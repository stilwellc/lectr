/**
 * The bid rooms' close multiples, refit nightly (scripts/lib/close-k-fit.ts →
 * public/data/ray/close-k.json → app/lib/close-k.ts setCloseK): a measured
 * cell is shrunk toward its parent, a thin cell IS its parent, the room's
 * drift moves its thin cells, the table never dips below 1 or shrinks with
 * time to close, the archive snapshot round-trips into observations, and a
 * missing or malformed served file leaves the compiled table in force.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fitCloseK, diffCloseK, obsFromBidHistory, obsFromSnaps, snapFromBook, soldIndex, writeSnap, readSnapDir, refitCloseK, CLOSE_K_N0, type CloseKObs } from '../lib/close-k-fit';
import { CLOSE_K_DEFAULT, CLOSE_K_MIN_N, setCloseK, resetCloseK, closeKOf, closeKSource } from '../../app/lib/close-k';
import { prioStatic } from '../../app/lib/priority';

/** n lots in one cell, each closing at `mult` × its bid */
const cell = (room: string, days: number, bid: number, mult: number, n: number, tag = ''): CloseKObs[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${room}-${tag}${days}-${bid}-${i}`, room, days, bid, h: bid * mult }));

test('a well-measured cell lands near its data, shrunk toward the parent by n0', () => {
  // goldin-elite <1d $1–10K: compiled 2.57. 400 lots closing at 3.0× — the room
  // has data only here, so its drift is this cell's residual (shrunk), and the
  // cell blends data (n=400) with the drifted parent (n0=25)
  const t = fitCloseK(cell('goldin-elite', 0.5, 5_000, 3.0, 400));
  const f = t.rooms['goldin-elite'];
  assert.equal(f.src[0][2], 'fit');
  assert.equal(f.n[0][2], 400);
  const drift = Math.log(3.0 / 2.57) * 400 / 450;
  const want = Math.exp((400 * Math.log(3.0) + CLOSE_K_N0 * (Math.log(2.57) + drift)) / (400 + CLOSE_K_N0));
  assert.ok(Math.abs(f.k[0][2] - want) < 0.011, `${f.k[0][2]} vs ${want}`);
  assert.ok(f.k[0][2] > 2.9 && f.k[0][2] < 3.0);
});

test('a thin cell (n < minN) falls back to its parent: compiled × the room drift', () => {
  const obs = [
    ...cell('rea', 0.5, 500, 1.32 * 1.2, 200),   // REA close night, $100–1K: 20% over compiled
    ...cell('rea', 10, 50, 50, CLOSE_K_MIN_N - 1), // a wild but THIN cell
  ];
  const f = fitCloseK(obs).rooms.rea;
  assert.equal(f.src[3][0], 'parent');
  assert.equal(f.n[3][0], CLOSE_K_MIN_N - 1);
  // the thin cell ignores its own 50× and follows the room's level
  const drift = f.drift;
  assert.ok(drift > 0.1 && drift < Math.log(1.2));
  assert.ok(Math.abs(f.k[3][0] - Math.round(2.75 * Math.exp(drift) * 100) / 100) < 0.011, `${f.k[3][0]}`);
  // a room with no data at all is the compiled table exactly
  const none = fitCloseK(obs).rooms.rr;
  assert.deepEqual(none.k, CLOSE_K_DEFAULT.rr);
  assert.equal(none.drift, 0);
  assert.ok(none.src.flat().every(s => s === 'parent'));
});

test('a lot counts once per cell however many snapshots it has there', () => {
  // one lot with 300 sightings at 10× in a cell + 30 lots at 2× → median of lots = 2×
  const one: CloseKObs[] = Array.from({ length: 300 }, () => ({ id: 'spam', room: 'nfl', days: 2, bid: 500, h: 5_000 }));
  const f = fitCloseK([...one, ...cell('nfl', 2, 500, 2, 30)]).rooms.nfl;
  assert.equal(f.n[1][1], 31);
  assert.ok(f.k[1][1] < 2.2, `${f.k[1][1]}`);
});

test('never below 1, never shrinking with time to close', () => {
  const obs = [
    ...cell('memory-lane', 0.5, 50_000, 0.5, 100), // hammer under the bid (data error) → floor 1
    ...cell('memory-lane', 2, 50_000, 3, 100),
    ...cell('memory-lane', 5, 50_000, 1.1, 100),   // a dip further out → carried up
  ];
  const k = fitCloseK(obs).rooms['memory-lane'].k;
  for (const row of k) for (const x of row) assert.ok(x >= 1);
  for (let b = 0; b < 5; b++) for (let d = 1; d < 5; d++) assert.ok(k[d][b] >= k[d - 1][b], `band ${b} day ${d}`);
  assert.ok(k[2][3] >= k[1][3]);
});

test('drift is clamped to ×/÷ 2 so a broken night cannot run the table away', () => {
  const f = fitCloseK(cell('hakes', 0.5, 500, 1.62 * 50, 500)).rooms.hakes;
  assert.ok(f.drift <= Math.log(2) + 1e-9);
  assert.ok(f.k[4][4] <= Math.round(1.11 * 2 * 100) / 100 + 0.01);
});

test('the archive snapshot round-trips: book → snapshot file → sightings joined to sold rows', () => {
  const book = [
    { id: 'gw-1', auctionHouse: 'Goldin', saleName: 'Goldin Weekly', artist: 'sports-cards', currentBid: 200, bidCount: 4, saleDateTime: '2026-10-12T02:00:00Z', saleDate: '2026-10-11', status: 'upcoming' },
    { id: 'eur-1', auctionHouse: 'Goldin', saleName: 'Goldin Weekly', currency: 'EUR', currentBid: 200, saleDateTime: '2026-10-12T02:00:00Z', saleDate: '2026-10-11', status: 'upcoming' },
    { id: 'chr-1', auctionHouse: "Christie's", currentBid: 2000, saleDate: '2026-10-12', status: 'upcoming' },
    { id: 'nobid', auctionHouse: 'REA', currentBid: 0, saleDate: '2026-10-12', status: 'upcoming' },
  ];
  const snap = snapFromBook('2026-10-09T12:00:00Z', book);
  assert.equal(snap.rows.length, 1);
  assert.equal(snap.rows[0][4], 'goldin-weekly');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closek-'));
  writeSnap(path.join(dir, 'snaps', '20261009T120000Z-1.json.gz'), snap);
  const back = readSnapDir(path.join(dir, 'snaps'));
  assert.deepEqual(back, [snap]);
  const sold = [
    { id: 'gw-1', auctionHouse: 'Goldin', saleName: 'Goldin Weekly', status: 'sold', hammerPrice: 900, priceUsd: 1_080, saleDateTime: '2026-10-12T02:00:00Z', saleDate: '2026-10-11' },
  ];
  const obs = obsFromSnaps(back, soldIndex(sold, new Set(['gw-1'])));
  assert.equal(obs.length, 1);
  assert.equal(obs[0].h, 900);
  assert.ok(Math.abs(obs[0].days - 2.5833) < 0.01);
  // a rescheduled close (sold 5 days off the snapshot's close) is dropped
  const moved = obsFromSnaps(back, soldIndex([{ ...sold[0], saleDateTime: '2026-10-17T02:00:00Z', saleDate: '2026-10-16' }], new Set(['gw-1'])));
  assert.equal(moved.length, 0);
  // a last-tracked-bid "sale" is not an outcome
  assert.equal(soldIndex([{ ...sold[0], priceBasis: 'last-tracked-bid' }], new Set(['gw-1'])).size, 0);
});

test('bidHistory sightings: date-only stamps read at 12:00Z, beyond 45d dropped', () => {
  const lot = { id: 'g1', auctionHouse: 'Goldin', saleName: 'Goldin Elite', status: 'sold', hammerPrice: 10_000, saleDateTime: '2026-10-10T03:00:00Z', saleDate: '2026-10-09',
    bidHistory: [{ d: '2026-08-01', b: 100, n: 1 }, { d: '2026-10-05', b: 2_000, n: 9 }, { d: '2026-10-09T20:00:00Z', b: 5_000, n: 20 }] };
  const obs = obsFromBidHistory([lot, { ...lot, id: 'u1', status: 'upcoming' }]);
  assert.equal(obs.length, 2);
  assert.ok(Math.abs(obs[0].days - (4 + 15 / 24)) < 1e-6);
  assert.ok(Math.abs(obs[1].days - 7 / 24) < 1e-6);
  assert.equal(obs[0].room, 'goldin-elite');
});

test('diff names every cell that moved ≥5% against last night', () => {
  const a = fitCloseK([]);
  const b = fitCloseK(cell('nfl', 0.5, 50, 2, 300));
  const d = diffCloseK(a, b);
  assert.ok(d.moved >= 1);
  assert.ok(d.lines.some(l => l.startsWith('nfl <1d <$100: 1.08 →')), d.lines.join('\n'));
  assert.equal(diffCloseK(b, b).moved, 0);
  // the compiled grid map works as the baseline too
  assert.ok(diffCloseK(CLOSE_K_DEFAULT, b).moved >= 1);
});

test('refitCloseK writes close-k.json from the corpus + archive and never throws', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closek-'));
  const served = path.join(dir, 'served'); fs.mkdirSync(served);
  const t = refitCloseK([], served, { dir });
  assert.ok(t);
  const j = JSON.parse(fs.readFileSync(path.join(served, 'close-k.json'), 'utf8'));
  assert.equal(j.v, 1);
  assert.deepEqual(j.rooms['goldin-weekly'].k, CLOSE_K_DEFAULT['goldin-weekly']);
  assert.equal(refitCloseK(null as unknown as [], served, { dir }), null); // a bad input → warning, null
});

test('client: a fitted table moves the anchor; missing/malformed keeps the compiled table', () => {
  const NOW = Date.parse('2026-10-08T12:00:00Z');
  const lot = { id: 'x', auctionHouse: 'NFL Auction', artist: 'game-used', subCat: 'game-used', currentBid: 1_000, saleDateTime: new Date(NOW + 12 * 3_600_000).toISOString(), saleDate: '2026-10-09' };
  resetCloseK();
  assert.equal(closeKSource(), 'compiled');
  assert.equal(prioStatic(lot, NOW)!.a, 1_000 * 1.14);
  for (const bad of [null, {}, { v: 2, rooms: {} }, { v: 1, rooms: { nfl: { k: [[1, 2]] } } }, { v: 1, rooms: { nfl: { k: CLOSE_K_DEFAULT.nfl.map(r => r.map(() => 0.5)) } } }, 'nope']) {
    assert.equal(setCloseK(bad), false, JSON.stringify(bad));
    assert.equal(closeKSource(), 'compiled');
    assert.equal(closeKOf('nfl', 0.5, 1_000), 1.14);
  }
  const fitted = fitCloseK(cell('nfl', 0.5, 2_000, 2, 400));
  assert.equal(setCloseK(JSON.parse(JSON.stringify(fitted))), true);
  assert.equal(closeKSource(), 'fitted');
  assert.ok(prioStatic(lot, NOW)!.a > 1_000 * 1.8);
  // a room the file lacks keeps its compiled row
  assert.equal(setCloseK({ v: 1, rooms: { nfl: fitted.rooms.nfl } }), true);
  assert.equal(closeKOf('rea', 0.5, 500), CLOSE_K_DEFAULT.rea[0][1]);
  resetCloseK();
});
