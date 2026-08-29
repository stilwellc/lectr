'use client';

import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { useReducedMotion } from './hooks';
import styles from './style.module.css';

/* ============================================================
   THE HERO INSTRUMENT — rebuilt from scratch (Aug 2026).
   Hand-rolled SVG, no chart library: the lander's centerpiece
   drawn in the lectr ink system, nothing warm, nothing smeared.

     · NEUTRAL INK: near-white anchor at full weight; curated
       sub-market layers in their indexed palette hues; green/
       red appear ONLY on value text, never as paint
     · INSTRUMENT GRID: dotted horizontal rules with right-edge
       value ticks (mono when the unit is %), a captioned zero
       rule when the domain crosses it, sparse quarter labels
     · ONE SCRUB across both panes: crosshair + a readout card
       listing every visible line at that quarter, color-keyed
     · SUBPANE: the price+volume composition — series that
       can't share the anchor's axis ride a second, quieter
       band that answers to the same crosshair and chips
     · draw-in is a clip wipe (the write-on grammar), never a
       value animation; reduced-motion renders resolved

   Honest to the pixel: every plotted point is a real quarterly
   reading; the readout prints values in each line's own unit.
   ============================================================ */

export interface HeroPoint { period: string; value: number; n: number }
export interface HeroLine {
  key: string;
  label: string;
  color: string;
  unit: 'pct' | 'money' | 'count';
  points: HeroPoint[];
}

interface Props {
  anchor: HeroLine;
  layers?: HeroLine[];
  subLayers?: HeroLine[];
  subLabel?: string | null;
  highlight?: string | null;
  height?: number;
  subHeight?: number;
  compact?: boolean;
  play: boolean;
  /** draw the dotted rules but not their value labels — for small panels
      whose headline already states the figure (labels collide at mini size) */
  hideTickLabels?: boolean;
  /** FLIPPED composition (sports/science/culture): the curated sub-market
      lines take the MAIN stage; the anchor (the numeral's own line) rides
      the lower band. Same scrub, same chips, same honesty. */
  flip?: boolean;
}

/* ── scales & paths ────────────────────────────────────────── */

/** monotone cubic (Fritsch–Carlson) — smooth, never overshoots the data */
function monotonePath(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n === 0) return '';
  if (n === 1) return `M${xs[0]},${ys[0]}`;
  const dx: number[] = [], dy: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i]); dy.push(ys[i + 1] - ys[i]); m.push(dy[i] / (dx[i] || 1)); }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t.push(0);
    else { const w = dx[i - 1] + dx[i]; t.push(3 * w / ((w + dx[i]) / m[i - 1] + (w + dx[i - 1]) / m[i])); }
  }
  t.push(m[n - 2]);
  let d = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(xs[i] + h).toFixed(2)},${(ys[i] + h * t[i]).toFixed(2)} ${(xs[i + 1] - h).toFixed(2)},${(ys[i + 1] - h * t[i + 1]).toFixed(2)} ${xs[i + 1].toFixed(2)},${ys[i + 1].toFixed(2)}`;
  }
  return d;
}

/** rounded tick values — 3 quiet rules that land on human numbers */
function niceTicks(min: number, max: number, count = 3): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const step0 = span / (count + 1);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count + 1.6) || 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : v);
  return out.slice(0, count + 2);
}

const fmtTick = (v: number, unit: HeroLine['unit']): string => {
  if (unit === 'pct') return `${v > 0 ? '+' : ''}${Math.round(v)}%`;
  if (unit === 'count') return v >= 1000 ? `${Math.round(v / 1000)}K` : `${Math.round(v)}`;
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${Math.round(v)}`;
};
/** format a tick SET together — whole-K rounding on a tight domain collides
    distinct rules into the same label ("$5K / $5K / $4K"); when that happens
    the whole axis steps up one decimal so every printed rule reads as its
    own value (the formatEstimate "$49K–$49K" guard, applied to an axis) */
const fmtTickSet = (vals: number[], unit: HeroLine['unit']): Map<number, string> => {
  const base = new Map(vals.map(v => [v, fmtTick(v, unit)]));
  if (new Set(base.values()).size === base.size) return base;
  const fine = (v: number): string => {
    if (unit === 'pct') return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
    if (unit === 'count') return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : `${Math.round(v)}`;
    return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v)}`;
  };
  return new Map(vals.map(v => [v, fine(v)]));
};
const fmtVal = (v: number, unit: HeroLine['unit']): string => {
  if (unit === 'pct') return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  if (unit === 'count') return `${Math.round(v).toLocaleString()}/qtr`;
  return v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : `$${Math.round(v).toLocaleString()}`;
};

/* one pane's geometry: x from the shared period axis, y from its own domain */
function usePane(lines: HeroLine[], periods: string[], w: number, h: number, padTop: number, padBot: number) {
  return useMemo(() => {
    const xOf = new Map<string, number>();
    const span = Math.max(1, periods.length - 1);
    periods.forEach((p, i) => xOf.set(p, (i / span) * w));
    const vals = lines.flatMap(l => l.points.map(p => p.value));
    let min = vals.length ? Math.min(...vals) : 0;
    let max = vals.length ? Math.max(...vals) : 1;
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.10;
    min -= pad; max += pad;
    const yOf = (v: number) => padTop + (1 - (v - min) / (max - min)) * (h - padTop - padBot);
    const paths = lines.map(l => {
      const pts = l.points.filter(p => xOf.has(p.period));
      return { line: l, pts, d: monotonePath(pts.map(p => xOf.get(p.period)!), pts.map(p => yOf(p.value))) };
    });
    return { xOf, yOf, min, max, paths };
  }, [lines, periods, w, h, padTop, padBot]);
}

/* ── the component ─────────────────────────────────────────── */

export default function HeroChart({
  anchor, layers = [], subLayers = [], subLabel, highlight,
  height = 280, subHeight = 84, compact = false, play, flip = false,
  hideTickLabels = false,
}: Props) {
  const reduce = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverI, setHoverI] = useState<number | null>(null);

  // TRUE-PIXEL viewBox: measure the container and draw 1 svg unit = 1 css px.
  // An aspect-ratio-scaled viewBox collapsed the panes to ~60px on phones —
  // heights here are real pixels at every width, and text never distorts.
  const [W, setW] = useState(0);
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

  // the shared quarterly axis — union of every visible line's periods, sorted
  const periods = useMemo(() => {
    const set = new Set<string>(anchor.points.map(p => p.period));
    for (const l of [...layers, ...subLayers]) for (const p of l.points) set.add(p.period);
    return Array.from(set).sort();
  }, [anchor, layers, subLayers]);

  const flipped = flip && subLayers.length > 0;
  const mainLines = useMemo(() => (flipped ? subLayers : [anchor, ...layers]), [flipped, subLayers, anchor, layers]);
  const subLines = useMemo(() => (flipped ? [anchor] : subLayers), [flipped, anchor, subLayers]);
  const main = usePane(mainLines, periods, W, height, 18, compact ? 22 : 26);
  const sub = usePane(subLines, periods, W, subHeight, 10, 8);
  const hasSub = subLines.length > 0;

  const mainUnit = flipped ? (mainLines[0]?.unit ?? 'pct') : anchor.unit;
  const ticks = useMemo(() => niceTicks(main.min, main.max, compact ? 2 : 3), [main.min, main.max, compact]);
  const subTicks = useMemo(() => (flipped ? niceTicks(sub.min, sub.max, 1) : []), [flipped, sub.min, sub.max]);
  const tickLabels = useMemo(() => fmtTickSet(ticks, mainUnit), [ticks, mainUnit]);
  const subTickLabels = useMemo(() => fmtTickSet(subTicks, anchor.unit), [subTicks, anchor.unit]);
  const zeroInDomain = mainUnit === 'pct' && main.min < 0 && main.max > 0;

  // sparse x labels — first, ~middle(s), last
  const xLabels = useMemo(() => {
    if (periods.length < 2) return [];
    const want = compact ? 3 : 5;
    const idxs = new Set<number>([0, periods.length - 1]);
    for (let k = 1; k < want - 1; k++) idxs.add(Math.round((k * (periods.length - 1)) / (want - 1)));
    return Array.from(idxs).sort((a, b) => a - b).map(i => ({ i, label: periods[i] }));
  }, [periods, compact]);

  /* scrub — pointer x → nearest period index (mouse + touch, both panes) */
  const onMove = useCallback((e: React.PointerEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHoverI(Math.round(frac * (periods.length - 1)));
  }, [periods.length]);
  const onLeave = useCallback(() => setHoverI(null), []);

  const hoverPeriod = hoverI != null ? periods[hoverI] : null;
  const hoverX = hoverPeriod != null ? main.xOf.get(hoverPeriod)! : null;
  const readout = useMemo(() => {
    if (!hoverPeriod) return null;
    const at = (l: HeroLine) => l.points.find(p => p.period === hoverPeriod);
    const rows = [
      { key: '_anchor', label: anchor.label, color: 'var(--color-fg, #E8EAED)', unit: anchor.unit, pt: at(anchor), anchor: true },
      ...[...layers, ...subLayers].map(l => ({ key: l.key, label: l.label, color: l.color, unit: l.unit, pt: at(l), anchor: false })),
    ].filter(r => r.pt);
    return { period: hoverPeriod, rows };
  }, [hoverPeriod, anchor, layers, subLayers]);

  const opacityOf = (key: string | null) =>
    highlight == null ? undefined : highlight === key ? 1 : 0.12;

  const animCls = play && !reduce ? ` ${styles.hcWipe}` : '';
  const anchorLast = anchor.points[anchor.points.length - 1];

  // anchor peak/trough tags — honest extremes, skipped when they ARE the terminus
  const anno = useMemo(() => {
    if (compact || anchor.points.length < 8) return [];
    let pi = 0, ti = 0;
    anchor.points.forEach((p, i) => {
      if (p.value > anchor.points[pi].value) pi = i;
      if (p.value < anchor.points[ti].value) ti = i;
    });
    const out: { p: HeroPoint; side: 'above' | 'below' }[] = [];
    if (pi !== anchor.points.length - 1 && pi !== 0) out.push({ p: anchor.points[pi], side: 'above' });
    if (ti !== anchor.points.length - 1 && ti !== 0 && ti !== pi) out.push({ p: anchor.points[ti], side: 'below' });
    return out;
  }, [anchor, compact]);

  const reserved = height + (hasSub ? subHeight + 30 : 0);
  if (!W) {
    return <div ref={wrapRef} className={styles.hcWrap} style={{ minHeight: reserved }} aria-hidden />;
  }

  return (
    <div
      ref={wrapRef}
      className={styles.hcWrap}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      role="img"
      aria-label={`${anchor.label} chart`}
    >
      {/* ── MAIN STAGE ── */}
      <svg viewBox={`0 0 ${W} ${height}`} className={styles.hcSvg} style={{ height }} width={W} height={height}>
        {/* instrument grid: dotted rules + right-edge ticks */}
        {ticks.map(t => {
          const y = main.yOf(t);
          if (y < 12 || y > height - 18) return null;
          const isZero = zeroInDomain && t === 0;
          return (
            <g key={`t${t}`}>
              <line x1={0} x2={W} y1={y} y2={y} className={isZero ? styles.hcRuleZero : styles.hcRule} />
              {!hideTickLabels && (
                <text x={W - 4} y={y - 5} textAnchor="end" className={`${styles.hcTick}${mainUnit === 'pct' ? ` ${styles.pctData}` : ''}`}>
                  {tickLabels.get(t)}{isZero && !flipped ? ' · est' : ''}
                </text>
              )}
            </g>
          );
        })}

        {/* x labels along the base */}
        {xLabels.map(({ i, label }) => (
          <text
            key={label}
            x={Math.min(W - 2, Math.max(2, main.xOf.get(periods[i]) ?? 0))}
            y={height - 8}
            textAnchor={i === 0 ? 'start' : i === periods.length - 1 ? 'end' : 'middle'}
            className={styles.hcXLabel}
          >
            {label}
          </text>
        ))}

        {/* crosshair */}
        {hoverX != null && <line x1={hoverX} x2={hoverX} y1={10} y2={height - 20} className={styles.hcCross} />}

        <g className={animCls || undefined}>
          {/* layers under the anchor (flipped: every main line IS a layer) */}
          {(flipped ? main.paths : main.paths.slice(1)).map(({ line, d, pts }) => (
            <g key={line.key} style={{ opacity: opacityOf(line.key), transition: 'opacity 0.25s ease' }}>
              <path d={d} fill="none" stroke={line.color} strokeWidth={highlight === line.key ? (flipped ? 2.3 : 2) : (flipped ? 1.7 : 1.4)}
                strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {pts.length > 0 && (
                <circle cx={main.xOf.get(pts[pts.length - 1].period)} cy={main.yOf(pts[pts.length - 1].value)} r={2.2} fill={line.color} />
              )}
              {(highlight === line.key || mainLines.length <= 3) && pts.length > 0 && (
                <text x={Math.min(W - 4, (main.xOf.get(pts[pts.length - 1].period) ?? 0) + 8)}
                  y={main.yOf(pts[pts.length - 1].value) + 3}
                  textAnchor={(main.xOf.get(pts[pts.length - 1].period) ?? 0) > W - 80 ? 'end' : 'start'}
                  className={styles.hcLineLabel} fill={line.color}>
                  {line.label}
                </text>
              )}
            </g>
          ))}

          {/* the anchor — near-white, full weight (main stage, normal mode) */}
          {!flipped && (
            <g style={{ opacity: highlight == null ? 1 : 0.35, transition: 'opacity 0.25s ease' }}>
              <path d={main.paths[0].d} fill="none" stroke="var(--color-fg, #E8EAED)" strokeWidth={2.25}
                strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          )}

          {/* anchor terminus — a quiet double ring, no glow */}
          {!flipped && anchorLast && main.xOf.has(anchorLast.period) && (
            <g>
              <circle cx={main.xOf.get(anchorLast.period)} cy={main.yOf(anchorLast.value)} r={3.2} fill="var(--color-fg, #E8EAED)" />
              {/* the pulse class rides the RING itself, gated on the OS motion
                  switch (styles.hcTerminus never existed — the old gate was a
                  no-op and the pulse ran for reduced-motion readers, B3 #4);
                  under reduce the ring renders as a static quiet double ring */}
              <circle cx={main.xOf.get(anchorLast.period)} cy={main.yOf(anchorLast.value)} r={6.5}
                fill="none" stroke="var(--color-fg, #E8EAED)" strokeOpacity={0.3} strokeWidth={1}
                className={reduce ? undefined : styles.hcTerminusRing} />
            </g>
          )}

          {/* peak / trough tags */}
          {!flipped && anno.map(({ p, side }) => (
            <text key={`${p.period}${side}`}
              x={main.xOf.get(p.period)} y={main.yOf(p.value) + (side === 'above' ? -9 : 15)}
              textAnchor="middle"
              className={`${styles.hcAnno}${anchor.unit === 'pct' ? ` ${styles.pctData}` : ''}`}>
              {fmtVal(p.value, anchor.unit)}
            </text>
          ))}

          {/* scrub dots on every visible line */}
          {hoverPeriod && main.paths.map(({ line, pts }) => {
            const pt = pts.find(p => p.period === hoverPeriod);
            if (!pt) return null;
            const isAnchor = !flipped && line.key === anchor.key;
            if (!isAnchor && highlight != null && highlight !== line.key) return null;
            return <circle key={`h${line.key}`} cx={main.xOf.get(pt.period)} cy={main.yOf(pt.value)} r={isAnchor ? 3.4 : 2.4}
              fill={isAnchor ? 'var(--color-fg, #E8EAED)' : line.color} stroke="var(--color-bg, #08090B)" strokeWidth={1.4} />;
          })}
        </g>
      </svg>

      {/* ── SUBPANE — same crosshair, its own quiet band ── */}
      {hasSub && (
        <>
          <div className={styles.hcSubMeta}>
            <span>{subLabel}</span>
          </div>
          <svg viewBox={`0 0 ${W} ${subHeight}`} className={styles.hcSvg} style={{ height: subHeight }} width={W} height={subHeight}>
            <line x1={0} x2={W} y1={subHeight - 6} y2={subHeight - 6} className={styles.hcRule} />
            {subTicks.map(t => {
              const y = sub.yOf(t);
              if (y < 10 || y > subHeight - 10) return null;
              return (
                <text key={`st${t}`} x={W - 4} y={y - 4} textAnchor="end" className={styles.hcTick}>
                  {subTickLabels.get(t)}
                </text>
              );
            })}
            {hoverX != null && <line x1={hoverX} x2={hoverX} y1={2} y2={subHeight - 6} className={styles.hcCross} />}
            <g className={animCls || undefined}>
              {sub.paths.map(({ line, d, pts }) => (
                <g key={line.key} style={{ opacity: flipped && line.key === anchor.key ? (highlight == null ? 1 : 0.45) : opacityOf(line.key), transition: 'opacity 0.25s ease' }}>
                  <path d={d} fill="none"
                    stroke={flipped && line.key === anchor.key ? 'var(--color-fg, #E8EAED)' : line.color}
                    strokeWidth={flipped && line.key === anchor.key ? 1.8 : highlight === line.key ? 1.8 : 1.2}
                    strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  {pts.length > 0 && (
                    <circle cx={sub.xOf.get(pts[pts.length - 1].period)} cy={sub.yOf(pts[pts.length - 1].value)} r={flipped && line.key === anchor.key ? 2.6 : 1.8}
                      fill={flipped && line.key === anchor.key ? 'var(--color-fg, #E8EAED)' : line.color} />
                  )}
                  {highlight === line.key && pts.length > 0 && (
                    <text x={Math.min(W - 4, (sub.xOf.get(pts[pts.length - 1].period) ?? 0) + 8)}
                      y={sub.yOf(pts[pts.length - 1].value) + 3}
                      textAnchor={(sub.xOf.get(pts[pts.length - 1].period) ?? 0) > W - 80 ? 'end' : 'start'}
                      className={styles.hcLineLabel} fill={line.color}>
                      {line.label}
                    </text>
                  )}
                </g>
              ))}
              {hoverPeriod && sub.paths.map(({ line, pts }) => {
                const pt = pts.find(p => p.period === hoverPeriod);
                if (!pt) return null;
                const isAnchor = flipped && line.key === anchor.key;
                if (!isAnchor && highlight != null && highlight !== line.key) return null;
                return <circle key={`hs${line.key}`} cx={sub.xOf.get(pt.period)} cy={sub.yOf(pt.value)} r={isAnchor ? 2.8 : 2.2}
                  fill={isAnchor ? 'var(--color-fg, #E8EAED)' : line.color} stroke="var(--color-bg, #08090B)" strokeWidth={1.2} />;
              })}
            </g>
          </svg>
        </>
      )}

      {/* ── READOUT — every visible line at the scrubbed quarter ── */}
      {readout && (
        <div className={styles.hcReadout} style={{ left: `${((hoverX ?? 0) / W) * 100}%` }} data-flip={(hoverX ?? 0) > W * 0.62 ? 'true' : undefined}>
          <span className={styles.hcReadoutPeriod}>{readout.period}</span>
          {readout.rows.map(r => (
            <span key={r.key} className={styles.hcReadoutRow} data-anchor={r.anchor ? 'true' : undefined}>
              <i style={{ background: r.color }} aria-hidden />
              <span className={styles.hcReadoutName}>{r.label}</span>
              <span className={`${styles.hcReadoutVal}${r.unit === 'pct' ? ` ${styles.pctData}` : ''}`}>{fmtVal(r.pt!.value, r.unit)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
