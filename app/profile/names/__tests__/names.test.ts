import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinClock } from '../../../lib/__tests__/helpers/pin-clock';
import type { AuctionLot } from '../../../types';
import type { EntityDetail, EntitySummary } from '../../../lib/entity/model';
import type { Follow } from '../../../lib/follows';
import { FLAG_SIGNAL } from '../../../lib/flags';
import {
  isoDayOf, marketOfName, deskNamesOf, groupByMarket, liveLotsOf, salesOf, estOf, saleWhen, calendarTotals,
  pulseOf, sparkSpan, blindSpotOf, agoText, namesTotals, orderNames, type DeskName, type NameRead,
} from '../names';

pinClock('2026-10-11T16:00:00-04:00');
const NOW = Date.now();
const H = 3_600_000;

function lot(o: Partial<AuctionLot> & { id: string; artist: string }): AuctionLot {
  return {
    title: 'Untitled', year: null, medium: null, dimensions: null, category: 'original', imageUrl: null,
    auctionHouse: "Christie's", saleName: 'New York Sale 1', saleDate: '2026-10-20', lotNumber: 1,
    estimateLow: 1000, estimateHigh: 2000, currency: 'USD', hammerPrice: null, premiumPrice: null, priceUsd: null,
    status: 'upcoming', url: 'https://example.test', ...o,
  } as AuctionLot;
}

const F = {
  warhol: { kind: 'maker', key: 'andy-warhol', label: 'Andy Warhol' } as Follow,
  rolex: { kind: 'maker', key: 'rolex', label: 'Rolex' } as Follow,
  charizard: { kind: 'entity', key: 'sj:tcg|k:charizard', label: 'Charizard' } as Follow,
  watches: { kind: 'cat', key: 'watches', label: 'Watches' } as Follow,
  phillips: { kind: 'house', key: 'Phillips', label: 'Phillips' } as Follow,
};

test('isoDayOf reads the desk clock, never the wall clock', () => {
  assert.equal(isoDayOf(Date.parse('2026-10-11T12:00:00')), '2026-10-11');
});

test('marketOfName: an entity id names its market; a category follow its category’s; a house nothing', () => {
  assert.equal(marketOfName({ id: 'mk:andy-warhol', follow: F.warhol }), 'art');
  assert.equal(marketOfName({ id: 'mk:rolex', follow: F.rolex }), 'watches');
  assert.equal(marketOfName({ id: 'sj:tcg|k:charizard', follow: F.charizard }), 'tcg');
  assert.equal(marketOfName({ id: null, follow: F.watches }), 'watches');
  assert.equal(marketOfName({ id: null, follow: { kind: 'cat', key: 'sports-cards:singles', label: 'x' } }), 'sports');
});

test('deskNamesOf: follows (no houses) + owned + saved, once each, counted on the one row', () => {
  const owned = [lot({ id: 'o1', artist: 'andy-warhol', ek: 'mk:andy-warhol' } as never), lot({ id: 'o2', artist: 'george-nakashima', ek: 'mk:george-nakashima' } as never)];
  const saved = [lot({ id: 's1', artist: 'andy-warhol', ek: 'mk:andy-warhol' } as never), lot({ id: 's2', artist: 'alexander-calder', ek: 'mk:alexander-calder' } as never), lot({ id: 's3', artist: 'alexander-calder', ek: 'mk:alexander-calder' } as never)];
  const names = deskNamesOf([F.warhol, F.phillips, F.charizard, F.watches], owned, saved);
  const by = new Map(names.map(n => [n.key, n]));
  assert.deepEqual(Array.from(by.keys()), ['mk:andy-warhol', 'sj:tcg|k:charizard', 'cat:watches', 'mk:george-nakashima', 'mk:alexander-calder']);
  const w = by.get('mk:andy-warhol')!;
  assert.equal(w.followed, true); assert.equal(w.owned, 1); assert.equal(w.saved, 1); assert.equal(w.market, 'art');
  const nk = by.get('mk:george-nakashima')!;
  assert.equal(nk.followed, false); assert.equal(nk.owned, 1); assert.equal(nk.saved, 0); assert.equal(nk.market, 'design');
  const c = by.get('mk:alexander-calder')!;
  assert.equal(c.saved, 2); assert.equal(c.owned, 0); assert.equal(c.followed, false);
  assert.ok(!names.some(n => n.follow.kind === 'house'), 'a house is not a name');
});

test('groupByMarket: the site’s market order, empty markets absent, unknown market last as "Across markets"', () => {
  const mk = (key: string, market: DeskName['market']): DeskName => ({ key, id: null, label: key, follow: F.watches, followed: true, owned: 0, saved: 0, market });
  const g = groupByMarket([mk('a', 'tcg'), mk('b', 'art'), mk('c', 'all'), mk('d', 'art')]);
  assert.deepEqual(g.map(x => x.market), ['all', 'art', 'tcg']);
  assert.equal(g[0].label, 'Across markets');
  assert.equal(g[1].names.length, 2);
});

test('liveLotsOf: a name with an entity joins on the lot’s ek; a closed lot is not live', () => {
  const book = [
    lot({ id: 'a', artist: 'andy-warhol', ek: 'mk:andy-warhol', saleDate: '2026-10-20' } as never),
    lot({ id: 'b', artist: 'andy-warhol', ek: 'mk:andy-warhol', saleDate: '2026-09-01' } as never),
    lot({ id: 'c', artist: 'pablo-picasso', ek: 'mk:pablo-picasso', saleDate: '2026-10-20' } as never),
  ];
  const got = liveLotsOf({ id: 'mk:andy-warhol', follow: F.warhol }, book, NOW);
  assert.deepEqual(got.map(l => l.id), ['a']);
});

test('liveLotsOf: a category follow (no entity) uses the follow matcher', () => {
  const book = [lot({ id: 'w', artist: 'rolex', ek: 'mk:rolex', title: 'Rolex Submariner wristwatch', subCat: 'wristwatches', saleDate: '2026-10-20' } as never)];
  const got = liveLotsOf({ id: null, follow: F.watches }, book, NOW);
  assert.equal(got.length, 1);
});

test('estOf: the estimate fields are USD and are NEVER converted again; a one-sided estimate is not priced; none is none', () => {
  assert.deepEqual(estOf(lot({ id: 'a', artist: 'x', estimateLow: 100, estimateHigh: 300 })), { lo: 100, hi: 300, priced: true, side: null });
  assert.deepEqual(estOf(lot({ id: 'a', artist: 'x', estimateLow: 100, estimateHigh: null })), { lo: 100, hi: 100, priced: false, side: 'low' });
  assert.deepEqual(estOf(lot({ id: 'a2', artist: 'x', estimateLow: null, estimateHigh: 900 })), { lo: 900, hi: 900, priced: false, side: 'high' });
  // a non-USD lot whose row carries estimateLow/High only: those ARE dollars (the aliases of est*Usd) — read as comps.estUsdBand does
  assert.deepEqual(estOf(lot({ id: 'b', artist: 'x', currency: 'EUR', estimateLow: 100, estimateHigh: 300, saleDate: '2026-10-14' })), { lo: 100, hi: 300, priced: true, side: null });
  // the canonical USD fields lead when present
  assert.deepEqual(estOf(lot({ id: 'c', artist: 'x', currency: 'EUR', estimateLow: 100, estimateHigh: 300, estLowUsd: 110, estHighUsd: 330 })), { lo: 110, hi: 330, priced: true, side: null });
  assert.equal(estOf(lot({ id: 'd', artist: 'x', estimateLow: null, estimateHigh: null })), 'none');
});

/* THE LIVE BOOK (R4#1, R1#10 — the double-FX bug). Two rows copied from prod
   upcoming.json as pulled on Oct 11 2026 (lastCrawl Oct 11): every one of its
   158 non-USD live lots carries estimateLow/High only, already in dollars.
   names.ts used to multiply them by fxRateFor again when est*Usd was null. */
const CALDER_DKK = lot({
  id: 'bonhams-brk_1008686-50FCC97140EF', artist: 'alexander-calder', ek: 'mk:alexander-calder',
  title: 'Alexander Calder: "Asymétrie". Signed in print Calder 72. Lithograph in colours. Visible size 80 x 57 cm.',
  category: 'print', subCat: 'prints', auctionHouse: 'Bruun Rasmussen', saleName: '', saleDate: '2026-10-13', saleDateTime: '2026-10-13T18:32:00+00:00',
  lotNumber: 776, estimateLow: 233.1, estimateHigh: 310.8, currency: 'DKK',
} as never);
const MAO_EUR = lot({
  id: 'bonhams-31799-62', artist: 'andy-warhol', ek: 'mk:andy-warhol', title: 'Mao, 1972', category: 'print', subCat: 'prints',
  auctionHouse: 'Bonhams', saleName: '', saleDate: '2026-10-28', saleDateTime: '2026-10-28T14:00:00+00:00', lotNumber: 62,
  estimateLow: 13800, estimateHigh: 20700, currency: 'EUR',
} as never);

test('X3#1 the live book: the Bruun Rasmussen DKK Calder reads $233–$311 (it printed "$36–$48"); the Bonhams EUR Mao $13.8K–$20.7K (it printed ≈$15.9K–$23.8K)', () => {
  assert.deepEqual(estOf(CALDER_DKK), { lo: 233.1, hi: 310.8, priced: true, side: null });
  assert.deepEqual(estOf(MAO_EUR), { lo: 13800, hi: 20700, priced: true, side: null });
  const sales = salesOf([CALDER_DKK, MAO_EUR]);
  assert.deepEqual(sales.map(s => s.house), ['Bruun Rasmussen', 'Bonhams']);
  assert.deepEqual(sales[0].est, { lo: 233.1, hi: 310.8, k: 1, oneSided: 0, from: 0, none: 0 });
  assert.deepEqual(sales[1].est, { lo: 13800, hi: 20700, k: 1, oneSided: 0, from: 0, none: 0 });
  const t = calendarTotals(sales);
  assert.equal(t.lo, 233.1 + 13800); assert.equal(t.hi, 310.8 + 20700);
  assert.ok(!('approx' in t), 'nothing is approximate: nothing was converted');
});

test('X3#2 one-sided estimates (RR publishes the low only): the sale prints "from $700" on 2 and sums nothing', () => {
  const rr = (id: string, low: number) => lot({ id, artist: 'historical', auctionHouse: 'RR Auction', saleName: 'Fine Autographs', saleDate: '2026-10-14', estimateLow: low, estimateHigh: null, currentBid: 300, bidCount: 4 });
  const sales = salesOf([rr('rr-1', 350), rr('rr-2', 350), lot({ id: 'rr-3', artist: 'historical', auctionHouse: 'RR Auction', saleName: 'Fine Autographs', saleDate: '2026-10-14', estimateLow: 1000, estimateHigh: 2000 })]);
  assert.equal(sales.length, 1);
  assert.deepEqual(sales[0].est, { lo: 1000, hi: 2000, k: 1, oneSided: 2, from: 700, none: 0 });
  const t = calendarTotals(sales);
  assert.equal(t.k, 1); assert.equal(t.oneSided, 2); assert.equal(t.from, 700);
});

test('salesOf: groups by house + sale + close day, sums the priced bands, counts bids and flags, soonest first', () => {
  const lots = [
    lot({ id: '1', artist: 'andy-warhol', auctionHouse: "Christie's", saleName: 'NY 2', saleDate: '2026-10-22', estimateLow: 1000, estimateHigh: 2000 }),
    lot({ id: '2', artist: 'andy-warhol', auctionHouse: "Christie's", saleName: 'NY 2', saleDate: '2026-10-22', estimateLow: 3000, estimateHigh: 5000, signal: { label: FLAG_SIGNAL } } as never),
    lot({ id: '3', artist: 'andy-warhol', auctionHouse: 'Bonhams', saleName: '', saleDate: '2026-10-14', currency: 'EUR', estimateLow: 100, estimateHigh: 200 }),
    lot({ id: '4', artist: 'andy-warhol', auctionHouse: 'Goldin', saleName: 'Weekly', saleDate: '2026-10-18', estimateLow: null, estimateHigh: null, currentBid: 40000, bidCount: 12 }),
  ];
  const sales = salesOf(lots);
  assert.deepEqual(sales.map(s => s.house), ['Bonhams', 'Goldin', "Christie's"]);
  const c = sales[2];
  assert.equal(c.lots.length, 2);
  assert.deepEqual(c.est, { lo: 4000, hi: 7000, k: 2, oneSided: 0, from: 0, none: 0 });
  assert.equal(c.flagged, 1);
  // the Bonhams EUR lot's estimateLow/High are dollars already — summed as they are
  assert.deepEqual(sales[0].est, { lo: 100, hi: 200, k: 1, oneSided: 0, from: 0, none: 0 });
  assert.deepEqual(sales[1].est, { lo: 0, hi: 0, k: 0, oneSided: 0, from: 0, none: 1 });
  assert.deepEqual(sales[1].bids, { n: 1, sum: 40000 });
  assert.ok(sales.every(s => s.closeMs != null && s.closeMs > NOW));
  const t = calendarTotals(sales);
  assert.deepEqual(t, { lots: 4, sales: 3, lo: 4100, hi: 7200, k: 3, oneSided: 0, from: 0, flagged: 1 });
});

test('saleWhen: hours inside a day, days beyond, closed, unknown', () => {
  assert.deepEqual(saleWhen(NOW + 3 * H + 7 * 60_000, NOW), { kind: 'hours', hours: 3, minutes: 7 });
  assert.deepEqual(saleWhen(NOW - 1, NOW), { kind: 'closed' });
  assert.deepEqual(saleWhen(null, NOW), { kind: 'unknown' });
  const d = saleWhen(NOW + 3 * 24 * H, NOW);
  assert.equal(d.kind, 'day');
  assert.equal((d as { days: number }).days, 3);
});

const summary = (o: Partial<EntitySummary>): EntitySummary => ({
  id: 'mk:andy-warhol', kind: 'maker', market: 'art', label: 'Andy Warhol', discipline: null, face: null, page: null,
  sold: 14000, sold12m: 553, med12m: 33020, med12mN: 553, medScope: 'unique works', record: { p: 195040000, d: '2022-05-08' },
  spark: [1, 2, null, 4], sparkN: [10, 10, 2, 10], sparkBasis: 'median', yoy: { pct: 8.2, n: 41, basis: 'matched', lo: 1.1, hi: 15 }, verified: null, thin: false,
  caps: { compare: true, follow: 'andy-warhol', dossier: true }, ...o,
});

test('pulseOf: the published figures pass through; a median never prints without its n', () => {
  const p = pulseOf(summary({}), ['2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3'])!;
  assert.equal(p.med12m, 33020); assert.equal(p.med12mN, 553); assert.equal(p.scope, 'unique works');
  assert.deepEqual(p.spark, [1, 2, null, 4]);
  assert.equal(p.yoy?.pct, 8.2);
  assert.equal(sparkSpan(p.sparkQ, 4), '2025-Q4 to 2026-Q3');
  const gated = pulseOf(summary({ med12m: 500, med12mN: null }))!;
  assert.equal(gated.med12m, null, 'no n → no median');
  const thin = pulseOf(summary({ spark: [5, null, null, null] }))!;
  assert.equal(thin.spark, null, 'one point is not a trend');
  assert.equal(pulseOf(null), null);
  assert.equal(pulseOf(summary({ yoy: null }))!.yoy, null, 'the build printed no YoY → none here');
});

const detail: EntityDetail = {
  yearly: [], cats: [],
  houses: [{ h: "Sotheby's", n: 50 }, { h: "Christie's", n: 40 }, { h: 'Phillips', n: 10 }, { h: 'Wright', n: 0 }],
  top: [{ id: 't1', img: null, p: 195040000, d: '2022-05-08', t: 'Marilyn', h: "Christie's", cat: 'Paintings' }],
  recent: [
    { id: 'r1', img: null, p: 896000, d: '2026-10-08', t: 'Cowboys', h: "Sotheby's", cat: 'Prints' },
    { id: 'r2', img: null, p: 217600, d: '2026-10-08', t: 'Nickel', h: "Sotheby's", cat: 'Prints' },
    { id: 'r3', img: null, p: 5000, d: '2026-09-01', t: 'Small', h: 'Bonhams', cat: 'Prints' },
  ],
};

test('blindSpotOf: last seen = newest row (highest price on a tie), days since from the desk clock, house shares', () => {
  const b = blindSpotOf(detail, NOW)!;
  assert.equal(b.lastSeen?.id, 'r1');
  assert.equal(b.daysSince, 3);
  assert.deepEqual(b.houses.map(h => [h.h, h.share]), [["Sotheby's", 0.5], ["Christie's", 0.4], ['Phillips', 0.1]]);
  assert.equal(b.housesN, 100);
  const old = blindSpotOf({ ...detail, recent: [] }, NOW)!;
  assert.equal(old.lastSeen?.id, 't1', 'with no recent rows the record is the last seen');
  assert.equal(blindSpotOf(null, NOW), null);
  assert.equal(blindSpotOf({ ...detail, recent: [], top: [] }, NOW)!.lastSeen, null);
});

test('agoText', () => {
  assert.equal(agoText(0), 'today'); assert.equal(agoText(1), 'yesterday'); assert.equal(agoText(3), '3 days ago');
  assert.equal(agoText(45), '2 months ago'); assert.equal(agoText(365), '1 year ago'); assert.equal(agoText(900), '2.5 years ago');
});

test('namesTotals + orderNames: live names first by soonest sale, then blind spots by last seen', () => {
  const mk = (key: string, live: number, closeMs: number | null): NameRead => ({
    name: { key, id: key, label: key, follow: F.warhol, followed: true, owned: 0, saved: 0, market: 'art' },
    sales: closeMs == null ? [] : [{ key: 's', house: 'H', saleName: '', day: '', closeMs, timed: true, lots: [], est: { lo: 0, hi: 0, k: 0, oneSided: 0, from: 0, none: 0 }, bids: { n: 0, sum: 0 }, flagged: 0 }],
    live, flagged: 0,
  });
  const reads = [mk('late', 2, NOW + 5 * 24 * H), mk('quietOld', 0, null), mk('soon', 1, NOW + 2 * H), mk('quietNew', 0, null)];
  const seen: Record<string, string> = { quietOld: '2024-01-01', quietNew: '2026-10-01' };
  assert.deepEqual(orderNames(reads, k => seen[k] ?? null).map(r => r.name.key), ['soon', 'late', 'quietNew', 'quietOld']);
  assert.deepEqual(namesTotals(reads), { names: 4, live: 2, blind: 2, sales: 1, lots: 3 });
});
