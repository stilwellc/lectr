/**
 * build-backtest-incremental.ts — the FAST NIGHTLY backtest.
 *
 * The full replay (build-backtest.ts) re-scores EVERY concluded-with-estimate
 * lot against all its priors, every run — an O(targets × priors) pass that grew
 * to HOURS as the corpus passed ~500k lots. But the record is CUMULATIVE history
 * that barely moves night-to-night: the only lots whose call is genuinely NEW
 * are the ones that CLOSED since the last run. This entry point scores ONLY
 * those and APPENDS them to the carried-forward record.
 *
 * It reuses the SAME scoring code as the full replay (backtest-core.ts) over the
 * SAME full corpus (identical IDF, vectors, and per-maker roster), so each newly
 * folded row is byte-identical to the row a full replay would produce for that
 * same lot. What makes append correct is the sidecar STATE FILE: the full build
 * persists the raw accumulator arrays (perfs, calObs, byYear, scoredIds); we
 * rehydrate them, fold ONLY the new lots' observations in, and re-derive the
 * published summary. scoredIds dedups any lot that straddles the boundary.
 *
 * ── DRIFT BOUND (the one place incremental can diverge from a full replay) ──
 * A lot's call is a function of its comp pool = all strictly-EARLIER same-maker
 * sold priors. For a lot that CLOSES normally, every prior is already in the
 * corpus (priors are older by construction), so its incremental row equals its
 * full-replay row exactly. The ONLY divergence is a RETROACTIVE prior: a lot
 * BACKFILLED into the corpus that is dated BEFORE an already-scored target. That
 * new prior would enter the target's pool on a full replay but the target is
 * never re-scored incrementally. Two guards bound this:
 *   1. We only score targets dated STRICTLY AFTER the prior run's generatedAt,
 *      so a backfilled OLD lot is skipped as a target (not re-added), never
 *      double-counted — the record can go slightly STALE for that cohort but
 *      never wrong-by-duplication.
 *   2. The WEEKLY full rebuild re-scores everything from scratch and overwrites
 *      the state, erasing any accumulated drift. So drift is bounded to at most
 *      one week of backfilled-prior effect on already-closed lots — acceptable
 *      for a cumulative track record, and exactly why the weekly backstop exists.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readCorpus as readCorpusShared } from './corpus-io';
import type { AuctionLot } from '../app/types';
import {
  prepare, targetsOf, scoreSold, scoreBoughtIn,
  summarizeState, summaryLine, type BacktestState, type L,
} from './backtest-core';
import { buildBacktest, writeState, STATE_FILE } from './build-backtest';

/** Load the sidecar accumulator state, or null if it's absent/unreadable (first
 *  ever run, or a state file that predates this feature). Null → caller falls
 *  back to a full build, which is always correct. */
function readState(): BacktestState | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(STATE_FILE)).toString('utf8')) as BacktestState;
    // shape guard — a truncated/legacy file must not silently zero the record
    if (!st || !Array.isArray(st.scoredIds) || !st.flagged || typeof st.nowMs !== 'number') return null;
    return st;
  } catch {
    return null;
  }
}

/** Prior generatedAt (YYYY-MM-DD) from the published record — the close-date
 *  cutoff for "what's new". Null if there's no prior record to append to. */
function readPriorGeneratedAt(dataDir: string): string | null {
  const p = path.join(dataDir, 'backtest.json');
  if (!fs.existsSync(p)) return null;
  try {
    const prev = JSON.parse(fs.readFileSync(p, 'utf8')) as { generatedAt?: string };
    return typeof prev.generatedAt === 'string' && prev.generatedAt.length >= 10 ? prev.generatedAt : null;
  } catch {
    return null;
  }
}

export function buildBacktestIncremental(dataDir: string, allLots?: AuctionLot[]): void {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

  const st = readState();
  const priorGeneratedAt = readPriorGeneratedAt(dataDir);
  if (!st || !priorGeneratedAt) {
    // Safe on an empty/missing prior: no state to append to → do the full build
    // (which ALSO writes the state file, so tomorrow's incremental can run).
    console.log('[backtest] no prior state/record — falling back to FULL build');
    buildBacktest(dataDir, allLots);
    return;
  }

  const lots = (allLots ?? (readCorpusShared() as unknown as AuctionLot[]));
  console.log(`[backtest] incremental: loaded ${lots.length} lots (${elapsed()}); prior record generatedAt=${priorGeneratedAt}, ${st.scoredIds.length} lots on record`);

  const prep = prepare(lots, console.log, elapsed);
  const { soldTargets, biTargets } = targetsOf(prep);

  // NEW = closed strictly after the prior run's stamp AND not already folded in.
  // The generatedAt cutoff is the cheap coarse filter (a saleDate string compare
  // — ISO dates sort lexically); scoredIds is the exact dedup that also catches a
  // lot dated ON the boundary day. Together they guarantee no double-count.
  const seen = new Set(st.scoredIds);
  const isNew = (l: L) => l.saleDate > priorGeneratedAt && !seen.has(l.id);
  const newSold = soldTargets.filter(isNew);
  const newBi = biTargets.filter(isNew);
  console.log(`[backtest] incremental: ${newSold.length} newly-closed sold + ${newBi.length} bought-in targets to score (${elapsed()})`);

  for (const lot of newSold) if (scoreSold(prep, st, lot)) st.scoredIds.push(lot.id);
  for (const lot of newBi) if (scoreBoughtIn(prep, st, lot)) st.scoredIds.push(lot.id);

  // Re-derive + republish. generatedAt advances to today so tomorrow's cutoff
  // moves forward; the summary/calibration/series are recomputed over the merged
  // accumulators (nowMs stays frozen from the last full build, so recency
  // weighting is stable across incrementals — the weekly full refreshes it).
  const out = summarizeState(st, new Date().toISOString().slice(0, 10));
  fs.writeFileSync(path.join(dataDir, 'backtest.json'), JSON.stringify(out));
  writeState(st);
  console.log(`[backtest] incremental complete (${elapsed()}) —`, summaryLine(out));
}

if (require.main === module) {
  buildBacktestIncremental(path.join(process.cwd(), 'public', 'data', 'ray'));
}
