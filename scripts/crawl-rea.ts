// REA (Robert Edward Auctions) crawler — ISOLATED. Writes only the 'rea'
// segment; NOT wired into the nightly matrix or assemble list. Run on-demand:
//   RAY_SKIP_MAIN=1 npx tsx scripts/crawl-rea.ts --start 49990 --end 50010
//   (full backfill: --start 1 --end 210000 ; nightly window: recent id range)
//
// Path (verified Aug 2026): bid.collectrea.com/lots/{id} — server-rendered
// (Laravel/Livewire), robots-allowed (/lots), plain curl 200, sequential
// numeric ids. Structured <dt>/<dd>: Sold For, Year, Auction, Lot #, Category.
// H&S (hugginsandscott.com) runs the same stack + block — crawl-hugginsscott
// reuses this parser with a different URL scheme.
import * as cheerio from 'cheerio';
import type { AuctionLot, LotCategory } from '../app/types';
import { assertInvariants } from '../app/lib/validate';
import { saleCloseFor } from './lib/sale-close-dates';
import { getHtml, decodeHtml, classifySports, pseudoArtist, readAuth, stampRealizedUsd, stampUpcomingUsd, seasonToDate, writeMergedSegment, writeMergedSegmentWithLive, settledOnly, liveOnly, mapPool } from './lib/sports-crawl';
import { readSegment } from './corpus-io';
import { reportLegHealth, reportAndExit } from './lib/leg-health';

const LOT_BASE = 'https://bid.collectrea.com/lots';
// The archive CDN hosts: REA rea-image-archive.nyc3.cdn.digitaloceanspaces.com,
// H&S hs-image-archive.nyc3.cdn.digitaloceanspaces.com (verified Sep 27 2026 —
// the old REA-only pattern left 49,901 H&S rows imageless). The match starts AT
// the host, so the capture is scheme-less — stamp https: on it (the pages
// themselves link the https:// form).
const IMG_HINT = /(?:rea|hs)-image-archive[^"'\s]+\.(?:jpg|jpeg|png|webp)/i;
function archiveImageUrl(html: string): string | null {
  const m = html.match(IMG_HINT);
  if (!m) return null;
  return `https://${m[0].replace(/^(?:https?:)?\/\//i, '')}`;
}
const TODAY = new Date().toISOString().slice(0, 10);

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : def;
}

// REA renders the fields as <dt>/<dd>; H&S (same stack, different template)
// renders them as <li>Label: value</li>. Read BOTH so one parser serves both.
function dtMap($: cheerio.CheerioAPI): Record<string, string> {
  const m: Record<string, string> = {};
  $('dt').each((_, el) => {
    const k = $(el).text().replace(/[:\s]+$/, '').trim().toLowerCase();
    const dd = $(el).next('dd');
    if (k && dd.length) m[k] = dd.text().replace(/\s+/g, ' ').trim();
  });
  $('li').each((_, el) => {
    const txt = $(el).text().replace(/\s+/g, ' ').trim();
    const c = txt.indexOf(':');
    if (c > 0 && c < 30) {
      const k = txt.slice(0, c).trim().toLowerCase();
      const v = txt.slice(c + 1).trim();
      if (k && v && /^(sold for|year|auction|lot #|category|auction category)$/.test(k)) m[k] = m[k] || v;
    }
  });
  return m;
}

/** Parse one REA lot page into an AuctionLot (or null if unsold / unparseable).
 *  Exported so the H&S crawler reuses it on the same markup. */
export function parseReaLot(html: string, id: number | string, house: 'REA' | 'Huggins & Scott' = 'REA', urlOverride?: string): AuctionLot | null {
  const $ = cheerio.load(html);
  const map = dtMap($);

  // REA puts the lot name in <title>; H&S's <title> is generic ("… Auction
  // Archive"), so fall back to the lot-name heading (h3/h1), then the URL slug.
  let rawTitle = ($('title').first().text() || '').replace(/\s*\|\s*REA Archive.*$/i, '').replace(/\s*\|\s*Huggins.*$/i, '').trim();
  if (!rawTitle || /auction archive|^search$/i.test(rawTitle)) {
    const heads = $('h3, h1').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get()
      .filter(t => t && !/^(search|auction|menu|login)$/i.test(t));
    rawTitle = heads.sort((a, b) => b.length - a.length)[0] || '';
  }
  if (!rawTitle && typeof urlOverride === 'string') {
    const slug = urlOverride.split('/').pop() || '';
    rawTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  }
  const title = rawTitle;
  if (!title) return null;

  // Sold For → realized (premium-inclusive). No price = unsold/withdrawn → skip.
  const soldRaw = map['sold for'] || '';
  const soldNum = parseInt(soldRaw.replace(/[^0-9]/g, ''), 10);
  if (!soldNum || soldNum <= 0) return null;

  const catLabel = map['category'] || map['auction category'] || '';
  const auctionLabel = map['auction'] || '';
  // the archive posts only the auction's season/month ("2026 Summer"). The
  // close day comes from the cited close-date table (sale-close-dates.ts):
  // the real close ('day') or a conservative season-end bound ('season'),
  // never after today (a sold row is known by the day it is read). A label
  // the table leaves alone (REA monthly sales, which close inside their
  // month) keeps the mid-month stub flagged datePrecision:'month' so nothing
  // reads it as a real close day (the live bid page carries the real one).
  const close = saleCloseFor(house, auctionLabel, TODAY);
  const saleDate = close ? close.date : (seasonToDate(auctionLabel) || seasonToDate(rawTitle) || null);
  if (!saleDate) return null; // can't date it → skip (invariant needs YYYY-MM-DD)

  const cat = classifySports(catLabel, title);
  const bodyText = $('main').text() || $('body').text() || '';
  const auth = readAuth(cat, title, bodyText.slice(0, 4000));

  const imageUrl = archiveImageUrl(html);

  const idPrefix = house === 'REA' ? 'rea' : 'hugginsscott';
  const url = urlOverride || `${LOT_BASE}/${id}`;

  return {
    id: `${idPrefix}-${id}`,
    artist: pseudoArtist(cat),
    title,
    year: map['year'] ? map['year'].replace(/[^0-9]/g, '') || null : null,
    medium: null,
    dimensions: null,
    description: null,
    platform: null,
    category: 'object' as LotCategory,
    imageUrl,
    auctionHouse: house,
    saleName: auctionLabel || null,
    saleDate,
    datePrecision: close ? close.precision : 'month',
    lotNumber: map['lot #'] ? parseInt(map['lot #'].replace(/[^0-9]/g, ''), 10) || null : null,
    ...stampRealizedUsd(soldNum, saleDate),
    // v2 auth fields (existing schema): the grade + who certified it
    gradeLabel: auth.grade,
    authCert: auth.marks.length ? auth.marks.join(' · ') : null,
    // first-draft confidence flag for the doctrine gate (game-used→photo-match,
    // wax→BBCE, card→slab). Tomorrow's tune decides drop-vs-downweight.
    authConfidence: auth.confidence,
    subCat: cat,
    status: 'sold',
    url,
  } as unknown as AuctionLot;
}

// ── the bid.* Livewire lot page (REA bid.collectrea.com + H&S
// bid.hugginsandscott.com — same stack) ───────────────────────────────────────
// Verified Sep 27 2026 on both hosts. A CLOSED sale keeps serving this same
// live markup (it does NOT flip to the archive for weeks — REA September 2026
// closed Sep 21 and every lot still renders here); the subject lot carries
//   miniCountdown({ lotId, endTime:'2026-09-21T00:09:22-04:00', totalBids, status:'sold' })
//   x-data="{ lotId, currentBid:46000, …, status:'sold', …, soldFor:'56580.00', … }"
// status: live|open|ending = running; 'sold' = settled (the page prints
// "SOLD FOR $56,580 — Includes Buyers Premium"); 'closed' = UNSOLD (the page
// prints "UNSOLD"). soldFor is premium-INCLUSIVE and is byte-for-byte the
// figure the archive later prints as "Sold For" (H&S Summer 2026 lot 1:
// soldFor 72000.00 = archive $72,000; REA: 46,000 × 1.23 = 56,580) — so it is
// stamped on the SAME 'realized' basis as every archive row (stampRealizedUsd).
// The Livewire snapshot's buyersPremium is NOT used: it can include fees the
// archive figure doesn't (REA 200938: 46,000 + 10,810 ≠ 56,580).

const MINI_RE = /miniCountdown\(\{[\s\S]{0,400}?\}\)/;
const CLOUD_IMG_RE = /https?:\/\/res\.cloudinary\.com\/(?:robertedwardauctions|hugginsandscott)\/image\/upload\/[^"'\s]+?\.(?:jpg|jpeg|png|webp)/gi;
/** the subject's gallery image — prefer the untransformed full-size asset
 *  (`/upload/v<ver>/…`) over the 300px c_fill thumbnail strip */
function bidSiteImage(html: string): string | null {
  const all = html.match(CLOUD_IMG_RE) || [];
  return all.find(u => /\/upload\/v\d+\//.test(u)) || all[0] || null;
}
const stripText = (s: string) => decodeHtml(s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export type BidPageRead =
  | { kind: 'live'; lot: AuctionLot }
  | { kind: 'sold'; lot: AuctionLot }
  | { kind: 'unsold'; lot: AuctionLot }
  | { kind: 'unparsed'; why: string };

/** "September 2026" / "Summer 2026" → { word, year, saleName:'2026 September' }
 *  (the archive's own saleName shape, e.g. '2026 June', '2026 Summer') */
function auctionLabel(text: string): { word: string; year: string; saleName: string } | null {
  const m = text.match(/Item was in Auction\s+([A-Za-z]+)\s+(20\d{2})\b/);
  if (!m) return null;
  const word = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  return { word, year: m[2], saleName: `${m[2]} ${word}` };
}

/** Read ONE bid.* lot page: running → upcoming lot; status 'sold' → settled
 *  sale dated from the lot's own endTime; status 'closed' → bought-in (unsold)
 *  row. Anything else is 'unparsed' (with the reason — counted, never silent).
 *  H&S settles under its ARCHIVE id (hugginsscott-{yr}-{season}-{lot#}, the
 *  id the monthly archive crawl mints for the same lot) so a closed live lot
 *  and its archive page can never become two sales. */
export function parseReaBidPage(html: string, id: number | string, house: 'REA' | 'Huggins & Scott' = 'REA', urlOverride?: string): BidPageRead {
  const mc = html.match(MINI_RE);
  if (!mc) return { kind: 'unparsed', why: 'no-countdown' };
  const block = mc[0];
  const status = (block.match(/status:\s*'([a-z_]+)'/) || [])[1] || '';
  const endTime = (block.match(/endTime:\s*'([^']+)'/) || [])[1] || '';
  // the lot's OWN close, in house-local time: its calendar day is the sale day
  const saleDate = endTime.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return { kind: 'unparsed', why: 'no-endTime' };
  const bidCount = parseInt((block.match(/totalBids:\s*(\d+)/) || [])[1] || '0', 10);
  const decoded = html.replace(/&quot;/g, '"');
  const bidM = decoded.match(/"currentBid":\s*([0-9]+(?:\.[0-9]+)?)/);
  const currentBid = bidM ? Math.round(parseFloat(bidM[1])) : 0;

  const $ = cheerio.load(html);
  const title = decodeHtml(($('title').first().text() || '')).replace(/\s*\|\s*(REA|Robert Edward|Huggins).*$/i, '').trim();
  if (!title || /auction archive|^search$|opening soon/i.test(title)) return { kind: 'unparsed', why: 'no-title' };
  const idPrefix = house === 'REA' ? 'rea' : 'hugginsscott';
  const url = urlOverride || `${LOT_BASE}/${id}`;
  const imageUrl = bidSiteImage(html);

  if (/^(live|open|ending)$/.test(status)) {
    const cat = classifySports('', title);
    const auth = readAuth(cat, title, ($('main').text() || $('body').text() || '').slice(0, 4000));
    return { kind: 'live', lot: {
      id: `${idPrefix}-${id}`,
      artist: pseudoArtist(cat),
      title,
      year: null, medium: null, dimensions: null, description: null, platform: null,
      category: 'object' as LotCategory,
      imageUrl,
      auctionHouse: house,
      saleName: null,
      saleDate,
      saleDateTime: endTime || null, // ISO with house-local offset; Date-parseable
      lotNumber: null,
      ...stampUpcomingUsd(saleDate),
      currentBid, bidCount,
      gradeLabel: auth.grade,
      authCert: auth.marks.length ? auth.marks.join(' · ') : null,
      authConfidence: auth.confidence,
      subCat: cat,
      status: 'upcoming',
      firstSeen: TODAY,
      url,
    } as unknown as AuctionLot };
  }

  if (status !== 'sold' && status !== 'closed') return { kind: 'unparsed', why: `status:${status || '?'}` };
  if (saleDate > TODAY) return { kind: 'unparsed', why: 'closed-but-future-endTime' };

  // settled / unsold: the closed page's own header + description
  const text = stripText(html);
  const lab = auctionLabel(text);
  const lotNumM = text.match(/Lot #\s*(\d+)\s*:/);
  const lotNumber = lotNumM ? parseInt(lotNumM[1], 10) : null;
  const descM = html.match(/<h2[^>]*>\s*Description\s*<\/h2>\s*<div[^>]*>([\s\S]{0,8000}?)<\/div>/i);
  const description = descM ? stripText(descM[1]).slice(0, 4000) : '';
  let rowId = `${idPrefix}-${id}`;
  if (house === 'Huggins & Scott') {
    if (!lab || lotNumber == null) return { kind: 'unparsed', why: 'hs-no-archive-key' };
    rowId = `hugginsscott-${lab.year}-${lab.word.toLowerCase()}-${lotNumber}`;
  }
  const cat = classifySports('', title);
  const auth = readAuth(cat, title, description);
  const base = {
    id: rowId,
    artist: pseudoArtist(cat),
    title,
    year: null, medium: null, dimensions: null,
    description: null,
    platform: null,
    category: 'object' as LotCategory,
    imageUrl,
    auctionHouse: house,
    saleName: lab ? lab.saleName : null,
    saleDate,
    saleDateTime: endTime,
    lotNumber,
    bidCount,
    gradeLabel: auth.grade,
    authCert: auth.marks.length ? auth.marks.join(' · ') : null,
    authConfidence: auth.confidence,
    subCat: cat,
    url,
  };

  if (status === 'closed') {
    // UNSOLD: a real closed-without-sale record (not a price) — it retires the
    // upcoming row by id and tells the corpus the lot passed
    return { kind: 'unsold', lot: { ...base, id: rowId, ...stampUpcomingUsd(saleDate), status: 'bought_in' } as unknown as AuctionLot };
  }

  // SOLD: the subject's own x-data block (anchored on ITS lotId) carries
  // soldFor — premium-inclusive, the archive's "Sold For"
  const sub = html.match(new RegExp(`lotId:\\s*${String(id).replace(/[^0-9]/g, '')},[\\s\\S]{0,400}?soldFor:\\s*'([0-9]+(?:\\.[0-9]+)?)'`));
  const soldFor = sub ? Math.round(parseFloat(sub[1])) : 0;
  if (!soldFor || soldFor <= 0) return { kind: 'unparsed', why: 'sold-without-soldFor' };
  if (currentBid > 0 && soldFor < currentBid) return { kind: 'unparsed', why: `soldFor ${soldFor} < hammer ${currentBid}` };
  return { kind: 'sold', lot: { ...base, ...stampRealizedUsd(soldFor, saleDate), status: 'sold' } as unknown as AuctionLot };
}

/** Back-compat: the LIVE-only reader (null for anything not running). */
export function parseReaLive(html: string, id: number | string, house: 'REA' | 'Huggins & Scott' = 'REA', urlOverride?: string): AuctionLot | null {
  const r = parseReaBidPage(html, id, house, urlOverride);
  return r.kind === 'live' ? r.lot : null;
}

export interface ReaLiveResult {
  live: AuctionLot[];
  /** settled rows (sold + bought_in) for the segment */
  resolved: AuctionLot[];
  ok: boolean;
  stats: { gridIds: number; fetched: number; live: number; sold: number; unsold: number; known: number; unparsed: number; resolveTried: number; resolveFetched: number; resolveSettled: number; reason: string | null;
    /** set ONLY when the site positively says no auction is running (see
     *  betweenSalesNote) — a healthy empty grid, reported ok with this note */
    betweenSales?: string | null };
}

/** The bid.* site's own auction gate, read off the /lots shell. Between sales
 *  the Livewire stack renders (verified Oct 3 2026 on BOTH bid.collectrea.com
 *  and bid.hugginsandscott.com, after REA Sep 2026 + H&S Summer 2026 closed):
 *    x-data="{ status: 'pending', showTimer: true }"
 *    <h1 class="mb-4">Our October 2026 Auction Is Opening Soon.</h1>
 *    … let countDownDate = new Date(1791475200 * 1000) …
 *  and no /lots/{id} link at all. A running sale renders its lot grid under a
 *  non-pending status instead. */
export function readAuctionGate(html: string): { status: string | null; saleName: string | null; opensAt: string | null } {
  const st = html.match(/x-data="\{\s*status:\s*'([a-z_]+)'/i);
  const name = html.match(/<h1[^>]*>\s*Our\s+([^<]{2,80}?)\s+Is\s+Opening\s+Soon\.?\s*<\/h1>/i);
  const cd = html.match(/countDownDate\s*=\s*new Date\(\s*(\d{9,11})\s*\*\s*1000\s*\)/);
  return {
    status: st ? st[1].toLowerCase() : null,
    saleName: name ? decodeHtml(name[1]).replace(/\s+/g, ' ').trim() : null,
    opensAt: cd ? new Date(parseInt(cd[1], 10) * 1000).toISOString() : null,
  };
}

/** POSITIVE "no current auction" read: non-null ONLY when the site itself says
 *  the next sale has not opened — status 'pending' AND the "… Is Opening Soon"
 *  heading, no lot link on the page, and the countdown (when printed) has not
 *  run out more than a day ago (a sale that should be open but still shows an
 *  empty grid is the silent zero, not a quiet week). Anything else — a
 *  live/open/closed status, a missing heading, an unreadable shell — returns
 *  null and an empty grid stays ok=false. */
export function betweenSalesNote(html: string | null, now: number = Date.now()): string | null {
  if (!html) return null;
  if (/\/lots\/\d+/.test(html)) return null; // a grid that lists lots is not between sales
  const g = readAuctionGate(html);
  if (g.status !== 'pending' || !g.saleName) return null;
  if (g.opensAt && Date.parse(g.opensAt) < now - 86_400_000) return null;
  const when = g.opensAt ? g.opensAt.slice(0, 10) : null;
  return `between sales (next: ${when ? `${g.saleName} opens ${when}` : g.saleName})`;
}

/** Enumerate + fetch the CURRENT auction's lots off a bid.* Livewire site.
 *  The /lots grid is server-paginated and honors plain ?page=N GETs (12/page,
 *  stable order); ids are NOT contiguous, so the listing — not an id window —
 *  is the enumerator. REA's September 2026 grid runs ~385 pages (4.6K lots):
 *  the old 200-page cap silently truncated it at 2,400.
 *
 *  Every listed lot page is read with parseReaBidPage: running → upcoming;
 *  'sold' → settled sale at soldFor, dated from its own endTime; 'closed' →
 *  bought_in. A closed sale's grid keeps listing its lots for weeks, so THIS
 *  is where closed sales settle (the Sep 27 audit found ~4,750 REA/H&S sales
 *  lost because only live|open|ending parsed and the rest read as "nothing").
 *  Lots whose BID id the segment already holds as a settled row (see
 *  settledBidIds) are skipped — a settled sale never changes — and count
 *  toward the gate.
 *
 *  `resolve` then re-reads prior upcoming (and stale unknown-result) ids that
 *  tonight's pass did NOT settle — gone from the grid, or listed but their
 *  page fetch failed — through the same reader, falling back to the archive
 *  parser when the id has flipped to collectrea.com/archives/….
 *
 *  `ok` (the live-replace gate) is EARNED, not assumed:
 *   - grid unreachable → ok=false
 *   - grid answered with 0 ids → ok=false (resolve still runs)
 *   - lot pages fetched but NOTHING recognized (live/sold/unsold/known) → ok=false */
export async function crawlReaLive(
  site: string,
  house: 'REA' | 'Huggins & Scott',
  prevOpen: AuctionLot[],
  knownBidIds: Set<string> = new Set(),
): Promise<ReaLiveResult> {
  const ids = new Set<string>();
  let gridReached = false;
  let firstGridHtml: string | null = null;
  const MAX_GRID_PAGES = 1000; // 12/page → 12K lots; REA Sep 2026 ≈ 385 pages
  let page = 1;
  for (; page <= MAX_GRID_PAGES; page++) {
    const html = await getHtml(`${site}/lots?page=${page}`);
    if (!html) break;
    gridReached = true;
    if (page === 1) firstGridHtml = html;
    const before = ids.size;
    for (const m of Array.from(html.matchAll(/\/lots\/(\d+)/g))) ids.add(m[1]);
    if (ids.size === before) break; // page past the end repeats/empties → done
    await new Promise(r => setTimeout(r, 150));
  }
  if (page > MAX_GRID_PAGES) console.warn(`[${house}] live grid hit the ${MAX_GRID_PAGES}-page cap — enumeration may be truncated`);
  console.log(`[${house}] live grid: ${ids.size} lot ids${gridReached ? '' : ' (grid unreachable)'}`);

  const idPrefix = house === 'REA' ? 'rea' : 'hugginsscott';
  const stats: ReaLiveResult['stats'] = { gridIds: ids.size, fetched: 0, live: 0, sold: 0, unsold: 0, known: 0, unparsed: 0, resolveTried: 0, resolveFetched: 0, resolveSettled: 0, reason: null, betweenSales: null };
  const unparsedWhy: Record<string, number> = {};
  const noteUnparsed = (why: string) => { stats.unparsed++; unparsedWhy[why] = (unparsedWhy[why] || 0) + 1; };
  const resolved: AuctionLot[] = [];
  const settledRaw = new Set<string>(); // raw bid ids settled (or known) tonight
  const knownRaw = knownBidIds; // bid ids the segment already holds settled

  const live = !gridReached ? [] : (await mapPool(Array.from(ids), 3, async (id) => {
    if (knownRaw.has(id)) { stats.known++; settledRaw.add(id); return null; }
    const url = `${site}/lots/${id}`;
    const html = await getHtml(url);
    if (!html) return null;
    stats.fetched++;
    await new Promise(r => setTimeout(r, 120));
    try {
      const r = parseReaBidPage(html, id, house, url);
      if (r.kind === 'live') { stats.live++; return r.lot; }
      if (r.kind === 'sold') { stats.sold++; resolved.push(r.lot); settledRaw.add(id); return null; }
      if (r.kind === 'unsold') { stats.unsold++; resolved.push(r.lot); settledRaw.add(id); return null; }
      // not the bid markup at all → the id already flipped to the archive
      const arch = parseReaLot(html, id, house, url);
      if (arch) { stats.sold++; resolved.push(arch); settledRaw.add(id); return null; }
      noteUnparsed(r.why);
      return null;
    } catch (e) { noteUnparsed(`threw:${(e as Error)?.message?.slice(0, 40) || e}`); return null; }
  }, `${house} live`)).filter((x): x is AuctionLot => !!x);
  console.log(`[${house}] live pages: fetched ${stats.fetched}/${ids.size - stats.known} (+${stats.known} already settled, skipped) · live ${stats.live} · sold ${stats.sold} · unsold ${stats.unsold} · unparsed ${stats.unparsed}${stats.unparsed ? ' ' + JSON.stringify(unparsedWhy) : ''}`);

  let ok = true;
  if (!gridReached) { ok = false; stats.reason = 'live grid unreachable'; console.error(`[${house}] live grid unreachable — NOT ok; prior upcoming snapshot rides (stale rows age out)`); }
  else if (ids.size === 0) {
    // `ok` here is the live-REPLACE gate and stays false either way: an empty
    // snapshot must never evict prior rows (they demote + keep resolving).
    // Leg HEALTH differs: an empty grid the site itself explains is healthy.
    ok = false;
    const note = betweenSalesNote(firstGridHtml);
    if (note) { stats.betweenSales = note; console.log(`[${house}] live grid empty — ${note}; healthy (prior upcoming rows still demote + resolve)`); }
    else { stats.reason = 'live grid returned 0 lot ids'; console.warn(`[${house}] live grid returned 0 lot ids and the site does NOT say it is between sales — NOT ok; prior upcoming snapshot rides (stale rows age out)`); }
  }
  else if (stats.live + stats.sold + stats.unsold + stats.known === 0) {
    ok = false;
    stats.reason = `grid listed ${ids.size} ids, ${stats.fetched} pages fetched, 0 recognized (${JSON.stringify(unparsedWhy)})`;
    console.error(`[${house}] live grid listed ${ids.size} ids but ${stats.fetched} fetched pages parsed to NOTHING — NOT ok (markup change or wall?); prior upcoming snapshot rides`);
  }

  // resolve: prior open ids tonight's pass did not settle or see live
  const liveRaw = new Set(live.map(l => l.id.slice(idPrefix.length + 1)));
  const gone = prevOpen.filter(l => {
    if (!l.id.startsWith(`${idPrefix}-`)) return false;
    const raw = rawBidId(l, idPrefix);
    return !!raw && !liveRaw.has(raw) && !settledRaw.has(raw) && !knownRaw.has(raw);
  });
  stats.resolveTried = gone.length;
  const resolvedGone = (await mapPool(gone, 3, async (prev) => {
    const rawId = rawBidId(prev, idPrefix)!;
    const url = (prev as { url?: string }).url || `${site}/lots/${rawId}`;
    const html = await getHtml(url);
    if (!html) return null;
    stats.resolveFetched++;
    await new Promise(r => setTimeout(r, 120));
    try {
      const r = parseReaBidPage(html, rawId, house, url);
      if (r.kind === 'sold' || r.kind === 'unsold') return r.lot;
      if (r.kind === 'live') { live.push(r.lot); return null; } // still running, just off the grid
      return parseReaLot(html, rawId, house, url);
    } catch { return null; }
  }, `${house} resolve`)).filter((x): x is AuctionLot => !!x);
  stats.resolveSettled = resolvedGone.length;
  if (gone.length) console.log(`[${house}] resolve: ${gone.length} open ids not settled on the grid → ${stats.resolveFetched} fetched → ${resolvedGone.length} settled`);
  return { live, resolved: resolved.concat(resolvedGone), ok, stats };
}

/** the bid-site id behind a segment row: REA rows ARE `rea-{bidId}`; H&S
 *  upcoming rows are `hugginsscott-{bidId}` too, but read the url to be sure */
function rawBidId(l: AuctionLot, idPrefix: string): string | null {
  const u = (l as { url?: string }).url || '';
  const m = u.match(/\/lots\/(\d+)/);
  if (m) return m[1];
  const rest = l.id.slice(idPrefix.length + 1);
  return /^\d+$/.test(rest) ? rest : null;
}

/** bid-site ids the segment already holds SETTLED (sold / bought_in rows whose
 *  url is a bid.* /lots/{id} page) — the live pass never re-fetches these.
 *  H&S archive rows (hugginsandscott.com/auction/… urls) are deliberately not
 *  in here: the first closed-grid read re-dates them from the month stub to
 *  the lot's real endTime, after which their url is the bid page. */
export function settledBidIds(rows: AuctionLot[]): Set<string> {
  const out = new Set<string>();
  for (const l of rows) {
    const st = (l as { status?: string }).status;
    if (st !== 'sold' && st !== 'bought_in') continue;
    const m = ((l as { url?: string }).url || '').match(/\/\/bid\.[^/]+\/lots\/(\d+)/);
    if (m) out.add(m[1]);
  }
  return out;
}

/** prior rows the resolve pass should try to settle: tonight's-open
 *  'upcoming' rows, plus rows a failed night demoted to 'unknown-result'
 *  (writeMergedSegmentWithLive's stale gate) within the last 60 days */
export function openRowsForResolve(rows: AuctionLot[]): AuctionLot[] {
  const cut = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  return rows.filter(l => {
    const st = (l as { status?: string }).status;
    if (st === 'upcoming') return true;
    return st === 'unknown-result' && String((l as { staleSince?: string }).staleSince || l.saleDate || '') >= cut;
  });
}

/** dry-run / log evidence: settled counts per sale + a few priced samples */
export function summarizeSettled(label: string, rows: AuctionLot[]): void {
  if (!rows.length) return;
  const bySale: Record<string, { sold: number; unsold: number; usd: number }> = {};
  for (const l of rows) {
    const k = `${l.saleName || '?'}`;
    const b = bySale[k] || (bySale[k] = { sold: 0, unsold: 0, usd: 0 });
    if (l.status === 'sold') { b.sold++; b.usd += (l as { realizedUsd?: number }).realizedUsd || 0; } else b.unsold++;
  }
  for (const [k, v] of Object.entries(bySale)) console.log(`[${label}] settled · ${k}: ${v.sold} sold ($${Math.round(v.usd).toLocaleString('en-US')} realized), ${v.unsold} unsold`);
  const sold = rows.filter(l => l.status === 'sold');
  const step = Math.max(1, Math.floor(sold.length / 5));
  for (let i = 0; i < sold.length && i < step * 5; i += step) {
    const l = sold[i] as AuctionLot & { realizedUsd?: number; saleDateTime?: string };
    console.log(`[${label}] sample ${l.id} lot ${l.lotNumber ?? '?'} $${l.realizedUsd} ${l.saleDate} (${l.saleDateTime}) ${l.url} — ${l.title.slice(0, 60)}`);
  }
}

/** one leg-health record for an REA-stack leg (live grid + optional archive) */
export function reportReaLegHealth(house: string, st: ReaLiveResult['stats'] | null, archive: { fetched: number; parsed: number; settled?: number; reason?: string | null } = { fetched: 0, parsed: 0 }): void {
  const fetched = (st ? st.fetched + st.resolveFetched : 0) + archive.fetched;
  const parsed = (st ? st.live + st.sold + st.unsold + st.resolveSettled : 0) + archive.parsed;
  const settled = (st ? st.sold + st.unsold + st.resolveSettled : 0) + (archive.settled ?? archive.parsed);
  const reasons: string[] = [];
  if (st && st.reason) reasons.push(st.reason);
  if (archive.reason) reasons.push(archive.reason);
  // a resolve that fetched pages for open ids and settled none of them is the
  // exact Sep 2026 silent zero — even on a night the grid itself looked ok
  if (st && st.resolveFetched >= 20 && st.resolveSettled === 0) reasons.push(`resolve fetched ${st.resolveFetched} closed-lot pages and settled 0`);
  const ok = reasons.length === 0;
  reportLegHealth({ house, ok, fetched, parsed, settled, reason: ok ? (st?.betweenSales || null) : reasons.join('; ') });
}

async function main() {
  const live = process.argv.includes('--live');
  const windowGiven = process.argv.includes('--start') || process.argv.includes('--end');
  const start = arg('start', 49990);
  const end = arg('end', 50010);
  const delayMs = arg('delay', 250);
  const lots: AuctionLot[] = [];
  let hit = 0, miss = 0;
  // --live without an explicit window skips the archive sweep: the deep archive
  // is fully harvested, and NEW sold history arrives via the live-leg resolve.
  if (!live || windowGiven) {
    console.log(`[REA] crawling lots ${start}..${end}`);
    for (let id = start; id <= end; id++) {
      const html = await getHtml(`${LOT_BASE}/${id}`);
      if (!html) { miss++; continue; }
      try {
        const lot = parseReaLot(html, id);
        if (lot) { lots.push(lot); hit++; } else miss++;
      } catch { miss++; }
      if ((id - start) % 25 === 0 && id > start) console.log(`  …${id} (${hit} sold, ${miss} skipped)`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.log(`[REA] parsed ${lots.length} sold lots (${miss} skipped)`);

  // ── live leg: snapshot the running auction's lots as status:'upcoming' ────
  let liveLots: AuctionLot[] = [];
  let liveOk = false;
  let liveStats: ReaLiveResult['stats'] | null = null;
  if (live) {
    const seg = readSegment('rea') as unknown as AuctionLot[];
    const r = await crawlReaLive('https://bid.collectrea.com', 'REA', openRowsForResolve(seg), settledBidIds(seg));
    liveOk = r.ok;
    liveStats = r.stats;
    lots.push(...r.resolved); // closed lots: settled sales (sold) + passed (bought_in)
    const { good, dropped } = liveOnly(r.live);
    if (dropped) console.log(`[REA] dropped ${dropped} malformed live lots`);
    liveLots = good;
    console.log(`[REA] live: ${liveLots.length} upcoming lots, ${r.resolved.length} settled (grid ${liveOk ? 'ok' : r.stats.betweenSales ? 'empty, between sales — prior rows demote + resolve' : 'FAILED — keeping prior snapshot, stale rows age out'})`);
    summarizeSettled('REA', r.resolved);
  }

  const report = assertInvariants(lots.concat(liveLots));
  console.log(`[REA] invariant FATALs: ${report.fatal.length} | warns: ${report.warn.length}`);
  report.fatal.slice(0, 8).forEach(f => console.error('  FATAL', f));

  const byCat: Record<string, number> = {};
  const byConf: Record<string, number> = {};
  for (const l of lots) {
    const c = (l as { subCat?: string }).subCat || '?'; byCat[c] = (byCat[c] || 0) + 1;
    const cf = (l as { authConfidence?: string }).authConfidence || '?'; byConf[cf] = (byConf[cf] || 0) + 1;
  }
  console.log('[REA] by category:', byCat);
  console.log('[REA] by auth-confidence:', byConf);

  reportReaLegHealth('rea', liveStats, { fetched: hit + miss, parsed: hit });

  if (process.argv.includes('--write')) {
    const { good, dropped } = settledOnly(lots);
    if (dropped) console.log(`[REA] dropped ${dropped} unsettled/future-dated lots`);
    const rep = assertInvariants(good.concat(liveLots));
    if (rep.fatal.length) {
      console.error(`[REA] refusing to write: ${rep.fatal.length} FATALs remain after filtering`); rep.fatal.slice(0, 5).forEach(f => console.error('  ', f));
      reportAndExit({ house: 'rea', fetched: (liveStats?.fetched || 0) + hit + miss, parsed: lots.length + liveLots.length, settled: 0, reason: `refused write: ${rep.fatal.length} invariant FATALs` });
    }
    const r = live
      ? writeMergedSegmentWithLive('rea', good, liveLots, liveOk)
      : { ...writeMergedSegment('rea', good), upcoming: undefined as number | undefined };
    console.log(`[REA] merged into segment 'rea': +${r.added} new, ${r.total} total${r.upcoming !== undefined ? `, ${r.upcoming} upcoming` : ''}.`);
  } else {
    console.log('[REA] dry run (pass --write to persist the isolated segment)');
    const s = lots.find(l => l.status === 'sold');
    if (s) console.log('[REA] sample:', JSON.stringify({ id: s.id, artist: s.artist, title: s.title.slice(0, 50), saleDate: s.saleDate, priceUsd: (s as { priceUsd?: number }).priceUsd, grade: (s as { gradeLabel?: string }).gradeLabel, cert: (s as { authCert?: string }).authCert }, null, 0));
    const u = liveLots[0];
    if (u) console.log('[REA] live sample:', JSON.stringify({ id: u.id, title: u.title.slice(0, 50), saleDate: u.saleDate, currentBid: (u as { currentBid?: number }).currentBid, bidCount: (u as { bidCount?: number }).bidCount }, null, 0));
  }
}

// run main() ONLY when executed directly — importing parseReaLot (crawl-
// hugginsscott, backfill-rea) must NOT spawn a competing crawl.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('[REA] fatal', e); reportAndExit({ house: 'rea', fetched: 0, parsed: 0, settled: 0, reason: `crashed: ${String((e as Error)?.message || e).slice(0, 200)}` }); });
}
