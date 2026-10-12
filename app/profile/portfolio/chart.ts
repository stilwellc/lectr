/**
 * chart.ts — the Portfolio line's geometry (R1#11, Oct 11 2026). Pure: no
 * React, no DOM. chart.tsx draws what this file lays out.
 *
 * Two series on ONE money axis, both read off collectionIndex:
 *   marked   the joined pieces re-marked and summed (IndexPoint.value) —
 *            a run breaks where a year is a gap; a lone year is a dot
 *   paid     THE PAID BASELINE (IndexPoint.paid): what the joined pieces
 *            cost, as a STEP — flat between purchases, up when one joins.
 *            Pieces join at what they cost, so without it the marked line
 *            reads as a diagonal of growth when most of the climb is
 *            accumulation (R1#11). Where the two part is the movement.
 *
 * The plot stops short of the right edge by a GUTTER that holds the tick
 * labels (HeroChart prints them at the right edge over the line's end —
 * R2's "$200K overlaps the line"); every axis year gets a label when they
 * fit, else every other (first and last always).
 */
import type { IndexPoint } from './portfolio';
import { fmtFace } from '../../lib/lot-face';

export interface Tick { v: number; y: number; label: string }
export interface YearLabel { i: number; x: number; label: string; anchor: 'start' | 'middle' | 'end' }
export interface Run { d: string; points: { i: number; x: number; y: number; v: number }[] }

export interface ChartGeometry {
  W: number; H: number;
  /** the plot's right edge (the gutter holds the tick labels) */
  plotW: number;
  gutter: number;
  x: (i: number) => number;
  y: (v: number) => number;
  min: number; max: number;
  ticks: Tick[];
  years: YearLabel[];
  /** marked: one run per stretch of adjacent marked years; a lone year is a dot */
  runs: Run[];
  dots: { i: number; x: number; y: number; v: number }[];
  /** the paid step path (every axis year) */
  paidPath: string;
  paidEnd: { x: number; y: number } | null;
  markedEnd: { x: number; y: number } | null;
}

/** rounded tick values — a few quiet rules that land on human numbers (HeroChart's rule) */
export function niceTicks(min: number, max: number, count = 3): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const step0 = span / (count + 1);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count + 1.6) || 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v);
  return out.slice(0, count + 2);
}

/** label a tick set so no two rules share a label ($49K / $49K → $48.6K / $49.4K) */
export function tickLabels(vals: number[]): Map<number, string> {
  const base = new Map(vals.map(v => [v, fmtFace(v)]));
  if (new Set(base.values()).size === base.size) return base;
  const fine = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v)}`);
  return new Map(vals.map(v => [v, fine(v)]));
}

/** the tick gutter: the widest label at the tick font (≈6.2px per glyph at
 *  10px), the terminus ring's reach past the plot (r 6.5) and breathing room */
export function gutterFor(labels: Iterable<string>): number {
  let w = 0;
  for (const l of Array.from(labels)) w = Math.max(w, l.length);
  return Math.round(w * 6.2) + 22;
}

/** which axis years get a label: all when ≥ 40px apart, else every other
 *  (the first and the last always; the last is never crowded by its neighbour) */
export function yearLabelIdx(n: number, plotW: number, minGap = 40): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const gap = plotW / (n - 1);
  if (gap >= minGap) return Array.from({ length: n }, (_, i) => i);
  const step = Math.max(2, Math.ceil(minGap / gap));
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += step) if ((n - 1 - i) * gap >= minGap) out.push(i);
  out.push(n - 1);
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function chartGeometry(points: readonly IndexPoint[], W: number, H: number, opts: { compact?: boolean } = {}): ChartGeometry {
  const padT = 14, padB = opts.compact ? 20 : 24;
  const vals: number[] = [];
  for (const p of points) { if (p.value != null) vals.push(p.value); vals.push(p.paid); }
  let min = vals.length ? Math.min(...vals) : 0;
  let max = vals.length ? Math.max(...vals) : 1;
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.10;
  min -= pad; max += pad;
  if (min < 0 && Math.min(...vals) >= 0) min = 0;
  const tickVals = niceTicks(min, max, opts.compact ? 2 : 3);
  const labels = tickLabels(tickVals);
  const gutter = gutterFor(labels.values());
  const plotW = Math.max(1, W - gutter);
  const n = points.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const ticks: Tick[] = tickVals.map(v => ({ v, y: y(v), label: labels.get(v)! })).filter(t => t.y >= 10 && t.y <= H - padB + 2);

  const years: YearLabel[] = yearLabelIdx(n, plotW).map(i => ({
    i, x: x(i), label: String(points[i].year),
    anchor: i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle',
  }));

  // marked: runs of adjacent marked years
  const runs: Run[] = [];
  const dots: ChartGeometry['dots'] = [];
  let cur: Run['points'] = [];
  const flush = () => {
    if (cur.length === 1) dots.push(cur[0]);
    else if (cur.length > 1) runs.push({ d: cur.map((p, k) => `${k === 0 ? 'M' : 'L'}${r2(p.x)},${r2(p.y)}`).join(''), points: cur });
    cur = [];
  };
  points.forEach((p, i) => {
    if (p.value == null) { flush(); return; }
    cur.push({ i, x: x(i), y: y(p.value), v: p.value });
  });
  flush();

  // paid: a step — flat across the year, up where the next year's cost is higher
  let paidPath = '';
  if (n > 0) {
    paidPath = `M${r2(x(0))},${r2(y(points[0].paid))}`;
    for (let i = 1; i < n; i++) {
      paidPath += `H${r2(x(i))}`;
      if (points[i].paid !== points[i - 1].paid) paidPath += `V${r2(y(points[i].paid))}`;
    }
  }
  const lastMarked = [...runs.flatMap(r => r.points), ...dots].sort((a, b) => a.i - b.i).pop() ?? null;
  return {
    W, H, plotW, gutter, x, y, min, max, ticks, years, runs, dots, paidPath,
    paidEnd: n > 0 ? { x: x(n - 1), y: y(points[n - 1].paid) } : null,
    markedEnd: lastMarked ? { x: lastMarked.x, y: lastMarked.y } : null,
  };
}
