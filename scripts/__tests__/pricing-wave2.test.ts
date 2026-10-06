/**
 * Pricing fix wave 2 (Oct 6 2026) — the engine-side contracts: the purity gate and the hard comp boundaries.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateValueEx, setEngineFlags, ENGINE_FLAGS_CURRENT, ENGINE_FLAGS_HAMMER_BASIS, type Comp,
  blendPredict, EXACT_BLEND,
} from '../../app/lib/value';
import { buildIdf, type Match } from '../../app/lib/similarity';
import type { AuctionLot } from '../../app/types';

// ── the engine: purity gate + hard boundaries (estimateValueEx) ─────────────
const M = (cosine: number): Match => ({ score: Math.round(cosine * 100), cosine, cls: 'similar', reasons: [] });
const row = (id: string, title: string, saleDate: string): AuctionLot => ({ id, title, artist: 'entertainment-memorabilia', category: 'object', status: 'sold', saleDate } as unknown as AuctionLot);
const comp = (id: string, title: string, usd: number, saleDate = '2025-12-01'): Comp => ({ id, match: M(0.9), realizedUsd: usd, saleDate, lot: row(id, title, saleDate) });
const target = (title: string): AuctionLot => ({
  id: 't', title, artist: 'entertainment-memorabilia', category: 'object', auctionHouse: 'RR Auction', status: 'upcoming',
  saleDate: '2026-09-20', estLowUsd: 400, estHighUsd: 600,
} as unknown as AuctionLot);

test('purity gate: a read needs ≥3 pure comps — bare-name / stale comps carry no signal; the value still ships', () => {
  setEngineFlags(ENGINE_FLAGS_CURRENT);
  const lot = target('Harry S. Truman Typed Letter Signed');
  const pure = [1, 2, 3, 4].map(i => comp(`p${i}`, 'Harry S. Truman Typed Letter Signed', 700 + i));
  const v1 = estimateValueEx(lot, pure, buildIdf([])).value!;
  assert.ok(v1.signal, 'four pure comps → a read');
  const bare = [1, 2].map(i => comp(`b${i}`, 'Harry S. Truman', 700 + i));
  const stale = [1, 2, 3].map(i => comp(`o${i}`, 'Harry S. Truman Typed Letter Signed', 700 + i, '2008-02-13'));
  const mixed = [...bare, ...stale, pure[0]];
  const v2 = estimateValueEx(lot, mixed, buildIdf([])).value!;
  assert.equal(v2.signal, null);
  assert.equal(v2.abstain, 'flag:purity');
  assert.ok(v2.compValueUsd > 0);
  setEngineFlags(ENGINE_FLAGS_HAMMER_BASIS);
  assert.ok(estimateValueEx(lot, mixed, buildIdf([])).value!.signal, 'the previous engine read it');
  setEngineFlags(null);
});

test('purity gate: a comp ratio outside ×5 strips the signal (it used to ship "strong, 64%")', () => {
  setEngineFlags(ENGINE_FLAGS_CURRENT);
  const v = estimateValueEx(target('Harry S. Truman Typed Letter Signed'), [1, 2, 3, 4].map(i => comp(`x${i}`, 'Harry S. Truman Typed Letter Signed', 9000 + i)), buildIdf([])).value!;
  assert.ok(v.compRatio! > 5);
  assert.equal(v.signal, null);
  assert.equal(v.abstain, 'flag:ratio-x5');
  setEngineFlags(null);
});

test('hard boundaries: unsigned comps never price a signed lot (pool shrinks, under 3 → abstain)', () => {
  setEngineFlags(ENGINE_FLAGS_CURRENT);
  const lot = target('Charles Lindbergh Signed Photograph');
  const unsigned = [1, 2, 3].map(i => comp(`u${i}`, 'Charles Lindbergh Original Vintage Photograph', 300 + i));
  const signed = [1, 2].map(i => comp(`s${i}`, 'Charles Lindbergh Signed Photograph', 2000 + i));
  const r = estimateValueEx(lot, [...unsigned, ...signed], buildIdf([]));
  assert.equal(r.value, null);
  assert.equal(r.abstain, 'pool<3');
  const r2 = estimateValueEx(lot, [...unsigned, ...signed, comp('s3', 'Charles Lindbergh Signed Photograph', 2100)], buildIdf([]));
  assert.deepEqual(r2.value!.poolIds.slice().sort(), ['s1', 's2', 's3']);
  setEngineFlags(null);
});

test('exactBlend (measured, not adopted): ≥2 exact comps lift the comp weight to ≥ EXACT_BLEND.w only under the flag', () => {
  const lot = { artist: 'andy-warhol', auctionHouse: "Christie's" };
  setEngineFlags(ENGINE_FLAGS_CURRENT);
  assert.equal(blendPredict(lot, 1000, 'b', 3000, 'low', null, 5).w, 0.05, 'off in the served engine');
  setEngineFlags({ ...ENGINE_FLAGS_CURRENT, exactBlend: true });
  assert.equal(blendPredict(lot, 1000, 'b', 3000, 'low', null, 5).w, EXACT_BLEND.w);
  assert.equal(blendPredict(lot, 1000, 'b', 3000, 'low', null, 1).w, 0.05, 'one exact comp is not a market');
  setEngineFlags(null);
});
