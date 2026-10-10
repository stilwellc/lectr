/**
 * relaxTriage (app/lib/feed-filters, Oct 9 r6): the empty board's way back —
 * each active filter offered as a one-tap undo, counted by the same rule the
 * board runs, and never offered when it brings nothing back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relaxTriage, passesTriage, TRIAGE_DEFAULTS, type TriageFilters } from '../feed-filters';

const TODAY = '2026-10-09';
const lot = (id: string, saleDate: string, house: string, estimateLow: number) =>
  ({ id, title: 'Untitled', saleDate, auctionHouse: house, estimateLow, estimateHigh: estimateLow * 1.5, status: 'upcoming' });

// three flags, none closing inside 48 hours
const flags = [
  lot('a', '2026-10-13', 'Wright', 12000),
  lot('b', '2026-10-14', 'RR Auction', 14000),
  lot('c', '2026-10-22', 'Phillips', 120000),
];
const opts = { today: TODAY };

test('48 hours under $25K: only the window undo brings flags back, with its count', () => {
  const f: TriageFilters = { ...TRIAGE_DEFAULTS, win: '48h', maxUsd: 25000 };
  assert.equal(flags.filter(l => passesTriage(l, f, opts)).length, 0);
  const r = relaxTriage(flags, f, opts);
  assert.deepEqual(r.map(x => x.k), ['win'], 'dropping the value cap alone still leaves the 48h window empty');
  assert.equal(r[0].n, 2, 'the two flags under $25K');
  assert.equal(r[0].next.win, null);
  assert.equal(r[0].next.maxUsd, 25000, 'the other filters stay put');
  // the count IS what the board shows after the tap
  assert.equal(flags.filter(l => passesTriage(l, r[0].next, opts)).length, r[0].n);
});

test('a house + value cut offers each undo that helps', () => {
  const f: TriageFilters = { ...TRIAGE_DEFAULTS, house: 'Phillips', maxUsd: 25000 };
  const r = relaxTriage(flags, f, opts);
  assert.deepEqual(r.map(x => [x.k, x.n]), [['house', 2], ['value', 1]]);
});

test('no active filter, nothing to relax', () => {
  assert.deepEqual(relaxTriage(flags, TRIAGE_DEFAULTS, opts), []);
});
