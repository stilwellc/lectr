/**
 * build-backtest.ts — the signal's measured record, point-in-time correct,
 * computed with the REAL production engine (resolveComps + estimateValue), not a
 * proxy. For every concluded lot that carried an estimate, replay the buy signal
 * as it would have been called ON THAT DAY: the comp pool is the lot's FULL
 * same-maker sold history restricted to sales that had already happened (no
 * prior cap — production build-market passes the full roster, and a cap was
 * measured to understate shipped coverage by ~7pp), scored through the exact
 * production similarity + gate the live site uses, WITH the calibration
 * production would have had loaded that quarter (P1-1). Then score the outcome:
 *  - sold lots: realized vs estimate, on BOTH bases — all-in (premium-inclusive
 *    realized, the number a buyer pays) and HAMMER (hammerUsd, or realized ÷ the
 *    house premium schedule where the house didn't publish it) — because
 *    estimates are hammer-basis, the hammer read is the honest "beat the
 *    estimate" test.
 *  - bought-in lots: counted as failures-to-sell per bucket (a below-market flag
 *    on a lot that then failed to sell is a miss the old backtest hid).
 * No hindsight leaks: a lot's own result never participates in its own call,
 * and neither does anything dated on/after it.
 *
 * THIS is the FULL replay — the pass that scores EVERY concluded-with-estimate
 * lot from scratch. It is the correctness backstop. The nightly path is
 * build-backtest-incremental.ts, which scores only the lots that closed since
 * the last run and appends them. Both call the SAME scoring code in
 * backtest-core.ts, so their rows are byte-identical.
 *
 * ── PER-MARKET LEGS (P0-1c, Sep 2 2026) ──
 * The full replay outgrew a single 350-min job (273k targets; the RR archive
 * alone is 94k culture targets). It now runs as parallel legs, one market each:
 *   npx tsx scripts/build-backtest.ts --market culture --leg-dir data/backtest-legs
 * writes data/backtest-legs/backtest-state.culture.json.gz (+ .json summary),
 * and the merge step
 *   npx tsx scripts/build-backtest.ts --merge --leg-dir data/backtest-legs
 * concatenates every leg into the canonical state + backtest.json. Buckets and
 * observation arrays are order-free, so the merge is exact. Markets are the
 * ARTISTS roster's market keys plus 'other' (unrostered slugs).
 *
 * Exit codes: non-zero whenever a record cannot be produced (empty targets,
 * empty summary, unreadable leg, write failure) — a green run MEANS a record.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readCorpus as readCorpusShared, CORPUS_DIR } from './corpus-io';
import { ARTISTS } from '../app/constants';
import type { AuctionLot } from '../app/types';
import {
  prepare, targetsOf, mkState, replayTargets, mergeStates, assertRecord,
  summarizeState, summaryLine, ENGINE_VERSION, type BacktestState,
} from './backtest-core';

// Sidecar accumulator state for the incremental. backtest.json holds only the
// ROUNDED summary; the incremental needs the raw per-observation arrays (perfs,
// calObs, byYear, scoredIds) to fold new lots in and reproduce a median /
// weighted rate / conformal quantile a full replay would compute. Gzipped (the
// calObs array is ~85k rows). Lives in the ENGINE-ONLY corpus dir (data/corpus),
// NOT public/data/ray — it must never ship to clients or bloat the deployed
// static export. data-store push/pull-backtest carries it forward with R2.
// RAY_BACKTEST_STATE overrides the location (local harnesses that must never
// touch data/corpus).
export const STATE_FILE = process.env.RAY_BACKTEST_STATE || path.join(CORPUS_DIR, 'backtest-state.json.gz');

export function writeState(st: BacktestState, file = STATE_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // atomic: a job killed mid-write must never leave a truncated state that
  // tomorrow's incremental reads as "no state → full rebuild"
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify(st))));
  fs.renameSync(tmp, file);
}

export function readStateFile(file: string): BacktestState | null {
  if (!fs.existsSync(file)) return null;
  const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')) as BacktestState;
  if (!st || !Array.isArray(st.scoredIds) || !st.flagged || typeof st.nowMs !== 'number' || !Array.isArray(st.calObs)) return null;
  return st;
}

/** Every market a leg can address: the roster's market keys + 'other'. */
export function backtestMarkets(): string[] {
  return Array.from(new Set<string>(ARTISTS.map(a => a.market))).concat('other');
}

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null; };
const flag = (n: string): boolean => process.argv.includes(`--${n}`);

export interface FullBuildOpts {
  market?: string | null;      // one market leg; null = every target
  legDir?: string | null;      // where leg outputs go (state + summary per market)
  limit?: number | null;       // testing: cap targets
}

export function buildBacktest(dataDir: string, allLots?: AuctionLot[], opts: FullBuildOpts = {}): ReturnType<typeof summarizeState> {
  // Progress logging — the replay grows with the corpus and can run for
  // HOURS. Without heartbeats the CI step prints NOTHING until it either
  // finishes or hits the job timeout. Log the phase timings and a per-target
  // heartbeat so a slow replay is observable in the run log.
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const lots = (allLots ?? (readCorpusShared() as unknown as AuctionLot[]));
  console.log(`[backtest] loaded ${lots.length} lots (${elapsed()}) — engine ${ENGINE_VERSION}${opts.market ? ` · market leg ${opts.market}` : ''}`);

  const prep = prepare(lots, console.log, elapsed);
  let { soldTargets, biTargets } = targetsOf(prep, opts.market);
  if (opts.limit) { soldTargets = soldTargets.slice(-opts.limit); biTargets = biTargets.slice(-Math.ceil(opts.limit / 10)); }
  console.log(`[backtest] replaying ${soldTargets.length} sold + ${biTargets.length} bought-in targets (${elapsed()})`);
  if (!soldTargets.length) throw new Error(`[backtest] no targets${opts.market ? ` for market ${opts.market}` : ''} — refusing to write an empty record`);

  // Freeze "now" at build start so the state file records the exact wall-clock
  // the calObs recency weighting used — an incremental re-weights against this.
  const st = mkState(Date.now());
  const { scored, tried } = replayTargets(prep, st, soldTargets, biTargets, console.log);
  console.log(`[backtest] replay complete (${elapsed()}) — ${scored} scored, ${tried} abstained`);

  const out = summarizeState(st, new Date().toISOString().slice(0, 10));
  if (opts.market) {
    const dir = opts.legDir || path.join(process.cwd(), 'data', 'backtest-legs');
    fs.mkdirSync(dir, { recursive: true });
    writeState(st, path.join(dir, `backtest-state.${opts.market}.json.gz`));
    fs.writeFileSync(path.join(dir, `backtest.${opts.market}.json`), JSON.stringify(out));
    console.log(`[backtest] leg ${opts.market} → ${dir}:`, summaryLine(out));
    return out;
  }
  assertRecord(out);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'backtest.json'), JSON.stringify(out));
  writeState(st);
  console.log('backtest.json:', summaryLine(out));
  return out;
}

/** Merge every leg state in `legDir` (or the named markets) into the canonical
 *  state + published record. Fails loud if a requested leg is missing. */
export function mergeLegs(dataDir: string, legDir: string, markets?: string[] | null): ReturnType<typeof summarizeState> {
  const want = markets && markets.length ? markets : backtestMarkets();
  const states: BacktestState[] = [];
  const missing: string[] = [];
  for (const m of want) {
    const f = path.join(legDir, `backtest-state.${m}.json.gz`);
    const st = fs.existsSync(f) ? readStateFile(f) : null;
    if (!st) { missing.push(m); continue; }
    states.push(st);
    console.log(`[backtest] merge: leg ${m} — ${st.calObs.length} observations, ${st.scoredIds.length} scored`);
  }
  // 'other' is legitimately empty when every slug is rostered; any rostered
  // market missing means a leg failed — do not publish a partial record.
  const fatal = missing.filter(m => m !== 'other');
  if (fatal.length) throw new Error(`[backtest] merge: missing leg state for ${fatal.join(', ')} in ${legDir} — refusing to publish a partial record`);
  if (!states.length) throw new Error('[backtest] merge: no leg states found');
  const st = mergeStates(states);
  const out = summarizeState(st, new Date().toISOString().slice(0, 10));
  assertRecord(out);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'backtest.json'), JSON.stringify(out));
  writeState(st);
  console.log('backtest.json (merged):', summaryLine(out));
  return out;
}

if (require.main === module) {
  const dataDir = arg('out') || path.join(process.cwd(), 'public', 'data', 'ray');
  const legDir = arg('leg-dir') || path.join(process.cwd(), 'data', 'backtest-legs');
  try {
    if (flag('merge')) {
      const mk = arg('markets');
      mergeLegs(dataDir, legDir, mk ? mk.split(',').map(s => s.trim()).filter(Boolean) : null);
    } else {
      const market = arg('market');
      if (market && !backtestMarkets().includes(market)) throw new Error(`[backtest] unknown market ${market} — one of ${backtestMarkets().join(', ')}`);
      const limit = arg('limit');
      buildBacktest(dataDir, undefined, { market, legDir, limit: limit ? parseInt(limit, 10) : null });
    }
  } catch (e) {
    console.error('[backtest] FAILED:', (e as Error).message);
    process.exit(1);
  }
}
