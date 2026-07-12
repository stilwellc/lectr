'use client';

import { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
import { AuctionLot } from '../../types';
import { demandSeries, formatDemand } from '../../lib/demand';

/**
 * DemandChart — the market's Demand Index as the analytics lead chart. Same
 * quantity as the home hero (typical sale vs its estimate, trailing 12
 * months) with axes for the analyst: % ticks, thinned quarters, the zero
 * "sells at estimate" baseline, hover detail with the window's sample size.
 */
function Tip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: { value: number; n: number } }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border)',
      borderRadius: 10,
      padding: '10px 14px',
      fontFamily: 'var(--font-sans), sans-serif',
    }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>12 months to {label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: p.value >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
        {formatDemand(p.value)} vs estimate
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-faint)', marginTop: 2 }}>{p.n.toLocaleString()} sales in window</div>
    </div>
  );
}

export default function DemandChart({ allLots }: { allLots: AuctionLot[] }) {
  const series = useMemo(() => demandSeries(allLots), [allLots]);
  const [hovered, setHovered] = useState(false);
  const now = series.length ? series[series.length - 1].value : 0;
  const lineColor = now >= 0 ? 'var(--color-up)' : 'var(--color-down)';

  if (series.length < 2) return null;

  return (
    <section className="ray-demand rail" style={{ paddingBlock: '40px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <h2 className="ray-h2">Market demand</h2>
        <span style={{ fontSize: 13, color: 'var(--color-text-faint)' }}>
          typical sale vs its estimate · trailing 12 months · currently{' '}
          <b style={{ color: lineColor, fontWeight: 700 }}>{formatDemand(now)}</b>
        </span>
      </div>
      <div className="glass glass-quiet" style={{ padding: '22px 18px 10px' }} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="demandGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.14} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--color-text-faint)', fontFamily: 'var(--font-sans), sans-serif' }}
                axisLine={{ stroke: 'var(--color-border)' }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={56}
              />
              <YAxis
                tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v}%`}
                tick={{ fontSize: 11, fill: 'var(--color-text-faint)', fontFamily: 'var(--font-sans), sans-serif' }}
                axisLine={false}
                tickLine={false}
                width={46}
                domain={[(min: number) => Math.min(0, Math.floor(min)), (max: number) => Math.ceil(max)]}
              />
              <ReferenceLine y={0} stroke="var(--color-border-mid)" strokeDasharray="4 4" />
              <Tooltip content={<Tip />} cursor={{ stroke: 'var(--color-border-mid)', strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={2.25}
                fill="url(#demandGrad)"
                dot={false}
                activeDot={{ r: 4, fill: lineColor, stroke: 'var(--color-bg)', strokeWidth: 2 }}
                isAnimationActive={!hovered}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={{ padding: '8px 4px 6px', fontSize: 11.5, color: 'var(--color-text-faint)' }}>
          0% = the typical lot sells exactly at its estimate midpoint · median of all sales in each trailing-year window
        </div>
      </div>
    </section>
  );
}
