/**
 * emit-r2-index.ts — writes every object the read-only lot API
 * (functions/api, Cloudflare Pages Functions) reads from R2, into a LOCAL
 * directory. Uploading it is a separate step (scripts/r2-api-push.sh;
 * docs/data-pipeline.md "The lot API").
 *
 * WHY: every surface that needed lot-level history used to stream the whole
 * served corpus to the browser (lots-*.json + sold-archive-*.json, ~500MB
 * raw). Pages caps a deploy at 20,000 files of ≤25MiB, so per-lot static
 * files are impossible — and the Workers FREE plan caps each request at 10ms
 * of CPU. So ALL the work happens here, once a night: comps answers, sorted
 * and filtered table pages, column summaries, ref ledgers. The API only maps
 * a key to a byte range and hands the stored gzip bytes back
 * (functions/_lib/format.ts has the layout both sides share).
 *
 *   NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/emit-r2-index.ts \
 *     [--served public/data/ray] [--corpus data/corpus] [--out data/r2-api]
 *
 * Reads the SERVED book (meta, upcoming, lots-*.json, sold-archive-*.json) —
 * the rows the browser used to stream, the eager upcoming lots' stamped
 * fields re-attached exactly as useRayData's phase 2 / emit-page-stats did —
 * plus, optionally, the full corpus (data/corpus/{lots,sold-archive}.json.gz)
 * to resolve engine pool ids that never ship on the wire. Pure read of those
 * inputs; writes only under --out:
 *
 *   <out>/api/current.json          the pointer (upload LAST)
 *   <out>/api/v/<version>/…         manifest.json, dir.bin, blob-N.bin
 *   <out>/api/UPLOAD_ORDER.txt      payloads first, pointer last
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AuctionLot } from '../app/types';
import { ARTISTS, MARKETS, marketArtists, marketOf } from '../app/constants';
import {
  BLOB_CAP, FORMAT_VERSION, blobKey, ID_BUCKETS, LOC_SHARDS, REF_PAGE, ROW_DROP, TABLE_MAX_PAGES, TABLE_PAGE,
  displayRow, idBucketOf, locShardOf, refKey, tableKey,
  type Current, type IdEntry, type Loc, type Manifest, type PagedLoc, type SummaryJson, type TablePageBody,
} from '../functions/_lib/format';
import { bookPartitionsOf, culturePartitionsOf } from './r2/pools';
import { compsFor, isEmptyAnswer, type CompSource } from './r2/comps';

type Row = AuctionLot & Record<string, unknown>;

export interface EmitInput {
  main: AuctionLot[];
  archive: AuctionLot[];
  eager: AuctionLot[];
  /** corpus-only rows an engine pool names (resolvable by id, in no table) */
  extras?: AuctionLot[];
  lastCrawl: string;
  /** comps precompute window in days (default 730 — the saveable window) */
  compsDays?: number;
  /** "today" for the window (tests pin it) */
  now?: Date;
}
export interface EmitResult { version: string; dir: string; manifest: Manifest; objects: string[]; bytes: number; stats: Record<string, number> }

const ARCHIVE_MARKETS = new Set(['sports', 'science']);
const TOP_ROWS = 60;
const SETTLED_KEEP = 50;

// ── blob writer ─────────────────────────────────────────────────────────────
class BlobWriter {
  blobs: string[] = [];
  private fd = -1;
  private size = 0;
  total = 0;
  constructor(private dir: string) {}
  put(buf: Uint8Array): Loc {
    if (this.fd < 0 || (this.size > 0 && this.size + buf.length > BLOB_CAP)) this.rotate();
    fs.writeSync(this.fd, buf);
    const loc: Loc = [this.blobs.length - 1, this.size, buf.length];
    this.size += buf.length;
    this.total += buf.length;
    return loc;
  }
  gz(v: unknown): Loc {
    return this.put(zlib.gzipSync(Buffer.from(JSON.stringify(v)), { level: 6 }));
  }
  /** consecutive gzip members in ONE blob → [blob, start, total, …lens] */
  paged(total: number, pages: unknown[]): PagedLoc {
    const bufs = pages.map(p => zlib.gzipSync(Buffer.from(JSON.stringify(p)), { level: 6 }));
    const sum = bufs.reduce((s, b) => s + b.length, 0);
    if (this.fd < 0 || (this.size > 0 && this.size + sum > BLOB_CAP)) this.rotate();
    const start = this.size;
    for (const b of bufs) { fs.writeSync(this.fd, b); this.size += b.length; this.total += b.length; }
    return [this.blobs.length - 1, start, total, ...bufs.map(b => b.length)];
  }
  private rotate() {
    if (this.fd >= 0) fs.closeSync(this.fd);
    const name = blobKey(this.blobs.length);
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

function storedRow(l: Row): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k in l) if (!ROW_DROP.has(k)) o[k] = l[k];
  return o;
}

// ── tables: PastResults' filter + order, materialized ─────────────────────
type Facets = TablePageBody['facets'];
function facetsOf(rows: Row[]): Facets {
  const cats = new Set<string>();
  for (const l of rows) if (l.category && l.category !== 'unknown') cats.add(String(l.category));
  let sports: [string, number][] | null = null;
  if (rows.length && rows.every(l => marketOf(l.artist) === 'sports')) {
    const counts = new Map<string, number>();
    for (const l of rows) { const s = String(l.sport || 'Other'); counts.set(s, (counts.get(s) || 0) + 1); }
    if (counts.size >= 2) sports = Array.from(counts.entries()).sort((a, b) => (a[0] === 'Other' ? 1 : b[0] === 'Other' ? -1 : b[1] - a[1]));
  }
  return { cats: Array.from(cats).sort(), sports };
}
/** PastResults' order: price = highest first (stable); date = newest first,
 *  then woven round-robin across houses in order of first appearance. */
export function orderRows(rows: Row[], sort: 'date' | 'price'): Row[] {
  if (sort === 'price') return rows.map((l, i) => ({ l, i })).sort((a, b) => ((b.l.priceUsd || 0) - (a.l.priceUsd || 0)) || (a.i - b.i)).map(x => x.l);
  const byDate = rows.map((l, i) => ({ l, i, t: dateMs(l) })).sort((a, b) => (b.t - a.t) || (a.i - b.i)).map(x => x.l);
  const groups = new Map<string, Row[]>();
  for (const l of byDate) { const g = groups.get(l.auctionHouse) || []; g.push(l); groups.set(l.auctionHouse, g); }
  if (groups.size < 2) return byDate;
  const qs = Array.from(groups.values());
  const out: Row[] = [];
  for (let i = 0; out.length < byDate.length; i++) for (const q of qs) if (i < q.length) out.push(q[i]);
  return out;
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
    .map(x => [x.i, displayRow(x.l)] as [number, Record<string, unknown>]);
  return { v: 1, scope, n: rows.length, dict, cols, top };
}

export function emitR2Index(input: EmitInput, outRoot: string, log: (s: string) => void = () => {}): EmitResult {
  const version = versionOf(input.lastCrawl);
  const prefix = `api/v/${version}/`;
  const dir = path.join(outRoot, prefix);
  fs.mkdirSync(dir, { recursive: true });
  const w = new BlobWriter(dir);
  const locs = new Map<string, unknown>();
  const stats: Record<string, number> = {};
  const t0 = Date.now();
  const lap = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
  /** a summary goes up twice: PLAIN under p:<scope> (the API streams it
   *  straight from R2 — summaries run to ~10MB raw, too much to gunzip inside
   *  a 10ms-CPU Function) and gzip under s:<scope> (readers before Oct 6) */
  const summary = (scope: string, sum: SummaryJson) => {
    const txt = JSON.stringify(sum);
    locs.set(`p:${scope}`, w.put(Buffer.from(txt)));
    locs.set(`s:${scope}`, w.gz(sum));
  };

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

  // row store: one PLAIN JSON object per lot, (artist, saleDate desc) —
  // /api/lot hands the bytes back without a parse or a gunzip
  const store = [...main, ...archiveOnly, ...extras]
    .map((row, i) => ({ row, i, t: dateMs(row) }))
    .sort((a, b) => (a.row.artist < b.row.artist ? -1 : a.row.artist > b.row.artist ? 1 : (b.t - a.t) || (a.i - b.i)))
    .map(x => x.row);
  const entries = new Map<string, IdEntry>();
  for (const l of store) entries.set(l.id, [...w.put(Buffer.from(JSON.stringify(storedRow(l))))]);
  stats.rows = store.length;
  log(`row store: ${store.length.toLocaleString()} rows (${main.length} main · ${archiveOnly.length} archive-only · ${extras.length} extra) · ${lap()}`);

  // ── 2 · comps, precomputed over in-memory candidate partitions ───────────
  const parts = new Map<string, AuctionLot[]>();
  const addPart = (k: string, l: AuctionLot) => { const p = parts.get(k); if (p) p.push(l); else parts.set(k, [l]); };
  for (const l of main) for (const k of bookPartitionsOf(l)) addPart(k, l);
  for (const l of archiveOnly) if (ARCHIVE_MARKETS.has(marketOf(l.artist))) for (const k of bookPartitionsOf(l)) addPart(k, l);
  for (const l of main) for (const k of culturePartitionsOf(l)) addPart(k, l);
  for (const l of store) if (l.repeatSaleGroupId) addPart(`g|${String(l.repeatSaleGroupId).replace(/\|/g, '/')}`, l);
  const byId = new Map<string, AuctionLot>(store.map(l => [l.id, l]));
  const src: CompSource = { partition: k => parts.get(k) || [], byId: id => byId.get(id) };

  const days = input.compsDays ?? 730;
  const cutoff = new Date((input.now ?? new Date()).getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const eagerIds = new Set(input.eager.map(l => l.id));
  const settledIds = new Set<string>();
  const settledRows = main
    .filter(l => (l.priceUsd || 0) > 0 && (l.signal as { label?: string } | null | undefined)?.label === 'Below Market')
    .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));
  for (const l of settledRows.slice(0, 300)) settledIds.add(l.id);
  const inWindow = (l: Row) => eagerIds.has(l.id) || settledIds.has(l.id)
    || ((l.status === 'sold' || l.status === 'bought_in') && (l.saleDate || '') >= cutoff);
  let nComps = 0, nEmpty = 0, slow = 0, slowId = '';
  for (const l of store) {
    if (!inWindow(l)) continue;
    const ts = performance.now();
    const ans = compsFor(src, l);
    const dt = performance.now() - ts;
    if (dt > slow) { slow = dt; slowId = l.id; }
    const e = entries.get(l.id)!;
    if (isEmptyAnswer(ans)) { e.push(-1); nEmpty++; continue; }
    const loc = w.gz(ans);
    e.push(loc[0], loc[1], loc[2]);
    nComps++;
  }
  stats.comps = nComps; stats.compsEmpty = nEmpty;
  log(`comps: ${nComps.toLocaleString()} answers + ${nEmpty.toLocaleString()} empty (window ${cutoff}→, slowest ${slow.toFixed(0)}ms ${slowId}) · ${lap()}`);

  // ── 3 · tables (maker books + market archives), refs, summaries ─────────
  const bookBySlug = new Map<string, Row[]>();
  for (const a of ARTISTS) bookBySlug.set(a.slug, []);
  for (const l of main) bookBySlug.get(l.artist)?.push(l);
  for (const l of archiveOnly) if (ARCHIVE_MARKETS.has(marketOf(l.artist))) bookBySlug.get(l.artist)?.push(l);

  let nPages = 0, nCombos = 0;
  const emitTable = (scope: string, sold: Row[]) => {
    if (!sold.length) return;
    const facets = facetsOf(sold);
    locs.set(`f:${scope}`, facets);
    const cats: (string | null)[] = [null, ...facets.cats];
    const sports: (string | null)[] = [null, ...(facets.sports ? facets.sports.map(s => s[0]) : [])];
    for (const sort of ['date', 'price'] as const) {
      const ordered = orderRows(sold, sort);
      for (const cat of cats) for (const sport of sports) {
        const rows = ordered.filter(l => (cat == null || l.category === cat) && (sport == null || String(l.sport || 'Other') === sport));
        if (!rows.length) continue;
        const pages: TablePageBody[] = [];
        for (let p = 0; p < TABLE_MAX_PAGES && p * TABLE_PAGE < rows.length; p++) {
          pages.push({
            total: rows.length, page: p, size: TABLE_PAGE,
            rows: rows.slice(p * TABLE_PAGE, (p + 1) * TABLE_PAGE).map(displayRow), facets,
            capped: rows.length > TABLE_MAX_PAGES * TABLE_PAGE,
          });
        }
        locs.set(tableKey(scope, sort, cat, sport), w.paged(rows.length, pages));
        nPages += pages.length; nCombos++;
      }
    }
  };

  let nRefs = 0;
  for (const [slug, book] of Array.from(bookBySlug.entries())) {
    emitTable(`m:${slug}`, book.filter(l => l.status === 'sold'));
    // the summary carries the maker's rows MINUS the eager ones — the client
    // lays the eager upcoming lots (live bid state, signal) over it by id
    summary(`m:${slug}`, buildSummary(`m:${slug}`, book.filter(l => !eagerIds.has(l.id))));
    // one watch reference's sold rows, newest first (/api/ref)
    const byRef = new Map<string, Row[]>();
    for (const l of book) {
      if (l.status !== 'sold' || !l.reference || String(l.reference).includes('|')) continue;
      const k = String(l.reference).toLowerCase();
      (byRef.get(k) || byRef.set(k, []).get(k)!).push(l);
    }
    byRef.forEach((rows, ref) => {
      const ordered = rows.map((l, i) => ({ l, i, t: dateMs(l) })).sort((a, b) => (b.t - a.t) || (a.i - b.i)).map(x => x.l);
      const pages = [];
      for (let p = 0; p < TABLE_MAX_PAGES && p * REF_PAGE < ordered.length; p++) {
        pages.push({ total: ordered.length, page: p, size: REF_PAGE, rows: ordered.slice(p * REF_PAGE, (p + 1) * REF_PAGE).map(displayRow), capped: ordered.length > TABLE_MAX_PAGES * REF_PAGE });
      }
      locs.set(refKey(slug, ref), w.paged(ordered.length, pages));
      nRefs++;
    });
  }
  for (const m of MARKETS) {
    const set = marketArtists(m.key);
    const rows = main.filter(l => set.has(l.artist)).concat(ARCHIVE_MARKETS.has(m.key) ? archiveOnly.filter(l => set.has(l.artist)) : []);
    emitTable(`k:${m.key}`, rows.filter(l => l.status === 'sold' && (l.priceUsd || 0) > 0));
    // the /analytics pools read only concluded rows (sold, bought in), no players
    summary(`k:${m.key}`, buildSummary(`k:${m.key}`, rows.filter(l => l.status === 'sold' || l.status === 'bought_in'), { players: false }));
    // settled flags (/receipts): the row + the flag it carried while live
    const flagged = settledRows.filter(l => m.key === 'all' || set.has(l.artist)).slice(0, SETTLED_KEEP)
      .map(l => ({ ...displayRow(l), signal: l.signal }));
    locs.set(`z:${m.key}`, w.gz({ rows: flagged }));
  }
  stats.tableCombos = nCombos; stats.tablePages = nPages; stats.refs = nRefs;
  log(`tables: ${nCombos.toLocaleString()} filter×sort combos · ${nPages.toLocaleString()} pages · ${nRefs.toLocaleString()} ref ledgers · ${lap()}`);

  // ── 4 · id buckets + location shards → dir.bin ──────────────────────────
  const dirArr = new Uint32Array((ID_BUCKETS + LOC_SHARDS) * 3);
  {
    const buckets: Record<string, IdEntry>[] = Array.from({ length: ID_BUCKETS }, () => ({}));
    entries.forEach((e, id) => { buckets[idBucketOf(id)][id] = e; });
    let maxB = 0;
    buckets.forEach((b, i) => {
      if (!Object.keys(b).length) return;
      // id buckets + loc shards stay PLAIN JSON (a few KB): the hot path of
      // every request parses one with no gunzip at all
      const txt = JSON.stringify(b);
      const loc = w.put(Buffer.from(txt));
      maxB = Math.max(maxB, txt.length);
      dirArr.set(loc, i * 3);
    });
    const shards: Record<string, unknown>[] = Array.from({ length: LOC_SHARDS }, () => ({}));
    locs.forEach((v, k) => { shards[locShardOf(k)][k] = v; });
    let maxS = 0;
    shards.forEach((s, i) => {
      if (!Object.keys(s).length) return;
      const txt = JSON.stringify(s);
      maxS = Math.max(maxS, txt.length);
      dirArr.set(w.put(Buffer.from(txt)), (ID_BUCKETS + i) * 3);
    });
    stats.maxIdBucketBytes = maxB; stats.maxLocShardBytes = maxS; stats.locKeys = locs.size;
  }
  w.close();
  fs.writeFileSync(path.join(dir, 'dir.bin'), Buffer.from(dirArr.buffer));

  const manifest: Manifest = {
    format: FORMAT_VERSION, version, lastCrawl: input.lastCrawl, generatedAt: new Date().toISOString(),
    blobs: w.blobs, rows: store.length, comps: nComps, compsWindow: cutoff,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  // the pointer carries the loc-shard directory inline: a cold isolate goes
  // pointer → loc shard → answer, with no dir.bin / manifest hop in between
  const current: Current = { version, prefix, locDir: Array.from(dirArr.subarray(ID_BUCKETS * 3)) };
  fs.writeFileSync(path.join(outRoot, 'api', 'current.json'), JSON.stringify(current));
  const objects = [...w.blobs.map(b => prefix + b), prefix + 'dir.bin', prefix + 'manifest.json', 'api/current.json'];
  fs.writeFileSync(path.join(outRoot, 'api', 'UPLOAD_ORDER.txt'), objects.join('\n') + '\n');
  stats.objects = objects.length; stats.blobBytes = w.total;
  log(`wrote ${objects.length} objects · ${(w.total / 1048576).toFixed(1)}MB · largest id bucket ${stats.maxIdBucketBytes}B · largest loc shard ${stats.maxLocShardBytes}B (${stats.locKeys} keys) · version ${version} · ${lap()}`);
  return { version, dir, manifest, objects, bytes: w.total, stats };
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
