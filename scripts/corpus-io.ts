/**
 * Corpus IO — the split between the full v2 CORPUS (for the build + the value
 * engine) and the slim SERVED files (for the client).
 *
 * - data/corpus/{lots,sold-archive}.json.gz  = full v2 (~76 fields/lot), the
 *   source of truth. gzipped so git stays sane (53MB raw → ~5MB). Build-time
 *   + step-2 read this. NEVER served.
 * - public/data/ray/{lots,sold-archive}.json = slim projection (display + the
 *   fields the UI reads, nulls omitted), <25MB, the phase-2 client stream.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
export const CORPUS_DIR = path.join(process.cwd(), 'data', 'corpus');
export const SERVED_DIR = path.join(process.cwd(), 'public', 'data', 'ray');

// ── SEGMENTS: the corpus split BY AUCTION HOUSE, so the nightly can crawl each
// in its OWN isolated, bounded, retryable job (data/corpus/segments/<name>.json.gz)
// instead of one monolith that loads the whole 455k+ corpus. A lot's house is
// disjoint (unlike its vertical, which cross-pulls — a Sotheby's sports sale can
// hold culture lots), so house segments never overlap and assemble.ts is a
// clean concat. Each house's crawlers own their segment. Wright+Rago share a
// crawler → one 'wright' segment.
export const SEGMENTS_DIR = path.join(CORPUS_DIR, 'segments');
// NOTE: the sports/pop-culture expansion segments (rea, scp, …) are DELIBERATELY
// omitted from this list AND from the nightly matrix + assemble list until each
// house's crawler clears verification — they are built isolated (scripts/
// crawl-<house>.ts write their own segment file directly) so nothing reaches the
// production corpus until explicitly wired in.
export const SEGMENT_NAMES = ['goldin', 'sothebys', 'christies', 'bonhams', 'phillips', 'wright', 'rrauction', 'rrauction-archive', 'other'] as const;
export type SegmentName = (typeof SEGMENT_NAMES)[number];

const HOUSE_TO_SEGMENT: Record<string, SegmentName> = {
  'Goldin': 'goldin', "Sotheby's": 'sothebys', 'Sothebys': 'sothebys', "Christie's": 'christies',
  'Christies': 'christies', 'Bonhams': 'bonhams', 'Phillips': 'phillips', 'Wright': 'wright', 'Rago': 'wright',
  // LAMA sells on the Wright/Rago platform and is crawled inside the wright
  // segment's job — one operator, one segment (like Rago).
  'LAMA': 'wright',
  'RR Auction': 'rrauction',
  // sports + pop-culture expansion — one isolated segment per house. These map
  // to 'other' via the fallback until each is verified and added to the assemble
  // list; the standalone crawlers write their named segment directly.
  'REA': 'rea' as SegmentName, 'Huggins & Scott': 'hugginsscott' as SegmentName,
  'SCP': 'scp' as SegmentName, 'Lelands': 'lelands' as SegmentName,
  'Memory Lane': 'memorylane' as SegmentName, 'Love of the Game': 'lotg' as SegmentName,
  "Julien's": 'juliens' as SegmentName, "Hake's": 'hakes' as SegmentName,
  'Propstore': 'propstore' as SegmentName,
};
/** Which segment a lot belongs to — keyed on its auction house. */
export function segmentOf(auctionHouse: string): SegmentName {
  return HOUSE_TO_SEGMENT[auctionHouse] || 'other';
}

// Segments are stored as gzipped NDJSON (one lot per line), NOT a JSON array.
// A 322k-lot Goldin segment JSON-stringifies to >512MB — past V8's max string
// length ("RangeError: Invalid string length"). NDJSON never builds one giant
// string: write concatenates small per-lot buffers; read parses line-by-line
// over the gunzipped buffer. Scales to any segment size.
// NDJSON files use a DISTINCT extension (.ndjson.gz) from the legacy JSON-array
// segments (.json.gz). Same-key overwrites suffered R2 GET-lag: a crawl could
// read the OLD array format from a NEW-format key, mis-parse the whole array as
// one line, and crash (undefined id). A separate key has no old object to lag
// onto. The parser also defensively flattens any array-line (belt + braces).
function parseNdjson(buf: Buffer): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const pushLine = (s: number, e: number) => {
    if (e <= s) return;
    const v = JSON.parse(buf.toString('utf8', s, e));
    if (Array.isArray(v)) { for (const x of v) out.push(x); } else out.push(v);
  };
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) { pushLine(start, i); start = i + 1; } // '\n'
  }
  pushLine(start, buf.length);
  return out;
}

export function readSegment(name: string): Record<string, unknown>[] {
  const gz = path.join(SEGMENTS_DIR, name + '.ndjson.gz');
  if (!fs.existsSync(gz)) return [];
  return parseNdjson(zlib.gunzipSync(fs.readFileSync(gz)));
}

export function writeSegment(name: string, lots: Record<string, unknown>[]): void {
  fs.mkdirSync(SEGMENTS_DIR, { recursive: true });
  const parts: Buffer[] = [];
  for (const l of lots) parts.push(Buffer.from(JSON.stringify(l) + '\n', 'utf8'));
  fs.writeFileSync(path.join(SEGMENTS_DIR, name + '.ndjson.gz'), zlib.gzipSync(Buffer.concat(parts)));
}

/** Concat every segment file back into the full corpus (for assemble/engine). */
export function readAllSegments(): Record<string, unknown>[] {
  if (!fs.existsSync(SEGMENTS_DIR)) return [];
  const out: Record<string, unknown>[] = [];
  for (const f of fs.readdirSync(SEGMENTS_DIR).sort()) {
    if (!f.endsWith('.ndjson.gz')) continue;
    const rows = parseNdjson(zlib.gunzipSync(fs.readFileSync(path.join(SEGMENTS_DIR, f))));
    for (const r of rows) out.push(r); // loop-append: spread overflows past ~100k
  }
  return out;
}

/** Partition a full lot list into per-segment buckets (bootstrap + tests). */
export function splitIntoSegments(allLots: Record<string, unknown>[]): Record<string, Record<string, unknown>[]> {
  const byName: Record<string, Record<string, unknown>[]> = {};
  for (const l of allLots) {
    const name = segmentOf(String((l as { auctionHouse?: string }).auctionHouse || ''));
    (byName[name] || (byName[name] = [])).push(l);
  }
  return byName;
}

// Engine-only / redundant fields the client never renders.
// `reference` and `repeatSaleGroupId` are deliberately NOT stripped: the client
// links watch lots to /ref pages and renders provenance timelines from them,
// and nulls are omitted below so they only cost bytes where actually set.
// `formKey` is deliberately NOT stripped either: ComparableModal/LotPage print
// the "N comparable <form>" headline straight off lot.formKey (no classifyForm
// fallback there), so stripping it made every shard-loaded lot read 'unknown'.
// It's a short string and nulls are omitted, so the cost is a few bytes/lot.
const STRIP = new Set([
  'titleTokens','normalizedTitle','objectFingerprint','modelKey',
  'materialTokens','mediumCanon','authCert','gradeLabel','description','titleRaw',
  'serialNo','editionOf','editionTotal','editionMarker','dimSource','yearSource',
  'yearIsCirca','sizeClass','fxRecovered','fxRate','fxAsOf',
  'schemaVersion','validatedAt','firstSeenKnown','platform','saleDateTime',
  'buyerPremiumPct','hammerNative','premiumNative','realizedNative','hammerUsd',
  'premiumUsd','estLowNative','estHighNative','nativeCurrency','makerSlug',
  'entityClass','imageHash',
  // engine-only USD twins — the client renders the estimateLow/estimateHigh/
  // priceUsd aliases (which carry USD), so these are pure duplicate weight.
  'estLowUsd','estHighUsd','realizedUsd',
  // nightly bid snapshots (corpus-only raw material for bid momentum)
  'bidHistory',
  // measured client-unread (serving audit Jul 31 2026, ~30MB raw): the client
  // renders priceUsd (premiumPrice is a duplicate alias), archived/auctionId/
  // buyerPremium/_pid/_pname/_card/photoMatched are pipeline-only. subCat/
  // drill/sport STAY — the feed lens, cat cell, and lot certificate read them.
  'premiumPrice', 'archived', 'auctionId', 'buyerPremium', '_pid', '_pname', '_card', 'photoMatched',
]);

// The corpus files (lots.json.gz, sold-archive.json.gz) and segments are stored
// as gzipped NDJSON — NOT a JSON array. A single JSON.stringify / gunzip.toString
// of the 318k-lot sold-archive (crawl-enriched with bidHistory) blows V8's max
// string length (0x1fffffe8 ≈ 512MB) on BOTH write and read. NDJSON never builds
// one giant string: write concatenates small per-row buffers; read parses each
// line over the gunzipped buffer. gzipNdjson/readGzRows are the shared codecs
// every corpus reader/writer must use (build-market, build-upcoming, backfills).
export function gzipNdjson(rows: Record<string, unknown>[]): Buffer {
  const parts: Buffer[] = [];
  for (const r of rows) parts.push(Buffer.from(JSON.stringify(r) + '\n', 'utf8'));
  return zlib.gzipSync(Buffer.concat(parts));
}
/** Read a gzipped-NDJSON corpus/segment file (buffer-safe). Also flattens a
 *  legacy single-line JSON array, so pre-conversion files still read. */
export function readGzRows(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return parseNdjson(zlib.gunzipSync(fs.readFileSync(file)));
}

export function slimForClient<T extends Record<string, unknown>>(lot: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k in lot) {
    if (STRIP.has(k)) continue;
    const v = lot[k];
    if (v === null || v === undefined) continue;          // omit nulls — pure weight
    if (Array.isArray(v) && v.length === 0) continue;
    // truthy-only reads: every consumer checks `if (l.resultsPending)` — the
    // explicit false is measured dead weight (~1.2MB) on served rows
    if (k === 'resultsPending' && v === false) continue;
    out[k] = v;
  }
  // ── THE ALIAS CONTRACT: every legacy money alias on a SERVED row carries USD.
  // estimateLow/estimateHigh/priceUsd already do. `hammerPrice` did NOT — it
  // mirrored hammerNative, so a GBP lot shipped hammerPrice=550 next to a USD
  // estimateLow=650. Every client consumer reads it as USD
  // (`hammerUsd ?? hammerPrice`, with hammerUsd STRIPPED from served): utils.ts
  // overEstimatePct, the /value settled tape, and demand.ts. Measured on the
  // served payload: 7,306 of 22,339 sold rows carrying hammerPrice held a
  // native value (median priceUsd/hammerPrice 1.86 where a true premium is
  // ~1.25), understating the demand index by a median 30 POINTS and dragging
  // every lander hero negative. This is the v2 money bug — native vs USD —
  // re-entering through an alias. Project the USD twin onto the alias so the
  // contract holds: the client renders dollars, so the alias must BE dollars.
  const hUsd = lot['hammerUsd'];
  if (typeof hUsd === 'number' && hUsd > 0) out['hammerPrice'] = hUsd;
  else if ('hammerPrice' in out) delete out['hammerPrice']; // native-only ⇒ omit, never mislead
  return out;
}

/** Read the full corpus (gz first, then raw). NEVER falls back to the slim
 *  SERVED files: those have engine fields (titleTokens, realizedNative, …)
 *  STRIPPED, so a served-fallback read would silently produce empty comps /
 *  zeroed dashboards. A missing full corpus must fail loud, not degrade. */
export function readCorpus(): Record<string, unknown>[] {
  const read = (base: string): Record<string, unknown>[] | null => {
    const gz = path.join(CORPUS_DIR, base + '.gz');
    if (fs.existsSync(gz)) return readGzRows(gz); // buffer-safe NDJSON (handles legacy arrays)
    const raw = path.join(CORPUS_DIR, base);
    if (fs.existsSync(raw)) return parseNdjson(fs.readFileSync(raw));
    return null;
  };
  const main = read('lots.json');
  if (main === null) throw new Error(`[corpus] lots.json(.gz) not found in ${CORPUS_DIR} — refusing to read the stripped served files. Restore the corpus before building.`);
  const archive = read('sold-archive.json');
  // The archive (Goldin sold history) can legitimately be absent pre-split, but
  // a silent empty here would starve the sports comp pool — log the counts loud.
  if (archive === null) console.warn(`[corpus] sold-archive.json(.gz) not found — proceeding with ${main.length} main lots and NO archive`);
  return main.concat(archive || []);
}

/** Write the full corpus (gz) + slim served files from an in-memory allLots.
 *  isArchived(lot) decides which file a lot lands in (Goldin sold → archive).
 *  isCorpusOnly(lot) (optional) keeps a lot in the CORPUS gz (engine reads it)
 *  but strips it from EVERY served file — for bulk data (348K sold sport cards)
 *  that must not bloat the client payload. Corpus-only lots still land in the
 *  main/archive gz split per isArchived, just never in the shards or served
 *  archive. */
export function writeCorpusAndServed(
  allLots: Record<string, unknown>[],
  isArchived: (l: Record<string, unknown>) => boolean,
  isCorpusOnly: (l: Record<string, unknown>) => boolean = () => false,
): { corpusMb: string; servedMb: string; archiveMb: string } {
  fs.mkdirSync(CORPUS_DIR, { recursive: true });
  // The served dir is R2-only (gitignored), so a fresh assemble checkout that
  // pulled ONLY segments has no public/data/ray yet — create it before writing
  // the shards, or writeSharded ENOENTs on lots-0.json.
  fs.mkdirSync(SERVED_DIR, { recursive: true });
  const archive = allLots.filter(isArchived);
  const main = allLots.filter(l => !isArchived(l));
  const mb = (n: number) => (n / 1048576).toFixed(1);

  // full corpus (gz) — source of truth (INCLUDES corpus-only lots). Serialize
  // as a JSON array WITHOUT one giant intermediate string: JSON.stringify of a
  // 300k+ lot array blows V8's max string length. Concat small per-lot buffers.
  const lotsGz = gzipNdjson(main);
  const archGz = gzipNdjson(archive);
  fs.writeFileSync(path.join(CORPUS_DIR, 'lots.json.gz'), lotsGz);
  fs.writeFileSync(path.join(CORPUS_DIR, 'sold-archive.json.gz'), archGz);

  // served projections EXCLUDE corpus-only lots (they'd blow the payload)
  const mainServed = main.filter(l => !isCorpusOnly(l));
  const archiveServed = archive.filter(l => !isCorpusOnly(l));

  // slim served — BOTH tiers are SHARDED (<file>-0.json, <file>-1.json, … +
  // <file>-index.json) because a single file outgrew Cloudflare Pages'
  // 25 MiB/file HARD cap (deploys fail outright past it — lots.json first,
  // then the archive crossed 22MB after the card sample). ~18 MiB per shard
  // leaves headroom; the client fetches a tier's shards in parallel + concats.
  const SHARD_TARGET = 18 * 1048576;
  const writeSharded = (base: string, rows: Record<string, unknown>[]): number => {
    const strs = rows.map(l => JSON.stringify(slimForClient(l)));
    const shards: string[][] = [[]];
    let curBytes = 2;
    for (const s of strs) {
      const last = shards[shards.length - 1];
      if (last.length && curBytes + s.length + 1 > SHARD_TARGET) { shards.push([s]); curBytes = 2 + s.length; }
      else { last.push(s); curBytes += s.length + 1; }
    }
    // clear stale shards beyond the new count, and the legacy single file
    for (let i = shards.length; ; i++) {
      const p = path.join(SERVED_DIR, `${base}-${i}.json`);
      if (fs.existsSync(p)) fs.unlinkSync(p); else break;
    }
    const legacy = path.join(SERVED_DIR, `${base}.json`);
    if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
    let bytes = 0;
    shards.forEach((arr, i) => {
      const body = '[' + arr.join(',') + ']';
      bytes += Buffer.byteLength(body);
      fs.writeFileSync(path.join(SERVED_DIR, `${base}-${i}.json`), body);
    });
    fs.writeFileSync(path.join(SERVED_DIR, `${base}-index.json`), JSON.stringify({ shards: shards.length }));
    console.log(`[corpus] served ${base} sharded ×${shards.length} (${mb(bytes)}MB total)`);
    return bytes;
  };
  const servedBytes = writeSharded('lots', mainServed);
  writeSharded('sold-archive', archiveServed);
  return { corpusMb: mb(lotsGz.length), archiveMb: mb(archGz.length), servedMb: mb(servedBytes) };
}
