'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Scatter,
  YAxis,
  XAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useReducedMotion } from './hooks';
import styles from './style.module.css';

/* ============================================================
   The market chart — a dollar-normalized index. Raw per-quarter
   cohort points sit UNDER a smooth trend line (WatchCharts "we
   show the raw data" credibility). On enter the line draws in
   over ~1.1s ease-out; reduced-motion renders it resolved.
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
}

function TerminalTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: IndexPoint }> }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className={styles.chartTip}>
      <span className={styles.chartTipPeriod}>{p.period}</span>
      <span className={styles.chartTipVal}>{p.value}</span>
      <span className={styles.chartTipN}>{p.n.toLocaleString('en-US')} lots</span>
    </div>
  );
}

export default function MarketChart({ data, play, height = 260, compact = false }: Props) {
  const reduce = useReducedMotion();
  const rows = useMemo(() => data.map((d) => ({ ...d })), [data]);

  // y-domain padded so the trend breathes; index is rebased to 100.
  const vals = rows.map((r) => r.value);
  const min = Math.min(...vals, 100);
  const max = Math.max(...vals, 100);
  const pad = Math.max(8, (max - min) * 0.14);

  const animate = play && !reduce;

  return (
    <div className={styles.chartWrap} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 6, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="tt-line" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--tt-butter)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--tt-butter)" stopOpacity="1" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--tt-hair)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 9.5, fill: 'var(--tt-faint)', fontFamily: 'var(--font-mono-data)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--tt-hair)' }}
            interval={compact ? Math.max(1, Math.floor(rows.length / 3)) : Math.max(1, Math.floor(rows.length / 6))}
            minTickGap={16}
          />
          {/* y-axis drives the scale but renders NO numbers — an abstract index
              level on the axis ("127") just confuses; the shape + the % deltas
              tell the story. */}
          <YAxis domain={[Math.floor(min - pad), Math.ceil(max + pad)]} hide />
          <Tooltip
            content={<TerminalTooltip />}
            cursor={{ stroke: 'var(--tt-butter)', strokeOpacity: 0.3, strokeWidth: 1 }}
          />
          {/* raw cohort points under the trend */}
          <Scatter
            dataKey="value"
            fill="var(--tt-faint)"
            fillOpacity={0.5}
            isAnimationActive={false}
            shape={(props: { cx?: number; cy?: number }) =>
              props.cx == null || props.cy == null ? (
                <g />
              ) : (
                <circle cx={props.cx} cy={props.cy} r={1.7} fill="var(--tt-faint)" fillOpacity={0.55} />
              )
            }
          />
          {/* the smooth trend line — cinematic draw-in */}
          <Line
            type="monotone"
            dataKey="value"
            stroke="url(#tt-line)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3.5, fill: 'var(--tt-butter)', stroke: 'var(--tt-bg)', strokeWidth: 1.5 }}
            isAnimationActive={animate}
            animationDuration={animate ? 1100 : 0}
            animationEasing="ease-out"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
