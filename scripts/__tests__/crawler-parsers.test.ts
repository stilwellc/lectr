/**
 * Crawler parsers against SAVED pages (scripts/__tests__/fixtures/, captured
 * Sep 28 2026 with a desktop Chrome UA; <script>/<style>/<svg>/comments
 * stripped — the trimmed file parses byte-identically to the full page).
 *
 *   rea-bid-190709-sold.html            bid.collectrea.com/lots/190709 (REA Sep 2026, settled)
 *   hs-bid-16901-sold.html              bid.hugginsandscott.com/lots/16901 (H&S Summer 2026, settled)
 *   hs-archive-2026-summer-page1.html   hugginsandscott.com/auction/2026/summer/?page=1 (month index)
 *   hs-archive-2026-summer-3.html       one archive lot page from that month
 *   mlb-api-items.json                  auctions.mlb.com listing API items (closed + open), 3 real items
 *   mlb-lot-6428490-ended.html          an ended MLB lot page (subject blocks + one related-lot card)
 *   bidsquare-scp-5997288-sold.html     SCP (Bidsquare) settled lot
 *   bidsquare-hakes-9830701-live.html   Hake's (Bidsquare) live lot
 *   createauction-lotg-gallery.html     Love of the Game /Lots/Gallery — 4 cards incl. a WITHDRAWN one
 *
 * No REA/H&S lot was live or unsold at capture time (both sales had closed),
 * so the 'live' and 'closed' (unsold) states are the captured page with ONLY
 * the countdown status word swapped — the parser branches on that word alone.
 * Dates that the parsers compare against TODAY are shifted in-test (never in
 * the fixture) so the suite does not rot when the live sale ends.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseReaBidPage, parseReaLive, parseReaLot } from '../crawl-rea';
import { monthLotLinks, idFromUrl, monthIndexRank } from '../crawl-hugginsscott';
import { parseApi, closeIso, toLot, parseWinningRow, parseWinningBid, type ApiItem } from '../crawl-mlbauction';
import {
  parseBidsquareSold, parseBidsquareLive, subjectPrice, eventStatus, eventName, parseEstimate, ldProduct,
  ANCHOR_STATS, type BidsquareHouse,
} from '../lib/bidsquare';
import { buildLot, buildLiveLot, extractLiveCards, HOUSES, type RawLot } from '../crawl-createauction';

const FX = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures');
const fx = (f: string) => fs.readFileSync(path.join(FX, f), 'utf8');
type Row = Record<string, any>;

// ── REA / H&S bid.* Livewire lot page ───────────────────────────────────────
const REA = fx('rea-bid-190709-sold.html');
const HS = fx('hs-bid-16901-sold.html');
const withStatus = (html: string, s: string) => html.replace(/status:\s*'sold'/g, `status: '${s}'`);

test('REA bid page, SOLD: settled at the subject soldFor (premium-inclusive), dated from its own endTime', () => {
  const r = parseReaBidPage(REA, 190709, 'REA', 'https://bid.collectrea.com/lots/190709');
  assert.equal(r.kind, 'sold');
  const l = (r as { lot: Row }).lot;
  assert.equal(l.id, 'rea-190709');
  assert.equal(l.title, '1985 Star Company Basketball "Gatorade Slam Dunk" #7 Michael Jordan PSA NM-MT 8');
  assert.equal(l.status, 'sold');
  assert.equal(l.auctionHouse, 'REA');
  assert.equal(l.saleName, '2026 September');
  assert.equal(l.saleDate, '2026-09-20');
  assert.equal(l.saleDateTime, '2026-09-20T22:27:24-04:00');
  assert.equal(l.lotNumber, 10);
  assert.equal(l.bidCount, 117);
  assert.equal(l.realizedUsd, 70725);
  assert.equal(l.priceUsd, 70725);
  assert.equal(l.premiumNative, 70725);
  assert.equal(l.hammerNative, null);
  assert.equal(l.priceBasis, 'realized');
  assert.equal(l.gradeLabel, 'PSA NM-MT 8');
  assert.equal(l.authCert, 'PSA');
  assert.equal(l.subCat, 'graded-card');
  assert.equal(l.artist, 'graded-cards');
  assert.equal(l.imageUrl, 'https://res.cloudinary.com/robertedwardauctions/image/upload/v1783014031/2026-September/190709-1.jpg');
  assert.equal(l.datePrecision, undefined, 'exact close day — not month precision');
  assert.equal(parseReaLive(REA, 190709), null, 'the live-only reader ignores a settled page');
  assert.equal(parseReaLot(REA, 190709), null, 'the archive parser does not misread the bid markup');
});

test('REA bid page, CLOSED (unsold): a bought_in row with no price', () => {
  const r = parseReaBidPage(withStatus(REA, 'closed'), 190709, 'REA');
  assert.equal(r.kind, 'unsold');
  const l = (r as { lot: Row }).lot;
  assert.equal(l.id, 'rea-190709');
  assert.equal(l.status, 'bought_in');
  assert.equal(l.saleDate, '2026-09-20');
  assert.equal(l.realizedUsd, null);
  assert.equal(l.priceUsd, null);
});

test('REA bid page, LIVE: an upcoming row carrying the current bid + bid count, no realized money', () => {
  for (const s of ['live', 'open', 'ending']) {
    const r = parseReaBidPage(withStatus(REA, s), 190709, 'REA');
    assert.equal(r.kind, 'live', s);
    const l = (r as { lot: Row }).lot;
    assert.equal(l.status, 'upcoming');
    assert.equal(l.currentBid, 57500);
    assert.equal(l.bidCount, 117);
    assert.equal(l.saleDate, '2026-09-20');
    assert.equal(l.saleDateTime, '2026-09-20T22:27:24-04:00');
    assert.equal(l.realizedUsd, null);
    assert.equal(l.priceUsd, null);
  }
  assert.equal(parseReaLive(withStatus(REA, 'live'), 190709)?.id, 'rea-190709');
});

test('REA bid page: unknown status / no countdown / soldFor not anchored on the subject → unparsed with a reason', () => {
  assert.deepEqual(parseReaBidPage(withStatus(REA, 'paused'), 190709), { kind: 'unparsed', why: 'status:paused' });
  assert.deepEqual(parseReaBidPage('<html><title>x</title></html>', 190709), { kind: 'unparsed', why: 'no-countdown' });
  // the soldFor read is anchored on the SUBJECT lotId: a page whose x-data
  // belongs to another lot never prices this one
  const other = REA.replace(/lotId:\s*190709/g, 'lotId: 190710').replace(/miniCountdown\(\{\s*lotId: 190710/, 'miniCountdown({ lotId: 190709');
  assert.deepEqual(parseReaBidPage(other, 190709), { kind: 'unparsed', why: 'sold-without-soldFor' });
});

test('H&S bid page, SOLD: settles under the ARCHIVE id (year-season-lot#) so live and archive rows never double', () => {
  const r = parseReaBidPage(HS, 16901, 'Huggins & Scott', 'https://bid.hugginsandscott.com/lots/16901');
  assert.equal(r.kind, 'sold');
  const l = (r as { lot: Row }).lot;
  assert.equal(l.id, 'hugginsscott-2026-summer-7');
  assert.equal(l.title, '1909-1911 T206 White Border Ty Cobb Bat on Shoulder PSA VG 3');
  assert.equal(l.saleName, '2026 Summer');
  assert.equal(l.saleDate, '2026-09-10');
  assert.equal(l.lotNumber, 7);
  assert.equal(l.realizedUsd, 7500);
  assert.equal(l.bidCount, 46);
  assert.equal(l.url, 'https://bid.hugginsandscott.com/lots/16901');
  const u = parseReaBidPage(withStatus(HS, 'closed'), 16901, 'Huggins & Scott');
  assert.equal(u.kind, 'unsold');
  assert.equal((u as { lot: Row }).lot.id, 'hugginsscott-2026-summer-7');
  // a LIVE H&S lot keeps its bid id (the archive key does not exist yet)
  const lv = parseReaBidPage(withStatus(HS, 'live'), 16901, 'Huggins & Scott');
  assert.equal((lv as { lot: Row }).lot.id, 'hugginsscott-16901');
});

// ── H&S archive ─────────────────────────────────────────────────────────────
test('H&S archive month index: lot detail links in page order, absolute; ids and month rank', () => {
  const links = monthLotLinks(fx('hs-archive-2026-summer-page1.html'));
  const uniq = Array.from(new Set(links));
  assert.equal(uniq.length, 10);
  assert.equal(uniq[0], 'https://hugginsandscott.com/auction/2026/Summer/1/1961-topps-dice-game-brooks-robinson-sgc-exnm-6-highest-graded-example');
  assert.equal(uniq[2], 'https://hugginsandscott.com/auction/2026/Summer/3/1967-topps-581-tom-seaver-rookie-psa-mint-9');
  assert.ok(uniq.every(u => /^https:\/\/hugginsandscott\.com\/auction\/2026\/Summer\/\d+\/[a-z0-9-]+$/.test(u)));
  assert.deepEqual(monthLotLinks('<a href="/auction/2026/Summer/">month</a><a href="/search">s</a>'), [], 'month/index links are not lots');
  assert.equal(idFromUrl(uniq[2]), '2026-summer-3');
  assert.ok(monthIndexRank('/auction/2026/summer/') > monthIndexRank('/auction/2026/spring/'));
  assert.ok(monthIndexRank('/auction/2026/January/') > monthIndexRank('/auction/2025/December/'));
  assert.equal(monthIndexRank('/search'), 0);
});

test('H&S archive lot page: <li> fields → a sold row dated at the sale\'s cited close, at the archive "Sold For"', () => {
  const url = 'https://hugginsandscott.com/auction/2026/Summer/3/1967-topps-581-tom-seaver-rookie-psa-mint-9';
  const l = parseReaLot(fx('hs-archive-2026-summer-3.html'), idFromUrl(url), 'Huggins & Scott', url) as unknown as Row;
  assert.ok(l);
  assert.equal(l.id, 'hugginsscott-2026-summer-3');
  assert.equal(l.title, '1967 Topps #581 Tom Seaver Rookie PSA MINT 9', 'generic <title> → the lot heading');
  assert.equal(l.year, '1967');
  assert.equal(l.saleName, '2026 Summer');
  assert.equal(l.saleDate, '2026-09-10', 'season label → the cited close day (sale-close-dates.ts), not the 07-15 stub');
  assert.equal(l.datePrecision, 'day');
  assert.equal(l.lotNumber, 3);
  assert.equal(l.realizedUsd, 31200);
  assert.equal(l.gradeLabel, 'PSA MINT 9');
  assert.equal(l.imageUrl, 'https://hs-image-archive.nyc3.cdn.digitaloceanspaces.com/2026/summer/3-1967-topps-581-tom-seaver-rookie-psa-mint-9-1.jpg');
  assert.equal(l.status, 'sold');
  // no "Sold For" → unsold/withdrawn → skipped
  assert.equal(parseReaLot(fx('hs-archive-2026-summer-3.html').replace(/Sold For:/, 'Status:'), 'x', 'Huggins & Scott'), null);
});

// ── MLB Auctions ────────────────────────────────────────────────────────────
const MLB_API = JSON.parse(fx('mlb-api-items.json')) as { closed: { items: ApiItem[] }; open: { items: ApiItem[] } };
const MLB_LOT = fx('mlb-lot-6428490-ended.html');
const item = (id: string) => [...MLB_API.closed.items, ...MLB_API.open.items].find(i => String(i.id) === id)!;

test('MLB parseApi: JSON body parses; the WAF interstitial (HTML) and junk read as null', () => {
  const body = JSON.stringify(MLB_API.closed);
  assert.equal(parseApi(`\n\t  ${body}`)?.items?.length, 2, 'leading whitespace (the API pads) is fine');
  assert.equal(parseApi('<!DOCTYPE html><title>Human Verification</title>'), null);
  assert.equal(parseApi('{"items": [ broken'), null);
});

test('MLB closeIso: the API closeTime is GMT', () => {
  assert.equal(closeIso(item('6428490')), '2026-09-17T02:00:00.000Z');
  assert.equal(closeIso(item('6420023')), '2026-09-30T22:00:00.000Z');
  assert.equal(closeIso({ ...item('6420023'), closeTime: '' }), null);
});

test('MLB toLot: sold needs a winning figure AND bidCount > 0; open → upcoming with the live bid', () => {
  const sold = toLot(item('6428490'), { title: item('6428490').fullTitle!, desc: '' }, 'sold', 590) as unknown as Row;
  assert.equal(sold.id, 'mlbauction-6428490');
  assert.equal(sold.title, 'Henry Bolte Game-Used Broken Bat - Natural Victus Sports MH17-M - 6/30/26 vs. LAD');
  assert.equal(sold.status, 'sold');
  // closeTime 2026-09-17 02:00 GMT = 10:00 PM EDT Sep 16 — the ET day, not the GMT one
  assert.equal(sold.saleDate, '2026-09-16');
  assert.equal(sold.saleDateTime, '2026-09-17T02:00:00.000Z', 'the close instant rides on the sold row');
  assert.equal(sold.realizedUsd, 590);
  assert.equal(sold.saleName, 'MLB Auctions · athletics');
  assert.equal(sold.subCat, 'game-used');
  assert.equal(sold.sport, 'Baseball');
  // closed with 0 bids (the page still prints its opening figure) → no sale
  assert.equal(toLot(item('6442159'), { title: 'x', desc: '' }, 'sold', 22995), null);
  assert.equal(toLot(item('6428490'), { title: 'x', desc: '' }, 'sold', null), null);
  const up = toLot(item('6420023'), { title: item('6420023').fullTitle!, desc: 'MLB Authenticated' }, 'upcoming') as unknown as Row;
  assert.equal(up.status, 'upcoming');
  assert.equal(up.currentBid, 3150);
  assert.equal(up.bidCount, 36);
  assert.equal(up.saleDateTime, '2026-09-30T22:00:00.000Z');
  assert.equal(up.realizedUsd, null);
  assert.equal(up.authConfidence, 'high', 'MLB Authentication in the description = league chain of custody');
  assert.equal(up.authCert, 'MLB-AUTH');
});

test('MLB ended lot page: winning row + winning bid read ONLY inside the subject blocks', () => {
  // NOTE: the WINNING row's timestamp is when the winning (proxy) bid was
  // PLACED — Sep 10 here — not the close (Sep 17 02:00 GMT per the API). The
  // idwalk dates sales from this row, so idwalk sale dates can run early.
  assert.deepEqual(parseWinningRow(MLB_LOT), { date: '2026-09-10', bid: 590 });
  assert.equal(parseWinningBid(MLB_LOT), 590);
  // the related-lot card below the subject prints "Current Bid:" — never read
  assert.ok(/Current Bid:/.test(MLB_LOT));
  // a lot that closed with no bids still prints "Winning Bid: $X" → not a sale
  const noBids = MLB_LOT.replace(/(<li[^>]*id="bid-history"[^>]*>)[\s\S]*?<\/li>/, '$1<p>No bids yet on this item.</p></li>');
  assert.equal(parseWinningBid(noBids), null);
  assert.deepEqual(parseWinningRow(noBids), { date: null, bid: null });
  // "Winning Bid" printed OUTSIDE the subject block is an anchor miss, not a price
  const decoy = MLB_LOT.replace(/<li class="auction-bid-current[^"]*"/, '<li class="related-card"');
  assert.equal(parseWinningBid(decoy.replace(/(<li[^>]*id="bid-history"[^>]*>)[\s\S]*?<\/li>/, '$1</li>')), null);
});

// ── Bidsquare (SCP / Hake's) ────────────────────────────────────────────────
const SCP: BidsquareHouse = { segment: 'scp', label: 'SCP', host: 'https://catalogs.scpauctions.com', houseSlug: 'scp-auctions-inc', idPrefix: 'scp', auctionHouse: 'SCP' as Row['x'] };
const HAKES: BidsquareHouse = { segment: 'hakes', label: "Hake's", host: 'https://www.hakes.com', houseSlug: 'hakes-auctions', idPrefix: 'hakes', auctionHouse: "Hake's" as Row['x'] };
const SCP_SOLD = fx('bidsquare-scp-5997288-sold.html');
// the live lot closes 2026-09-30; move its close far out so the "not past" gate holds forever
const HAKES_LIVE = fx('bidsquare-hakes-9830701-live.html').replace(/2026-09-30T21:40:00/g, '2099-09-30T21:40:00');

test('Bidsquare SOLD (SCP): JSON-LD identity + the subject lbl/tcb pair labelled "Sold for" (includes BP)', () => {
  const url = 'https://catalogs.scpauctions.com/online-auctions/scp-auctions-inc/x-5997288';
  const l = parseBidsquareSold(SCP, SCP_SOLD, url) as unknown as Row;
  assert.ok(l);
  assert.equal(l.id, 'scp-5997288');
  assert.equal(l.title, '1909-11 T206 El Principe De Gales Frank "Home Run" Baker - PSA EX-MT 6 (Pop 1, None Higher!)');
  assert.equal(l.saleName, '2022 FALL PREMIER AUCTION');
  assert.equal(l.saleDate, '2022-12-11');
  assert.equal(l.realizedUsd, 3300);
  assert.equal(l.priceBasis, 'realized');
  assert.equal(l.status, 'sold');
  assert.equal(l.gradeLabel, 'PSA EX-MT 6');
  assert.equal(l.imageUrl, 'https://s1.img.bidsquare.com/item/xl/2624/26246703.jpeg');
  assert.equal(l.url, url);
  assert.deepEqual(subjectPrice(SCP_SOLD, '5997288'), { label: 'Sold for', amount: 3300, eventId: '15125', includesBp: true });
  assert.equal(eventStatus(SCP_SOLD), 'past');
  assert.equal(parseBidsquareLive(SCP, SCP_SOLD, url), null, 'a settled page is never a live lot');
});

test('Bidsquare LIVE (Hake\'s): current bid + estimate, upcoming, no realized money', () => {
  const l = parseBidsquareLive(HAKES, HAKES_LIVE, 'u') as unknown as Row;
  assert.ok(l);
  assert.equal(l.id, 'hakes-9830701');
  assert.equal(l.title, '1978 TOPPS STAR WARS SERIES 5 FULL WAX BOX BBCE CERTIFIED.');
  assert.equal(l.saleName, 'September 2026 Pop Culture Auction');
  assert.equal(l.status, 'upcoming');
  assert.equal(l.currentBid, 1250);
  assert.equal(l.saleDate, '2099-09-30');
  assert.equal(l.saleDateTime, '2099-09-30T21:40:00-04:00', 'the trailing zone name is stripped');
  assert.equal(l.estLowUsd, 1000);
  assert.equal(l.estHighUsd, 2000);
  assert.equal(l.realizedUsd, null);
  assert.equal(l.subCat, 'unopened-wax');
  assert.equal(l.authCert, 'BBCE');
  assert.deepEqual(parseEstimate(HAKES_LIVE), { low: 1000, high: 2000 });
  assert.equal(eventStatus(HAKES_LIVE), 'upcoming');
  assert.equal(eventName(HAKES_LIVE), 'September 2026 Pop Culture Auction');
  assert.equal((ldProduct(HAKES_LIVE) as Row).offers.price, 10, 'offers.price is the STARTING bid, never used as a result');
  assert.equal(parseBidsquareSold(HAKES, HAKES_LIVE, 'u'), null, '"Current Bid" is never a sale');
  // a live lot whose close has passed is not published as live
  assert.equal(parseBidsquareLive(HAKES, fx('bidsquare-hakes-9830701-live.html').replace(/2026-09-30T21:40:00/g, '2020-09-30T21:40:00'), 'u'), null);
});

test('Bidsquare anchor: a tcb figure that is not the subject\'s is never read (counted as an anchor miss)', () => {
  const before = ANCHOR_STATS.anchorMiss;
  const neighbour = SCP_SOLD.replace(/lbl_5997288_/g, 'lbl_5997999_').replace(/tcb_5997288_/g, 'tcb_5997999_');
  assert.equal(subjectPrice(neighbour, '5997288'), null);
  assert.equal(parseBidsquareSold(SCP, neighbour, 'u'), null);
  assert.ok(ANCHOR_STATS.anchorMiss > before);
  // lbl and tcb must agree on the EVENT id too
  const split = SCP_SOLD.replace(/tcb_5997288_15125/g, 'tcb_5997288_99999');
  assert.equal(subjectPrice(split, '5997288'), null);
});

// ── CreateAuction (Lelands / Memory Lane / LOTG) ────────────────────────────
const LOTG = HOUSES.lotg;

test('CreateAuction buildLot: only "SOLD FOR" pages, dated from the End: date; a future end settles only if closed', () => {
  const raw: RawLot = {
    price: 'SOLD FOR $48,000', title: 'Lot #5: 1952 Topps #311 Mickey Mantle PSA 5', catLine: 'Category: Baseball Cards',
    endLine: 'Start: 8/1/2026 7:00 PM EDT End: 8/15/2026 10:00 PM EDT', desc: 'A 1952 Topps Mantle graded PSA 5.', img: 'https://x/img.jpg', closed: true,
  };
  const l = buildLot(raw, 46556, LOTG) as unknown as Row;
  assert.equal(l.id, 'lotg-46556');
  assert.equal(l.title, '1952 Topps #311 Mickey Mantle PSA 5', 'catalogue lot prefix stripped, year kept');
  assert.equal(l.saleDate, '2026-08-15');
  assert.equal(l.realizedUsd, 48000);
  assert.equal(l.auctionHouse, 'Love of the Game');
  assert.equal(l.url, 'https://bid.loveofthegameauctions.com/bids/bidplace.aspx?itemid=46556');
  assert.equal(buildLot({ ...raw, price: 'CURRENT BID $48,000' }, 1, LOTG), null, 'a live bid is not a sale');
  assert.equal(buildLot({ ...raw, endLine: 'no date' }, 1, LOTG), null);
  assert.equal(buildLot({ ...raw, endLine: 'End: 1/1/2099', closed: false }, 1, LOTG), null, 'future + open = live');
  const clamped = buildLot({ ...raw, endLine: 'End: 1/1/2099', closed: true }, 1, LOTG) as unknown as Row;
  assert.ok(clamped.saleDate < '2099-01-01', 'future + closed (soft-close) → clamped to today');
});

test('CreateAuction buildLiveLot: a gallery card → upcoming at its current bid', () => {
  const l = buildLiveLot({ id: '47175', title: 'Lot 7: 1972 Willie Mays Game-Worn Mets Jersey', bid: 'Current Bid: $12,100', sold: '', img: '/images_items/thumbs/t.jpg' },
    '2099-10-01', '2099-10-01T22:00:00-04:00', LOTG) as unknown as Row;
  assert.equal(l.id, 'lotg-47175');
  assert.equal(l.title, '1972 Willie Mays Game-Worn Mets Jersey');
  assert.equal(l.currentBid, 12100);
  assert.equal(l.status, 'upcoming');
  assert.equal(l.imageUrl, 'https://bid.loveofthegameauctions.com/images_items/thumbs/t.jpg', 'relative image → host-absolute');
  assert.equal(l.realizedUsd, null);
});

test('CreateAuction gallery rows (real browser DOM): per-card price, never a neighbour\'s; WITHDRAWN flagged', async (t) => {
  let chromium: typeof import('playwright-core').chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { t.skip('playwright-core unavailable'); return; }
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch()).catch(() => null);
  if (!browser) { t.skip('no Chrome/Chromium on this machine'); return; }
  try {
    const page = await browser.newPage();
    await page.setContent(fx('createauction-lotg-gallery.html'));
    const cards = await extractLiveCards(page);
    const by = Object.fromEntries(cards.map(c => [c.id, c]));
    assert.deepEqual(Object.keys(by).sort(), ['46295', '46556', '46562', '47175']);
    assert.equal(by['46556'].sold, 'SOLD FOR $48,000');
    assert.equal(by['46562'].sold, 'SOLD FOR $40,800');
    assert.equal(by['46562'].title, '1886 N167 Old Judge Buck Ewing (HOF) - PSA FR 1.5 - EyeAppealInc B+');
    assert.equal(by['46562'].img, 'https://bid.loveofthegameauctions.com/images_items/thumbs/thumb_item_46562_1_159079.jpg');
    // the withdrawn card has NO price of its own and must not borrow one
    assert.equal(by['47175'].wd, true);
    assert.equal(by['47175'].sold, '');
    assert.equal(by['47175'].bid, '');
    assert.ok(by['47175'].title.startsWith('WITHDRAWN: Outstanding 1972 Willie Mays'));
    assert.equal(by['46295'].sold, 'SOLD FOR $13,800');
    assert.ok(cards.filter(c => !c.wd).every(c => !c.wd && c.sold));
  } finally { await browser.close(); }
});
