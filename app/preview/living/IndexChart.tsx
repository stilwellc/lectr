'use client';

/**
 * THE INDEX CHART — the dollar-normalized lectr all-market index, hand-rolled in
 * SVG (no recharts → no global CSS reach, fully scoped). The trend line DRAWS in
 * on scroll (stroke-dashoffset, ~1s signature ease) with raw quarterly dots
 * underneath ("we show the raw data"). Reduced motion → the line ships fully
 * drawn (dashoffset 0, no animation). y-axis reads as a real index level.
 */

import { useMemo } from 'react';
import type { IndexSeries } from './data';
import { useInViewport, useReducedMotion } from './useScene';
import s from './style.module.css';

const W = 760;
const H = 300;
const PAD = { top: 24, right: 16, bottom: 28, left: 44 };

export default function IndexChart({ series }: { series: IndexSeries }) {
  const reduced = useReducedMotion();
  const [ref, inView] = useInViewport<HTMLDivElement>({ once: true, threshold: 0.25 });

  const geom = useMemo(() => {
    const pts = series.points;
    if (pts.length < 2) return null;
    const values = pts.map((p) => p.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const span = hi - lo || 1;
    // pad the value range 8% each side so the line breathes
    const vMin = lo - span * 0.08;
    const vMax = hi + span * 0.08;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (i / (pts.length - 1)) * innerW;
    const y = (v: number) => PAD.top + innerH - ((v - vMin) / (vMax - vMin)) * innerH;

    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const areaPath =
      `M${x(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)} ` +
      pts.map((p, i) => `L${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ') +
      ` L${x(pts.length - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`;

    // gridline / axis ticks at rounded index levels
    const ticks: number[] = [];
    const step = span > 60 ? 40 : span > 25 ? 20 : 10;
    const start = Math.ceil(vMin / step) * step;
    for (let t = start; t <= vMax; t += step) ticks.push(t);

    const dots = pts.map((p, i) => ({ cx: x(i), cy: y(p.value) }));
    const first = pts[0];
    const last = pts[pts.length - 1];
    return { linePath, areaPath, ticks, y, dots, first, last, innerW };
  }, [series]);

  const drawn = inView || reduced;

  if (!geom) return null;

  return (
    <div ref={ref} className={s.chartWrap} data-drawn={drawn ? 'true' : 'false'}>
      <div className={s.chartHead}>
        <span className={s.chartLabel}>{series.label}</span>
        <span className={s.chartN}>
          n = {series.n.toLocaleString('en-US')} sold · base 100
        </span>
      </div>
      <svg
        className={s.chartSvg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${series.label}, from ${geom.first.period} to ${geom.last.period}`}
      >
        <defs>
          <linearGradient id="li-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E8DAB6" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#E8DAB6" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* gridlines + y ticks */}
        {geom.ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={geom.y(t)}
              y2={geom.y(t)}
              className={s.chartGrid}
            />
            <text x={PAD.left - 8} y={geom.y(t) + 3} className={s.chartTick} textAnchor="end">
              {t}
            </text>
          </g>
        ))}

        {/* area fill under the line */}
        <path d={geom.areaPath} fill="url(#li-area)" className={s.chartArea} />

        {/* raw quarterly dots — the credibility layer */}
        {geom.dots.map((d, i) => (
          <circle key={i} cx={d.cx} cy={d.cy} r={2} className={s.chartDot} />
        ))}

        {/* the drawn trend line */}
        <path d={geom.linePath} className={s.chartLine} pathLength={1} />

        {/* endpoint marker */}
        <circle cx={geom.dots[geom.dots.length - 1].cx} cy={geom.dots[geom.dots.length - 1].cy} r={4} className={s.chartEnd} />
      </svg>
      <div className={s.chartAxis}>
        <span>{geom.first.period}</span>
        <span>{geom.last.period}</span>
      </div>
    </div>
  );
}
