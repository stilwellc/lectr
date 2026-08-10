// Lelands (CreateAuction) GALLERY backfill — the efficient bulk path for the
// full 25-yr archive. Per-lot headless is a non-starter (CF challenge each);
// the gallery lists a whole auction's lots WITH sold prices inline, and — the
// key find — the WebForms auction-select postback SURVIVES Cloudflare, so one
// CF-clear drives the dropdown through all ~132 auctions. Extends to Memory
// Lane / LOTG (same engine) via --house. Run:
//   RAY_SKIP_MAIN=1 npx tsx scripts/crawl-lelands-gallery.ts --house lelands [--write] [--max-auctions N]
import { chromium, type Browser, type Page } from 'playwright-core';
import type { AuctionLot, LotCategory, AuctionHouse } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { classifySports, pseudoArtist, readAuth, stampRealizedUsd, seasonToDate, writeMergedSegment, settledOnly, installCrashGuard } from './lib/sports-crawl';

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

interface RawCard { id: string; title: string; sold: string; img: string | null; }
async function extractCards(page: Page): Promise<RawCard[]> {
  return page.evaluate(() => {
    const seen = new Set<string>(); const out: RawCard[] = [];
    document.querySelectorAll('a[href*="bidplace.aspx?itemid="]').forEach((a) => {
      const href = (a as HTMLAnchorElement).href;
      const id = (href.match(/itemid=(\d+)/) || [])[1];
      if (!id || seen.has(id)) return; seen.add(id);
      let el: Element | null = a;
      for (let i = 0; i < 5 && el; i++) { if (/sold for|current bid/i.test(el.textContent || '')) break; el = el.parentElement; }
      const txt = (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const sold = (txt.match(/sold for\s*\$[\d,]+(?:\.\d+)?/i) || [])[0] || '';
      const img = (el?.querySelector('img') as HTMLImageElement | null)?.getAttribute('src') || null;
      out.push({ id, title: txt.replace(/sold for\s*\$[\d,.]+/i, '').replace(/current bid.*/i, '').trim().slice(0, 200), sold, img });
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
  const settled = auctions.filter((a) => { const d = seasonToDate(a.name); return d && d <= TODAY; });
  console.log(`[gal:${cfg.seg}] ${auctions.length} auctions (${settled.length} settled); crawling up to ${maxAuctions}`);

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

    const lots = cards.map((c) => buildLot(c, saleDate, cfg)).filter((x): x is AuctionLot => !!x);
    all.push(...lots);
    done++;
    console.log(`  [gal] ${a.name} (${a.id}): ${lots.length} sold lots  [running ${all.length}]`);
    if (write && lots.length) { const { good } = settledOnly(lots); if (good.length) { const r = writeMergedSegment(cfg.seg, good); console.log(`    → segment ${r.total}`); } }
  }
  await browser.close();

  console.log(`[gal:${cfg.seg}] ${done} auctions, ${all.length} sold lots`);
  const rep = assertInvariants(settledOnly(all).good);
  console.log(`[gal:${cfg.seg}] invariant FATALs: ${rep.fatal.length}`);
  rep.fatal.slice(0, 6).forEach((f) => console.error('  FATAL', f));
  if (!write) console.log('[gal] dry run (pass --write to persist; it writes incrementally per auction)');
}
main().catch((e) => { console.error('[gal] fatal', e); process.exit(1); });
