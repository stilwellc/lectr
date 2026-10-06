/**
 * Oct 6 2026 — the Flags on one basis: hammer comp/flag ratios, hammer beats
 * in the record, the single-figure estimate kind, one-notch confidence.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  estKindOf, adjustedTop, setEngineFlags, getEngineFlags, BAND_TOP_RATIO, ENGINE_FLAGS_HOUSE_GATE,
} from '../../app/lib/value';
import { compPremiumOf, sfOf, calibrationOf, type CalObs, type L } from '../backtest-core';
import { lotHammerFromAllIn } from '../../app/lib/premiums';

afterEach(() => setEngineFlags(null));

test('estKindOf: a single printed figure is its own kind only under singleFigure', () => {
  assert.equal(estKindOf(5000, 5000), 'b');
  assert.equal(estKindOf(4000, 6000), 'b');
  assert.equal(estKindOf(500, null), 'p');
  setEngineFlags({ ...getEngineFlags(), singleFigure: true });
  assert.equal(estKindOf(5000, 5000), 's');
  assert.equal(estKindOf(4000, 6000), 'b');
  assert.equal(adjustedTop(5000, 5000, 1.1, 's'), 5000 * 1.1 * BAND_TOP_RATIO);
  assert.equal(adjustedTop(5000, 5000, 1.1), 5500, 'range semantics unchanged without the kind');
});

test('compPremiumOf / sfOf: the comps premium at the lot’s dated schedule', () => {
  const lot = { auctionHouse: 'REA', saleDate: '2026-04-15', estLowUsd: 5000, estHighUsd: 5000 } as unknown as L;
  assert.equal(compPremiumOf(lot, 12300), 12300 / lotHammerFromAllIn(lot, 12300));
  assert.ok(Math.abs(compPremiumOf(lot, 12300) - 1.23) < 1e-9);
  assert.equal(sfOf(lot), true);
  assert.equal(sfOf({ estLowUsd: 4000, estHighUsd: 6000 } as unknown as L), false);
});

test('calibrationOf: hammer basis buckets on fr / pc and counts the HAMMER beat', () => {
  const rows: CalObs[] = [];
  // 300 rows: all-in flag ratio 1.5 (a "flag" bucket all-in), premium 1.25 → hammer ratio 1.2 (at-market bucket);
  // all-in beat true, hammer beat false
  for (let i = 0; i < 300; i++) rows.push({ m: 'art', cr: 1.5, fr: 1.5, beat: true, ba: true, hb: false, hba: false, pc: 1.25, r: 1, conf: 'high', ageY: 0.5, et: 'b' });
  setEngineFlags(ENGINE_FLAGS_HOUSE_GATE);
  const allIn = calibrationOf(rows);
  setEngineFlags({ ...ENGINE_FLAGS_HOUSE_GATE, hammerBasis: true });
  const ham = calibrationOf(rows);
  // all-in: bucket 3 (1.3–2) carries the beats; hammer: bucket 2 (0.9–1.3) and no beats
  assert.ok(allIn.beatRate.art[3] > ham.beatRate.art[2]);
  assert.equal(allIn.beatRate.art[3], 85, 'all-in: every row beats');
  assert.ok(ham.beatRate.art[3] < 85, 'hammer: no row beats; the flag bucket is empty');
});
