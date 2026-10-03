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
