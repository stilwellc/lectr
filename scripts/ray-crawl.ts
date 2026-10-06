// http-tape FIRST: with RAY_HTTP_RECORD/RAY_HTTP_REPLAY set it wraps fetch (and,
// on replay, freezes the clock) before any other module evaluates. No-op otherwise.
import './lib/http-tape';
import * as fs from 'fs';
import * as path from 'path';
import { computeStats } from './compute-stats';
import { PRICE_BASIS } from './price-basis';
import { soldByYear, houseCoverage } from './coverage';

// ── Types ──
// Imported from app/types.ts — the app's types are the single source of truth.
// (This block used to be a hand-mirrored copy "to avoid import issues in a
// standalone script", but the script is no longer standalone — it already
// imports app/lib/comps and build-upcoming — and the mirror had drifted.)

import type {
  AuctionLot, LotCategory,
  MarketStats,
} from '../app/types';

// Shared crawler plumbing: transient-failure retry (5xx/network/timeout only,
// never 4xx), the incremental skip-set predicate, and robust estimate-range
// parsing. All pure/no-side-effect modules — safe as static imports.
import { RESULT_PENDING_MS } from './lib/skip-set';
import { saleDayOf } from './lib/sale-day';

// v2 foundation — the single, deterministic normalization layer. Every FUTURE
// row is born v2 by stamping these (native money fact + dated USD, persisted
// identity keys) at parse/classify time. imageHash is the only I/O function and
// runs INCREMENTALLY (a bounded batch per crawl — decision #3), never all 41k.
import {
  normalizeDimensions, extractYear, canonMedium,
  extractEdition, extractSerials, extractCollectibleTags, classifyEntity,
  objectFingerprint, titleTokens,
  modelKey as normModelKey, watchKey as normWatchKey,
  normalizeTitle as normNormalizeTitle,
} from '../app/lib/normalize';

// Per-house crawlers (fetch + parse + enrich) live in scripts/lib/houses/.
import { ARTISTS, type ArtistConfig } from './lib/houses/artists';
import { crawlBonhams } from './lib/houses/bonhams';
import { crawlChristies, crawlChristiesAuctions } from './lib/houses/christies';
import { DELAY_MS, HEALTH, INCREMENTAL_MODE_REASON, UA, runPool, sleep, stampMoney } from './lib/houses/common';
import { enrichLots } from './lib/houses/enrich';
import { crawlGoldin, goldinCompletedAuctions, goldinFeedComplete, goldinStatusOk } from './lib/houses/goldin';
import { crawlLama } from './lib/houses/lama';
import { crawlPhillips } from './lib/houses/phillips';
import { crawlSothebys, crawlSothebysAuctions, enrichSothebysCloseTimes } from './lib/houses/sothebys';
import { crawlWright } from './lib/houses/wright';

// ── Lot Classification ──
// Classifies a lot as original, print, photograph, sculpture, design, or unknown
// based on medium, title, sale name, URL, and artist context.

const DESIGN_ARTISTS = new Set(['george-nakashima', 'charles-eames', 'jean-prouve', 'pierre-jeanneret']);
// Watches makers + science collections: their lots are objects, never
// paintings/prints — pattern classifiers ("printed dial") must not touch them.
const OBJECT_ARTISTS = new Set([
  'rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier',
  'meteorites', 'fossils', 'space-exploration', 'scientific-instruments',
  'game-used', 'trophies-awards', 'tickets-passes',
]);
// Fine artists whose unclassified lots default to 'print' (edition-heavy output)
const EDITION_DEFAULT_ARTISTS = new Set(['andy-warhol', 'keith-haring', 'ed-ruscha', 'henri-matisse', 'pablo-picasso']);
// Fine artists whose unclassified lots default to 'original' (painting/drawing-heavy output)
const ORIGINAL_DEFAULT_ARTISTS = new Set([
  'george-condo', 'kaws', 'raymond-pettibon', 'peter-saul',
  'tom-sachs', 'barry-mcgee', 'futura-2000', 'r-crumb', 'fab-5-freddy',
  'eddie-martinez', 'kenny-scharf',
]);

const PRINT_PATTERNS = /\b(screenprint|silkscreen|serigraph|lithograph|etching|woodcut|woodblock|linocut|engraving|aquatint|monotype|monoprint|offset|poster|gicl[eé]e|print(?:ed)?|edition of|numbered.*\/|signed.*numbered|multiple|chromolithograph|intaglio)\b/i;
const PHOTO_PATTERNS = /\b(photograph|gelatin silver|c-print|chromogenic|daguerreotype|platinum print|pigment print|inkjet print|archival pigment|digital print|cibachrome|polaroid|albumen)\b/i;
const SCULPTURE_PATTERNS = /\b(sculpture|bronze|ceramic|porcelain|cast iron|resin|fibreglass|fiberglass|stainless steel|patinated|figure|figurine|plaster cast)\b/i;
const DESIGN_PATTERNS = /\b(lounge chair|dining chair|side chair|armchair|cabinet|desk|table|bookcase|shelf|shelving|headboard|bench|settee|sofa|credenza|dresser|nightstand|lamp|chandelier|sconce|light fixture|ottoman|stool|rocker|rocking chair|walnut|rosewood|teak|plywood|upholster|enameled|molded|fiberglass shell)\b/i;
const ORIGINAL_PATTERNS = /\b(oil on|acrylic on|tempera on|gouache on|watercolor on|watercolour on|mixed media on|ink on|charcoal on|pastel on|enamel on|spray paint on|oil and|acrylic and|encaustic|collage on|canvas|linen|panel|board|paper(?! print))\b/i;

// Title patterns that signal editions: "from [Series]", "plate(s)", known series formats
const TITLE_EDITION_PATTERNS = /\b(plates?\s*,?\s*from\b|,\s*from\s+[A-Z]|\bfrom\s+the\s+portfolio\b|\bfrom\s+(?:Myths|Ads|Flowers|Marilyn|Mao|Campbell|Electric Chair|Endangered Species|Cowboys and Indians|Ladies and Gentlemen|Flash|Martha Graham|Hans Christian Andersen|Wild Raspberries|In the Bottom|Ten Portraits|Space Fruit|Sunset|Ingrid Bergman|Reigning Queens))\b/i;

function classifyLot(lot: AuctionLot): LotCategory {
  // Watches & science lots are objects — before any pattern matching, or a
  // Rolex with a "printed dial" becomes a print.
  if (OBJECT_ARTISTS.has(lot.artist)) return 'object';

  // Combine all text signals
  const medium = (lot.medium || '').toLowerCase();
  const title = (lot.title || '').toLowerCase();
  const saleName = (lot.saleName || '').toLowerCase();
  const url = (lot.url || '').toLowerCase();
  const text = `${medium} ${title}`;

  // Design artists default to "design" unless clearly something else
  const isDesignArtist = DESIGN_ARTISTS.has(lot.artist);

  // 1. Check medium field first (most reliable when populated)
  // Photo checked before print since "c-print", "Polaroid print" etc. are photographs
  if (medium) {
    if (PHOTO_PATTERNS.test(medium)) return 'photograph';
    if (PRINT_PATTERNS.test(medium)) return 'print';
    if (SCULPTURE_PATTERNS.test(medium)) return 'sculpture';
    if (DESIGN_PATTERNS.test(medium)) return 'design';
    if (ORIGINAL_PATTERNS.test(medium)) return 'original';
  }

  // 2. Check title for explicit medium patterns
  if (PHOTO_PATTERNS.test(title)) return 'photograph';
  if (PRINT_PATTERNS.test(title)) return 'print';
  if (SCULPTURE_PATTERNS.test(title)) return 'sculpture';
  if (DESIGN_PATTERNS.test(title)) return 'design';

  // 3. Title patterns that strongly signal editions: "X plate(s), from Y", "from [Known Series]"
  if (TITLE_EDITION_PATTERNS.test(lot.title)) return 'print';

  // 4. Check sale name for category clues
  if (/prints?\s*[&+]\s*multiples?/i.test(saleName) || /prints?\s+unlimited/i.test(saleName)) return 'print';
  if (/photograph/i.test(saleName)) return 'photograph';
  if (/design/i.test(saleName) || /furniture/i.test(saleName)) return 'design';

  // 5. Check URL path
  if (/\/prints?\b/i.test(url)) return 'print';
  if (/\/photograph/i.test(url)) return 'photograph';
  if (/\/design/i.test(url)) return 'design';

  // 6. Artist-level defaults
  if (isDesignArtist) return 'design';
  if (EDITION_DEFAULT_ARTISTS.has(lot.artist)) return 'print';
  if (ORIGINAL_DEFAULT_ARTISTS.has(lot.artist)) return 'original';

  // 7. If we have a medium field but nothing matched the patterns, likely original
  if (medium && ORIGINAL_PATTERNS.test(text)) return 'original';

  return 'unknown';
}

const DATA_DIR = path.join(process.cwd(), 'public', 'data', 'ray');
// ── Crawl a single artist across all houses ──

// SEGMENTED NIGHTLY: RAY_HOUSE=<segment> scopes a run to ONE house's crawlers,
// so each house crawls in its own isolated, bounded, retryable job and writes
// its own corpus segment (assemble.ts reunions them). null = crawl every house
// (the legacy monolith, still used by backfills + manual runs). Wright+Rago
// share a crawler → the 'wright' segment.
const CRAWL_HOUSE = process.env.RAY_HOUSE || null;
const houseWanted = (seg: string) => !CRAWL_HOUSE || CRAWL_HOUSE === seg;

async function crawlArtist(artist: ArtistConfig): Promise<AuctionLot[]> {
  const allLots: AuctionLot[] = [];

  console.log(`\n[Ray] === ${artist.displayName} ===`);

  if (houseWanted('phillips')) {
    console.log(`[Ray] Crawling Phillips...`);
    const phillipsLots = await crawlPhillips(artist);
    console.log(`[Ray] Phillips: ${phillipsLots.length} lots`);
    allLots.push(...phillipsLots);
    await sleep(DELAY_MS);
  }

  if (houseWanted('sothebys')) {
    console.log(`[Ray] Crawling Sothebys...`);
    const sothebysLots = await crawlSothebys(artist);
    console.log(`[Ray] Sothebys: ${sothebysLots.length} lots`);
    allLots.push(...sothebysLots);
    await sleep(DELAY_MS);
  }

  if (houseWanted('christies')) {
    console.log(`[Ray] Crawling Christie's...`);
    const christiesLots = await crawlChristies(artist);
    console.log(`[Ray] Christie's: ${christiesLots.length} lots`);
    allLots.push(...christiesLots);
    await sleep(DELAY_MS);
  }

  if (houseWanted('wright')) {
    console.log(`[Ray] Crawling Wright/Rago...`);
    const wrightLots = await crawlWright(artist);
    console.log(`[Ray] Wright/Rago: ${wrightLots.length} lots`);
    allLots.push(...wrightLots);
    await sleep(DELAY_MS);

    // LAMA rides the same group platform + segment ('wright') — gated here, not
    // on a 'lama' key, so it runs inside the nightly's wright matrix job.
    console.log(`[Ray] Crawling LAMA...`);
    const lamaLots = await crawlLama(artist);
    console.log(`[Ray] LAMA: ${lamaLots.length} lots`);
    allLots.push(...lamaLots);
    await sleep(DELAY_MS);
  }

  if (houseWanted('bonhams')) {
    console.log(`[Ray] Crawling Bonhams...`);
    const bonhamsLots = await crawlBonhams(artist);
    console.log(`[Ray] Bonhams: ${bonhamsLots.length} lots`);
    allLots.push(...bonhamsLots);
  }

  return allLots;
}

// ── Main ──

async function main() {
  console.log('[Ray] Starting auction crawl...');
  console.log(`[Ray] Incremental crawl (Christie's/Sotheby's auctions): ${INCREMENTAL_MODE_REASON}`);
  console.log(`[Ray] Data directory: ${DATA_DIR}`);
  console.log(`[Ray] Artists: ${ARTISTS.map(a => a.displayName).join(', ')}`);

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Load existing data. MUST read the FULL corpus (data/corpus/{lots,sold-
  // archive}.json.gz) — NOT the slim public/data/ray/lots.json, which OMITS the
  // Goldin sold-archive (~11k permanent hammer records split out for payload
  // size). Reading the slim file silently drops the entire archive every crawl:
  // the merge would rebuild sold-archive.json from only this run's Goldin tail,
  // erasing accumulated history. readCorpus() concats both files back together.
  let existingLots: AuctionLot[] = [];
  const existingStatsByArtist: Record<string, MarketStats> = {};
  const statsPath = path.join(DATA_DIR, 'stats.json');
  // house → segment name for the per-house health line/tripwire (assigned from
  // corpus-io's canonical map once the dynamic import lands below).
  let segOfHouse: (house: string) => string = () => 'other';
  // Pre-crawl per-house upcoming counts — captured NOW because reconcile/
  // sanitize mutate existingLots' statuses in place later (same reason the
  // market-level coverageBefore snapshot exists).
  const upcomingPrevByHouse: Record<string, number> = {};

  try {
    const { readCorpus, readSegment, segmentOf } = await import('./corpus-io');
    segOfHouse = segmentOf;
    // SEGMENTED: a house run loads only ITS segment (bounded memory); the
    // legacy monolith loads the whole corpus.
    existingLots = (CRAWL_HOUSE ? readSegment(CRAWL_HOUSE) : readCorpus()) as unknown as AuctionLot[];
    for (const lot of existingLots) {
      if (!lot.artist) lot.artist = 'george-condo';
      if (!lot.category) lot.category = 'unknown' as LotCategory;
      if (lot.status === 'upcoming') {
        const s = segmentOf(lot.auctionHouse);
        upcomingPrevByHouse[s] = (upcomingPrevByHouse[s] || 0) + 1;
      }
    }
    console.log(`[Ray] Loaded ${existingLots.length} existing lots (${CRAWL_HOUSE ? `segment ${CRAWL_HOUSE}` : 'full corpus incl. sold-archive'}).`);
  } catch (e) {
    // Segmented run with the segment file PRESENT on disk but unreadable
    // (zero-byte/corrupt pull): abort — proceeding seedless would merge
    // against nothing and overwrite the last-good segment with a fresh-only
    // subset. A genuinely MISSING file never lands here (readSegment returns
    // [] for it — the bootstrap path stays open).
    if (CRAWL_HOUSE && fs.existsSync(path.join('data', 'corpus', 'segments', `${CRAWL_HOUSE}.ndjson.gz`))) {
      throw new Error(`[Ray] segment ${CRAWL_HOUSE} exists on disk but failed to read (${(e as Error).message}) — refusing a seedless crawl`);
    }
    console.log('[Ray] Could not read corpus:', (e as Error).message);
  }
  if (fs.existsSync(statsPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
      // Handle both old format (single MarketStats) and new format (keyed by artist)
      if (raw.lastUpdated) {
        // Old format — assign to george-condo
        existingStatsByArtist['george-condo'] = raw;
      } else {
        Object.assign(existingStatsByArtist, raw);
      }
    } catch { /* ignore */ }
  }

  // Crawl all artists (RAY_ONLY=slug,slug scopes a run to specific entries —
  // used when onboarding a new vertical without recrawling the world)
  const only = process.env.RAY_ONLY ? new Set(process.env.RAY_ONLY.split(',')) : null;
  const roster = only ? ARTISTS.filter(a => only.has(a.slug)) : ARTISTS;
  if (only) console.log(`[Ray] RAY_ONLY: crawling ${roster.map(a => a.slug).join(', ')}`);
  const freshLots: AuctionLot[] = [];

  // Bounded-concurrency maker sweep — replaces the old sequential loop (33
  // makers × fetch+pagination+1500ms each = the ~40min christies / ~24min
  // sothebys wall-time). N=CRAWL_CONCURRENCY (default 4, conservative) distinct
  // makers crawl at once; the pool spaces requests naturally so the 1500ms
  // inter-artist DELAY_MS is dropped from this path (per-page politeness sleeps
  // INSIDE each house crawler stay). A 250ms cold-start stagger keeps the N
  // workers from all firing on the same host at t=0. Dial CRAWL_CONCURRENCY
  // down (env) if a house starts 429ing.
  const CONCURRENCY = Math.max(1, Number(process.env.CRAWL_CONCURRENCY) || 4);
  let makerFailures = 0;
  const sweepStart = Date.now();
  // Error isolation: crawlArtist already try/catches per house, but a wrapper
  // guarantees one maker's throw can NEVER kill the pool or lose the others —
  // it logs, tallies, and yields [] so the run continues.
  const perMaker = await runPool(roster, CONCURRENCY, async (artist) => {
    try {
      return await crawlArtist(artist);
    } catch (e) {
      makerFailures++;
      console.error(`[Ray] ${artist.slug} crawl failed: ${(e as Error).message}`);
      return [] as AuctionLot[];
    }
  }, 250);
  for (const lots of perMaker) freshLots.push(...lots);

  // >25% of makers failing is a ban/outage signature — shout, but still write
  // what succeeded (the segment-collapse guard at the segment write is the
  // backstop against overwriting a good segment with a collapsed one).
  if (makerFailures > roster.length * 0.25) {
    console.warn(`[Ray] ⚠️  WARNING: ${makerFailures}/${roster.length} makers failed (>25%) — possible rate-limit ban or source outage; proceeding with what succeeded.`);
  }
  console.log(`[Ray] maker sweep: ${roster.length} makers, ${CONCURRENCY} concurrency, ${Math.round((Date.now() - sweepStart) / 1000)}s`);

  // Sotheby's watch & science auctions ride the GraphQL API — one cross-roster
  // pass, not per-artist. Scope to whichever verticals this run touches.
  const WATCH_SLUGS = ['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier'];
  const SCIENCE_SLUGS = ['meteorites', 'fossils', 'space-exploration', 'scientific-instruments'];
  const SPORTS_SLUGS = ['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia'];
  const ART_SLUGS = ['george-condo', 'kaws', 'andy-warhol', 'keith-haring', 'ed-ruscha', 'pablo-picasso', 'henri-matisse', 'tom-sachs', 'peter-saul', 'raymond-pettibon', 'barry-mcgee', 'futura-2000', 'r-crumb', 'fab-5-freddy', 'francesco-clemente', 'eddie-martinez', 'kenny-scharf', 'george-nakashima', 'charles-eames', 'jean-prouve', 'pierre-jeanneret'];
  const wantWatch = !only || WATCH_SLUGS.some(s => only.has(s));
  const wantScience = !only || SCIENCE_SLUGS.some(s => only.has(s));
  const wantSports = !only || SPORTS_SLUGS.some(s => only.has(s));
  const wantArt = !only || ART_SLUGS.some(s => only.has(s));
  const scopeCount = [wantWatch, wantScience, wantSports, wantArt].filter(Boolean).length;
  const auctionScope: 'watches' | 'science' | 'sports' | 'art' | 'all' | null =
    scopeCount > 1 ? 'all' : wantWatch ? 'watches' : wantScience ? 'science' : wantSports ? 'sports' : wantArt ? 'art' : null;
  if (auctionScope && houseWanted('sothebys')) {
    freshLots.push(...await crawlSothebysAuctions(auctionScope));
    // accurate per-lot close times for the live Sotheby's lots (best-effort)
    await enrichSothebysCloseTimes(freshLots);
  }
  if (auctionScope && houseWanted('christies')) {
    freshLots.push(...await crawlChristiesAuctions(auctionScope));
  }
  // Goldin: sports objects (never cards) + computing/fossils (never games).
  // Live inventory only — each crawl replaces the previous Goldin set
  // wholesale, so gate refinements purge immediately.
  const GOLDIN_SLUGS = ['game-used', 'trophies-awards', 'tickets-passes', 'meteorites', 'fossils', 'scientific-instruments'];
  let goldinRan = false;

  // Coverage baseline — captured NOW, before reconcile/sanitize mutate lot.status
  // in place on the existingLots objects (they're shared by reference with lotMap).
  // Computing "before" from existingLots at the end would read post-crawl status
  // and silently mask a collapse — the exact failure the tripwire guards against.
  const coverageBefore: Record<string, number> = { art: 0, watches: 0, sports: 0, science: 0 };
  {
    const g: Record<string, string[]> = { art: ART_SLUGS, watches: WATCH_SLUGS, sports: SPORTS_SLUGS, science: SCIENCE_SLUGS };
    for (const l of existingLots) {
      if (l.status !== 'upcoming') continue;
      for (const k in g) if (g[k].includes(l.artist)) coverageBefore[k]++;
    }
  }
  let freshGoldinIds = new Set<string>();
  if (houseWanted('goldin') && (!only || GOLDIN_SLUGS.some(s => only.has(s)))) {
    const goldinLots = await crawlGoldin();
    goldinRan = true;
    freshGoldinIds = new Set(goldinLots.map(l => l.id));
    freshLots.push(...goldinLots);
  }

  // DOCTRINE: Ray is AUCTION intelligence. Buy-now / fixed-price / retail
  // listings are NEVER crawled — an asking price is not market data. A
  // marketplace crawler was added and removed here in July 2026; do not
  // reintroduce it.

  // Merge: new data overwrites existing by ID — but carry forward enriched
  // fields the fresh list-page copy lacks (medium/dims/year/image are facts
  // about the object; wiping them re-burns the enrich budget on the same lots
  // forever). Fresh always wins for price/status/bid fields via the spread.
  //
  // firstSeen (W15): lotMap is seeded from the previous lots.json, so `prev`
  // is undefined exactly when an id has never been seen before — those get
  // stamped with today's ISO date. Previously-seen ids carry their stamp
  // forward from the prior record (crawlers never set firstSeen on fresh
  // copies, so without the carry the spread would wipe it every run). Lots
  // that predate the feature stay unstamped — they were not new when first
  // observed, and a fabricated date would be a lie ("New today" must mean it).
  const todayIso = new Date().toISOString().split('T')[0];
  const lotMap = new Map<string, AuctionLot>();
  for (const lot of existingLots) lotMap.set(lot.id, lot);
  // bid snapshots: nightly {d,b,n} appended per live bid-auction lot — the raw
  // material for a future bid-momentum feature (final bidCount already
  // stratifies outcomes 0.74×→1.00×, but last-write-wins was discarding the
  // trajectory). Corpus-only (STRIPped from served).
  type Snap = { d: string; b: number; n: number };
  const withSnaps = (fresh: AuctionLot, prev?: AuctionLot): Snap[] | undefined => {
    const hist: Snap[] = ((prev as { bidHistory?: Snap[] } | undefined)?.bidHistory || []).slice(-59);
    const bid = fresh.currentBid || 0;
    const n = fresh.bidCount || 0;
    if (fresh.status === 'upcoming' && (bid > 0 || n > 0)) {
      const last = hist[hist.length - 1];
      if (!last || last.b !== bid || last.n !== n) hist.push({ d: todayIso, b: bid, n });
    }
    return hist.length ? hist : undefined;
  };
  for (const lot of freshLots) {
    const prev = lotMap.get(lot.id);
    const bidHistory = lot.auctionHouse === 'Goldin' ? withSnaps(lot, prev) : undefined;
    if (bidHistory) (lot as AuctionLot & { bidHistory?: Snap[] }).bidHistory = bidHistory;
    lotMap.set(lot.id, prev ? {
      ...lot,
      medium: lot.medium ?? prev.medium,
      dimensions: lot.dimensions ?? prev.dimensions,
      year: lot.year ?? prev.year,
      imageUrl: lot.imageUrl ?? prev.imageUrl,
      // estimates are facts about the lot: some crawl paths (Wright/Rago
      // artist search) return copies WITHOUT them — never let an estimate-less
      // fresh copy wipe an enriched estimate (fresh still wins when it has one)
      estimateLow: (lot.estimateLow ?? null) !== null ? lot.estimateLow : prev.estimateLow,
      estimateHigh: (lot.estimateHigh ?? null) !== null ? lot.estimateHigh : prev.estimateHigh,
      estLowUsd: (lot.estLowUsd ?? null) !== null ? lot.estLowUsd : prev.estLowUsd,
      estHighUsd: (lot.estHighUsd ?? null) !== null ? lot.estHighUsd : prev.estHighUsd,
      estLowNative: (lot.estLowNative ?? null) !== null ? lot.estLowNative : prev.estLowNative,
      estHighNative: (lot.estHighNative ?? null) !== null ? lot.estHighNative : prev.estHighNative,
      firstSeen: prev.firstSeen,
    } : { ...lot, firstSeen: todayIso });
  }

  // Clean up stale/bad entries
  const SCIENCE_SET = new Set(['meteorites', 'fossils', 'space-exploration', 'scientific-instruments']);
  const WATCH_SET = new Set(['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier']);
  const badIds = new Set<string>();
  let goldinPromoted = 0;

  // W11 — GENERALIZE vanished-lot reconciliation to ALL houses (not just
  // Goldin). A non-Goldin lot that stood 'upcoming', whose sale date has now
  // passed, but that did NOT reappear in this run's fresh crawl of its own
  // scope, is a zombie: the source dropped it without ever publishing a result
  // (withdrawn, or an unknown result). We can't fabricate a sold/bought_in — so
  // we mark it 'withdrawn' when it's a clean disappearance short after the sale,
  // else 'unknown-result'. This fixes the ~424 stale upcoming rows that never
  // resolve. GUARDED: only reconcile a lot whose SCOPE was actually crawled
  // this run (else a RAY_ONLY run would strand every other house's upcoming as
  // "vanished"), and never touch sold/bought_in (permanent) or Goldin (its own
  // Completed-flip pass above owns Goldin adjudication).
  const freshNonGoldinIds = new Set<string>();
  const crawledArtists = new Set<string>();
  const houseOk = new Set<string>(); // houses that returned ≥1 lot this run
  for (const l of freshLots) {
    if (l.auctionHouse !== 'Goldin') freshNonGoldinIds.add(l.id);
    crawledArtists.add(l.artist);
    houseOk.add(l.auctionHouse);
  }
  // A house appears in this run's fresh set → we have authority to reconcile
  // its still-upcoming past-sale lots. (A house crawled but returning zero
  // lots for an artist is indistinguishable from a not-crawled house, so we
  // gate on the artist having produced ANY fresh lot this run.)
  const nowMs = Date.now();
  const RECONCILE_GRACE_MS = 3 * 86_400_000; // 3-day grace after sale close
  let reconciledWithdrawn = 0, reconciledUnknown = 0;
  for (const [id, lot] of Array.from(lotMap.entries())) {
    if (lot.title?.match(/^Lot\.\d+/i)) badIds.add(id);
    if (id === 'sothebys-upcoming-boy-white-hat' && lotMap.has('sothebys-george-condo-qiao-zhikang-duo-the-boy-with-white')) {
      badIds.add(id);
    }
    // Evict legacy Bonhams keyword-dredge junk from the science verticals.
    // Sotheby's/Christie's curated science auctions AND Goldin (whose crawler
    // deliberately ingests Apple/computing + fossils — invariant: science from
    // Goldin exists) are the legitimate sources; sold records are permanent
    // archive and never swept here.
    if (SCIENCE_SET.has(lot.artist) && lot.status !== 'sold'
      && lot.auctionHouse !== "Sotheby's" && lot.auctionHouse !== "Christie's" && lot.auctionHouse !== 'Goldin') badIds.add(id);
    // Evict the deprecated Algolia crawler's lots (sothebys-lux-*, no images) —
    // superseded by the GraphQL auction crawler's sothebys-<uuid> lots.
    if (id.startsWith('sothebys-lux-')) badIds.add(id);
    // Evict any buy-now marketplace lots — fixed-price asks are not auction
    // data and must never be in the dataset (see doctrine above).
    if (id.startsWith('sothebys-mkt-')) badIds.add(id);
    // Goldin has no public sold archive — RAY IS THE ARCHIVE. When a tracked
    // lot's auction flips to 'Completed', promote its LAST bid to a hammer (bid
    // + buyer's premium) — that's the authoritative, time-based sold signal, and
    // the only one Goldin gives us (it purges the lot from its live feed on
    // close). Sold records are permanent. A lot still live stays upcoming; a lot
    // that vanished with no completed auction and no bid is delisted stock and
    // leaves; a legacy stale 'upcoming' past its end also goes.
    // The whole pass is gated on goldinStatusOk: with a failed status fetch the
    // Completed set is empty and every closed lot would read as "delisted" —
    // one transient error must never erase the pending archive. Deferring a run
    // loses nothing (lots are keyed by id); evicting loses the hammer forever.
    if (id.startsWith('goldin-') && goldinRan && goldinStatusOk && lot.status === 'upcoming') {
      const auctionDone = !!lot.auctionId && goldinCompletedAuctions.has(lot.auctionId);
      const bid = lot.currentBid || 0;
      if (auctionDone) {
        if (bid > 0) {
          const bp = lot.buyerPremium || 22;
          // v2: stamp the FULL money block on promotion (native hammer =
          // last bid, realized = hammer + premium, dated USD). Basis is
          // 'last-tracked-bid' — HONEST: this is our last snapshot, not the
          // final hammer (extended bidding runs after it). The recent-close
          // sold sweep (3b) overwrites with the true price, and downstream
          // consumers (ledger/UI) treat this basis as provisional.
          // an UNDATED (placeholder-close) lot whose auction completed is
          // dated on the Completed flip — a sold row must carry a real day
          if (!lot.saleDate) {
            lot.saleDate = todayIso;
            delete (lot as { datePrecision?: string }).datePrecision;
          }
          Object.assign(lot, stampMoney({
            isSold: true,
            nativeCurrency: 'USD',
            saleDate: (lot.saleDate || '').split('T')[0] || null,
            hammerNative: bid,
            premiumNative: Math.round(bid * (1 + bp / 100)),
            estLowNative: null,
            estHighNative: null,
            priceBasis: 'last-tracked-bid',
            buyerPremiumPct: bp,
          }));
          lot.status = 'sold';
          goldinPromoted++;
        } else {
          badIds.add(id); // closed with no bid = bought-in
        }
      } else if (goldinFeedComplete && !freshGoldinIds.has(id)) {
        // Gone from a FULLY-enumerated live feed but its auction isn't
        // Completed yet. A lot carrying real money is held pending — its
        // Completed flip adjudicates it (promote or bought-in) on a later run;
        // evicting now would destroy the only hammer record that will ever
        // exist. Only zero-bid delisted stock leaves, plus legacy records we
        // can't adjudicate (no auctionId) that are stale past their end.
        if (bid > 0 && lot.auctionId) {
          // hold — awaiting the Completed flip
        } else if (lot.auctionId || new Date(lot.saleDate).getTime() < Date.now() - 86_400_000) {
          badIds.add(id);
        }
      }
    }
    // Watch makers: evict the old Christie's maker-search lots (now superseded
    // by christies-auc-* from the full auction crawler) to avoid double-count.
    if (WATCH_SET.has(lot.artist) && lot.auctionHouse === "Christie's" && !id.startsWith('christies-auc-')) badIds.add(id);

    // W11 — non-Goldin zombie reconciliation (see the comment block above).
    if (lot.auctionHouse !== 'Goldin' && lot.status === 'upcoming' && !badIds.has(id)) {
      const saleMs = new Date(lot.saleDate).getTime();
      const salePassed = !isNaN(saleMs) && saleMs < nowMs;
      const scopeCrawled = crawledArtists.has(lot.artist);
      const reappeared = freshNonGoldinIds.has(id);
      // Only reconcile if the lot's OWN house actually returned lots this run —
      // if its house's fetch failed transiently (0 lots), a same-artist lot from
      // another house must NOT authorize withdrawing it (that's the silent
      // live-lot-loss under a flaky source).
      const houseCrawled = houseOk.has(lot.auctionHouse);
      if (salePassed && scopeCrawled && houseCrawled && !reappeared) {
        // vanished from a scope we crawled, after its sale — never resolved.
        // Recently past → a clean withdrawal; long past → unknown result.
        if (nowMs - saleMs <= RECONCILE_GRACE_MS) {
          lot.status = 'withdrawn';
          reconciledWithdrawn++;
        } else {
          lot.status = 'unknown-result';
          reconciledUnknown++;
        }
      }
    }
  }
  for (const id of Array.from(badIds)) lotMap.delete(id);

  // ── GLOBAL status-sanitize + results-pending net (house-agnostic) ──
  // EVERY house has the same failure mode: a sale closes, the house has not
  // posted hammers yet, and the lot lands in a state that (a) hides it from both
  // active and sold (the "double miss") or (b) is outright invalid (upcoming
  // with a past date; sold with no price — flaky artist-page scrapes produce
  // both). The write-gate is all-or-nothing, so a handful of such rows would
  // block the entire 44k-row publish. This one pass sanitizes them so the gate
  // passes AND no just-closed lot vanishes: a resultless lot whose sale closed
  // within RESULT_PENDING_MS is held VISIBLE as pending (upcoming); anything
  // past the window or otherwise invalid settles to bought_in. Goldin is
  // excluded — its Completed-flip pass owns its own adjudication.
  const HIDDEN = new Set(['bought_in', 'withdrawn', 'unknown-result']);
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  let heldPending = 0, demoted = 0;
  const held = (lot: AuctionLot & { resultsPending?: boolean }) => { lot.status = 'upcoming'; lot.resultsPending = true; heldPending++; };
  for (const lot of Array.from(lotMap.values())) {
    if (lot.auctionHouse === 'Goldin') continue;
    const hasHammer = (lot.realizedUsd || 0) > 0;
    const sMs = new Date(lot.saleDate).getTime();
    const saleStr = (lot.saleDate || '').slice(0, 10);
    const past = /^\d{4}-\d{2}-\d{2}$/.test(saleStr) && saleStr < todayStr;
    const withinWindow = !isNaN(sMs) && sMs <= nowMs && nowMs - sMs <= RESULT_PENDING_MS;

    // (a) 'sold' with no usable price is a parse miss, not a real sale → demote
    //     to bought_in AND strip any partial money (the non-sold-null-price
    //     invariant requires every realized/hammer/premium field be null).
    if (lot.status === 'sold' && !hasHammer) {
      lot.status = 'bought_in';
      const L = lot as unknown as Record<string, unknown>;
      for (const f of ['realizedUsd', 'realizedNative', 'hammerUsd', 'hammerNative', 'premiumUsd', 'premiumNative', 'hammerPrice', 'premiumPrice', 'priceUsd', 'priceBasis']) L[f] = null;
      demoted++; continue;
    }
    // (b) hidden + resultless + just-closed → hold visible as pending
    if (HIDDEN.has(lot.status as string) && !hasHammer && past && withinWindow) { held(lot as AuctionLot & { resultsPending?: boolean }); continue; }
    // (c) 'upcoming' with a PAST sale date — keep it VISIBLE if it is just-closed
    //     OR already flagged results-pending (a deliberately-held live lot whose
    //     source date is stale, e.g. Christie's online sales). Only a stale
    //     upcoming with NO pending flag beyond the window is a real closed
    //     listing → bought_in. NEVER demote a results-pending lot (that is how
    //     live lots were being lost).
    if (lot.status === 'upcoming' && past) {
      if (withinWindow || (lot as AuctionLot & { resultsPending?: boolean }).resultsPending) held(lot as AuctionLot & { resultsPending?: boolean });
      else { lot.status = 'bought_in'; demoted++; }
    }
  }
  if (heldPending) console.log(`[Ray] Held ${heldPending} just-closed lots visible as results-pending (all houses)`);
  if (demoted) console.log(`[Ray] Sanitized ${demoted} invalid rows (sold-no-price / stale-upcoming → bought_in)`);

  // ── Christie's online-sale TRUE dates + rescue (onlineonly) ──
  // www.christies.com is STALE for online ("First Open") sales — it reports live
  // lots as over with years-old dates, so they get stranded as bought_in. The
  // real close lives on onlineonly (the SSO url each lot carries). Fetch it for
  // EVERY non-sold Christie's lot with an onlineonly url — existing corpus rows
  // included, since the legacy id format is not re-produced each crawl — stamp
  // the true end_date, and revive future-dated lots to 'upcoming'. Best-effort:
  // an unreachable lot keeps its state (never dropped). This un-strands live lots
  // that the stale www data wrongly closed (e.g. saved Tom Sachs).
  {
    const targets = Array.from(lotMap.values()).filter(l =>
      l.auctionHouse === "Christie's" && l.status !== 'sold' && !!l.url && /onlineonly\.christies\.com/.test(l.url));
    const CONC = 6, CAP = 1500;
    // Wall-clock budget (same pattern as ENRICH_TIME_BUDGET_MS): a stalled
    // onlineonly host timing out every 20s fetch would walk this rescue past
    // the workflow's 60-min kill. Unreached lots keep their state — never drop.
    const BUDGET_MS = 8 * 60_000;
    const start = Date.now();
    const slice = targets.slice(0, CAP);
    let dated = 0, revived = 0;
    for (let i = 0; i < slice.length; i += CONC) {
      if (Date.now() - start > BUDGET_MS) {
        console.log(`  [Christie's] onlineonly budget exhausted at ${i}/${slice.length} — stopping early so the crawl still writes`);
        break;
      }
      await Promise.all(slice.slice(i, i + CONC).map(async lot => {
        try {
          const r = await fetch(lot.url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
          if (!r.ok) return;
          const h = await r.text();
          const raw = (h.match(/"end_date":"([0-9T:.\-]+Z)"/) || [])[1];
          if (!raw) return;
          const d = new Date(raw);
          if (isNaN(d.getTime())) return;
          const iso = d.toISOString();
          // the sale-location calendar day (lib/sale-day), not the UTC day
          lot.saleDate = saleDayOf("Christie's", iso, { saleName: lot.saleName, currency: (lot as AuctionLot & { nativeCurrency?: string }).nativeCurrency }) || iso.slice(0, 10);
          (lot as AuctionLot & { saleDateTime?: string }).saleDateTime = iso;
          dated++;
          if (d.getTime() > Date.now()) {
            if (lot.status !== 'upcoming') revived++;
            lot.status = 'upcoming';
            (lot as AuctionLot & { resultsPending?: boolean }).resultsPending = false;
          }
        } catch { /* unreachable → keep state; never drop */ }
      }));
      await sleep(120);
    }
    if (slice.length) console.log(`  [Christie's] onlineonly: dated ${dated}/${slice.length}, revived ${revived} wrongly-closed lots to upcoming`);
  }

  if (goldinRan) console.log(`[Ray] Goldin: promoted ${goldinPromoted} closed lots to final hammer (last-bid + premium)`);
  if (reconciledWithdrawn || reconciledUnknown) {
    // NOTE: the global sanitize net below RE-HOLDS any of these still within the
    // 14-day RESULT_PENDING window as upcoming+resultsPending (the safe, don't-
    // lose-a-lot direction), so only the >14-day 'unknown-result' ones actually
    // publish in that state. These counts are the reconcile-pass tallies, not the
    // final published statuses.
    console.log(`[Ray] Reconcile pass flagged ${reconciledWithdrawn + reconciledUnknown} vanished upcoming lots (${reconciledWithdrawn} recent→withdrawn, ${reconciledUnknown} old→unknown-result); recent ones are re-held as results-pending below`);
  }

  const allLots = Array.from(lotMap.values()).sort((a, b) => {
    const da = new Date(a.saleDate).getTime();
    const db = new Date(b.saleDate).getTime();
    if (isNaN(da) && isNaN(db)) return 0;
    if (isNaN(da)) return 1;
    if (isNaN(db)) return -1;
    return db - da;
  });

  // Enrich lots missing medium/dimensions/year from detail pages
  await enrichLots(allLots);

  // Classify every lot. comps is imported once here (dynamically, matching
  // the buildUpcoming pattern) for the form/object-class work in this pass,
  // the watch filter below, and the W16 signal-scoped image check.
  const { classifyForm, objectClassOf, computeDeepSignal, isSportsScienceObject, extractSportsTags } =
    await import('../app/lib/comps');
  // sport tag (title-derived) for the SPORT filter on the sports vertical —
  // sportOf lives in app/utils (pure, no client deps; same fn the UI uses).
  const { sportOf } = await import('../app/utils');
  const SPORT_SLUGS = new Set(['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia']);
  const categoryCounts: Record<string, number> = {};
  for (const lot of allLots) {
    lot.category = classifyLot(lot);
    // W17 — object-class tag for the watch-maker ambiguity (a Cartier
    // Panthère ring is jewelry, not a watch): stamped on 'object' lots so
    // vertical pools and pickCall can gate without re-deriving forms
    // client-side. Runs over the whole merged set, so archive records pick
    // up the tag too; a stale tag is cleared if a lot reclassifies out.
    if (lot.category === 'object') lot.objectClass = objectClassOf(lot);
    else if (lot.objectClass) delete lot.objectClass;
    // W2 — crawl-time sports/science tags (entity/objectType/eventKey/sportYear).
    // Additive, gated on the sports/science object choke point, and mirrored on
    // the objectClass cleanup: stamp when the lot qualifies, clear a stale tag
    // when it reclassifies out. Short keys so the archive stays lean.
    if (isSportsScienceObject(lot)) {
      const tags = extractSportsTags(lot.title, lot.artist);
      if (tags.entity !== undefined) lot.entity = tags.entity; else delete lot.entity;
      if (tags.objectType !== undefined) lot.objectType = tags.objectType as AuctionLot['objectType']; else delete lot.objectType;
      if (tags.eventKey !== undefined) lot.eventKey = tags.eventKey; else delete lot.eventKey;
      if (tags.sportYear !== undefined) lot.sportYear = tags.sportYear; else delete lot.sportYear;
    } else {
      if (lot.entity !== undefined) delete lot.entity;
      if (lot.objectType !== undefined) delete lot.objectType;
      if (lot.eventKey !== undefined) delete lot.eventKey;
      if (lot.sportYear !== undefined) delete lot.sportYear;
    }
    // SPORT tag — which sport a sports-vertical lot belongs to, read from the
    // title. Stamped on the three sports slugs only (null = no sport cue →
    // "Other" in the UI filter); cleared when a lot lives outside the sports
    // vertical, mirroring the entity/objectType cleanup above.
    if (SPORT_SLUGS.has(lot.artist)) lot.sport = sportOf(lot.title);
    else if (lot.sport !== undefined) delete lot.sport;

    // ── v2 IDENTITY STAMP ──────────────────────────────────────────────────
    // Persist what the value/similarity engine joins on, using the SAME pure
    // functions the backfill uses (normalize.ts), so a fresh row and a migrated
    // row are byte-identical. Runs after category/objectClass/sports tags are
    // set (objectFingerprint reads entity/objectType). Every field is additive;
    // an absent signal produces null (never fabricated identity).
    lot.formKey = classifyForm(lot);
    lot.modelKey = normModelKey(lot);
    lot.reference = normWatchKey(lot);
    lot.normalizedTitle = normNormalizeTitle(lot.title);
    // ART lots: drop the maker's own name words from the tokens — they carry
    // zero signal within a same-maker comp pool and inflate cosine between
    // unrelated works (holdout: art coverage 19.8→21.1%, edge +2pt).
    const isArtLot = !DESIGN_ARTISTS.has(lot.artist) && !OBJECT_ARTISTS.has(lot.artist);
    lot.titleTokens = titleTokens(lot.title, isArtLot ? lot.artist.split('-') : undefined);

    const { makerSlug, entityClass } = classifyEntity(lot.artist);
    lot.makerSlug = makerSlug;
    lot.entityClass = entityClass;

    const yr = extractYear(lot.year, lot.title, lot.description || undefined);
    lot.yearNum = yr.yearNum;
    lot.yearSource = yr.yearSource;
    lot.yearIsCirca = yr.yearIsCirca;

    const dims = normalizeDimensions(lot.dimensions);
    lot.heightCm = dims?.heightCm ?? null;
    lot.widthCm = dims?.widthCm ?? null;
    lot.depthCm = dims?.depthCm ?? null;
    lot.sizeClass = dims?.sizeClass ?? null;
    lot.dimSource = dims?.dimSource ?? null;

    const med = canonMedium(lot.medium);
    lot.mediumCanon = med.mediumCanon;
    lot.materialTokens = med.materialTokens;

    const ed = extractEdition(lot.title, lot.description || undefined);
    lot.editionOf = ed.editionOf;
    lot.editionTotal = ed.editionTotal;
    lot.editionMarker = ed.editionMarker;
    const ser = extractSerials(lot.title, lot.description || undefined);
    lot.serialNo = ser.serialNo;
    if (ser.caseNo) lot.caseNo = ser.caseNo;
    if (ser.movementNo) lot.movementNo = ser.movementNo;

    // collectible auth signals (game-used sports) — title-borne
    const tags = extractCollectibleTags(lot.title);
    lot.photoMatched = tags.photoMatched;
    lot.authCert = tags.authCert;
    lot.gradeLabel = tags.gradeLabel;

    // Layer-B fingerprint LAST — reads makerSlug/model/dims/edition + sports
    // tags all stamped above. NULL when discriminators are thin (never fabricate
    // exact identity — guards the Untitled collisions + the Eames over-merge).
    lot.objectFingerprint = objectFingerprint(lot);

    lot.schemaVersion = 2;

    categoryCounts[lot.category] = (categoryCounts[lot.category] || 0) + 1;
  }
  console.log(`[Ray] Category breakdown:`, categoryCounts);

  // A science slug must never hold a wristwatch-form lot — the router vetoes
  // them at intake; this form-level gate catches anything older data or a new
  // source slips through (a $150K Richard Mille was briefly the meteorites
  // "record sale" before this class of row was purged). In-place: allLots is
  // const and shared with everything downstream.
  {
    const SCI_GUARD = new Set(['meteorites', 'fossils', 'space-exploration', 'scientific-instruments']);
    let evictedSciWatch = 0;
    for (let i = allLots.length - 1; i >= 0; i--) {
      const l = allLots[i];
      if (SCI_GUARD.has(l.artist) && l.formKey === 'wristwatch') { allLots.splice(i, 1); evictedSciWatch++; }
    }
    if (evictedSciWatch) console.warn(`[Ray] evicted ${evictedSciWatch} wristwatch-form lots from science slugs`);
  }

  // The watches vertical trades WATCHES only. Cartier especially is a jeweler
  // as much as a watchmaker — maker crawls drag in thermometer cases, lipstick
  // holders, earclips, pearl sets, bracelets. A blocklist is whack-a-mole, so
  // require a POSITIVE horology signal: keep a lot only if its form is a
  // watch/clock or its text names a watch (movement, ref, a Cartier watch
  // line, etc). Everything without a watch signal is dropped.
  const WATCH_MAKERS = new Set(['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier']);
  const HOROLOGY = new Set(['wristwatch', 'pocket-watch', 'clock']);
  const WATCH_SIGNAL = /watch|montre|chronograph|chronometer|chronometre|tourbillon|calibre|caliber|\bref\.?\b|reference|automatic|self-?winding|manual wind|movement|\bdial\b|perpetual|minute repeat|moonphase|moon phase|day-?date|tank|santos|panth|ballon|pasha|tortue|baignoire|\bronde\b|roadster|\bdrive\b|cloche|oyster|cosmograph|datejust|submariner|seamaster|speedmaster|constellation|nautilus|aquanaut|calatrava|royal oak|cellini|de ville|must de|must 21|jaeger|reverso/i;
  const beforeWatch = allLots.length;
  const keptLots = allLots.filter(l => {
    if (!WATCH_MAKERS.has(l.artist)) return true;
    if (HOROLOGY.has(classifyForm(l as any))) return true;
    return WATCH_SIGNAL.test(`${l.title || ''} ${l.medium || ''}`);
  });
  if (keptLots.length < beforeWatch) {
    console.log(`[Ray] Dropped ${beforeWatch - keptLots.length} non-watch lots from watch makers (jewelry/objects)`);
  }
  allLots.length = 0;
  // NOT push(...keptLots): spread overflows the call stack past ~100k args and
  // the corpus is now ~455k. Loop-append (same fix as the backfill scripts).
  for (const l of keptLots) allLots.push(l);

  // ── W16 · dead-link guard (publish-time backstop) ──
  // Catches URLs that predate the parse-time id resolution above: an empty/
  // undefined auction segment ("auction//", "auction/undefined/") or a
  // lot/0 tail 404s at the house. Upcoming lots are DROPPED — a bid link
  // that can't be followed is not intelligence, and a flag must never sit on
  // a dead link. Sold/bought-in records are the permanent archive and are
  // never evicted here — their link is repaired to the house origin (a live
  // page) instead.
  const DEAD_URL = /auction\/(?:\/|undefined\/|null\/)|\/lot\/(?:0|undefined|null)(?:[/?#]|$)/;
  let deadDropped = 0, deadRepaired = 0;
  const linkedLots = allLots.filter(lot => {
    if (!lot.url || !DEAD_URL.test(lot.url)) return true;
    if (lot.status === 'upcoming') { deadDropped++; return false; }
    try { lot.url = new URL(lot.url).origin; deadRepaired++; } catch { /* unparsable — keep the record as-is */ }
    return true;
  });
  if (deadDropped || deadRepaired) {
    console.log(`[Ray] Dead-link guard: dropped ${deadDropped} upcoming lots, repaired ${deadRepaired} archive URLs`);
    allLots.length = 0;
    for (const l of linkedLots) allLots.push(l); // no spread — corpus > 100k args overflows
  }

  // ── W16 · image liveness, scoped to signal-bearing lots ──
  // SCOPE (deliberate): only UPCOMING lots that would carry a Below/Above
  // Market flag are probed — those are the images the flag counts and the
  // call surfaces stand on, and they run a few dozen per crawl. A full-corpus
  // check would add minutes of network time for lots nothing renders. HEAD
  // only, small concurrency, hard wall-clock budget so a stalled CDN can't
  // eat the CI window. Only a definitive 404/410 clears imageUrl — timeouts,
  // 403s and HEAD-rejecting CDNs are inconclusive, and absence of proof must
  // never strip a live image (data honesty applies to absence too).
  const IMG_CONCURRENCY = 6;
  const IMG_BUDGET_MS = 90_000;
  const flaggedLots = allLots.filter(l =>
    l.status === 'upcoming' && l.imageUrl && computeDeepSignal(l, allLots) !== null);
  if (flaggedLots.length > 0) {
    console.log(`[Ray] Image check: probing ${flaggedLots.length} flagged upcoming lots (HEAD, ${IMG_CONCURRENCY}-wide)...`);
    const imgStart = Date.now();
    let imgCursor = 0, imgCleared = 0;
    const probe = async () => {
      while (imgCursor < flaggedLots.length && Date.now() - imgStart < IMG_BUDGET_MS) {
        const lot = flaggedLots[imgCursor++];
        try {
          const res = await fetch(lot.imageUrl!, {
            method: 'HEAD',
            headers: { 'User-Agent': UA },
            redirect: 'follow',
            signal: AbortSignal.timeout(5000),
          });
          if (res.status === 404 || res.status === 410) { lot.imageUrl = null; imgCleared++; }
        } catch { /* inconclusive — keep the image */ }
      }
    };
    await Promise.all(Array.from({ length: IMG_CONCURRENCY }, probe));
    console.log(`[Ray] Image check: cleared ${imgCleared} dead image URLs in ${Math.round((Date.now() - imgStart) / 1000)}s`);
  }

  // Compute per-artist stats
  const statsByArtist: Record<string, MarketStats> = {};
  for (const artist of ARTISTS) {
    const artistLots = allLots.filter(l => l.artist === artist.slug);
    statsByArtist[artist.slug] = computeStats(artistLots, existingStatsByArtist[artist.slug] || null);
    console.log(`[Ray] ${artist.displayName}: ${artistLots.length} lots, ${artistLots.filter(l => l.status === 'sold').length} sold`);
  }

  // The eager payload + backtest run over the FULL in-memory corpus, BEFORE
  // the payload split — so the sports/science sold-comp pool and the realized
  // cohort see every Goldin sold row, not the truncated lots.json. Non-fatal:
  // the CI workflow reruns both as their own steps, so a throw here must not
  // take the crawl's lots.json down with it. Runs before the writes so a
  // precompute pass (which stamps lot.soldComp in place) lands in the split.
  try {
    const { buildUpcoming } = await import('./build-upcoming');
    buildUpcoming(DATA_DIR, allLots);
  } catch (e) {
    console.error('[Ray] buildUpcoming failed (crawl data intact):', e);
  }
  try {
    const { buildBacktest } = await import('./build-backtest');
    buildBacktest(DATA_DIR, allLots);
  } catch (e) {
    console.error('[Ray] buildBacktest failed (crawl data intact):', e);
  }

  // (imageHash removed: different houses photograph the same object differently,
  // so a perceptual hash never matches the same item across sales — Collin.
  // Same-object identity is title + structured attributes, scored as a % in
  // step 2; the fingerprint is a coarse blocking key only, imageHash is not
  // worth the network pass for near-zero cross-sale value.)

  // ── §4 WRITE-TIME VALIDATION GATE ─────────────────────────────────────────
  // assertInvariants(lots) is PURE — it returns {fatal, warn} and throws
  // nothing; the crawler owns the policy: log warnings, then THROW on any FATAL
  // so the crawl aborts with the JSON untouched (data honesty > a bad publish).
  // Imported dynamically (matching the comps/buildUpcoming pattern); the
  // consumers agent owns app/lib/validate.ts. A sold lot MUST have realizedUsd>0
  // + priceBasis + a real non-future saleDate; a non-sold lot MUST have null
  // price fields; every *Usd == native×fxRate; ids/dates well-formed. Runs on
  // the FULL corpus (allLots) BEFORE the payload split so an archive row can't
  // skip the gate; passing rows are stamped validatedAt.
  {
    const { assertInvariants } = await import('../app/lib/validate');
    const report = assertInvariants(allLots);
    for (const w of report.warn) console.warn(`[Ray] WARN invariant: ${w}`);
    if (report.fatal.length > 0) {
      console.error(`[Ray] ${report.fatal.length} FATAL invariant violation(s):`);
      for (const f of report.fatal.slice(0, 50)) console.error(`  ✗ ${f}`);
      if (report.fatal.length > 50) console.error(`  … and ${report.fatal.length - 50} more`);
      // A LARGE count means systemic corruption → abort with data untouched.
      // A SMALL count of stragglers must not block a 44k-row publish: drop just
      // those rows and publish the rest (honest — bad rows excluded, not faked).
      // The sanitize pass above already fixes the known patterns; this catches
      // the unforeseen few so the pipeline is never wedged by a handful of rows.
      const DROP_CEILING = 30;
      if (report.fatal.length > DROP_CEILING) {
        throw new Error(`assertInvariants: ${report.fatal.length} FATAL (> ${DROP_CEILING}) — systemic, refusing to publish`);
      }
      const badIds = new Set(report.fatal.map(f => (f.match(/^\[\d+\] ([^:]+):/) || [])[1]).filter(Boolean));
      const kept = allLots.filter(l => !badIds.has(l.id));
      console.warn(`[Ray] Dropping ${allLots.length - kept.length} invalid row(s) and publishing the remaining ${kept.length}.`);
      allLots.length = 0; for (const l of kept) allLots.push(l); // no spread — corpus > 100k args overflows
      const recheck = assertInvariants(allLots);
      if (recheck.fatal.length > 0) throw new Error(`assertInvariants: ${recheck.fatal.length} FATAL remain after drop — refusing to publish`);
    }
    const validatedAt = new Date().toISOString();
    for (const lot of allLots) lot.validatedAt = validatedAt;
    console.log(`[Ray] Invariant gate PASSED (${report.warn.length} warnings) — stamped validatedAt on ${allLots.length} lots`);
  }

  // ── COVERAGE TRIPWIRE ─────────────────────────────────────────────────────
  // The class of bug that hid science: a market's live lots silently vanish and
  // nobody notices until it's spotted by eye. Compare active (upcoming, incl.
  // results-pending) counts per market against the PRE-crawl corpus and shout on
  // a collapse. Non-fatal (a market can legitimately be between sale cycles), but
  // the alert line is greppable so CI can notify on it. Also logs every market's
  // before→after so a slow bleed is visible in the crawl log.
  {
    const groups: Record<string, string[]> = {
      art: ART_SLUGS, watches: WATCH_SLUGS, sports: SPORTS_SLUGS, science: SCIENCE_SLUGS,
    };
    const activeByMarket = (lots: AuctionLot[]) => {
      const m: Record<string, number> = { art: 0, watches: 0, sports: 0, science: 0 };
      for (const l of lots) {
        if (l.status !== 'upcoming') continue;
        for (const k in groups) if (groups[k].includes(l.artist)) m[k]++;
      }
      return m;
    };
    const before = coverageBefore; // pre-crawl snapshot (before in-place mutation)
    const after = activeByMarket(allLots);
    console.log('[coverage] active (upcoming) lots per market, pre-crawl → post-crawl:');
    let alerts = 0;
    for (const k of Object.keys(after)) {
      const b = before[k], a = after[k];
      // collapse = a market with real prior coverage falls to zero, or loses >60%
      const collapse = (b >= 8 && a === 0) || (b >= 20 && a < b * 0.4);
      if (collapse) alerts++;
      console.log(`[coverage]   ${k.padEnd(8)} ${String(b).padStart(4)} → ${String(a).padStart(4)}${collapse ? '   ⚠️  COVERAGE ALERT — sharp drop, investigate' : ''}`);
    }
    if (alerts) console.warn(`[Ray] ⚠️  COVERAGE ALERT: ${alerts} market(s) lost their active lots this crawl — check the crawler/source before trusting this data.`);
  }

  // ── PER-HOUSE CRAWL HEALTH + TRIPWIRE ─────────────────────────────────────
  // One machine-greppable line per house: lots_expected is the SOURCE's own
  // advertised total where a feed exposes one (Christie's sale totals, Goldin
  // facet counts — approximate, feeds can overlap), 'na' otherwise;
  // parse_errors counts lots DROPPED for a missing required field (id/title/
  // url); upcoming_prev/upcoming_now compare the pre-crawl segment book to the
  // post-merge one. Sits NEXT TO the market-level coverage tripwire above —
  // that one watches verticals, this one watches houses.
  {
    const fetchedByHouse: Record<string, number> = {};
    // LAMA rides the wright SEGMENT but reports its own line: its lots count
    // toward BOTH (the segment line is what the write gates on). Keying LAMA's
    // lots only by segment is why `house=lama lots_fetched=0` printed next to
    // "LAMA: 250 lots" every night — a counter bug, no lots were lost.
    const SUB_HOUSE: Record<string, string> = { LAMA: 'lama' };
    for (const l of freshLots) {
      const s = segOfHouse(l.auctionHouse);
      fetchedByHouse[s] = (fetchedByHouse[s] || 0) + 1;
      const sub = SUB_HOUSE[l.auctionHouse];
      if (sub && sub !== s) fetchedByHouse[sub] = (fetchedByHouse[sub] || 0) + 1;
    }
    const upcomingNowByHouse: Record<string, number> = {};
    for (const l of allLots) {
      if (l.status !== 'upcoming') continue;
      const s = segOfHouse(l.auctionHouse);
      upcomingNowByHouse[s] = (upcomingNowByHouse[s] || 0) + 1;
      const sub = SUB_HOUSE[l.auctionHouse];
      if (sub && sub !== s) upcomingNowByHouse[sub] = (upcomingNowByHouse[sub] || 0) + 1;
    }
    const housesSeen = Array.from(new Set<string>([
      ...Object.keys(fetchedByHouse), ...Object.keys(upcomingPrevByHouse),
      ...Object.keys(HEALTH.expected), ...Object.keys(HEALTH.parseErrors), ...Object.keys(HEALTH.fetched),
    ])).sort();
    for (const h of housesSeen) {
      const expected = HEALTH.expected[h] != null ? String(HEALTH.expected[h]) : 'na';
      console.log(`[health] house=${h} lots_expected=${expected} pages_fetched=${HEALTH.fetched[h] || 0} lots_fetched=${fetchedByHouse[h] || 0} parse_errors=${HEALTH.parseErrors[h] || 0} upcoming_prev=${upcomingPrevByHouse[h] || 0} upcoming_now=${upcomingNowByHouse[h] || 0}`);
    }
    // Tripwire: a house's upcoming book dropping >20% night-over-night (>30%
    // for Goldin — its live inventory naturally churns as auctions complete)
    // is the signature of a broken crawler/source, not a market move. WARN
    // loudly (greppable) but never fatal here — the segment-collapse guard
    // below owns the hard abort. ≥20-lot floor: percentage noise on a
    // handful of lots is not a signal.
    for (const h of housesSeen) {
      const prevUp = upcomingPrevByHouse[h] || 0;
      const nowUp = upcomingNowByHouse[h] || 0;
      const tolerance = h === 'goldin' ? 0.3 : 0.2;
      if (prevUp >= 20 && nowUp < prevUp * (1 - tolerance)) {
        console.warn(`[Ray] ⚠️  HOUSE TRIPWIRE: ${h} upcoming dropped ${prevUp} → ${nowUp} (>${Math.round(tolerance * 100)}% night-over-night) — check the crawler/source before trusting this segment.`);
      }
    }
  }

  // ── SEGMENTED NIGHTLY: a house run owns ONE segment. Write just this house's
  // lots and STOP — the full-corpus write + engine + served build belong to
  // assemble.ts, which reunions every segment. Last-good guard: a crawl that
  // collapsed its own segment must never overwrite the good one (isolated
  // failure ≠ data loss).
  if (CRAWL_HOUSE) {
    const { writeSegment, segmentOf } = await import('./corpus-io');
    const segLots = allLots.filter(l => segmentOf((l as AuctionLot).auctionHouse) === CRAWL_HOUSE);
    // LEG HEALTH (leg-health.json + ::error:: — scripts/lib/leg-health.ts):
    // written BEFORE the hard guards below so a guarded abort still leaves a
    // record. ok=false when the source answered but nothing parsed (silent
    // zero), when nothing was fetched at all (source down / wall), or when the
    // segment would collapse.
    {
      const { reportLegHealth } = await import('./lib/leg-health');
      const pagesFetched = HEALTH.fetched[CRAWL_HOUSE] || 0;
      const fresh = freshLots.filter(l => segmentOf(l.auctionHouse) === CRAWL_HOUSE);
      const settled = fresh.filter(l => l.status === 'sold' || l.status === 'bought_in').length;
      const reasons: string[] = [];
      if (pagesFetched > 0 && fresh.length === 0) reasons.push(`${pagesFetched} lot-bearing page(s) fetched but 0 lots parsed (parse_errors=${HEALTH.parseErrors[CRAWL_HOUSE] || 0})`);
      if (pagesFetched === 0 && fresh.length === 0) reasons.push('no lot-bearing page fetched and 0 lots parsed — source down or walled');
      if (existingLots.length > 200 && segLots.length < existingLots.length * 0.7) reasons.push(`segment would collapse ${existingLots.length} → ${segLots.length}`);
      reportLegHealth({ house: CRAWL_HOUSE, ok: reasons.length === 0, fetched: pagesFetched, parsed: fresh.length, settled, reason: reasons.join('; ') || null });
      // sub-houses crawled inside this leg (LAMA rides the wright job)
      for (const [house, sub] of [['LAMA', 'lama']] as const) {
        if (segmentOf(house) !== CRAWL_HOUSE) continue;
        const subFetched = HEALTH.fetched[sub] || 0;
        const subFresh = freshLots.filter(l => l.auctionHouse === house);
        const subSettled = subFresh.filter(l => l.status === 'sold' || l.status === 'bought_in').length;
        const subOk = !(subFetched > 0 && subFresh.length === 0);
        reportLegHealth({ house: sub, ok: subOk, fetched: subFetched, parsed: subFresh.length, settled: subSettled, reason: subOk ? null : `${subFetched} page(s) fetched but 0 lots parsed` });
      }
    }
    // SILENT-ZERO guard (Sep 2 2026 audit): the source ANSWERED — lot-bearing
    // pages came back 2xx (HEALTH.fetched, see noteFetched) — yet this run
    // parsed NOTHING for the house. That is a markup change, a wall page
    // served as 200, or a regex that stopped matching; it is never an empty
    // market. Refuse the write so the last-good segment rides. (Bootstrap —
    // no prior segment — passes so a brand-new house can still seed.)
    {
      const pagesFetched = HEALTH.fetched[CRAWL_HOUSE] || 0;
      const parsedFresh = freshLots.filter(l => segmentOf(l.auctionHouse) === CRAWL_HOUSE).length;
      if (pagesFetched > 0 && parsedFresh === 0 && existingLots.length > 0) {
        throw new Error(`[Ray] SILENT-ZERO: segment ${CRAWL_HOUSE} — ${pagesFetched} lot-bearing page(s) fetched but 0 lots parsed this run (parse_errors=${HEALTH.parseErrors[CRAWL_HOUSE] || 0}) — refusing to write; the last-good segment rides`);
      }
    }
    // Tightened 0.5 → 0.7: a house shrinking >30% overnight is a crawler/source
    // failure, not a market — abort the write, keep the last-good segment.
    // (>200-lot floor unchanged: tiny segments swing legitimately.)
    if (existingLots.length > 200 && segLots.length < existingLots.length * 0.7) {
      throw new Error(`[Ray] segment ${CRAWL_HOUSE} collapsed ${existingLots.length} → ${segLots.length} (>30%) — refusing to overwrite the last-good segment`);
    }
    // Belt-and-braces under the 200-lot floor: a zero-lot seed while the
    // segment file exists on disk means the corpus load failed upstream and
    // this write would be fresh-only. (Bootstrap = no file at all — passes.)
    if (existingLots.length === 0 && fs.existsSync(path.join('data', 'corpus', 'segments', `${CRAWL_HOUSE}.ndjson.gz`))) {
      throw new Error(`[Ray] segment ${CRAWL_HOUSE}: zero-lot seed but the segment file exists on disk — refusing a fresh-only overwrite`);
    }
    writeSegment(CRAWL_HOUSE, segLots as unknown as Record<string, unknown>[]);
    console.log(`[Ray] segment ${CRAWL_HOUSE}: wrote ${segLots.length} lots (was ${existingLots.length}) — assemble reunions + builds.`);
    return;
  }

  // W3 · Payload split at write time. Goldin *sold* is ~35% of the corpus and
  // no estimate engine ever reads it (signal/backtest/demand all require
  // estimates Goldin never has), so it moves to a lazy sold-archive.json;
  // lots.json keeps everything else (incl. Goldin *upcoming*). lots.json is
  // minified (like upcoming.json): every first-visit client streams the whole
  // file, so indentation is pure waste.
  const isGoldinSold = (l: AuctionLot) => l.auctionHouse === 'Goldin' && l.status === 'sold';
  // Full v2 corpus (gz, source of truth) + slim served files (client). The
  // corpus carries every engine field; the client gets a null-omitted display
  // projection under Cloudflare's 25MB/file cap. See scripts/corpus-io.ts.
  // ── PUBLISH SANITY GATE ───────────────────────────────────────────────
  // The last line of defense before the corpus is written and self-deployed:
  // compare against the PREVIOUS corpus and refuse to publish a collapse. A
  // crawler regression that silently drops a house/vertical must fail the run
  // loudly (no commit, no deploy, yesterday's good data keeps serving) — not
  // ship a hollowed-out book. Growth is never blocked; only shrinkage is.
  {
    try {
      const { readGzRows } = await import('./corpus-io');
      const prevPath = path.join(process.cwd(), 'data', 'corpus', 'lots.json.gz');
      if (fs.existsSync(prevPath)) {
        // buffer-safe NDJSON read — the corpus is NDJSON now, and a raw
        // gunzip.toString+JSON.parse both throws on it AND blows the 512MB
        // string limit, which the catch below would silently swallow — disabling
        // this entire gate. readGzRows handles NDJSON (+ legacy arrays).
        const prev = readGzRows(prevPath) as { status?: string; auctionHouse?: string }[];
        const prevTotal = prev.length;
        const newTotal = allLots.filter(l => !isGoldinSold(l)).length;
        if (prevTotal > 1000 && newTotal < prevTotal * 0.97) {
          throw new Error(`corpus shrank ${prevTotal} → ${newTotal} (>3%) — refusing to publish`);
        }
        const prevSold = prev.filter(l => l.status === 'sold').length;
        const newSold = allLots.filter(l => l.status === 'sold' && !isGoldinSold(l)).length;
        if (prevSold > 1000 && newSold < prevSold * 0.97) {
          throw new Error(`sold book shrank ${prevSold} → ${newSold} (>3%) — refusing to publish`);
        }
        const prevHouses = new Set(prev.map(l => l.auctionHouse)).size;
        const newHouses = new Set(allLots.map(l => l.auctionHouse)).size;
        if (newHouses < prevHouses) {
          throw new Error(`an auction house vanished (${prevHouses} → ${newHouses}) — refusing to publish`);
        }
        console.log(`[Ray] publish gate OK: lots ${prevTotal}→${newTotal}, sold ${prevSold}→${newSold}, houses ${prevHouses}→${newHouses}`);
      }
    } catch (e) {
      if (String(e).includes('refusing to publish')) throw e;
      console.warn('[Ray] publish gate check skipped:', e);
    }
  }

  const { writeCorpusAndServed } = await import('./corpus-io');
  const io = writeCorpusAndServed(
    allLots as unknown as Record<string, unknown>[],
    (l: Record<string, unknown>) => isGoldinSold(l as unknown as AuctionLot),
  );
  console.log(`[Ray] Wrote corpus ${io.corpusMb}+${io.archiveMb}MB gz | served lots.json ${io.servedMb}MB (slim)`);
  fs.writeFileSync(statsPath, JSON.stringify(statsByArtist, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'meta.json'), JSON.stringify({
    lastCrawl: new Date().toISOString(),
    artists: ARTISTS.map(a => ({ slug: a.slug, displayName: a.displayName })),
    // derived from the data so it never drifts as houses are added
    sources: Array.from(new Set(allLots.map(l => l.auctionHouse))).sort(),
    // W4 · full-corpus totals so the home aggregate counts + Colophon read
    // honest numbers without paying for the lazy sold-archive.json.
    totalLots: allLots.length,
    totalSold: allLots.filter(l => l.status === 'sold').length,
    // ── PRICE BASIS DECLARATION ─────────────────────────────────────────
    // Read scripts/price-basis.ts before writing ANY code that compares a sold
    // price to an estimate. Shared with assemble.ts, which used to drop it.
    priceBasis: PRICE_BASIS,
    // Sold lots per calendar year — proves the archive's time depth rather than
    // asserting it, and is what /about charts in §01.
    soldByYear: soldByYear(allLots),
    coverage: houseCoverage(allLots),
    version: 2,
  }, null, 2));

  // ── PART-2 ENGINE PASS ──────────────────────────────────────────────────
  // Value the upcoming lots, group repeat sales, and build the market
  // dashboards from the freshly-written corpus. Non-fatal: a failure here
  // leaves the crawl's data intact (the engine outputs just go stale a day).
  try {
    const { runMarketBuild } = await import('./build-market');
    await runMarketBuild();
  } catch (e) {
    console.error('[Ray] market/value engine pass failed (crawl data intact):', e);
  }

  console.log(`\n[Ray] Done. ${allLots.length} total lots written (corpus gz + slim served + engine).`);
}

// Re-exports: the house registry (record/replay harness, tests) and the names
// older scripts import from here (backfill-lama, backfill-bonhams-artists, …).
export { HOUSES as HOUSE_REGISTRY } from './lib/houses';
export { HEALTH, balancedObjectAfter } from './lib/houses/common';
export { ARTISTS } from './lib/houses/artists';
export { crawlLama } from './lib/houses/lama';
export { crawlBonhams } from './lib/houses/bonhams';
export { isPlaceholderClose } from './lib/houses/goldin';

// RAY_SKIP_MAIN lets a test import the crawler's exported functions without
// triggering a full corpus crawl. Default (unset) = normal run, unchanged.
if (!process.env.RAY_SKIP_MAIN) {
  main().catch(async err => {
    console.error('[Ray] Fatal error:', err);
    // a segmented leg that dies (or trips a hard guard — SILENT-ZERO, collapse)
    // still leaves its health record; the exit code is unchanged
    if (CRAWL_HOUSE) {
      try {
        const { reportLegHealth } = await import('./lib/leg-health');
        reportLegHealth({ house: CRAWL_HOUSE, ok: false, fetched: HEALTH.fetched[CRAWL_HOUSE] || 0, parsed: 0, settled: 0, reason: String((err as Error)?.message || err).slice(0, 300) });
      } catch { /* health is best-effort; never mask the real failure */ }
    }
    process.exit(1);
  });
}
