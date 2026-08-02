/* QA probe: fit an empirical grade multiplier ladder via within-card paired
 * log-ratios (mix-immune). Group by player|year|set|cardNo; within each group,
 * median price per grade rung; form cross-grade pairs → log(medHi/medLo) as an
 * observation of logMult[hi]-logMult[lo]. Least-squares vs a base rung. */
import { readGzRows } from '../corpus-io';

function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

const rows = readGzRows('data/corpus/sold-archive.json.gz');
type C = { playerSlug?: string; year?: string; setName?: string | null; cardNo?: string; gradeCo?: string; gradeNum?: number | null };

// grade rung key — grade NUMBER only (collapse graders PSA/BGS/SGC/CGC onto a
// shared numeric ladder; grader-brand effects are a second-order refinement).
// We restrict to the dense numeric rungs.
const RUNGS = [7, 8, 8.5, 9, 9.5, 10] as const;
const rungSet = new Set<number>(RUNGS as unknown as number[]);

// group by ladder key → grade → prices
const groups = new Map<string, Map<number, number[]>>();
let considered = 0;
for (const l of rows as any[]) {
  if (l.artist !== 'sports-cards' || l.status !== 'sold') continue;
  const price = (l.realizedUsd > 0 ? l.realizedUsd : l.priceUsd) || 0;
  if (!(price > 0)) continue;
  const c: C = l._card;
  if (!c || !c.playerSlug || !c.year || !c.cardNo || c.gradeNum == null) continue;
  if (!rungSet.has(c.gradeNum)) continue;
  const set = (c.setName || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const key = `${c.playerSlug}|${c.year}|${set}|${c.cardNo.toLowerCase()}`;
  let g = groups.get(key);
  if (!g) { g = new Map(); groups.set(key, g); }
  (g.get(c.gradeNum) || g.set(c.gradeNum, []).get(c.gradeNum)!).push(price);
  considered++;
}
console.log('graded card-sales considered (rungs 7-10):', considered, 'ladder groups:', groups.size);

// pair observations: within each group, for each ordered pair (lo<hi) with >=1
// sale each, log(med[hi]/med[lo]). Require >=2 sales total per grade cell for
// a stable per-cell median (mix-immune within the card).
const MIN_CELL = 2;
type Obs = { hi: number; lo: number; y: number };
const obs: Obs[] = [];
const pairSupport = new Map<string, number>(); // "hi>lo" → count
for (const g of groups.values()) {
  const cells = Array.from(g.entries()).filter(([, v]) => v.length >= MIN_CELL);
  if (cells.length < 2) continue;
  const meds = new Map<number, number>();
  for (const [grade, v] of cells) meds.set(grade, median(v));
  const gs = Array.from(meds.keys()).sort((a, b) => a - b);
  for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
    const lo = gs[i], hi = gs[j];
    obs.push({ hi, lo, y: Math.log(meds.get(hi)! / meds.get(lo)!) });
    const k = `${hi}>${lo}`;
    pairSupport.set(k, (pairSupport.get(k) || 0) + 1);
  }
}
console.log('paired observations:', obs.length);

// adjacent-rung paired support (the rungs the fit most depends on)
console.log('pair support (hi>lo → n):');
for (const [k, n] of Array.from(pairSupport.entries()).sort((a, b) => b[1] - a[1])) console.log('  ', k, n);

// least-squares: unknowns = logMult per rung, base = 8 fixed at 0.
const base = 8;
const free = RUNGS.filter(r => r !== base);
const idx = new Map<number, number>();
free.forEach((r, i) => idx.set(r, i));
const P = free.length;
// Normal equations A^T A x = A^T b, each obs row has +1 at hi, -1 at lo.
const ATA = Array.from({ length: P }, () => new Array(P).fill(0));
const ATb = new Array(P).fill(0);
for (const o of obs) {
  const terms: [number, number][] = [];
  if (o.hi !== base) terms.push([idx.get(o.hi)!, 1]);
  if (o.lo !== base) terms.push([idx.get(o.lo)!, -1]);
  for (const [a, ca] of terms) {
    ATb[a] += ca * o.y;
    for (const [b, cb] of terms) ATA[a][b] += ca * cb;
  }
}
// solve via Gaussian elimination
function solve(A: number[][], b: number[]): number[] {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
const x = solve(ATA, ATb);
const logMult = new Map<number, number>([[base, 0]]);
free.forEach((r, i) => logMult.set(r, x[i]));
console.log('\nFITTED LADDER (base grade 8 = 1.00):');
const oldMult = (n: number) => n >= 10 ? 7 : n >= 9.5 ? 3 : n >= 9 ? 1.6 : n >= 8.5 ? 1.15 : n >= 8 ? 1 : 0.8;
for (const r of RUNGS) {
  const m = Math.exp(logMult.get(r)!);
  console.log(`  grade ${r}: fitted ${m.toFixed(3)}  vs old ${oldMult(r).toFixed(2)}`);
}
