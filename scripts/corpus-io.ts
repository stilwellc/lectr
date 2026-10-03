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
  'NFL Auction': 'nflauction' as SegmentName,
  'MLB Auctions': 'mlbauction' as SegmentName,
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
    // Per-segment isolation: a truncated/corrupt segment must degrade ONE
    // house (its lots simply absent this run; the sanity gate judges the
    // total), never abort the whole reunion and forfeit every other house's
    // fresh crawl. The R2 last-good fallback only fills MISSING files, so a
    // present-but-corrupt file previously killed the night.
    try {
      const rows = parseNdjson(zlib.gunzipSync(fs.readFileSync(path.join(SEGMENTS_DIR, f))));
      for (const r of rows) out.push(r); // loop-append: spread overflows past ~100k
    } catch (e) {
      console.error(`[corpus-io] SEGMENT CORRUPT — skipping ${f}: ${(e as Error).message}`);
    }
  }
  return out;
}

// ── STREAMING CODECS (Oct 2026 scale pass) ─────────────────────────────────
// The sync readers above gunzip a whole file into ONE Buffer before parsing —
// the goldin segment alone is ~1.3GB raw, the merged corpus ~2GB, all off-heap
// on top of the parsed rows. The streaming reader inflates in 1MB chunks and
// parses each '\n'-terminated line as it completes, so the transient cost is
// one chunk. It splits on 0x0A ONLY (never readline: readline also breaks on
// \r, which JSON strings never carry raw but a stray CR in a crawled title
// would), and flattens a legacy array-line exactly like parseNdjson.

/** Stream a gzipped NDJSON file line by line: onLine(buf, start, end) for every
 *  non-empty '\n'-terminated line (the trailing unterminated one included).
 *  `buf` is only valid during the call. */
export async function streamGzLines(file: string, onLine: (buf: Buffer, start: number, end: number) => void): Promise<void> {
  if (!fs.existsSync(file)) return;
  let carry: Buffer | null = null;
  const src = fs.createReadStream(file, { highWaterMark: 1 << 20 }).pipe(zlib.createGunzip({ chunkSize: 1 << 20 }));
  for await (const chunk of src as AsyncIterable<Buffer>) {
    const buf: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    for (let nl = buf.indexOf(10, start); nl >= 0; nl = buf.indexOf(10, start)) {
      if (nl > start) onLine(buf, start, nl);
      start = nl + 1;
    }
    carry = start < buf.length ? Buffer.from(buf.subarray(start)) : null;
  }
  if (carry && carry.length) onLine(carry, 0, carry.length);
}

/** Stream a gzipped NDJSON file, calling onRow for every parsed row in file
 *  order (a legacy array-line is flattened, exactly like parseNdjson). */
export async function streamGzRows(file: string, onRow: (row: Record<string, unknown>) => void): Promise<void> {
  await streamGzLines(file, (buf, s, e) => {
    const v = JSON.parse(buf.toString('utf8', s, e));
    if (Array.isArray(v)) { for (const x of v) onRow(x); } else onRow(v);
  });
}

/** Engine scratch fields that ride the crawl segments from older builds but
 *  are overwritten (or never read) before any output is produced:
 *  `_v` (the IDF vector, rebuilt by buildVectors for every engine lot and
 *  deleted before the corpus write — ~190MB of JSON, ~1GB of heap as
 *  dictionary objects) and `_saleMs` (re-stamped for every lot before its
 *  first read, deleted before the write). Dropping them at read changes no
 *  output; scripts/ci/equivalence.ts proves it on the real corpus. */
export const DEAD_SEGMENT_FIELDS = ['_v', '_saleMs'] as const;

/** Remove top-level `"key":value` members from one JSON object line, as TEXT,
 *  before it is parsed. Text, not `delete` (or a rebuilt copy): an object
 *  JSON.parse builds is packed exactly to its keys, while deleting a
 *  non-final key drops it to V8 dictionary mode and a key-by-key copy grows
 *  an out-of-object backing store — both measured +33% heap on the corpus.
 *  Structural matches only (a `"` inside a JSON string is always escaped), at
 *  depth 1 only (a nested key of the same name is kept). */
export function stripTopLevelKeysText(line: string, keys: readonly string[]): string {
  let hit = false;
  for (const k of keys) if (line.indexOf(`"${k}":`) >= 0) { hit = true; break; }
  if (!hit) return line;
  const n = line.length;
  let out = '';
  let from = 0;
  let depth = 0;
  let i = 0;
  // skip a JSON string starting at quote index q; returns index after the closing quote
  const skipStr = (q: number): number => {
    let j = q + 1;
    while (j < n) {
      const c = line.charCodeAt(j);
      if (c === 92) j += 2; else if (c === 34) return j + 1; else j++;
    }
    return n;
  };
  // skip one JSON value starting at v (after any whitespace); returns index after it
  const skipVal = (v: number): number => {
    let j = v, d = 0;
    while (j < n) {
      const c = line.charCodeAt(j);
      if (c === 34) { j = skipStr(j); if (d === 0) return j; continue; }
      if (c === 123 || c === 91) d++;
      else if (c === 125 || c === 93) { if (d === 0) return j; d--; if (d === 0) return j + 1; }
      else if (d === 0 && c === 44) return j;
      j++;
    }
    return j;
  };
  while (i < n) {
    const c = line.charCodeAt(i);
    if (c === 34) {
      const e = skipStr(i);
      if (depth === 1 && line.charCodeAt(e) === 58) { // a top-level key
        const key = line.slice(i + 1, e - 1);
        if (keys.indexOf(key) >= 0) {
          const ve = skipVal(e + 1);
          // drop `,"k":v` (or `"k":v,` when it is the first member)
          let ks = i;
          let vend = ve;
          if (line.charCodeAt(i - 1) === 44) ks = i - 1;
          else if (line.charCodeAt(ve) === 44) vend = ve + 1;
          out += line.slice(from, ks);
          from = vend;
          i = vend;
          continue;
        }
        i = e;
        continue;
      }
      i = e;
      continue;
    }
    if (c === 123 || c === 91) depth++;
    else if (c === 125 || c === 93) depth--;
    i++;
  }
  return from === 0 ? line : out + line.slice(from);
}

/** readAllSegments, streamed + lean: same rows, same order, same per-segment
 *  corruption isolation (a segment's rows land only if the WHOLE segment
 *  parsed), minus DEAD_SEGMENT_FIELDS (stripped as text before the parse). */
export async function readAllSegmentsLean(): Promise<Record<string, unknown>[]> {
  if (!fs.existsSync(SEGMENTS_DIR)) return [];
  const out: Record<string, unknown>[] = [];
  for (const f of fs.readdirSync(SEGMENTS_DIR).sort()) {
    if (!f.endsWith('.ndjson.gz')) continue;
    const rows: Record<string, unknown>[] = [];
    try {
      await streamGzLines(path.join(SEGMENTS_DIR, f), (buf, s, e) => {
        const v = JSON.parse(stripTopLevelKeysText(buf.toString('utf8', s, e), DEAD_SEGMENT_FIELDS));
        if (Array.isArray(v)) { for (const x of v) rows.push(stripKeys(x, DEAD_SEGMENT_FIELDS)); } else rows.push(v);
      });
    } catch (e) {
      console.error(`[corpus-io] SEGMENT CORRUPT — skipping ${f}: ${(e as Error).message}`);
      continue;
    }
    for (const r of rows) out.push(r);
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
  // advisory LLM extraction (scripts/lib/extract) — corpus-only pipeline input
  'llm',
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
    // `abstain` (P1-6) is a short reason string stamped by build-market when
    // the engine DECLINED to value a lot — kept so served data distinguishes
    // "abstained" (abstain set, no value) from "never ran" (neither key).
    // `value: null` is still omitted below (the abstain string is the marker).
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

/** THE served live book — ONE predicate for every consumer (Sep 27 2026). The
 *  Supabase sync upserted every status==='upcoming' row (11,708) while the site
 *  served only upcoming.json's filtered set (7,913): the DB carried ~3.8k closed
 *  lots as "live". build-upcoming.ts and sync-lots-db.ts now both call this.
 *  Rule: status 'upcoming' AND (a results-pending lot within its one-day grace,
 *  else a sale day >= today) — the same timezone-safe day-string compare the
 *  client feed uses. `now` is injectable for tests. */
export function isServedUpcoming(l: { status?: unknown; saleDate?: unknown; resultsPending?: unknown }, now: Date = new Date()): boolean {
  if (l.status !== 'upcoming') return false;
  const day = typeof l.saleDate === 'string' ? l.saleDate.slice(0, 10) : '';
  if (!day) return false;
  if (l.resultsPending) return day >= new Date(now.getTime() - 864e5).toISOString().slice(0, 10);
  return day >= now.toISOString().slice(0, 10);
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

/** A copy of `r` without `keys`, key order kept. Returns `r` itself when none
 *  is present. (For bulk rows prefer stripTopLevelKeysText before the parse.) */
export function stripKeys<T extends Record<string, unknown>>(r: T, keys: readonly string[]): T {
  let hit = false;
  for (const k of keys) if (k in r) { hit = true; break; }
  if (!hit) return r;
  const drop = new Set(keys);
  const o: Record<string, unknown> = {};
  for (const k in r) if (!drop.has(k)) o[k] = r[k];
  return o as T;
}

const SHARD_TARGET = 18 * 1048576;
/** The served-shard writer, streamed: identical shard boundaries and bytes to
 *  the array version in writeCorpusAndServed (boundaries depend only on the
 *  row strings in order), but only ONE shard's strings are ever resident. */
function writeShardedStream(base: string, rows: Record<string, unknown>[]): { bytes: number; shards: number } {
  let cur: string[] = [];
  let curBytes = 2;
  let n = 0, bytes = 0;
  const flush = () => {
    const body = '[' + cur.join(',') + ']';
    bytes += Buffer.byteLength(body);
    fs.writeFileSync(path.join(SERVED_DIR, `${base}-${n}.json`), body);
    n++; cur = []; curBytes = 2;
  };
  for (const l of rows) {
    const s = JSON.stringify(slimForClient(l));
    if (cur.length && curBytes + s.length + 1 > SHARD_TARGET) { flush(); cur = [s]; curBytes = 2 + s.length; }
    else { cur.push(s); curBytes += s.length + 1; }
  }
  flush(); // the array version always writes shard 0, even for an empty tier
  for (let i = n; ; i++) {
    const p = path.join(SERVED_DIR, `${base}-${i}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p); else break;
  }
  const legacy = path.join(SERVED_DIR, `${base}.json`);
  if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
  fs.writeFileSync(path.join(SERVED_DIR, `${base}-index.json`), JSON.stringify({ shards: n }));
  console.log(`[corpus] served ${base} sharded ×${n} (${(bytes / 1048576).toFixed(1)}MB total)`);
  return { bytes, shards: n };
}

/** Gzip writer over a libuv-threadpool stream: deflate runs OFF the main
 *  thread while JS serializes the next rows. Same zlib defaults as gzipSync. */
class GzFile {
  private gz = zlib.createGzip();
  private out: fs.WriteStream;
  private done: Promise<void>;
  constructor(file: string) {
    this.out = fs.createWriteStream(file);
    this.done = new Promise((res, rej) => { this.out.on('finish', () => res()); this.out.on('error', rej); this.gz.on('error', rej); });
    this.gz.pipe(this.out);
  }
  /** resolves when the pipe can take more (backpressure) */
  write(s: string): Promise<void> | null {
    return this.gz.write(s) ? null : new Promise(r => this.gz.once('drain', () => r()));
  }
  async end(): Promise<number> {
    this.gz.end();
    await this.done;
    return this.out.bytesWritten;
  }
}

export type CorpusRowSink = { add(tier: 'main' | 'archive', ord: number, line: string, row: Record<string, unknown>): void | Promise<void>; finish(): Promise<void> };

/** persistCorpusAndServed — writeCorpusAndServed for the single-load nightly.
 *  Writes byte-identical files (served shards from the in-memory rows exactly
 *  as before; lots.json.gz / sold-archive.json.gz with the same NDJSON
 *  content), then CONSUMES `allLots`: each row is serialized once for the
 *  gz, and replaced by `JSON.parse` of that very line — so the returned
 *  `view` is exactly what readCorpus() would return from the files just
 *  written (main tier, then archive), while only one copy of the corpus is
 *  ever resident. `allLots` is emptied (the caller must not hold other
 *  references to the rows if it wants the memory back). `sink` receives
 *  every written line (the columnar corpus writer). */
export async function persistCorpusAndServed(
  allLots: Record<string, unknown>[],
  isArchived: (l: Record<string, unknown>) => boolean,
  isCorpusOnly: (l: Record<string, unknown>) => boolean = () => false,
  opts: { sink?: CorpusRowSink | null } = {},
): Promise<{ corpusMb: string; servedMb: string; archiveMb: string; view: Record<string, unknown>[] }> {
  fs.mkdirSync(CORPUS_DIR, { recursive: true });
  fs.mkdirSync(SERVED_DIR, { recursive: true });
  const mb = (n: number) => (n / 1048576).toFixed(1);
  // the columnar sink is ADVISORY: a failure drops it, never the write
  let sink = opts.sink ?? null;
  const tierOf: Uint8Array = new Uint8Array(allLots.length);
  let nArch = 0;
  for (let i = 0; i < allLots.length; i++) if (isArchived(allLots[i])) { tierOf[i] = 1; nArch++; }
  const served = (tier: number) => allLots.filter((l, i) => tierOf[i] === tier && !isCorpusOnly(l));
  // served first — slimForClient reads the IN-MEMORY rows (a NaN or an
  // undefined-valued key serializes differently once roundtripped)
  const sMain = writeShardedStream('lots', served(0));
  writeShardedStream('sold-archive', served(1));
  // corpus: main tier then archive, one line per row; each row is replaced in
  // the view by its own reparsed line and released from allLots
  const view: Record<string, unknown>[] = [];
  const archView: Record<string, unknown>[] = [];
  const sizes: number[] = [];
  for (const tier of [0, 1] as const) {
    const gz = new GzFile(path.join(CORPUS_DIR, tier === 0 ? 'lots.json.gz' : 'sold-archive.json.gz'));
    const dest = tier === 0 ? view : archView;
    for (let i = 0; i < allLots.length; i++) {
      if (tierOf[i] !== tier) continue;
      const line = JSON.stringify(allLots[i]) + '\n';
      const row = JSON.parse(line) as Record<string, unknown>;
      if (sink) {
        try { await sink.add(tier === 0 ? 'main' : 'archive', dest.length, line, row); }
        catch (e) { console.log(`::warning title=columnar corpus skipped::${(e as Error).message}`); sink = null; }
      }
      dest.push(row);
      allLots[i] = null as unknown as Record<string, unknown>;
      const wait = gz.write(line);
      if (wait) await wait;
    }
    sizes.push(await gz.end());
  }
  allLots.length = 0;
  if (sink) {
    try { await sink.finish(); }
    catch (e) { console.log(`::warning title=columnar corpus skipped::${(e as Error).message}`); }
  }
  for (const r of archView) view.push(r);
  return { corpusMb: mb(sizes[0]), archiveMb: mb(sizes[1]), servedMb: mb(sMain.bytes), view };
}

/** The corpus as the market build used to read it back from the files assemble
 *  wrote (readCorpus order: main tier, then archive; every row the JSON
 *  roundtrip of the in-memory one) — without writing or parsing any file.
 *  Consumes `allLots` (emptied) so the corpus is resident once. */
export function roundtripCorpusView(allLots: Record<string, unknown>[], isArchived: (l: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const tierOf = new Uint8Array(allLots.length);
  let nArch = 0;
  for (let i = 0; i < allLots.length; i++) if (isArchived(allLots[i])) { tierOf[i] = 1; nArch++; }
  const view: Record<string, unknown>[] = [];
  const arch: Record<string, unknown>[] = new Array(nArch);
  let j = 0;
  for (let i = 0; i < allLots.length; i++) {
    const r = JSON.parse(JSON.stringify(allLots[i])) as Record<string, unknown>;
    if (tierOf[i] === 1) arch[j++] = r; else view.push(r);
    allLots[i] = null as unknown as Record<string, unknown>;
  }
  allLots.length = 0;
  for (const r of arch) view.push(r);
  return view;
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
