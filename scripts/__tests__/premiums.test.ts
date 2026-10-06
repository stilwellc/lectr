/**
 * app/lib/premiums.ts — the per-house buyer's-premium schedule, max-bid
 * guidance, hammer inference and the round-increment / % bid-ladder test.
 * (data-quality.test.ts covers one ladder case inside the sentinel; this file
 * pins the whole contract.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  houseAllInFactor, lotAllInFactor, maxHammerFor, inferHammerUsd, isRoundIncrement, BID_LADDER_PCT,
  houseAllInFactorAt, DATED_PREMIUMS,
  DATED_TIERED_PREMIUMS, tieredScheduleAt, allInFromHammer, hammerFromAllIn, houseHammerFromAllInAt,
} from '../../app/lib/premiums';

test('houseAllInFactor: flat houses, tiered houses by hammer band, 1.25 fallback', () => {
  assert.equal(houseAllInFactor('Goldin'), 1.22);
  assert.equal(houseAllInFactor('REA'), 1.175);
  assert.equal(houseAllInFactor('Memory Lane'), 1.20);
  assert.equal(houseAllInFactor("Sotheby's", 500_000), 1.27);
  assert.equal(houseAllInFactor("Sotheby's", 1_000_000), 1.27, 'band ceiling is inclusive');
  assert.equal(houseAllInFactor("Sotheby's", 1_000_001), 1.21);
  assert.equal(houseAllInFactor("Sotheby's", 10_000_000), 1.15);
  assert.equal(houseAllInFactor("Christie's", 5_000_000), 1.21);
  assert.equal(houseAllInFactor('Bonhams', 2_000_000), 1.20);
  assert.equal(houseAllInFactor('Bonhams'), 1.28, 'no hammer → lowest band');
  assert.equal(houseAllInFactor('Some New House'), 1.25);
  assert.equal(houseAllInFactor(null), 1.25);
});

test('houseAllInFactorAt (Oct 6): Wright / Rago / LAMA dated eras — 25% → 26% (2023) → 27% (2025) → 28% after Mar 15 2026', () => {
  const at = (h: string, d: string) => houseAllInFactorAt(h, 5000, d);
  assert.equal(at('Wright', '2002-05-01'), 1.15);
  assert.equal(at('Wright', '2008-12-11'), 1.20);
  assert.equal(at('Wright', '2009-02-26'), 1.25);
  assert.equal(at('Wright', '2022-12-15'), 1.25);
  assert.equal(at('Wright', '2023-01-11'), 1.26);
  assert.equal(at('Wright', '2025-01-08'), 1.27);
  assert.equal(at('Wright', '2026-03-13'), 1.27);
  assert.equal(at('Wright', '2026-03-17'), 1.28);
  assert.equal(at('Rago', '2026-03-25'), 1.28);
  assert.equal(at('Rago', '2019-06-01'), 1.25);
  assert.equal(at('LAMA', '2010-05-01'), 1.225);
  assert.equal(at('LAMA', '2026-05-19'), 1.28);
  assert.equal(houseAllInFactor('Bruun Rasmussen'), 1.30);
  // a stamped premium still wins
  assert.equal(lotAllInFactor({ auctionHouse: 'Wright', saleDate: '2026-09-30', buyerPremiumPct: 33 }), 1.33);
});

test('houseAllInFactorAt: REA era schedule by saleDate; other houses / bad dates fall back to the undated schedule', () => {
  const at = (d: string | null) => houseAllInFactorAt('REA', 2000, d);
  assert.equal(at('2003-11-01'), 1.15, 'before the first era → first rate');
  assert.equal(at('2004-04-15'), 1.15);
  assert.equal(at('2005-04-15'), 1.16);
  assert.equal(at('2006-10-15'), 1.16);
  assert.equal(at('2007-04-15'), 1.175);
  assert.equal(at('2011-04-15'), 1.175);
  assert.equal(at('2012-04-15'), 1.185);
  assert.equal(at('2014-04-15'), 1.185, 'Spring 2014 still 18.5%');
  assert.equal(at('2014-10-15'), 1.20, 'Fall 2014 → 20%');
  assert.equal(at('2025-07-15'), 1.20);
  assert.equal(at('2025-09-15'), 1.23);
  assert.equal(at('2026-07-15T00:00:00Z'), 1.23, 'datetime is read by its date');
  assert.equal(at(null), houseAllInFactor('REA'), 'no date → undated schedule');
  assert.equal(at('?'), houseAllInFactor('REA'));
  assert.equal(houseAllInFactorAt('Goldin', 1000, '2010-01-01'), houseAllInFactor('Goldin'));
  assert.equal(houseAllInFactorAt("Sotheby's", 2_000_000, null), houseAllInFactor("Sotheby's", 2_000_000), 'no date → undated tiers');
  // schedule hygiene: ascending dates, plausible factors
  for (const [h, eras] of Object.entries(DATED_PREMIUMS)) {
    for (let i = 1; i < eras.length; i++) assert.ok(eras[i][0] > eras[i - 1][0], `${h} eras ascending`);
    for (const [, f] of eras) assert.ok(f > 1 && f < 1.4, `${h} factor ${f}`);
  }
});

test('tiered math: marginal bands, exact inverse, continuous at the band edges', () => {
  const s = { rates: [0.25, 0.20, 0.12], ceilings: [50_000, 1_000_000] };
  assert.equal(allInFromHammer(40_000, s), 50_000);
  assert.equal(allInFromHammer(50_000, s), 62_500, 'band edge');
  assert.equal(allInFromHammer(130_000, s), 158_500, '$50k @25% + $80k @20%');
  assert.equal(allInFromHammer(2_000_000, s), 62_500 + 950_000 * 1.2 + 1_000_000 * 1.12);
  for (const h of [1, 999, 50_000, 50_001, 400_000, 1_000_000, 1_000_001, 7_654_321]) {
    assert.ok(Math.abs(hammerFromAllIn(allInFromHammer(h, s), s) - h) < 1e-6, `round trip ${h}`);
  }
  assert.equal(hammerFromAllIn(0, s), 0);
  assert.equal(hammerFromAllIn(1195, { rates: [0.195, 0.10], ceilings: [100_000] }), 1000);
});

test("tieredScheduleAt / houseHammerFromAllInAt: Christie's & Sotheby's eras by sale date AND sale currency", () => {
  // Christie's London 2012: 25% to £25k; Oct 2002 King Street: 19.5% to £70k; Mar 2013: £37,500 (the published band)
  assert.deepEqual(tieredScheduleAt("Christie's", '2012-06-25', 'GBP'), { rates: [0.25, 0.20, 0.12], ceilings: [25_000, 500_000] });
  assert.equal(houseHammerFromAllInAt("Christie's", 13_750, '2012-06-25', 'GBP'), 11_000);
  assert.equal(houseHammerFromAllInAt("Christie's", 3_824, '2002-10-09', 'GBP'), 3_200);
  assert.equal(houseHammerFromAllInAt("Christie's", 79_875, '2013-06-17', 'GBP'), 65_000, '£37.5k @25% + £27.5k @20%');
  assert.equal(houseHammerFromAllInAt("Christie's", 3_780, '2023-12-06'), 3_000, 'USD default, 26% era');
  // Sotheby's: Hong Kong's own 2002 rate (18%), the 2024 20% interlude, the 2026 28%
  assert.equal(houseHammerFromAllInAt("Sotheby's", 37_760, '2002-10-30', 'HKD'), 32_000);
  assert.equal(houseHammerFromAllInAt("Sotheby's", 12_000, '2024-11-20'), 10_000);
  assert.equal(houseHammerFromAllInAt("Sotheby's", 409_600, '2026-04-24', 'HKD'), 320_000);
  // era boundaries are inclusive of their first day
  assert.equal(tieredScheduleAt("Sotheby's", '2026-02-12')!.rates[0], 0.27);
  assert.equal(tieredScheduleAt("Sotheby's", '2026-02-13')!.rates[0], 0.28);
  // no tiered read → null / undated fallback: unknown currency, pre-table date, bad date, other house
  assert.equal(tieredScheduleAt("Christie's", '2012-06-25', 'JPY'), null);
  assert.equal(tieredScheduleAt("Christie's", '1990-01-01'), null);
  assert.equal(tieredScheduleAt("Christie's", '?'), null);
  assert.equal(tieredScheduleAt('Goldin', '2012-06-25'), null);
  assert.equal(houseHammerFromAllInAt("Christie's", 1_260, null), 1_260 / houseAllInFactor("Christie's", 1_260));
  assert.equal(houseHammerFromAllInAt('REA', 2_962, '2013-04-15'), 2_962 / 1.185, 'REA flat eras unchanged');
  // blended factor at a hammer
  assert.equal(houseAllInFactorAt("Christie's", 130_000, '2012-05-09'), 158_500 / 130_000);
  // schedule hygiene: ascending dates, rates/ceilings shapes agree, ceilings ascending, plausible rates
  for (const [h, eras] of Object.entries(DATED_TIERED_PREMIUMS)) {
    for (let i = 1; i < eras.length; i++) assert.ok(eras[i].from > eras[i - 1].from, `${h} eras ascending at ${eras[i].from}`);
    for (const e of eras) {
      for (const [cur, c] of Object.entries(e.ceilings)) {
        const r = e.rateOverride?.[cur] ?? e.rates;
        assert.equal(r.length, c.length + 1, `${h} ${e.from} ${cur} shape`);
        for (let i = 1; i < c.length; i++) assert.ok(c[i] > c[i - 1], `${h} ${e.from} ${cur} ceilings ascending`);
        for (const x of r) assert.ok(x > 0 && x < 0.35, `${h} ${e.from} rate ${x}`);
      }
    }
  }
});

test('lotAllInFactor: a stamped buyerPremiumPct (0 < bp < 60) wins over the schedule', () => {
  assert.equal(lotAllInFactor({ auctionHouse: 'Goldin', buyerPremiumPct: 20 }), 1.2);
  assert.equal(lotAllInFactor({ auctionHouse: 'Goldin', buyerPremiumPct: 0 }), 1.22, 'zero is not a premium');
  assert.equal(lotAllInFactor({ auctionHouse: 'Goldin', buyerPremiumPct: 75 }), 1.22, 'implausible stamp ignored');
  assert.equal(lotAllInFactor({ auctionHouse: "Christie's", buyerPremiumPct: null }, 7_000_000), 1.15);
});

test('maxHammerFor: walk-away hammer = floor(all-in ÷ factor)', () => {
  assert.equal(maxHammerFor(1175, { auctionHouse: 'REA' }), 1000);
  assert.equal(maxHammerFor(1000, { auctionHouse: 'Goldin' }), 819);
  assert.equal(maxHammerFor(1000, { auctionHouse: 'Goldin', buyerPremiumPct: 25 }), 800);
});

test('inferHammerUsd: published hammer wins; else realized ÷ the lot factor; 0 when there is no price', () => {
  assert.equal(inferHammerUsd({ auctionHouse: 'Goldin', hammerUsd: 900, realizedUsd: 1220 }), 900);
  assert.equal(inferHammerUsd({ auctionHouse: 'Goldin', realizedUsd: 1220 }), 1000);
  assert.equal(inferHammerUsd({ auctionHouse: 'Goldin', priceUsd: 1220 }), 1000, 'priceUsd is the fallback realized');
  assert.equal(inferHammerUsd({ auctionHouse: 'REA', realizedUsd: 1175, buyerPremiumPct: 17.5 }), 1000);
  // tiered house reads the band off the realized figure
  assert.ok(Math.abs(inferHammerUsd({ auctionHouse: "Sotheby's", realizedUsd: 2_420_000 }) - 2_000_000) < 1e-6);
  assert.equal(inferHammerUsd({ auctionHouse: 'Goldin' }), 0);
  assert.equal(inferHammerUsd({ auctionHouse: 'Goldin', hammerUsd: 0, realizedUsd: 0 }), 0);
});

test('isRoundIncrement: flat step by band ($50 <5k, $100 <50k, $500 <500k, $1k above), ±$1 default tolerance', () => {
  assert.equal(isRoundIncrement(1050), true);
  assert.equal(isRoundIncrement(1051), true, 'within ±1');
  assert.equal(isRoundIncrement(1052), false);
  assert.equal(isRoundIncrement(4950), true);
  assert.equal(isRoundIncrement(10_050), false, 'the NFL idwalk poison price: 10,050 is off the $100 step');
  assert.equal(isRoundIncrement(10_100), true);
  assert.equal(isRoundIncrement(60_500), true);
  assert.equal(isRoundIncrement(60_100), false);
  assert.equal(isRoundIncrement(1_001_000), true);
  assert.equal(isRoundIncrement(1_000_500), false);
  assert.equal(isRoundIncrement(1052, 2), true, 'custom tolerance');
  assert.equal(isRoundIncrement(0), false);
  assert.equal(isRoundIncrement(-50), false);
  assert.equal(isRoundIncrement(NaN), false);
});

test('BID_LADDER_PCT: the three 10% geometric-ladder houses', () => {
  assert.deepEqual(BID_LADDER_PCT, { 'Lelands': 0.10, 'Memory Lane': 0.10, 'Love of the Game': 0.10 });
});

test('isRoundIncrement with a % ladder: a rung is honest only inside a 3-rung chain of peers', () => {
  // the Memory Lane 10% ladder from 1,050: 1,050 → 1,155 → 1,271 → 1,398 → 1,538 → 1,692
  const ladder = { pct: 0.10, peers: [1050, 1155, 1271, 1398, 1538, 1692] };
  // 1,271 is off every flat step…
  assert.equal(isRoundIncrement(1271), false);
  // …but between two rungs it is a real ladder price
  assert.equal(isRoundIncrement(1271, 1, ladder), true, 'between 1,155 and 1,398');
  assert.equal(isRoundIncrement(1692, 1, ladder), true, 'top end of a run (1,538 ← 1,398)');
  assert.equal(isRoundIncrement(1155, 1, { pct: 0.10, peers: [1271, 1398] }), true, 'bottom end of a run');
  // one coincidental neighbour is not a ladder
  assert.equal(isRoundIncrement(1271, 1, { pct: 0.10, peers: [1398] }), false, '<2 peers');
  assert.equal(isRoundIncrement(1271, 1, { pct: 0.10, peers: [1398, 5000] }), false, 'a single neighbour, no chain');
  // rung tolerance: ±max(1.5, 0.2%) — the ladder rounds each step to the dollar
  assert.equal(isRoundIncrement(1273, 1, { pct: 0.10, peers: [1155, 1398] }), true, '×1.1 = 1,400.3 is 2.3 from 1,398 (tol 2.8); ÷1.1 = 1,157.3 is 2.3 from 1,155 (tol 2.3)');
  assert.equal(isRoundIncrement(1290, 1, { pct: 0.10, peers: [1155, 1398] }), false, 'off the ladder');
  // the value itself in the peer list is ignored (no self-chaining)
  assert.equal(isRoundIncrement(1271, 1, { pct: 0.10, peers: [1271, 1271, 1398] }), false);
  // a zero/negative pct means no ladder
  assert.equal(isRoundIncrement(1271, 1, { pct: 0, peers: [1155, 1398] }), false);
  // peers may be any iterable (a Set from the house's repeat-price census)
  assert.equal(isRoundIncrement(1271, 1, { pct: 0.10, peers: new Set([1155, 1398]) }), true);
});
