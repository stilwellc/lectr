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
import type { AuctionLot, LotCategory } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import {
  getHtml, decodeHtml, classifySports, pseudoArtist, readAuth,
  stampRealizedUsd, stampUpcomingUsd, writeMergedSegment,
  writeMergedSegmentWithLive, settledOnly, liveOnly, installCrashGuard,
  REAL_UA, mapPool,
} from './lib/sports-crawl';
import { readSegment } from './corpus-io';

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
  const saleDate = iso.slice(0, 10);
  const cat = classifySports('', ident.title);
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
    return { ...base, status: 'sold', ...stampRealizedUsd(bid, saleDate) } as unknown as AuctionLot;
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

  // ── SOLD — the closed archive, nominated by query, decided on full title ──
  const closedRaw = new Map<number, ApiItem>();
  for (const q of QUERIES) {
    for (const it of await pageThrough('closed', q, closedPages, delayMs)) closedRaw.set(it.id, it);
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

  if (process.argv.includes('--write')) {
    const { good, dropped } = settledOnly(lots);
    if (dropped) console.log(`[NFLAuction] dropped ${dropped} unsettled/future-dated lots`);
    const rep = assertInvariants(good.concat(liveLots));
    if (rep.fatal.length) {
      console.error(`[NFLAuction] refusing to write: ${rep.fatal.length} FATALs`);
      rep.fatal.slice(0, 5).forEach(f => console.error('  ', f));
      process.exit(1);
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
  main().catch(e => { console.error('[NFLAuction] fatal', e); process.exit(1); });
}
