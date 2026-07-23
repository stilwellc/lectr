/**
 * backfill-sothebys-algolia.ts — the Sotheby's Algolia discovery backfill.
 *
 * sothebys.com's public search UI is backed by a public, no-auth Algolia index
 * (`bsp_dotcom_prod_en`) whose search-only creds are embedded in the search page
 * HTML (proven by resolve-sothebys.ts). Every `type:Lot AND soldStatus:SOLD` hit
 * carries the realized total (`salePrice`, buyer-inclusive), native currency
 * (`estimateCurrency` / the "Sale price: N CUR" tail of `details`),
 * lowEstimate/highEstimate, the canonical lot `url`, `title`, `artistName`,
 * `brands`, `departments`, and a numeric `endDate` (epoch-ms). ~1.37M sold lots
 * are indexed; ~370K are in-scope net-new (the goldmine this script harvests).
 *
 * ── how it stays inside Algolia's 1000-hit hard pagination cap ──
 * We NEVER page past 1000. Instead we enumerate exhaustively by recursive
 * endDate numeric-range BISECTION per in-scope department: query a department
 * over a [lo,hi) endDate window with hitsPerPage:0 to read nbHits; if >1000,
 * split the window at its midpoint and recurse; once a window has ≤1000 hits,
 * page it out fully (hitsPerPage:1000, one page). This mirrors the Goldin
 * auction-enumeration backfill and guarantees every sold lot in an in-scope
 * department is seen exactly once.
 *
 * ── the department allowlist (load-bearing) ──
 * Only lectr verticals are queried (Contemporary/Impressionist/Modern/Old Master
 * art, Prints, Photographs, 20th C Design + furniture, Watches, Jewelry,
 * Sneakers/Sports Memorabilia, Popular Culture, Handbags/Fashion). Wine, whisky,
 * books/manuscripts, Chinese/Asian works of art, silver, ceramics/glass, rugs,
 * antiquities etc. (~1M out-of-scope sold lots, ~322K of them net-new noise) are
 * never fetched.
 *
 * ── routing (ITEM-FIRST — the doctrine: item text decides, never the sale) ──
 * Each in-scope lot routes to a tracked slug via the repo's routers, exactly as
 * ray-crawl.ts's nightly ingest wires them: routeItem(artistName/brands, title)
 * FIRST — a tracked maker (Picasso, Rolex, …) always wins its own bucket. ONLY
 * when routeItem finds nothing tracked do we fall back to the SALE-scoped
 * memorabilia routers: sports SALES (isSportsSale on the URL's sale slug) →
 * routeSportsLot; else culture SALES (isCultureSale) → routeCulture. A lot that
 * routes to nothing tracked is SKIPPED — never guessed. (Routing the sale first
 * was a P0 bug: it buried tracked-maker fine-art that sold in culture-/sports-
 * named sales — e.g. an $18M Picasso in the "Icons" sale → entertainment-memorabilia.)
 *
 * ── scale safeguard ──
 * These lots have THIN metadata (title/fullText only — no dimensions, reference,
 * edition). Marked `source:'sothebys-algolia'`, they feed stats.json / market
 * series / records / the sold archive but are HELD OUT of the heavy engine pool
 * (repeat-sale grouping + per-lot valuation) by build-market's engineAll filter —
 * the same architecture sports-cards use.
 *
 * ── money ──
 * stampSold() (same shape resolve-sothebys.ts uses): dated-FX, priceBasis
 * 'realized', premium-inclusive salePrice → premiumNative, estimates from
 * lowEstimate/highEstimate. FX-unsupported currencies are skipped (never
 * coerced).
 *
 * DRY-RUN by default (full discovery report). `--write` rewrites the sothebys
 * segment (local only; the nightly owns the R2 push). Checkpointed so a crash
 * resumes. Loop-append everywhere (spread overflows past ~100K).
 * Run: NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/backfill-sothebys-algolia.ts [--write]
 */
import * as fs from 'fs';
import * as path from 'path';

import type { AuctionLot, Currency, LotCategory, PriceBasis } from '../app/types';
import {
  toUsdDated, fxRateFor, normalizeDimensions, extractYear, canonMedium,
  extractEdition, extractSerial, extractCollectibleTags, classifyEntity,
  objectFingerprint, titleTokens,
  modelKey as normModelKey, watchKey as normWatchKey,
  normalizeTitle as normNormalizeTitle,
} from '../app/lib/normalize';
import { readSegment, writeSegment } from './corpus-io';
import { isSportsSale, routeSportsLot } from './sports-sale';
import { isCultureSale, routeCulture } from './culture';

/* ── config ──────────────────────────────────────────────────────────────── */

const WRITE = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CONC = 4;                       // parallel Algolia queries
const WORK_DIR = '/private/tmp/uiaudit';
const CKPT = path.join(WORK_DIR, 'sothebys-algolia-ckpt.ndjson');   // resumable discovery
const CURSOR = path.join(WORK_DIR, 'sothebys-algolia-cursor.json'); // which departments are done

const ALGOLIA_FALLBACK = { appId: 'O28SY4Q7WU', apiKey: 'e732e65c70ebf8b51d4e2f922b536496', index: 'bsp_dotcom_prod_en' };
const SUPPORTED_CUR = new Set<Currency>(['USD', 'GBP', 'EUR', 'HKD', 'CNY', 'AUD', 'CHF']);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── DEPARTMENT ALLOWLIST — lectr verticals only. Exact facet strings from the
// live index (probed). Everything not here (Wine, Whisky & Spirits, Books &
// Manuscripts, all Chinese/Asian/Islamic/Indian works, Silver, European
// Ceramics & Glass, Rugs & Carpets, antiquities/Ancient/Pre-Columbian, Objects
// of Vertu, Russian/African/regional works, Clocks & Barometers) is OUT.
const ALLOW_DEPARTMENTS = [
  'Contemporary Art',
  'Impressionist & Modern Art',
  'Modern British & Irish Art',
  'American Art',
  'Latin American Art',
  'Old Master Paintings',
  'Old Master Drawings',
  'Prints',
  'Photographs',
  'Digital Art',
  '20th Century Design',
  'French & Continental Furniture',
  'English Furniture',
  'American Furniture, Decorative Art & Folk Art',
  'European Sculpture & Works of Art',
  'Watches',
  'Jewelry',
  'Sneakers, Sports Memorabilia & Modern Collectibles',
  'Handbags & Fashion',
  'Popular Culture',
];

/* ── money stamping — same sold-branch shape as resolve-sothebys.ts's stampSold ── */
function stampSold(cur: Currency, saleDate: string, premiumNative: number, estLowNative: number | null, estHighNative: number | null) {
  const { rate, asOf } = fxRateFor(cur, saleDate);
  const conv = (n: number | null) => toUsdDated(n, cur, saleDate).usd;
  const estLowUsd = conv(estLowNative), estHighUsd = conv(estHighNative);
  const realizedUsd = conv(premiumNative);
  return {
    nativeCurrency: cur,
    hammerNative: null, premiumNative, realizedNative: premiumNative,
    buyerPremiumPct: null,
    fxRate: rate, fxAsOf: asOf,
    hammerUsd: null, premiumUsd: realizedUsd, realizedUsd,
    estLowNative, estHighNative, estLowUsd, estHighUsd,
    priceBasis: 'realized' as PriceBasis,
    currency: cur, estimateLow: estLowUsd, estimateHigh: estHighUsd,
    hammerPrice: null, premiumPrice: premiumNative, priceUsd: realizedUsd,
  };
}

/* ── item routing (verbatim from backfill-sothebys-slugs.ts — the doctrine) ── */

const ART_MAKER_ROUTES: [RegExp, string][] = [
  [/\bgeorge condo\b/, 'george-condo'],
  [/\bkaws\b/, 'kaws'],
  [/\bandy warhol\b|\bwarhol\b/, 'andy-warhol'],
  [/\bkeith haring\b|\bharing\b/, 'keith-haring'],
  [/\bed(ward)? ruscha\b|\bruscha\b/, 'ed-ruscha'],
  [/\bpablo picasso\b|\bpicasso\b/, 'pablo-picasso'],
  [/\bhenri matisse\b|\bmatisse\b/, 'henri-matisse'],
  [/\btom sachs\b/, 'tom-sachs'],
  [/\bpeter saul\b/, 'peter-saul'],
  [/\braymond pettibon\b|\bpettibon\b/, 'raymond-pettibon'],
  [/\bbarry mcgee\b/, 'barry-mcgee'],
  [/\bfutura\s?2000\b|\bfutura\b/, 'futura-2000'],
  [/\brobert crumb\b|\br\.?\s?crumb\b/, 'r-crumb'],
  [/\bfab(ulous)?\s5\sfreddy\b|\bfred(erick)? brathwaite\b/, 'fab-5-freddy'],
  [/\bfrancesco clemente\b|\bclemente\b/, 'francesco-clemente'],
  [/\beddie martinez\b/, 'eddie-martinez'],
  [/\bkenny scharf\b|\bscharf\b/, 'kenny-scharf'],
  // design
  [/\bgeorge nakashima\b|\bnakashima\b/, 'george-nakashima'],
  [/\bcharles (and |& )?ray eames\b|\b(charles|ray) eames\b|\beames\b/, 'charles-eames'],
  [/\bprouv[eé]/, 'jean-prouve'],
  [/\bpierre jeanneret\b|\bjeanneret\b/, 'pierre-jeanneret'],
];

function routeItem(creators: string | null, title: string, extra = ''): string | null {
  const t = `${creators || ''} ${title} ${extra}`.toLowerCase();
  if (/\b(topps|bowman|panini|goudey|fleer|donruss|upper deck|rookie card|trading card|tobacco (card|silk)|pok[eé]mon|yu-?gi-?oh|\btcg\b)\b/.test(t)) return null;
  if (/\brolex\b/.test(t)) return 'rolex';
  if (/\bpatek\b/.test(t)) return 'patek-philippe';
  if (/\baudemars\b/.test(t)) return 'audemars-piguet';
  if (/\bomega\b/.test(t)) return 'omega';
  if (/\bcartier\b/.test(t)) return 'cartier';
  for (const [re, slug] of ART_MAKER_ROUTES) if (re.test(t)) return slug;
  if (/meteorite|pallasite|tektite|moldavite|chondrite|gibeon|seymchan|impactite|lunar meteorite|martian/.test(t)) return 'meteorites';
  if (/fossil|dinosaur|trilobite|ammonite|megalodon|mammoth|mosasaur|tyrannosaur|triceratops|pterosaur|ichthyosaur|plesiosaur|neanderthal|paleolithic|petrified|tooth of|amber with|coprolite|stromatolite/.test(t)) return 'fossils';
  if (/\b(skeletons?|skulls?|tusks?|claws?|jaws?)\b/.test(t) && /\b(prehistoric|cretaceous|jurassic|triassic|permian|eocene|oligocene|miocene|pliocene|pleistocene|ice age|saber[- ]tooth(ed)?|cave (bear|lion)|woolly|dire wolf|raptor|extinct)\b/.test(t)) return 'fossils';
  if (/apollo|nasa|space[- ]flown|space (exploration|shuttle|suit|program|station)|spacesuit|lunar|astronaut|cosmonaut|sputnik|gemini \d|soyuz|vostok|skylab|\brocket\b|x-15|satellite|mission (control|patch)|flight plan|star chart/.test(t)) return 'space-exploration';
  if (/\b(nintendo|sega|playstation|\bxbox\b|game ?boy|atari (2600|vcs|jaguar|lynx|5200|7800)|super nintendo|sega (genesis|saturn|dreamcast)|\bnes\b|\bsnes\b|game cartridge|arcade (cabinet|machine)|video ?game)\b/.test(t)) return null;
  if (/telescope|microscope|astrolabe|sextant|octant|orrery|armillary|barometer|theodolite|chronometer\b|slide rule|surveying|globe\b|celestial|enigma machine|cipher|calculat(or|ing)|typewriter|computer|macintosh|apple[- ](1|ii)|altair|commodore|prototype|patent model|anatomical|medical (instrument|kit)|laboratory|einstein|newton|darwin|curie|tesla|edison|bell labs|bell telephone laborator|transistor|semiconductor|integrated circuit|microprocessor|vacuum tube|punch(ed)? card|mainframe|eniac|univac|\bcray\b|\bibm\b|pdp-\d|\bvax\b|apple lisa|\bnext(cube|step)?\b|xerox (alto|parc|star)|difference engine|analytical engine|babbage|\bturing\b|von neumann|shockley|grace hopper|wozniak|steve jobs|kenbak|imsai|trs-80|\bamiga\b|osborne 1|manuscript.*(scien|math|physic)|first edition.*(scien|math|physic)/.test(t)) return 'scientific-instruments';
  if (/\b(cards?|n172|t20[0-9]|tobacco (card|silk)|psa\b|sgc\b|topps|bowman|panini|goudey|leaf\b|cabinet (photo|card)|carte de visite)\b/.test(t)) return null;
  if (/\b(game[- ](used|worn|issued)|match[- ](used|worn)|player[- ]worn|team[- ]issued|tour[- ](used|worn)|worn (jersey|uniform|cleats|boots|gloves|jacket|cap|shirt)|game (bat|ball|jersey|uniform|glove|worn)|match[- ]worn (shirt|jersey|boots))\b/.test(t)) return 'game-used';
  if (/\b(trophy|championship (ring|trophy|belt|pennant)|title belt|winners? medal|olympic (medal|torch)|world series (ring|trophy)|super bowl ring|mvp award|heisman|vince lombardi|stanley cup|green jacket|lombardi trophy)\b/.test(t)) return 'trophies-awards';
  if (/\b(full ticket|ticket stub|game[- ]used ticket|world series ticket|super bowl ticket|world cup (ticket|final ticket)|olympic ticket|season pass|press pass|all[- ]access (pass|credential))\b/.test(t)) return 'tickets-passes';
  return null; // nothing we track — never guess
}

/* ── lot classification (verbatim from backfill-sothebys-slugs.ts) ────────── */

const DESIGN_ARTISTS = new Set(['george-nakashima', 'charles-eames', 'jean-prouve', 'pierre-jeanneret']);
const OBJECT_ARTISTS = new Set([
  'rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier',
  'meteorites', 'fossils', 'space-exploration', 'scientific-instruments',
  'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia',
  'movie-tv', 'music-memorabilia', 'entertainment-memorabilia',
]);
const EDITION_DEFAULT_ARTISTS = new Set(['andy-warhol', 'keith-haring', 'ed-ruscha', 'henri-matisse', 'pablo-picasso']);
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
const TITLE_EDITION_PATTERNS = /\b(plates?\s*,?\s*from\b|,\s*from\s+[A-Z]|\bfrom\s+the\s+portfolio\b|\bfrom\s+(?:Myths|Ads|Flowers|Marilyn|Mao|Campbell|Electric Chair|Endangered Species|Cowboys and Indians|Ladies and Gentlemen|Flash|Martha Graham|Hans Christian Andersen|Wild Raspberries|In the Bottom|Ten Portraits|Space Fruit|Sunset|Ingrid Bergman|Reigning Queens))\b/i;

function classifyLot(lot: AuctionLot): LotCategory {
  if (OBJECT_ARTISTS.has(lot.artist)) return 'object';
  const medium = (lot.medium || '').toLowerCase();
  const title = (lot.title || '').toLowerCase();
  const saleName = (lot.saleName || '').toLowerCase();
  const url = (lot.url || '').toLowerCase();
  const text = `${medium} ${title}`;
  const isDesignArtist = DESIGN_ARTISTS.has(lot.artist);
  if (medium) {
    if (PHOTO_PATTERNS.test(medium)) return 'photograph';
    if (PRINT_PATTERNS.test(medium)) return 'print';
    if (SCULPTURE_PATTERNS.test(medium)) return 'sculpture';
    if (DESIGN_PATTERNS.test(medium)) return 'design';
    if (ORIGINAL_PATTERNS.test(medium)) return 'original';
  }
  if (PHOTO_PATTERNS.test(title)) return 'photograph';
  if (PRINT_PATTERNS.test(title)) return 'print';
  if (SCULPTURE_PATTERNS.test(title)) return 'sculpture';
  if (DESIGN_PATTERNS.test(title)) return 'design';
  if (TITLE_EDITION_PATTERNS.test(lot.title)) return 'print';
  if (/prints?\s*[&+]\s*multiples?/i.test(saleName) || /prints?\s+unlimited/i.test(saleName)) return 'print';
  if (/photograph/i.test(saleName)) return 'photograph';
  if (/design/i.test(saleName) || /furniture/i.test(saleName)) return 'design';
  if (/\/prints?\b/i.test(url)) return 'print';
  if (/\/photograph/i.test(url)) return 'photograph';
  if (/\/design/i.test(url)) return 'design';
  if (isDesignArtist) return 'design';
  if (EDITION_DEFAULT_ARTISTS.has(lot.artist)) return 'print';
  if (ORIGINAL_DEFAULT_ARTISTS.has(lot.artist)) return 'original';
  if (medium && ORIGINAL_PATTERNS.test(text)) return 'original';
  return 'unknown';
}

/* ── Algolia plumbing ────────────────────────────────────────────────────── */

type Creds = { appId: string; apiKey: string; index: string };

/** Scrape the public search-only creds off the search page; fall back to the
 *  last-known-good set (reuse of resolve-sothebys.ts's algoliaCreds). */
async function algoliaCreds(): Promise<Creds> {
  try {
    const r = await fetch('https://www.sothebys.com/en/search', { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const html = r.ok ? await r.text() : '';
    const appId = (html.match(/ALGOLIA_SEARCH_APP_ID['":\s]+([A-Z0-9]{8,12})/) || [])[1];
    const apiKey = (html.match(/ALGOLIA_SEARCH_API_KEY['":\s]+([a-f0-9]{32})/) || [])[1];
    const index = (html.match(/ALGOLIA_SEARCH_INDEX['":\s]+([a-z0-9_]+)/) || [])[1];
    if (appId && apiKey && index) return { appId, apiKey, index };
  } catch { /* fall through */ }
  return ALGOLIA_FALLBACK;
}

type Hit = {
  url?: string; title?: string | null; salePrice?: number | null; hammerPrice?: number | null;
  details?: string | null; soldStatus?: string | null;
  lowEstimate?: number | null; highEstimate?: number | null; estimateCurrency?: string | null;
  artistName?: string | null; artists?: string[]; brands?: string[];
  departments?: string[]; endDate?: number | null; imageAltText?: string | null;
  landscapeImage?: string | null; portraitImage?: string | null; image?: string | null;
  lotNumber?: string | number | null; itemId?: string | null; objectID?: string | null;
};

type AlgoliaResp = { nbHits: number; hits: Hit[] };

async function algoliaRaw(c: Creds, body: Record<string, unknown>): Promise<AlgoliaResp> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`https://${c.appId}-dsn.algolia.net/1/indexes/${c.index}/query`, {
        method: 'POST',
        headers: { 'x-algolia-application-id': c.appId, 'x-algolia-api-key': c.apiKey, 'content-type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (r.status === 429 || r.status >= 500) { await sleep(500 * (attempt + 1)); continue; }
      if (!r.ok) return { nbHits: 0, hits: [] };
      const j = (await r.json()) as { nbHits?: number; hits?: Hit[] };
      return { nbHits: j.nbHits || 0, hits: j.hits || [] };
    } catch { await sleep(400 * (attempt + 1)); }
  }
  return { nbHits: 0, hits: [] };
}

const ATTRS = ['url', 'title', 'salePrice', 'hammerPrice', 'details', 'soldStatus',
  'lowEstimate', 'highEstimate', 'estimateCurrency', 'artistName', 'artists', 'brands',
  'departments', 'endDate', 'imageAltText', 'landscapeImage', 'portraitImage', 'image',
  'lotNumber', 'itemId', 'objectID'];

// Algolia's `nbHits` is APPROXIMATE (exhaustiveNbHits:false) — an estimate can
// read <1000 for a window that really holds >1000, and a single page tops out
// at 1000. So the estimate is only a HINT for *whether* to bisect; leaf
// correctness is decided by the ACTUAL page: if a fetched window returns a full
// page (length ≥ PAGE_LEAF), it truly overflowed and MUST be split further.
// PAGE_LEAF is set below 1000 so a window whose true count sits just under the
// cap is still safely paged in one shot; the estimate threshold is lower still.
const PAGE_LEAF = 1000;          // Algolia's hard per-page ceiling
const EST_BISECT = 700;          // conservative estimate cutoff → bisect

/** One page of a window (hitsPerPage:PAGE_LEAF), returning the hits AND the
 *  estimated nbHits. length===PAGE_LEAF ⇒ the window is truncated (overflowed). */
async function pageWindow(c: Creds, dep: string, lo: number, hi: number): Promise<{ hits: Hit[]; nb: number }> {
  const r = await algoliaRaw(c, {
    query: '', hitsPerPage: PAGE_LEAF,
    filters: `type:Lot AND soldStatus:SOLD AND departments:"${dep}"`,
    numericFilters: [`endDate>=${lo}`, `endDate<${hi}`],
    attributesToRetrieve: ATTRS,
  });
  return { hits: r.hits, nb: r.nbHits };
}
/** Cheap count-only probe (hitsPerPage:0) — the estimate hint for bisection. */
async function estWindow(c: Creds, dep: string, lo: number, hi: number): Promise<number> {
  const r = await algoliaRaw(c, {
    query: '', hitsPerPage: 0,
    filters: `type:Lot AND soldStatus:SOLD AND departments:"${dep}"`,
    numericFilters: [`endDate>=${lo}`, `endDate<${hi}`],
  });
  return r.nbHits;
}

/* ── url / dedupe helpers (reuse of resolve-sothebys.ts's urlTail) ────────── */

// Sotheby's lot URLs come in TWO shapes, both of which must yield a stable
// year/sale/lot tail for cross-format dedupe:
//   new       …/buy/auction/2021/{sale-slug}/{lot-slug}
//   ecatalogue…/auctions/ecatalogue/2016/{sale-slug}-{saleNum}/lot.34.html
// The trailing saleNumber suffix on the ecatalogue sale-slug is stripped so a
// lot that was re-catalogued under both shapes still keys the same.
const urlTail = (u: string): string | null => {
  const s = (u || '').toLowerCase();
  let m = s.match(/\/ecatalogue\/(\d{4})\/([a-z0-9-]+?)(?:-[a-z]?\d{3,})?\/lot\.([\w.]+?)\.html/i);
  if (m) return `${m[1]}/${m[2]}/lot${m[3]}`;
  m = s.match(/\/auction\/(\d{4})\/([a-z0-9-]+)\/([a-z0-9-]+?)\/?(?:[?#]|$)/i);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  // last-ditch generic: year/seg/seg anywhere
  m = s.match(/\/(\d{4})\/([a-z0-9-]+)\/([a-z0-9-.]+?)\/?(?:[?#]|$)/i);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : null;
};
/** The `year/sale-slug` sale key from a lot URL — feeds isSportsSale/isCultureSale.
 *  Handles both the new /buy/auction/ and legacy /ecatalogue/ URL shapes. */
const saleKey = (u: string): string => {
  const s = (u || '');
  let m = s.match(/\/ecatalogue\/(\d{4})\/([a-z0-9-]+?)(?:-[a-z]?\d{3,})?\/lot\./i);
  if (m) return `${m[1]}/${m[2]}`;
  m = s.match(/\/auction\/(\d{4})\/([a-z0-9-]+)/i);
  return m ? `${m[1]}/${m[2]}` : '';
};

const detailsCurrency = (details: string) => (details.match(/Sale price:\s*[\d,.]+\s*([A-Z]{3})/) || [])[1] as Currency | undefined;

/* ── v2 identity stamp (mirrors backfill-sothebys-slugs.ts's post-merge stamp) ── */

const SPORT_SLUGS = new Set(['game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia']);

async function stampIdentity(rows: (AuctionLot & Record<string, unknown>)[]): Promise<void> {
  const { objectClassOf, isSportsScienceObject, extractSportsTags, classifyForm } =
    await import('../app/lib/comps');
  const { sportOf } = await import('../app/utils');
  for (const lot of rows) {
    lot.category = classifyLot(lot);
    if (lot.category === 'object') (lot as Record<string, unknown>).objectClass = objectClassOf(lot);
    if (isSportsScienceObject(lot)) {
      const tags = extractSportsTags(lot.title, lot.artist);
      if (tags.entity !== undefined) (lot as Record<string, unknown>).entity = tags.entity;
      if (tags.objectType !== undefined) (lot as Record<string, unknown>).objectType = tags.objectType;
      if (tags.eventKey !== undefined) (lot as Record<string, unknown>).eventKey = tags.eventKey;
      if (tags.sportYear !== undefined) (lot as Record<string, unknown>).sportYear = tags.sportYear;
    }
    if (SPORT_SLUGS.has(lot.artist)) (lot as Record<string, unknown>).sport = sportOf(lot.title);

    lot.formKey = classifyForm(lot);
    lot.modelKey = normModelKey(lot);
    lot.reference = normWatchKey(lot);
    lot.normalizedTitle = normNormalizeTitle(lot.title);
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
    lot.serialNo = extractSerial(lot.title, lot.description || undefined);

    const tags = extractCollectibleTags(lot.title);
    lot.photoMatched = tags.photoMatched;
    lot.authCert = tags.authCert;
    lot.gradeLabel = tags.gradeLabel;

    lot.objectFingerprint = objectFingerprint(lot);
    lot.schemaVersion = 2;
    // firstSeen deliberately UNSET: these lots were historic when first observed.
  }
}

/* ── checkpoint io (loop-append; crash-resumable) ────────────────────────── */

function loadCursor(): Set<string> {
  try { return new Set(JSON.parse(fs.readFileSync(CURSOR, 'utf8')).done as string[]); }
  catch { return new Set(); }
}
function saveCursor(done: Set<string>): void {
  fs.writeFileSync(CURSOR, JSON.stringify({ done: Array.from(done) }));
}
/** Replay the checkpoint file into a hits-by-objectID map (dedupe within results).
 *  Buffer-first, line-by-line: the checkpoint grows past 500MB (V8's max UTF-8
 *  string length), so buf.toString('utf8') would throw ERR_STRING_TOO_LONG.
 *  Scan for newlines over the raw buffer and decode each line in isolation. */
function loadCheckpoint(): Map<string, Hit> {
  const m = new Map<string, Hit>();
  if (!fs.existsSync(CKPT)) return m;
  const buf = fs.readFileSync(CKPT);
  let start = 0;
  const ingest = (s: number, e: number) => {
    if (e <= s) return;
    try {
      const h = JSON.parse(buf.toString('utf8', s, e)) as Hit;
      const key = h.objectID || h.itemId || urlTail(h.url || '');
      if (key) m.set(key, h);
    } catch { /* skip malformed line */ }
  };
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) { ingest(start, i); start = i + 1; }
  }
  ingest(start, buf.length);
  return m;
}

/* ── build a corpus row from an in-scope, routed hit ─────────────────────── */

function hitToRow(hit: Hit, artist: string): AuctionLot | null {
  const cur = detailsCurrency(hit.details || '') || (hit.estimateCurrency as Currency | undefined);
  if (!cur || !SUPPORTED_CUR.has(cur)) return null;         // FX-unsupported — never coerce
  const premiumNative = Number(hit.salePrice);
  if (!(premiumNative > 0)) return null;
  if (!hit.endDate || !Number.isFinite(hit.endDate)) return null;
  const saleDateTime = new Date(hit.endDate).toISOString();
  const saleDay = saleDateTime.slice(0, 10);
  const key = saleKey(hit.url || '');
  const saleName = key
    ? key.split('/')[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : '';
  const estLow = hit.lowEstimate != null && hit.lowEstimate > 0 ? Number(hit.lowEstimate) : null;
  const estHigh = hit.highEstimate != null && hit.highEstimate > 0 ? Number(hit.highEstimate) : null;
  // distinct id namespace so an Algolia row never collides with a GraphQL-sourced
  // sothebys-{lotId} row (objectID is Algolia's stable unique key, on 100% of hits)
  const id = `sothebys-alg-${hit.objectID || hit.itemId || urlTail(hit.url || '') || premiumNative}`;
  const img = hit.landscapeImage || hit.portraitImage || hit.image || null;
  const lotNum = hit.lotNumber != null ? (parseInt(String(hit.lotNumber), 10) || null) : null;

  return {
    id,
    artist,
    title: (hit.title || '').trim() || (hit.imageAltText || '').trim() || '(untitled)',
    year: null,
    medium: null,
    dimensions: null,
    description: null,
    category: 'unknown',
    imageUrl: img,
    auctionHouse: "Sotheby's",
    saleName,
    saleDate: saleDay,
    saleDateTime,
    lotNumber: lotNum,
    ...stampSold(cur, saleDay, premiumNative, estLow, estHigh),
    status: 'sold' as AuctionLot['status'],
    resultsPending: false,
    source: 'sothebys-algolia',
    url: hit.url || `https://www.sothebys.com/en/buy/auction/${key}`,
  } as unknown as AuctionLot;
}

/* ── main ────────────────────────────────────────────────────────────────── */

(async () => {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const creds = await algoliaCreds();
  console.log(`[algolia] ${creds.appId}/${creds.index}${creds === ALGOLIA_FALLBACK ? ' (fallback creds)' : ' (live-scraped creds)'}${WRITE ? '' : ' · DRY-RUN'}`);

  // existing sothebys segment — dedupe target (by url-tail AND by id)
  const existing = readSegment('sothebys') as unknown as AuctionLot[];
  const existingTails = new Set<string>();
  const existingIds = new Set<string>();
  for (const l of existing) { const t = urlTail(l.url || ''); if (t) existingTails.add(t); existingIds.add(String(l.id)); }
  console.log(`[algolia] existing sothebys segment: ${existing.length} lots (${existingTails.size} url-tails)`);

  // ── DISCOVERY (bisection sweep, resumable) ──
  const done = loadCursor();
  const seen = loadCheckpoint();                 // url-tail → hit (dedupe within results)
  if (seen.size) console.log(`[algolia] resumed checkpoint: ${done.size} departments done · ${seen.size} unique hits banked`);
  const ckptStream = fs.createWriteStream(CKPT, { flags: 'a' });

  const NOW = Date.now();
  const FLOOR = Date.UTC(1998, 0, 1);            // Sotheby's online index starts well after this
  let queries = 0;
  const perDeptCount: Record<string, number> = {};

  // within-results dedupe keys on objectID (Algolia's stable unique id — present
  // on 100% of hits in BOTH url formats; url-tails miss on legacy ecatalogue).
  const onHits = (dep: string) => (hits: Hit[]) => {
    for (const h of hits) {
      const key = h.objectID || h.itemId || urlTail(h.url || '');
      if (!key) continue;
      perDeptCount[dep] = (perDeptCount[dep] || 0) + 1;
      if (seen.has(key)) continue;               // within-results dedupe by objectID
      seen.set(key, h);
      ckptStream.write(JSON.stringify(h) + '\n');
    }
  };

  for (const dep of ALLOW_DEPARTMENTS) {
    if (done.has(dep)) { console.log(`[algolia] ${dep}: already done (checkpoint)`); continue; }
    const before = seen.size;
    let localQ = 0, truncFixups = 0;
    const emit = onHits(dep);

    // Work-queue over endDate windows. For each window we PAGE it directly
    // (hitsPerPage:PAGE_LEAF). Correctness is decided by the ACTUAL page, NOT by
    // Algolia's approximate nbHits: if hits.length reaches PAGE_LEAF the window
    // truly overflowed (truncated) and is SPLIT and re-queued; else the page is
    // complete and emitted. A cheap est-probe is used only to pre-split obviously
    // huge windows so we don't pull a full 1000-row page just to discover it's
    // truncated. Single-ms windows that still overflow are the pathological floor
    // (a whole mega-sale at one endDate) — logged, page kept (best effort).
    let queue: [number, number][] = [[FLOOR, NOW + 864e5]];
    while (queue.length) {
      const batch = queue.slice(0, CONC);
      queue = queue.slice(CONC);
      const next: [number, number][] = [];
      await Promise.all(batch.map(async ([lo, hi]) => {
        // pre-split hint: if the estimate is well over the cap and the window is
        // splittable, bisect WITHOUT paging (saves pulling a doomed 1000-page).
        if (hi - lo > 1) {
          localQ++; queries++;
          const est = await estWindow(creds, dep, lo, hi);
          if (est === 0) return;
          if (est > EST_BISECT) {
            const mid = lo + Math.floor((hi - lo) / 2);
            next.push([lo, mid], [mid, hi]);
            return;
          }
        }
        // estimate says it's small enough — page it and verify against the page
        localQ++; queries++;
        const { hits } = await pageWindow(creds, dep, lo, hi);
        if (hits.length >= PAGE_LEAF && hi - lo > 1) {
          // estimate under-counted — real overflow. Split and re-queue.
          truncFixups++;
          const mid = lo + Math.floor((hi - lo) / 2);
          next.push([lo, mid], [mid, hi]);
          return;
        }
        if (hits.length >= PAGE_LEAF) console.warn(`[algolia]   WARN single-ms window truncated at ${PAGE_LEAF} (${dep} @ ${lo}) — possible loss`);
        emit(hits);
      }));
      if (next.length) queue = next.concat(queue);
      await sleep(50);
    }
    done.add(dep);
    saveCursor(done);
    console.log(`[algolia] ${dep.padEnd(52)} raw=${(perDeptCount[dep] || 0).toString().padStart(7)} · +${seen.size - before} unique · ${localQ} queries${truncFixups ? ` · ${truncFixups} trunc-fixups` : ''} (running total ${queries})`);
  }
  ckptStream.end();
  await new Promise<void>(r => ckptStream.on('finish', () => r()));

  const rawTotal = Object.values(perDeptCount).reduce((s, n) => s + n, 0);
  console.log(`\n[algolia] SWEEP DONE · ${queries} Algolia queries · ${rawTotal} raw hits · ${seen.size} unique in-scope sold lots (url-tail deduped)`);

  // ── ROUTE + BUILD ROWS ──
  let routedSports = 0, routedCulture = 0, routedItem = 0, unrouted = 0, dupExisting = 0, badMoney = 0, dupById = 0;
  const bySlug: Record<string, number> = {};
  const byVertical: Record<string, number> = {};
  const VERTICAL_OF: Record<string, string> = {};
  for (const [v, slugs] of Object.entries({
    art: ['george-condo', 'kaws', 'andy-warhol', 'keith-haring', 'ed-ruscha', 'pablo-picasso', 'henri-matisse', 'tom-sachs', 'peter-saul', 'raymond-pettibon', 'barry-mcgee', 'futura-2000', 'r-crumb', 'fab-5-freddy', 'francesco-clemente', 'eddie-martinez', 'kenny-scharf'],
    design: ['george-nakashima', 'charles-eames', 'jean-prouve', 'pierre-jeanneret'],
    watches: ['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier'],
    sports: ['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia'],
    science: ['space-exploration', 'meteorites', 'fossils', 'scientific-instruments'],
    culture: ['movie-tv', 'music-memorabilia', 'entertainment-memorabilia'],
  })) for (const s of slugs) VERTICAL_OF[s] = v;

  const newRows: AuctionLot[] = [];
  const newIds = new Set<string>();
  for (const hit of Array.from(seen.values())) {
    const tail = urlTail(hit.url || '');
    if (tail && existingTails.has(tail)) { dupExisting++; continue; }   // dedupe vs existing segment
    const key = saleKey(hit.url || '');
    const title = (hit.title || '').trim();
    const creators = hit.artistName || (hit.artists && hit.artists.length ? hit.artists.join(' ') : '') || (hit.brands && hit.brands.length ? hit.brands.join(' ') : '');
    // ITEM-FIRST routing (the doctrine: item text decides, never the sale). A
    // tracked maker MUST win over the sale bucket — otherwise an $18M Picasso
    // that happened to sell in a culture-named sale ("Icons") gets buried as
    // entertainment-memorabilia. Only when routeItem finds nothing tracked do we
    // fall back to the SALE-scoped memorabilia routers, exactly as ray-crawl.ts's
    // nightly ingest does (see routeItem→isSportsSale/isCultureSale there).
    let artist: string | null = routeItem(creators, title, '');
    if (artist) routedItem++;
    else if (isSportsSale(key)) { artist = routeSportsLot(title, ''); if (artist) routedSports++; }
    else if (isCultureSale(key)) { artist = routeCulture(title, ''); if (artist) routedCulture++; }
    if (!artist) { unrouted++; continue; }                       // nothing tracked — never guess

    const row = hitToRow(hit, artist);
    if (!row) { badMoney++; continue; }                          // unusable currency/price/date
    if (existingIds.has(String(row.id)) || newIds.has(String(row.id))) { dupById++; continue; }
    newIds.add(String(row.id));
    bySlug[artist] = (bySlug[artist] || 0) + 1;
    byVertical[VERTICAL_OF[artist] || '?'] = (byVertical[VERTICAL_OF[artist] || '?'] || 0) + 1;
    newRows.push(row);
  }

  // vertical guards (same doctrine as backfill-sothebys-slugs.ts): drop misrouted
  // watch-form-in-science and non-watch-signal watch-maker lots.
  await stampIdentity(newRows as (AuctionLot & Record<string, unknown>)[]);
  const WATCH_MAKERS = new Set(['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier']);
  const HOROLOGY = new Set(['wristwatch', 'pocket-watch', 'clock']);
  const WATCH_SIGNAL = /watch|montre|chronograph|chronometer|chronometre|tourbillon|calibre|caliber|\bref\.?\b|reference|automatic|self-?winding|manual wind|movement|\bdial\b|perpetual|minute repeat|moonphase|moon phase|day-?date|tank|santos|panth|ballon|pasha|tortue|baignoire|\bronde\b|roadster|\bdrive\b|cloche|oyster|cosmograph|datejust|submariner|seamaster|speedmaster|constellation|nautilus|aquanaut|calatrava|royal oak|cellini|de ville|must de|must 21|jaeger|reverso/i;
  const SCI_GUARD = new Set(['meteorites', 'fossils', 'space-exploration', 'scientific-instruments']);
  const beforeGuards = newRows.length;
  const guarded = newRows.filter(l => {
    const lr = l as unknown as Record<string, unknown>;
    if (SCI_GUARD.has(l.artist) && lr.formKey === 'wristwatch') return false;
    if (!WATCH_MAKERS.has(l.artist)) return true;
    if (HOROLOGY.has(lr.formKey as string)) return true;
    return WATCH_SIGNAL.test(`${l.title || ''} ${l.medium || ''}`);
  });
  const guardDropped = beforeGuards - guarded.length;

  // recompute per-slug/vertical over the guarded set
  const gBySlug: Record<string, number> = {}, gByVertical: Record<string, number> = {};
  for (const l of guarded) { gBySlug[l.artist] = (gBySlug[l.artist] || 0) + 1; gByVertical[VERTICAL_OF[l.artist] || '?'] = (gByVertical[VERTICAL_OF[l.artist] || '?'] || 0) + 1; }

  /* ── REPORT ── */
  console.log('\n════════════════ FULL DISCOVERY REPORT ════════════════');
  console.log(`in-scope unique sold lots found (url-tail deduped): ${seen.size}`);
  console.log(`  dedupe vs existing sothebys segment:  -${dupExisting} already present`);
  console.log(`routing:  sports ${routedSports} · culture ${routedCulture} · item(maker) ${routedItem} · UNROUTED(skipped) ${unrouted}`);
  const routedTotal = routedSports + routedCulture + routedItem;
  const routeDenom = seen.size - dupExisting;
  console.log(`  routing hit-rate: ${routedTotal}/${routeDenom} net-new = ${routeDenom ? (100 * routedTotal / routeDenom).toFixed(1) : '0'}%`);
  console.log(`  skipped after route: badMoney/currency ${badMoney} · dup-by-id ${dupById}`);
  console.log(`vertical guards dropped: ${guardDropped} (watch-form-in-science / non-watch-signal watch-maker)`);
  console.log(`\nNET-NEW ROWS TO WRITE: ${guarded.length}`);
  console.log('\nper-department raw in-scope hits:');
  for (const dep of ALLOW_DEPARTMENTS) console.log(`  ${(perDeptCount[dep] || 0).toString().padStart(8)}  ${dep}`);
  console.log('\nper-vertical (routed, guarded):');
  for (const [v, n] of Object.entries(gByVertical).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(8)}  ${v}`);
  console.log('\nper-slug (routed, guarded):');
  for (const [s, n] of Object.entries(gBySlug).sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(8)}  ${s}`);

  const priced = guarded.filter(l => (l.realizedUsd || 0) > 0).length;
  const withEst = guarded.filter(l => { const lr = l as unknown as Record<string, unknown>; return (lr.estLowUsd as number || 0) > 0 && (lr.estHighUsd as number || 0) > 0; }).length;
  console.log(`\nprice coverage: ${priced}/${guarded.length} (${guarded.length ? (100 * priced / guarded.length).toFixed(1) : '0'}%) · estimate coverage: ${withEst}/${guarded.length} (${guarded.length ? (100 * withEst / guarded.length).toFixed(1) : '0'}%)`);
  const totalRealized = guarded.reduce((s, l) => s + (l.realizedUsd || 0), 0);
  console.log(`total realized (USD) of new rows: $${Math.round(totalRealized).toLocaleString()}`);

  console.log('\n20 samples:');
  for (const l of guarded.slice(0, 20)) {
    console.log(`  [${l.artist}] ${(l.currency)} ${(l.premiumPrice || 0).toLocaleString()} → $${Math.round(l.realizedUsd || 0).toLocaleString()} · ${l.saleDate} · ${(l.title || '').slice(0, 55)}`);
  }

  const projectedSegment = existing.length + guarded.length;
  console.log(`\nprojected sothebys segment: ${existing.length} → ${projectedSegment} (+${guarded.length})`);
  console.log('════════════════════════════════════════════════════════');

  if (!WRITE) { console.log('\n[algolia] DRY-RUN — pass --write to append the new rows to the sothebys segment'); return; }
  if (!guarded.length) { console.log('[algolia] no new rows — segment untouched'); return; }

  // loop-append (spread overflows past ~100K) — existing rows byte-untouched
  const merged = existing as unknown as Record<string, unknown>[];
  for (const g of guarded as unknown as Record<string, unknown>[]) merged.push(g);
  writeSegment('sothebys', merged);
  console.log(`[algolia] wrote ${merged.length} lots to segments/sothebys.ndjson.gz (local only — nightly owns the R2 push)`);
})();
