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
import { reportLegHealth, reportAndExit } from './lib/leg-health';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
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

// ── API transport ────────────────────────────────────────────────────────────
// Since Sep 20 2026 the listing API answers GitHub-hosted runner IPs with the
// WAF's "Human Verification" interstitial (HTML, often 200) instead of JSON —
// every night read as `api DOWN` with ZERO diagnostics, while the same call
// from a residential IP returns JSON. Every failed call now logs its HTTP
// status + a body snippet (first few, then counted), and on failure the crawl
// retries the call THROUGH A REAL BROWSER (system Chrome via playwright-core —
// the RR Auction resolver's launch path): the page loads the site origin,
// lets any JS challenge run, then fetches the API from inside the page with
// the browser's own cookies/TLS fingerprint. Whether that clears the WAF on a
// runner IP can only be proven on CI (from a residential Mac the plain fetch
// already works). `--browser` forces the browser path (local testing).
export const API_STATS = { calls: 0, ok: 0, fail: 0, browserCalls: 0, browserOk: 0, lastStatus: '' as string, lastSnippet: '' as string };
let failLogged = 0;
const snippet = (t: string) => t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
function noteApiFail(url: string, status: string, body: string) {
  API_STATS.fail++;
  API_STATS.lastStatus = status;
  API_STATS.lastSnippet = snippet(body);
  if (failLogged++ < 6) console.warn(`[MLBAuction] API FAIL ${status} ${url.replace(HOST, '')} — body: ${API_STATS.lastSnippet || '(empty)'}`);
}

let browserMode = process.argv.includes('--browser');
let browser: Browser | null = null;
let bctx: BrowserContext | null = null;
let bpage: Page | null = null;
let browserDead = false;
async function browserPage(): Promise<Page | null> {
  if (bpage) return bpage;
  if (browserDead) return null;
  try {
    browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
    bctx = await browser.newContext({ userAgent: REAL_UA, locale: 'en-US' });
    bpage = await bctx.newPage();
    await bpage.goto(`${HOST}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // give a JS challenge up to ~20s to clear itself
    for (let i = 0; i < 20; i++) {
      const t = await bpage.title().catch(() => '');
      if (!/human verification|just a moment|access denied/i.test(t)) break;
      await bpage.waitForTimeout(1000);
    }
    console.log(`[MLBAuction] browser path up (origin title: "${(await bpage.title().catch(() => '')).slice(0, 60)}")`);
    return bpage;
  } catch (e) {
    browserDead = true;
    console.warn(`[MLBAuction] browser path unavailable: ${(e as Error)?.message?.split('\n')[0] || e}`);
    return null;
  }
}
export async function closeBrowser() { try { await browser?.close(); } catch { /* already gone */ } browser = null; bpage = null; bctx = null; }

/** GET through the page (same-origin fetch — browser cookies + fingerprint) */
async function browserGet(url: string): Promise<{ status: number; text: string } | null> {
  const page = await browserPage();
  if (!page) return null;
  API_STATS.browserCalls++;
  try {
    return await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include', headers: { Accept: 'application/json, text/html;q=0.9' } });
      return { status: r.status, text: await r.text() };
    }, url);
  } catch (e) {
    return { status: 0, text: String((e as Error)?.message || e) };
  }
}

function parseApi(text: string): { items?: ApiItem[] } | null {
  const t = text.trim();
  if (!t.startsWith('{')) return null; // the WAF interstitial is HTML
  try { return JSON.parse(t); } catch { return null; }
}

async function getJson(url: string, retries = 2): Promise<{ items?: ApiItem[] } | null> {
  API_STATS.calls++;
  if (!browserMode) {
    for (let a = 0; a <= retries; a++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': REAL_UA, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9', Referer: `${HOST}/` }, signal: AbortSignal.timeout(30000) });
        const text = await res.text();
        const j = res.ok ? parseApi(text) : null;
        if (j) { API_STATS.ok++; return j; }
        noteApiFail(url, `HTTP ${res.status}${res.ok ? ' (non-JSON body)' : ''}`, text);
        if (res.status === 403 || /human verification/i.test(text)) break; // a wall, not a blip — go to the browser
      } catch (e) {
        if (a < retries) await new Promise(r => setTimeout(r, 800 * (a + 1)));
        else noteApiFail(url, `network ${(e as Error)?.message || e}`, '');
      }
    }
    // plain fetch walled/failed → switch the rest of the run to the browser
    if (!browserDead) { console.warn('[MLBAuction] plain API fetch failed — retrying through a real browser (playwright-core, system Chrome)'); browserMode = true; }
  }
  const b = await browserGet(url);
  if (!b) return null;
  const j = b.status >= 200 && b.status < 300 ? parseApi(b.text) : null;
  if (j) { API_STATS.ok++; API_STATS.browserOk++; return j; }
  noteApiFail(url, `browser HTTP ${b.status}${b.status >= 200 && b.status < 300 ? ' (non-JSON body)' : ''}`, b.text);
  return null;
}

/** lot-page HTML via the same transport the API is using tonight */
async function getPage(url: string): Promise<string | null> {
  if (!browserMode) return getHtml(url);
  const b = await browserGet(url);
  return b && b.status >= 200 && b.status < 300 ? b.text : null;
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

// ── SUBJECT-LOT ANCHORING ────────────────────────────────────────────────────
// An ended lot page also carries related-lot cards ("Current Bid: $X" ×3 on a
// Sep 2 2026 sample) and a search-result JS template — a page-wide "first
// match" reads THOSE as the subject's price. That is the exact poison shape
// that minted 3,895 fake NFL sales off the Hot-Items widget (see
// heal-nflauction-idwalk.ts). Every price read here is therefore scoped to a
// block only the SUBJECT lot renders (verified on auctionId 6395641):
//   settled figure  <li class="auction-bid-current …"><b>Winning Bid:</b></span> <span>$45.00</span></li>
//   bid history     <li id="bid-history"> … <div class="the-winner">WINNING</div></td>
//                   <td headers="date">Aug 23, 2026 03:13:23 PM EDT</td> <td headers="bid" class="numeric">$45.00</td>
// A related-lot card renders neither block, so nothing outside the subject can
// satisfy either anchor.
const BID_HISTORY_OPEN = /<li[^>]*\bid="bid-history"[^>]*>/i;
const AUCTION_BID_CURRENT_OPEN = /<li[^>]*\bclass="[^"]*\bauction-bid-current\b[^"]*"[^>]*>/i;
let anchorMisses = 0;

/** slice from the anchor's opening tag to its own closing `</li>` (neither
 *  block nests an <li>, so the first close IS the boundary), length-capped */
function subjectBlock(html: string, openRe: RegExp, maxLen: number): string | null {
  const m = html.match(openRe);
  if (!m || m.index == null) return null;
  const start = m.index;
  const close = html.indexOf('</li>', start);
  const end = close < 0 ? start + maxLen : Math.min(close + 5, start + maxLen);
  return html.slice(start, end);
}

/** the WINNING bid-history row — server-rendered with its exact timestamp,
 *  read ONLY inside the subject's <li id="bid-history"> block */
export function parseWinningRow(html: string): { date: string | null; bid: number | null } {
  const block = subjectBlock(html, BID_HISTORY_OPEN, 80000);
  if (!block) return { date: null, bid: null };
  const m = block.match(/the-winner"[^>]*>\s*WINNING\s*<\/div>\s*<\/td>\s*<td[^>]*headers="date"[^>]*>\s*([A-Z][a-z]{2} \d{1,2}, 20\d{2})[^<]*<\/td>\s*<td[^>]*headers="bid"[^>]*>\s*\$\s*([\d,\.]+)/i)
    ?? block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/WINNING\s+([A-Z][a-z]{2} \d{1,2}, 20\d{2})[^$]{0,60}\$\s*([\d,\.]+)/);
  if (!m) return { date: null, bid: null };
  const t = Date.parse(`${m[1]} UTC`);
  const bid = parseFloat(m[2].replace(/,/g, ''));
  return {
    date: isNaN(t) ? null : new Date(t).toISOString().slice(0, 10),
    bid: isFinite(bid) && bid > 0 ? bid : null,
  };
}

/** the settled figure — ONLY from the subject's auction-bid-current block; a
 *  "Winning Bid" printed anywhere else on the page is an anchor miss (logged,
 *  never priced).
 *  NOT a sold gate on its own (verified Sep 2 2026, auctionId 6395702): a lot
 *  that closed with "No bids yet on this item." STILL prints
 *  `Winning Bid: $22,995.00` (its opening/reserve figure). So: a "No bids yet"
 *  bid-history block nulls it, and callers must pair it with real bidding
 *  evidence — the API's bidCount>0, or the WINNING history row (idwalk). */
export function parseWinningBid(html: string): number | null {
  const hist = subjectBlock(html, BID_HISTORY_OPEN, 80000);
  if (hist && /No bids yet/i.test(hist)) return null; // closed without a bid — the printed figure is not a sale
  const block = subjectBlock(html, AUCTION_BID_CURRENT_OPEN, 4000);
  if (!block) {
    if (/Winning Bid/i.test(html) && anchorMisses++ < 5) console.warn('[MLBAuction] page prints "Winning Bid" outside the subject auction-bid-current block — anchor miss (markup change?); treated as unsettled');
    return null;
  }
  const w = block.replace(/<[^>]+>/g, ' ').match(/Winning Bid:?\s*\$\s*([\d,\.]+)/i);
  const n = w ? parseFloat(w[1].replace(/,/g, '')) : NaN;
  return isFinite(n) && n > 0 ? n : null;
}

/** POISON DETECTOR (the NFL idwalk lesson, Aug 30 2026): one exact price on
 *  >20% of a ≥50-row batch of NEW sold rows means the source is echoing a
 *  template/widget constant, not per-lot results. Runs on EVERY write —
 *  the idwalk's incremental flushes included, not just the final one. */
function poisonedBatch(rows: AuctionLot[]): { price: number; n: number } | null {
  if (rows.length < 50) return null;
  const census = new Map<number, number>();
  for (const l of rows) {
    const pv = (l as unknown as { priceUsd?: number; realizedUsd?: number });
    const pr = pv.realizedUsd ?? pv.priceUsd;
    if (typeof pr === 'number') census.set(pr, (census.get(pr) || 0) + 1);
  }
  const top = Array.from(census.entries()).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] > rows.length * 0.2 ? { price: top[0], n: top[1] } : null;
}

/** the WAF here rate-limits: a request burst gets a "Human Verification"
 *  interstitial instead of the lot page. Treat it as a miss (never parse it)
 *  and count CONSECUTIVE hits — every clean page resets the streak to 0 (that
 *  reset is the success signal). A tripped streak no longer ends the run's
 *  fetching outright: the pool pauses once for a cool-down, resets, and goes
 *  again; only after MAX_COOLDOWNS does it stop for the night — skipped lots
 *  simply retry next run (the merge is additive). */
let challengeStreak = 0;
const CHALLENGE_TRIP = 10;
const MAX_COOLDOWNS = 2;
const COOLDOWN_MS = 60_000;
let cooldowns = 0;
let cooling: Promise<void> | null = null;
function challenged(html: string): boolean {
  if (/<title>\s*Human Verification/i.test(html)) { challengeStreak++; return true; }
  challengeStreak = 0; // success → streak reset
  return false;
}
const wafTripped = () => challengeStreak >= CHALLENGE_TRIP;
/** call before every lot-page fetch: true = go ahead. Shared across the pool —
 *  concurrent workers all wait on the same cool-down promise. */
async function wafGate(): Promise<boolean> {
  if (!wafTripped()) return true;
  if (!cooling) {
    if (cooldowns >= MAX_COOLDOWNS) return false; // out of cool-downs: stop fetching for the run
    cooldowns++;
    console.warn(`[MLBAuction] WAF challenge streak reached ${challengeStreak} — cooling down ${COOLDOWN_MS / 1000}s (${cooldowns}/${MAX_COOLDOWNS}) before resuming`);
    cooling = new Promise<void>(r => setTimeout(r, COOLDOWN_MS)).then(() => { challengeStreak = 0; cooling = null; });
  }
  await cooling;
  return !wafTripped();
}

/** the lot page: the real description block + the server-rendered settled
 *  figure (`Winning Bid: $X` prints for the subject lot only when the sale
 *  actually closed with a winner — the sold gate on a reserve-blind API) */
async function readLotPage(id: number | string): Promise<PageRead | null> {
  if (!(await wafGate())) return null;
  const html = await getPage(`${HOST}/iSynApp/auctionDisplay.action?sid=${SID}&auctionId=${id}`);
  if (!html || challenged(html)) return null;
  const d = html.match(/id="auction-description"[^>]*>([\s\S]{0,4000}?)<\/div>/i);
  const desc = d ? decodeHtml(d[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
  // the WINNING history row is the primary figure (per-lot bidding evidence);
  // the printed Winning Bid fills in only when the row is absent — and the
  // API-path caller additionally requires bidCount>0 (toLot's sold branch)
  const row = parseWinningRow(html);
  const winningBid = row.bid ?? parseWinningBid(html);
  return { desc, winningBid, winningDate: row.date };
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
  // --probe: one API call through tonight's transport (plain → browser
  // fallback), print what came back, exit. The CI diagnostic for "api DOWN".
  if (process.argv.includes('--probe')) {
    const j = await getJson(`${HOST}/iSynApp/allAuction.action?sid=${SID}&viewType=api&qMode=open&query=${encodeURIComponent('game used')}&rc=3&rs=0`);
    console.log(`[MLBAuction] probe: ${j ? `OK — ${(j.items || []).length} items via ${browserMode ? 'browser' : 'plain fetch'}: ${(j.items || []).map(i => i.id).join(', ')}` : 'FAILED'}`, JSON.stringify(API_STATS));
    await closeBrowser();
    return;
  }
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
      if (!(await wafGate())) return;
      const html = await getPage(`${HOST}/x/isynmv1/aucd/${r.id}`);
      await new Promise(res => setTimeout(res, delayMs));
      walked++;
      if (html && challenged(html)) return;
      if (walked % 2000 === 0) console.log(`[MLBAuction] idwalk ${walked}/${rows.length} (${kept} kept)`);
      if (!html) return;
      const t = html.match(/<meta property="og:title" content="([^"]*)"/i);
      const title = t ? decodeHtml(t[1]).replace(/\s*\|.*$/, '').trim() : '';
      if (!title || /official mlb auctions/i.test(title) || !GAME_USED_RE.test(title)) return;
      // the settled gate is the WINNING history row (exact timestamp + the
      // bid that won) — the ONLY per-lot evidence a bid was actually placed.
      // The "Winning Bid:" figure is NOT a gate: a no-bid close prints its
      // opening figure there too (see parseWinningBid), and the walk has no
      // API bidCount to lean on. It is used as a cross-check only.
      const row = parseWinningRow(html);
      if (!row.bid || row.bid <= 0) return; // no WINNING row → never a sale
      const bid = row.bid;
      const printed = parseWinningBid(html);
      if (printed != null && Math.abs(printed - bid) > 0.5 && anchorMisses++ < 5) console.warn(`[MLBAuction] idwalk ${r.id}: WINNING row $${bid} ≠ printed Winning Bid $${printed} — keeping the row`);
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
      // INCREMENTAL: the walk is long — persist every 500 keeps, but ONLY
      // after the poison detector clears the batch (a flush used to bypass it)
      if (process.argv.includes('--write') && kept % 500 === 0) {
        const { good } = settledOnly(lots);
        const p = poisonedBatch(good);
        if (p) {
          console.error(`[MLBAuction] ABORT (idwalk flush): $${p.price} repeats on ${p.n}/${good.length} new sold rows — poisoned feed, nothing written.`);
          process.exit(1);
        }
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
    console.log(`[MLBAuction] live candidates: ${cands.length} (api ${liveOk ? 'ok' : 'DOWN'}${browserMode ? ', via browser' : ''})`);
    if (!liveOk) console.error(`[MLBAuction] API DOWN — last answer ${API_STATS.lastStatus || 'none'}: ${API_STATS.lastSnippet || '(empty)'} — prior upcoming rows older than 3 days (or past close) are demoted, not re-served`);
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

  await closeBrowser();
  // ── leg health: the API answering is the whole leg ──
  {
    const apiDown = API_STATS.calls > 0 && API_STATS.ok === 0;
    const reasons: string[] = [];
    if (apiDown) reasons.push(`listing API down: ${API_STATS.fail}/${API_STATS.calls} calls failed (plain + ${API_STATS.browserCalls} browser), last ${API_STATS.lastStatus || '?'} "${API_STATS.lastSnippet.slice(0, 120)}"`);
    else if (process.argv.includes('--live') && !liveOk) reasons.push('live leg not ok');
    if (soldCands.length >= 20 && lots.length === 0 && !wafTripped()) reasons.push(`${soldCands.length} closed candidates, 0 settled`);
    if (wafTripped()) reasons.push('lot-page WAF challenge tripped');
    reportLegHealth({ house: 'mlbauction', ok: reasons.length === 0, fetched: API_STATS.ok + soldCands.length, parsed: lots.length + liveLots.length, settled: lots.length, reason: reasons.join('; ') || null });
  }

  if (process.argv.includes('--write')) {
    const { good, dropped } = settledOnly(lots);
    if (dropped) console.log(`[MLBAuction] dropped ${dropped} unsettled/future-dated lots`);
    // POISON DETECTOR — see poisonedBatch (also runs on every idwalk flush)
    const poison = poisonedBatch(good);
    if (poison) {
      console.error(`[MLBAuction] ABORT: $${poison.price} repeats on ${poison.n}/${good.length} new sold rows — poisoned feed, nothing written.`);
      reportAndExit({ house: "mlbauction", fetched: API_STATS.ok, parsed: good.length + liveLots.length, settled: 0, reason: `poisoned batch: $${poison.price} on ${poison.n}/${good.length} rows` });
    }
    const rep = assertInvariants(good.concat(liveLots));
    if (rep.fatal.length) {
      console.error(`[MLBAuction] refusing to write: ${rep.fatal.length} FATALs`);
      rep.fatal.slice(0, 5).forEach(f => console.error('  ', f));
      reportAndExit({ house: "mlbauction", fetched: API_STATS.ok, parsed: good.length + liveLots.length, settled: 0, reason: `refused write: ${rep.fatal.length} invariant FATALs` });
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
  main().catch(e => { console.error('[MLBAuction] fatal', e); reportAndExit({ house: 'mlbauction', fetched: 0, parsed: 0, settled: 0, reason: `crashed: ${String((e as Error)?.message || e).slice(0, 200)}` }); });
}
