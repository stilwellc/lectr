/**
 * resolve-rrauction.ts — the RR Auction crawler. THE ONLY HEADLESS CRAWLER.
 *
 * RR Auction (rrauction.com) is Cloudflare-gated: every URL 403s a plain fetch
 * (even sitemap.xml), the lot data is embedded in the CF-challenged HTML doc,
 * and there is NO content API — the rendered page makes zero XHR for lots.
 * So this house, alone, requires a real browser to clear the CF JS challenge.
 * It runs as its OWN isolated nightly matrix leg (RAY_HOUSE=rrauction) with a
 * Chromium install scoped to that job; a failure can't touch any other segment.
 *
 * Mechanism: one Playwright/Chromium context clears CF once (the clearance
 * cookie then rides every subsequent navigation), paginates each sale's gallery
 * endpoint (?page=N&itemQty=100&cat=0 — classic URL paging, 24→100/pp), and
 * extracts lot cards from the server-rendered HTML. Every lot is routed to a
 * vertical by its OWN subject via routeRRLot (science is matched, never
 * defaulted); mass/graded lots drop.
 *
 * Estimates are open-ended floors ("$25,000+") → estLow only, estHigh null; RR
 * lots therefore surface as demand/descriptive reads, never index comps.
 *
 * Usage:  npx tsx scripts/resolve-rrauction.ts [--write] [--sale <id>] [--max-pages N]
 *   --write      persist the rrauction segment (default: dry-run summary)
 *   --sale <id>  crawl one sale id (default: discover current sales)
 */

import { chromium, type Browser, type Page } from 'playwright-core';
import type { AuctionLot, LotCategory } from '../app/types';
import { routeRRLot } from './rr-auction';
import { ARTIST_MARKET } from '../app/constants';
import { writeSegment, readSegment } from './corpus-io';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BASE = 'https://www.rrauction.com';

interface RawLot {
  lotId: string; lotNumber: number | null; title: string; url: string;
  imageUrl: string | null; estLow: number | null; estHigh: number | null;
  realized: number | null; currentBid: number | null; bidCount: number | null;
  status: 'upcoming' | 'sold'; endsMMDD: string | null;
}

const money = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/\$\s*([\d]+(?:\.\d+)?)/);
  return m ? Math.round(parseFloat(m[1])) : null;
};

/** clear CF once, then reuse the context for every navigation. Launches the
 *  installed Chrome channel (CI: `npx playwright install chrome`; local: system
 *  Chrome), falling back to a bundled chromium if a channel isn't present. */
async function open(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const page = await browser.newPage({ userAgent: UA });
  return { browser, page };
}

/** extract every lot card on one gallery page (server-rendered HTML) */
async function extractPage(page: Page): Promise<RawLot[]> {
  return page.evaluate(() => {
    const out: any[] = [];
    document.querySelectorAll('.auction-item').forEach((el) => {
      const a = el.querySelector('a.auction-item__title') as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      const rawTitle = (a.getAttribute('title') || a.textContent || '').trim();
      // "Lot #4002. Steve Jobs Signed…" → lotNumber + clean title
      const lm = rawTitle.match(/^Lot\s*#?\s*([\w-]+)\s*[.\-]\s*(.+)$/i);
      const lotNumRaw = lm ? lm[1] : null;
      const title = lm ? lm[2].trim() : rawTitle;
      const idm = href.match(/lot-detail\/(\d+)/);
      const lotId = idm ? idm[1] : href.replace(/[^\w]+/g, '-').slice(0, 40);
      const img = el.querySelector('.auction-item__image img') as HTMLImageElement | null;
      const imageUrl = img ? (img.getAttribute('data-src') || img.getAttribute('src')) : null;
      const estTxt = el.querySelector('.gallery-estimate')?.textContent || '';
      const valTxt = el.querySelector('.value')?.textContent || '';
      const endTxt = el.querySelector('.gallery-countdown')?.textContent || '';
      out.push({ lotId, lotNumRaw, title, href, imageUrl, estTxt, valTxt, endTxt });
    });
    return out;
  }).then((rows: any[]) => rows.map((r): RawLot => {
    const estNums = (r.estTxt.replace(/,/g, '').match(/\$\s*[\d]+/g) || []).map((x: string) => money(x)!);
    const sold = /sold\s*for/i.test(r.valTxt);
    const bidM = r.valTxt.match(/\((\d+)\s*bids?\)/i);
    const lotNumber = r.lotNumRaw && /^\d+$/.test(r.lotNumRaw) ? parseInt(r.lotNumRaw, 10) : null;
    const endM = r.endTxt.match(/(\d{1,2})\/(\d{1,2})/);
    return {
      lotId: r.lotId, lotNumber, title: r.title,
      url: r.href.startsWith('http') ? r.href : BASE + r.href,
      imageUrl: r.imageUrl ? (r.imageUrl.startsWith('http') ? r.imageUrl : BASE + r.imageUrl) : null,
      estLow: estNums[0] ?? null,
      estHigh: estNums.length > 1 ? estNums[1] : null, // RR floors ("$25,000+") → no high
      realized: sold ? money(r.valTxt) : null,
      currentBid: !sold ? money(r.valTxt) : null,
      bidCount: bidM ? parseInt(bidM[1], 10) : null,
      status: sold ? 'sold' : 'upcoming',
      endsMMDD: endM ? `${endM[1].padStart(2, '0')}/${endM[2].padStart(2, '0')}` : null,
    };
  }));
}

/** paginate a sale's gallery until a page returns no lots */
async function crawlSale(page: Page, saleId: string, maxPages: number): Promise<{ lots: RawLot[]; saleName: string }> {
  const seen = new Set<string>();
  const lots: RawLot[] = [];
  let saleName = `RR Auction ${saleId}`;
  // RR ignores itemQty (caps ~24/page) and clamps out-of-range pages to the
  // last page — so paginate until a page adds NO new lotIds, not until <N.
  for (let p = 1; p <= maxPages; p++) {
    const url = `${BASE}/auctions/auction-details/${saleId}/?page=${p}&itemQty=100&view=gallery&sort=lot&cat=0`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(p === 1 ? 6000 : 2000); // first nav clears CF
    if (p === 1) {
      const t = await page.title();
      if (t && !/just a moment/i.test(t)) saleName = t.split('|')[0].trim() || saleName;
    }
    const rows = await extractPage(page);
    if (!rows.length) break;
    const fresh = rows.filter((r) => !seen.has(r.lotId));
    if (!fresh.length) break;           // clamped to last page → done
    fresh.forEach((r) => seen.add(r.lotId));
    lots.push(...fresh);
  }
  return { lots, saleName };
}

/** discover current sale ids from the auctions index */
async function discoverSaleIds(page: Page): Promise<string[]> {
  await page.goto(`${BASE}/auctions/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000);
  const ids = await page.evaluate(() => {
    const set = new Set<string>();
    document.querySelectorAll('a[href*="/auctions/details/"], a[href*="/auctions/auction-details/"]').forEach((a) => {
      const h = a.getAttribute('href') || '';
      const m = h.match(/auction-?details\/(\d+)/);
      if (m) set.add(m[1]);
    });
    return Array.from(set);
  });
  return ids;
}

/** RR-native (USD) lot → a v2-correct AuctionLot */
function toLot(r: RawLot, slug: string, saleId: string, saleName: string): AuctionLot {
  const market = ARTIST_MARKET[slug];
  const category: LotCategory = 'object'; // memorabilia/documents/hardware are objects
  const realizedUsd = r.realized;
  const estLowUsd = r.estLow;
  const estHighUsd = r.estHigh;
  // saleDate from the countdown MM/DD, year inferred to the nearest future
  let saleDate = new Date().toISOString().slice(0, 10);
  if (r.endsMMDD) {
    const [mm, dd] = r.endsMMDD.split('/').map(Number);
    const now = new Date();
    let y = now.getUTCFullYear();
    const cand = new Date(Date.UTC(y, mm - 1, dd));
    if (cand.getTime() < now.getTime() - 180 * 86400000) y += 1; // rolled into next year
    saleDate = `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  return {
    id: `rrauction-${saleId}-${r.lotId}`,
    artist: slug,
    title: r.title,
    year: null, medium: null, dimensions: null,
    category,
    imageUrl: r.imageUrl,
    auctionHouse: 'RR Auction',
    saleName,
    saleDate,
    lotNumber: r.lotNumber,
    // v2 money — USD native
    nativeCurrency: 'USD', fxRate: 1, fxAsOf: saleDate,
    hammerNative: realizedUsd, premiumNative: realizedUsd, realizedNative: realizedUsd,
    hammerUsd: realizedUsd, premiumUsd: realizedUsd, realizedUsd,
    estLowNative: estLowUsd, estHighNative: estHighUsd, estLowUsd, estHighUsd,
    // old aliases
    estimateLow: estLowUsd, estimateHigh: estHighUsd,
    currency: 'USD',
    hammerPrice: realizedUsd, premiumPrice: realizedUsd, priceUsd: realizedUsd,
    priceBasis: r.status === 'sold' ? 'hammer' : undefined,
    currentBid: r.currentBid ?? undefined,
    bidCount: r.bidCount ?? undefined,
    status: r.status,
    // vertical follows the slug, market is derived downstream
    ...(market ? {} : {}),
  } as AuctionLot;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const saleArg = args.includes('--sale') ? args[args.indexOf('--sale') + 1] : null;
  const maxPages = args.includes('--max-pages') ? parseInt(args[args.indexOf('--max-pages') + 1], 10) : 40;

  const { browser, page } = await open();
  try {
    const saleIds = saleArg ? [saleArg] : await discoverSaleIds(page);
    console.log(`[rr] sales to crawl: ${saleIds.join(', ') || '(none discovered)'}`);

    const lots: AuctionLot[] = [];
    const dist: Record<string, number> = {};
    let dropped = 0;
    for (const saleId of saleIds) {
      const { lots: raw, saleName } = await crawlSale(page, saleId, maxPages);
      let kept = 0;
      for (const r of raw) {
        const slug = routeRRLot(r.title);
        if (!slug) { dropped++; continue; }
        lots.push(toLot(r, slug, saleId, saleName));
        dist[slug] = (dist[slug] || 0) + 1;
        kept++;
      }
      console.log(`[rr] sale ${saleId} "${saleName}": ${raw.length} lots → ${kept} kept, ${raw.length - kept} dropped`);
    }

    console.log(`\n[rr] TOTAL ${lots.length} lots kept, ${dropped} dropped`);
    console.log('[rr] vertical distribution:');
    for (const [slug, n] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${slug.padEnd(24)} ${n}   → ${ARTIST_MARKET[slug] || '?'}`);
    }

    if (write) {
      // RR owns its whole segment (single house); replace last-good with this run.
      const prior = readSegment('rrauction') as unknown as AuctionLot[];
      if (lots.length === 0 && prior.length > 0) {
        console.log(`[rr] refusing to overwrite ${prior.length} last-good lots with an empty crawl`);
      } else {
        writeSegment('rrauction', lots as unknown as Record<string, unknown>[]);
        console.log(`[rr] wrote rrauction segment: ${lots.length} lots (was ${prior.length})`);
      }
    } else {
      console.log('\n[rr] dry run — pass --write to persist the segment');
      console.log('[rr] sample lots:');
      lots.slice(0, 6).forEach((l) => console.log(`   [${ARTIST_MARKET[l.artist]}] ${l.artist} · ${l.status} · est ${l.estLowUsd ?? '—'} · ${l.title.slice(0, 60)}`));
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error('[rr] FATAL', e); process.exit(1); });
