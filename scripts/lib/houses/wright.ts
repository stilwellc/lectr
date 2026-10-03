/**
 * Wright / Rago — shared Laravel group-platform artist API (basic + advanced items).
 *
 * Moved verbatim out of scripts/ray-crawl.ts (house split, Sep 2026).
 */
import * as cheerio from 'cheerio';
import type { AuctionLot, AuctionHouse, LotCategory } from '../../../app/types';
import { fetchWithRetry } from '../fetch-retry';
import { parseEstimateRange } from '../estimate-range';
import type { ArtistConfig } from './artists';
import { DEEP, UA, isSaleDayPast, noteFetched, parseDrop, sleep, stampMoney } from './common';

// ── Wright/Rago Crawler ──
// Wright uses Inertia.js (Laravel + Vue). All lot data is in the #app div's data-page attribute.
// Basic artist pages use results_grouped; advanced/custom pages use results.primary_results.paginator.

export async function crawlWright(artist: ArtistConfig): Promise<AuctionLot[]> {
  if (!artist.wright) return [];
  const lots: AuctionLot[] = [];
  const url = `https://www.wright20.com/artists/${artist.wright}`;
  console.log(`  [Wright] Fetching ${artist.displayName}...`);

  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': UA },
      timeoutMs: 30000,
    });
    if (!res.ok) {
      console.log(`  [Wright] HTTP ${res.status}`);
      return lots;
    }
    noteFetched('wright');
    const html = await res.text();
    const $ = cheerio.load(html);

    const dataPage = $('#app').attr('data-page');
    if (!dataPage) {
      console.log('  [Wright] No data-page attribute found on #app');
      return lots;
    }

    const pageData = JSON.parse(dataPage);
    const resultsGrouped = pageData?.props?.results_grouped;

    // Try basic page format (results_grouped)
    if (resultsGrouped && Array.isArray(resultsGrouped) && resultsGrouped.length > 0) {
      let totalItems = 0;
      for (const group of resultsGrouped) {
        const sessions = group.sessions || {};
        for (const sessionKey of Object.keys(sessions)) {
          const session = sessions[sessionKey];
          const items = session.items || [];
          for (const item of items) {
            totalItems++;
            const parsed = parseWrightBasicItem(item, session, sessionKey, artist.slug);
            if (parsed) lots.push(parsed); // null = dropped for a missing required field (counted)
          }
        }
      }
      console.log(`  [Wright] Parsed ${totalItems} lots (basic page)`);
      return fixWrightRagoSessions(lots);
    }

    // Try advanced/custom page format (paginator)
    const paginator = pageData?.props?.results?.primary_results?.paginator?.items
      || pageData?.props?.results?.primary_results?.sorted_items?.results;
    if (paginator?.data && Array.isArray(paginator.data)) {
      const items = paginator.data;
      const lastPage = paginator.last_page || 1;
      console.log(`  [Wright] Found ${items.length} lots on page 1 of ${lastPage} (${paginator.total || items.length} total, advanced page)`);
      for (const item of items) {
        const parsed = parseWrightAdvancedItem(item, artist.slug);
        if (parsed) lots.push(parsed); // null = dropped for a missing required field (counted)
      }
      // deep mode: walk the whole paginator (history lives back here)
      if (DEEP && lastPage > 1) {
        const cap = Math.min(lastPage, 30);
        for (let p = 2; p <= cap; p++) {
          await sleep(600);
          try {
            const r2 = await fetchWithRetry(`${url}?page=${p}`, { headers: { 'User-Agent': UA }, timeoutMs: 30000 });
            if (!r2.ok) break;
            const $2 = cheerio.load(await r2.text());
            const dp2 = $2('#app').attr('data-page');
            if (!dp2) break;
            const pd2 = JSON.parse(dp2);
            const pag2 = pd2?.props?.results?.primary_results?.paginator?.items
              || pd2?.props?.results?.primary_results?.sorted_items?.results;
            const items2 = pag2?.data;
            if (!items2 || !Array.isArray(items2) || items2.length === 0) break;
            for (const item of items2) {
              const parsed = parseWrightAdvancedItem(item, artist.slug);
              if (parsed) lots.push(parsed);
            }
          } catch { break; }
        }
        console.log(`  [Wright] Deep walk complete: ${lots.length} lots total`);
      }
      return fixWrightRagoSessions(lots);
    }

    console.log('  [Wright] No lot data found in page data');
  } catch (err) {
    console.error('  [Wright] Error:', err);
  }

  return fixWrightRagoSessions(lots);
}

/** Session-level Rago detection (W12b). The Wright artist-page API tags house
 *  per ITEM and misses some: one "Prints Unlimited" session shipped 5 lots as
 *  Rago and 2 as Wright, whose wright20.com URLs 404 — the sale lives on
 *  ragoarts.com. The sale path inside the URL is the true session key: when
 *  ANY lot of a session sold under Rago, the whole session did. Re-attribute
 *  the stragglers BEFORE ids leave the crawler (invariant 6 requires the id
 *  prefix to match the selling house, so this must happen at birth, not in a
 *  fix-up pass over the corpus).
 */
export function fixWrightRagoSessions(lots: AuctionLot[]): AuctionLot[] {
  const salePathOf = (u: string | null | undefined) => {
    const m = (u || '').match(/\/auctions\/\d{4}\/\d{2}\/[^/?#]+/);
    return m ? m[0] : null;
  };
  const ragoSales = new Set<string>();
  for (const l of lots) {
    const p = salePathOf(l.url);
    if (p && l.auctionHouse === 'Rago') ragoSales.add(p);
  }
  if (!ragoSales.size) return lots;
  for (const l of lots) {
    const p = salePathOf(l.url);
    if (!p || l.auctionHouse !== 'Wright' || !ragoSales.has(p)) continue;
    l.auctionHouse = 'Rago';
    l.platform = 'wright';
    l.id = l.id.replace(/^wright-/, 'rago-');
    if (l.url) l.url = l.url.replace('://www.wright20.com', '://www.ragoarts.com');
    console.log(`  [Wright] ${p}: re-attributed ${l.id} to Rago (session-level)`);
  }
  return lots;
}

export function parseWrightBasicItem(item: any, session: any, sessionKey: string, artistSlug: string): AuctionLot | null {
  const title = item.name || 'Untitled';
  const lotNum = item.lot_number || null;
  const house = (item.house || 'Wright') as string;
  const result = item.result || null;
  const resultSansPremium = item.result_sans_premium || null;

  // REQUIRED-field gate: id needs fd_key or lot_number; a lot without a name
  // or without any alias URL is unusable. Count + drop (optional fields never drop).
  if (!item.fd_key && !lotNum) { parseDrop('wright', 'missing id (fd_key+lot_number)', String(item.name || '').slice(0, 80)); return null; }
  if (!item.name) { parseDrop('wright', 'missing title', `fd_key=${item.fd_key || `${lotNum}-${sessionKey}`}`); return null; }
  if (!item.alias) { parseDrop('wright', 'missing url (alias)', String(item.name).slice(0, 80)); return null; }

  // range-aware (lib/estimate-range): tolerates em dashes, repeated currency
  // symbols between the bounds, and single-value estimates (flat band).
  const estStr = item.estimate_formatted || '';
  const { low: estimateLow, high: estimateHigh } = parseEstimateRange(estStr);

  const sessionDate = session.date || item.session?.date || '';
  let saleDate = '';
  if (sessionDate) {
    try {
      const d = new Date(sessionDate);
      if (!isNaN(d.getTime())) saleDate = d.toISOString().split('T')[0];
    } catch { /* skip */ }
  }

  const auctionInPast = saleDate ? isSaleDayPast(saleDate) : false;
  const isSold = result != null && result > 0;
  const imageUrl = item.primary_index_image || null;

  let lotUrl = item.alias || '';
  if (lotUrl.startsWith('//')) lotUrl = 'https:' + lotUrl;
  else if (!lotUrl.startsWith('http') && lotUrl) lotUrl = 'https://www.wright20.com' + lotUrl;

  const auctionHouse: AuctionHouse = house.toLowerCase().includes('rago') ? 'Rago' : 'Wright';
  const dims = item.formatted_dimensions || null;

  // Extract year from Wright basic item
  const year = item.year_designed || item.circa || item.year || null;

  // Rago's lots are crawled through Wright's Inertia stack — record the crawl-
  // origin platform when the selling house differs (identity §1a / W12). W12
  // also renamespaces the id: a Rago lot is `rago-*` (invariant 6, id prefix
  // matches the SELLING house), with `platform:'wright'` carrying the origin.
  // Existing wright-* Rago rows were renamespaced by the (completed, since
  // removed) migrate-v2 backfill, so born-v2 crawler ids line up with it.
  const platform = auctionHouse === 'Rago' ? 'wright' : null;
  const idPrefix = auctionHouse === 'Rago' ? 'rago' : 'wright';

  return {
    id: `${idPrefix}-${item.fd_key || `${lotNum}-${sessionKey}`}`,
    artist: artistSlug,
    title,
    year,
    medium: item.material || null,
    dimensions: dims ? dims.replace(/&times;/g, '×').replace(/&ndash;/g, '–') : null,
    description: item.description ? String(item.description).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null : null,
    platform,
    category: 'unknown' as LotCategory,
    imageUrl,
    auctionHouse,
    saleName: session.title || '',
    saleDate,
    lotNumber: lotNum,
    ...stampMoney({
      isSold,
      nativeCurrency: 'USD', // Wright/Rago publish USD
      saleDate: saleDate || null,
      hammerNative: resultSansPremium,
      premiumNative: result,
      estLowNative: estimateLow,
      estHighNative: estimateHigh,
      priceBasis: 'realized',
    }),
    status: isSold ? 'sold' : auctionInPast ? 'bought_in' : 'upcoming',
    url: lotUrl,
  };
}

export function parseWrightAdvancedItem(item: any, artistSlug: string): AuctionLot | null {
  const title = item.name || 'Untitled';
  const lotNum = item.lot_number || null;

  // REQUIRED-field gate (same doctrine as the basic parser).
  if (!item.fd_key && !item.id && !lotNum) { parseDrop('wright', 'missing id (fd_key+id+lot_number)', String(item.name || '').slice(0, 80)); return null; }
  if (!item.name) { parseDrop('wright', 'missing title', `fd_key=${item.fd_key || item.id || lotNum}`); return null; }
  if (!item.alias) { parseDrop('wright', 'missing url (alias)', String(item.name).slice(0, 80)); return null; }
  const result = item.result_premium_amount || null;
  const hammer = item.result_amount || null;
  const isSold = item.item_status === 'Sold' || (result != null && result > 0);

  let saleDate = '';
  if (item.session?.start_date) {
    saleDate = item.session.start_date.split('T')[0];
  }

  const auctionInPast = saleDate ? isSaleDayPast(saleDate) : false;

  // Build image URL
  let imageUrl: string | null = null;
  if (item.primary_index_image?.filename) {
    const img = item.primary_index_image;
    imageUrl = `https://www.wright20.com/items/index/220/${img.seo_filename || img.filename}`;
  }

  let lotUrl = item.alias || '';
  if (lotUrl.startsWith('//')) lotUrl = 'https:' + lotUrl;
  else if (!lotUrl.startsWith('http') && lotUrl) lotUrl = 'https://www.wright20.com/' + lotUrl;

  const houseName = item.session?.auction?.auction_house?.name || item.auction?.auction_house?.name || 'Wright';
  const auctionHouse: AuctionHouse = houseName.toLowerCase().includes('rago') ? 'Rago' : 'Wright';

  // Extract dimensions from Wright advanced item
  const dims = item.formatted_dimensions || item.dimensions || null;

  // W12 — renamespace Rago ids to `rago-*` (invariant 6); platform carries the
  // Wright-stack origin.
  const platform = auctionHouse === 'Rago' ? 'wright' : null;
  const idPrefix = auctionHouse === 'Rago' ? 'rago' : 'wright';

  return {
    id: `${idPrefix}-${item.fd_key || item.id || `${lotNum}`}`,
    artist: artistSlug,
    title,
    year: item.year_designed || null,
    medium: item.material || null,
    dimensions: dims ? String(dims).replace(/&times;/g, '×').replace(/&ndash;/g, '–') : null,
    description: item.description ? String(item.description).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null : null,
    platform,
    category: 'unknown' as LotCategory,
    imageUrl,
    auctionHouse,
    saleName: item.session?.title || '',
    saleDate,
    lotNumber: lotNum,
    ...stampMoney({
      isSold,
      nativeCurrency: 'USD', // Wright/Rago publish USD
      saleDate: saleDate || null,
      hammerNative: hammer,
      premiumNative: result,
      estLowNative: item.estimate_low || null,
      estHighNative: item.estimate_high || null,
      priceBasis: 'realized',
    }),
    status: isSold ? 'sold' : auctionInPast ? 'bought_in' : 'upcoming',
    url: lotUrl,
  };
}
