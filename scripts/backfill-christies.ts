/**
 * backfill-christies.ts — historic Christie's CLOSED-sale backfill.
 *
 * Christie's is a top-3 house but the live crawler only discovers CURRENT
 * sales (department pages) + a handful of seeds + 8 pages of each artist page,
 * so our historic Christie's depth is thin (~1k sold vs Sotheby's ~6.5k). This
 * script closes that gap:
 *   1. Enumerates historic auction slugs via the Wayback CDX API — every
 *      archived /en/auction/{slug} URL is a real sale. ALL discovered slugs are
 *      cached to /private/tmp/uiaudit/christies-slugs.txt.
 *   2. For each art/design/watch/science-keyword candidate slug: fetches the
 *      sale LIVE from christies.com (closed sales serve results permanently,
 *      complete + paginated) and parses window.chrComponents.lots exactly like
 *      the live crawler's christiesAuctionLots(). If the live slug 301s /
 *      404s / went away, falls back to the latest Wayback snapshot of the sale
 *      page (which embeds the same JSON).
 *   3. Maps estimate-bearing SOLD lots exactly like the crawler's Christie's
 *      auction path (id christies-auc-{object_id} → natural dedupe with live
 *      data; routeItem → tracked makers only; premium-inclusive price_realised
 *      → premiumNative with the sale-dated FX), stamps the v2 identity block
 *      with the same normalize.ts functions, merges into data/corpus/lots.json.gz
 *      (existing rows ALWAYS win), and rebuilds the served payloads.
 *
 * Politeness: a 4-wide worker pool, 500-800 ms jitter per request, 30 s
 * timeouts, per-sale cache for resumability, hard total-request cap. Never
 * deletes or modifies existing rows.
 * Run: npx tsx scripts/backfill-christies.ts
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
import { isCultureSale, routeCulture } from './culture';

/* ── config ──────────────────────────────────────────────────────────────── */

const WORK_DIR = '/private/tmp/uiaudit';
const SLUG_FILE = path.join(WORK_DIR, 'christies-slugs.txt');
const CDX_CACHE = path.join(WORK_DIR, 'christies-auction-cdx.txt');
const SALE_CACHE_DIR = path.join(WORK_DIR, 'christies-sales');
const CORPUS = path.join(process.cwd(), 'data', 'corpus');

// candidate filter — our verticals' sale-name keywords. routeItem keeps only
// tracked makers regardless, so a false-positive slug costs one sale fetch.
// Sports terms target genuine memorabilia sales (baseball/olympic/world-cup/…)
// while avoiding "sporting guns/rifles" firearms sales — routeItem gates the
// rest (game-used / trophies / tickets only; cards never).
const CANDIDATE_RE = /(watch|montre|contemporary|post-?war|modern|impressionist|avant-garde|first-open|thinking-italian|print|multiple|edition|design|scandinav|nordic|works-on-paper|day-sale|evening|morning-session|afternoon-session|art-contemporain|art-moderne|now-|21st|20th-century|natural-history|meteorite|dinosaur|fossil|jurassic|science|deep-impact|space|palaeontolog|mineral|latin-american|dubuffet|warhol|picasso|kaws|haring|basquiat|ruscha|condo|photograph|prouve|jeanneret|nakashima|eames|sports|memorabilia|olympic|world-cup|baseball|cricket|golf|tennis|boxing|wimbledon|maradona|game-used|game-worn|super-bowl|world-series|hollywood|entertainment|popular-culture|pop-culture|rock-and-pop|rock-n-roll|the-beatles|bowie|james-bond|film-and|music|icons)/;

const MAX_TOTAL_REQUESTS = 12000; // hard stop across live + wayback + cdx pages
const MAX_PAGES = 20;             // per sale (flagship sales run into hundreds)

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const polite = () => sleep(500 + Math.floor(Math.random() * 300));
let requestCount = 0;
const budgetLeft = () => requestCount < MAX_TOTAL_REQUESTS;

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
};

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
  // political / literary / entertainment Americana is NOT science (see ray-crawl.ts)
  if (/\b(washington|thomas jefferson|abraham lincoln|john adams|john quincy adams|alexander hamilton|james madison|james monroe|andrew jackson|ulysses grant|robert e\.? lee|general sherman|jefferson davis|john wilkes booth|confederate|civil war|continental (army|congress)|declaration of independence|revolutionary war|colonial governor|bunker hill|fort (sumter|ticonderoga)|emancipation|hemingway|walt whitman|washington irving|ezra pound|marilyn monroe|bette davis|marlene dietrich|bruce springsteen|jacqueline (bouvier|kennedy)|cotton mather|ecclesiastical history)\b/.test(t)
      && !/telescope|microscope|astrolab|sextant|orrery|armillary|chronometer|patent (model|no|for)|scientific instrument|albert einstein|isaac newton|thomas edison|nikola tesla|charles darwin|\bsmyth\b|orville|atomic|nuclear|manhattan project/.test(t)) return null;
  if (/telescope|microscope|astrolabe|sextant|octant|orrery|armillary|barometer|theodolite|chronometer\b|slide rule|surveying (instrument|compass|chain|cross)|(terrestrial|library|pocket|table) globe|globe by|celestial|enigma machine|cipher|calculat(or|ing)|typewriter|computer|macintosh|apple[- ](1|ii)|altair|commodore|prototype|patent model|anatomical|medical (instrument|kit)|laboratory|albert einstein|isaac newton|charles darwin|marie curie|nikola tesla|thomas edison|bell labs|bell telephone laborator|transistor|semiconductor|integrated circuit|microprocessor|vacuum tube|punch(ed)? card|mainframe|eniac|univac|\bcray\b|\bibm\b|pdp-\d|\bvax\b|apple lisa|\bnext(cube|step)?\b|xerox (alto|parc|star)|difference engine|analytical engine|babbage|\bturing\b|von neumann|shockley|grace hopper|wozniak|steve jobs|kenbak|imsai|trs-80|\bamiga\b|osborne 1|manuscript.*(scien|math|physic)|first edition.*(scien|math|physic)/.test(t)) return 'scientific-instruments';
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

/* ── Christie's currency (verbatim from ray-crawl.ts) ────────────────────── */

function parseChristiesCurrency(txt: string): Currency {
  if (/HK\$|HKD/.test(txt)) return 'HKD';
  if (/£|GBP/.test(txt)) return 'GBP';
  if (/€|EUR/.test(txt)) return 'EUR';
  if (/CHF/.test(txt)) return 'CHF';
  if (/CN¥|RMB|CNY/.test(txt)) return 'CNY';
  if (/AU\$|AUD/.test(txt)) return 'AUD';
  return 'USD';
}

/** Extract the chrComponents.lots array from a Christie's sale-page HTML. */
function lotsFromHtml(html: string): any[] {
  const m = html.match(/window\.chrComponents\.lots\s*=\s*(\{[\s\S]*?\});\s*(?:window\.|<\/script>)/);
  if (!m) return [];
  try {
    const d = JSON.parse(m[1]);
    const lots = d?.data?.lots;
    return Array.isArray(lots) ? lots : [];
  } catch { return []; }
}

/* ── sale fetch: live first, Wayback fallback ────────────────────────────── */

/** Paginate the LIVE sale page. Closed sales serve full results permanently. */
async function fetchSaleLive(slug: string): Promise<any[] | null> {
  const byId = new Map<string, any>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (!budgetLeft()) break;
    let html: string;
    try {
      requestCount++;
      const res = await fetch(`https://www.christies.com/en/auction/${slug}?sortby=lotnumber&page=${page}`, {
        headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(30000),
      });
      if (res.status >= 300) return page === 1 ? null : Array.from(byId.values()); // gone/renamed → let Wayback try
      if (!res.ok) break;
      html = await res.text();
    } catch { break; }
    const lots = lotsFromHtml(html);
    if (!lots.length) break;
    const before = byId.size;
    for (const lot of lots) byId.set(lot.object_id, lot);
    if (byId.size === before) break; // no new lots — end of sale
    await polite();
  }
  return byId.size ? Array.from(byId.values()) : null;
}

/** Latest 200-status Wayback snapshot of the sale page, parsed for lots JSON. */
async function fetchSaleWayback(slug: string): Promise<any[] | null> {
  if (!budgetLeft()) return null;
  let ts: string | null = null;
  try {
    requestCount++;
    const cdx = await fetch(
      `https://web.archive.org/cdx/search/cdx?url=christies.com/en/auction/${slug}&output=json&filter=statuscode:200&collapse=digest&limit=6`,
      { signal: AbortSignal.timeout(30000) },
    );
    const rows = await cdx.json() as string[][];
    // newest capture last in CDX order → walk from the end for freshest results
    const caps = rows.slice(1);
    if (!caps.length) return null;
    ts = caps[caps.length - 1][1];
  } catch { return null; }
  if (!ts) return null;
  try {
    requestCount++;
    const res = await fetch(`http://web.archive.org/web/${ts}id_/https://www.christies.com/en/auction/${slug}`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(40000),
    });
    if (!res.ok) return null;
    const lots = lotsFromHtml(await res.text());
    return lots.length ? lots : null;
  } catch { return null; }
}

async function fetchSale(slug: string): Promise<{ lots: any[]; source: string }> {
  const cacheFile = path.join(SALE_CACHE_DIR, slug.replace(/[^a-z0-9-]/gi, '_') + '.json');
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  let lots = await fetchSaleLive(slug);
  let source = 'live';
  if (!lots || !lots.length) { lots = await fetchSaleWayback(slug); source = 'wayback'; await polite(); }
  const out = { lots: lots || [], source: lots && lots.length ? source : 'none' };
  fs.writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}

/* ── slug discovery (Wayback CDX) ────────────────────────────────────────── */

async function discoverSlugs(): Promise<string[]> {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  let body: string;
  if (fs.existsSync(CDX_CACHE) && fs.statSync(CDX_CACHE).size > 0) {
    body = fs.readFileSync(CDX_CACHE, 'utf8');
    console.log(`[cdx] using cached ${CDX_CACHE}`);
  } else {
    console.log('[cdx] fetching christies.com/en/auction/* …');
    requestCount++;
    const url = 'https://web.archive.org/cdx/search/cdx?' + new URLSearchParams({
      url: 'christies.com/en/auction/*', fl: 'original', collapse: 'urlkey', limit: '400000',
    }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(240000) });
    if (!res.ok) throw new Error(`CDX HTTP ${res.status}`);
    body = await res.text();
    fs.writeFileSync(CDX_CACHE, body);
  }
  const slugs = new Set<string>();
  const slugRe = /\/en\/auction\/([a-z0-9][a-z0-9-]*-\d{4,6})(?:[/?]|$)/g;
  let sm: RegExpExecArray | null;
  while ((sm = slugRe.exec(body)) !== null) slugs.add(sm[1]);
  const all = Array.from(slugs).sort();
  fs.writeFileSync(SLUG_FILE, all.join('\n') + '\n');
  console.log(`[discover] ${all.length} unique Christie's auction slugs → ${SLUG_FILE}`);
  return all;
}

/* ── main ────────────────────────────────────────────────────────────────── */

const readGz = (f: string): Record<string, unknown>[] =>
  JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, f + '.gz'))).toString('utf8'));
const writeGz = (f: string, d: unknown) =>
  fs.writeFileSync(path.join(CORPUS, f + '.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(d))));

(async () => {
  fs.mkdirSync(SALE_CACHE_DIR, { recursive: true });

  const allSlugs = await discoverSlugs();
  let candidates = allSlugs.filter(s => CANDIDATE_RE.test(s));
  console.log(`[discover] ${candidates.length} vertical-keyword candidate sales`);
  // test knobs: CHRISTIES_LIMIT=N caps the candidate set; CHRISTIES_DRY=1 skips
  // the corpus merge/rebuild (still reports what WOULD be ingested).
  const LIMIT = parseInt(process.env.CHRISTIES_LIMIT || '', 10);
  const DRY = process.env.CHRISTIES_DRY === '1';
  if (LIMIT > 0) { candidates = candidates.slice(0, LIMIT); console.log(`[test] CHRISTIES_LIMIT → ${candidates.length} candidates`); }

  /* corpus — read up front so dedupe is exact; existing rows are NEVER touched */
  const lots = readGz('lots.json');
  const archive = readGz('sold-archive.json');
  const existingIds = new Set<string>([...lots, ...archive].map(l => String(l.id)));
  const corpusBefore = lots.length;

  const newRows: AuctionLot[] = [];
  const seenNew = new Set<string>();
  let probed = 0, withLots = 0, soldSeen = 0, soldWithEst = 0, dupes = 0;
  const sourceCount: Record<string, number> = { live: 0, wayback: 0, none: 0 };

  const ingestSale = (slug: string, rawLots: any[]): void => {
    const saleName = slug.replace(/-\d{4,6}$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const sportsSale = isSportsSale(slug); // route the WHOLE sale to sports
    const cultureSale = !sportsSale && isCultureSale(slug); // else pop-culture
    for (const lot of rawLots) {
      const primary = lot.title_primary_txt || '';
      const secondary = lot.title_secondary_txt || '';
      const title = (secondary ? `${primary} ${secondary}` : primary).trim();
      if (!title) continue;
      if (lot.lot_withdrawn) continue;

      const realisedNum = num(lot.price_realised);
      if (!(realisedNum && realisedNum > 0)) continue; // backfill ingests SOLD only
      soldSeen++;

      const estLow = num(lot.estimate_low);
      const estHigh = num(lot.estimate_high);
      if (!(estLow && estLow > 0 && estHigh && estHigh > 0)) continue; // estimate-bearing only
      soldWithEst++;

      // sports SALES route ALL lots to the sports vertical (memorabilia catch-all
      // for what the object regexes miss); other sales route to tracked makers.
      const artist = sportsSale ? routeSportsLot(title, lot.description_txt || '')
        : cultureSale ? routeCulture(title, lot.description_txt || '')
        : routeItem(primary, secondary, lot.description_txt || '');
      if (!artist) continue; // nothing we track — never guess

      const id = `christies-auc-${lot.object_id}`;
      // existing rows win — dedupe against BOTH Christie's id schemes: the live
      // crawler mints `christies-auc-{object_id}` (auction pages) AND
      // `christies-{object_id}` (artist pages) for the SAME physical lot, so a
      // bare exact-id check would re-add lots already present under the other.
      if (existingIds.has(id) || existingIds.has(`christies-${lot.object_id}`) || seenNew.has(id)) { dupes++; continue; }
      seenNew.add(id);

      const cur = parseChristiesCurrency(`${lot.price_realised_txt || ''} ${lot.estimate_txt || ''}`);
      const endDate: string | null = lot.end_date || lot.start_date || null;
      if (!endDate) continue; // a sold lot must date its own FX — never fabricate
      const saleDay = String(endDate).split('T')[0];
      const description = lot.description_txt && String(lot.description_txt).length < 4000
        ? String(lot.description_txt).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null
        : null;

      newRows.push({
        id,
        artist,
        title,
        year: null,
        medium: secondary || null,
        dimensions: null,
        description,
        category: 'unknown',
        imageUrl: lot.image?.image_src || null,
        auctionHouse: "Christie's",
        saleName,
        saleDate: saleDay,
        saleDateTime: endDate,
        lotNumber: null,
        ...stampMoney({
          isSold: true,
          nativeCurrency: cur,
          saleDate: saleDay,
          hammerNative: null,
          premiumNative: realisedNum,
          estLowNative: estLow,
          estHighNative: estHigh,
          priceBasis: 'realized',
        }),
        status: 'sold' as any,
        url: lot.url || `https://www.christies.com/en/auction/${slug}`,
      } as AuctionLot);
    }
  };

  /* crawl candidates — 4-wide polite worker pool; per-sale cache makes it
     resumable. Each worker is serial with 500-800 ms jitter between requests. */
  let cursor = 0;
  const CONC = 4;
  const worker = async () => {
    while (cursor < candidates.length) {
      if (!budgetLeft()) return;
      const slug = candidates[cursor++];
      probed++;
      try {
        const { lots: rawLots, source } = await fetchSale(slug);
        sourceCount[source] = (sourceCount[source] || 0) + 1;
        if (rawLots.length) { withLots++; ingestSale(slug, rawLots); }
      } catch { /* unreachable sale — skip, never fabricate */ }
      if (probed % 50 === 0) {
        console.log(`[crawl] ${probed}/${candidates.length} · with-lots ${withLots} (live ${sourceCount.live}/wb ${sourceCount.wayback}) · new rows ${newRows.length} · reqs ${requestCount}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  if (!budgetLeft()) console.warn(`[crawl] request budget (${MAX_TOTAL_REQUESTS}) exhausted — stopped at ${probed}/${candidates.length} candidates`);

  console.log(`\n[crawl] probed ${probed}/${candidates.length} · with-lots ${withLots} (live ${sourceCount.live} / wayback ${sourceCount.wayback} / none ${sourceCount.none})`);
  console.log(`[crawl] sold seen ${soldSeen} · with estimates ${soldWithEst} · tracked+new ${newRows.length} · already-in-corpus ${dupes}`);

  if (!newRows.length) {
    console.log('[merge] no new rows — corpus untouched, nothing rebuilt.');
    return;
  }

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

  const byMaker: Record<string, number> = {};
  for (const l of guarded) byMaker[l.artist] = (byMaker[l.artist] || 0) + 1;
  console.log('\n[ingest] new sold rows by maker:', JSON.stringify(byMaker, null, 2));

  if (DRY) { console.log(`[dry] CHRISTIES_DRY=1 — would add ${guarded.length} rows; corpus untouched.`); return; }

  /* merge — append only; existing rows byte-untouched */
  lots.push(...(guarded as unknown as Record<string, unknown>[]));
  writeGz('lots.json', lots);
  console.log(`[merge] corpus lots.json.gz: ${corpusBefore} → ${lots.length} rows (+${guarded.length}) · archive untouched (${archive.length})`);

  if (process.env.SKIP_REBUILD === '1') { console.log('[merge] SKIP_REBUILD=1 — corpus written, served NOT rebuilt.'); return; }
  console.log('[merge] rebuilding served payloads…');
  runMarketBuild();
})();
