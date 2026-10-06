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
import { buyerFields, compAllInUsd, resolveComps } from '../../app/lib/value';
import { buildIdf, buildVectors } from '../../app/lib/similarity';
import { titleTokens } from '../../app/lib/normalize';
import type { AuctionLot } from '../../app/types';

test('lotHammerFromAllIn: REA era rates by sale date; undated lots keep the house schedule', () => {
  assert.equal(lotHammerFromAllIn({ auctionHouse: 'REA', saleDate: '2026-04-15' }, 12_300), 10_000); // 23% from Sep 2025
  assert.ok(Math.abs(lotHammerFromAllIn({ auctionHouse: 'REA', saleDate: '2018-04-15' }, 12_000) - 10_000) < 1e-9); // 20%
  assert.ok(Math.abs(lotHammerFromAllIn({ auctionHouse: 'REA', saleDate: '2004-04-15' }, 11_500) - 10_000) < 1e-9); // 15%
  assert.equal(lotHammerFromAllIn({ auctionHouse: 'REA' }, 11_750), 11_750 / houseAllInFactor('REA'));
});

test('lotHammerFromAllIn: a house with no dated schedule converts exactly as the undated factor did', () => {
  for (const h of ['Goldin', 'Bonhams', 'Phillips', 'RR Auction']) {
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

test('compAllInUsd (Oct 6): hammer-basis comps are grossed to all-in at their own sale-date premium; all-in rows untouched', () => {
  // all-in rows (and rows without a basis) pass through
  assert.equal(compAllInUsd({ realizedUsd: 8320, hammerUsd: 6500, priceBasis: 'realized', auctionHouse: 'Bonhams', saleDate: '2026-10-01' }), 8320);
  assert.equal(compAllInUsd({ realizedUsd: 5000, auctionHouse: 'Goldin' }), 5000);
  // a Wright hammer-only row: hammer × the premium in force on its sale date
  const w = { realizedUsd: 15000, hammerUsd: 15000, priceBasis: 'hammer-only', auctionHouse: 'Wright', saleDate: '2004-10-03' };
  assert.equal(compAllInUsd(w), Math.round(15000 * lotAllInFactor(w, 15000) * 100) / 100);
  assert.ok(compAllInUsd(w) > 15000);
  // the struts 'hammer' stamp at REA's 2004 era rate (15%); a stamped premium wins
  assert.equal(compAllInUsd({ realizedUsd: 10000, hammerUsd: 10000, priceBasis: 'hammer', auctionHouse: 'REA', saleDate: '2004-04-15' }), 11500);
  assert.equal(compAllInUsd({ realizedUsd: 10000, priceBasis: 'hammer', auctionHouse: "Hake's", buyerPremiumPct: 20, saleDate: '2026-09-30' }), 12000);
});

test('resolveComps (Oct 6): a hammer-only comp enters the pool grossed to all-in', () => {
  const T = 'Marilyn Monroe (Marilyn) screenprint in colors 1967';
  const mk = (id: string, extra: Record<string, unknown>) => ({
    id, artist: 'andy-warhol', title: T, titleTokens: titleTokens(T), category: 'print',
    auctionHouse: 'Wright', saleDate: '2004-10-03', status: 'sold', ...extra,
  }) as unknown as AuctionLot;
  const lot = mk('t', { status: 'upcoming', saleDate: '2026-11-01' });
  const hammerRow = mk('h', { realizedUsd: 15000, hammerUsd: 15000, priceBasis: 'hammer-only' });
  const allInRow = mk('a', { realizedUsd: 18750, priceBasis: 'realized' });
  // unrelated rows so the shared title words carry idf weight
  const filler = ['Campbell Soup I tomato screenprint 1968', 'Flowers offset lithograph 1964', 'Mao portrait silkscreen 1972', 'Electric Chair screenprint 1971']
    .map((t, i) => ({ ...mk(`f${i}`, { realizedUsd: 1000 }), title: t, titleTokens: titleTokens(t) }) as AuctionLot);
  const all = [lot, hammerRow, allInRow, ...filler];
  const tbl = buildIdf(all);
  buildVectors(all, tbl);
  const comps = resolveComps(lot, [hammerRow, allInRow], tbl);
  assert.equal(comps.length, 2);
  const byId = new Map(comps.map(c => [c.id, c.realizedUsd]));
  assert.equal(byId.get('a'), 18750);
  assert.equal(byId.get('h'), compAllInUsd({ realizedUsd: 15000, hammerUsd: 15000, priceBasis: 'hammer-only', auctionHouse: 'Wright', saleDate: '2004-10-03' }));
});
