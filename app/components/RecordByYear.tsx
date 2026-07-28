'use client';

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import type { Backtest } from '../hooks/useRayData';
import { fmtSignedPct } from '../utils';

/**
 * RecordByYear — the backtest's per-year series, rendered for the first time:
 * what flagged vs unflagged lots realized against their estimates, year by
 * year since 2000. The whole point of the record is that the green line sits
 * above the gray one in EVERY year — this chart lets a skeptic check.
 */
export default function RecordByYear({ backtest }: { backtest: Backtest }) {
  const data = (backtest.series || []).filter(p => p.flaggedMedianPct != null && p.unflaggedMedianPct != null);
  if (data.length < 5) return null;

  return (
    <section className="rail ray-enter" style={{ paddingTop: 30 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
        <h2 className="ray-h2" style={{ margin: 0 }}>The record, year by year</h2>
        <span style={{ fontSize: 13.5, color: 'var(--color-text-faint)' }}>
          median result vs estimate — flagged lots should beat unflagged every year, and do
        </span>
      </div>
      <div className="glass glass-quiet" style={{ padding: '18px 12px 8px 0' }}>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 18, left: 0, bottom: 2 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 10.5, fill: 'var(--chart-tick)', fontFamily: 'var(--font-sans), sans-serif' }}
                axisLine={false} tickLine={false} minTickGap={36}
              />
              <YAxis
                tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}%`}
                tick={{ fontSize: 10.5, fill: 'var(--chart-tick)', fontFamily: 'var(--font-sans), sans-serif' }}
                axisLine={false} tickLine={false} width={46}
              />
              <ReferenceLine y={0} stroke="var(--chart-ref)" strokeDasharray="4 4" />
              <Tooltip
                cursor={{ stroke: 'var(--chart-cursor)', strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as { flaggedMedianPct: number; unflaggedMedianPct: number; nFlagged: number };
                  return (
                    <div style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 14px', fontFamily: 'var(--font-sans), sans-serif' }}>
                      <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 5 }}>{label} · {d.nFlagged} flagged lots</div>
                      {/* signed formatter — a down year must print "−12%", never "+-12%" */}
                      <div style={{ fontSize: 13.5, color: 'var(--color-up)', fontWeight: 600 }}>flagged {fmtSignedPct(d.flaggedMedianPct)}</div>
                      <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)' }}>unflagged {fmtSignedPct(d.unflaggedMedianPct)}</div>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey="unflaggedMedianPct" stroke="var(--chart-line-2)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="flaggedMedianPct" stroke="var(--color-up)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ display: 'flex', gap: 18, padding: '8px 0 10px 18px', fontSize: 12.5, color: 'var(--color-text-faint)' }}>
          <span><span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--color-up)', verticalAlign: 'middle', marginRight: 6 }} />flagged below market</span>
          <span><span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--chart-line-2)', verticalAlign: 'middle', marginRight: 6 }} />unflagged</span>
          <span>· premium-inclusive, as bought</span>
        </div>
      </div>
    </section>
  );
}
