// NFL Auction crawler — GAME-USED lots only (Collin, Aug 24 2026), from the
// league's official charity auction at nflauction.nfl.com (Commerce Dynamics
// iSynApp platform). Plain curl 200s with a real-Chrome UA, and the listing
// endpoint doubles as a JSON API with `viewType=api`:
//
//   /iSynApp/allAuction.action?sid=1100783&viewType=api
//     &qMode=open|closed &query=<tokens> &sort=… &rc=<page size> &rs=<offset>
//
// Items carry id/title(truncated ~48ch)/currentBid/bidCount/reserveAmt/
// teamName/closeTime(GMT)/closeTimeClean(ET)/images/type('bid'|bin). The FULL
// title + description live on the lot page's og: meta tags — and NFL titles
// carry the photo-match language readAuth's game-used doctrine gate needs
// ("… Photo Matched"). Charity house: NO estimates, NO buyer's premium — a
// closed lot's final bid IS the all-in realized price when the reserve was
// met. BIN ("binitems") is fixed-price retail → excluded (auctions-only
// doctrine). Inclusion is decided on the FULL title: /game[-\s]?(used|worn|
// issued)/i — the server `query` only nominates candidates.
//
// Run: RAY_SKIP_MAIN=1 npx tsx scripts/crawl-nflauction.ts --live [--write]
//      [--closed-pages 30] [--delay 150]
//
// --idwalk: the DEEP archive. The listing API windows at ~1 year, but ENDED
// lot pages live on individually (any slug; FinalStatus=Y; the final bid is
// SERVER-rendered). scripts/data/nflauction-wayback-ids.csv holds every real
// lot id recoverable from the Wayback CDX index (31k ids, 2013→today) with
// its first-capture date; the walk fetches each unknown id on the LIVE site
// and keeps finalized game-used lots. saleDate for pre-window lots is the
// first-capture month (day 15) — the same month-grade approximation the
// corpus already accepts from seasonToDate ("2018 Spring" catalogs); ids the
// windowed backfill already settled (exact closeTime) are skipped, so exact
// dates always win.
import type { AuctionLot, LotCategory } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import {
  getHtml, decodeHtml, classifySports, pseudoArtist, readAuth,
  stampRealizedUsd, stampUpcomingUsd, writeMergedSegment,
  writeMergedSegmentWithLive, settledOnly, liveOnly, installCrashGuard,
  REAL_UA, mapPool, type SportsCategory,
} from './lib/sports-crawl';
import { readSegment } from './corpus-io';
import { reportLegHealth, reportAndExit } from './lib/leg-health';
import { saleDayOf } from './lib/sale-day';

const HOST = 'https://nflauction.nfl.com';
const SID = '1100783';
const TODAY = new Date().toISOString().slice(0, 10);
const GAME_USED_RE = /game[-\s]?(used|worn|issued)/i;
/** the server-side nominations — fuzzy OR match; the regex above decides */
const QUERIES = ['game used', 'game worn', 'game issued'];
const PAGE = 100;

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : def;
}

interface ApiItem {
  id: number; title: string; url: string;
  currentBid: string; binAmt: string; bidCount: number;
  teamName?: string; causeName?: string; reserveAmt: string;
  closeTime: string;       // "Sep 16, 2026, 2:02:00 AM" — GMT
  imgFull?: string; imgMedium?: string; imgThumb?: string;
  type?: string;           // 'bid' | bin variants
  totalSecondsLeft?: number;
}

/** API call accounting — a failed call logs its status + body snippet (the
 *  MLB config of this platform started walling CI runners Sep 20 2026 with
 *  no trace in the log; this house shares the platform). */
const API_STATS = { calls: 0, ok: 0, fail: 0, lastStatus: '', lastSnippet: '' };
let apiFailLogged = 0;
async function getJson(url: string, retries = 2): Promise<{ items?: ApiItem[] } | null> {
  API_STATS.calls++;
  const fail = (status: string, body: string) => {
    API_STATS.fail++; API_STATS.lastStatus = status;
    API_STATS.lastSnippet = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (apiFailLogged++ < 6) console.warn(`[NFLAuction] API FAIL ${status} ${url.replace(HOST, '')} — body: ${API_STATS.lastSnippet || '(empty)'}`);
  };
  for (let a = 0; a <= retries; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': REAL_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      if (!res.ok) { fail(`HTTP ${res.status}`, text); return null; }
      try { const j = JSON.parse(text); API_STATS.ok++; return j; } catch { fail(`HTTP ${res.status} (non-JSON body)`, text); return null; }
    } catch (e) {
      if (a < retries) await new Promise(r => setTimeout(r, 800 * (a + 1)));
      else fail(`network ${(e as Error)?.message || e}`, '');
    }
  }
  return null;
}

const money = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return isFinite(n) && n > 0 ? n : null;
};

/** closeTime is GMT ("Sep 16, 2026, 2:02:00 AM" — verified +4h vs the ET
 *  closeTimeClean). → ISO UTC or null. */
function closeIso(it: ApiItem): string | null {
  const t = Date.parse(`${it.closeTime} UTC`);
  return isNaN(t) ? null : new Date(t).toISOString();
}

/** page through one query in one mode until a short page or the cap */
async function pageThrough(qMode: 'open' | 'closed', query: string, maxPages: number, delayMs: number): Promise<ApiItem[]> {
  const out: ApiItem[] = [];
  for (let p = 0; p < maxPages; p++) {
    const url = `${HOST}/iSynApp/allAuction.action?sid=${SID}&viewType=api&qMode=${qMode}` +
      `&query=${encodeURIComponent(query)}&sort=aucend_desc&rc=${PAGE}&rs=${p * PAGE}`;
    const d = await getJson(url);
    const items = d?.items || [];
    out.push(...items);
    if (items.length < PAGE) break;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return out;
}

/** full title + description from the lot page's og: meta (API titles truncate) */
async function fullIdentity(it: ApiItem): Promise<{ title: string; desc: string } | null> {
  const html = await getHtml(`${HOST}/iSynApp/auctionDisplay.action?sid=${SID}&auctionId=${it.id}`);
  if (!html) return null;
  const t = html.match(/<meta property="og:title" content="([^"]*)"/i)
    ?? html.match(/<title>([^<]*)<\/title>/i);
  const d = html.match(/<meta (?:property="og:description"|name="description") content="([^"]*)"/i);
  const title = t ? decodeHtml(t[1]).trim() : '';
  if (!title) return null;
  return { title, desc: d ? decodeHtml(d[1]).trim() : '' };
}

function toLot(it: ApiItem, ident: { title: string; desc: string }, kind: 'sold' | 'upcoming'): AuctionLot | null {
  const iso = closeIso(it);
  if (!iso) return null;
  // the ET calendar day of the GMT close (a 9:59 PM ET close is 01:59Z the
  // next day — lib/sale-day.ts); the instant itself rides on every row
  const saleDate = saleDayOf('NFL Auction', iso) || iso.slice(0, 10);
  // (Oct 8 sports audit, E7) NFL Auction's use language wins: a "Signed Game
  // Issued" jersey or a coin-toss coin is game-used, never an autograph /
  // ticket ("… Notable Play: … TD Pass" read as a pass)
  const cat: SportsCategory = GAME_USED_RE.test(ident.title) || /\b(?:coin toss|toss coin|flip coin|coin flip)\b/i.test(ident.title) ? 'game-used' : classifySports('', ident.title);
  const auth = readAuth(cat, ident.title, ident.desc);
  const bid = money(it.currentBid);
  const reserve = money(it.reserveAmt) ?? 0;
  const base = {
    id: `nflauction-${it.id}`,
    artist: pseudoArtist(cat),
    title: ident.title,
    category: 'object' as LotCategory,
    auctionHouse: 'NFL Auction' as AuctionLot['auctionHouse'],
    saleName: it.causeName ? `NFL Auction · ${it.causeName}` : 'NFL Auction',
    saleDate,
    sport: 'Football',
    subCat: cat,
    imageUrl: it.imgFull || it.imgMedium || it.imgThumb || null,
    url: `${HOST}/iSynApp/auctionDisplay.action?sid=${SID}&auctionId=${it.id}`,
    gradeLabel: auth.grade, authCert: auth.cert, authConfidence: auth.confidence,
  };
  if (kind === 'sold') {
    // a sale requires real bidding that met any reserve; everything else is a
    // pass — skipped, never a zero-dollar "sale" (charity house: final bid is
    // all-in; there is no buyer's premium)
    if (!bid || it.bidCount <= 0 || (reserve > 0 && bid < reserve)) return null;
    if (saleDate > TODAY) return null;
    return { ...base, status: 'sold', saleDateTime: iso, ...stampRealizedUsd(bid, saleDate) } as unknown as AuctionLot;
  }
  return {
    ...base,
    status: 'upcoming',
    saleDateTime: iso,
    firstSeen: TODAY,
    ...stampUpcomingUsd(saleDate),
    currentBid: bid ?? null,
    bidCount: typeof it.bidCount === 'number' ? it.bidCount : null,
  } as unknown as AuctionLot;
}

async function main() {
  if (process.argv.includes('--write')) installCrashGuard('NFLAuction');
  const delayMs = arg('delay', 150);
  const closedPages = arg('closed-pages', 30);
  const conc = 3;

  // ids already settled in the segment never need a re-fetch of the lot page
  const existing = readSegment('nflauction') as unknown as AuctionLot[];
  const haveSold = new Set(existing.filter(l => l.status === 'sold').map(l => l.id));
  const prevTitles = new Map(existing.map(l => [l.id, { title: l.title, desc: '' }]));

  // ── SOLD — the closed archive, nominated by query, decided on full title.
  // --backfill ALSO sweeps the NO-QUERY archive to exhaustion (the platform
  // retains ~a year; query mode caps around 2-3k rows) with a cheap 'game'
  // prefilter on the truncated title — the union of both sources is
  // near-complete (a 'Game …' phrase hidden past the ~48ch truncation is
  // still caught by the server queries, which search full titles). ──
  const backfill = process.argv.includes('--backfill');
  const closedRaw = new Map<number, ApiItem>();
  for (const q of QUERIES) {
    for (const it of await pageThrough('closed', q, closedPages, delayMs)) closedRaw.set(it.id, it);
  }
  if (backfill) {
    const all = await pageThrough('closed', '', Math.max(closedPages, 200), delayMs);
    console.log(`[NFLAuction] backfill: ${all.length} closed rows swept (no query)`);
    for (const it of all) if (/game/i.test(it.title || '')) closedRaw.set(it.id, it);
  }
  console.log(`[NFLAuction] closed candidates: ${closedRaw.size}`);
  const soldCands = Array.from(closedRaw.values())
    .filter(it => String(it.type || 'bid') === 'bid')
    .filter(it => !haveSold.has(`nflauction-${it.id}`));
  const lots: AuctionLot[] = [];
  let miss = 0;
  await mapPool(soldCands, conc, async (it) => {
    const ident = prevTitles.get(`nflauction-${it.id}`)?.title.length ? prevTitles.get(`nflauction-${it.id}`)! : await fullIdentity(it);
    await new Promise(r => setTimeout(r, delayMs));
    if (!ident || !GAME_USED_RE.test(ident.title)) { miss++; return; }
    try { const lot = toLot(it, ident, 'sold'); if (lot) lots.push(lot); else miss++; } catch { miss++; }
  });
  console.log(`[NFLAuction] parsed ${lots.length} new sold game-used lots (${miss} skipped)`);
  // POISON DETECTOR: if one exact price carries >20% of a >=50-row batch,
  // the feed is echoing a widget/campaign figure, not per-lot results.
  if (lots.length >= 50) {
    const census = new Map<number, number>();
    for (const l of lots) {
      const p = (l as unknown as { priceUsd?: number }).priceUsd;
      if (typeof p === 'number') census.set(p, (census.get(p) || 0) + 1);
    }
    const [topPrice, topN] = Array.from(census.entries()).sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
    if (topN > lots.length * 0.2) {
      console.error(`[NFLAuction] ABORT: $${topPrice} repeats on ${topN}/${lots.length} new sold rows — poisoned feed, nothing written.`);
      reportAndExit({ house: 'nflauction', fetched: API_STATS.ok, parsed: lots.length, settled: 0, reason: `poisoned batch: $${topPrice} on ${topN}/${lots.length} rows` });
    }
  }

  // ── IDWALK — RETIRED (Aug 30 2026). The mode's price extraction was
  // unsound: the first "Current Bid: $X" on an archived lot page belongs to
  // the sidebar Hot-Items widget as often as the subject, which minted 3,895
  // fake sales sharing a handful of widget prices ($10,050 ×3,622 …) — 70% of
  // the NFL sold corpus, healed by scripts/heal-nflauction-idwalk.ts. Closed
  // pages render true amounts via JS only; there is no honest server-side
  // price for these ids. Never re-enable without a verified per-lot source.
  // (The walk's code was deleted Sep 2 2026 — it lived behind `if (false)`;
  // git history has it. The wayback-id manifest stays in scripts/data/.)
  if (process.argv.includes('--idwalk')) {
    console.error('[NFLAuction] --idwalk is RETIRED: its price scrape read the Hot-Items widget, not the lot. See scripts/heal-nflauction-idwalk.ts.');
    process.exit(1);
  }

  // ── LIVE — tonight's open game-used snapshot ──
  let liveLots: AuctionLot[] = [];
  let liveOk = false;
  if (process.argv.includes('--live')) {
    const openRaw = new Map<number, ApiItem>();
    let anyPage = false;
    for (const q of QUERIES) {
      const items = await pageThrough('open', q, 10, delayMs);
      if (items.length) anyPage = true;
      for (const it of items) openRaw.set(it.id, it);
    }
    // liveOk = the API answered (an empty result set on a reachable API is a
    // fact); a network-dead night keeps last night's snapshot
    liveOk = anyPage || (await getJson(`${HOST}/iSynApp/allAuction.action?sid=${SID}&viewType=api&qMode=open&rc=1&rs=0`)) != null;
    const cands = Array.from(openRaw.values())
      .filter(it => String(it.type || 'bid') === 'bid')
      .filter(it => (it.totalSecondsLeft ?? 1) > 0);
    console.log(`[NFLAuction] live candidates: ${cands.length} (api ${liveOk ? 'ok' : 'DOWN'})`);
    await mapPool(cands, conc, async (it) => {
      const prev = prevTitles.get(`nflauction-${it.id}`);
      const ident = prev?.title ? { title: prev.title, desc: '' } : await fullIdentity(it);
      if (!prev?.title) await new Promise(r => setTimeout(r, delayMs));
      if (!ident || !GAME_USED_RE.test(ident.title)) return;
      try { const lot = toLot(it, ident, 'upcoming'); if (lot) liveLots.push(lot); } catch { /* skip */ }
    });
    const lg = liveOnly(liveLots);
    if (lg.dropped) console.log(`[NFLAuction] dropped ${lg.dropped} malformed live lots`);
    liveLots = lg.good;
    console.log(`[NFLAuction] live: ${liveLots.length} upcoming game-used lots`);
  }

  const byConf: Record<string, number> = {};
  for (const l of lots.concat(liveLots)) {
    const cf = (l as { authConfidence?: string }).authConfidence || '?'; byConf[cf] = (byConf[cf] || 0) + 1;
  }
  console.log('[NFLAuction] confidence:', byConf);
  {
    const reasons: string[] = [];
    if (API_STATS.calls > 0 && API_STATS.ok === 0) reasons.push(`listing API down: ${API_STATS.fail}/${API_STATS.calls} calls failed, last ${API_STATS.lastStatus || '?'} "${API_STATS.lastSnippet.slice(0, 120)}"`);
    else if (process.argv.includes('--live') && !liveOk) reasons.push('live leg not ok');
    if (soldCands.length >= 20 && lots.length === 0 && miss < soldCands.length) reasons.push(`${soldCands.length} closed candidates, 0 settled`);
    reportLegHealth({ house: 'nflauction', ok: reasons.length === 0, fetched: API_STATS.ok, parsed: lots.length + liveLots.length, settled: lots.length, reason: reasons.join('; ') || null });
  }

  if (process.argv.includes('--write')) {
    const { good, dropped } = settledOnly(lots);
    if (dropped) console.log(`[NFLAuction] dropped ${dropped} unsettled/future-dated lots`);
    const rep = assertInvariants(good.concat(liveLots));
    if (rep.fatal.length) {
      console.error(`[NFLAuction] refusing to write: ${rep.fatal.length} FATALs`);
      rep.fatal.slice(0, 5).forEach(f => console.error('  ', f));
      reportAndExit({ house: 'nflauction', fetched: API_STATS.ok, parsed: good.length + liveLots.length, settled: 0, reason: `refused write: ${rep.fatal.length} invariant FATALs` });
    }
    const r = process.argv.includes('--live')
      ? writeMergedSegmentWithLive('nflauction', good, liveLots, liveOk)
      : { ...writeMergedSegment('nflauction', good), upcoming: undefined as number | undefined };
    console.log(`[NFLAuction] merged into segment 'nflauction': +${r.added} new, ${r.total} total${r.upcoming !== undefined ? `, ${r.upcoming} upcoming` : ''}.`);
  } else {
    const s = lots[0] || liveLots[0];
    if (s) console.log('[NFLAuction] sample:', JSON.stringify({ id: s.id, artist: s.artist, title: s.title.slice(0, 60), saleDate: s.saleDate, status: s.status, priceUsd: (s as { priceUsd?: number }).priceUsd, bid: (s as { currentBid?: number }).currentBid, conf: (s as { authConfidence?: string }).authConfidence }, null, 0));
    console.log('[NFLAuction] dry run (pass --write to persist)');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('[NFLAuction] fatal', e); reportAndExit({ house: 'nflauction', fetched: 0, parsed: 0, settled: 0, reason: `crashed: ${String((e as Error)?.message || e).slice(0, 200)}` }); });
}
