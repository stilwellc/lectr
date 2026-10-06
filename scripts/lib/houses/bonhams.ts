/**
 * Bonhams — Typesense search-proxy crawl + lot parse + detail enrich.
 *
 * Moved verbatim out of scripts/ray-crawl.ts (house split, Sep 2026).
 */
import * as cheerio from 'cheerio';
import type { AuctionLot, LotStatus, LotCategory, PriceBasis } from '../../../app/types';
import { fetchWithRetry } from '../fetch-retry';
import type { ArtistConfig } from './artists';
import { DEEP, type EnrichResult, MEDIUM_PATTERNS, UA, isSaleDayPast, isoCurrencyToInternal, noteEnrichFail, noteFetched, parseDrop, sleep, stampMoney, statusWithMoney } from './common';

// ── Bonhams Crawler ──
// Bonhams uses Typesense search with a public API key.
// We query the 'lots' collection for the artist name.

const BONHAMS_TYPESENSE_KEY = '7YZqOyG0twgst4ACc2VuCyZxpGAYzM0weFTLCC20FQY';

const BONHAMS_SEARCH_URL = 'https://api01.bonhams.com/search-proxy/collections/lots/documents/search';

export async function crawlBonhams(artist: ArtistConfig): Promise<AuctionLot[]> {
  if (!artist.bonhams) return [];
  const lots: AuctionLot[] = [];
  const query = encodeURIComponent(artist.bonhams);
  console.log(`  [Bonhams] Fetching ${artist.displayName}...`);

  try {
    // Fetch up to 250 lots per artist (paginate if needed)
    let page = 1;
    let totalFetched = 0;
    let totalFound = 0;

    do {
      const url = `${BONHAMS_SEARCH_URL}?q=${query}&query_by=catalogDesc,title&per_page=250&page=${page}`;
      // 30s per attempt (fetchWithRetry arms a fresh AbortSignal per try) — a
      // stalled Typesense node used to hang this maker's crawl indefinitely
      const res = await fetchWithRetry(url, {
        headers: {
          'X-TYPESENSE-API-KEY': BONHAMS_TYPESENSE_KEY,
          'User-Agent': UA,
        },
        timeoutMs: 30000,
      });

      if (!res.ok) {
        console.log(`  [Bonhams] HTTP ${res.status}`);
        break;
      }

      const data = await res.json() as any;
      noteFetched('bonhams');
      totalFound = data.found || 0;
      const hits = data.hits || [];

      if (page === 1) {
        console.log(`  [Bonhams] Found ${totalFound} lots`);
      }

      for (const hit of hits) {
        const doc = hit.document;
        const lot = parseBonhamsLot(doc, artist.slug);
        if (lot) lots.push(lot);
      }

      totalFetched += hits.length;
      page++;

      if (totalFetched < totalFound && hits.length > 0) {
        await sleep(500);
      }
    } while (totalFetched < totalFound && page <= (DEEP ? 40 : 10));

    console.log(`  [Bonhams] Parsed ${lots.length} lots (${lots.filter(l => l.status === 'sold').length} sold)`);
  } catch (err) {
    console.error('  [Bonhams] Error:', err);
  }

  return lots;
}

export function parseBonhamsLot(doc: any, artistSlug: string): AuctionLot | null {
  // W16 — resolve both ids BEFORE emitting: a missing auctionId interpolates
  // into the URL as "auction/undefined/" (legacy records: "auction//") and a
  // missing/zero lotId ends it "lot/0" — both 404 on bonhams.com. The same
  // ids also form the composite lot id, so an unresolved record can't be
  // deduped either. Never emit an unlinkable lot; a flag on a dead link is a
  // lie the publish-time guard below would have to catch anyway.
  const auctionId = doc.auctionId ?? doc.auction_id ?? doc.auction?.id ?? null;
  const lotId = doc.lotId ?? doc.lot_id ?? doc.id ?? null;
  // REQUIRED-field gate: both ids form the composite id AND the URL — an
  // unresolved record is unkeyable + unlinkable. Count + drop (was silent).
  if (!auctionId || !lotId) { parseDrop('bonhams', 'missing auctionId/lotId', String(doc.title || '').slice(0, 80)); return null; }

  const rawTitle = doc.title || '';
  if (!rawTitle && !doc.styledDescription) { parseDrop('bonhams', 'missing title', `auction ${auctionId} lot ${lotId}`); return null; }
  // Extract a clean title from styledDescription if available
  let title = rawTitle;
  if (doc.styledDescription) {
    const lines: string[] = [];
    const lineMatches = doc.styledDescription.match(/<div class="[^"]*">(.*?)<\/div>/g) || [];
    for (const m of lineMatches) {
      const text = m.replace(/<[^>]*>/g, '').trim();
      if (text) lines.push(text);
    }
    // Filter out artist name and date lines, keep actual title/description
    const titleParts = lines.filter(l =>
      !l.match(/^\(?[bB](?:orn)?\.\s*\d{4}\)?$/) &&         // "(B. 1957)" or "(born 1957)"
      !l.match(/^\(\d{4}[-–]\d{4}\)$/) &&                    // "(1928-1987)"
      !l.match(/^\(?born \d{4}\)?$/i) &&                      // "(born 1974)"
      !l.match(/^\(?[A-Za-z]+,?\s+(?:born\s+)?\d{4}[-–]?\d{0,4}\)?$/) && // "(American, 1928-1987)"
      !l.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+$/) &&            // "George Condo"
      !l.match(/^[A-Z]{2,}$/)                                 // "KAWS"
    );
    if (titleParts.length > 0) {
      // Use the "otherLine" div if available (usually the artwork title), else first non-artist line
      const otherIdx = lineMatches.findIndex((m: string) => m.includes('otherLine'));
      if (otherIdx >= 0) {
        const otherText = lineMatches[otherIdx].replace(/<[^>]*>/g, '').trim();
        if (otherText) {
          title = otherText;
        } else {
          title = titleParts[0];
        }
      } else {
        title = titleParts[0];
      }
    }
  }
  // Strip HTML tags from title
  title = title.replace(/<[^>]*>/g, '').trim() || 'Untitled';

  // Extract medium, dimensions, and year from styledDescription lines
  // Bonhams structured descriptions often include this data after the title line
  let medium: string | null = null;
  let dimensions: string | null = null;
  let year: string | null = null;
  if (doc.styledDescription) {
    const descLines: string[] = [];
    const descMatches = doc.styledDescription.match(/<div class="[^"]*">(.*?)<\/div>/g) || [];
    for (const m of descMatches) {
      const text = m.replace(/<[^>]*>/g, '').trim();
      if (text) descLines.push(text);
    }
    // Look for medium, dimensions, and year
    for (const line of descLines) {
      if (line === title) continue; // skip the title itself
      if (/^\(?[bB](?:orn)?\.\s*\d{4}\)?$/.test(line)) continue;
      if (/^\(\d{4}[-–]\d{4}\)$/.test(line)) continue;
      if (/^\(?born \d{4}\)?$/i.test(line)) continue;
      if (/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(line)) continue; // artist name
      if (/^[A-Z]{2,}$/.test(line)) continue; // "KAWS"
      if (/^\(?[A-Za-z]+,?\s+(?:born\s+)?\d{4}[-–]?\d{0,4}\)?$/.test(line)) continue; // "(American, 1928-1987)"

      // Year line (standalone 4-digit year, possibly with circa)
      if (!year && /^(?:circa|c\.?)?\s*\d{4}$/i.test(line)) {
        const yearMatch = line.match(/(\d{4})/);
        if (yearMatch) year = yearMatch[1];
        continue;
      }

      // Dimension line (has cm or in measurements) — Bonhams order is
      // title → medium → dimensions, so guard on !dimensions (a !medium guard
      // would skip the dims line once medium is captured)
      if (/\d+\s*(?:×|x)\s*\d+|\b(?:cm|in)\b/.test(line) && !dimensions) {
        dimensions = line;
        continue;
      }
      // Medium line — contains material/technique keywords, but skip very long lines (full catalog entries)
      if (!medium && line.length < 150 && /(?:oil|acrylic|gouache|watercolor|ink|charcoal|pencil|pastel|spray|enamel|screenprint|silkscreen|lithograph|etching|woodcut|print|photograph|gelatin|silver|bronze|ceramic|porcelain|mixed media|collage|canvas|linen|paper|board|panel|synthetic polymer|offset|poster|gicl[eé]e|marker|crayon|felt[- ]?tip)/i.test(line)) {
        medium = line;
      }
    }
  }

  // null = a currency the money layer cannot convert (fail-closed: the row
  // carries no price/estimate and is comp-excluded — never relabelled USD;
  // Bruun Rasmussen's brk_ sales arrive as DKK)
  const currency = isoCurrencyToInternal(doc.currency?.iso_code);
  const hammerPrice = doc.price?.hammerPrice || null;
  const hammerPremium = doc.price?.hammerPremium || null;
  const estimateLow = doc.price?.estimateLow || null;
  const estimateHigh = doc.price?.estimateHigh || null;

  let saleDate = '';
  const endDate = doc.hammerTime?.datetime || doc.auctionEndDate?.datetime || doc.biddableFrom?.datetime;
  if (endDate) {
    saleDate = endDate.split('T')[0];
  }

  const isSold = doc.status === 'SOLD';
  const isBoughtIn = doc.status === 'BI';
  const auctionEnded = doc.flags?.isAuctionEnded ?? (saleDate ? isSaleDayPast(saleDate) : true); // default to ended if no date

  let status: LotStatus = 'upcoming';
  if (isSold) status = 'sold';
  else if (isBoughtIn) status = 'bought_in';
  else if (auctionEnded) status = 'bought_in';

  const imageUrl = doc.image?.url || null;
  // brk_* auctions are Bruun Rasmussen (Copenhagen — a Bonhams brand whose
  // lots ride the shared search API but do NOT exist on bonhams.com: every
  // /auction/brk_*/lot/* URL 404s live). Their canonical lot pages are
  // bruun-rasmussen.dk/m/lots/<lotId> (probe-verified 200 across sales).
  const lotUrl = String(auctionId).startsWith('brk_')
    ? `https://bruun-rasmussen.dk/m/lots/${lotId}`
    : `https://www.bonhams.com/auction/${auctionId}/lot/${lotId}`;

  // Retain the raw description (styledDescription stripped to text, else the
  // catalog desc) — non-destructive re-parse source for the identity layer.
  const bonhamsDescription = (() => {
    const src = doc.styledDescription || doc.catalogDesc || doc.description || '';
    if (!src) return null;
    const txt = String(src).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return txt ? txt.slice(0, 4000) : null;
  })();

  // Bonhams exposes both hammer + premium-inclusive: realized when a premium
  // number exists, else the hammer is the realized (hammer-only basis).
  const bonhamsBasis: PriceBasis = hammerPremium != null ? 'realized' : 'hammer-only';
  const money = stampMoney({
    isSold,
    nativeCurrency: currency,
    saleDate: saleDate || null,
    hammerNative: hammerPrice,
    premiumNative: hammerPremium,
    estLowNative: estimateLow,
    estHighNative: estimateHigh,
    priceBasis: bonhamsBasis,
  });

  return {
    id: `bonhams-${auctionId}-${lotId}`,
    artist: artistSlug,
    title,
    year,
    medium,
    dimensions,
    description: bonhamsDescription,
    category: 'unknown' as LotCategory,
    imageUrl,
    auctionHouse: 'Bonhams',
    saleName: doc.heading || '',
    saleDate,
    lotNumber: doc.lotNo?.number || null,
    ...money,
    status: statusWithMoney(status, money),
    url: lotUrl,
  };
}

export async function enrichBonhams(lot: AuctionLot): Promise<EnrichResult> {
  try {
    const res = await fetch(lot.url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA } });
    if (!res.ok) return {};
    const html = await res.text();
    const $ = cheerio.load(html);
    const result: EnrichResult = {};

    // Bonhams embeds lot data in JSON-LD (@type: Product) with a combined description string
    let description = '';

    $('script[type="application/ld+json"]').each((_, script) => {
      try {
        const json = JSON.parse($(script).html() || '{}');
        if (json.description) description = json.description;
      } catch (e) { noteEnrichFail('Bonhams', 'json', lot, e); }
    });

    if (!description) return {};

    // Parse medium: look for material keywords
    const medMatch = description.match(new RegExp(`(${MEDIUM_PATTERNS.source}[^,;.]{0,60})`, 'i'));
    if (medMatch) result.medium = medMatch[0].trim();

    // Parse dimensions — multiple formats:
    const dimPatterns = [
      // Standard W x H: "24 x 18 in", "63 × 52 cm", "99.8 by 73 cm."
      /(\d+(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\s+\d+\/\d+)?(?:\.\d+)?\s*(?:[×x]|\bby\b)\s*\d+(?:[¼½¾⅓⅔⅛⅜⅝⅞]|\s+\d+\/\d+)?(?:\.\d+)?\s*(?:in|cm)\.?(?:\s*\([^)]+\))?)/i,
      // "height 34in; width 32in" or "height of chair 32 1/2in (83cm); width 32in"
      /height\s+(?:of\s+\w+\s+)?(\d+(?:\s+\d+\/\d+)?(?:[.,]\d+)?)\s*in[^;]*;\s*width\s+(\d+(?:\s+\d+\/\d+)?(?:[.,]\d+)?)\s*in/i,
      // Single dimension: "ht. 9 3/8 in." or "height 24in"
      /(?:ht\.?|height)\s+(\d+(?:\s+\d+\/\d+)?(?:[.,]\d+)?)\s*in/i,
    ];

    for (let i = 0; i < dimPatterns.length; i++) {
      const m = description.match(dimPatterns[i]);
      if (m) {
        if (m[2]) {
          // height/width format — reconstruct as "H x W in"
          result.dimensions = `${m[1]} x ${m[2]} in`;
        } else if (i === 2) {
          // Single dimension (ht. only) — store as-is for reference
          result.dimensions = `${m[1]} in (height)`;
        } else {
          result.dimensions = m[1].trim();
        }
        break;
      }
    }

    // Parse year — multiple patterns
    const yearPatterns = [
      /(?:executed|painted|dated|conceived|created)\s+(?:circa\s+)?(?:in\s+)?(\d{4})/i,
      /(?:circa|c\.)\s*(\d{4})/i,
      // "designed 1956" or "produced 1984"
      /(?:designed|produced|made)\s+(?:circa\s+)?(\d{4})/i,
      // Standalone year after comma: ", 1963" (common in descriptions)
      /,\s*(\d{4})(?:\s|,|$)/,
    ];
    for (const pat of yearPatterns) {
      const m = description.match(pat);
      if (m) { result.year = m[1]; break; }
    }

    return result;
  } catch (e) { noteEnrichFail('Bonhams', 'page', lot, e); return {}; }
}
