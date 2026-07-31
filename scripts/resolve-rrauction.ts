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
 * Mechanism: CF grants each FRESH browser context exactly one clean
 * navigation — no cf_clearance cookie is ever set, and every SECOND goto in
 * the same context re-challenges and never clears (observed live 2026-07-30:
 * nav 1 renders, nav 2+ sits at "Just a moment…" forever; in-page fetch()es
 * 403 the same way). So the crawl opens a throwaway context per gallery page,
 * extracts, and closes it. Anonymous sessions also clamp itemQty to 24/pp
 * (100 is silently ignored), so we page with the site's own link form
 * (?page=N&itemQty=24&sort=lot-asc — NO trailing slash before the query) and
 * take the 24-lot pages as they come. Every lot is routed to a vertical by its
 * OWN subject via routeRRLot (science is matched, never defaulted);
 * mass/graded lots drop.
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

/** launch the installed Chrome channel (CI: `npx playwright install chrome`;
 *  local: system Chrome), falling back to a bundled chromium if a channel
 *  isn't present. Contexts are throwaway — see nav(). */
async function open(): Promise<Browser> {
  return chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
}

/** navigate ONE url in a fresh throwaway context and run fn on the settled
 *  page. CF only ever grants a context its first navigation, so every gallery
 *  page gets its own context; a challenged attempt is burned and retried once.
 *  ok=false + challenged=true after retries means CF walled us (a block, not a
 *  fact about the sale); ok=false + challenged=false means the page rendered
 *  without the needle (e.g. past the last gallery page). */
async function nav<T>(browser: Browser, url: string, needle: string, fn: (page: Page) => Promise<T>): Promise<{ ok: boolean; value: T | null; challenged: boolean }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctx = await browser.newContext({ userAgent: UA });
    try {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const ok = await settle(page, needle);
      if (ok) return { ok: true, value: await fn(page), challenged: false };
      const challenged = /just a moment/i.test(await page.title().catch(() => ''));
      if (!challenged) return { ok: false, value: null, challenged: false };
      // challenged → this context is spent; burn it and try one more
    } finally {
      await ctx.close();
    }
  }
  return { ok: false, value: null, challenged: true };
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

/** wait until the CF challenge has cleared and real content is up (or timeout).
 *  CI runners can take longer than a residential machine — poll, don't guess. */
async function settle(page: Page, needle: string, maxMs = 30000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const state = await page.evaluate((sel) => ({
      challenged: /just a moment/i.test(document.title),
      ready: !!document.querySelector(sel),
    }), needle).catch(() => ({ challenged: true, ready: false }));
    if (state.ready) return true;
    if (!state.challenged && Date.now() - t0 > 8000) return false; // page up, content absent
    await page.waitForTimeout(1000);
  }
  return false;
}

/** a gallery page url in the site's own link form (no trailing slash before
 *  the query — the slashed form works too, but match what RR emits) */
const galleryUrl = (saleId: string, p: number, cat: string) =>
  `${BASE}/auctions/auction-details/${saleId}?page=${p}&itemQty=24&view=gallery&sort=lot-asc&cat=${cat}`;

/** paginate one gallery view (a cat tab) until a page adds no new lotIds.
 *  Throws if CF walls the FIRST page of the all-lots view (sale unreadable —
 *  fail loud, never silently crawl 0); mid-run walls warn and truncate. */
async function crawlView(browser: Browser, saleId: string, cat: string, seen: Set<string>, lots: RawLot[], maxPages: number): Promise<void> {
  for (let p = 1; p <= maxPages; p++) {
    const r = await nav(browser, galleryUrl(saleId, p, cat), '.auction-item__title', extractPage);
    if (r.challenged) {
      if (cat === '0' && p === 1) throw new Error(`[rr] sale ${saleId}: CF challenge never cleared on the all-lots view — blocked, not empty`);
      console.warn(`[rr] sale ${saleId} cat=${cat} page ${p}: CF wall mid-crawl — view truncated`);
      break;
    }
    const rows = r.value ?? [];
    if (!rows.length) break;            // rendered page, no cards → past the end
    const fresh = rows.filter((x) => !seen.has(x.lotId));
    if (!fresh.length) break;           // clamped to last page → done
    fresh.forEach((x) => seen.add(x.lotId));
    lots.push(...fresh);
  }
}

/** crawl a sale COMPLETELY: the all-lots view plus every category tab the
 *  sale page advertises (big RR sales partition lots across cat= views —
 *  cat=0 alone is not guaranteed to expose everything). Dedup by lotId. */
async function crawlSale(browser: Browser, saleId: string, maxPages: number): Promise<{ lots: RawLot[]; saleName: string }> {
  const seen = new Set<string>();
  const lots: RawLot[] = [];
  let saleName = `RR Auction ${saleId}`;

  // land on the sale once: sale name + the set of category tabs
  const landing = await nav(browser, galleryUrl(saleId, 1, '0'), '.auction-item__title', async (page) => ({
    title: await page.title(),
    cats: await page.evaluate(() => {
      const set = new Set<string>();
      document.querySelectorAll('a[href*="cat="]').forEach((a) => {
        const m = (a.getAttribute('href') || '').match(/[?&]cat=(\d+)/);
        if (m) set.add(m[1]);
      });
      return Array.from(set);
    }),
  }));
  const t = landing.value?.title;
  if (t && !/just a moment/i.test(t)) saleName = t.split('|')[0].trim() || saleName;
  const cats = landing.value?.cats ?? [];

  await crawlView(browser, saleId, '0', seen, lots, maxPages);
  for (const cat of cats) {
    if (cat === '0') continue;
    await crawlView(browser, saleId, cat, seen, lots, maxPages);
  }
  console.log(`[rr] sale ${saleId}: ${lots.length} unique lots across ${1 + cats.filter((c) => c !== '0').length} views`);
  return { lots, saleName };
}

/** discover current sale ids from the auctions index. The index links sales as
 *  /auctions/details/<id>-<slug>/ (note the s in auctions/), while gallery
 *  paging uses /auctions/auction-details/<id>/ — match BOTH forms. */
async function discoverSaleIds(browser: Browser): Promise<string[]> {
  const r = await nav(browser, `${BASE}/auctions/`, 'a[href*="details/"]', (page) => page.evaluate(() => {
    const set = new Set<string>();
    let n = 0;
    document.querySelectorAll('a[href]').forEach((a) => {
      const h = a.getAttribute('href') || '';
      // matches /auctions/details/748-…, /auctions/auction-details/748/, with
      // or without the domain
      const m = h.match(/\/auctions\/(?:auction-)?details\/(\d+)/);
      if (m) { set.add(m[1]); n++; }
    });
    return { ids: Array.from(set), title: document.title, links: n };
  }));
  const { ids, title, links } = r.value ?? { ids: [], title: '(challenged)', links: 0 };
  console.log(`[rr] discovery: title="${title}" · ${links} sale links · ${ids.length} unique sales`);
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
  // anonymous sessions serve 24 lots/page — 80 pages ≈ 1.9k lots/view ceiling
  const maxPages = args.includes('--max-pages') ? parseInt(args[args.indexOf('--max-pages') + 1], 10) : 80;

  const browser = await open();
  try {
    const saleIds = saleArg ? [saleArg] : await discoverSaleIds(browser);
    console.log(`[rr] sales to crawl: ${saleIds.join(', ') || '(none discovered)'}`);
    if (!saleIds.length) {
      // zero discovery is a BROKEN CRAWL (selector/regex/CF drift), never a
      // fact about RR — fail the job loudly; assemble keeps the last-good
      // segment. Silently writing empty is how a green run ships no lots.
      throw new Error('[rr] discovery returned 0 sales — refusing to write; the leg must go red');
    }

    const lots: AuctionLot[] = [];
    const dist: Record<string, number> = {};
    let dropped = 0;
    for (const saleId of saleIds) {
      const { lots: raw, saleName } = await crawlSale(browser, saleId, maxPages);
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
      if (lots.length === 0) {
        // sales existed but produced nothing — extraction drift. Go red;
        // last-good survives untouched.
        throw new Error(`[rr] ${saleIds.length} sales but 0 lots extracted — refusing to write empty (last-good: ${prior.length})`);
      }
      writeSegment('rrauction', lots as unknown as Record<string, unknown>[]);
      console.log(`[rr] wrote rrauction segment: ${lots.length} lots (was ${prior.length})`);
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
