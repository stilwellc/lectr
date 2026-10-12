'use client';
/**
 * PortfolioChart — the collection line in the hero instrument's grammar
 * (app/preview/terminal/HeroChart: dotted rules, right-edge ticks, ink
 * line, crosshair + readout) drawn here so the PAID baseline can be a true
 * step and the plot can stop short of the tick gutter (./chart.ts has the
 * geometry and the reasons). Reuses HeroChart's own classes for every
 * stroke and type size — no new colors, no new sizes.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from '../../preview/terminal/style.module.css';
import { fmtFace } from '../../lib/lot-face';
import type { IndexPoint } from './portfolio';
import { chartGeometry } from './chart';

export default function PortfolioChart({ points, height, compact = false }: { points: readonly IndexPoint[]; height: number; compact?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  const [hoverI, setHoverI] = useState<number | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const g = useMemo(() => (W ? chartGeometry(points, W, height, { compact }) : null), [points, W, height, compact]);

  const onMove = useCallback((e: React.PointerEvent) => {
    const el = wrapRef.current;
    if (!el || !g || points.length < 2) return;
    const r = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, g.plotW)));
    setHoverI(Math.round(frac * (points.length - 1)));
  }, [g, points.length]);
  const onLeave = useCallback(() => setHoverI(null), []);

  if (!W || !g) return <div ref={wrapRef} className={styles.hcWrap} style={{ minHeight: height }} aria-hidden />;
  const hp = hoverI != null ? points[hoverI] : null;
  const hx = hoverI != null ? g.x(hoverI) : null;
  const years = points.map(p => p.year);
  const aria = `Your pieces marked against what you paid, ${years[0]}–${years[years.length - 1]}: marked ${points.filter(p => p.value != null).map(p => `${p.year} ${fmtFace(p.value!)}`).join(', ')}; paid ${points.map(p => `${p.year} ${fmtFace(p.paid)}`).join(', ')}`;

  return (
    <div ref={wrapRef} className={styles.hcWrap} onPointerMove={onMove} onPointerLeave={onLeave} role="img" aria-label={aria}>
      <svg viewBox={`0 0 ${W} ${height}`} className={styles.hcSvg} style={{ height }} width={W} height={height}>
        {g.ticks.map(t => (
          <g key={`t${t.v}`}>
            <line x1={0} x2={g.plotW} y1={t.y} y2={t.y} className={styles.hcRule} />
            <text x={W - 2} y={t.y + 3.5} textAnchor="end" className={styles.hcTick}>{t.label}</text>
          </g>
        ))}
        {g.years.map(yl => (
          <text key={yl.i} x={Math.min(g.plotW - 1, Math.max(1, yl.x))} y={height - 7} textAnchor={yl.anchor} className={styles.hcXLabel}>{yl.label}</text>
        ))}
        {hx != null && <line x1={hx} x2={hx} y1={8} y2={height - 18} className={styles.hcCross} />}
        {/* the paid baseline: a grey step under the marked line */}
        <path d={g.paidPath} fill="none" stroke="var(--color-text-faint)" strokeWidth={1.5} strokeLinejoin="miter" vectorEffect="non-scaling-stroke" />
        {g.paidEnd && <circle cx={g.paidEnd.x} cy={g.paidEnd.y} r={2.2} fill="var(--color-text-faint)" />}
        {/* marked: ink, full weight; a gap breaks the run */}
        {g.runs.map((r, k) => (
          <path key={k} d={r.d} fill="none" stroke="var(--color-fg)" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
        {g.dots.map(d => <circle key={`d${d.i}`} cx={d.x} cy={d.y} r={2.4} fill="var(--color-fg)" />)}
        {g.markedEnd && (
          <g>
            <circle cx={g.markedEnd.x} cy={g.markedEnd.y} r={3.2} fill="var(--color-fg)" />
            <circle cx={g.markedEnd.x} cy={g.markedEnd.y} r={6.5} fill="none" stroke="var(--color-fg)" strokeOpacity={0.3} strokeWidth={1} />
          </g>
        )}
        {hp && hx != null && (
          <>
            {hp.value != null && <circle cx={hx} cy={g.y(hp.value)} r={3.4} fill="var(--color-fg)" stroke="var(--color-bg)" strokeWidth={1.4} />}
            <circle cx={hx} cy={g.y(hp.paid)} r={2.6} fill="var(--color-text-faint)" stroke="var(--color-bg)" strokeWidth={1.2} />
          </>
        )}
      </svg>
      {hp && hx != null && (
        <div className={styles.hcReadout} style={{ left: `${(hx / W) * 100}%` }} data-flip={hx > W * 0.6 ? 'true' : undefined}>
          <span className={styles.hcReadoutPeriod}>{hp.label} · {hp.pieces} {hp.pieces === 1 ? 'piece' : 'pieces'}</span>
          <span className={styles.hcReadoutRow} data-anchor="true">
            <i style={{ background: 'var(--color-fg, #E8EAED)' }} aria-hidden />
            <span className={styles.hcReadoutName}>Marked</span>
            <span className={styles.hcReadoutVal}>{hp.value != null ? `${fmtFace(hp.value)} · n ${hp.n.toLocaleString()}` : 'gap'}</span>
          </span>
          <span className={styles.hcReadoutRow}>
            <i style={{ background: 'var(--color-text-faint, #7A8087)' }} aria-hidden />
            <span className={styles.hcReadoutName}>Paid</span>
            <span className={styles.hcReadoutVal}>{fmtFace(hp.paid)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
