/**
 * Data-quality passes (Sep 27 2026 audit) — fixture tests, one block per rule.
 *
 * Run: RAY_SKIP_MAIN=1 npx tsx scripts/__tests__/data-quality.test.ts
 *
 * Every fixture row is shaped after a REAL corpus row the audit found (ids kept
 * where they illustrate the case). The rules are pure mutations of a lot array,
 * so each test builds a tiny corpus, runs the pass, and asserts the outcome —
 * including the guards (what must NOT be touched) and idempotency.
 */
import * as assert from 'assert';
import {
  dropRRStubRows, dedupeRRSameSaleItems, dedupeUrlSchemeCollisions, dedupeBruunUnderBonhams,
  rerouteForeignLeadMaker, rerouteSetCodeCards, demoteStaleUpcoming, stampCompExcludes,
  nullPlaceholderImages, stampDatePrecision, fixFamilyHammerEqualsPrice, BRUUN_HOUSE,
} from '../lib/corpus-normalize';
import { isRoundIncrement, BID_LADDER_PCT, lotAllInFactor, houseAllInFactorAt, houseHammerFromAllInAt } from '../../app/lib/premiums';
import { computeSentinel, sentinelVerdict } from '../assemble';
import { isServedUpcoming } from '../corpus-io';
import { leadsWithSetCode } from '../lib/set-codes';
import { classifySports } from '../lib/sports-crawl';

type R = Record<string, any>;
const L = (o: R): any => ({ id: 'x', artist: 'memorabilia', title: 't', category: 'object', auctionHouse: 'REA', saleDate: '2026-01-01', status: 'sold', currency: 'USD', estimateLow: null, estimateHigh: null, hammerPrice: null, premiumPrice: null, priceUsd: null, url: '', imageUrl: null, ...o });

let passed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); process.exitCode = 1; }
}
const ids = (xs: R[]) => xs.map(x => x.id).sort();

console.log('data-quality passes\n');

// ── 1 · stale upcoming ────────────────────────────────────────────────────
check('stale upcoming >3d past close → unknown-result + compExclude; recent/future untouched', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  const lots = [
    L({ id: 'hugginsscott-20372', auctionHouse: 'Huggins & Scott', status: 'upcoming', saleDate: '2026-09-10', resultsPending: true }),
    L({ id: 'mlb-fresh', auctionHouse: 'MLB Auctions', status: 'upcoming', saleDate: '2026-09-25' }),       // inside the 3-day window
    L({ id: 'future', auctionHouse: 'REA', status: 'upcoming', saleDate: '2026-10-20' }),
    L({ id: 'sdt-later', auctionHouse: 'Phillips', status: 'upcoming', saleDate: '2026-09-01', saleDateTime: '2026-09-26T18:00:00Z' }),
    L({ id: 'sold-old', status: 'sold', saleDate: '2020-01-01', priceUsd: 100 }),
  ];
  const r = demoteStaleUpcoming(lots, now);
  assert.strictEqual(r.total, 1);
  assert.deepStrictEqual(r.byHouse, { 'Huggins & Scott': 1 });
  assert.strictEqual(lots[0].status, 'unknown-result');
  assert.strictEqual(lots[0].compExclude, 'stale-upcoming');
  assert.strictEqual(lots[0].resultsPending, false);
  assert.strictEqual(lots[1].status, 'upcoming');
  assert.strictEqual(lots[3].status, 'upcoming', 'a later parsed saleDateTime keeps it live');
  assert.strictEqual(demoteStaleUpcoming(lots, now).total, 0, 'idempotent');
});

// ── 2 · dedupe ────────────────────────────────────────────────────────────
check('RR stub rows (lot-detail/0, "Lot #." titles) are dropped', () => {
  const lots = [
    L({ id: 'rrauction-271-0', auctionHouse: 'RR Auction', title: 'Lot #. Procul Harem', url: 'https://www.rrauction.com/auctions/lot-detail/0' }),
    L({ id: 'rrauction-747-351524707470055', auctionHouse: 'RR Auction', title: 'Benjamin Harrison Letter Signed' }),
  ];
  assert.strictEqual(dropRRStubRows(lots), 1);
  assert.deepStrictEqual(ids(lots), ['rrauction-747-351524707470055']);
});

check('RR same item twice in one sale (same preview image id) → one row; unrelated shared image and two real sales kept', () => {
  const img = (sale: number, item: number) => `https://cdn.rrauction.com/auction/${sale}/preview/${item}_1.jpg`;
  const lots = [
    // real dupe: bought_in + sold, prefix-compatible titles → keep the sold one
    L({ id: 'rrauction-590-342840705901023', auctionHouse: 'RR Auction', title: 'Link Lyman', status: 'bought_in', lotNumber: 1023, imageUrl: img(590, 3428407) }),
    L({ id: 'rrauction-590-342840705904278', auctionHouse: 'RR Auction', title: 'Link Lyman', status: 'sold', priceUsd: 240, lotNumber: 4278, imageUrl: img(590, 3428407) }),
    // real dupe, same price, fuller title wins
    L({ id: 'rrauction-541-33956180541132', auctionHouse: 'RR Auction', title: 'Harry S. Truman', priceUsd: 328, lotNumber: 132, imageUrl: img(541, 3395618) }),
    L({ id: 'rrauction-541-33956180541290', auctionHouse: 'RR Auction', title: 'Harry S. Truman Signed Photograph', priceUsd: 328, lotNumber: 290, imageUrl: img(541, 3395618) }),
    // shared image, unrelated items → untouched
    L({ id: 'rrauction-591-a', auctionHouse: 'RR Auction', title: 'Scientists Check', status: 'bought_in', lotNumber: 385, imageUrl: img(591, 3414994) }),
    L({ id: 'rrauction-591-b', auctionHouse: 'RR Auction', title: 'Iwo Jima: Joe Rosenthal Cover', priceUsd: 125, lotNumber: 460, imageUrl: img(591, 3414994) }),
    // two sold at different prices → two real sales, untouched
    L({ id: 'rrauction-447-a', auctionHouse: 'RR Auction', title: 'Mohandas Gandhi Autograph Letter Signed', priceUsd: 20000, lotNumber: 1037, imageUrl: img(447, 3329707) }),
    L({ id: 'rrauction-447-b', auctionHouse: 'RR Auction', title: 'Mohandas Gandhi Autograph Letter Signed', priceUsd: 25000, lotNumber: 2097, imageUrl: img(447, 3329707) }),
  ];
  assert.strictEqual(dedupeRRSameSaleItems(lots), 2);
  assert.deepStrictEqual(ids(lots), ['rrauction-447-a', 'rrauction-447-b', 'rrauction-541-33956180541290', 'rrauction-590-342840705904278', 'rrauction-591-a', 'rrauction-591-b']);
  assert.strictEqual(dedupeRRSameSaleItems(lots), 0, 'idempotent');
});

check("Sotheby's/Christie's id schemes on one lot URL → the crawled row wins; seed rows sharing an artist page are NOT a lot key", () => {
  const S = 'https://www.sothebys.com/en/buy/auction/2021/contemporary-curated-5/final-days';
  const lots = [
    L({ id: 'sothebys-final-days', auctionHouse: "Sotheby's", url: S, saleDate: '2021-06-01', priceUsd: 1202761.6 }),
    L({ id: 'sothebys-29ddb9ae-0a47-4e04-b8ea-3aa356c77fd2', auctionHouse: "Sotheby's", url: S + '?locale=en', saleDate: '2021-11-10', priceUsd: 1202761.6 }),
    L({ id: 'sothebys-nu-etendu', auctionHouse: "Sotheby's", status: 'upcoming', url: 'https://www.sothebys.com/en/buy/auction/2026/magnum-opus-act-ii-figure-form/nu-etendu' }),
    L({ id: 'sothebys-10fde699-3fd6-4720-8da3-6748396c8c59', auctionHouse: "Sotheby's", status: 'bought_in', url: 'https://www.sothebys.com/en/buy/auction/2026/magnum-opus-act-ii-figure-form/nu-etendu' }),
    L({ id: 'sothebys-may25-antipodal-figure', auctionHouse: "Sotheby's", url: 'https://www.sothebys.com/en/artists/george-condo' }),
    L({ id: 'sothebys-nov24-mental-states', auctionHouse: "Sotheby's", url: 'https://www.sothebys.com/en/artists/george-condo' }),
    L({ id: 'christies-auc-6435017', auctionHouse: "Christie's", url: 'https://www.christies.com/en/lot/lot-6435017?ldp_breadcrumb=back', priceUsd: 8039350 }),
    L({ id: 'christies-6435017', auctionHouse: "Christie's", url: 'https://www.christies.com/en/lot/lot-6435017', priceUsd: 8039350 }),
    L({ id: 'christies-auc-5602497', auctionHouse: "Christie's", url: 'https://www.christies.com/en/sso' }),
    L({ id: 'christies-auc-5602502', auctionHouse: "Christie's", url: 'https://www.christies.com/en/sso' }),
  ];
  assert.strictEqual(dedupeUrlSchemeCollisions(lots), 3);
  const got = ids(lots);
  assert.ok(got.includes('sothebys-29ddb9ae-0a47-4e04-b8ea-3aa356c77fd2') && !got.includes('sothebys-final-days'), 'crawled uuid row kept (its real Nov date), slug dropped');
  assert.ok(got.includes('sothebys-10fde699-3fd6-4720-8da3-6748396c8c59') && !got.includes('sothebys-nu-etendu'));
  assert.ok(got.includes('sothebys-may25-antipodal-figure') && got.includes('sothebys-nov24-mental-states'), 'artist-page seeds are distinct lots');
  assert.ok(got.includes('christies-auc-5602497') && got.includes('christies-auc-5602502'), '/sso is not a lot key');
  assert.strictEqual(got.filter(i => /6435017/.test(i)).length, 1);
});

check('Bruun Rasmussen under Bonhams: bonhams.com twin → drop; unique BR lot → relabelled to its own house', () => {
  const lots = [
    L({ id: 'bonhams-33077-185', auctionHouse: 'Bonhams', artist: 'pablo-picasso', saleDate: '2026-10-08', lotNumber: 185, estimateLow: 1000, estimateHigh: 1000, title: '"Picasso. 28 linographies originales". Madoura' }),
    L({ id: 'bonhams-99999-185', auctionHouse: 'Bonhams', saleDate: '2026-10-08', lotNumber: 185, estimateLow: 50, estimateHigh: 80, title: 'An unrelated lot in another Bonhams sale that day' }),
    L({ id: 'bonhams-brk_1008817-5754887C13E6', auctionHouse: 'Bonhams', artist: 'pablo-picasso', saleDate: '2026-10-08', lotNumber: 185, estimateLow: 1000, estimateHigh: 1000, title: 'Pablo Picasso: "Picasso. 28 linographies originales". Madoura' }),
    L({ id: 'bonhams-brk_1008799-0411C1769AB4', auctionHouse: 'Bonhams', artist: 'kaws', saleDate: '2026-09-02', lotNumber: 8080, estimateLow: 2000, estimateHigh: 3000, title: 'KAWS: "KAWS BFF, Black edition"' }),
  ];
  const r = dedupeBruunUnderBonhams(lots);
  assert.deepStrictEqual(r, { dropped: 1, relabelled: 1 });
  assert.deepStrictEqual(ids(lots), ['bonhams-33077-185', 'bonhams-99999-185', 'bonhams-brk_1008799-0411C1769AB4']);
  assert.strictEqual(lots.find((l: R) => l.id.startsWith('bonhams-brk'))!.auctionHouse, BRUUN_HOUSE);
  assert.deepStrictEqual(dedupeBruunUnderBonhams(lots), { dropped: 0, relabelled: 0 }, 'idempotent');
});

// ── 3 · compExclude ───────────────────────────────────────────────────────
check('compExclude: <$10, >50× high / <2% low, unconverted HKD, last-tracked-bid, seed search url, Estimate Upon Request', () => {
  const lots = [
    L({ id: 'under10', auctionHouse: 'Goldin', priceUsd: 6 }),
    L({ id: 'hi', auctionHouse: "Sotheby's", priceUsd: 10001600, estimateLow: 1850, estimateHigh: 2313, saleName: 'Modern And Contemporary Art Milan' }),
    L({ id: 'lo', auctionHouse: 'LAMA', priceUsd: 110, estimateLow: 90000, estimateHigh: 120000, saleName: 'Modern Art & Design' }),
    L({ id: 'kaws-hkd', auctionHouse: "Sotheby's", currency: 'HKD', priceUsd: 16000, estimateLow: 128, estimateHigh: 192, saleName: 'NIGOLDENEYE Volume One' }),
    L({ id: 'freddie', auctionHouse: "Sotheby's", currency: 'GBP', priceUsd: 20538, estimateLow: 50, estimateHigh: 75, saleName: 'Freddie Mercury: A World of His Own' }),
    L({ id: 'onlywatch', auctionHouse: "Christie's", currency: 'CHF', priceUsd: 352100, estimateLow: 4527, estimateHigh: 5533, saleName: 'Only Watch' }),
    L({ id: 'ltb', auctionHouse: 'Goldin', priceUsd: 366, priceBasis: 'last-tracked-bid' }),
    L({ id: 'christies-feb26-clown', auctionHouse: "Christie's", priceUsd: 243750, estimateLow: 150000, estimateHigh: 250000, url: 'https://www.christies.com/en/results?query=george+condo' }),
    L({ id: 'sothebys-arlequin-buste', auctionHouse: "Sotheby's", priceUsd: 42640000, title: 'Arlequin (Buste) Estimate Upon Request' }),
    L({ id: 'normal', auctionHouse: 'REA', priceUsd: 1200, estimateLow: 800, estimateHigh: 1200 }),
    L({ id: 'bought-in-junk', auctionHouse: "Sotheby's", status: 'bought_in', estimateLow: 1, estimateHigh: 2 }),
  ];
  stampCompExcludes(lots);
  const by = Object.fromEntries(lots.map((l: R) => [l.id, l.compExclude]));
  assert.strictEqual(by['under10'], 'price-under-10');
  assert.strictEqual(by['hi'], 'price-vs-estimate');
  assert.strictEqual(by['lo'], 'price-vs-estimate');
  assert.strictEqual(by['kaws-hkd'], 'fx-unconverted');
  assert.strictEqual(by['freddie'], undefined, 'whitelisted celebrity sale');
  assert.strictEqual(by['onlywatch'], undefined, 'whitelisted charity sale');
  assert.strictEqual(by['ltb'], 'last-tracked-bid');
  assert.strictEqual(by['christies-feb26-clown'], 'seed-nonlot-url');
  assert.strictEqual(by['sothebys-arlequin-buste'], 'estimate-upon-request');
  assert.strictEqual(lots.find((l: R) => l.id === 'sothebys-arlequin-buste').title, 'Arlequin (Buste)', 'label stripped from the title');
  assert.strictEqual(by['normal'], undefined);
  assert.strictEqual(by['bought-in-junk'], undefined);
  const again = stampCompExcludes(lots);
  assert.deepStrictEqual(again, {}, 'idempotent (first reason wins, never re-counted)');
});

// ── 4/5 · datePrecision ───────────────────────────────────────────────────
check("datePrecision: seasonToDate 15th → month (5 hobby houses); Sotheby's slug June-1 → year; crawler value respected", () => {
  const lots = [
    L({ id: 'rea-48979', auctionHouse: 'REA', saleDate: '2018-04-15' }),
    L({ id: 'lelands-1', auctionHouse: 'Lelands', saleDate: '2026-08-15' }),
    L({ id: 'rea-real', auctionHouse: 'REA', saleDate: '2026-09-20' }),
    L({ id: 'goldin-15', auctionHouse: 'Goldin', saleDate: '2026-08-15' }),
    L({ id: 'crawler-said', auctionHouse: 'Memory Lane', saleDate: '2026-07-15', datePrecision: 'day' }),
    L({ id: 'sothebys-untitled-28', auctionHouse: "Sotheby's", saleDate: '2026-06-01' }),
    L({ id: 'sothebys-alg-7650025f-853a-449d-a73c-06e0f03daa67', auctionHouse: "Sotheby's", saleDate: '2022-06-01' }),
  ];
  assert.deepStrictEqual(stampDatePrecision(lots), { month: 2, year: 1 });
  const by = Object.fromEntries(lots.map((l: R) => [l.id, l.datePrecision]));
  assert.strictEqual(by['rea-48979'], 'month');
  assert.strictEqual(by['lelands-1'], 'month');
  assert.strictEqual(by['rea-real'], undefined);
  assert.strictEqual(by['goldin-15'], undefined);
  assert.strictEqual(by['crawler-said'], 'day');
  assert.strictEqual(by['sothebys-untitled-28'], 'year');
  assert.strictEqual(by['sothebys-alg-7650025f-853a-449d-a73c-06e0f03daa67'], undefined, 'a crawled June-1 date is real');
  assert.deepStrictEqual(stampDatePrecision(lots), { month: 0, year: 0 }, 'idempotent');
});

// ── 6 · percentage bid ladders ────────────────────────────────────────────
check('isRoundIncrement: flat steps unchanged; 10% geometric ladder rungs honest only with the ladder + peers', () => {
  assert.strictEqual(isRoundIncrement(1000), true);
  assert.strictEqual(isRoundIncrement(10050 / 1.22), false);
  const peers = [1050, 1155, 1271, 1398, 1538, 1692, 1861];
  assert.strictEqual(isRoundIncrement(1271), false, 'no ladder → the old flat answer');
  assert.strictEqual(isRoundIncrement(1271, 1, { pct: 0.10, peers }), true, 'between two rungs');
  assert.strictEqual(isRoundIncrement(1050, 1, { pct: 0.10, peers }), true, 'bottom of a 3-rung run');
  assert.strictEqual(isRoundIncrement(2047, 1, { pct: 0.10, peers }), true, 'top of a run (1861×1.1 = 2047.1)');
  assert.strictEqual(isRoundIncrement(3_117_333, 1, { pct: 0.10, peers }), false, 'a bleed with no ladder around it');
  assert.strictEqual(isRoundIncrement(1500, 1, { pct: 0.10, peers: [1650] }), true, '1500 is flat-round anyway');
  assert.strictEqual(isRoundIncrement(1523, 1, { pct: 0.10, peers: [1675] }), false, 'one lone neighbour is not a ladder');
  assert.deepStrictEqual(Object.keys(BID_LADDER_PCT).sort(), ['Lelands', 'Love of the Game', 'Memory Lane']);
});

check('computeSentinel: a Lelands ladder cluster is honest, the NFL idwalk bleed stays poison, and the delta gate still diffs vs baseline', () => {
  const lots: R[] = [];
  const add = (house: string, price: number, n: number, date: string) => { for (let i = 0; i < n; i++) lots.push({ status: 'sold', auctionHouse: house, priceUsd: price, saleDate: date }); };
  for (const p of [1050, 1155, 1271, 1398, 1538]) add('Lelands', p, p === 1271 ? 20 : 4, '2026-08-15');
  add('NFL Auction', 10050, 40, '2026-08-30');
  const sigs = computeSentinel(lots as never, { lotAllInFactor, isRoundIncrement, BID_LADDER_PCT });
  const lel = sigs.find(s => s.house === 'Lelands')!;
  const nfl = sigs.find(s => s.house === 'NFL Auction')!;
  assert.ok(lel && lel.honest, 'Lelands $1,271 ×20 is a ladder rung');
  assert.ok(nfl && !nfl.honest, 'NFL $10,050 ×40 is poison');
  // delta gate: a known poison is standing; a NEW one with another new → abort
  const base = new Map([[`NFL Auction|10050`, 40]]);
  assert.strictEqual(sentinelVerdict(sigs, base).abort, false, 'standing poison in the baseline does not gate');
  const extra = sigs.concat([{ house: 'X', price: 5555, n: 30, top: 30, topDate: 'd', hammer: 4545, honest: false }, { house: 'Y', price: 7777, n: 30, top: 30, topDate: 'd', hammer: 6000, honest: false }]);
  assert.strictEqual(sentinelVerdict(extra, base).reason, 'new-poison');
});

check('computeSentinel + REA premium eras: real increment × era-premium clusters are honest; a bleed (and a wrong-era tie) stays poison', () => {
  const lots: R[] = [];
  const add = (price: number, n: number, date: string) => { for (let i = 0; i < n; i++) lots.push({ status: 'sold', auctionHouse: 'REA', priceUsd: price, saleDate: date }); };
  // REAL standing signatures from the Oct 5 2026 corpus (price ×n @ placeholder date):
  add(1840, 38, '2004-04-15');   // $1,600 × 1.15
  add(1508, 77, '2005-04-15');   // $1,300 × 1.16
  add(7540, 36, '2006-04-15');   // $6,500 × 1.16
  add(2962, 65, '2013-04-15');   // $2,500 × 1.185
  add(10072, 17, '2013-04-15');  // $8,500 × 1.185
  // an era-1.175 tie dated in the 18.5% era: $2,350 = $2,000 × 1.175 — NOT honest in 2013
  add(2350, 20, '2013-04-15');
  // a bleed: one arbitrary price stamped across a batch
  add(10050, 40, '2025-10-15');
  const dated = { lotAllInFactor, isRoundIncrement, BID_LADDER_PCT, houseAllInFactorAt };
  const sig = (s: ReturnType<typeof computeSentinel>, p: number) => s.find(x => x.price === p)!;
  const withEras = computeSentinel(lots as never, dated);
  for (const p of [1840, 1508, 7540, 2962, 10072]) assert.ok(sig(withEras, p).honest, `$${p} is an era-premium tie`);
  assert.strictEqual(sig(withEras, 2350).honest, false, '$2,350 in 2013 is not a 18.5%-era increment');
  assert.strictEqual(sig(withEras, 10050).honest, false, 'the bleed stays poison');
  assert.ok(Math.abs(sig(withEras, 2962).hammer - 2500) <= 1, 'implied hammer ≈ $2,500 (REA rounds the premium to the dollar)');
  // the flat 1.175 (no eras) is what made the real ties look like poison
  const flat = computeSentinel(lots as never, { lotAllInFactor, isRoundIncrement, BID_LADDER_PCT });
  for (const p of [1840, 1508, 7540, 2962, 10072]) assert.strictEqual(sig(flat, p).honest, false, `$${p} under the flat 1.175`);
  assert.strictEqual(sig(flat, 2350).honest, true, 'the flat factor blessed a wrong-era tie');
});

check("computeSentinel + Christie's/Sotheby's tiered eras in the SALE currency: real ties honest; a bleed, a wrong-era tie and a native-less row stay poison", () => {
  const lots: R[] = [];
  const add = (house: string, usd: number, n: number, date: string, cur?: string, native?: number) => {
    for (let i = 0; i < n; i++) lots.push({ status: 'sold', auctionHouse: house, priceUsd: usd, realizedUsd: usd, saleDate: date, ...(cur ? { nativeCurrency: cur, premiumNative: native } : {}) });
  };
  // REAL standing signatures from the Oct 5 2026 corpus (USD = native all-in × that year's FX):
  add("Christie's", 21793.75, 23, '2012-06-25', 'GBP', 13750); // £11,000 × 1.25
  add("Christie's", 5747.47, 18, '2002-10-09', 'GBP', 3824);   // £3,200 × 1.195 (King Street, 19.5% era)
  add("Christie's", 40987.5, 15, '2014-05-11', 'CHF', 37500);  // CHF 30,000 × 1.25
  add("Christie's", 1062.1, 15, '2010-06-23', 'GBP', 687);     // £550 × 1.25 = 687.5, premium truncated to the pound
  add("Sotheby's", 7470, 15, '2013-02-25', 'EUR', 5625);       // €4,500 × 1.25
  add("Sotheby's", 52428.8, 16, '2026-04-24', 'HKD', 409600);  // HK$320,000 × 1.28
  add("Sotheby's", 4833.28, 16, '2002-10-30', 'HKD', 37760);   // HK$32,000 × 1.18 (Hong Kong's 2002 rate)
  // above band 1: Christie's NY 2012 hammer $130,000 = 25% on $50k + 20% on $80k → $158,500
  add("Christie's", 158500, 15, '2012-05-09');
  // a wrong-era tie: £3,824 is 19.5%-era arithmetic — in a 2012 sale (25%) it implies £3,059.20
  add("Christie's", 6060.04, 20, '2012-06-25', 'GBP', 3824);
  // a bleed: one arbitrary price stamped across a London batch
  add("Christie's", 21836.55, 40, '2012-06-25', 'GBP', 13777);
  // a USD-native bleed at Sotheby's NY
  add("Sotheby's", 10050, 40, '2016-04-05');
  // the same real £13,750 tie but WITHOUT its native figure → read as USD, not blessed
  add("Sotheby's", 21793.75, 20, '2012-06-25');
  const all = { lotAllInFactor, isRoundIncrement, BID_LADDER_PCT, houseAllInFactorAt, houseHammerFromAllInAt };
  const s = computeSentinel(lots as never, all);
  const sig = (h: string, p: number) => s.find(x => x.house === h && x.price === p)!;
  for (const [h, p] of [["Christie's", 21793.75], ["Christie's", 5747.47], ["Christie's", 40987.5], ["Christie's", 1062.1], ["Sotheby's", 7470], ["Sotheby's", 52428.8], ["Sotheby's", 4833.28], ["Christie's", 158500]] as const) {
    assert.ok(sig(h, p).honest, `${h} $${p} is a round native increment × its era premium`);
  }
  assert.strictEqual(sig("Christie's", 21793.75).currency, 'GBP');
  assert.strictEqual(sig("Christie's", 21793.75).hammer, 11000);
  assert.strictEqual(sig("Christie's", 158500).hammer, 130000, 'band walk: $50k @25% + $80k @20%');
  assert.strictEqual(sig("Christie's", 6060.04).honest, false, 'a 19.5%-era figure in a 25%-era sale is not a tie');
  assert.strictEqual(sig("Christie's", 21836.55).honest, false, 'the London bleed stays poison');
  assert.strictEqual(sig("Sotheby's", 10050).honest, false, 'the NY bleed stays poison');
  assert.strictEqual(sig("Sotheby's", 21793.75).honest, false, 'no native figure → USD → not blessed');
  // single factor: the flat/undated read (pre-Oct-5 sentinel) saw all the real ties as poison
  const old = computeSentinel(lots as never, { lotAllInFactor, isRoundIncrement, BID_LADDER_PCT, houseAllInFactorAt });
  for (const p of [21793.75, 5747.47, 40987.5, 158500]) assert.strictEqual(old.find(x => x.house === "Christie's" && x.price === p)!.honest, false, `$${p} under the undated USD read`);
});

// ── 7 · placeholder images ────────────────────────────────────────────────
check('placeholder images → null; real images untouched', () => {
  const lots = [
    L({ id: 'c', imageUrl: 'https://www.christies.com/img/LotImages/Alert/NoImage/non_NoImag.jpg' }),
    L({ id: 'r', imageUrl: 'https://www.rrauction.com/assets/img/missing.png' }),
    L({ id: 's', imageUrl: 'https://sothebys-com.brightspotcdn.com/dims4/default/4a3f158/2147483647/strip/true/crop/500x500+0+0/resize/421x421!/quality/90/?url=http%3A%2F%2Fsothebys-brightspot-migration.s3.amazonaws.com%2Fc6%2F4c%2F28%2F59fa5b71fac41f69087283fc636e351464ae6e590e9c1cb5f016306f9a%2Flot.jpg' }),
    L({ id: 't', imageUrl: 'https://auction.lelands.com/images_items/thumbs/thumb_' }),
    L({ id: 'ok', imageUrl: 'https://auction.lelands.com/images_items/thumbs/thumb_item_130997_1_465177.jpg' }),
  ];
  const r = nullPlaceholderImages(lots);
  assert.deepStrictEqual(r, { 'christies-noimage': 1, 'rr-missing': 1, 'sothebys-generic': 1, 'truncated-thumb': 1 });
  assert.deepStrictEqual(lots.map((l: R) => l.imageUrl === null), [true, true, true, true, false]);
});

// ── 8 · category routing ──────────────────────────────────────────────────
check('pre-war set codes: leading-anchored detector; classifySports + the corpus reroute send them to cards', () => {
  assert.strictEqual(leadsWithSetCode('1909-1911 T206 White Border Ty Cobb Bat Off Shoulder SGC GOOD 30'), true);
  assert.strictEqual(leadsWithSetCode('1887 N172 Old Judge Mike "King" Kelly'), true);
  assert.strictEqual(leadsWithSetCode('64 1887 N172 Old Judge Leech Maskrey - SGC FAIR 20'), true);
  assert.strictEqual(leadsWithSetCode('Signed 1933 R319 Goudey #120 Carl Reynolds - PSA/DNA'), true);
  assert.strictEqual(leadsWithSetCode('2008 Ivan Rodriguez Game-Used Louisville Slugger R226 Professional Model Bat'), false, 'bat model code, not a set');
  assert.strictEqual(leadsWithSetCode("1955-57 Ted Williams Game Used Hillerich & Bradsby 'W183' Professional Model Bat"), false);
  assert.strictEqual(leadsWithSetCode('1964 Leaf R734-3 Munsters Unopened Wax Box'), false, 'post-1959');
  assert.strictEqual(classifySports('', '1909-1911 T206 White Border Nap Lajoie with Bat SGC GOOD+ 2.5'), 'graded-card');
  assert.strictEqual(classifySports('', '1921 Tip Top Bread Baltimore Orioles Lefty Grove Pre-Rookie SGC FAIR 1.5'), 'graded-card');
  assert.strictEqual(classifySports('', '1927 Babe Ruth Game Used Bat PSA/DNA GU 9'), 'game-used');
  const lots = [
    L({ id: 'rea-1', auctionHouse: 'REA', artist: 'game-used', title: '1909-1911 T206 White Border Sherry Magee with Bat PSA EX 5' }),
    L({ id: 'rea-2', auctionHouse: 'REA', artist: 'memorabilia', title: '1915 E106 American Caramel Nap Lajoie' }),
    L({ id: 'rea-3', auctionHouse: 'REA', artist: 'unopened-wax', title: '1952 Topps Unopened Wax Pack' }),
    L({ id: 'goldin-1', auctionHouse: 'Goldin', artist: 'game-used', title: '1909 T206 Ty Cobb' }),
  ];
  assert.strictEqual(rerouteSetCodeCards(lots), 2);
  assert.deepStrictEqual(lots.map((l: R) => l.artist), ['graded-cards', 'graded-cards', 'unopened-wax', 'game-used']);
});

check('foreign leading maker: tracked → re-routed, untracked → dropped, own-name mentions untouched', () => {
  const lots = [
    L({ id: 'w1', auctionHouse: "Christie's", artist: 'andy-warhol', title: 'Jean-Michel Basquiat' }),
    L({ id: 'p1', auctionHouse: "Christie's", artist: 'pablo-picasso', title: 'MATISSE, Henri. Six autograph letters signed' }),
    L({ id: 'm1', auctionHouse: 'Bonhams', artist: 'henri-matisse', title: 'After Marc Chagall Hommage a Teriade Grand Palais (Sorlier 44)' }),
    L({ id: 'p2', auctionHouse: 'Bonhams', artist: 'pablo-picasso', title: 'Jean Cocteau, portrait of Pablo Picasso' }),
    L({ id: 'w2', auctionHouse: 'Bonhams', artist: 'andy-warhol', title: 'Michael Jackson and Little Angel at the Basquiat Opening' }),
    L({ id: 'x', auctionHouse: 'REA', artist: 'memorabilia', title: 'Marc Chagall signed program' }),
  ];
  const r = rerouteForeignLeadMaker(lots);
  assert.deepStrictEqual(r, { rerouted: 1, dropped: 2 });
  assert.deepStrictEqual(ids(lots), ['p1', 'p2', 'w2', 'x']);
  assert.strictEqual(lots.find((l: R) => l.id === 'p1').artist, 'henri-matisse');
});

// ── 9 · hammer == all-in ──────────────────────────────────────────────────
check('Wright/LAMA hammer copied from the all-in price → recomputed from a stamped BP, else nulled; hammer-only kept', () => {
  const lots = [
    L({ id: 'wright-168056', auctionHouse: 'Wright', priceUsd: 8750, hammerPrice: 8750, hammerUsd: 8750 }),
    L({ id: 'lama-bp', auctionHouse: 'LAMA', priceUsd: 12500, hammerPrice: 12500, buyerPremiumPct: 25 }),
    L({ id: 'wright-honest', auctionHouse: 'Wright', priceUsd: 6250, hammerPrice: 5000 }),
    L({ id: 'wright-hammer-only', auctionHouse: 'Wright', priceUsd: 5000, hammerPrice: 5000, priceBasis: 'hammer-only' }),
  ];
  assert.deepStrictEqual(fixFamilyHammerEqualsPrice(lots), { recomputed: 1, nulled: 1 });
  assert.strictEqual(lots[0].hammerPrice, null); assert.strictEqual(lots[0].hammerUsd, null);
  assert.strictEqual(lots[1].hammerPrice, 10000);
  assert.strictEqual(lots[2].hammerPrice, 5000);
  assert.strictEqual(lots[3].hammerPrice, 5000);
  assert.deepStrictEqual(fixFamilyHammerEqualsPrice(lots), { recomputed: 0, nulled: 0 }, 'idempotent');
});

// ── 10 · one served live book ─────────────────────────────────────────────
check('isServedUpcoming = the upcoming.json predicate (sync-lots-db shares it)', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  assert.strictEqual(isServedUpcoming({ status: 'upcoming', saleDate: '2026-09-27' }, now), true);
  assert.strictEqual(isServedUpcoming({ status: 'upcoming', saleDate: '2026-09-26' }, now), false, 'closed yesterday, no results-pending');
  assert.strictEqual(isServedUpcoming({ status: 'upcoming', saleDate: '2026-09-26', resultsPending: true }, now), true, 'grace day');
  assert.strictEqual(isServedUpcoming({ status: 'upcoming', saleDate: '2026-09-25', resultsPending: true }, now), false);
  assert.strictEqual(isServedUpcoming({ status: 'sold', saleDate: '2026-10-01' }, now), false);
  assert.strictEqual(isServedUpcoming({ status: 'upcoming', saleDate: null }, now), false);
});

console.log(`\n${passed} passed`);
