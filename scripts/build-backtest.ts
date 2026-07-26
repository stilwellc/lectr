/**
 * build-backtest.ts — the signal's measured record, point-in-time correct,
 * computed with the REAL production engine (resolveComps + estimateValue), not a
 * proxy. For every concluded lot that carried an estimate, replay the buy signal
 * as it would have been called ON THAT DAY: the comp pool is the lot's FULL
 * same-maker sold history restricted to sales that had already happened (no
 * prior cap — production build-market passes the full roster, and a cap was
 * measured to understate shipped coverage by ~7pp), scored through the exact
 * production similarity + gate the live site uses. Then score the outcome:
 *  - sold lots: realized vs estimate, on BOTH bases — all-in (premium-inclusive
 *    realized, the number a buyer pays) and HAMMER (hammerUsd, or realized/1.25
 *    where the house didn't publish it) — because estimates are hammer-basis,
 *    the hammer read is the honest "beat the estimate" test.
 *  - bought-in lots: counted as failures-to-sell per bucket (a below-market flag
 *    on a lot that then failed to sell is a miss the old backtest hid).
 * No hindsight leaks: a lot's own result never participates in its own call,
 * and neither does anything dated on/after it.
 *
 * THIS is the FULL replay — the O(targets × priors) pass that scores EVERY
 * concluded-with-estimate lot from scratch. It is the correctness backstop (run
 * WEEKLY in CI). The nightly path is build-backtest-incremental.ts, which scores
 * only the lots that closed since the last run and appends them. Both call the
 * SAME scoring code in backtest-core.ts, so their rows are byte-identical; the
 * only reason to still run the full replay is to re-fold any lot whose comp pool
 * changed retroactively (a backfilled prior dated BEFORE an already-scored
 * target — see build-backtest-incremental.ts for the exact drift bound).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readCorpus as readCorpusShared, CORPUS_DIR } from './corpus-io';
import type { AuctionLot } from '../app/types';
import {
  prepare, targetsOf, scoreSold, scoreBoughtIn, mkState,
  summarizeState, summaryLine, type BacktestState,
} from './backtest-core';

// Sidecar accumulator state for the incremental. backtest.json holds only the
// ROUNDED summary; the incremental needs the raw per-observation arrays (perfs,
// calObs, byYear, scoredIds) to fold new lots in and reproduce a median /
// weighted rate / conformal quantile a full replay would compute. Gzipped (the
// calObs array is ~45k rows). Lives in the ENGINE-ONLY corpus dir (data/corpus),
// NOT public/data/ray — it must never ship to clients or bloat the deployed
// static export. data-store push/pull-backtest carries it forward with R2.
export const STATE_FILE = path.join(CORPUS_DIR, 'backtest-state.json.gz');

export function writeState(st: BacktestState): void {
  fs.mkdirSync(CORPUS_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, zlib.gzipSync(Buffer.from(JSON.stringify(st))));
}

export function buildBacktest(dataDir: string, allLots?: AuctionLot[]): void {
  // Progress logging — the replay is an O(targets×priors) pass that grows with
  // the corpus and can run for HOURS. Without heartbeats the CI step prints
  // NOTHING until it either finishes or hits the job timeout (which is exactly
  // how the 70min-cap "cancelled" nights went undiagnosed). Log the phase timings
  // and a per-target heartbeat so a slow replay is observable in the run log.
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const lots = (allLots ?? (readCorpusShared() as unknown as AuctionLot[]));
  console.log(`[backtest] loaded ${lots.length} lots (${elapsed()})`);

  const prep = prepare(lots, console.log, elapsed);
  const { soldTargets, biTargets } = targetsOf(prep);
  console.log(`[backtest] replaying ${soldTargets.length} sold + ${biTargets.length} bought-in targets (${elapsed()})`);

  // Freeze "now" at build start so the state file records the exact wall-clock
  // the calObs recency weighting used — an incremental re-weights against this.
  const st = mkState(Date.now());

  let done = 0;
  for (const lot of soldTargets) {
    if (++done % 20000 === 0) console.log(`[backtest] sold replay ${done}/${soldTargets.length} (${elapsed()})`);
    if (scoreSold(prep, st, lot)) st.scoredIds.push(lot.id);
  }
  console.log(`[backtest] sold replay complete (${elapsed()}) — replaying bought-ins`);
  for (const lot of biTargets) {
    if (scoreBoughtIn(prep, st, lot)) st.scoredIds.push(lot.id);
  }

  const out = summarizeState(st, new Date().toISOString().slice(0, 10));
  fs.writeFileSync(path.join(dataDir, 'backtest.json'), JSON.stringify(out));
  writeState(st);
  console.log('backtest.json:', summaryLine(out));
}

if (require.main === module) {
  buildBacktest(path.join(process.cwd(), 'public', 'data', 'ray'));
}
