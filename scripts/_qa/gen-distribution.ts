/** gen-distribution.ts — freeze the flagged-vs-unflagged outcome histogram into a
 *  COMMITTED snapshot the about page can import directly.
 *
 *  Why a committed snapshot and not a read of backtest.json: public/data/ray/ is
 *  gitignored and pulled from R2 at build time, so a brand-new key in
 *  backtest.json does not exist in CI until a nightly has run and pushed. This
 *  writes app/about/distribution.json (in the repo, always present) so the page
 *  ships on the very next deploy. Once the pipeline has re-run, backtest.json's
 *  own `distribution` block (see backtest-core.ts) carries the live numbers and
 *  this file is the fallback / provenance record.
 *
 *  Source of truth is the sidecar accumulator state — the SAME raw perfs arrays
 *  summarizeState() medians — so the snapshot and the pipeline block cannot drift
 *  in method: both call distributionOf().
 *
 *  Run: npx tsx scripts/_qa/gen-distribution.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { distributionOf, type BacktestState } from '../backtest-core';
import { STATE_FILE } from '../build-backtest';

const OUT = path.join(process.cwd(), 'app', 'about', 'distribution.json');

const st: BacktestState = JSON.parse(zlib.gunzipSync(fs.readFileSync(STATE_FILE)).toString('utf8'));
const dist = distributionOf(st.flagged, st.unflagged);

const out = {
  _what: 'Per-lot outcome distribution (realized vs. estimate mid, all-in basis) for flagged vs. unflagged lots — counts per bin, from the backtest accumulator state.',
  generatedAt: new Date().toISOString(),
  ...dist,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

// Reconciliation: the nine bins partition the whole line, so the counts MUST sum
// to n for each arm. Print it — a mismatch means a NaN perf slipped the binner.
const sumF = dist.bins.reduce((a, b) => a + b.flagged, 0);
const sumU = dist.bins.reduce((a, b) => a + b.unflagged, 0);
console.log(`wrote ${OUT}`);
for (const b of dist.bins) console.log(`  ${b.label.padEnd(20)} flagged ${String(b.flagged).padStart(6)}  unflagged ${String(b.unflagged).padStart(6)}`);
console.log(`  summary`, dist.summary);
console.log(`  reconcile: flagged bins sum ${sumF} vs n ${dist.summary.flaggedN} → ${sumF === dist.summary.flaggedN ? 'OK' : 'MISMATCH'}`);
console.log(`  reconcile: unflagged bins sum ${sumU} vs n ${dist.summary.unflaggedN} → ${sumU === dist.summary.unflaggedN ? 'OK' : 'MISMATCH'}`);
