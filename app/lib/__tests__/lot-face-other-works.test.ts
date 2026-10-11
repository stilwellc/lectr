/**
 * W29 (Oct 11 2026) — the comps list sets the engine's OTHER WORKS apart
 * (value.otherWorkIds, W24 §22): the comparables first, then "Other works by
 * <maker>, for context"; the "N comparable" head counts the comparables only;
 * the comps median (read over both) names the other works beside it where the
 * rows are listed, and is tagged on its own row wherever it sits. A lot the
 * engine marked nothing on reads exactly as before.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { readFileSync } from 'fs';
import path from 'path';
import { lotFace, medianRowId, otherWorkIdsOf, otherWorksCount, otherWorksLabel, splitOtherWorks } from '../lot-face';
import type { AuctionLot } from '../../types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

// the live Picasso shape (bonhams-31799-13, Femmes à leur toilette, 1965):
// four pool rows, three of them other works (the 1956 linocuts, the 1964
// unique "Deux femmes"); the comps median $32,346 is one of the other works
const PICASSO_POOL = ['christies-auc-5820953', 'christies-24560.50', 'christies-auc-4894952', 'christies-auc-5553952'];
const PICASSO_OTHER = ['christies-24560.50', 'christies-auc-4894952', 'christies-auc-5553952'];
const lot = (v: Record<string, unknown>): AuctionLot => ({
  id: 'bonhams-31799-13', title: 'Femmes à leur toilette, IIᵉ état, 1 mars 1965, 1966', artist: 'pablo-picasso',
  auctionHouse: 'Bonhams', status: 'upcoming', saleDate: '2026-10-28', estimateLow: 6900, estimateHigh: 9200,
  value: {
    poolIds: PICASSO_POOL, n: 4, compValueUsd: 10942, low: 6828, high: 21676, compRatio: 3.14, signal: null,
    estimateUsd: null, vsBid: null, confidence: 'low', exact: null, abstain: 'flag:purity', compMedianUsd: 32346,
    expectedHammerUsd: 8548, bandLowUsd: 5334, bandHighUsd: 16934, premiumFactor: 1.28, ...v,
  },
} as unknown as AuctionLot);

test('the face counts the comparables apart from the other works', () => {
  const f = lotFace(lot({ otherWorkIds: PICASSO_OTHER }));
  assert.ok(f.comps);
  assert.deepEqual(f.comps!.other, PICASSO_OTHER);
  assert.equal(f.comps!.n, 4, 'n stays the pool the median read');
  assert.equal(f.comps!.sameN, 1);
  assert.equal(f.comps!.med, 32346, 'the median is the engine\'s, unchanged');
  assert.equal(f.comps!.sub, 'weighted · 4 sales', 'sub (rows not listed: /value, the terminal) unchanged');
  assert.equal(f.comps!.listSub, 'weighted · 4 sales · incl. 3 other works');
});

test('a pool larger than its listed K names the other works too', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
  const f = lotFace(lot({ poolIds: ids, n: 23, otherWorkIds: ['c2', 'c7'] }));
  assert.equal(f.comps!.sameN, 21);
  assert.equal(f.comps!.listSub, 'weighted · 10 closest of 23 sales · incl. 2 other works');
});

test('a pool that is all other works says so', () => {
  const f = lotFace(lot({ poolIds: PICASSO_OTHER, n: 3, otherWorkIds: PICASSO_OTHER }));
  assert.equal(f.comps!.sameN, 0);
  assert.equal(f.comps!.listSub, 'weighted · 3 sales · all other works');
});

test('no otherWorkIds: the face reads exactly as before', () => {
  const f = lotFace(lot({}));
  assert.deepEqual(f.comps!.other, []);
  assert.equal(f.comps!.sameN, 4);
  assert.equal(f.comps!.listSub, f.comps!.sub);
  assert.equal(f.comps!.sub, 'weighted · 4 sales');
});

test('other-work ids outside the pool never count', () => {
  assert.deepEqual(otherWorkIdsOf({ poolIds: ['a', 'b'], otherWorkIds: ['b', 'zz'] }), ['b']);
  assert.deepEqual(otherWorkIdsOf({ poolIds: ['a'], otherWorkIds: [] }), []);
  assert.deepEqual(otherWorkIdsOf(null), []);
  const f = lotFace(lot({ otherWorkIds: ['not-in-pool'] }));
  assert.deepEqual(f.comps!.other, []);
  assert.equal(f.comps!.listSub, f.comps!.sub);
});

test('splitOtherWorks keeps each group in order; no ids is the same array', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const { same, other } = splitOtherWorks(rows, ['b', 'd']);
  assert.deepEqual(same.map(r => r.id), ['a', 'c']);
  assert.deepEqual(other.map(r => r.id), ['b', 'd']);
  const none = splitOtherWorks(rows, []);
  assert.equal(none.same, rows);
  assert.deepEqual(none.other, []);
  assert.equal(splitOtherWorks(rows, undefined).same, rows);
});

test('labels', () => {
  assert.equal(otherWorksLabel('Pablo Picasso'), 'Other works by Pablo Picasso, for context');
  assert.equal(otherWorksLabel(''), 'Other works, for context');
  assert.equal(otherWorksCount(1), '1 other work');
  assert.equal(otherWorksCount(3), '3 other works');
});

test('the median tag lands on its row even when that row is another work', () => {
  const rows = [
    { id: 'christies-auc-5820953', priceUsd: 7_500 },
    { id: 'christies-24560.50', priceUsd: 32_346 },
    { id: 'christies-auc-4894952', priceUsd: 134_500 },
  ];
  const { same, other } = splitOtherWorks(rows, PICASSO_OTHER);
  const med = medianRowId([...same, ...other], 32346);
  assert.equal(med, 'christies-24560.50');
  assert.ok(other.some(r => r.id === med));
});

test('the lot page and the modal set the other works apart, through lot-face', () => {
  const page = src('app/components/LotPage.tsx');
  assert.match(page, /otherWorksLabel\(makerName\)/);
  assert.match(page, /face\.comps\.listSub/);
  assert.match(page, /face\.comps\.sameN/);
  // the median row is read over every listed row, never per group
  assert.match(page, /medianRowId\(compRows, compsMed\)/);
  const modal = src('app/components/ComparableModal.tsx');
  assert.match(modal, /otherWorksLabel\(maker\.name\)/);
  assert.match(modal, /face\.comps\.listSub/);
  assert.match(modal, /face\.comps\.sameN/);
});

test('a head at one reads singular', async () => {
  const { formNoun } = await import('../lot-face');
  assert.equal(formNoun('prints', 1), 'print');
  assert.equal(formNoun('prints', 2), 'prints');
  assert.equal(formNoun('sales', 1), 'sale');
  assert.equal(formNoun('works on paper', 1), 'work on paper');
  assert.equal(formNoun('wristwatches', 1), 'wristwatch');
  assert.equal(formNoun('benches', 1), 'bench');
  assert.equal(formNoun('jewelry', 1), 'jewelry');
  assert.equal(formNoun('game-used gear', 1), 'game-used gear');
  assert.equal(formNoun('tickets & passes', 1), 'ticket or pass');
});
