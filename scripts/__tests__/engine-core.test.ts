/**
 * Value engine core (app/lib/value.ts + app/lib/comps.ts) — fixture tests.
 *
 * Hand-built lots only (no corpus): the quantile contract, the point-in-time
 * date semantics (datePrecision month/year → known only after the period
 * ends), the comp-exclusion stamp, the form/part/count shape gate, and the
 * published value + band on a tiny deterministic pool. No calibration or time
 * index is loaded (setCalibration/setTimeIndex are reset around each test), so
 * every figure below is the uncalibrated engine and is computed by hand.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AuctionLot } from '../../app/types';
import {
  quantile, knownKey, UNKNOWN_KEY, quarterKey, timeFactor, resolveComps, estimateValueEx,
  blendPredict, vsBidRead, setCalibration, setTimeIndex, type Comp, type TimeIndex, type EngineCalibration,
} from '../../app/lib/value';
import {
  lotShapeOf, shapesCompatible, sameShape, plateOfWhole, isCompExcluded, comparableTo, estUsdBand,
  coarseWatchMaterial, normalizeTitle,
} from '../../app/lib/comps';
import { buildIdf, buildVectors, similarity, type Match } from '../../app/lib/similarity';
import { titleTokens } from '../../app/lib/normalize';
import { houseAllInFactor, houseAllInFactorAt, lotAllInFactor } from '../../app/lib/premiums';

afterEach(() => { setCalibration(null); setTimeIndex(null); });

type R = Record<string, unknown>;
const print = (id: string, title: string, o: R = {}): AuctionLot & { _v?: Record<string, number> } => ({
  id, title, artist: 'andy-warhol', category: 'print', auctionHouse: "Christie's", status: 'sold',
  saleDate: '2025-06-01', realizedUsd: 100000, titleTokens: titleTokens(title), ...o,
}) as unknown as AuctionLot;
const MARILYN = 'Marilyn Monroe (Marilyn) screenprint in colors 1967';

// ── quantile ────────────────────────────────────────────────────────────────
test('quantile: type-7 linear interpolation on a sorted array; 0 (not NaN) on empty for legacy callers', () => {
  const s = [10, 20, 30, 40];
  assert.equal(quantile(s, 0), 10);
  assert.equal(quantile(s, 1), 40);
  assert.equal(quantile(s, 0.5), 25);
  assert.equal(quantile(s, 0.25), 17.5);
  assert.equal(quantile(s, 0.75), 32.5);
  assert.equal(quantile(s, 0.15), 14.5);
  assert.equal(quantile([7], 0.85), 7);
  assert.equal(quantile(s, -1), 10, 'q clamped to [0,1]');
  assert.equal(quantile(s, 2), 40, 'q clamped to [0,1]');
  assert.equal(quantile([], 0.5), 0);
});

// ── point-in-time date semantics ────────────────────────────────────────────
test('knownKey: day precision is the day; month/year precision sorts after the whole period; unknown never known', () => {
  assert.equal(knownKey({ saleDate: '2026-09-15' }), '2026-09-15');
  assert.equal(knownKey({ saleDate: '2026-09-15T20:00:00Z', datePrecision: 'day' }), '2026-09-15');
  assert.equal(knownKey({ saleDate: '2026-09-15', datePrecision: 'month' }), '2026-09-32');
  assert.equal(knownKey({ saleDate: '2026-06-01', datePrecision: 'year' }), '2026-13');
  assert.equal(knownKey({ saleDate: '2026-06-01', datePrecision: 'unknown' }), UNKNOWN_KEY);
  assert.equal(knownKey({ saleDate: '' }), UNKNOWN_KEY);
  assert.equal(knownKey({ saleDate: null }), UNKNOWN_KEY);
  // ordering: a month-dated September sale is known on Oct 1, not on Sep 30
  assert.ok(knownKey({ saleDate: '2026-09-15', datePrecision: 'month' }) > '2026-09-30');
  assert.ok(knownKey({ saleDate: '2026-09-15', datePrecision: 'month' }) < '2026-10-01');
  assert.ok(knownKey({ saleDate: '2026-06-01', datePrecision: 'year' }) > '2026-12-31');
  assert.ok(knownKey({ saleDate: '2026-06-01', datePrecision: 'year' }) < '2027-01-01');
});

test('quarterKey + timeFactor: carries a comp to the index asOf, clamped to [0.5, 2]; no index → 1', () => {
  assert.equal(quarterKey('2024-08-10'), '2024Q3');
  assert.equal(quarterKey('2024-01-01'), '2024Q1');
  assert.equal(quarterKey(''), '');
  const ti: TimeIndex = {
    asOf: '2026-07-01', marketBySlug: { 'andy-warhol': 'art' },
    levels: { art: { '2024Q1': 100, '2024Q3': 110, '2025Q2': 50, '2026Q2': 130 } },
    lastQ: { art: '2026Q2' },
  };
  assert.equal(timeFactor('art', '2024-02-10', null), 1, 'no index loaded');
  assert.equal(timeFactor(null, '2024-02-10', ti), 1, 'no market');
  assert.equal(timeFactor('art', '2024-02-10', ti), 1.3);
  assert.equal(timeFactor('art', '2024-08-10', ti), 130 / 110);
  assert.equal(timeFactor('art', '2024-05-10', ti), 1.3, 'gap quarter → nearest EARLIER level (2024Q1)');
  assert.equal(timeFactor('art', '2025-05-10', ti), 2, '130/50 = 2.6 clamps to 2');
  assert.equal(timeFactor('art', '2026-05-10', ti), 1, 'the asOf quarter itself carries no adjustment');
  assert.equal(timeFactor('watches', '2024-02-10', ti), 1, 'market without levels');
});

// ── compExclude + the shape gate ────────────────────────────────────────────
test('isCompExcluded: any non-empty compExclude code excludes', () => {
  assert.equal(isCompExcluded({}), false);
  assert.equal(isCompExcluded({ compExclude: null }), false);
  assert.equal(isCompExcluded({ compExclude: '' }), false);
  assert.equal(isCompExcluded({ compExclude: 'price<10' }), true);
  assert.equal(isCompExcluded({ compExclude: 'stale-upcoming' }), true);
});

test('lotShapeOf: count / part / original axes read off the title', () => {
  assert.deepEqual(lotShapeOf('Rolex Daytona 116500LN stainless steel'), { count: 1, part: false, original: null });
  assert.equal(lotShapeOf('Audemars Piguet Royal Oak länkbit').part, true, 'Scandinavian link piece');
  assert.equal(lotShapeOf('Two spare bracelet links for Rolex Submariner').part, true);
  assert.equal(lotShapeOf('Rolex empty presentation box').part, true);
  assert.equal(lotShapeOf('Rolex Submariner with Oyster bracelet').part, false, 'a watch ON a bracelet is whole');
  assert.equal(lotShapeOf('Pair of Eames LCW chairs').count, 2);
  assert.equal(lotShapeOf('Six Conoid Chairs').count, 6);
  assert.equal(lotShapeOf('Three Musketeers poster').count, 1, 'a title, not a count');
  assert.equal(lotShapeOf('1952 Topps Mickey Mantle').count, 1, 'a leading digit is a year');
  assert.equal(lotShapeOf('Collection of 40 baseball cards').count, 40);
  assert.equal(lotShapeOf('Large collection of vintage baseball cards').count, 0, 'unstated multiple');
  assert.equal(lotShapeOf('American black walnut side chairs (6)').count, 6, 'catalogue quantity suffix');
  assert.equal(lotShapeOf('1952 Topps complete set').count, 0);
  assert.equal(lotShapeOf('Amazing Spider-Man #300 original cover art').original, 'original');
  assert.equal(lotShapeOf('Amazing Spider-Man #300 CGC 9.8').original, 'printed');
});

test('shapesCompatible: part never comps whole; single never comps multiple; stated counts must agree; original ≠ printed', () => {
  const S = (t: string) => lotShapeOf(t);
  assert.equal(shapesCompatible(S('Audemars Piguet Royal Oak 15202ST'), S('Audemars Piguet Royal Oak länkbit')), false);
  assert.equal(shapesCompatible(S('Eames LCW chair'), S('Pair of Eames LCW chairs')), false);
  assert.equal(shapesCompatible(S('Pair of Eames LCW chairs'), S('Four Eames LCW chairs')), false);
  assert.equal(shapesCompatible(S('Pair of Eames LCW chairs'), S('Eames LCW chairs (2)')), true);
  assert.equal(shapesCompatible(S('Eames LCW chair'), S('Pair of Eames LCW chairs'), { ignoreCount: true }), true);
  assert.equal(shapesCompatible(S('Spider-Man #1 original comic art page'), S('Spider-Man #1 CGC 9.8 comic book')), false);
  assert.equal(shapesCompatible(S('Spider-Man #1 original comic art page'), S('Spider-Man #1 splash page')), true);
  assert.equal(shapesCompatible(S('Warhol Marilyn'), S('Warhol Marilyn')), true);
});

test('plateOfWhole / sameShape: a plate "…, from <Series>" never comps the whole portfolio', () => {
  const plate = 'Sam, from 25 Cats Name(d) Sam and One Blue Pussy';
  const book = '25 Cats Name(d) Sam and One Blue Pussy';
  assert.equal(plateOfWhole(plate, book), true);
  assert.equal(plateOfWhole(book, plate), true, 'either direction');
  assert.equal(plateOfWhole(plate, 'Blue Pussy, from 25 Cats Name(d) Sam and One Blue Pussy'), false, 'two plates of the same book');
  assert.equal(sameShape({ title: plate }, { title: book }), false);
  assert.equal(sameShape({ title: plate }, { title: plate }), true);
  assert.equal(normalizeTitle('“Sam”, from 25 Cats (1954)'), 'sam from 25 cats');
});

test('comparableTo: watches bifurcate by reference and (strict) material; unknown form never comps', () => {
  const w = (id: string, title: string, reference: string | null) =>
    ({ id, title, formKey: 'wristwatch', reference, category: 'object' }) as unknown as AuctionLot;
  const gate = comparableTo(w('a', 'Rolex Daytona 116500LN stainless steel', '116500LN'));
  assert.equal(gate(w('b', 'Rolex Daytona 116500LN steel white dial', '116500LN')), true);
  assert.equal(gate(w('c', 'Rolex Daytona 116505 18k rose gold', '116505')), false, 'different reference');
  assert.equal(gate(w('d', 'Rolex Daytona 116500LN two-tone', '116500LN')), false, 'material conflict');
  assert.equal(gate(w('e', 'Rolex Daytona 116500LN', '116500LN')), false, 'unparsed material is a loose comp → excluded');
  assert.equal(gate({ ...w('f', 'Rolex Daytona 116500LN steel', '116500LN'), formKey: 'jewelry' } as AuctionLot), false, 'form mismatch');
  const unk = comparableTo({ id: 'u', title: 'Thing', formKey: 'unknown', category: 'object' } as unknown as AuctionLot);
  assert.equal(unk(w('b', 'x', null)), false);
  assert.equal(coarseWatchMaterial({ title: 'Rolex Datejust 18k and steel', medium: null }), 'two-tone');
  assert.equal(coarseWatchMaterial({ title: 'Patek Philippe 5711 platinum', medium: null }), 'platinum');
});

test('estUsdBand: USD fields win, legacy fields fall back, a single posted bound fills both', () => {
  assert.deepEqual(estUsdBand({ estLowUsd: 100, estHighUsd: 200, estimateLow: 1, estimateHigh: 2 } as unknown as AuctionLot), { low: 100, high: 200 });
  assert.deepEqual(estUsdBand({ estimateLow: 500, estimateHigh: null } as unknown as AuctionLot), { low: 500, high: 500 });
  assert.deepEqual(estUsdBand({ estLowUsd: null, estHighUsd: null, estimateLow: null, estimateHigh: null } as unknown as AuctionLot), { low: null, high: null });
});

// ── resolveComps: point-in-time + exclusion + shape on a real idf pool ─────
function marilynPool() {
  const lot = print('lot', MARILYN, { status: 'upcoming', saleDate: '2026-10-01', realizedUsd: null, estLowUsd: 80000, estHighUsd: 120000 });
  const cands = [
    print('c1', MARILYN, { realizedUsd: 150000, saleDate: '2025-05-10' }),
    print('c2', MARILYN, { realizedUsd: 160000, saleDate: '2025-03-10' }),
    print('c3', MARILYN, { realizedUsd: 170000, saleDate: '2024-11-10' }),
    print('c4', MARILYN + ',', { realizedUsd: 180000, saleDate: '2024-06-10' }),
    // month-dated September sale: unknown until Oct 1
    print('m1', MARILYN, { realizedUsd: 140000, saleDate: '2026-09-15', datePrecision: 'month' }),
    // year-dated 2026 sale: unknown until 2027
    print('y1', MARILYN, { realizedUsd: 145000, saleDate: '2026-06-01', datePrecision: 'year' }),
    // junk price, stamped by normalize
    print('x1', MARILYN, { realizedUsd: 1, saleDate: '2024-01-10', compExclude: 'price<10' }),
    // a set of two — same words, different shape
    // (the stamped titleTokens are the lot's own, so ONLY the shape gate —
    // not the similarity score — can keep it out)
    print('s2', `${MARILYN} (2)`, { realizedUsd: 300000, saleDate: '2024-01-10', titleTokens: titleTokens(MARILYN) }),
    // not sold / no price
    print('u1', MARILYN, { status: 'bought_in', realizedUsd: null, saleDate: '2024-02-10' }),
    // unrelated object
    print('z1', 'Campbell Soup I tomato screenprint 1968', { realizedUsd: 30000, saleDate: '2024-01-10' }),
  ];
  const all = [lot, ...cands];
  const tbl = buildIdf(all);
  buildVectors(all, tbl);
  return { lot, cands, tbl };
}

test('resolveComps: a comp is admitted only once KNOWN before the cut (month/year precision), never excluded, never a different shape', () => {
  const { lot, cands, tbl } = marilynPool();
  const ids = (priorTo?: string) => resolveComps(lot, cands, tbl, priorTo).map(c => c.id).sort();
  assert.deepEqual(ids('2026-09-20'), ['c1', 'c2', 'c3', 'c4']);
  assert.deepEqual(ids('2026-09-30'), ['c1', 'c2', 'c3', 'c4'], 'month-dated Sep sale still unknown on Sep 30');
  assert.deepEqual(ids('2026-10-01'), ['c1', 'c2', 'c3', 'c4', 'm1']);
  assert.deepEqual(ids('2026-12-31'), ['c1', 'c2', 'c3', 'c4', 'm1']);
  assert.deepEqual(ids('2027-01-01'), ['c1', 'c2', 'c3', 'c4', 'm1', 'y1']);
  assert.deepEqual(ids('2025-01-01'), ['c3', 'c4'], 'day-precision cut is strict (<)');
  assert.deepEqual(ids(), ['c1', 'c2', 'c3', 'c4', 'm1', 'y1'], 'no cut: everything sold + priced + comparable');
  // s2 / x1 are word-for-word the lot — the SHAPE gate and the exclusion stamp
  // (not the title cosine) are what keep them out
  const s2 = cands.find(c => c.id === 's2')!, x1 = cands.find(c => c.id === 'x1')!;
  assert.ok(similarity(lot, s2, tbl).score >= 65, "s2 clears the strict similarity gate on its own");
  assert.ok(similarity(lot, x1, tbl).cosine >= 0.9);
  assert.deepEqual(lotShapeOf(s2.title), { count: 2, part: false, original: null });
  // the lot never comps itself
  assert.ok(!resolveComps(lot, [lot, ...cands], tbl).some(c => c.id === 'lot'));
});

// ── estimateValueEx on that pool (uncalibrated) ─────────────────────────────
test('estimateValueEx: estimate lot → directional signal + house×premium blend + pool band (uncalibrated, by hand)', () => {
  const { lot, cands, tbl } = marilynPool();
  const comps = resolveComps(lot, cands, tbl, '2026-09-20');
  const { value, abstain } = estimateValueEx(lot, comps, tbl);
  assert.equal(abstain, null);
  assert.ok(value);
  assert.deepEqual(value.poolIds, ['c1', 'c2', 'c3', 'c4']);
  assert.equal(value.n, 4);
  assert.equal(value.tier, 'main');
  // weighted median (cos² × recency, halflife 2y on estimate lots) lands on 160k
  assert.equal(value.compMedianUsd, 160000);
  assert.equal(value.compAdjUsd, 160000, 'no time index → adj = raw');
  assert.equal(value.compRatio, 1.6);
  assert.deepEqual(value.signal, { label: 'below comparable market', strength: 'moderate', beatRatePct: 64 });
  // n=4, bestCos 1, disp = q3/q1 = 172.5k/157.5k ≤ 2.5 → medium (n<6 blocks high)
  assert.equal(value.confidence, 'medium');
  // uncalibrated blend: mid × premium × (ratio / premium)^w, w(medium) = .25
  // — the premium IN FORCE on the lot's sale date (Oct 5 2026: the dated
  // schedule; Christie's 2026 bands, not the undated flat 1.26)
  const pm = lotAllInFactor(lot, 100000);
  assert.equal(pm, houseAllInFactorAt("Christie's", 100000, lot.saleDate));
  assert.notEqual(pm, houseAllInFactor("Christie's", 100000));
  const pred = 100000 * pm * Math.pow(1.6 / pm, 0.25);
  assert.equal(value.compValueUsd, Math.round(pred));
  assert.equal(value.blendW, 0.25);
  // band: the pool's own 15/85 lerp quantiles, rescaled to the prediction
  const vals = [150000, 160000, 170000, 180000];
  const scale = pred / 160000;
  assert.equal(value.low, Math.round(quantile(vals, 0.15) * scale));
  assert.equal(value.high, Math.round(quantile(vals, 0.85) * scale));
  assert.ok(value.low <= value.compValueUsd && value.compValueUsd <= value.high);
  assert.equal(value.estimateUsd, null, 'estimate lots publish no absolute estimate');
  assert.deepEqual(value.exact, { id: 'c1', realizedUsd: 150000, saleDate: '2025-05-10', cls: 'modelMatch' });
});

const M = (cosine: number, cls: Match['cls'] = 'similar', idExact = false): Match =>
  ({ score: Math.round(cosine * 100), cosine, cls, reasons: [], idExact });
const C = (id: string, usd: number, m: Match, saleDate = '2025-01-01'): Comp => ({ id, match: m, realizedUsd: usd, saleDate });

test('estimateValueEx: abstains with a stable reason code (no-candidates, pool<3)', () => {
  const tbl = buildIdf([]);
  const lot = print('lot', MARILYN, { status: 'upcoming', saleDate: '2026-01-01' });
  assert.deepEqual(estimateValueEx(lot, [], tbl), { value: null, abstain: 'no-candidates' });
  assert.deepEqual(estimateValueEx(lot, [C('a', 100, M(0.9)), C('b', 110, M(0.9))], tbl), { value: null, abstain: 'pool<3' });
  // a zero-priced comp is not a comp
  assert.deepEqual(estimateValueEx(lot, [C('a', 100, M(0.9)), C('b', 110, M(0.9)), C('c', 0, M(0.9))], tbl).abstain, 'pool<3');
});

test('estimateValueEx: no-estimate lot → absolute value + premium-grossed vsBid; relaxed-gate pool is capped at medium', () => {
  const tbl = buildIdf([]);
  const lot = print('lot', 'Game-used bat', { status: 'upcoming', saleDate: '2026-01-01', currentBid: 500, auctionHouse: 'Goldin', artist: 'game-used', category: 'object' });
  // strict gate (cos ≥ .50 & score ≥ 65) seats only 2 → falls back to the relaxed 0.45/55 tier
  const comps = [C('a', 1000, M(0.9)), C('b', 1000, M(0.9)), C('c', 1000, M(0.6)), C('d', 1000, M(0.47))];
  const { value } = estimateValueEx(lot, comps.map(c => (c.id === 'c' ? { ...c, match: { ...c.match, score: 60 } } : c)), tbl);
  assert.ok(value);
  assert.equal(value.tier, 'fallback');
  assert.equal(value.estimateUsd, 1000);
  assert.equal(value.compValueUsd, 1000);
  assert.equal(value.signal, null);
  assert.equal(value.compRatio, null);
  // bid 500 × Goldin 1.22 = 610 all-in vs 1000 → -39% → below
  assert.deepEqual(value.vsBid, { label: 'below recent comps', pct: -39 });
  assert.notEqual(value.confidence, 'high');
});

test('vsBidRead: the live hammer is grossed through the house premium before the ±12% read', () => {
  assert.deepEqual(vsBidRead({ auctionHouse: 'REA' }, 1000, 1175), { label: 'in line', pct: 0 });
  assert.deepEqual(vsBidRead({ auctionHouse: 'REA' }, 1000, 1000), { label: 'above recent comps', pct: 18 });
  assert.deepEqual(vsBidRead({ auctionHouse: 'REA', buyerPremiumPct: 25 }, 1000, 1500), { label: 'below recent comps', pct: -17 });
});

test('blendPredict: calibrated intercept chain house×market → market → global; uncalibrated falls back to house × premium', () => {
  const cal: EngineCalibration = {
    edges: [], beatRate: {}, band: {},
    marketBySlug: { 'andy-warhol': 'art' },
    blend: { a: { "art|Christie's:b": 0.2, 'art:b': 0.1, 'global:b': 0 }, w: { high: 0.5 } },
  };
  const lot = { artist: 'andy-warhol', auctionHouse: "Christie's" };
  const r1 = blendPredict(lot, 100, 'b', 200, 'high', cal);
  assert.equal(r1.w, 0.5);
  assert.ok(Math.abs(r1.value - 100 * Math.exp(0.2 + 0.5 * Math.log(2))) < 1e-9);
  const r2 = blendPredict({ ...lot, auctionHouse: 'Phillips' }, 100, 'b', 200, 'high', cal);
  assert.ok(Math.abs(r2.value - 100 * Math.exp(0.1 + 0.5 * Math.log(2))) < 1e-9, 'market intercept');
  const r3 = blendPredict({ artist: 'kaws', auctionHouse: 'Phillips' }, 100, 'b', 200, 'high', cal);
  assert.ok(Math.abs(r3.value - 100 * Math.exp(0 + 0.5 * Math.log(2))) < 1e-9, 'global intercept');
  const r4 = blendPredict({ artist: 'kaws', auctionHouse: 'Wright' }, 100, 'b', 100, 'low', null);
  assert.equal(r4.w, 0.05);
  assert.ok(Math.abs(r4.value - 100 * 1.25 * Math.pow(1 / 1.25, 0.05)) < 1e-9);
});
