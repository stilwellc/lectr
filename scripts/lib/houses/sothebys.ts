/**
 * Sotheby's — artist pages, the GraphQL auction crawler (watches/science/sports/art),
 * per-lot close times, and the detail-page enricher.
 *
 * Moved verbatim out of scripts/ray-crawl.ts (house split, Sep 2026).
 */
import * as cheerio from 'cheerio';
import { isCurrency, type AuctionLot, type LotStatus, type Currency, type LotCategory } from '../../../app/types';
import { routeCulture, isCultureSale } from '../../culture';
import { isSportsSale, routeSportsLot } from '../../sports-sale';
import { fetchWithRetry } from '../fetch-retry';
import { buildSkippableSaleNames, RESULT_PENDING_MS } from '../skip-set';
import type { ArtistConfig } from './artists';
import { type EnrichResult, INCREMENTAL_CRAWL, INCREMENTAL_MODE_REASON, MEDIUM_PATTERNS, UA, noteEnrichFail, noteFetched, parseDrop, sleep, stampMoney, statusWithMoney } from './common';
import { routeItem } from './routing';

// ── Sotheby's Crawler ──
// Parses lot links from the artist page HTML.

export async function crawlSothebys(artist: ArtistConfig): Promise<AuctionLot[]> {
  if (!artist.sothebys) return [];
  const lots: AuctionLot[] = [];
  const url = `https://www.sothebys.com/en/artists/${artist.sothebys}`;
  console.log(`  [Sothebys] Fetching ${artist.displayName}...`);

  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': UA },
      timeoutMs: 30000,
    });
    if (!res.ok) {
      console.log(`  [Sothebys] HTTP ${res.status}`);
      return lots;
    }
    noteFetched('sothebys');
    const html = await res.text();
    const $ = cheerio.load(html);

    const now = new Date();
    const seen = new Set<string>();
    const artistSlugParts = artist.sothebys!.split('-');
    const stripPrefix = new RegExp(`^${artistSlugParts.join('-?')}-?`, 'i');

    // Parse from Card elements (richer data: images, estimates, lot numbers)
    const cards = $('.Card.data-type-lot').toArray();
    console.log(`  [Sothebys] Found ${cards.length} lot cards`);

    for (const cardEl of cards) {
      const card = $(cardEl);
      const href = card.find('a[href*="/buy/auction/"]').first().attr('href') || '';
      if (!href) continue;

      const slug = href.split('/').pop() || '';
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);

      // Image from data-src (lazy loaded), fallback to src
      const img = card.find('img');
      const imageUrl = img.attr('data-src') || img.attr('src') || null;
      // Filter out SVG placeholders
      const finalImageUrl = imageUrl && imageUrl.startsWith('data:image/svg') ? null : imageUrl;

      // Lot number
      const lotNumText = card.find('.Card-lotNumber').text().trim();
      const lotNumber = lotNumText ? parseInt(lotNumText) || null : null;

      // Title from card info text — extract the actual work title
      const infoText = card.find('.Card-info-container').text().trim();
      // Info typically has: "Type: lot Category: Lot ArtistName ArtistName Title Estimate: ..."
      // Extract title by looking for text between duplicated artist name and "Estimate:"
      let title = '';
      const estimateIdx = infoText.indexOf('Estimate:');
      const relevantText = estimateIdx > 0 ? infoText.substring(0, estimateIdx) : infoText;
      // Find the display name repeated (Sotheby's shows it twice)
      const displayParts = artist.displayName.split(' ');
      const lastName = displayParts[displayParts.length - 1];
      const lastNameIdx = relevantText.lastIndexOf(lastName);
      if (lastNameIdx >= 0) {
        title = relevantText.substring(lastNameIdx + lastName.length).trim();
        // Clean up any Chinese characters or extra whitespace
        title = title.replace(/[\u4e00-\u9fff\u00b7\u2013\u2014|]+/g, ' ').replace(/\s+/g, ' ').trim();
        // Strip artist name if it appears at the start (ALL CAPS variant)
        const nameUpper = artist.displayName.toUpperCase();
        if (title.startsWith(nameUpper)) {
          title = title.substring(nameUpper.length).trim();
        }
      }
      if (!title || title.length < 2) {
        // Fallback to slug-based title
        let titleSlug = slug.replace(stripPrefix, '');
        titleSlug = titleSlug.replace(/^qiao-zhi?-?kang-duo-?/i, '');
        if (!titleSlug || titleSlug.length < 2) { parseDrop('sothebys', 'missing title (card + slug both empty)', slug); continue; }
        title = titleSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }

      // Estimate parsing: "Estimate: 800,000 – 1,200,000 USD"
      const estText = card.find('.Card-estimate').text().trim();
      let estimateLow: number | null = null;
      let estimateHigh: number | null = null;
      let currency: Currency = 'USD';
      const estMatch = estText.match(/Estimate:\s*([\d,]+)\s*[–—-]\s*([\d,]+)\s*(\w+)/);
      if (estMatch) {
        estimateLow = parseInt(estMatch[1].replace(/,/g, ''));
        estimateHigh = parseInt(estMatch[2].replace(/,/g, ''));
        const cur = estMatch[3].toUpperCase();
        if (isCurrency(cur)) {
          currency = cur;
        }
      }

      // Sale name and year from href: /buy/auction/YYYY/sale-name/slug
      const hrefParts = href.split('/');
      const auctionIdx = hrefParts.indexOf('auction');
      const auctionYear = auctionIdx >= 0 && hrefParts[auctionIdx + 1] ? parseInt(hrefParts[auctionIdx + 1]) || null : null;
      const saleName = auctionIdx >= 0 && hrefParts[auctionIdx + 2]
        ? hrefParts[auctionIdx + 2].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        : '';

      // The artist page exposes NO results (no hammer, no real sale date) — a
      // record without a realized price is not a sale, so lots from this path
      // are never 'sold'. A current-year card still showing a live Estimate is
      // treated as upcoming; everything else resolved without a knowable
      // result and is recorded as bought_in (matching how the other crawlers
      // handle indeterminate past lots). The June 1 date is a placeholder —
      // the year is all the page gives us.
      let status: LotStatus = 'bought_in';
      let saleDate = '';
      if (auctionYear) {
        saleDate = `${auctionYear}-06-01`;
        if (auctionYear >= now.getFullYear() && estimateLow !== null) {
          status = 'upcoming';
        }
      }

      const fullUrl = href.startsWith('http') ? href : `https://www.sothebys.com${href}`;

      // Try to extract medium, dimensions, and year from card info container
      // Sotheby's often includes this data in the info text after the title
      let medium: string | null = null;
      let dimensions: string | null = null;
      let year: string | null = null;
      const afterTitle = infoText.substring(infoText.indexOf(title) + title.length).trim();

      // Look for year (4-digit number, possibly with circa/c.)
      const yearMatch = afterTitle.match(/(?:(?:circa|c\.)\s*)?(\d{4})(?:\s|,|$)/i);
      if (yearMatch) {
        year = yearMatch[1];
      }

      // Look for medium patterns (oil on canvas, screenprint, etc.)
      const mediumMatch = afterTitle.match(/((?:oil|acrylic|watercolor|gouache|ink|mixed media|screenprint|lithograph|etching|woodcut|gelatin silver|c-print|bronze|ceramic|spray paint)[^,\.]{0,80})/i);
      if (mediumMatch) {
        medium = mediumMatch[1].trim();
      }

      // Look for dimensions (numbers followed by × or x and units)
      const dimMatch = afterTitle.match(/(\d+(?:\.\d+)?\s*[×x]\s*\d+(?:\.\d+)?\s*(?:in|cm)[^,\.]{0,40})/i);
      if (dimMatch) {
        dimensions = dimMatch[1].trim();
      }

      lots.push({
        id: `sothebys-${slug}`,
        artist: artist.slug,
        title,
        year,
        medium,
        dimensions,
        category: 'unknown' as LotCategory,
        imageUrl: finalImageUrl,
        auctionHouse: "Sotheby's",
        saleName,
        saleDate,
        lotNumber,
        ...stampMoney({
          isSold: false, // artist-page path exposes no realized price — never 'sold'
          nativeCurrency: currency,
          saleDate: saleDate || null,
          hammerNative: null,
          premiumNative: null,
          estLowNative: estimateLow,
          estHighNative: estimateHigh,
          priceBasis: 'realized',
        }),
        status,
        url: fullUrl,
      });
    }

    // Also pick up any additional lot links not in Card containers
    const allLinks = $('a[href*="/buy/auction/"]').toArray();
    for (const el of allLinks) {
      const href = $(el).attr('href') || '';
      const slug = href.split('/').pop() || '';
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);

      let titleSlug = slug.replace(stripPrefix, '');
      titleSlug = titleSlug.replace(/^qiao-zhi?-?kang-duo-?/i, '');
      if (!titleSlug || titleSlug.length < 2) continue;
      const title = titleSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      const yearMatch = href.match(/\/auction\/(\d{4})\//);
      const auctionYear = yearMatch ? parseInt(yearMatch[1]) : null;
      // Bare links carry no estimate and no result — never 'upcoming' (would
      // be a phantom that can't resolve) and never 'sold' (no realized price).
      const status: LotStatus = 'bought_in';
      let saleDate = '';
      if (auctionYear) saleDate =`${auctionYear}-06-01`;

      const fullUrl = href.startsWith('http') ? href : `https://www.sothebys.com${href}`;
      lots.push({
        id: `sothebys-${slug}`,
        artist: artist.slug,
        title,
        year: null,
        medium: null,
        dimensions: null,
        category: 'unknown' as LotCategory,
        imageUrl: null,
        auctionHouse: "Sotheby's",
        saleName: '',
        saleDate,
        lotNumber: null,
        ...stampMoney({
          isSold: false, // bare-link path: no estimate, no result — never 'sold'
          nativeCurrency: 'USD', // bare links carry no currency signal; default USD
          saleDate: saleDate || null,
          hammerNative: null,
          premiumNative: null,
          estLowNative: null,
          estHighNative: null,
          priceBasis: 'realized',
        }),
        status,
        url: fullUrl,
      });
    }

    const withImages = lots.filter(l => l.imageUrl).length;
    console.log(`  [Sothebys] Parsed ${lots.length} unique lots (${withImages} with images, ${lots.filter(l => l.status === 'upcoming').length} upcoming)`);
  } catch (err) {
    console.error('  [Sothebys] Error:', err);
  }

  return lots;
}

// ── Sotheby's Auction Crawler (GraphQL) ──
// Sotheby's has no maker pages; their real auction lots (watches + the
// curated Geek Week science sales) come from the auction pages, whose lots
// load through a public GraphQL API — full titles, estimates, hammer prices
// and images, no auth. We seed known watch & science sales and also discover
// the current ones from the department / Geek Week pages so CI stays fresh.
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
        bidState { sold { ... on ResultVisible { isSold premiums { finalPrice: finalPriceV2 { currency amount } } } } }
        media(imageSizes: [Medium, Large]) { images { renditions { url imageSize } } }
      }
    }
  }
}`;

// Known Sotheby's sales for historical depth (the crawler also discovers the
// current ones live). Watches map to a maker by lot; science sales carry a
// default routing hint but each lot is re-routed by its own text.
const SOTHEBYS_WATCH_SALES = [
  '2026/important-watches', '2026/fine-watches', '2025/important-watches',
  '2025/important-watches-2', '2025/fine-watches-2', '2025/fine-watches-3',
  '2024/important-watches', '2024/fine-watches',
];

const SOTHEBYS_SPORTS_SALES = ['2025/sports', '2025/sports-2', '2024/sports', '2024/the-one'];

// Art & design come through the SAME reliable GraphQL auction path as watches/
// science (NOT the flaky artist-page scrape, which carries no hammer and rots
// art in unknown-result). Sales are discovered live from the contemporary /
// modern departments; these seeds are a fallback. Sale names are diverse (no
// shared keyword), so art sales are NOT name-filtered — routeItem keeps only
// tracked-maker lots per the item-level doctrine.
const SOTHEBYS_ART_SALES = [
  '2026/contemporary-discoveries', '2026/modern-discoveries-l26158',
  '2026/surrealism-and-its-legacy-pf2666', '2026/modernites-pf2616',
];

const SOTHEBYS_SCIENCE_SALES = [
  '2026/natural-history', '2026/space-exploration-2', '2026/history-of-science-technology',
  '2026/history-of-science-technology-2', '2025/natural-history', '2025/space-exploration',
  '2025/history-of-science-technology', '2024/natural-history', '2024/space-exploration',
  '2023/space-exploration',
];

// A sale closes hours-to-days before the house posts hammer results. For that
// window a just-closed lot has no result yet — but it is NOT bought-in and must
// not vanish. We keep it VISIBLE as pending (upcoming) until the window lapses;
// a later crawl flips it to sold when the result posts. Beyond the window, a
// still-resultless lot is treated as a genuine bought-in. Two weeks comfortably
// covers every house's posting lag while limiting how long a real bought-in can
// masquerade as pending. The constant itself lives in lib/skip-set.ts
// (RESULT_PENDING_MS — single source; imported at the top of this file).

// Sotheby's gates realized prices behind a login. When a logged-in session
// cookie is provided (SOTHEBYS_COOKIE env / GitHub secret), every Sotheby's
// request carries it and sold results resolve like any other house. Without
// it the crawler still works — results just stay pending until the window
// lapses. Cookie format: the raw Cookie header value from a logged-in browser.
const SOTHEBYS_COOKIE = process.env.SOTHEBYS_COOKIE || '';

const sothebysAuth = (): Record<string, string> => (SOTHEBYS_COOKIE ? { Cookie: SOTHEBYS_COOKIE } : {});

async function sothebysAuctionMeta(slug: string): Promise<{ uuid: string; endDate: string | null; state: string; title: string } | null> {
  try {
    const res = await fetchWithRetry(`https://www.sothebys.com/en/buy/auction/${slug}`, { headers: { 'User-Agent': UA, ...sothebysAuth() }, timeoutMs: 30000 });
    if (!res.ok) { console.warn(`[Sotheby's] meta ${slug}: HTTP ${res.status}`); return null; }
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

async function sothebysAuctionLots(uuid: string): Promise<{ currency: Currency | null; lots: any[] }> {
  const out: any[] = [];
  let offset = 0;
  // null until the API names a currency the money layer converts (fail-closed)
  let currency: Currency | null = null;
  for (let guard = 0; guard < 40; guard++) {
    try {
      const res = await fetchWithRetry(SOTHEBYS_GQL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apollographql-client-name': 'sothebys-web', 'User-Agent': UA, ...sothebysAuth() },
        body: JSON.stringify({ query: SOTHEBYS_LOT_QUERY, variables: { id: uuid, limit: 100, offset } }),
        timeoutMs: 30000,
      });
      if (!res.ok) { console.warn(`  [Sotheby's] lots ${uuid} offset ${offset}: HTTP ${res.status} — stopping this sale's pagination`); break; }
      const j = await res.json() as any;
      noteFetched('sothebys');
      const auc = j?.data?.auction;
      const lc = auc?.lotCards;
      if (isCurrency(auc?.currency)) currency = auc.currency;
      if (!lc || !lc.lots) break;
      out.push(...lc.lots);
      if (!lc.hasNextPage) break;
      offset += 100;
      await sleep(350);
    } catch { break; }
  }
  return { currency, lots: out };
}

// Sotheby's timed auctions close lots individually; the sale-level schedule the
// auction page embeds LAGS (a stale max endDate), so a live lot reads as past.
// The real per-lot close only lives on the lot page (`scheduledOpeningDate`, the
// value behind the on-page countdown). Enrich UPCOMING Sotheby's lots with it so
// close times are accurate. Best-effort + capped + concurrency-limited: a lot we
// can't reach keeps its sale-level date and stays visible — accuracy NEVER costs
// a tracked lot (Collin's rule).
export async function enrichSothebysCloseTimes(lots: AuctionLot[]): Promise<void> {
  const targets = lots.filter(l => l.auctionHouse === "Sotheby's" && l.status === 'upcoming' && l.url);
  if (!targets.length) return;
  const CONC = 6, CAP = 1000;
  // Wall-clock budget (same pattern as ENRICH_TIME_BUDGET_MS): a stalled host
  // timing out every 20s fetch would walk this pass past the workflow's 60-min
  // kill and lose the whole night. Unreached lots keep their sale-level dates.
  const BUDGET_MS = 8 * 60_000;
  const start = Date.now();
  const slice = targets.slice(0, CAP);
  let enriched = 0;
  for (let i = 0; i < slice.length; i += CONC) {
    if (Date.now() - start > BUDGET_MS) {
      console.log(`  [Sotheby's] close-time budget exhausted at ${i}/${slice.length} — stopping early so the crawl still writes`);
      break;
    }
    await Promise.all(slice.slice(i, i + CONC).map(async lot => {
      try {
        const r = await fetch(lot.url, { headers: { 'User-Agent': UA, ...sothebysAuth() }, signal: AbortSignal.timeout(20000) });
        if (!r.ok) return;
        const h = await r.text();
        const raw = (h.match(/"scheduledOpeningDate":"([^"]+)"/) || [])[1]
                 || (h.match(/"cutoffTime":"([^"]+)"/) || [])[1];
        if (!raw) return;
        const d = new Date(raw);
        if (isNaN(d.getTime())) return;
        const iso = d.toISOString();
        lot.saleDate = iso.slice(0, 10);
        (lot as AuctionLot & { saleDateTime?: string }).saleDateTime = iso;
        // genuinely future now → it stands on its own date; drop the keep-visible flag
        if (d.getTime() > Date.now()) (lot as AuctionLot & { resultsPending?: boolean }).resultsPending = false;
        enriched++;
      } catch { /* unreachable → keep sale-level date + resultsPending; never drop */ }
    }));
    await sleep(120);
  }
  console.log(`  [Sotheby's] enriched ${enriched}/${slice.length} live lots with accurate per-lot close times`);
}

export async function crawlSothebysAuctions(scope: 'watches' | 'science' | 'sports' | 'art' | 'all'): Promise<AuctionLot[]> {
  const lots: AuctionLot[] = [];

  // discover current sales live so CI picks up new Geek Week / watch / art sales
  const discovered = { watches: new Set<string>(), science: new Set<string>(), sports: new Set<string>(), art: new Set<string>() };
  const grab = async (url: string, into: Set<string>) => {
    try {
      const r = await fetchWithRetry(url, { headers: { 'User-Agent': UA }, timeoutMs: 30000 });
      if (!r.ok) { console.warn(`  [Sotheby's] discovery ${url}: HTTP ${r.status} — no sales discovered from this page (seed list still runs)`); return; }
      const h = await r.text();
      const before = into.size;
      (h.match(/\/en\/buy\/auction\/20[0-9]{2}\/[a-z0-9-]+/g) || []).forEach(s => into.add(s.replace('/en/buy/auction/', '')));
      if (into.size === before) console.warn(`  [Sotheby's] discovery ${url}: 200 but 0 sale links matched — markup change?`);
    } catch (e) { console.warn(`  [Sotheby's] discovery ${url} failed: ${(e as Error).message}`); }
  };
  if (scope === 'watches' || scope === 'all') await grab('https://www.sothebys.com/en/departments/watches', discovered.watches);
  if (scope === 'science' || scope === 'all') await grab('https://www.sothebys.com/en/buy/series/geek-week?locale=en', discovered.science);
  if (scope === 'sports' || scope === 'all') await grab('https://www.sothebys.com/en/departments/popular-culture', discovered.sports);
  if (scope === 'art' || scope === 'all') {
    // contemporary + modern departments list the current art sales; take them
    // all (names are too varied to keyword-filter) and let routeItem keep only
    // tracked-maker lots.
    await grab('https://www.sothebys.com/en/departments/contemporary-art', discovered.art);
    await grab('https://www.sothebys.com/en/departments/impressionist-modern-art', discovered.art);
  }

  const watchSales = Array.from(new Set([...SOTHEBYS_WATCH_SALES, ...Array.from(discovered.watches)]))
    .filter(s => /watch/i.test(s));
  const scienceSales = Array.from(new Set([...SOTHEBYS_SCIENCE_SALES, ...Array.from(discovered.science)]))
    .filter(s => /natural-history|space-exploration|science|meteor|fossil/i.test(s));
  const sportsSales = Array.from(new Set([...SOTHEBYS_SPORTS_SALES, ...Array.from(discovered.sports)]))
    .filter(s => /sport|memorabilia|olympic|the-one/i.test(s));
  // Art sales are NOT name-filtered (diverse names); cap the count so a busy
  // season cannot explode the run — routeItem drops untracked-maker lots.
  const artSales = Array.from(new Set([...SOTHEBYS_ART_SALES, ...Array.from(discovered.art)])).slice(0, 60);

  const jobs: { sale: string; kind: 'watches' | 'science' | 'sports' | 'art' }[] = [];
  if (scope === 'watches' || scope === 'all') watchSales.forEach(sale => jobs.push({ sale, kind: 'watches' }));
  if (scope === 'science' || scope === 'all') scienceSales.forEach(sale => jobs.push({ sale, kind: 'science' }));
  if (scope === 'sports' || scope === 'all') sportsSales.forEach(sale => jobs.push({ sale, kind: 'sports' }));
  if (scope === 'art' || scope === 'all') artSales.forEach(sale => jobs.push({ sale, kind: 'art' }));

  console.log(`  [Sotheby's] ${jobs.length} sales to crawl (${watchSales.length} watch, ${scienceSales.length} science, ${sportsSales.length} sports, ${artSales.length} art)`);

  // ── INCREMENTAL-CRAWL FAST PATH (same pattern as Christie's; see the long
  // comment there for the saleName-superset-key + carry-forward reasoning).
  // Sotheby's difference: there is NO explicit end_date signal on the segment
  // rows to lean on — closure is derived STRICTLY from the segment's own lot
  // statuses + saleDate/saleDateTime (every lot terminal, none results-pending,
  // ALL datable and closed > RESULT_PENDING_MS ago). Any doubt (an undatable
  // lot, a pending flag, an upcoming) disqualifies the sale: a wrongly-skipped
  // live sale is worse than a redundant fetch. Included prior lots are ALL
  // Sotheby's-house rows (auction-crawler ids aren't prefix-distinguishable
  // from artist-page ids) — a colliding artist-page cohort can only make the
  // predicate stricter, never hide an unresolved lot. Skips are keyed by the
  // sale slug's derived saleName using the EXACT transform the loop stamps.
  const sothebysNameOf = (slug: string) => slug.split('/').pop()!.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const skippableSales = new Map<string, number>(); // saleName → prior-lot count
  if (INCREMENTAL_CRAWL) {
    try {
      const { readSegment } = await import('../../corpus-io');
      const prior = (readSegment('sothebys') as unknown as AuctionLot[]) || [];
      const names = buildSkippableSaleNames(
        prior as unknown as import('../skip-set').SkipLot[],
        () => true, // segment is already Sotheby's-only; superset keying is the safe direction
      );
      for (const [name, count] of Array.from(names.entries())) skippableSales.set(name, count);
      // A sale surfaced by TODAY's live department/series discovery is being
      // actively shown by the house — always re-crawl it (mirrors Christie's).
      const discoveredSlugs = [
        ...Array.from(discovered.watches), ...Array.from(discovered.science),
        ...Array.from(discovered.sports), ...Array.from(discovered.art),
      ];
      for (const slug of discoveredSlugs) skippableSales.delete(sothebysNameOf(slug));
    } catch (e) {
      // Segment unreadable → skip NOTHING (full crawl is the safe default).
      console.warn(`  [Sotheby's] incremental: could not read segment (${(e as Error).message}) — full crawl`);
      skippableSales.clear();
    }
  }

  let sothebysSkipped = 0, sothebysFetched = 0, sothebysCarried = 0;
  for (const { sale } of jobs) {
    // Incremental fast path: fully resolved + old + not resurfaced in discovery
    // → don't re-fetch. Its lots ride through via the merge's carry-forward.
    if (INCREMENTAL_CRAWL && skippableSales.has(sothebysNameOf(sale))) {
      sothebysSkipped++;
      sothebysCarried += skippableSales.get(sothebysNameOf(sale)) || 0;
      continue;
    }
    sothebysFetched++;
    const meta = await sothebysAuctionMeta(sale);
    if (!meta) { console.log(`  [Sotheby's] ${sale}: no metadata, skip`); continue; }
    const { currency: auctionCur, lots: rawLots } = await sothebysAuctionLots(meta.uuid);
    const saleName = sale.split('/').pop()!.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    let kept = 0;
    for (const lot of rawLots) {
      // REQUIRED-field gate: lotId keys the record + the URL tail; title is
      // the identity text. Missing either → count + drop with one warn line.
      if (!lot.lotId) { parseDrop('sothebys', 'missing lotId', `${sale}: ${String(lot.title || '').slice(0, 60)}`); continue; }
      if (!lot.title) { parseDrop('sothebys', 'missing title', `${sale}: lot ${lot.lotId}`); continue; }
      // item-level FIRST: the lot's own text decides where it belongs. Only if
      // no tracked maker matches do we fall back to the SALE as the signal — but
      // strictly for the memorabilia verticals routeItem can't identify (sports/
      // pop-culture), gated by the SAME isSportsSale/isCultureSale used in the
      // backfills so the false-friend exclusions (mechanical-music, orthodox
      // icons, etc.) parse out here too.
      let artist = routeItem(lot.creatorsDisplayTitle, lot.title, lot.subtitle || '');
      if (!artist) {
        if (isSportsSale(sale)) artist = routeSportsLot(lot.title, lot.subtitle || '');
        else if (isCultureSale(sale)) artist = routeCulture(lot.title, lot.subtitle || '');
      }
      if (!artist) continue; // nothing we track — skip, never guess

      const soldRes = lot.bidState?.sold;
      const finalPrice = soldRes?.premiums?.finalPrice;
      const isSold = !!soldRes?.isSold && !!finalPrice;
      let status: string, saleDate: string, resultsPending = false;
      if (isSold) {
        status = 'sold';
        saleDate = meta.endDate || new Date().toISOString();
      } else if (meta.state === 'Opened' || meta.state === 'Published') {
        // TRUST THE STATE over the schedule date. A timed auction closes lot by
        // lot and the embedded endDate lags — for a live ('Opened') or announced
        // ('Published') sale it can read as past, which wrongly buried these lots.
        // The house says the sale is live/upcoming, so the lot IS upcoming. Use
        // the real endDate when it's genuinely future; otherwise anchor to now
        // (the sale is live and closing imminently) so it lands correctly upcoming
        // without depending on a stale date or clock skew.
        status = 'upcoming';
        const em = meta.endDate ? new Date(meta.endDate).getTime() : NaN;
        saleDate = (!isNaN(em) && em > Date.now()) ? meta.endDate! : new Date().toISOString();
      } else if (meta.endDate && new Date(meta.endDate).getTime() > Date.now()) {
        status = 'upcoming';
        saleDate = meta.endDate;
      } else if (meta.endDate && Date.now() - new Date(meta.endDate).getTime() <= RESULT_PENDING_MS) {
        // Closed, but the house has not posted a hammer yet — keep the lot
        // VISIBLE as pending (upcoming) rather than dropping it, so a just-closed
        // sale does not vanish while we wait for results.
        status = 'upcoming';
        saleDate = meta.endDate;
        resultsPending = true;
      } else {
        continue; // closed past the results window & unsold — a true bought-in
      }
      const saleDay = saleDate.split('T')[0];

      const est = lot.estimateV2;
      const rendition = lot.media?.images?.[0]?.renditions;
      const img = rendition?.find((r: any) => r.imageSize === 'Large') || rendition?.find((r: any) => r.imageSize === 'Medium') || rendition?.[0];

      // W2: keep NATIVE, convert with a dated rate. finalPrice carries its own
      // currency (may differ from the sale's, e.g. an HKD lot in a mixed sale);
      // estimates are in the sale currency. The finalPrice is buyer-inclusive
      // (a Sotheby's realized/premium number), so it maps to premiumNative.
      // fail-closed (Oct 6 2026): the finalPrice's own currency when it names
      // one, else the sale's — validated, never an unchecked cast (an INR /
      // SGD sale used to ride through as whatever string it was)
      const finalCur: Currency | null = finalPrice?.currency ? (isCurrency(finalPrice.currency) ? finalPrice.currency : null) : auctionCur;
      const premiumNative = isSold && finalPrice ? parseFloat(finalPrice.amount) : null;

      const sMoney = stampMoney({
        isSold,
        nativeCurrency: finalCur,
        saleDate: saleDay,
        hammerNative: null,
        premiumNative,
        estLowNative: est?.lowEstimate?.amount ? parseFloat(est.lowEstimate.amount) : null,
        estHighNative: est?.highEstimate?.amount ? parseFloat(est.highEstimate.amount) : null,
        priceBasis: 'realized',
      });
      lots.push({
        id: `sothebys-${lot.lotId}`,
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
        saleDateTime: saleDate, // GraphQL gives a genuine ISO timestamp
        lotNumber: lot.lotNumber?.lotDisplayNumber ? parseInt(lot.lotNumber.lotDisplayNumber, 10) || null : null,
        ...sMoney,
        status: statusWithMoney(status, sMoney) as any,
        resultsPending,
        url: `https://www.sothebys.com/en/buy/auction/${sale}/${lot.slug?.lotSlug || lot.lotId}`,
      } as AuctionLot);
      kept++;
    }
    console.log(`  [Sotheby's] ${sale} (${meta.state}): ${rawLots.length} lots → ${kept} kept`);
    await sleep(500);
  }
  console.log(`  [Sotheby's] incremental mode: ${INCREMENTAL_MODE_REASON}`);
  if (INCREMENTAL_CRAWL) console.log(`  [Sotheby's] incremental: fetched ${sothebysFetched} sales, skipped ${sothebysSkipped} fully-resolved (${sothebysCarried} lots carried forward from segment)`);
  console.log(`  [Sotheby's] Total ${lots.length} lots (${lots.filter(l => l.status === 'sold').length} sold, ${lots.filter(l => l.status === 'upcoming').length} upcoming)`);
  return lots;
}

export async function enrichSothebys(lot: AuctionLot): Promise<EnrichResult> {
  try {
    const res = await fetch(lot.url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA } });
    if (!res.ok) return {};
    const html = await res.text();
    const $ = cheerio.load(html);
    const result: EnrichResult = {};

    // Try JSON-LD description
    let description = '';
    $('script[type="application/ld+json"]').each((_, script) => {
      try {
        const json = JSON.parse($(script).html() || '{}');
        if (json.description) description = json.description;
      } catch (e) { noteEnrichFail("Sotheby's", 'json', lot, e); }
    });

    // Fallback to og:description
    if (!description) {
      description = $('meta[property="og:description"]').attr('content') || '';
    }

    if (!description) return {};

    const medMatch = description.match(new RegExp(`(${MEDIUM_PATTERNS.source}[^,;.]{0,60})`, 'i'));
    if (medMatch) result.medium = medMatch[0].trim();

    // Sotheby's uses "X by Y in." format
    const dimMatch = description.match(/(\d+(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\.\d+)?\s*(?:by|[×x])\s*\d+(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\.\d+)?\s*(?:in|cm|mm)\.?)/i);
    if (dimMatch) result.dimensions = dimMatch[1].trim();

    const yearPatterns = [
      /(?:executed|painted|conceived|created)\s+(?:circa\s+)?(?:in\s+)?(\d{4})/i,
      /(?:circa|c\.)\s*(\d{4})/i,
    ];
    for (const pat of yearPatterns) {
      const m = description.match(pat);
      if (m) { result.year = m[1]; break; }
    }

    return result;
  } catch (e) { noteEnrichFail("Sotheby's", 'page', lot, e); return {}; }
}
