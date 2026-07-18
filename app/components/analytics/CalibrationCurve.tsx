'use client';

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { Backtest } from '../../hooks/useRayData';

const BUCKET_LABELS = ['<0.6×', '0.6–0.9×', '0.9–1.3×', '1.3–2×', '2–10×', '10×+'];
const MARKET_COLORS: Record<string, string> = {
  global: '#F2EEE3',
  art: '#A19B8D',
  design: '#8A8477',
  watches: '#6B6558',
};

/**
 * CalibrationCurve — "what a flag is worth": the measured chance a lot beats
 * its high estimate, by how far its comps trade over the ask (compRatio),
 * refit from every nightly replay (per-market, recency-weighted, shrunk).
 * The honesty is the point: the final bucket (10×+) DROPS — extreme ratios
 * under-deliver, and the engine says so instead of extrapolating.
 */
export default function CalibrationCurve({ backtest }: { backtest: Backtest }) {
  const cal = backtest.calibration;
  if (!cal?.beatRate?.global || cal.beatRate.global.length !== 6) return null;

  const rows = BUCKET_LABELS.map((label, i) => ({
    bucket: label,
    global: cal.beatRate.global[i],
    art: cal.beatRate.art?.[i],
    design: cal.beatRate.design?.[i],
    watches: cal.beatRate.watches?.[i],
  }));

  return (
    <section className="ray-calibration rail" style={{ paddingBlock: '40px 48px' }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ fontFamily: 'var(--font-sans), sans-serif', fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
          What a flag <span style={{ fontStyle: 'normal', color: 'var(--color-fg)' }}>is worth</span>
        </h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
          Measured chance a lot beats its high estimate, by how far its comps trade over the ask —
          refit from {cal.n?.toLocaleString?.() || 'every'} replayed sales at every nightly build. The 10×+ bucket drops on purpose: extreme gaps under-deliver, and the engine says so.
        </p>
      </div>
      <div className="glass glass-quiet" style={{ padding: '18px 12px 6px 0', marginTop: 16 }}>
        <div style={{ height: 230 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 6, right: 18, left: 0, bottom: 2 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--chart-tick)', fontFamily: 'var(--font-sans), sans-serif' }} axisLine={false} tickLine={false} interval={0} />
              <YAxis domain={[30, 85]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11, fill: 'var(--chart-tick)', fontFamily: 'var(--font-sans), sans-serif' }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                cursor={{ stroke: 'var(--chart-cursor)', strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 14px', fontFamily: 'var(--font-sans), sans-serif' }}>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 5 }}>comps at {label} the estimate</div>
                      {payload.map(p => (
                        <div key={String(p.dataKey)} style={{ fontSize: 12.5, color: MARKET_COLORS[String(p.dataKey)] || 'var(--color-fg)' }}>
                          {String(p.dataKey)}: {p.value}% beat the high estimate
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              {(['watches', 'design', 'art'] as const).map(m => (
                <Line key={m} type="stepAfter" dataKey={m} stroke={MARKET_COLORS[m]} strokeWidth={1.4} dot={false} isAnimationActive={false} strokeOpacity={0.75} />
              ))}
              <Line type="stepAfter" dataKey="global" stroke={MARKET_COLORS.global} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '8px 0 10px 18px', fontSize: 12, color: 'var(--color-text-faint)' }}>
          {Object.entries(MARKET_COLORS).map(([m, c]) => (
            <span key={m}><span style={{ display: 'inline-block', width: 14, height: 2, background: c, verticalAlign: 'middle', marginRight: 6 }} />{m}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
