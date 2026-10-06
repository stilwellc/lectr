/**
 * scripts/backtest-core.ts — the published record's AGGREGATION (the numbers
 * /value, /about and the receipts print from backtest.json): which rows land
 * in which cell, never how a row is scored.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordByMarketOf, isAboveObs, unsoldCapturedCells, unsoldCellKey, summarizeRows, capturedHeadlineOf, mkState, mergeStates,
  type CalObs, type L, type BiObs,
} from '../backtest-core';

const row = (o: Partial<CalObs>): CalObs => ({ m: 'art', cr: 1, beat: false, r: 1, conf: 'low', ageY: 1, et: 'b', pf: 0, fl: false, ...o });

test('isAboveObs: the stamped call wins; legacy rows recover it from the flag ratio', () => {
  assert.equal(isAboveObs(row({ ab: true, cr: 1.1 })), true);
  assert.equal(isAboveObs(row({ ab: false, cr: 0.5 })), false);
  assert.equal(isAboveObs(row({ cr: 0.7 })), true, 'cr <= 0.75 with no fr');
  assert.equal(isAboveObs(row({ cr: 0.7, fr: 0.9 })), false, 'fr (house-normalized) is the flag ratio when present');
  assert.equal(isAboveObs(row({ cr: 0.5, fl: true })), false, 'a below call is never above');
});

test('recordByMarketOf: range-estimate lots only; above calls never counted as unflagged; single-figure separate', () => {
  const rows: CalObs[] = [];
  for (let i = 0; i < 60; i++) rows.push(row({ fl: true, pf: 0.5 }));            // flagged, range
  for (let i = 0; i < 60; i++) rows.push(row({ pf: 0.1, cr: 1 }));               // at market
  for (let i = 0; i < 60; i++) rows.push(row({ pf: -0.2, cr: 0.6 }));            // above market
  for (let i = 0; i < 70; i++) rows.push(row({ fl: true, pf: 2, et: 'p' }));     // single-figure flagged
  const r = recordByMarketOf(rows).art;
  assert.deepEqual(r.flagged, { n: 60, medPct: 50 }, 'single-figure rows stay out of the headline-population cell');
  assert.deepEqual(r.unflagged, { n: 60, medPct: 10 }, 'above-market rows are not unflagged');
  assert.deepEqual(r.above, { n: 60, medPct: -20 });
  assert.deepEqual(r.singleFigure.flagged, { n: 70, medPct: 200 });
  assert.equal(r.singleFigure.unflagged.n, 0);
});

test('recordByMarketOf: a cell under 50 rows publishes no median', () => {
  const r = recordByMarketOf([row({ fl: true, pf: 1 })]).art;
  assert.deepEqual(r.flagged, { n: 1, medPct: null });
});

test('recordByMarketOf with a captured scope: headline cells only, bought-ins in the median, sold-only kept aside', () => {
  const rows: CalObs[] = [];
  for (let i = 0; i < 40; i++) rows.push(row({ h: 'Bonhams', sd: '2024-05-01', fl: true, pf: 0.5 }));
  for (let i = 0; i < 40; i++) rows.push(row({ h: "Christie's", sd: '2024-05-01', fl: true, pf: 1 }));
  const bi: BiObs[] = [];
  for (let i = 0; i < 30; i++) bi.push({ m: 'art', h: 'Bonhams', sd: '2024-05-02', lab: 'F', id: `b${i}` });
  const r = recordByMarketOf(rows, { cells: new Set(['Bonhams|2024Q2']), bi }).art;
  assert.equal(r.flagged.n, 40);
  assert.equal(r.flagged.nBoughtIn, 30);
  assert.equal(r.flagged.medPct, 50, '70 concluded: 30 failures + 40 at +50%, upper median is +50');
  assert.equal(r.soldOnly!.flagged.n, 80);
});

// ── unsold capture (Oct 6) ──
const lot = (house: string, sd: string, status: string, est = true): L =>
  ({ id: `${house}-${sd}-${Math.random()}`, artist: 'x', auctionHouse: house, saleDate: sd, status, ...(est ? { estLowUsd: 100, estHighUsd: 200 } : {}) } as unknown as L);

test('unsoldCapturedCells: a house x quarter counts only when its bought-ins are really there', () => {
  const lots: L[] = [];
  for (let i = 0; i < 100; i++) lots.push(lot("Christie's", '2024-05-01', 'sold'));       // sold-only crawl
  lots.push(lot("Christie's", '2024-05-02', 'bought_in'));                                 // one stray
  for (let i = 0; i < 80; i++) lots.push(lot('Bonhams', '2024-05-01', 'sold'));
  for (let i = 0; i < 20; i++) lots.push(lot('Bonhams', '2024-06-01', 'bought_in'));       // 20%
  for (let i = 0; i < 200; i++) lots.push(lot('Phillips', '2024-02-01', 'sold'));
  for (let i = 0; i < 4; i++) lots.push(lot('Phillips', '2024-02-01', 'bought_in'));       // 2% < 3%
  for (let i = 0; i < 9; i++) lots.push(lot('Bonhams', '2024-08-01', 'bought_in', false)); // no range estimate: not a target
  assert.deepEqual(unsoldCapturedCells(lots), ['Bonhams|2024Q2']);
  assert.equal(unsoldCellKey('Bonhams', '2024-06-30'), 'Bonhams|2024Q2');
});

test('summarizeRows: a bought-in is a failed outcome on the concluded basis; *Sold fields keep survivors only', () => {
  const sold = [0.5, 0.6, 0.7].map(pf => row({ fl: true, pf, hp: pf - 0.2, beat: pf > 0.55, hb: false }));
  const r = summarizeRows(sold, 2);
  assert.equal(r.n, 3);
  assert.equal(r.nBoughtIn, 2);
  assert.equal(r.failToSellPct, 40);
  assert.equal(r.medianPerfPct, 50, 'median of [-100, -100, 50, 60, 70]');
  assert.equal(r.hammerMedianPct, 30);
  assert.equal(r.medianSoldPct, 60);
  assert.equal(r.beatHighPct, 40, '2 beats of 5 concluded');
  assert.equal(r.beatHighSoldPct, 67);
  assert.equal(r.hammerBeatPct, 0);
});

test('capturedHeadlineOf: only rows + bought-ins inside captured cells; no rows → null (sold-only fallback)', () => {
  const st = mkState(Date.now());
  st.unsoldCells = ['Bonhams|2024Q2'];
  st.calObs.push(row({ h: 'Bonhams', sd: '2024-05-01', fl: true, pf: 0.4 }));
  st.calObs.push(row({ h: "Christie's", sd: '2024-05-01', fl: true, pf: 3 }));          // survivor-only cell
  st.calObs.push(row({ h: 'Bonhams', sd: '2024-05-01', fl: true, pf: 3, et: 'p' }));    // single-figure
  st.bi = [{ m: 'art', h: 'Bonhams', sd: '2024-04-02', lab: 'F', t: 'main', id: 'a' }, { m: 'art', h: "Christie's", sd: '2024-04-02', lab: 'F', id: 'b' }];
  const c = capturedHeadlineOf(st)!;
  assert.equal(c.flagged.n, 1);
  assert.equal(c.flagged.nBoughtIn, 1);
  assert.equal(c.flagged.failToSellPct, 50);
  assert.equal(capturedHeadlineOf({ ...st, biComplete: false }), null);
  assert.equal(capturedHeadlineOf({ ...st, unsoldCells: [] }), null);
});

test('mergeStates: bought-in rows concatenate, cells union, completeness only if every leg is complete', () => {
  const a = mkState(1), b = mkState(2);
  a.bi!.push({ m: 'art', sd: '2024-01-01', lab: 'U', id: 'x' }); a.unsoldCells = ['A|2024Q1'];
  b.unsoldCells = ['A|2024Q1', 'B|2024Q1'];
  const m = mergeStates([a, b]);
  assert.equal(m.bi!.length, 1);
  assert.deepEqual(m.unsoldCells, ['A|2024Q1', 'B|2024Q1']);
  assert.equal(m.biComplete, true);
  b.biComplete = false;
  assert.equal(mergeStates([a, b]).biComplete, false);
});
