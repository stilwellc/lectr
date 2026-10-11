'use client';
/**
 * interests.ts — what the quick start ("What do you collect?") remembers
 * besides the follows themselves (Oct 11 2026): the markets the reader picked
 * and an optional price range. Kept ON THE DEVICE only (localStorage
 * `lectr-interests`, every access try/catch'd) — signed in or not; the
 * follows it produced are what sync to an account (app/lib/follows).
 *
 * The price range is a reader's statement, not a learned band: useTaste
 * hands it to the recommender as a STRONG band (recs.ts statedFit — lots
 * inside lead, lots outside sink to a floor, never hidden; a lot with no
 * price anchor cannot be placed and stays close to the in-range ones).
 * `inPriceRange` stays for anything that wants the plain yes/no.
 * `getPricePref()` is the tiny getter for anything else that wants it.
 */
import { useEffect, useMemo, useState } from 'react';
import { MARKETS, type Market } from '../constants';
import { prioStatic } from './priority';
import { storageFailed, deviceKV } from './safe-storage';

export interface PricePref {
  /** at least (hammer-basis USD) — one of feed-filters VALUE_FLOORS */
  minUsd: number | null;
  /** under (USD) — one of feed-filters VALUE_CEILINGS */
  maxUsd: number | null;
}

export interface Interests extends PricePref {
  v: 1;
  markets: Market[];
  /** ISO time the reader last finished the quick start */
  at: string | null;
}

export const INTERESTS_KEY = 'lectr-interests';
export const NO_INTERESTS: Interests = { v: 1, markets: [], minUsd: null, maxUsd: null, at: null };

type Store = Pick<Storage, 'getItem' | 'setItem'>;
function store(): Store | null {
  return typeof window !== 'undefined' ? deviceKV : null;
}

const MARKET_KEYS = new Set<string>(MARKETS.map(m => m.key).filter(k => k !== 'all'));

const pos = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

/** a stored value read defensively: anything malformed reads as no interests */
export function parseInterests(raw: string | null | undefined): Interests {
  if (!raw) return NO_INTERESTS;
  try {
    const o = JSON.parse(raw) as Partial<Interests>;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return NO_INTERESTS;
    const minUsd = pos(o.minUsd);
    let maxUsd = pos(o.maxUsd);
    // an inverted range is no range on that side
    if (minUsd != null && maxUsd != null && minUsd >= maxUsd) maxUsd = null;
    const markets = Array.isArray(o.markets) ? o.markets.filter((m): m is Market => typeof m === 'string' && MARKET_KEYS.has(m)) : [];
    return { v: 1, markets: Array.from(new Set(markets)), minUsd, maxUsd, at: typeof o.at === 'string' && !isNaN(Date.parse(o.at)) ? o.at : null };
  } catch { return NO_INTERESTS; }
}

export function readInterests(s: Store | null = store()): Interests {
  try { return parseInterests(s?.getItem(INTERESTS_KEY)); } catch { return NO_INTERESTS; }
}

export function writeInterests(next: Omit<Interests, 'v'>, s: Store | null = store()): Interests {
  const v = parseInterests(JSON.stringify({ ...next, v: 1 }));
  try { s?.setItem(INTERESTS_KEY, JSON.stringify(v)); } catch { storageFailed(); /* blocked / full: say so */ }
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event(INTERESTS_KEY)); } catch { /* no window */ }
  return v;
}

/** THE getter: the reader's stated price range, or null (none stated) */
export function getPricePref(s: Store | null = store()): PricePref | null {
  const i = readInterests(s);
  return i.minUsd != null || i.maxUsd != null ? { minUsd: i.minUsd, maxUsd: i.maxUsd } : null;
}

/** does a lot sit inside the stated range? (feed-filters' value anchor; a lot
 *  with no anchor cannot be placed, so a preference never hides it) */
export function inPriceRange(l: Parameters<typeof prioStatic>[0], pref: PricePref | null, nowMs?: number): boolean {
  if (!pref || (pref.minUsd == null && pref.maxUsd == null)) return true;
  const p = prioStatic(l, nowMs);
  if (!p) return true;
  if (pref.minUsd != null && p.a < pref.minUsd) return false;
  if (pref.maxUsd != null && p.a >= pref.maxUsd) return false;
  return true;
}

/** the range in words ("$5K–$50K", "under $1K", "$25K and up") */
export function priceText(pref: PricePref | null): string | null {
  if (!pref) return null;
  const k = (n: number) => (n >= 1000 ? `$${n / 1000}K` : `$${n}`);
  if (pref.minUsd != null && pref.maxUsd != null) return `${k(pref.minUsd)}–${k(pref.maxUsd)}`;
  if (pref.minUsd != null) return `${k(pref.minUsd)} and up`;
  if (pref.maxUsd != null) return `under ${k(pref.maxUsd)}`;
  return null;
}

/** the stored interests, live across tabs and components */
export function useInterests(): Interests {
  const [v, setV] = useState<Interests>(NO_INTERESTS);
  useEffect(() => {
    const sync = () => setV(readInterests());
    sync();
    window.addEventListener(INTERESTS_KEY, sync);
    const onStorage = (e: StorageEvent) => { if (e.key === INTERESTS_KEY) sync(); };
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(INTERESTS_KEY, sync); window.removeEventListener('storage', onStorage); };
  }, []);
  return v;
}

/** the stored price range as a stable object (null = none) */
export function usePricePref(): PricePref | null {
  const i = useInterests();
  const { minUsd, maxUsd } = i;
  return useMemo(() => (minUsd != null || maxUsd != null ? { minUsd, maxUsd } : null), [minUsd, maxUsd]);
}
