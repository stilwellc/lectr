import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  moveOf, recordIn, recordLevel, biggestIn, rankNames, isNews, isQuiet, digestTotals, marketNamesOf,
  makerEntityId, liveFactsOf, daysBefore, type NameDigest, type LiveFacts,
} from '../your-market';
import { MIN_YOY_N, MIN_YOY_PAIRS, RESULT_ROWS } from '../entity/stats';
import type { EntityResultRow } from '../entity/model';
import type { AuctionLot } from '../../types';
import { makerFollow, entityFollow, catFollow, houseFollow } from '../follows';

const row = (id: string, p: number, d: string): EntityResultRow => ({ id, img: null, p, d, t: id, h: 'Goldin', cat: '' });
const noLive: LiveFacts = { live: 0, flagged: 0, closing: 0, fresh: 0, flaggedLots: [] };
const digest = (label: string, o: Partial<NameDigest> = {}): NameDigest => ({
  name: { key: label, id: `mk:${label}`, label, follow: makerFollow(label, label), followed: true, owned: 0 },
  move: null, record: null, biggest: null, live: noLive, sold12m: 0, read: true, page: null, ...o,
});
const liveN = (live: number, flagged = 0): LiveFacts => ({
  live, flagged, closing: 0, fresh: 0,
  flaggedLots: Array.from({ length: flagged }, (_, i) => ({ id: `f${i}` } as AuctionLot)),
});

/* ── the move's n-gates + interval ── */

test('a matched YoY prints at the pair gate, with its interval; toned only when the interval leaves 0 out', () => {
  const up = moveOf({ pct: 47.9, n: 316, basis: 'matched', lo: 43.6, hi: 51.1 });
  assert.equal(up?.tone, 'up');
  assert.equal(up?.n, 316);
  const down = moveOf({ pct: -12, n: 40, basis: 'matched', lo: -20, hi: -3 });
  assert.equal(down?.tone, 'down');
  // Warhol on the prod file: +2.8% with a 90% interval −7.4 → +11.1 — printed, neutral
  const flat = moveOf({ pct: 2.8, n: 71, basis: 'matched', lo: -7.4, hi: 11.1 });
  assert.equal(flat?.tone, 'flat');
});

test('below the n-gate, no move: matched/index need MIN_YOY_PAIRS, median needs MIN_YOY_N', () => {
  assert.equal(moveOf({ pct: 30, n: MIN_YOY_PAIRS - 1, basis: 'matched', lo: 10, hi: 50 }), null);
  assert.ok(moveOf({ pct: 30, n: MIN_YOY_PAIRS, basis: 'matched', lo: 10, hi: 50 }));
  assert.equal(moveOf({ pct: 30, n: MIN_YOY_PAIRS, basis: 'index', lo: 10, hi: 50 })?.tone, 'up');
  assert.equal(moveOf({ pct: 30, n: MIN_YOY_N - 1, basis: 'median', lo: 10, hi: 50 }), null);
  assert.ok(moveOf({ pct: 30, n: MIN_YOY_N, basis: 'median', lo: 10, hi: 50 }));
});

test('no published interval (an older payload), a broken one, or no yoy → nothing printed', () => {
  assert.equal(moveOf({ pct: 30, n: 200, basis: 'matched' }), null);
  assert.equal(moveOf({ pct: 30, n: 200, basis: 'matched', lo: 50, hi: 10 }), null);
  assert.equal(moveOf({ pct: NaN, n: 200, basis: 'matched', lo: 1, hi: 2 }), null);
  assert.equal(moveOf(null), null);
});

/* ── records ── */

test('a record is a top result dated in the window; rank 1 = all-time; fresh = the short window', () => {
  const top = [row('a', 1_830_000, '2026-10-05'), row('b', 900_000, '2022-01-01'), row('c', 500_000, '2026-09-20')];
  const r = recordIn({ top }, '2026-09-10', '2026-10-03');
  assert.equal(r?.rank, 1);
  assert.equal(r?.fresh, true);
  assert.equal(recordLevel(r), 4);
  // the record is old; the #3 result is inside 30 days but not this week
  const top2 = [row('a', 1_830_000, '2026-06-20'), row('b', 900_000, '2022-01-01'), row('c', 500_000, '2026-09-20')];
  const r2 = recordIn({ top: top2 }, '2026-09-10', '2026-10-03');
  assert.equal(r2?.rank, 3);
  assert.equal(r2?.fresh, false);
  assert.equal(recordLevel(r2), 1);
  assert.equal(recordIn({ top: top2 }, '2026-10-01'), null);
  assert.equal(recordIn(null, '2026-10-01'), null);
});

/* ── the window's biggest sale: said for the window only when covered ── */

test('biggest: recent reaching past the window start holds every window sale (exact, counted)', () => {
  const recent = [row('r1', 8960, '2026-10-08'), row('r2', 7040, '2026-10-08'), row('r3', 851, '2026-10-07'),
    ...Array.from({ length: RESULT_ROWS - 3 }, (_, i) => row(`o${i}`, 48_000, '2026-09-24'))];
  const b = biggestIn({ top: [row('t', 17_000_000, '2017-10-26')], recent }, '2026-10-03');
  assert.equal(b?.whole, true);
  assert.equal(b?.row?.id, 'r1');
  assert.equal(b?.n, 3);
});

test('biggest: recent truncated inside the window → only the days it covers, never "this week"', () => {
  const recent = Array.from({ length: RESULT_ROWS }, (_, i) => row(`r${i}`, 900_000 - i * 1000, '2026-10-08'));
  const b = biggestIn({ top: [row('t', 195_000_000, '2022-05-08')], recent }, '2026-10-03');
  assert.equal(b?.whole, false);
  assert.equal(b?.from, '2026-10-08');
  assert.equal(b?.row?.id, 'r0');
  assert.equal(b?.n, null);
});

test('biggest: a top result inside the window is the window max even when recent is truncated', () => {
  const recent = Array.from({ length: RESULT_ROWS }, (_, i) => row(`r${i}`, 1000 - i, '2026-10-08'));
  const b = biggestIn({ top: [row('t', 5_000_000, '2026-10-05')], recent }, '2026-10-03');
  assert.equal(b?.whole, true);
  assert.equal(b?.row?.id, 't');
});

test('biggest: a covered window with no sale says so (row null, whole)', () => {
  const b = biggestIn({ top: [], recent: [row('r', 100, '2026-09-01')] }, '2026-10-03');
  assert.deepEqual([b?.row, b?.whole, b?.n], [null, true, 0]);
});

/* ── ranking: new record > clear move > flags > volume ── */

test('ranking: a new record outranks a clear move, which outranks flags, which outrank volume', () => {
  const rec = digest('rec', { record: { row: row('x', 1, '2026-10-05'), rank: 1, fresh: true } });
  const move = digest('move', { move: { pct: 48, n: 300, basis: 'matched', lo: 40, hi: 55, tone: 'up' } });
  const flags = digest('flags', { live: liveN(3, 2) });
  const busy = digest('busy', { live: liveN(400) });
  const flat = digest('flat', { move: { pct: 90, n: 300, basis: 'matched', lo: -5, hi: 150, tone: 'flat' }, live: liveN(1) });
  const order = rankNames([busy, flat, flags, move, rec]).map(d => d.name.label);
  assert.deepEqual(order, ['rec', 'move', 'flags', 'busy', 'flat']);
});

test('ranking: a fresh all-time record beats an older one, which beats a fresh top-k result', () => {
  const r = (label: string, rank: number, fresh: boolean) => digest(label, { record: { row: row(label, 1, '2026-10-01'), rank, fresh } });
  const order = rankNames([r('topk-fresh', 4, true), r('rec-old', 1, false), r('rec-fresh', 1, true), r('topk-old', 3, false)]).map(d => d.name.label);
  assert.deepEqual(order, ['rec-fresh', 'rec-old', 'topk-fresh', 'topk-old']);
});

test('ranking: a spanning-zero move is not news; among equals, volume then the larger move', () => {
  const flat = digest('flat', { move: { pct: 2.8, n: 71, basis: 'matched', lo: -7.4, hi: 11.1, tone: 'flat' } });
  assert.equal(isNews(flat), false);
  const a = digest('a', { move: { pct: 10, n: 50, basis: 'matched', lo: 2, hi: 18, tone: 'up' }, live: liveN(5) });
  const b = digest('b', { move: { pct: 130, n: 45, basis: 'matched', lo: 91, hi: 154, tone: 'up' }, live: liveN(5) });
  const c = digest('c', { move: { pct: 5, n: 50, basis: 'matched', lo: 1, hi: 9, tone: 'up' }, live: liveN(9) });
  assert.deepEqual(rankNames([a, b, c]).map(d => d.name.label), ['c', 'b', 'a']);
});

test('quiet: nothing live, no published move, no sale in the window, no record', () => {
  assert.equal(isQuiet(digest('q')), true);
  assert.equal(isQuiet(digest('l', { live: liveN(1) })), false);
  assert.equal(isQuiet(digest('m', { move: { pct: 1, n: 50, basis: 'matched', lo: -2, hi: 4, tone: 'flat' } })), false);
});

test('totals: a lot two names share is one flag', () => {
  const shared = { id: 'L1' } as AuctionLot;
  const a = digest('a', { live: { ...noLive, live: 1, flagged: 1, flaggedLots: [shared] } });
  const b = digest('b', { live: { ...noLive, live: 1, flagged: 1, flaggedLots: [shared] } });
  assert.equal(digestTotals([a, b]).flagged, 1);
});

/* ── the names ── */

test('names: follows map to their entity ids; houses are not names; owned pieces join once', () => {
  assert.equal(makerEntityId('andy-warhol'), 'mk:andy-warhol');
  assert.equal(makerEntityId('rolex'), 'mk:rolex');
  assert.equal(makerEntityId('mickey-mantle'), 'pl:mickey-mantle');
  assert.equal(makerEntityId('meteorites'), 'cs:space-science:meteorites');
  const ns = marketNamesOf([
    makerFollow('andy-warhol', 'Andy Warhol'), makerFollow('mickey-mantle', 'Mickey Mantle'),
    entityFollow('sj:tcg|k:charizard', 'Charizard'), catFollow('watches', null), houseFollow('Goldin'),
  ], [
    { id: 'o1', title: 'Marilyn', artist: 'andy-warhol', auctionHouse: 'X', ek: 'mk:andy-warhol' } as unknown as AuctionLot,
    { id: 'o2', title: '1986 Fleer #57 Michael Jordan PSA 10', artist: 'basketball-cards', auctionHouse: 'X', ek: 'pl:michael-jordan', playerSlug: 'michael-jordan', playerName: 'Michael Jordan' } as unknown as AuctionLot,
  ]);
  assert.deepEqual(ns.map(n => n.id), ['mk:andy-warhol', 'pl:mickey-mantle', 'sj:tcg|k:charizard', null, 'pl:michael-jordan']);
  assert.equal(ns[4].label, 'Michael Jordan');
  assert.equal(ns[4].followed, false);
  assert.equal(ns.find(n => n.id === 'mk:andy-warhol')?.owned, 1);
  assert.equal(ns.find(n => n.follow.kind === 'cat')?.id, null, 'a category is live-only: the cs: row is the unnamed remainder, not the category');
  assert.ok(!ns.some(n => n.follow.kind === 'house'));
});

test('live facts: on the block, flagged by the one predicate, closing within seven days', () => {
  const now = Date.parse('2026-10-09T20:00:00Z');
  const base = { artist: 'rolex', auctionHouse: 'Phillips', status: 'upcoming', title: 'Rolex Daytona' };
  const book = [
    { ...base, id: 'a', saleDate: '2026-10-12', saleDateTime: '2026-10-12T15:00:00Z', signal: { label: 'Below Market' } },
    { ...base, id: 'b', saleDate: '2026-10-30', saleDateTime: '2026-10-30T15:00:00Z', signal: null },
    { ...base, id: 'c', saleDate: '2026-10-01', status: 'sold', signal: null },
    { ...base, id: 'd', artist: 'omega', saleDate: '2026-10-12', saleDateTime: '2026-10-12T15:00:00Z', signal: { label: 'Below Market' } },
  ] as unknown as AuctionLot[];
  const f = liveFactsOf({ id: 'mk:rolex', follow: makerFollow('rolex', 'Rolex') }, book, { nowMs: now, today: '2026-10-09' });
  assert.deepEqual([f.live, f.flagged, f.closing], [2, 1, 1]);
  assert.equal(f.flaggedLots[0].id, 'a');
});

test('days: the week window is seven days including today', () => {
  assert.equal(daysBefore('2026-10-09', 6), '2026-10-03');
  assert.equal(daysBefore('2026-10-09', -1), '2026-10-10');
  assert.equal(daysBefore('2026-03-01', 1), '2026-02-28');
});

test('live facts: an entity name joins on the computed entity key when the book carries no ek stamp', () => {
  const now = Date.parse('2026-10-09T20:00:00Z');
  const book = [
    { id: 'z', artist: 'pokemon', auctionHouse: 'Heritage', status: 'upcoming', title: '2003 Pokemon Skyridge Holo #146 Crystal Charizard - PSA GEM MT 10', saleDate: '2026-10-25', signal: null },
  ] as unknown as AuctionLot[];
  const f = liveFactsOf({ id: 'sj:tcg|k:charizard', follow: entityFollow('sj:tcg|k:charizard', 'Charizard') }, book, { nowMs: now, today: '2026-10-09' });
  assert.equal(f.live, 1);
});
