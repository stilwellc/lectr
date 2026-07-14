/**
 * build-backtest.ts — the signal's measured record, point-in-time correct.
 *
 * For every concluded sale that carried an estimate, replay the buy signal as
 * it would have been called ON THAT DAY: the comp pool is restricted to sales
 * that had already happened (same form/model/size gates, same >= 3-comps and
 * dispersion guards as production). Then score the outcome the lot actually
 * delivered against its own estimate. No hindsight leaks: a lot's own result
 * never participates in its own call, and neither does anything after it.
 *
 * Emits public/data/ray/backtest.json — small summary + per-year series.
 */
import * as fs from 'fs';
import * as path from 'path';
import { classifyForm, modelKey, parseDims, normalizeTitle, Form } from '../app/lib/comps';
import type { AuctionLot } from '../app/types';

interface Prepped {
  lot: AuctionLot;
  form: Form;
  model: string | null;
  dims: [number, number] | null;
  nt: string;
  t: number;            // saleDate ms
  estMid: number;
  perf: number;         // priceUsd / estMid - 1
  beatHigh: boolean;
}

const FURNITURE = new Set<Form>([
  'seating-chair', 'seating-stool', 'seating-bench', 'seating-sofa',
  'table-dining', 'table-low', 'table-side', 'table', 'case', 'desk', 'bed',
  'lighting', 'mirror', 'design-other',
]);

function median(sorted: number[]): number {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

function gated(a: Prepped, b: Prepped): boolean {
  if (a.form === 'unknown' || b.form === 'unknown' || a.form !== b.form) return false;
  if (FURNITURE.has(a.form) && a.model !== b.model) return false;
  if (a.dims && b.dims) {
    if (FURNITURE.has(a.form)) {
      const la = Math.max(...a.dims), lb = Math.max(...b.dims);
      if (la > 0 && lb > 0 && (la / lb > 2.2 || lb / la > 2.2)) return false;
    } else {
      const areaA = a.dims[0] * a.dims[1], areaB = b.dims[0] * b.dims[1];
      if (areaA > 0 && areaB > 0 && (areaA / areaB > 4 || areaB / areaA > 4)) return false;
    }
  }
  return true;
}

/** Full corpus: the crawler passes its in-memory allLots so nothing reads a
 *  post-split truncated file. Standalone, the corpus is reassembled from
 *  lots.json CONCAT sold-archive.json. Goldin lots carry no estimate and are
 *  filtered by the `!l.estimateLow` guard below, so the output is byte-
 *  identical either way — the concat exists only to prevent silent truncation
 *  if the estimate gate is ever relaxed. */
function readCorpus(dataDir: string): AuctionLot[] {
  const main: AuctionLot[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'lots.json'), 'utf8'));
  const archivePath = path.join(dataDir, 'sold-archive.json');
  if (!fs.existsSync(archivePath)) return main;
  const archive: AuctionLot[] = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  return main.concat(archive);
}

export function buildBacktest(dataDir: string, allLots?: AuctionLot[]): void {
  const lots: AuctionLot[] = allLots ?? readCorpus(dataDir);

  // Precompute everything once — the replay is O(sum of group sizes squared)
  // within (artist × form) groups, which stays tractable.
  const sold: Prepped[] = [];
  for (const l of lots) {
    if (l.status !== 'sold' || !l.priceUsd || !l.estimateLow || !l.estimateHigh) continue;
    const t = new Date(l.saleDate).getTime();
    if (isNaN(t)) continue;
    const estMid = (l.estimateLow + l.estimateHigh) / 2;
    if (estMid <= 0) continue;
    sold.push({
      lot: l,
      form: classifyForm(l),
      model: modelKey(l),
      dims: parseDims(l.dimensions),
      nt: normalizeTitle(l.title),
      t,
      estMid,
      perf: l.priceUsd / estMid - 1,
      beatHigh: l.priceUsd > l.estimateHigh,
    });
  }

  // group by artist|form, sorted by time
  const groups = new Map<string, Prepped[]>();
  for (const p of sold) {
    if (p.form === 'unknown') continue;
    const k = `${p.lot.artist}|${p.form}`;
    (groups.get(k) || groups.set(k, []).get(k)!).push(p);
  }
  groups.forEach(g => g.sort((a, b) => a.t - b.t));

  type Bucket = { perfs: number[]; beat: number; n: number };
  const mk = (): Bucket => ({ perfs: [], beat: 0, n: 0 });
  const flagged = mk(), unflagged = mk(), above = mk();
  const byYear = new Map<number, { flagged: number[]; unflagged: number[] }>();

  groups.forEach(g => {
    for (let i = 0; i < g.length; i++) {
      const cur = g[i];
      // pool: strictly earlier sales in the group passing the pairwise gates
      const priorAll: Prepped[] = [];
      for (let j = 0; j < i; j++) {
        if (g[j].t >= cur.t) continue; // same-day sales stay out — no leak
        if (gated(cur, g[j])) priorAll.push(g[j]);
      }
      if (priorAll.length < 3) continue; // production guard: silence

      // same-edition fast path, exactly like production
      let pool = cur.nt.length >= 6 ? priorAll.filter(p => p.nt === cur.nt) : [];
      if (pool.length < 3) pool = priorAll.slice(-24); // most recent, like production's recency preference

      const prices = pool.map(p => p.lot.priceUsd!).sort((a, b) => a - b);
      const med = median(prices);
      const q1 = prices[Math.floor(prices.length * 0.25)];
      const q3 = prices[Math.floor(prices.length * 0.75)];
      if (med <= 0 || (q3 - q1) / med > 2.5) continue; // dispersion guard: silence

      const ratio = med / cur.estMid;
      const call = ratio >= 1.2 ? 'below' : ratio <= 0.75 ? 'above' : 'none';

      const bucket = call === 'below' ? flagged : call === 'above' ? above : unflagged;
      bucket.perfs.push(cur.perf);
      if (cur.beatHigh) bucket.beat++;
      bucket.n++;

      const y = new Date(cur.t).getUTCFullYear();
      const yb = byYear.get(y) || { flagged: [], unflagged: [] };
      if (call === 'below') yb.flagged.push(cur.perf);
      else if (call === 'none') yb.unflagged.push(cur.perf);
      byYear.set(y, yb);
    }
  });

  const summarize = (b: Bucket) => {
    const s = [...b.perfs].sort((x, y) => x - y);
    return {
      n: b.n,
      medianPerfPct: b.n ? Math.round(median(s) * 100) : 0,
      beatHighPct: b.n ? Math.round((b.beat / b.n) * 100) : 0,
    };
  };

  const years = Array.from(byYear.keys()).sort();
  const series = years
    .map(y => {
      const v = byYear.get(y)!;
      const f = [...v.flagged].sort((a, b) => a - b);
      const u = [...v.unflagged].sort((a, b) => a - b);
      return {
        year: y,
        flaggedMedianPct: f.length >= 5 ? Math.round(median(f) * 100) : null,
        unflaggedMedianPct: u.length >= 5 ? Math.round(median(u) * 100) : null,
        nFlagged: f.length,
      };
    })
    .filter(p => p.flaggedMedianPct !== null || p.unflaggedMedianPct !== null);

  const out = {
    generatedAt: new Date().toISOString(),
    flagged: summarize(flagged),
    unflagged: summarize(unflagged),
    above: summarize(above),
    series,
  };
  fs.writeFileSync(path.join(dataDir, 'backtest.json'), JSON.stringify(out));
  console.log('backtest.json:',
    `flagged n=${out.flagged.n} median +${out.flagged.medianPerfPct}% beatHigh ${out.flagged.beatHighPct}%`,
    `| unflagged n=${out.unflagged.n} median +${out.unflagged.medianPerfPct}% beatHigh ${out.unflagged.beatHighPct}%`,
    `| above n=${out.above.n} median +${out.above.medianPerfPct}%`);
}

if (require.main === module) {
  buildBacktest(path.join(process.cwd(), 'public', 'data', 'ray'));
}
