'use client';

import { useMemo } from 'react';
import { MarketStats, AuctionLot } from '../types';
import type { LotCategory } from '../types';
import { formatPrice, categoryLabels } from '../utils';

type CategoryFilter = 'all' | LotCategory;

interface Props {
  stats: MarketStats;
  lots?: AuctionLot[];
  categoryFilter?: CategoryFilter;
}

export default function StatsGrid({ stats, lots, categoryFilter = 'all' }: Props) {
  const filteredStats = useMemo(() => {
    if (categoryFilter === 'all' || !lots) {
      return {
        avgPrice: stats.avgPriceLast12Months,
        recordPrice: stats.recordPrice,
        recordTitle: stats.recordTitle,
        // UTC getter: date-only strings parse as UTC midnight, so local
        // getFullYear() can report the previous year near Jan 1.
        recordYear: new Date(stats.recordDate).getUTCFullYear(),
        lotsTracked: stats.totalLotsTracked,
      };
    }
    const filtered = lots.filter(l => l.category === categoryFilter);
    const sold = filtered.filter(l => l.status === 'sold' && l.priceUsd);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const recent = sold.filter(l => new Date(l.saleDate) >= oneYearAgo);
    const avgPrice = recent.length
      ? recent.reduce((s, l) => s + (l.priceUsd || 0), 0) / recent.length
      : 0;
    const record = sold.length ? sold.reduce((best, l) => (l.priceUsd || 0) > (best.priceUsd || 0) ? l : best) : null;
    const recordTitle = record?.title || '—';
    return {
      avgPrice,
      recordPrice: record?.priceUsd || 0,
      recordTitle: recordTitle.length > 60 ? recordTitle.substring(0, 57) + '...' : recordTitle,
      recordYear: record ? new Date(record.saleDate).getUTCFullYear() : 0,
      lotsTracked: filtered.length,
    };
  }, [categoryFilter, lots, stats]);

  const catLabel = categoryFilter !== 'all' ? categoryLabels[categoryFilter] : '';

  const sellThrough = useMemo(() => {
    const source = lots || [];
    const filtered = categoryFilter === 'all' ? source : source.filter(l => l.category === categoryFilter);
    const concluded = filtered.filter(l => l.status === 'sold' || l.status === 'bought_in');
    if (concluded.length < 5) return null;
    const sold = concluded.filter(l => l.status === 'sold').length;
    return { rate: Math.round((sold / concluded.length) * 100), total: concluded.length };
  }, [lots, categoryFilter]);

  const cards = [
    {
      label: catLabel ? `Avg. Price — ${catLabel}` : 'Avg. Price (12mo)',
      value: formatPrice(filteredStats.avgPrice),
      sub: `${filteredStats.lotsTracked.toLocaleString()} lots tracked`,
    },
    {
      label: catLabel ? `Record — ${catLabel}` : 'Record Sale',
      value: formatPrice(filteredStats.recordPrice),
      sub: filteredStats.recordYear ? `${filteredStats.recordTitle}, ${filteredStats.recordYear}` : '—',
    },
    {
      label: 'Sell-Through Rate',
      value: sellThrough ? `${sellThrough.rate}%` : '—',
      sub: sellThrough ? `${sellThrough.total.toLocaleString()} lots concluded` : 'Insufficient data',
    },
    {
      label: 'Auction Houses',
      value: `${stats.houseDistribution?.length || 0}`,
      sub: stats.houseDistribution?.map(h => h.house).join(', ') || '—',
    },
  ];

  return (
    <section className="ray-stats rail">
      <style>{`
        .ray-stats { padding-block: 40px; }
        .ray-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }
        .ray-stat-card {
          padding: 28px 28px;
        }
        .ray-stat-value {
          font-family: var(--font-serif), serif;
          font-size: 34px;
          font-weight: 300;
          line-height: 1;
          margin-bottom: 8px;
        }
        @media (max-width: 768px) {
          .ray-stats { padding-block: 32px; }
          .ray-stats-grid {
            grid-template-columns: 1fr 1fr;
          }
          .ray-stat-card { padding: 20px 18px; }
          .ray-stat-value { font-size: 26px; }
        }
      `}</style>

      <div className="ray-stats-grid">
        {cards.map((card) => (
          <div key={card.label} className="ray-stat-card glass glass-quiet">
            <div style={{
              fontSize: 12,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--color-text-muted)',
              fontWeight: 600,
              marginBottom: 14,
            }}>
              {card.label}
            </div>
            <div className="ray-stat-value" style={{
              color: 'var(--color-fg)',
            }}>
              {card.value}
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--color-text-muted)',
              fontWeight: 400,
              lineHeight: 1.4,
            }}>
              {card.sub}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
