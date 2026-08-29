'use client';

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import FigCap from '../FigCap';
import type { Backtest } from '../../hooks/useRayData';

const BUCKET_LABELS = ['<0.6×', '0.6–0.9×', '0.9–1.3×', '1.3–2×', '2–10×', '10×+'];
// cool categorical set (the IndexLab layer palette) — the global cohort is the
// hero and rides the chart-hero token; per-market cohorts stay distinguishable
const MARKET_COLORS: Record<string, string> = {
  global: 'var(--chart-hero, #e8dab6)',
  art: '#7EA4CC',
  design: '#6FB5AC',
  watches: '#A98BC8',
};

/**
 * CalibrationCurve — "what a flag is worth": the measured chance a lot beats
 * its high estimate, by how far its comps trade over the ask (compRatio),
 * refit from every nightly replay (per-market, recency-weighted, shrunk).
 * The honesty is the point: the final bucket (10×+) DROPS — extreme ratios
 * under-deliver, and the engine says so instead of extrapolating.
 */
export default function CalibrationCurve({ backtest, bare = false, flagThreshold = false }: {
  backtest: Backtest;
  /** render only the chart panel — the caller owns the section head/copy */
  bare?: boolean;
  /** draw the 1.3× flag-bar witness at the first flag-eligible bucket */
  flagThreshold?: boolean;
}) {
  const cal = backtest.calibration;
  if (!cal?.beatRate?.global || cal.beatRate.global.length !== 6) return null;

  const rows = BUCKET_LABELS.map((label, i) => ({
    bucket: label,
    global: cal.beatRate.global[i],
    art: cal.beatRate.art?.[i],
    design: cal.beatRate.design?.[i],
    watches: cal.beatRate.watches?.[i],
  }));

  const panel = (
    <div className="glass glass-quiet" style={{ padding: '18px 12px 6px 0', marginTop: bare ? 0 : 16 }}>
      <div style={{ height: 230 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 64, left: 0, bottom: 2 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="bucket" tick={{ fontSize: 10.5, fill: 'var(--chart-tick)', fontFamily: 'var(--font-sans), sans-serif' }} axisLine={false} tickLine={false} interval={0} />
            <YAxis domain={[30, 85]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 10.5, fill: 'var(--chart-tick)', fontFamily: 'var(--font-sans), sans-serif' }} axisLine={false} tickLine={false} width={40} />
            {flagThreshold && (
              /* the flag bar: comps ≥1.3× the ask is where a flag becomes
                 legal — the witness stands at the first eligible bucket */
              <ReferenceLine x="1.3–2×" stroke="var(--chart-ref)" strokeWidth={1}
                label={{ value: 'flags start here · 1.3×', position: 'insideTopLeft', fill: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'var(--font-sans), sans-serif' }} />
            )}
            <Tooltip
              cursor={{ stroke: 'var(--chart-cursor)', strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 14px', fontFamily: 'var(--font-sans), sans-serif' }}>
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 5 }}>comps at {label} the estimate</div>
                    {payload.map(p => (
                      <div key={String(p.dataKey)} style={{ fontSize: 12.5, color: MARKET_COLORS[String(p.dataKey)] || 'var(--color-fg)' }}>
                        {String(p.dataKey)}: {p.value}% beat the high estimate, all-in
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {(['watches', 'design', 'art'] as const).map(m => (
              <Line key={m} type="stepAfter" dataKey={m} stroke={MARKET_COLORS[m]} strokeWidth={1.4} dot={false} isAnimationActive={false} strokeOpacity={0.75} />
            ))}
            <Line type="stepAfter" dataKey="global" stroke={MARKET_COLORS.global} strokeWidth={2} dot={false} isAnimationActive={false}
              label={(p: { index?: number; x?: number; y?: number }) => (p.index === rows.length - 1 && p.x != null && p.y != null ? (
                <text x={p.x + 8} y={p.y + 3} fontSize={10.5} fontFamily="var(--font-mono), monospace" fontWeight={600} fill="var(--chart-hero, #e8dab6)">global</text>
              ) : <g />)} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '8px 0 10px 18px', fontSize: 12.5, color: 'var(--color-text-faint)' }}>
        {Object.entries(MARKET_COLORS).map(([m, c]) => (
          <span key={m}><span style={{ display: 'inline-block', width: 14, height: 2, background: c, verticalAlign: 'middle', marginRight: 6 }} />{m}</span>
        ))}
      </div>
      <FigCap>
        Beat rate vs the high estimate by comp-ratio bucket, per market — recency-weighted and shrunk, refit at every
        nightly replay{cal.n?.toLocaleString ? ` over ${cal.n.toLocaleString()} sales` : ''}. The 10×+ bucket drops on
        purpose: extreme ratios under-deliver and the curve says so.
      </FigCap>
    </div>
  );
  if (bare) return panel;

  // section rhythm rides the tokens so the ≤768px override applies.
  // NO .rail here: the only mount (analytics' engine section) already wraps
  // this in a .rail div — a second rail double-applied the gutter and inset
  // this panel relative to its siblings.
  return (
    <section className="ray-calibration" style={{ paddingBlock: 'var(--sect-t) var(--sect-b)', fontVariantNumeric: 'tabular-nums' }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ fontFamily: 'var(--font-sans), sans-serif', fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
          What a flag <span style={{ fontStyle: 'normal', color: 'var(--color-fg)' }}>is worth</span>
        </h2>
        <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
          Measured chance a lot beats its high estimate, by how far its comps trade over the ask —
          refit from {cal.n?.toLocaleString?.() || 'every'} replayed sales at every nightly build. The 10×+ bucket drops on purpose: extreme gaps under-deliver, and the engine says so.
        </p>
      </div>
      {panel}
    </section>
  );
}
