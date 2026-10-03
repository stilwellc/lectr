/**
 * Ops decision tables: the publish-missed / per-house issue plans, the
 * double-run guard, the cron-trigger Worker's schedule, and the engine-gate
 * replay (incl. the tripwire that keeps gate-thresholds.ts honest).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { planPublish, planHouse } from '../ci/ops-issues.mjs';
import { shouldSkip } from '../ci/run-guard.mjs';
import { plan, SCHEDULE, dispatch } from '../../workers/cron-trigger/src/index';
import { replayReport, replayAll, applyOverrides, type ValidateReport } from '../ci/gate-replay';
import { CURRENT_GATE } from '../ci/gate-thresholds';

test('publish issue: opens only on a missed SCHEDULED night, comments while open, closes on any publish', () => {
  assert.equal(planPublish({ published: false, scheduled: true, open: false }), 'open');
  assert.equal(planPublish({ published: false, scheduled: true, open: true }), 'comment');
  assert.equal(planPublish({ published: false, scheduled: false, open: false }), 'none', 'a manual recovery run never pages');
  assert.equal(planPublish({ published: true, scheduled: false, open: true }), 'close');
  assert.equal(planPublish({ published: true, scheduled: true, open: false }), 'none');
});

test('house issue: open when down, rewrite while down, close when ok', () => {
  assert.equal(planHouse({ ok: false, open: false }), 'open');
  assert.equal(planHouse({ ok: false, open: true }), 'update');
  assert.equal(planHouse({ ok: true, open: true }), 'close');
  assert.equal(planHouse({ ok: true, open: false }), 'none');
});

test('run guard: the GitHub-cron fallback skips when a cron-worker run started inside the window', () => {
  const now = Date.parse('2026-10-03T05:00:00Z');
  const runs = [
    { id: 2, display_title: 'Nightly · schedule', created_at: '2026-10-03T04:58:00Z', conclusion: null },
    { id: 1, display_title: 'Nightly · cron-worker', created_at: '2026-10-03T04:17:05Z', conclusion: null },
  ];
  assert.equal(shouldSkip({ runs, nowMs: now, currentId: 2, windowH: 20, event: 'schedule', trigger: '' }).skip, true);
  // manual runs never skip
  assert.equal(shouldSkip({ runs, nowMs: now, currentId: 3, windowH: 20, event: 'workflow_dispatch', trigger: 'manual' }).skip, false);
  // a cancelled worker run does not count; nor one outside the window
  assert.equal(shouldSkip({ runs: [{ ...runs[1], conclusion: 'cancelled' }], nowMs: now, currentId: 2, windowH: 20, event: 'schedule', trigger: '' }).skip, false);
  assert.equal(shouldSkip({ runs: [{ ...runs[1], created_at: '2026-10-02T04:17:00Z' }], nowMs: now, currentId: 2, windowH: 20, event: 'schedule', trigger: '' }).skip, false);
  // the worker run itself is not skipped by itself
  assert.equal(shouldSkip({ runs: [runs[1]], nowMs: now, currentId: 1, windowH: 20, event: 'workflow_dispatch', trigger: 'cron-worker' }).skip, false);
});

test('cron-trigger: wrangler.toml crons == SCHEDULE keys; each maps to a real workflow with trigger=cron-worker', async () => {
  const toml = fs.readFileSync(path.join(__dirname, '..', '..', 'workers', 'cron-trigger', 'wrangler.toml'), 'utf8');
  const crons = JSON.parse(toml.match(/crons\s*=\s*(\[[^\]]*\])/)![1]);
  assert.deepEqual([...crons].sort(), Object.keys(SCHEDULE).sort());
  for (const c of crons) {
    for (const d of plan(c)) {
      assert.ok(fs.existsSync(path.join(__dirname, '..', '..', '.github', 'workflows', d.workflow)), d.workflow);
      assert.equal(d.inputs.trigger, 'cron-worker');
      const wf = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', d.workflow), 'utf8');
      assert.match(wf, /trigger:\s*\n\s*description/, `${d.workflow} declares the trigger input`);
    }
  }
  assert.deepEqual(plan('0 0 * * *'), []);
  // dispatch: no token → refuses without calling out; 204 → ok
  assert.equal((await dispatch({}, plan('17 4 * * *')[0])).ok, false);
  let called = '';
  const fake = (async (url: string, init: { body: string }) => { called = `${url} ${init.body}`; return new Response(null, { status: 204 }); }) as unknown as typeof fetch;
  const r = await dispatch({ GITHUB_DISPATCH_TOKEN: 't' }, plan('17 4 * * *')[0], fake);
  assert.equal(r.ok, true);
  assert.match(called, /stilwellc\/lectr\/actions\/workflows\/nightly\.yml\/dispatches .*"ref":"main".*cron-worker/);
});

const report = (over: Partial<ValidateReport> = {}): ValidateReport => ({
  generatedAt: '2026-10-01T11:00:00Z', coveragePct: 60, failures: [], warnings: [],
  global: { buckets: { '<0.6': { beat: 430, n: 1000 }, '0.6-0.9': { beat: 370, n: 1000 }, '0.9-1.3': { beat: 450, n: 1000 }, '1.3-2': { beat: 520, n: 1000 }, '>2': { beat: 600, n: 1000 } } },
  byMarket: {},
  ...over,
});

test('gate replay: the Sep 29 G1 dip — warn under CURRENT, flips to FAIL when proposed dipBlocks=true', () => {
  const r = report();
  assert.equal(replayReport(r, CURRENT_GATE).failures.length, 0);
  assert.equal(replayReport(r, CURRENT_GATE).signal, 'degraded');
  const proposed = applyOverrides(CURRENT_GATE, ['g1.dipBlocks=true']);
  const [row] = replayAll([r], CURRENT_GATE, proposed);
  assert.equal(row.flips, true);
  assert.equal(row.proposed, 'FAIL');
  assert.throws(() => applyOverrides(CURRENT_GATE, ['g9.nope=1']), /unknown threshold/);
  // G5 failures are carried, not recomputed
  assert.match(replayReport(report({ failures: ['G5 live estimate lots: biased'] }), CURRENT_GATE).failures.join(), /G5 carried/);
});

test('TRIPWIRE: validate-engine.ts thresholds still match scripts/ci/gate-thresholds.ts (change both + attach a gate replay)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate-engine.ts'), 'utf8');
  const must = [
    `const MIN_N = ${CURRENT_GATE.minN};`,
    `Math.max(${CURRENT_GATE.dipFloorPt}, ${CURRENT_GATE.dipSe} * se)`,
    `g.spread < ${CURRENT_GATE.g1.spreadMin}) failures.push`,
    `if (!g.ok) ${CURRENT_GATE.g1.dipBlocks ? 'failures' : 'warnings'}.push`,
    `mono.spread < ${CURRENT_GATE.g2.spreadMin}) failures.push`,
    `if (!mono.ok) ${CURRENT_GATE.g2.dipBlocks ? 'failures' : 'warnings'}.push`,
    `hi >= ${CURRENT_GATE.g3.highMaxMedErr}) failures.push`,
    `coveragePct < ${CURRENT_GATE.g4.minCoveragePct}) failures.push`,
  ];
  const missing = must.filter(m => !src.includes(m));
  assert.deepEqual(missing, [], 'validate-engine.ts gate changed — update scripts/ci/gate-thresholds.ts to match AND run `npx tsx scripts/ci/gate-replay.ts --r2 --gh --set …` (docs/RUNBOOK.md "Engine-gate policy")');
});
