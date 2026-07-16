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

// Engine-only / redundant fields the client never renders.
const STRIP = new Set([
  'titleTokens','normalizedTitle','objectFingerprint','modelKey','reference',
  'materialTokens','mediumCanon','authCert','gradeLabel','description','titleRaw',
  'serialNo','editionOf','editionTotal','editionMarker','dimSource','yearSource',
  'yearIsCirca','sizeClass','repeatSaleGroupId','fxRecovered','fxRate','fxAsOf',
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
 *  isArchived(lot) decides which file a lot lands in (Goldin sold → archive). */
export function writeCorpusAndServed(
  allLots: Record<string, unknown>[],
  isArchived: (l: Record<string, unknown>) => boolean,
): { corpusMb: string; servedMb: string; archiveMb: string } {
  fs.mkdirSync(CORPUS_DIR, { recursive: true });
  const archive = allLots.filter(isArchived);
  const main = allLots.filter(l => !isArchived(l));
  const mb = (n: number) => (n / 1048576).toFixed(1);

  // full corpus (gz) — source of truth
  const lotsGz = zlib.gzipSync(Buffer.from(JSON.stringify(main)));
  const archGz = zlib.gzipSync(Buffer.from(JSON.stringify(archive)));
  fs.writeFileSync(path.join(CORPUS_DIR, 'lots.json.gz'), lotsGz);
  fs.writeFileSync(path.join(CORPUS_DIR, 'sold-archive.json.gz'), archGz);

  // slim served — the main file is SHARDED (lots-0.json, lots-1.json, … +
  // lots-index.json) because a single lots.json outgrew Cloudflare Pages'
  // 25 MiB/file HARD cap (deploys fail outright past it). ~18 MiB per shard
  // leaves headroom; the client fetches all shards in parallel and concats.
  const SHARD_TARGET = 18 * 1048576;
  const slimStrs = main.map(l => JSON.stringify(slimForClient(l)));
  const shards: string[][] = [[]];
  let curBytes = 2;
  for (const s of slimStrs) {
    const last = shards[shards.length - 1];
    if (last.length && curBytes + s.length + 1 > SHARD_TARGET) { shards.push([s]); curBytes = 2 + s.length; }
    else { last.push(s); curBytes += s.length + 1; }
  }
  // clear stale shards beyond the new count, and the legacy single file
  for (let i = shards.length; ; i++) {
    const p = path.join(SERVED_DIR, `lots-${i}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p); else break;
  }
  const legacy = path.join(SERVED_DIR, 'lots.json');
  if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
  let servedBytes = 0;
  shards.forEach((arr, i) => {
    const body = '[' + arr.join(',') + ']';
    servedBytes += Buffer.byteLength(body);
    fs.writeFileSync(path.join(SERVED_DIR, `lots-${i}.json`), body);
  });
  fs.writeFileSync(path.join(SERVED_DIR, 'lots-index.json'), JSON.stringify({ shards: shards.length }));

  const archSlim = JSON.stringify(archive.map(slimForClient));
  fs.writeFileSync(path.join(SERVED_DIR, 'sold-archive.json'), archSlim);

  const CAP = 24 * 1048576;
  if (Buffer.byteLength(archSlim) > CAP) console.warn(`[corpus] served sold-archive.json is ${mb(Buffer.byteLength(archSlim))}MB — approaching Cloudflare's 25MB/file cap (shard it like lots)`);

  console.log(`[corpus] served lots sharded ×${shards.length} (${mb(servedBytes)}MB total)`);
  return { corpusMb: mb(lotsGz.length), archiveMb: mb(archGz.length), servedMb: mb(servedBytes) };
}
