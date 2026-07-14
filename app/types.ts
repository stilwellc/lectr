export type AuctionHouse = 'Phillips' | "Sotheby's" | "Christie's" | 'Wright' | 'Rago' | 'Heritage' | 'Bonhams' | 'Hindman' | 'Goldin';
export type LotStatus = 'upcoming' | 'sold' | 'bought_in' | 'withdrawn';
export type Currency = 'USD' | 'GBP' | 'EUR' | 'HKD' | 'CNY' | 'AUD' | 'CHF';
export type LotCategory = 'original' | 'print' | 'photograph' | 'sculpture' | 'design' | 'object' | 'unknown';
/** how a sold price was established: a verified hammer, or the last bid Ray
    tracked before a house that publishes no results closed (Goldin) */
export type PriceBasis = 'hammer' | 'last-tracked-bid' | 'goldin-final-bid';

/** The kind of sports/science object a Goldin sold lot is — stamped at crawl
    time on category 'object' lots whose slug is in the sports/science set.
    Short key, undefined on every non-Goldin-sports/science lot. */
export type ObjectType = 'jersey' | 'sneakers' | 'bat' | 'ball' | 'glove' | 'helmet' | 'cap' | 'pants' | 'puck' | 'belt' | 'ring' | 'ticket' | 'trophy' | 'other';

/** A descriptive realized-price band for a sports/science object, drawn from
    same-slug sold comps. Carries NO directional label and NO percent — by type
    it can never render a below/above-market CALL (Goldin publishes no
    estimates; realized prices are mix-noise and must not be sold as a call). */
export interface SoldComp {
  /** the form label key (FORM_LABEL[form]) — e.g. 'sports-jersey' */
  form: string;
  /** the comp pool that produced the band */
  pool: AuctionLot[];
  median: number;
  low: number;
  high: number;
  n: number;
  confidence: 'high' | 'medium' | 'low';
}

/** One quarter of a realized-cohort demand series: the median realized price
    within a tight like-for-like cohort (single object-slug + price band).
    Typed distinctly from DemandPoint so a `$` median can never sit in a
    `%-over-estimate` field. */
export interface RealizedPoint {
  date: string;
  value: number;
  n: number;
}

export interface AuctionLot {
  id: string;
  artist: string;
  title: string;
  year: string | null;
  medium: string | null;
  dimensions: string | null;
  category: LotCategory;
  imageUrl: string | null;
  auctionHouse: AuctionHouse;
  saleName: string;
  saleDate: string;
  lotNumber: number | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  currency: Currency;
  hammerPrice: number | null;
  premiumPrice: number | null;
  priceUsd: number | null;
  priceBasis?: PriceBasis;
  /** live bid on a no-estimate bid auction (Goldin) — real money on the lot now */
  currentBid?: number;
  bidCount?: number;
  /** buyer's premium % (Goldin) — carried so the last-tracked bid can be
      promoted to a hammer + premium when the lot's auction completes */
  buyerPremium?: number;
  /** the source auction's id (Goldin) — lets us detect completion: Goldin
      purges a lot from its live index the moment its auction closes, so the
      only sold signal is the auction flipping to status 'Completed' */
  auctionId?: string;
  status: LotStatus;
  url: string;
  /** Precomputed at crawl time for upcoming lots (comps median vs estimate
      midpoint) so the feed can paint before the full history downloads.
      undefined = not precomputed (compute client-side from allLots). */
  signal?: { label: 'Below Market' | 'Above Market'; pct: number; basis?: number; kind?: 'edition' | 'form'; form?: string; confidence?: 'very-high' | 'high' | 'medium' | 'low' } | null;
  /** ISO date (YYYY-MM-DD) the crawler first saw this lot id. Stamped once at
      merge time on genuinely-new ids and carried forward on every later crawl.
      Lots that predate the stamp never get one (they weren't "new" when the
      feature shipped) — UI reads this defensively; it may be undefined. */
  firstSeen?: string;
  /** Coarse object class for the watch-maker ambiguity (a Cartier Panthère
      ring is jewelry even though Panthère is a watch line): 'watch' |
      'jewelry' | 'object'. Derived from classifyForm at crawl time on
      category 'object' lots — see objectClassOf in app/lib/comps.ts.
      Undefined on non-object lots and on pre-tag archive records. */
  objectClass?: string;
  /** Crawl-time sports/science tags — stamped only on category 'object' Goldin
      lots in the sports/science set (via extractSportsTags in comps.ts), else
      undefined. Short keys to keep the sold-archive footprint minimal. */
  entity?: string;
  objectType?: ObjectType;
  eventKey?: string;
  sportYear?: number;
  /** Precomputed realized-comp band for upcoming Goldin sports/science lots
      (the descriptive analogue of `signal`, built from soldCompBand). null on
      every non-sports/science-object lot; undefined = not precomputed. Carries
      no label and no pct — it can never render a directional call. */
  soldComp?: { median: number; high: number; low: number; n: number; confidence: string; form: string } | null;
}

export interface PricePoint {
  date: string;
  avgPrice: number;
  medianPrice: number;
  totalSales: number;
  highPrice: number;
}

export interface HouseCount {
  house: AuctionHouse;
  count: number;
  totalValue: number;
}

export interface MarketStats {
  lastUpdated: string;
  totalLotsTracked: number;
  avgPriceLast12Months: number;
  medianPriceLast12Months: number;
  recordPrice: number;
  recordTitle: string;
  recordDate: string;
  recordHouse: AuctionHouse;
  appreciationRate: number;
  totalAuctionRevenue: number;
  priceHistory: PricePoint[];
  houseDistribution: HouseCount[];
}
