/**
 * Phillips full-history backfill (.github/workflows/backfill-phillips.yml):
 * the maker selector, the per-maker page cap, and the nothing-evicted union.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARTISTS } from '../lib/houses/artists';
import { phillipsLastPage } from '../lib/houses/phillips';
import { PHILLIPS_WATCH_SLUGS, phillipsCounts, resolvePhillipsMakers, unionPreserving } from '../lib/phillips-backfill';

test('selector: watches = the five Phillips watch makers', () => {
  assert.deepEqual(resolvePhillipsMakers('watches', ARTISTS).sort(), [...PHILLIPS_WATCH_SLUGS].sort());
});

test('selector: art + watches partition all; every slug carries a Phillips id', () => {
  const all = resolvePhillipsMakers('all', ARTISTS);
  const art = resolvePhillipsMakers('art', ARTISTS);
  const watches = resolvePhillipsMakers('WATCHES', ARTISTS);
  assert.equal(art.length + watches.length, all.length);
  assert.ok(art.length > 10);
  for (const s of all) assert.ok(ARTISTS.find(a => a.slug === s)?.phillips?.id, s);
  for (const s of art) assert.ok(!watches.includes(s), s);
});

test('selector: explicit list is validated and de-duplicated', () => {
  assert.deepEqual(resolvePhillipsMakers(' patek-philippe, rolex,patek-philippe ', ARTISTS), ['patek-philippe', 'rolex']);
  assert.throws(() => resolvePhillipsMakers('patek-phillipe', ARTISTS), /not in the roster/);
  assert.throws(() => resolvePhillipsMakers('meteorites', ARTISTS), /no Phillips maker id/);
  assert.throws(() => resolvePhillipsMakers('rolex;rm -rf', ARTISTS), /not a slug/);
  assert.throws(() => resolvePhillipsMakers('  ', ARTISTS), /empty/);
});

test('page plan: nightly 2 pages, deep = full history, cap bounds deep only', () => {
  assert.equal(phillipsLastPage(36, false), 2);
  assert.equal(phillipsLastPage(1, false), 1);
  assert.equal(phillipsLastPage(36, true), 36);
  assert.equal(phillipsLastPage(36, true, 10), 10);
  assert.equal(phillipsLastPage(4, true, 10), 4);
  assert.equal(phillipsLastPage(36, false, 10), 2);
  assert.equal(phillipsLastPage(0, true), 1);
});

test('union: crawl copy wins, dropped pre ids are restored, new ids added', () => {
  const pre = [
    { id: 'phillips-A-1', status: 'sold', priceUsd: 100, artist: 'rolex' },
    { id: 'phillips-A-2', status: 'sold', priceUsd: 200, artist: 'rolex' },     // dropped by the crawl
    { id: 'phillips-A-3', status: 'upcoming', artist: 'kaws' },
  ];
  const post = [
    { id: 'phillips-A-1', status: 'sold', priceUsd: 100, artist: 'rolex', houseReference: '5711/1A' },
    { id: 'phillips-A-3', status: 'sold', priceUsd: 900, artist: 'kaws' },
    { id: 'phillips-B-9', status: 'sold', priceUsd: 5000, artist: 'patek-philippe', houseReference: '2499' },
  ];
  const u = unionPreserving(pre, post);
  assert.equal(u.rows.length, 4);
  assert.equal(u.added, 1);
  assert.equal(u.restored, 1);
  assert.equal(u.refreshed, 2);
  const byId = new Map(u.rows.map(r => [r.id, r]));
  assert.equal(byId.get('phillips-A-1')?.houseReference, '5711/1A');  // fresh copy carries the ref
  assert.equal(byId.get('phillips-A-3')?.status, 'sold');             // fresh wins
  assert.equal(byId.get('phillips-A-2')?.priceUsd, 200);              // nothing evicted
  for (const r of pre) assert.ok(byId.has(r.id as string), `${r.id} survived`);
});

test('union: empty pre (bootstrap) = the crawl; empty crawl = pre untouched', () => {
  const rows = [{ id: 'x', status: 'sold' }];
  assert.equal(unionPreserving([], rows).rows.length, 1);
  const u = unionPreserving(rows, []);
  assert.equal(u.rows.length, 1);
  assert.equal(u.restored, 1);
});

test('counts: houseReference, watches, maker scope', () => {
  const rows = [
    { id: '1', artist: 'patek-philippe', status: 'sold', houseReference: '5711' },
    { id: '2', artist: 'patek-philippe', status: 'bought_in', houseReference: '  ' },
    { id: '3', artist: 'kaws', status: 'sold' },
  ];
  assert.deepEqual(phillipsCounts(rows), { rows: 3, sold: 2, watches: 2, withHouseReference: 1 });
  assert.deepEqual(phillipsCounts(rows, new Set(['kaws'])), { rows: 1, sold: 1, watches: 0, withHouseReference: 0 });
});
