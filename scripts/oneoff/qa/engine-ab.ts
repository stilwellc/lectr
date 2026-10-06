/**
 * engine-ab.ts — HOLDOUT A/B of two engine flag sets on identical comp pools
 * (Oct 3 2026 engine pass). Replays a stratified sample of recent sold
 * targets (estimate + no-estimate) point-in-time — calibration from the
 * backtest state's rows dated before each quarter, the market time index and
 * the house-bias index built for that quarter — and prices every lot's ONE
 * comp pool under engine A and engine B (backtest-core.compareEngines).
 *
 *   npx tsx scripts/oneoff/qa/engine-ab.ts --from 2025-10-01 --per-market 2500 --noest 3000 \
 *     --a legacy --b current --cal legacy|full|none [--corpus data/corpus] [--out cmp.json]
 *
 * Never writes to data/ or public/. tsconfig-excluded (_qa).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readGzRows } from '../../corpus-io';
import { normalizeCorpus } from '../../lib/corpus-normalize';
import {
  prepare, targetsOf, compsOne, calibrationFor, rehydrateState, compareEngines, engineRowOf, hasAnyEst,
  type BacktestState, type L, type EngineRow,
} from '../../backtest-core';
import {
  estimateValueEx, setCalibration, setTimeIndex, setHouseBias, setEngineFlags, houseFactorOf, FLAG_GATE,
  ENGINE_FLAGS_LEGACY, ENGINE_FLAGS_CURRENT, ENGINE_FLAGS_CANDIDATE, ENGINE_FLAGS_HOUSE_GATE, ENGINE_FLAGS_HAMMER_BASIS, ENGINE_FLAGS_COMP_PURITY, ENGINE_FLAGS_WAVE3, ENGINE_FLAGS_WAVE4, ENGINE_FLAGS_WAVE5, ENGINE_FLAGS_WAVE6, ENGINE_FLAGS_WAVE7, ENGINE_FLAGS_WAVE10, type EngineFlags, type EngineCalibration,
} from '../../../app/lib/value';
import type { AuctionLot } from '../../../app/types';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };
const FLAGSETS: Record<string, EngineFlags> = { legacy: ENGINE_FLAGS_LEGACY, 'house-gate': ENGINE_FLAGS_HOUSE_GATE, 'hammer-basis': ENGINE_FLAGS_HAMMER_BASIS, 'comp-purity': ENGINE_FLAGS_COMP_PURITY, wave3: ENGINE_FLAGS_WAVE3, wave4: ENGINE_FLAGS_WAVE4, wave5: ENGINE_FLAGS_WAVE5, wave6: ENGINE_FLAGS_WAVE6, wave7: ENGINE_FLAGS_WAVE7, wave10: ENGINE_FLAGS_WAVE10, current: ENGINE_FLAGS_CURRENT, candidate: ENGINE_FLAGS_CANDIDATE };

function main() {
  const dir = arg('corpus') || 'data/corpus';
  const from = arg('from') || '2025-10-01';
  // (wave 8) an upper bound for a TRAINING window (fit on an earlier year, test on the holdout)
  const to = arg('to') || '9999';
  const perMarket = parseInt(arg('per-market') || '2500', 10);
  const noEstN = parseInt(arg('noest') || '3000', 10);
  const A = FLAGSETS[arg('a') || 'legacy'], B = FLAGSETS[arg('b') || 'current'];
  // extra ad-hoc flag variants: --b-flags houseNormFlags=0,houseAnchor=1
  const tweak = (f: EngineFlags, spec: string | null): EngineFlags => {
    if (!spec) return f;
    const o: EngineFlags = { ...f, version: `${f.version}~${spec}` };
    for (const kv of spec.split(',')) { const [k, v] = kv.split('='); (o as unknown as Record<string, unknown>)[k] = v === '1'; }
    if (process.env.AB_DEBUG) console.log('[ab] flags', JSON.stringify(o));
    return o;
  };
  const fa = tweak(A, arg('a-flags')), fb = tweak(B, arg('b-flags'));
  const calMode = arg('cal') || 'legacy';
  // (Oct 6, wave 2) engine constant overrides for sweeps: --set PURITY.maxAgeY=99,EXACT_BLEND.w=0.6
  if (arg('set')) {
    const V = require('../../../app/lib/value') as Record<string, Record<string, unknown>>;
    for (const kv of arg('set')!.split(',')) { const [k, v] = kv.split('='); const [o, f] = k.split('.'); V[o][f] = +v; }
  }
  if (arg('lift') != null) FLAG_GATE.minLiftPt = +arg('lift')!;
  if (arg('min-odds-hammer') != null) FLAG_GATE.minOddsHammer = +arg('min-odds-hammer')!;
  const t0 = Date.now();
  const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const lots = (readGzRows(path.join(dir, 'lots.json.gz')) as unknown as AuctionLot[])
    .concat(readGzRows(path.join(dir, 'sold-archive.json.gz')) as unknown as AuctionLot[]);
  normalizeCorpus(lots as never);
  const EXC = new Set(['sports-cards', 'graded-cards', 'pokemon']);
  const eng = lots.filter(l => !EXC.has(l.artist) && (l as AuctionLot & { source?: string }).source !== 'sothebys-algolia');
  const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'backtest-state.json.gz'))).toString('utf8')) as BacktestState;
  const prep = prepare(eng, console.log, el);
  rehydrateState(st, prep, console.log);
  const tg = targetsOf(prep);
  const mOf = (l: L) => prep.marketBySlug[l.artist] || 'other';
  const est = tg.soldTargets.filter(l => l.saleDate >= from && l.saleDate < to);
  const byM = new Map<string, L[]>();
  for (const l of est) (byM.get(mOf(l)) || byM.set(mOf(l), []).get(mOf(l))!).push(l);
  const pick: L[] = [];
  byM.forEach(arr => { const step = Math.max(1, Math.ceil(arr.length / perMarket)); for (let i = 0; i < arr.length; i += step) pick.push(arr[i]); });
  const ne = tg.noEstTargets.filter(l => l.saleDate >= from && l.saleDate < to);
  { const step = Math.max(1, Math.ceil(ne.length / noEstN)); for (let i = 0; i < ne.length; i += step) pick.push(ne[i]); }
  pick.sort((a, b) => (a.saleDate < b.saleDate ? -1 : 1));
  console.log(`[ab] ${pick.filter(hasAnyEst).length} estimate + ${pick.filter(l => !hasAnyEst(l)).length} no-estimate targets since ${from} · A=${fa.version} B=${fb.version} · cal=${calMode} (${el()})`);
  const rowsA: EngineRow[] = [], rowsB: EngineRow[] = [];
  let curQ = '';
  const cals: Record<'a' | 'b', EngineCalibration | null> = { a: null, b: null };
  const qOf = (sd: string) => `${sd.slice(0, 4)}Q${Math.floor((+sd.slice(5, 7) - 1) / 3) + 1}`;
  const qStart = (q: string) => `${q.slice(0, 4)}-${String((+q.slice(5) - 1) * 3 + 1).padStart(2, '0')}-01`;
  for (const l of pick) {
    const q = qOf(l.saleDate);
    if (q !== curQ) {
      curQ = q;
      // each engine gets the calibration ITS flags would have fit (odds basis,
      // anchor weight) — the refit reads the flag set in force
      for (const [f, slot] of [[fa, 'a'], [fb, 'b']] as [EngineFlags, 'a' | 'b'][]) {
        setEngineFlags(f);
        let cal: EngineCalibration | null = null;
        if (calMode !== 'none') {
          const c = calibrationFor(st, qStart(q), prep.marketBySlug);
          cal = c && calMode === 'legacy'
            ? { edges: c.edges, beatRate: c.beatRate, band: c.band, bandByMarket: c.bandByMarket, mdape: c.mdape, marketBySlug: c.marketBySlug }
            : c;
        }
        cals[slot] = cal;
      }
      setTimeIndex(prep.timeIndexer!(qStart(q)));
      setHouseBias(prep.houseBiasIndexer!(qStart(q)));
      console.log(`[ab] quarter ${q} (${el()})`);
    }
    const comps = compsOne(prep, l);
    const m = mOf(l);
    const et = (l.estLowUsd || 0) > 0 && (l.estHighUsd || 0) > 0 ? 'b' : 'p'; // the yardstick's house factor (one for both engines)
    setEngineFlags(ENGINE_FLAGS_HOUSE_GATE); // one yardstick for both engines
    const hf = hasAnyEst(l) ? houseFactorOf(m, l.auctionHouse, et)?.f : undefined;
    for (const [f, out, slot] of [[fa, rowsA, 'a'], [fb, rowsB, 'b']] as [EngineFlags, EngineRow[], 'a' | 'b'][]) {
      setEngineFlags(f);
      setCalibration(cals[slot]);
      const v = comps ? estimateValueEx(l, comps, prep.tbl).value : null;
      // (wave 4) the per-lot diagnostics the harness analyses read (house,
      // estimate, comp ratio / weight) — the comparison ignores them
      out.push({
        ...engineRowOf(l, hasAnyEst(l) ? m : `noest:${m}`, v, hf),
        h: l.auctionHouse, el: l.estLowUsd || 0, eh: l.estHighUsd || 0,
        ...(v ? { cr: v.compRatio, fr: v.flagRatio ?? null, bw: v.blendW ?? null, cm: v.compMedianUsd ?? null, n: v.n } : {}),
      } as EngineRow);
    }
  }
  setEngineFlags(null); setCalibration(null); setTimeIndex(null); setHouseBias(null);
  const cmp = compareEngines(rowsA, rowsB, { current: fa.version, candidate: fb.version });
  const line = (k: string, s: ReturnType<typeof compareEngines>['current']['all']) =>
    `${k.padEnd(16)} valued ${String(s.valued).padStart(5)} · n${s.n} medErr ${s.medAbsErrPct}% ±30% ${s.within30Pct}% bias ${s.bias} band ${s.bandCoveragePct}% <maxBid ${s.belowMaxBidPct}% | flags ${s.flags.nFlagged}/${s.flags.nFlagged + s.flags.nUnflagged} prec(adj) ${s.flags.precisionAdjPct}% prec(raw) ${s.flags.precisionRawPct}% edge(adj) ${s.flags.edgeAdjPt}pt edge(raw) ${s.flags.edgeRawPt}pt [${s.flags.flaggedAdj} vs ${s.flags.unflaggedAdj}]`;
  for (const k of ['all', ...Object.keys(cmp.current.byMarket)]) {
    const a = k === 'all' ? cmp.current.all : cmp.current.byMarket[k];
    const b = k === 'all' ? cmp.candidate.all : cmp.candidate.byMarket[k];
    console.log(`A ${line(k, a)}`);
    console.log(`B ${line(k, b)}`);
  }
  console.log(`[ab] promote=${cmp.promote} ${cmp.reasons.join('; ')} (${el()})`);
  if (arg('out')) fs.writeFileSync(arg('out')!, JSON.stringify({ cmp, rowsA, rowsB }));
}
main();
