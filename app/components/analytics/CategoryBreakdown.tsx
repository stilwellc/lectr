'use client';

import { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { AuctionLot } from '../../types';
import { formatPrice, categoryLabels, categoryColorsHex } from '../../utils';
import { useTheme } from '../ThemeProvider';

interface Props {
  allLots: AuctionLot[];
}

function formatAxis(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function CategoryTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { category: string; revenue: number; count: number; soldCount: number } }> }) {
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
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', letterSpacing: '-0.01em', textTransform: 'none', marginBottom: 6 }}>
        {d.category}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-fg)', fontWeight: 500, marginBottom: 1 }}>
        Sales Value: {formatPrice(d.revenue)}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 1 }}>
        {d.soldCount.toLocaleString()} sold of {d.count.toLocaleString()} total
      </div>
    </div>
  );
}

export default function CategoryBreakdown({ allLots }: Props) {
  const { theme } = useTheme();
  const categoryData = useMemo(() => {
    const catMap: Record<string, { revenue: number; count: number; soldCount: number }> = {};
    for (const lot of allLots) {
      const cat = lot.category || 'unknown';
      if (!catMap[cat]) catMap[cat] = { revenue: 0, count: 0, soldCount: 0 };
      catMap[cat].count++;
      if (lot.status === 'sold' && lot.priceUsd) {
        catMap[cat].revenue += lot.priceUsd;
        catMap[cat].soldCount++;
      }
    }
    return Object.entries(catMap)
      .filter(([cat]) => cat !== 'unknown')
      .map(([cat, d]) => ({
        category: categoryLabels[cat] || cat,
        categoryKey: cat,
        revenue: d.revenue,
        count: d.count,
        soldCount: d.soldCount,
        // Recharts fills need concrete hexes, swapped per theme.
        fill: categoryColorsHex[theme][cat] || (theme === 'light' ? '#6D685E' : '#9F9991'),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [allLots, theme]);

  if (categoryData.length === 0) return null;

  return (
    <section className="ray-category rail">
      <style>{`
        .ray-category { padding-block: 40px 48px; }
        @media (max-width: 768px) {
          .ray-category { padding-block: 32px 32px; }
        }
      `}</style>

      <div style={{ marginBottom: 20 }}>
        <h2 style={{
          fontFamily: 'var(--font-sans), sans-serif',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: '-0.02em',
        }}>
          Category <span style={{ fontStyle: 'normal', color: 'var(--color-fg)' }}>breakdown</span>
        </h2>
      </div>

      <div className="glass glass-quiet" style={{
        overflow: 'hidden',
        padding: '20px 8px 16px 0',
      }}>
        <ResponsiveContainer width="100%" height={categoryData.length * 56 + 40}>
          <BarChart data={categoryData} layout="vertical" margin={{ top: 8, right: 30, left: 10, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={formatAxis}
              tick={{ fontSize: 12, fill: 'var(--color-text-faint)', fontFamily: "var(--font-sans), sans-serif" }}
              axisLine={{ stroke: 'var(--color-border)' }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="category"
              width={100}
              tick={{ fontSize: 12, fill: 'var(--color-text-muted)', fontFamily: "var(--font-sans), sans-serif" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CategoryTooltip />} cursor={{ fill: 'var(--color-hover-item)' }} />
            <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
              {categoryData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} fillOpacity={0.7} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <div style={{
          height: 1,
          background: 'var(--color-border)',
          margin: '8px 20px 0',
        }} />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '14px 20px 4px' }}>
          {categoryData.map(cat => (
            <div key={cat.categoryKey} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: cat.fill,
                opacity: 0.7,
                flexShrink: 0,
              }} />
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {cat.category}: {cat.count.toLocaleString()} lots
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
