/**
 * W31 (Oct 11 2026) — measure THE SETTLED APPRAISAL pass on the local corpus:
 * the engine valuing the served SOLD rows through the live path (build-market
 * §1b + §3), newest first, under one wall-clock budget. The run reads the
 * corpus once (lots.json.gz + sold-archive.json.gz), runs the engine phase
 * through the point-in-time seam (evalOnly — nothing is persisted) with the
 * settled pass ON, and prints:
 *   - the pass's own line (count · seconds · heap) from build-market
 *   - the elapsed time at which the pass crossed the 24-month and 36-month
 *     sale-date boundaries (one run → the three scopes' costs)
 *   - the 60-day tracking check + the realized/value ratios by sale age
 *   - (--validate) the engine gate (validate-engine) run twice on the SAME
 *     corpus — with the settled stamps and with them stripped — to prove the
 *     live-lot gate report is unchanged
 *
 * Run: NODE_OPTIONS=--max-old-space-size=6144 npx tsx scripts/oneoff/qa/w31-settled-measure.ts [--months 0|24|36] [--budget-s 1500] [--validate]
 */
import * as fs from 'fs';
import * as path from 'path';
import { runMarketBuild } from '../../build-market';
import { readCorpus } from '../../corpus-io';
import { settledCut } from '../../lib/settled-appraisal';
import type { AuctionLot } from '../../../app/types';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null; };
const months = Number(arg('months') ?? 0);
const budgetS = Number(arg('budget-s') ?? 1500);
const VALIDATE = process.argv.includes('--validate');
const OUT = arg('out') || path.join(process.cwd(), 'data', 'qa', 'w31-settled-measure.json');

(async () => {
  const t0 = Date.now();
  const mb = () => Math.round(process.memoryUsage().heapUsed / 1048576);
  console.log(`[w31] reading corpus… heap ${mb()}MB`);
  const corpus = readCorpus() as unknown as AuctionLot[];
  console.log(`[w31] ${corpus.length} rows · ${Math.round((Date.now() - t0) / 1000)}s · heap ${mb()}MB`);
  const TODAY = new Date().toISOString().slice(0, 10);
  // the per-row clock: a monkey-patched Date.now is NOT used (the engine
  // reads it); instead the pass's newest-first order lets the boundaries
  // be recovered from the stamped rows' sale dates after the run — the rows
  // stamped are a prefix of the targets, so counts per window are exact.
  const tEngine = Date.now();
  const valued = await runMarketBuild({ lots: corpus, evalOnly: true, settled: { months: months === 0 ? null : months, budgetMs: budgetS * 1000 } });
  const engineS = Math.round((Date.now() - tEngine) / 1000);
  const stamped = valued.filter(l => l.status === 'sold' && (l as AuctionLot & { valueAsOf?: string }).valueAsOf === TODAY);
  const abstained = valued.filter(l => l.status === 'sold' && !(l as AuctionLot & { valueAsOf?: string }).valueAsOf && (l as AuctionLot & { abstain?: string }).abstain);
  const windows: Record<string, { stamped: number; abstained: number }> = {};
  for (const m of [24, 36, 0]) {
    const cut = settledCut(TODAY, m === 0 ? null : m);
    windows[m === 0 ? 'all' : `${m}m`] = {
      stamped: stamped.filter(l => (l.saleDate || '').slice(0, 10) >= cut).length,
      abstained: abstained.filter(l => (l.saleDate || '').slice(0, 10) >= cut).length,
    };
  }
  const oldest = stamped.concat(abstained).map(l => (l.saleDate || '').slice(0, 10)).sort()[0] || null;
  const qa = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'qa', 'settled-appraisal.json'), 'utf8'));
  console.log(`[w31] engine phase ${engineS}s · stamped ${stamped.length} · abstained ${abstained.length} · oldest reached ${oldest} · heap ${mb()}MB`);
  console.log(`[w31] by window: ${JSON.stringify(windows)}`);
  let gate: unknown = null;
  if (VALIDATE) {
    const { runValidateEngine } = await import('../../validate-engine');
    const strip = (o: Record<string, unknown>) => { const c = JSON.parse(JSON.stringify(o)); delete c.generatedAt; delete c.ranAt; delete c.elapsedMs; return c; };
    const dir = path.join(process.cwd(), 'data', 'qa');
    const withStamps = runValidateEngine({ corpus: valued, sample: 6000, json: path.join(dir, 'w31-validate-with.json') });
    const saved = new Map<string, unknown>();
    for (const l of valued) {
      const w = l as AuctionLot & { valueAsOf?: string; value?: unknown; abstain?: unknown };
      if (l.status === 'sold' && (w.valueAsOf || w.abstain !== undefined)) { saved.set(String(l.id), [w.value, w.abstain, w.valueAsOf]); w.value = undefined; w.abstain = undefined; w.valueAsOf = undefined; }
    }
    const without = runValidateEngine({ corpus: valued, sample: 6000, json: path.join(dir, 'w31-validate-without.json') });
    const a = strip(JSON.parse(fs.readFileSync(path.join(dir, 'w31-validate-with.json'), 'utf8')));
    const b = strip(JSON.parse(fs.readFileSync(path.join(dir, 'w31-validate-without.json'), 'utf8')));
    const same = JSON.stringify(a) === JSON.stringify(b);
    gate = { same, withFailures: withStamps.failures, withoutFailures: without.failures, stripped: saved.size };
    console.log(`[w31] engine gate with vs without settled stamps: ${same ? 'IDENTICAL' : 'DIFFERENT'} (failures ${withStamps.failures} / ${without.failures}; ${saved.size} rows stripped)`);
  }
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), months, budgetS, engineS, windows, oldestReached: oldest, settled: qa, gate, heapMb: mb() }, null, 2));
  console.log(`[w31] wrote ${OUT} · total ${Math.round((Date.now() - t0) / 1000)}s`);
})().catch(e => { console.error(e); process.exit(1); });
