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
export const SEGMENT_NAMES = ['goldin', 'sothebys', 'christies', 'bonhams', 'phillips', 'wright', 'other'] as const;
export type SegmentName = (typeof SEGMENT_NAMES)[number];

const HOUSE_TO_SEGMENT: Record<string, SegmentName> = {
  'Goldin': 'goldin', "Sotheby's": 'sothebys', 'Sothebys': 'sothebys', "Christie's": 'christies',
  'Christies': 'christies', 'Bonhams': 'bonhams', 'Phillips': 'phillips', 'Wright': 'wright', 'Rago': 'wright',
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
const STRIP = new Set([
  'titleTokens','normalizedTitle','objectFingerprint','modelKey',
  'materialTokens','mediumCanon','authCert','gradeLabel','description','titleRaw',
  'serialNo','editionOf','editionTotal','editionMarker','dimSource','yearSource',
  'yearIsCirca','sizeClass','fxRecovered','fxRate','fxAsOf',
  'schemaVersion','validatedAt','firstSeenKnown','platform','saleDateTime',
  'buyerPremiumPct','hammerNative','premiumNative','realizedNative','hammerUsd',
  'premiumUsd','estLowNative','estHighNative','nativeCurrency','makerSlug',
  'entityClass','formKey','imageHash',
  // engine-only USD twins — the client renders the estimateLow/estimateHigh/
  // priceUsd aliases (which carry USD), so these are pure duplicate weight.
  'estLowUsd','estHighUsd','realizedUsd',
  // nightly bid snapshots (corpus-only raw material for bid momentum)
  'bidHistory',
]);

/** Gzip a JSON ARRAY without building one giant intermediate string (which
 *  blows V8's max string length past ~300k lots). Concat small per-row buffers. */
export function gzipJsonArray(rows: Record<string, unknown>[]): Buffer {
  const parts: Buffer[] = [Buffer.from('[', 'utf8')];
  for (let i = 0; i < rows.length; i++) {
    if (i) parts.push(Buffer.from(',', 'utf8'));
    parts.push(Buffer.from(JSON.stringify(rows[i]), 'utf8'));
  }
  parts.push(Buffer.from(']', 'utf8'));
  return zlib.gzipSync(Buffer.concat(parts));
}

export function slimForClient<T extends Record<string, unknown>>(lot: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k in lot) {
    if (STRIP.has(k)) continue;
    const v = lot[k];
    if (v === null || v === undefined) continue;          // omit nulls — pure weight
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/** Read the full corpus (gz first, then raw). NEVER falls back to the slim
 *  SERVED files: those have engine fields (titleTokens, realizedNative, …)
 *  STRIPPED, so a served-fallback read would silently produce empty comps /
 *  zeroed dashboards. A missing full corpus must fail loud, not degrade. */
export function readCorpus(): Record<string, unknown>[] {
  const read = (base: string): Record<string, unknown>[] | null => {
    const gz = path.join(CORPUS_DIR, base + '.gz');
    if (fs.existsSync(gz)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8'));
    const raw = path.join(CORPUS_DIR, base);
    if (fs.existsSync(raw)) return JSON.parse(fs.readFileSync(raw, 'utf8'));
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
  const archive = allLots.filter(isArchived);
  const main = allLots.filter(l => !isArchived(l));
  const mb = (n: number) => (n / 1048576).toFixed(1);

  // full corpus (gz) — source of truth (INCLUDES corpus-only lots). Serialize
  // as a JSON array WITHOUT one giant intermediate string: JSON.stringify of a
  // 300k+ lot array blows V8's max string length. Concat small per-lot buffers.
  const lotsGz = gzipJsonArray(main);
  const archGz = gzipJsonArray(archive);
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
