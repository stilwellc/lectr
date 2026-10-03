/**
 * page-data.ts — the BUILD-TIME page payloads (scripts/emit-page-stats.ts).
 *
 * The full sold corpus (lots-*.json, ~35MB brotli) used to be the only way a
 * page could print a settlement number, a lot's comps, a maker's photo or a
 * maker's sold history. The emitter reads the same served shards the client
 * would have streamed, runs the SAME app/lib functions over them once a night,
 * and writes small files under /data/ray/pages/:
 *
 *   page-stats.json      settlement per market · maker faces · maker shard counts
 *                        · the ref/player directories
 *   lot-pack-XX.json     per upcoming lot: the comp rows / band / appraisal /
 *                        reference band / provenance the certificate prints
 *
 * Every OTHER lot (a settled lot, a lot the build packed nothing for) reads
 * the same pack from the lot API (/api/comps, app/lib/api.ts) — computed at
 * the edge over the lot's own candidate pool. The client never downloads the
 * served corpus shards any more (lot-idx / maker-<slug>-N files are no longer
 * read).
 *
 * Every loader here is module-cached and versioned by the crawl stamp so a
 * new crawl is a new URL.
 */
import { fetchComps } from './api';
import type { AuctionLot } from '../types';

/** FNV-1a 32 → 2 hex chars. Shared with the emitter — both sides MUST agree. */
export function bucketOf(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 0xff).toString(16).padStart(2, '0');
}

export interface SettlementStat {
  /** sold lots with a price in this market's served book */
  sold: number;
  /** median hammer vs estimate (the home slip's exact upper-middle pick) */
  medianPct: number | null;
  latest: string | null;
}
export interface MakerFace { url: string; val: number }
export interface RefIndexRow { maker: string; ref: string; n: number; med: number }
export interface PlayerIndexRow { slug: string; name: string; sport: string | null; n: number }
export interface SettledCallRow {
  id: string; k: string; d: string; sd: string; p: number; r: number; f?: number;
  m: string; t: string; a: string; h: string;
  /** the projection repeats verbatim across ≥3 lots that call night — an
      opening-bid ladder start, not a lot-specific read (hidden by the UI) */
  fb?: 1;
}
export interface PageStats {
  generatedAt: string;
  lastCrawl: string;
  settlement: Record<string, SettlementStat>;
  makerFaces: Record<string, MakerFace>;
  makerShards: Record<string, number>;
  refIndex: RefIndexRow[];
  playerIndex: PlayerIndexRow[];
  settled: Record<string, SettledCallRow[]>;
}

/** a display-grade comp row — the fields the certificate's comps/provenance
    rows read (never merged back into a pool) */
export type PackRow = Pick<AuctionLot, 'id' | 'title' | 'auctionHouse' | 'saleDate' | 'priceUsd' | 'status' | 'artist' | 'category'> &
  Partial<Pick<AuctionLot, 'url' | 'imageUrl' | 'medium' | 'saleName' | 'estimateLow' | 'estimateHigh' | 'repeatSaleGroupId'>>;

export interface LotPack {
  /** soldCompBand over main + archive (sports/science objects) */
  b?: { form: string; median: number; low: number; high: number; n: number; confidence: 'high' | 'medium' | 'low'; rows: PackRow[] };
  /** the call: the engine's pool resolved on the served book, else the
      client read (signalWithPool) — n/med/form/kind exactly as LotPage builds */
  c?: { n: number; med: number | null; form: string | null; kind: string; resolved: number; rows: PackRow[]; ps?: number[] };
  /** appraiseLot value (only when the page would fall through to it) */
  a?: number | null;
  /** science/culture reference band */
  r?: { kind: 'reference' | 'edition-like'; confidence: 'low'; med: number; q1: number; q3: number; n: number; scope?: string } | null;
  /** provenance rows (repeatSaleGroupId), oldest first */
  p?: PackRow[];
}

/** THE FALLBACK-PROJECTION RULE (one definition — the emitter and /receipts
 *  both call it). A bid projection ('vsbid') or shelf call ('gap') is
 *  bid × the close curve, so a lot nobody has bid on projects off the house's
 *  opening increment: the same starting bid yields the SAME number for every
 *  such lot that night ($691 ×3 on Sep 27). A projection repeated verbatim
 *  across ≥3 distinct lots on one call date carries no lot-specific read —
 *  it is marked `fb` and surfaces hide it rather than print it as a call. */
export function markFallbackProjections<T extends { id: string; k: string; d: string; p: number; fb?: 1 }>(rows: T[]): T[] {
  const groups = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.k !== 'vsbid' && r.k !== 'gap') continue;
    const key = `${r.k}|${r.d}|${Math.round(r.p)}`;
    (groups.get(key) || groups.set(key, new Set()).get(key)!).add(r.id);
  }
  return rows.map(r => {
    if (r.k !== 'vsbid' && r.k !== 'gap') return r;
    const n = groups.get(`${r.k}|${r.d}|${Math.round(r.p)}`)?.size || 0;
    return n >= 3 ? { ...r, fb: 1 as const } : r;
  });
}

const BASE = '/data/ray/pages';
const verOf = (v?: string) => (v ? `?v=${encodeURIComponent(v)}` : '');

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

let statsP: Promise<PageStats | null> | null = null;
/** page-stats.json (~tens of KB) — one fetch per session */
export function loadPageStats(): Promise<PageStats | null> {
  if (!statsP) statsP = getJson<PageStats>(`${BASE}/page-stats.json`);
  return statsP;
}

const packP = new Map<string, Promise<Record<string, LotPack> | null>>();
function bucketFile<T>(cache: Map<string, Promise<T | null>>, kind: string, id: string, ver?: string): Promise<T | null> {
  const b = bucketOf(id);
  let p = cache.get(b);
  if (!p) { p = getJson<T>(`${BASE}/${kind}-${b}.json${verOf(ver)}`); cache.set(b, p); }
  return p;
}

/** The build-time pack for an upcoming lot, or null (not packed). */
export async function loadStaticLotPack(id: string, ver?: string): Promise<LotPack | null> {
  const m = await bucketFile(packP, 'lot-pack', id, ver);
  return (m && m[id]) || null;
}

/** The lot's comp pack: the build-time pack when the nightly packed this lot,
 *  else the lot API's (/api/comps — the same reads over the lot's own pool).
 *  Resolves null when neither knows the lot; REJECTS when the API failed, so
 *  the caller can print an honest error + retry. */
export async function loadLotPackStrict(id: string, ver?: string): Promise<LotPack | null> {
  const stat = await loadStaticLotPack(id, ver);
  if (stat) return stat;
  const ans = await fetchComps(id);
  return ans ? ans.pack : null;
}

/** loadLotPackStrict, failing SOFT (null) — for surfaces with their own fallbacks. */
export function loadLotPack(id: string, ver?: string): Promise<LotPack | null> {
  return loadLotPackStrict(id, ver).catch(() => null);
}

/** PackRow → the display-grade lot the comps rows render */
export function packRowsToLots(rows: PackRow[] | undefined): AuctionLot[] {
  return (rows || []) as unknown as AuctionLot[];
}
