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
} from '../backtest-core';
import { calibrationOnEngineBasis } from '../build-market';
import { setEngineFlags, ENGINE_FLAGS_CURRENT, ENGINE_FLAGS_HOUSE_GATE } from '../../app/lib/value';

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
