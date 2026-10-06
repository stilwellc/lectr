/**
 * band-tier-fit.ts — FIT THE TIER TAILS (Oct 6 2026, pricing wave 10).
 * Reads an engine-ab.ts run over the TRAINING window (`--from 2023-10-01
 * --to 2025-10-01`: every row priced point-in-time by the current engine,
 * banded by its own quarter's calibration) and fits, per market × path ×
 * tier, the exponents (kLo, kHi) that put `q` of the rows below lo^kLo and
 * `q` above hi^kHi — the same ratio fit as the wave-7 market tails
 * (backtest-core.fitValueBands), but on the SERVED tier: the calibration's
 * own rows carry the tier of the engine that wrote them (art and culture
 * calObs are all 'low'), so the per-tier tails cannot be learned there.
 * A cell under `minN` rows keeps k = 1. Prints the table value.VB_TIER.k takes.
 *
 *   npx tsx scripts/oneoff/qa/band-tier-fit.ts --rows train.json [--q 0.10] [--q-high 0.08]
 *     [--minN 100] [--kmin 1] [--kmax 2] [--out k.json]
 *   --split 2024-10-01   fit on the rows before the date, report coverage /
 *                        width by tier on the rows after, for a grid of q
 *                        (the training window's own out-of-sample check)
 *
 * Never writes to data/ or public/. tsconfig-excluded (_qa).
 */
import * as fs from 'fs';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };
type Row = { m: string; conf: string; r: number; p: number; lo: number; hi: number; sd: string };
type Pt = { m: string; path: string; c: string; z: number; l: number; h: number; sd: string };
type Table = Record<string, Record<string, Record<string, [number, number]>>>;
const TIERS = ['high', 'medium', 'low'] as const;

/** k per market × tier: each row's tail ratio log z / log(its own band edge)
 *  — the row falls outside edge^k iff ratio > k — at its (1 − q) quantile */
export function fitTable(pts: Pt[], q: Record<string, number>, minN: number, kMin: number, kMax: number, log?: (s: string) => void): Table {
  const out: Table = {};
  for (const m of Array.from(new Set(pts.map(p => p.m))).sort()) {
    for (const c of TIERS) {
      const ps = pts.filter(p => p.m === m && p.c === c);
      if (!ps.length) continue;
      const side = (lo: boolean) => {
        const r = ps.map(p => { const b = lo ? p.l : p.h; return Math.abs(Math.log(b)) > 1e-6 ? Math.log(p.z) / Math.log(b) : null; })
          .filter((x): x is number => x != null).sort((a, b) => a - b);
        if (r.length < minN) return null;
        const k = r[Math.min(r.length - 1, Math.max(0, Math.ceil((1 - q[c]) * r.length) - 1))];
        return Math.round(Math.min(kMax, Math.max(kMin, k)) * 100) / 100;
      };
      const lo = side(true), hi = side(false);
      const k: [number, number] | null = lo != null && hi != null ? [lo, hi] : null;
      const path = m.startsWith('noest:') ? 'n' : 'e';
      if (log) log(`${m.padEnd(15)} ${c.padEnd(6)} n=${String(ps.length).padStart(4)} k=${k ? k.join('/') : '1/1'} cov ${cover(ps, null)}% → ${cover(ps, k)}%`);
      if (k && (k[0] !== 1 || k[1] !== 1)) ((out[path] ||= {})[m.replace(/^noest:/, '')] ||= {})[c] = k;
    }
  }
  return out;
}
const kOf = (t: Table, p: Pt): [number, number] => t[p.path]?.[p.m.replace(/^noest:/, '')]?.[p.c] ?? [1, 1];
function cover(ps: Pt[], k: [number, number] | null): string {
  const [a, b] = k || [1, 1];
  return (100 * ps.filter(p => p.z >= Math.pow(p.l, a) && p.z <= Math.pow(p.h, b)).length / ps.length).toFixed(1);
}

function main() {
  const q0 = +(arg('q') || '0.10');
  const q: Record<string, number> = { high: +(arg('q-high') || q0), medium: +(arg('q-medium') || q0), low: +(arg('q-low') || q0) };
  const minN = +(arg('minN') || '100');
  const kMin = +(arg('kmin') || '1'), kMax = +(arg('kmax') || '2');
  const rows = (JSON.parse(fs.readFileSync(arg('rows')!, 'utf8')).rowsB as Row[]).filter(r => r.p > 0 && r.lo > 0 && r.hi > 0 && r.r > 0);
  // per row: (z, the row's own band edges as multiples of its value)
  const pts: Pt[] = rows.map(r => ({ m: r.m, path: r.m.startsWith('noest:') ? 'n' : 'e', c: r.conf, z: r.r / r.p, l: Math.min(1, r.lo / r.p), h: Math.max(1, r.hi / r.p), sd: r.sd }));
  const split = arg('split');
  if (split) {
    const fitPts = pts.filter(p => p.sd < split), test = pts.filter(p => p.sd >= split);
    console.log(`fit ${fitPts.length} rows < ${split} · test ${test.length} rows`);
    const grid = [0.10, 0.09, 0.08, 0.07, 0.06];
    for (const qh of grid) for (const qr of [0.10, 0.09]) {
      const t = fitTable(fitPts, { high: qh, medium: qr, low: qr }, minN, kMin, kMax);
      const cell = (ps: Pt[]) => {
        let hit = 0, w = 0;
        for (const p of ps) { const [a, b] = kOf(t, p); const lo = Math.pow(p.l, a), hi = Math.pow(p.h, b); if (p.z >= lo && p.z <= hi) hit++; w += Math.log(hi / lo); }
        return `${(100 * hit / ps.length).toFixed(1)}% ${(w / ps.length).toFixed(2)}`;
      };
      const by = (c: string) => test.filter(p => p.c === c);
      const mk = (m: string, c: string) => { const ps = test.filter(p => p.m === m && p.c === c); return ps.length >= 50 ? `${m.slice(0, 3)}:${cell(ps).split(' ')[0]}` : ''; };
      console.log(`q high ${qh} rest ${qr}: high ${cell(by('high'))} | medium ${cell(by('medium'))} | low ${cell(by('low'))} | all ${cell(test)} · high by market ${['art', 'culture', 'science', 'watches'].map(m => mk(m, 'high')).join(' ')}`);
    }
    console.log(`base (k=1): high ${cover(test.filter(p => p.c === 'high'), null)}% medium ${cover(test.filter(p => p.c === 'medium'), null)}% low ${cover(test.filter(p => p.c === 'low'), null)}%`);
    return;
  }
  const out = fitTable(pts, q, minN, kMin, kMax, console.log);
  console.log(JSON.stringify(out));
  if (arg('out')) fs.writeFileSync(arg('out')!, JSON.stringify(out));
}
if (require.main === module) main();
