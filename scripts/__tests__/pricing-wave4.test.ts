/**
 * Pricing fix wave 4 (Oct 6 2026) — the partial house habit, the wrong-scale
 * pool, the same-work comp test, the held Flags markets, the uncalibrated
 * odds, the live-bid floor on a band-less value. docs/ENGINE_LANES.md §15.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setEngineFlags, setCalibration, setHouseBias, estimateValueEx, blendPredict, floorAtBid,
  ENGINE_FLAGS_CURRENT, FLAG_HOLD_MARKETS, type Comp, type EngineCalibration, type EngineFlags, type HouseBias, type ValueResult,
} from '../../app/lib/value';
import { sameWorkComp } from '../../app/lib/comp-purity';
import { buildIdf, type Match } from '../../app/lib/similarity';
import { lotAllInFactor } from '../../app/lib/premiums';
import type { AuctionLot } from '../../app/types';

const M = (cosine: number): Match => ({ score: Math.round(cosine * 100), cosine, cls: 'similar', reasons: [] });
const C = (id: string, usd: number, saleDate = '2025-12-01'): Comp => ({ id, match: M(0.9), realizedUsd: usd, saleDate });
const with_ = (o: Partial<EngineFlags>): EngineFlags => ({ ...ENGINE_FLAGS_CURRENT, ...o, version: `${ENGINE_FLAGS_CURRENT.version}~t` });
const tbl = buildIdf([]);

test('sameWorkComp: same title (maker / years / punctuation aside), same house family, h × w ±10%; no dims = not the same work', () => {
  const t = { artist: 'pablo-picasso', title: 'Puppy (vase)', auctionHouse: 'Rago', heightCm: 44, widthCm: 44 };
  assert.ok(sameWorkComp(t, { artist: 'pablo-picasso', title: 'Puppy Vase', auctionHouse: 'Wright', heightCm: 44.5, widthCm: 43 }));
  assert.ok(!sameWorkComp(t, { artist: 'pablo-picasso', title: 'Puppy Plate', auctionHouse: 'Wright', heightCm: 44, widthCm: 44 }), 'another work');
  assert.ok(!sameWorkComp(t, { artist: 'pablo-picasso', title: 'Puppy (vase)', auctionHouse: "Christie's", heightCm: 44, widthCm: 44 }), 'another house');
  assert.ok(!sameWorkComp(t, { artist: 'pablo-picasso', title: 'Puppy (vase)', auctionHouse: 'Rago', heightCm: 28, widthCm: 44 }), 'another size');
  assert.ok(!sameWorkComp(t, { artist: 'pablo-picasso', title: 'Puppy (vase)', auctionHouse: 'Rago' }), 'no dimensions, no claim');
});

test('blendPredict: habitShrink withholds that share of the house habit (the anchor), the comp term untouched', () => {
  const hb: HouseBias = { asOf: '2026-01-01', ref: Math.log(1.5), cells: { 'g:p': Math.log(1.6) }, n: { 'g:p': 500 } };
  setHouseBias(hb);
  setEngineFlags(ENGINE_FLAGS_CURRENT);
  const lot = { artist: 'entertainment-memorabilia', auctionHouse: 'RR Auction' };
  const full = blendPredict(lot, 1000, 'p', 800, 'low', null);
  const part = blendPredict(lot, 1000, 'p', 800, 'low', null, 0, 0, 0.3);
  assert.equal(full.w, part.w);
  const lr = Math.log(800 / 1000);
  assert.ok(Math.abs(Math.log(full.value / 1000) - ((1 - full.w) * Math.log(1.6) + full.w * lr)) < 1e-9);
  assert.ok(Math.abs(Math.log(part.value / 1000) - ((1 - part.w) * 0.7 * Math.log(1.6) + part.w * lr)) < 1e-9);
  setHouseBias(null); setEngineFlags(null);
});

test('partialHabit: a single-point estimate whose pure comps read under the habit anchors on part of it; a band estimate does not', () => {
  const hb: HouseBias = { asOf: '2026-01-01', ref: Math.log(1.3), cells: { 'g:p': Math.log(1.6), 'g:b': Math.log(1.3) }, n: { 'g:p': 500, 'g:b': 500 } };
  setHouseBias(hb);
  const rr = (o: Record<string, unknown> = {}) => ({
    id: 't', title: 'Jimmy Carter Typed Letter Signed', artist: 'entertainment-memorabilia', auctionHouse: 'RR Auction',
    status: 'upcoming', saleDate: '2026-09-16', estLowUsd: 300, ...o,
  } as unknown as AuctionLot);
  const comps = [C('a', 200), C('b', 220), C('c', 240), C('d', 210)];
  setEngineFlags(with_({ partialHabit: false }));
  const off = estimateValueEx(rr(), comps, tbl).value!;
  setEngineFlags(with_({ partialHabit: true }));
  const on = estimateValueEx(rr(), comps, tbl).value!;
  assert.ok(off.flagRatio! < 0.8);
  assert.ok(on.compValueUsd < off.compValueUsd, `${on.compValueUsd} < ${off.compValueUsd}`);
  const band = estimateValueEx(rr({ estLowUsd: 250, estHighUsd: 350 }), comps, tbl).value!;
  setEngineFlags(with_({ partialHabit: false }));
  assert.equal(estimateValueEx(rr({ estLowUsd: 250, estHighUsd: 350 }), comps, tbl).value!.compValueUsd, band.compValueUsd, 'band estimates keep the whole habit');
  setHouseBias(null); setEngineFlags(null);
});

test('poolScale: comps outside ×/÷5 of the estimate price another object — no value', () => {
  const lot = { id: 't', title: 'Entablature', artist: 'roy-lichtenstein', auctionHouse: "Sotheby's", status: 'upcoming', saleDate: '2026-11-01', estLowUsd: 400000, estHighUsd: 600000, medium: 'acrylic' } as unknown as AuctionLot;
  const prints = [C('a', 5625), C('b', 3900), C('c', 4800), C('d', 13825)];
  setEngineFlags(with_({ poolScale: true }));
  assert.deepEqual(estimateValueEx(lot, prints, tbl), { value: null, abstain: 'pool-scale' });
  setEngineFlags(with_({ poolScale: false }));
  assert.ok(estimateValueEx(lot, prints, tbl).value, 'without the rule the estimate-anchored value shipped');
  setEngineFlags(null);
});

test('flagHold: a held market (watches, sports) ships no "below" read; another market still flags', () => {
  const cal: EngineCalibration = {
    edges: [0.6, 0.9, 1.3, 2.0, 10],
    beatRate: { global: [40, 40, 45, 63, 70, 70] },
    band: { high: { lo: 0.7, hi: 1.5 }, medium: { lo: 0.6, hi: 1.8 }, low: { lo: 0.5, hi: 2.5 } },
    marketBySlug: { rolex: 'watches', 'andy-warhol': 'art' },
  };
  setCalibration(cal);
  const comps = [C('a', 3000), C('b', 3100), C('c', 2900), C('d', 3050)];
  const lot = (artist: string) => ({ id: 't', title: 'Submariner', artist, auctionHouse: "Christie's", status: 'upcoming', saleDate: '2026-11-01', estLowUsd: 1000, estHighUsd: 1500 } as unknown as AuctionLot);
  setEngineFlags(with_({ flagHold: false }));
  assert.equal(estimateValueEx(lot('rolex'), comps, tbl).value!.signal?.label, 'below comparable market');
  setEngineFlags(with_({ flagHold: true }));
  assert.ok(FLAG_HOLD_MARKETS.has('watches') && FLAG_HOLD_MARKETS.has('sports'));
  const held = estimateValueEx(lot('rolex'), comps, tbl).value!;
  assert.equal(held.signal, null);
  assert.equal(held.abstain, 'flag:held');
  assert.ok(held.compValueUsd > 0, 'the value itself stands');
  assert.equal(estimateValueEx(lot('andy-warhol'), comps, tbl).value!.signal?.label, 'below comparable market', 'art still flags');
  setCalibration(null); setEngineFlags(null);
});

test('uncalNoOdds: no calibration → no odds and no directional call (never the legacy curve)', () => {
  setCalibration(null);
  const comps = [C('a', 3000), C('b', 3100), C('c', 2900), C('d', 3050)];
  const lot = { id: 't', title: 'Marilyn', artist: 'andy-warhol', auctionHouse: "Christie's", status: 'upcoming', saleDate: '2026-11-01', estLowUsd: 1000, estHighUsd: 1500 } as unknown as AuctionLot;
  setEngineFlags(with_({ uncalNoOdds: false }));
  assert.ok((estimateValueEx(lot, comps, tbl).value!.signal?.beatRatePct ?? 0) > 0, 'legacy curve odds');
  setEngineFlags(with_({ uncalNoOdds: true }));
  const s = estimateValueEx(lot, comps, tbl).value!.signal;
  assert.ok(!s || (s.beatRatePct === 0 && s.label !== 'below comparable market'));
  setEngineFlags(null);
});

test('floorAtBid: a value without the hammer band still has its all-in low floored at the bid', () => {
  const NOW = Date.parse('2026-10-05T13:00:00Z');
  const v = { poolIds: [], n: 5, compValueUsd: 3000, low: 900, high: 4000, compRatio: null, signal: null, estimateUsd: 3000, vsBid: null, confidence: 'medium', exact: null } as ValueResult;
  const lot = { auctionHouse: 'Goldin', currentBid: 1400, saleDate: '2026-10-20', saleDateTime: '2026-10-20T02:00:00Z' };
  const f = floorAtBid(v, lot, NOW);
  assert.notEqual(f, v);
  assert.equal(f.low, Math.round(1400 * lotAllInFactor(lot, 1400)));
  assert.equal(f.compValueUsd, 3000, 'the value above the bid is untouched');
});
