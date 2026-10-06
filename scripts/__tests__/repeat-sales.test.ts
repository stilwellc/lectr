/**
 * scripts/repeat-sales.ts — the BMN repeat-sale index behind market.json
 * `repeatSale` and every repeat-sale sub-market/drill read. Synthetic markets
 * with a KNOWN true index pin the fit's robustness: house levels, outlier
 * pairs, a thin seasonal last quarter, a house-mix break.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRepeatSaleIndex } from '../repeat-sales';
import type { AuctionLot } from '../../app/types';

/** deterministic PRNG (mulberry32) + a Box-Muller normal */
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  return { u, n };
}
const QUARTERS: string[] = [];
for (let y = 2020; y <= 2025; y++) for (let q = 1; q <= 4; q++) QUARTERS.push(`${y}-Q${q}`);
const dateOf = (q: string, day = 15) => {
  const [y, n] = q.split('-Q');
  return `${y}-${String((+n - 1) * 3 + 2).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
type Sale = { key: string; q: string; house: string; price: number };
const toLots = (sales: Sale[]): AuctionLot[] => sales.map((s, i) => ({
  id: `l${i}`, artist: 'x', title: s.key, status: 'sold', priceUsd: s.price,
  saleDate: dateOf(s.q, 1 + (i % 27)), auctionHouse: s.house,
} as unknown as AuctionLot));
const keyOf = (l: AuctionLot) => l.title || null;
const NOW = new Date('2026-02-15T00:00:00Z'); // stub 2026-Q1 → last complete 2025-Q4

/** flat true index; `houseOf(qIdx, r)` picks the house; `mult(house, qIdx, r)` the price multiplier */
function market(seed: number, nObj: number, opts: {
  houseOf?: (qi: number, u: number) => string;
  mult?: (house: string, qi: number, u: number) => number;
  salesPerObj?: number;
  quarterWeight?: (qi: number) => number;
} = {}): Sale[] {
  const R = rng(seed);
  const houseOf = opts.houseOf || (() => 'A');
  const mult = opts.mult || (() => 1);
  const wts = QUARTERS.map((_, i) => (opts.quarterWeight ? opts.quarterWeight(i) : 1));
  const tot = wts.reduce((a, b) => a + b, 0);
  const pickQ = () => { let x = R.u() * tot; for (let i = 0; i < wts.length; i++) { x -= wts[i]; if (x <= 0) return i; } return wts.length - 1; };
  const out: Sale[] = [];
  for (let o = 0; o < nObj; o++) {
    const base = 1000 * Math.exp(R.n());
    const k = opts.salesPerObj || 3;
    const qs = new Set<number>();
    while (qs.size < k) qs.add(pickQ());
    for (const qi of Array.from(qs)) {
      const h = houseOf(qi, R.u());
      out.push({ key: `o${o}`, q: QUARTERS[qi], house: h, price: base * mult(h, qi, R.u()) * Math.exp(0.08 * R.n()) });
    }
  }
  return out;
}

test('house fixed effects: a rising share of a premium house is not appreciation', () => {
  // flat market; house B prices 80% over A; B's share climbs 10% → 70%
  const sales = market(1, 1500, {
    houseOf: (qi, u) => (u < 0.1 + 0.6 * qi / (QUARTERS.length - 1) ? 'B' : 'A'),
    mult: (h) => (h === 'B' ? 1.8 : 1),
  });
  const naive = buildRepeatSaleIndex(toLots(sales), keyOf, { now: NOW, minHousePairs: 0, huberPasses: 0 });
  const fixed = buildRepeatSaleIndex(toLots(sales), keyOf, { now: NOW });
  const n3 = naive.horizons['3Y'], f3 = fixed.horizons['3Y'];
  assert.ok(n3.publishable && n3.changePct! > 8, `naive fit reads the house shift as a rise (${n3.changePct})`);
  assert.ok(Math.abs(f3.changePct ?? 0) < 4, `house FE removes it (${f3.changePct}, ${f3.reason})`);
  assert.match(fixed.note, /house fixed effects 1 vs [AB]/);
});

test('Huber: a cluster of x8 mis-variant resales in the end quarter does not move the index', () => {
  const sales = market(2, 1200, {
    mult: (_h, qi, u) => (qi === QUARTERS.length - 1 && u < 0.12 ? 8 : 1),
  });
  const ols = buildRepeatSaleIndex(toLots(sales), keyOf, { now: NOW, huberPasses: 0 });
  const hub = buildRepeatSaleIndex(toLots(sales), keyOf, { now: NOW });
  assert.ok((ols.horizons['1Y'].changePct ?? 0) > 15, `least squares chases the outliers (${ols.horizons['1Y'].changePct})`);
  const h1 = hub.horizons['1Y'].changePct ?? 0;
  assert.ok(Math.abs(h1) < 8, `Huber holds (${h1})`);
  // the CI is a real interval around the robust point
  if (hub.horizons['1Y'].publishable) assert.ok(hub.horizons['1Y'].ciLoPct! < h1 && h1 < hub.horizons['1Y'].ciHiPct!);
});

test('volume check: a thin last quarter (< 60% of its trailing-4 median) is not the endpoint', () => {
  // +2%/quarter market; the final quarter trades at ~20% of normal volume and prints +60% on top
  const sales = market(3, 4000, {
    quarterWeight: (qi) => (qi === QUARTERS.length - 1 ? 0.2 : 1),
    mult: (_h, qi) => Math.exp(0.02 * qi) * (qi === QUARTERS.length - 1 ? 1.6 : 1),
  });
  const r = buildRepeatSaleIndex(toLots(sales), keyOf, { now: NOW });
  const h = r.horizons['1Y'];
  // ends on 2025-Q3 (true 1Y = e^0.08−1 ≈ +8.3%) — never on the thin, marked-up 2025-Q4
  assert.ok(h.publishable && h.changePct! > 4 && h.changePct! < 13, `1Y ends on the dense quarter (${h.changePct} ${h.reason})`);
  // the thin quarter alone clears the pair floors — only the volume rule stops it
  const thinPairs = r.series[r.series.length - 1].nPairs;
  assert.ok(thinPairs >= 40, `thin quarter still has ${thinPairs} pairs`);
  const last = r.series[r.series.length - 1];
  assert.equal(last.period, '2025-Q4', 'the thin quarter still prints in the series');
});

test('house-mix break: one house >40% of one endpoint and <12% of the other abstains', () => {
  // house A sells everything up to 2024, house B everything after
  const sales = market(4, 1500, {
    houseOf: (qi, u) => (qi < 16 ? (u < 0.95 ? 'A' : 'B') : (u < 0.95 ? 'B' : 'A')),
  });
  const r = buildRepeatSaleIndex(toLots(sales), keyOf, { now: NOW });
  assert.equal(r.horizons['3Y'].publishable, false);
  assert.match(r.horizons['3Y'].reason, /house mix breaks/);
});

test('flat market, clean data: every horizon near zero, CI covers zero → abstains on sign', () => {
  const r = buildRepeatSaleIndex(toLots(market(5, 1500)), keyOf, { now: NOW });
  for (const h of ['1Y', '3Y', '5Y']) {
    const z = r.horizons[h];
    assert.ok(!z.publishable, `${h} must not certify a direction on a flat market (${z.changePct} ${z.reason})`);
  }
});
