/**
 * band-tier-sim.ts — THE BAND RESCORER (Oct 6 2026, pricing wave 10). Re-fits
 * only the published-value band (backtest-core.fitValueBands, via
 * calibrationFor at each quarter start) under band variants and rescores the
 * rows of an engine-ab.ts run: the value and tier stay the run's own, the
 * band becomes value × the variant's path × tier (× market) cell. Prints
 * coverage and mean log width by tier × market for each variant.
 *
 *   npx tsx scripts/oneoff/qa/band-tier-sim.ts --corpus <dir> --rows ho.json[,train.json] \
 *     --variants "base:vbTier=0;fit:vbTier=1,table=k.json"
 *
 * Variant keys: vbTier=0|1, table=<band-tier-fit.ts --out> (VB_TIER.k; the
 * served table when absent).
 * Never writes to data/ or public/. tsconfig-excluded (_qa).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readGzRows } from '../../corpus-io';
import { normalizeCorpus } from '../../lib/corpus-normalize';
import { prepare, calibrationFor, rehydrateState, type BacktestState, type EngineRow } from '../../backtest-core';
import { setEngineFlags, ENGINE_FLAGS_CURRENT, VB_TIER, type EngineCalibration } from '../../../app/lib/value';
import type { AuctionLot } from '../../../app/types';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };
type Row = EngineRow & { sd: string };

function main() {
  const dir = arg('corpus') || 'data/corpus';
  const files = (arg('rows') || '').split(',').filter(Boolean);
  const variants = (arg('variants') || 'base:vbTier=0;tier:vbTier=1').split(';').map(v => { const [name, spec] = v.split(':'); return { name, spec: spec || '' }; });
  const lots = (readGzRows(path.join(dir, 'lots.json.gz')) as unknown as AuctionLot[])
    .concat(readGzRows(path.join(dir, 'sold-archive.json.gz')) as unknown as AuctionLot[]);
  normalizeCorpus(lots as never);
  const EXC = new Set(['sports-cards', 'graded-cards', 'pokemon']);
  const eng = lots.filter(l => !EXC.has(l.artist) && (l as AuctionLot & { source?: string }).source !== 'sothebys-algolia');
  const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'backtest-state.json.gz'))).toString('utf8')) as BacktestState;
  const prep = prepare(eng, () => {}, () => '');
  rehydrateState(st, prep, () => {});
  const qOf = (sd: string) => `${sd.slice(0, 4)}Q${Math.floor((+sd.slice(5, 7) - 1) / 3) + 1}`;
  const qStart = (q: string) => `${q.slice(0, 4)}-${String((+q.slice(5) - 1) * 3 + 1).padStart(2, '0')}-01`;
  const served = VB_TIER.k;
  for (const f of files) {
    const rows = (JSON.parse(fs.readFileSync(f, 'utf8')).rowsB as Row[]).filter(r => r.p > 0 && r.lo > 0 && r.hi > 0 && r.r > 0);
    const quarters = Array.from(new Set(rows.map(r => qOf(r.sd)))).sort();
    console.log(`\n=== ${path.basename(f)} · ${rows.length} rows · ${quarters.join(' ')}`);
    // the run's own band, as a check on the rescorer
    const runCov = rows.filter(r => r.lo <= r.r && r.r <= r.hi).length / rows.length;
    for (const v of variants) {
      const on: Record<string, string> = {};
      for (const kv of v.spec.split(',').filter(Boolean)) { const [k, x] = kv.split('='); on[k] = x; }
      VB_TIER.k = on.table ? JSON.parse(fs.readFileSync(on.table, 'utf8')) : served;
      setEngineFlags({ ...ENGINE_FLAGS_CURRENT, vbTier: on.vbTier === '1' });
      const cals = new Map<string, EngineCalibration | null>();
      for (const q of quarters) cals.set(q, calibrationFor(st, qStart(q), prep.marketBySlug));
      type Acc = { n: number; hit: number; w: number };
      const acc = new Map<string, Acc>();
      const add = (k: string, hit: boolean, w: number) => { const a = acc.get(k) || acc.set(k, { n: 0, hit: 0, w: 0 }).get(k)!; a.n++; a.hit += hit ? 1 : 0; a.w += w; };
      for (const r of rows) {
        const cal = cals.get(qOf(r.sd));
        const noest = r.m.startsWith('noest:');
        const m = noest ? r.m.slice(6) : r.m;
        const pth = noest ? 'n' : 'e';
        const vb = cal?.valueBandByMarket?.[m]?.[pth]?.[r.conf] || cal?.valueBand?.[pth]?.[r.conf];
        let lo = r.lo, hi = r.hi;
        if (vb) { lo = Math.min(r.p, r.p * vb.lo); hi = Math.max(r.p, r.p * vb.hi); }
        const hit = lo <= r.r && r.r <= hi, w = Math.log(hi / lo);
        for (const k of [`${r.m}|${r.conf}`, `${r.m}|all`, `ALL|${r.conf}`, 'ALL|all', ...(noest ? [] : [`EST|${r.conf}`, 'EST|all'])]) add(k, hit, w);
      }
      const cell = (k: string) => { const a = acc.get(k); return a ? `${String(a.n).padStart(4)} ${(100 * a.hit / a.n).toFixed(1).padStart(5)}% ${(a.w / a.n).toFixed(2)}` : '                 -'; };
      console.log(`--- ${v.name} (${v.spec || 'current'})${v.name === variants[0].name ? ` · run's own band ${(100 * runCov).toFixed(1)}%` : ''}`);
      const ms = Array.from(new Set(rows.map(r => r.m))).sort();
      for (const m of [...ms, 'EST', 'ALL']) console.log(`  ${m.padEnd(15)} ${['high', 'medium', 'low', 'all'].map(c => cell(`${m}|${c}`)).join(' | ')}`);
    }
  }
  setEngineFlags(null);
}
main();
