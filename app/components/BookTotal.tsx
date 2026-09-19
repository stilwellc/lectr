'use client';

/**
 * A corpus figure that corrects itself.
 *
 * Server pages (/about, the engine post) used to print `meta.totalLots` from a
 * build-time import, so they froze at the deploy's vintage and disagreed with
 * the colophon three inches below them. This renders the baked number first —
 * so the HTML a scraper or a JS-disabled reader gets is still a real figure —
 * then swaps to the live one from meta.json on mount.
 */

import { useBookTotals } from '../lib/book';

type Field = 'lots' | 'sold' | 'sources';

export default function BookTotal({
  fallback,
  field = 'lots',
  format = true,
}: {
  /** the build-time value, shipped in the HTML as the pre-hydration face */
  fallback: number;
  field?: Field;
  format?: boolean;
}) {
  const totals = useBookTotals();
  const live = totals
    ? field === 'lots'
      ? totals.totalLots
      : field === 'sold'
        ? totals.totalSold
        : totals.sources
    : null;
  const n = live || fallback;
  return <>{format ? n.toLocaleString() : String(n)}</>;
}
