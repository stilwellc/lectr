import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedMovers } from '../../preview/terminal/verified';
import type { MarketData } from '../../hooks/useRayData';

const hz = (changePct: number | null, publishable: boolean) => ({ changePct, ciLoPct: changePct == null ? null : changePct - 50, ciHiPct: changePct == null ? null : changePct + 60, nStart: 100, nEnd: 500, publishable, reason: '' });
const series = [{ period: '1991-Q4', value: 100, ciLo: 100, ciHi: 100, n: 24 }, { period: '2026-Q3', value: 309, ciLo: 250, ciHi: 380, n: 212 }];
const market = (mi: Record<string, unknown>) => ({ makerIndex: mi } as unknown as MarketData);

test('verified movers (r7): a retired pseudo-maker (a category) never reaches the verified list', () => {
  const m = market({
    'space-exploration': { series, coverageMakerLots: 3000, horizons: { '1Y': hz(null, false), '3Y': hz(41, true), MAX: hz(90, true) } },
    'graded-cards': { series, coverageMakerLots: 3000, horizons: { '3Y': hz(12, true) } },
    rolex: { series, coverageMakerLots: 9000, horizons: { '3Y': hz(27.4, true) } },
  });
  assert.deepEqual(verifiedMovers(m).map(x => x.slug), ['rolex']);
  assert.deepEqual(verifiedMovers(m, 'science').map(x => x.slug), []);
});

test('verified movers (P3): the full-span read publishes when no fixed horizon does, labeled with its span', () => {
  const m = market({
    'patek-philippe': { series, coverageMakerLots: 20570, horizons: { '1Y': hz(null, false), '3Y': hz(null, false), '5Y': hz(null, false), MAX: hz(209, true) } },
    rolex: { series, coverageMakerLots: 9000, horizons: { '1Y': hz(null, false), '3Y': hz(27.4, true), '5Y': hz(24.6, true), MAX: hz(80, true) } },
    omega: { series, coverageMakerLots: 9000, horizons: { '1Y': hz(null, false), MAX: hz(null, false) } },
  });
  const v = verifiedMovers(m);
  const patek = v.find(x => x.slug === 'patek-philippe');
  assert.equal(patek?.horizon, 'since 1991');
  assert.equal(patek?.changePct, 209);
  // a fixed horizon still wins when it publishes (longest first)
  assert.equal(v.find(x => x.slug === 'rolex')?.horizon, '5Y');
  assert.equal(v.find(x => x.slug === 'omega'), undefined);
});
