/**
 * Phillips — artist-page crawl (maker lots API, hydrate-props fallback) + detail enrich.
 *
 * Moved verbatim out of scripts/ray-crawl.ts (house split, Sep 2026).
 */
import * as cheerio from 'cheerio';
import type { AuctionLot, LotCategory, PriceBasis } from '../../../app/types';
import { fetchWithRetry } from '../fetch-retry';
import type { ArtistConfig } from './artists';
import { type EnrichResult, MEDIUM_PATTERNS, UA, detectCurrency, noteEnrichFail, noteFetched, parseDrop, sleep, stampMoney, statusWithMoney } from './common';

// ── Phillips Crawler ──
// Phillips embeds lot data as a JSON string in ReactDOM.hydrate props for ArtistLanding.
// The "maker" prop contains a JSON-encoded string with pastLots.data[].

export async function crawlPhillips(artist: ArtistConfig): Promise<AuctionLot[]> {
  if (!artist.phillips) return [];
  const lots: AuctionLot[] = [];
  console.log(`  [Phillips] Fetching ${artist.displayName}...`);

  // ── primary: the paginated maker-lots API — 100% estimate-bearing, ~99%
  // sold-priced, and the ONLY way past the newest slice of a maker's history
  // (the artist page's hydration blob exposes one page, which is why only ~3%
  // of Phillips history had been captured). Nightly runs walk the first 2
  // pages (fresh sales); PHILLIPS_DEEP=1 walks the full history (backfill).
  let lotData: any[] = [];
  try {
    const per = 100;
    const first = await fetchWithRetry(`https://api.phillips.com/api/maker/${artist.phillips.id}/lots?page=1&resultsPerPage=${per}`, {
      headers: { 'User-Agent': UA }, timeoutMs: 45000,
    });
    if (first.ok) {
      const j = await first.json();
      lotData = Array.isArray(j.data) ? j.data : [];
      // the maker API IS the lot-bearing page (the hydration blob is only the
      // fallback) — count it, or pages_fetched reads 0 every night and the
      // SILENT-ZERO gate never arms for Phillips
      noteFetched('phillips');
      const totalPages = j.totalPages || 1;
      const deep = process.env.PHILLIPS_DEEP === '1';
      const lastPage = deep ? totalPages : Math.min(totalPages, 2);
      console.log(`  [Phillips] API: ${j.totalCount || lotData.length} lots, walking ${lastPage}/${totalPages} pages${deep ? ' (deep)' : ''}`);
      for (let p = 2; p <= lastPage; p++) {
        await sleep(400);
        try {
          const r = await fetchWithRetry(`https://api.phillips.com/api/maker/${artist.phillips.id}/lots?page=${p}&resultsPerPage=${per}`, {
            headers: { 'User-Agent': UA }, timeoutMs: 45000,
          });
          if (!r.ok) { console.warn(`  [Phillips] page ${p}: HTTP ${r.status}`); break; }
          const jp = await r.json();
          if (!Array.isArray(jp.data) || jp.data.length === 0) break;
          noteFetched('phillips');
          lotData.push(...jp.data);
        } catch (e) { console.warn(`  [Phillips] page ${p} failed: ${(e as Error).message}`); break; }
      }
    } else {
      console.warn(`  [Phillips] maker API HTTP ${first.status} — falling back to page scrape`);
    }
  } catch (e) { console.warn(`  [Phillips] maker API failed: ${(e as Error).message} — falling back to page scrape`); }

  // ── fallback: the artist page's hydration blob (legacy path)
  if (lotData.length === 0) {
    try {
      const res = await fetchWithRetry(`https://www.phillips.com/artist/${artist.phillips.id}/${artist.phillips.slug}`, {
        headers: { 'User-Agent': UA }, timeoutMs: 30000,
      });
      if (!res.ok) { console.log(`  [Phillips] HTTP ${res.status}`); return lots; }
      noteFetched('phillips');
      const html = await res.text();
      const $ = cheerio.load(html);
      let makerData: any = null;
      $('script').each((_, script) => {
        if (makerData) return;
        const text = $(script).html() || '';
        if (!text.includes('ArtistLanding')) return;
        // the maker prop uses \u0022 unicode escapes for quotes
        const makerMatch = text.match(/"maker":"([^"]*)"/);
        if (makerMatch) {
          try {
            const innerJson = JSON.parse('"' + makerMatch[1] + '"');
            makerData = JSON.parse(innerJson);
          } catch (e) {
            console.log('  [Phillips] Failed to parse maker prop:', (e as Error).message?.substring(0, 100));
          }
        }
      });
      lotData = [...(makerData?.upcomingLots?.data || []), ...(makerData?.pastLots?.data || [])];
    } catch (err) {
      console.error('  [Phillips] Error:', err);
      return lots;
    }
  }
  if (lotData.length === 0) { console.log('  [Phillips] No structured lot data found'); return lots; }
  console.log(`  [Phillips] Parsing ${lotData.length} lots…`);

  try {
    for (const lot of lotData) {
      if (lot.isNoLot) continue;
      const rawTitle = lot.description || lot.title || lot.lotTitle || '';
      const title = rawTitle || 'Untitled';
      const saleNum = lot.saleNumber || '';
      const lotNum = lot.lotNumber || '';
      // REQUIRED-field gate: no id parts → an unkeyable `phillips--` row; no
      // title at all → junk. Count + drop loudly (optional fields never drop).
      if (!saleNum && !lotNum) { parseDrop('phillips', 'missing id (saleNumber+lotNumber)', JSON.stringify(lot).slice(0, 100)); continue; }
      if (!rawTitle) { parseDrop('phillips', 'missing title', `sale=${saleNum} lot=${lotNum}`); continue; }
      const detailLink = lot.detailLink || lot.url || `/detail/${saleNum}/${lotNum}`;
      const currency = detectCurrency(lot.currencySign || '');
      const hammerBP = lot.hammerPlusBP ?? lot.hammerPlusCommission ?? null;
      const hammer = lot.hammerPrice ?? null;
      const soldPrice = hammerBP ?? hammer;
      const isSold = soldPrice != null && soldPrice > 0;
      // Phillips is per-lot: premium-inclusive when hammerBP exists, else the
      // realized number is just the hammer (no premium published).
      const phillipsBasis: PriceBasis = hammerBP != null ? 'realized' : 'hammer-only';

      let auctionInPast = false;
      if (lot.auctionStartDateTimeOffset) {
        const aDate = new Date(lot.auctionStartDateTimeOffset);
        auctionInPast = !isNaN(aDate.getTime()) && aDate < new Date();
      }

      let imageUrl: string | null = null;
      if (lot.imagePath) {
        const ver = lot.cloudinaryVersion || '1';
        // If imagePath is already a full URL, use it as-is; otherwise build Cloudinary URL
        if (lot.imagePath.startsWith('http')) {
          imageUrl = lot.imagePath;
        } else {
          imageUrl = `https://assets.phillips.com/image/upload/t_Website_LotDetailMainImage/v${ver}/${lot.imagePath}`;
        }
      }

      let saleDate = '';
      if (lot.auctionStartDateTimeOffset) {
        saleDate = lot.auctionStartDateTimeOffset.split('T')[0];
      } else if (lot.saleDate) {
        saleDate = lot.saleDate;
      }

      // currencySign null = unknown/ambiguous → fail-closed (no price, comp-excluded)
      const money = stampMoney({
        isSold,
        nativeCurrency: currency,
        saleDate: saleDate || null,
        hammerNative: hammer,
        premiumNative: hammerBP,
        estLowNative: lot.lowEstimate ?? null,
        estHighNative: lot.highEstimate ?? null,
        priceBasis: phillipsBasis,
      });
      lots.push({
        id: `phillips-${saleNum}-${lotNum}`,
        artist: artist.slug,
        title,
        year: lot.dates || lot.circa || null,
        medium: lot.medium || null,
        dimensions: lot.dimensions || null,
        description: lot.description || lot.catalogueNote || null,
        category: 'unknown' as LotCategory,
        imageUrl,
        auctionHouse: 'Phillips',
        saleName: lot.saleTitle || '',
        saleDate,
        lotNumber: lotNum ? parseInt(lotNum) : null,
        ...money,
        status: statusWithMoney(isSold ? 'sold' : auctionInPast ? 'bought_in' : 'upcoming', money),
        url: detailLink.startsWith('http') ? detailLink : `https://www.phillips.com${detailLink}`,
      });
    }
  } catch (err) {
    console.error('  [Phillips] Error:', err);
  }

  return lots;
}

export async function enrichPhillips(lot: AuctionLot): Promise<EnrichResult> {
  try {
    const res = await fetch(lot.url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA } });
    if (!res.ok) return {};
    const html = await res.text();
    const $ = cheerio.load(html);
    const result: EnrichResult = {};

    // Phillips renders lot details in div[data-testid="html-parser"] spans.
    // Collect all text blocks from these elements.
    const blocks: string[] = [];
    $('div[data-testid="html-parser"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text) blocks.push(text);
    });

    for (const block of blocks) {
      // Dimensions: contains measurement patterns (e.g. "7 x 5 1/8 in.")
      if (!result.dimensions && /\d+\s*[x×]\s*\d+.*(?:in|cm)/i.test(block)) {
        result.dimensions = block;
        continue;
      }
      // Medium: contains material keywords
      if (!result.medium && MEDIUM_PATTERNS.test(block) && block.length < 200) {
        result.medium = block;
        continue;
      }
      // Year: "Painted in 1994." or "Executed in 2005"
      if (!result.year) {
        const yearMatch = block.match(/(?:painted|executed|created|conceived|dated|made)\s+(?:circa\s+)?(?:in\s+)?(\d{4})/i);
        if (yearMatch) {
          result.year = yearMatch[1];
          continue;
        }
      }
    }

    return result;
  } catch (e) { noteEnrichFail('Phillips', 'page', lot, e); return {}; }
}
