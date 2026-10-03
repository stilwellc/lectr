/**
 * api.ts — the client side of the read-only lot API (functions/api, R2-backed;
 * docs/data-pipeline.md "The lot API"). It replaces every client download of
 * the full served corpus (lots-*.json + sold-archive-*.json, ~500MB raw):
 * one lot, one lot's comps, one page of a table, or one maker's/market's
 * book in compact columns — never the whole book.
 *
 * Every loader is module-memoized per session, retries a transient failure
 * once, and REJECTS on failure (callers render an honest error + retry, never
 * a silent empty state). Same-origin only — CSP connect-src 'self' covers it.
 */
import type { AuctionLot } from '../types';
import type { LotPack, PackRow } from './page-data';
import type { SummaryJson } from '../../functions/_lib/format';

export class ApiError extends Error {
  constructor(readonly status: number, msg: string) { super(msg); }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function apiFetch(path: string): Promise<Response> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(600);
    try {
      const r = await fetch(path, { headers: { Accept: 'application/json' } });
      if (r.ok || r.status === 404 || r.status === 400) return r;
      last = new ApiError(r.status, `${path}: ${r.status}`);
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new ApiError(0, `${path}: network`);
}

async function apiJson<T>(path: string): Promise<T | null> {
  const r = await apiFetch(path);
  if (r.status === 404) return null;
  if (!r.ok) throw new ApiError(r.status, `${path}: ${r.status}`);
  return (await r.json()) as T;
}

/** memo that forgets failures, so a retry button really retries */
function memo<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = load();
    cache.set(key, p);
    p.catch(() => { if (cache.get(key) === p) cache.delete(key); });
  }
  return p;
}

// ── lots ─────────────────────────────────────────────────────────────────────
const lotP = new Map<string, Promise<AuctionLot | null>>();
/** One lot by id — null when the book doesn't carry it (rejects on failure). */
export function fetchLot(id: string): Promise<AuctionLot | null> {
  return memo(lotP, id, async () => {
    const j = await apiJson<{ lot: AuctionLot }>(`/api/lot/${encodeURIComponent(id)}`);
    return j?.lot ?? null;
  });
}

/** Many lots by id (batched ≤60 per request); ids the book lacks are absent. */
export async function fetchLots(ids: string[]): Promise<Map<string, AuctionLot>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const out = new Map<string, AuctionLot>();
  for (let i = 0; i < uniq.length; i += 60) {
    const batch = uniq.slice(i, i + 60);
    const j = await apiJson<{ lots: Record<string, AuctionLot> }>(`/api/lots?ids=${batch.map(encodeURIComponent).join(',')}`);
    for (const [id, l] of Object.entries(j?.lots || {})) out.set(id, l);
  }
  return out;
}

// ── comps ────────────────────────────────────────────────────────────────────
export interface ApiLotPack extends LotPack {
  ap?: { value: number; n: number; kind: 'edition' | 'form'; confidence: string } | null;
  mr?: { kind: string; confidence: string; med: number; q1: number; q3: number; n: number; scope?: string } | null;
  sig?: unknown;
}
export interface CompsAnswer { id: string; pack: ApiLotPack; ctx: PackRow[]; exact: PackRow | null }

const compsP = new Map<string, Promise<CompsAnswer | null>>();
/** One lot's comp reads, computed at the edge over its own candidate pool. */
export function fetchComps(id: string): Promise<CompsAnswer | null> {
  return memo(compsP, id, () => apiJson<CompsAnswer>(`/api/comps?lot=${encodeURIComponent(id)}`));
}

// ── tables ───────────────────────────────────────────────────────────────────
export type TableScope = { kind: 'maker'; slug: string } | { kind: 'archive'; market: string };
export interface TableQuery { sort: 'date' | 'price'; cat?: string | null; sport?: string | null; page: number; size: number }
export interface TablePage {
  total: number; page: number; size: number; rows: AuctionLot[];
  facets: { cats: string[]; sports: [string, number][] | null };
}
const tableP = new Map<string, Promise<TablePage>>();
export function fetchTablePage(scope: TableScope, q: TableQuery): Promise<TablePage> {
  const sp = new URLSearchParams({ sort: q.sort, page: String(q.page), size: String(q.size) });
  if (q.cat && q.cat !== 'all') sp.set('cat', q.cat);
  if (q.sport && q.sport !== 'all') sp.set('sport', q.sport);
  const path = scope.kind === 'maker'
    ? `/api/maker/${encodeURIComponent(scope.slug)}?${sp}`
    : `/api/archive?market=${encodeURIComponent(scope.market)}&${sp}`;
  return memo(tableP, path, async () => {
    const j = await apiJson<TablePage>(path);
    if (!j) throw new ApiError(404, path);
    return j;
  });
}

// ── summaries (aggregate surfaces) ──────────────────────────────────────────
/** Columns → the slim lot objects the aggregate surfaces read (status, price,
 *  date, category, estimates, house, sport, player). The top-priced rows come
 *  back whole (title, photo, id) for the record plates. Synthetic ids keep
 *  React keys unique; they never leave the page. */
export function decodeSummary(j: SummaryJson): AuctionLot[] {
  const { dict: D, cols: C } = j;
  const at = (arr: string[], i: number) => (i >= 0 ? arr[i] : undefined);
  const out: AuctionLot[] = new Array(j.n);
  for (let i = 0; i < j.n; i++) {
    const o: Record<string, unknown> = {
      id: `${j.scope}#${i}`,
      artist: at(D.a, C.a[i]) || '',
      status: at(D.s, C.s[i]) || 'unknown',
      category: at(D.c, C.c[i]) || 'unknown',
      auctionHouse: at(D.h, C.h[i]) || '',
      saleDate: at(D.d, C.d[i]) || '',
      title: '',
    };
    if (C.p[i]) o.priceUsd = C.p[i];
    if (C.el[i]) o.estimateLow = C.el[i];
    if (C.eh[i]) o.estimateHigh = C.eh[i];
    const sp = at(D.sp, C.sp[i]); if (sp) o.sport = sp;
    if (C.pl[i] >= 0) { o.playerSlug = D.pl[C.pl[i]]; if (D.pn[C.pl[i]]) o.playerName = D.pn[C.pl[i]]; }
    out[i] = o as unknown as AuctionLot;
  }
  for (const [i, row] of j.top) if (i >= 0 && i < j.n) out[i] = row as unknown as AuctionLot;
  return out;
}

const sumP = new Map<string, Promise<AuctionLot[]>>();
/** A maker's book (minus the eager upcoming lots, which the caller lays on
    top) or a market's book, decoded. Rejects on failure. */
export function fetchSummary(kind: 'maker' | 'market', key: string): Promise<AuctionLot[]> {
  const path = kind === 'maker' ? `/api/maker/${encodeURIComponent(key)}?view=summary` : `/api/market/${encodeURIComponent(key)}?view=summary`;
  return memo(sumP, path, async () => {
    const j = await apiJson<SummaryJson>(path);
    if (!j) throw new ApiError(404, path);
    return decodeSummary(j);
  });
}

// ── settled flags (/receipts) ───────────────────────────────────────────────
const settledP = new Map<string, Promise<AuctionLot[]>>();
export function fetchSettledFlags(market = 'all'): Promise<AuctionLot[]> {
  const path = `/api/settled-flags?market=${encodeURIComponent(market)}`;
  return memo(settledP, path, async () => (await apiJson<{ rows: AuctionLot[] }>(path))?.rows || []);
}
