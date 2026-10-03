/**
 * emit-r2-index.ts — writes the per-key objects the read-only lot API
 * (functions/api, Cloudflare Pages Functions) reads from R2, into a LOCAL
 * directory. Uploading that directory is a separate step
 * (scripts/r2-api-push.sh; docs/data-pipeline.md "The lot API").
 *
 * WHY: every surface that needed lot-level history (the home archive table,
 * the comps modal, sold-lot comps, maker tables and charts, /analytics pools,
 * /receipts, the profile desk) used to stream the whole served corpus to the
 * browser (lots-*.json + sold-archive-*.json, ~500MB raw). Cloudflare Pages
 * caps a deploy at 20,000 files of ≤25MiB, so per-lot static files are
 * impossible; instead the API reads only the bytes one answer needs from a
 * handful of R2 blobs via ranged GETs (functions/_lib/format.ts has the
 * layout and every constant both sides share).
 *
 *   NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/emit-r2-index.ts \
 *     [--served public/data/ray] [--corpus data/corpus] [--out data/r2-api]
 *
 * Reads the SERVED book (meta, upcoming, lots-*.json, sold-archive-*.json) —
 * the same rows the browser used to stream, the eager upcoming lots' stamped
 * fields re-attached exactly as useRayData's phase 2 / emit-page-stats did —
 * plus, optionally, the full corpus (data/corpus/{lots,sold-archive}.json.gz)
 * to resolve engine pool ids that never ship on the wire. Pure read of those
 * inputs; writes only under --out:
 *
 *   <out>/api/current.json          the pointer (upload LAST)
 *   <out>/api/v/<version>/…         manifest.json, blob-N.bin, loc-NN.json
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AuctionLot } from '../app/types';
import { ARTISTS, MARKETS, marketArtists, marketOf } from '../app/constants';
import {
  BLOB_CAP, CHUNK_ROWS, FORMAT_VERSION, ID_BUCKETS, LOC_SHARDS, encodeScopeIndex, idBucketOf, locShardOf, locShardName,
  type Loc, type Manifest, type ScopeIndex, type SummaryJson,
} from '../functions/_lib/format';
import { bookPartitionsOf, culturePartitionsOf, formOf, isCandidate } from '../functions/_lib/pools';

type Row = AuctionLot & Record<string, unknown>;

export interface EmitInput {
  main: AuctionLot[];
  archive: AuctionLot[];
  eager: AuctionLot[];
  /** corpus-only rows an engine pool names (resolvable by id, in no table) */
  extras?: AuctionLot[];
  lastCrawl: string;
}
export interface EmitResult { version: string; dir: string; manifest: Manifest; objects: string[]; bytes: number }

const ARCHIVE_MARKETS = new Set(['sports', 'science']);
const TOP_ROWS = 60;
const SETTLED_KEEP = 300;

// ── blob writer ─────────────────────────────────────────────────────────────
class BlobWriter {
  blobs: string[] = [];
  private fd = -1;
  private size = 0;
  total = 0;
  readonly locs = new Map<string, Loc>();
  constructor(private dir: string) {}
  put(key: string, buf: Uint8Array): void {
    if (this.locs.has(key)) throw new Error(`duplicate key ${key}`);
    if (this.fd < 0 || (this.size > 0 && this.size + buf.length > BLOB_CAP)) this.rotate();
    fs.writeSync(this.fd, buf);
    this.locs.set(key, [this.blobs.length - 1, this.size, buf.length]);
    this.size += buf.length;
    this.total += buf.length;
  }
  putJsonGz(key: string, v: unknown): void {
    this.put(key, zlib.gzipSync(Buffer.from(JSON.stringify(v)), { level: 6 }));
  }
  private rotate() {
    if (this.fd >= 0) fs.closeSync(this.fd);
    const name = `blob-${this.blobs.length}.bin`;
    this.blobs.push(name);
    this.fd = fs.openSync(path.join(this.dir, name), 'w');
    this.size = 0;
  }
  close() { if (this.fd >= 0) fs.closeSync(this.fd); this.fd = -1; }
}

const dateMs = (l: AuctionLot) => { const t = new Date(l.saleDate).getTime(); return Number.isFinite(t) ? t : -Infinity; };

/** phase-2 re-attach (useRayData.loadFull / emit-page-stats): the eager lot's stamped fields win */
function reattacher(eager: AuctionLot[]) {
  const byId = new Map(eager.map(l => [l.id, l as Row]));
  return (l: AuctionLot): Row => {
    const e = byId.get(l.id);
    if (!e) return l as Row;
    const x = { ...l } as Row;
    if (e.signal !== undefined) x.signal = e.signal;
    for (const k of ['soldComp', 'bidVelocity', 'saleDateTime', 'bidProj', 'currentBid', 'bidCount', 'overlayAt']) {
      if (e[k] != null) x[k] = e[k];
    }
    return x;
  };
}

function versionOf(lastCrawl: string): string {
  const stamp = (lastCrawl || 'nocrawl').replace(/[^0-9A-Za-z]/g, '').slice(0, 15) || 'nocrawl';
  return `${stamp}-${Date.now().toString(36)}`;
}

/** Build the scope index for a set of SOLD rows (positions in the row store). */
function buildScopeIndex(rows: { row: Row; pos: number }[]): ScopeIndex {
  // base order: saleDate desc, stable on input order (PastResults' date sort)
  const base = rows.map((r, i) => ({ ...r, i, t: dateMs(r.row) }))
    .sort((a, b) => (b.t - a.t) || (a.i - b.i));
  const houses: string[] = [], cats: string[] = [], sports: string[] = [];
  const hIx = new Map<string, number>(), cIx = new Map<string, number>(), sIx = new Map<string, number>();
  const idx = (m: Map<string, number>, arr: string[], v: string) => {
    let i = m.get(v); if (i === undefined) { i = arr.length; arr.push(v); m.set(v, i); } return i;
  };
  const n = base.length;
  const ix: ScopeIndex = {
    head: { n, houses, cats, sports, facetCats: [], facetSports: null },
    pos: new Int32Array(n), price: new Float64Array(n), house: new Uint16Array(n),
    cat: new Uint8Array(n), sport: new Uint16Array(n), byPrice: new Int32Array(n),
  };
  const sportCounts = new Map<string, number>();
  let allSports = n > 0;
  base.forEach((b, i) => {
    const l = b.row;
    ix.pos[i] = b.pos;
    ix.price[i] = l.priceUsd || 0;
    ix.house[i] = idx(hIx, houses, String(l.auctionHouse || ''));
    ix.cat[i] = idx(cIx, cats, String(l.category || ''));
    const sp = String((l as Row).sport || '');
    ix.sport[i] = idx(sIx, sports, sp);
    const label = sp || 'Other';
    sportCounts.set(label, (sportCounts.get(label) || 0) + 1);
    if (marketOf(l.artist) !== 'sports') allSports = false;
  });
  if (cats.length > 255 || houses.length > 65535 || sports.length > 65535) throw new Error('scope index dictionary overflow');
  const perm = Array.from({ length: n }, (_, i) => i).sort((a, b) => (ix.price[b] - ix.price[a]) || (a - b));
  ix.byPrice.set(perm);
  ix.head.facetCats = cats.filter(c => c && c !== 'unknown').sort();
  ix.head.facetSports = allSports && sportCounts.size >= 2
    ? Array.from(sportCounts.entries()).sort((a, b) => (a[0] === 'Other' ? 1 : b[0] === 'Other' ? -1 : b[1] - a[1]))
    : null;
  return ix;
}

/** Columnar summary of a scope's rows (the aggregate surfaces' input).
 *  Rows are ordered maker → saleDate (better compression; every consumer
 *  aggregates, none depends on order). Money columns are whole dollars /
 *  whole native estimate units — sub-dollar precision moves no median or
 *  %-vs-estimate the pages print. `players: false` drops the player column
 *  (only the maker page's player strip reads it). */
function buildSummary(scope: string, input: Row[], opts: { players?: boolean } = {}): SummaryJson {
  const rows = input.map((l, i) => ({ l, i }))
    .sort((x, y) => (x.l.artist < y.l.artist ? -1 : x.l.artist > y.l.artist ? 1 : (x.l.saleDate || '') < (y.l.saleDate || '') ? -1 : (x.l.saleDate || '') > (y.l.saleDate || '') ? 1 : x.i - y.i))
    .map(x => x.l);
  const players = opts.players !== false;
  const dict: SummaryJson['dict'] = { a: [], s: [], c: [], h: [], sp: [], pl: [], pn: [], d: [] };
  const maps: Record<string, Map<string, number>> = {};
  const di = (k: keyof SummaryJson['dict'], v: unknown): number => {
    if (v == null || v === '') return -1;
    const m = maps[k] || (maps[k] = new Map());
    const s = String(v);
    let i = m.get(s);
    if (i === undefined) { i = dict[k].length; dict[k].push(s); m.set(s, i); if (k === 'pl') dict.pn.push(''); }
    return i;
  };
  const cols: SummaryJson['cols'] = { a: [], s: [], c: [], h: [], sp: [], pl: [], d: [], p: [], el: [], eh: [] };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
  for (const l of rows) {
    cols.a.push(di('a', l.artist));
    cols.s.push(di('s', l.status));
    cols.c.push(di('c', l.category));
    cols.h.push(di('h', l.auctionHouse));
    cols.sp.push(di('sp', l.sport));
    const pi = players ? di('pl', l.playerSlug) : -1;
    if (pi >= 0 && !dict.pn[pi] && l.playerName) dict.pn[pi] = String(l.playerName);
    if (players) cols.pl.push(pi);
    cols.d.push(di('d', l.saleDate));
    cols.p.push(num(l.priceUsd));
    cols.el.push(num(l.estimateLow));
    cols.eh.push(num(l.estimateHigh));
  }
  const top = rows.map((l, i) => ({ l, i }))
    .filter(x => x.l.status === 'sold' && (x.l.priceUsd || 0) > 0)
    .sort((a, b) => (b.l.priceUsd! - a.l.priceUsd!) || (a.i - b.i))
    .slice(0, TOP_ROWS)
    .map(x => [x.i, slimForTop(x.l)] as [number, Record<string, unknown>]);
  return { v: 1, scope, n: rows.length, dict, cols, top };
}
const TOP_DROP = new Set(['firstSeen', '_vn', 'entitySrc', 'heightCm', 'widthCm', 'depthCm', 'subjectKeys', 'itemClass', 'drill', 'value', 'signal', 'bidProj']);
function slimForTop(l: Row): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k in l) if (!TOP_DROP.has(k)) o[k] = l[k];
  return o;
}

export function emitR2Index(input: EmitInput, outRoot: string, log: (s: string) => void = () => {}): EmitResult {
  const version = versionOf(input.lastCrawl);
  const prefix = `api/v/${version}/`;
  const dir = path.join(outRoot, prefix);
  fs.mkdirSync(dir, { recursive: true });
  const w = new BlobWriter(dir);

  // ── 1 · the book: main (eager re-attached) ∪ archive-only ∪ extras ───────
  const reattach = reattacher(input.eager);
  const main = input.main.map(reattach);
  const mainIds = new Set(main.map(l => l.id));
  const archiveOnly: Row[] = [];
  {
    const seen = new Set<string>();
    for (const l of input.archive) {
      if (seen.has(l.id) || mainIds.has(l.id)) continue;
      seen.add(l.id);
      archiveOnly.push(l as Row);
    }
  }
  const known = new Set<string>([...Array.from(mainIds), ...archiveOnly.map(l => l.id)]);
  const extras = (input.extras || []).filter(l => !known.has(l.id) && known.add(l.id)) as Row[];

  // row store: (artist, saleDate desc) — a maker's rows sit in adjacent chunks
  const store = [...main, ...archiveOnly, ...extras]
    .map((row, i) => ({ row, i, t: dateMs(row) }))
    .sort((a, b) => (a.row.artist < b.row.artist ? -1 : a.row.artist > b.row.artist ? 1 : (b.t - a.t) || (a.i - b.i)))
    .map(x => x.row);
  const posOf = new Map<string, number>();
  store.forEach((l, i) => posOf.set(l.id, i));
  let chunks = 0;
  for (let i = 0; i < store.length; i += CHUNK_ROWS) w.putJsonGz(`c:${chunks++}`, store.slice(i, i + CHUNK_ROWS));
  log(`row store: ${store.length.toLocaleString()} rows (${main.length} main · ${archiveOnly.length} archive-only · ${extras.length} extra) in ${chunks} chunks`);

  // ── 2 · id → position buckets ────────────────────────────────────────────
  {
    const buckets: Record<string, number>[] = Array.from({ length: ID_BUCKETS }, () => ({}));
    store.forEach((l, i) => { buckets[idBucketOf(l.id)][l.id] = i; });
    buckets.forEach((b, k) => { if (Object.keys(b).length) w.putJsonGz(`b:${k}`, b); });
  }

  // ── 3 · maker books: table index + summary + comp partitions ─────────────
  const eagerIds = new Set(input.eager.map(l => l.id));
  const bookBySlug = new Map<string, Row[]>();
  for (const a of ARTISTS) bookBySlug.set(a.slug, []);
  for (const l of main) bookBySlug.get(l.artist)?.push(l);
  for (const l of archiveOnly) if (ARCHIVE_MARKETS.has(marketOf(l.artist))) bookBySlug.get(l.artist)?.push(l);

  const parts = new Map<string, Row[]>();
  const addPart = (k: string, l: Row) => { const p = parts.get(k); if (p) p.push(l); else parts.set(k, [l]); };
  const makers: Manifest['makers'] = {};
  for (const [slug, book] of Array.from(bookBySlug.entries())) {
    const sold = book.filter(l => l.status === 'sold');
    if (sold.length) w.put(`x:m:${slug}`, encodeScopeIndex(buildScopeIndex(sold.map(row => ({ row, pos: posOf.get(row.id)! })))));
    // the summary carries the maker's rows MINUS the eager ones — the client
    // lays the eager upcoming lots (live bid state, signal) over it by id,
    // exactly as useMakerRows did over the maker shards
    w.putJsonGz(`s:m:${slug}`, buildSummary(`m:${slug}`, book.filter(l => !eagerIds.has(l.id))));
    const forms = new Set<string>();
    for (const l of book) {
      for (const k of bookPartitionsOf(l)) addPart(k, l);
      if (isCandidate(l)) forms.add(formOf(l));
      // one watch reference's sold rows (/api/ref)
      if (l.status === 'sold' && l.reference) addPart(`r|${slug}|${String(l.reference).toLowerCase().replace(/\|/g, '/')}`, l);
    }
    makers[slug] = { market: marketOf(slug), n: book.length, sold: sold.length, forms: Array.from(forms).sort() };
  }
  // the culture band pools the main tier across every culture slug
  for (const l of main) for (const k of culturePartitionsOf(l)) addPart(k, l);
  // provenance: every row of the same physical object, any tier, any status
  for (const l of store) if (l.repeatSaleGroupId) addPart(`g|${String(l.repeatSaleGroupId).replace(/\|/g, '/')}`, l);
  let maxPart = 0, maxKey = '';
  for (const [k, rows] of Array.from(parts.entries())) {
    if (rows.length > maxPart) { maxPart = rows.length; maxKey = k; }
    w.putJsonGz(`p:${k}`, rows);
  }
  log(`comp partitions: ${parts.size.toLocaleString()} (largest ${maxKey} · ${maxPart.toLocaleString()} rows)`);

  // ── 4 · markets: archive table index + analytics summary ────────────────
  const markets: Manifest['markets'] = {};
  for (const m of MARKETS) {
    const set = marketArtists(m.key);
    const withArchive = ARCHIVE_MARKETS.has(m.key);
    const rows = main.filter(l => set.has(l.artist)).concat(withArchive ? archiveOnly.filter(l => set.has(l.artist)) : []);
    const sold = rows.filter(l => l.status === 'sold' && (l.priceUsd || 0) > 0);
    if (sold.length) w.put(`x:k:${m.key}`, encodeScopeIndex(buildScopeIndex(sold.map(row => ({ row, pos: posOf.get(row.id)! })))));
    // the /analytics pools read only concluded rows (sold, bought in) and no
    // player column
    w.putJsonGz(`s:k:${m.key}`, buildSummary(`k:${m.key}`, rows.filter(l => l.status === 'sold' || l.status === 'bought_in'), { players: false }));
    markets[m.key] = { sold: sold.length };
  }

  // ── 5 · settled flags (/receipts): stamped Below Market, now priced ─────
  {
    const rows = main
      .filter(l => (l.priceUsd || 0) > 0 && (l.signal as { label?: string } | null | undefined)?.label === 'Below Market')
      .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''))
      .slice(0, SETTLED_KEEP)
      .map(l => ({ m: marketOf(l.artist), row: slimForTop(l) }));
    w.putJsonGz('z:settled', rows);
  }
  w.close();

  // ── 6 · location tables, manifest, pointer ──────────────────────────────
  const shards: Record<string, Loc>[] = Array.from({ length: LOC_SHARDS }, () => ({}));
  w.locs.forEach((loc, key) => { shards[locShardOf(key)][key] = loc; });
  const objects: string[] = [...w.blobs.map(b => prefix + b)];
  shards.forEach((s, i) => {
    fs.writeFileSync(path.join(dir, locShardName(i)), JSON.stringify(s));
    objects.push(prefix + locShardName(i));
  });
  const manifest: Manifest = {
    format: FORMAT_VERSION, version, lastCrawl: input.lastCrawl, generatedAt: new Date().toISOString(),
    blobs: w.blobs, rows: store.length, chunks, makers, markets,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  objects.push(prefix + 'manifest.json');
  fs.writeFileSync(path.join(outRoot, 'api', 'current.json'), JSON.stringify({ version, prefix }));
  objects.push('api/current.json'); // LAST — the pointer flips only after every payload is up
  fs.writeFileSync(path.join(outRoot, 'api', 'UPLOAD_ORDER.txt'), objects.join('\n') + '\n');
  log(`wrote ${objects.length} objects · ${(w.total / 1048576).toFixed(1)}MB of blobs · version ${version}`);
  return { version, dir, manifest, objects, bytes: w.total };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function readShards(dir: string, base: string): AuctionLot[] {
  let n = 0;
  try { n = Number(JSON.parse(fs.readFileSync(path.join(dir, `${base}-index.json`), 'utf8')).shards) || 0; } catch { n = 0; }
  const out: AuctionLot[] = [];
  for (let i = 0; i < n; i++) {
    const rows = JSON.parse(fs.readFileSync(path.join(dir, `${base}-${i}.json`), 'utf8')) as AuctionLot[];
    for (const r of rows) out.push(r);
  }
  return out;
}

/** engine pool ids the served book never ships, resolved from the full
    corpus NDJSON.gz (emit-page-stats' buffer-safe id sniff). Optional. */
function resolveExtras(corpusDir: string, want: Set<string>): AuctionLot[] {
  const got = new Map<string, AuctionLot>();
  for (const f of ['lots.json.gz', 'sold-archive.json.gz']) {
    const file = path.join(corpusDir, f);
    if (!want.size || !fs.existsSync(file)) continue;
    const buf = zlib.gunzipSync(fs.readFileSync(file));
    let start = 0;
    while (start < buf.length) {
      let end = buf.indexOf(10, start);
      if (end < 0) end = buf.length;
      const head = buf.toString('utf8', start, Math.min(end, start + 400));
      const m = head.match(/"id":"((?:[^"\\]|\\.)*)"/);
      if (m && want.has(m[1]) && !got.has(m[1])) {
        try {
          const l = JSON.parse(buf.toString('utf8', start, end)) as AuctionLot;
          if (l.status === 'sold' && (l.priceUsd || 0) > 0) got.set(l.id, l);
        } catch { /* a torn row is skipped, never guessed */ }
      }
      start = end + 1;
    }
  }
  return Array.from(got.values());
}

function main() {
  const t0 = Date.now();
  const log = (s: string) => console.log(`[r2-index] ${s} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const served = arg('served', 'public/data/ray');
  const corpus = arg('corpus', 'data/corpus');
  const out = arg('out', 'data/r2-api');
  const meta = JSON.parse(fs.readFileSync(path.join(served, 'meta.json'), 'utf8')) as { lastCrawl?: string };
  const up = JSON.parse(fs.readFileSync(path.join(served, 'upcoming.json'), 'utf8')) as { lots?: AuctionLot[] };
  const mainRows = readShards(served, 'lots');
  if (!mainRows.length) throw new Error(`[r2-index] no lots-*.json shards in ${served} — run assemble first`);
  const archive = readShards(served, 'sold-archive');
  log(`read ${mainRows.length.toLocaleString()} main + ${archive.length.toLocaleString()} archive rows`);
  const onWire = new Set<string>([...mainRows.map(l => l.id), ...archive.map(l => l.id)]);
  const want = new Set<string>();
  for (const l of [...mainRows, ...(up.lots || [])]) for (const id of l.value?.poolIds || []) if (!onWire.has(String(id))) want.add(String(id));
  const extras = resolveExtras(corpus, want);
  log(`engine pool ids off the wire: ${want.size.toLocaleString()} · resolved ${extras.length.toLocaleString()} from ${corpus}`);
  // a fresh output dir per run — stale versions never ride along
  fs.rmSync(path.join(out, 'api'), { recursive: true, force: true });
  emitR2Index({ main: mainRows, archive, eager: up.lots || [], extras, lastCrawl: meta.lastCrawl || '' }, out, log);
}

if (!process.env.RAY_SKIP_MAIN && process.argv[1] && /emit-r2-index\.ts$/.test(process.argv[1])) main();
