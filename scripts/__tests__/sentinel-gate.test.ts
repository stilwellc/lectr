/**
 * Sentinel price-bleed gate — decision table.
 *
 * Run: RAY_SKIP_MAIN=1 npx tsx scripts/__tests__/sentinel-gate.test.ts
 *
 * WHY THIS EXISTS: the absolute form of this gate (`poison.length >= 2` → abort,
 * fdd9791, Sep 2 2026) blocked EVERY nightly publish for a week — 18,797 crawled
 * lots stranded, the live site frozen on a Sep 2 corpus, and because the corpus
 * went stale the close-board intraday leg found nothing closing and stopped
 * moving prices too. The fixture below is the REAL 82-signature set from the
 * Sep 9 production run (run 34344044788), so these cases are not hypothetical:
 * case 1 is literally "would last night have published under the new gate".
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { sentinelVerdict, type SentinelSignature } from '../assemble';

const REAL: SentinelSignature[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'sentinel-fixture.json'), 'utf8'),
);
const keyOf = (s: SentinelSignature) => `${s.house}|${s.price}`;
const baselineOf = (sigs: SentinelSignature[]) => new Map(sigs.map(s => [keyOf(s), s.n]));
const sig = (o: Partial<SentinelSignature>): SentinelSignature => ({
  house: 'TestHouse', price: 1234, n: 20, top: 18, topDate: '2026-09-09', hammer: 1000, honest: false, ...o,
});

let passed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${(e as Error).message}`); process.exitCode = 1; }
}

console.log(`sentinel gate — ${REAL.length} real production signatures as the fixture\n`);

// ── the regression this whole change exists to prevent ────────────────────
check('the standing 82-signature book publishes when it matches the baseline', () => {
  const v = sentinelVerdict(REAL, baselineOf(REAL));
  assert.strictEqual(v.abort, false, 'must NOT abort on the standing set');
  assert.strictEqual(v.freshPoison.length, 0);
  assert.strictEqual(v.poison.length, 82, 'all 82 are still REPORTED as poison, just not gating');
});

check('the OLD absolute rule would have aborted on that same set (proves the fixture is the wedge)', () => {
  const poison = REAL.filter(s => !s.honest);
  assert.ok(poison.length >= 2, 'old rule: >=2 poison aborts — this is what broke the pipeline');
});

// ── it must still catch a genuinely broken crawler ────────────────────────
check('two NEW clusters abort', () => {
  const v = sentinelVerdict([...REAL, sig({ house: 'Goldin', price: 10050, n: 40 }), sig({ house: 'Goldin', price: 20100, n: 33 })], baselineOf(REAL));
  assert.strictEqual(v.abort, true);
  assert.strictEqual(v.reason, 'new-poison');
  assert.strictEqual(v.freshPoison.length, 2);
});

check('a single NEW cluster does not abort (threshold is 2)', () => {
  const v = sentinelVerdict([...REAL, sig({ house: 'Goldin', price: 10050, n: 40 })], baselineOf(REAL));
  assert.strictEqual(v.abort, false);
  assert.strictEqual(v.freshPoison.length, 1);
});

check('the NFL idwalk shape ($10,050 x3,622) aborts as catastrophic', () => {
  const v = sentinelVerdict([...REAL, sig({ house: 'NFL Auction', price: 10050, n: 3622 })], baselineOf(REAL));
  assert.strictEqual(v.abort, true);
  assert.strictEqual(v.reason, 'catastrophic');
});

check('catastrophic aborts EVEN IF the cluster is already in the baseline', () => {
  const poisoned = sig({ house: 'NFL Auction', price: 10050, n: 3622 });
  const v = sentinelVerdict([...REAL, poisoned], baselineOf([...REAL, poisoned]));
  assert.strictEqual(v.abort, true, 'a stamped feed must not be grandfathered in');
  assert.strictEqual(v.reason, 'catastrophic');
});

// ── growth of a KNOWN cluster ─────────────────────────────────────────────
check('a known cluster growing modestly (77 -> 90) is not "new"', () => {
  const grown = REAL.map(s => (s.n === 77 ? { ...s, n: 90 } : s));
  const v = sentinelVerdict(grown, baselineOf(REAL));
  assert.strictEqual(v.freshPoison.length, 0, '77+25=102 and 77*1.5=115.5 — 90 clears neither');
  assert.strictEqual(v.abort, false);
});

check('a known cluster exploding (77 -> 400) counts as new', () => {
  const grown = REAL.map(s => (s.n === 77 ? { ...s, n: 400 } : s));
  const v = sentinelVerdict(grown, baselineOf(REAL));
  assert.strictEqual(v.freshPoison.length, 1);
});

// ── bootstrap: no baseline in meta.json ───────────────────────────────────
check('no baseline publishes (bootstrap) instead of wedging', () => {
  const v = sentinelVerdict(REAL, new Map());
  assert.strictEqual(v.hasBaseline, false);
  assert.strictEqual(v.abort, false, 'a missing baseline must not re-create the wedge');
});

check('no baseline STILL aborts on catastrophic', () => {
  const v = sentinelVerdict([...REAL, sig({ house: 'NFL Auction', price: 10050, n: 900 })], new Map());
  assert.strictEqual(v.abort, true);
  assert.strictEqual(v.reason, 'catastrophic');
});

// ── honest ties are never poison ──────────────────────────────────────────
check('honest increment ties never gate, at any size', () => {
  const v = sentinelVerdict([sig({ honest: true, n: 5000 })], new Map());
  assert.strictEqual(v.abort, false);
  assert.strictEqual(v.poison.length, 0);
});

check('an empty book is a no-op', () => {
  const v = sentinelVerdict([], baselineOf(REAL));
  assert.strictEqual(v.abort, false);
  assert.strictEqual(v.poison.length, 0);
});

console.log(`\n${passed} passed${process.exitCode ? ' — WITH FAILURES' : ''}`);
