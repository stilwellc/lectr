/**
 * Pricing fix wave 8 (Oct 6 2026) — the round-3 under-call classes. Nothing
 * was adopted: the served engine stays 2026.10.06-wave7. The measured rules
 * stay replayable behind their switches: the habit premium (habitPremium,
 * HABIT_PREMIUM) and the comp half-life by estimate kind (COMP_HL).
 * docs/ENGINE_LANES.md §19.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setEngineFlags, setCalibration, estimateValueEx,
  ENGINE_FLAGS_CURRENT, ENGINE_FLAGS_CANDIDATE, HABIT_PREMIUM, COMP_HL,
  type Comp, type EngineCalibration, type EngineFlags,
} from '../../app/lib/value';
import { buildIdf, type Match } from '../../app/lib/similarity';
import type { AuctionLot } from '../../app/types';

const with_ = (o: Partial<EngineFlags>): EngineFlags => ({ ...ENGINE_FLAGS_CURRENT, ...o, version: `${ENGINE_FLAGS_CURRENT.version}~t` });

test('wave 8 changes no served value: wave 7 stays the engine, the habit premium is off', () => {
  assert.equal(ENGINE_FLAGS_CURRENT.version, '2026.10.06-wave7');
  assert.ok(!ENGINE_FLAGS_CURRENT.habitPremium);
  assert.ok(!ENGINE_FLAGS_CANDIDATE.habitPremium, 'nothing pending');
  assert.deepEqual(COMP_HL, { band: 2, point: 2, noEst: 1 });
});

const M = (cosine: number): Match => ({ score: Math.round(cosine * 100), cosine, cls: 'similar', reasons: [] });
const C = (id: string, usd: number): Comp => ({
  id, match: M(0.9), realizedUsd: usd, saleDate: '2025-12-01',
  lot: { id, artist: 'rolex', title: 'Rolex Day-Date wristwatch', reference: '1803', auctionHouse: "Christie's", saleDate: '2025-12-01', status: 'sold' } as unknown as AuctionLot,
});
const cal: EngineCalibration = {
  edges: [0.6, 0.9, 1.3, 2.0, 10], beatRate: { global: [40, 40, 45, 63, 70, 70] },
  band: { high: { lo: 0.7, hi: 1.5 }, medium: { lo: 0.6, hi: 1.8 }, low: { lo: 0.5, hi: 2.5 } }, marketBySlug: { rolex: 'watches' },
};
const lot = { id: 't', artist: 'rolex', title: 'Rolex Day-Date wristwatch', reference: '1803', auctionHouse: "Sotheby's", status: 'upcoming', saleDate: '2026-10-21', estLowUsd: 10000, estHighUsd: 15000 } as unknown as AuctionLot;

test('habitPremium (measured, off): comps ≥ HABIT_PREMIUM.fr × the habit lift the value by k; under the bar nothing moves', () => {
  setCalibration(cal);
  const tbl = buildIdf([]);
  const over = ['a', 'b', 'c', 'd'].map((id, i) => C(id, 40000 + 1000 * i));
  setEngineFlags(with_({ habitPremium: false }));
  const off = estimateValueEx(lot, over, tbl).value!;
  assert.ok((off.flagRatio ?? 0) >= HABIT_PREMIUM.fr, `fr ${off.flagRatio}`);
  setEngineFlags(with_({ habitPremium: true }));
  const on = estimateValueEx(lot, over, tbl).value!;
  assert.ok(Math.abs(on.compValueUsd / off.compValueUsd - HABIT_PREMIUM.k) < 0.002, `${on.compValueUsd} / ${off.compValueUsd}`);
  assert.ok(Math.abs(on.high / off.high - HABIT_PREMIUM.k) < 0.002, 'the band moves with it');
  assert.deepEqual(on.signal, off.signal, 'the Flags read the comps, not the value');
  const near = ['a', 'b', 'c', 'd'].map((id, i) => C(id, 15000 + 500 * i));
  const n0 = estimateValueEx(lot, near, tbl).value!;
  assert.ok((n0.flagRatio ?? 9) < HABIT_PREMIUM.fr);
  setEngineFlags(with_({ habitPremium: false }));
  assert.equal(estimateValueEx(lot, near, tbl).value!.compValueUsd, n0.compValueUsd);
  setCalibration(null); setEngineFlags(null);
});

test('COMP_HL: the single-figure half-life is its own handle (a shorter one down-weights old comps)', () => {
  setCalibration(cal);
  const tbl = buildIdf([]);
  const rr = { ...lot, estHighUsd: undefined } as unknown as AuctionLot;
  const old = (id: string, usd: number, d: string): Comp => ({ ...C(id, usd), saleDate: d });
  const comps = [old('a', 8000, '2016-01-01'), old('b', 8200, '2016-02-01'), old('c', 20000, '2026-06-01'), old('d', 21000, '2026-07-01'), old('e', 8100, '2016-03-01')];
  setEngineFlags(with_({}));
  const base = estimateValueEx(rr, comps, tbl).value!;
  const prev = COMP_HL.point;
  COMP_HL.point = 0.25;
  try {
    const short = estimateValueEx(rr, comps, tbl).value!;
    assert.ok((short.compAdjUsd ?? 0) > (base.compAdjUsd ?? 0), `${short.compAdjUsd} vs ${base.compAdjUsd}`);
  } finally { COMP_HL.point = prev; }
  setCalibration(null); setEngineFlags(null);
});
