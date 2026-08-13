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
import { classifySports, pseudoArtist, readAuth, stampRealizedUsd, stampUpcomingUsd, writeMergedSegment, writeMergedSegmentWithLive, settledOnly, liveOnly, purgeFromSegment } from './lib/sports-crawl';
import { readSegment } from './corpus-io';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const HOUSES: Record<string, { host: string; house: AuctionHouse; seg: string; prefix: string }> = {
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

export async function settle(page: Page, maxMs = 30000): Promise<boolean> {
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

export interface RawLot { price: string; title: string; catLine: string; endLine: string; desc: string; img: string | null; closed: boolean; }

/** parse one lot page (server-rendered after CF clears). No named arrow-consts
 *  inside evaluate — tsx/esbuild would inject an undefined __name helper. */
export async function extract(page: Page): Promise<RawLot | null> {
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

export function buildLot(raw: RawLot, id: number, cfg: { host: string; house: AuctionHouse; prefix: string }): AuctionLot | null {
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

// ── LIVE leg: the current auction is /Lots/Gallery's DEFAULT view (query
// params are ignored; other auctions need the ctl00$Auction postback, which we
// don't need here). Cards carry "CURRENT BID $X" inline, so ONE gallery nav —
// not 250 per-lot navs — snapshots the whole live sale. The auction's close
// date comes from a single sample lot page's "End:" line. Cards showing
// "SOLD FOR" mid-sale are staggered soft-closes → parsed as settled sales via
// buildLot (same prefix-{itemid} id retires any prior upcoming row).
interface LiveCard { id: string; title: string; bid: string; sold: string; img: string | null; wd?: boolean; }

async function clearCF(page: Page, maxMs = 30000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await page.evaluate(() => !/just a moment/i.test(document.title)).catch(() => false)) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function extractLiveCards(page: Page): Promise<LiveCard[]> {
  // no named fns inside evaluate — the tsx/esbuild __name trap
  return page.evaluate(() => {
    const byId = new Map<string, { title: string; card: string; img: string | null }>();
    document.querySelectorAll('a[href*="bidplace.aspx?itemid="]').forEach((a) => {
      const href = (a as HTMLAnchorElement).href;
      const id = (href.match(/itemid=(\d+)/) || [])[1];
      if (!id) return;
      // walk up ONLY while the element still belongs to THIS lot's card — the
      // moment a parent holds a second itemid we've crossed into the grid, and
      // any "sold for"/"current bid" found there is a NEIGHBOR's price. (A
      // withdrawn card has no price of its own; the old unbounded walk climbed
      // to the grid and stole one — 27 Lelands lots "sold" at the same $3.1M.)
      let el: Element | null = a; let card_el: Element | null = a;
      for (let i = 0; i < 6 && el; i++) {
        const ids = new Set<string>();
        el.querySelectorAll('a[href*="bidplace.aspx?itemid="]').forEach((x) => {
          const m = (x.getAttribute('href') || '').match(/itemid=(\d+)/);
          if (m) ids.add(m[1]);
        });
        if (ids.size > 1) break;
        card_el = el;
        if (/sold for|current bid/i.test(el.textContent || '')) break;
        el = el.parentElement;
      }
      const card = (card_el?.textContent || '').replace(/\s+/g, ' ').trim();
      const img = (card_el?.querySelector('img') as HTMLImageElement | null)?.getAttribute('src') || null;
      // a card has 2+ anchors for the same itemid (image + title text); prefer
      // the anchor's OWN text as the title — the card blob leads with ribbon
      // labels ("BEST OF THE BEST") and the boxed lot number
      const own = (a.textContent || '').replace(/\s+/g, ' ').trim();
      const prev = byId.get(id) || { title: '', card, img };
      if (own.length > prev.title.length && !/^\$|current bid|sold for/i.test(own)) prev.title = own;
      if (!prev.img && img) prev.img = img;
      if (card.length > prev.card.length) prev.card = card;
      byId.set(id, prev);
    });
    const out: LiveCard[] = [];
    byId.forEach((v, id) => {
      const txt = v.card;
      const wd = /\bwithdrawn\b/i.test(txt); // neither live nor a sale — reported so any ghost row gets purged
      const bid = (txt.match(/current bid[:\s]*\$[\d,]+(?:\.\d+)?/i) || [])[0] || '';
      const sold = (txt.match(/sold for\s*\$[\d,]+(?:\.\d+)?/i) || [])[0] || '';
      const fallback = txt.replace(/sold for\s*\$[\d,.]+/i, '').replace(/current bid.*/i, '').trim();
      const title = (v.title || fallback)
        .replace(/^(best of the best|highlight|featured|premier)\s+/i, '')
        .replace(/^\d{1,4}\s+(?=\D)/, '') // the boxed lot number
        .trim().slice(0, 200);
      out.push({ id, title, bid, sold, img: v.img, wd });
    });
    return out;
  }).catch(() => [] as LiveCard[]);
}

export function buildLiveLot(c: LiveCard, saleDate: string, saleDateTime: string | null, cfg: { host: string; house: AuctionHouse; prefix: string }): AuctionLot | null {
  const m = c.bid.replace(/,/g, '').match(/\$([0-9]+)/);
  const currentBid = m ? parseInt(m[1], 10) : 0;
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
    auctionHouse: cfg.house, saleName: null, saleDate, saleDateTime, lotNumber: null,
    ...stampUpcomingUsd(saleDate),
    currentBid,
    gradeLabel: auth.grade, authCert: auth.marks.length ? auth.marks.join(' · ') : null,
    authConfidence: auth.confidence, subCat: cat, status: 'upcoming',
    firstSeen: TODAY_ISO,
    url: `${cfg.host}/bids/bidplace.aspx?itemid=${c.id}`,
  } as unknown as AuctionLot;
}

/** "End: 8/15/2026 10:00 PM EST" → ISO-ish saleDateTime (kept null on a bare date). */
function endToDateTime(endLine: string): string | null {
  const m = endLine.match(/End\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*(E[SD]T)?/i);
  if (!m) return null;
  let h = parseInt(m[4], 10) % 12;
  if (/pm/i.test(m[6])) h += 12;
  const off = m[7] && /edt/i.test(m[7]) ? '-04:00' : '-05:00';
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T${String(h).padStart(2, '0')}:${m[5]}:00${off}`;
}

/** One gallery page in a THROWAWAY context (CF grants each context one clean
 *  nav — reusing a context for a second nav gets re-challenged). */
async function galleryPage(browser: Browser, url: string): Promise<{ cards: LiveCard[]; ok: boolean }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctx = await browser.newContext({ userAgent: UA });
    try {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (!(await clearCF(page))) continue;
      let cards: LiveCard[] = [];
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(1000);
        cards = await extractLiveCards(page);
        if (cards.length) break;
      }
      return { cards, ok: true };
    } catch { /* retry in a fresh context */ } finally { await ctx.close(); }
  }
  return { cards: [], ok: false };
}

async function crawlLive(browser: Browser, cfg: { host: string; house: AuctionHouse; seg: string; prefix: string }): Promise<{ live: AuctionLot[]; soldNow: AuctionLot[]; resolved: AuctionLot[]; ok: boolean; wdIds: Set<string> }> {
  // the gallery paginates via plain GET ?page=N (bootstrap pager) — walk pages
  // in fresh contexts until a page adds no new ids
  const cards: LiveCard[] = [];
  const seen = new Set<string>();
  let ok = false;
  for (let pg = 1; pg <= 30; pg++) {
    const r = await galleryPage(browser, `${cfg.host}/Lots/Gallery?page=${pg}`);
    if (pg === 1) ok = r.ok;
    if (!r.ok) break;
    let fresh = 0;
    for (const c of r.cards) if (!seen.has(c.id)) { seen.add(c.id); cards.push(c); fresh++; }
    if (!fresh) break;
  }
  if (!ok) return { live: [], soldNow: [], resolved: [], ok: false, wdIds: new Set<string>() };

  const liveCards = cards.filter(c => c.bid && !c.sold && !c.wd);
  const soldCards = cards.filter(c => c.sold && !c.wd);
  const wdIds = new Set(cards.filter(c => c.wd).map(c => `${cfg.prefix}-${c.id}`));
  console.log(`[CA:${cfg.seg}] gallery: ${cards.length} cards (${liveCards.length} live, ${soldCards.length} soft-closed sold, ${wdIds.size} withdrawn)`);

  // one sample lot page gives the auction's End date (shared by the sale)
  let saleDate: string | null = null, saleDateTime: string | null = null;
  const sample = liveCards[0] || soldCards[0];
  if (sample) {
    const r = await nav(browser, `${cfg.host}/bids/bidplace.aspx?itemid=${sample.id}`);
    if (r.ok && r.raw?.endLine) { saleDate = endToDate(r.raw.endLine); saleDateTime = endToDateTime(r.raw.endLine); }
  }
  if (!saleDate) {
    if (liveCards.length) console.log(`[CA:${cfg.seg}] live: no End date readable — skipping ${liveCards.length} live cards this pass`);
    return { live: [], soldNow: [], resolved: [], ok, wdIds };
  }

  const live = saleDate >= TODAY_ISO
    ? liveCards.map(c => buildLiveLot(c, saleDate!, saleDateTime, cfg)).filter((x): x is AuctionLot => !!x)
    : [];
  // mid-sale soft-closes are settled facts; date them like buildLot would
  // (true close ≤ auction end; clamp future to today)
  const soldDate = saleDate <= TODAY_ISO ? saleDate : TODAY_ISO;
  const soldNow = soldCards.map(c => {
    const sm = c.sold.replace(/,/g, '').match(/\$([0-9]+)/);
    const soldNum = sm ? parseInt(sm[1], 10) : 0;
    if (!soldNum) return null;
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
      auctionHouse: cfg.house, saleName: null, saleDate: soldDate, lotNumber: null,
      ...stampRealizedUsd(soldNum, soldDate),
      gradeLabel: auth.grade, authCert: auth.marks.length ? auth.marks.join(' · ') : null,
      authConfidence: auth.confidence, subCat: cat, status: 'sold',
      url: `${cfg.host}/bids/bidplace.aspx?itemid=${c.id}`,
    } as unknown as AuctionLot;
  }).filter((x): x is AuctionLot => !!x);

  // resolve: prior upcoming ids gone from tonight's gallery → per-lot re-read
  // (their pages flip to "SOLD FOR" once settled; buildLot handles the rest)
  const prevUpcoming = (readSegment(cfg.seg) as unknown as AuctionLot[]).filter(l => (l as { status?: string }).status === 'upcoming');
  const nowIds = new Set(cards.map(c => `${cfg.prefix}-${c.id}`));
  const gone = prevUpcoming.filter(l => l.id.startsWith(`${cfg.prefix}-`) && !nowIds.has(l.id));
  const resolved: AuctionLot[] = [];
  for (const prev of gone) {
    const rawId = parseInt(prev.id.slice(cfg.prefix.length + 1), 10);
    if (!rawId) continue;
    const r = await nav(browser, `${cfg.host}/bids/bidplace.aspx?itemid=${rawId}`);
    if (!r.ok || !r.raw) continue;
    const lot = buildLot(r.raw, rawId, cfg);
    if (lot) resolved.push(lot);
  }
  if (gone.length) console.log(`[CA:${cfg.seg}] resolve: ${gone.length} closed upcoming ids → ${resolved.length} settled sales`);
  return { live, soldNow, resolved, ok, wdIds };
}

async function main() {
  const houseKey = argStr('house', 'lelands');
  const cfg = HOUSES[houseKey];
  if (!cfg) { console.error(`[CA] unknown --house ${houseKey} (lelands|memorylane|lotg)`); process.exit(1); }
  const liveMode = process.argv.includes('--live');
  const windowGiven = process.argv.includes('--start') || process.argv.includes('--end');
  const start = argNum('start', 131700);
  const end = argNum('end', 131760);

  const browser = await open();
  const lots: AuctionLot[] = [];
  let liveLots: AuctionLot[] = [];
  let liveOk = false;
  let wdIds = new Set<string>();
  let sold = 0, miss = 0, walled = 0;
  try {
    // --live without an explicit window skips the id sweep: the sold windows
    // are harvested, and new sold history arrives via gallery soft-closes +
    // the resolve pass over closed upcoming ids.
    if (!liveMode || windowGiven) {
      console.log(`[CA:${houseKey}] itemid ${start}..${end} (headless CF)`);
      for (let id = start; id <= end; id++) {
        const r = await nav(browser, `${cfg.host}/bids/bidplace.aspx?itemid=${id}`);
        if (r.challenged) { walled++; continue; }
        if (!r.ok || !r.raw) { miss++; continue; }
        const lot = buildLot(r.raw, id, cfg);
        if (lot) { lots.push(lot); sold++; } else miss++;
        if ((id - start) % 20 === 0 && id > start) console.log(`  …${id} (${sold} sold, ${miss} skip, ${walled} walled)`);
      }
    }
    if (liveMode) {
      const r = await crawlLive(browser, cfg);
      liveOk = r.ok;
      lots.push(...r.soldNow, ...r.resolved);
      const lg = liveOnly(r.live);
      if (lg.dropped) console.log(`[CA:${houseKey}] dropped ${lg.dropped} malformed live lots`);
      liveLots = lg.good;
      wdIds = r.wdIds;
      console.log(`[CA:${houseKey}] live: ${liveLots.length} upcoming, ${r.soldNow.length} gallery-sold, ${r.resolved.length} resolved, ${wdIds.size} withdrawn (${liveOk ? 'ok' : 'CF-walled — keeping prior snapshot'})`);
    }
  } finally { await browser.close(); }
  console.log(`[CA:${houseKey}] ${sold} sold, ${miss} skipped, ${walled} CF-walled`);

  const report = assertInvariants(lots.concat(liveLots));
  console.log(`[CA:${houseKey}] invariant FATALs: ${report.fatal.length} | warns: ${report.warn.length}`);
  report.fatal.slice(0, 8).forEach(f => console.error('  FATAL', f));
  const byCat: Record<string, number> = {};
  for (const l of lots) { const c = (l as { subCat?: string }).subCat || '?'; byCat[c] = (byCat[c] || 0) + 1; }
  console.log(`[CA:${houseKey}] by category:`, byCat);

  if (process.argv.includes('--write')) {
    const { good, dropped } = settledOnly(lots);
    if (dropped) console.log(`[CA:${houseKey}] dropped ${dropped} unsettled/future-dated lots`);
    const rep = assertInvariants(good.concat(liveLots));
    if (rep.fatal.length) { console.error(`[CA] refusing to write: ${rep.fatal.length} FATALs remain after filtering`); rep.fatal.slice(0, 5).forEach(f => console.error('  ', f)); process.exit(1); }
    const res = liveMode
      ? writeMergedSegmentWithLive(cfg.seg, good, liveLots, liveOk)
      : { ...writeMergedSegment(cfg.seg, good), upcoming: undefined as number | undefined };
    const purged = purgeFromSegment(cfg.seg, wdIds);
    if (purged) console.log(`[CA:${houseKey}] purged ${purged} withdrawn ghost rows`);
    console.log(`[CA:${houseKey}] merged into segment '${cfg.seg}': +${res.added} new, ${res.total} total${res.upcoming !== undefined ? `, ${res.upcoming} upcoming` : ''}.`);
  } else {
    const s = lots[0];
    if (s) console.log('[CA] sample:', JSON.stringify({ id: s.id, artist: s.artist, title: s.title.slice(0, 55), saleDate: s.saleDate, priceUsd: (s as { priceUsd?: number }).priceUsd, cert: (s as { authCert?: string }).authCert }, null, 0));
    const u = liveLots[0];
    if (u) console.log('[CA] live sample:', JSON.stringify({ id: u.id, title: u.title.slice(0, 55), saleDate: u.saleDate, currentBid: (u as { currentBid?: number }).currentBid }, null, 0));
    console.log('[CA] dry run (pass --write to persist)');
  }
}
// run main() ONLY when executed directly — importing extract/buildLot/HOUSES
// (backfill-createauction) must NOT spawn a competing crawl.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('[CA] fatal', e); process.exit(1); });
}
