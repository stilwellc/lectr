// CreateAuction headless crawler — Lelands + Memory Lane + Love of the Game.
// All three run the SAME CreateAuction.com engine (ASP.NET/Telerik) behind a
// Cloudflare JS challenge, so — exactly like RR Auction — a real browser is
// required to clear CF. Modeled on resolve-rrauction.ts: a throwaway context
// per page (CF grants each context one clean nav), settle until the challenge
// clears, then parse the server-rendered lot. Each house writes+MERGES its own
// isolated segment. Run:
//   RAY_SKIP_MAIN=1 npx tsx scripts/crawl-createauction.ts --house lelands --start 131700 --end 131820 [--write]
import { chromium, type Browser, type Page } from 'playwright-core';
import type { AuctionLot, LotCategory, AuctionHouse } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { classifySports, pseudoArtist, readAuth, stampRealizedUsd, writeMergedSegment, settledOnly } from './lib/sports-crawl';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const HOUSES: Record<string, { host: string; house: AuctionHouse; seg: string; prefix: string }> = {
  lelands: { host: 'https://auction.lelands.com', house: 'Lelands', seg: 'lelands', prefix: 'lelands' },
  memorylane: { host: 'https://bid.memorylaneinc.com', house: 'Memory Lane', seg: 'memorylane', prefix: 'memorylane' },
  lotg: { host: 'https://bid.loveofthegameauctions.com', house: 'Love of the Game', seg: 'lotg', prefix: 'lotg' },
};

function argStr(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function argNum(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : def;
}

async function open(): Promise<Browser> {
  return chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
}

async function settle(page: Page, maxMs = 30000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const state = await page.evaluate(() => ({
      challenged: /just a moment/i.test(document.title),
      ready: !!document.querySelector('#lot-desc') || !!document.querySelector('#MainContent_currentBidBox'),
    })).catch(() => ({ challenged: true, ready: false }));
    if (state.ready) return true;
    if (!state.challenged && Date.now() - t0 > 8000) return false;
    await page.waitForTimeout(1000);
  }
  return false;
}

interface RawLot { price: string; title: string; catLine: string; endLine: string; desc: string; img: string | null; closed: boolean; }

/** parse one lot page (server-rendered after CF clears). No named arrow-consts
 *  inside evaluate — tsx/esbuild would inject an undefined __name helper. */
async function extract(page: Page): Promise<RawLot | null> {
  // NO named functions / named const-arrows inside evaluate — tsx/esbuild would
  // inject an undefined __name helper (mirrors resolve-rrauction's style).
  return page.evaluate(() => {
    const price = ((document.querySelector('#MainContent_currentBidBox') as HTMLElement | null)?.textContent || '').replace(/\s+/g, ' ').trim();
    const desc = ((document.querySelector('#lot-desc') as HTMLElement | null)?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 3000);
    const lines = (document.body.innerText || '').split('\n');
    let title = '', catLine = '', endLine = '';
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].replace(/\s+/g, ' ').trim();
      if (!title && /^Lot\s*#/i.test(l) && l.length > 8) title = l;
      if (!catLine && /^Category\s*:/i.test(l)) catLine = l;
      // the settle line is "Start: M/D/YYYY … End: M/D/YYYY" — match on End: + a date
      if (!endLine && /End\s*:/i.test(l) && /\d{1,2}\/\d{1,2}\/\d{4}/.test(l)) endLine = l;
    }
    if (!title) {
      const hs: string[] = [];
      document.querySelectorAll('h1,h2,h3').forEach((e) => {
        const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && !/^(search|auction|menu|login|lelands|memory lane)$/i.test(t)) hs.push(t);
      });
      hs.sort((a, b) => b.length - a.length);
      title = hs[0] || '';
    }
    const img = (document.querySelector('#lot-desc img, img[src*="images_items"]') as HTMLImageElement | null)?.src || null;
    const clock = ((document.querySelector('#MainContent_clock1') as HTMLElement | null)?.textContent || '');
    const closed = /auction closed|lot closed|bidding (has )?ended|auction has ended/i.test(clock + ' ' + document.body.innerText.slice(0, 4000));
    return { price, title, catLine, endLine, desc, img, closed };
  }).catch(() => null);
}

async function nav(browser: Browser, url: string): Promise<{ ok: boolean; raw: RawLot | null; challenged: boolean }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctx = await browser.newContext({ userAgent: UA });
    try {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (await settle(page)) return { ok: true, raw: await extract(page), challenged: false };
      const challenged = /just a moment/i.test(await page.title().catch(() => ''));
      if (!challenged) return { ok: false, raw: null, challenged: false };
    } finally { await ctx.close(); }
  }
  return { ok: false, raw: null, challenged: true };
}

// CreateAuction prints "Start: M/D/YYYY … End: M/D/YYYY". We take the lot's END
// (the settle date). US M/D/Y → ISO. A lot whose auction end is still in the
// FUTURE isn't settled history yet (even if it shows a soft-close "SOLD") — the
// caller skips it, same spirit as "a live bid is not a sale".
function endToDate(endLine: string): string | null {
  // the End: date is the SECOND date on the "Start … End …" line
  const dates = Array.from(endLine.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g));
  const m = dates.length ? dates[dates.length - 1] : null;
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; // YYYY-MM-DD
}
const TODAY_ISO = new Date().toISOString().slice(0, 10);
function moneyOf(s: string): number {
  const m = s.replace(/,/g, '').match(/\$\s*([0-9]+)(?:\.\d+)?/);
  return m ? parseInt(m[1], 10) : 0;
}

function buildLot(raw: RawLot, id: number, cfg: { host: string; house: AuctionHouse; prefix: string }): AuctionLot | null {
  // only SOLD lots (class alert-success renders "SOLD FOR $X")
  if (!/sold\s*for/i.test(raw.price)) return null;
  const soldNum = moneyOf(raw.price);
  if (!soldNum) return null;
  const title = raw.title.replace(/^Lot\s*#?\s*[\w-]+\s*[:.\-]\s*/i, '').trim() || raw.title.trim();
  if (!title) return null;
  let saleDate = endToDate(raw.endLine);
  if (!saleDate) return null;
  // A future end date is settled history ONLY if the lot actually closed (a
  // staggered soft-close on a sold lot) — clamp its date to today, the real
  // close. Future + NOT closed = a live auction, not a sale → skip.
  if (saleDate > TODAY_ISO) {
    if (!raw.closed) return null;
    saleDate = TODAY_ISO;
  }
  const catLabel = raw.catLine.replace(/^Category\s*:/i, '').trim();
  const cat = classifySports(catLabel, title);
  const auth = readAuth(cat, title, raw.desc);
  return {
    id: `${cfg.prefix}-${id}`,
    artist: pseudoArtist(cat),
    title, year: null, medium: null, dimensions: null,
    description: raw.desc ? raw.desc.slice(0, 1200) : null,
    platform: null, category: 'object' as LotCategory,
    imageUrl: raw.img,
    auctionHouse: cfg.house,
    saleName: null, saleDate, lotNumber: null,
    ...stampRealizedUsd(soldNum, saleDate),
    gradeLabel: auth.grade,
    authCert: auth.marks.length ? auth.marks.join(' · ') : null,
    authConfidence: auth.confidence,
    subCat: cat,
    status: 'sold', url: `${cfg.host}/bids/bidplace.aspx?itemid=${id}`,
  } as unknown as AuctionLot;
}

async function main() {
  const houseKey = argStr('house', 'lelands');
  const cfg = HOUSES[houseKey];
  if (!cfg) { console.error(`[CA] unknown --house ${houseKey} (lelands|memorylane|lotg)`); process.exit(1); }
  const start = argNum('start', 131700);
  const end = argNum('end', 131760);
  console.log(`[CA:${houseKey}] itemid ${start}..${end} (headless CF)`);

  const browser = await open();
  const lots: AuctionLot[] = [];
  let sold = 0, miss = 0, walled = 0;
  try {
    for (let id = start; id <= end; id++) {
      const r = await nav(browser, `${cfg.host}/bids/bidplace.aspx?itemid=${id}`);
      if (r.challenged) { walled++; continue; }
      if (!r.ok || !r.raw) { miss++; continue; }
      const lot = buildLot(r.raw, id, cfg);
      if (lot) { lots.push(lot); sold++; } else miss++;
      if ((id - start) % 20 === 0 && id > start) console.log(`  …${id} (${sold} sold, ${miss} skip, ${walled} walled)`);
    }
  } finally { await browser.close(); }
  console.log(`[CA:${houseKey}] ${sold} sold, ${miss} skipped, ${walled} CF-walled`);

  const report = assertInvariants(lots);
  console.log(`[CA:${houseKey}] invariant FATALs: ${report.fatal.length} | warns: ${report.warn.length}`);
  report.fatal.slice(0, 8).forEach(f => console.error('  FATAL', f));
  const byCat: Record<string, number> = {};
  for (const l of lots) { const c = (l as { subCat?: string }).subCat || '?'; byCat[c] = (byCat[c] || 0) + 1; }
  console.log(`[CA:${houseKey}] by category:`, byCat);

  if (process.argv.includes('--write')) {
    const { good, dropped } = settledOnly(lots);
    if (dropped) console.log(`[CA:${houseKey}] dropped ${dropped} unsettled/future-dated lots`);
    const rep = assertInvariants(good);
    if (rep.fatal.length) { console.error(`[CA] refusing to write: ${rep.fatal.length} FATALs remain after filtering`); rep.fatal.slice(0, 5).forEach(f => console.error('  ', f)); process.exit(1); }
    const res = writeMergedSegment(cfg.seg, good);
    console.log(`[CA:${houseKey}] merged into segment '${cfg.seg}': +${res.added} new, ${res.total} total.`);
  } else {
    const s = lots[0];
    if (s) console.log('[CA] sample:', JSON.stringify({ id: s.id, artist: s.artist, title: s.title.slice(0, 55), saleDate: s.saleDate, priceUsd: (s as { priceUsd?: number }).priceUsd, cert: (s as { authCert?: string }).authCert }, null, 0));
    console.log('[CA] dry run (pass --write to persist)');
  }
}
main().catch(e => { console.error('[CA] fatal', e); process.exit(1); });
