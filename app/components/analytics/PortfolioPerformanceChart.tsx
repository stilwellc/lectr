'use client';

import { useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { MarketStats } from '../../types';
import { useChartDraw } from '../../hooks/useChartDraw';

interface Props {
  statsByArtist: Record<string, MarketStats>;
}

function formatAxis(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

const tooltipColors: Record<string, string> = { avgPrice: 'var(--color-fg)', highPrice: 'var(--color-accent-gold-text)', trendline: 'var(--color-accent-wine-text)' };
const tooltipLabels: Record<string, string> = { avgPrice: 'Avg', highPrice: 'High', trendline: 'Trend' };

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border)',
      borderRadius: 10,
      padding: '10px 14px',
      fontFamily: "var(--font-sans), sans-serif",
    }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      {payload.filter(e => e.value != null).map((entry) => (
        <div key={entry.dataKey} style={{ fontSize: 13, color: tooltipColors[entry.dataKey] || 'var(--color-fg)', marginBottom: 1, fontWeight: 500 }}>
          {tooltipLabels[entry.dataKey] || entry.dataKey}: {formatAxis(entry.value)}
        </div>
      ))}
    </div>
  );
}

export default function PortfolioPerformanceChart({ statsByArtist }: Props) {
  const drawRef = useChartDraw();
  const data = useMemo(() => {
    const quarterMap: Record<string, { weightedSum: number; totalHigh: number; totalSales: number }> = {};

    for (const stats of Object.values(statsByArtist)) {
      for (const point of stats.priceHistory || []) {
        const key = point.date.replace(' ', '-');
        if (!quarterMap[key]) {
          quarterMap[key] = { weightedSum: 0, totalHigh: 0, totalSales: 0 };
        }
        quarterMap[key].weightedSum += point.avgPrice * point.totalSales;
        quarterMap[key].totalHigh = Math.max(quarterMap[key].totalHigh, point.highPrice);
        quarterMap[key].totalSales += point.totalSales;
      }
    }

    const sorted = Object.entries(quarterMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({
        date: date.replace('-', ' '),
        avgPrice: d.totalSales > 0 ? d.weightedSum / d.totalSales : 0,
        highPrice: d.totalHigh,
        totalSales: d.totalSales,
      }));

    const window = 3;
    return sorted.map((p, i) => {
      if (i < window - 1) return { ...p, trendline: undefined };
      const slice = sorted.slice(i - window + 1, i + 1);
      const avg = slice.reduce((s, q) => s + q.avgPrice, 0) / window;
      return { ...p, trendline: avg };
    });
  }, [statsByArtist]);

  if (data.length < 2) return null;

  return (
    <section className="ray-perf-chart rail">
      <style>{`
        .ray-perf-chart { padding-block: 40px 48px; }
        .ray-perf-chart-container { height: 300px; }
        @media (max-width: 768px) {
          .ray-perf-chart { padding-block: 32px 32px; }
          .ray-perf-chart-container { height: 200px; }
        }
      `}</style>

      <div style={{ marginBottom: 20 }}>
        <h2 style={{
          fontFamily: "var(--font-serif), serif",
          fontSize: 32,
          fontWeight: 300,
          letterSpacing: '-0.02em',
        }}>
          Market <span style={{ fontStyle: 'italic', color: 'var(--color-accent-gold)' }}>Performance</span>
        </h2>
      </div>

      <div className="glass glass-quiet" style={{
        overflow: 'hidden',
      }}>
        <div style={{ padding: '20px 8px 0 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-fg)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-faint)', fontWeight: 600 }}>
                Avg
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent-gold)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-faint)', fontWeight: 600 }}>
                High
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 2, background: 'var(--color-accent-wine)', borderRadius: 1, flexShrink: 0 }} />
              <span style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-faint)', fontWeight: 600 }}>
                Trend
              </span>
            </div>
          </div>
          <div className="ray-perf-chart-container ray-chart-draw" ref={drawRef}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="perfIvoryGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-fg)" stopOpacity={0.08} />
                    <stop offset="100%" stopColor="var(--color-fg)" stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="perfGoldGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent-gold)" stopOpacity={0.1} />
                    <stop offset="100%" stopColor="var(--color-accent-gold)" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: 'var(--color-text-faint)', fontFamily: "var(--font-sans), sans-serif" }}
                  axisLine={{ stroke: 'var(--color-border)' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={formatAxis}
                  tick={{ fontSize: 12, fill: 'var(--color-text-faint)', fontFamily: "var(--font-sans), sans-serif" }}
                  axisLine={false}
                  tickLine={false}
                  width={55}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="highPrice"
                  stroke="var(--color-accent-gold)"
                  strokeWidth={1}
                  fill="url(#perfGoldGrad)"
                  strokeOpacity={0.35}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="avgPrice"
                  stroke="var(--color-fg)"
                  strokeWidth={2}
                  fill="url(#perfIvoryGrad)"
                  dot={false}
                  activeDot={{ r: 3, fill: 'var(--color-fg)', stroke: 'var(--color-bg)', strokeWidth: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="trendline"
                  stroke="var(--color-accent-wine)"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={false}
                  connectNulls={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}
