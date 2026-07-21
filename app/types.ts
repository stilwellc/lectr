export type AuctionHouse = 'Phillips' | "Sotheby's" | "Christie's" | 'Wright' | 'Rago' | 'Heritage' | 'Bonhams' | 'Hindman' | 'Goldin';
/** 'withdrawn'/'unknown-result' are actively used post-migration for vanished
    or unreconciled non-Goldin lots (see §1d + W11). */
export type LotStatus = 'upcoming' | 'sold' | 'bought_in' | 'withdrawn' | 'unknown-result';
export type Currency = 'USD' | 'GBP' | 'EUR' | 'HKD' | 'CNY' | 'AUD' | 'CHF';
export type LotCategory = 'original' | 'print' | 'photograph' | 'sculpture' | 'design' | 'object' | 'unknown';
/** How a sold price was established. v2 expands the union while KEEPING the old
    values ('hammer' | 'last-tracked-bid' | 'goldin-final-bid') so pre-migration
    rows still typecheck and the load-bearing engine keeps reading them:
      'realized'          hammer + buyer's premium (Bonhams/Wright/Rago/Christie's/Sotheby's)
      'hammer-only'       the number is the winning bid, no premium (some Phillips)
      'final-bid-plus-bp' Goldin: last tracked live bid grossed by its BP schedule
      'last-tracked-bid'  a tracked bid with no premium applied (legacy)
      'hammer'            legacy verified-hammer tag (kept as alias of 'hammer-only')
      'goldin-final-bid'  legacy Goldin tag (kept as alias of 'final-bid-plus-bp') */
export type PriceBasis =
  | 'realized' | 'hammer-only' | 'final-bid-plus-bp' | 'last-tracked-bid'
  | 'hammer' | 'goldin-final-bid';

/** Is a routing slug a real maker (picasso, rolex) or a collectible bucket
    (game-used, tickets-passes, fossils)? See classifyEntity in normalize.ts. */
export type EntityClass = 'maker' | 'category';
/** Coarse size bucket by max linear dimension (cheap pre-filter). */
export type SizeClass = 'small' | 'medium' | 'large' | 'monumental';
/** Whether canonical cm came from a native metric group or imperial×2.54. */
export type DimSource = 'metric' | 'imperial-converted';
/** Non-numbered proof designation on an art/print edition. */
export type EditionMarker = 'AP' | 'HC' | 'EA' | 'PP' | 'unique';
/** Where a canonical year came from — field is trusted over title. */
export type YearSource = 'field' | 'title';

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

  // ─────────────────────────────────────────────────────────────────────────
  // v2 MONEY BLOCK — native is the FACT, USD is a DERIVED view via a dated rate.
  // Every field is OPTIONAL so pre-migration rows still typecheck. On a MIGRATED
  // row the old fields below (currency/hammerPrice/premiumPrice/priceUsd/
  // estimateLow/estimateHigh) become ALIASES of these canonical fields.
  // ─────────────────────────────────────────────────────────────────────────
  /** the REAL transaction currency — never blanket-forced to 'USD' */
  nativeCurrency?: Currency;
  /** winning bid in nativeCurrency; null when only a premium-inclusive number is published */
  hammerNative?: number | null;
  /** buyer-paid realized (hammer + BP) in nativeCurrency */
  premiumNative?: number | null;
  /** realized price recorded = premiumNative ?? hammerNative; null unless sold */
  realizedNative?: number | null;
  /** buyer's premium % applied (e.g. 22) — grosses hammer→realized like-for-like */
  buyerPremiumPct?: number | null;
  /** nativeCurrency→USD rate used for THIS row (1.0 for USD) */
  fxRate?: number;
  /** the date the rate is quoted for (YYYY-MM-DD) — equals saleDate's day/month/year */
  fxAsOf?: string;
  /** hammerNative × fxRate */
  hammerUsd?: number | null;
  /** premiumNative × fxRate */
  premiumUsd?: number | null;
  /** realizedNative × fxRate — the ONLY price field downstream value math reads; null unless sold */
  realizedUsd?: number | null;
  /** estimate band in nativeCurrency — canonical single unit for ALL houses */
  estLowNative?: number | null;
  estHighNative?: number | null;
  /** est*Native × fxRate — the denominator demand.ts/comps.ts divide against */
  estLowUsd?: number | null;
  estHighUsd?: number | null;
  /** set when a USD-path estimate had its native currency back-derived (§1b) */
  fxRecovered?: boolean;

  // ── OLD money fields, retained as optional ALIASES during migration ──
  estimateLow: number | null;
  estimateHigh: number | null;
  currency: Currency;
  hammerPrice: number | null;
  premiumPrice: number | null;
  priceUsd: number | null;
  /** REQUIRED on every sold lot post-migration (union expanded in v2) */
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
  /** True when a lot's sale has closed but the house has not posted a hammer
      yet — held as 'upcoming' and kept visible until results publish (then it
      flips to 'sold', or drops once the results window lapses). */
  resultsPending?: boolean;
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
  /** Which sport a sports-vertical lot belongs to — sportOf(title) in
      app/utils.ts ('Soccer' | 'Basketball' | …), stamped at crawl time on the
      three sports slugs (game-used, trophies-awards, tickets-passes) only.
      null = title names no sport (the UI files it under "Other");
      undefined/absent on every non-sports lot. */
  sport?: string | null;
  /** Precomputed realized-comp band for upcoming Goldin sports/science lots
      (the descriptive analogue of `signal`, built from soldCompBand). null on
      every non-sports/science-object lot; undefined = not precomputed. Carries
      no label and no pct — it can never render a directional call. */
  soldComp?: { median: number; high: number; low: number; n: number; confidence: string; form: string } | null;

  // ─────────────────────────────────────────────────────────────────────────
  // v2 IDENTITY BLOCK — persist what the value/similarity engine joins on.
  // Layer A = "very similar" (model/normalizedTitle); Layer B = "exact"
  // (objectFingerprint/imageHash/serial). All OPTIONAL + additive.
  // ─────────────────────────────────────────────────────────────────────────
  /** canonical maker/manufacturer slug (= artist when entityClass==='maker') */
  makerSlug?: string | null;
  /** real maker vs collectible bucket (game-used, tickets-passes, fossils) */
  entityClass?: EntityClass;
  /** crawl-origin tech stack when ≠ selling house (Rago via Wright's Inertia); null when same */
  platform?: string | null;
  /** unmodified source title (provenance — re-clean without re-crawl) */
  titleRaw?: string;
  /** persisted classifyForm() output (the FORM_LABEL keyspace) */
  formKey?: string | null;
  /** persisted modelKey() — furniture code/named series (lc2, pk22, conoid) */
  modelKey?: string | null;
  /** persisted watchKey() — ref number or model line (daytona, nautilus) */
  reference?: string | null;
  /** persisted normalizeTitle() — Layer-A pool key */
  normalizedTitle?: string | null;
  /** Normalized token set for the similarity scorer (step 2) — persisted so
      every crawl and the engine tokenize identically. See titleTokens(). */
  titleTokens?: string[];
  /** canonical 4-digit production/publication year */
  yearNum?: number | null;
  /** trust field over title */
  yearSource?: YearSource | null;
  /** flags circa/c. so approximate ≠ exact */
  yearIsCirca?: boolean;
  /** canonical cm (metric group if present, else imperial×2.54); depthCm null for 2D */
  heightCm?: number | null;
  widthCm?: number | null;
  depthCm?: number | null;
  /** coarse bucket by max linear dim (<40/40-100/100-200/>200 cm) */
  sizeClass?: SizeClass | null;
  /** measurement provenance (don't tight-match metric vs converted) */
  dimSource?: DimSource | null;
  /** controlled-vocab technique key; normalizes colours→colors */
  mediumCanon?: string | null;
  /** furniture materials (walnut/teak/rosewood/oak/bronze/ceramic) */
  materialTokens?: string[];
  /** N/M edition parsed from title/description */
  editionOf?: number | null;
  editionTotal?: number | null;
  /** non-numbered proof designation */
  editionMarker?: EditionMarker | null;
  /** case/movement/serial (watches, instruments) */
  serialNo?: string | null;
  /** game-used "photo-matched" in title — strongest sports exact signal */
  photoMatched?: boolean;
  /** auth bodies (PSA/DNA, MeiGray, Beckett, LOA/COA) */
  authCert?: string[];
  /** third-party grade (PSA 10, BGS 9.5) */
  gradeLabel?: string | null;
  /** retained raw lot description — non-destructive re-parse source */
  description?: string | null;
  /** perceptual hash of imageUrl (dHash) — cross-sale same-object matching */
  imageHash?: string | null;
  /** deterministic Layer-B hash; null when discriminators insufficient — never
      assert exact identity on a title-only match */
  objectFingerprint?: string | null;
  /** links lots believed same physical object; distinct from comp pool; null until confident */
  repeatSaleGroupId?: string | null;
  /** the athlete behind a sports lot (build-stamped on upcoming; parsed from title) */
  playerSlug?: string | null;
  playerName?: string | null;
  /** live sports-card comps: exact same card+grade sales + the grade ladder,
      hash-joined at build against the sold-card corpus (never similarity) */
  cardComps?: {
    med: number | null; n: number;
    lastSales: { d: string | null; p: number }[];
    gradeLadder: { g: string; med: number; n: number }[];
  } | null;
  /** Part-2 engine output, stamped at build time on upcoming lots. See
      app/lib/value.ts ValueResult. Structural to avoid a types↔value cycle. */
  value?: {
    poolIds: string[]; n: number; compValueUsd: number; low: number; high: number;
    compRatio: number | null;
    signal: { label: string; strength: string; beatRatePct: number } | null;
    estimateUsd: number | null;
    vsBid: { label: string; pct: number } | null;
    confidence: 'high' | 'medium' | 'low';
    exact: { id: string; realizedUsd: number; saleDate: string; cls: string } | null;
  } | null;

  // ── v2 STATUS / TIME / PROVENANCE ──
  /** full timestamp only when genuinely known (watch paths) */
  saleDateTime?: string | null;
  /** distinguishes "predates tracking" from genuinely "new" */
  firstSeenKnown?: boolean;
  /** = 2; the engine rejects pre-gate rows */
  schemaVersion?: number;
  /** ISO stamp set by the validation gate */
  validatedAt?: string | null;
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
