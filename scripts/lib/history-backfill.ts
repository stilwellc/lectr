/**
 * Pure helpers for the Sotheby's / Wright history backfill
 * (.github/workflows/backfill-history.yml → scripts/backfill-history.ts).
 *
 * Same contract as the Phillips backfill (lib/phillips-backfill.ts, whose
 * unionPreserving this reuses): the crawl is the nightly's own ray-crawl.ts
 * path scoped by RAY_HOUSE + RAY_ONLY and deepened by a backfill-only env
 * (SOTHEBYS_HISTORY=1 / WRIGHT_DEEP=1), and the result is unioned back over
 * the pre-crawl snapshot — fresh id wins, nothing evicted.
 */
import type { ArtistConfig } from './houses/artists';
import { SOTHEBYS_WATCH_SLUGS, sothebysHistoryMakers } from './houses/sothebys-history';

export type HistoryHouse = 'sothebys' | 'wright';
export const HISTORY_HOUSES: readonly HistoryHouse[] = ['sothebys', 'wright'];

/** The roster entries a house's history pass can serve. */
export function historyEligible(house: HistoryHouse, artists: readonly ArtistConfig[]): ArtistConfig[] {
  if (house === 'wright') return artists.filter(a => !!a.wright);
  return sothebysHistoryMakers(artists);
}

/**
 * Maker selector → RAY_ONLY slugs for `house`.
 *   'art' (every eligible non-watch maker) · 'watches' (Sotheby's only) · 'all'
 *   · or a comma list of roster slugs.
 * Throws on an unknown house, an unknown slug, or a slug the house cannot
 * serve — a typo must fail the dispatch, never crawl nothing.
 */
export function resolveHistoryMakers(house: string, spec: string, artists: readonly ArtistConfig[]): string[] {
  if (!(HISTORY_HOUSES as readonly string[]).includes(house)) throw new Error(`unknown house '${house}' (sothebys | wright)`);
  const h = house as HistoryHouse;
  const ok = historyEligible(h, artists);
  const isWatch = (slug: string) => SOTHEBYS_WATCH_SLUGS.includes(slug);
  const s = spec.trim().toLowerCase();
  if (!s) throw new Error('empty maker selector');
  if (s === 'all') return ok.map(a => a.slug);
  if (s === 'art') return ok.filter(a => !isWatch(a.slug)).map(a => a.slug);
  if (s === 'watches') {
    const w = ok.filter(a => isWatch(a.slug)).map(a => a.slug);
    if (!w.length) throw new Error(`'watches' selects nothing for ${house}`);
    return w;
  }
  const want = s.split(',').map(x => x.trim()).filter(Boolean);
  if (!want.length) throw new Error(`bad maker selector '${spec}'`);
  const bad: string[] = [];
  for (const slug of want) {
    if (!/^[a-z0-9-]+$/.test(slug)) bad.push(`${slug} (not a slug)`);
    else if (!artists.some(a => a.slug === slug)) bad.push(`${slug} (not in the roster)`);
    else if (!ok.some(a => a.slug === slug)) bad.push(`${slug} (no ${house} history)`);
  }
  if (bad.length) throw new Error(`bad maker(s): ${bad.join(', ')}`);
  return Array.from(new Set(want));
}

type Row = Record<string, unknown>;

export interface HouseCounts { rows: number; sold: number; byHouse: Record<string, number>; soldByYear: Record<string, number> }

/** rows / sold / per-auctionHouse / sold-per-year, optionally for a maker set. */
export function historyCounts(rows: readonly Row[], slugs?: ReadonlySet<string>): HouseCounts {
  const c: HouseCounts = { rows: 0, sold: 0, byHouse: {}, soldByYear: {} };
  for (const r of rows) {
    if (slugs && !slugs.has(String(r.artist ?? ''))) continue;
    c.rows++;
    const h = String(r.auctionHouse ?? '?');
    c.byHouse[h] = (c.byHouse[h] || 0) + 1;
    if (r.status === 'sold') {
      c.sold++;
      const y = String(r.saleDate ?? '').slice(0, 4) || '?';
      c.soldByYear[y] = (c.soldByYear[y] || 0) + 1;
    }
  }
  return c;
}
