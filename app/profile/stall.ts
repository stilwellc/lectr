'use client';
/**
 * NO INFINITE SPINNERS (Oct 11 2026, /profile follow-ups) — every loading
 * state on the desk has a deadline. A fetch that never answers (a stalled
 * connection, a bucket a CDN holds open) must not leave a row saying
 * "Reading…" forever: after the deadline the surface fails soft to what it
 * already has and says so in words.
 */
import { useEffect, useState } from 'react';

/** how long a desk read may take before the page stops waiting on it */
export const READ_DEADLINE_MS = 10_000;

/** `p`, or `fallback` once `ms` pass first (the late value is not lost —
 *  `p` itself still settles for whoever else holds it) */
export function withTimeout<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}

/** true once `active` has held for `ms` without a break (resets when it
 *  drops) — the page's watchdog over a loading state it does not own */
export function useStalled(active: boolean, ms: number = READ_DEADLINE_MS): boolean {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!active) { setStalled(false); return; }
    const t = window.setTimeout(() => setStalled(true), ms);
    return () => window.clearTimeout(t);
  }, [active, ms]);
  return active && stalled;
}
