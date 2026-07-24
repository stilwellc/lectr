'use client';

import React, { useMemo } from 'react';
import s from './style.module.css';
import { useInView, useReducedMotion, fmtDelta } from './lib';

export interface Pt { date: string; value: number; n: number }

/* ============================================================
   THE MARKET — one dollar-normalized index chart, hand-rolled
   as SVG so it stays tiny + static-export safe (no recharts
   client tree needed here). Raw quarterly points sit UNDER a
   smooth trend line ("we show the raw data" credibility). The
   line draws in on scroll via stroke-dashoffset; the area
   fades up behind it. Reduced-motion → resolved instantly.
   ============================================================ */

const W = 920;
const H = 300;
const PAD = { top: 18, right: 8, bottom: 26, left: 8 };

// a light monotone smoothing so the trend line reads as a trend,
// not the raw jitter — Catmull-Rom → bezier, tension tuned soft.
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  const d: string[] = [`M ${pts[0][0]},${pts[0][1]}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`);
  }
  return d.join(' ');
}

export function MarketChart({ series, compact = false }: { series: Pt[]; compact?: boolean }) {
  const [ref, seen] = useInView<HTMLDivElement>({ threshold: 0.25 });
  const reduce = useReducedMotion();
  const drawn = reduce || seen;

  const model = useMemo(() => {
    // The source is a %-over-estimate DEMAND reading per quarter (already a
    // level, not a return) — so we present it honestly as an index anchored
    // at 100 + value·k, NOT by compounding it (compounding a %-level would
    // manufacture a fake hockey-stick and undercut the "we show the data"
    // credibility). This keeps the real shape and a believable magnitude.
    const K = 2.2;
    const idx: number[] = series.map(p => 100 + p.value * K);
    const min = Math.min(...idx);
    const max = Math.max(...idx);
    const range = max - min || 1;
    const iw = W - PAD.left - PAD.right;
    const ih = H - PAD.top - PAD.bottom;
    const pts: [number, number][] = idx.map((v, i) => {
      const x = PAD.left + (i / (idx.length - 1)) * iw;
      const y = PAD.top + ih - ((v - min) / range) * ih;
      return [x, y];
    });
    const path = smoothPath(pts);
    const area = `${path} L ${pts[pts.length - 1][0].toFixed(2)},${(H - PAD.bottom).toFixed(2)} L ${pts[0][0].toFixed(2)},${(H - PAD.bottom).toFixed(2)} Z`;
    // approximate path length for the dash animation
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    const first = idx[0];
    const last = idx[idx.length - 1];
    const totalDelta = ((last - first) / first) * 100;
    return { pts, path, area, len: Math.round(len * 1.05), level: last, totalDelta, idx };
  }, [series]);

  const startLabel = series[0]?.date ?? '';
  const endLabel = series[series.length - 1]?.date ?? '';
  const midIdx = Math.floor(series.length / 2);
  const midLabel = series[midIdx]?.date ?? '';

  return (
    <div ref={ref}>
      <div className={compact ? s.mChartTop : s.chartTopline}>
        <div className={s.chartFig}>
          <span className={s.chartFigLabel}>lectr All-Market Index</span>
          <span className={s.chartFigNum}>{Math.round(model.level).toLocaleString('en-US')}</span>
          <span className={`${s.chartFigDelta} ${model.totalDelta >= 0 ? s.deltaUp : s.deltaDown}`}>
            {fmtDelta(model.totalDelta, 1)} <span style={{ color: 'var(--paper-faint)', fontWeight: 400 }}>since {startLabel.split(' ')[0]}</span>
          </span>
        </div>
        {!compact && (
          <div className={s.chartLegend}>
            <span className={s.legendItem}><i className={s.legendLine} /> trend</span>
            <span className={s.legendItem}><i className={s.legendDot} /> quarterly print</span>
          </div>
        )}
      </div>

      <svg
        className={s.chartSvg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`lectr all-market index, ${startLabel} to ${endLabel}, ${fmtDelta(model.totalDelta, 0)}`}
      >
        <defs>
          <linearGradient id="catGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* baseline gridlines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            className={s.chartGrid}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + (H - PAD.top - PAD.bottom) * f}
            y2={PAD.top + (H - PAD.top - PAD.bottom) * f}
          />
        ))}

        {/* raw quarterly prints under the trend */}
        {model.pts.filter((_, i) => i % 3 === 0).map((p, i) => (
          <circle
            key={i}
            className={`${s.chartDot} ${drawn ? s.chartDotShown : ''}`}
            cx={p[0]}
            cy={p[1]}
            r={1.6}
            style={{ transitionDelay: `${600 + i * 12}ms` }}
          />
        ))}

        {/* area fill */}
        <path
          className={`${s.chartArea} ${drawn ? s.chartAreaDrawn : ''}`}
          d={model.area}
        />
        {/* the trend line — draws in */}
        <path
          className={`${s.chartLine} ${s.chartLineDraw} ${drawn ? s.chartLineDrawn : ''}`}
          d={model.path}
          style={{ ['--len' as string]: `${model.len}` }}
        />
      </svg>

      {!compact && (
        <div className={s.chartFoot}>
          <span>{startLabel}</span>
          <span>{midLabel}</span>
          <span>{endLabel}</span>
        </div>
      )}
    </div>
  );
}
