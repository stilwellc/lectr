/**
 * comp-precision.ts — THE COMP-PRECISION HARNESS (pricing wave 5, Oct 6 2026).
 *
 * Re-runs today's pool selection (backtest-core.compsOne → value.estimateValueEx)
 * on every hand-judged lot of the comp audits and scores the pool the engine
 * picks NOW against the per-comp verdicts (G good · W acceptable · X wrong):
 *
 *   pool    — the top-K pool each engine (A / B) serves: judged comps in it by
 *             grade, the wrong share among the judged, the unjudged count, and
 *             how many lots each engine values / abstains on
 *   pairs   — every judged (lot, comp) pair whose two rows exist: which pairs
 *             engine B's hard boundaries drop that A's keep, by grade (the
 *             rule's own precision, independent of pool churn)
 *   value   — expected hammer vs the appraiser's hammer (median |log error|)
 *             on lots both engines value; the error A carried on the lots B
 *             withdraws
 *
 * The judged pairs come from a pairs.ndjson ({round, lotId, compId, g, r,
 * split}) + judged-lots.json (appraiserHammerUsd per lot); DEV / TEST is
 * md5(lot id) parity, stamped by the extractor. Tune on DEV; report TEST.
 *
 *   npx tsx scripts/oneoff/qa/comp-precision.ts --pairs pairs.ndjson --lots judged-lots.json \
 *     [--corpus data/corpus] [--a current] [--b current] [--b-flags objectBoundary=1] [--split DEV|TEST|ALL]
 *     [--dump rows.ndjson] [--out res.json]
 *
 * Never writes to data/ or public/. tsconfig-excluded (_qa).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readGzRows } from '../../corpus-io';
import { normalizeCorpus } from '../../lib/corpus-normalize';
import { prepare, compsOne, calibrationFor, rehydrateState, type BacktestState, type L } from '../../backtest-core';
import {
  estimateValueEx, setCalibration, setTimeIndex, setHouseBias, setEngineFlags,
  ENGINE_FLAGS_CURRENT, ENGINE_FLAGS_CANDIDATE, ENGINE_FLAGS_WAVE4, type EngineFlags, type ValueResult,
} from '../../../app/lib/value';
import { compBoundaryFault, objectBoundaryFault, isMemorabiliaLot } from '../../../app/lib/comp-purity';
import { BOUNDARY2, BOUNDARY5 } from '../../../app/lib/value';
import type { AuctionLot } from '../../../app/types';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };
const FLAGSETS: Record<string, EngineFlags> = { wave4: ENGINE_FLAGS_WAVE4, current: ENGINE_FLAGS_CURRENT, candidate: ENGINE_FLAGS_CANDIDATE };
const CARD = new Set(['sports-cards', 'graded-cards', 'pokemon']);

type Pair = { round: number; lotId: string; compId: string; g: 'G' | 'W' | 'X'; r: string; split: string; house: string };
type JLot = { round: number; lotId: string; house: string; split: string; appraiserHammerUsd: number | null };

function tweak(f: EngineFlags, spec: string | null): EngineFlags {
  if (!spec) return f;
  const o: EngineFlags = { ...f, version: `${f.version}~${spec}` };
  for (const kv of spec.split(',')) { const [k, v] = kv.split('='); (o as unknown as Record<string, unknown>)[k] = v === '1'; }
  return o;
}

function main() {
  const dir = arg('corpus') || 'data/corpus';
  const split = arg('split') || 'ALL';
  const fa = tweak(FLAGSETS[arg('a') || 'current'], arg('a-flags'));
  const fb = tweak(FLAGSETS[arg('b') || 'current'], arg('b-flags'));
  if (arg('set')) {
    const V = require('../../../app/lib/value') as Record<string, Record<string, unknown>>;
    for (const kv of arg('set')!.split(',')) { const [k, v] = kv.split('='); const [o, f] = k.split('.'); V[o][f] = +v; }
  }
  const pairs = fs.readFileSync(arg('pairs')!, 'utf8').split('\n').filter(Boolean).map(s => JSON.parse(s) as Pair)
    .filter(p => split === 'ALL' || p.split === split);
  const jl = JSON.parse(fs.readFileSync(arg('lots')!, 'utf8')) as Record<string, JLot>;
  // the latest round's verdict wins when a lot was judged twice
  const grade = new Map<string, Map<string, Pair>>();
  for (const p of pairs.sort((a, b) => a.round - b.round)) (grade.get(p.lotId) || grade.set(p.lotId, new Map()).get(p.lotId)!).set(p.compId, p);
  const appr = new Map<string, number>();
  for (const v of Object.values(jl).sort((a, b) => a.round - b.round)) if ((v.appraiserHammerUsd || 0) > 0) appr.set(v.lotId, v.appraiserHammerUsd!);

  const t0 = Date.now();
  const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const lots = (readGzRows(path.join(dir, 'lots.json.gz')) as unknown as AuctionLot[])
    .concat(readGzRows(path.join(dir, 'sold-archive.json.gz')) as unknown as AuctionLot[]);
  normalizeCorpus(lots as never);
  const byId = new Map<string, AuctionLot>();
  for (const l of lots) byId.set(l.id, l);
  if (arg('dump')) {
    const need = new Set<string>();
    for (const p of pairs) { need.add(p.lotId); need.add(p.compId); }
    const w = fs.createWriteStream(arg('dump')!);
    need.forEach(id => {
      const l = byId.get(id) as (AuctionLot & Record<string, unknown>) | undefined;
      if (!l) return;
      const { _v, _vn, titleTokens, ...rest } = l as Record<string, unknown>;
      void _v; void _vn; void titleTokens;
      w.write(JSON.stringify({ ...rest, description: String(l.description || '').slice(0, 600) }) + '\n');
    });
    w.end();
    console.log(`[cp] dumped ${need.size} ids (${Array.from(need).filter(i => byId.has(i)).length} found) → ${arg('dump')}`);
    if (process.argv.includes('--dump-only')) return;
  }
  const eng = lots.filter(l => !CARD.has(l.artist) && (l as AuctionLot & { source?: string }).source !== 'sothebys-algolia');
  const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'backtest-state.json.gz'))).toString('utf8')) as BacktestState;
  const prep = prepare(eng, console.log, el);
  rehydrateState(st, prep, console.log);
  const today = arg('asof') || new Date().toISOString().slice(0, 10);
  setTimeIndex(prep.timeIndexer!(today));
  setHouseBias(prep.houseBiasIndexer!(today));
  const cals: Record<string, ReturnType<typeof calibrationFor>> = {};
  for (const [f, k] of [[fa, 'a'], [fb, 'b']] as [EngineFlags, string][]) { setEngineFlags(f); cals[k] = calibrationFor(st, today, prep.marketBySlug); }

  const engById = new Map<string, L>();
  for (const l of prep.lots) engById.set(l.id, l);
  const mkOf = (l: AuctionLot) => prep.marketBySlug[l.artist] || 'other';
  type Acc = { lots: number; valued: number; G: number; W: number; X: number; U: number; err: number[]; drop: { G: number; W: number; X: number } };
  const acc = () => ({ lots: 0, valued: 0, G: 0, W: 0, X: 0, U: 0, err: [] as number[], drop: { G: 0, W: 0, X: 0 } });
  const cells: Record<'a' | 'b', Map<string, Acc>> = { a: new Map(), b: new Map() };
  const cell = (s: 'a' | 'b', k: string) => cells[s].get(k) || cells[s].set(k, acc()).get(k)!;
  const rows: Record<string, unknown>[] = [];
  const withdrawn: { id: string; e: number | null; why: string | null }[] = [];
  const pairDrops = { G: 0, W: 0, X: 0, n: { G: 0, W: 0, X: 0 } };
  const pairDropRows: Record<string, unknown>[] = [];
  let found = 0;
  const faultOf = (f: EngineFlags, t: AuctionLot, c: AuctionLot) => (f.compBoundary ? compBoundaryFault(t as never, c as never, { ext: !!f.boundary2, watchVariant: !!f.watchVariant, rules: BOUNDARY2 }) : null)
    || (f.objectBoundary ? objectBoundaryFault(t as never, c as never, BOUNDARY5) : null);
  grade.forEach((gm, lotId) => {
    const lot = engById.get(lotId);
    if (!lot) return;
    found++;
    const keys = ['all', `m:${mkOf(lot)}`, `h:${lot.auctionHouse}`, `mem:${isMemorabiliaLot(lot as never) ? 'y' : 'n'}`];
    // the rule-level read: every judged pair B's boundaries drop that A's keep
    gm.forEach((p, cid) => {
      const c = byId.get(cid);
      if (!c) return;
      pairDrops.n[p.g]++;
      const da = faultOf(fa, lot, c);
      const db = faultOf(fb, lot, c);
      if (!da && db) {
        pairDrops[p.g]++;
        for (const k of keys) cell('b', k).drop[p.g]++;
        pairDropRows.push({ lot: lotId, t: lot.title, c: cid, ct: c.title, g: p.g, r: p.r, why: db });
      }
    });
    const comps = compsOne(prep, lot);
    const out: Record<string, unknown> = { id: lotId, title: lot.title, house: lot.auctionHouse, m: mkOf(lot) };
    const vals: Record<string, ValueResult | null> = {};
    for (const [f, s] of [[fa, 'a'], [fb, 'b']] as [EngineFlags, 'a' | 'b'][]) {
      setEngineFlags(f); setCalibration(cals[s]);
      const r = comps ? estimateValueEx(lot, comps, prep.tbl) : { value: null, abstain: 'no-candidates' };
      const v = r.value; vals[s] = v;
      const ids = v?.poolIds || [];
      const ap = appr.get(lotId);
      const e = v && ap && (v.expectedHammerUsd || 0) > 0 ? Math.abs(Math.log(v.expectedHammerUsd! / ap)) : null;
      for (const k of keys) {
        const c = cell(s, k);
        c.lots++;
        if (v) c.valued++;
        for (const id of ids) { const p = gm.get(id); if (p) c[p.g]++; else c.U++; }
      }
      out[s] = { v: v ? v.expectedHammerUsd : null, abstain: r.abstain || v?.abstain || null, pool: ids.map(id => [id, gm.get(id)?.g || '?']), e };
    }
    const ap = appr.get(lotId);
    const ea = vals.a && ap ? Math.abs(Math.log(vals.a.expectedHammerUsd! / ap)) : null;
    const eb = vals.b && ap ? Math.abs(Math.log(vals.b.expectedHammerUsd! / ap)) : null;
    if (ea != null && eb != null) for (const k of keys) { cell('a', k).err.push(ea); cell('b', k).err.push(eb); }
    if (vals.a && !vals.b) withdrawn.push({ id: lotId, e: ea, why: (out.b as { abstain: string | null }).abstain });
    rows.push(out);
  });
  setEngineFlags(null); setCalibration(null); setTimeIndex(null); setHouseBias(null);

  const med = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
  const fmt = (c: Acc) => {
    const j = c.G + c.W + c.X;
    return `lots ${String(c.lots).padStart(3)} valued ${String(c.valued).padStart(3)} · judged ${String(j).padStart(4)} G ${pct(c.G / (j || 1))} W ${pct(c.W / (j || 1))} X ${pct(c.X / (j || 1))} · unjudged ${c.U} · medErr ${c.err.length ? pct(Math.exp(med(c.err)) - 1) : '-'} (n${c.err.length})`;
  };
  console.log(`[cp] split=${split} · ${grade.size} judged lots, ${found} non-card in the corpus · A=${fa.version} B=${fb.version} (${el()})`);
  const ks = Array.from(cells.a.keys()).sort((x, y) => (x === 'all' ? -1 : y === 'all' ? 1 : x < y ? -1 : 1));
  for (const k of ks) {
    if (cells.a.get(k)!.lots < 3) continue;
    const b = cells.b.get(k)!;
    console.log(`A ${k.padEnd(22)} ${fmt(cells.a.get(k)!)}`);
    console.log(`B ${k.padEnd(22)} ${fmt(b)}  | pairs dropped G ${b.drop.G} W ${b.drop.W} X ${b.drop.X}`);
  }
  console.log(`[cp] judged pairs B newly drops: G ${pairDrops.G}/${pairDrops.n.G} · W ${pairDrops.W}/${pairDrops.n.W} · X ${pairDrops.X}/${pairDrops.n.X}`);
  const we = withdrawn.filter(w => w.e != null).map(w => w.e!);
  console.log(`[cp] withdrawn by B: ${withdrawn.length} (with appraisal ${we.length}, A medErr ${we.length ? pct(Math.exp(med(we)) - 1) : '-'}) ${JSON.stringify(withdrawn.slice(0, 12))}`);
  if (arg('out')) fs.writeFileSync(arg('out')!, JSON.stringify({ rows, pairDropRows, withdrawn }, null, 1));
}
main();
