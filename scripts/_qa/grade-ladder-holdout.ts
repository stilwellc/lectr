/* Holdout: does the fitted ladder predict cross-grade prices better than the
 * old constant ladder? Split ladder-groups 80/20 by a hash of the key. Fit on
 * train (paired log-ratios), then on HELD-OUT groups: for each cross-grade cell
 * pair, predict med[hi] from med[lo] × mult[hi]/mult[lo]; score |log(pred/actual)|.
 * Compare fitted vs old. Also 20-fold bootstrap the rung estimates for CIs. */
import { readGzRows } from '../corpus-io';

function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
const RUNGS = [7, 8, 8.5, 9, 9.5, 10];
const rungSet = new Set(RUNGS);
const rows = readGzRows('data/corpus/sold-archive.json.gz');
const groups = new Map<string, Map<number, number[]>>();
for (const l of rows as any[]) {
  if (l.artist !== 'sports-cards' || l.status !== 'sold') continue;
  const price = (l.realizedUsd > 0 ? l.realizedUsd : l.priceUsd) || 0;
  if (!(price > 0)) continue;
  const c = l._card;
  if (!c || !c.playerSlug || !c.year || !c.cardNo || c.gradeNum == null || !rungSet.has(c.gradeNum)) continue;
  const set = (c.setName || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const key = `${c.playerSlug}|${c.year}|${set}|${c.cardNo.toLowerCase()}`;
  let g = groups.get(key);
  if (!g) { g = new Map(); groups.set(key, g); }
  (g.get(c.gradeNum) || g.set(c.gradeNum, []).get(c.gradeNum)!).push(price);
}
const MIN_CELL = 2;
function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

function fit(keys: string[]): Map<number, number> {
  type Obs = { hi: number; lo: number; y: number };
  const obs: Obs[] = [];
  for (const k of keys) {
    const g = groups.get(k)!;
    const cells = Array.from(g.entries()).filter(([, v]) => v.length >= MIN_CELL);
    if (cells.length < 2) continue;
    const meds = new Map<number, number>();
    for (const [grade, v] of cells) meds.set(grade, median(v));
    const gs = Array.from(meds.keys()).sort((a, b) => a - b);
    for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++)
      obs.push({ hi: gs[j], lo: gs[i], y: Math.log(meds.get(gs[j])! / meds.get(gs[i])!) });
  }
  const base = 8; const free = RUNGS.filter(r => r !== base); const idx = new Map<number, number>();
  free.forEach((r, i) => idx.set(r, i)); const P = free.length;
  const ATA = Array.from({ length: P }, () => new Array(P).fill(0)); const ATb = new Array(P).fill(0);
  for (const o of obs) {
    const terms: [number, number][] = [];
    if (o.hi !== base) terms.push([idx.get(o.hi)!, 1]);
    if (o.lo !== base) terms.push([idx.get(o.lo)!, -1]);
    for (const [a, ca] of terms) { ATb[a] += ca * o.y; for (const [b, cb] of terms) ATA[a][b] += ca * cb; }
  }
  const n = P; const M = ATA.map((r, i) => [...r, ATb[i]]);
  for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]]; for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let kk = c; kk <= n; kk++) M[r][kk] -= f * M[c][kk]; } }
  const x = M.map((r, i) => r[n] / r[i]);
  const lm = new Map<number, number>([[base, 0]]); free.forEach((r, i) => lm.set(r, x[i]));
  return lm;
}

const allKeys = Array.from(groups.keys());
const train = allKeys.filter(k => hash(k) >= 0.2);
const test = allKeys.filter(k => hash(k) < 0.2);
const lm = fit(train);
const fittedMult = (g: number) => Math.exp(lm.get(g) ?? 0);
const oldMult = (n: number) => n >= 10 ? 7 : n >= 9.5 ? 3 : n >= 9 ? 1.6 : n >= 8.5 ? 1.15 : n >= 8 ? 1 : 0.8;

let eF: number[] = [], eO: number[] = [], nPairs = 0;
for (const k of test) {
  const g = groups.get(k)!;
  const cells = Array.from(g.entries()).filter(([, v]) => v.length >= MIN_CELL);
  if (cells.length < 2) continue;
  const meds = new Map<number, number>(); for (const [grade, v] of cells) meds.set(grade, median(v));
  const gs = Array.from(meds.keys()).sort((a, b) => a - b);
  for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
    const lo = gs[i], hi = gs[j], mlo = meds.get(lo)!, mhi = meds.get(hi)!;
    eF.push(Math.abs(Math.log((mlo * fittedMult(hi) / fittedMult(lo)) / mhi)));
    eO.push(Math.abs(Math.log((mlo * oldMult(hi) / oldMult(lo)) / mhi)));
    nPairs++;
  }
}
console.log(`holdout: ${test.length} test groups, ${nPairs} cross-grade pairs`);
console.log(`  median |log err|  fitted ${median(eF).toFixed(4)}  vs old ${median(eO).toFixed(4)}  (lower=better)`);
console.log(`  mean   |log err|  fitted ${(eF.reduce((a, b) => a + b, 0) / eF.length).toFixed(4)}  vs old ${(eO.reduce((a, b) => a + b, 0) / eO.length).toFixed(4)}`);

// bootstrap rung CIs (resample train keys with replacement, 40x)
const B = 40; const boot = new Map<number, number[]>(RUNGS.map(r => [r, []]));
for (let b = 0; b < B; b++) {
  const samp: string[] = []; for (let i = 0; i < train.length; i++) samp.push(train[(Math.random() * train.length) | 0]);
  const lmb = fit(samp);
  for (const r of RUNGS) boot.get(r)!.push(Math.exp(lmb.get(r) ?? 0));
}
console.log('\nbootstrap rung stability (40x, base 8=1):');
for (const r of RUNGS) {
  const v = boot.get(r)!.sort((a, b) => a - b);
  console.log(`  grade ${r}: fitted ${fittedMult(r).toFixed(3)}  CI[${v[2].toFixed(2)}, ${v[37].toFixed(2)}]`);
}
