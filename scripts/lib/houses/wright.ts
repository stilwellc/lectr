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
//
// HISTORY (Oct 2026): a BASIC page carries BOTH shapes — results_grouped (the
// ~250 most recent lots, what the nightly reads) AND the full-history
// paginator (Picasso: 5 pages × 250 = 1,153 lots back to 2000). The basic
// branch used to return straight after results_grouped, so even RAY_DEEP never
// reached the history (Picasso stopped at 2024). Deep mode (RAY_DEEP=1, or the
// history backfill's WRIGHT_DEEP=1) now walks that paginator too; the nightly
// (neither set) is unchanged — results_grouped only, no extra pages.
//
// IDS: a grouped item's `fd_key` IS the paginator item's numeric `id`
// (grouped fd_key 303053 ≡ paginator id 303053 whose own fd_key is
// '234631~'), so the history walk of a BASIC page keys rows by `id` — the same
// `wright-<n>` the nightly mints for that lot, never a second id for one lot.
// Advanced pages keep their fd_key ids (unchanged).

/** Deep mode: walk the artist's full paginator history. */
export const WRIGHT_HISTORY = DEEP || process.env.WRIGHT_DEEP === '1';
/** hard page cap per artist (250 lots/page) */
const WRIGHT_MAX_PAGES = 30;

/** The Wright group's sibling houses. The artist feed is GROUP-WIDE: the same
 *  1,153 Picasso lots come back from wright20.com AND lamodern.com, spanning
 *  Wright, Rago, LAMA, Toomey & Co. and Poster Auctions International. */
export type WrightGroupHouse = 'Wright' | 'Rago' | 'LAMA' | 'Toomey' | 'PAI';
/** `auction.auction_house` ids on the group platform — read off the live feed
 *  (Oct 2026): each id's `listing_*` flag and its sales agree
 *  (1 listing_wright · 2 listing_rago "Curated: PICASSO" · 5 listing_lama
 *  "Modern Art & Design" · 6 listing_toomey · 9 listing_pai "Posters"). */
export const WRIGHT_GROUP_HOUSE_IDS: Readonly<Record<number, WrightGroupHouse>> = { 1: 'Wright', 2: 'Rago', 5: 'LAMA', 6: 'Toomey', 9: 'PAI' };
export const WRIGHT_GROUP_DOMAINS: Readonly<Record<'Wright' | 'Rago' | 'LAMA', string>> = { Wright: 'www.wright20.com', Rago: 'www.ragoarts.com', LAMA: 'www.lamodern.com' };

const houseFromName = (name: string): WrightGroupHouse | 'unknown' => {
  const n = name.toLowerCase();
  if (n.includes('rago')) return 'Rago';
  if (n.includes('lama') || n.includes('los angeles modern')) return 'LAMA';
  if (n.includes('toomey')) return 'Toomey';
  if (n.includes('poster')) return 'PAI';
  if (n.includes('wright')) return 'Wright';
  return 'unknown';
};

/**
 * The SELLING house of a group-platform item, from (in order) the auction's
 * numeric `auction_house` id (or a `{name}` object), the basic feed's `house`
 * string, then an absolute alias host. 'unknown' = a signal we cannot map (a
 * new group house) — callers skip it, never guess. null = no house signal at
 * all (callers keep their historical default).
 */
export function wrightGroupHouseOf(item: any): WrightGroupHouse | 'unknown' | null {
  const ah = item?.session?.auction?.auction_house ?? item?.auction?.auction_house;
  if (typeof ah === 'number') return WRIGHT_GROUP_HOUSE_IDS[ah] || 'unknown';
  if (ah && typeof ah === 'object' && typeof ah.name === 'string' && ah.name) return houseFromName(ah.name);
  if (typeof item?.house === 'string' && item.house.trim()) return houseFromName(item.house);
  const host = (String(item?.alias || '').match(/^(?:https?:)?\/\/([^/]+)/i) || [])[1]?.toLowerCase() || '';
  if (host.includes('lamodern')) return 'LAMA';
  if (host.includes('ragoarts')) return 'Rago';
  if (host.includes('toomeyco')) return 'Toomey';
  if (host.includes('posterauctions')) return 'PAI';
  if (host.includes('wright20')) return 'Wright';
  return null;
}

/** true when the house came from the platform's numeric auction_house id —
 *  authoritative, so the session-level Rago heuristic must not override it. */
const hasHouseId = (item: any): boolean =>
  typeof (item?.session?.auction?.auction_house ?? item?.auction?.auction_house) === 'number';

/** Absolute lot URL: an absolute alias is kept; a relative one resolves
 *  against the SELLING house's own domain (a Rago lot under wright20.com 404s). */
export function wrightGroupUrl(alias: string, house: 'Wright' | 'Rago' | 'LAMA'): string {
  const a = String(alias || '');
  if (!a) return '';
  if (a.startsWith('//')) return 'https:' + a;
  if (a.startsWith('http')) return a;
  return `https://${WRIGHT_GROUP_DOMAINS[house]}/${a.replace(/^\/+/, '')}`;
}

/** Group-feed items a crawler skipped because a sibling crawler (LAMA) or no
 *  tracked house owns them — a doctrine skip, NOT a parse error. */
export const WRIGHT_HOUSE_SKIPS: Record<string, number> = {};
const noteHouseSkip = (h: string) => { WRIGHT_HOUSE_SKIPS[h] = (WRIGHT_HOUSE_SKIPS[h] || 0) + 1; };

/** Lots whose house came from the numeric auction_house id (see hasHouseId). */
const HOUSE_BY_ID = new WeakSet<AuctionLot>();

const paginatorOf = (pd: any): any =>
  pd?.props?.results?.primary_results?.paginator?.items
  || pd?.props?.results?.primary_results?.sorted_items?.results;

/** platform key of a row: the id with its house prefix stripped — one lot is
 *  one key whichever house a feed labels it (a co-branded "Curated: PICASSO"
 *  lot reads Wright in results_grouped but Rago (house 2) in the paginator). */
export const wrightPlatformKey = (id: string): string => id.replace(/^(?:wright|rago|lama)-/, '');

/** Walk paginator pages 1..min(last, cap) — page 1 is `firstPage`, already
 *  loaded — appending rows whose platform key is not already present (the
 *  nightly's results_grouped copy of a lot always wins: same id, no churn). */
async function walkWrightHistory(url: string, firstPage: any, lots: AuctionLot[], artistSlug: string, idKey: 'id' | 'fd_key'): Promise<number> {
  const have = new Set(lots.map(l => wrightPlatformKey(l.id)));
  let added = 0;
  const take = (items: any[]) => {
    for (const item of items) {
      const parsed = parseWrightAdvancedItem(item, artistSlug, { idKey });
      const key = parsed ? wrightPlatformKey(parsed.id) : '';
      if (parsed && !have.has(key)) { have.add(key); lots.push(parsed); added++; }
    }
  };
  if (Array.isArray(firstPage?.data)) take(firstPage.data);
  const cap = Math.min(Number(firstPage?.last_page) || 1, WRIGHT_MAX_PAGES);
  for (let p = 2; p <= cap; p++) {
    await sleep(600);
    try {
      const r2 = await fetchWithRetry(`${url}?page=${p}`, { headers: { 'User-Agent': UA }, timeoutMs: 30000 });
      if (!r2.ok) { console.log(`  [Wright] history page ${p}: HTTP ${r2.status} — stopping`); break; }
      const dp2 = cheerio.load(await r2.text())('#app').attr('data-page');
      if (!dp2) break;
      const items2 = paginatorOf(JSON.parse(dp2))?.data;
      if (!Array.isArray(items2) || items2.length === 0) break;
      take(items2);
    } catch { break; }
  }
  return added;
}

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
            if (parsed) lots.push(parsed); // null = dropped (missing required field) or another house's lot
          }
        }
      }
      console.log(`  [Wright] Parsed ${totalItems} lots (basic page)`);
      // deep mode: the full history lives in the SAME page's paginator — the
      // basic branch used to return here and skip it even under RAY_DEEP
      if (WRIGHT_HISTORY) {
        const pag = paginatorOf(pageData);
        if (Array.isArray(pag?.data)) {
          const added = await walkWrightHistory(url, pag, lots, artist.slug, 'id');
          console.log(`  [Wright] Deep walk (basic page, ${pag.last_page || 1} page(s), ${pag.total ?? '?'} group-wide): +${added} history lots → ${lots.length}`);
        }
      }
      return fixWrightRagoSessions(lots);
    }

    // Try advanced/custom page format (paginator)
    const paginator = paginatorOf(pageData);
    if (paginator?.data && Array.isArray(paginator.data)) {
      const items = paginator.data;
      const lastPage = paginator.last_page || 1;
      console.log(`  [Wright] Found ${items.length} lots on page 1 of ${lastPage} (${paginator.total || items.length} total, advanced page)`);
      for (const item of items) {
        const parsed = parseWrightAdvancedItem(item, artist.slug);
        if (parsed) lots.push(parsed); // null = dropped (missing required field) or another house's lot
      }
      // deep mode: walk the whole paginator (history lives back here)
      if (WRIGHT_HISTORY && lastPage > 1) {
        await walkWrightHistory(url, paginator, lots, artist.slug, 'fd_key');
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
 *  fix-up pass over the corpus). A lot attributed by the platform's numeric
 *  auction_house id (the history paginator) is authoritative and never
 *  re-attributed — across 25 years of history a Wright and a Rago sale can
 *  share a month + slug ("prints-multiples").
 */
export function fixWrightRagoSessions(lots: AuctionLot[]): AuctionLot[] {
  const salePathOf = (u: string | null | undefined) => {
    const m = (u || '').match(/\/auctions\/\d{4}\/\d{2}\/[^/?#]+/);
    return m ? m[0] : null;
  };
  const ragoSales = new Set<string>();
  for (const l of lots) {
    const p = salePathOf(l.url);
    if (p && l.auctionHouse === 'Rago' && !HOUSE_BY_ID.has(l)) ragoSales.add(p);
  }
  if (!ragoSales.size) return lots;
  for (const l of lots) {
    const p = salePathOf(l.url);
    if (!p || l.auctionHouse !== 'Wright' || HOUSE_BY_ID.has(l) || !ragoSales.has(p)) continue;
    l.auctionHouse = 'Rago';
    l.platform = 'wright';
    l.id = l.id.replace(/^wright-/, 'rago-');
    if (l.url) l.url = l.url.replace('://www.wright20.com', '://www.ragoarts.com');
    console.log(`  [Wright] ${p}: re-attributed ${l.id} to Rago (session-level)`);
  }
  return lots;
}

/** The Wright crawler keeps Wright + Rago lots. LAMA lots on the shared feed
 *  belong to crawlLama (clean `lama-` ids); Toomey / Poster Auctions lots
 *  belong to no tracked house. null signal = the historical Wright default. */
function wrightCrawlerHouse(item: any): 'Wright' | 'Rago' | null {
  const h = wrightGroupHouseOf(item);
  if (h === null || h === 'Wright') return 'Wright';
  if (h === 'Rago') return 'Rago';
  noteHouseSkip(h);
  return null;
}

export function parseWrightBasicItem(item: any, session: any, sessionKey: string, artistSlug: string): AuctionLot | null {
  const title = item.name || 'Untitled';
  const lotNum = item.lot_number || null;
  const result = item.result || null;
  const resultSansPremium = item.result_sans_premium || null;

  // REQUIRED-field gate: id needs fd_key or lot_number; a lot without a name
  // or without any alias URL is unusable. Count + drop (optional fields never drop).
  if (!item.fd_key && !lotNum) { parseDrop('wright', 'missing id (fd_key+lot_number)', String(item.name || '').slice(0, 80)); return null; }
  if (!item.name) { parseDrop('wright', 'missing title', `fd_key=${item.fd_key || `${lotNum}-${sessionKey}`}`); return null; }
  if (!item.alias) { parseDrop('wright', 'missing url (alias)', String(item.name).slice(0, 80)); return null; }

  // the SELLING house (Oct 2026): the feed is group-wide — a LAMA lot used to
  // be stamped Wright here with its lamodern.com URL
  const auctionHouse: AuctionHouse | null = wrightCrawlerHouse(item);
  if (!auctionHouse) return null;

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

/**
 * One paginator item. `idKey` picks the id scheme: 'fd_key' (default — the
 * advanced-page scheme, unchanged) or 'id' (the basic page's history walk,
 * where the grouped feed's fd_key IS this numeric id — see the header).
 */
export function parseWrightAdvancedItem(item: any, artistSlug: string, opts: { idKey?: 'fd_key' | 'id' } = {}): AuctionLot | null {
  const title = item.name || 'Untitled';
  const lotNum = item.lot_number || null;

  // REQUIRED-field gate (same doctrine as the basic parser).
  if (!item.fd_key && !item.id && !lotNum) { parseDrop('wright', 'missing id (fd_key+id+lot_number)', String(item.name || '').slice(0, 80)); return null; }
  if (!item.name) { parseDrop('wright', 'missing title', `fd_key=${item.fd_key || item.id || lotNum}`); return null; }
  if (!item.alias) { parseDrop('wright', 'missing url (alias)', String(item.name).slice(0, 80)); return null; }

  // the SELLING house from the auction's numeric house id (Oct 2026: it is an
  // int, not an object — the old `.auction_house.name` read always fell back
  // to 'Wright', stamping every Rago/LAMA/Toomey lot Wright)
  const auctionHouse: AuctionHouse | null = wrightCrawlerHouse(item);
  if (!auctionHouse) return null;

  const result = item.result_premium_amount || null;
  const hammer = item.result_amount || null;
  // sold requires an actual price (LAMA doctrine): an item_status 'Sold' with
  // no hammer/premium is a data gap, not a confirmed sale
  const isSold = (result != null && result > 0) || (hammer != null && hammer > 0);

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

  const lotUrl = wrightGroupUrl(item.alias || '', auctionHouse === 'Rago' ? 'Rago' : 'Wright');

  // Extract dimensions from Wright advanced item
  const dims = item.formatted_dimensions || item.dimensions || null;

  // W12 — renamespace Rago ids to `rago-*` (invariant 6); platform carries the
  // Wright-stack origin.
  const platform = auctionHouse === 'Rago' ? 'wright' : null;
  const idPrefix = auctionHouse === 'Rago' ? 'rago' : 'wright';
  const idPart = opts.idKey === 'id' && item.id ? item.id : (item.fd_key || item.id || `${lotNum}`);

  const lot: AuctionLot = {
    id: `${idPrefix}-${idPart}`,
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
  if (hasHouseId(item)) HOUSE_BY_ID.add(lot);
  return lot;
}
