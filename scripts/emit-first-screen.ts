/**
 * emit-first-screen.ts — the first-screen payloads (perf wave W13, Oct 11 2026).
 *
 *   npx tsx scripts/emit-first-screen.ts [--served <dir>] [--check]
 *
 * Runs in `npm run build`, BEFORE next build, over the exact served files the
 * deploy ships (nightly and every close-board refresh rebuild the site, so a
 * payload is always built from the book it sits beside). Writes
 * <served>/first/<key>.json + first/index.json, and the content hash the
 * HTML bakes (next.config NEXT_PUBLIC_FS_VERSION).
 *
 * Each payload is a SLICE of upcoming.json's own rows plus the small reads
 * its first screen prints (app/lib/first-screen). The slice is chosen by the
 * selectors in app/lib/first-screen-select.ts:
 *
 *   home      every lot the "What matters" shortlist seats at ANY instant of
 *             a 48h clock sweep (20-minute steps) on ANY reader's day (every
 *             time zone), closed under fold groups + cross-house twins
 *   value     every Below-Market flag, every dead-room appraised lot, every
 *             gapOk lot (clock-free predicates; the window runs on the client)
 *   makers    every lot of a maker-market maker (art · design · watches)
 *   ent-<bb>  every lot whose entity key hashes to bucket <bb> (256 files)
 *
 * Fail-soft: no served data → no payloads, no hash, the site behaves exactly
 * as before. A payload whose rows lack a stamped signal (a pre-stamp book —
 * lotSignal would recompute over the slice) is not written.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import type { AuctionLot } from '../app/types';
import { prepareEagerLots, type CloseBoardJson } from '../app/lib/eager-book';
import { setCloseK } from '../app/lib/close-k';
import { houseBaselineStats } from '../app/lib/feed-filters';
import { bucketOf } from '../app/lib/page-data';
import {
  homeFeedIds, closeOverRefs, valueCandidate, makersCandidate,
} from '../app/lib/first-screen-select';
import type { FirstScreenPayload, FsMarket } from '../app/lib/first-screen';

const SERVED = path.join(process.cwd(), 'public', 'data', 'ray');
const HOUR = 3_600_000;

/** run fn with the wall clock pinned at `ms` (Date.now and new Date()) */
export function withClock<T>(ms: number, fn: () => T): T {
  const R = globalThis.Date;
  class Pinned extends R {
    constructor(...a: unknown[]) {
      // @ts-expect-error spread into the Date constructor
      super(...(a.length ? a : [ms]));
    }
    static now(): number { return ms; }
  }
  globalThis.Date = Pinned as unknown as DateConstructor;
  try { return fn(); } finally { globalThis.Date = R; }
}

/** every reader's calendar day at instant `ms` (UTC−12 … UTC+14) */
export function readerDays(ms: number): string[] {
  const s = new Set<string>();
  for (let o = -12; o <= 14; o++) s.add(new Date(ms + o * HOUR).toISOString().slice(0, 10));
  return Array.from(s);
}

export interface FirstScreenInput {
  /** upcoming.json, parsed (never mutated) */
  up: { generatedAt?: string; lots: AuctionLot[]; demand?: unknown; realized?: unknown; bidComp?: unknown };
  meta: { lastCrawl?: string; sources?: string[]; totalLots?: number; totalSold?: number };
  market: Record<string, unknown> | null;
  backtest: unknown;
  /** receipts.json — only its graded lane record ships (the annexes' footers) */
  receipts?: { record?: unknown } | null;
  closeBoard: CloseBoardJson | null;
  closeK: unknown;
  /** the sweep's start (default: now) */
  fromMs?: number;
  /** sweep length + step (default 48h, 20 min) */
  hours?: number;
  stepMin?: number;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function trimMarket(m: Record<string, unknown> | null): FsMarket | null {
  if (!m) return null;
  const markets: FsMarket['markets'] = {};
  for (const [k, v] of Object.entries((m.markets || {}) as Record<string, Record<string, unknown>>)) {
    markets[k] = { method: v.method as string, label: v.label as string, index: v.index, n: v.n as number };
  }
  const hedonic: FsMarket['hedonic'] = {};
  for (const [k, v] of Object.entries((m.hedonic || {}) as Record<string, Record<string, unknown>>)) {
    hedonic[k] = { horizons: v.horizons, lastCompleteQuarter: v.lastCompleteQuarter, note: v.note, composite: v.composite };
  }
  return {
    generatedAt: m.generatedAt as string, lastCrawl: m.lastCrawl as string,
    markets, repeatSale: (m.repeatSale || undefined) as FsMarket['repeatSale'], hedonic,
  };
}

/** the "What matters" union over the clock sweep, closed over row refs */
export function homeSlice(prepared: AuctionLot[], crawlDay: string, fromMs: number, hours: number, stepMin: number): Set<string> {
  const seated = new Set<string>();
  for (let t = fromMs - HOUR; t <= fromMs + hours * HOUR; t += stepMin * 60_000) {
    for (const day of readerDays(t)) {
      for (const id of withClock(t, () => homeFeedIds(prepared, t, day, crawlDay))) seated.add(id);
    }
  }
  return closeOverRefs(prepared, seated);
}

export function buildFirstScreens(input: FirstScreenInput): Map<string, Omit<FirstScreenPayload, 'ver'>> {
  const out = new Map<string, Omit<FirstScreenPayload, 'ver'>>();
  const raw = input.up.lots || [];
  const fromMs = input.fromMs ?? Date.now();
  // the rows as the client will hold them (close stamps + the overlay), for
  // the SELECTION only — the payload ships the raw rows and the client
  // prepares them itself (prepareEagerLots), exactly as phase 1 does
  const prepared = clone(raw);
  if (input.closeK) setCloseK(input.closeK);
  withClock(fromMs, () => prepareEagerLots(prepared, input.closeBoard, input.up.generatedAt));
  const crawlDay = (input.meta.lastCrawl || new Date(fromMs).toISOString()).slice(0, 10);
  const common = {
    v: 1 as const,
    meta: { lastCrawl: input.meta.lastCrawl || '', sources: input.meta.sources || [], totalLots: input.meta.totalLots, totalSold: input.meta.totalSold },
    upGen: input.up.generatedAt,
    closeBoard: input.closeBoard,
    closeK: input.closeK ?? null,
    baselines: houseBaselineStats(raw),
  };
  const pick = (ids: (l: AuctionLot, i: number) => boolean) => raw.filter(ids);
  const market = trimMarket(input.market);

  const homeIds = homeSlice(prepared, crawlDay, fromMs, input.hours ?? 48, input.stepMin ?? 20);
  out.set('home', { ...common, key: 'home', up: { demand: input.up.demand, realized: input.up.realized, bidComp: input.up.bidComp }, market, lots: pick(l => homeIds.has(l.id)) });
  out.set('value', { ...common, key: 'value', up: { demand: input.up.demand }, market, backtest: input.backtest ?? null, receipts: input.receipts?.record ? { record: input.receipts.record } : null, lots: pick((l, i) => valueCandidate(prepared[i])) });
  out.set('makers', { ...common, key: 'makers', up: { demand: input.up.demand }, market: null, lots: pick(l => makersCandidate(l)) });
  const byBucket = new Map<string, AuctionLot[]>();
  for (let b = 0; b < 256; b++) byBucket.set(b.toString(16).padStart(2, '0'), []);
  for (const l of raw) {
    const ek = (l as AuctionLot & { ek?: string | null }).ek;
    if (ek) byBucket.get(bucketOf(ek))!.push(l);
  }
  byBucket.forEach((lots, b) => out.set(`ent-${b}`, { ...common, key: `ent-${b}`, lots }));
  // a slice that would recompute a signal over itself is not a slice
  out.forEach((p, k) => { if (p.lots.some(l => l.signal === undefined)) out.delete(k); });
  return out;
}

/** (W27) the total-market roster's first screen prints maker rows only:
 *  their summaries ship as a slice of pages/entities-all.json — the makers'
 *  columns of the same v2 wire, dictionaries whole — so the ledger's first
 *  JS paint never waits on the whole file (~120KB brotli). null: not a v2
 *  file (the client then reads the whole file, as before). */
export function entitiesFirst(w: unknown): Record<string, unknown> | null {
  const f = w as { v?: number; c?: Record<string, unknown>; vf?: Record<string, unknown> } | null;
  if (!f || f.v !== 2 || !f.c || !Array.isArray(f.c.id)) return null;
  const keep: number[] = [];
  (f.c.id as unknown[]).forEach((id, i) => { if (typeof id === 'string' && id.startsWith('mk:')) keep.push(i); });
  const c: Record<string, unknown[]> = {};
  for (const [k, col] of Object.entries(f.c)) {
    if (!Array.isArray(col)) return null;
    c[k] = keep.map(i => col[i]);
  }
  const vf: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f.vf || {})) if (k.startsWith('mk:')) vf[k] = v;
  return { ...f, c, vf };
}

function readJson<T>(f: string): T | null {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) as T; } catch { return null; }
}

export function emitFirstScreens(served = SERVED): { ver: string; files: number; bytes: Record<string, [number, number]> } | null {
  const up = readJson<FirstScreenInput['up']>(path.join(served, 'upcoming.json'));
  const meta = readJson<FirstScreenInput['meta']>(path.join(served, 'meta.json'));
  const dir = path.join(served, 'first');
  fs.rmSync(dir, { recursive: true, force: true });
  if (!up || !Array.isArray(up.lots) || !meta) { console.log('emit-first-screen: no served book — no payloads (the site waits for the book, as before)'); return null; }
  // the sweep's start — also where the build's first paint (app/lib/
  // first-paint) starts proving its copy, so both read one instant
  const fromMs = Date.now();
  const built = buildFirstScreens({
    up, meta, fromMs,
    market: readJson(path.join(served, 'market.json')),
    backtest: readJson(path.join(served, 'backtest.json')),
    receipts: readJson(path.join(served, 'receipts.json')),
    closeBoard: readJson(path.join(served, 'close-board.json')),
    closeK: readJson(path.join(served, 'close-k.json')),
  });
  if (!built.size) return null;
  const bodies = new Map<string, string>();
  const h = crypto.createHash('sha1');
  built.forEach((p, k) => { const s = JSON.stringify(p); bodies.set(k, s); h.update(k).update(s); });
  const ents = entitiesFirst(readJson(path.join(served, 'pages', 'entities-all.json')));
  if (ents) { const s = JSON.stringify(ents); bodies.set('entities-all', s); h.update('entities-all').update(s); }
  const ver = h.digest('hex').slice(0, 12);
  fs.mkdirSync(dir, { recursive: true });
  const bytes: Record<string, [number, number]> = {};
  bodies.forEach((s, k) => {
    // the hash goes in last so the body's own bytes stay what was hashed
    const body = `${s.slice(0, -1)},"ver":"${ver}"}`;
    fs.writeFileSync(path.join(dir, `${k}.json`), body);
    if (!k.startsWith('ent-')) bytes[k] = [body.length, zlib.brotliCompressSync(body).length];
  });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ ver, fromMs, lastCrawl: meta.lastCrawl || '', keys: Array.from(bodies.keys()), generatedAt: new Date().toISOString() }));
  return { ver, files: bodies.size, bytes };
}

if (require.main === module && !process.env.RAY_SKIP_MAIN) {
  const i = process.argv.indexOf('--served');
  const t0 = Date.now();
  const served = i > 0 ? process.argv[i + 1] : SERVED;
  let r: ReturnType<typeof emitFirstScreens> = null;
  try {
    r = emitFirstScreens(served);
  } catch (e) {
    // advisory: a failed emit ships no payloads (pages wait for the book, as
    // before) — it must never fail the deploy
    fs.rmSync(path.join(served, 'first'), { recursive: true, force: true });
    console.log(`::warning::emit-first-screen failed — no first-screen payloads this deploy: ${(e as Error).message}`);
  }
  if (r) {
    const sizes = Object.entries(r.bytes).map(([k, [raw, br]]) => `${k} ${(raw / 1024).toFixed(0)}KB raw / ${(br / 1024).toFixed(1)}KB br`).join(' · ');
    console.log(`emit-first-screen: ${r.files} payloads, ver ${r.ver} (${((Date.now() - t0) / 1000).toFixed(1)}s) — ${sizes}`);
  }
}
