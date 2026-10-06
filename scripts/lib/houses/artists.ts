/**
 * The tracked-maker roster: which maker is crawled at which house, under which
 * house-side id/slug. (resolve-phillips.ts READS this file for Phillips maker ids.)
 *
 * Moved verbatim out of scripts/ray-crawl.ts (house split, Sep 2026).
 */


// ── Artist Configuration ──

export interface ArtistConfig {
  slug: string;
  displayName: string;
  phillips?: { id: string; slug: string };
  sothebys?: string;
  christies?: string;
  wright?: string;
  /** LAMA (lamodern.com) shares the Wright/Rago Laravel group platform, so its
   *  artist slugs match the Wright ones — crawlLama falls back to `wright` when
   *  this is unset. Set explicitly only to override a divergent LAMA slug, or to
   *  `null`-equivalent by omitting the wright slug. Every tracked maker verified
   *  to carry real LAMA depth (Aug 2026 probe: 11–266 lots each). */
  lama?: string;
  bonhams?: string;
  hindman?: string;
}

export const ARTISTS: ArtistConfig[] = [
  {
    slug: 'george-condo',
    displayName: 'George Condo',
    phillips: { id: '10606', slug: 'george-condo' },
    sothebys: 'george-condo',
    christies: 'george-condo',
    wright: 'george-condo',
    bonhams: 'George Condo',
  },
  {
    slug: 'futura-2000',
    displayName: 'Futura 2000',
    phillips: { id: '4001', slug: 'futura-2000' },
    christies: 'futura',
    wright: 'futura-lenny-mcgurr',
    bonhams: 'Futura 2000',
  },
  {
    slug: 'kaws',
    displayName: 'KAWS',
    phillips: { id: '4271', slug: 'kaws' },
    sothebys: 'kaws',
    christies: 'kaws',
    wright: 'kaws-brian-donnelly',
    bonhams: 'KAWS',
  },
  {
    slug: 'george-nakashima',
    displayName: 'George Nakashima',
    phillips: { id: '379', slug: 'george-nakashima' },
    sothebys: 'george-nakashima',
    christies: 'george-nakashima',
    wright: 'george-nakashima',
    bonhams: 'George Nakashima',
  },
  {
    slug: 'charles-eames',
    displayName: 'Charles & Ray Eames',
    phillips: { id: '10514', slug: 'charles-eames-and-ray-eames' },
    wright: 'charles-and-ray-eames',
    bonhams: 'Charles Eames',
  },
  {
    slug: 'andy-warhol',
    displayName: 'Andy Warhol',
    phillips: { id: '10449', slug: 'andy-warhol' },
    sothebys: 'andy-warhol',
    christies: 'andy-warhol',
    wright: 'andy-warhol',
    bonhams: 'Andy Warhol',
  },
  {
    slug: 'tom-sachs',
    displayName: 'Tom Sachs',
    phillips: { id: '7698', slug: 'tom-sachs' },
    sothebys: 'tom-sachs',
    christies: 'tom-sachs',
    wright: 'tom-sachs',
    bonhams: 'Tom Sachs',
  },
  {
    slug: 'barry-mcgee',
    displayName: 'Barry McGee',
    phillips: { id: '3470', slug: 'barry-mcgee' },
    christies: 'barry-mcgee',
    wright: 'barry-mcgee',
    bonhams: 'Barry McGee',
  },
  {
    slug: 'keith-haring',
    displayName: 'Keith Haring',
    phillips: { id: '11032', slug: 'keith-haring' },
    sothebys: 'keith-haring',
    christies: 'keith-haring',
    wright: 'keith-haring',
    bonhams: 'Keith Haring',
  },
  {
    slug: 'peter-saul',
    displayName: 'Peter Saul',
    phillips: { id: '8398', slug: 'peter-saul' },
    christies: 'peter-saul',
    wright: 'peter-saul',
    bonhams: 'Peter Saul',
  },
  {
    slug: 'ed-ruscha',
    displayName: 'Ed Ruscha',
    phillips: { id: '11024', slug: 'ed-ruscha' },
    sothebys: 'ed-ruscha',
    christies: 'ed-ruscha',
    wright: 'ed-ruscha',
    bonhams: 'Ed Ruscha',
  },
  {
    slug: 'r-crumb',
    displayName: 'R. Crumb',
    phillips: { id: '7549', slug: 'robert-crumb' },
    wright: 'robert-crumb',
    bonhams: 'Robert Crumb',
  },
  {
    slug: 'raymond-pettibon',
    displayName: 'Raymond Pettibon',
    phillips: { id: '10831', slug: 'raymond-pettibon' },
    sothebys: 'raymond-pettibon',
    christies: 'raymond-pettibon',
    wright: 'raymond-pettibon',
    bonhams: 'Raymond Pettibon',
  },
  {
    slug: 'henri-matisse',
    displayName: 'Henri Matisse',
    phillips: { id: '10638', slug: 'henri-matisse' },
    sothebys: 'henri-matisse',
    christies: 'henri-matisse',
    wright: 'henri-matisse',
    bonhams: 'Henri Matisse',
  },
  {
    slug: 'pablo-picasso',
    displayName: 'Pablo Picasso',
    phillips: { id: '10800', slug: 'pablo-picasso' },
    sothebys: 'pablo-picasso',
    christies: 'pablo-picasso',
    wright: 'pablo-picasso',
    bonhams: 'Pablo Picasso',
  },
  {
    slug: 'fab-5-freddy',
    displayName: 'Fab 5 Freddy',
    phillips: { id: '10358', slug: 'fred-brathwaite-aka-fab-5-freddy' },
    bonhams: 'Fab 5 Freddy',
  },
  {
    slug: 'francesco-clemente',
    displayName: 'Francesco Clemente',
    phillips: { id: '8171', slug: 'francesco-clemente' },
    christies: 'francesco-clemente',
    wright: 'francesco-clemente',
    bonhams: 'Francesco Clemente',
  },
  {
    slug: 'jean-prouve',
    displayName: 'Jean Prouvé',
    phillips: { id: '5611', slug: 'jean-prouve' },
    christies: 'jean-prouve',
    wright: 'jean-prouve',
    bonhams: 'Jean Prouvé',
  },
  {
    slug: 'pierre-jeanneret',
    displayName: 'Pierre Jeanneret',
    phillips: { id: '7134', slug: 'pierre-jeanneret' },
    christies: 'pierre-jeanneret',
    wright: 'pierre-jeanneret',
    bonhams: 'Pierre Jeanneret',
  },
  {
    slug: 'eddie-martinez',
    displayName: 'Eddie Martinez',
    phillips: { id: '7287', slug: 'eddie-martinez' },
    sothebys: 'eddie-martinez',
    christies: 'eddie-martinez',
    bonhams: 'Eddie Martinez',
  },
  {
    slug: 'kenny-scharf',
    displayName: 'Kenny Scharf',
    phillips: { id: '1306', slug: 'kenny-scharf' },
    sothebys: 'kenny-scharf',
    christies: 'kenny-scharf',
    wright: 'kenny-scharf',
    bonhams: 'Kenny Scharf',
  },
  // ── blue-chip modern/contemporary added Aug 2026. Sotheby's/Christie's lots
  // arrive via the auction crawlers + ART_MAKER_ROUTES (the per-artist page
  // path is flaky); Bonhams via Typesense name search; Wright/LAMA via slug
  // (sparse for these art names but harmless). Phillips maker ids (Oct 6
  // 2026) read from the phillips.com/artist/<id>/<slug> URLs and checked
  // against api.phillips.com/api/maker/<id>/lots (the search API errors).
  { slug: 'jean-michel-basquiat', displayName: 'Jean-Michel Basquiat', sothebys: 'jean-michel-basquiat', christies: 'jean-michel-basquiat', wright: 'jean-michel-basquiat', bonhams: 'Jean-Michel Basquiat', phillips: { id: '11029', slug: 'jean-michel-basquiat' } },
  { slug: 'roy-lichtenstein', displayName: 'Roy Lichtenstein', sothebys: 'roy-lichtenstein', christies: 'roy-lichtenstein', wright: 'roy-lichtenstein', bonhams: 'Roy Lichtenstein', phillips: { id: '10858', slug: 'roy-lichtenstein' } },
  { slug: 'francis-bacon', displayName: 'Francis Bacon', sothebys: 'francis-bacon', christies: 'francis-bacon', wright: 'francis-bacon', bonhams: 'Francis Bacon', phillips: { id: '9823', slug: 'francis-bacon' } },
  { slug: 'alexander-calder', displayName: 'Alexander Calder', sothebys: 'alexander-calder', christies: 'alexander-calder', wright: 'alexander-calder', bonhams: 'Alexander Calder', phillips: { id: '11020', slug: 'alexander-calder' } },
  { slug: 'rashid-johnson', displayName: 'Rashid Johnson', sothebys: 'rashid-johnson', christies: 'rashid-johnson', wright: 'rashid-johnson', bonhams: 'Rashid Johnson', phillips: { id: '4718', slug: 'rashid-johnson' } },
  { slug: 'jeff-koons', displayName: 'Jeff Koons', sothebys: 'jeff-koons', christies: 'jeff-koons', wright: 'jeff-koons', bonhams: 'Jeff Koons', phillips: { id: '11031', slug: 'jeff-koons' } },

  // ── The watches vertical: makers, not artists. Phillips (the watch house)
  // maker pages + Christie's maker pages + Bonhams keyword search.
  // Wright/Rago don't trade watches — deliberately absent.
  // christies omitted — crawlChristiesAuctions pulls full curated watch sales
  // (the maker/search page only gave 50 lots and would double-count).
  { slug: 'rolex', displayName: 'Rolex', phillips: { id: '5830', slug: 'rolex' }, bonhams: 'Rolex wristwatch' },
  { slug: 'patek-philippe', displayName: 'Patek Philippe', phillips: { id: '12634', slug: 'patek-philippe' }, bonhams: 'Patek Philippe' },
  { slug: 'audemars-piguet', displayName: 'Audemars Piguet', phillips: { id: '10464', slug: 'audemars-piguet' }, bonhams: 'Audemars Piguet' },
  { slug: 'omega', displayName: 'Omega', phillips: { id: '10364', slug: 'omega' }, bonhams: 'Omega wristwatch' },
  { slug: 'cartier', displayName: 'Cartier', phillips: { id: '4810', slug: 'cartier' }, bonhams: 'Cartier' },

  // ── The science vertical: Sotheby's curated Geek Week sales only (natural
  // history, space exploration, history of science & technology). No Bonhams
  // keyword dredging — that pulled thousands of junk fragments. These slugs
  // carry no house config; crawlSothebysAuctions populates them by routing
  // each lot's text. Rago would never have science.
  { slug: 'meteorites', displayName: 'Meteorites' },
  { slug: 'fossils', displayName: 'Fossils & Dinosaurs' },
  { slug: 'space-exploration', displayName: 'Space Exploration' },
  { slug: 'scientific-instruments', displayName: 'Scientific Instruments' },

  // ── The sports vertical: Goldin only, and ONLY the real objects —
  // game-used, trophies & awards, tickets & passes. NEVER cards.
  { slug: 'game-used', displayName: 'Game Worn & Used' },
  { slug: 'trophies-awards', displayName: 'Trophies & Awards' },
  { slug: 'tickets-passes', displayName: 'Tickets & Passes' },
];
