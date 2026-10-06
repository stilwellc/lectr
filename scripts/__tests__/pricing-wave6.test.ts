/**
 * Pricing fix wave 6 (Oct 6 2026) — art comp identity: the scale-consistent
 * pool (compScale), the catalogue pool (crPool) and the catalogue floor
 * (crWork). docs/ENGINE_LANES.md §17.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setEngineFlags, setCalibration, estimateValueEx, ENGINE_FLAGS_CURRENT, COMP_SCALE,
  type Comp, type EngineCalibration, type EngineFlags,
} from '../../app/lib/value';
import { buildIdf, type Match } from '../../app/lib/similarity';
import type { AuctionLot } from '../../app/types';

const M = (cosine: number): Match => ({ score: Math.round(cosine * 100), cosine, cls: 'similar', reasons: [] });
const C = (id: string, usd: number, o: Partial<Comp> = {}): Comp => ({ id, match: M(0.9), realizedUsd: usd, saleDate: '2025-12-01', ...o });
const with_ = (o: Partial<EngineFlags>): EngineFlags => ({ ...ENGINE_FLAGS_CURRENT, ...o, version: `${ENGINE_FLAGS_CURRENT.version}~t` });
const tbl = buildIdf([]);
const cal: EngineCalibration = {
  edges: [0.6, 0.9, 1.3, 2.0, 10],
  beatRate: { global: [40, 40, 45, 63, 70, 70] },
  band: { high: { lo: 0.7, hi: 1.5 }, medium: { lo: 0.6, hi: 1.8 }, low: { lo: 0.5, hi: 2.5 } },
  marketBySlug: { 'pablo-picasso': 'art', 'entertainment-memorabilia': 'culture' },
};
const lot = (o: Record<string, unknown> = {}) => ({
  id: 't', title: 'Minotaure aveugle guidé par une Fillette, I, from La Suite Vollard', artist: 'pablo-picasso',
  auctionHouse: "Christie's", status: 'upcoming', saleDate: '2026-10-21', estLowUsd: 10000, estHighUsd: 15000, ...o,
} as unknown as AuctionLot);

test('compScale: an art comp far off the estimate leaves the pool (the "dans la nuit" plate)', () => {
  setCalibration(cal);
  const comps = [C('a', 15000), C('b', 12000), C('c', 17500), C('d', 14000), C('nuit1', 133500), C('nuit2', 106250)];
  setEngineFlags(with_({ compScale: false }));
  const off = estimateValueEx(lot(), comps, tbl).value!;
  assert.ok(off.poolIds.includes('nuit1'));
  setEngineFlags(with_({ compScale: true }));
  const on = estimateValueEx(lot(), comps, tbl).value!;
  assert.deepEqual([...on.poolIds].sort(), ['a', 'b', 'c', 'd']);
  assert.ok(on.compValueUsd <= off.compValueUsd);
  setCalibration(null); setEngineFlags(null);
});

test('compScale: fewer than COMP_SCALE.minKeep comps left → the pool stands', () => {
  setCalibration(cal);
  setEngineFlags(with_({ compScale: true }));
  const comps = [C('a', 15000), C('b', 12000), C('n1', 133500), C('n2', 106250), C('n3', 99000)];
  assert.ok(COMP_SCALE.minKeep >= 3);
  const v = estimateValueEx(lot({ estLowUsd: 30000, estHighUsd: 40000 }), comps, tbl).value!;
  assert.equal(v.poolIds.length, 5);
  setCalibration(null); setEngineFlags(null);
});

test('compScale: never rescues a pool priced on another scale (pool-scale still abstains)', () => {
  setCalibration(cal);
  setEngineFlags(with_({ compScale: true }));
  // a $3k target whose pool is mostly $40k+ originals, with three near-estimate stragglers
  const comps = [C('a', 60000), C('b', 45000), C('c', 85000), C('d', 57000), C('e', 61000), C('f', 52000), C('g', 70000),
    C('x', 3000), C('y', 2800), C('z', 3500)];
  assert.deepEqual(estimateValueEx(lot({ title: 'Toros Vallauris', medium: 'linocut', estLowUsd: 3000, estHighUsd: 3000 }), comps, tbl), { value: null, abstain: 'pool-scale' });
  setCalibration(null); setEngineFlags(null);
});

test('compScale: off outside art / design (memorabilia keeps its pool)', () => {
  setCalibration(cal);
  setEngineFlags(with_({ compScale: true }));
  const comps = [C('a', 1500), C('b', 1200), C('c', 1750), C('d', 1400), C('e', 13350)];
  const v = estimateValueEx(lot({ artist: 'entertainment-memorabilia', title: 'Jimmy Carter Typed Letter Signed', estLowUsd: 1000, estHighUsd: 1500 }), comps, tbl).value!;
  assert.ok(v.poolIds.includes('e'));
  setCalibration(null); setEngineFlags(null);
});

test('crPool / crWork: the same catalogue-raisonné number is the same work', () => {
  setCalibration(cal);
  const t = lot({ title: 'Sculpteur et son modèle devant une fenêtre (B. 168)', category: 'print', formKey: 'print', medium: 'etching' });
  const cited = (id: string, usd: number) => C(id, usd, { lot: { id, artist: 'pablo-picasso', title: `Sculpteur et son modèle devant une fenêtre (B. 168)`, category: 'print', formKey: 'print', medium: 'etching' } as unknown as AuctionLot });
  const other = (id: string, usd: number) => C(id, usd, { lot: { id, artist: 'pablo-picasso', title: `Femme assise (B. 300)`, category: 'print', formKey: 'print', medium: 'etching' } as unknown as AuctionLot });
  const comps = [cited('a', 30000), cited('b', 32000), cited('c', 31000), other('d', 9000), other('e', 9500)];
  setEngineFlags(with_({ crPool: true }));
  assert.deepEqual([...estimateValueEx(t, comps, tbl).value!.poolIds].sort(), ['a', 'b', 'c']);
  setEngineFlags(with_({ crWork: false }));
  const off = estimateValueEx(t, comps.slice(0, 3), tbl).value!;
  setEngineFlags(with_({ crWork: true }));
  const on = estimateValueEx(t, comps.slice(0, 3), tbl).value!;
  assert.ok((on.blendW ?? 0) >= 0.5 && (on.blendW ?? 0) > (off.blendW ?? 0), `${on.blendW} vs ${off.blendW}`);
  setCalibration(null); setEngineFlags(null);
});
