/**
 * The monthly engine accuracy report (scripts/accuracy-report.ts): the metric
 * math on hand-built fixtures, the joins (pre-sale only, in-window only,
 * hammer basis), the thin-sample rules, the window/args contract, and the
 * trend read of prior reports.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  errStats, rate, cellOf, gradeTape, gradeCallRows, flagsEdge, buildReport, renderMarkdown, parseArgs,
  monthWindow, previousMonth, readPriorReports, tapeRowOfServed, mergeTape, soldInfoOf, headlineOf, flagVerdict,
  MIN_SHOW, MIN_SOLID, type TapeRow, type CallRow, type SoldInfo, type Graded, type Abstention,
} from '../accuracy-report';

const W = { from: '2026-09-01', to: '2026-09-30' };
const sold = (id: string, h: number, o: Partial<SoldInfo> = {}): SoldInfo => ({
  id, status: 'sold', sd: '2026-09-15', r: h * 1.25, h, f: 1.25, estLo: 800, estHi: 1200, market: 'art', house: 'X', ...o,
});
const g = (h: number, predH: number, o: Partial<Graded> = {}): Graded => ({
  id: 'x', src: 'tape', kind: 'path:e', version: 'v1', shadow: false, market: 'art', tier: 'high',
  callDay: '2026-09-01', saleDay: '2026-09-15', h, predH, ...o,
});
const EMPTY_ABST: Abstention = {
  book: { asOf: '2026-10-02', upcoming: 0, valued: 0, abstained: 0, neither: 0, abstainPct: null, reasons: {} },
  settled: { tapeSince: null, eligible: 0, valued: 0, valuedPct: null, byMarket: {} },
};

test('errStats: log-error convention — median abs error, ±30% share, bias', () => {
  // ratios actual/pred: 5 × 1.0, 3 × 2.0, 2 × 0.5 → |ln| = 0×5, ln2×5 → median |ln| = (0 + ln2)/2
  const pairs = [
    ...Array(5).fill({ actual: 100, pred: 100 }),
    ...Array(3).fill({ actual: 200, pred: 100 }),
    ...Array(2).fill({ actual: 50, pred: 100 }),
  ];
  const s = errStats(pairs);
  assert.equal(s.n, 10);
  assert.equal(s.thin, true);                       // 10 < MIN_SOLID
  assert.equal(s.medAbsErrPct, Math.round((Math.exp(Math.log(2) / 2) - 1) * 1000) / 10); // 41.4
  assert.equal(s.within30Pct, 50);                  // only the 5 exact hits
  assert.equal(s.bias, 1);                          // median log ratio: sorted [-ln2,-ln2,0,0,0,0,0,ln2,ln2,ln2] → 0
  // exactly ±30% counts as within
  assert.equal(errStats(Array(10).fill({ actual: 130, pred: 100 })).within30Pct, 100);
});

test('errStats / rate: under MIN_SHOW nothing prints; non-positive pairs are dropped', () => {
  const s = errStats(Array(MIN_SHOW - 1).fill({ actual: 100, pred: 100 }));
  assert.deepEqual([s.medAbsErrPct, s.within30Pct, s.bias, s.thin], [null, null, null, true]);
  assert.equal(errStats([{ actual: 0, pred: 100 }, { actual: 100, pred: 0 }]).n, 0);
  assert.equal(rate(3, 9).pct, null);
  assert.deepEqual(rate(15, 50), { n: 50, thin: false, pct: 30 });
  assert.equal(rate(5, 20).thin, true);
});

test('cellOf: closer-than-house (ties = half), band coverage, max-bid share', () => {
  const rows: Graded[] = [];
  // 10 lots where lectr nails it and the house is 2× off
  for (let i = 0; i < 10; i++) rows.push(g(1000, 1000, { houseMid: 2000, bandLoH: 900, bandHiH: 1100, mb: 1200 }));
  // 10 lots where the house nails it and lectr is 2× off, hammer outside band, above max bid
  for (let i = 0; i < 10; i++) rows.push(g(1000, 2000, { houseMid: 1000, bandLoH: 1500, bandHiH: 2500, mb: 800 }));
  // 10 exact ties, no estimate on 0 of them; no band; no max bid
  for (let i = 0; i < 10; i++) rows.push(g(1000, 1000, { houseMid: 1000 }));
  const c = cellOf(rows);
  assert.equal(c.n, 30);
  assert.equal(c.thin, false);
  assert.equal(c.closer.n, 30);
  assert.equal(c.closer.pct, 50);                  // 10 wins + 10×0.5 ties of 30
  assert.equal(c.band.n, 20);
  assert.equal(c.band.pct, 50);
  assert.equal(c.maxBid.n, 20);
  assert.equal(c.maxBid.pct, 50);
  assert.equal(c.house.n, 30);
  assert.equal(c.lectr.within30Pct, Math.round(1000 * 20 / 30) / 10);
});

test('gradeTape: only lots SOLD in the window ON/AFTER the call day; hammer basis via xh and the served factor', () => {
  const tape: TapeRow[] = [
    // graded: xh is the call; band lo/hi (all-in) ÷ served factor p/xh = 1.25
    { id: 'a', d: '2026-09-01', m: 'art', p: 1250, lo: 1000, hi: 1500, c: 'high', k: 'e', e: 1000, s: 'b', v: 'v1', xh: 1000, mb: 900 },
    // graded: no xh → p ÷ the lot's own factor (1.25)
    { id: 'b', d: '2026-09-01', m: 'design', p: 2500, lo: 0, hi: 0, c: 'low', k: 'n', v: 'v0' },
    // sold before the call → excluded
    { id: 'c', d: '2026-09-20', p: 1000, lo: 0, hi: 0, c: 'low', k: 'e', v: 'v1' },
    // bought in
    { id: 'd', d: '2026-09-01', p: 1000, lo: 0, hi: 0, c: 'low', k: 'e', v: 'v1' },
    // sold outside the window
    { id: 'e', d: '2026-09-01', p: 1000, lo: 0, hi: 0, c: 'low', k: 'e', v: 'v1' },
    // not in the corpus
    { id: 'zz', d: '2026-09-01', p: 1000, lo: 0, hi: 0, c: 'low', k: 'e', v: 'v1' },
    // shadow row (graded, flagged shadow)
    { id: 'a', d: '2026-09-01', p: 1100, lo: 0, hi: 0, c: 'low', k: 'e', v: 'v2', sh: 1 },
  ];
  const m = new Map<string, SoldInfo>([
    ['a', sold('a', 1100)],
    ['b', sold('b', 2000, { estLo: undefined, estHi: undefined, market: 'design' })],
    ['c', sold('c', 1000)],
    ['d', sold('d', 0, { status: 'bought_in', r: 0 })],
    ['e', sold('e', 1000, { sd: '2026-10-02' })],
  ]);
  const { graded, counts } = gradeTape(tape, m, W);
  assert.equal(counts.graded, 3);
  assert.equal(counts.soldBeforeCall, 1);
  assert.equal(counts.boughtIn, 1);
  assert.equal(counts.notInCorpus, 1);
  const a = graded.find(x => x.id === 'a' && !x.shadow)!;
  assert.equal(a.predH, 1000);
  assert.equal(a.houseMid, 1000);                  // tape e wins
  assert.equal(a.bandLoH, 800);
  assert.equal(a.bandHiH, 1200);
  assert.equal(a.mb, 900);
  assert.equal(a.signal, 'b');
  const b = graded.find(x => x.id === 'b')!;
  assert.equal(b.predH, 2000);                     // 2500 ÷ 1.25
  assert.equal(b.houseMid, undefined);
  assert.equal(graded.filter(x => x.shadow).length, 1);
});

test('gradeCallRows: all-in calls → hammer through the lot factor; house mid from the corpus estimate', () => {
  const calls: CallRow[] = [
    { id: 'a', d: '2026-09-01', k: 'card', p: 1250, s: 'x', m: 'sports' },
    { id: 'b', d: '2026-09-01', k: 'vsbid', p: 500 },
    { id: 'gone', d: '2026-09-01', k: 'card', p: 100, r: 120, sd: '2026-09-10' },
  ];
  const m = new Map<string, SoldInfo>([['a', sold('a', 1000)], ['b', sold('b', 400)]]);
  const { graded, counts } = gradeCallRows(calls, m, W);
  assert.equal(counts.graded, 2);
  assert.equal(counts.notInCorpus, 1);
  const a = graded.find(x => x.id === 'a')!;
  assert.equal(a.predH, 1000);
  assert.equal(a.houseMid, 1000);
  assert.equal(a.tier, 'x');
  assert.equal(a.market, 'sports');
  assert.equal(graded.find(x => x.id === 'b')!.tier, '-');
});

test('flagsEdge: flagged vs unflagged realized/estimate and beat-high; edge only when both sides print', () => {
  const rows: Graded[] = [];
  for (let i = 0; i < 12; i++) rows.push(g(1500, 1000, { path: 'e', signal: 'b', houseMid: 1000, estHi: 1200 }));
  for (let i = 0; i < 12; i++) rows.push(g(900, 1000, { path: 'e', signal: 'a', houseMid: 1000, estHi: 1200 }));
  for (let i = 0; i < 12; i++) rows.push(g(1000, 1000, { path: 'n', signal: 'b', houseMid: 1000 })); // not an estimate-path lot
  const f = flagsEdge(rows);
  assert.equal(f.flagged.n, 12);
  assert.equal(f.flagged.medRealizedOverEst, 1.5);
  assert.equal(f.flagged.beatHighPct, 100);
  assert.equal(f.unflagged.medRealizedOverEst, 0.9);
  assert.equal(f.unflagged.beatHighPct, 0);
  assert.equal(f.edgeRatio, 0.6);
  assert.equal(f.edgeBeatHighPt, 100);
  assert.equal(f.above.n, 12);
  assert.equal(flagsEdge(rows.slice(0, 12)).edgeRatio, null); // no unflagged side
});

test('window + args: default = previous calendar month; partial when cut short or not over; one month only', () => {
  const now = new Date('2026-10-02T07:23:00Z');
  assert.equal(previousMonth(now), '2026-09');
  assert.equal(previousMonth(new Date('2026-01-02T00:00:00Z')), '2025-12');
  assert.deepEqual(monthWindow('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  const d = parseArgs([], now, '/r');
  assert.equal(d.month, '2026-09');
  assert.deepEqual(d.window, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(d.partial, false);
  assert.equal(d.outDir, '/r/docs/accuracy');
  assert.equal(d.snapshotDir, null);
  const p = parseArgs(['--from', '2026-10-01', '--to', '2026-10-31'], now, '/r');
  assert.equal(p.month, '2026-10');
  assert.equal(p.partial, true);
  assert.equal(p.window.to, '2026-10-02');         // clipped to today
  assert.throws(() => parseArgs(['--from', '2026-09-20', '--to', '2026-10-05'], now), /one calendar month/);
  assert.throws(() => parseArgs(['--month', '2026-9'], now), /YYYY-MM/);
});

test('served snapshot → tape row, and first call wins on merge (tape row on a tie)', () => {
  const t = tapeRowOfServed({
    id: 7, status: 'upcoming', artist: 'kaws', estimateLow: 1000, estimateHigh: 3000,
    value: { compValueUsd: 2500.4, low: 2000, high: 3200, confidence: 'medium', signal: { label: 'below comparable market' }, expectedHammerUsd: 2000, maxBidUsd: 1800, engineVersion: 'v9' },
  }, '2026-09-20')!;
  assert.equal(t.id, '7');
  assert.equal(t.k, 'e');
  assert.equal(t.e, 2000);
  assert.equal(t.s, 'b');
  assert.equal(t.p, 2500);
  assert.equal(t.xh, 2000);
  assert.equal(t.v, 'v9');
  assert.equal(t.rc, 1);
  assert.equal(tapeRowOfServed({ id: 1, value: null }, '2026-09-20'), null);
  assert.equal(tapeRowOfServed({ id: 1, value: { compValueUsd: 10, basis: 'card-comp' } }, '2026-09-20')!.k, 'c');
  const tape: TapeRow[] = [{ id: '7', d: '2026-10-03', p: 1, lo: 0, hi: 0, c: 'low', k: 'e', v: 'v9' }, { id: '8', d: '2026-10-03', p: 1, lo: 0, hi: 0, c: 'low', k: 'e', v: 'v9' }];
  const later = { ...t, id: '8', d: '2026-10-03' };
  const merged = mergeTape(tape, [t, later]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(r => r.id === '7')!.d, '2026-09-20'); // the earlier snapshot claim wins
  assert.equal(merged.find(r => r.id === '8')!.rc, undefined);   // same-day tie: the real tape row
});

test('soldInfoOf: published hammer wins, else realized ÷ the lot premium', () => {
  const a = soldInfoOf({ id: 'a', status: 'sold', saleDate: '2026-09-03T18:00:00Z', realizedUsd: 1270, hammerUsd: 1000, artist: 'kaws' });
  assert.deepEqual([a.h, a.f, a.sd, a.status], [1000, 1.27, '2026-09-03', 'sold']);
  const b = soldInfoOf({ id: 'b', status: 'sold', saleDate: '2026-09-03', realizedUsd: 1250, buyerPremiumPct: 25 });
  assert.equal(b.h, 1000);
  assert.equal(soldInfoOf({ id: 'c', status: 'bought_in', saleDate: '2026-09-03' }).h, 0);
});

test('buildReport + renderMarkdown: thin samples are labelled, empty months render, trend keeps the last 3 prior months', () => {
  const tape: TapeRow[] = [];
  const m = new Map<string, SoldInfo>();
  for (let i = 0; i < 12; i++) {
    tape.push({ id: `t${i}`, d: '2026-09-01', m: 'art', p: 1250, lo: 1000, hi: 1500, c: 'high', k: 'e', e: 1000, v: 'v1', xh: 1000, mb: 900 });
    m.set(`t${i}`, sold(`t${i}`, 1000 + i * 10));
  }
  const prior = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-10'].map(month => ({ month, partial: false, headline: headlineOf({ tape: { overall: cellOf([]), flags: flagsEdge([]) } as never, calls: { byKind: {} } as never }) }));
  const r = buildReport({ month: '2026-09', window: W, partial: false, now: new Date('2026-10-02T07:23:00Z'), tape, calls: [], sold: m, abstention: EMPTY_ABST, prior, sources: { x: 'y' } });
  assert.equal(r.tape.overall.n, 12);
  assert.equal(r.tape.overall.thin, true);
  assert.deepEqual(r.trend.map(t => t.month), ['2026-08', '2026-07', '2026-06']);
  assert.equal(r.headline.tapeGraded, 12);
  const md = renderMarkdown(r);
  assert.match(md, /# Engine accuracy report: September 2026/);
  assert.match(md, /\*\(thin\)\*/);
  assert.match(md, /HAMMER/);
  assert.match(md, /n 12, thin/);
  // an empty month still renders, with no throw and an honest line
  const empty = buildReport({ month: '2026-09', window: W, partial: true, now: new Date('2026-09-10T00:00:00Z'), tape: [], calls: [], sold: new Map(), abstention: EMPTY_ABST, prior: [], sources: {} });
  const emd = renderMarkdown(empty);
  assert.match(emd, /value tape is EMPTY/);
  assert.match(emd, /PARTIAL window/);
  assert.match(emd, /This is the first/);
  assert.ok(MIN_SOLID > MIN_SHOW);
});

test('readPriorReports: only schema-1 month JSONs strictly before the report month', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
  const h = { tapeGraded: 5 };
  fs.writeFileSync(path.join(dir, '2026-07.json'), JSON.stringify({ schema: 1, partial: false, headline: h }));
  fs.writeFileSync(path.join(dir, '2026-08.json'), JSON.stringify({ schema: 1, partial: true, headline: h }));
  fs.writeFileSync(path.join(dir, '2026-09.json'), JSON.stringify({ schema: 1, headline: h }));
  fs.writeFileSync(path.join(dir, '2026-06.json'), '{not json');
  fs.writeFileSync(path.join(dir, 'README.json'), '{}');
  const got = readPriorReports(dir, '2026-09');
  assert.deepEqual(got.map(x => [x.month, x.partial]), [['2026-07', false], ['2026-08', true]]);
  assert.deepEqual(readPriorReports(path.join(dir, 'nope'), '2026-09'), []);
});

test('flagVerdict: a sub-0.02× gap is FLAT, not "held"; a reversed gap says so', () => {
  const grp = { n: 50, thin: false, medRealizedOverEst: 1, beatHighPct: 40 };
  const f = (edgeRatio: number | null, edgeBeatHighPt: number | null) => ({ flagged: grp, unflagged: grp, above: grp, at: grp, none: grp, edgeRatio, edgeBeatHighPt });
  assert.match(flagVerdict(f(0.001, 8.7)), /^Flat .*still favours flagged/);
  assert.match(flagVerdict(f(-0.01, -2)), /^Flat .*does not favour/);
  assert.equal(flagVerdict(f(0.1, 5)), 'The direction held.');
  assert.match(flagVerdict(f(-0.1, 5)), /did NOT hold/);
  assert.equal(flagVerdict(f(null, null)), '');
});

test('renderMarkdown trend table: union of call products across months; older reports missing newer fields print "—"', () => {
  const r = buildReport({
    month: '2026-10', window: { from: '2026-10-01', to: '2026-10-31' }, partial: false, now: new Date('2026-11-02T07:23:00Z'),
    tape: [], calls: [], sold: new Map(), abstention: EMPTY_ABST, sources: {},
    prior: [{ month: '2026-09', partial: false, headline: { tapeGraded: 7, tapeMedAbsErrPct: 50, calls: { card: { graded: 100, medAbsErrPct: 120, within30Pct: 20, bias: 1.4, closerPct: null } } } as never }],
  });
  const md = renderMarkdown(r);
  assert.match(md, /\| month \| tape graded .* card graded \/ med err \|/);
  assert.match(md, /\| 2026-09 \| 7 \| 50% \| — \| — \|.*\| 100 \/ 120% \|/);
  assert.match(md, /^\| 2026-10 \| 0 \|.*\| — \|$/m);
});
