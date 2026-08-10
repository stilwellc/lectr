// CreateAuction FULL-DEPTH backfill — parallel headless itemid enumeration.
// The gallery caps at 250/auction and curl is 403 (no cf cookie), so full depth
// is per-lot over the whole itemid range. Speedup = N PERSISTENT CF-cleared
// contexts (each cleared once, then reused for sequential gotos — verified no
// re-challenge), pulling from a shared id queue. Gaps fail fast. Run:
//   RAY_SKIP_MAIN=1 npx tsx scripts/backfill-createauction.ts --house lelands --start 1 --end 136000 --contexts 8 --write
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { AuctionLot } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { writeMergedSegment, settledOnly, installCrashGuard } from './lib/sports-crawl';
import { HOUSES, extract, buildLot } from './crawl-createauction';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const argStr = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const argNum = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : d; };

// fast settle: content up → true; challenge → false+challenged; empty (a gap)
// bails in ~2.5s instead of the full window.
async function fastSettle(page: Page): Promise<'ok' | 'challenged' | 'empty'> {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const s = await page.evaluate(() => ({
      ch: /just a moment/i.test(document.title),
      ready: !!document.querySelector('#lot-desc') || !!document.querySelector('#MainContent_currentBidBox'),
      len: document.body.innerText.length,
    })).catch(() => ({ ch: true, ready: false, len: 0 }));
    if (s.ready) return 'ok';
    if (!s.ch && Date.now() - t0 > 2500) return 'empty'; // page up, no lot → gap
    await page.waitForTimeout(500);
  }
  return 'challenged';
}

async function clearContext(browser: Browser, host: string): Promise<{ ctx: BrowserContext; page: Page } | null> {
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  try {
    await page.goto(`${host}/bids/bidplace.aspx?itemid=1`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      if (await page.evaluate(() => !/just a moment/i.test(document.title)).catch(() => false)) return { ctx, page };
      await page.waitForTimeout(1000);
    }
  } catch { /* fall through */ }
  await ctx.close();
  return null;
}

async function main() {
  const write = process.argv.includes('--write');
  if (write) installCrashGuard('CA-BF');
  const cfg = HOUSES[argStr('house', 'lelands')];
  if (!cfg) { console.error('unknown --house'); process.exit(1); }
  const start = argNum('start', 1);
  const end = argNum('end', 136000);
  const nCtx = argNum('contexts', 8);
  console.log(`[ca-bf:${cfg.seg}] itemid ${start}..${end}, ${nCtx} parallel contexts`);

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  let nextId = start, sold = 0, gaps = 0, total = 0, processed = 0;
  const buffer: AuctionLot[] = [];
  const startedAt = Date.now();
  const ticker = setInterval(() => {
    const mins = (Date.now() - startedAt) / 60000;
    console.log(`  [ca-bf:${cfg.seg}] ${processed} processed · ${sold} sold · ${gaps} gaps · segment ${total} · ${(processed / mins).toFixed(0)}/min`);
  }, 30000);

  async function flush() {
    if (!write || !buffer.length) { buffer.length = 0; return; }
    const { good } = settledOnly(buffer.splice(0));
    const clean = good.filter((l) => assertInvariants([l]).fatal.length === 0);
    if (clean.length) { const r = writeMergedSegment(cfg.seg, clean); total = r.total; }
  }

  async function worker(w: number) {
    let held = await clearContext(browser, cfg.host);
    while (nextId <= end) {
      const id = nextId++;
      if (!held) { held = await clearContext(browser, cfg.host); if (!held) { await new Promise(r => setTimeout(r, 3000)); continue; } }
      try {
        await held.page.goto(`${cfg.host}/bids/bidplace.aspx?itemid=${id}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const st = await fastSettle(held.page);
        if (st === 'challenged') { await held.ctx.close(); held = null; nextId = id; continue; } // re-clear, retry this id
        if (st === 'empty') { gaps++; continue; }
        const raw = await extract(held.page);
        if (raw) { const lot = buildLot(raw, id, cfg); if (lot) { buffer.push(lot); sold++; } }
      } catch { /* transient — skip id */ }
      processed++;
      if (buffer.length >= 400) await flush();
    }
    if (held) await held.ctx.close();
  }

  await Promise.all(Array.from({ length: nCtx }, (_, w) => worker(w)));
  await flush();
  clearInterval(ticker);
  await browser.close();
  console.log(`[ca-bf:${cfg.seg}] DONE: ${sold} sold, ${gaps} gaps, segment ${total}`);
}
main().catch((e) => { console.error('[ca-bf] fatal', e); process.exit(1); });
