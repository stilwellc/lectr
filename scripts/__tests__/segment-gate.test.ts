/**
 * The per-house shrink + price gate (scripts/ci/segment-gate.ts) that
 * data-store.sh push-segment runs before replacing a house's last-good.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { segmentGateVerdict, statsOfRows, statsOfFile } from '../ci/segment-gate';

type Row = Record<string, unknown>;
const sold = (n: number, price: (i: number) => number = i => 100 + (i % 500) * 7): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, status: 'sold', priceUsd: price(i) }));
const live = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, status: 'upcoming' }));

test('no baseline (first write) passes', () => {
  assert.equal(segmentGateVerdict(null, statsOfRows(sold(10))).ok, true);
});

test('a steady night passes; upcoming churn (a live sale closing) does NOT count as shrink', () => {
  const prev = statsOfRows([...sold(5000), ...live(3000)]);
  const next = statsOfRows([...sold(5040), ...live(10)]);
  const v = segmentGateVerdict(prev, next);
  assert.equal(v.ok, true, v.reasons.join('; '));
});

test('settled rows dropping > 5% blocks', () => {
  const prev = statsOfRows([...sold(1000), ...Array.from({ length: 1000 }, (_, i) => ({ id: `b${i}`, status: 'bought_in' }))]);
  const next = statsOfRows([...sold(1000), ...Array.from({ length: 850 }, (_, i) => ({ id: `b${i}`, status: 'bought_in' }))]);
  const v = segmentGateVerdict(prev, next);
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(';'), /settled rows 2000 → 1850/);
});

test('losing > 200 sold rows blocks even when it is < 5% of a big house', () => {
  const v = segmentGateVerdict(statsOfRows(sold(100_000)), statsOfRows(sold(99_700)));
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(';'), /lost 300 sold rows/);
  assert.equal(segmentGateVerdict(statsOfRows(sold(100_000)), statsOfRows(sold(99_900))).ok, true);
});

test('a collapsed house (Hake\'s → 0 rows) blocks', () => {
  const v = segmentGateVerdict(statsOfRows(sold(900)), statsOfRows([]));
  assert.equal(v.ok, false);
  // an all-live house emptied is a collapse too (no settled baseline to shrink from)
  const allLive = segmentGateVerdict(statsOfRows(live(1984)), statsOfRows([]));
  assert.equal(allLive.ok, false);
  assert.match(allLive.reasons.join(';'), /segment emptied/);
});

test('price sanity: a shifted median blocks; a stamped single price blocks', () => {
  const prev = statsOfRows(sold(2000));
  const shifted = statsOfRows(sold(2000, i => (100 + (i % 500) * 7) * 3)); // FX slip ×3
  assert.match(segmentGateVerdict(prev, shifted).reasons.join(';'), /sold median/);
  const stamped = statsOfRows([...sold(2000), ...sold(400, () => 10050)]); // the NFL $10,050 bleed shape
  const v = segmentGateVerdict(prev, stamped);
  assert.equal(v.ok, false);
  assert.match(v.reasons.join(';'), /one price now holds/);
  // small houses skip the price check (noise)
  assert.equal(segmentGateVerdict(statsOfRows(sold(50)), statsOfRows(sold(50, () => 99999))).ok, true);
});

test('statsOfFile streams a gz NDJSON segment (legacy array lines flattened)', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seg-')), 'x.ndjson.gz');
  const lines = [...sold(3).map(r => JSON.stringify(r)), JSON.stringify(live(2)), ''];
  fs.writeFileSync(f, zlib.gzipSync(lines.join('\n')));
  const s = await statsOfFile(f);
  assert.equal(s.rows, 5);
  assert.equal(s.upcoming, 2);
  assert.equal(s.sold, 3);
  assert.equal(s.priced, 3);
});
