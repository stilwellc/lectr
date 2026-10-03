/**
 * The STALE-HOUSE rule (hideStaleHouseLive in corpus-normalize, wired through
 * assemble's readStaleHouses + computeHouseStats): a house with no successful
 * crawl in > 48h has its live lots hidden from every served live set — never
 * deleted, and lifted by itself when the house crawls OK again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hideStaleHouseLive } from '../lib/corpus-normalize';
import { computeHouseStats, readStaleHouses } from '../assemble';
import { isServedUpcoming } from '../corpus-io';

const NOW = new Date('2026-10-03T06:00:00Z');
const lot = (o: Record<string, unknown>): any => ({ id: 'x', artist: 'memorabilia', title: 't', category: 'object', saleDate: '2026-10-10', status: 'upcoming', ...o });

test('hideStaleHouseLive: only the stale house\'s upcoming lots are demoted; nothing is removed; idempotent', () => {
  const lots = [
    lot({ id: 'h1', auctionHouse: "Hake's", resultsPending: true }),
    lot({ id: 'h2', auctionHouse: "Hake's", status: 'sold', priceUsd: 500, saleDate: '2026-09-20' }),
    lot({ id: 'r1', auctionHouse: 'REA' }),
    lot({ id: 'w1', auctionHouse: 'LAMA' }), // rides the wright segment
  ];
  const r = hideStaleHouseLive(lots, new Set(['hakes', 'wright']));
  assert.equal(lots.length, 4, 'never deleted');
  assert.deepEqual(r, { total: 2, byHouse: { hakes: 1, wright: 1 } });
  const h1 = lots.find(l => l.id === 'h1');
  assert.equal(h1.status, 'unknown-result');
  assert.equal(h1.staleHidden, true);
  assert.equal(h1.resultsPending, false);
  assert.equal(h1.compExclude, 'stale-house');
  assert.equal(isServedUpcoming(h1, NOW), false, 'out of the served live set');
  assert.equal(lots.find(l => l.id === 'h2').status, 'sold', 'settled history untouched');
  assert.equal(lots.find(l => l.id === 'r1').status, 'upcoming', 'a healthy house untouched');
  assert.equal(hideStaleHouseLive(lots, new Set(['hakes', 'wright'])).total, 0, 'idempotent');
  assert.equal(hideStaleHouseLive(lots, new Set()).total, 0);
});

test('readStaleHouses: ledger → stale set; a missing or corrupt ledger hides nothing', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  const f = path.join(d, 'house-ledger.json');
  assert.equal(readStaleHouses(f, NOW).size, 0);
  fs.writeFileSync(f, '{oops');
  assert.equal(readStaleHouses(f, NOW).size, 0);
  fs.writeFileSync(f, JSON.stringify({
    version: 1, updatedAt: NOW.toISOString(), houses: {
      hakes: { lastOkAt: '2026-09-23T04:00:00Z', trackedSince: '2026-09-01T00:00:00Z', ok: false },
      rea: { lastOkAt: '2026-10-02T05:00:00Z', trackedSince: '2026-09-01T00:00:00Z', ok: true },
    },
  }));
  assert.deepEqual(Array.from(readStaleHouses(f, NOW)), ['hakes']);
});

test('computeHouseStats: live counts the served set AFTER the hide; lastSaleDate ignores future dates', () => {
  const lots = [
    lot({ id: 'h1', auctionHouse: "Hake's" }),
    lot({ id: 'r1', auctionHouse: 'REA' }),
    lot({ id: 'r2', auctionHouse: 'REA', status: 'sold', saleDate: '2026-09-30', priceUsd: 10 }),
    lot({ id: 'r3', auctionHouse: 'REA', status: 'sold', saleDate: '2027-01-01', priceUsd: 10 }),
  ];
  hideStaleHouseLive(lots, new Set(['hakes']));
  const s = computeHouseStats(lots, NOW);
  assert.deepEqual(s.hakes, { rows: 1, sold: 0, live: 0, hiddenLive: 1, lastSaleDate: null });
  assert.deepEqual(s.rea, { rows: 3, sold: 2, live: 1, hiddenLive: 0, lastSaleDate: '2026-09-30' });
});
