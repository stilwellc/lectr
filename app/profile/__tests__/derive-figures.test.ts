/**
 * THE DESK'S OWN FIGURES (desk/derive, Oct 29 2026) — every number the
 * masthead, the cockpit and the tab badges print, on fixtures: the estimate
 * total's currency rule, one-sided estimates counted apart, closes-today on
 * the reader's day across a timezone edge, My max against a non-USD bid, the
 * Did-you-win inbox, the record's median on an even count, new bids vs the
 * saved bid_count, the collection's totals, the since-last-visit news.
 *
 * The clock is pinned to a US evening (10:30 PM ET, Oct 29 2026 = 02:30Z Oct
 * 30) in the New York zone, so a UTC-sliced day would land tomorrow — the bug
 * every day figure here guards against.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { AuctionLot } from '../../types';
import type { SavedMeta } from '../../lib/account';
import type { LedgerRow } from '../desk/derive';
import { pinClock } from '../../lib/__tests__/helpers/pin-clock';

process.env.TZ = 'America/New_York';
pinClock('2026-10-29T22:30:00-04:00');

// derive.ts carries the live-signal reader (components/LotCard → the comps
// modal's stylesheet): stub the extension, then load the module
(Module as unknown as { _extensions: Record<string, (m: unknown, f: string) => void> })._extensions['.css'] = () => {};
declare const require: NodeRequire;
const D = require('../desk/derive') as typeof import('../desk/derive');

const lot = (over: Partial<AuctionLot> & Record<string, unknown>): AuctionLot =>
  ({ id: 'l', title: 'Lot', artist: 'andy-warhol', auctionHouse: 'Phillips', status: 'upcoming', saleDate: '2026-11-05', currency: 'USD',
    estimateLow: null, estimateHigh: null, priceUsd: null, ...over } as unknown as AuctionLot);
const meta = (over: Partial<SavedMeta> = {}): SavedMeta => ({ savedAt: '2026-10-01T12:00:00.000Z', estMid: null, signalPct: null, bidCount: null, ...over });
const sig = (entries: [string, { label: string; pct: number } | null][]) => new Map(entries);

/* ── the estimate total ─────────────────────────────────────────────────── */

test('watchSummaryOf: the total sums USD midpoints — a EUR lot through its dated rate (est*Usd), never its native figures', () => {
  const eur = lot({ id: 'eur', currency: 'EUR', fxRate: 1.08, estLowNative: 1000, estHighNative: 2000, estLowUsd: 1080, estHighUsd: 2160, estimateLow: 1080, estimateHigh: 2160 });
  const usd = lot({ id: 'usd', estimateLow: 1000, estimateHigh: 3000 });
  const s = D.watchSummaryOf([eur, usd], sig([]));
  assert.equal(s.totalEst, 1620 + 2000);
  assert.equal(s.priced, 2);
  assert.equal(s.oneSided, 0);
});

test('watchSummaryOf: a non-USD lot the money layer could not convert (no rate, no USD bound) adds nothing and is not "priced" — its native estimate is never summed 1:1', () => {
  // the crawler is fail-closed: an unconvertible currency keeps its native
  // bounds and carries NO USD estimate (types.ts: never a native figure
  // relabelled 'USD')
  const chf = lot({ id: 'chf', currency: 'CHF', estLowNative: 5000, estHighNative: 8000 });
  const usd = lot({ id: 'usd', estimateLow: 1000, estimateHigh: 3000 });
  const s = D.watchSummaryOf([chf, usd], sig([]));
  assert.equal(s.totalEst, 2000);
  assert.equal(s.priced, 1);
  assert.equal(s.oneSided, 0);
});

test('watchSummaryOf: the live book\'s GBP shape (Bonhams: currency GBP, no fxRate, estimateLow/High already dollars) sums at face — the alias IS USD', () => {
  // bonhams-31994-572 on Oct 29 2026: estimateLow 931 / estimateHigh 1197 =
  // £700 / £900 at 1.33 — the build converted; summing at face is right and
  // converting again (names.ts's old double-FX bug) would be the error
  const gbp = lot({ id: 'gbp', currency: 'GBP', estimateLow: 931, estimateHigh: 1197 });
  const s = D.watchSummaryOf([gbp], sig([]));
  assert.equal(s.totalEst, 1064);
  assert.equal(s.priced, 1);
});

test('watchSummaryOf: a one-sided estimate is counted apart and never summed; a bid-only lot is neither', () => {
  const from = lot({ id: 'rr', estimateLow: 700 });
  const bidOnly = lot({ id: 'goldin', currentBid: 402, bidCount: 10 });
  const priced = lot({ id: 'p', estimateLow: 1000, estimateHigh: 3000 });
  const s = D.watchSummaryOf([from, bidOnly, priced], sig([]));
  assert.equal(s.totalEst, 2000);
  assert.equal(s.priced, 1, 'priced counts BOTH-bounds lots only — "1 of 3 priced", never "3 of 3"');
  assert.equal(s.oneSided, 1);
});

test('watchSummaryOf: flagged = rows whose live signal reads Below Market', () => {
  const a = lot({ id: 'a' }), b = lot({ id: 'b' }), c = lot({ id: 'c' });
  const s = D.watchSummaryOf([a, b, c], sig([['a', { label: 'Below Market', pct: 30 }], ['b', { label: 'Above Market', pct: 12 }], ['c', null]]));
  assert.equal(s.flagged, 1);
});

/* ── closes today, on the reader's calendar ─────────────────────────────── */

test('watchSummaryOf: closesToday reads the reader\'s day — a 10 PM ET close (02:00Z tomorrow) is today; a 7 PM ET close tomorrow is not; a date-only sale day is its day', () => {
  const tonight = lot({ id: 'tonight', saleDate: '2026-10-30', saleDateTime: '2026-10-30T03:30:00Z', auctionHouse: 'Goldin' });   // 11:30 PM ET Oct 29 — still ahead of the 10:30 PM clock
  const tomorrow = lot({ id: 'tomorrow', saleDate: '2026-10-30', saleDateTime: '2026-10-30T23:00:00Z', auctionHouse: 'Goldin' }); // 7 PM ET Oct 30
  const dayOnly = lot({ id: 'day', saleDate: '2026-10-29' });
  const later = lot({ id: 'later', saleDate: '2026-11-02' });
  const s = D.watchSummaryOf([later, tonight, tomorrow, dayOnly], sig([]));
  assert.equal(s.closesToday, 2);
  assert.equal(D.closeDays(tonight), 0);
  assert.equal(D.closeDays(tomorrow), 1);
  // next = the first row (the shelf is sorted soonest-first upstream) whose close day is today or later
  assert.equal(s.next?.id, 'later');
});

/* ── My max vs the live bid ─────────────────────────────────────────────── */

test('liveBidUsd / overMaxOf: a USD bid reads as is; a EUR bid converts through its rate; a non-USD bid with no rate cannot be read against a USD max (never a false alarm); a sold lot is never over max', () => {
  const maxOf = (id: string) => ({ usd: 1000, eurOver: 1050, eurUnder: 1100, noRate: 1000, sold: 1000, noMax: null }[id] ?? null);
  const usd = lot({ id: 'usd', currentBid: 1200 });
  const eurOver = lot({ id: 'eurOver', currency: 'EUR', fxRate: 1.08, currentBid: 1000 });   // $1,080 > $1,050
  const eurUnder = lot({ id: 'eurUnder', currency: 'EUR', fxRate: 1.08, currentBid: 1000 }); // $1,080 < $1,100
  const noRate = lot({ id: 'noRate', currency: 'GBP', currentBid: 2000 });
  const sold = lot({ id: 'sold', currentBid: 5000, priceUsd: 5000 });
  const noMax = lot({ id: 'noMax', currentBid: 5000 });
  assert.equal(D.liveBidUsd(usd), 1200);
  assert.equal(D.liveBidUsd(eurOver), 1080);
  assert.equal(D.liveBidUsd(noRate), null);
  assert.equal(D.liveBidUsd(lot({ id: 'x' })), null);
  assert.deepEqual(D.overMaxIdsOf([usd, eurOver, eurUnder, noRate, sold, noMax], maxOf), ['usd', 'eurOver']);
  assert.equal(D.overMaxOf([usd, eurOver, eurUnder, noRate, sold, noMax], maxOf), 2);
});

test('needsYouOf: a watch both past your max and closing today is ONE thing; results to confirm add on top; the facts keep their own counts', () => {
  const both = lot({ id: 'both', saleDate: '2026-10-29', currentBid: 1500 });
  const onlyClosing = lot({ id: 'closing', saleDate: '2026-10-29' });
  const onlyOver = lot({ id: 'over', saleDate: '2026-11-03', currentBid: 1500 });
  const n = D.needsYouOf([both, onlyClosing, onlyOver], id => (id === 'both' || id === 'over' ? 1000 : null), 2);
  assert.deepEqual(n, { n: 3 + 2, overMax: 2, closesToday: 2, closedEarlierToday: 0, results: 2 });
});

/* ── the Did-you-win inbox ──────────────────────────────────────────────── */

test('unclaimedOf: settled wins not owned, not dismissed; past-pending rows, owned rows, dismissed rows and provisional orphans are out; ids are the SAVED ids', () => {
  const win = lot({ id: 'win', status: 'sold', priceUsd: 900, saleDate: '2026-10-20' });
  const aliased = lot({ id: 'wright-5', status: 'sold', priceUsd: 900, saleDate: '2026-10-21' }); // saved as rago-5
  const owned = lot({ id: 'owned', status: 'sold', priceUsd: 900, saleDate: '2026-10-22' });
  const dismissed = lot({ id: 'dis', status: 'sold', priceUsd: 900, saleDate: '2026-10-23' });
  const pending = lot({ id: 'pend', status: 'upcoming', saleDate: '2026-10-20', resultsPending: true });
  const metas: Record<string, SavedMeta> = { win: meta(), 'rago-5': meta(), owned: meta({ owned: true }), dis: meta({ dismissed: true }), pend: meta(),
    'arch-ok': meta(), 'arch-prov': meta(), 'arch-owned': meta({ owned: true }), 'arch-dis': meta({ dismissed: true }) };
  const savedIdOf = (id: string) => (id === 'wright-5' ? 'rago-5' : id);
  const r = D.unclaimedOf({
    sold: [win, aliased, owned, dismissed, pending],
    soldOrphans: [
      { id: 'arch-ok', priceUsd: 100, saleDate: '2026-10-01', provisional: false },
      { id: 'arch-prov', priceUsd: 100, saleDate: '2026-10-01', provisional: true },
      { id: 'arch-owned', priceUsd: 100, saleDate: '2026-10-01', provisional: false },
      { id: 'arch-dis', priceUsd: 100, saleDate: '2026-10-01', provisional: false },
    ],
    ownedLotIds: new Set(['owned']), ownedIdSet: new Set(['arch-owned', 'owned']),
    metaFor: id => metas[savedIdOf(id)], savedMeta: metas, savedIdOf,
  });
  assert.equal(r.n, 3);
  assert.deepEqual(r.ids, ['win', 'rago-5', 'arch-ok']);
});

/* ── the record ─────────────────────────────────────────────────────────── */

test('recordOf: judged = sold with a price against an estimate; the median on an even count is the mean of the two middles; realized sums the judged', () => {
  const j = (id: string, priceUsd: number, saleDate: string) => lot({ id, status: 'sold', priceUsd, saleDate, estimateLow: 800, estimateHigh: 1200 }); // mid 1000
  const sold = [j('a', 1100, '2026-10-01'), j('b', 1300, '2026-10-02'), j('c', 900, '2026-10-03'), j('d', 1500, '2026-10-04'),
    lot({ id: 'noEst', status: 'sold', priceUsd: 5000, saleDate: '2026-10-05' }),                                       // no estimate: not judged
    lot({ id: 'noPrice', status: 'sold', priceUsd: null, saleDate: '2026-10-06', estimateLow: 800, estimateHigh: 1200 })]; // no price: not judged
  const r = D.recordOf(sold, () => undefined);
  assert.ok(r);
  assert.equal(r.n, 4);
  // +10, +30, −10, +50 → sorted −10, 10, 30, 50 → (10 + 30) / 2
  assert.equal(Math.round(r.med! * 1e6) / 1e6, 20);
  assert.equal(r.realized, 1100 + 1300 + 900 + 1500);
  assert.equal(r.split, null, 'the flagged-vs-rest split needs 3 on each side');
  assert.deepEqual(r.series.map(x => x.id), ['a', 'b', 'c', 'd']);
  assert.equal(D.recordOf([lot({ id: 'x', status: 'sold', priceUsd: 10, saleDate: '2026-10-01' })], () => undefined), null);
});

test('sinceLastOf: watches that SETTLED after the previous visit day — a results-pending row (no price yet) is not settled news; before the archive, nothing', () => {
  const prev = '2026-10-25';
  const sold = [
    lot({ id: 'fresh', status: 'sold', priceUsd: 1200, saleDate: '2026-10-27', estimateLow: 800, estimateHigh: 1200 }),      // +20%
    lot({ id: 'fresh2', status: 'sold', priceUsd: 900, saleDate: '2026-10-28', estimateLow: 800, estimateHigh: 1200 }),      // −10%
    lot({ id: 'pending', status: 'upcoming', resultsPending: true, saleDate: '2026-10-28' }),                                  // closed, no result
    lot({ id: 'old', status: 'sold', priceUsd: 5000, saleDate: '2026-10-20', estimateLow: 800, estimateHigh: 1200 }),         // before the visit
  ];
  const since = D.sinceLastOf(sold, prev, true);
  assert.equal(since?.n, 2);
  assert.equal(Math.round((since?.med ?? NaN) * 1e6) / 1e6, 5);
  assert.equal(D.sinceLastOf(sold, prev, false), null);
  assert.equal(D.sinceLastOf(sold, null, true), null);
  assert.equal(D.sinceLastOf([sold[3]], prev, true), null);
});

/* ── what changed since the saves ───────────────────────────────────────── */

test('watchChangesOf: newBids = the bids landed past the SAVED bid_count, summed; a save with no count, a lot with no count, or fewer bids adds nothing', () => {
  const metas: Record<string, SavedMeta> = { a: meta({ bidCount: 3 }), b: meta({ bidCount: null }), c: meta({ bidCount: 3 }), d: meta({ bidCount: 5 }), e: meta({ bidCount: 0 }) };
  const rows = [lot({ id: 'a', bidCount: 7 }), lot({ id: 'b', bidCount: 7 }), lot({ id: 'c' }), lot({ id: 'd', bidCount: 2 }), lot({ id: 'e', bidCount: 2 }), lot({ id: 'unsaved', bidCount: 9 })];
  const c = D.watchChangesOf(rows, id => metas[id], sig([]));
  assert.equal(c.newBids, 4 + 2);
  assert.equal(c.moved, 0);
});

test('watchChangesOf: moved = a signed call whose magnitude changed (rounded) or whose side flipped; a legacy direction-unknown save never counts', () => {
  const metas: Record<string, SavedMeta> = {
    same: meta({ signalPct: 20 }), grew: meta({ signalPct: 20 }), flipped: meta({ signalPct: 20 }),
    legacy: meta({ savedAt: '2026-01-01T00:00:00.000Z', signalPct: 20 }), gone: meta({ signalPct: 20 }),
  };
  const rows = ['same', 'grew', 'flipped', 'legacy', 'gone'].map(id => lot({ id }));
  const c = D.watchChangesOf(rows, id => metas[id], sig([
    ['same', { label: 'Below Market', pct: 20.4 }],
    ['grew', { label: 'Below Market', pct: 25 }],
    ['flipped', { label: 'Above Market', pct: 20 }],
    ['legacy', { label: 'Above Market', pct: 60 }],
    ['gone', null],
  ]));
  assert.equal(c.moved, 2);
});

/* ── the collection's totals ────────────────────────────────────────────── */

test('collectionTotalsOf: the appraisal total is the engine\'s over the appraised pieces; the ±% and "marked vs bought" read the pieces with BOTH figures', () => {
  const t = D.collectionTotalsOf([
    { paid: 1000, appraised: 1500 },   // both
    { paid: null, appraised: 800 },    // appraised, no bought price (an archive win at no cost)
    { paid: 500, appraised: null },    // bought, no comp pool
  ]);
  assert.deepEqual(t, { totalPaid: 1500, totalAppraised: 2300, appraisedPaid: 1000, appraisedOfPaid: 1500, deltaPct: 50, appraisedN: 2, appraisedPaidN: 1 });
  assert.equal(D.collectionTotalsOf([{ paid: 500, appraised: null }]).deltaPct, null);
});

test('exposureOf: pieces and held value per sub-market (appraised, else bought), largest first; a piece with no sub-market is not placed', () => {
  const vintage = { slug: 'vintage', label: 'Vintage' }, modern = { slug: 'modern', label: 'Modern' };
  const e = D.exposureOf([
    { drill: vintage, appraised: 1500, paid: 1000 }, { drill: vintage, appraised: null, paid: 400 },
    { drill: modern, appraised: 3000, paid: null }, { drill: null, appraised: 9000, paid: 9000 },
  ]);
  assert.deepEqual(e, [{ row: modern, n: 1, held: 3000 }, { row: vintage, n: 2, held: 1900 }]);
});

/* ── the shelves, the saves, the orphans ────────────────────────────────── */

test('partitionSaved: live soonest-first; sold and past-pending rows settle most-recent-first; withdrawn / passed go to other', () => {
  const rows = [
    lot({ id: 'nov', saleDate: '2026-11-09' }), lot({ id: 'oct', saleDate: '2026-10-31' }),
    lot({ id: 'pending', saleDate: '2026-10-20' }),                      // upcoming, 9 days past its day: left the block
    lot({ id: 'sold1', status: 'sold', saleDate: '2026-10-01', priceUsd: 1 }), lot({ id: 'sold2', status: 'sold', saleDate: '2026-10-15', priceUsd: 1 }),
    lot({ id: 'withdrawn', status: 'withdrawn', saleDate: '2026-10-10' }),
    lot({ id: 'undated', saleDate: '' }),                                  // no date: stays live, sorts last
  ];
  const p = D.partitionSaved(rows);
  assert.deepEqual(p.upcoming.map(l => l.id), ['oct', 'nov', 'undated']);
  assert.deepEqual(p.sold.map(l => l.id), ['pending', 'sold2', 'sold1']);
  assert.deepEqual(p.other.map(l => l.id), ['withdrawn']);
});

test('resolveSaved: saves resolve through the alias map before an orphan is declared; duplicates collapse; orphans only once the archive answered', () => {
  const book = [lot({ id: 'a' }), lot({ id: 'wright-9' })];
  const r = D.resolveSaved(['a~', 'a', 'rago-9', 'missing'], book, true);
  assert.deepEqual(r.savedLots.map(l => l.id), ['a', 'wright-9']);
  assert.deepEqual(Array.from(r.savedIdByLotId.entries()), [['a', 'a~'], ['wright-9', 'rago-9']]);
  assert.deepEqual(r.orphanIds, ['missing']);
  assert.deepEqual(D.resolveSaved(['missing'], book, false).orphanIds, [], 'half a corpus never prints an orphan');
});

test('splitOrphans: the ledger answers through the same aliases; a 3-tuple is provisional; a miss is gone; nothing is judged before the ledger loads', () => {
  const ledger = new Map<string, LedgerRow>([['x', [900, '2026-10-02']], ['y', [100, '2026-10-05', 1]]]);
  const s = D.splitOrphans(['x~', 'y', 'gone'], ledger, true);
  assert.deepEqual(s.soldOrphans, [{ id: 'y', priceUsd: 100, saleDate: '2026-10-05', provisional: true }, { id: 'x~', priceUsd: 900, saleDate: '2026-10-02', provisional: false }]);
  assert.deepEqual(s.goneOrphans, ['gone']);
  assert.deepEqual(D.splitOrphans(['x~', 'gone'], ledger, false), { soldOrphans: [], goneOrphans: [] }, 'a ledger not yet loaded is not "withdrawn by the house"');
});

test('tenureOf: the oldest save\'s month, once older than 30 days', () => {
  const metas = { a: meta({ savedAt: '2026-03-15T10:00:00.000Z' }), b: meta({ savedAt: '2026-09-01T10:00:00.000Z' }) };
  assert.equal(D.tenureOf(['a', 'b'], metas), 'March 2026');
  assert.equal(D.tenureOf(['b'], { b: meta({ savedAt: '2026-10-20T10:00:00.000Z' }) }), null);
  assert.equal(D.tenureOf([], {}), null);
});

/* ── closed earlier today, awaiting results, and the paper's parity ──────── */

test('watchSummaryOf / needsYouOf: a watch whose published close passed earlier today is "closed earlier today" (results pending), never "closes today" and never counted as needing you', () => {
  const now = Date.now(); // 10:30 PM ET
  const earlier = lot({ id: 'earlier', saleDate: '2026-10-30', saleDateTime: '2026-10-29T18:00:00Z', auctionHouse: 'Goldin', closeKind: 'online', currentBid: 500 } as Partial<AuctionLot>); // 2 PM ET today
  const tonight = lot({ id: 'tonight', saleDate: '2026-10-30', saleDateTime: '2026-10-30T03:00:00Z', auctionHouse: 'Goldin', closeKind: 'online' } as Partial<AuctionLot>); // 11 PM ET today
  const dayOnly = lot({ id: 'day', saleDate: '2026-10-29', auctionHouse: 'Phillips' }); // closes when its day ends where it is sold — still ahead at 10:30 PM
  const s = D.watchSummaryOf([earlier, tonight, dayOnly], sig([]), now);
  assert.equal(s.closesToday, 2);
  assert.equal(s.closedEarlierToday, 1);
  const ny = D.needsYouOf([earlier, tonight, dayOnly], () => null, 0, now);
  assert.deepEqual(ny, { n: 2, overMax: 0, closesToday: 2, closedEarlierToday: 1, results: 0 });
  // past your max AND closed earlier: the bid still needs you (it is said), the close does not
  const ny2 = D.needsYouOf([earlier, tonight], id => (id === 'earlier' ? 1 : null), 1, now);
  assert.deepEqual(ny2, { n: 2 + 1, overMax: 1, closesToday: 1, closedEarlierToday: 1, results: 1 });
});

test('pendingResultsOf: the settled shelf\'s rows the house hasn\'t resulted — "awaiting results", not "settled"', () => {
  const sold = [
    lot({ id: 's1', status: 'sold', priceUsd: 10, saleDate: '2026-10-01' }),
    lot({ id: 'p1', status: 'upcoming', saleDate: '2026-10-20' }),
    lot({ id: 'p2', status: 'upcoming', saleDate: '2026-10-21', resultsPending: true }),
  ];
  assert.equal(D.pendingResultsOf(sold), 2);
  assert.equal(D.pendingResultsOf([]), 0);
});

test('parity: the Daily Desk\'s glance total is the desk\'s own total (pricedTotal) over the same watches', () => {
  const { planDesk } = require('../../../scripts/lib/daily-desk') as typeof import('../../../scripts/lib/daily-desk');
  const { pricedTotal, liveBidUsd } = require('../desk/priced') as typeof import('../desk/priced');
  const rows = [
    lot({ id: 'usd', saleDate: '2026-11-02', saleDateTime: '2026-11-02T23:00:00Z', estimateLow: 1000, estimateHigh: 3000 }),
    lot({ id: 'gbp', saleDate: '2026-11-03', saleDateTime: '2026-11-03T23:00:00Z', currency: 'GBP', estimateLow: 931, estimateHigh: 1197 }),
    lot({ id: 'eur', saleDate: '2026-11-04', saleDateTime: '2026-11-04T23:00:00Z', currency: 'EUR', fxRate: 1.08, estLowUsd: 1080, estHighUsd: 2160, estimateLow: 1080, estimateHigh: 2160, currentBid: 1000 }),
    lot({ id: 'rr', saleDate: '2026-11-05', saleDateTime: '2026-11-05T23:00:00Z', estimateLow: 700 }),
  ];
  const desk = D.watchSummaryOf(rows, sig([]));
  const paper = planDesk({ now: Date.now(), tz: 'America/New_York', watches: rows.map(l => ({ lot_id: l.id, max_usd: 1050 })), live: new Map(rows.map(l => [l.id, l])), sold: [], picks: [] })!;
  const t = pricedTotal(rows);
  assert.equal(desk.totalEst, t.total);
  assert.deepEqual([paper.glance.priced, paper.glance.oneSided], [desk.priced, desk.oneSided]);
  assert.deepEqual([desk.priced, desk.oneSided], [t.priced, t.oneSided]);
  // the over-max read: the same USD bid on both surfaces
  assert.equal(D.liveBidUsd, liveBidUsd);
  assert.deepEqual(paper.overMax.map(i => i.id), D.overMaxIdsOf(rows, () => 1050));
});
