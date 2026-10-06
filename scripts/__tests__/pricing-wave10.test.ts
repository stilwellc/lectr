/**
 * Pricing fix wave 10 (Oct 6 2026) — the tier tails on the value band
 * (vbTier, VB_TIER.k). docs/ENGINE_LANES.md §21.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setEngineFlags, ENGINE_FLAGS_CURRENT, ENGINE_FLAGS_WAVE7, VB_TIER, type EngineFlags,
} from '../../app/lib/value';
import { fitValueBands, type NoEstObs } from '../backtest-core';
import { USE_HOUSE_REFERENCE } from '../lib/corpus-normalize';

const with_ = (o: Partial<EngineFlags>): EngineFlags => ({ ...ENGINE_FLAGS_CURRENT, ...o, version: `${ENGINE_FLAGS_CURRENT.version}~t` });

test('wave 10 is the served engine: the tier tails on, the Phillips reference still off', () => {
  assert.equal(ENGINE_FLAGS_CURRENT.version, '2026.10.06-wave10');
  assert.equal(ENGINE_FLAGS_CURRENT.vbTier, true);
  assert.ok(!ENGINE_FLAGS_WAVE7.vbTier);
  for (const k of ['vbMarket', 'bidPull', 'cardNewRelease', 'oddsFloor'] as const) assert.equal(ENGINE_FLAGS_CURRENT[k], true, k);
  assert.equal(USE_HOUSE_REFERENCE, false);
});

test('VB_TIER.k only widens, within the fit clamp, on known paths and tiers', () => {
  let n = 0;
  for (const [path, byM] of Object.entries(VB_TIER.k)) {
    assert.ok(path === 'e' || path === 'n', path);
    for (const byT of Object.values(byM)) {
      for (const [c, [lo, hi]] of Object.entries(byT)) {
        assert.ok(['high', 'medium', 'low'].includes(c), c);
        assert.ok(lo >= 1 && lo <= 2 && hi >= 1 && hi <= 2, `${c} ${lo}/${hi}`);
        n++;
      }
    }
  }
  assert.ok(n > 0);
  // the under-covering high tiers the fit was for
  for (const m of ['art', 'culture', 'watches']) assert.ok(VB_TIER.k.e[m]?.high, m);
});

// a deterministic residual cloud: ln z evenly spread over ±s
const cloud = (m: string, conf: string, s: number, n: number): NoEstObs[] =>
  Array.from({ length: n }, (_, i) => ({ m, conf, rn: Math.exp(-s + (2 * s * i) / (n - 1)), sd: '2026-06-01' }) as NoEstObs);

test('vbTier raises a listed cell\'s tails to k, leaves unlisted cells, and builds a cell for a market without one', () => {
  const saved = VB_TIER.k;
  try {
    VB_TIER.k = { n: { art: { high: [1.5, 2] }, design: { medium: [1.2, 1.2] } } };
    const ne = [...cloud('art', 'high', 0.5, 400), ...cloud('art', 'medium', 0.7, 400), ...cloud('design', 'medium', 0.6, 40)];
    setEngineFlags(with_({ vbTier: false }));
    const off = fitValueBands([], ne, null, {}, '2026-10-01');
    setEngineFlags(with_({ vbTier: true }));
    const on = fitValueBands([], ne, null, {}, '2026-10-01');
    const b = off.valueBandByMarket.art.n.high, a = on.valueBandByMarket.art.n.high;
    assert.ok(Math.abs(a.lo - Math.round(Math.pow(b.lo, 1.5) * 1000) / 1000) < 0.002, `${a.lo} vs ${b.lo}^1.5`);
    assert.ok(Math.abs(a.hi - Math.round(Math.pow(b.hi, 2) * 1000) / 1000) < 0.002, `${a.hi} vs ${b.hi}^2`);
    assert.ok(a.mb == null || (a.mb >= a.lo && a.mb <= 1));
    assert.deepEqual(on.valueBandByMarket.art.n.medium, off.valueBandByMarket.art.n.medium);
    assert.deepEqual(on.valueBand, off.valueBand, 'the global tier bands never move');
    // design is too thin for its own market tails: its cell is the global medium band^1.2
    assert.ok(!off.valueBandByMarket.design);
    const g = off.valueBand.n.medium, d = on.valueBandByMarket.design.n.medium;
    assert.ok(Math.abs(d.lo - Math.pow(g.lo, 1.2)) < 0.002 && Math.abs(d.hi - Math.pow(g.hi, 1.2)) < 0.002, JSON.stringify(d));
  } finally {
    VB_TIER.k = saved;
    setEngineFlags(null);
  }
});
