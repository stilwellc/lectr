/**
 * W32 (Oct 11 2026) — THE ESTIMATE CARRIED THROUGH TIME (EngineFlags.estCarry).
 * Measured on repeat-sale pairs and NOT adopted (docs/ENGINE_LANES.md §24):
 * ENGINE_FLAGS_CURRENT stays W24. These tests pin the seam so a later wave
 * can re-measure it without re-deriving it:
 *   - estimateCarryOf: current / ok / thin / none, the n-gate, the fallback
 *   - the engine on a REAL repeat pair (Rolex Explorer ref. 1016 — the
 *     Sotheby's Dec 2024 sale valued as of its Sept 2026 resale): the carry
 *     moves the anchor, the comps are untouched, the live lot is byte-identical
 *   - the served engine (W24) never carries; a settled stamp keeps the record
 *   - the time index carries each level's n
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateCarryOf, EST_CARRY, setEngineFlags, setCalibration, setTimeIndex, setHouseBias, resolveComps, estimateValueEx,
  ENGINE_FLAGS_CURRENT, ENGINE_FLAGS_W24, ENGINE_FLAGS_W32, timeFactor, type TimeIndex, type ValueResult,
} from '../../app/lib/value';
import { makeTimeIndexer } from '../../app/lib/indices';
import { buildIdf, buildVectors } from '../../app/lib/similarity';
import { settledValueOf } from '../lib/settled-appraisal';
import type { AuctionLot } from '../../app/types';

/* ── the rows: Rolex Explorer reference 1016 — real corpus rows (W31's fixture) ── */
// the t2 sale of the pair: Sotheby's, Sep 19 2026, realized $13,926 — never a comp of its own t1 read
const T2 = { id: 'sothebys-2df853ff-5312-4f0a-b9a5-9bad093ad493', artist: 'rolex', title: 'Explorer ‘Gilt OCR Type 6’, Reference 1016 | A stainless steel wristwatch with bracelet, Circa 1966', titleTokens: ['explorer', 'gilt', 'ocr', 'type', '6', 'reference', '1016', 'stainless', 'steel', 'wristwatch', 'bracelet', '1966'], reference: '1016', formKey: 'wristwatch', medium: 'steel wristwatch with bracelet', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2026-09-19', status: 'sold', realizedUsd: 13926.4, priceUsd: 13926.4, priceBasis: 'realized', estLowUsd: 15360, estHighUsd: 30720, currency: 'HKD', yearNum: 1966 };
// a sale between t1 and t2: Bonhams, Sep 18 2025, est. $6,000–8,000, realized $10,880
const BETWEEN = { id: 'bonhams-31170-1062', artist: 'rolex', title: "Explorer 'MK 3', Ref: 1016, c. 1975", titleTokens: ['explorer', 'mk', '3', 'ref', '1016', '1975'], reference: '1016', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: 'Bonhams', saleDate: '2025-09-18', status: 'sold', realizedUsd: 10880, hammerUsd: 8500, priceUsd: 10880, priceBasis: 'realized', buyerPremiumPct: 28, estLowUsd: 6000, estHighUsd: 8000, currency: 'USD', yearNum: 1975 };
// the t1 row: Sotheby's New York, Dec 13 2024, est. $10,000–15,000, realized $10,800
const T1 = { id: 'sothebys-0bbc69ac-9b9f-4983-a721-982219db81cc', artist: 'rolex', title: 'Reference 1016 Explorer | A stainless steel automatic wristwatch with bracelet, Circa 1960', titleTokens: ['reference', '1016', 'explorer', 'stainless', 'steel', 'automatic', 'wristwatch', 'bracelet', '1960'], reference: '1016', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2024-12-13', status: 'sold', realizedUsd: 10800, priceUsd: 10800, priceBasis: 'realized', estLowUsd: 10000, estHighUsd: 15000, currency: 'USD', yearNum: 1960 };
const BEFORE = [
  { id: 'sothebys-b867b6b9-6791-4d87-bc8e-789bd62daebf', artist: 'rolex', title: 'Reference 1016 Explorer | A stainless steel automatic wristwatch with bracelet, Circa 1967', titleTokens: ['reference', '1016', 'explorer', 'stainless', 'steel', 'automatic', 'wristwatch', 'bracelet', '1967'], reference: '1016', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2024-12-13', status: 'sold', realizedUsd: 11400, priceUsd: 11400, priceBasis: 'realized', estLowUsd: 8000, estHighUsd: 12000, currency: 'USD', yearNum: 1967 },
  { id: 'sothebys-ecd8dd22-6933-4850-ac26-de4c10e0ff22', artist: 'rolex', title: 'Reference 1016 Explorer | Retailed by Tiffany & Co.: A stainless steel automatic wristwatch, Circa 1968', titleTokens: ['reference', '1016', 'explorer', 'retailed', 'tiffany', 'co', 'stainless', 'steel', 'automatic', 'wristwatch', '1968'], reference: '1016', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2024-12-13', status: 'sold', realizedUsd: 28800, priceUsd: 28800, priceBasis: 'realized', estLowUsd: 12000, estHighUsd: 18000, currency: 'USD', yearNum: 1968 },
  { id: 'sothebys-2fe75fe6-aee8-46d6-bbc6-41bdedbc86de', artist: 'rolex', title: 'Explorer, Reference 1016 | A stainless steel wristwatch with bracelet, Circa 1967', titleTokens: ['explorer', 'reference', '1016', 'stainless', 'steel', 'wristwatch', 'bracelet', '1967'], reference: '1016', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2024-10-09', status: 'sold', realizedUsd: 13824, priceUsd: 13824, priceBasis: 'realized', estLowUsd: 10240, estHighUsd: 15360, currency: 'HKD', yearNum: 1967 },
  { id: 'sothebys-alg-439e6bf7-9cfa-4b04-9d5e-054dadc9aa96', artist: 'rolex', title: "reference 1016 explorer 'gilt underline exclamation point' | a stainless steel automatic wristwatch with bracelet and tropical underline exclamation point dial, circa 1963", titleTokens: ['reference', '1016', 'explorer', 'gilt', 'underline', 'exclamation', 'point', 'stainless', 'steel', 'automatic', 'wristwatch', 'bracelet', 'tropical', 'dial', '1963'], reference: '1016', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2024-06-05', status: 'sold', realizedUsd: 20400, priceUsd: 20400, priceBasis: 'realized', estLowUsd: 15000, estHighUsd: 25000, currency: 'USD', yearNum: 1963 },
];
// the maker roster is wider than one reference (the Daytona ref. 116589 rows, real) — IDF, never a 1016 comp
const OTHER_REF = [
  { id: 'christies-auc-6583995', artist: 'rolex', title: "ROLEX. AN EXTREMELY RARE AND ATTRACTIVE 18K WHITE GOLD AND BAGUETTE-CUT DIAMOND-SET AUTOMATIC CHRONOGRAPH WRISTWATCH WITH MOTHER-OF-PEARL DIAL DAYTONA 'BEACH' MOTHER-OF-PEARL MODEL, REF. 116589, CASE NO. K595296, CIRCA 2005", titleTokens: ['rolex', 'extremely', 'rare', 'attractive', '18k', 'white', 'gold', 'baguette', 'cut', 'diamond', 'set', 'automatic', 'chronograph', 'wristwatch', 'mother', 'pearl', 'dial', 'daytona', 'beach', 'model', 'ref', '116589', 'case', 'k595296', '2005'], reference: '116589', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Christie's", saleDate: '2026-05-27', status: 'sold', realizedUsd: 130048, priceUsd: 130048, priceBasis: 'realized', estLowUsd: 64000, estHighUsd: 128000, currency: 'HKD', yearNum: 2005 },
  { id: 'christies-auc-6567951', artist: 'rolex', title: "ROLEX. AN EXTREMELY RARE, VIBRANT AND ATTRACTIVE 18K WHITE GOLD AND BAGUETTE DIAMOND-SET AUTOMATIC CHRONOGRAPH WRISTWATCH WITH MOTHER OF PEARL DIAL DAYTONA 'BEACH' MOTHER OF PEARL MODEL, REF. 116589, CASE NO. D802350, CIRCA 2005", titleTokens: ['rolex', 'extremely', 'rare', 'vibrant', 'attractive', '18k', 'white', 'gold', 'baguette', 'diamond', 'set', 'automatic', 'chronograph', 'wristwatch', 'mother', 'pearl', 'dial', 'daytona', 'beach', 'model', 'ref', '116589', 'case', 'd802350', '2005'], reference: '116589', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Christie's", saleDate: '2025-12-09', status: 'sold', realizedUsd: 139700, priceUsd: 139700, priceBasis: 'realized', estLowUsd: 120000, estHighUsd: 240000, currency: 'USD', yearNum: 2005 },
  { id: 'christies-auc-6557940', artist: 'rolex', title: 'ROLEX. AN ATTRACTIVE 18K WHITE GOLD BAGUETTE-CUT SAPPHIRE AND DIAMOND-SET AUTOMATIC CHRONOGRAPH WRISTWATCH WITH SODALITE DIAL DAYTONA MODEL, REF. 116589, CASE NO. K590856', titleTokens: ['rolex', 'attractive', '18k', 'white', 'gold', 'baguette', 'cut', 'sapphire', 'diamond', 'set', 'automatic', 'chronograph', 'wristwatch', 'sodalite', 'dial', 'daytona', 'model', 'ref', '116589', 'case', 'k590856'], reference: '116589', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Christie's", saleDate: '2025-11-26', status: 'sold', realizedUsd: 130048, priceUsd: 130048, priceBasis: 'realized', estLowUsd: 102400, estHighUsd: 204800, currency: 'HKD' },
  { id: 'sothebys-9c22f5c0-48a0-4419-814e-6f4bfecc4202', artist: 'rolex', title: 'Cosmograph Daytona, Reference 116589 | A white gold and diamond-set chronograph wristwatch with mother-of-pearl dial, Circa 2018', titleTokens: ['cosmograph', 'daytona', 'reference', '116589', 'white', 'gold', 'diamond', 'set', 'chronograph', 'wristwatch', 'mother', 'pearl', 'dial', '2018'], reference: '116589', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2026-09-19', status: 'sold', realizedUsd: 45875.2, priceUsd: 45875.2, priceBasis: 'realized', estLowUsd: 30720, estHighUsd: 61440, currency: 'HKD', yearNum: 2018 },
];
const BACKGROUND = Array.from({ length: 200 }, (_, i) => ({
  id: `bg-${i}`, artist: 'rolex', formKey: 'wristwatch', category: 'object', status: 'sold', saleDate: '2024-03-01', realizedUsd: 9000 + i,
  reference: String(126610 + i),
  titleTokens: [['submariner', 'daytona', 'gmt', 'master', 'datejust'][i % 5], 'stainless', 'steel', 'automatic', 'wristwatch', i % 3 ? 'reference' : 'ref', `ref${126610 + i}`, String(1960 + (i % 60)), String(i % 10), ...(i % 2 ? ['bracelet'] : [])],
}));

/** a watches index as of t2's quarter start (2026-07-01: levels through
 *  2026Q2) — the market read 1.0 at t1's quarter and 0.8 by the last quarter */
const indexAsOfT2 = (n: number, levels?: Record<string, number>): TimeIndex => {
  const lv = levels || { '2024Q2': 1.05, '2024Q3': 1.02, '2024Q4': 1.0, '2025Q1': 0.95, '2025Q2': 0.9, '2025Q3': 0.88, '2025Q4': 0.85, '2026Q1': 0.82, '2026Q2': 0.8 };
  const nq: Record<string, number> = {};
  for (const q of Object.keys(lv)) nq[q] = n;
  return { asOf: '2026-07-01', marketBySlug: { rolex: 'watches' }, levels: { watches: lv }, lastQ: { watches: '2026Q2' }, n: { watches: nq } };
};
const reset = () => { setEngineFlags(null); setCalibration(null); setTimeIndex(null); setHouseBias(null); };

/* ── estimateCarryOf ──────────────────────────────────────────────────── */
test('estimateCarryOf: current / ok / thin / none, the n-gate, the fallback quarter', () => {
  const ti = indexAsOfT2(400);
  // a sale in the index's last quarter or later carries nothing (the live lot)
  assert.deepEqual(estimateCarryOf('watches', '2026-06-15', ti), { f: 1, status: 'current', n: 0, from: '2026Q2', to: '2026Q2' });
  assert.equal(estimateCarryOf('watches', '2026-11-01', ti).status, 'current');
  // a Dec 2024 sale carries 0.8 / 1.0 on 400 sales at both ends — and agrees with timeFactor
  const c = estimateCarryOf('watches', '2024-12-13', ti);
  assert.deepEqual(c, { f: 0.8, status: 'ok', n: 400, from: '2024Q4', to: '2026Q2' });
  assert.equal(c.f, timeFactor('watches', '2024-12-13', ti));
  // the n-gate: under EST_CARRY.minN at either end reads thin (same factor)
  const thin = estimateCarryOf('watches', '2024-12-13', indexAsOfT2(EST_CARRY.minN - 1));
  assert.equal(thin.status, 'thin'); assert.equal(thin.f, 0.8); assert.equal(thin.n, EST_CARRY.minN - 1);
  // an index built before W32 carries no n → thin
  const noN = indexAsOfT2(400); delete noN.n;
  assert.equal(estimateCarryOf('watches', '2024-12-13', noN).status, 'thin');
  // a sale quarter with no level of its own falls back to the nearest earlier level: within
  // EST_CARRY.maxFallbackQ quarters ok, past it thin; older than the window → the first level, thin
  const gappy = indexAsOfT2(400, { '2023Q1': 1.2, '2024Q4': 1.0, '2025Q4': 0.85, '2026Q2': 0.8 });
  assert.deepEqual(estimateCarryOf('watches', '2025-03-01', gappy), { f: 0.8, status: 'ok', n: 400, from: '2024Q4', to: '2026Q2' });   // 2025Q1 ← 2024Q4 (1 quarter)
  assert.equal(estimateCarryOf('watches', '2025-09-01', gappy).status, 'thin');                                                     // 2025Q3 ← 2024Q4 (3 quarters)
  assert.deepEqual(estimateCarryOf('watches', '2021-05-01', gappy), { f: 0.8 / 1.2, status: 'thin', n: 400, from: '2023Q1', to: '2026Q2' });
  // the market has no index: a sale in the quarter before asOf's (or later) is current, an older one is 'none'
  assert.equal(estimateCarryOf('art', '2026-05-01', ti).status, 'current');
  assert.equal(estimateCarryOf('art', '2026-02-01', ti).status, 'none');
  assert.equal(estimateCarryOf(null, '2024-12-13', ti).status, 'none');
  // no index loaded at all, or no date: current (the pre-W32 engine)
  assert.equal(estimateCarryOf('watches', '2024-12-13', null).status, 'current');
  assert.equal(estimateCarryOf('watches', null, ti).status, 'current');
  // the clamp of timeFactor applies to the carry too
  assert.equal(estimateCarryOf('watches', '2024-12-13', indexAsOfT2(400, { '2024Q4': 10, '2025Q1': 9, '2025Q4': 8, '2026Q2': 1 })).f, 0.5);
});

/* ── the engine on the real pair ──────────────────────────────────────── */
const roster = [T1, T2, BETWEEN, ...BEFORE, ...OTHER_REF, ...BACKGROUND] as unknown as AuctionLot[];
const tbl = buildIdf(roster);
buildVectors(roster, tbl);
type VLot = AuctionLot & { _v?: Record<string, number> };
const t1 = roster[0] as VLot;
/** the comps of the t1 read AS OF t2: the t2 row is never a comp (it is the truth), its sale day is the cut */
const compsAsOfT2 = () => resolveComps(t1, roster.filter(l => l.id !== T2.id) as VLot[], tbl, T2.saleDate);
const sansVersion = (v: ValueResult | null) => { if (!v) return v; const { engineVersion: _e, ...rest } = v; return rest; };

test('the real pair: the t1 row valued as of its resale — W24 keeps the anchor at its 2024 level, W32 carries it; the comps are the same', () => {
  reset(); setTimeIndex(indexAsOfT2(400));
  const comps = compsAsOfT2();
  assert.ok(comps.length >= 3, `comps ${comps.length}`);
  assert.equal(comps.some(c => c.id === T2.id), false, 'the t2 sale is the truth, never a comp');
  assert.equal(comps.some(c => c.id === BETWEEN.id), true, 'the Sept 2025 sale is evidence as of 2026');
  setEngineFlags(ENGINE_FLAGS_W24);
  const v0 = estimateValueEx(t1, comps, tbl).value!;
  setEngineFlags(ENGINE_FLAGS_W32);
  const v1 = estimateValueEx(t1, comps, tbl).value!;
  reset();
  assert.ok(v0 && v1);
  assert.equal(v0.estCarry, undefined, 'the served engine stamps no carry');
  assert.deepEqual(v1.estCarry, { f: 0.8, n: 400, from: '2024Q4', to: '2026Q2' });
  assert.deepEqual(v1.poolIds, v0.poolIds, 'the carry moves the anchor, never the pool');
  assert.equal(v1.n, v0.n);
  assert.equal(v1.compAdjUsd, v0.compAdjUsd, 'the comps are carried the same either way');
  assert.equal(v1.compRatio, v0.compRatio, 'compRatio stays the statistic on the printed estimate');
  // the anchor moved by 0.8^(1 − w): under the carried estimate the value falls, less than the full 20%
  assert.ok(v1.compValueUsd < v0.compValueUsd, `${v1.compValueUsd} < ${v0.compValueUsd}`);
  assert.ok(v1.compValueUsd > v0.compValueUsd * 0.8, 'the comp weight keeps part of the move');
  assert.equal(v1.confidence, v0.confidence, 'a deep index demotes nothing');
  // THE MEASUREMENT (§24), on this pair: the watch resold at $13,926 — the carried read sits further from it
  const err = (v: ValueResult) => Math.abs(T2.realizedUsd / v.compValueUsd - 1);
  assert.ok(err(v1) > err(v0), `carried ${v1.compValueUsd} vs anchored ${v0.compValueUsd} against $${T2.realizedUsd}`);
  console.log(`# ref. 1016 pair: W24 $${v0.compValueUsd} · W32 $${v1.compValueUsd} (carry ×0.8) · resold $${T2.realizedUsd} on ${T2.saleDate}`);
});

test('the live lot is byte-identical under W24 and W32 — the carry is ×1 by construction', () => {
  reset(); setTimeIndex(indexAsOfT2(400));
  const live = { ...T1, id: 'live-1016', saleDate: '2026-11-01', status: 'upcoming', realizedUsd: null, priceUsd: null, currentBid: 9000 } as unknown as VLot;
  buildVectors([live], tbl);
  const comps = resolveComps(live, roster as VLot[], tbl, '2026-10-11');
  assert.ok(comps.length >= 3);
  setEngineFlags(ENGINE_FLAGS_W24);
  const v0 = estimateValueEx(live, comps, tbl);
  setEngineFlags(ENGINE_FLAGS_W32);
  const v1 = estimateValueEx(live, comps, tbl);
  reset();
  assert.ok(v0.value && v1.value);
  assert.deepEqual(sansVersion(v1.value), sansVersion(v0.value));
  assert.equal(v1.value!.estCarry, undefined);
  // the same for a sale in the index's last quarter (the W31 0–2m cohort)
  const recent = { ...T1, id: 'recent-1016', saleDate: '2026-06-20' } as unknown as VLot;
  buildVectors([recent], tbl);
  const cr = resolveComps(recent, roster as VLot[], tbl, '2026-10-11');
  setEngineFlags(ENGINE_FLAGS_W24); const r0 = estimateValueEx(recent, cr, tbl);
  setEngineFlags(ENGINE_FLAGS_W32); const r1 = estimateValueEx(recent, cr, tbl);
  reset();
  assert.deepEqual(sansVersion(r1.value), sansVersion(r0.value));
});

test('a thin index demotes the carried read one notch; a market with no index abstains "no-index" only when a carry is needed', () => {
  reset();
  const comps = (() => { setTimeIndex(indexAsOfT2(400)); const c = compsAsOfT2(); return c; })();
  // thin: n under the bar
  setTimeIndex(indexAsOfT2(10));
  setEngineFlags(ENGINE_FLAGS_W24); const v0 = estimateValueEx(t1, comps, tbl).value!;
  setEngineFlags(ENGINE_FLAGS_W32); const v1 = estimateValueEx(t1, comps, tbl).value!;
  assert.deepEqual(v1.estCarry, { f: 0.8, n: 10, from: '2024Q4', to: '2026Q2', thin: true });
  const notch = { high: 'medium', medium: 'low', low: 'low' } as const;
  assert.equal(v1.confidence, notch[v0.confidence]);
  // no index for the market, the sale two years before asOf: no figure
  setTimeIndex({ asOf: '2026-07-01', marketBySlug: { rolex: 'watches' }, levels: {}, lastQ: {} });
  setEngineFlags(ENGINE_FLAGS_W32);
  const ex = estimateValueEx(t1, comps, tbl);
  assert.equal(ex.value, null); assert.equal(ex.abstain, 'no-index');
  // the served engine values it regardless (no carry, no gate)
  setEngineFlags(ENGINE_FLAGS_W24);
  assert.ok(estimateValueEx(t1, comps, tbl).value);
  // no index loaded at all: W32 = W24 (nothing to carry to)
  setTimeIndex(null);
  setEngineFlags(ENGINE_FLAGS_W24); const n0 = estimateValueEx(t1, comps, tbl).value;
  setEngineFlags(ENGINE_FLAGS_W32); const n1 = estimateValueEx(t1, comps, tbl).value;
  assert.deepEqual(sansVersion(n1), sansVersion(n0));
  reset();
});

test('the served engine is W24: estCarry off, and a settled stamp keeps a carry record when one exists', () => {
  assert.equal(ENGINE_FLAGS_CURRENT.version, ENGINE_FLAGS_W24.version);
  assert.equal(ENGINE_FLAGS_CURRENT.estCarry, undefined);
  assert.equal(ENGINE_FLAGS_W32.estCarry, true);
  const v = { poolIds: [], n: 3, compValueUsd: 1, low: 1, high: 1, compRatio: 1, signal: null, estimateUsd: null, vsBid: null, confidence: 'low', exact: null, estCarry: { f: 0.8, n: 400, from: '2024Q4', to: '2026Q2' } } as unknown as ValueResult;
  assert.deepEqual(settledValueOf(v).estCarry, v.estCarry);
});

/* ── the index carries its n ──────────────────────────────────────────── */
test('makeTimeIndexer: each level carries the quarter\'s sale count (TimeIndex.n)', () => {
  // three cohorts (form keys) × 10 sales a quarter over six quarters, the market drifting up
  const rows: AuctionLot[] = [];
  const quarters = ['2024-02-15', '2024-05-15', '2024-08-15', '2024-11-15', '2025-02-15', '2025-05-15'];
  quarters.forEach((d, qi) => {
    for (const form of ['wristwatch', 'pocketwatch', 'clock']) for (let i = 0; i < 10; i++) {
      rows.push({ id: `${form}-${qi}-${i}`, artist: 'rolex', formKey: form, category: 'object', status: 'sold', saleDate: d, realizedUsd: (form === 'clock' ? 500 : 5000) * (1 + 0.05 * qi) * (0.9 + 0.02 * i), titleTokens: [form] } as unknown as AuctionLot);
    }
  });
  const ti = makeTimeIndexer(rows, { rolex: 'watches' })('2025-10-01');
  assert.equal(ti.lastQ.watches, '2025Q2');
  assert.deepEqual(Object.keys(ti.levels.watches).sort(), ['2024Q1', '2024Q2', '2024Q3', '2024Q4', '2025Q1', '2025Q2']);
  assert.ok(ti.n && ti.n.watches);
  for (const q of Object.keys(ti.levels.watches)) assert.equal(ti.n!.watches[q], 30, q);
  assert.ok(ti.levels.watches['2025Q2'] > ti.levels.watches['2024Q1'], 'the index rose with the sales');
  // and the carry reads them: a 2024Q1 sale carried to 2025Q2 on 30 sales = ok at the bar
  const c = estimateCarryOf('watches', '2024-02-15', ti);
  assert.equal(c.status, EST_CARRY.minN <= 30 ? 'ok' : 'thin'); assert.equal(c.n, 30); assert.ok(c.f > 1);
});
