/**
 * scripts/hedonic-index.ts — the market/maker hedonic gates (Oct 2026 fixes):
 *  · year-precision dates never enter the fit (their quarter is invented)
 *  · the MARKET index fails a horizon on a ≥15pp source/house share shift
 *    between its endpoints (the maker index keeps its >40%/<12% rule)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHedonicIndex, compositionBreak, type QuarterStat } from '../hedonic-index';
import type { AuctionLot } from '../../app/types';

/** deterministic PRNG (mulberry32) + Box-Muller normal */
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { u, n: () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()) };
}
const QUARTERS = ['2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4', '2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'];
const NOW = new Date('2026-08-15T00:00:00Z'); // current stub = 2026-Q3 → last complete 2026-Q2

/** Synthetic market: 10 makers, 2 houses, 160 lots/quarter, a true +20%/yr
 *  drift; `shareB(q)` is house B's share of quarter q; 8 sales per house-quarter. */
function market(shareB: (q: string) => number, seed = 1, sigma = 0.25): AuctionLot[] {
  const r = rng(seed);
  const lots: AuctionLot[] = [];
  QUARTERS.forEach((q, qi) => {
    const [y, qn] = q.split('-Q').map(Number);
    for (let i = 0; i < 160; i++) {
      const maker = `maker-${i % 10}`;
      const house = r.u() < shareB(q) ? 'House B' : 'House A';
      const lnP = 9 + (i % 10) * 0.3 + (house === 'House B' ? 0.4 : 0) + Math.log(1.2) * (qi / 4) + sigma * r.n();
      const month = (qn - 1) * 3 + 1 + (i % 3);
      lots.push({
        id: `${q}-${i}`, artist: maker, status: 'sold', realizedUsd: Math.exp(lnP),
        saleDate: `${y}-${String(month).padStart(2, '0')}-10`, auctionHouse: house,
        formKey: i % 2 ? 'painting' : 'work-on-paper', saleName: `${house} sale ${q} #${i % 8}`,
      } as unknown as AuctionLot);
    }
  });
  return lots;
}

test('market hedonic: a stable house mix publishes the drift', () => {
  const h = buildHedonicIndex(market(() => 0.5), NOW);
  assert.equal(h.lastCompleteQuarter, '2026-Q2');
  const y1 = h.horizons['1Y'];
  assert.equal(y1.publishable, true, y1.reason);
  assert.ok(y1.changePct! > 10 && y1.changePct! < 30, `1Y ${y1.changePct}`);
});

test('market hedonic: a ≥15pp house share shift between endpoints fails the horizon', () => {
  // House B is 50% of every quarter except the 1Y end, where it is 70% (+20pp).
  const h = buildHedonicIndex(market(q => (q === '2026-Q2' ? 0.7 : 0.5)), NOW);
  const y1 = h.horizons['1Y'];
  assert.equal(y1.publishable, false);
  assert.match(y1.reason, /^composition break: house 'House [AB]'/);
});

test('compositionBreak: market mode trips at 15pp, maker mode keeps >40%/<12%', () => {
  const qs = (houses: Record<string, number>): QuarterStat => {
    const n = Object.values(houses).reduce((a, b) => a + b, 0);
    return { n, houseShare: new Map(Object.entries(houses)), srcShare: new Map([['native', n]]) } as unknown as QuarterStat;
  };
  const a = qs({ A: 85, B: 15 }), b = qs({ A: 70, B: 30 });   // 15pp shift
  const c = qs({ A: 86, B: 14 });                              // 1pp shift
  assert.ok(compositionBreak(a, b, 'market'));
  assert.equal(compositionBreak(a, c, 'market'), null);
  assert.equal(compositionBreak(a, b, 'maker'), null, 'maker mode: 30% is not >40%');
  assert.ok(compositionBreak(qs({ A: 55, B: 45 }), qs({ A: 95, B: 5 }), 'maker'), 'maker mode: 45% vs 5%');
});

test('year-precision (and unknown) dates never enter the fit', () => {
  const lots = market(() => 0.5);
  const base = buildHedonicIndex(lots, NOW).series.find(p => p.period === '2025-Q2')!.n;
  // 40 Sotheby's '-06-01' year-precision stubs land in 2025-Q2 by date only
  const stubs = Array.from({ length: 40 }, (_, i) => ({
    id: `stub-${i}`, artist: `maker-${i % 10}`, status: 'sold', realizedUsd: 1e6, saleDate: '2025-06-01',
    auctionHouse: 'House A', datePrecision: i % 2 ? 'year' : 'unknown', saleName: 'stub',
  } as unknown as AuctionLot));
  const after = buildHedonicIndex(lots.concat(stubs), NOW).series.find(p => p.period === '2025-Q2')!.n;
  assert.equal(after, base);
  // a MONTH-precision date keeps its true quarter
  const month = stubs.map(s => ({ ...s, datePrecision: 'month' } as unknown as AuctionLot));
  assert.equal(buildHedonicIndex(lots.concat(month), NOW).series.find(p => p.period === '2025-Q2')!.n, base + 40);
});
