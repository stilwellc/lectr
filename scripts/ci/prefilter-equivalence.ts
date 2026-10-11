/**
 * prefilter-equivalence.ts — proves the BOUNDED candidate pre-filter
 * (backtest-core.candidatePriors, Oct 11 2026) admits exactly the comp pools
 * the previous prefix-only filter did.
 *
 * Loads the corpus (readCorpus, from cwd's data/corpus), prepares it once, and
 * for a date-spread sample of every market's replay targets runs BOTH filters
 * → resolveComps, comparing the admitted pool (id, match, price, date) and the
 * prior count. Also times both.
 *
 *   NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/ci/prefilter-equivalence.ts [--n 4000] [--markets watches,sports]
 *
 * Exit 0 = every pool identical; 1 = a mismatch (first few printed).
 */
import { readCorpus } from '../corpus-io';
import { prepare, candidatePriors, identityKeyOf, targetsOf, type Prepared, type L } from '../backtest-core';
import { resolveComps, FALLBACK_GATE } from '../../app/lib/value';
import { ARTISTS } from '../../app/constants';
import type { AuctionLot } from '../../app/types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function lowerBound(dates: string[], d: string): number {
  let lo = 0, hi = dates.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] < d) lo = m + 1; else hi = m; }
  return lo;
}

/** The pre-Oct-11 candidatePriors, verbatim (heaviest-IDF prefix + identity
 *  postings), on its own visited marks so it cannot disturb the new one's. */
const legacyMarks = new Map<string, { mark: Int32Array; gen: number }>();
function legacyCandidatePriors(prep: Prepared, lot: L): { priors: number; cands: L[] } {
  const ix = prep.index.get(lot.artist) as unknown as { roster: L[]; dates: string[]; posting: Map<string, number[]>; idPosting: Map<string, number[]> } | undefined;
  if (!ix) return { priors: 0, cands: [] };
  const cut = lowerBound(ix.dates, lot.saleDate);
  if (cut < 3) return { priors: cut, cands: [] };
  let st = legacyMarks.get(lot.artist);
  if (!st) { st = { mark: new Int32Array(ix.roster.length), gen: 0 }; legacyMarks.set(lot.artist, st); }
  const v = lot._v || {};
  const vn = lot._vn || 0;
  st.gen++;
  const gen = st.gen, mark = st.mark;
  const hits: number[] = [];
  const visit = (list: number[] | undefined) => {
    if (!list) return;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (i >= cut) break;
      if (mark[i] !== gen) { mark[i] = gen; hits.push(i); }
    }
  };
  if (vn > 0) {
    const toks = Object.keys(v).sort((a, b) => v[b] - v[a]);
    const floor = FALLBACK_GATE.cosFloor - 1e-9;
    let suffix2 = vn * vn;
    for (const t of toks) {
      if (Math.sqrt(Math.max(0, suffix2)) / vn < floor) break;
      visit(ix.posting.get(t));
      suffix2 -= v[t] * v[t];
    }
  }
  const idk = identityKeyOf(lot);
  if (idk) visit(ix.idPosting.get(idk));
  hits.sort((a, b) => b - a);
  const cands: L[] = [];
  for (const i of hits) { const s = ix.roster[i]; if (s.id !== lot.id) cands.push(s); }
  return { priors: cut, cands };
}

const key = (p: ReturnType<typeof resolveComps> | null) => (p ? JSON.stringify(p.map(c => [c.id, c.match, c.realizedUsd, c.saleDate])) : 'null');

function main() {
  const N = Number(arg('n') || 4000);
  const markets = (arg('markets') || [...Array.from(new Set(ARTISTS.map(a => a.market))), 'other'].join(',')).split(',');
  const t0 = Date.now();
  const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const lots = readCorpus() as unknown as AuctionLot[];
  const prep = prepare(lots, console.log, el);
  let bad = 0;
  for (const m of markets) {
    const { soldTargets, biTargets, noEstTargets } = targetsOf(prep, m);
    const all = [...soldTargets, ...biTargets, ...noEstTargets].sort((a, b) => (a.saleDate < b.saleDate ? -1 : 1));
    if (!all.length) { console.log(`[prefilter-eq] ${m}: no targets`); continue; }
    const step = Math.max(1, Math.floor(all.length / N));
    const sample = all.filter((_, i) => i % step === 0).slice(0, N);
    let cOld = 0, cNew = 0, tOld = 0, tNew = 0, mism = 0;
    // warm every memo (shapes, refs, vectors) both paths touch, then time
    // them in ALTERNATING order so neither rides the other's warm caches
    for (const l of sample) { const r = legacyCandidatePriors(prep, l); if (r.priors >= 3) resolveComps(l, r.cands, prep.tbl, l.saleDate); }
    let k = 0;
    for (const l of sample) {
      const runOld = () => { const a = process.hrtime.bigint(); const r = legacyCandidatePriors(prep, l); const p = r.priors >= 3 ? resolveComps(l, r.cands, prep.tbl, l.saleDate) : null; tOld += Number(process.hrtime.bigint() - a); return { r, p }; };
      const runNew = () => { const a = process.hrtime.bigint(); const r = candidatePriors(prep, l); const p = r.priors >= 3 ? resolveComps(l, r.cands, prep.tbl, l.saleDate) : null; tNew += Number(process.hrtime.bigint() - a); return { r, p }; };
      let o: ReturnType<typeof runOld>, nw: ReturnType<typeof runNew>;
      if (k++ % 2) { nw = runNew(); o = runOld(); } else { o = runOld(); nw = runNew(); }
      const r0 = o.r, p0 = o.p, r1 = nw.r, p1 = nw.p;
      cOld += r0.cands.length; cNew += r1.cands.length;
      if (r0.priors !== r1.priors || key(p0) !== key(p1)) {
        if (mism++ < 3) console.log(`  MISMATCH ${m} ${l.id}: priors ${r0.priors}/${r1.priors} · pool ${p0?.length ?? 'null'}/${p1?.length ?? 'null'}`);
      }
    }
    bad += mism;
    const n = sample.length;
    console.log(`[prefilter-eq] ${m}: ${n} targets (of ${all.length}) · candidates ${(cOld / n).toFixed(0)} → ${(cNew / n).toFixed(0)} · filter+resolve ${(tOld / n / 1e6).toFixed(2)} → ${(tNew / n / 1e6).toFixed(2)} ms (${(tOld / Math.max(1, tNew)).toFixed(1)}×) · pool mismatches ${mism}`);
  }
  console.log(`[prefilter-eq] ${bad ? `${bad} MISMATCH(ES)` : 'all pools identical'} (${el()})`);
  process.exit(bad ? 1 : 0);
}
main();
