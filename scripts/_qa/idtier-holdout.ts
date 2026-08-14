/**
 * idtier-holdout.ts — temporal-holdout A/B for the exact-identity tier
 * (numeric watch refs / art editions) + autograph format gate (Aug 14).
 *
 * Scores the same recent sold targets twice through the REAL replay path
 * (backtest-core valueOne) with ID_TIER off then on, and reports per market:
 * coverage, flagged-cohort performance (realized vs estimate, beat-high rate),
 * comp-value error, and what the newly-valued / newly-flagged cohorts measure.
 *   RAY_SKIP_MAIN=1 npx tsx scripts/_qa/idtier-holdout.ts
 */
import { readCorpus } from '../corpus-io';
import { prepare, valueOne, hasAnyEst, estMidOf, estTopOf, median, type L } from '../backtest-core';
import { ID_TIER } from '../../app/lib/similarity';
import { ARTISTS } from '../../app/constants';
import type { AuctionLot } from '../../app/types';

const MK = new Set(['watches', 'art', 'science', 'culture']);
const SLUGS = new Set<string>([
  ...ARTISTS.filter(a => MK.has(a.market) && a.slug !== 'pokemon').map(a => a.slug),
  'autographs',
]);
const CAP: Record<string, number> = { watches: 800, art: 800, science: 1200, culture: 1200, sports: 500 };
const SINCE = '2025-02-01';

type Obs = { id: string; m: string; valued: boolean; flagged: boolean; perf: number; beat: boolean; err: number | null; idn: number };

function run(prep: ReturnType<typeof prepare>, targets: L[]): Map<string, Obs> {
  const out = new Map<string, Obs>();
  for (const t of targets) {
    const m = prep.marketBySlug[t.artist] || 'all';
    const estMid = estMidOf(t);
    const v = valueOne(prep, t);
    const realized = t.realizedUsd!;
    out.set(t.id, {
      id: t.id, m,
      valued: !!v,
      flagged: !!v?.signal?.label.startsWith('below'),
      perf: realized / estMid - 1,
      beat: realized > estTopOf(t),
      err: v && v.compValueUsd > 0 ? Math.abs(realized / v.compValueUsd - 1) : null,
      idn: (v as { idn?: number } | null)?.idn || 0,
    });
  }
  return out;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
function cohort(name: string, rows: Obs[]) {
  if (!rows.length) { console.log(`    ${name}: n=0`); return; }
  const perfs = rows.map(r => r.perf).sort((a, b) => a - b);
  const beats = rows.filter(r => r.beat).length;
  const errs = rows.map(r => r.err).filter((e): e is number => e != null).sort((a, b) => a - b);
  console.log(`    ${name}: n=${rows.length} medPerf=${pct(median(perfs))} beatHigh=${pct(beats / rows.length)} medAbsErr=${errs.length ? pct(median(errs)) : '—'}`);
}

async function main() {
  const t0 = Date.now();
  const all = (readCorpus() as unknown as AuctionLot[]).filter(l => SLUGS.has(l.artist));
  console.log(`[idtier] subset corpus: ${all.length} lots · ${((Date.now() - t0) / 1000).toFixed(0)}s load`);
  const prep = prepare(all, m => console.log(m), () => `${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // targets: recent sold with a real estimate band, newest-first per market cap
  const byM = new Map<string, L[]>();
  for (const l of prep.sold) {
    if (!hasAnyEst(l) || l.saleDate < SINCE) continue;
    const m = prep.marketBySlug[l.artist] || 'all';
    (byM.get(m) || byM.set(m, []).get(m)!).push(l);
  }
  const targets: L[] = [];
  Array.from(byM.entries()).forEach(([m, g]) => {
    g.sort((a, b) => (a.saleDate < b.saleDate ? 1 : -1));
    targets.push(...g.slice(0, CAP[m] || 500));
  });
  console.log(`[idtier] targets: ${targets.length} (${Array.from(byM.keys()).map(m => `${m}:${Math.min(byM.get(m)!.length, CAP[m] || 500)}`).join(' ')})`);

  ID_TIER.enabled = false;
  const off = run(prep, targets);
  console.log(`[idtier] OFF arm done · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  ID_TIER.enabled = true;
  const on = run(prep, targets);
  console.log(`[idtier] ON arm done · ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  for (const m of ['watches', 'art', 'science', 'culture', 'sports']) {
    const ids = targets.filter(t => (prep.marketBySlug[t.artist] || 'all') === m).map(t => t.id);
    if (!ids.length) continue;
    const A = ids.map(i => off.get(i)!), B = ids.map(i => on.get(i)!);
    console.log(`\n== ${m} (${ids.length} targets) ==`);
    console.log(`  coverage: ${A.filter(r => r.valued).length} → ${B.filter(r => r.valued).length} · flags: ${A.filter(r => r.flagged).length} → ${B.filter(r => r.flagged).length} · idn>0 lots: ${B.filter(r => r.idn > 0).length}`);
    console.log('  OFF:'); cohort('flagged', A.filter(r => r.flagged)); cohort('unflagged', A.filter(r => r.valued && !r.flagged));
    console.log('  ON: '); cohort('flagged', B.filter(r => r.flagged)); cohort('unflagged', B.filter(r => r.valued && !r.flagged));
    cohort('NEW-valued (on-only)', B.filter((r, i) => r.valued && !A[i].valued));
    cohort('NEW-flagged (on-only)', B.filter((r, i) => r.flagged && !A[i].flagged));
    cohort('LOST-flagged (off-only)', A.filter((r, i) => r.flagged && !B[i].flagged));
    cohort('idn-anchored (idn>=3)', B.filter(r => r.flagged && r.idn >= 3));
  }
  console.log(`\n[idtier] total ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
main().catch(e => { console.error(e); process.exit(1); });
