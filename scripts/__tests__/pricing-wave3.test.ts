/**
 * Pricing fix wave 3 (Oct 6 2026) — the calibration basis gate, the record's
 * engine stamp, the clean-pool read, the lot read figures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  calibrationBasisOf, engineBasis, rowsMissingHammer, mkState, summarizeState, type BacktestState,
  rowsEngineVersionOf, rowsByEngineVersionOf,
} from '../backtest-core';
import { calibrationOnEngineBasis } from '../build-market';
import { setEngineFlags, ENGINE_FLAGS_CURRENT, ENGINE_FLAGS_HOUSE_GATE, ENGINE_FLAGS_COMP_PURITY, ENGINE_VERSION, estimateValueEx, type Comp } from '../../app/lib/value';
import { buildIdf, type Match } from '../../app/lib/similarity';
import { lotMaxBid, lotProjectedClose, cardCompsHammer, lotVerdict } from '../../app/lib/verdict';
import { maxHammerFor } from '../../app/lib/premiums';
import type { AuctionLot } from '../../app/types';

type Row = BacktestState['calObs'][number];
const row = (o: Partial<Row>): Row => ({ r: 1, cr: 1.5, conf: 'medium', m: 'art', ageY: 1, beat: true, ...o } as unknown as Row);

test('calibration basis: hammer only when the engine is on it AND the rows carry the hammer fields', () => {
  setEngineFlags(ENGINE_FLAGS_CURRENT);
  assert.equal(engineBasis(), 'hammer');
  const bare = [row({}), row({})];
  assert.equal(calibrationBasisOf(bare), 'all-in', 'never rehydrated → the odds are all-in');
  const ham = [row({ pc: 1.25, hb: true, hba: false }), row({ pc: 1.25, hb: false, hba: false })];
  assert.equal(calibrationBasisOf(ham), 'hammer');
  assert.equal(calibrationBasisOf([...ham, row({})]), 'all-in', 'a mixed state is not on the hammer');
  const st = mkState(Date.now());
  st.calObs = [...ham, row({})];
  assert.equal(rowsMissingHammer(st), 1);
  setEngineFlags(ENGINE_FLAGS_HOUSE_GATE);
  assert.equal(engineBasis(), 'all-in');
  assert.equal(calibrationBasisOf(ham), 'all-in');
  setEngineFlags(ENGINE_FLAGS_CURRENT);
});

test('summarizeState stamps the calibration basis', () => {
  setEngineFlags(ENGINE_FLAGS_CURRENT);
  const out = summarizeState(mkState(Date.now()), '2026-10-06');
  assert.equal(out.calibration.basis, 'all-in', 'an empty record carries no hammer odds');
});

test('build-market refuses a wrong-basis calibration: re-fit from the state, else uncalibrated — never the all-in odds', () => {
  setEngineFlags(ENGINE_FLAGS_CURRENT);
  const good = { calibration: { basis: 'hammer', beatRate: { global: [1] } }, engineVersion: 'x', generatedAt: 'y' };
  assert.equal(calibrationOnEngineBasis(good, []), good, 'a hammer calibration loads as-is');
  const legacy = { calibration: { beatRate: { global: [1] } }, engineVersion: '2026.10.03-house-gate', generatedAt: 'y' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave3-'));
  const missing = path.join(dir, 'none.json.gz');
  const r = calibrationOnEngineBasis(legacy, [], missing);
  assert.equal(r.calibration, null, 'no state to re-fit from → uncalibrated');
  // a state whose rows cannot be rehydrated (no corpus rows) still fits all-in → refused
  const st = mkState(Date.now());
  st.calObs = [row({ id: 'gone', pf: 0.5, sd: '2025-01-01' } as Partial<Row>)];
  const f = path.join(dir, 'st.json.gz');
  fs.writeFileSync(f, zlib.gzipSync(Buffer.from(JSON.stringify(st))));
  const r2 = calibrationOnEngineBasis(legacy, [], f);
  assert.equal((r2.calibration as { basis?: string } | null)?.basis ?? 'hammer', 'hammer', 'whatever loads is on the engine basis');
  // under the all-in engine the legacy calibration is the right one
  setEngineFlags(ENGINE_FLAGS_HOUSE_GATE);
  assert.equal(calibrationOnEngineBasis(legacy, []), legacy);
  setEngineFlags(ENGINE_FLAGS_CURRENT);
});

test('lot read figures (verdict.ts): max bid = the engine max bid, projection only when validated, card comps on the hammer', () => {
  const base = { id: 'goldin-x', artist: 'sports-cards', title: 't', auctionHouse: 'Goldin', status: 'upcoming', saleDate: '2026-10-10' } as unknown as AuctionLot;
  const val = { compValueUsd: 1250, low: 1000, high: 1600, confidence: 'medium', maxBidUsd: 950, compRatio: null } as unknown as AuctionLot['value'];
  const l = { ...base, value: val } as AuctionLot;
  assert.equal(lotMaxBid(l)!.hammer, 950, 'the engine max bid, not the hammer under value.low');
  assert.ok(lotMaxBid(l)!.allIn > 950);
  assert.equal(lotMaxBid({ ...l, value: { ...val!, confidence: 'low' } } as AuctionLot), null, 'no certified floor → no max bid');
  const card = { ...base, cardComps: { med: 1000, n: 3 } } as unknown as AuctionLot;
  assert.equal(lotMaxBid(card)!.hammer, maxHammerFor(850, card), 'a card-median floor keeps the hammer on it');
  assert.equal(lotProjectedClose({ ...l, bidProj: { g: 1.5, allIn: 2000 } } as AuctionLot), null, 'an unvalidated cell never prints');
  assert.equal(lotProjectedClose({ ...l, bidProj: { g: 1.5, allIn: 2000, ok: true } } as AuctionLot), 2000);
  const cc = { ...base, currentBid: 275, value: { compValueUsd: 458, estimateUsd: 458, low: 400, high: 520, confidence: 'medium', basis: 'card-comp', expectedHammerUsd: 375, vsBid: null } } as unknown as AuctionLot;
  assert.equal(cardCompsHammer(cc), 375, 'the comps HAMMER over a hammer bid');
  assert.equal(cardCompsHammer({ ...cc, value: { ...cc.value!, abstain: 'card:player-median-context-only' } } as AuctionLot), null);
  assert.equal(cardCompsHammer({ ...cc, value: { ...cc.value!, bidFloor: 275 } } as AuctionLot), null, 'a bid-floored value is not a comps figure');
  assert.equal(lotVerdict(l)!.maxBid, 950);
});

// ── the engine (estimateValueEx) ─────────────────────────────────────────
const M = (cosine: number): Match => ({ score: Math.round(cosine * 100), cosine, cls: 'similar', reasons: [] });
const artRow = (id: string, title: string, saleDate: string, o: Record<string, unknown> = {}): AuctionLot =>
  ({ id, title, artist: 'pablo-picasso', category: 'print', status: 'sold', saleDate, ...o } as unknown as AuctionLot);
const artComp = (id: string, title: string, usd: number, saleDate = '2025-12-01', o: Record<string, unknown> = {}): Comp =>
  ({ id, match: M(0.9), realizedUsd: usd, saleDate, lot: artRow(id, title, saleDate, o) });
const artTarget = (title: string, o: Record<string, unknown> = {}): AuctionLot => ({
  id: 't', title, artist: 'pablo-picasso', category: 'print', auctionHouse: 'Phillips', status: 'upcoming',
  saleDate: '2026-09-20', estLowUsd: 80000, estHighUsd: 120000, ...o,
} as unknown as AuctionLot);

test('identity-less art (wave 3): a bare title whose comps span > 20× abstains; a cited / described one does not', () => {
  setEngineFlags(ENGINE_FLAGS_CURRENT);
  const comps = [artComp('a', 'Homme assis', 48000), artComp('b', 'Homme assis', 118000), artComp('c', 'Homme assis', 8_000_000), artComp('d', 'Homme assis', 190000)];
  const r = estimateValueEx(artTarget('Homme assis'), comps, buildIdf([]));
  assert.equal(r.value, null);
  assert.equal(r.abstain, 'identity-less');
  assert.ok(estimateValueEx(artTarget('Homme assis', { medium: 'etching' }), comps, buildIdf([])).value, 'medium evidence names the object');
  setEngineFlags(ENGINE_FLAGS_COMP_PURITY);
  assert.ok(estimateValueEx(artTarget('Homme assis'), comps, buildIdf([])).value, 'the previous engine valued it');
  setEngineFlags(null);
});

test('record stamp: backtest.json names the engine its ROWS came from, not the current engine', () => {
  const rows = [{ ev: '2026.10.03-house-gate' }, { ev: '2026.10.03-house-gate' }, { ev: ENGINE_VERSION }, {}];
  assert.equal(rowsEngineVersionOf(rows), '2026.10.03-house-gate');
  assert.deepEqual(rowsByEngineVersionOf(rows), { '2026.10.03-house-gate': 2, [ENGINE_VERSION]: 1, legacy: 1 });
  assert.equal(rowsEngineVersionOf([]), ENGINE_VERSION);
  const st = mkState(Date.now());
  st.calObs = [row({ ev: '2026.10.03-house-gate' } as Partial<Row>), row({ ev: '2026.10.03-house-gate' } as Partial<Row>)];
  const out = summarizeState(st, '2026-10-06');
  assert.equal(out.engineVersion, '2026.10.03-house-gate');
  assert.equal(out.currentEngineVersion, ENGINE_VERSION);
  assert.equal(out.rowsOnVersionPct, 0);
});
