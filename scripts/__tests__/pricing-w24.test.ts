/**
 * W24 (Oct 11 2026) — the buyer review of live lots: comp pools that mixed
 * different objects, the max bid pinned at the live bid, the garbled medium
 * capture. Every fixture below is a real corpus row (ids kept), trimmed to the
 * fields the readers use.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setEngineFlags, setCalibration, estimateValueEx, floorAtBid, ENGINE_FLAGS_CURRENT, ENGINE_FLAGS_WAVE10,
  type Comp, type EngineCalibration, type EngineFlags, type ValueResult,
} from '../../app/lib/value';
import { supportOf, isUniqueWork, uniqueSupportConflict, uniqueSizeConflict, workYearConflict, estMidUsdOf } from '../../app/lib/comp-purity';
import { buildIdf, type Match } from '../../app/lib/similarity';
import { isGluedMedium } from '../lib/corpus-normalize';
import { MEDIUM_PATTERNS } from '../lib/houses/common';
import type { AuctionLot } from '../../app/types';

/* ── the rows ─────────────────────────────────────────────────────────── */
// the target: Christie's London, Oct 14 2026
const WARHOL_CANVAS = {
  id: 'christies-6606837', artist: 'andy-warhol', title: 'Diamond Dust Shoes', medium: 'acrylic', formKey: 'original-2d', yearNum: 1980,
  heightCm: 229.5, widthCm: 177.8, estLowUsd: 2394000, estHighUsd: 3325000, auctionHouse: "Christie's",
  description: "ANDY WARHOL (1928-1987) Diamond Dust Shoes signed and dated 'Andy Warhol 80' (on the overlap) acrylic, silkscreen ink and diamond dust on canvas 90 x 70in. (229.5 x 177.8cm.) Executed in 1980",
};
// in its pool on prod: the estate's works on paper ($185,000 and $290,500)
const WARHOL_PAPER_1 = {
  id: 'christies-auc-5739332', artist: 'andy-warhol', title: 'Andy Warhol (1928-1987) Diamond Dust Shoes', medium: 'Diamond Dust Shoes', formKey: 'original-2d', yearNum: 1980,
  heightCm: 147.3, widthCm: 100.3, estLowUsd: 150000, estHighUsd: 200000, auctionHouse: "Christie's",
  description: 'Andy Warhol (1928-1987) Diamond Dust Shoes stamped with the Estate of Andy Warhol and the Andy Warhol Foundation for the Visual Arts stamps synthetic polymer, silkscreen inks and diamond dust on paper 39½ x 58 in. (100.3 x 147.3 cm.) Executed in 1980.',
};
const WARHOL_PAPER_2 = {
  id: 'christies-auc-5559546', artist: 'andy-warhol', title: 'Andy Warhol (1928-1987) Diamond Dust Shoes', medium: 'Diamond Dust Shoes', formKey: 'original-2d', yearNum: 1980,
  heightCm: 152.4, widthCm: 101.6, estLowUsd: 150000, estHighUsd: 200000, auctionHouse: "Christie's",
  description: "Andy Warhol (1928-1987) Diamond Dust Shoes stamped with the Estate of Andy Warhol and the Andy Warhol Foundation for the Visual Arts, Inc. stamps and numbered '099EUT.042' (on the reverse) synthetic polymer, silkscreen inks and diamond dust on paper 40 x 60 in. (101 x 152 cm.) Executed in 1980.",
};
// the same canvas, sold May 2025 ($2.95M) — stays
const WARHOL_CANVAS_2025 = {
  id: 'christies-auc-6534269', artist: 'andy-warhol', title: 'ANDY WARHOL (1928-1987) Diamond Dust Shoes', medium: 'Diamond Dust Shoes', formKey: 'original-2d',
  heightCm: 177.8, widthCm: 228.6, auctionHouse: "Christie's",
  description: 'ANDY WARHOL (1928-1987) Diamond Dust Shoes signed and dated ... acrylic, silkscreen ink and diamond dust on canvas 90 x 70 in. (228.6 x 177.8 cm.) Painted in 1980.',
};
// Bonhams Oct 28 2026: Picasso, state II aquatint (est. €6,900–9,200)
const PICASSO_T = {
  id: 'bonhams-31799-13', artist: 'pablo-picasso', title: 'Femmes à leur toilette, IIᵉ état, 1 mars 1965, 1966', formKey: 'print', yearNum: 1965,
  estLowUsd: 6900, estHighUsd: 9200, auctionHouse: 'Bonhams', description: 'PABLO PICASSO (1881-1973) Femmes à leur toilette, IIᵉ état, 1 mars 1965, 1966',
};
const PICASSO_SAME = { id: 'christies-auc-5820953', artist: 'pablo-picasso', title: 'Pablo Picasso (1881-1973) Femmes à leur toilette II', formKey: 'print', yearNum: 1965, estLowUsd: 3296, estHighUsd: 4944, auctionHouse: "Christie's" };
const PICASSO_LINO_1956 = { id: 'christies-24560.50', artist: 'pablo-picasso', title: 'Femmes á leur Toilette', medium: 'oilettelinocut', formKey: 'print', yearNum: 1956, estLowUsd: 19950, estHighUsd: 26600, auctionHouse: "Christie's" };
const PICASSO_B1037 = { id: 'christies-auc-4894952', artist: 'pablo-picasso', title: 'PABLO PICASSO Femmes à leur toilette (B. 1037)', formKey: 'print', yearNum: 1956, estLowUsd: 20000, estHighUsd: 30000, auctionHouse: "Christie's" };
const PICASSO_DEUX = { id: 'christies-auc-5553952', artist: 'pablo-picasso', title: 'Pablo Picasso (1881-1973) Deux femmes à leur toilette', formKey: 'print', yearNum: 1964, estLowUsd: 80000, estHighUsd: 120000, auctionHouse: "Christie's" };
// Lichtenstein Cow Triptych (Bonhams Oct 28 2026, est. €8,050–13,800) and the
// Rago poster in its pool ($1,250, est. $800–1,200)
const COW_T = { id: 'bonhams-31799-60', artist: 'roy-lichtenstein', title: 'Cow Triptych (Cow Going Abstract), 1982', formKey: 'unknown', yearNum: 1982, estLowUsd: 8050, estHighUsd: 13800, auctionHouse: 'Bonhams' };
const COW_POSTER = { id: 'rago-103141', artist: 'roy-lichtenstein', title: 'Cow Triptych (Cow Going Abstract)', formKey: 'unknown', estLowUsd: 800, estHighUsd: 1200, auctionHouse: 'Rago' };
const COW_2026 = { id: 'bonhams-31755-69', artist: 'roy-lichtenstein', title: 'Cow Triptych (Cow Going Abstract), 1982', formKey: 'unknown', estLowUsd: 8050, estHighUsd: 11500, auctionHouse: 'Bonhams' };

const P = <T>(x: T) => x as never;

/* ── readers ──────────────────────────────────────────────────────────── */
test('W24 support: canvas vs the estate\'s works on paper; the "(on the overlap)" signature note is not a support', () => {
  assert.equal(supportOf(P(WARHOL_CANVAS)), 'canvas');
  assert.equal(supportOf(P(WARHOL_PAPER_1)), 'paper');
  assert.equal(supportOf(P(WARHOL_PAPER_2)), 'paper');
  assert.equal(supportOf(P(WARHOL_CANVAS_2025)), 'canvas');
  assert.ok(isUniqueWork(P(WARHOL_CANVAS)) && isUniqueWork(P(WARHOL_PAPER_1)));
  assert.equal(uniqueSupportConflict(P(WARHOL_CANVAS), P(WARHOL_PAPER_1)), true);
  assert.equal(uniqueSupportConflict(P(WARHOL_CANVAS), P(WARHOL_CANVAS_2025)), false);
  // prints are not unique works: the rule never reads them
  assert.equal(uniqueSupportConflict(P(PICASSO_T), P(PICASSO_SAME)), false);
});

test('W24 size: the 40 × 60 in sheets are 2.6× smaller than the 90 × 70 in canvas', () => {
  assert.equal(uniqueSizeConflict(P(WARHOL_CANVAS), P(WARHOL_PAPER_1), 2.5), true);
  assert.equal(uniqueSizeConflict(P(WARHOL_CANVAS), P(WARHOL_PAPER_2), 2.5), true);
  assert.equal(uniqueSizeConflict(P(WARHOL_CANVAS), P(WARHOL_CANVAS_2025), 2.5), false);
});

test('W24 year: the 1956 linocuts are not the 1965 aquatint; the 1965 state is', () => {
  assert.equal(workYearConflict(P(PICASSO_T), P(PICASSO_LINO_1956), 2), true);
  assert.equal(workYearConflict(P(PICASSO_T), P(PICASSO_B1037), 2), true);
  assert.equal(workYearConflict(P(PICASSO_T), P(PICASSO_SAME), 2), false);
  // an undated side says nothing
  assert.equal(workYearConflict(P(COW_T), P(COW_POSTER), 2), false);
});

test('W24 estimate scale: the houses priced "Deux femmes" and the poster an order of magnitude away', () => {
  const r = (a: object, b: object) => { const x = estMidUsdOf(P(a)), y = estMidUsdOf(P(b)); return Math.max(x, y) / Math.min(x, y); };
  assert.ok(r(PICASSO_T, PICASSO_DEUX) > 6);
  assert.ok(r(COW_T, COW_POSTER) > 6);
  assert.ok(r(WARHOL_CANVAS, WARHOL_PAPER_1) > 6);
  assert.ok(r(COW_T, COW_2026) < 6);
  assert.ok(r(PICASSO_T, PICASSO_LINO_1956) < 6);
});

/* ── the engine ───────────────────────────────────────────────────────── */
const M = (cosine: number): Match => ({ score: Math.round(cosine * 100), cosine, cls: 'similar', reasons: [] });
const C = (lot: Record<string, unknown>, usd: number, saleDate: string, cos = 0.9): Comp => ({ id: String(lot.id), match: M(cos), realizedUsd: usd, saleDate, lot: lot as unknown as AuctionLot });
const tbl = buildIdf([]);
const cal: EngineCalibration = {
  edges: [0.6, 0.9, 1.3, 2.0, 10],
  beatRate: { global: [40, 40, 45, 63, 70, 70] },
  band: { high: { lo: 0.7, hi: 1.5 }, medium: { lo: 0.6, hi: 1.8 }, low: { lo: 0.5, hi: 2.5 } },
  marketBySlug: { 'andy-warhol': 'art', 'pablo-picasso': 'art', 'roy-lichtenstein': 'art' },
};
const asT = (o: object) => ({ ...o, status: 'upcoming', saleDate: '2026-10-14' } as unknown as AuctionLot);
const W24ON: Partial<EngineFlags> = { estScale: true, uniqueSupport: true, uniqueSize: true, workYear: true };
const run = (flags: Partial<EngineFlags>, t: object, comps: Comp[]) => {
  setCalibration(cal); setEngineFlags({ ...ENGINE_FLAGS_WAVE10, ...flags, version: 't' });
  const r = estimateValueEx(asT(t), comps, tbl);
  setCalibration(null); setEngineFlags(null);
  return r;
};

test('W24 engine: the Warhol pool keeps the canvases and loses the works on paper', () => {
  const canvas = (id: string, usd: number, sd: string) => C({ ...WARHOL_CANVAS_2025, id }, usd, sd, 1);
  const comps = [
    canvas('christies-auc-6534269', 2954000, '2025-05-12'), canvas('christies-auc-6398123', 2580000, '2022-11-18'),
    canvas('christies-auc-6452785', 1683500, '2023-11-07'), canvas('christies-auc-5846108', 2045000, '2014-11-12'),
    C(WARHOL_PAPER_1, 185000, '2013-11-13', 1), C(WARHOL_PAPER_2, 290500, '2012-05-09', 1),
  ];
  const off = run({}, WARHOL_CANVAS, comps).value!;
  assert.ok(off.poolIds.includes('christies-auc-5739332'), 'wave 10 kept the sheet');
  const on = run(W24ON, WARHOL_CANVAS, comps).value!;
  assert.ok(!on.poolIds.includes('christies-auc-5739332') && !on.poolIds.includes('christies-auc-5559546'));
  assert.equal(on.poolIds.length, 4);
});

test('W24 (measured, not adopted) the date / scale filters leave the Picasso aquatint one true comp — no value', () => {
  const comps = [C(PICASSO_SAME, 6592, '2014-09-18', 0.71), C(PICASSO_LINO_1956, 32346, '2026-09-24', 0.67), C(PICASSO_B1037, 18000, '2007-05-01', 0.67), C(PICASSO_DEUX, 134500, '2012-05-02', 0.61)];
  const off = run({}, PICASSO_T, comps);
  assert.ok(off.value && off.value.poolIds.includes('christies-24560.50') && off.value.poolIds.includes('christies-auc-4894952'), 'wave 10 priced it off the 1956 linocuts');
  const on = run(W24ON, PICASSO_T, comps);
  assert.equal(on.value, null);
  assert.equal(on.abstain, 'pool<3');
});

test('W24 (measured, not adopted) the estimate-scale filter drops the Rago poster from the Cow Triptych pool', () => {
  const comps = [C(COW_2026, 27968, '2026-03-18', 1), C({ ...COW_2026, id: 'bonhams-29353-183', estLowUsd: 18000, estHighUsd: 25000 }, 25600, '2024-03-26', 0.95),
    C(COW_POSTER, 1250, '2017-05-06', 0.95), C({ ...COW_2026, id: 'bonhams-22803-104', estLowUsd: 9168, estHighUsd: 12224 }, 12988, '2015-07-14', 0.95)];
  const on = run(W24ON, COW_T, comps).value!;
  assert.ok(!on.poolIds.includes('rago-103141'));
  assert.equal(on.poolIds.length, 3);
});

/* ── max bid ──────────────────────────────────────────────────────────── */
// nflauction-6465735, Oct 11 2026: Broncos Adam Trautman game-worn jersey,
// bid $2,500 on comps whose median hammer is ~$1.5k
const JERSEY = { auctionHouse: 'NFL Auction', currentBid: 2500, saleDate: '2026-10-20', saleDateTime: '2026-10-20T23:00:00Z' };
const jerseyValue = (): ValueResult => ({
  poolIds: [], n: 10, compValueUsd: 1899, low: 1700, high: 2300, compRatio: null, signal: null, estimateUsd: 1899, vsBid: null,
  confidence: 'high', exact: null, expectedHammerUsd: 1519, bandLowUsd: 1360, bandHighUsd: 1840, maxBidUsd: 1410, premiumFactor: 1.25,
});
test('W24 max bid: a bid past the walk-away keeps the engine\'s max bid (it used to read "worth up to" the bid)', () => {
  const NOW = Date.parse('2026-10-11T13:00:00Z');
  setEngineFlags({ ...ENGINE_FLAGS_WAVE10, version: 't' });
  const old = floorAtBid(jerseyValue(), JERSEY, NOW);
  assert.equal(old.maxBidUsd, 2500, 'wave 10: pinned at the live bid');
  setEngineFlags({ ...ENGINE_FLAGS_WAVE10, maxBidOwn: true, version: 't' });
  const f = floorAtBid(jerseyValue(), JERSEY, NOW);
  setEngineFlags(null);
  assert.equal(f.expectedHammerUsd, 2500, 'the hammer still cannot land under the bid');
  assert.equal(f.bandLowUsd, 2500);
  assert.equal(f.maxBidUsd, 1410, 'the walk-away stays where the comps put it');
});

test('W24 is the served engine: support / size boundaries and the own max bid on; the measured rejects off', () => {
  assert.equal(ENGINE_FLAGS_CURRENT.version, '2026.10.11-w24');
  for (const k of ['uniqueSupport', 'uniqueSize', 'maxBidOwn', 'otherWorkMark', 'vbTier'] as const) assert.equal(ENGINE_FLAGS_CURRENT[k], true, k);
  for (const k of ['estScale', 'workYear', 'mixedPoolAbstain'] as const) assert.ok(!ENGINE_FLAGS_CURRENT[k], k);
});

test('W24 engine: the Picasso pool keeps its value but names the other works', () => {
  const comps = [C(PICASSO_SAME, 6592, '2014-09-18', 0.71), C(PICASSO_LINO_1956, 32346, '2026-09-24', 0.67), C(PICASSO_B1037, 18000, '2007-05-01', 0.67), C(PICASSO_DEUX, 134500, '2012-05-02', 0.61)];
  setCalibration(cal); setEngineFlags(null);
  const v = estimateValueEx(asT(PICASSO_T), comps, tbl).value!;
  setCalibration(null);
  assert.deepEqual([...(v.otherWorkIds || [])].sort(), ['christies-24560.50', 'christies-auc-4894952'].sort());
  assert.ok(!(v.otherWorkIds || []).includes('christies-auc-5820953'), 'the 1965 state is the same work');
});

/* ── medium capture ───────────────────────────────────────────────────── */
test('W24 medium: a keyword inside a word is no medium (toilette, Linke, temperature)', () => {
  const head = (s: string) => (s.match(new RegExp(`(${MEDIUM_PATTERNS.source}[^,;.]{0,60})`, 'i')) || [null])[0];
  assert.equal(head('Femmes à leur toilette, 1956'), null);
  assert.equal(head('PABLO PICASSO (1881-1973) Femmes á leur Toilette linocut, 1956, on Arches wove paper'), 'linocut');
  assert.equal(head('retailed by Oskar Linke in Genova'), null);
  assert.equal(head('Etching on wove paper'), 'Etching on wove paper');
  for (const m of ['oilette', 'oilettelinocut', 'oile sur la tête (Duthuit 155)', 'temperature', 'inke à Gênes']) assert.equal(isGluedMedium(m), true, m);
  for (const m of ['Etching on wove paper', 'oil on canvas', 'oilstick on paper', 'lithographie en couleurs', 'screenprints', 'aquatinte']) assert.equal(isGluedMedium(m), false, m);
});
