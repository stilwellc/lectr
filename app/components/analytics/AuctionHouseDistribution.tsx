'use client';

import { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from 'recharts';
import { MarketStats } from '../../types';
import { formatPrice, houseColorsHex, formatMoneyAxis } from '../../utils';
import { useTheme } from '../ThemeProvider';

interface Props {
  statsByArtist: Record<string, MarketStats>;
}

const formatAxis = formatMoneyAxis;

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
      <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', letterSpacing: '-0.01em', textTransform: 'none', marginBottom: 6 }}>
        {d.house}
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--color-fg)', fontWeight: 500, marginBottom: 1 }}>
        Value: {formatPrice(d.totalValue)}
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--color-text-muted)' }}>
        {d.count.toLocaleString()} lots
      </div>
    </div>
  );
}

/**
 * Rendered embedded inside the Distributions band only (its tab row supplies
 * the section frame and header) — mirrors SportBreakdown's card-only shape.
 */
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
        fill: houseColorsHex[theme][house] || (theme === 'light' ? '#6D685E' : '#A69B86'),
      }))
      .sort((a, b) => b.totalValue - a.totalValue);
  }, [statsByArtist, theme]);

  if (houseData.length === 0) return null;

  return (
    <>
      <style>{`
        .ray-house-chart { height: 300px; }
        @media (max-width: 768px) {
          .ray-house-chart { height: 290px; }
        }
      `}</style>
      <div className="glass glass-quiet" style={{
        overflow: 'hidden',
      }}>
        <div style={{ padding: '20px 8px 0 0' }}>
          <div className="ray-house-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={houseData} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={formatAxis}
                  tick={{ fontSize: 10.5, fill: 'var(--color-text-faint)', fontFamily: "var(--font-sans), sans-serif" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="house"
                  tick={{ fontSize: 12.5, fill: 'var(--color-text-secondary)', fontFamily: "var(--font-sans), sans-serif" }}
                  axisLine={false}
                  tickLine={false}
                  width={82}
                  interval={0}
                />
                <Tooltip content={<HouseTooltip />} cursor={{ fill: 'var(--color-hover-item)' }} />
                <Bar dataKey="totalValue" radius={[0, 4, 4, 0]} barSize={16}>
                  {houseData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} fillOpacity={0.75} />
                  ))}
                  <LabelList dataKey="totalValue" position="right" formatter={(v: number) => formatAxis(v)} style={{ fill: 'var(--color-text-muted)', fontSize: 11.5, fontFamily: 'var(--font-sans), sans-serif' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </>
  );
}
