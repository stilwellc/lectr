// MLB Auctions crawler — GAME-USED lots only (Collin, Aug 25 2026), from the
// league's official auction site at auctions.mlb.com (same Commerce Dynamics
// iSynApp platform as NFL Auction — sid 1101001). Plain curl 200s with a
// real-Chrome UA, and the listing endpoint doubles as a JSON API:
//
//   /iSynApp/allAuction.action?sid=1101001&viewType=api
//     &qMode=open|closed &query=<tokens> &sort=… &rc=<page size> &rs=<offset>
//
// Platform deltas vs the NFL config (all verified Aug 25 2026):
//   · API titles are FULL here (no ~48ch truncation) → game-used is decided
//     on the API title and lot pages are fetched ONLY for keepers (the real
//     description lives in the #auction-description block; the og:description
//     meta is a generic "Bid on … at MLB Auctions" stub).
//   · closeTime is "YYYY-MM-DD HH:mm:ss.0" GMT (NFL prints "Sep 16, 2026,
//     2:02:00 AM") — closeIso() parses both.
//   · items carry NO reserveAmt; type is 'auction' (not 'bid'); bidCount is a
//     STRING. An ended lot page server-renders `Winning Bid: $X` for its
//     subject lot ONLY when the sale actually settled — that render is the
//     sold gate AND the authoritative realized figure (reserve-not-met and
//     unsold pages never print it).
//   · every lot is authenticated under the MLB Authentication Program
//     (league chain-of-custody hologram) — recognized here as high-confidence
//     for game-used, the same standing photo-matching has on the NFL side.
// Charity-adjacent house semantics are identical: NO estimates, NO buyer's
// premium — the winning bid IS the all-in realized price. BIN excluded
// (auctions-only doctrine).
//
// Run: RAY_SKIP_MAIN=1 npx tsx scripts/crawl-mlbauction.ts --live [--write]
//      [--closed-pages 30] [--delay 150]
//
// --idwalk: the DEEP archive. The listing API windows at ~a year, but ENDED
// lot pages live on individually (any slug: /x/isynmv1/aucd/<id>).
// scripts/data/mlbauction-wayback-ids.csv holds every real lot id recoverable
// from the Wayback CDX index; the walk fetches each unknown id on the LIVE
// site and keeps finalized game-used sales. UNLIKE the NFL walk, saleDate is
// EXACT here: the ended page server-renders the bid history and the WINNING
// row prints its own timestamp ("WINNING Aug 11, 2026 01:00:00 PM EDT
// $1,610.00"). Wayback first-capture is only the last-ditch fallback (the
// 2025 bulk crawl makes capture dates meaningless for old MLB lots).
import type { AuctionLot, LotCategory } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import {
  getHtml, decodeHtml, classifySports, pseudoArtist, readAuth,
  stampRealizedUsd, stampUpcomingUsd, writeMergedSegment,
  writeMergedSegmentWithLive, settledOnly, liveOnly, installCrashGuard,
  REAL_UA, mapPool,
} from './lib/sports-crawl';
import { readSegment } from './corpus-io';
import * as fs from 'fs';
import * as path from 'path';

const HOST = 'https://auctions.mlb.com';
const SID = '1101001';
const TODAY = new Date().toISOString().slice(0, 10);
const GAME_USED_RE = /game[-\s]?(used|worn|issued)/i;
const MLB_AUTH_RE = /MLB Authentication(?:\s+Program)?|MLB[-\s]Authenticated|MLB hologram/i;
/** the server-side nominations — fuzzy OR match; the regex above decides */
const QUERIES = ['game used', 'game worn', 'game issued'];
const PAGE = 100;

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : def;
}

interface ApiItem {
  id: number | string; title: string; fullTitle?: string; url: string;
  currentBid: string; binAmt?: string; bidCount: number | string;
  teamName?: string; causeName?: string; seller?: string; reserveAmt?: string;
  closeTime: string;       // "2026-08-12 00:00:00.0" — GMT
  imgFull?: string; imgMedium?: string; imgThumb?: string;
  type?: string;           // 'auction' here ('bid' on the NFL config)
  totalSecondsLeft?: number | string;
}

async function getJson(url: string, retries = 2): Promise<{ items?: ApiItem[] } | null> {
  for (let a = 0; a <= retries; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': REAL_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) return null;
      return await res.json();
    } catch { if (a < retries) await new Promise(r => setTimeout(r, 800 * (a + 1))); }
  }
  return null;
}

const money = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return isFinite(n) && n > 0 ? n : null;
};
const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return isFinite(n) ? n : 0;
};
const bestTitle = (it: ApiItem): string => (it.fullTitle || it.title || '').trim();

/** closeTime is GMT on both platform configs; parse either print. */
function closeIso(it: ApiItem): string | null {
  const raw = String(it.closeTime || '').trim();
  if (!raw) return null;
  const sql = raw.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
  const t = sql ? Date.parse(`${sql[1]}T${sql[2]}Z`) : Date.parse(`${raw} UTC`);
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

interface PageRead { desc: string; winningBid: number | null; winningDate: string | null; }

/** the WINNING bid-history row — server-rendered with its exact timestamp */
function parseWinningRow(html: string): { date: string | null; bid: number | null } {
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = txt.match(/WINNING\s+([A-Z][a-z]{2} \d{1,2}, 20\d{2})[^$]{0,60}\$\s*([\d,\.]+)/);
  if (!m) return { date: null, bid: null };
  const t = Date.parse(`${m[1]} UTC`);
  const bid = parseFloat(m[2].replace(/,/g, ''));
  return {
    date: isNaN(t) ? null : new Date(t).toISOString().slice(0, 10),
    bid: isFinite(bid) && bid > 0 ? bid : null,
  };
}
/** the WAF here rate-limits: a request burst gets a "Human Verification"
 *  interstitial instead of the lot page. Treat it as a miss (never parse it),
 *  count consecutive hits, and stop page-fetching for the run once tripped —
 *  skipped lots simply retry next night (the merge is additive). */
let challengeStreak = 0;
const CHALLENGE_TRIP = 10;
function challenged(html: string): boolean {
  if (/<title>\s*Human Verification/i.test(html)) { challengeStreak++; return true; }
  challengeStreak = 0;
  return false;
}
const wafTripped = () => challengeStreak >= CHALLENGE_TRIP;

/** the lot page: the real description block + the server-rendered settled
 *  figure (`Winning Bid: $X` prints for the subject lot only when the sale
 *  actually closed with a winner — the sold gate on a reserve-blind API) */
async function readLotPage(id: number | string): Promise<PageRead | null> {
  if (wafTripped()) return null;
  const html = await getHtml(`${HOST}/iSynApp/auctionDisplay.action?sid=${SID}&auctionId=${id}`);
  if (!html || challenged(html)) return null;
  const d = html.match(/id="auction-description"[^>]*>([\s\S]{0,4000}?)<\/div>/i);
  const desc = d ? decodeHtml(d[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
  const w = html.match(/Winning Bid:?\s*<\/b>\s*<\/span>\s*<span>\s*\$\s*([\d,\.]+)/i)
    ?? html.replace(/<[^>]+>/g, ' ').match(/Winning Bid:?\s*\$\s*([\d,\.]+)/i);
  const winningBid = w ? parseFloat(w[1].replace(/,/g, '')) : null;
  const row = parseWinningRow(html);
  return { desc, winningBid: winningBid && winningBid > 0 ? winningBid : row.bid, winningDate: row.date };
}

/** league chain-of-custody = the game-used gold standard on this house */
function mlbAuth(cat: ReturnType<typeof classifySports>, title: string, desc: string) {
  const auth = readAuth(cat, title, desc);
  if (MLB_AUTH_RE.test(`${title}\n${desc}`)) {
    auth.confidence = 'high';
    if (!auth.cert) auth.cert = 'MLB-AUTH';
  }
  return auth;
}

function toLot(it: ApiItem, ident: { title: string; desc: string }, kind: 'sold' | 'upcoming', realized?: number | null): AuctionLot | null {
  const iso = closeIso(it);
  if (!iso) return null;
  const saleDate = iso.slice(0, 10);
  const cat = classifySports('', ident.title);
  const auth = mlbAuth(cat, ident.title, ident.desc);
  const bid = money(it.currentBid);
  const base = {
    id: `mlbauction-${it.id}`,
    artist: pseudoArtist(cat),
    title: ident.title,
    category: 'object' as LotCategory,
    auctionHouse: 'MLB Auctions' as AuctionLot['auctionHouse'],
    saleName: it.seller ? `MLB Auctions · ${it.seller}` : 'MLB Auctions',
    saleDate,
    sport: 'Baseball',
    subCat: cat,
    imageUrl: it.imgFull || it.imgMedium || it.imgThumb || null,
    url: `${HOST}/iSynApp/auctionDisplay.action?sid=${SID}&auctionId=${it.id}`,
    gradeLabel: auth.grade, authCert: auth.cert, authConfidence: auth.confidence,
  };
  if (kind === 'sold') {
    // a sale = the ended page printed a winning bid (the API is reserve-blind
    // here, so the page render is the gate); the winning figure is all-in —
    // no buyer's premium on the league house
    const finalBid = realized ?? null;
    if (!finalBid || num(it.bidCount) <= 0) return null;
    if (saleDate > TODAY) return null;
    return { ...base, status: 'sold', ...stampRealizedUsd(finalBid, saleDate) } as unknown as AuctionLot;
  }
  return {
    ...base,
    status: 'upcoming',
    saleDateTime: iso,
    firstSeen: TODAY,
    ...stampUpcomingUsd(saleDate),
    currentBid: bid ?? null,
    bidCount: num(it.bidCount) || null,
  } as unknown as AuctionLot;
}

async function main() {
  if (process.argv.includes('--write')) installCrashGuard('MLBAuction');
  const delayMs = arg('delay', 150);
  const closedPages = arg('closed-pages', 30);
  // safer concurrency than the NFL config — this WAF rate-limits bursts
  const conc = 2;

  // ids already settled in the segment never need a re-fetch of the lot page
  const existing = readSegment('mlbauction') as unknown as AuctionLot[];
  const haveSold = new Set(existing.filter(l => l.status === 'sold').map(l => l.id));
  const prevTitles = new Map(existing.map(l => [l.id, l.title]));

  // ── SOLD — the closed archive, nominated by query, decided on the FULL API
  // title (no truncation on this config). --backfill ALSO sweeps the NO-QUERY
  // archive to exhaustion — the union of both sources is near-complete. ──
  const backfill = process.argv.includes('--backfill');
  const closedRaw = new Map<string, ApiItem>();
  for (const q of QUERIES) {
    for (const it of await pageThrough('closed', q, closedPages, delayMs)) closedRaw.set(String(it.id), it);
  }
  if (backfill) {
    const all = await pageThrough('closed', '', Math.max(closedPages, 200), delayMs);
    console.log(`[MLBAuction] backfill: ${all.length} closed rows swept (no query)`);
    for (const it of all) if (GAME_USED_RE.test(bestTitle(it))) closedRaw.set(String(it.id), it);
  }
  console.log(`[MLBAuction] closed candidates: ${closedRaw.size}`);
  const soldCands = Array.from(closedRaw.values())
    .filter(it => ['auction', 'bid'].includes(String(it.type || 'auction')))
    .filter(it => GAME_USED_RE.test(bestTitle(it)))
    .filter(it => num(it.bidCount) > 0 && money(it.currentBid) != null)
    .filter(it => !haveSold.has(`mlbauction-${it.id}`));
  const lots: AuctionLot[] = [];
  let miss = 0;
  await mapPool(soldCands, conc, async (it) => {
    const page = await readLotPage(it.id);
    await new Promise(r => setTimeout(r, delayMs));
    if (!page || !page.winningBid) { miss++; return; } // no settled winner printed → not a sale
    try {
      const lot = toLot(it, { title: bestTitle(it), desc: page.desc }, 'sold', page.winningBid);
      if (lot) lots.push(lot); else miss++;
    } catch { miss++; }
  });
  console.log(`[MLBAuction] parsed ${lots.length} new sold game-used lots (${miss} skipped)${wafTripped() ? ' — WAF challenge tripped; unfetched lots retry next run' : ''}`);

  // ── IDWALK — the deep archive: every wayback-recovered id vs the live site ──
  if (process.argv.includes('--idwalk')) {
    const manifest = path.join(process.cwd(), 'scripts', 'data', 'mlbauction-wayback-ids.csv');
    // --idskip/--idcap slice the walk so an 84k-id manifest can run as a few
    // bounded dispatches instead of one job racing the runner time limit
    const idskip = arg('idskip', 0);
    const idcap = arg('idcap', 0);
    let rows = fs.readFileSync(manifest, 'utf8').trim().split('\n').slice(1)
      .map(l => { const [id, ts] = l.split(','); return { id: Number(id), ts }; })
      .filter(r => r.id > 0 && !haveSold.has(`mlbauction-${r.id}`));
    if (idskip > 0) rows = rows.slice(idskip);
    if (idcap > 0) rows = rows.slice(0, idcap);
    console.log(`[MLBAuction] idwalk: ${rows.length} unknown historical ids${idskip || idcap ? ` (skip ${idskip}, cap ${idcap || '∞'})` : ''}`);
    let walked = 0, kept = 0;
    await mapPool(rows, conc, async (r) => {
      if (wafTripped()) return;
      const html = await getHtml(`${HOST}/x/isynmv1/aucd/${r.id}`);
      await new Promise(res => setTimeout(res, delayMs));
      walked++;
      if (html && challenged(html)) return;
      if (walked % 2000 === 0) console.log(`[MLBAuction] idwalk ${walked}/${rows.length} (${kept} kept)`);
      if (!html) return;
      const t = html.match(/<meta property="og:title" content="([^"]*)"/i);
      const title = t ? decodeHtml(t[1]).replace(/\s*\|.*$/, '').trim() : '';
      if (!title || /official mlb auctions/i.test(title) || !GAME_USED_RE.test(title)) return;
      // the settled gate: a finalized sale prints the WINNING history row
      // (with its exact timestamp) and the Winning Bid figure — reserve-not-
      // met/unsold ended pages render neither
      const row = parseWinningRow(html);
      const w = html.replace(/<[^>]+>/g, ' ').match(/Winning Bid:?\s*\$\s*([\d,\.]+)/i);
      const bid = row.bid ?? (w ? parseFloat(w[1].replace(/,/g, '')) : null);
      if (!bid || bid <= 0) return; // no verified final price → never a sale
      const d = html.match(/id="auction-description"[^>]*>([\s\S]{0,4000}?)<\/div>/i);
      const desc = d ? decodeHtml(d[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
      const cat = classifySports('', title);
      const auth = mlbAuth(cat, title, desc);
      // the WINNING row's own date = exact hammer day; wayback first-capture
      // month (day 15) only if the page somehow printed no dated row
      const saleDate = row.date ?? `${r.ts.slice(0, 4)}-${r.ts.slice(4, 6)}-15`;
      if (saleDate > TODAY) return;
      const lot = {
        id: `mlbauction-${r.id}`,
        artist: pseudoArtist(cat), title,
        category: 'object' as LotCategory,
        auctionHouse: 'MLB Auctions' as AuctionLot['auctionHouse'],
        saleName: 'MLB Auctions', saleDate,
        sport: 'Baseball', subCat: cat,
        imageUrl: null,
        url: `${HOST}/iSynApp/auctionDisplay.action?sid=${SID}&auctionId=${r.id}`,
        gradeLabel: auth.grade, authCert: auth.cert, authConfidence: auth.confidence,
        status: 'sold',
        ...stampRealizedUsd(bid, saleDate),
      } as unknown as AuctionLot;
      lots.push(lot); kept++;
      // INCREMENTAL: the walk is long — persist every 500 keeps
      if (process.argv.includes('--write') && kept % 500 === 0) {
        const { good } = settledOnly(lots);
        if (good.length) writeMergedSegment('mlbauction', good);
      }
    });
    console.log(`[MLBAuction] idwalk done: ${kept} finalized game-used sales recovered from ${walked} ids`);
  }

  // ── LIVE — tonight's open game-used snapshot ──
  let liveLots: AuctionLot[] = [];
  let liveOk = false;
  if (process.argv.includes('--live')) {
    const openRaw = new Map<string, ApiItem>();
    let anyPage = false;
    for (const q of QUERIES) {
      const items = await pageThrough('open', q, 10, delayMs);
      if (items.length) anyPage = true;
      for (const it of items) openRaw.set(String(it.id), it);
    }
    // liveOk = the API answered (an empty result set on a reachable API is a
    // fact); a network-dead night keeps last night's snapshot
    liveOk = anyPage || (await getJson(`${HOST}/iSynApp/allAuction.action?sid=${SID}&viewType=api&qMode=open&rc=1&rs=0`)) != null;
    const cands = Array.from(openRaw.values())
      .filter(it => ['auction', 'bid'].includes(String(it.type || 'auction')))
      .filter(it => GAME_USED_RE.test(bestTitle(it)))
      .filter(it => num(it.totalSecondsLeft ?? 1) > 0);
    console.log(`[MLBAuction] live candidates: ${cands.length} (api ${liveOk ? 'ok' : 'DOWN'})`);
    await mapPool(cands, conc, async (it) => {
      // live lots don't need the settled gate; fetch the page once per NEW id
      // for the description (auth read) — known ids ride the API title
      const known = prevTitles.has(`mlbauction-${it.id}`);
      let desc = '';
      if (!known) {
        const page = await readLotPage(it.id);
        desc = page?.desc || '';
        await new Promise(r => setTimeout(r, delayMs));
      }
      try {
        const lot = toLot(it, { title: bestTitle(it), desc }, 'upcoming');
        if (lot) liveLots.push(lot);
      } catch { /* skip */ }
    });
    const lg = liveOnly(liveLots);
    if (lg.dropped) console.log(`[MLBAuction] dropped ${lg.dropped} malformed live lots`);
    liveLots = lg.good;
    console.log(`[MLBAuction] live: ${liveLots.length} upcoming game-used lots`);
  }

  const byConf: Record<string, number> = {};
  for (const l of lots.concat(liveLots)) {
    const cf = (l as { authConfidence?: string }).authConfidence || '?'; byConf[cf] = (byConf[cf] || 0) + 1;
  }
  console.log('[MLBAuction] confidence:', byConf);

  if (process.argv.includes('--write')) {
    const { good, dropped } = settledOnly(lots);
    if (dropped) console.log(`[MLBAuction] dropped ${dropped} unsettled/future-dated lots`);
    // POISON DETECTOR (the NFL idwalk lesson, Aug 30 2026): if one exact
    // price carries >20% of a >=50-row batch of NEW sold rows, the source is
    // echoing a template/widget constant, not per-lot results — abort.
    if (good.length >= 50) {
      const census = new Map<number, number>();
      for (const l of good) {
        const pv = (l as unknown as { priceUsd?: number; realizedUsd?: number });
        const pr = pv.realizedUsd ?? pv.priceUsd;
        if (typeof pr === 'number') census.set(pr, (census.get(pr) || 0) + 1);
      }
      const top = Array.from(census.entries()).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > good.length * 0.2) {
        console.error(`[MLBAuction] ABORT: $${top[0]} repeats on ${top[1]}/${good.length} new sold rows — poisoned feed, nothing written.`);
        process.exit(1);
      }
    }
    const rep = assertInvariants(good.concat(liveLots));
    if (rep.fatal.length) {
      console.error(`[MLBAuction] refusing to write: ${rep.fatal.length} FATALs`);
      rep.fatal.slice(0, 5).forEach(f => console.error('  ', f));
      process.exit(1);
    }
    const r = process.argv.includes('--live')
      ? writeMergedSegmentWithLive('mlbauction', good, liveLots, liveOk)
      : { ...writeMergedSegment('mlbauction', good), upcoming: undefined as number | undefined };
    console.log(`[MLBAuction] merged into segment 'mlbauction': +${r.added} new, ${r.total} total${r.upcoming !== undefined ? `, ${r.upcoming} upcoming` : ''}.`);
  } else {
    const s = lots[0] || liveLots[0];
    if (s) console.log('[MLBAuction] sample:', JSON.stringify({ id: s.id, artist: s.artist, title: s.title.slice(0, 60), saleDate: s.saleDate, status: s.status, priceUsd: (s as { priceUsd?: number }).priceUsd, bid: (s as { currentBid?: number }).currentBid, conf: (s as { authConfidence?: string }).authConfidence }, null, 0));
    console.log('[MLBAuction] dry run (pass --write to persist)');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('[MLBAuction] fatal', e); process.exit(1); });
}
