'use client';

import { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { AuctionLot } from '../../types';
import { formatPrice } from '../../utils';

interface Props {
  allLots: AuctionLot[];
}

const RANGES = [
  { label: '$0\u20131K', min: 0, max: 1_000 },
  { label: '$1K\u20135K', min: 1_000, max: 5_000 },
  { label: '$5K\u201325K', min: 5_000, max: 25_000 },
  { label: '$25K\u2013100K', min: 25_000, max: 100_000 },
  { label: '$100K\u2013500K', min: 100_000, max: 500_000 },
  { label: '$500K+', min: 500_000, max: Infinity },
];

function DistributionTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; count: number; totalValue: number } }> }) {
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
        {d.label}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-accent-gold)', fontWeight: 500, marginBottom: 1 }}>
        {d.count.toLocaleString()} lots
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        Total: {formatPrice(d.totalValue)}
      </div>
    </div>
  );
}

export default function PriceDistribution({ allLots }: Props) {
  const buckets = useMemo(() => {
    const sold = allLots.filter(l => l.status === 'sold' && l.priceUsd);
    return RANGES.map(r => {
      const matching = sold.filter(l => l.priceUsd! >= r.min && l.priceUsd! < r.max);
      return {
        label: r.label,
        count: matching.length,
        totalValue: matching.reduce((s, l) => s + (l.priceUsd || 0), 0),
      };
    });
  }, [allLots]);

  const hasData = buckets.some(b => b.count > 0);
  if (!hasData) return null;

  return (
    <section className="ray-price-dist rail">
      <style>{`
        .ray-price-dist { padding-block: 40px 48px; }
        .ray-price-dist-chart { height: 280px; }
        @media (max-width: 768px) {
          .ray-price-dist { padding-block: 32px 32px; }
          .ray-price-dist-chart { height: 200px; }
        }
      `}</style>

      <div style={{ marginBottom: 20 }}>
        <h2 style={{
          fontFamily: "var(--font-serif), serif",
          fontSize: 32,
          fontWeight: 300,
          letterSpacing: '-0.02em',
        }}>
          Price <span style={{ fontStyle: 'italic', color: 'var(--color-accent-gold)' }}>Distribution</span>
        </h2>
      </div>

      <div className="glass glass-quiet" style={{
        overflow: 'hidden',
        padding: '20px 8px 16px 0',
      }}>
        <div className="ray-price-dist-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: 'var(--color-text-faint)', fontFamily: "var(--font-sans), sans-serif" }}
                axisLine={{ stroke: 'var(--color-border)' }}
                tickLine={false}
                interval={0}
              />
              <YAxis
                tick={{ fontSize: 12, fill: 'var(--color-text-faint)', fontFamily: "var(--font-sans), sans-serif" }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip content={<DistributionTooltip />} cursor={{ fill: 'var(--color-hover-item)' }} />
              <Bar dataKey="count" fill="var(--color-fg)" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
