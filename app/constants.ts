/**
 * The roster and the markets. Every artist belongs to a MARKET — the way the
 * trade actually splits (design sales vs contemporary art sales), so a
 * Nakashima bench never muddies the art demand index and vice versa.
 * Every vertical is live; the `live` flag stays so a future vertical can be
 * announced before it trades. 'all' is the whole collectibles market — the
 * lander's default until a vertical is chosen.
 */
export type Market = 'all' | 'art' | 'design' | 'watches' | 'sports' | 'science' | 'culture';

export const MARKETS: { key: Market; label: string; live: boolean; tagline: string }[] = [
  { key: 'all', label: 'Total market', live: true, tagline: 'every vertical, one tape' },
  { key: 'art', label: 'Art', live: true, tagline: 'paintings, editions, photography & sculpture' },
  { key: 'design', label: 'Design', live: true, tagline: 'the furniture & objects market' },
  { key: 'watches', label: 'Watches', live: true, tagline: 'the reference market' },
  { key: 'sports', label: 'Sports', live: true, tagline: 'cards, game-worn, trophies & tickets' },
  { key: 'science', label: 'Science', live: true, tagline: 'tech, fossils, space & instruments' },
  { key: 'culture', label: 'Pop Culture', live: true, tagline: 'screen-worn, stage-played & the unrepeatable' },
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
  { slug: 'science-tech', label: 'Science & Technology', market: 'science' },
  // the sports vertical: Goldin cards + objects, plus Sotheby's/Christie's
  // sports-sale memorabilia (the catch-all: autographs, photos, equipment,
  // pennants — everything in a sports sale that isn't specifically the above)
  { slug: 'sports-cards', label: 'Sports Cards', market: 'sports' },
  { slug: 'game-used', label: 'Game Worn & Used', market: 'sports' },
  { slug: 'trophies-awards', label: 'Trophies & Awards', market: 'sports' },
  { slug: 'tickets-passes', label: 'Tickets & Passes', market: 'sports' },
  { slug: 'sports-memorabilia', label: 'Sports Memorabilia', market: 'sports' },
  // the pop-culture vertical: high-end 1/1 cultural artifacts, never mass
  // (no comics/cards/video games) — screen-used film & TV, stage-worn music,
  // handwritten lyrics, and the iconic entertainment/historic catch-all
  { slug: 'movie-tv', label: 'Film & TV', market: 'culture' },
  { slug: 'music-memorabilia', label: 'Music', market: 'culture' },
  { slug: 'entertainment-memorabilia', label: 'Entertainment & Icons', market: 'culture' },
] as const;

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

/** What the tracked entries in a market ARE — they aren't all artists. */
export function rosterNoun(market: Market, n = 2): string {
  const plural = n !== 1;
  switch (market) {
    case 'art': return plural ? 'artists' : 'artist';
    case 'design': return plural ? 'designers' : 'designer';
    case 'watches': return plural ? 'makers' : 'maker';
    case 'science': return plural ? 'collections' : 'collection';
    case 'sports': return plural ? 'categories' : 'category';
    case 'culture': return plural ? 'categories' : 'category';
    default: return 'tracked';
  }
}

export function marketOf(slug: string): Market {
  return ARTIST_MARKET[slug] || 'art';
}
