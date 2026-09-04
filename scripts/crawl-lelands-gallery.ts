// Lelands (CreateAuction) GALLERY backfill — the efficient bulk path for the
// full 25-yr archive. Per-lot headless is a non-starter (CF challenge each);
// the gallery lists a whole auction's lots WITH sold prices inline, and — the
// key find — the WebForms auction-select postback SURVIVES Cloudflare, so one
// CF-clear drives the dropdown through all ~132 auctions. Extends to Memory
// Lane / LOTG (same engine) via --house. Run:
//   RAY_SKIP_MAIN=1 npx tsx scripts/crawl-lelands-gallery.ts --house lelands [--write] [--max-auctions N]
//     [--sale-date YYYY-MM-DD]   only auctions whose season date lands within ±75 days
//     [--auction <substring>]    only auctions whose dropdown name contains it (case-insensitive)
//   (the heal targeting knobs — e.g. Memory Lane 2026-06-06: --house memorylane --sale-date 2026-06-06)
import { chromium, type Browser, type Page } from 'playwright-core';
import type { AuctionLot, LotCategory, AuctionHouse } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { classifySports, pseudoArtist, readAuth, stampRealizedUsd, seasonToDate, writeMergedSegment, settledOnly, installCrashGuard, purgeFromSegment } from './lib/sports-crawl';
import { readSegment } from './corpus-io';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HOUSES: Record<string, { host: string; house: AuctionHouse; seg: string; prefix: string }> = {
  lelands: { host: 'https://auction.lelands.com', house: 'Lelands', seg: 'lelands', prefix: 'lelands' },
  memorylane: { host: 'https://bid.memorylaneinc.com', house: 'Memory Lane', seg: 'memorylane', prefix: 'memorylane' },
  lotg: { host: 'https://bid.loveofthegameauctions.com', house: 'Love of the Game', seg: 'lotg', prefix: 'lotg' },
};
const argStr = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const argNum = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : d; };
const TODAY = new Date().toISOString().slice(0, 10);

async function clearCF(page: Page, maxMs = 30000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await page.evaluate(() => !/just a moment/i.test(document.title)).catch(() => false)) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

interface RawCard { id: string; title: string; sold: string; img: string | null; wd?: boolean; }
async function extractCards(page: Page): Promise<RawCard[]> {
  // no named fns inside evaluate — the tsx/esbuild __name trap
  return page.evaluate(() => {
    const byId = new Map<string, { title: string; card: string; img: string | null }>();
    document.querySelectorAll('a[href*="bidplace.aspx?itemid="]').forEach((a) => {
      const href = (a as HTMLAnchorElement).href;
      const id = (href.match(/itemid=(\d+)/) || [])[1];
      if (!id) return;
      // walk up ONLY while the element holds a single itemid — past that is the
      // grid, where a priceless (withdrawn) card would steal a NEIGHBOR's
      // "SOLD FOR" (this exact bug wrote 27 Lelands lots at the same $3.1M)
      let el: Element | null = a; let card: Element | null = a;
      for (let i = 0; i < 6 && el; i++) {
        const ids = new Set<string>();
        el.querySelectorAll('a[href*="bidplace.aspx?itemid="]').forEach((x) => {
          const m = (x.getAttribute('href') || '').match(/itemid=(\d+)/);
          if (m) ids.add(m[1]);
        });
        if (ids.size > 1) break;
        card = el;
        if (/sold for|current bid/i.test(el.textContent || '')) break;
        el = el.parentElement;
      }
      const txt = (card?.textContent || '').replace(/\s+/g, ' ').trim();
      const img = (card?.querySelector('img') as HTMLImageElement | null)?.getAttribute('src') || null;
      // TITLE AT SOURCE (Sep 2 2026): a card has 2+ anchors for one itemid
      // (image + title text) — the title is the longest anchor's OWN text, not
      // the whole card blob (which leads with ribbon labels, the boxed lot
      // number and trails with the price line; the pre-fix rows stored that
      // blob as the title)
      const own = (a.textContent || '').replace(/\s+/g, ' ').trim();
      const prev = byId.get(id) || { title: '', card: txt, img };
      if (own.length > prev.title.length && !/^\$|current bid|sold for/i.test(own)) prev.title = own;
      if (!prev.img && img) prev.img = img;
      if (txt.length > prev.card.length) prev.card = txt;
      byId.set(id, prev);
    });
    const out: RawCard[] = [];
    byId.forEach((v, id) => {
      const txt = v.card;
      const wd = /\bwithdrawn\b/i.test(txt); // withdrawn ≠ a sale — reported so its ghost row gets purged
      const sold = wd ? '' : (txt.match(/sold for\s*\$[\d,]+(?:\.\d+)?/i) || [])[0] || '';
      // blob fallback only: strip ribbon + the boxed lot number (never off the
      // anchor's own text — that would eat the year of "1952 Topps …")
      const fallback = txt.replace(/sold for\s*\$[\d,.]+/i, '').replace(/current bid.*/i, '').trim()
        .replace(/^(best of the best|highlight|featured|premier)\s+/i, '')
        .replace(/^\d{1,4}\s+(?=\D)/, '');
      const title = (v.title || fallback).replace(/^(best of the best|highlight|featured|premier)\s+/i, '').trim().slice(0, 200);
      out.push({ id, title, sold, img: v.img, wd });
    });
    return out;
  }).catch(() => [] as RawCard[]);
}

function buildLot(c: RawCard, saleDate: string, cfg: { host: string; house: AuctionHouse; prefix: string }): AuctionLot | null {
  const m = c.sold.replace(/,/g, '').match(/\$([0-9]+)/);
  const soldNum = m ? parseInt(m[1], 10) : 0;
  if (!soldNum) return null; // no sold price on the card → not a settled sale
  const title = c.title.replace(/^Lot\s*#?\s*[\w-]+\s*[:.\-]\s*/i, '').trim() || c.title.trim();
  if (!title) return null;
  const cat = classifySports('', title);
  const auth = readAuth(cat, title, title);
  return {
    id: `${cfg.prefix}-${c.id}`,
    artist: pseudoArtist(cat), title,
    year: null, medium: null, dimensions: null, description: null, platform: null,
    category: 'object' as LotCategory,
    imageUrl: c.img && c.img.startsWith('http') ? c.img : c.img ? cfg.host + c.img : null,
    auctionHouse: cfg.house, saleName: null, saleDate, lotNumber: null,
    ...stampRealizedUsd(soldNum, saleDate),
    gradeLabel: auth.grade, authCert: auth.marks.length ? auth.marks.join(' · ') : null,
    authConfidence: auth.confidence, subCat: cat, status: 'sold',
    url: `${cfg.host}/bids/bidplace.aspx?itemid=${c.id}`,
  } as unknown as AuctionLot;
}

async function main() {
  const write = process.argv.includes('--write');
  if (write) installCrashGuard('LEL-GAL');
  const cfg = HOUSES[argStr('house', 'lelands')];
  if (!cfg) { console.error('unknown --house'); process.exit(1); }
  const maxAuctions = argNum('max-auctions', 200);
  // heal targeting: --sale-date narrows to auctions whose season date (the
  // dropdown name → seasonToDate, day 15) lands within ±75 days of it (a
  // hobby season is ~a quarter; the exact close day isn't in the name);
  // --auction narrows on the dropdown name itself
  const saleDateArg = argStr('sale-date', '');
  // --dump <path>: write every crawled lot as NDJSON for offline inspection
  // (diagnosing the price bleed: compare crawled prices against the served ledger).
  const dumpPath = argStr('dump', '');
  const auctionArg = argStr('auction', '').toLowerCase();
  if (saleDateArg && !/^\d{4}-\d{2}-\d{2}$/.test(saleDateArg)) { console.error('--sale-date must be YYYY-MM-DD'); process.exit(1); }
  const WINDOW_MS = 75 * 86_400_000;

  // Rows the segment already holds with an EXACT sale date (the live-leg /
  // per-lot paths stamp the auction's real End: date; only the gallery stamps
  // a season-approximate day-15). A heal that re-prices a row must not also
  // downgrade its date — the Aug 13 resolve pass learned this on ~1.9k Lelands
  // rows. Keep the existing exact date; take the gallery's price.
  const exactDates = new Map<string, { saleDate: string; saleDateTime: string | null }>();
  for (const r of readSegment(cfg.seg) as unknown as (AuctionLot & { saleDateTime?: string | null })[]) {
    if (r && r.id && typeof r.saleDate === 'string' && !r.saleDate.endsWith('-15')) exactDates.set(r.id, { saleDate: r.saleDate, saleDateTime: r.saleDateTime ?? null });
  }

  const browser: Browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());

  // one clean context just to read the auction dropdown
  const ictx = await browser.newContext({ userAgent: UA });
  const ipage = await ictx.newPage();
  await ipage.goto(`${cfg.host}/Lots/Gallery`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (!await clearCF(ipage)) { console.error('[gal] CF never cleared'); await browser.close(); process.exit(1); }
  const auctions = await ipage.evaluate(() => {
    const s = document.querySelector('select[name*="Auction"], select[id*="Auction"]') as HTMLSelectElement | null;
    const out: { id: string; name: string }[] = [];
    s?.querySelectorAll('option').forEach((o) => { const v = o.getAttribute('value') || ''; if (v && v !== '-1') out.push({ id: v, name: (o.textContent || '').trim() }); });
    return out;
  });
  await ictx.close();
  let settled = auctions.filter((a) => { const d = seasonToDate(a.name); return d && d <= TODAY; });
  if (saleDateArg) {
    const t = Date.parse(saleDateArg);
    settled = settled.filter((a) => Math.abs(Date.parse(seasonToDate(a.name)!) - t) <= WINDOW_MS);
  }
  if (auctionArg) settled = settled.filter((a) => a.name.toLowerCase().includes(auctionArg));
  console.log(`[gal:${cfg.seg}] ${auctions.length} auctions (${settled.length} settled${saleDateArg || auctionArg ? ` after --sale-date/--auction filter` : ''}); crawling up to ${maxAuctions}`);
  if (saleDateArg || auctionArg) console.log(`[gal:${cfg.seg}] targeted: ${settled.map((a) => `${a.name} (${a.id} → ${seasonToDate(a.name)})`).join(' · ') || 'NONE — check the filter against the dropdown names above'}`);

  const all: AuctionLot[] = [];
  let done = 0;
  for (const a of settled.slice(0, maxAuctions)) {
    const saleDate = seasonToDate(a.name)!;
    // FRESH context per auction — the pagination postbacks corrupt a reused
    // page's auction-select state, so isolate each auction's crawl.
    const ctx = await browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();
    let cards: RawCard[] = [];
    try {
      await page.goto(`${cfg.host}/Lots/Gallery`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (!await clearCF(page)) throw new Error('CF');
      await page.selectOption('select[name*="Auction"]', a.id);
      // poll until the postback renders SOLD lots (a settled auction) — a fixed
      // wait raced the postback and returned 0 for the slower auctions
      for (let i = 0; i < 18; i++) {
        await page.waitForTimeout(1000);
        cards = await extractCards(page);
        if (cards.some((c) => c.sold)) break; // sold lots up → postback done
      }
      // paginate within THIS context (state can't leak to other auctions now)
      for (let pg = 0; pg < 30; pg++) {
        const next = page.locator('.pager a, [class*="paging"] a, a[href*="__doPostBack"]').filter({ hasText: /^(next|»|>)$/i }).first();
        if (!(await next.count().catch(() => 0))) break;
        const before = cards.length;
        await next.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(2500);
        const more = await extractCards(page);
        const ids = new Set(cards.map((c) => c.id));
        for (const c of more) if (!ids.has(c.id)) cards.push(c);
        if (cards.length === before) break;
      }
    } catch (e) { console.error(`  [gal] ${a.name} failed:`, (e as Error).message.slice(0, 50)); await ctx.close(); continue; }
    await ctx.close();

    const lots = cards.filter((c) => !c.wd).map((c) => {
      const prev = exactDates.get(`${cfg.prefix}-${c.id}`);
      const lot = buildLot(c, prev?.saleDate || saleDate, cfg);
      return lot && prev ? ({ ...lot, saleDateTime: prev.saleDateTime } as AuctionLot) : lot;
    }).filter((x): x is AuctionLot => !!x);
    const wdIds = new Set(cards.filter((c) => c.wd).map((c) => `${cfg.prefix}-${c.id}`));
    all.push(...lots);
    done++;
    console.log(`  [gal] ${a.name} (${a.id}): ${lots.length} sold lots, ${wdIds.size} withdrawn  [running ${all.length}]`);
    if (write) {
      if (lots.length) { const { good } = settledOnly(lots); if (good.length) { const r = writeMergedSegment(cfg.seg, good); console.log(`    → segment ${r.total}`); } }
      const purged = purgeFromSegment(cfg.seg, wdIds);
      if (purged) console.log(`    → purged ${purged} withdrawn ghost rows`);
    }
  }
  await browser.close();

  console.log(`[gal:${cfg.seg}] ${done} auctions, ${all.length} sold lots`);
  const rep = assertInvariants(settledOnly(all).good);
  console.log(`[gal:${cfg.seg}] invariant FATALs: ${rep.fatal.length}`);
  rep.fatal.slice(0, 6).forEach((f) => console.error('  FATAL', f));
  if (dumpPath) {
    const fs = await import('fs');
    fs.writeFileSync(dumpPath, all.map((l) => JSON.stringify(l)).join('\n') + '\n');
    console.log(`[gal] dumped ${all.length} lots → ${dumpPath}`);
  }
  if (!write) console.log('[gal] dry run (pass --write to persist; it writes incrementally per auction)');

  // SILENT-ZERO GUARD (Sep 3 2026). A heal that reads nothing must not report
  // success. The Sep 3 Memory Lane run crawled its one targeted auction for
  // 12.7 min, extracted 0 sold lots, exited 0, and the workflow pushed the
  // segment — the same failure shape that let the Aug 13 run be written off as
  // "done". CF cleared on that run (clearCF would have exited 1), so an empty
  // read means the settled-lot view never surfaced sold cards: the postback
  // pattern moved, or the targeted auction has no settled lots to read. Either
  // way it is a fact to fix, not a success to push. Only guards a TARGETED run
  // (--sale-date / --auction), where finding nothing is by definition wrong;
  // an untargeted sweep may legitimately find every auction already settled.
  // Broadened after the Sep 3 diagnosis: the Aug 13 run logged "106 auctions,
  // 0 sold lots" and was written off as done, and the Sep 3 targeted run did
  // the same with 1 auction. ANY run that opens auctions and reads no sold lot
  // is broken — a settled CreateAuction auction always has sold lots.
  if (done > 0 && all.length === 0) {
    console.error(`::error title=gallery heal read nothing::[gal:${cfg.seg}] opened ${done} settled auction(s) and extracted 0 sold lots. This is the CI signature: from a GitHub Actions address the CF interstitial clears but the gallery serves empty content, so the crawl "succeeds" with nothing. The same auction yields lots from a residential address. Run this heal locally with an R2 token, not on CI.`);
    process.exit(1);
  }
}
main().catch((e) => { console.error('[gal] fatal', e); process.exit(1); });
