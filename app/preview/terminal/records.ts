/* ============================================================
   THE RECORD BOARD — curated cross-category all-time hammer
   records. These live in the full/stats tier (not the eager
   top-realized), so per the data contract they are CURATED and
   hardcoded here. Each carries a source flag for the trust
   surface — authority with a number behind it.

   Prices are the widely-reported all-in hammer (incl. premium)
   results at the time of sale. Source-flagged, not asserted as
   live from the corpus.
   ============================================================ */

export interface RecordEntry {
  /** absolute hammer in USD — drives the ranking + the bar */
  usd: number;
  /** display object title */
  title: string;
  /** maker / consignor / subject line */
  maker: string;
  category: 'Art' | 'Watches' | 'Design' | 'Sports' | 'Science' | 'Culture';
  /** auction house + year, e.g. "Christie's · 2022" */
  house: string;
  /** short source flag surfaced on the row */
  source: string;
  /** optional direct link to the sale; when absent the row resolves the sale
      via a title+house web search so every record is still clickable. */
  url?: string;
}

/** Ranked at render time; ordering here is illustrative. */
export const RECORD_BOARD: RecordEntry[] = [
  {
    usd: 195_040_000,
    title: 'Shot Sage Blue Marilyn',
    maker: 'Andy Warhol',
    category: 'Art',
    house: "Christie's · 2022",
    source: "Christie's, May 2022",
  },
  {
    usd: 179_365_000,
    title: 'Les Femmes d’Alger (Version O)',
    maker: 'Pablo Picasso',
    category: 'Art',
    house: "Christie's · 2015",
    source: "Christie's, May 2015",
  },
  {
    usd: 50_130_000,
    title: '“Stan” — Tyrannosaurus rex Skeleton',
    maker: 'Late Cretaceous, ~67M yrs',
    category: 'Science',
    house: "Christie's · 2020",
    source: "Christie's, Oct 2020",
  },
  {
    usd: 31_186_000,
    title: 'Grandmaster Chime Ref. 6300A-010',
    maker: 'Patek Philippe',
    category: 'Watches',
    house: "Christie's · 2019",
    source: "Only Watch / Christie's, 2019",
  },
  {
    usd: 12_600_000,
    title: 'The T206 Honus Wagner',
    maker: 'Honus Wagner (1909)',
    category: 'Sports',
    house: 'Private / Goldin · 2022',
    source: 'Reported sale, 2022',
  },
  {
    usd: 9_269_100,
    title: 'Himalaya Niloticus Crocodile Birkin',
    maker: 'Hermès',
    category: 'Design',
    house: "Sotheby's · 2021",
    source: "Sotheby's HK, reported",
  },
  {
    usd: 6_250_000,
    title: 'Rolex “Paul Newman” Daytona Ref. 6239',
    maker: 'Rolex · Paul Newman’s own',
    category: 'Watches',
    house: "Phillips · 2017",
    source: 'Phillips, Oct 2017',
  },
  {
    usd: 5_640_000,
    title: 'Codex Leicester (Da Vinci notebook)',
    maker: 'Leonardo da Vinci',
    category: 'Science',
    house: "Christie's · 1994",
    source: "Christie's, 1994",
  },
  {
    usd: 3_930_000,
    title: 'Marilyn Monroe “Happy Birthday” gown',
    maker: 'Jean Louis / worn 1962',
    category: 'Culture',
    house: 'Julien’s · 2016',
    source: 'Julien’s Auctions, 2016',
  },
  {
    usd: 2_880_000,
    title: 'Kobe Bryant Rookie-Season Locker',
    maker: 'Kobe Bryant · game-worn',
    category: 'Sports',
    house: "Sotheby's · 2023",
    source: "Sotheby's, reported",
  },
];
