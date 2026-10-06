/**
 * The demand read (app/lib/demand.ts): ONE hammer-basis primitive shared by
 * the market curve and the sub-market rows, range estimates only, and a
 * trailing window that ends at today for the quarter in progress.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demandSeries, hammerOverEstimatePct, hasRangeEstimate } from '../../app/lib/demand';
import { inferHammerUsd } from '../../app/lib/premiums';
import type { AuctionLot } from '../../app/types';

const lot = (o: Partial<AuctionLot>): AuctionLot => ({
  id: String(Math.random()), artist: 'x', title: 't', status: 'sold', auctionHouse: 'Bonhams',
  saleDate: '2026-05-01', priceUsd: 1250, estimateLow: 800, estimateHigh: 1200, ...o,
} as AuctionLot);

test('hammer basis: published hammer wins, else the house schedule (inferHammerUsd)', () => {
  assert.equal(hammerOverEstimatePct(lot({ hammerUsd: 1500 })), 50);
  const l = lot({});
  const want = (inferHammerUsd(l) / 1000 - 1) * 100;
  assert.ok(Math.abs(hammerOverEstimatePct(l)! - want) < 1e-9);
  // never the all-in figure
  assert.ok(hammerOverEstimatePct(l)! < 25);
});

test('single-figure ("$X+") estimates are floors — dropped from midpoint math', () => {
  const rr = lot({ auctionHouse: 'RR Auction', estimateLow: 500, estimateHigh: null });
  assert.equal(hammerOverEstimatePct(rr), null);
  assert.equal(hasRangeEstimate(rr), false);
  assert.equal(hammerOverEstimatePct(lot({ estimateLow: null, estimateHigh: 900 })), null);
  assert.equal(hasRangeEstimate(lot({})), true);
  // USD money fields win over the legacy aliases
  assert.equal(hammerOverEstimatePct(lot({ hammerUsd: 2000, estLowUsd: 1000, estHighUsd: 3000 })), 0);
});

test('series reads every lot through the same primitive; single-figure lots excluded', () => {
  const lots = [
    ...Array.from({ length: 6 }, () => lot({ hammerUsd: 1100, estimateLow: 900, estimateHigh: 1100 })),
    ...Array.from({ length: 20 }, () => lot({ auctionHouse: 'RR Auction', priceUsd: 5000, estimateLow: 500, estimateHigh: null })),
  ];
  const s = demandSeries(lots, { now: Date.UTC(2026, 5, 30) });
  assert.equal(s.length, 1);
  assert.equal(s[0].n, 6);
  assert.ok(Math.abs(s[0].value - 10) < 1e-9);
});

test('the in-progress quarter reads a true trailing twelve months ending today', () => {
  const now = Date.UTC(2026, 9, 5); // Oct 5 2026, 2026 Q4 in progress
  const lots = [
    // Oct 2025 (inside today's TTM, outside the old Jan 1 → Jan 1 2027 window)
    ...Array.from({ length: 5 }, () => lot({ saleDate: '2025-10-20', hammerUsd: 2000 })),
    // Q4 2026 to date
    ...Array.from({ length: 5 }, () => lot({ saleDate: '2026-10-02', hammerUsd: 1000 })),
    // future-dated row: never in a read
    lot({ saleDate: '2026-12-01', hammerUsd: 9000 }),
  ];
  const s = demandSeries(lots, { now });
  const q4 = s.find(p => p.date === '2026 Q4')!;
  assert.equal(q4.n, 10);
  assert.ok(!s.some(p => p.n === 11));
});
