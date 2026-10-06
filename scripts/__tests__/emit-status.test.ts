/**
 * The per-house ledger + the status.json contract (scripts/lib/house-status.ts,
 * scripts/emit-status.ts). The /status page renders this JSON — the contract
 * test pins every field the page reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mergeLegRecords, updateLedger, staleHouseKeys, buildStatus, STALE_AFTER_H, type Ledger } from '../lib/house-status';
import * as zlib from 'zlib';
import { readLegRecords, readSegmentSources, segmentLastSeen } from '../emit-status';

const H = (n: number) => n * 3600e3;
const T0 = new Date('2026-10-03T06:00:00Z');

test('mergeLegRecords: crawl record + shrink-gate record for one house → ok is the AND, reasons joined', () => {
  const m = mergeLegRecords([
    { house: 'hakes', ok: true, fetched: 3, parsed: 1984, settled: 0, reason: null },
    { house: 'hakes', ok: false, fetched: 0, parsed: 10, settled: 0, reason: 'per-house shrink gate: settled rows 900 → 10' },
    { house: 'rea', ok: true, reason: 'between sales' },
  ]);
  assert.equal(m.get('hakes')!.ok, false);
  assert.match(m.get('hakes')!.reason!, /shrink gate/);
  assert.equal(m.get('rea')!.ok, true);
});

test('updateLedger: fresh+ok → lastOkAt now; leg ok but segment not handed off → NOT ok; crash → not ok; streak counts', () => {
  const legs = mergeLegRecords([
    { house: 'goldin', ok: true },
    { house: 'rea', ok: true, reason: 'between sales' },
    { house: 'scp', ok: false, reason: '200 grid, 0 parsed' },
  ]);
  const l1 = updateLedger(null, {
    houses: ['goldin', 'rea', 'scp', 'hakes'],
    legs,
    sources: { goldin: 'fresh', rea: 'last-good', scp: 'last-good', hakes: 'last-good' },
    crawled: true, now: T0, runId: '42',
  });
  assert.equal(l1.houses.goldin.ok, true);
  assert.equal(l1.houses.goldin.lastOkAt, T0.toISOString());
  assert.equal(l1.houses.rea.ok, false, 'a refused segment is not a successful crawl');
  assert.match(l1.houses.rea.reason!, /did not land/);
  assert.equal(l1.houses.scp.reason, '200 grid, 0 parsed');
  assert.match(l1.houses.hakes.reason!, /crashed or timed out/);
  assert.equal(l1.houses.hakes.trackedSince, T0.toISOString());
  assert.equal(l1.houses.hakes.failStreak, 1);
  // night 2: hakes still down, goldin ok again
  const t1 = new Date(T0.getTime() + H(24));
  const l2 = updateLedger(l1, { houses: ['goldin', 'hakes'], legs: new Map(), sources: { goldin: 'fresh', hakes: 'last-good' }, crawled: true, now: t1 });
  assert.equal(l2.houses.hakes.failStreak, 2);
  assert.equal(l2.houses.hakes.trackedSince, T0.toISOString(), 'the stale clock never resets on a failure');
  assert.equal(l2.houses.goldin.ok, true, 'fresh segment without a leg record still counts');
  assert.ok(l2.houses.rea, 'houses missing from tonight keep their history');
});

test('bootstrap: a house first seen already dead starts its stale clock at its segment\'s lastSeen (end of day)', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'boot-')), 'hakes.ndjson.gz');
  fs.writeFileSync(f, zlib.gzipSync([{ id: 'a', lastSeen: '2026-09-23' }, { id: 'b', lastSeen: '2026-09-30', firstSeen: '2026-09-01' }].map(r => JSON.stringify(r)).join('\n')));
  const seed = await segmentLastSeen(f);
  assert.equal(seed, '2026-09-30T23:59:59.000Z');
  assert.equal(await segmentLastSeen(f + '.missing'), null);
  const l = updateLedger(null, { houses: ['hakes', 'goldin'], legs: new Map(), sources: { hakes: 'last-good', goldin: 'fresh' }, crawled: true, now: T0, bootstrapSince: { hakes: seed, goldin: null } });
  assert.equal(l.houses.hakes.trackedSince, seed);
  assert.deepEqual(Array.from(staleHouseKeys(l, T0)), ['hakes'], 'already >48h dead on the first night → hidden at once');
  assert.equal(l.houses.goldin.trackedSince, T0.toISOString());
});

test('updateLedger: a skip_crawl night carries every entry forward untouched', () => {
  const l1 = updateLedger(null, { houses: ['goldin'], legs: mergeLegRecords([{ house: 'goldin', ok: true }]), sources: { goldin: 'fresh' }, crawled: true, now: T0 });
  const l2 = updateLedger(l1, { houses: ['goldin'], legs: new Map(), sources: { goldin: 'last-good' }, crawled: false, now: new Date(T0.getTime() + H(5)) });
  assert.deepEqual(l2.houses.goldin, l1.houses.goldin);
});

test('staleHouseKeys: > 48h since the last OK crawl (or since tracking began) is stale; exactly 48h is not', () => {
  const ledger: Ledger = {
    version: 1, updatedAt: T0.toISOString(), houses: {
      goldin: { lastOkAt: T0.toISOString(), lastAttemptAt: null, trackedSince: '2026-09-01T00:00:00Z', ok: true, reason: null, source: 'fresh', failStreak: 0, lastRunId: null },
      hakes: { lastOkAt: '2026-09-23T04:00:00Z', lastAttemptAt: null, trackedSince: '2026-09-01T00:00:00Z', ok: false, reason: 'x', source: 'last-good', failStreak: 9, lastRunId: null },
      lotg: { lastOkAt: null, lastAttemptAt: null, trackedSince: new Date(T0.getTime() - H(STALE_AFTER_H)).toISOString(), ok: false, reason: 'x', source: 'last-good', failStreak: 2, lastRunId: null },
    },
  };
  assert.deepEqual(Array.from(staleHouseKeys(ledger, T0)).sort(), ['hakes']);
  assert.deepEqual(Array.from(staleHouseKeys(ledger, new Date(T0.getTime() + 1000))).sort(), ['hakes', 'lotg']);
  assert.equal(staleHouseKeys(null, T0).size, 0, 'no ledger (bootstrap) hides nothing');
});

test('buildStatus: THE CONTRACT — fields, signal ok vs degraded, staleHidden', () => {
  const ledger = updateLedger(null, {
    houses: ['goldin', 'hakes'], legs: mergeLegRecords([{ house: 'goldin', ok: true }, { house: 'hakes', ok: false, reason: 'login wall' }]),
    sources: { goldin: 'fresh', hakes: 'last-good' }, crawled: true, now: new Date(T0.getTime() - H(72)),
  });
  ledger.houses.goldin.lastOkAt = T0.toISOString();
  const s = buildStatus({
    now: T0, houses: ['goldin', 'hakes'], ledger, runId: '99', engineVersion: 'v1', engineSignal: 'validated',
    stats: { goldin: { rows: 10, sold: 8, live: 2, hiddenLive: 0, lastSaleDate: '2026-10-02' }, hakes: { rows: 5, sold: 0, live: 0, hiddenLive: 5, lastSaleDate: null } },
  });
  assert.deepEqual(Object.keys(s).sort(), ['archives', 'generatedAt', 'houses', 'publish']);
  for (const a of s.archives) for (const k of ['house', 'label', 'kind', 'present', 'rows', 'sold', 'lastSaleDate']) assert.ok(k in a, `archives[].${k}`);
  for (const k of ['lastPublishedAt', 'runId', 'engineVersion', 'signal']) assert.ok(k in s.publish, `publish.${k}`);
  for (const h of s.houses) for (const k of ['house', 'asOf', 'lastSaleDate', 'live', 'ok', 'reason', 'staleHidden']) assert.ok(k in h, `houses[].${k}`);
  const g = s.houses.find(h => h.house === 'goldin')!;
  const k = s.houses.find(h => h.house === 'hakes')!;
  assert.equal(g.ok, true); assert.equal(g.asOf, T0.toISOString()); assert.equal(g.live, 2); assert.equal(g.lastSaleDate, '2026-10-02');
  assert.equal(k.ok, false); assert.equal(k.staleHidden, true); assert.equal(k.hiddenLive, 5); assert.match(k.reason!, /live lots hidden/);
  assert.equal(s.publish.signal, 'degraded');
  assert.deepEqual(s.publish.housesDown, ['hakes']);
  assert.equal(s.publish.runId, '99');

  const allOk = buildStatus({ now: T0, houses: ['goldin'], ledger, stats: null, runId: null, engineVersion: null, engineSignal: 'validated' });
  assert.equal(allOk.publish.signal, 'ok');
  const engineDegraded = buildStatus({ now: T0, houses: ['goldin'], ledger, stats: null, runId: null, engineVersion: null, engineSignal: 'degraded' });
  assert.equal(engineDegraded.publish.signal, 'degraded');
});

test('readLegRecords + readSegmentSources: artifact dirs at any depth, .source markers', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'status-'));
  fs.mkdirSync(path.join(d, 'health-hakes', 'data', 'qa'), { recursive: true });
  fs.writeFileSync(path.join(d, 'health-hakes', 'leg-health.json'), JSON.stringify({ house: 'hakes', ok: true }));
  fs.writeFileSync(path.join(d, 'health-hakes', 'data', 'qa', 'leg-health-gate.json'), JSON.stringify({ house: 'hakes', ok: false, reason: 'gate' }));
  fs.writeFileSync(path.join(d, 'junk.json'), '{not json');
  const recs = readLegRecords(d);
  assert.equal(recs.length, 2);
  assert.equal(mergeLegRecords(recs).get('hakes')!.ok, false);
  const seg = fs.mkdtempSync(path.join(os.tmpdir(), 'segs-'));
  fs.writeFileSync(path.join(seg, '.goldin.source'), 'handoff\n');
  fs.writeFileSync(path.join(seg, '.rea.source'), 'last-good\n');
  assert.deepEqual(readSegmentSources(seg, ['goldin', 'rea', 'scp']), { goldin: 'fresh', rea: 'last-good', scp: 'unknown' });
});
