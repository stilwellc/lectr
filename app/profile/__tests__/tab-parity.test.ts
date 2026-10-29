/**
 * THE SECTION BAR'S FIGURES (sections.ts tabItemsOf) equal the room heads
 * they stand for, on one fixture desk: Watching N = the room's "N live lots",
 * For you = "N picked", Week = the rows the week LISTS (watches + picks shown;
 * watches alone while the device hides picks), Record = the record's median,
 * Collection = the pieces, Names = the roster. And the cockpit's 14-day strip
 * counts exactly what Your week counts, day by day.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { AuctionLot } from '../../types';
import type { DeskData } from '../desk/types';
import type { DeskInternals } from '../desk/provider';
import { pinClock } from '../../lib/__tests__/helpers/pin-clock';
import { storageSet } from '../../lib/safe-storage';
import { fmtSignedPct, localToday } from '../../utils';

process.env.TZ = 'America/New_York';
pinClock('2026-10-29T16:00:00-04:00');
const NOW = Date.now();

(Module as unknown as { _extensions: Record<string, (m: unknown, f: string) => void> })._extensions['.css'] = () => {};
declare const require: NodeRequire;
const { tabItemsOf } = require('../desk/sections') as typeof import('../desk/sections');
const { planOf, PICKS_KEY } = require('../week') as typeof import('../week');
const { planWeek, weekLeadOf, pickDefault } = require('../week/week') as typeof import('../week/week');
const { hammerStrip } = require('../desk/cockpit-logic') as typeof import('../desk/cockpit-logic');
const { deskNamesOf, namesTotals, liveLotsOf, salesOf } = require('../names/names') as typeof import('../names/names');

const lot = (over: Partial<AuctionLot> & Record<string, unknown>): AuctionLot =>
  ({ id: 'l', title: 'Work', artist: 'andy-warhol', auctionHouse: "Christie's", saleName: 'New York Sale 1', status: 'upcoming', currency: 'USD',
    saleDate: '2026-11-02', saleDateTime: '2026-11-02T23:00:00Z', estimateLow: 1000, estimateHigh: 2000, priceUsd: null, ek: 'mk:andy-warhol', ...over } as unknown as AuctionLot);

// three watches on the week, one beyond it; four picks (two on the week); one owned piece; one followed name
const watches = [
  lot({ id: 'w1', saleDate: '2026-10-30', saleDateTime: '2026-10-30T23:00:00Z' }),
  lot({ id: 'w2', saleDate: '2026-11-03', saleDateTime: '2026-11-03T23:00:00Z', estimateLow: 700, estimateHigh: null }),
  lot({ id: 'w3', saleDate: '2026-11-05', saleDateTime: '2026-11-05T23:00:00Z' }),
  lot({ id: 'w4', saleDate: '2026-11-20', saleDateTime: '2026-11-20T23:00:00Z' }),
];
const picks = [
  lot({ id: 'p1', saleDate: '2026-10-31', saleDateTime: '2026-10-31T23:00:00Z', artist: 'kaws', ek: 'mk:kaws' }),
  lot({ id: 'p2', saleDate: '2026-11-04', saleDateTime: '2026-11-04T23:00:00Z', artist: 'kaws', ek: 'mk:kaws' }),
  lot({ id: 'p3', saleDate: '2026-11-25', saleDateTime: '2026-11-25T23:00:00Z', artist: 'kaws', ek: 'mk:kaws' }),
  lot({ id: 'p4', saleDate: '2026-12-01', saleDateTime: '2026-12-01T23:00:00Z', artist: 'kaws', ek: 'mk:kaws' }),
];
const owned = lot({ id: 'o1', status: 'sold', priceUsd: 5000, saleDate: '2026-09-01', saleDateTime: null, artist: 'george-nakashima', ek: 'mk:george-nakashima' });
const nameLot = lot({ id: 'n1', saleDate: '2026-11-06', saleDateTime: '2026-11-06T23:00:00Z', artist: 'george-nakashima', ek: 'mk:george-nakashima' });
const follows = [{ kind: 'maker' as const, key: 'george-nakashima', label: 'George Nakashima' }];
const book = [...watches, ...picks, nameLot];

const desk = {
  now: NOW, signedIn: true, book, fullLoaded: true, fullError: false, lastCrawl: '2026-10-29',
  saved: [...watches, owned], savedIds: new Set([...watches.map(l => l.id), 'o1']), metaFor: () => null,
  collection: [owned], ownedIds: new Set(['o1']), ledger: new Map(), ledgerLoaded: true, taste: null, follows,
  price: { minUsd: null, maxUsd: null }, recs: picks.map(l => ({ lot: l, score: 1, seed: { kind: 'follow', label: 'KAWS' } })), closingPicks: [], lastVisitMs: null,
} as unknown as DeskData;
const record = { n: 5, realized: 50_000, med: 73.4, oneSidedN: 0, split: null, series: [] };
const collection = { rows: [{ lot: owned, paid: 5000, paidIsOverride: false, note: null, savedId: 'o1', appraised: 6000, basis: '3 comps', refOnly: false, deltaPct: 20, drill: null, drillSlug: null }],
  totalPaid: 5000, totalAppraised: 6000, appraisedPaid: 5000, appraisedOfPaid: 6000, deltaPct: 20, appraisedN: 1, appraisedPaidN: 1, pendingOwned: [] };
const i = {
  deskView: true, signedOutView: false, watchFirst: true, upcoming: watches, todayShows: true, hasMarket: true, unseenAlerts: 0,
  hasRecordRoom: true, record, collection, historyCount: 1, orphanIds: [], settledCount: 1, pendingResultsN: 0, other: [], unclaimedWins: 0, sinceLastN: 0,
} as unknown as DeskInternals;

const tabs = () => Object.fromEntries(tabItemsOf(desk, i).map(t => [t.id, t]));

test('Watching = the room\'s "N live lots"; For you = the room\'s "N picked"; Record = the record\'s median; Collection = the pieces; Names = the roster', () => {
  const t = tabs();
  assert.equal(t.watching.count, i.upcoming.length);
  assert.equal(t['for-you'].count, desk.recs.length);
  assert.equal(t.record.count, fmtSignedPct(Math.round(record.med)));
  assert.equal(t.record.count, '+73%');
  assert.equal(t.owned.count, desk.collection.length);
  assert.equal(desk.collection.length, collection.rows.length);
  const names = deskNamesOf(desk.follows, desk.collection, desk.saved);
  const reads = names.map(n => { const lots = liveLotsOf(n, desk.book, NOW); return { name: n, sales: salesOf(lots), live: lots.length, flagged: 0 }; });
  assert.equal(t.names.count, names.length);
  assert.equal(t.names.count, namesTotals(reads).names);
  assert.equal(t.budget.count, undefined, 'a setting, not a count');
});

test('Week = the rows the room LISTS: yours (watches + picks) while picks show; watches alone once the device hides them — never the hidden picks', () => {
  const plan = planOf(desk);
  assert.equal(plan.watches, 3); assert.equal(plan.picks, 2); assert.equal(plan.yours, 5); assert.equal(plan.nameRows, 1);
  // no memory on the device: with watches on the week the picks are hidden by default (week.ts pickDefault)
  assert.equal(pickDefault(plan, null), false);
  assert.equal(tabs().week.count, weekLeadOf(plan, false));
  assert.equal(tabs().week.count, 3, 'the tab said 5 while the room listed 3 and "2 picks · hidden" (the mismatch pass 13 fixes)');
  storageSet(PICKS_KEY, '1');
  assert.equal(tabs().week.count, 5);
  storageSet(PICKS_KEY, '0');
  assert.equal(tabs().week.count, 3);
  assert.equal(weekLeadOf({ yours: 5, watches: 0 }, false), 0, 'picks-only desk with picks hidden: no count (the room says so)');
});

test('the cockpit\'s 14-day strip counts exactly what Your week counts, day by day: rows, watches, picks, names, estimate total', () => {
  const plan = planWeek({ now: NOW, saved: desk.saved, savedIds: desk.savedIds, recs: desk.recs, book: desk.book, follows: desk.follows, collection: desk.collection });
  const strip = hammerStrip(plan.rows.map(r => ({ day: r.day, est: r.estMid ?? 0, kind: r.kind })), localToday());
  assert.equal(strip.length, plan.days.length);
  for (let k = 0; k < strip.length; k++) {
    const s = strip[k], d = plan.days[k];
    assert.equal(s.day, d.day);
    assert.equal(s.n, d.rows.length, `${d.day} rows`);
    assert.equal(s.watches, d.rows.filter(r => r.kind === 'watch').length, `${d.day} watches`);
    assert.equal(s.picks, d.rows.filter(r => r.kind === 'pick').length, `${d.day} picks`);
    assert.equal(s.names, d.names, `${d.day} names`);
    assert.equal(s.est, d.estTotal, `${d.day} estimate total (names never add)`);
  }
  assert.equal(strip.reduce((a, d) => a + d.n, 0), plan.rows.length);
  assert.equal(strip.reduce((a, d) => a + d.watches + d.picks, 0), plan.yours);
});
