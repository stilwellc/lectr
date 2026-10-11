'use client';

/**
 * The book's totals, from ONE place.
 *
 * Before this existed the same number came from five paths — a runtime fetch in
 * useRayData, a second private fetch in the colophon, a build-time
 * `import meta from 'meta.json'` on /about and the engine post, a client-side
 * sum of the loaded shard, and a hardcoded literal in the styleguide. They
 * agreed on the day of a deploy and drifted after it, so a reader moving from
 * /value to /analytics to /makers saw 1,119,120 → 1,127,410 → 1,130,050 in one
 * session. For a product whose pitch is that every number is graded, that is
 * the worst possible bug.
 *
 * Rule from here: nothing renders a corpus total except through this module.
 * Baked values may still ship in the HTML as the pre-hydration face (so a
 * scrape or a no-JS read sees a real number), but they must be passed as
 * `fallback` and be corrected on mount.
 */

import { useEffect, useState } from 'react';

export interface BookTotals {
  totalLots: number;
  totalSold: number;
  sources: number;
  lastCrawl: string;
}

let cache: BookTotals | null = null;
// the in-flight promise is cached too: several consumers mounting in the same
// tick (or StrictMode's double effect) must not each fire a request
let inflight: Promise<BookTotals | null> | null = null;

export function bookTotalsCache(): BookTotals | null {
  return cache;
}

const subscribers = new Set<(t: BookTotals) => void>();

function totalsOf(j: { totalLots?: number; totalSold?: number; sources?: unknown; lastCrawl?: string }): BookTotals {
  return {
    totalLots: j.totalLots || 0,
    totalSold: j.totalSold || 0,
    sources: Array.isArray(j.sources) ? j.sources.length : 0,
    lastCrawl: j.lastCrawl || '',
  };
}

/** A new deploy's book went on screen in place (W25, useRayData
 *  prepareNewBook): its meta.json replaces the totals for every mounted
 *  reader in the same tick, so the colophon never dates the old book. */
export function replaceBookTotals(meta: { totalLots?: number; totalSold?: number; sources?: unknown; lastCrawl?: string }): void {
  cache = totalsOf(meta);
  inflight = Promise.resolve(cache);
  const t = cache;
  subscribers.forEach(fn => fn(t));
}

export function fetchBookTotals(): Promise<BookTotals | null> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch('/data/ray/meta.json')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!j) return null;
        cache = totalsOf(j);
        return cache;
      })
      .catch(() => null /* callers fall back to whatever shipped in the HTML */);
  }
  return inflight;
}

/** The live totals, or null until the fetch lands. One request per session. */
export function useBookTotals(skip = false): BookTotals | null {
  const [totals, setTotals] = useState<BookTotals | null>(cache);
  useEffect(() => {
    let dead = false;
    const on = (t: BookTotals) => { if (!dead) setTotals(t); };
    subscribers.add(on);
    // totals replaced between render and subscribe still reach us
    if (cache) { const c = cache; if (c !== totals) Promise.resolve().then(() => on(c)); }
    else if (!skip) fetchBookTotals().then(t => { if (t) on(t); });
    return () => {
      dead = true;
      subscribers.delete(on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);
  return totals;
}
