'use client';

import { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { MarketStats } from '../../types';
import { formatPrice, houseColorsHex } from '../../utils';
import { useTheme } from '../ThemeProvider';

interface Props {
  statsByArtist: Record<string, MarketStats>;
}

function formatAxis(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function HouseTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { house: string; totalValue: number; count: number } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border)',
      borderRadius: 10,
      padding: '10px 14px',
      fontFamily: "var(--font-sans), sans-serif",
    }}>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
        {d.house}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-fg)', fontWeight: 500, marginBottom: 1 }}>
        Value: {formatPrice(d.totalValue)}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        {d.count.toLocaleString()} lots
      </div>
    </div>
  );
}

export default function AuctionHouseDistribution({ statsByArtist }: Props) {
  const { theme } = useTheme();
  const houseData = useMemo(() => {
    const houseMap: Record<string, { count: number; totalValue: number }> = {};
    for (const stats of Object.values(statsByArtist)) {
      for (const hd of stats.houseDistribution || []) {
        if (!houseMap[hd.house]) houseMap[hd.house] = { count: 0, totalValue: 0 };
        houseMap[hd.house].count += hd.count;
        houseMap[hd.house].totalValue += hd.totalValue;
      }
    }
    return Object.entries(houseMap)
      .map(([house, d]) => ({
        house,
        count: d.count,
        totalValue: d.totalValue,
        // Recharts fills need concrete hexes, swapped per theme.
        fill: houseColorsHex[theme][house] || (theme === 'light' ? '#6D685E' : '#9F9991'),
      }))
      .sort((a, b) => b.totalValue - a.totalValue);
  }, [statsByArtist, theme]);

  if (houseData.length === 0) return null;

  return (
    <section className="ray-house-dist rail">
      <style>{`
        .ray-house-dist { padding-block: 40px 48px; }
        .ray-house-chart { height: 300px; }
        @media (max-width: 768px) {
          .ray-house-dist { padding-block: 32px 32px; }
          .ray-house-chart { height: 220px; }
        }
      `}</style>

      <div style={{ marginBottom: 20 }}>
        <h2 style={{
          fontFamily: "var(--font-serif), serif",
          fontSize: 32,
          fontWeight: 300,
          letterSpacing: '-0.02em',
        }}>
          Auction House <span style={{ fontStyle: 'italic', color: 'var(--color-accent-gold)' }}>Distribution</span>
        </h2>
      </div>

      <div className="glass glass-quiet" style={{
        overflow: 'hidden',
      }}>
        <div style={{ padding: '20px 8px 0 0' }}>
          <div className="ray-house-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={houseData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="house"
                  tick={{ fontSize: 12, fill: 'var(--color-text-faint)', fontFamily: "var(--font-sans), sans-serif" }}
                  axisLine={{ stroke: 'var(--color-border)' }}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tickFormatter={formatAxis}
                  tick={{ fontSize: 12, fill: 'var(--color-text-faint)', fontFamily: "var(--font-sans), sans-serif" }}
                  axisLine={false}
                  tickLine={false}
                  width={55}
                />
                <Tooltip content={<HouseTooltip />} cursor={{ fill: 'var(--color-hover-item)' }} />
                <Bar dataKey="totalValue" radius={[4, 4, 0, 0]}>
                  {houseData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} fillOpacity={0.7} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </section>
  );
}
