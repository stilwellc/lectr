/**
 * close-k-fit.ts — THE NIGHTLY REFIT of the bid rooms' close multiples
 * (app/lib/close-k.ts). Runs on the GitHub Actions runner inside
 * build-upcoming (never in serverless): the corpus is already in memory.
 *
 * OBSERVATIONS — one (lot, days out, live bid, hammer) per bid sighting:
 *  1. bidHistory on SOLD corpus lots. Only Goldin keeps it through settlement
 *     (ray-crawl carries it; the sports-crawl houses replace the row with the
 *     settled record, so their history dies at the close). Snapshots append
 *     only when {bid, count} changes; date-only stamps read as 12:00Z (the
 *     hour the served book lands).
 *  2. THE CLOSE-K SNAPSHOT ARCHIVE — every night build-upcoming writes a tiny
 *     snapshot of the served bid-room book (id, bid, bid count, close ms,
 *     room; ~100KB gz) to data/closek/tonight.json.gz, and the nightly ships
 *     it write-once to R2 closek/snaps/. Before assemble the newest
 *     SNAP_PULL_N are pulled back to data/closek/snaps/ and joined here to
 *     the sold rows by id. This is the ONLY history for Hake's, Memory Lane,
 *     NFL, REA and RR.
 *
 * FIT — per room × days bucket × bid band:
 *  - each lot counts ONCE per cell (the mean of its log hammer/bid there), so
 *    a Goldin lot with 9 snapshots in the 14d+ bucket is one vote, not nine;
 *    n = distinct lots.
 *  - parent = the compiled Oct 9 cell × the room's drift (the shrunk median
 *    of every lot-cell residual vs the compiled table, clamped to ×/÷ 2) —
 *    a thin cell follows its room's measured level but keeps the measured
 *    bid-size × horizon shape.
 *  - n ≥ minN: log k = (n·median + n0·log parent) / (n + n0) — shrinkage
 *    toward the parent, which fades as n grows. n < minN: the parent.
 *  - then never below 1, never shrinking with time to close (running max
 *    over days, per bid band), rounded to 0.01.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { CLOSE_K_DEFAULT, CLOSE_K_ROOMS, CLOSE_K_MIN_N, CLOSE_K_DAY_EDGES, CLOSE_K_BID_EDGES, dayBucketOf, bidBandOf, closeKRoomOf, type CloseKTable, type CloseKRoomFit, type CloseKGrid } from '../../app/lib/close-k';
import { taxonOf } from '../../app/lib/taxonomy';
import { closeMs } from '../../app/lib/house-tz';
import { inferHammerUsd } from '../../app/lib/premiums';

export const CLOSE_K_DIR = path.join(process.cwd(), 'data', 'closek');
/** how many nightly snapshots the fit reads (≈ 2 months: a lot listed 45d
 *  out plus its settlement lag) */
export const SNAP_PULL_N = 75;
/** sightings further out than this are not projected */
const MAX_DAYS = 45;
/** pseudo-count of the parent in a fitted cell */
export const CLOSE_K_N0 = 25;
/** pseudo-count of the compiled table in a room's drift */
const DRIFT_N0 = 50;
const DRIFT_CLAMP = Math.log(2);

export type CloseKObs = { id: string; room: string; days: number; bid: number; h: number };
/** one archived night: t = the book's generatedAt; rows [id, bid, bidCount, closeMs, room] */
export type CloseKSnap = { v: 1; t: string; rows: [string, number, number, number, string][] };

type AnyLot = Record<string, unknown> & { id?: string; status?: string; auctionHouse?: string | null; saleName?: string | null; currency?: string | null; currentBid?: number | null; bidCount?: number | null; saleDate?: string | null; saleDateTime?: string | null; priceBasis?: string | null };

const isUsd = (l: AnyLot) => !l.currency || l.currency === 'USD';
const roomOfLot = (l: AnyLot) => closeKRoomOf(l.auctionHouse, l.saleName, taxonOf(l as Parameters<typeof taxonOf>[0]).cat);
const closeOf = (l: AnyLot): number | null => closeMs(l as Parameters<typeof closeMs>[0]);

/** the hammer a sold row closed at (USD), 0 when it isn't a usable outcome */
export function soldHammerOf(l: AnyLot): number {
  if (l.status !== 'sold' || l.priceBasis === 'last-tracked-bid' || !isUsd(l)) return 0;
  const hp = (l as { hammerPrice?: number | null }).hammerPrice;
  const hu = (l as { hammerUsd?: number | null }).hammerUsd;
  if (typeof hu === 'number' && hu > 0) return hu;
  if (typeof hp === 'number' && hp > 0) return hp;
  return inferHammerUsd(l as Parameters<typeof inferHammerUsd>[0]) || 0;
}

/** tonight's snapshot of the served book's bid-room lots */
export function snapFromBook(generatedAt: string, lots: AnyLot[]): CloseKSnap {
  const rows: CloseKSnap['rows'] = [];
  for (const l of lots) {
    if (!l.id || !isUsd(l) || !((l.currentBid || 0) > 0)) continue;
    const room = roomOfLot(l);
    const c = closeOf(l);
    if (!room || c == null) continue;
    rows.push([String(l.id), l.currentBid as number, l.bidCount || 0, c, room]);
  }
  return { v: 1, t: generatedAt, rows };
}

/** bid sightings from the sold rows' own bidHistory */
export function obsFromBidHistory(lots: AnyLot[]): CloseKObs[] {
  const out: CloseKObs[] = [];
  for (const l of lots) {
    const bh = (l as { bidHistory?: Array<{ d: string; b: number }> }).bidHistory;
    if (!Array.isArray(bh) || !bh.length || l.status !== 'sold') continue;
    const h = soldHammerOf(l);
    if (!(h > 0)) continue;
    const room = roomOfLot(l);
    const c = closeOf(l);
    if (!room || c == null) continue;
    for (const s of bh) {
      if (!(s?.b > 0) || typeof s.d !== 'string') continue;
      const t = Date.parse(s.d.length === 10 ? `${s.d}T12:00:00Z` : s.d);
      const days = (c - t) / 864e5;
      if (!(days > 0) || days > MAX_DAYS) continue;
      out.push({ id: String(l.id), room, days, bid: s.b, h });
    }
  }
  return out;
}

/** archived sightings joined to their outcomes. A lot whose sold row closed
 *  more than 2 days off the snapshot's close (rescheduled, extended) is
 *  skipped — its days-out was wrong when it was served. */
export function obsFromSnaps(snaps: CloseKSnap[], sold: Map<string, { h: number; close: number | null }>): CloseKObs[] {
  const out: CloseKObs[] = [];
  for (const s of snaps) {
    const t = Date.parse(s.t);
    if (isNaN(t)) continue;
    for (const [id, bid, , close, room] of s.rows) {
      const o = sold.get(id);
      if (!o || !(o.h > 0) || !(bid > 0)) continue;
      if (o.close != null && Math.abs(o.close - close) > 2 * 864e5) continue;
      const days = (close - t) / 864e5;
      if (!(days > 0) || days > MAX_DAYS) continue;
      out.push({ id, room, days, bid, h: o.h });
    }
  }
  return out;
}

/** the outcome index the snapshot join needs: only ids the archive holds */
export function soldIndex(lots: AnyLot[], ids: Set<string>): Map<string, { h: number; close: number | null }> {
  const m = new Map<string, { h: number; close: number | null }>();
  for (const l of lots) {
    if (!l.id || !ids.has(String(l.id))) continue;
    const h = soldHammerOf(l);
    if (h > 0) m.set(String(l.id), { h, close: closeOf(l) });
  }
  return m;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const grid = <T>(f: (d: number, b: number) => T): T[][] => [0, 1, 2, 3, 4].map(d => [0, 1, 2, 3, 4].map(b => f(d, b)));

export function fitCloseK(obs: CloseKObs[], opts: { minN?: number; n0?: number; prior?: Record<string, CloseKGrid>; generatedAt?: string; lastCrawl?: string; basis?: Record<string, number> } = {}): CloseKTable {
  const minN = opts.minN ?? CLOSE_K_MIN_N;
  const n0 = opts.n0 ?? CLOSE_K_N0;
  const prior: Record<string, CloseKGrid> = opts.prior ?? CLOSE_K_DEFAULT;
  // lot × cell → its log ratios
  const per = new Map<string, number[]>();
  for (const o of obs) {
    if (!prior[o.room] || !(o.bid > 0) || !(o.h > 0)) continue;
    const key = `${o.room}|${dayBucketOf(o.days)}|${bidBandOf(o.bid)}|${o.id}`;
    const a = per.get(key) ?? []; a.push(Math.log(o.h / o.bid)); per.set(key, a);
  }
  // cell → one value per lot
  const cells = new Map<string, number[]>();
  for (const [key, a] of Array.from(per.entries())) {
    const cell = key.slice(0, key.lastIndexOf('|'));
    const v = a.reduce((x, y) => x + y, 0) / a.length;
    const c = cells.get(cell) ?? []; c.push(v); cells.set(cell, c);
  }
  const rooms: Record<string, CloseKRoomFit> = {};
  for (const r of CLOSE_K_ROOMS) {
    const P = prior[r];
    // the room's drift vs the compiled table, over every lot-cell it holds
    const resid: number[] = [];
    for (let d = 0; d < 5; d++) for (let b = 0; b < 5; b++) for (const v of cells.get(`${r}|${d}|${b}`) ?? []) resid.push(v - Math.log(Math.max(1, P[d][b])));
    const nRoom = resid.length;
    let drift = 0;
    if (nRoom >= minN) drift = Math.max(-DRIFT_CLAMP, Math.min(DRIFT_CLAMP, median(resid) * nRoom / (nRoom + DRIFT_N0)));
    const n = grid((d, b) => cells.get(`${r}|${d}|${b}`)?.length ?? 0);
    const src = grid((d, b) => (n[d][b] >= minN ? 'fit' : 'parent') as 'fit' | 'parent');
    const raw = grid((d, b) => {
      const parent = Math.log(Math.max(1, P[d][b])) + drift;
      const x = cells.get(`${r}|${d}|${b}`);
      if (!x || x.length < minN) return parent;
      return (x.length * median(x) + n0 * parent) / (x.length + n0);
    });
    const k = grid(() => 1);
    for (let b = 0; b < 5; b++) {
      let m = 1;
      for (let d = 0; d < 5; d++) { m = Math.max(m, Math.exp(raw[d][b])); k[d][b] = Math.round(m * 100) / 100; }
    }
    rooms[r] = { k, n, src, drift: Math.round(drift * 1000) / 1000, nRoom };
  }
  return {
    v: 1,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    ...(opts.lastCrawl ? { lastCrawl: opts.lastCrawl } : {}),
    minN, n0,
    dayEdges: CLOSE_K_DAY_EDGES, bidEdges: CLOSE_K_BID_EDGES,
    rooms,
    ...(opts.basis ? { basis: opts.basis } : {}),
  };
}

const DAY_LABEL = ['<1d', '1-3d', '3-7d', '7-14d', '14d+'];
const BID_LABEL = ['<$100', '$100-1K', '$1-10K', '$10-100K', '$100K+'];

/** the night-over-night diff: every cell that moved ≥ `pct` (default 5%) */
export function diffCloseK(prev: CloseKTable | Record<string, CloseKGrid> | null, next: CloseKTable, pct = 0.05): { moved: number; lines: string[]; maxMove: number } {
  const prevGrid = (r: string): CloseKGrid | null => {
    if (!prev) return null;
    const p = prev as CloseKTable;
    if (p.rooms) return p.rooms[r]?.k ?? null;
    return (prev as Record<string, CloseKGrid>)[r] ?? null;
  };
  const lines: string[] = [];
  let moved = 0, maxMove = 0;
  for (const r of CLOSE_K_ROOMS) {
    const a = prevGrid(r), f = next.rooms[r];
    if (!a || !f) continue;
    for (let d = 0; d < 5; d++) for (let b = 0; b < 5; b++) {
      const x = a[d]?.[b], y = f.k[d][b];
      if (!(x > 0)) continue;
      const m = Math.abs(Math.log(y / x));
      maxMove = Math.max(maxMove, m);
      if (m >= Math.log(1 + pct)) {
        moved++;
        lines.push(`${r} ${DAY_LABEL[d]} ${BID_LABEL[b]}: ${x} → ${y} (n ${f.n[d][b]}, ${f.src[d][b]})`);
      }
    }
  }
  return { moved, lines, maxMove };
}

export function readSnapDir(dir: string, limit = SNAP_PULL_N): CloseKSnap[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json.gz') || f.endsWith('.json')).sort().slice(-limit);
  const out: CloseKSnap[] = [];
  for (const f of files) {
    try {
      const buf = fs.readFileSync(path.join(dir, f));
      const j = JSON.parse((f.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8')) as CloseKSnap;
      if (j?.v === 1 && typeof j.t === 'string' && Array.isArray(j.rows)) out.push(j);
    } catch { console.warn(`[close-k] snapshot ${f} unreadable — skipped`); }
  }
  return out;
}

export function writeSnap(file: string, snap: CloseKSnap): number {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const gz = zlib.gzipSync(JSON.stringify(snap));
  fs.writeFileSync(file, gz);
  return gz.length;
}

/**
 * The nightly step, called by build-upcoming over the in-memory corpus:
 * pull-side inputs are data/closek/snaps/ (the archive) and
 * data/closek/prev.json (last night's table, for the diff; else the served
 * close-k.json already in dataDir). Writes dataDir/close-k.json. Never throws.
 */
export function refitCloseK(lots: AnyLot[], dataDir: string, opts: { dir?: string } = {}): CloseKTable | null {
  const dir = opts.dir ?? CLOSE_K_DIR;
  try {
    const snaps = readSnapDir(path.join(dir, 'snaps'));
    const ids = new Set<string>();
    for (const s of snaps) for (const r of s.rows) ids.add(r[0]);
    const hist = obsFromBidHistory(lots);
    const fromSnaps = obsFromSnaps(snaps, soldIndex(lots, ids));
    let lastCrawl: string | undefined;
    try { lastCrawl = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'))?.lastCrawl || undefined; } catch { /* first build */ }
    const table = fitCloseK([...hist, ...fromSnaps], { lastCrawl, basis: { historySightings: hist.length, snapshotSightings: fromSnaps.length, snapshotNights: snaps.length } });
    let prev: CloseKTable | null = null;
    for (const f of [path.join(dir, 'prev.json'), path.join(dataDir, 'close-k.json')]) {
      try { prev = JSON.parse(fs.readFileSync(f, 'utf8')); if (prev?.rooms) break; prev = null; } catch { /* none */ }
    }
    const fitted = CLOSE_K_ROOMS.reduce((a, r) => a + table.rooms[r].src.flat().filter(s => s === 'fit').length, 0);
    console.log(`[close-k] refit: ${hist.length} history + ${fromSnaps.length} snapshot sightings (${snaps.length} nights) → ${fitted}/225 cells measured (n ≥ ${table.minN}), the rest on their parent`);
    for (const r of CLOSE_K_ROOMS) {
      const f = table.rooms[r];
      console.log(`[close-k]   ${r.padEnd(18)} lots-in-cells ${String(f.nRoom).padStart(6)} · drift ${f.drift >= 0 ? '+' : ''}${f.drift} · measured ${f.src.flat().filter(s => s === 'fit').length}/25`);
    }
    const d = diffCloseK(prev ?? CLOSE_K_DEFAULT, table);
    console.log(`[close-k] vs ${prev ? 'last night' : 'the compiled table'}: ${d.moved} cell(s) moved ≥5% (max ${(Math.exp(d.maxMove) * 100 - 100).toFixed(0)}%)`);
    for (const l of d.lines.slice(0, 60)) console.log(`[close-k]   ${l}`);
    if (d.lines.length > 60) console.log(`[close-k]   … ${d.lines.length - 60} more`);
    if (prev && d.maxMove > Math.log(1.5)) console.log(`::warning title=close-k moved::a cell moved ${(Math.exp(d.maxMove) * 100 - 100).toFixed(0)}% night over night — check the diff above`);
    fs.writeFileSync(path.join(dataDir, 'close-k.json'), JSON.stringify(table));
    return table;
  } catch (e) {
    console.log(`::warning title=close-k refit failed::${(e as Error).message} — the client keeps the compiled table`);
    return null;
  }
}
