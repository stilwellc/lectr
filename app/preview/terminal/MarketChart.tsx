'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Scatter,
  YAxis,
  XAxis,
  Tooltip,
  ReferenceDot,
} from 'recharts';
import { useReducedMotion } from './hooks';
import styles from './style.module.css';

/* ============================================================
   THE MARKET CHART — the hero's instrument, drawn in the house
   language:

     · the trend line at full strength (butter, rounded joins),
       closing on a LIVE TERMINUS — a pulsing endpoint dot
     · a luminous directional fill (green up / red down), not
       a smear — bright at the line, gone by two-thirds
     · DOTTED horizontal rules (soft-transition grammar) and a
       dotted crosshair — never solid lines inside the plot
     · honest anchors: the series' PEAK and TROUGH annotated
       with real values in the series' own unit (mono only
       when the unit is %)
     · raw per-quarter cohort dots kept visible under the trend
       ("we show the raw data" credibility)
     · edge-masked so the line breathes out of the frame edges

   Stamped, never spun: the draw-in reveals the real line; no
   value ever interpolates. Reduced-motion renders resolved.
   ============================================================ */

export interface IndexPoint {
  period: string;
  value: number;
  n: number;
}

interface Props {
  data: IndexPoint[];
  play: boolean;
  height?: number;
  /** compact = mobile card variant (fewer ticks, shorter) */
  compact?: boolean;
  /** format a value in the series' own unit (fmtPct / fmtMoneyCompact) */
  format?: (n: number) => string;
  /** the unit is a percent — annotations + tooltip values speak mono */
  isPct?: boolean;
}

function TerminalTooltip({ active, payload, format, isPct }: {
  active?: boolean; payload?: Array<{ payload: IndexPoint }>;
  format: (n: number) => string; isPct: boolean;
}) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className={styles.chartTip}>
      <span className={styles.chartTipPeriod}>{p.period}</span>
      <span className={`${styles.chartTipVal}${isPct ? ` ${styles.pctData}` : ''}`}>{format(p.value)}</span>
      <span className={styles.chartTipN}>{p.n.toLocaleString('en-US')} lots</span>
    </div>
  );
}

export default function MarketChart({
  data, play, height = 260, compact = false,
  format = (n) => String(Math.round(n)), isPct = false,
}: Props) {
  const reduce = useReducedMotion();
  const rows = useMemo(() => data.map((d) => ({ ...d })), [data]);

  const vals = rows.map((r) => r.value);
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 100;
  const pad = Math.max(2, (max - min) * 0.22);

  // direction from the series' own endpoints (deadband so drift reads flat)
  const dir = useMemo<'up' | 'down' | 'flat'>(() => {
    if (vals.length < 2) return 'flat';
    const first = vals[0];
    const last = vals[vals.length - 1];
    if (!first) return 'flat';
    const pct = ((last - first) / Math.abs(first)) * 100;
    if (pct > 1.5) return 'up';
    if (pct < -1.5) return 'down';
    return 'flat';
  }, [vals]);
  const fillColor = dir === 'up' ? '#57be87' : dir === 'down' ? '#cc6a5c' : '#9a8f7d';

  // the honest anchors: peak + trough of the visible window (skipped when the
  // window is short, flat, or the extreme IS the endpoint the terminus marks)
  const peakIdx = vals.indexOf(max);
  const troughIdx = vals.indexOf(min);
  const annotate = rows.length >= 8 && max !== min;
  const last = rows.length ? rows[rows.length - 1] : null;

  const animate = play && !reduce;

  return (
    <div className={styles.chartWrap} style={{ height }} data-dir={dir}>
      {/* colored directional under-glow — decorative, beneath the plot */}
      <div className={styles.chartGlow} data-dir={dir} aria-hidden />
      <div className={styles.chartMask}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 24, right: 16, bottom: 4, left: 10 }}>
            <defs>
              <linearGradient id="tt-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={fillColor} stopOpacity="0.26" />
                <stop offset="62%" stopColor={fillColor} stopOpacity="0.04" />
                <stop offset="100%" stopColor={fillColor} stopOpacity="0" />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke="none"
              fill="url(#tt-area)"
              isAnimationActive={animate}
              animationDuration={animate ? 1100 : 0}
              animationEasing="ease-out"
            />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 10.5, fill: 'var(--tt-faint)', fontFamily: 'var(--font-inter), sans-serif', letterSpacing: '0.04em' }}
              tickLine={false}
              axisLine={false}
              interval={compact ? Math.max(1, Math.floor(rows.length / 3)) : Math.max(1, Math.floor(rows.length / 6))}
              minTickGap={28}
              tickMargin={9}
            />
            {/* y drives the scale, renders no abstract levels — the anchors +
                the headline speak the values */}
            <YAxis domain={[Math.floor(min - pad), Math.ceil(max + pad)]} hide />
            <Tooltip
              content={<TerminalTooltip format={format} isPct={isPct} />}
              cursor={{ stroke: 'var(--tt-butter)', strokeOpacity: 0.45, strokeWidth: 1, strokeDasharray: '2 6' }}
            />
            {/* raw cohort points — visible, quiet */}
            <Scatter
              dataKey="value"
              isAnimationActive={false}
              shape={(props: { cx?: number; cy?: number }) =>
                props.cx == null || props.cy == null ? (
                  <g />
                ) : (
                  <circle cx={props.cx} cy={props.cy} r={1.9} fill="var(--tt-butter)" fillOpacity={0.28} />
                )
              }
            />
            {/* the trend — full-strength butter, cinematic draw-in */}
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--tt-butter)"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, fill: 'var(--tt-butter)', stroke: 'var(--tt-bg, #17130e)', strokeWidth: 1.5 }}
              isAnimationActive={animate}
              animationDuration={animate ? 1100 : 0}
              animationEasing="ease-out"
            />
            {/* honest anchors: peak + trough in the series' own unit */}
            {annotate && !compact && peakIdx !== rows.length - 1 && (
              <ReferenceDot
                x={rows[peakIdx].period}
                y={rows[peakIdx].value}
                r={0}
                isFront
                label={({ viewBox }: { viewBox?: { x?: number; y?: number } }) => (
                  <g transform={`translate(${viewBox?.x ?? 0}, ${(viewBox?.y ?? 0) - 9})`}>
                    <circle cx="0" cy="7" r="2" fill="var(--tt-butter)" fillOpacity="0.75" />
                    <text x="0" y="-2" textAnchor="middle" className={`${styles.chartAnno}${isPct ? ` ${styles.pctData}` : ''}`}>
                      {format(rows[peakIdx].value)}
                    </text>
                  </g>
                )}
              />
            )}
            {annotate && !compact && troughIdx !== 0 && troughIdx !== rows.length - 1 && troughIdx !== peakIdx && (
              <ReferenceDot
                x={rows[troughIdx].period}
                y={rows[troughIdx].value}
                r={0}
                isFront
                label={({ viewBox }: { viewBox?: { x?: number; y?: number } }) => (
                  <g transform={`translate(${viewBox?.x ?? 0}, ${(viewBox?.y ?? 0) + 9})`}>
                    <circle cx="0" cy="-7" r="2" fill="var(--tt-butter)" fillOpacity="0.75" />
                    <text x="0" y="13" textAnchor="middle" className={`${styles.chartAnno}${isPct ? ` ${styles.pctData}` : ''}`}>
                      {format(rows[troughIdx].value)}
                    </text>
                  </g>
                )}
              />
            )}
            {/* THE LIVE TERMINUS — the series' now, pulsing */}
            {last && (
              <ReferenceDot
                x={last.period}
                y={last.value}
                r={0}
                isFront
                label={({ viewBox }: { viewBox?: { x?: number; y?: number } }) => (
                  <g transform={`translate(${viewBox?.x ?? 0}, ${viewBox?.y ?? 0})`} className={styles.chartTerminus}>
                    {!reduce && <circle className={styles.chartTerminusHalo} r="4" fill={fillColor} />}
                    <circle r="3.4" fill="var(--tt-butter)" stroke="var(--tt-bg, #17130e)" strokeWidth="1.5" />
                  </g>
                )}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
