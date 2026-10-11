'use client';

import { usePathname } from 'next/navigation';

/**
 * Phase-1 data preloads — on every route that reads the live book
 * (useRayData). Rendered from the root layout; usePathname resolves at
 * prerender time, so each exported page's <head> carries them or not.
 *
 * They used to be unconditional, which made /about and every /blog post
 * (static pages whose figures are baked in at build time) download and parse
 * the whole ~1.7 MB live book for a ⌘K palette nobody opened (perf wave W1,
 * Oct 11 2026). The palette now loads the book when it opens
 * (CommandK → useRayDataWhen). Unknown routes default to preloading.
 *
 * crossOrigin="anonymous" matches fetch()'s default cors/same-origin
 * credentials mode so the browser reuses the preload (no double fetch).
 * ALL FIVE are preloaded because useRayData awaits them in a single
 * Promise.allSettled — first paint gates on the SLOWEST of the set, so
 * preloading a subset just makes the unlisted ones start late and become the
 * gate. meta.json versions the phase-2 shard URLs.
 */
export const RAY_PRELOADS = [
  '/data/ray/upcoming.json',
  '/data/ray/market.json',
  '/data/ray/stats.json',
  '/data/ray/meta.json',
  '/data/ray/backtest.json',
] as const;

/** routes that never read the live book (static, build-time figures) */
const NO_DATA = /^\/(about|blog|styleguide)(\/|$)/;

export function routeReadsLiveBook(pathname: string | null | undefined): boolean {
  return !NO_DATA.test(pathname || '/');
}

export default function RayDataPreloads() {
  const pathname = usePathname();
  if (!routeReadsLiveBook(pathname)) return null;
  return (
    <>
      {RAY_PRELOADS.map(href => (
        <link key={href} rel="preload" href={href} as="fetch" crossOrigin="anonymous" />
      ))}
    </>
  );
}
