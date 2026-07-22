/**
 * backfill-sothebys-slugs.ts — historic Sotheby's CLOSED-sale backfill.
 *
 * The live crawler (ray-crawl.ts) only discovers CURRENT sales from department
 * pages; 2020–2024 closed sales are the gap. This script:
 *   1. Enumerates historic auction slugs via the Wayback Machine CDX API
 *      (web.archive.org/cdx/search/cdx — every archived URL under
 *      /en/buy/auction/{year}/ embeds its auction slug, so lot-page captures
 *      enumerate sales too). Sotheby's own sitemap-*.xml indexes were probed
 *      live and carry ZERO /en/buy/auction/ URLs (editorial pages only), so
 *      that method is dropped. ALL discovered slugs are saved to
 *      /private/tmp/uiaudit/sothebys-slugs.txt for future crawls.
 *   2. For each watch/art-keyword candidate slug: resolves the auction uuid +
 *      state via the auction page (same regexes as sothebysAuctionMeta), then
 *      pages the public GraphQL lots API. Sotheby's gates results per sale:
 *      some closed sales are ResultVisible publicly, some ResultHidden — only
 *      public results are ingested (never fabricated).
 *   3. Maps estimate-bearing SOLD lots exactly like the crawler's Sotheby's
 *      sale path (id sothebys-{lotId}, routeItem → tracked makers only,
 *      stampMoney with the sale-dated FX, saleDate from meta.endDate), stamps
 *      the v2 identity block with the same normalize.ts functions, merges into
 *      data/corpus/lots.json.gz (existing rows ALWAYS win), and rebuilds the
 *      served payloads via runMarketBuild().
 *
 * Politeness: 400–600 ms sleep between requests, 30 s timeouts, skip on
 * failure, hard total-request cap. Never deletes or modifies existing rows.
 * Run: npx tsx scripts/backfill-sothebys-slugs.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

import type { AuctionLot, Currency, LotCategory, PriceBasis } from '../app/types';
import {
  toUsdDated, fxRateFor, normalizeDimensions, extractYear, canonMedium,
  extractEdition, extractSerial, extractCollectibleTags, classifyEntity,
  objectFingerprint, titleTokens,
  modelKey as normModelKey, watchKey as normWatchKey,
  normalizeTitle as normNormalizeTitle,
} from '../app/lib/normalize';
import { runMarketBuild } from './build-market';
import { isSportsSale, routeSportsLot } from './sports-sale';

/* ── config ──────────────────────────────────────────────────────────────── */

const YEARS = [2020, 2021, 2022, 2023, 2024];
const WORK_DIR = '/private/tmp/uiaudit';
const SLUG_FILE = path.join(WORK_DIR, 'sothebys-slugs.txt');
const SALE_CACHE_DIR = path.join(WORK_DIR, 'sothebys-sales');
const CORPUS = path.join(process.cwd(), 'data', 'corpus');

// candidate filter — watch + art sale-name keywords (day-sale/evening covers
// the marquee art sales; sale names are diverse, routeItem keeps only tracked
// makers anyway, so a false-positive slug costs one meta request).
const CANDIDATE_RE = /(watch|contemporary|modern|prints|day-sale|day-auction|evening|sport|memorabilia|baseball|basketball|football|soccer|hockey|olympic|cricket|tennis|golf|boxing|maradona|pele|sneaker|the-one|game-worn|game-used|world-cup|super-bowl|street|culture|icons)/;

const MAX_TOTAL_REQUESTS = 5000; // hard stop across meta + GraphQL pages
const MAX_GQL_PAGES = 40;        // per sale (matches the crawler's guard)

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const SOTHEBYS_GQL = 'https://clientapi.prod.sothelabs.com/graphql';
const SOTHEBYS_LOT_QUERY = `query LotCards($id: String!, $limit: Int, $offset: Int) {
  auction(id: $id, language: ENGLISH) {
    currency
    lotCards: lotCardsConnection(offset: $offset, limit: $limit, filter: ALL) {
      hasNextPage
      totalCount
      lots {
        lotId
        title
        subtitle
        creatorsDisplayTitle
        lotNumber { ... on VisibleLotNumber { lotDisplayNumber } }
        slug { lotSlug }
        estimateV2 { ... on LowHighEstimateV2 { lowEstimate { amount } highEstimate { amount } } }
        bidState { sold { __typename ... on ResultVisible { isSold premiums { finalPrice: finalPriceV2 { currency amount } } } } }
        media(imageSizes: [Medium, Large]) { images { renditions { url imageSize } } }
      }
    }
  }
}`;
const SOTHEBYS_COOKIE = process.env.SOTHEBYS_COOKIE || '';
const sothebysAuth = (): Record<string, string> => (SOTHEBYS_COOKIE ? { Cookie: SOTHEBYS_COOKIE } : {});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const polite = () => sleep(400 + Math.floor(Math.random() * 200));
let requestCount = 0;
const budgetLeft = () => requestCount < MAX_TOTAL_REQUESTS;

/* ── item routing (verbatim from ray-crawl.ts — the doctrine) ────────────── */

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

/* ── lot classification (verbatim from ray-crawl.ts) ─────────────────────── */

const DESIGN_ARTISTS = new Set(['george-nakashima', 'charles-eames', 'jean-prouve', 'pierre-jeanneret']);
const OBJECT_ARTISTS = new Set([
  'rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier',
  'meteorites', 'fossils', 'space-exploration', 'scientific-instruments',
  'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia',
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

/* ── v2 money stamping (verbatim from ray-crawl.ts) ──────────────────────── */

interface MoneyIn {
  isSold: boolean;
  nativeCurrency: Currency;
  saleDate: string | null;
  hammerNative: number | null;
  premiumNative: number | null;
  estLowNative: number | null;
  estHighNative: number | null;
  priceBasis: PriceBasis;
  buyerPremiumPct?: number | null;
}
type MoneyBlock = Pick<AuctionLot,
  'nativeCurrency' | 'hammerNative' | 'premiumNative' | 'realizedNative' |
  'buyerPremiumPct' | 'fxRate' | 'fxAsOf' | 'hammerUsd' | 'premiumUsd' |
  'realizedUsd' | 'estLowNative' | 'estHighNative' | 'estLowUsd' | 'estHighUsd' |
  'priceBasis' | 'currency' | 'estimateLow' | 'estimateHigh' |
  'hammerPrice' | 'premiumPrice' | 'priceUsd'>;

function stampMoney(m: MoneyIn): MoneyBlock {
  const { rate, asOf } = fxRateFor(m.nativeCurrency, m.saleDate);
  const conv = (n: number | null) => toUsdDated(n, m.nativeCurrency, m.saleDate).usd;
  const estLowNative = m.estLowNative;
  const estHighNative = m.estHighNative;
  const estLowUsd = conv(estLowNative);
  const estHighUsd = conv(estHighNative);
  if (!m.isSold) {
    return {
      nativeCurrency: m.nativeCurrency,
      hammerNative: null, premiumNative: null, realizedNative: null,
      buyerPremiumPct: m.buyerPremiumPct ?? null,
      fxRate: rate, fxAsOf: asOf,
      hammerUsd: null, premiumUsd: null, realizedUsd: null,
      estLowNative, estHighNative, estLowUsd, estHighUsd,
      currency: m.nativeCurrency,
      estimateLow: estLowUsd, estimateHigh: estHighUsd,
      hammerPrice: null, premiumPrice: null, priceUsd: null,
      priceBasis: undefined,
    };
  }
  const hammerNative = m.hammerNative;
  const premiumNative = m.premiumNative;
  const realizedNative = premiumNative ?? hammerNative;
  const hammerUsd = conv(hammerNative);
  const premiumUsd = conv(premiumNative);
  const realizedUsd = conv(realizedNative);
  let bp = m.buyerPremiumPct ?? null;
  if (bp == null && hammerNative != null && premiumNative != null && hammerNative > 0) {
    bp = Math.round((premiumNative / hammerNative - 1) * 1000) / 10;
  }
  return {
    nativeCurrency: m.nativeCurrency,
    hammerNative, premiumNative, realizedNative,
    buyerPremiumPct: bp,
    fxRate: rate, fxAsOf: asOf,
    hammerUsd, premiumUsd, realizedUsd,
    estLowNative, estHighNative, estLowUsd, estHighUsd,
    priceBasis: m.priceBasis,
    currency: m.nativeCurrency,
    estimateLow: estLowUsd, estimateHigh: estHighUsd,
    hammerPrice: hammerNative, premiumPrice: premiumNative, priceUsd: realizedUsd,
  };
}

/* ── Sotheby's fetchers (same shapes as ray-crawl.ts) ────────────────────── */

async function sothebysAuctionMeta(slug: string): Promise<{ uuid: string; endDate: string | null; state: string; title: string } | null> {
  try {
    requestCount++;
    const res = await fetch(`https://www.sothebys.com/en/buy/auction/${slug}`, { headers: { 'User-Agent': UA, ...sothebysAuth() }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const html = await res.text();
    const uuid = (html.match(/"auctionId":"([0-9a-f-]{36})"/) || [])[1];
    if (!uuid) return null;
    const state = (html.match(/"state":"(Closed|Opened|Published)"/) || [])[1] || 'Unknown';
    const title = (html.match(/"title":"([^"]{2,80})"/) || [])[1] || slug;
    const ends = (html.match(/"endDate":"20[0-9-]+T[^"]+"/g) || []).map(s => s.slice(11, -1));
    const latest = ends.map(d => new Date(d)).filter(d => !isNaN(d.getTime())).sort((x, y) => y.getTime() - x.getTime())[0];
    return { uuid, endDate: latest ? latest.toISOString() : null, state, title };
  } catch { return null; }
}

/** Page the GraphQL lots API. Bails after page 1 when no lot in the sale has a
 *  publicly visible result (ResultHidden sale) — no point burning the budget. */
async function sothebysAuctionLots(uuid: string): Promise<{ currency: Currency; lots: any[]; hidden: boolean }> {
  const out: any[] = [];
  let currency: Currency = 'USD';
  let offset = 0;
  let hidden = false;
  for (let guard = 0; guard < MAX_GQL_PAGES; guard++) {
    if (!budgetLeft()) break;
    try {
      requestCount++;
      const res = await fetch(SOTHEBYS_GQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apollographql-client-name': 'sothebys-web', 'User-Agent': UA, ...sothebysAuth() },
        body: JSON.stringify({ query: SOTHEBYS_LOT_QUERY, variables: { id: uuid, limit: 100, offset } }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await res.json() as any;
      const auc = j?.data?.auction;
      const lc = auc?.lotCards;
      if (auc?.currency && ['USD', 'GBP', 'EUR', 'HKD', 'CNY', 'AUD', 'CHF'].includes(auc.currency)) currency = auc.currency;
      if (!lc || !lc.lots) break;
      out.push(...lc.lots);
      if (offset === 0 && lc.lots.length &&
          !lc.lots.some((l: any) => l?.bidState?.sold?.__typename === 'ResultVisible')) {
        hidden = true;
        break; // results gated for this sale — skip remaining pages
      }
      if (!lc.hasNextPage) break;
      offset += 100;
      await polite();
    } catch { break; }
  }
  return { currency, lots: out, hidden };
}

/* ── 1 · slug discovery (Wayback CDX) ────────────────────────────────────── */

async function discoverSlugs(): Promise<Map<number, Set<string>>> {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const byYear = new Map<number, Set<string>>();
  for (const year of YEARS) {
    const cache = path.join(WORK_DIR, `cdx-${year}.txt`);
    let body: string;
    if (fs.existsSync(cache) && fs.statSync(cache).size > 0) {
      body = fs.readFileSync(cache, 'utf8');
      console.log(`[cdx] ${year}: using cached ${cache}`);
    } else {
      const url = 'https://web.archive.org/cdx/search/cdx?' + new URLSearchParams({
        url: `sothebys.com/en/buy/auction/${year}*`, fl: 'original', collapse: 'urlkey',
      }).toString();
      console.log(`[cdx] ${year}: fetching…`);
      requestCount++;
      const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!res.ok) { console.warn(`[cdx] ${year}: HTTP ${res.status} — skipping year`); byYear.set(year, new Set()); continue; }
      body = await res.text();
      fs.writeFileSync(cache, body);
      await sleep(2000);
    }
    // every captured URL under the prefix carries the auction slug as path
    // segment 5 (lot pages included) — extract, drop assets/query variants.
    const slugs = new Set<string>();
    for (const line of body.split('\n')) {
      const m = line.match(/^https?:\/\/www\.sothebys\.com\/en\/buy\/auction\/(\d{4})\/([a-z0-9-]+)(?:[/?]|$)/);
      if (!m || +m[1] !== year) continue;
      if (/\.(jpe?g|png|gif|webp|svg)$/.test(m[2])) continue;
      slugs.add(m[2]);
    }
    byYear.set(year, slugs);
    console.log(`[cdx] ${year}: ${slugs.size} unique auction slugs`);
  }
  return byYear;
}

/* ── main ────────────────────────────────────────────────────────────────── */

const readGz = (f: string): Record<string, unknown>[] =>
  JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, f + '.gz'))).toString('utf8'));
const writeGz = (f: string, d: unknown) =>
  fs.writeFileSync(path.join(CORPUS, f + '.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(d))));

(async () => {
  fs.mkdirSync(SALE_CACHE_DIR, { recursive: true });

  /* discovery */
  const byYear = await discoverSlugs();
  const allSlugs: string[] = [];
  for (const year of YEARS) for (const s of Array.from(byYear.get(year) || []).sort()) allSlugs.push(`${year}/${s}`);
  fs.writeFileSync(SLUG_FILE, allSlugs.join('\n') + '\n');
  console.log(`[discover] ${allSlugs.length} total slugs saved to ${SLUG_FILE}`);

  // candidates: watch slugs first (the diversification priority), then art.
  const candidates = allSlugs.filter(s => CANDIDATE_RE.test(s.split('/')[1]));
  candidates.sort((a, b) => Number(/watch/.test(b)) - Number(/watch/.test(a)) || (a < b ? -1 : 1));
  console.log(`[discover] ${candidates.length} watch/art-keyword candidates (${candidates.filter(s => /watch/.test(s)).length} watch)`);

  /* corpus — read up front so dedupe is exact; existing rows are NEVER touched */
  const lots = readGz('lots.json');
  const archive = readGz('sold-archive.json');
  const existingIds = new Set<string>([...lots, ...archive].map(l => String(l.id)));
  const corpusBefore = lots.length;

  /* crawl candidates — small polite worker pool. Each worker is serial with
     400–600 ms jitter between its own requests; pool-wide that is a few req/s
     against a CDN-backed site (the live crawler itself runs 6-wide elsewhere).
     The per-sale cache in SALE_CACHE_DIR makes the sweep resumable. */
  const newRows: AuctionLot[] = [];
  let probed = 0, resolved = 0, closed = 0, publicSales = 0, hiddenSales = 0,
      noDate = 0, soldSeen = 0, soldWithEst = 0, dupes = 0;

  type SaleData = { meta: Awaited<ReturnType<typeof sothebysAuctionMeta>>; currency: Currency; lots: any[]; hidden: boolean };
  const fetchSale = async (sale: string): Promise<SaleData> => {
    const cacheFile = path.join(SALE_CACHE_DIR, sale.replace('/', '_') + '.json');
    if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const meta = await sothebysAuctionMeta(sale);
    await polite();
    let saleData: SaleData;
    if (!meta || meta.state !== 'Closed') {
      saleData = { meta: meta && meta.state !== 'Closed' ? meta : null, currency: 'USD', lots: [], hidden: false };
    } else {
      const { currency, lots: rawLots, hidden } = await sothebysAuctionLots(meta.uuid);
      await polite();
      saleData = { meta, currency, lots: rawLots, hidden };
    }
    fs.writeFileSync(cacheFile, JSON.stringify(saleData));
    return saleData;
  };

  const ingestSale = (sale: string, saleData: SaleData): void => {
    const meta = saleData.meta;
    if (!meta) return;
    resolved++;
    if (meta.state !== 'Closed') return; // live sales belong to the live crawler
    closed++;
    if (saleData.hidden) { hiddenSales++; return; }
    if (!saleData.lots.length) return;
    if (!meta.endDate) { noDate++; return; } // a sold lot must date its own FX — never fabricate
    publicSales++;

    const saleName = sale.split('/').pop()!.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const sportsSale = isSportsSale(sale); // route the WHOLE sale to sports
    const saleDate = meta.endDate;
    const saleDay = saleDate.split('T')[0];

    for (const lot of saleData.lots) {
      if (!lot.title) continue;
      const soldRes = lot.bidState?.sold;
      const finalPrice = soldRes?.premiums?.finalPrice;
      const isSold = !!soldRes?.isSold && !!finalPrice;
      if (!isSold) continue; // backfill ingests SOLD results only
      soldSeen++;

      const est = lot.estimateV2;
      const estLow = est?.lowEstimate?.amount ? parseFloat(est.lowEstimate.amount) : null;
      const estHigh = est?.highEstimate?.amount ? parseFloat(est.highEstimate.amount) : null;
      if (!(estLow != null && estLow > 0 && estHigh != null && estHigh > 0)) continue; // estimate-bearing only
      soldWithEst++;

      // sports SALES route ALL lots to the sports vertical (memorabilia catch-all);
      // other sales route to tracked makers only.
      const artist = sportsSale ? routeSportsLot(lot.title, lot.subtitle || '') : routeItem(lot.creatorsDisplayTitle, lot.title, lot.subtitle || '');
      if (!artist) continue; // nothing we track — never guess

      const id = `sothebys-${lot.lotId}`;
      if (existingIds.has(id)) { dupes++; continue; } // existing rows win
      existingIds.add(id);

      const rendition = lot.media?.images?.[0]?.renditions;
      const img = rendition?.find((r: any) => r.imageSize === 'Large') || rendition?.find((r: any) => r.imageSize === 'Medium') || rendition?.[0];
      const finalCur = (finalPrice?.currency || saleData.currency) as Currency;
      const premiumNative = parseFloat(finalPrice.amount);
      if (!(premiumNative > 0)) continue;

      newRows.push({
        id,
        artist,
        title: lot.title,
        year: null,
        medium: lot.subtitle || null,
        dimensions: null,
        description: lot.subtitle || null,
        category: 'unknown',
        imageUrl: img?.url || null,
        auctionHouse: "Sotheby's",
        saleName,
        saleDate: saleDay,
        saleDateTime: saleDate,
        lotNumber: lot.lotNumber?.lotDisplayNumber ? parseInt(lot.lotNumber.lotDisplayNumber, 10) || null : null,
        ...stampMoney({
          isSold: true,
          nativeCurrency: finalCur,
          saleDate: saleDay,
          hammerNative: null,
          premiumNative,
          estLowNative: estLow,
          estHighNative: estHigh,
          priceBasis: 'realized',
        }),
        status: 'sold' as any,
        url: `https://www.sothebys.com/en/buy/auction/${sale}/${lot.slug?.lotSlug || lot.lotId}`,
      } as AuctionLot);
    }
    console.log(`  [sale] ${sale} (${saleData.lots.length} lots, ${saleData.currency}) → ${newRows.length} cumulative new rows · reqs ${requestCount}`);
  };

  let cursor = 0;
  const CONC = 6;
  const worker = async () => {
    while (cursor < candidates.length) {
      if (!budgetLeft()) return;
      const sale = candidates[cursor++];
      probed++;
      try {
        const saleData = await fetchSale(sale);
        ingestSale(sale, saleData);
      } catch { /* unreachable sale — skip, never fabricate */ }
      if (probed % 25 === 0) console.log(`[crawl] progress ${probed}/${candidates.length} candidates · ${publicSales} public · ${hiddenSales} hidden · ${newRows.length} new rows · reqs ${requestCount}`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  if (!budgetLeft()) console.warn(`[crawl] request budget (${MAX_TOTAL_REQUESTS}) exhausted — stopped at ${probed}/${candidates.length} candidates`);

  console.log(`\n[crawl] probed ${probed}/${candidates.length} candidates · ${resolved} resolved · ${closed} closed · ${publicSales} results-public · ${hiddenSales} results-hidden · ${noDate} closed-but-dateless`);
  console.log(`[crawl] sold lots seen ${soldSeen} · with estimates ${soldWithEst} · tracked+new ${newRows.length} · already-in-corpus ${dupes}`);

  /* v2 identity stamp — mirrors the crawler's post-merge stamp for NEW rows only */
  const { objectClassOf, isSportsScienceObject, extractSportsTags, classifyForm } =
    await import('../app/lib/comps');
  const { sportOf } = await import('../app/utils');
  const SPORT_SLUGS = new Set(['game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia']);

  for (const lot of newRows as (AuctionLot & Record<string, unknown>)[]) {
    lot.category = classifyLot(lot);
    if (lot.category === 'object') (lot as any).objectClass = objectClassOf(lot);
    if (isSportsScienceObject(lot)) {
      const tags = extractSportsTags(lot.title, lot.artist);
      if (tags.entity !== undefined) (lot as any).entity = tags.entity;
      if (tags.objectType !== undefined) (lot as any).objectType = tags.objectType;
      if (tags.eventKey !== undefined) (lot as any).eventKey = tags.eventKey;
      if (tags.sportYear !== undefined) (lot as any).sportYear = tags.sportYear;
    }
    if (SPORT_SLUGS.has(lot.artist)) (lot as any).sport = sportOf(lot.title);

    lot.formKey = classifyForm(lot);
    lot.modelKey = normModelKey(lot);
    lot.reference = normWatchKey(lot);
    lot.normalizedTitle = normNormalizeTitle(lot.title);
    // ART lots drop the maker's own name words (the crawler's name-drop rule)
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
    // firstSeen deliberately UNSET: these lots were historic when first observed;
    // a fabricated "seen" date would be a lie ("New today" must mean it).
  }

  /* vertical guards — same doctrine as the crawler's publish gates */
  const WATCH_MAKERS = new Set(['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier']);
  const HOROLOGY = new Set(['wristwatch', 'pocket-watch', 'clock']);
  const WATCH_SIGNAL = /watch|montre|chronograph|chronometer|chronometre|tourbillon|calibre|caliber|\bref\.?\b|reference|automatic|self-?winding|manual wind|movement|\bdial\b|perpetual|minute repeat|moonphase|moon phase|day-?date|tank|santos|panth|ballon|pasha|tortue|baignoire|\bronde\b|roadster|\bdrive\b|cloche|oyster|cosmograph|datejust|submariner|seamaster|speedmaster|constellation|nautilus|aquanaut|calatrava|royal oak|cellini|de ville|must de|must 21|jaeger|reverso/i;
  const SCI_GUARD = new Set(['meteorites', 'fossils', 'space-exploration', 'scientific-instruments']);
  const beforeGuards = newRows.length;
  const guarded = newRows.filter(l => {
    if (SCI_GUARD.has(l.artist) && (l as any).formKey === 'wristwatch') return false;
    if (!WATCH_MAKERS.has(l.artist)) return true;
    if (HOROLOGY.has((l as any).formKey)) return true;
    return WATCH_SIGNAL.test(`${l.title || ''} ${l.medium || ''}`);
  });
  if (guarded.length < beforeGuards) console.log(`[guard] dropped ${beforeGuards - guarded.length} non-watch/misrouted lots (jewelry, watch-form in science)`);

  /* report per market/maker */
  const byMaker: Record<string, number> = {};
  for (const l of guarded) byMaker[l.artist] = (byMaker[l.artist] || 0) + 1;
  console.log('\n[ingest] new sold rows by maker:', JSON.stringify(byMaker, null, 2));
  const estCovered = guarded.filter(l => ((l as any).estLowUsd || 0) > 0 && ((l as any).estHighUsd || 0) > 0).length;
  console.log(`[ingest] estimate coverage of ingested rows: ${estCovered}/${guarded.length}`);

  if (!guarded.length) {
    console.log('[merge] no new rows — corpus untouched, nothing rebuilt.');
    return;
  }

  /* merge — append only; existing rows byte-untouched. NOT push(...guarded):
     spread overflows the call stack past ~100k args. */
  for (const g of guarded as unknown as Record<string, unknown>[]) lots.push(g);
  writeGz('lots.json', lots);
  console.log(`[merge] corpus lots.json.gz: ${corpusBefore} → ${lots.length} rows (+${guarded.length}) · archive untouched (${archive.length})`);

  if (process.env.SKIP_REBUILD === '1') { console.log('[merge] SKIP_REBUILD=1 — corpus written, served NOT rebuilt.'); return; }
  console.log('[merge] rebuilding served payloads…');
  runMarketBuild();
})();
