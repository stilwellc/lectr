export type AuctionHouse = 'Phillips' | "Sotheby's" | "Christie's" | 'Wright' | 'Rago' | 'LAMA' | 'Heritage' | 'Bonhams' | 'Hindman' | 'Goldin' | 'RR Auction'
  // sports + pop-culture expansion (Aug 2026 — built isolated, wired in per house
  // as each clears verification; see scripts/crawl-<house>.ts + their segments)
  | 'REA' | 'Huggins & Scott' | 'SCP' | 'Lelands' | 'Memory Lane' | 'Love of the Game'
  | "Julien's" | "Hake's" | 'Propstore' | 'NFL Auction' | 'MLB Auctions'
  // Bonhams-owned Copenhagen house, relabelled out of 'Bonhams' by normalize (Sep 27)
  | 'Bruun Rasmussen';
/** 'withdrawn'/'unknown-result' are actively used post-migration for vanished
    or unreconciled non-Goldin lots (see §1d + W11). */
export type LotStatus = 'upcoming' | 'sold' | 'bought_in' | 'withdrawn' | 'unknown-result';
/** Every currency the money layer can carry and convert (normalize.ts FX
    table) — the ONE runtime list; `Currency` is derived from it, and crawlers
    validate a house-supplied code with `isCurrency` instead of re-typing it. */
export const CURRENCIES = ['USD', 'GBP', 'EUR', 'HKD', 'CNY', 'AUD', 'CHF', 'DKK', 'SEK', 'NOK', 'JPY'] as const;
export type Currency = typeof CURRENCIES[number];
export const isCurrency = (c: unknown): c is Currency =>
  typeof c === 'string' && (CURRENCIES as readonly string[]).includes(c);
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

/** One quarter of a bid-competition series: the MEDIAN number of bids drawn per
    sold lot (a Goldin `bidCount`) over the trailing year. A DEMAND primitive —
    competitive tension per lot — NOT a price return and NOT %-over-estimate.
    `value` is a bare count (bids/lot), so it's typed distinctly from DemandPoint
    (a `%`) and RealizedPoint (a `$`) — the three can never share a caption. */
export interface BidCompetitionPoint {
  date: string;
  /** median bids per sold lot in the trailing-year window, e.g. 21 */
  value: number;
  /** sold lots carrying bidCount>0 inside the window */
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
  /** ABSENT at runtime on a row whose currency the money layer cannot convert
      (crawler fail-closed: no price, no estimate, compExclude
      'fx-unknown-currency' — never a native figure relabelled 'USD') */
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
  /** Set by corpus-normalize (Sep 27 2026) when the lot must NEVER be used as a
      comp — a short reason code ('stale-upcoming', 'price-vs-estimate',
      'fx-unconverted', 'last-tracked-bid', 'price-under-10', 'seed-nonlot-url',
      'estimate-upon-request'; see COMP_EXCLUDE). The row still renders. */
  compExclude?: string;
  /** How precise saleDate is. Absent = 'day'. 'month' = a synthesized mid-month
      stamp (seasonToDate: "2018 Spring" → 04-15); 'year' = a June-1 placeholder
      (Sotheby's artist-page scrape); 'season' = a conservative upper bound on
      an unpublished close (scripts/lib/sale-close-dates.ts — the day is read
      as-is, so the sale counts as known only from that bound on).
      Crawler-stamped values win over normalize. */
  datePrecision?: 'day' | 'month' | 'year' | 'season' | 'unknown';
  url: string;
  /** Stamped at BUILD time by scripts/build-upcoming.ts onto the eager
      upcoming.json lots ONLY (comps median vs estimate midpoint, or the
      engine's translated call) so the feed can paint before the full history
      downloads — the served shards never carry it; useRayData re-attaches it
      to the phase-2 lots by id. undefined = not precomputed (compute
      client-side from allLots); null = the build looked and stamped NO flag —
      the client must never recompute past a null. */
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
  /** provenance of a parser-derived entity stamp ('sig-p2'); absent on
   *  crawler-supplied entities — normalize may re-derive versioned stamps */
  entitySrc?: string | null;
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
  /** persisted classifyForm() output (the FORM_LABEL keyspace). SERVED to the
      client (not stripped): ComparableModal/LotPage print the
      "N comparable <form>" headline straight off it. */
  formKey?: string | null;
  /** persisted modelKey() — furniture code/named series (lc2, pk22, conoid) */
  modelKey?: string | null;
  /** persisted watchKey() — ref number or model line (daytona, nautilus) */
  reference?: string | null;
  /** (Oct 6 2026, pricing wave 7) the house's own STRUCTURED reference field,
      raw (Phillips maker API `wReferenceNo`: "1680, repeated inside
      caseback"). Phillips titles never print the reference; corpus-normalize
      reads this (watch-ref.readHouseReference) into `reference` when the
      title carries no numeric one. */
  houseReference?: string | null;
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
  /** labelled serial blocking key (watches, instruments), kind-qualified:
      "sn-<case/serial no.>" else "mvt-<movement no.>" (app/lib/normalize.ts
      extractSerials) — a case number never equals a movement number */
  serialNo?: string | null;
  /** labelled case / serial number (≥4 digits, separators folded). CORPUS-ONLY */
  caseNo?: string | null;
  /** labelled movement number (≥4 digits, separators folded). CORPUS-ONLY */
  movementNo?: string | null;
  /** game-used "photo-matched" in title — strongest sports exact signal */
  photoMatched?: boolean;
  /** auth bodies (PSA/DNA, MeiGray, Beckett, LOA/COA) */
  authCert?: string[];
  /** third-party grade (PSA 10, BGS 9.5) */
  gradeLabel?: string | null;
  /** retained raw lot description — non-destructive re-parse source.
      CORPUS-ONLY: stripped from every served payload (shards AND the eager
      upcoming.json) — it can carry internal house notes. */
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
  /** sub-category taxonomy (stamped by corpus-normalize, additive — no engine
   *  reads these): subCat = kind within the vertical (cards/wristwatches/
   *  prints/space…), drill = the performance split inside it (sport/model
   *  family/subject domain/program/material), flown = space-only flag. */
  subCat?: string;
  drill?: string;
  flown?: boolean;
  /** live bid-velocity, precomputed in build-upcoming from lot.bidHistory
      (Goldin live lots only): bids added over the trailing window + the
      lot's percentile among live peers. DESCRIPTIVE demand primitive —
      never a price, never a %-change (no green/red). */
  bidVelocity?: { delta: number; hours: number; pctile: number | null };
  /** stamped client-side when the intraday close-board overlay refreshed
      this lot's bid state — its generatedAt ("LIVE · refreshed Nh ago") */
  overlayAt?: string;
  /** cross-house live collisions: this exact cardKey live elsewhere NOW */
  crossLive?: { id: string; house: string; bid: number }[];
  /** projected close (bid × close-day growth curve, all-in) vs the value floor */
  /** ok (Oct 6 2026): the projection's house × days-out × projection/floor
      cell is VALIDATED on the graded tape (lanes.validateGapCells) — the Gap
      seats only such lots */
  bidProj?: { g: number; allIn: number; floor?: number; below?: boolean; ok?: boolean };
  playerName?: string | null;
  /** parsed trading-card identity — the composite fingerprint keying the card
      repeat-sales index (same player+year+set+cardNo+grade = the same product).
      PERSISTED at build time (lives in the corpus and rides the served card
      sample), not a transient parse — downstream readers may rely on it being
      on the row. */
  _card?: {
    player?: string | null;
    playerSlug?: string | null;
    year?: string | null;
    setName?: string | null;
    cardNo?: string | null;
    gradeCo?: string | null;
    gradeNum?: number | null;
    serialOf?: number | null;
    rookie?: boolean;
    auto?: boolean;
  } | null;
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
    /** compValueUsd is the engine's PREDICTION (blended, Sep 2026); the comps
        MEDIAN a "comps median" display prints is compMedianUsd (absent on
        older data → fall back to compValueUsd, which was the median then). */
    poolIds: string[]; n: number; compValueUsd: number; low: number; high: number;
    compMedianUsd?: number | null; compAdjUsd?: number | null; blendW?: number | null;
    compRatio: number | null;
    /** the statistic the signal is called on (comps vs the house-adjusted
     *  estimate) — the printed % reads THIS, fallback compRatio */
    flagRatio?: number | null;
    signal: { label: string; strength: string; beatRatePct: number } | null;
    estimateUsd: number | null;
    vsBid: { label: string; pct: number } | null;
    confidence: 'high' | 'medium' | 'low';
    exact: { id: string; realizedUsd: number; saleDate: string; cls: string } | null;
    /** 'card-comp' = tiered sports-card comp value (bid-only Goldin cards),
     *  not the hedonic engine. Absent/'hedonic' = the engine value. */
    basis?: 'hedonic' | 'card-comp';
  } | null;

  // ── v2 STATUS / TIME / PROVENANCE ──
  /** full timestamp only when genuinely known (watch paths). Stripped from the
      served shards, but KEPT on the eager upcoming.json lots — trueSaleDay()
      (app/utils.ts) prefers it over a possibly-crawl-day saleDate. */
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

// Build-time analytics for a market, computed over the FULL corpus so the
// distribution charts don't have to iterate the slim/sample client payload
// (which badly undercounts the ~433k-sold verticals like cards).
export interface TopSaleRow {
  id: string;
  artist: string;
  title: string;
  priceUsd: number;
  url: string;
  auctionHouse: string;
  saleDate: string;
  sport?: string | null;
  overEst: number | null;
}
export interface MarketAnalytics {
  topSales: TopSaleRow[];
  priceBuckets: { label: string; count: number; totalValue: number }[];
  sportBreakdown: { sport: string; count: number; totalValue: number }[];
  categoryBreakdown: { categoryKey: string; revenue: number; count: number; soldCount: number }[];
}

export interface MarketStats {
  lastUpdated: string;
  totalLotsTracked: number;
  /** SOLD-only count for this slug (totalLotsTracked includes live lots) */
  totalSoldTracked?: number;
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
