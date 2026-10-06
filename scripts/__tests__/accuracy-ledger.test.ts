/**
 * The live accuracy ledger (scripts/accuracy-ledger.ts) on fixture tapes: the
 * point-in-time pick (last serve ON/BEFORE the sale, never after — the
 * lookahead guard), the tape's last-served state (build-market-tape `L`),
 * unsold lots under the captured-cell rule, the engine-version split, the
 * drift thresholds (warn-only), the append-only daily rows, idempotence, and
 * the settlement scan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  servesOf, lastServeBefore, gradeLedger, ledgerCell, driftOf, mergeDaily, buildLedger, dailyRowsOf, scanSettlements,
  DRIFT, RESTATE_DAYS, type LedgerLot, type DailyRow,
} from '../accuracy-ledger';
import { appendValueTape, readValueTape } from '../build-market-tape';
import { gzipNdjson } from '../corpus-io';
import type { TapeRow, SoldInfo, Graded } from '../accuracy-report';
import type { AuctionLot } from '../../app/types';

const AS_OF = '2026-10-20';
const row = (id: string, d: string, o: Partial<TapeRow> = {}): TapeRow => ({
  id, d, m: 'art', p: 1250, lo: 1000, hi: 1500, c: 'medium', k: 'e', e: 1000, xh: 1000, v: 'v1', ...o,
});
const sold = (id: string, sd: string, h: number, o: Partial<SoldInfo> = {}): SoldInfo => ({
  id, status: 'sold', sd, r: h * 1.25, h, f: 1.25, estLo: 800, estHi: 1200, market: 'art', house: 'HouseA', ...o,
});
const NO_CELLS = new Set<string>();

test('lookahead guard: the LAST serve on or before the sale day is graded; later serves never are', () => {
  const tape = [
    row('a', '2026-10-01', { xh: 1000, v: 'v1' }),
    row('a', '2026-10-05', { xh: 2000, v: 'v2' }),        // served AFTER the sale below
    row('b', '2026-10-09', { xh: 900 }),                  // every serve after its sale
  ];
  const serves = servesOf(tape);
  assert.equal(lastServeBefore(serves.get('a')!, '2026-10-03')!.xh, 1000);
  assert.equal(lastServeBefore(serves.get('a')!, '2026-10-05')!.xh, 2000);   // same day counts (the record's convention)
  const soldMap = new Map([['a', sold('a', '2026-10-03', 1000)], ['b', sold('b', '2026-10-04', 900)]]);
  const { lots, counts } = gradeLedger(serves, soldMap, NO_CELLS, AS_OF);
  assert.equal(counts.graded, 1);
  assert.equal(counts.lookahead, 1);
  assert.equal(lots[0].g!.predH, 1000);
  assert.equal(lots[0].version, 'v1');
});

test('last served state: a row\'s L is a later serve; one dated after the sale is ignored; shadow rows never serve', () => {
  const t = row('a', '2026-10-01', { xh: 1000, L: { d: '2026-10-04', p: 1500, lo: 1200, hi: 1800, c: 'high', k: 'e', xh: 1200 } });
  const shadow = row('a', '2026-10-03', { xh: 5000, v: 'cand', sh: 1 });
  const serves = servesOf([t, shadow]);
  assert.equal(serves.get('a')!.length, 2);                 // first + L, no shadow
  const g = (sd: string) => gradeLedger(serves, new Map([['a', sold('a', sd, 1200)]]), NO_CELLS, AS_OF).lots[0];
  assert.equal(g('2026-10-06').g!.predH, 1200);              // the last change
  assert.equal(g('2026-10-06').tier, 'high');
  assert.equal(g('2026-10-02').g!.predH, 1000);              // L postdates this sale → the first serve
  // within a day the later tape position wins (the tape is appended in run order)
  const sameDay = servesOf([row('c', '2026-10-02', { xh: 10, v: 'v1' }), row('c', '2026-10-02', { xh: 20, v: 'v2' })]);
  assert.equal(lastServeBefore(sameDay.get('c')!, '2026-10-02')!.xh, 20);
  // a backfill snapshot serve loses a same-day tie to the real tape row
  const snap = servesOf([row('d', '2026-10-02', { xh: 30 })], [row('d', '2026-10-02', { xh: 99, v: 'snap' })]);
  assert.equal(lastServeBefore(snap.get('d')!, '2026-10-02')!.xh, 30);
});

test('unsold: bought-in counts as a failed outcome only inside captured cells, never in price error', () => {
  const tape = [
    row('in', '2026-10-01', { s: 'b', o: 70 }), row('out', '2026-10-01', { s: 'b', o: 70 }),
    row('hit', '2026-10-01', { s: 'b', o: 70 }),
  ];
  const soldMap = new Map<string, SoldInfo>([
    ['in', sold('in', '2026-10-05', 0, { status: 'bought_in', r: 0, house: 'HouseA' })],
    ['out', sold('out', '2026-10-05', 0, { status: 'bought_in', r: 0, house: 'HouseB' })],
    ['hit', sold('hit', '2026-10-05', 1500, { house: 'HouseA' })],   // beats the 1,200 high
  ]);
  const { lots, counts } = gradeLedger(servesOf(tape), soldMap, new Set(['HouseA|2026Q4']), AS_OF);
  assert.equal(counts.unsoldCounted, 1);
  assert.equal(counts.unsoldUncaptured, 1);
  assert.equal(counts.graded, 1);
  const c = ledgerCell(lots, true);
  assert.equal(c.n, 1);                    // only the sold lot is priced
  assert.equal(c.unsold, 1);
  assert.deepEqual([c.flags.n, c.flags.hits], [2, 1]);   // the bought-in flag is a miss
  assert.equal(c.odds.n, 2);
  // a lot with no estimate has nothing to beat: no flag/odds outcome
  const noEst = gradeLedger(servesOf([row('x', '2026-10-01', { s: 'b', o: 70 })]),
    new Map([['x', sold('x', '2026-10-05', 900, { estLo: undefined, estHi: undefined })]]), NO_CELLS, AS_OF).lots[0];
  assert.equal(noEst.beat, null);
});

test('engine-version split: each lot is graded under the version of its last pre-sale serve', () => {
  const tape: TapeRow[] = [];
  const soldMap = new Map<string, SoldInfo>();
  for (let i = 0; i < 12; i++) {
    tape.push(row(`a${i}`, '2026-10-01', { v: 'v1' }), row(`a${i}`, '2026-10-06', { v: 'v2' }));
    soldMap.set(`a${i}`, sold(`a${i}`, i < 5 ? '2026-10-03' : '2026-10-08', 1000));
  }
  const l = buildLedger({ tape, sold: soldMap, capturedCells: NO_CELLS, asOf: AS_OF, now: new Date('2026-10-20T12:00:00Z') });
  const bv = l.rollups['30'].byVersion;
  assert.deepEqual([bv.v1.n, bv.v2.n], [5, 7]);
  assert.deepEqual(l.versions, ['v1', 'v2']);
  assert.equal(l.daily.find(r => r.d === '2026-10-08')!.v.v2, 7);
  // a sale stamped after asOf is not settled yet
  const later = buildLedger({ tape, sold: soldMap, capturedCells: NO_CELLS, asOf: '2026-10-07', now: new Date() });
  assert.equal(later.counts.graded, 5);
});

// ── drift ──
const lot = (sd: string, h: number, predH: number, o: Partial<Graded> = {}, market = 'art'): LedgerLot => ({
  id: `${sd}-${h}-${predH}-${Math.random()}`, saleDay: sd, market, house: 'H', version: 'v1', tier: 'medium', sold: true, flagged: false, beat: null,
  g: { id: 'x', src: 'tape', kind: 'path:e', version: 'v1', shadow: false, market, tier: 'medium', callDay: sd, saleDay: sd, h, predH, bandLoH: predH * 0.8, bandHiH: predH * 1.25, ...o },
});
test('drift: band coverage under 72% warns at n ≥ 30, not below it', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => lot('2026-10-10', i % 2 ? 1000 : 2000, 1000));  // 50% inside the band
  const d = driftOf(mk(DRIFT.minN), AS_OF);
  assert.ok(d.some(x => x.metric === 'bandCoverage' && x.scope === 'art'));
  assert.ok(d.some(x => x.metric === 'bandCoverage' && x.scope === 'all'));
  assert.equal(driftOf(mk(DRIFT.minN - 1), AS_OF).length, 0);
  // 75% inside the band: no coverage warning
  const ok = Array.from({ length: 40 }, (_, i) => lot('2026-10-10', i % 4 === 0 ? 1100 * 1.5 : 1000, 1000));
  assert.ok(!driftOf(ok, AS_OF).some(x => x.metric === 'bandCoverage'));
});
test('drift: error worsening > 20% vs the prior 30 days, and bias outside 0.85–1.18', () => {
  // prior 30 days: |err| 10% · current: 15% (1.5×) → warns; 11.5% (1.15×) → does not
  const prior = Array.from({ length: 30 }, (_, i) => lot('2026-09-10', i % 2 ? 1100 : 1000 / 1.1, 1000));
  const worse = Array.from({ length: 30 }, (_, i) => lot('2026-10-10', i % 2 ? 1150 : 1000 / 1.15, 1000));
  const mild = Array.from({ length: 30 }, (_, i) => lot('2026-10-10', i % 2 ? 1115 : 1000 / 1.115, 1000));
  const w = driftOf([...prior, ...worse], AS_OF).find(x => x.metric === 'errorWorsened' && x.scope === 'art');
  assert.ok(w && w.value > 1.2, JSON.stringify(w));
  assert.ok(!driftOf([...prior, ...mild], AS_OF).some(x => x.metric === 'errorWorsened'));
  // no prior window at n ≥ 30 → no comparison
  assert.ok(!driftOf(worse, AS_OF).some(x => x.metric === 'errorWorsened'));
  // bias: everything sells 1.25× the call → outside; 1.1× → inside
  const hi = Array.from({ length: 30 }, () => lot('2026-10-10', 1250, 1000, { bandHiH: 2000 }));
  assert.ok(driftOf(hi, AS_OF).some(x => x.metric === 'bias' && x.value === 1.25));
  const fine = Array.from({ length: 30 }, () => lot('2026-10-10', 1100, 1000));
  assert.ok(!driftOf(fine, AS_OF).some(x => x.metric === 'bias'));
  // per market: a thin market does not warn even when the whole book does
  const thin = Array.from({ length: 10 }, () => lot('2026-10-10', 3000, 1000, {}, 'watches'));
  assert.ok(!driftOf([...hi, ...thin], AS_OF).some(x => x.scope === 'watches'));
});

test('daily rows: append-only — frozen beyond the restate horizon, restated inside it, idempotent', () => {
  const old = '2026-09-01', recent = '2026-10-15';
  const prior: DailyRow[] = [
    { d: old, n: 99, u: 0, mae: 5, w30: 90, bias: 1, w30n: 89, bandHit: 70, bandN: 99, houseMae: 4, flagN: 0, flagHit: 0, oddsN: 0, brierSum: 0, v: { v0: 99 }, m: { art: 99 } },
    { d: recent, n: 1, u: 0, mae: null, w30: null, bias: null, w30n: 1, bandHit: 1, bandN: 1, houseMae: null, flagN: 0, flagHit: 0, oddsN: 0, brierSum: 0, v: { v0: 1 }, m: { art: 1 } },
  ];
  const tonight = dailyRowsOf([lot(old, 1000, 1000), lot(recent, 1000, 1000), lot(recent, 1000, 1000)]);
  const merged = mergeDaily(prior, tonight, AS_OF);
  assert.equal(merged.find(r => r.d === old)!.n, 99);       // frozen (older than RESTATE_DAYS)
  assert.equal(merged.find(r => r.d === recent)!.n, 2);     // restated
  assert.ok(Date.parse(AS_OF) - Date.parse(old) > RESTATE_DAYS * 864e5);
  // a lost tape night: nothing recomputed, the frozen history survives
  assert.deepEqual(mergeDaily(prior, [], AS_OF).map(r => r.d), [old]);
  // rerunning the same night on its own output changes nothing
  const tape = [row('a', '2026-10-01'), row('b', '2026-10-02', { xh: 800 })];
  const soldMap = new Map([['a', sold('a', '2026-10-03', 1100)], ['b', sold('b', '2026-10-04', 1000)]]);
  const now = new Date('2026-10-20T12:00:00Z');
  const first = buildLedger({ tape, sold: soldMap, capturedCells: NO_CELLS, asOf: AS_OF, now });
  const again = buildLedger({ tape, sold: soldMap, capturedCells: NO_CELLS, asOf: AS_OF, now, prior: JSON.parse(JSON.stringify(first)) });
  assert.deepEqual(again, first);
});

test('the tape records odds, house factor and the LAST changed serve (first serve never moves)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-tape-'));
  const file = path.join(dir, 'value-tape.json.gz');
  const mkLot = (p: number, br = 62) => ({
    id: 'x1', status: 'upcoming', artist: 'kaws', estLowUsd: 800, estHighUsd: 1200,
    value: { compValueUsd: p, low: p * 0.8, high: p * 1.3, confidence: 'medium', signal: { label: 'below market', beatRatePct: br }, expectedHammerUsd: p / 1.25, houseFactor: 1.1 },
  }) as unknown as AuctionLot;
  const shadowOf = (p: number) => ({ version: 'cand', values: new Map([['x1', { compValueUsd: p, low: p, high: p, confidence: 'low' }]]) });
  appendValueTape([mkLot(1250)], '2026-10-01', { kaws: 'art' }, 'v1', new Set(), file, shadowOf(1));
  let [r, sh] = readValueTape(file);
  assert.deepEqual([r.o, r.hf, r.L], [62, 1.1, undefined]);
  assert.equal(sh.sh, 1);
  // same night again: no-op · next night unchanged: no L
  appendValueTape([mkLot(1250)], '2026-10-01', { kaws: 'art' }, 'v1', new Set(), file);
  appendValueTape([mkLot(1250)], '2026-10-02', { kaws: 'art' }, 'v1', new Set(), file);
  [r] = readValueTape(file);
  assert.equal(r.L, undefined);
  // changed serve → L carries it; the first serve stays
  const res = appendValueTape([mkLot(2500, 70)], '2026-10-03', { kaws: 'art' }, 'v1', new Set(), file, shadowOf(9));
  assert.equal(res.lastUpdated, 1);
  [r, sh] = readValueTape(file);
  assert.deepEqual([r.p, r.d, r.L!.p, r.L!.d, r.L!.o, r.L!.xh], [1250, '2026-10-01', 2500, '2026-10-03', 70, 2000]);
  assert.equal(sh.L, undefined);                              // shadow rows never get a last serve
  // a new version starts its own row (first wins per version)
  appendValueTape([mkLot(3000)], '2026-10-04', { kaws: 'art' }, 'v2', new Set(), file);
  const rows = readValueTape(file);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].L!.d, '2026-10-03');                   // v1's row no longer moves
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scanSettlements: joins served lots (settled row wins) and finds unsold-captured cells', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-scan-'));
  const rows: Record<string, unknown>[] = [
    { id: 'a', status: 'sold', saleDate: '2026-10-05', auctionHouse: 'HouseA', realizedUsd: 1250, hammerUsd: 1000, estLowUsd: 800, estHighUsd: 1200, artist: 'kaws' },
    { id: 'b', status: 'upcoming', saleDate: '2026-10-25', auctionHouse: 'HouseA', artist: 'kaws' },
  ];
  // HouseA Q4: 20 sold + 4 bought-in range-estimate lots → captured; HouseB: sold only
  for (let i = 0; i < 20; i++) rows.push({ id: `s${i}`, status: 'sold', saleDate: '2026-10-02', auctionHouse: 'HouseA', realizedUsd: 100, estLowUsd: 80, estHighUsd: 120 });
  for (let i = 0; i < 4; i++) rows.push({ id: `bi${i}`, status: 'bought_in', saleDate: '2026-10-02', auctionHouse: 'HouseA', estLowUsd: 80, estHighUsd: 120 });
  for (let i = 0; i < 20; i++) rows.push({ id: `t${i}`, status: 'sold', saleDate: '2026-10-02', auctionHouse: 'HouseB', realizedUsd: 100, estLowUsd: 80, estHighUsd: 120 });
  fs.writeFileSync(path.join(dir, 'lots.json.gz'), gzipNdjson(rows));
  fs.writeFileSync(path.join(dir, 'sold-archive.json.gz'), gzipNdjson([{ id: 'b', status: 'other' }]));
  const r = await scanSettlements([path.join(dir, 'lots.json.gz'), path.join(dir, 'sold-archive.json.gz')], new Set(['a', 'b', 'zz']), '2026-10-01');
  assert.deepEqual([r.sold.get('a')!.h, r.sold.get('a')!.status, r.sold.get('b')!.status], [1000, 'sold', 'other']);
  assert.equal(r.sold.has('zz'), false);
  assert.deepEqual(Array.from(r.capturedCells), ['HouseA|2026Q4']);
  fs.rmSync(dir, { recursive: true, force: true });
});
