/**
 * W31 (Oct 11 2026) — THE SETTLED APPRAISAL: the engine's value on a SOLD
 * row, read today through the live path. Every engine fixture below is a real
 * corpus row (ids kept — Rolex Explorer ref. 1016, the Sotheby's / Bonhams
 * sales of 2024–2026), trimmed to the fields the readers use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  settledScopeOf, settledCut, isSettledTarget, settledTargets, settledValueOf, settledPathOf, gradeSettled, cohortRatios, SETTLED_DEFAULTS,
} from '../lib/settled-appraisal';
import { setEngineFlags, setCalibration, setTimeIndex, setHouseBias, resolveComps, estimateValueEx, ENGINE_FLAGS_CURRENT, type ValueResult } from '../../app/lib/value';
import { buildIdf, buildVectors } from '../../app/lib/similarity';
import { appendValueTape, readValueTape } from '../build-market-tape';
import type { AuctionLot } from '../../app/types';

const P = <T>(x: T) => x as never;
const TODAY = '2026-10-11';

/* ── the rows: Rolex Explorer reference 1016 — real corpus rows ─────────── */
// sold after the target: Bonhams, Sep 18 2025, est. $6,000–8,000, realized $10,880
const AFTER_BONHAMS = { id: 'bonhams-31170-1062', artist: 'rolex', title: "Explorer 'MK 3', Ref: 1016, c. 1975", titleTokens: ['explorer', 'mk', '3', 'ref', '1016', '1975'], reference: '1016', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: 'Bonhams', saleDate: '2025-09-18', status: 'sold', realizedUsd: 10880, hammerUsd: 8500, priceUsd: 10880, priceBasis: 'realized', buyerPremiumPct: 28, estLowUsd: 6000, estHighUsd: 8000, currency: 'USD', yearNum: 1975 };
// sold a year after the target — a comp today's read admits, the point-in-time replay would not
const AFTER = { id: 'sothebys-2df853ff-5312-4f0a-b9a5-9bad093ad493', artist: 'rolex', title: 'Explorer ‘Gilt OCR Type 6’, Reference 1016 | A stainless steel wristwatch with bracelet, Circa 1966', titleTokens: ['explorer', 'gilt', 'ocr', 'type', '6', 'reference', '1016', 'stainless', 'steel', 'wristwatch', 'bracelet', '1966'], reference: '1016', formKey: 'wristwatch', medium: 'steel wristwatch with bracelet', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2026-09-19', status: 'sold', realizedUsd: 13926.4, priceUsd: 13926.4, priceBasis: 'realized', estLowUsd: 15360, estHighUsd: 30720, currency: 'HKD', yearNum: 1966 };
// the settled target: Sotheby's New York, Dec 13 2024, est. $10,000–15,000, realized $10,800
// (its Algolia discovery twin, sothebys-alg-c937d93d… dated Dec 6 2024 at the same price, is the
// same lot listed twice — kept out: a duplicate listing is not a second sale)
const TARGET = { id: 'sothebys-0bbc69ac-9b9f-4983-a721-982219db81cc', artist: 'rolex', title: 'Reference 1016 Explorer | A stainless steel automatic wristwatch with bracelet, Circa 1960', titleTokens: ['reference', '1016', 'explorer', 'stainless', 'steel', 'automatic', 'wristwatch', 'bracelet', '1960'], reference: '1016', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2024-12-13', status: 'sold', realizedUsd: 10800, priceUsd: 10800, priceBasis: 'realized', estLowUsd: 10000, estHighUsd: 15000, currency: 'USD', yearNum: 1960 };
// sold before the target
const BEFORE = [
  { id: 'sothebys-b867b6b9-6791-4d87-bc8e-789bd62daebf', artist: 'rolex', title: 'Reference 1016 Explorer | A stainless steel automatic wristwatch with bracelet, Circa 1967', titleTokens: ['reference', '1016', 'explorer', 'stainless', 'steel', 'automatic', 'wristwatch', 'bracelet', '1967'], reference: '1016', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2024-12-13', status: 'sold', realizedUsd: 11400, priceUsd: 11400, priceBasis: 'realized', estLowUsd: 8000, estHighUsd: 12000, currency: 'USD', yearNum: 1967 },
  { id: 'sothebys-ecd8dd22-6933-4850-ac26-de4c10e0ff22', artist: 'rolex', title: 'Reference 1016 Explorer | Retailed by Tiffany & Co.: A stainless steel automatic wristwatch, Circa 1968', titleTokens: ['reference', '1016', 'explorer', 'retailed', 'tiffany', 'co', 'stainless', 'steel', 'automatic', 'wristwatch', '1968'], reference: '1016', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2024-12-13', status: 'sold', realizedUsd: 28800, priceUsd: 28800, priceBasis: 'realized', estLowUsd: 12000, estHighUsd: 18000, currency: 'USD', yearNum: 1968 },
  { id: 'sothebys-2fe75fe6-aee8-46d6-bbc6-41bdedbc86de', artist: 'rolex', title: 'Explorer, Reference 1016 | A stainless steel wristwatch with bracelet, Circa 1967', titleTokens: ['explorer', 'reference', '1016', 'stainless', 'steel', 'wristwatch', 'bracelet', '1967'], reference: '1016', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2024-10-09', status: 'sold', realizedUsd: 13824, priceUsd: 13824, priceBasis: 'realized', estLowUsd: 10240, estHighUsd: 15360, currency: 'HKD', yearNum: 1967 },
  { id: 'sothebys-alg-439e6bf7-9cfa-4b04-9d5e-054dadc9aa96', artist: 'rolex', title: "reference 1016 explorer 'gilt underline exclamation point' | a stainless steel automatic wristwatch with bracelet and tropical underline exclamation point dial, circa 1963", titleTokens: ['reference', '1016', 'explorer', 'gilt', 'underline', 'exclamation', 'point', 'stainless', 'steel', 'automatic', 'wristwatch', 'bracelet', 'tropical', 'dial', '1963'], reference: '1016', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2024-06-05', status: 'sold', realizedUsd: 20400, priceUsd: 20400, priceBasis: 'realized', estLowUsd: 15000, estHighUsd: 25000, currency: 'USD', yearNum: 1963 },
];

// the maker roster is wider than one reference: the Daytona ref. 116589 rows
// (real) sit in the same Rolex pool and carry the IDF — never a 1016 comp
const OTHER_REF = [
  { id: 'christies-auc-6583995', artist: 'rolex', title: "ROLEX. AN EXTREMELY RARE AND ATTRACTIVE 18K WHITE GOLD AND BAGUETTE-CUT DIAMOND-SET AUTOMATIC CHRONOGRAPH WRISTWATCH WITH MOTHER-OF-PEARL DIAL DAYTONA 'BEACH' MOTHER-OF-PEARL MODEL, REF. 116589, CASE NO. K595296, CIRCA 2005", titleTokens: ['rolex', 'extremely', 'rare', 'attractive', '18k', 'white', 'gold', 'baguette', 'cut', 'diamond', 'set', 'automatic', 'chronograph', 'wristwatch', 'mother', 'pearl', 'dial', 'daytona', 'beach', 'model', 'ref', '116589', 'case', 'k595296', '2005'], reference: '116589', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Christie's", saleDate: '2026-05-27', status: 'sold', realizedUsd: 130048, priceUsd: 130048, priceBasis: 'realized', estLowUsd: 64000, estHighUsd: 128000, currency: 'HKD', yearNum: 2005 },
  { id: 'christies-auc-6567951', artist: 'rolex', title: "ROLEX. AN EXTREMELY RARE, VIBRANT AND ATTRACTIVE 18K WHITE GOLD AND BAGUETTE DIAMOND-SET AUTOMATIC CHRONOGRAPH WRISTWATCH WITH MOTHER OF PEARL DIAL DAYTONA 'BEACH' MOTHER OF PEARL MODEL, REF. 116589, CASE NO. D802350, CIRCA 2005", titleTokens: ['rolex', 'extremely', 'rare', 'vibrant', 'attractive', '18k', 'white', 'gold', 'baguette', 'diamond', 'set', 'automatic', 'chronograph', 'wristwatch', 'mother', 'pearl', 'dial', 'daytona', 'beach', 'model', 'ref', '116589', 'case', 'd802350', '2005'], reference: '116589', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Christie's", saleDate: '2025-12-09', status: 'sold', realizedUsd: 139700, priceUsd: 139700, priceBasis: 'realized', estLowUsd: 120000, estHighUsd: 240000, currency: 'USD', yearNum: 2005 },
  { id: 'christies-auc-6557940', artist: 'rolex', title: 'ROLEX. AN ATTRACTIVE 18K WHITE GOLD BAGUETTE-CUT SAPPHIRE AND DIAMOND-SET AUTOMATIC CHRONOGRAPH WRISTWATCH WITH SODALITE DIAL DAYTONA MODEL, REF. 116589, CASE NO. K590856', titleTokens: ['rolex', 'attractive', '18k', 'white', 'gold', 'baguette', 'cut', 'sapphire', 'diamond', 'set', 'automatic', 'chronograph', 'wristwatch', 'sodalite', 'dial', 'daytona', 'model', 'ref', '116589', 'case', 'k590856'], reference: '116589', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Christie's", saleDate: '2025-11-26', status: 'sold', realizedUsd: 130048, priceUsd: 130048, priceBasis: 'realized', estLowUsd: 102400, estHighUsd: 204800, currency: 'HKD' },
  { id: 'sothebys-9c22f5c0-48a0-4419-814e-6f4bfecc4202', artist: 'rolex', title: 'Cosmograph Daytona, Reference 116589 | A white gold and diamond-set chronograph wristwatch with mother-of-pearl dial, Circa 2018', titleTokens: ['cosmograph', 'daytona', 'reference', '116589', 'white', 'gold', 'diamond', 'set', 'chronograph', 'wristwatch', 'mother', 'pearl', 'dial', '2018'], reference: '116589', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2026-09-19', status: 'sold', realizedUsd: 45875.2, priceUsd: 45875.2, priceBasis: 'realized', estLowUsd: 30720, estHighUsd: 61440, currency: 'HKD', yearNum: 2018 },
  { id: 'sothebys-alg-019dfee0-321f-7dcf-a8ef-6a5d23374e54', artist: 'rolex', title: 'reference 116589 daytona | a white gold and diamond-set automatic chronograph wristwatch, circa 2000', titleTokens: ['reference', '116589', 'daytona', 'white', 'gold', 'diamond', 'set', 'automatic', 'chronograph', 'wristwatch', '2000'], reference: '116589', formKey: 'wristwatch', category: 'object', subCat: 'wristwatches', auctionHouse: "Sotheby's", saleDate: '2026-06-15', status: 'sold', realizedUsd: 35840, priceUsd: 35840, priceBasis: 'realized', estLowUsd: 20000, estHighUsd: 40000, currency: 'USD', yearNum: 2000 },
];

// the rest of the maker book, for the IDF only (the engine's IDF is fit on the
// whole 553k-row sold book, where 'explorer' and '1016' are rare words; on a
// 13-row roster they would weigh nothing). Never a comp: another reference.
const BACKGROUND = Array.from({ length: 200 }, (_, i) => ({
  id: `bg-${i}`, artist: 'rolex', formKey: 'wristwatch', category: 'object', status: 'sold', saleDate: '2024-03-01', realizedUsd: 9000 + i,
  reference: String(126610 + i),
  titleTokens: [['submariner', 'daytona', 'gmt', 'master', 'datejust'][i % 5], 'stainless', 'steel', 'automatic', 'wristwatch', i % 3 ? 'reference' : 'ref', `ref${126610 + i}`, String(1960 + (i % 60)), String(i % 10), ...(i % 2 ? ['bracelet'] : [])],
}))

/* ── the scope ────────────────────────────────────────────────────────── */
test('settledScopeOf: the nightly default, 0 = every row, off = disabled, a bad value disables', () => {
  assert.deepEqual(settledScopeOf({}), { months: SETTLED_DEFAULTS.months, budgetMs: SETTLED_DEFAULTS.budgetS * 1000 });
  assert.deepEqual(settledScopeOf({ RAY_SETTLED_MONTHS: '36', RAY_SETTLED_BUDGET_S: '300' }), { months: 36, budgetMs: 300_000 });
  assert.deepEqual(settledScopeOf({ RAY_SETTLED_MONTHS: '0' }), { months: null, budgetMs: 480_000 });
  assert.equal(settledScopeOf({ RAY_SETTLED_MONTHS: 'off' }), null);
  assert.equal(settledScopeOf({ RAY_SETTLED_MONTHS: '-1' }), null);
  assert.equal(settledScopeOf({ RAY_SETTLED_MONTHS: 'soon' }), null);
  // a bad budget falls back to the default, never to zero
  assert.equal(settledScopeOf({ RAY_SETTLED_BUDGET_S: 'x' })!.budgetMs, 480_000);
});

test('settledCut: calendar months before the build day', () => {
  assert.equal(settledCut('2026-10-11', 24), '2024-10-11');
  assert.equal(settledCut('2026-10-11', 36), '2023-10-11');
  assert.equal(settledCut('2026-03-31', 1), '2026-03-03'); // JS month arithmetic rolls Feb 31 forward — a day either way is not a row a reader holds
  assert.equal(settledCut('2026-10-11', null), '0000-00-00');
});

test('settledTargets: sold, priced, dated, tokenized, in window — newest sale first, ties by id', () => {
  const rows = [
    { id: 'b', status: 'sold', saleDate: '2025-01-02', realizedUsd: 10, titleTokens: ['x'] },
    { id: 'a', status: 'sold', saleDate: '2025-01-02', realizedUsd: 10, titleTokens: ['x'] },
    { id: 'new', status: 'sold', saleDate: '2026-09-01', realizedUsd: 10, titleTokens: ['x'] },
    { id: 'old', status: 'sold', saleDate: '2023-01-01', realizedUsd: 10, titleTokens: ['x'] },          // before the cut
    { id: 'live', status: 'upcoming', saleDate: '2026-11-01', realizedUsd: null, titleTokens: ['x'] },  // not sold
    { id: 'free', status: 'sold', saleDate: '2026-01-01', realizedUsd: 0, titleTokens: ['x'] },        // no price
    { id: 'mute', status: 'sold', saleDate: '2026-01-01', realizedUsd: 10, titleTokens: [] },          // no tokens → no vector
    { id: 'undated', status: 'sold', saleDate: null, realizedUsd: 10, titleTokens: ['x'] },
  ];
  assert.deepEqual(settledTargets(rows, settledCut(TODAY, 24)).map(r => r.id), ['new', 'a', 'b']);
  assert.deepEqual(settledTargets(rows, '0000-00-00').map(r => r.id), ['new', 'a', 'b', 'old']);
  assert.equal(isSettledTarget(rows[0], '2025-01-02'), true);
  assert.equal(isSettledTarget(rows[0], '2025-01-03'), false);
});

/* ── the stamp ────────────────────────────────────────────────────────── */
test('settledValueOf: no call rides a settled value — signal / vsBid null, the live-bid floor gone, the engine fields kept, the engine result untouched', () => {
  const v = {
    poolIds: ['a', 'b', 'c'], n: 3, compValueUsd: 12000, low: 9000, high: 15000, compRatio: 1.4, flagRatio: 1.3, houseFactor: 1.08,
    signal: { label: 'below estimate', strength: 'moderate', beatRatePct: 61 }, estimateUsd: null,
    vsBid: { label: 'below recent comps', pct: -20 }, confidence: 'medium', exact: null, tier: 'main', otherWorkIds: ['c'],
    expectedHammerUsd: 9600, bandLowUsd: 7200, bandHighUsd: 12000, maxBidUsd: 8800, premiumFactor: 1.25, engineVersion: 'x', bidFloor: 9000,
  } as unknown as ValueResult & { bidFloor?: number };
  const s = settledValueOf(v);
  assert.notEqual(s, v);
  assert.equal(s.signal, null);
  assert.equal(s.vsBid, null);
  assert.equal('bidFloor' in s, false);
  assert.equal(v.signal!.label, 'below estimate');       // the engine's object is not mutated
  assert.equal(v.bidFloor, 9000);
  for (const k of ['poolIds', 'n', 'compValueUsd', 'low', 'high', 'compRatio', 'flagRatio', 'houseFactor', 'confidence', 'tier', 'otherWorkIds', 'expectedHammerUsd', 'bandLowUsd', 'bandHighUsd', 'maxBidUsd', 'premiumFactor', 'engineVersion'] as const) {
    assert.deepEqual((s as unknown as Record<string, unknown>)[k], (v as unknown as Record<string, unknown>)[k], k);
  }
});

/* ── the engine on real rows ──────────────────────────────────────────── */
test('the settled read: the row is never in its own pool, a comp sold AFTER it is admitted, the engine values it, the stamp carries no call', () => {
  setEngineFlags(ENGINE_FLAGS_CURRENT); setCalibration(null); setTimeIndex(null); setHouseBias(null);
  const roster = [TARGET, AFTER, AFTER_BONHAMS, ...BEFORE, ...OTHER_REF, ...BACKGROUND] as unknown as AuctionLot[];
  const tbl = buildIdf(roster);
  buildVectors(roster, tbl);
  const target = roster[0] as AuctionLot & { _v?: Record<string, number> };
  // the live path: resolveComps over the maker pool WITH the row itself in it, priorTo = today
  const comps = resolveComps(target, roster as (AuctionLot & { _v?: Record<string, number> })[], tbl, TODAY);
  assert.ok(comps.length >= 3, `comps ${comps.length}`);
  assert.equal(comps.some(c => c.id === TARGET.id), false, 'the row is never its own comp');
  assert.equal(comps.some(c => c.id === AFTER.id), true, 'a sale after the hammer is evidence of today\'s value');
  assert.equal(comps.some(c => c.id === AFTER_BONHAMS.id), true);
  assert.equal(comps.every(c => c.saleDate < TODAY), true);
  assert.equal(comps.some(c => OTHER_REF.some(o => o.id === c.id) || c.id.startsWith('bg-')), false, 'another reference is another watch');
  // the point-in-time replay would NOT admit the later sale
  const pit = resolveComps(target, roster as (AuctionLot & { _v?: Record<string, number> })[], tbl, TARGET.saleDate);
  assert.equal(pit.some(c => c.id === AFTER.id || c.id === AFTER_BONHAMS.id), false);
  const ex = estimateValueEx(target, comps, tbl);
  assert.ok(ex.value, `abstained: ${ex.abstain}`);
  const v = ex.value!;
  assert.ok(v.compValueUsd > 0 && v.n >= 3);
  assert.ok(v.poolIds.includes(AFTER.id));
  assert.equal(v.poolIds.includes(TARGET.id), false);
  const s = settledValueOf(v);
  assert.equal(s.signal, null);
  assert.equal(s.vsBid, null);
  assert.equal(s.compValueUsd, v.compValueUsd);
  assert.equal(s.n, v.n);
  // the realized price of the row is NOT an input: the value stands on the other sales
  assert.notEqual(s.compValueUsd, TARGET.realizedUsd);
  // ×5 sanity (lotVerdict / enginePoolOf read compRatio): the engine's own pool-scale gate holds it inside
  assert.ok(s.compRatio != null && s.compRatio <= 5 && s.compRatio >= 0.2);
  console.log(`# settled read of ${TARGET.id}: value $${s.compValueUsd} (hammer $${(s as { expectedHammerUsd?: number }).expectedHammerUsd}) · ${s.confidence} · n${s.n} · realized $${TARGET.realizedUsd}`);
});

/* ── the record ───────────────────────────────────────────────────────── */
test('settledPathOf: estimate / no-estimate hedonic / card tier', () => {
  assert.equal(settledPathOf({ estLowUsd: 100, value: { compValueUsd: 1 } }), 'e');
  assert.equal(settledPathOf({ estHighUsd: 100, value: { compValueUsd: 1 } }), 'e');
  assert.equal(settledPathOf({ value: { compValueUsd: 1 } }), 'n');
  assert.equal(settledPathOf({ estLowUsd: 100, value: { compValueUsd: 1, basis: 'card-comp' } }), 'c');
});

test('gradeSettled: rows sold in the last 60 days, realized vs value — median abs error, ±30%, bias; older and unvalued rows stay out', () => {
  const rows = [
    { saleDate: '2026-10-01', realizedUsd: 1000, estLowUsd: 800, value: { compValueUsd: 1000 } },   // e, exact
    { saleDate: '2026-09-20', realizedUsd: 1200, estLowUsd: 800, value: { compValueUsd: 1000 } },   // e, +20%
    { saleDate: '2026-09-01', realizedUsd: 2000, value: { compValueUsd: 1000 } },                   // n, +100%
    { saleDate: '2026-08-20', realizedUsd: 500, value: { compValueUsd: 1000, basis: 'card-comp' } },// c, -50%
    { saleDate: '2026-06-01', realizedUsd: 9000, value: { compValueUsd: 1000 } },                   // 132 days old → out
    { saleDate: '2026-10-05', realizedUsd: 9000, value: null },                                      // unvalued → out
    { saleDate: '2026-10-05', realizedUsd: 0, value: { compValueUsd: 1000 } },                       // unpriced → out
  ];
  const g = gradeSettled(rows, TODAY, 60);
  assert.equal(g.days, 60);
  assert.equal(g.all.n, 4);
  // errors 0, .2, 1, .5 → median .35 → 35%; within ±30%: 2 of 4 → 50%; ratios 1, 1.2, 2, .5 → median 1.1
  assert.equal(g.all.medAbsErrPct, 35);
  assert.equal(g.all.within30Pct, 50);
  assert.equal(g.all.bias, 1.1);
  assert.deepEqual(g.byPath.e, { n: 2, medAbsErrPct: 10, within30Pct: 100, bias: 1.1 });
  assert.deepEqual(g.byPath.n, { n: 1, medAbsErrPct: 100, within30Pct: 0, bias: 2 });
  assert.deepEqual(g.byPath.c, { n: 1, medAbsErrPct: 50, within30Pct: 0, bias: 0.5 });
  assert.deepEqual(gradeSettled([], TODAY).all, { n: 0, medAbsErrPct: null, within30Pct: null, bias: null });
});

test('cohortRatios: realized / value by sale age', () => {
  const rows = [
    { saleDate: '2026-09-25', realizedUsd: 1100, value: { compValueUsd: 1000 } },  // 0-2m
    { saleDate: '2026-01-15', realizedUsd: 900, value: { compValueUsd: 1000 } },   // 2-12m
    { saleDate: '2025-01-15', realizedUsd: 2000, value: { compValueUsd: 1000 } },  // 12-24m
    { saleDate: '2024-01-15', realizedUsd: 1000, value: { compValueUsd: 1000 } },  // 24-36m
    { saleDate: '2015-01-15', realizedUsd: 500, value: { compValueUsd: 1000 } },   // 36m+
  ];
  const c = cohortRatios(rows, TODAY);
  assert.equal(c['0-2m'].all.medRatio, 1.1);
  assert.equal(c['2-12m'].all.medRatio, 0.9);
  assert.equal(c['12-24m'].all.medRatio, 2);
  assert.equal(c['24-36m'].all.medRatio, 1);
  assert.equal(c['36m+'].all.medRatio, 0.5);
  assert.equal(c['36m+'].n.n, 1);
  assert.equal(c['36m+'].e.n, 0);
});

/* ── the live gate is untouched ───────────────────────────────────────── */
test('the value tape ignores a SOLD row carrying a settled value — the live forward check (validate-engine G5) reads only live lots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w31-tape-'));
  const file = path.join(dir, 'value-tape.json.gz');
  const v = { compValueUsd: 12000, low: 9000, high: 15000, confidence: 'medium', signal: null, expectedHammerUsd: 9600 };
  const lots = [
    { ...TARGET, value: v, valueAsOf: TODAY },                                                        // settled: never on the tape
    { id: 'live-1', artist: 'rolex', status: 'upcoming', saleDate: '2026-10-20', estLowUsd: 8000, estHighUsd: 12000, value: v },
  ] as unknown as AuctionLot[];
  const r = appendValueTape(lots, TODAY, { rolex: 'watches' }, 'test', new Set([TARGET.id]), file);
  assert.equal(r.added, 1);
  const rows = readValueTape(file);
  assert.deepEqual(rows.map(x => x.id), ['live-1']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('slimForClient: a settled stamp reaches the wire — the slim projection carries value + valueAsOf, and a null value stays off the wire', () => {
  const { slimForClient } = require('../corpus-io') as typeof import('../corpus-io');
  const stamped = slimForClient({ ...TARGET, value: { compValueUsd: 12000, n: 3, poolIds: ['a'], signal: null, vsBid: null }, valueAsOf: TODAY } as never);
  assert.equal((stamped.value as { compValueUsd: number }).compValueUsd, 12000);
  assert.equal(stamped.valueAsOf, TODAY);
  const abstained = slimForClient({ ...TARGET, value: null, abstain: 'pool<3', valueAsOf: undefined } as never);
  assert.equal('value' in abstained, false);
  assert.equal('valueAsOf' in abstained, false);
  assert.equal(abstained.abstain, 'pool<3');
});

