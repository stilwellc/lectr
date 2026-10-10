'use client';
/**
 * feed-filters.ts — the triage filters shared by the home feed, /value and
 * /makers (Oct 8): closing window, clean category/sub (app/lib/taxonomy),
 * house, value floor and "new since your last visit" — plus a URL codec so a
 * reload or a shared link reopens the exact same view.
 *
 * Only state the reader changed is written to the URL (defaults are omitted),
 * via history.replaceState — filtering never adds a Back-button entry.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { taxonOf, subMatches, type CatKey } from './taxonomy';
import { prioStatic } from './priority';
import { passesFacets } from './facets';
import { localToday, trueSaleDay } from '../utils';

export type CloseWindow = 'today' | '48h' | 'week';

export interface TriageFilters {
  /** closing window, on the reader's calendar */
  win: CloseWindow | null;
  /** clean category (taxonomy CatKey) */
  cat: CatKey | null;
  /** clean sub-category key within `cat` */
  sub: string | null;
  house: string | null;
  /** value floor on the priority anchor (hammer-basis USD) */
  minUsd: number | null;
  /** value ceiling on the same anchor ("Under $5K") */
  maxUsd: number | null;
  /** first seen after the reader's previous visit */
  newOnly: boolean;
  /** in-category facets (app/lib/facets): Graded, Rookie, era, Film & TV… */
  fx: string[];
}

export const TRIAGE_DEFAULTS: TriageFilters = { win: null, cat: null, sub: null, house: null, minUsd: null, maxUsd: null, newOnly: false, fx: [] };

export const WINDOWS: { key: CloseWindow; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '48h', label: '48 hours' },
  { key: 'week', label: 'This week' },
];
/** the value rungs (Oct 10: + $10K, $50K, $250K). The URL carries any
 *  positive number (min=/max=), so links made on the old 4-rung ladder still
 *  open exactly as they were. */
export const VALUE_FLOORS = [1000, 5000, 10000, 25000, 50000, 100000, 250000];
/** the ceilings ("Under $X") — the same rungs read from the other side; no
 *  "Under $250K" (that is nearly the whole book, not a filter) */
export const VALUE_CEILINGS = [1000, 5000, 10000, 25000, 50000, 100000];
export const fmtCeiling = (n: number) => (n >= 1000 ? `Under $${n / 1000}K` : `Under $${n}`);
/** the toolbar's ONE value select (floors, then ceilings): its current option
 *  ('min:5000' / 'max:5000' / '') and the patch an option applies — picking
 *  one side clears the other (a range rides the URL or the phone sheet) */
export function valueOptionOf(f: Pick<TriageFilters, 'minUsd' | 'maxUsd'>): string {
  return f.minUsd ? `min:${f.minUsd}` : f.maxUsd ? `max:${f.maxUsd}` : '';
}
export function valuePatchOf(v: string): Pick<TriageFilters, 'minUsd' | 'maxUsd'> {
  const [side, n] = v.split(':');
  const usd = Number(n);
  if (!Number.isFinite(usd) || usd <= 0) return { minUsd: null, maxUsd: null };
  return side === 'max' ? { minUsd: null, maxUsd: usd } : { minUsd: usd, maxUsd: null };
}

function addDays(iso: string, n: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}

type TriageLot = Parameters<typeof prioStatic>[0] & {
  title?: string | null;
  auctionHouse?: string | null; firstSeen?: string | null; saleDate?: string | null; saleDateTime?: string | null;
};

// ── onboarding baselines ─────────────────────────────────────────────────────
// A house's FIRST crawl stamps its whole live book with one firstSeen day (REA,
// Oct 9: 3,489 lots "first seen today"). Lots a crawler discovers on day one
// were not necessarily listed that day — they must not flood "New since last
// visit". The rule, read off the book itself (no crawl metadata needed):
//   a house's ONBOARDING DAY is its earliest firstSeen anywhere in the pool
//   (live + whatever sold history is loaded) WHEN
//     · that day is recent (≤ BASELINE_RECENT_DAYS before today) — the lens
//       only cares while those lots could still read as "new", and a wrong
//       guess (a house whose catalogs all land at once) can only hide one
//       catalog for two days, never for good,
//     · it holds > BASELINE_SHARE of the house's live, stamped lots — a house
//       with a running book (Goldin) has older live lots, so its real new
//       catalogs always count, and
//     · it is a flood (≥ BASELINE_MIN lots) — a small house's first catalog
//       (Rago's 13) is harmless and stays "new".
// Lots without firstSeen (RR's 965 predate the stamp — ray-crawl W15 never
// fabricates one) are never "new": an unknown arrival day is not today.
export const BASELINE_SHARE = 0.6;
export const BASELINE_MIN = 50;
export const BASELINE_RECENT_DAYS = 2;
export type HouseBaselines = ReadonlyMap<string, string>;
type BaselineLot = { auctionHouse?: string | null; firstSeen?: string | null; status?: string | null };

const baselineCache = new WeakMap<object, { today: string; map: HouseBaselines }>();
/** house → onboarding day (YYYY-MM-DD). Cached per pool array + day, so every
 *  call site can pass the page's whole pool without re-scanning it. */
export function houseBaselines(lots: readonly BaselineLot[], today: string = localToday()): HouseBaselines {
  const hit = baselineCache.get(lots);
  if (hit && hit.today === today) return hit.map;
  const earliest = new Map<string, string>();
  const live = new Map<string, Map<string, number>>();
  for (const l of lots) {
    const h = l.auctionHouse;
    const d = (l.firstSeen || '').slice(0, 10);
    if (!h || !d) continue;
    const e = earliest.get(h);
    if (!e || d < e) earliest.set(h, d);
    if (l.status && l.status !== 'upcoming') continue;
    let byDay = live.get(h);
    if (!byDay) live.set(h, (byDay = new Map()));
    byDay.set(d, (byDay.get(d) || 0) + 1);
  }
  const cutoff = addDays(today, -BASELINE_RECENT_DAYS);
  const map = new Map<string, string>();
  earliest.forEach((day, h) => {
    if (day < cutoff) return;
    const byDay = live.get(h);
    if (!byDay) return;
    let total = 0;
    byDay.forEach(n => { total += n; });
    const n = byDay.get(day) || 0;
    if (n >= BASELINE_MIN && n / total > BASELINE_SHARE) map.set(h, day);
  });
  baselineCache.set(lots, { today, map });
  return map;
}

export interface NewLensOpts { today?: string; prevVisitDay?: string | null; baselines?: HouseBaselines | null }

/** Is this lot "new" for the reader? firstSeen after their previous visit
 *  (or today, on a first visit / a repeat visit the same day), and not part of
 *  its house's onboarding flood. */
export function isNewLot(l: { auctionHouse?: string | null; firstSeen?: string | null }, opts: NewLensOpts = {}): boolean {
  const seen = (l.firstSeen || '').slice(0, 10);
  if (!seen) return false;
  const today = opts.today ?? localToday();
  const since = opts.prevVisitDay;
  // first visit ever (no previous day) or already here today → "new today"
  if (!since || since >= today) { if (seen < today) return false; }
  else if (seen <= since) return false;
  if (l.auctionHouse && opts.baselines?.get(l.auctionHouse) === seen) return false;
  return true;
}

/** Does one lot pass the triage filters? `prevVisitDay` comes from useLastVisit;
 *  `baselines` from houseBaselines(the page's whole lot pool). */
export function passesTriage(l: TriageLot, f: TriageFilters, opts: NewLensOpts = {}): boolean {
  if (f.win) {
    const today = opts.today ?? localToday();
    const day = trueSaleDay(l);
    if (!day) return false;
    const last = f.win === 'today' ? today : f.win === '48h' ? addDays(today, 1) : addDays(today, 6);
    if (day > last) return false;
  }
  if (f.cat || f.sub) {
    const t = taxonOf(l);
    if (f.cat && t.cat !== f.cat) return false;
    if (f.sub && !subMatches(t.cat, f.sub, t.sub)) return false;
  }
  if (f.house && l.auctionHouse !== f.house) return false;
  if (f.fx.length && !passesFacets(l, f.fx)) return false;
  if (f.minUsd || f.maxUsd) {
    // a lot with no price anchor can't be placed on either side of a bound
    const p = prioStatic(l);
    if (!p) return false;
    if (f.minUsd && p.a < f.minUsd) return false;
    if (f.maxUsd && p.a >= f.maxUsd) return false;
  }
  if (f.newOnly && !isNewLot(l, opts)) return false;
  return true;
}

export function isTriageActive(f: TriageFilters): boolean {
  return f.win != null || f.cat != null || f.sub != null || f.house != null || f.minUsd != null || f.maxUsd != null || f.newOnly || f.fx.length > 0;
}

// ── the way back ─────────────────────────────────────────────────────────────
export type RelaxKey = 'win' | 'sub' | 'cat' | 'house' | 'value' | 'new' | 'fx';
/** When the reader's filters cut a list to nothing: each active filter as a
 *  one-tap undo, with how many of `lots` that undo alone brings back (the same
 *  passesTriage rule the list runs). Undos that bring nothing back are left
 *  out; a picked sub-category relaxes to its category before the category
 *  itself goes. Order: window, category, house, value, new, refinements. */
export function relaxTriage(lots: readonly TriageLot[], f: TriageFilters, opts: NewLensOpts = {}): { k: RelaxKey; next: TriageFilters; n: number }[] {
  const out: { k: RelaxKey; next: TriageFilters; n: number }[] = [];
  const offer = (k: RelaxKey, patch: Partial<TriageFilters>) => {
    const next = { ...f, ...patch };
    let n = 0;
    for (const l of lots) if (passesTriage(l, next, opts)) n++;
    if (n > 0) out.push({ k, next, n });
  };
  if (f.win) offer('win', { win: null });
  if (f.cat && f.sub) offer('sub', { sub: null });
  else if (f.cat) offer('cat', { cat: null, sub: null, fx: [] });
  if (f.house) offer('house', { house: null });
  if (f.minUsd || f.maxUsd) offer('value', { minUsd: null, maxUsd: null });
  if (f.newOnly) offer('new', { newOnly: false });
  if (f.fx.length) offer('fx', { fx: [] });
  return out;
}

// ── URL codec ────────────────────────────────────────────────────────────────
// Short keys; anything absent = default. Pages may encode extra keys of their
// own (sort, tab, q…) through the same params object.
export function triageToParams(f: TriageFilters, p: URLSearchParams): void {
  const put = (k: string, v: string | null) => { if (v) p.set(k, v); else p.delete(k); };
  put('win', f.win);
  put('cat', f.cat);
  put('sub', f.sub);
  put('house', f.house);
  put('min', f.minUsd ? String(f.minUsd) : null);
  put('max', f.maxUsd ? String(f.maxUsd) : null);
  put('new', f.newOnly ? '1' : null);
  put('fx', f.fx.length ? f.fx.join(',') : null);
}

export function triageFromParams(p: URLSearchParams): TriageFilters {
  const win = p.get('win');
  const min = Number(p.get('min'));
  const max = Number(p.get('max'));
  return {
    win: win === 'today' || win === '48h' || win === 'week' ? win : null,
    cat: (p.get('cat') as CatKey) || null,
    sub: p.get('sub') || null,
    house: p.get('house') || null,
    minUsd: Number.isFinite(min) && min > 0 ? min : null,
    maxUsd: Number.isFinite(max) && max > 0 ? max : null,
    newOnly: p.get('new') === '1',
    fx: (p.get('fx') || '').split(',').filter(Boolean),
  };
}

/**
 * URL-synced state: reads once on mount (client only — SSR renders defaults),
 * then mirrors every change into the query string with replaceState.
 * `encode`/`decode` map the page's state to/from URLSearchParams.
 */
export function useUrlState<T>(
  defaults: T,
  decode: (p: URLSearchParams) => T,
  encode: (s: T, p: URLSearchParams) => void,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(defaults);
  const cur = useRef<T>(defaults);
  const hydrated = useRef(false);
  useEffect(() => {
    const v = decode(new URLSearchParams(window.location.search));
    cur.current = v;
    setState(v);
    hydrated.current = true;
    // decode is a stable module-level fn at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = useCallback((next: T | ((prev: T) => T)) => {
    const v = typeof next === 'function' ? (next as (prev: T) => T)(cur.current) : next;
    cur.current = v;
    setState(v);
    if (!hydrated.current) return;
    const p = new URLSearchParams(window.location.search);
    encode(v, p);
    const qs = p.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', url);
  }, [encode]);
  return [state, set];
}

// ── last visit ───────────────────────────────────────────────────────────────
const LV_KEY = 'lectr-last-visit';
const LV_SESSION = 'lectr-visit-session';

/**
 * The reader's PREVIOUS visit day (per device, no account needed). The stored
 * day only advances once per browser session, so "new since last visit" stays
 * stable while the reader moves around the site.
 */
export function useLastVisit(): string | null {
  const [prev, setPrev] = useState<string | null>(null);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LV_KEY);
      const inSession = window.sessionStorage.getItem(LV_SESSION);
      if (inSession) { setPrev(inSession === '-' ? null : inSession); return; }
      window.sessionStorage.setItem(LV_SESSION, stored || '-');
      window.localStorage.setItem(LV_KEY, localToday());
      setPrev(stored);
    } catch { /* storage blocked: no "new" lens, everything else works */ }
  }, []);
  return prev;
}

/** apply a patch; a new category drops facets that belonged to the old one */
export function patchTriage<T extends TriageFilters>(f: T, patch: Partial<T>): T {
  const next = { ...f, ...patch };
  const moved = (k: string) => k in patch && (patch as Record<string, unknown>)[k] !== (f as Record<string, unknown>)[k];
  if ((moved('cat') || moved('vertical')) && !('fx' in patch)) next.fx = [];
  return next;
}

// ── feed memory ──────────────────────────────────────────────────────────────
// "Open my feed the way I left it" (Oct 9): the home feed remembers the
// reader's last triage + tab + sort per device. A bare visit to a lander
// restores it; any feed param in the URL means the URL wins, untouched. A
// different market restores only what applies there — the same rule the
// market-flip effect uses (category / sub-category / facets are scoped to the
// market they were picked in; window, house, floor, new, sort and tab travel).
// Search text and the Hammer Week day are deliberately NOT remembered: a stale
// query or a past day reopening on its own would read as a broken feed.
const MEM_KEY = 'lectr-feed-memory';
export const MEMORY_KEYS = ['win', 'cat', 'sub', 'house', 'min', 'max', 'new', 'fx', 'tab', 'sort', 'below'] as const;
const MARKET_SCOPED = new Set<string>(['cat', 'sub', 'fx']);

export interface FeedMemory { /** market the view was left on */ m: string; /** remembered params */ p: string }

/** the remembered slice of a feed URL's params */
export function memoryOf(params: URLSearchParams, market: string): FeedMemory {
  const out = new URLSearchParams();
  for (const k of MEMORY_KEYS) { const v = params.get(k); if (v) out.set(k, v); }
  return { m: market, p: out.toString() };
}

/** the params to restore on `market`, or null when nothing applies */
export function restoreParams(mem: FeedMemory | null | undefined, market: string): URLSearchParams | null {
  if (!mem || typeof mem.p !== 'string' || typeof mem.m !== 'string') return null;
  const src = new URLSearchParams(mem.p);
  const out = new URLSearchParams();
  for (const k of MEMORY_KEYS) {
    const v = src.get(k);
    if (!v) continue;
    if (mem.m !== market && MARKET_SCOPED.has(k)) continue;
    out.set(k, v);
  }
  return out.toString() ? out : null;
}

export function readFeedMemory(): FeedMemory | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(MEM_KEY) || 'null');
    return v && typeof v === 'object' ? (v as FeedMemory) : null;
  } catch { return null; }
}

/** null (or an empty slice) forgets the view */
export function writeFeedMemory(mem: FeedMemory | null): void {
  try {
    if (!mem || !mem.p) window.localStorage.removeItem(MEM_KEY);
    else window.localStorage.setItem(MEM_KEY, JSON.stringify(mem));
  } catch { /* storage blocked: the feed simply opens on defaults */ }
}
