/**
 * Christie's — artist pages (embedded JSON), the auction crawler, detail enrich.
 *
 * Moved verbatim out of scripts/ray-crawl.ts (house split, Sep 2026).
 */
import * as cheerio from 'cheerio';
import type { AuctionLot, Currency, LotCategory } from '../../../app/types';
import { routeCulture, isCultureSale } from '../../culture';
import { isSportsSale, routeSportsLot } from '../../sports-sale';
import { fetchWithRetry } from '../fetch-retry';
import { buildSkippableSaleNames } from '../skip-set';
import { parseEstimateRange } from '../estimate-range';
import type { ArtistConfig } from './artists';
import { DEEP, type EnrichResult, INCREMENTAL_CRAWL, INCREMENTAL_MODE_REASON, MEDIUM_PATTERNS, UA, balancedObjectAfter, detectCurrency, isSaleDayPast, noteEnrichFail, noteExpected, noteFetched, parseDrop, sleep, stampMoney, statusWithMoney } from './common';
import { routeItem } from './routing';

// ── Christie's Crawler ──
// Christie's embeds lot data as JSON in window.chrComponents.configurableSearch.

export function parseChristiesHtml(html: string, artistSlug: string): AuctionLot[] {
  // brace-balanced, string-aware (see balancedObjectAfter) — the old
  // `(\{[\s\S]*?\});` stopped at the first `});` even inside a JSON string
  const json = balancedObjectAfter(html, /window\.chrComponents\.configurableSearch\s*=\s*/)
    ?? balancedObjectAfter(html, /configurableSearch\s*=\s*/);
  if (json) return parseChristiesJson(json, artistSlug);
  if (/configurableSearch/.test(html)) console.warn("  [Christie's] configurableSearch anchor present but the object never balanced — markup change?");
  return [];
}

export async function crawlChristies(artist: ArtistConfig): Promise<AuctionLot[]> {
  if (!artist.christies) return [];

  const lots: AuctionLot[] = [];
  const seen = new Set<string>();

  // deep mode: the artist page paginates — walk back through history
  if (DEEP) {
    for (let p = 2; p <= 8; p++) {
      await sleep(800);
      try {
        const r = await fetchWithRetry(`https://www.christies.com/en/artists/${artist.christies}?lotavailability=All&sortby=relevance&page=${p}`, {
          headers: { 'User-Agent': UA }, timeoutMs: 30000,
        });
        if (!r.ok) break;
        const pageLots = parseChristiesHtml(await r.text(), artist.slug);
        let fresh = 0;
        pageLots.forEach(lot => { if (!seen.has(lot.id)) { seen.add(lot.id); lots.push(lot); fresh++; } });
        if (fresh === 0) break;
      } catch (e) { console.warn(`  [Christie's] deep-page fetch failed: ${(e as Error).message}`); break; }
    }
    if (lots.length) console.log(`  [Christie's] Deep pages added ${lots.length} lots`);
  }

  // Fetch from artist page (gets recent/past lots)
  const artistUrl = `https://www.christies.com/en/artists/${artist.christies}?lotavailability=All&sortby=relevance`;
  console.log(`  [Christie's] Fetching artist page for ${artist.displayName}...`);

  try {
    const res = await fetchWithRetry(artistUrl, {
      headers: { 'User-Agent': UA },
      timeoutMs: 30000,
    });
    if (res.ok) {
      noteFetched('christies');
      parseChristiesHtml(await res.text(), artist.slug).forEach(lot => {
        if (!seen.has(lot.id)) {
          seen.add(lot.id);
          lots.push(lot);
        }
      });
    }
  } catch (err) {
    console.error("  [Christie's] Error fetching artist page:", err);
  }

  // Also fetch from search (gets upcoming lots that might not be on artist page)
  const searchUrl = `https://www.christies.com/en/search?entry=${encodeURIComponent(artist.displayName)}&page=1&sortby=relevance&tab=available_lots`;
  console.log(`  [Christie's] Fetching search for upcoming lots...`);

  try {
    const res = await fetchWithRetry(searchUrl, {
      headers: { 'User-Agent': UA },
      timeoutMs: 30000,
    });
    if (res.ok) {
      noteFetched('christies');
      parseChristiesHtml(await res.text(), artist.slug).forEach(lot => {
        if (!seen.has(lot.id)) {
          seen.add(lot.id);
          lots.push(lot);
        }
      });
    }
  } catch (err) {
    console.error("  [Christie's] Error fetching search:", err);
  }

  console.log(`  [Christie's] Found ${lots.length} total lots`);
  return lots;
}

export function parseChristiesJson(jsonStr: string, artistSlug: string): AuctionLot[] {
  const lots: AuctionLot[] = [];
  try {
    const data = JSON.parse(jsonStr);
    const lotData = data?.data?.lots || data?.lots || [];
    console.log(`  [Christie's] Found ${lotData.length} lots`);

    for (const lot of lotData) {
      const titleSecondary = lot.title_secondary_txt || '';
      const title = titleSecondary || lot.title_primary_txt || 'Untitled';
      const lotId = lot.object_id || lot.lot_id_txt || '';
      // REQUIRED-field gate: no id → an unkeyable/undedupable `christies-` row
      // AND a dead built URL; no title source at all → junk. Count + drop.
      if (!lotId) { parseDrop('christies', 'missing object_id/lot_id_txt', String(lot.title_primary_txt || '').slice(0, 80)); continue; }
      if (!titleSecondary && !lot.title_primary_txt) { parseDrop('christies', 'missing title', `lot ${lotId}`); continue; }
      const lotUrl = lot.url || `https://www.christies.com/en/lot/lot-${lotId}`;

      const estimateStr = lot.estimate_txt || '';
      // the estimate names the sale currency; an estimate-on-request lot falls
      // back to the realized string; neither → null (fail-closed, never USD)
      const currency = detectCurrency(estimateStr) ?? detectCurrency(lot.price_realised_txt || '');
      // RANGE-AWARE estimate parse (lib/estimate-range). The old
      // `([\d,]+)\s*[-–]\s*([\d,]+)` regex could not cross a repeated currency
      // token ("GBP 200,000 - GBP 300,000") or an em dash, silently dropping
      // the WHOLE band; and a single-value estimate never populated at all.
      // Now: both bounds land in estimateLow/estimateHigh (a single value
      // becomes a flat low==high band); "estimate on request" stays null.
      const { low: estimateLow, high: estimateHigh } = parseEstimateRange(estimateStr);

      // price_realised_txt is a REALIZED price — a single number by nature
      // (never a range), so a first-number parse is the correct semantics
      // here. Do NOT range-parse/sum/average a realized string.
      const priceStr = lot.price_realised_txt || '';
      let priceRealized: number | null = null;
      const priceMatch = priceStr.match(/([\d,]+)/);
      if (priceMatch) {
        priceRealized = parseInt(priceMatch[0].replace(/,/g, ''));
      }

      const saleDate = lot.start_date ? lot.start_date.split('T')[0] : '';
      const auctionInPast = saleDate ? isSaleDayPast(saleDate) : true; // default to past if no date
      const isSold = priceRealized != null && priceRealized > 0;
      const imageUrl = lot.image?.image_src || null;
      const saleNum = lot.sale?.number || '';
      const lotNum = lot.lot_id_txt || '';

      // Try to extract medium from Christie's data — only use short medium_txt, not full description
      const rawMedium = lot.medium_txt || null;
      const christiesMedium = rawMedium && String(rawMedium).length < 150
        ? String(rawMedium).replace(/<[^>]*>/g, '')
        : null;

      // Extract dimensions from Christie's data
      const rawDimensions = lot.measurements_txt || lot.dimensions_txt || null;
      const christiesDimensions = rawDimensions && String(rawDimensions).length < 200
        ? String(rawDimensions).replace(/<[^>]*>/g, '').replace(/&times;/g, '×').replace(/&ndash;/g, '–')
        : null;

      // Christie's publishes price realised (buyer-inclusive) — the realized
      // number is the premium; hammer is not exposed here.
      const christiesDescription = lot.description_txt && String(lot.description_txt).length < 4000
        ? String(lot.description_txt).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null
        : null;

      const money = stampMoney({
        isSold,
        nativeCurrency: currency,
        saleDate: saleDate || null,
        hammerNative: null,
        premiumNative: priceRealized,
        estLowNative: estimateLow,
        estHighNative: estimateHigh,
        priceBasis: 'realized',
      });
      lots.push({
        id: `christies-${lotId}`,
        artist: artistSlug,
        title: title.replace(/<[^>]*>/g, ''),
        year: lot.date_txt || null,
        medium: christiesMedium,
        dimensions: christiesDimensions,
        description: christiesDescription,
        category: 'unknown' as LotCategory,
        imageUrl,
        auctionHouse: "Christie's",
        saleName: lot.sale?.location ? `${lot.sale.location} Sale ${saleNum}` : '',
        saleDate,
        lotNumber: lotNum ? parseInt(lotNum) : null,
        ...money,
        status: statusWithMoney(isSold ? 'sold' : auctionInPast ? 'bought_in' : 'upcoming', money),
        url: lotUrl.startsWith('http') ? lotUrl : `https://www.christies.com${lotUrl}`,
      });
    }
  } catch (e) {
    console.log("  [Christie's] JSON parse error:", (e as Error).message?.substring(0, 100));
  }
  return lots;
}

// ── Christie's Auction Crawler ──
// Same bar as the Sotheby's crawler: full watch & science auction lots (not
// the 50-lot maker/search page). Christie's auction pages embed all lot data
// in `window.chrComponents.lots` — titles, estimates, prices realised, images.
// Pages ≥2 return the whole sale; we dedupe by object_id to be safe.
const CHRISTIES_WATCH_SEEDS = [
  'important-watches-30715', 'important-watches-24504',
  'rare-watches-including-watches-for-ela-24403', 'watches-online-the-new-york-edit-24505',
];

const CHRISTIES_SCIENCE_SEEDS = ['jurassic-icons-allosaurus-stegosaurus-30576'];

const CHRISTIES_SPORTS_SEEDS = ['the-golden-age-of-baseball-selections-of-works-from-the-national-pastime-museum-26565'];

// Art discovered live from the contemporary / modern / prints departments;
// names too varied to keyword-filter, so routeItem keeps only tracked makers.
const CHRISTIES_ART_SEEDS = ['avant-garde-s-including-thinking-italian-24607', 'art-contemporain-vente-du-jour-24609', 'art-moderne-24608'];

/** The sale currency of a Christie's lot from its realized + estimate text —
 *  detectCurrency's fail-closed read (Oct 6 2026: null for a currency the
 *  money layer cannot convert, never a silent 'USD'). */
export function parseChristiesCurrency(txt: string): Currency | null {
  return detectCurrency(txt);
}

async function christiesAuctionLots(slug: string): Promise<any[]> {
  const byId = new Map<string, any>();
  let total = Infinity;
  // Cap high enough to cover flagship sales (hundreds of lots) — a hard 12 could
  // silently truncate a large sale. The `byId.size < total` guard stops early on
  // normal sales; this is just the runaway ceiling.
  const MAX_PAGES = 60;
  for (let page = 1; page <= MAX_PAGES && byId.size < total; page++) {
    try {
      const res = await fetchWithRetry(`https://www.christies.com/en/auction/${slug}?sortby=lotnumber&page=${page}`, {
        headers: { 'User-Agent': UA }, timeoutMs: 30000,
      });
      if (!res.ok) { console.warn(`  [Christie's] ${slug} page ${page}: HTTP ${res.status}`); break; }
      const html = await res.text();
      noteFetched('christies');
      // brace-balanced + string-aware: a `});` inside a lot's JSON string used
      // to truncate the object → JSON.parse throw → the whole sale read as empty
      const m = balancedObjectAfter(html, /window\.chrComponents\.lots\s*=\s*/);
      if (!m) { if (page === 1) console.warn(`  [Christie's] ${slug}: no window.chrComponents.lots object on page 1 — markup change?`); break; }
      const d = JSON.parse(m);
      const lots = d?.data?.lots;
      if (!Array.isArray(lots)) break; // malformed/empty page — don't throw
      total = d.data.total_hits_filtered || lots.length;
      const before = byId.size;
      for (const lot of lots) byId.set(lot.object_id, lot);
      if (byId.size === before) break; // no new lots
      await sleep(400);
    } catch { break; }
  }
  if (byId.size < total && total !== Infinity) console.warn(`[Christie's] ${slug}: paginated ${byId.size}/${total} lots — sale may be truncated (raise MAX_PAGES?)`);
  // health: the source's own advertised sale size (total_hits_filtered)
  if (total !== Infinity) noteExpected('christies', total);
  return Array.from(byId.values());
}

export async function crawlChristiesAuctions(scope: 'watches' | 'science' | 'sports' | 'art' | 'all'): Promise<AuctionLot[]> {
  const lots: AuctionLot[] = [];
  const discovered = { watches: new Set<string>(), science: new Set<string>(), sports: new Set<string>(), art: new Set<string>() };
  const grab = async (url: string, into: Set<string>) => {
    try {
      const r = await fetchWithRetry(url, { headers: { 'User-Agent': UA }, timeoutMs: 30000 });
      if (!r.ok) { console.warn(`  [Christie's] discovery ${url}: HTTP ${r.status} — no sales discovered from this page (seed list still runs)`); return; }
      const h = await r.text();
      const before = into.size;
      (h.match(/\/en\/auction\/[a-z0-9-]+-[0-9]{4,6}/g) || []).forEach(s => into.add(s.replace('/en/auction/', '')));
      if (into.size === before) console.warn(`  [Christie's] discovery ${url}: 200 but 0 sale links matched — markup change?`);
    } catch (e) { console.warn(`  [Christie's] discovery ${url} failed: ${(e as Error).message}`); }
  };
  if (scope === 'watches' || scope === 'all') await grab('https://www.christies.com/en/departments/watches-and-wristwatches', discovered.watches);
  if (scope === 'science' || scope === 'all') await grab('https://www.christies.com/en/departments/science-and-natural-history', discovered.science);
  if (scope === 'sports' || scope === 'all') await grab('https://www.christies.com/en/departments/sports-memorabilia', discovered.sports);
  if (scope === 'art' || scope === 'all') {
    await grab('https://www.christies.com/en/departments/post-war-and-contemporary-art', discovered.art);
    await grab('https://www.christies.com/en/departments/impressionist-and-modern-art', discovered.art);
    await grab('https://www.christies.com/en/departments/prints-and-multiples', discovered.art);
  }

  const watchSales = Array.from(new Set([...CHRISTIES_WATCH_SEEDS, ...Array.from(discovered.watches)]));
  const scienceSales = Array.from(new Set([...CHRISTIES_SCIENCE_SEEDS, ...Array.from(discovered.science)]));
  const sportsSales = Array.from(new Set([...CHRISTIES_SPORTS_SEEDS, ...Array.from(discovered.sports)]));
  const artSales = Array.from(new Set([...CHRISTIES_ART_SEEDS, ...Array.from(discovered.art)])).slice(0, 60);

  const jobs: { sale: string; kind: 'watches' | 'science' | 'sports' | 'art' }[] = [];
  if (scope === 'watches' || scope === 'all') watchSales.forEach(sale => jobs.push({ sale, kind: 'watches' }));
  if (scope === 'science' || scope === 'all') scienceSales.forEach(sale => jobs.push({ sale, kind: 'science' }));
  if (scope === 'sports' || scope === 'all') sportsSales.forEach(sale => jobs.push({ sale, kind: 'sports' }));
  if (scope === 'art' || scope === 'all') artSales.forEach(sale => jobs.push({ sale, kind: 'art' }));
  console.log(`  [Christie's Auctions] ${jobs.length} sales (${watchSales.length} watch, ${scienceSales.length} science, ${sportsSales.length} sports, ${artSales.length} art)`);

  // ── INCREMENTAL-CRAWL FAST PATH (default ON; Sunday UTC = full sweep) ─────
  // Build the set of sale NAMES that are already fully resolved in the current
  // segment, so we can skip re-fetching those sales. This block is ONLY entered
  // when INCREMENTAL_CRAWL is on (weekday default, or forced via env=1); when
  // off (Sunday full-sweep backstop, or forced via env=0), `skippableSaleNames`
  // stays empty and the sale loop below fetches every sale (byte-identical to
  // the original full crawl). The resolved-sale predicate lives in
  // scripts/lib/skip-set.ts (shared with the Sotheby's auction crawler).
  //
  // KEYING NOTE (why saleName, and why that is safe): a persisted lot does NOT
  // store the sale slug/code — only a saleName derived from the slug via the
  // exact transform used below (`slug → Title Case`). saleName is therefore a
  // SUPERSET key: recurring sales ("Design", "Important Watches") fold multiple
  // seasons' lots under one name. That only makes the predicate STRICTER — a
  // collision can add reasons to re-fetch (a live current cohort blocks the
  // name) but can NEVER hide an unresolved lot behind a skip. That is the safe
  // direction: at worst we re-fetch a sale we could have skipped; we never skip
  // a sale that still has a live/pending lot.
  //
  // CARRY-FORWARD: skipping a sale means we push NO fresh lots for it. Its
  // existing lots are preserved automatically by the caller's merge — lotMap is
  // seeded from the segment (`for (const lot of existingLots) lotMap.set(...)`),
  // and a lot that is never overwritten by a fresh crawl stays in lotMap and is
  // written back out. So "skip a fetch" can never drop those lots. And because
  // every carried-forward lot for a skipped sale is sold/settled-bought_in and
  // OLDER than RESULT_PENDING_MS, neither the W11 zombie-reconcile (only touches
  // 'upcoming') nor the results-pending net (only re-holds within the window)
  // will mutate them.
  const skippableSaleNames = new Map<string, number>(); // saleName → prior-lot count
  const nameOf = (slug: string) => slug.replace(/-\d{4,6}$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (INCREMENTAL_CRAWL) {
    try {
      const { readSegment } = await import('../../corpus-io');
      const prior = (readSegment('christies') as unknown as AuctionLot[]) || [];
      // A sale is skippable only if EVERY christies-auc lot under its name is a
      // terminal, old, non-online result — see lib/skip-set.ts for the full
      // predicate (any single failing lot disqualifies the whole name; online-
      // only sales, pending results, and anything inside RESULT_PENDING_MS are
      // never skipped).
      const names = buildSkippableSaleNames(
        prior as unknown as import('../skip-set').SkipLot[],
        l => String(l.id).startsWith('christies-auc-'), // only this crawler's lots
      );
      for (const [name, count] of Array.from(names.entries())) skippableSaleNames.set(name, count);
      // A sale reappearing in TODAY's live department discovery must ALWAYS be
      // re-crawled (it is being actively surfaced), even if the segment looks
      // resolved — remove any such name from the skip set.
      const discoveredSlugs = [
        ...Array.from(discovered.watches), ...Array.from(discovered.science),
        ...Array.from(discovered.sports), ...Array.from(discovered.art),
      ];
      for (const slug of discoveredSlugs) skippableSaleNames.delete(nameOf(slug));
    } catch (e) {
      // If the segment can't be read, skip NOTHING — fall back to a full crawl
      // (the safe default). Never let an incremental optimization drop coverage.
      console.warn(`  [Christie's Auctions] incremental: could not read segment (${(e as Error).message}) — full crawl`);
      skippableSaleNames.clear();
    }
  }

  let skipped = 0, fetched = 0, carried = 0;
  for (const { sale } of jobs) {
    // Incremental fast path: this sale is fully resolved + old + not resurfaced
    // in discovery → don't re-fetch. Its lots ride through via carry-forward.
    if (INCREMENTAL_CRAWL && skippableSaleNames.has(nameOf(sale))) {
      skipped++;
      carried += skippableSaleNames.get(nameOf(sale)) || 0;
      continue;
    }
    fetched++;
    const rawLots = await christiesAuctionLots(sale);
    const saleName = sale.replace(/-\d{4,6}$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    let kept = 0;
    for (const lot of rawLots) {
      const primary = lot.title_primary_txt || '';
      const secondary = lot.title_secondary_txt || '';
      const title = secondary ? `${primary} ${secondary}`.trim() : primary;
      // REQUIRED-field gate: object_id keys the record; a titleless lot is junk.
      if (!lot.object_id) { parseDrop('christies', 'missing object_id', `${sale}: ${title.slice(0, 60)}`); continue; }
      if (!title) { parseDrop('christies', 'missing title', `${sale}: lot ${lot.object_id}`); continue; }
      if (lot.lot_withdrawn) continue;
      // item-level FIRST, then SALE as fallback for the memorabilia verticals
      // routeItem can't identify (sports/pop-culture), gated by the same
      // isSportsSale/isCultureSale as the backfills (mechanical-music/orthodox-
      // icon false friends parse out here too).
      let artist = routeItem(primary, secondary, lot.description_txt || '');
      if (!artist) {
        if (isSportsSale(sale)) artist = routeSportsLot(title, lot.description_txt || '');
        else if (isCultureSale(sale)) artist = routeCulture(title, lot.description_txt || '');
      }
      if (!artist) continue; // nothing we track — skip, never guess

      const realisedNum = parseFloat(lot.price_realised || '');
      const isSold = !!realisedNum && realisedNum > 0;
      const cur = parseChristiesCurrency(`${lot.price_realised_txt || ''} ${lot.estimate_txt || ''}`);
      const endDate = lot.end_date || lot.start_date;
      const endMs = endDate ? new Date(endDate).getTime() : NaN;
      let status: string, saleDate: string, resultsPending = false;
      if (isSold) {
        status = 'sold';
        saleDate = endDate || new Date().toISOString();
      } else {
        // DO NOT trust www.christies.com's is_auction_over / schedule date to
        // CLOSE a lot — it is STALE for online ("First Open"/onlineonly) sales,
        // reporting a sale as over (2013 dates!) when it is actually live and
        // days from closing. That buried live lots (Collin's Tom Sachs). So a
        // resultless lot is ALWAYS kept VISIBLE: a genuinely-future endDate
        // stands as-is; anything else is held pending (upcoming) so a live lot
        // is never lost to a bad date. (Accurate close times come from the
        // onlineonly enrichment pass.)
        status = 'upcoming';
        if (!isNaN(endMs) && endMs > Date.now()) {
          saleDate = endDate; // a genuine future date can be trusted
        } else {
          // stale/unreliable www date (can be years old for online sales) —
          // anchor to now so we never render a garbage date; keep it VISIBLE.
          // The true close comes from the onlineonly enrichment.
          saleDate = new Date().toISOString();
          resultsPending = true;
        }
      }
      const saleDay = saleDate.split('T')[0];
      const christiesAucDescription = lot.description_txt && String(lot.description_txt).length < 4000
        ? String(lot.description_txt).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null
        : null;

      const auctionMoney = stampMoney({
        isSold,
        nativeCurrency: cur,
        saleDate: saleDay,
        hammerNative: null,
        premiumNative: isSold ? realisedNum : null,
        estLowNative: lot.estimate_low ? parseFloat(lot.estimate_low) : null,
        estHighNative: lot.estimate_high ? parseFloat(lot.estimate_high) : null,
        priceBasis: 'realized',
      });
      lots.push({
        id: `christies-auc-${lot.object_id}`,
        artist,
        title,
        year: null,
        medium: secondary || null,
        dimensions: null,
        description: christiesAucDescription,
        category: 'unknown',
        imageUrl: lot.image?.image_src || null,
        auctionHouse: "Christie's",
        saleName,
        saleDate: saleDay,
        saleDateTime: endDate || null,
        lotNumber: null,
        // W2: price realised is buyer-inclusive → premiumNative; keep native +
        // convert with a dated rate. Estimates are in the same sale currency.
        ...auctionMoney,
        status: statusWithMoney(status, auctionMoney) as any,
        resultsPending,
        url: lot.url || `https://www.christies.com/en/auction/${sale}`,
      } as AuctionLot);
      kept++;
    }
    console.log(`  [Christie's Auctions] ${sale}: ${rawLots.length} lots → ${kept} kept`);
    await sleep(500);
  }
  console.log(`  [Christie's Auctions] incremental mode: ${INCREMENTAL_MODE_REASON}`);
  if (INCREMENTAL_CRAWL) console.log(`  [Christie's Auctions] incremental: fetched ${fetched} sales, skipped ${skipped} fully-resolved (${carried} lots carried forward from segment)`);
  console.log(`  [Christie's Auctions] Total ${lots.length} lots (${lots.filter(l => l.status === 'sold').length} sold, ${lots.filter(l => l.status === 'upcoming').length} upcoming)`);
  return lots;
}

export async function enrichChristies(lot: AuctionLot): Promise<EnrichResult> {
  try {
    const res = await fetch(lot.url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA } });
    if (!res.ok) return {};
    const html = await res.text();
    const $ = cheerio.load(html);
    const result: EnrichResult = {};

    // Strategy 1: Parse the accordion text (most reliable)
    // Christie's has lot details in <span class="chr-lot-section__accordion--text">
    let detailText = '';
    $('span.chr-lot-section__accordion--text').each((_, el) => {
      const t = $(el).text().trim();
      if (t && !detailText) detailText = t;
    });

    // Strategy 2: Try window.chrComponents.lotHeader_* JSON for dimensions
    if (!detailText) {
      $('script').each((_, script) => {
        const content = $(script).html() || '';
        const m = balancedObjectAfter(content, /window\.chrComponents\.lotHeader_\d+\s*=\s*/);
        if (m) {
          try {
            const json = JSON.parse(m);
            const lotData = json?.data?.lots?.[0];
            if (lotData?.lot_assets?.[0]?.measurements_txt) {
              result.dimensions = lotData.lot_assets[0].measurements_txt;
            }
          } catch (e) { noteEnrichFail("Christie's", 'json', lot, e); }
        }
      });
    }

    // Strategy 3: Fallback to data-scroll-section
    if (!detailText) {
      detailText = $('[data-scroll-section="Details"]').text().trim();
    }

    if (!detailText && !result.dimensions) return {};

    if (detailText) {
      // Extract medium
      const medMatch = detailText.match(new RegExp(`(${MEDIUM_PATTERNS.source}[^,\\.\\n]{0,80})`, 'i'));
      if (medMatch) result.medium = medMatch[0].trim();

      // Extract dimensions: "243.8 x 203.2 cm. (97 x 80 in.)" or "24 x 18 in."
      if (!result.dimensions) {
        const dimMatch = detailText.match(/(\d+(?:[.,]\d+)?(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\s+\d+\/\d+)?\s*[×x]\s*\d+(?:[.,]\d+)?(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\s+\d+\/\d+)?\s*(?:in|cm)\.?(?:\s*\([^)]+\))?)/i);
        if (dimMatch) result.dimensions = dimMatch[1].trim();
      }

      // Extract year
      const yearPatterns = [
        /(?:executed|painted|conceived|made|created|dated)\s+(?:circa|c\.?\s*)?\s*(?:in\s+)?(\d{4})/i,
        /(?:circa|c\.)\s*(\d{4})/i,
        /,\s*(\d{4})\s*(?:[,.]|$)/,
      ];
      for (const pat of yearPatterns) {
        const m = detailText.match(pat);
        if (m) { result.year = m[1]; break; }
      }
    }

    return result;
  } catch (e) { noteEnrichFail("Christie's", 'page', lot, e); return {}; }
}
