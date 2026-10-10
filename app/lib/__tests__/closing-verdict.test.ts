/**
 * The reader's-clock close labels (closing.ts), the per-house freshness
 * contract parse (house-status.ts) and the lot verdict frame (verdict.ts).
 * Oct 3 2026 honesty pass.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { closeMs, closeShort, closeWord, closesWithin, isOpen } from '../closing';
import { houseAsOfMap, parseStatus, staleHouses } from '../house-status';
import { lotVerdict, fmtUsd } from '../verdict';
import type { AuctionLot } from '../../types';
import { isLiveUpcoming } from '../../utils';

const H = 3_600_000;

test('a timed lot closes at its stamped instant, by the minute', () => {
  const close = Date.parse('2026-10-05T03:00:00.000Z');
  const lot = { status: 'upcoming', saleDate: '2026-10-04', saleDateTime: '2026-10-05T03:00:00.000Z' };
  assert.equal(closeMs(lot), close);
  assert.equal(isOpen(lot, close - 1), true);
  assert.equal(isOpen(lot, close), false);
  assert.equal(closeWord(lot, close - 5 * H), 'closes in 5h');
  assert.equal(closeShort(lot, close - 30 * 60_000), '30m');
  assert.equal(closeWord(lot, close + 1), 'closed');
  assert.equal(closesWithin(lot, close - 47 * H), true);
  assert.equal(closesWithin(lot, close - 49 * H), false);
});

test('a bare-midnight UTC stamp is day-only: open through the end of that day where the sale is held', () => {
  const lot = { status: 'upcoming', saleDate: '2026-11-19', saleDateTime: '2026-11-19T00:00:00.000Z', auctionHouse: 'Wright' };
  // Wright is Chicago: Nov 19 ends at 05:59:59.999Z Nov 20 (CST)
  const endOfDay = Date.parse('2026-11-20T05:59:59.999Z');
  assert.equal(closeMs(lot), endOfDay);
  assert.equal(closeWord(lot, new Date(2026, 10, 19, 9).getTime()), 'today');
  assert.equal(closeWord(lot, new Date(2026, 10, 18, 9).getTime()), 'tomorrow');
  assert.equal(closeWord(lot, new Date(2026, 10, 15, 9).getTime()), 'in 4d');
  assert.equal(isOpen(lot, Date.parse('2026-11-20T05:59:00Z')), true);
  assert.equal(isOpen(lot, Date.parse('2026-11-20T06:01:00Z')), false);
});

test('results-pending lots past their close are closed, never live', () => {
  const lot = { status: 'upcoming', saleDate: '2026-10-01', resultsPending: true };
  assert.equal(isOpen(lot, new Date(2026, 9, 3, 12).getTime()), false);
  assert.equal(closeWord(lot, new Date(2026, 9, 3, 12).getTime()), 'closed');
});

test('isLiveUpcoming: a lot past its close never counts as live', () => {
  const close = Date.parse('2026-10-05T15:00:00.000Z');
  const timed = { status: 'upcoming', saleDate: '2026-10-05', saleDateTime: '2026-10-05T15:00:00.000Z' };
  assert.equal(isLiveUpcoming(timed, '2026-10-05', 1, close - 1), true);
  assert.equal(isLiveUpcoming(timed, '2026-10-05', 1, close), false);
  // results pending past the day's end: closed, the grace never resurrects it
  const pending = { status: 'upcoming', saleDate: '2026-10-04', resultsPending: true };
  assert.equal(isLiveUpcoming(pending, '2026-10-05', 1, new Date(2026, 9, 5, 9).getTime()), false);
  // a day-only lot is live through its own day
  const dayOnly = { status: 'upcoming', saleDate: '2026-10-05' };
  assert.equal(isLiveUpcoming(dayOnly, '2026-10-05', 1, new Date(2026, 9, 5, 22).getTime()), true);
});

test('status.json parses defensively; absent houses fall back to lastSeen', () => {
  assert.equal(parseStatus(null), null);
  assert.equal(parseStatus('nope'), null);
  const st = parseStatus({ generatedAt: '2026-10-03T00:00:00Z', publish: { runId: 7 }, houses: [{ house: 'Wright', asOf: '2026-10-02T10:00:00Z', live: 3 }, { bad: 1 }] });
  assert.ok(st);
  assert.equal(st!.houses.length, 1);
  assert.equal(st!.publish!.runId, '7');
  const map = houseAsOfMap(st, [{ auctionHouse: "Hake's", lastSeen: '2026-09-30' }, { auctionHouse: 'Wright', lastSeen: '2026-09-01' }]);
  assert.equal(map.get('Wright'), '2026-10-02T10:00:00Z'); // status wins over lastSeen
  assert.equal(map.get("Hake's"), '2026-09-30');
  const now = Date.parse('2026-10-03T12:00:00Z');
  assert.deepEqual(staleHouses(map, ['Wright', "Hake's"], now).map(s => s.house), ["Hake's"]);
});

test('the verdict headline is the expected HAMMER vs the estimate, max bid = the engine max bid only', () => {
  const lot = {
    id: 'wright-415133', artist: 'pablo-picasso', auctionHouse: 'Wright', status: 'upcoming',
    estimateLow: 5000, estimateHigh: 5000,
    value: { poolIds: Array(10).fill('x'), n: 43, compValueUsd: 8185, low: 5009, high: 16451, compRatio: 3.584,
      signal: { label: 'below comparable market', strength: 'strong', beatRatePct: 73 }, estimateUsd: null, vsBid: null,
      confidence: 'medium', exact: null, compMedianUsd: 17920 },
  } as unknown as AuctionLot;
  const v = lotVerdict(lot)!;
  assert.equal(v.expected, 6548);           // 8185 all-in ÷ Wright's 1.25
  assert.equal(v.vsEstPct, 31);
  assert.equal(v.bandLo, 4007);             // the 5009 low ÷ 1.25
  // (wave 4) no engine max bid on the value → none printed (the page used
  // to derive one from the floor); with it, exactly the engine's
  assert.equal(v.maxBid, null);
  assert.equal(lotVerdict({ ...lot, value: { ...lot.value!, maxBidUsd: 4500 } } as AuctionLot)!.maxBid, 4500);
  assert.equal(v.flagged, true);
  assert.equal(fmtUsd(v.expected), '$6.5K');
  // a data-fault ratio never resurrects as a forecast
  assert.equal(lotVerdict({ ...lot, value: { ...lot.value!, compRatio: 12 } } as AuctionLot), null);
});
