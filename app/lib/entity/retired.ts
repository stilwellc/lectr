/**
 * entity/retired.ts — the pseudo-maker pages, retired (makers overhaul P2,
 * Oct 10 2026).
 *
 * ARTISTS registers 22 CATEGORIES beside the 32 named makers (graded-cards,
 * autographs, pokemon, space-exploration …) so their lots feed a vertical.
 * Their /makers/<slug> pages printed maker claims ("The maker's record") over
 * a category and duplicated surfaces built for categories. Each one now
 * resolves to the surface that IS that category: a /sub dossier where a drill
 * row exists, the science collection's entity page, else its market feed
 * scoped to the clean taxonomy category (+ sub).
 *
 * ONE map, read by: the generated public/_redirects (scripts/gen-redirects —
 * the 301s on Cloudflare), the /makers/[slug] route (a client replace for any
 * host without _redirects, e.g. next dev), and makerHref() — every link to a
 * maker page goes through it, so nothing links a retired page.
 */
import { MAKER_MARKETS, ARTISTS, type Market } from '../../constants';

const feed = (market: Market, cat: string, sub?: string) =>
  `/${market}?${new URLSearchParams({ cat, ...(sub ? { sub } : {}), tab: 'all' }).toString()}#on-the-block`;
const entity = (id: string) => `/entity?id=${encodeURIComponent(id)}`;

/** retired slug → where it lives now (every non-maker-market ARTISTS slug) */
export const RETIRED_MAKERS: Readonly<Record<string, string>> = {
  // sports — the clean taxonomy category (+ sub) on the sports feed
  'sports-cards': feed('sports', 'sports-cards'),
  'graded-cards': feed('sports', 'sports-cards', 'singles'),
  'unopened-wax': feed('sports', 'sports-cards', 'sealed-wax'),
  'sports-memorabilia': feed('sports', 'sports-memorabilia'),
  memorabilia: feed('sports', 'sports-memorabilia'),
  'game-used': feed('sports', 'sports-memorabilia', 'game-used'),
  autographs: feed('sports', 'sports-memorabilia', 'autographs'),
  'trophies-awards': feed('sports', 'sports-memorabilia', 'trophies'),
  'tickets-passes': feed('sports', 'sports-memorabilia', 'tickets'),
  'type-1-photos': feed('sports', 'sports-memorabilia', 'photographs'),
  'programs-publications': feed('sports', 'sports-memorabilia', 'programs'),
  'equipment-artifacts': feed('sports', 'sports-memorabilia', 'equipment'),
  // tcg + culture — the /sub dossiers the drills already build
  pokemon: '/sub/tcg/pokemon-cards',
  'movie-tv': '/sub/culture/hollywood',
  'music-memorabilia': '/sub/culture/music',
  'entertainment-memorabilia': feed('culture', 'entertainment'),
  'pop-memorabilia': feed('culture', 'entertainment'),
  // science — the collections no subject reader names ARE entities (cs:)
  meteorites: entity('cs:space-science:meteorites'),
  fossils: entity('cs:space-science:fossils'),
  'scientific-instruments': entity('cs:space-science:scientific-instruments'),
  'science-tech': entity('cs:space-science:science-tech'),
  'space-exploration': feed('science', 'space-science'),
};

/** where a retired slug lives now (null: a real maker page) */
export function retiredTarget(slug: string): string | null {
  return Object.prototype.hasOwnProperty.call(RETIRED_MAKERS, slug) ? RETIRED_MAKERS[slug] : null;
}

/** THE link to a maker's page: /makers/<slug>, or the retired slug's home */
export function makerHref(slug: string): string {
  return retiredTarget(slug) ?? `/makers/${slug}`;
}

/** the roster slugs that still have a maker page (art · design · watches) */
export const PAGE_MAKERS: readonly string[] = ARTISTS
  .filter(a => MAKER_MARKETS.has(a.market as Market) && !retiredTarget(a.slug))
  .map(a => a.slug);
