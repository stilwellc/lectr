/**
 * Pricing fix wave 7 (Oct 6 2026) — the market tails on the value band
 * (vbMarket), the RR bid pull (bidPull), the new-release card abstention
 * (cardNewRelease), the odds floor (oddsFloor), and the measured-not-adopted
 * reference readers (readHouseReference, watchRefBound).
 * docs/ENGINE_LANES.md §18.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setEngineFlags, setCalibration, estimateValueEx, pullTowardBid, floorAtBid, isNewReleaseCard, watchRefFamily,
  ENGINE_FLAGS_CURRENT, ENGINE_FLAGS_WAVE6, ENGINE_FLAGS_WAVE7, BID_PULL, VB_MARKET, CARD_NEW,
  type Comp, type EngineCalibration, type EngineFlags,
} from '../../app/lib/value';
import { fitValueBands, type NoEstObs } from '../backtest-core';
import { readHouseReference } from '../../app/lib/watch-ref';
import { buildIdf, type Match } from '../../app/lib/similarity';
import type { AuctionLot } from '../../app/types';

// (wave 10) the tier tails off: these cases isolate the wave-7 rules
const with_ = (o: Partial<EngineFlags>): EngineFlags => ({ ...ENGINE_FLAGS_CURRENT, vbTier: false, ...o, version: `${ENGINE_FLAGS_CURRENT.version}~t` });

test('wave 7 is in the served engine', () => {
  assert.equal(ENGINE_FLAGS_WAVE7.version, '2026.10.06-wave7');
  for (const k of ['vbMarket', 'bidPull', 'cardNewRelease', 'oddsFloor'] as const) assert.equal(ENGINE_FLAGS_CURRENT[k], true, k);
  for (const k of ['watchRefBound'] as const) assert.ok(!ENGINE_FLAGS_CURRENT[k], k);
  assert.ok(!ENGINE_FLAGS_WAVE6.vbMarket && !ENGINE_FLAGS_WAVE6.bidPull);
});

// a deterministic residual cloud: ln z evenly spread over ±s
const cloud = (m: string, s: number, n: number, sd = '2026-06-01'): NoEstObs[] =>
  Array.from({ length: n }, (_, i) => ({ m, conf: 'medium', rn: Math.exp(-s + (2 * s * i) / (n - 1)), sd }) as NoEstObs);

test('vbMarket: a wide market stretches both tails, a tight one tightens them; off → no market cells', () => {
  const ne = [...cloud('culture', 1.2, 400), ...cloud('watches', 0.3, 400), ...cloud('art', 0.7, 400)];
  setEngineFlags(with_({ vbMarket: false }));
  const off = fitValueBands([], ne, null, {}, '2026-10-01');
  assert.deepEqual(off.valueBandByMarket, {});
  setEngineFlags(with_({ vbMarket: true }));
  const on = fitValueBands([], ne, null, {}, '2026-10-01');
  const g = on.valueBand.n.medium;
  const cu = on.valueBandByMarket.culture.n.medium, wa = on.valueBandByMarket.watches.n.medium;
  assert.ok(cu.lo < g.lo && cu.hi > g.hi, `culture ${JSON.stringify(cu)} vs ${JSON.stringify(g)}`);
  assert.ok(wa.lo > g.lo && wa.hi < g.hi, `watches ${JSON.stringify(wa)} vs ${JSON.stringify(g)}`);
  // each market's own rows fall outside its tails ~VB_MARKET.q of the time
  const below = cloud('culture', 1.2, 400).filter(o => o.rn < cu.lo).length / 400;
  const above = cloud('culture', 1.2, 400).filter(o => o.rn > cu.hi).length / 400;
  assert.ok(Math.abs(below - VB_MARKET.q) < 0.02 && Math.abs(above - VB_MARKET.q) < 0.02, `${below} ${above}`);
  setEngineFlags(null);
});

test('vbMarket: a thin market (under VB_MARKET.minN rows) keeps the global band', () => {
  setEngineFlags(with_({ vbMarket: true }));
  const r = fitValueBands([], [...cloud('art', 0.7, 400), ...cloud('science', 1.5, VB_MARKET.minN - 1)], null, {}, '2026-10-01');
  assert.ok(!r.valueBandByMarket.science);
  setEngineFlags(null);
});

const rrValue = () => ({
  compValueUsd: 3750, low: 2500, high: 6250, expectedHammerUsd: 3000, bandLowUsd: 2000, bandHighUsd: 5000, maxBidUsd: 2600, premiumFactor: 1.25,
  estimateUsd: null, confidence: 'medium' as const,
});
const rrLot = (bid: number, house = 'RR Auction') => ({ currentBid: bid, auctionHouse: house, saleDate: '2026-09-20' });

test('bidPull: an RR value above 1.15× the bid moves BID_PULL.w of the way to it (log), band and all-in with it', () => {
  setEngineFlags(with_({ bidPull: true }));
  const v = pullTowardBid(rrValue(), rrLot(1000));
  const q = Math.exp((1 - BID_PULL.w) * Math.log(3000) + BID_PULL.w * Math.log(1000));
  assert.equal(v.expectedHammerUsd, Math.round(q));
  const s = q / 3000;
  assert.equal(v.compValueUsd, Math.round(3750 * s));
  assert.equal(v.bandLowUsd, Math.round(2000 * s));
  assert.equal(v.bandHighUsd, Math.round(5000 * s));
  assert.equal(v.maxBidUsd, Math.round(2600 * s));
  // then the bid floor still holds the band low at the bid
  const f = floorAtBid(v, { ...rrLot(1900), saleDateTime: '2026-09-30T00:00:00Z' }, Date.parse('2026-09-14T13:00:00Z'));
  assert.ok((f.bandLowUsd ?? 0) >= 1900);
  setEngineFlags(null);
});

test('bidPull: no pull near the bid, at another house, or with the flag off', () => {
  setEngineFlags(with_({ bidPull: true }));
  const base = rrValue();
  assert.equal(pullTowardBid(base, rrLot(2700)), base); // 3000 < 1.15 × 2700
  assert.equal(pullTowardBid(base, rrLot(1000, 'Goldin')), base);
  assert.equal(pullTowardBid(base, rrLot(0)), base);
  setEngineFlags(with_({ bidPull: false }));
  assert.equal(pullTowardBid(base, rrLot(1000)), base);
  setEngineFlags(null);
});

test('isNewReleaseCard: the set year within CARD_NEW.years of the valuation year', () => {
  const now = Date.parse('2026-09-14T13:00:00Z');
  assert.equal(CARD_NEW.years, 1);
  assert.ok(isNewReleaseCard('2026', now));
  assert.ok(isNewReleaseCard('2025-26', now));
  assert.ok(!isNewReleaseCard('2024', now));
  assert.ok(!isNewReleaseCard('1952', now));
  assert.ok(!isNewReleaseCard(null, now));
  assert.ok(!isNewReleaseCard('', now));
});

test('readHouseReference: the Phillips structured field keys like a title reference', () => {
  assert.equal(readHouseReference('126719BLRO', 'rolex'), '126719blro');
  assert.equal(readHouseReference('1680, repeated inside caseback', 'rolex'), '1680');
  assert.equal(readHouseReference('6265 inside caseback stamped 6263', 'rolex'), '6265');
  assert.equal(readHouseReference('5711/1A-011', 'patek-philippe'), '5711/1');
  assert.equal(readHouseReference('26300ST.OO.1110ST.08', 'audemars-piguet'), '26300');
  // a multi-watch field, an untracked maker, nothing → nothing
  assert.equal(readHouseReference('The first: 5912.30.22, 18K yellow gold\r\nThe second: 5932.30.23', 'omega'), null);
  assert.equal(readHouseReference('1680', 'tudor'), null);
  assert.equal(readHouseReference(null, 'rolex'), null);
});

test('watchRefFamily: the leading digit run of the numeric reference', () => {
  assert.equal(watchRefFamily({ artist: 'rolex', reference: '126719blro' }), 'rolex|126719');
  assert.equal(watchRefFamily({ artist: 'patek-philippe', reference: '5711/1' }), 'patek-philippe|5711');
  assert.equal(watchRefFamily({ artist: 'rolex', reference: 'submariner' }), null);
  assert.equal(watchRefFamily({ artist: 'pablo-picasso', reference: '1680' }), null);
});

const M = (cosine: number): Match => ({ score: Math.round(cosine * 100), cosine, cls: 'similar', reasons: [] });
const C = (id: string, usd: number, ref: string | null): Comp => ({
  id, match: M(0.9), realizedUsd: usd, saleDate: '2025-12-01',
  lot: { id, artist: 'rolex', title: 'Rolex wristwatch', reference: ref, auctionHouse: "Christie's", saleDate: '2025-12-01', status: 'sold' } as unknown as AuctionLot,
});

test('watchRefBound (measured, off): another reference family leaves the pool', () => {
  const cal: EngineCalibration = {
    edges: [0.6, 0.9, 1.3, 2.0, 10], beatRate: { global: [40, 40, 45, 63, 70, 70] },
    band: { high: { lo: 0.7, hi: 1.5 }, medium: { lo: 0.6, hi: 1.8 }, low: { lo: 0.5, hi: 2.5 } }, marketBySlug: { rolex: 'watches' },
  };
  setCalibration(cal);
  const lot = { id: 't', artist: 'rolex', title: 'Rolex Submariner wristwatch', reference: '1680', auctionHouse: "Sotheby's", status: 'upcoming', saleDate: '2026-10-21', estLowUsd: 10000, estHighUsd: 15000 } as unknown as AuctionLot;
  const comps = [C('a', 12000, '1680'), C('b', 13000, '1680/8'), C('c', 11000, null), C('d', 30000, '16610'), C('e', 31000, '116610lv')];
  const tbl = buildIdf([]);
  setEngineFlags(with_({ watchRefBound: true }));
  const v = estimateValueEx(lot, comps, tbl).value!;
  assert.deepEqual([...v.poolIds].sort(), ['a', 'b', 'c']);
  setEngineFlags(with_({ watchRefBound: false }));
  assert.equal(estimateValueEx(lot, comps, tbl).value!.poolIds.length, 5);
  setCalibration(null); setEngineFlags(null);
});
