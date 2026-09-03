/**
 * build-backtest-incremental.ts — the FAST NIGHTLY backtest.
 *
 * The full replay (build-backtest.ts) re-scores EVERY concluded-with-estimate
 * lot against all its priors — a pass that grew to HOURS as the corpus passed
 * ~1M lots. But the record is CUMULATIVE history that barely moves night-to-
 * night: the only lots whose call is genuinely NEW are the ones that CLOSED (or
 * were first CRAWLED) since the last run. This entry point scores ONLY those and
 * APPENDS them to the carried-forward record.
 *
 * It reuses the SAME scoring code as the full replay (backtest-core.ts) over the
 * SAME full corpus (identical IDF, vectors, and per-maker roster), so each newly
 * folded row is byte-identical to the row a full replay would produce for that
 * same lot. What makes append correct is the sidecar STATE FILE: the full build
 * persists the raw accumulator arrays (perfs, calObs, byYear, scoredIds,
 * triedIds); we rehydrate them, fold ONLY the new lots' observations in, and
 * re-derive the published summary. scoredIds ∪ triedIds dedups any lot that was
 * already attempted, whatever the outcome.
 *
 * ── WHAT IS "NEW" (P0-1b, Sep 2 2026) ──
 * The old cutoff was `saleDate > priorGeneratedAt`, which silently dropped any
 * result crawled AFTER its close day (results posted late, resolved-later
 * houses, archive backfills) — forever. New = not yet attempted AND (closed
 * inside the trailing 120-day window OR first seen by the crawler after the
 * prior run). The attempted set makes the window cheap: an abstention is not
 * re-attempted every night. Backfills bigger than the nightly budget are
 * chunked oldest-first across nights (the tried set carries the frontier).
 *
 * ── FIELD DRIFT (P0-1a) ──
 * A state minted before a calObs field existed is REHYDRATED (arithmetic +
 * corpus lookup, backtest-core.rehydrateState) — never a forced full rebuild.
 * The forced rebuild is exactly what killed every nightly Aug 26 → Sep 1: it
 * could not finish inside the job cap, wrote no state, and repeated.
 *
 * ── DRIFT BOUND ──
 * A lot's call is a function of its comp pool = all strictly-EARLIER same-maker
 * sold priors. A RETROACTIVE prior (a lot backfilled into the corpus dated
 * BEFORE an already-scored target) would enter the target's pool on a full
 * replay but the target is never re-scored incrementally; the per-market full
 * legs (build-backtest.ts --market) erase that drift when they run.
 *
 * Exit codes: non-zero whenever no record can be produced.
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCorpus as readCorpusShared } from './corpus-io';
import type { AuctionLot } from '../app/types';
import {
  prepare, targetsOf, replayTargets, rehydrateState, assertRecord,
  summarizeState, summaryLine, ENGINE_VERSION, type BacktestState, type L,
} from './backtest-core';
import { buildBacktest, writeState, readStateFile, STATE_FILE } from './build-backtest';

/** Trailing close-date window (days) inside which a never-attempted target is
 *  still admitted — covers late-posted results without a full replay. */
export const LATE_RESULT_WINDOW_DAYS = 120;
/** Nightly budget: more than this is chunked oldest-first across nights. */
export const NIGHTLY_TARGET_BUDGET = 80_000;

/** Load the sidecar accumulator state, or null if it's absent/unreadable (first
 *  ever run, or a truncated file). Null → caller falls back to a full build. */
function readState(): BacktestState | null {
  try { return readStateFile(STATE_FILE); } catch { return null; }
}

/** Prior generatedAt (YYYY-MM-DD) from the published record. Null if there's
 *  no prior record to append to. */
function readPriorGeneratedAt(dataDir: string): string | null {
  const p = path.join(dataDir, 'backtest.json');
  if (!fs.existsSync(p)) return null;
  try {
    const prev = JSON.parse(fs.readFileSync(p, 'utf8')) as { generatedAt?: string };
    return typeof prev.generatedAt === 'string' && prev.generatedAt.length >= 10 ? prev.generatedAt.slice(0, 10) : null;
  } catch {
    return null;
  }
}

const shiftDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10);

export function buildBacktestIncremental(dataDir: string, allLots?: AuctionLot[]): ReturnType<typeof summarizeState> {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

  const st = readState();
  const priorGeneratedAt = readPriorGeneratedAt(dataDir);
  if (!st || !priorGeneratedAt) {
    // Safe on an empty/missing prior: no state to append to → do the full build
    // (which ALSO writes the state file, so tomorrow's incremental can run).
    console.log('[backtest] no prior state/record — falling back to FULL build');
    return buildBacktest(dataDir, allLots);
  }

  const lots = (allLots ?? (readCorpusShared() as unknown as AuctionLot[]));
  console.log(`[backtest] incremental: loaded ${lots.length} lots (${elapsed()}); prior record generatedAt=${priorGeneratedAt}, ${st.scoredIds.length} scored + ${(st.triedIds || []).length} abstained on record; state engine ${st.engineVersion || 'legacy'} → ${ENGINE_VERSION}`);

  const prep = prepare(lots, console.log, elapsed);
  // legacy field drift → repair in place (never a forced full rebuild)
  rehydrateState(st, prep, console.log);
  const { soldTargets, biTargets } = targetsOf(prep);

  const scored = new Set(st.scoredIds);
  const tried = new Set(st.triedIds || []);
  const windowStart = shiftDays(priorGeneratedAt, -LATE_RESULT_WINDOW_DAYS);
  const isNew = (l: L) => {
    if (scored.has(l.id) || tried.has(l.id)) return false;
    if (l.saleDate > windowStart) return true;
    const fs = (l as L & { firstSeen?: string }).firstSeen;
    return !!fs && fs.slice(0, 10) > priorGeneratedAt;
  };
  let newSold = soldTargets.filter(isNew);
  let newBi = biTargets.filter(isNew);
  console.log(`[backtest] incremental: ${newSold.length} sold + ${newBi.length} bought-in targets not yet attempted (window since ${windowStart} or first seen after ${priorGeneratedAt}) (${elapsed()})`);
  if (newSold.length + newBi.length > NIGHTLY_TARGET_BUDGET) {
    // chunk oldest-first so the rolling calibration stays point-in-time; the
    // remainder is picked up tomorrow (they are still "not attempted")
    const byDate = (a: L, b: L) => (a.saleDate < b.saleDate ? -1 : a.saleDate > b.saleDate ? 1 : 0);
    newSold = newSold.sort(byDate).slice(0, NIGHTLY_TARGET_BUDGET);
    newBi = newBi.sort(byDate).slice(0, Math.max(0, NIGHTLY_TARGET_BUDGET - newSold.length));
    console.log(`[backtest] incremental: over the nightly budget — scoring the oldest ${newSold.length + newBi.length} tonight, the rest tomorrow`);
  }

  const res = replayTargets(prep, st, newSold, newBi, console.log, 5000);
  st.engineVersion = st.engineVersion || 'legacy';
  console.log(`[backtest] incremental: ${res.scored} scored, ${res.tried} abstained (${elapsed()})`);

  // Re-derive + republish. generatedAt advances to today so tomorrow's cutoff
  // moves forward; the summary/calibration/series are recomputed over the merged
  // accumulators (nowMs stays frozen from the last full build, so recency
  // weighting is stable across incrementals — the per-market full legs refresh it).
  const out = summarizeState(st, new Date().toISOString().slice(0, 10));
  assertRecord(out);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'backtest.json'), JSON.stringify(out));
  writeState(st);
  console.log(`[backtest] incremental complete (${elapsed()}) —`, summaryLine(out));
  return out;
}

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  const dataDir = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : path.join(process.cwd(), 'public', 'data', 'ray');
  try {
    buildBacktestIncremental(dataDir);
  } catch (e) {
    console.error('[backtest] FAILED:', (e as Error).message);
    process.exit(1);
  }
}
