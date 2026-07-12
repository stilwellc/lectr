/**
 * The roster and the markets. Every artist belongs to a MARKET — the way the
 * trade actually splits (design sales vs contemporary art sales), so a
 * Nakashima bench never muddies the art demand index and vice versa.
 * Watches, Sports and Science are announced but not yet live. 'all' is the
 * whole collectibles market — the lander's default until a vertical is chosen.
 */
export type Market = 'all' | 'art' | 'design' | 'watches' | 'sports' | 'science';

export const MARKETS: { key: Market; label: string; live: boolean; tagline: string }[] = [
  { key: 'all', label: 'Total market', live: true, tagline: 'every vertical, one tape' },
  { key: 'art', label: 'Art', live: true, tagline: 'paintings, editions, photography & sculpture' },
  { key: 'design', label: 'Design', live: true, tagline: 'the furniture & objects market' },
  { key: 'watches', label: 'Watches', live: true, tagline: 'the reference market' },
  { key: 'sports', label: 'Sports', live: false, tagline: 'cards, jerseys & memorabilia' },
  { key: 'science', label: 'Science', live: true, tagline: 'tech, fossils, space & instruments' },
];

export const ARTISTS = [
  { slug: 'george-condo', label: 'George Condo', market: 'art' },
  { slug: 'futura-2000', label: 'Futura 2000', market: 'art' },
  { slug: 'kaws', label: 'KAWS', market: 'art' },
  { slug: 'george-nakashima', label: 'George Nakashima', market: 'design' },
  { slug: 'charles-eames', label: 'Charles & Ray Eames', market: 'design' },
  { slug: 'andy-warhol', label: 'Andy Warhol', market: 'art' },
  { slug: 'tom-sachs', label: 'Tom Sachs', market: 'art' },
  { slug: 'barry-mcgee', label: 'Barry McGee', market: 'art' },
  { slug: 'keith-haring', label: 'Keith Haring', market: 'art' },
  { slug: 'peter-saul', label: 'Peter Saul', market: 'art' },
  { slug: 'ed-ruscha', label: 'Ed Ruscha', market: 'art' },
  { slug: 'r-crumb', label: 'R. Crumb', market: 'art' },
  { slug: 'raymond-pettibon', label: 'Raymond Pettibon', market: 'art' },
  { slug: 'henri-matisse', label: 'Henri Matisse', market: 'art' },
  { slug: 'pablo-picasso', label: 'Pablo Picasso', market: 'art' },
  { slug: 'fab-5-freddy', label: 'Fab 5 Freddy', market: 'art' },
  { slug: 'francesco-clemente', label: 'Francesco Clemente', market: 'art' },
  { slug: 'jean-prouve', label: 'Jean Prouvé', market: 'design' },
  { slug: 'pierre-jeanneret', label: 'Pierre Jeanneret', market: 'design' },
  { slug: 'eddie-martinez', label: 'Eddie Martinez', market: 'art' },
  { slug: 'kenny-scharf', label: 'Kenny Scharf', market: 'art' },
  // the watches vertical: makers, not artists
  { slug: 'rolex', label: 'Rolex', market: 'watches' },
  { slug: 'patek-philippe', label: 'Patek Philippe', market: 'watches' },
  { slug: 'audemars-piguet', label: 'Audemars Piguet', market: 'watches' },
  { slug: 'omega', label: 'Omega', market: 'watches' },
  { slug: 'cartier', label: 'Cartier', market: 'watches' },
  // the science vertical: collections — tech, fossils, space, instruments
  { slug: 'meteorites', label: 'Meteorites', market: 'science' },
  { slug: 'fossils', label: 'Fossils & Dinosaurs', market: 'science' },
  { slug: 'space-exploration', label: 'Space Exploration', market: 'science' },
  { slug: 'scientific-instruments', label: 'Scientific Instruments', market: 'science' },
] as const;

export type ArtistSlug = (typeof ARTISTS)[number]['slug'];

export const ARTIST_LABEL: Record<string, string> = Object.fromEntries(
  ARTISTS.map(a => [a.slug, a.label])
);

export const ARTIST_MARKET: Record<string, Market> = Object.fromEntries(
  ARTISTS.map(a => [a.slug, a.market as Market])
);

export function marketArtists(market: Market): Set<string> {
  if (market === 'all') return new Set(ARTISTS.map(a => a.slug));
  return new Set(ARTISTS.filter(a => a.market === market).map(a => a.slug));
}

export function marketOf(slug: string): Market {
  return ARTIST_MARKET[slug] || 'art';
}
