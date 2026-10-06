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
  summarizeState, summaryLine, ENGINE_VERSION, unsoldCapturedCells, backfillUnsold, type BacktestState,
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
  noNoEst?: boolean;           // skip the no-estimate targets (--no-noest)
}

/** Why a market leg can legitimately have nothing to replay — decided on the
 *  evidence, printed into the leg summary so an empty leg is never mistaken
 *  for a broken one. tcg: bid-only Pokémon were considered as targets and
 *  rejected — the hedonic replay never values them (engine-excluded like
 *  sports cards); their values come from the tcg card tiers, which the forward
 *  calls ledger grades (k:'card', m:'tcg'). */
const EMPTY_LEG_REASON: Record<string, string> = {
  tcg: 'tcg lots carry no house estimate and are engine-excluded from the hedonic replay (mass-produced cards are valued by the tcg card tiers); the tcg record is the forward card tape (calls-ledger k=card, m=tcg)',
};

/** An explicit, mergeable empty leg: an empty accumulator state + a summary
 *  that says why. Exit 0 — a market with nothing to replay is a result. */
export function writeEmptyLeg(market: string, dir: string, reason: string): ReturnType<typeof summarizeState> {
  const st = mkState(Date.now());
  const out = summarizeState(st, new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  writeState(st, path.join(dir, `backtest-state.${market}.json.gz`));
  fs.writeFileSync(path.join(dir, `backtest.${market}.json`), JSON.stringify({ ...out, empty: true, market, reason }));
  console.log(`[backtest] leg ${market}: EMPTY — ${reason} → wrote an explicit empty leg to ${dir}`);
  return out;
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
  let { soldTargets, biTargets, noEstTargets } = targetsOf(prep, opts.market);
  if (opts.noNoEst) noEstTargets = [];
  if (opts.limit) {
    soldTargets = soldTargets.slice(-opts.limit);
    biTargets = biTargets.slice(-Math.ceil(opts.limit / 10));
    noEstTargets = noEstTargets.slice(-Math.ceil(opts.limit / 2));
  }
  console.log(`[backtest] replaying ${soldTargets.length} sold + ${biTargets.length} bought-in + ${noEstTargets.length} no-estimate targets (${elapsed()})`);
  if (!soldTargets.length && !noEstTargets.length) {
    // A MARKET LEG WITH NOTHING TO REPLAY IS A RECORD, NOT A FAILURE (Sep 27):
    // tcg (Pokémon) lots carry no house estimate and are engine-excluded from
    // the hedonic path (mass-produced — valued by the card tiers, graded on the
    // forward 'card' tape), so the leg had 0 targets, threw, and the Sunday
    // merge was skipped every week (Sep 13/20/27). Write an explicit empty leg
    // — state + a summary naming the reason — and exit 0; the merge folds it
    // in as zero rows. The unsharded full build still refuses an empty record.
    if (opts.market) return writeEmptyLeg(opts.market, opts.legDir || path.join(process.cwd(), 'data', 'backtest-legs'),
      EMPTY_LEG_REASON[opts.market] || `no concluded targets for market ${opts.market} (no estimate-carrying sold lots, no engine-valued no-estimate lots in the trailing window)`);
    throw new Error('[backtest] no targets — refusing to write an empty record');
  }

  // Freeze "now" at build start so the state file records the exact wall-clock
  // the calObs recency weighting used — an incremental re-weights against this.
  const st = mkState(Date.now());
  const { scored, tried } = replayTargets(prep, st, soldTargets, biTargets, console.log, 20000, noEstTargets);
  console.log(`[backtest] replay complete (${elapsed()}) — ${scored} scored, ${tried} abstained`);
  // where the corpus captured unsold lots — the headline's population
  st.unsoldCells = unsoldCapturedCells(prep.lots);

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
    if (flag('summarize')) {
      // RE-SUMMARIZE ONLY: re-derive backtest.json from the saved accumulator
      // state (no corpus load, no replay) — for a change to the record's
      // aggregation that needs no new observations
      const st = readStateFile(STATE_FILE);
      if (!st) throw new Error(`[backtest] --summarize: no readable state at ${STATE_FILE}`);
      const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'backtest.json'), 'utf8')) as { generatedAt?: string }; } catch { return null; } })();
      const out = summarizeState(st, prev?.generatedAt || new Date().toISOString().slice(0, 10));
      assertRecord(out);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'backtest.json'), JSON.stringify(out));
      console.log('backtest.json (re-summarized):', summaryLine(out));
    } else if (flag('backfill-unsold')) {
      // ONE-TIME repair of a pre-Oct-6 state (the nightly incremental does the
      // same on its own): re-score the bought-ins already on record into rows
      // (tier buckets included), add the hammer twins, stamp the unsold-
      // captured cells, re-summarize. Loads the corpus; no sold replay.
      const st = readStateFile(STATE_FILE);
      if (!st) throw new Error(`[backtest] --backfill-unsold: no readable state at ${STATE_FILE}`);
      const t0 = Date.now();
      const lots = readCorpusShared() as unknown as AuctionLot[];
      const prep = prepare(lots, console.log, () => `${((Date.now() - t0) / 1000).toFixed(0)}s`);
      backfillUnsold(prep, st, console.log);
      st.unsoldCells = unsoldCapturedCells(prep.lots);
      const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'backtest.json'), 'utf8')) as { generatedAt?: string }; } catch { return null; } })();
      const out = summarizeState(st, prev?.generatedAt || new Date().toISOString().slice(0, 10));
      assertRecord(out);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'backtest.json'), JSON.stringify(out));
      writeState(st);
      console.log('backtest.json (unsold backfill):', summaryLine(out));
    } else if (flag('merge')) {
      const mk = arg('markets');
      mergeLegs(dataDir, legDir, mk ? mk.split(',').map(s => s.trim()).filter(Boolean) : null);
    } else {
      const market = arg('market');
      if (market && !backtestMarkets().includes(market)) throw new Error(`[backtest] unknown market ${market} — one of ${backtestMarkets().join(', ')}`);
      const limit = arg('limit');
      buildBacktest(dataDir, undefined, { market, legDir, limit: limit ? parseInt(limit, 10) : null, noNoEst: flag('no-noest') });
    }
  } catch (e) {
    console.error('[backtest] FAILED:', (e as Error).message);
    process.exit(1);
  }
}
