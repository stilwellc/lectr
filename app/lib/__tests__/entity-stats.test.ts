import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entityFigures, completeQuarters, quarterOf, dayMinus, medianRankLo, yoyOf, MIN_MED_N, type SoldPoint, type Labels } from '../entity/stats';

const TODAY = '2026-10-09';
const L: Labels = { lens: k => k.split(':')[1], coarse: k => k };
let n = 0;
const pt = (p: number, d: string, lens = 'fine-art:prints', extra: Partial<SoldPoint> = {}): SoldPoint =>
  ({ p, d, h: 'Christie\'s', lens, coarse: lens, id: `x${n++}`, t: `lot ${n}`, img: null, ...extra });

test('entity stats: quarters are calendar quarters of the date string; only complete ones', () => {
  assert.equal(quarterOf('2026-03-31'), '2026-Q1');
  assert.equal(quarterOf('2026-04-01'), '2026-Q2');
  // Oct 9 is in Q4: the last complete quarter is Q3
  assert.deepEqual(completeQuarters(TODAY, 5), ['2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3']);
  assert.deepEqual(completeQuarters('2026-01-02', 2), ['2025-Q3', '2025-Q4']);
  assert.equal(dayMinus(TODAY, 365), '2025-10-09');
});

test('entity stats: the 12-month window is calendar time, the median is n-gated', () => {
  const rows = [pt(100, '2025-10-09'), pt(200, '2025-10-10'), pt(300, '2026-10-09'), pt(400, '2026-10-10')];
  const f = entityFigures(rows, TODAY, L);
  // 2025-10-09 is outside (now − 365d, now]; the future row never counts
  assert.equal(f.sold, 3);
  assert.equal(f.sold12m, 2);
  assert.equal(f.med12m, null, 'n=2 < MIN_MED_N prints no median');
  assert.equal(f.med12mN, 2);
  const many = Array.from({ length: MIN_MED_N }, (_, i) => pt(1000 + i * 10, '2026-06-01'));
  const g = entityFigures(many, TODAY, L);
  assert.equal(g.med12m, 1020);
  assert.equal(g.med12mN, MIN_MED_N);
});

test('entity stats: the median reads ONE lens (the dominant one) and names it; sold + record read all', () => {
  const rows = [
    ...Array.from({ length: 8 }, () => pt(25_000, '2026-05-01', 'fine-art:prints')),
    ...Array.from({ length: 5 }, () => pt(180_000, '2026-05-01', 'fine-art:unique')),
    pt(195_000_000, '2022-05-08', 'fine-art:unique', { t: 'Shot Sage Blue Marilyn', id: 'rec', img: 'https://x/y.jpg' }),
  ];
  const f = entityFigures(rows, TODAY, L);
  assert.equal(f.medLens, 'fine-art:prints');
  assert.equal(f.medScope, 'prints');
  assert.equal(f.med12m, 25_000);
  assert.equal(f.med12mN, 8);
  assert.equal(f.sold, 14);
  assert.deepEqual(f.record, { p: 195_000_000, d: '2022-05-08', t: 'Shot Sage Blue Marilyn', h: 'Christie\'s', id: 'rec', img: 'https://x/y.jpg' });
  // the lens ledger covers both, each with its own n and 12-month median
  assert.deepEqual(f.cats.map(c => [c.key, c.n, c.med12m, c.med12mN]), [['fine-art:prints', 8, 25_000, 8], ['fine-art:unique', 6, 180_000, 5]]);
  assert.equal(f.lensSplit?.length, 2);
  assert.equal(f.lensSplit?.find(x => x.key === 'fine-art:unique')?.n12, 5);
});

test('entity stats: spark = complete quarters only, thin quarters null, never the quarter in progress', () => {
  const rows: SoldPoint[] = [];
  // 3 sales in each of the last 12 complete quarters except one thin quarter
  for (const q of completeQuarters(TODAY, 12)) {
    const [y, qq] = q.split('-Q');
    const d = `${y}-${String((Number(qq) - 1) * 3 + 2).padStart(2, '0')}-15`;
    const k = q === '2025-Q2' ? 2 : 3;
    for (let i = 0; i < k; i++) rows.push(pt(100 * (i + 1), d));
  }
  // the quarter in progress has sales — they must not draw
  for (let i = 0; i < 10; i++) rows.push(pt(9999, '2026-10-02'));
  const f = entityFigures(rows, TODAY, L);
  assert.equal(f.spark?.length, 12);
  assert.equal(f.sparkQ[11], '2026-Q3');
  const thin = f.sparkQ.indexOf('2025-Q2');
  assert.equal(f.spark?.[thin], null);
  assert.equal(f.sparkN?.[thin], 2);
  assert.ok(f.spark!.every(v => v === null || v === 200));
  assert.ok(!f.quarters.some(q => q.q === '2026-Q4'), 'detail history drops the partial quarter too');
  assert.equal(f.yearly.find(y => y.y === 2026)?.partial, true);
});

test('entity stats: a spark needs ≥4 drawn quarters, yoy needs ≥10 on both sides', () => {
  const sparse = [pt(100, '2026-08-01'), pt(100, '2026-08-02'), pt(100, '2026-08-03')];
  assert.equal(entityFigures(sparse, TODAY, L).spark, null);
  const rows: SoldPoint[] = [];
  for (let i = 0; i < 10; i++) rows.push(pt(100, '2024-12-01'));  // 2024-Q4 (prev side)
  for (let i = 0; i < 10; i++) rows.push(pt(150, '2026-02-01'));  // 2026-Q1 (cur side)
  const f = entityFigures(rows, TODAY, L);
  assert.deepEqual(f.yoy, { pct: 50, n: 10, basis: 'median', lo: 50, hi: 50 });
  const g = entityFigures(rows.slice(1), TODAY, L);
  assert.equal(g.yoy, null, 'a 9-sale side prints no yoy');
});

test('entity stats (P3): yoy is like for like — a crawl that adds cheap items moves no price', () => {
  // 25 identities, each up exactly 20% year on year; the current year ALSO
  // crawled 4× as many sales, mostly of a cheap identity never seen before
  const rows: SoldPoint[] = [];
  for (let i = 0; i < 25; i++) {
    const base = 1000 + i * 400;
    rows.push(pt(base, '2025-02-01', undefined, { k: `card${i}` }));
    rows.push(pt(base * 1.2, '2026-02-01', undefined, { k: `card${i}` }));
  }
  for (let i = 0; i < 75; i++) rows.push(pt(50, '2026-03-01', undefined, { k: `new${i % 3}` }));
  const f = entityFigures(rows, TODAY, L);
  // the pooled median would read −98%; the matched read is the real +20%
  assert.deepEqual(f.yoy, { pct: 20, n: 25, basis: 'matched', lo: 20, hi: 20 });
});

test('entity stats (P3): too few pairs — a keyed lens abstains; an unkeyed one reads the median only on a stable intake', () => {
  const pairs = (n: number): SoldPoint[] => Array.from({ length: n }, (_, i) => [pt(100, '2025-01-10', undefined, { k: `c${i}` }), pt(130, '2026-01-10', undefined, { k: `c${i}` })]).flat();
  const unique = (n: number, p: number, d: string): SoldPoint[] => Array.from({ length: n }, () => pt(p, d));
  // 4 pairs (< MIN_YOY_PAIRS: no 90% interval exists) on a keyed lens
  // (cards): no pooled-median stand-in
  assert.equal(entityFigures(pairs(4), TODAY, L).yoy, null);
  // (R7) 5 pairs that agree: a matched read, its interval printed
  assert.deepEqual(entityFigures(pairs(5), TODAY, L).yoy, { pct: 30, n: 5, basis: 'matched', lo: 30, hi: 30 });
  // unique works, equal intake: the pooled median, labeled
  assert.deepEqual(entityFigures([...unique(19, 100, '2025-01-10'), ...unique(19, 130, '2026-01-10')], TODAY, L).yoy, { pct: 30, n: 19, basis: 'median', lo: 30, hi: 30 });
  // the same, but the current year sold 2× as many: no read
  assert.equal(entityFigures([...unique(19, 100, '2025-01-10'), ...unique(38, 130, '2026-01-10')], TODAY, L).yoy, null);
  // 20 pairs: matched, whatever the intake did
  assert.deepEqual(entityFigures([...pairs(20), ...unique(60, 5, '2026-02-10')], TODAY, L).yoy, { pct: 30, n: 20, basis: 'matched', lo: 30, hi: 30 });
});

test('entity stats (R7): the median interval is distribution-free — exact binomial ranks', () => {
  // n = 5: [min, max] holds the median with 93.75% (≥ 90%); n < 5 has no 90% interval
  assert.equal(medianRankLo(4), 0);
  assert.equal(medianRankLo(5), 1);
  // n = 20: P(Bin(20,½) ≤ 5) = 2.07% ≤ 5%, ≤ 6 = 5.77% > 5% → rank 6
  assert.equal(medianRankLo(20), 6);
  // the 98% level used for a wide pooled-median move is stricter
  assert.ok(medianRankLo(20, 0.98) < medianRankLo(20));
  // large n: the normal approximation, continuous with the exact ranks
  assert.ok(Math.abs(medianRankLo(61) - medianRankLo(60)) <= 1);
});

test('entity stats (R7): a yoy prints only when it means something — bounded, or a clear move', () => {
  const D0 = '2025-01-10', D1 = '2026-01-10';
  // matched pairs with the given this-year/last-year ratios
  const ratios = (rs: number[]): SoldPoint[] => rs.flatMap((r, i) => [pt(1000, D0, undefined, { k: `c${i}` }), pt(1000 * r, D1, undefined, { k: `c${i}` })]);
  // tight around flat: printed, its interval straddling 0
  const flat = yoyOf(ratios([0.95, 0.98, 1, 1.01, 1.03, 1.05, 0.97, 1.02]), TODAY)!;
  assert.equal(flat.basis, 'matched');
  assert.ok(flat.lo < 0 && flat.hi > 0 && flat.hi - flat.lo < 20);
  // wide but every identity rose: a clear move, printed with its wide interval
  const up = yoyOf(ratios([1.1, 1.4, 2, 3, 5, 1.2, 2.5]), TODAY)!;
  assert.ok(up.lo > 0 && up.hi > 100, JSON.stringify(up));
  // wide and both ways: noise — no read
  assert.equal(yoyOf(ratios([0.3, 0.5, 0.8, 1, 1.3, 2, 3.5, 0.4, 2.6]), TODAY), null);
});

test('entity stats (R7): a pooled median needs a stable intake AND a bounded or clear read', () => {
  const D0 = '2025-01-10', D1 = '2026-01-10';
  const spread = (n: number, mid: number, d: string, w: number) => Array.from({ length: n }, (_, i) => pt(mid * Math.exp(w * (i / (n - 1) - 0.5)), d));
  // 40 a side, tight spread, +10%: printed
  const ok = yoyOf([...spread(40, 1000, D0, 0.6), ...spread(40, 1100, D1, 0.6)], TODAY)!;
  assert.equal(ok.basis, 'median');
  assert.ok(Math.abs(ok.pct - 10) < 1 && ok.lo < 10 && ok.hi > 10);
  // 12 a side over a 50× price range, +20%: the interval spans far past ±30
  // log points either side of 0 — no read
  assert.equal(yoyOf([...spread(12, 1000, D0, 4), ...spread(12, 1200, D1, 4)], TODAY), null);
});

test('entity stats: results are ordered (top by price, recent by date) and houses by count', () => {
  const rows = [pt(5, '2024-06-01', undefined, { h: 'A' }), pt(50, '2026-10-01', undefined, { h: 'B' }), pt(500, '2025-01-01', undefined, { h: 'B' })];
  const f = entityFigures(rows, TODAY, L);
  assert.deepEqual(f.top.map(r => r.p), [500, 50, 5]);
  assert.deepEqual(f.recent.map(r => r.d), ['2026-10-01', '2025-01-01', '2024-06-01']);
  assert.deepEqual(f.houses, [{ h: 'B', n: 2 }, { h: 'A', n: 1 }]);
});
