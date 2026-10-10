import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entityFigures, completeQuarters, quarterOf, dayMinus, MIN_MED_N, type SoldPoint, type Labels } from '../entity/stats';

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
  assert.deepEqual(f.yoy, { pct: 50, n: 10, basis: 'median' });
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
  assert.deepEqual(f.yoy, { pct: 20, n: 25, basis: 'matched' });
});

test('entity stats (P3): too few pairs — a keyed lens abstains; an unkeyed one reads the median only on a stable intake', () => {
  const pairs = (n: number): SoldPoint[] => Array.from({ length: n }, (_, i) => [pt(100, '2025-01-10', undefined, { k: `c${i}` }), pt(130, '2026-01-10', undefined, { k: `c${i}` })]).flat();
  const unique = (n: number, p: number, d: string): SoldPoint[] => Array.from({ length: n }, () => pt(p, d));
  // 19 pairs (< MIN_YOY_PAIRS) on a keyed lens (cards): no pooled-median stand-in
  assert.equal(entityFigures(pairs(19), TODAY, L).yoy, null);
  // unique works, equal intake: the pooled median, labeled
  assert.deepEqual(entityFigures([...unique(19, 100, '2025-01-10'), ...unique(19, 130, '2026-01-10')], TODAY, L).yoy, { pct: 30, n: 19, basis: 'median' });
  // the same, but the current year sold 2× as many: no read
  assert.equal(entityFigures([...unique(19, 100, '2025-01-10'), ...unique(38, 130, '2026-01-10')], TODAY, L).yoy, null);
  // 20 pairs: matched, whatever the intake did
  assert.deepEqual(entityFigures([...pairs(20), ...unique(60, 5, '2026-02-10')], TODAY, L).yoy, { pct: 30, n: 20, basis: 'matched' });
});

test('entity stats: results are ordered (top by price, recent by date) and houses by count', () => {
  const rows = [pt(5, '2024-06-01', undefined, { h: 'A' }), pt(50, '2026-10-01', undefined, { h: 'B' }), pt(500, '2025-01-01', undefined, { h: 'B' })];
  const f = entityFigures(rows, TODAY, L);
  assert.deepEqual(f.top.map(r => r.p), [500, 50, 5]);
  assert.deepEqual(f.recent.map(r => r.d), ['2026-10-01', '2025-01-01', '2024-06-01']);
  assert.deepEqual(f.houses, [{ h: 'B', n: 2 }, { h: 'A', n: 1 }]);
});
