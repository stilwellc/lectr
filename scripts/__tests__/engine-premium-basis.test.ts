/**
 * Oct 5 2026 — the engine's all-in → hammer conversion reads the premium in
 * force on the lot's sale date (premiums.lotHammerFromAllIn; REA's eras and
 * the tiered Christie's/Sotheby's schedules), everywhere: inferHammerUsd,
 * maxHammerFor, and the served buyer's fields (value.buyerFields). Houses with
 * no dated schedule convert exactly as before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lotHammerFromAllIn, inferHammerUsd, maxHammerFor, lotAllInFactor, houseAllInFactor,
  houseHammerFromAllInAt, allInFromHammer, tieredScheduleAt,
} from '../../app/lib/premiums';
import { buyerFields } from '../../app/lib/value';

test('lotHammerFromAllIn: REA era rates by sale date; undated lots keep the house schedule', () => {
  assert.equal(lotHammerFromAllIn({ auctionHouse: 'REA', saleDate: '2026-04-15' }, 12_300), 10_000); // 23% from Sep 2025
  assert.ok(Math.abs(lotHammerFromAllIn({ auctionHouse: 'REA', saleDate: '2018-04-15' }, 12_000) - 10_000) < 1e-9); // 20%
  assert.ok(Math.abs(lotHammerFromAllIn({ auctionHouse: 'REA', saleDate: '2004-04-15' }, 11_500) - 10_000) < 1e-9); // 15%
  assert.equal(lotHammerFromAllIn({ auctionHouse: 'REA' }, 11_750), 11_750 / houseAllInFactor('REA'));
});

test('lotHammerFromAllIn: a house with no dated schedule converts exactly as the undated factor did', () => {
  for (const h of ['Goldin', 'Wright', 'Bonhams', 'Phillips', 'RR Auction']) {
    for (const x of [800, 25_000, 2_400_000]) {
      assert.equal(lotHammerFromAllIn({ auctionHouse: h, saleDate: '2026-03-01' }, x, x / 1.25), x / houseAllInFactor(h, x / 1.25), `${h} ${x}`);
    }
  }
});

test('lotHammerFromAllIn: the stamped premium wins; tiered houses invert the band walk exactly', () => {
  assert.equal(lotHammerFromAllIn({ auctionHouse: "Christie's", buyerPremiumPct: 25, saleDate: '2026-03-01' }, 12_500), 10_000);
  const sd = '2026-05-12';
  assert.ok(tieredScheduleAt("Christie's", sd, 'USD'), 'Christie\'s 2026 is tiered');
  for (const hammer of [5_000, 150_000, 1_800_000, 9_000_000]) {
    const allIn = allInFromHammer(hammer, tieredScheduleAt("Christie's", sd, 'USD')!);
    assert.ok(Math.abs(lotHammerFromAllIn({ auctionHouse: "Christie's", saleDate: sd }, allIn) - hammer) < 1e-6, `round trip ${hammer}`);
    assert.equal(lotHammerFromAllIn({ auctionHouse: "Christie's", saleDate: sd }, allIn), houseHammerFromAllInAt("Christie's", allIn, sd));
  }
});

test('inferHammerUsd: the published hammer first, else the dated inverse; maxHammerFor floors the same inverse', () => {
  assert.equal(inferHammerUsd({ auctionHouse: 'REA', saleDate: '2026-04-15', hammerUsd: 9_000, realizedUsd: 12_300 }), 9_000);
  assert.equal(inferHammerUsd({ auctionHouse: 'REA', saleDate: '2026-04-15', realizedUsd: 12_300 }), 10_000);
  assert.equal(maxHammerFor(12_310, { auctionHouse: 'REA', saleDate: '2026-04-15' }), 10_008);
  // the forward factor on a hammer amount (bid grossing) reads the same day's schedule
  assert.equal(lotAllInFactor({ auctionHouse: 'REA', saleDate: '2026-04-15' }, 10_000), 1.23);
});

test('buyerFields: hammer-basis figures through the dated inverse (REA 2026), unchanged for an undated house', () => {
  const rea = buyerFields({ auctionHouse: 'REA', saleDate: '2026-11-20' }, 12_300, 9_840, 18_450, 11_070);
  assert.equal(rea.expectedHammerUsd, 10_000);
  assert.equal(rea.bandLowUsd, 8_000);
  assert.equal(rea.bandHighUsd, 15_000);
  assert.equal(rea.maxBidUsd, 9_000);
  assert.equal(rea.premiumFactor, 1.23);
  const gol = buyerFields({ auctionHouse: 'Goldin', saleDate: '2026-11-20' }, 12_200, 9_760, 18_300, 10_980);
  assert.equal(gol.expectedHammerUsd, Math.round(12_200 / 1.22));
  assert.equal(gol.maxBidUsd, Math.round(10_980 / 1.22));
  assert.equal(gol.premiumFactor, 1.22);
});
