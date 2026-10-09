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
  /** first seen after the reader's previous visit */
  newOnly: boolean;
}

export const TRIAGE_DEFAULTS: TriageFilters = { win: null, cat: null, sub: null, house: null, minUsd: null, newOnly: false };

export const WINDOWS: { key: CloseWindow; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '48h', label: '48 hours' },
  { key: 'week', label: 'This week' },
];
export const VALUE_FLOORS = [1000, 5000, 25000, 100000];

function addDays(iso: string, n: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}

type TriageLot = Parameters<typeof prioStatic>[0] & {
  auctionHouse?: string | null; firstSeen?: string | null; saleDate?: string | null; saleDateTime?: string | null;
};

/** Does one lot pass the triage filters? `prevVisitDay` comes from useLastVisit. */
export function passesTriage(l: TriageLot, f: TriageFilters, opts: { today?: string; prevVisitDay?: string | null } = {}): boolean {
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
  if (f.minUsd) {
    const p = prioStatic(l);
    if (!p || p.a < f.minUsd) return false;
  }
  if (f.newOnly) {
    const seen = l.firstSeen || '';
    const since = opts.prevVisitDay;
    if (!seen) return false;
    // first visit ever (no previous day) or already here today → "new today"
    if (!since || since >= (opts.today ?? localToday())) { if (seen < (opts.today ?? localToday())) return false; }
    else if (seen <= since) return false;
  }
  return true;
}

export function isTriageActive(f: TriageFilters): boolean {
  return f.win != null || f.cat != null || f.sub != null || f.house != null || f.minUsd != null || f.newOnly;
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
  put('new', f.newOnly ? '1' : null);
}

export function triageFromParams(p: URLSearchParams): TriageFilters {
  const win = p.get('win');
  const min = Number(p.get('min'));
  return {
    win: win === 'today' || win === '48h' || win === 'week' ? win : null,
    cat: (p.get('cat') as CatKey) || null,
    sub: p.get('sub') || null,
    house: p.get('house') || null,
    minUsd: Number.isFinite(min) && min > 0 ? min : null,
    newOnly: p.get('new') === '1',
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
