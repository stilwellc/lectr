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
  REAL_UA, mapPool,
} from './lib/sports-crawl';
import { readSegment } from './corpus-io';
import * as fs from 'fs';
import * as path from 'path';

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
      process.exit(1);
    }
  }

  // ── IDWALK — RETIRED (Aug 30 2026). The mode's price extraction was
  // unsound: the first "Current Bid: $X" on an archived lot page belongs to
  // the sidebar Hot-Items widget as often as the subject, which minted 3,895
  // fake sales sharing a handful of widget prices ($10,050 ×3,622 …) — 70% of
  // the NFL sold corpus, healed by scripts/heal-nflauction-idwalk.ts. Closed
  // pages render true amounts via JS only; there is no honest server-side
  // price for these ids. Never re-enable without a verified per-lot source.
  if (process.argv.includes('--idwalk')) {
    console.error('[NFLAuction] --idwalk is RETIRED: its price scrape read the Hot-Items widget, not the lot. See scripts/heal-nflauction-idwalk.ts.');
    process.exit(1);
  }
  if (false) {
    const manifest = path.join(process.cwd(), 'scripts', 'data', 'nflauction-wayback-ids.csv');
    const rows = fs.readFileSync(manifest, 'utf8').trim().split('\n').slice(1)
      .map(l => { const [id, ts] = l.split(','); return { id: Number(id), ts }; })
      .filter(r => r.id > 0 && !haveSold.has(`nflauction-${r.id}`));
    console.log(`[NFLAuction] idwalk: ${rows.length} unknown historical ids`);
    let walked = 0, kept = 0;
    await mapPool(rows, conc, async (r) => {
      const html = await getHtml(`${HOST}/x/isynmv1/aucd/${r.id}`);
      await new Promise(res => setTimeout(res, delayMs));
      walked++;
      if (walked % 2000 === 0) console.log(`[NFLAuction] idwalk ${walked}/${rows.length} (${kept} kept)`);
      if (!html) return;
      const t = html.match(/<meta property="og:title" content="([^"]*)"/i);
      const title = t ? decodeHtml(t[1]).replace(/\s*\|.*$/, '').trim() : '';
      if (!title || /official auction site/i.test(title) || !GAME_USED_RE.test(title)) return;
      // the SUBJECT lot's finalized flag is the first FinalStatus on the page
      const fin = html.match(/FinalStatus">([YN])/);
      if (!fin || fin[1] !== 'Y') return; // not finalized → not a settled sale
      const txt = html.replace(/<[^>]+>/g, ' ');
      const bidM = txt.match(/Current Bid\s*:?\s*\$\s*([\d,\.]+)/);
      const bid = bidM ? parseFloat(bidM[1].replace(/,/g, '')) : null;
      if (!bid || bid <= 0) return; // no verified final price → never a sale
      const d = html.match(/<meta (?:property="og:description"|name="description") content="([^"]*)"/i);
      const cat = classifySports('', title);
      const auth = readAuth(cat, title, d ? decodeHtml(d[1]) : '');
      // first-capture month, day 15 — month-grade honesty, exact dates win via haveSold
      const saleDate = `${r.ts.slice(0, 4)}-${r.ts.slice(4, 6)}-15`;
      if (saleDate > TODAY) return;
      const lot = {
        id: `nflauction-${r.id}`,
        artist: pseudoArtist(cat), title,
        category: 'object' as LotCategory,
        auctionHouse: 'NFL Auction' as AuctionLot['auctionHouse'],
        saleName: 'NFL Auction', saleDate,
        sport: 'Football', subCat: cat,
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
        if (good.length) writeMergedSegment('nflauction', good);
      }
    });
    console.log(`[NFLAuction] idwalk done: ${kept} finalized game-used sales recovered from ${walked} ids`);
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
