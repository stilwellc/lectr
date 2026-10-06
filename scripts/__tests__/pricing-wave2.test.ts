/**
 * Pricing fix wave 2 (Oct 6 2026) — the engine-side contracts: the purity
 * gate, the hard comp boundaries, the (measured, off) exact blend and recency
 * cap, the bid read's clock, card variant identity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_FLAGS_WAVE3,
  capWeights, COMP_WEIGHT_CAP, vsBidLive, VSBID_WINDOW_DAYS,
  estimateValueEx, setEngineFlags, ENGINE_FLAGS_CURRENT, ENGINE_FLAGS_HAMMER_BASIS, type Comp,
  blendPredict, EXACT_BLEND,
} from '../../app/lib/value';
import { parseCard, cardKey } from '../../app/lib/cards';
import { buildIdf, type Match } from '../../app/lib/similarity';
import type { AuctionLot } from '../../app/types';

test('capWeights: no weight above the cap, mass conserved, order kept; under 1/cap weights → equal', () => {
  const w = capWeights([10, 1, 1, 1, 1]);
  assert.ok(Math.abs(w.reduce((s, x) => s + x, 0) - 1) < 1e-9);
  assert.ok(Math.max(...w) <= COMP_WEIGHT_CAP.share + 1e-9);
  assert.ok(Math.abs(w[0] - COMP_WEIGHT_CAP.share) < 1e-9);
  assert.ok(Math.abs(w[1] - w[4]) < 1e-12);
  // already under the cap: proportions unchanged
  const u = capWeights([1, 1, 1, 1]);
  assert.deepEqual(u.map(x => Math.round(x * 1000)), [250, 250, 250, 250]);
  // two big ones both capped, the rest share the remainder
  const b = capWeights([5, 5, 1, 1]);
  assert.ok(Math.abs(b[0] - 0.35) < 1e-9 && Math.abs(b[1] - 0.35) < 1e-9 && Math.abs(b[2] - 0.15) < 1e-9);
  assert.deepEqual(capWeights([9, 1]), [0.5, 0.5]);
});

test('vsBidLive: the comps-vs-bid read only inside the last day of the sale', () => {
  const now = Date.parse('2026-10-05T13:00:00Z');
  assert.equal(VSBID_WINDOW_DAYS, 1);
  assert.equal(vsBidLive({ saleDateTime: '2026-10-06T02:00:00Z' }, now), true);
  assert.equal(vsBidLive({ saleDateTime: '2026-10-09T02:00:00Z' }, now), false);
  assert.equal(vsBidLive({ saleDate: '2026-10-06' }, now), true);
  assert.equal(vsBidLive({}, now), false);
});

test('card identity: named print variations never share a key with the base card', () => {
  const k = (t: string) => cardKey(parseCard(t));
  const base = k('2018 Bowman Chrome #1 Shohei Ohtani, Batting Rookie Card - PSA GEM MT 10');
  const bag = k('2018 Bowman Chrome #1 Shohei Ohtani, Carrying Bag Rookie Card - PSA GEM MT 10');
  assert.ok(base && bag && base !== bag);
  const gray = k('1956 Topps #30 Jackie Robinson, Gray Back - PSA NM-MT 8');
  const white = k('1956 Topps #30 Jackie Robinson, White Back - PSA NM-MT 8');
  assert.ok(gray && white && gray !== white);
  assert.equal(gray, k('1956 Topps #30 Jackie Robinson Gray Back PSA NM-MT 8'));
  const yel = k('1969 Topps #500 Mickey Mantle, Last Name in Yellow - PSA VG-EX 4');
  const wht = k('1969 Topps #500 Mickey Mantle, Last Name in White - PSA VG-EX 4');
  assert.ok(yel && wht && yel !== wht);
});

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
  // the wave-3 engine kept the value and stripped the signal; wave 4
  // (poolScale) withholds the value itself
  setEngineFlags(ENGINE_FLAGS_WAVE3);
  const comps = [1, 2, 3, 4].map(i => comp(`x${i}`, 'Harry S. Truman Typed Letter Signed', 9000 + i));
  const v = estimateValueEx(target('Harry S. Truman Typed Letter Signed'), comps, buildIdf([])).value!;
  assert.ok(v.compRatio! > 5);
  assert.equal(v.signal, null);
  assert.equal(v.abstain, 'flag:ratio-x5');
  setEngineFlags(ENGINE_FLAGS_CURRENT);
  assert.equal(estimateValueEx(target('Harry S. Truman Typed Letter Signed'), comps, buildIdf([])).abstain, 'pool-scale');
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
