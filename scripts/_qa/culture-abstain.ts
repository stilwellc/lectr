/** Why do 98% of culture estimate-lots seat no comps? Sample recent culture
 *  sold w/ estimates, walk resolveComps, and bucket the failure reason.
 *    RAY_SKIP_MAIN=1 npx tsx scripts/_qa/culture-abstain.ts */
import { readCorpus } from '../corpus-io';
import { prepare, hasEst, type L } from '../backtest-core';
import { resolveComps } from '../../app/lib/value';
import { similarity } from '../../app/lib/similarity';
import { ARTISTS } from '../../app/constants';
import type { AuctionLot } from '../../app/types';

const SLUGS = new Set<string>(ARTISTS.filter(a => (a.market === 'culture' || a.market === 'science') && a.slug !== 'pokemon').map(a => a.slug));

async function main() {
  const all = (readCorpus() as unknown as AuctionLot[]).filter(l => SLUGS.has(l.artist));
  const prep = prepare(all, m => console.log(m), () => '');
  const targets = prep.sold.filter(l => hasEst(l) && l.saleDate >= '2025-02-01').slice(-400);
  console.log(`[abst] ${targets.length} targets; slug spread:`, targets.reduce((m: Record<string, number>, t) => { m[t.artist] = (m[t.artist] || 0) + 1; return m; }, {}));

  const stats = { noPool: 0, hasPrior: 0, seated: 0 };
  const gateFail: Record<string, number> = { none_cls: 0, cos_low: 0, score_low: 0, passed: 0 };
  let sampled = 0;
  for (const t of targets) {
    const roster = (prep.byArtist.get(t.artist) || []).filter(s => s.id !== t.id && s.saleDate < t.saleDate);
    if (roster.length < 3) { stats.noPool++; continue; }
    stats.hasPrior++;
    const comps = resolveComps(t, roster, prep.tbl, t.saleDate);
    const passing = comps.filter(c => c.match.cosine >= 0.45 && c.match.score >= 55 && c.realizedUsd > 0);
    if (passing.length >= 3) { stats.seated++; continue; }
    // autopsy the best 200 candidates for the first 40 failures
    if (sampled < 40) {
      sampled++;
      let bestCos = 0, above4 = 0, above45 = 0, clsNone = 0;
      for (const s of roster) {
        const m = similarity(t as L & { _v?: Record<string, number> }, s as L & { _v?: Record<string, number> }, prep.tbl);
        if (m.cls === 'none') { clsNone++; continue; }
        bestCos = Math.max(bestCos, m.cosine);
        if (m.cosine >= 0.4) above4++;
        if (m.cosine >= 0.45 && m.score >= 55) above45++;
      }
      if (sampled <= 12) console.log(`  [${t.artist}] "${(t.title || '').slice(0, 60)}" roster=${roster.length} clsNone=${clsNone} cos≥.4=${above4} passGate=${above45} bestCos=${bestCos.toFixed(2)}`);
      if (above45 === 0 && above4 === 0) gateFail.cos_low++;
      else if (above45 < 3) gateFail.score_low++;
      else gateFail.passed++;
    }
  }
  console.log('[abst] pools:', stats, '| failure buckets (40 sampled):', gateFail);
}
main().catch(e => { console.error(e); process.exit(1); });
