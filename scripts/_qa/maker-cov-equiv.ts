// Numeric equivalence for the quarter-column covariance solve (hedonic-index.ts).
//
//   RAY_SKIP_MAIN=1 NODE_OPTIONS=--max-old-space-size=10240 \
//     npx tsx scripts/_qa/maker-cov-equiv.ts [slug=patek-philippe ...]
//
// Builds the maker index twice per slug — RAY_COV_EIGEN=1 (the old full p×p
// eigen pseudo-inverse) vs the Cholesky quarter-column solve — and compares
// every published number (series levels + CIs, horizon changes + CIs) to a
// relative tolerance of 1e-6. Both are exact inverses of the same SPD matrix;
// they differ only in float rounding. Prints both timings.
import { readAllSegments } from '../corpus-io';
import { normalizeCorpus } from '../lib/corpus-normalize';
import type { AuctionLot } from '../../app/types';

const TOL = 1e-6;
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ['patek-philippe', 'rolex', 'audemars-piguet', 'cartier', 'andy-warhol'];
const all = readAllSegments() as unknown as AuctionLot[]; normalizeCorpus(all);
const by = new Map<string, AuctionLot[]>();
for (const l of all) if (l.artist && slugs.includes(l.artist)) (by.get(l.artist) || by.set(l.artist, []).get(l.artist)!).push(l);

const flat = (o: unknown, pre = '', out: Record<string, number> = {}): Record<string, number> => {
  if (typeof o === 'number') { out[pre] = o; return out; }
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (k !== 'diag' && k !== 'note') flat(v, pre ? `${pre}.${k}` : k, out);
  return out;
};
const now = new Date();
let bad = 0;
async function main() {
  for (const slug of slugs) {
    const lots = by.get(slug); if (!lots) { console.log(`[cov-equiv] ${slug}: not in local corpus`); continue; }
    process.env.RAY_COV_EIGEN = '1';
    delete require.cache[require.resolve('../hedonic-index')];
    let { buildMakerIndex } = require('../hedonic-index');
    let t = Date.now(); const oldR = buildMakerIndex(lots, now); const oldS = (Date.now() - t) / 1000;
    process.env.RAY_COV_EIGEN = '';
    delete require.cache[require.resolve('../hedonic-index')];
    ({ buildMakerIndex } = require('../hedonic-index'));
    t = Date.now(); const newR = buildMakerIndex(lots, now); const newS = (Date.now() - t) / 1000;
    const a = flat(oldR), b = flat(newR);
    let maxRel = 0, worst = '';
    for (const k of Object.keys(a)) {
      const x = a[k], y = b[k];
      if (!(k in b)) { bad++; console.log(`  MISSING ${k}`); continue; }
      const rel = Math.abs(x - y) / Math.max(1e-9, Math.abs(x));
      if (rel > maxRel) { maxRel = rel; worst = k; }
      if (rel > TOL) { bad++; console.log(`  DIFF ${slug} ${k}: ${x} vs ${y} (rel ${rel.toExponential(2)})`); }
    }
    console.log(`[cov-equiv] ${slug.padEnd(18)} eigen ${oldS.toFixed(1)}s → cholesky ${newS.toFixed(1)}s (${(oldS / Math.max(0.1, newS)).toFixed(1)}×) · ${Object.keys(a).length} numbers · max rel diff ${maxRel.toExponential(2)} at ${worst || '-'}`);
  }
  if (bad) { console.error(`[cov-equiv] ${bad} mismatches`); process.exit(1); }
  console.log('[cov-equiv] all within tolerance');
}
main();
