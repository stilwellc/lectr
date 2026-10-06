/**
 * Oct 3 2026 engine pass — fixture tests for the house-normalized Flags, the
 * house anchor, the buyer's fields (expected hammer / band / max bid), the
 * card + no-estimate publish gates, the engine comparison (shadow/promote)
 * and the max-bid calibration metric. Hand-built lots only (no corpus).
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { appendValueTape, readValueTape, gradeValueTape } from '../build-market-tape';
import type { AuctionLot } from '../../app/types';
import {
  estimateValueEx, setCalibration, setTimeIndex, setHouseBias, setEngineFlags, houseFactorOf, adjustedTop, buyerFields,
  noEstGateOf, blendPredict, BAND_TOP_RATIO, ENGINE_FLAGS_LEGACY, ENGINE_FLAGS_CURRENT, ENGINE_FLAGS_HOUSE_GATE, ENGINE_VERSION,
  type Comp, type HouseBias, type EngineCalibration,
} from '../../app/lib/value';
import { buildHouseBias } from '../../app/lib/indices';
import { fitCardCalibration, gateCell, cardGate, CARD_GATE, type CardResidual } from '../../app/lib/cards-gate';
import { compareEngines, maxBidCalibrationOf, fitNoEstGate, type EngineRow, type CalObs, type NoEstObs } from '../backtest-core';
import { houseAllInFactor } from '../../app/lib/premiums';
import { buildIdf } from '../../app/lib/similarity';
import type { Match } from '../../app/lib/similarity';

afterEach(() => { setCalibration(null); setTimeIndex(null); setHouseBias(null); setEngineFlags(null); });

const MBS = { 'andy-warhol': 'art', 'entertainment-memorabilia': 'culture' };
let seq = 0;
const sold = (house: string, artist: string, saleDate: string, realized: number, lo: number, hi?: number): AuctionLot => ({
  id: `s${seq++}`, title: 't', artist, auctionHouse: house, status: 'sold', saleDate, realizedUsd: realized,
  estLowUsd: lo, ...(hi ? { estHighUsd: hi } : {}),
}) as unknown as AuctionLot;

// ── the house-bias index ────────────────────────────────────────────────────
function corpus(): AuctionLot[] {
  const out: AuctionLot[] = [];
  // a typical band house: realized 1.25× its estimate mid
  for (let i = 0; i < 60; i++) out.push(sold("Christie's", 'andy-warhol', `2025-0${1 + (i % 9)}-1${i % 9}`, 1250, 800, 1200));
  // a low-estimating single-point house: realized 3× its "$500+" point
  for (let i = 0; i < 60; i++) out.push(sold('RR Auction', 'entertainment-memorabilia', `2025-0${1 + (i % 9)}-1${i % 9}`, 1500, 500));
  // a sale AFTER the cut — must never enter the index
  for (let i = 0; i < 90; i++) out.push(sold('RR Auction', 'entertainment-memorabilia', '2026-05-01', 5000, 500));
  return out;
}

test('house-bias index: point-in-time, per house × market × estimate kind, relative to the global band habit', () => {
  const hb = buildHouseBias(corpus(), MBS, '2026-01-01');
  assert.ok(Math.abs(Math.exp(hb.ref) - 1.25) < 1e-3, 'ref = the global BAND habit');
  const rr = houseFactorOf('culture', 'RR Auction', 'p', hb)!;
  assert.equal(rr.key, 'mh:culture|RR Auction:p');
  assert.ok(Math.abs(rr.f - 3 / 1.25) < 0.01, `RR factor ${rr.f} ≈ 3 / 1.25 (sales after the cut ignored)`);
  const ch = houseFactorOf('art', "Christie's", 'b', hb)!;
  assert.ok(Math.abs(ch.f - 1) < 1e-3, 'a typical band house reads 1');
  // unknown house → its market cell → global
  assert.equal(houseFactorOf('art', 'Nobody', 'b', hb)!.key, 'm:art:b');
  assert.equal(houseFactorOf(null, null, 'b', null), null);
  // later cut: the post-cut sales now count and the RR habit moves
  const later = buildHouseBias(corpus(), MBS, '2026-06-01');
  assert.ok(houseFactorOf('culture', 'RR Auction', 'p', later)!.f > rr.f);
});

test('adjustedTop: band high × house factor; single point × factor × BAND_TOP_RATIO', () => {
  assert.equal(adjustedTop(800, 1200, 1), 1200);
  assert.equal(adjustedTop(800, 1200, 1.5), 1800);
  assert.equal(adjustedTop(500, null, 2), 500 * 2 * BAND_TOP_RATIO);
  assert.equal(adjustedTop(null, 700), 700 * BAND_TOP_RATIO);
});

// ── the house-normalized flag ───────────────────────────────────────────────
const M = (cosine: number): Match => ({ score: Math.round(cosine * 100), cosine, cls: 'similar', reasons: [] });
const C = (id: string, usd: number): Comp => ({ id, match: M(0.9), realizedUsd: usd, saleDate: '2025-12-01' });
const rrLot = (): AuctionLot => ({
  id: 'lot', title: 'signed photo', artist: 'entertainment-memorabilia', auctionHouse: 'RR Auction', status: 'upcoming',
  saleDate: '2026-01-15', estLowUsd: 500,
}) as unknown as AuctionLot;
const CAL_MIN: EngineCalibration = {
  edges: [0.6, 0.9, 1.3, 2.0, 10],
  beatRate: { global: [40, 40, 45, 63, 70, 70], 'culture:pt': [40, 40, 45, 63, 70, 70] },
  band: { high: { lo: 0.7, hi: 1.5 }, medium: { lo: 0.6, hi: 1.8 }, low: { lo: 0.5, hi: 2.5 } },
  marketBySlug: MBS,
};

test('flags: a low-estimating house no longer flags on its own policy — flagRatio divides by the house habit', () => {
  const comps = ['a', 'b', 'c', 'd'].map(id => C(id, 1400));   // comps 2.8× the "$500+" point
  const tbl = buildIdf([]);
  setCalibration(CAL_MIN);
  setHouseBias(buildHouseBias(corpus(), MBS, '2026-01-01'));
  setEngineFlags(ENGINE_FLAGS_LEGACY);
  const legacy = estimateValueEx(rrLot(), comps, tbl).value!;
  assert.equal(legacy.compRatio, 2.8);
  assert.equal(legacy.signal!.label, 'below comparable market', 'legacy: raw 2.8× flags');
  assert.equal(legacy.flagRatio, 2.8, 'legacy flag ratio = raw');
  setEngineFlags(ENGINE_FLAGS_HOUSE_GATE);
  const cur = estimateValueEx(rrLot(), comps, tbl).value!;
  assert.equal(cur.compRatio, 2.8, 'compRatio stays raw');
  assert.ok(Math.abs(cur.houseFactor! - 2.4) < 0.01);
  assert.ok(Math.abs(cur.flagRatio! - 2.8 / 2.4) < 0.01);
  assert.equal(cur.signal!.label, 'at comparable market', 'house-gate: 1.17× the house-adjusted estimate is not a flag');
  // (Oct 6) CURRENT reads the same comps on the hammer basis: the comps'
  // hammer (÷ RR's premium) vs the point — still not a flag
  setEngineFlags(ENGINE_FLAGS_CURRENT);
  const ham = estimateValueEx(rrLot(), comps, tbl).value!;
  assert.ok(Math.abs(ham.compRatio! - 2.8 / houseAllInFactor('RR Auction')) < 0.01);
  assert.equal(ham.signal!.label, 'at comparable market');
  assert.equal(ham.engineVersion, ENGINE_VERSION);
});

test('house anchor: the estimate-lot prediction anchors on the house habit, moved toward comps by w', () => {
  setHouseBias(buildHouseBias(corpus(), MBS, '2026-01-01'));
  const lot = { artist: 'entertainment-memorabilia', auctionHouse: 'RR Auction' };
  setEngineFlags(ENGINE_FLAGS_CURRENT);
  const cur = blendPredict(lot, 500, 'p', 1600, 'medium', { ...CAL_MIN, blend: { a: { 'global:p': 0.2 }, w: { medium: 0.25 } } });
  assert.ok(Math.abs(cur.value - 500 * Math.exp(0.75 * Math.log(3) + 0.25 * Math.log(3.2))) < 1, `${cur.value}`);
  setEngineFlags(ENGINE_FLAGS_LEGACY);
  const leg = blendPredict(lot, 500, 'p', 1600, 'medium', { ...CAL_MIN, blend: { a: { 'global:p': 0.2 }, w: { medium: 0.25 } } });
  assert.ok(Math.abs(leg.value - 500 * Math.exp(0.2 + 0.25 * Math.log(3.2))) < 1);
});

// ── the buyer's fields ──────────────────────────────────────────────────────
test('buyerFields: hammer basis = all-in ÷ the lot premium; max bid = the calibrated 30% point, clamped into [band low, expected]', () => {
  const lot = { auctionHouse: 'RR Auction' };
  const pf = houseAllInFactor('RR Auction');
  const f = buyerFields(lot, 1250, 900, 2000, 1100);
  assert.equal(f.premiumFactor, pf);
  assert.equal(f.expectedHammerUsd, Math.round(1250 / pf));
  assert.equal(f.bandLowUsd, Math.round(900 / pf));
  assert.equal(f.bandHighUsd, Math.round(2000 / pf));
  assert.equal(f.maxBidUsd, Math.round(1100 / pf));
  assert.equal(f.engineVersion, ENGINE_VERSION);
  // uncalibrated: geometric position between the band low and the median
  const u = buyerFields(lot, 1000, 500, 2000);
  assert.ok(u.maxBidUsd < u.expectedHammerUsd && u.maxBidUsd > u.bandLowUsd);
  // clamps: never above the expected hammer, never under the band low
  assert.equal(buyerFields(lot, 1000, 800, 1500, 5000).maxBidUsd, Math.round(1000 / pf));
  assert.equal(buyerFields(lot, 1000, 800, 1500, 10).maxBidUsd, Math.round(800 / pf));
  // a lot's own stamped premium wins
  assert.equal(buyerFields({ auctionHouse: 'RR Auction', buyerPremiumPct: 20 }, 1200, 1000, 1500).expectedHammerUsd, 1000);
});

test('estimateValueEx stamps the buyer fields + engine version on every value (uncalibrated estimate lot)', () => {
  const lot = { ...rrLot(), auctionHouse: "Christie's", artist: 'andy-warhol', estLowUsd: 800, estHighUsd: 1200 } as unknown as AuctionLot;
  const v = estimateValueEx(lot, ['a', 'b', 'c', 'd'].map(id => C(id, 1300)), buildIdf([])).value!;
  assert.ok(v.expectedHammerUsd! > 0 && v.bandLowUsd! <= v.maxBidUsd! && v.maxBidUsd! <= v.expectedHammerUsd!);
  assert.ok(v.bandLowUsd! <= v.expectedHammerUsd! && v.expectedHammerUsd! <= v.bandHighUsd!);
  assert.equal(v.expectedHammerUsd, Math.round(v.compValueUsd / v.premiumFactor!));
  assert.equal(v.engineVersion, ENGINE_VERSION);
});

// ── the publish gates ───────────────────────────────────────────────────────
test('gateCell: n floor, ±30% bar, bias bar — stable reason codes', () => {
  const tight = Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.1 : -0.1));
  assert.deepEqual(gateCell(tight.slice(0, 10)), { n: 10, within30Pct: null, bias: null, pass: false, reason: 'card:uncalibrated' });
  assert.equal(gateCell(tight).pass, true);
  const loose = Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.8 : -0.8));
  assert.equal(gateCell(loose).reason, 'card:gate-accuracy');
  const biased = Array.from({ length: 60 }, () => 0.2);
  assert.equal(gateCell(biased).reason, 'card:gate-bias');
  assert.equal(gateCell(loose, 'noest').reason, 'noest:gate-accuracy');
});

test('fitCardCalibration: tier bias/band from the last 120d; per-cell gate on point-in-time-corrected residuals', () => {
  const DAY = 864e5;
  const now = Date.parse('2026-10-01');
  const rows: CardResidual[] = [];
  // exact/high: realized runs 10% over the tier value, tight — the correction makes it pass
  for (let i = 0; i < 300; i++) rows.push({ tier: 'exact', conf: 'high', market: 'sports', ms: now - (1 + (i % 360)) * DAY, lr: Math.log(1.1) + (i % 2 ? 0.05 : -0.05) });
  // grade-adj/low: wide misses
  for (let i = 0; i < 300; i++) rows.push({ tier: 'grade-adj', conf: 'low', market: 'sports', ms: now - (1 + (i % 360)) * DAY, lr: i % 2 ? 0.9 : -0.9 });
  // a future row never counts
  rows.push({ tier: 'exact', conf: 'high', market: 'sports', ms: now + DAY, lr: 5 });
  const cal = fitCardCalibration(rows, now);
  assert.ok(Math.abs(cal.tiers.exact.bias - Math.exp((Math.log(1.1) * cal.tiers.exact.n) / (cal.tiers.exact.n + CARD_GATE.K))) < 0.01);
  assert.ok(cal.tiers.exact.lo <= cal.tiers.exact.mb && cal.tiers.exact.mb <= 1 && cal.tiers.exact.hi >= 1);
  assert.equal(cardGate(cal, 'sports', 'exact', 'high').pass, true);
  assert.equal(cardGate(cal, 'sports', 'grade-adj', 'low').reason, 'card:gate-accuracy');
  assert.equal(cardGate(cal, 'tcg', 'tcg-exact', 'high').reason, 'card:uncalibrated', 'a never-measured cell abstains');
});

test('no-estimate gate: fit from the record (rp, trailing year), read per market × confidence', () => {
  const rows: NoEstObs[] = [];
  for (let i = 0; i < 80; i++) rows.push({ m: 'sports', conf: 'low', rn: 1, rp: i % 2 ? 2.5 : 0.4, sd: '2026-06-01', id: `n${i}`, ev: 'x' });
  for (let i = 0; i < 80; i++) rows.push({ m: 'science', conf: 'medium', rn: 1, rp: i % 2 ? 1.05 : 0.95, sd: '2026-06-01', id: `m${i}`, ev: 'x' });
  for (let i = 0; i < 80; i++) rows.push({ m: 'science', conf: 'high', rn: 1, rp: 1, sd: '2020-06-01', id: `o${i}`, ev: 'x' });
  const g = fitNoEstGate(rows, '2026-10-01');
  assert.equal(g.sports.low.reason, 'noest:gate-accuracy');
  assert.equal(g.science.medium.pass, true);
  assert.equal(g.science.high, undefined, 'rows past the trailing year never count');
  const cal = { ...CAL_MIN, marketBySlug: { 'game-used': 'sports', 'space-exploration': 'science' }, noEstGate: g };
  assert.equal(noEstGateOf('game-used', 'low', cal).pass, false);
  assert.equal(noEstGateOf('space-exploration', 'medium', cal).pass, true);
  assert.equal(noEstGateOf('space-exploration', 'high', cal).reason, 'noest:uncalibrated');
});

// ── shadow / promote ────────────────────────────────────────────────────────
test('compareEngines: value error on the lots both valued; promote only on ≥ value accuracy and no edge loss', () => {
  const mk = (id: string, p: number, sig: 'b' | 't', r: number): EngineRow => ({ id, m: 'art', conf: 'medium', r, p, lo: p * 0.7, hi: p * 1.4, mid: 1000, top: 1200, atop: 1200, hf: 1, sig });
  const cur: EngineRow[] = [], cand: EngineRow[] = [];
  for (let i = 0; i < 40; i++) {
    const flagged = i < 20, r = flagged ? 1600 : 1100;
    cur.push(mk(`l${i}`, r * 1.4, flagged ? 'b' : 't', r));     // 40% off
    cand.push(mk(`l${i}`, r * 1.1, flagged ? 'b' : 't', r));    // 10% off, same flags
  }
  const better = compareEngines(cur, cand, { current: 'c', candidate: 'n' });
  assert.equal(better.both, 40);
  assert.equal(better.promote, true);
  assert.ok(better.candidate.all.medAbsErrPct! < better.current.all.medAbsErrPct!);
  // the candidate loses the directional edge (flags nothing) → hold
  const noEdge = compareEngines(cur, cand.map(r => ({ ...r, sig: 't' as const })), { current: 'c', candidate: 'n' });
  assert.equal(noEdge.promote, false);
  assert.match(noEdge.reasons.join(' '), /directional edge/);
  // worse value error → hold
  const worse = compareEngines(cand, cur, { current: 'n', candidate: 'c' });
  assert.equal(worse.promote, false);
});

test('maxBidCalibrationOf: hammers vs the band and the max bid, per market', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ m: 'art', cr: 1, beat: false, r: 1, conf: 'high', ageY: 0, bl: 0.8, bh: 1.3, bm: 0.9, xh: i < 12 ? 0.85 : i < 36 ? 1.1 : 1.6 })) as CalObs[];
  const c = maxBidCalibrationOf(rows, []);
  assert.equal(c.art.n, 40);
  assert.equal(c.art.belowMaxBidPct, 30);
  assert.equal(c.art.aboveMaxBidPct, 70);
  assert.equal(c.art.inBandPct, 90);
  assert.equal(c.all.nominalBelowPct, 30);
});

test('legacy flags reproduce the pre-pass engine: no house factor, raw ratio', () => {
  setEngineFlags(ENGINE_FLAGS_LEGACY);
  const hb: HouseBias = { asOf: '2026-01-01', ref: 0, cells: { 'g:p': 2 }, n: {} };
  setHouseBias(hb);
  const v = estimateValueEx(rrLot(), ['a', 'b', 'c', 'd'].map(id => C(id, 1600)), buildIdf([])).value!;
  assert.equal(v.houseFactor, undefined);
  assert.equal(v.flagRatio, v.compRatio);
  assert.equal(v.engineVersion, ENGINE_FLAGS_LEGACY.version);
});

// ── the value tape: served + shadow rows, first call wins per version ───────
test('appendValueTape: served rows + candidate shadow rows, first call wins per version; graded with the max bid', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tape-')), 'tape.json.gz');
  const v = { compValueUsd: 1250, low: 900, high: 1800, confidence: 'medium', expectedHammerUsd: 1000, maxBidUsd: 850, signal: { label: 'at comparable market' } };
  const lot = { id: 'a', status: 'upcoming', artist: 'andy-warhol', estLowUsd: 800, estHighUsd: 1200, value: v } as unknown as AuctionLot;
  const shadow = { version: 'cand', values: new Map([['a', { ...v, compValueUsd: 1300 }]]) };
  const r1 = appendValueTape([lot], '2026-10-03', MBS, 'cur', new Set(), file, shadow);
  assert.deepEqual([r1.added, r1.shadowAdded], [1, 1]);
  const r2 = appendValueTape([{ ...lot, value: { ...v, compValueUsd: 9999 } } as unknown as AuctionLot], '2026-10-04', MBS, 'cur', new Set(), file, shadow);
  assert.deepEqual([r2.added, r2.shadowAdded], [0, 0], 'first call wins per version');
  const rows = readValueTape(file);
  assert.equal(rows.length, 2);
  const served = rows.find(r => !r.sh)!, sh = rows.find(r => r.sh)!;
  assert.equal(served.p, 1250); assert.equal(served.v, 'cur'); assert.equal(served.xh, 1000); assert.equal(served.mb, 850);
  assert.equal(sh.p, 1300); assert.equal(sh.v, 'cand');
  // grade 25 sold copies of the served row (n ≥ 20) — hammer 800 sits under the max bid
  const many = Array.from({ length: 25 }, (_, i) => ({ ...served, id: `x${i}` }));
  const sold = new Map(many.map(r => [r.id, { r: 1000, sd: '2026-10-10', h: 800 }]));
  const g = gradeValueTape(many, sold, () => ['all']);
  assert.equal(g.all.n, 25);
  assert.equal(g.all.belowMaxBidPct, 100);
  assert.equal(g.all.bandCoveragePct, 100);
});
