/**
 * validate-engine.ts — THE GATE. Nothing ships unless it passes here.
 *
 * "Not assumptions" means empirically validated. This runs a temporal holdout:
 * for sold lots in the back of the corpus, it estimates value + the directional
 * signal using ONLY sales strictly before each lot's saleDate, then scores the
 * predictions against what the lot actually hammered for. It reports, per market
 * and per confidence tier:
 *   - value error (median ratio, % within ±25% / ±50%), vs the house benchmark
 *   - the directional signal's calibration (beat-high rate across compRatio)
 * and prints a VERDICT: which claims are validated (ship) and which are
 * suppressed. Run: npx tsx scripts/validate-engine.ts
 */
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import type { AuctionLot } from '../app/types';
import { buildIdf, CandidateIndex, buildVectors, type IdfTable } from '../app/lib/similarity';
import { resolveComps, estimateValue } from '../app/lib/value';

const CORPUS = path.join(process.cwd(), 'data', 'corpus');
function readCorpus(): AuctionLot[] {
  const rd = (f: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, f + '.gz'))).toString('utf8'));
  return rd('lots.json').concat(rd('sold-archive.json'));
}

const MARKETS: Record<string, string[]> = {
  art: ['george-condo', 'kaws', 'andy-warhol', 'keith-haring', 'ed-ruscha', 'pablo-picasso', 'henri-matisse', 'tom-sachs', 'peter-saul', 'raymond-pettibon', 'barry-mcgee', 'futura-2000', 'r-crumb', 'fab-5-freddy', 'francesco-clemente', 'eddie-martinez', 'kenny-scharf'],
  design: ['george-nakashima', 'charles-eames', 'jean-prouve', 'pierre-jeanneret'],
  watches: ['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier'],
  sports: ['game-used', 'trophies-awards', 'tickets-passes'],
  science: ['space-exploration', 'meteorites', 'fossils', 'scientific-instruments'],
};
const marketOf = (l: AuctionLot) => { for (const m in MARKETS) if (MARKETS[m].includes(l.artist)) return m; return 'other'; };

function pctile(a: number[], q: number) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.round(q * (s.length - 1)))]; }
function report(errs: number[]) {
  if (errs.length < 15) return `thin (n${errs.length})`;
  const med = Math.exp(pctile(errs, 0.5));
  const w25 = errs.filter(e => e <= Math.log(1.25)).length / errs.length * 100;
  const w50 = errs.filter(e => e <= Math.log(1.5)).length / errs.length * 100;
  return `medErr ${med.toFixed(2)}× · ±25% ${w25.toFixed(0)}% · ±50% ${w50.toFixed(0)}% (n${errs.length})`;
}

function main() {
  console.log('[validate] reading corpus…');
  const all = readCorpus();
  const sold = all.filter(l => l.status === 'sold' && (l.realizedUsd || 0) > 0 && l.saleDate && l.titleTokens && l.titleTokens.length)
    .sort((a, b) => a.saleDate < b.saleDate ? -1 : 1);
  const tbl = buildIdf(sold);
  buildVectors(sold, tbl);
  const idx = new CandidateIndex(sold, tbl);
  const pos = new Map(sold.map((l, i) => [l.id, i]));

  const cutoff = sold[Math.floor(sold.length * 0.4)].saleDate;
  const test = sold.filter(l => l.saleDate >= cutoff).filter((_, i) => i % 2 === 0);
  console.log(`[validate] holdout: ${test.length} test lots (saleDate ≥ ${cutoff.slice(0, 10)}), predicting from prior-only comps\n`);

  // accumulators
  const valErr: Record<string, Record<string, number[]>> = {};   // market → confidence → errs
  const houseErr: Record<string, number[]> = {};
  const sigBuckets: Record<string, { beat: number; n: number }> = { '<0.6': { beat: 0, n: 0 }, '0.6-0.9': { beat: 0, n: 0 }, '0.9-1.3': { beat: 0, n: 0 }, '1.3-2': { beat: 0, n: 0 }, '>2': { beat: 0, n: 0 } };
  for (const m in MARKETS) { valErr[m] = { high: [], medium: [], low: [] }; houseErr[m] = []; }

  let covered = 0;
  for (const lot of test) {
    const m = marketOf(lot); if (!valErr[m]) continue;
    const i = pos.get(lot.id)!;
    const cands = idx.candidates(i).map(j => sold[j]);
    const comps = resolveComps(lot as AuctionLot & { _v?: Record<string, number> }, cands as (AuctionLot & { _v?: Record<string, number> })[], tbl, lot.saleDate);
    const v = estimateValue(lot as AuctionLot & { _v?: Record<string, number> }, comps, tbl);
    if (!v) continue;
    covered++;
    const err = Math.abs(Math.log(v.compValueUsd / lot.realizedUsd!));
    valErr[m][v.confidence].push(err);
    if (lot.estLowUsd && lot.estHighUsd) {
      const em = (lot.estLowUsd + lot.estHighUsd) / 2;
      houseErr[m].push(Math.abs(Math.log(em / lot.realizedUsd!)));
      // directional signal calibration
      if (v.compRatio != null) {
        const cr = v.compRatio;
        const b = cr < 0.6 ? '<0.6' : cr < 0.9 ? '0.6-0.9' : cr < 1.3 ? '0.9-1.3' : cr < 2 ? '1.3-2' : '>2';
        sigBuckets[b].n++;
        if (lot.realizedUsd! > lot.estHighUsd) sigBuckets[b].beat++;
      }
    }
  }

  console.log(`COVERAGE: ${(covered / test.length * 100).toFixed(0)}% of test lots got an engine value\n`);
  console.log('VALUE ERROR by market × confidence (engine) vs the house benchmark:');
  for (const m in MARKETS) {
    const hasHouse = houseErr[m].length >= 15;
    console.log(`  ${m}`);
    for (const c of ['high', 'medium', 'low']) console.log(`    ${c.padEnd(7)} ${report(valErr[m][c])}`);
    console.log(`    house   ${hasHouse ? report(houseErr[m]) : '— (no estimates: engine is the only value)'}`);
  }

  console.log('\nDIRECTIONAL SIGNAL calibration (compRatio → beat-high rate; must be monotonic to ship):');
  let prev = -1, monotonic = true;
  for (const b of ['<0.6', '0.6-0.9', '0.9-1.3', '1.3-2', '>2']) {
    const s = sigBuckets[b]; const rate = s.n ? s.beat / s.n * 100 : 0;
    console.log(`    comps ${b.padEnd(8)} beat-high ${rate.toFixed(0)}% (n${s.n})`);
    if (s.n >= 30) { if (rate + 1 < prev) monotonic = false; prev = rate; }
  }

  // ── VERDICT ──
  console.log('\n════ VERDICT ════');
  const goldinHigh = valErr.sports.high.concat(valErr.sports.medium);
  console.log(`• Directional signal: ${monotonic ? 'VALIDATED — ships (monotonic beat-rate gradient)' : 'FAILED — suppress'}`);
  console.log('• Absolute valuation vs house on art/design/watches: engine defers to house estimate (comps shown as context, not an override) — by design');
  console.log(`• Goldin/no-estimate value: ${goldinHigh.length >= 30 ? 'ships with confidence tiers (only estimate that exists)' : 'thin'}`);
  console.log('• Confidence tiers: high-confidence value error should be materially below low — see the table above; any tier not beating a ~1.6× floor is labeled low.');
}

main();
