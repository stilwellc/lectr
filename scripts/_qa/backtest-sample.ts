/**
 * backtest-sample.ts — a version-agnostic point-in-time replay on a SAMPLE of
 * recent targets (Sep 27 2026 engine pass). Loads the engine from `--code`
 * (this worktree, or an exported copy of an older commit), replays the sampled
 * targets in sale order with the calibration each quarter would have loaded
 * (calibrationFor over the supplied backtest state's rows dated before the
 * quarter) and — when the engine has one — the point-in-time market index,
 * and writes one row per target for scripts scoring (before/after on the
 * identical target list).
 *
 *   npx tsx scripts/_qa/backtest-sample.ts --code <dir> --corpus <dir> \
 *     --from 2025-10-01 --per-market 1500 --noest 3000 --out rows.json
 *
 * Never writes to data/ or public/. tsconfig-excluded (_qa).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };

async function main() {
  const code = path.resolve(arg('code') || process.cwd());
  const corpus = arg('corpus')!;
  const from = arg('from') || '2025-10-01';
  const perMarket = parseInt(arg('per-market') || '1500', 10);
  const noEstN = parseInt(arg('noest') || '3000', 10);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const core = require(path.join(code, 'scripts/backtest-core'));
  const value = require(path.join(code, 'app/lib/value'));
  const { readGzRows } = require(path.join(code, 'scripts/corpus-io'));
  const { normalizeCorpus } = require(path.join(code, 'scripts/lib/corpus-normalize'));
  const t0 = Date.now();
  const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const lots = readGzRows(path.join(corpus, 'lots.json.gz')).concat(readGzRows(path.join(corpus, 'sold-archive.json.gz')));
  normalizeCorpus(lots);
  // engine exclusions (build-market / validate-engine)
  const EXC = new Set(['sports-cards', 'graded-cards', 'pokemon']);
  const eng = lots.filter((l: { artist: string; source?: string }) => !EXC.has(l.artist) && l.source !== 'sothebys-algolia');
  console.log(`[sample] corpus ${lots.length} → engine ${eng.length} (${el()})`);
  const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(corpus, 'backtest-state.json.gz'))).toString('utf8'));
  if (core.rehydrateState) core.rehydrateState(st, null, () => {});
  const prep = core.prepare(eng, console.log, el);
  const tg = core.targetsOf(prep);
  const mOf = (l: { artist: string }) => prep.marketBySlug[l.artist] || 'other';
  // deterministic stratified sample of the recent estimate targets
  const est = tg.soldTargets.filter((l: { saleDate: string }) => l.saleDate >= from);
  const byM = new Map<string, unknown[]>();
  for (const l of est) { const m = mOf(l); (byM.get(m) || byM.set(m, []).get(m)!).push(l); }
  const pick: { l: Record<string, unknown>; k: 'e' | 'n' }[] = [];
  byM.forEach(arr => { const step = Math.max(1, Math.ceil(arr.length / perMarket)); for (let i = 0; i < arr.length; i += step) pick.push({ l: arr[i] as Record<string, unknown>, k: 'e' }); });
  // no-estimate hedonic targets (same window) — sampled evenly
  const hasAnyEst = (l: { estLowUsd?: number; estHighUsd?: number }) => (l.estLowUsd || 0) > 0 || (l.estHighUsd || 0) > 0;
  const ne = prep.sold.filter((l: { saleDate: string; artist: string }) => l.saleDate >= from && !hasAnyEst(l as never) && !EXC.has(l.artist));
  { const step = Math.max(1, Math.ceil(ne.length / noEstN)); for (let i = 0; i < ne.length; i += step) pick.push({ l: ne[i], k: 'n' }); }
  pick.sort((a, b) => ((a.l.saleDate as string) < (b.l.saleDate as string) ? -1 : 1));
  console.log(`[sample] ${pick.filter(p => p.k === 'e').length} estimate + ${pick.filter(p => p.k === 'n').length} no-estimate targets since ${from} (${el()})`);
  const out: Record<string, unknown>[] = [];
  let curQ = '';
  const qOf = (sd: string) => `${sd.slice(0, 4)}Q${Math.floor((+sd.slice(5, 7) - 1) / 3) + 1}`;
  const qStart = (q: string) => `${q.slice(0, 4)}-${String((+q.slice(5) - 1) * 3 + 1).padStart(2, '0')}-01`;
  for (const { l, k } of pick) {
    const q = qOf(l.saleDate as string);
    if (q !== curQ) {
      curQ = q;
      value.setCalibration(core.calibrationFor(st, qStart(q), prep.marketBySlug));
      if (value.setTimeIndex && prep.timeIndexer) value.setTimeIndex(prep.timeIndexer(qStart(q)));
      console.log(`[sample] quarter ${q} (${el()})`);
    }
    const v = core.valueOne(prep, l);
    const lo = (l.estLowUsd as number) || 0, hi = (l.estHighUsd as number) || 0;
    out.push({
      id: l.id, k, m: mOf(l as { artist: string }), h: l.auctionHouse, sd: l.saleDate, r: l.realizedUsd,
      mid: lo && hi ? (lo + hi) / 2 : (lo || hi), eh: hi || lo, et: lo && hi ? 'b' : 'p',
      cv: v ? v.compValueUsd : null, vlo: v ? v.low : null, vhi: v ? v.high : null, conf: v ? v.confidence : null,
      cr: v ? v.compRatio : null, sig: v?.signal?.label ?? null, cm: v?.compAdjUsd ?? null, bw: v?.blendW ?? null,
    });
  }
  fs.writeFileSync(arg('out')!, JSON.stringify(out));
  console.log(`[sample] wrote ${out.length} rows (${el()})`);
}
main().catch(e => { console.error(e); process.exit(1); });
