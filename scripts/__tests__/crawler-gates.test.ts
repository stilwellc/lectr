/**
 * Crawler gates — Hake's login-gated sold read + REA/H&S between-sales health.
 *
 * Run: RAY_SKIP_MAIN=1 npx tsx --test scripts/__tests__/crawler-gates.test.ts
 *
 * WHY THIS EXISTS (nightly run 37028669622, Oct 2 2026):
 *  1. hakes: "fetched 600 sold lot pages and parsed 0". Hake's first Bidsquare
 *     sale (event 24709) settled, and Hake's hides the result behind "Login for
 *     Price": the subject has NO lbl_/tcb_ pair. The hammer is in the subject's
 *     own JSON-LD (availability SoldOut). Fixtures are trimmed REAL pages.
 *  2. rea + hugginsscott: "live grid returned 0 lot ids" → ok=false on a night
 *     both sites were plainly between sales ("… Is Opening Soon" + countdown).
 *     Between sales must report ok; a LIVE auction with an empty grid must not.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseBidsquareSold, gatedSoldHammer, recognizedUnsold, ldProduct, eventIdFromCatalogUrl, itemIdFromUrl } from '../lib/bidsquare';
import { HAKES } from '../crawl-hakes';
import { SCP } from '../crawl-scp';
import { betweenSalesNote, readAuctionGate, reportReaLegHealth, type ReaLiveResult } from '../crawl-rea';

const FIX = path.join(__dirname, 'fixtures');
const read = (f: string) => fs.readFileSync(path.join(FIX, f), 'utf8');

const HK_URL = 'https://www.hakes.com/online-auctions/hakes-auctions/1978-topps-star-wars-series-5-full-wax-box-bbce-certified-9830701';
const HK_CAT = 'https://www.hakes.com/auctions/hakes-auctions/september-2026-pop-culture-auction-24709/catalog';
const SCP_URL = 'https://catalogs.scpauctions.com/online-auctions/scp-auctions-inc/1909-11-t206-lot-of-8-commons-incl-dick-egan-red-ames-frank-smith-etc-all-sgc-graded-9380502';

type Row = Record<string, unknown>;

// ── Hake's: login-gated sold page ───────────────────────────────────────────

test('url id helpers', () => {
  assert.strictEqual(itemIdFromUrl(HK_URL), '9830701');
  assert.strictEqual(eventIdFromCatalogUrl(HK_CAT), '24709');
  assert.strictEqual(eventIdFromCatalogUrl(HK_CAT.replace(/\/catalog$/, '')), '24709');
});

test("Hake's gated sold page parses: hammer from the subject's JSON-LD, stored like SCP (realized = hammer × 1.20)", () => {
  const html = read('bidsquare-hakes-sold-gated.html');
  assert.ok(!/id="tcb_/.test(html), 'fixture is the gated state (no tcb figure)');
  const lot = parseBidsquareSold(HAKES, html, HK_URL, '24709') as unknown as Row;
  assert.ok(lot, 'parsed');
  assert.strictEqual(lot.id, 'hakes-9830701');
  assert.strictEqual(lot.status, 'sold');
  assert.strictEqual(lot.saleDate, '2026-09-30');
  assert.strictEqual(lot.saleName, 'September 2026 Pop Culture Auction');
  assert.strictEqual(lot.hammerNative, 1650);
  assert.strictEqual(lot.hammerUsd, 1650);
  assert.strictEqual(lot.realizedUsd, 1980);
  assert.strictEqual(lot.priceUsd, 1980);
  assert.strictEqual(lot.priceBasis, 'realized');
  assert.strictEqual(lot.buyerPremiumPct, 20);
  assert.strictEqual(lot.estLowUsd, 1000);
  assert.strictEqual(lot.estHighUsd, 2000);
});

test("Hake's gated read is anchored to item AND event", () => {
  const html = read('bidsquare-hakes-sold-gated.html');
  // a different catalog's event id → refuse
  assert.strictEqual(parseBidsquareSold(HAKES, html, HK_URL, '99999'), null);
  // the page reached under another item's url → the subject LD does not match
  assert.strictEqual(parseBidsquareSold(HAKES, html, HK_URL.replace(/9830701$/, '9830702'), '24709'), null);
  // bid area and event marker disagree on the event → refuse
  const split = html.replace('id="ba_9830701_24709"', 'id="ba_9830701_24710"');
  assert.strictEqual(parseBidsquareSold(HAKES, split, HK_URL, null), null);
  // a neighbour's bid area only → refuse
  const neighbour = html.replace(/9830701_24709/g, '9830702_24709');
  assert.strictEqual(parseBidsquareSold(HAKES, neighbour, HK_URL, '24709'), null);
  // JSON-LD Product for some other item only → refuse
  const otherLd = html.replace(/"productID": "9830701"/, '"productID": "1"').replace(/"sku": "9830701"/, '"sku": "1"');
  assert.strictEqual(parseBidsquareSold(HAKES, otherLd, HK_URL, '24709'), null);
});

test("Hake's gated page: not-sold states never become a sale", () => {
  const html = read('bidsquare-hakes-sold-gated.html');
  const unsold = html.replace('"availability": "SoldOut"', '"availability": "Discontinued"');
  assert.strictEqual(parseBidsquareSold(HAKES, unsold, HK_URL, '24709'), null);
  assert.strictEqual(recognizedUnsold(unsold, '9830701', ldProduct(unsold, '9830701')), true);
  assert.strictEqual(recognizedUnsold(html, '9830701', ldProduct(html, '9830701')), false);
  // a still-upcoming event is never read off the gated path
  const upcoming = html.replace(/data-event_status='past'/g, "data-event_status='upcoming'");
  assert.strictEqual(parseBidsquareSold(HAKES, upcoming, HK_URL, '24709'), null);
  // without the login gate button there is no gated read
  const noGate = html.replace(/f_event_button_view_hammer_price/g, 'x');
  assert.strictEqual(gatedSoldHammer(noGate, '9830701', ldProduct(noGate, '9830701')!, '24709'), null);
});

test('SCP public tcb path unchanged, and its JSON-LD price is the hammer (× 1.20 = Sold for)', () => {
  const html = read('bidsquare-scp-sold-tcb.html');
  const lot = parseBidsquareSold(SCP, html, SCP_URL, '23246') as unknown as Row;
  assert.ok(lot);
  assert.strictEqual(lot.realizedUsd, 840);
  assert.strictEqual(lot.priceBasis, 'realized');
  // SCP's premium is not read off an SCP page, so none is stamped (premiums.ts
  // schedule = 1.20 is the fallback); Hake's publishes 20% and stamps it
  assert.strictEqual(lot.buyerPremiumPct, null);
  const p = ldProduct(html, '9380502')!;
  assert.strictEqual((p.offers as Row).price, 700);
  assert.strictEqual(700 * 1.2, 840);
  // tcb from another event than the catalog crawled → refuse
  assert.strictEqual(parseBidsquareSold(SCP, html, SCP_URL, '11111'), null);
});

// ── REA / H&S: between sales vs the silent zero ─────────────────────────────

const NOW = Date.parse('2026-10-03T12:00:00Z');

test('REA shell between sales → positive note with the next sale + date', () => {
  const html = read('rea-lots-between-sales.html');
  const g = readAuctionGate(html);
  assert.deepStrictEqual(g, { status: 'pending', saleName: 'October 2026 Auction', opensAt: '2026-10-08T16:00:00.000Z' });
  assert.strictEqual(betweenSalesNote(html, NOW), 'between sales (next: October 2026 Auction opens 2026-10-08)');
});

test('H&S shell between sales → positive note', () => {
  const html = read('hugginsscott-lots-between-sales.html');
  assert.strictEqual(betweenSalesNote(html, NOW), 'between sales (next: Fall 2026 Auction opens 2026-11-19)');
});

test('a LIVE auction with an empty grid is NOT between sales (the silent zero)', () => {
  const html = read('rea-lots-between-sales.html');
  // the sale is running (status flipped by the site) but the grid gave 0 ids
  const live = html.replace("status: 'pending'", "status: 'open'").replace(/<h1[^>]*>[^<]*Opening Soon\.<\/h1>/, '<h1>October 2026 Auction</h1>');
  assert.strictEqual(betweenSalesNote(live, NOW), null);
  // status alone flipped, heading lingering → still not healthy
  assert.strictEqual(betweenSalesNote(html.replace("status: 'pending'", "status: 'open'"), NOW), null);
  // closed sale, no next-sale shell
  assert.strictEqual(betweenSalesNote(html.replace("status: 'pending'", "status: 'closed'"), NOW), null);
  // countdown ran out days ago but the grid is still empty → silent zero
  assert.strictEqual(betweenSalesNote(html, Date.parse('2026-10-12T00:00:00Z')), null);
  // a page that lists lots is never "between sales"
  assert.strictEqual(betweenSalesNote(html + '<a href="/lots/123456">x</a>', NOW), null);
  // unreadable / empty shell
  assert.strictEqual(betweenSalesNote('<html><body>maintenance</body></html>', NOW), null);
  assert.strictEqual(betweenSalesNote(null, NOW), null);
});

function legHealthFor(stats: Partial<ReaLiveResult['stats']>): { ok: boolean; reason: string | null } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leghealth-'));
  const cwd = process.cwd();
  const log = console.log;
  try {
    process.chdir(dir);
    console.log = () => {};
    const st: ReaLiveResult['stats'] = { gridIds: 0, fetched: 0, live: 0, sold: 0, unsold: 0, known: 0, unparsed: 0, resolveTried: 0, resolveFetched: 0, resolveSettled: 0, reason: null, betweenSales: null, ...stats };
    reportReaLegHealth('rea', st);
    return JSON.parse(fs.readFileSync(path.join(dir, 'leg-health.json'), 'utf8'));
  } finally {
    console.log = log;
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('leg health: between sales → ok=true with the note; silent zero → ok=false', () => {
  // each call writes a fresh file in a fresh dir; the module folds same-house
  // reports, so the latest call owns the record
  const quiet = legHealthFor({ betweenSales: 'between sales (next: October 2026 Auction opens 2026-10-08)' });
  assert.strictEqual(quiet.ok, true);
  assert.strictEqual(quiet.reason, 'between sales (next: October 2026 Auction opens 2026-10-08)');
  const zero = legHealthFor({ reason: 'live grid returned 0 lot ids' });
  assert.strictEqual(zero.ok, false);
  assert.strictEqual(zero.reason, 'live grid returned 0 lot ids');
});
