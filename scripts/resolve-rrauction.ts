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

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
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
  /** "7:00 PM" when the gallery countdown printed a clock (US Eastern) */
  endsClock?: string | null;
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
    // the countdown sometimes prints a clock ("... 7:00 PM") — keep it when
    // present; RR runs on US Eastern
    const timeM = r.endTxt.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
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
      endsClock: timeM ? `${timeM[1]}:${timeM[2]} ${timeM[3].toUpperCase()}` : null,
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
async function crawlView(browser: Browser, saleId: string, cat: string, seen: Set<string>, lots: RawLot[], maxPages: number): Promise<'end' | 'ceiling' | 'wall'> {
  for (let p = 1; p <= maxPages; p++) {
    const r = await nav(browser, galleryUrl(saleId, p, cat), '.auction-item__title', extractPage);
    if (r.challenged) {
      if (cat === '0' && p === 1) throw new Error(`[rr] sale ${saleId}: CF challenge never cleared on the all-lots view — blocked, not empty`);
      console.warn(`[rr] sale ${saleId} cat=${cat} page ${p}: CF wall mid-crawl — view truncated`);
      return 'wall';
    }
    const rows = r.value ?? [];
    if (!rows.length) return 'end';     // rendered page, no cards → past the end
    const fresh = rows.filter((x) => !seen.has(x.lotId));
    if (!fresh.length) return 'end';    // clamped to last page → done
    fresh.forEach((x) => seen.add(x.lotId));
    lots.push(...fresh);
  }
  return 'ceiling'; // still yielding fresh lots at maxPages — view may be truncated
}

/** crawl a sale COMPLETELY: the all-lots view plus every category tab the
 *  sale page advertises (big RR sales partition lots across cat= views —
 *  cat=0 alone is not guaranteed to expose everything). Dedup by lotId. */
/** catSweep 'always' (live nightly): crawl every category tab — belt and
 *  braces for the handful of live sales. 'auto' (archive): the all-lots view's
 *  own pagination covers whole sales (verified: sale 400 pages 1–50 ≈ all
 *  ~1.2k lots), so tabs are only swept when cat=0 hit the page ceiling and
 *  might be truncated — a 4–5× page saving across a 700-sale backfill. */
async function crawlSale(browser: Browser, saleId: string, maxPages: number, catSweep: 'always' | 'auto' = 'always'): Promise<{ lots: RawLot[]; saleName: string; saleClosed: string | null }> {
  const seen = new Set<string>();
  const lots: RawLot[] = [];
  let saleName = `RR Auction ${saleId}`;

  // land on the sale once: sale name + the set of category tabs
  const landing = await nav(browser, galleryUrl(saleId, 1, '0'), '.auction-item__title', async (page) => ({
    title: await page.title(),
    // closed sales carry "Auction Closed April 23, 2026" in the sale header;
    // live-gavel sales (Remarkable Rarities etc.) instead carry
    // "Auction #726 - September 20, 2025" — capture both, decide below
    hdr: await page.evaluate(() => {
      const t = document.body.innerText;
      const m = t.match(/Auction Closed\s+([A-Za-z]+\.?\s+\d{1,2},\s*\d{4})/);
      const n = t.match(/Auction\s*#\s*(\d+)\s*[-\u2013\u2014]\s*([A-Za-z]+\.?\s+\d{1,2},?\s*\d{4})/);
      return { closed: m ? m[1] : null, numId: n ? n[1] : null, numDate: n ? n[2] : null };
    }),
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

  const allView = await crawlView(browser, saleId, '0', seen, lots, maxPages);
  if (catSweep === 'always' || allView === 'ceiling') {
    for (const cat of cats) {
      if (cat === '0') continue;
      await crawlView(browser, saleId, cat, seen, lots, maxPages);
    }
  }
  console.log(`[rr] sale ${saleId}: ${lots.length} unique lots across ${1 + cats.filter((c) => c !== '0').length} views`);
  let saleClosed = isoDate(landing.value?.hdr?.closed);
  if (!saleClosed && landing.value?.hdr?.numId === saleId) {
    // the numbered header is the sale DATE, not proof it closed — trust it
    // only once that date is in the past (a future live sale stays no-date)
    const d = isoDate(landing.value.hdr.numDate);
    if (d && d < new Date().toISOString().slice(0, 10)) saleClosed = d;
  }
  return { lots, saleName, saleClosed };
}

const MONTH_NUM: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
/** "April 23, 2026" / "Apr. 23, 2026" → "2026-04-23" (null on anything else) */
function isoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s*(\d{4})/);
  if (!m) return null;
  const mm = MONTH_NUM[m[1].toLowerCase().slice(0, 3)];
  return mm ? `${m[3]}-${mm}-${m[2].padStart(2, '0')}` : null;
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
function toLot(r: RawLot, slug: string, saleId: string, saleName: string, arch?: { saleDate: string } | null): AuctionLot {
  const market = ARTIST_MARKET[slug];
  const category: LotCategory = 'object'; // memorabilia/documents/hardware are objects
  const realizedUsd = r.realized;
  const estLowUsd = r.estLow;
  const estHighUsd = r.estHigh;
  // archive lots: the sale-header close date is truth; a non-sold card in a
  // CLOSED sale is a pass, not an upcoming lot
  const status = arch ? (r.status === 'sold' ? 'sold' : 'bought_in') : r.status;
  // saleDate from the countdown MM/DD, year inferred to the nearest future
  let saleDate = arch ? arch.saleDate : new Date().toISOString().slice(0, 10);
  if (!arch && r.endsMMDD) {
    const [mm, dd] = r.endsMMDD.split('/').map(Number);
    const now = new Date();
    let y = now.getUTCFullYear();
    const cand = new Date(Date.UTC(y, mm - 1, dd));
    if (cand.getTime() < now.getTime() - 180 * 86400000) y += 1; // rolled into next year
    saleDate = `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  // close TIMESTAMP when the countdown printed a clock — RR is US Eastern;
  // DST by month (Mar–Oct ≈ EDT −04:00, else EST −05:00) is within a minute
  // of truth for countdown purposes and never claims more than it knows
  let saleDateTime: string | null = null;
  if (!arch && r.endsClock && saleDate) {
    const cm = r.endsClock.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (cm) {
      let h = Number(cm[1]) % 12;
      if (/pm/i.test(cm[3])) h += 12;
      const mo = Number(saleDate.slice(5, 7));
      const off = mo >= 3 && mo <= 10 ? '-04:00' : '-05:00';
      saleDateTime = `${saleDate}T${String(h).padStart(2, '0')}:${cm[2]}:00${off}`;
    }
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
    ...(saleDateTime ? { saleDateTime } : {}),
    lotNumber: r.lotNumber,
    // v2 money — USD native
    nativeCurrency: 'USD', fxRate: 1, fxAsOf: saleDate,
    // RR renders "Sold For: $X (w/BP)" — realized figures are PREMIUM-inclusive
    hammerNative: null, premiumNative: realizedUsd, realizedNative: realizedUsd,
    hammerUsd: null, premiumUsd: realizedUsd, realizedUsd,
    estLowNative: estLowUsd, estHighNative: estHighUsd, estLowUsd, estHighUsd,
    // old aliases
    estimateLow: estLowUsd, estimateHigh: estHighUsd,
    currency: 'USD',
    hammerPrice: null, premiumPrice: realizedUsd, priceUsd: realizedUsd,
    priceBasis: realizedUsd != null ? 'realized' : undefined,
    currentBid: arch ? undefined : r.currentBid ?? undefined,
    bidCount: r.bidCount ?? undefined,
    status,
    ...(arch ? { archived: true } : {}),
    // vertical follows the slug, market is derived downstream
    ...(market ? {} : {}),
  } as AuctionLot;
}

// ── ARCHIVE BACKFILL ─────────────────────────────────────────────────────────
// One-time (resumable) harvest of RR's CLOSED sales. Sale ids are sequential,
// so we walk a range newest→oldest. Every completed sale is checkpointed; a
// re-run skips done/dead sales and retries blocked ones. Lots are stamped
// archived:true and land in the SEPARATE 'rrauction-archive' segment (the
// assemble archive tier — engine-visible, never in client shards), so this can
// never race the nightly's live rrauction leg, which owns 'rrauction'.
//
//   npx tsx scripts/resolve-rrauction.ts --archive [--from 746] [--to 1]
//       [--workers 3] [--push]        crawl + finalize (+ push segment to R2)
//   npx tsx scripts/resolve-rrauction.ts --archive --finalize [--push]
//       skip crawling; rebuild the segment from the checkpoint ndjson
const ARCH_DIR = process.env.RR_ARCHIVE_DIR || path.join(process.cwd(), 'data', 'rr-archive');
const ckptPath = () => path.join(ARCH_DIR, 'checkpoint.json');
const ndjsonPath = () => path.join(ARCH_DIR, 'lots.ndjson');

interface ArchCkpt { sales: Record<string, { state: 'done' | 'dead' | 'blocked' | 'no-date'; raw?: number; kept?: number; name?: string; date?: string }> }
function loadCkpt(): ArchCkpt { try { return JSON.parse(fs.readFileSync(ckptPath(), 'utf8')); } catch { return { sales: {} }; } }
function saveCkpt(c: ArchCkpt) {
  fs.mkdirSync(ARCH_DIR, { recursive: true });
  fs.writeFileSync(ckptPath() + '.tmp', JSON.stringify(c, null, 1));
  fs.renameSync(ckptPath() + '.tmp', ckptPath());
}
const argOf = (args: string[], k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);

async function runArchive(args: string[], maxPages: number) {
  const from = parseInt(argOf(args, '--from') ?? '746', 10);
  const to = parseInt(argOf(args, '--to') ?? '1', 10);
  const workers = parseInt(argOf(args, '--workers') ?? '3', 10);
  const ckpt = loadCkpt();
  const ids: string[] = [];
  for (let i = from; i >= to; i--) {
    const st = ckpt.sales[String(i)]?.state;
    if (st && st !== 'blocked') continue; // done/dead/no-date stay settled; blocked retries
    ids.push(String(i));
  }
  fs.mkdirSync(ARCH_DIR, { recursive: true });
  console.log(`[rr-archive] range ${from}→${to}: ${ids.length} sales to crawl (${Object.keys(ckpt.sales).length} already checkpointed) · ${workers} workers`);
  const browser = await open();
  let done = 0, keptTotal = 0;
  const t0 = Date.now();
  try {
    const next = ids[Symbol.iterator]();
    await Promise.all(Array.from({ length: workers }, async () => {
      for (let n = next.next(); !n.done; n = next.next()) {
        const saleId = n.value;
        try {
          const { lots: raw, saleName, saleClosed } = await crawlSale(browser, saleId, maxPages, 'auto');
          if (!raw.length) { ckpt.sales[saleId] = { state: 'dead' }; saveCkpt(ckpt); continue; }
          if (!saleClosed) {
            // no "Auction Closed" header → still live, or header drift. Either
            // way we will NOT guess a date — dates are load-bearing for comps.
            ckpt.sales[saleId] = { state: 'no-date', raw: raw.length, name: saleName };
            saveCkpt(ckpt);
            console.warn(`[rr-archive] sale ${saleId} "${saleName}": ${raw.length} lots but NO closed date — skipped`);
            continue;
          }
          const lines: string[] = [];
          for (const r of raw) {
            const slug = routeRRLot(r.title);
            if (!slug) continue;
            lines.push(JSON.stringify(toLot(r, slug, saleId, saleName, { saleDate: saleClosed })));
          }
          if (lines.length) fs.appendFileSync(ndjsonPath(), lines.join('\n') + '\n');
          ckpt.sales[saleId] = { state: 'done', raw: raw.length, kept: lines.length, name: saleName, date: saleClosed };
          saveCkpt(ckpt);
          done++; keptTotal += lines.length;
          console.log(`[rr-archive] ${saleId} "${saleName}" (${saleClosed}): ${raw.length} lots → ${lines.length} kept · ${done}/${ids.length} sales · ${keptTotal} total · ${((Date.now() - t0) / 60000).toFixed(1)}m`);
        } catch (e) {
          ckpt.sales[saleId] = { state: 'blocked' };
          saveCkpt(ckpt);
          console.warn(`[rr-archive] sale ${saleId} blocked: ${(e as Error).message.slice(0, 100)}`);
        }
      }
    }));
  } finally {
    await browser.close();
  }
  finalizeArchive(args.includes('--push'));
}

/** dedup the harvest ndjson by lot id and write/push the archive segment */
function finalizeArchive(push: boolean) {
  if (!fs.existsSync(ndjsonPath())) { console.log('[rr-archive] no harvest ndjson — nothing to finalize'); return; }
  const byId = new Map<string, Record<string, unknown>>();
  for (const line of fs.readFileSync(ndjsonPath(), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const l = JSON.parse(line) as Record<string, unknown>;
    byId.set(l.id as string, l);
  }
  const lots = Array.from(byId.values());
  if (!lots.length) { console.log('[rr-archive] 0 lots after dedup — refusing to write'); return; }
  writeSegment('rrauction-archive', lots);
  console.log(`[rr-archive] wrote rrauction-archive segment: ${lots.length} unique lots`);
  if (push) execSync('bash scripts/data-store.sh push-segment rrauction-archive', { stdio: 'inherit' });
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const saleArg = args.includes('--sale') ? args[args.indexOf('--sale') + 1] : null;
  // anonymous sessions serve 24 lots/page — 80 pages ≈ 1.9k lots/view ceiling
  const maxPages = args.includes('--max-pages') ? parseInt(args[args.indexOf('--max-pages') + 1], 10) : 80;

  if (args.includes('--archive')) {
    if (args.includes('--finalize')) { finalizeArchive(args.includes('--push')); return; }
    await runArchive(args, maxPages);
    return;
  }

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

    // ── STALE-SALE RESOLVE — a sale that closes between nightlies falls off
    // /auctions/ (discovery is live-sales-only) and its rows carry forward
    // FROZEN as status 'upcoming' forever (the Aug-21 Steve Jobs/Apple sale
    // 748 sat stuck for six days). RR keeps closed-sale pages up with
    // "Sold For" values, so re-crawl any carried sale still holding
    // past-dated upcoming rows and let the archive mapping settle it
    // (sold → sold, unsold in a closed sale → bought_in). Capped per run to
    // bound headless time; the queue drains across nightlies.
    const priorSeg = readSegment('rrauction') as unknown as AuctionLot[];
    const today = new Date().toISOString().slice(0, 10);
    const liveSet = new Set(saleIds);
    const saleOfId = (l: AuctionLot) => (String(l.id).match(/^rrauction-(\d+)-/) || [])[1] || '';
    const staleCount = new Map<string, number>();
    const staleDate = new Map<string, string>();
    for (const l of priorSeg) {
      const sid = saleOfId(l);
      if (!sid || liveSet.has(sid)) continue;
      const sd = String(l.saleDate || '').slice(0, 10);
      if (l.status === 'upcoming' && sd && sd < today) {
        staleCount.set(sid, (staleCount.get(sid) || 0) + 1);
        if (!staleDate.has(sid) || sd > staleDate.get(sid)!) staleDate.set(sid, sd);
      }
    }
    const staleIds = Array.from(staleCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([sid]) => sid);
    if (staleIds.length) {
      console.log(`[rr] stale closed sales to resolve: ${staleIds.map(s => `${s} (${staleCount.get(s)} stuck)`).join(', ')}`);
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
    for (const saleId of staleIds) {
      try {
        const { lots: raw, saleName, saleClosed } = await crawlSale(browser, saleId, maxPages);
        // the sale-header close date is truth; the stuck rows' own saleDate
        // is the fallback when the header omits it
        const closedDate = saleClosed || staleDate.get(saleId) || today;
        let kept = 0, sold = 0;
        for (const r of raw) {
          const slug = routeRRLot(r.title);
          if (!slug) { dropped++; continue; }
          const lot = toLot(r, slug, saleId, saleName, { saleDate: closedDate });
          lots.push(lot);
          dist[slug] = (dist[slug] || 0) + 1;
          kept++;
          if (lot.status === 'sold') sold++;
        }
        saleIds.push(saleId); // joins the crawled set so the merge replaces its rows
        console.log(`[rr] STALE sale ${saleId} "${saleName}" (closed ${closedDate}): ${raw.length} lots → ${kept} resolved (${sold} sold, ${kept - sold} passed)`);
      } catch (e) {
        // a stale sale that fails to resolve stays carried untouched — never
        // let a results pass take down the live crawl's write
        console.warn(`[rr] stale sale ${saleId} resolve failed (carried as-is): ${(e as Error).message}`);
      }
    }

    console.log(`\n[rr] TOTAL ${lots.length} lots kept, ${dropped} dropped`);
    console.log('[rr] vertical distribution:');
    for (const [slug, n] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${slug.padEnd(24)} ${n}   → ${ARTIST_MARKET[slug] || '?'}`);
    }

    if (write) {
      // RR owns its whole segment (single house), but discovery is only this
      // run's truth about which sales are LIVE — a closed sale that falls off
      // /auctions/ must not take its sold rows with it, and partial discovery
      // (markup drift showing 3 of 5 sales) must not halve the segment. Sales
      // crawled this run are replaced whole; every other prior lot carries.
      const prior = readSegment('rrauction') as unknown as AuctionLot[];
      if (lots.length === 0) {
        // sales existed but produced nothing — extraction drift. Go red;
        // last-good survives untouched.
        throw new Error(`[rr] ${saleIds.length} sales but 0 lots extracted — refusing to write empty (last-good: ${prior.length})`);
      }
      const crawled = new Set(saleIds);
      const saleOf = (l: AuctionLot) => (String(l.id).match(/^rrauction-(\d+)-/) || [])[1] || '';
      const carried = prior.filter(l => !crawled.has(saleOf(l)));
      const merged = carried.concat(lots);
      // shrink guard mirroring ray-crawl's segment-collapse guard (>30%, with
      // the same >200-lot floor): even post-merge, a collapse means the crawl
      // lied somewhere — abort the write, keep last-good.
      if (prior.length > 200 && merged.length < prior.length * 0.7) {
        throw new Error(`[rr] segment would collapse ${prior.length} → ${merged.length} (>30%) — refusing to overwrite the last-good segment`);
      }
      writeSegment('rrauction', merged as unknown as Record<string, unknown>[]);
      console.log(`[rr] wrote rrauction segment: ${merged.length} lots (${lots.length} crawled + ${carried.length} carried; was ${prior.length})`);
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
