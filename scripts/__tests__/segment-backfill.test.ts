/**
 * History backfills (backfill-goldin.yml, backfill-hugginsscott.yml): the
 * nothing-evicted slice union with its skip set, the Goldin sweep window,
 * and the H&S month-range slice.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtCounts, parseSkipArtists, unionSlice } from '../lib/segment-backfill';
import { goldinSweepWindow } from '../lib/houses/goldin';
import { monthBound, monthsInRange } from '../crawl-hugginsscott';

test('skip list: slugs parsed, junk rejected', () => {
  assert.deepEqual(Array.from(parseSkipArtists(' sports-cards,POKEMON,, ')), ['sports-cards', 'pokemon']);
  assert.equal(parseSkipArtists('').size, 0);
  assert.equal(parseSkipArtists(undefined).size, 0);
  assert.throws(() => parseSkipArtists('sports-cards;rm'), /bad skip slug/);
});

test('slice union: skip applies to NEW rows only; nothing in the snapshot is evicted', () => {
  const pre = [
    { id: 'a', artist: 'sports-cards', status: 'sold', saleDate: '2023-01-02' },
    { id: 'b', artist: 'game-used', status: 'sold', saleDate: '2023-02-02' },
  ];
  const post = [
    { id: 'a', artist: 'sports-cards', status: 'sold', saleDate: '2023-01-02', priceUsd: 5 }, // refreshed, kept despite skip
    { id: 'c', artist: 'sports-cards', status: 'sold', saleDate: '2021-03-01' },              // new card → skipped
    { id: 'd', artist: 'game-used', status: 'sold', saleDate: '2021-03-01' },                 // new → kept
    { id: 'e', artist: 'tickets-passes', status: 'sold', saleDate: '2020-05-01' },            // new → kept
  ];
  const u = unionSlice(pre, post, parseSkipArtists('sports-cards'));
  const ids = u.rows.map(r => r.id).sort();
  assert.deepEqual(ids, ['a', 'b', 'd', 'e']);
  assert.equal(u.rows.find(r => r.id === 'a')?.priceUsd, 5, 'fresh copy wins');
  assert.equal(u.restored, 1); // b
  assert.equal(u.added, 2);
  assert.deepEqual(u.skipped, { 'sports-cards': 1 });
  assert.deepEqual(u.newByArtist, { 'game-used': 1, 'tickets-passes': 1 });
  assert.deepEqual(u.newByYear, { 2020: 1, 2021: 1 });
  assert.equal(u.newSold, 2);
});

test('slice union: no skip set = plain unionPreserving', () => {
  const u = unionSlice([{ id: 'a' }], [{ id: 'b', artist: 'x' }]);
  assert.deepEqual(u.rows.map(r => r.id).sort(), ['a', 'b']);
  assert.deepEqual(u.skipped, {});
});

test('fmtCounts: largest first, or by key', () => {
  assert.equal(fmtCounts({ a: 1, b: 3 }), 'b 3 · a 1');
  assert.equal(fmtCounts({ 2021: 1, 2019: 3 }, true), '2019 3 · 2021 1');
  assert.equal(fmtCounts({}), '—');
});

test('Goldin sweep window: rolling default, fixed slice, bad input throws', () => {
  const now = Date.parse('2026-10-06T00:00:00Z');
  const d = goldinSweepWindow({}, now);
  assert.equal(d.fromMs, now - 21 * 86_400_000);
  assert.equal(d.toMs, Infinity);
  assert.equal(goldinSweepWindow({ RAY_GOLDIN_SWEEP_DAYS: '3' }, now).fromMs, now - 3 * 86_400_000);
  const w = goldinSweepWindow({ RAY_GOLDIN_SWEEP_FROM: '2021-01-01', RAY_GOLDIN_SWEEP_TO: '2021-02-01' }, now);
  assert.equal(w.fromMs, Date.parse('2021-01-01T00:00:00Z'));
  assert.equal(w.toMs, Date.parse('2021-02-01T00:00:00Z'));
  assert.equal(goldinSweepWindow({ RAY_GOLDIN_SWEEP_TO: '2023-01-01' }, now).fromMs, 0);
  assert.throws(() => goldinSweepWindow({ RAY_GOLDIN_SWEEP_FROM: '2021-1-1' }, now), /YYYY-MM-DD/);
  assert.throws(() => goldinSweepWindow({ RAY_GOLDIN_SWEEP_FROM: '2022-01-01', RAY_GOLDIN_SWEEP_TO: '2021-01-01' }, now), /empty/);
});

test('H&S month slice: inclusive YYYY-MM bounds over the month indexes', () => {
  const idx = [
    'https://hugginsandscott.com/auction/2021/February/',
    'https://hugginsandscott.com/auction/2021/August/',
    'https://hugginsandscott.com/auction/2022/February/',
    'https://hugginsandscott.com/auction/2026/Summer/',
    'https://hugginsandscott.com/auction/2019/November/',
  ];
  assert.deepEqual(monthsInRange(idx, monthBound('2021-02', 'since'), monthBound('2022-02', 'until')).map(u => u.split('/auction/')[1]),
    ['2022/February/', '2021/August/', '2021/February/']);
  assert.deepEqual(monthsInRange(idx, null, monthBound('2019-12', 'until')).map(u => u.split('/auction/')[1]), ['2019/November/']);
  assert.equal(monthBound(null, 'since'), null);
  assert.throws(() => monthBound('2021-13', 'since'), /YYYY-MM/);
  assert.throws(() => monthBound('2021', 'until'), /YYYY-MM/);
});
