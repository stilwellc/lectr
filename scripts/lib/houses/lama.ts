/**
 * LAMA (lamodern.com) — same group platform as Wright; rides the wright segment.
 *
 * Moved verbatim out of scripts/ray-crawl.ts (house split, Sep 2026).
 */
import * as cheerio from 'cheerio';
import type { AuctionLot, LotCategory } from '../../../app/types';
import { fetchWithRetry } from '../fetch-retry';
import type { ArtistConfig } from './artists';
import { UA, isSaleDayPast, noteFetched, parseDrop, sleep, stampMoney } from './common';
import { WRIGHT_HISTORY, WRIGHT_HOUSE_SKIPS, wrightGroupHouseOf } from './wright';

// ── LAMA (Los Angeles Modern Auctions) ──
// LAMA joined the Rago/Wright group in 2021 and sells on the SAME Laravel/
// Inertia platform, so its artist pages (lamodern.com/artists/<slug>) carry an
// identical `#app` data-page payload in the "advanced" ArtistCustomPage format
// (props.results.primary_results.paginator). The slugs match Wright's, so this
// reuses the tracked-artist config (crawl OUR makers, never LAMA's whole book).
// It is NOT Rago: distinct host, distinct house, clean `lama-` ids. Doctrine:
// LAMA runs a small buy-now "direct sales" channel — those lots are dropped
// (an ask is not a hammer). Verified Aug 2026 (real Chrome UA defeats its 403).
//
// ATTRIBUTION (Oct 2026): the artist feed is GROUP-WIDE — lamodern.com returns
// the SAME paginator as wright20.com (Picasso: 1,153 lots across Wright, Rago,
// LAMA, Toomey, Poster Auctions). Every item used to be stamped LAMA, so the
// Picasso "LAMA" history 2000–2024 was mostly Wright and Rago sales. Only items
// whose auction_house id is LAMA's are kept here; the Wright crawler owns the
// Wright + Rago items of the same feed (wright.ts wrightGroupHouseOf).
export async function crawlLama(artist: ArtistConfig): Promise<AuctionLot[]> {
  const slug = artist.lama || artist.wright;
  if (!slug) return [];
  const lots: AuctionLot[] = [];
  const base = `https://www.lamodern.com/artists/${slug}`;
  console.log(`  [LAMA] Fetching ${artist.displayName}...`);

  const pageItems = (pd: any): any[] => {
    const pr = pd?.props?.results?.primary_results;
    const pag = pr?.paginator?.items || pr?.sorted_items?.results;
    return Array.isArray(pag?.data) ? pag.data : [];
  };
  const lastPageOf = (pd: any): number => {
    const pr = pd?.props?.results?.primary_results;
    const pag = pr?.paginator?.items || pr?.sorted_items?.results;
    return pag?.last_page || 1;
  };

  try {
    const res = await fetchWithRetry(base, { headers: { 'User-Agent': UA }, timeoutMs: 30000 });
    if (!res.ok) { console.log(`  [LAMA] HTTP ${res.status}`); return lots; }
    noteFetched('wright'); // LAMA crawls inside the wright segment's job (arms its SILENT-ZERO gate)
    noteFetched('lama');   // …and its own [health] line
    const $ = cheerio.load(await res.text());
    const dataPage = $('#app').attr('data-page');
    if (!dataPage) { console.log('  [LAMA] No data-page on #app'); return lots; }
    const pd = JSON.parse(dataPage);

    const items = pageItems(pd);
    const lastPage = lastPageOf(pd);
    console.log(`  [LAMA] page 1/${lastPage}: ${items.length} lots`);
    for (const it of items) { const p = parseLamaItem(it, artist.slug); if (p) lots.push(p); }

    // deep mode (RAY_DEEP / WRIGHT_DEEP) walks the artist's full LAMA history
    // (bounded like Wright's)
    if (WRIGHT_HISTORY && lastPage > 1) {
      const cap = Math.min(lastPage, 30);
      for (let pg = 2; pg <= cap; pg++) {
        await sleep(600);
        try {
          const r2 = await fetchWithRetry(`${base}?page=${pg}`, { headers: { 'User-Agent': UA }, timeoutMs: 30000 });
          if (!r2.ok) break;
          const dp2 = cheerio.load(await r2.text())('#app').attr('data-page');
          if (!dp2) break;
          const items2 = pageItems(JSON.parse(dp2));
          if (!items2.length) break;
          for (const it of items2) { const p = parseLamaItem(it, artist.slug); if (p) lots.push(p); }
        } catch { break; }
      }
      console.log(`  [LAMA] deep walk complete: ${lots.length} lots`);
    }
  } catch (err) {
    console.error('  [LAMA] Error:', err);
  }
  return lots;
}

export function parseLamaItem(item: any, artistSlug: string): AuctionLot | null {
  // DOCTRINE: LAMA's buy-now / direct-sales lots are asks, not hammers — drop.
  // A doctrine drop is NOT a parse error (it used to be counted as one, which
  // is why the lama [health] line read parse_errors=1 every night).
  if (item.is_buy_now || item.is_direct_sales) { console.log(`  [LAMA] skip buy-now/direct-sales (doctrine): ${String(item.name || '').slice(0, 80)}`); return null; }

  // the SELLING house: keep LAMA's own lots only (no house signal = the
  // historical LAMA default); a sibling house's lot is a doctrine skip
  const house = wrightGroupHouseOf(item);
  if (house !== null && house !== 'LAMA') { WRIGHT_HOUSE_SKIPS[house] = (WRIGHT_HOUSE_SKIPS[house] || 0) + 1; return null; }

  const title = item.name || 'Untitled';
  const lotNum = item.lot_number || null;
  if (!item.fd_key && !item.id && !lotNum) { parseDrop('lama', 'missing id (fd_key+id+lot_number)', String(item.name || '').slice(0, 80)); return null; }
  if (!item.name) { parseDrop('lama', 'missing title', `fd_key=${item.fd_key || item.id || lotNum}`); return null; }
  if (!item.alias) { parseDrop('lama', 'missing url (alias)', String(item.name).slice(0, 80)); return null; }

  const hammer = item.result_amount || null;
  const premium = item.result_premium_amount || null;
  // sold requires an actual price — a lot flagged item_status 'Sold' with NO
  // hammer/premium (a data gap / bought-in mislabel) is not a confirmed sale
  // (invariant: a sold lot needs realizedUsd>0). Deep-history LAMA had one.
  const isSold = (premium != null && premium > 0) || (hammer != null && hammer > 0);

  // LAMA has no session.start_date; the sale date lives on the auction object.
  let saleDate = '';
  const rawDate = item.auction?.date || item.session?.auction?.date || null;
  if (rawDate) saleDate = String(rawDate).split('T')[0];
  const auctionInPast = saleDate ? isSaleDayPast(saleDate) : false;

  let imageUrl: string | null = null;
  const img = item.primary_index_image;
  if (img?.seo_filename || img?.filename) {
    imageUrl = `https://www.lamodern.com/items/index/220/${img.seo_filename || img.filename}`;
  }

  let lotUrl = item.alias || '';
  if (lotUrl.startsWith('//')) lotUrl = 'https:' + lotUrl;
  else if (!lotUrl.startsWith('http') && lotUrl) lotUrl = 'https://www.lamodern.com/' + lotUrl;

  const dims = item.formatted_dimensions || item.dimensions || null;

  return {
    id: `lama-${item.fd_key || item.id || lotNum}`,
    artist: artistSlug,
    title,
    year: item.year_designed || item.year_produced || null,
    medium: item.material || null,
    dimensions: dims ? String(dims).replace(/&times;/g, '×').replace(/&ndash;/g, '–') : null,
    description: item.description ? String(item.description).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null : null,
    platform: 'wright',
    category: 'unknown' as LotCategory,
    imageUrl,
    auctionHouse: 'LAMA',
    saleName: item.session?.title || item.auction?.title || '',
    saleDate,
    lotNumber: lotNum,
    ...stampMoney({
      isSold,
      nativeCurrency: 'USD', // LAMA publishes USD
      saleDate: saleDate || null,
      hammerNative: hammer,
      premiumNative: premium,
      estLowNative: item.estimate_low || null,
      estHighNative: item.estimate_high || null,
      priceBasis: 'realized',
    }),
    status: isSold ? 'sold' : auctionInPast ? 'bought_in' : 'upcoming',
    url: lotUrl,
  };
}
