/**
 * The calls-ledger grading (scripts/lib/calls-ledger.ts): a lot that does not
 * sell — bought in, no result, or vanished from the corpus — is graded a MISS
 * 7 days after its close (it used to sit "pending" forever, so every hit rate
 * ran over survivors only); withdrawn lots are void; a later sale overwrites
 * a miss; hit rates carry misses in their denominator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeRows, summarizeCalls, type Call } from '../lib/calls-ledger';

const TODAY = '2026-10-05';
const sold = (m: Record<string, [number, string]>) => new Map(Object.entries(m).map(([id, [r, sd]]) => [id, { realizedUsd: r, saleDate: sd }]));
const status = (m: Record<string, [string, string | null]>) => new Map(Object.entries(m).map(([id, [s, sd]]) => [id, { status: s, saleDate: sd }]));

test('sold lots grade with their realized price', () => {
  const rows: Call[] = [{ id: 'a', d: '2026-09-01', k: 'card', p: 100 }];
  assert.equal(gradeRows(rows, sold({ a: [120, '2026-09-10'] }), status({ a: ['sold', '2026-09-10'] }), TODAY), true);
  assert.equal(rows[0].r, 120);
  assert.equal(rows[0].sd, '2026-09-10');
  assert.equal(rows[0].o, undefined);
});

test('bought-in / no-result lots are misses only once the close is 7 days past', () => {
  const rows: Call[] = [
    { id: 'bi-old', d: '2026-09-01', k: 'vsbid', p: 100, f: 120 },
    { id: 'bi-new', d: '2026-09-25', k: 'vsbid', p: 100, f: 120 },
    { id: 'ur-old', d: '2026-09-01', k: 'vsbid', p: 100, f: 120 },
    { id: 'live', d: '2026-09-01', k: 'vsbid', p: 100, f: 120 },
  ];
  gradeRows(rows, sold({}), status({
    'bi-old': ['bought_in', '2026-09-20'], 'bi-new': ['bought_in', '2026-10-01'],
    'ur-old': ['unknown-result', '2026-09-27'], live: ['upcoming', '2026-09-01'],
  }), TODAY);
  assert.deepEqual(rows.map(c => c.o), ['u', undefined, 'u', undefined]);
  assert.equal(rows[0].sd, '2026-09-20');
  assert.equal(rows[1].cd, '2026-10-01', 'the close date is stamped while the lot is known');
});

test('a lot that vanished from the corpus is a miss 7 days after its last-known close (or call date)', () => {
  const rows: Call[] = [
    { id: 'gone-legacy', d: '2026-09-10', k: 'quiet', p: 500 },
    { id: 'gone-fresh', d: '2026-10-02', k: 'quiet', p: 500 },
    { id: 'gone-cd', d: '2026-09-01', k: 'quiet', p: 500, cd: '2026-10-01' },
  ];
  gradeRows(rows, sold({}), status({}), TODAY);
  assert.deepEqual(rows.map(c => c.o), ['u', undefined, undefined]);
});

test('without the corpus status map nothing but sales grades (vanished is undecidable)', () => {
  const rows: Call[] = [{ id: 'gone', d: '2026-08-01', k: 'card', p: 100 }];
  assert.equal(gradeRows(rows, sold({}), undefined, TODAY), false);
  assert.equal(rows[0].o, undefined);
});

test('withdrawn is void; a later sale overwrites a miss', () => {
  const rows: Call[] = [
    { id: 'w', d: '2026-09-01', k: 'card', p: 100 },
    { id: 'back', d: '2026-09-01', k: 'card', p: 100, o: 'u', sd: '2026-09-01' },
  ];
  gradeRows(rows, sold({ back: [90, '2026-10-03'] }), status({ w: ['withdrawn', '2026-09-15'], back: ['sold', '2026-10-03'] }), TODAY);
  assert.equal(rows[0].o, 'w');
  assert.equal(rows[1].o, undefined);
  assert.equal(rows[1].r, 90);
  const rec = summarizeCalls(rows, TODAY);
  assert.equal(rec.card.graded, 1, 'void rows are neither graded nor misses');
});

test('hit rates carry misses in the denominator; medRatio stays over sold rows', () => {
  const rows: Call[] = [];
  // 20 sold card calls exactly on the read, 20 misses
  for (let i = 0; i < 20; i++) rows.push({ id: `s${i}`, d: '2026-09-01', k: 'card', p: 100, r: 100, sd: '2026-09-10' });
  for (let i = 0; i < 20; i++) rows.push({ id: `m${i}`, d: '2026-09-01', k: 'card', p: 100, o: 'u', sd: '2026-09-10' });
  // vsbid: 20 sold at/above the floor, 20 unsold
  for (let i = 0; i < 20; i++) rows.push({ id: `vs${i}`, d: '2026-09-01', k: 'vsbid', p: 100, f: 120, r: 130, sd: '2026-09-10' });
  for (let i = 0; i < 20; i++) rows.push({ id: `vm${i}`, d: '2026-09-01', k: 'vsbid', p: 100, f: 120, o: 'u', sd: '2026-09-10' });
  const rec = summarizeCalls(rows, TODAY);
  assert.equal(rec.card.graded, 40);
  assert.equal(rec.card.medRatio, 1);
  assert.equal(rec.card.within30Pct, 50);
  assert.equal(rec.vsbid.graded, 40);
  assert.equal(rec.vsbid.belowHit, 50);
});

test("belowHit grades only the calls that projected UNDER the floor (the 'below' claim)", () => {
  const rows: Call[] = [];
  // 30 projections already at/above the floor that sold above it — no 'below' claim
  for (let i = 0; i < 30; i++) rows.push({ id: `a${i}`, d: '2026-09-01', k: 'vsbid', p: 150, f: 120, r: 160, sd: '2026-09-10' });
  // 20 below-floor claims: 10 held (sold ≥ floor), 5 sold under, 5 unsold
  for (let i = 0; i < 10; i++) rows.push({ id: `h${i}`, d: '2026-09-01', k: 'vsbid', p: 100, f: 120, r: 125, sd: '2026-09-10' });
  for (let i = 0; i < 5; i++) rows.push({ id: `u${i}`, d: '2026-09-01', k: 'vsbid', p: 100, f: 120, r: 90, sd: '2026-09-10' });
  for (let i = 0; i < 5; i++) rows.push({ id: `m${i}`, d: '2026-09-01', k: 'vsbid', p: 100, f: 120, o: 'u', sd: '2026-09-10' });
  const rec = summarizeCalls(rows, TODAY);
  assert.equal(rec.vsbid.belowHit, 50);
  assert.equal(rec.vsbid.graded, 50, 'graded still counts every settled projection');
  // under 20 below-floor claims → withheld
  assert.equal(summarizeCalls(rows.slice(0, 45), TODAY).vsbid.belowHit, null);
});
