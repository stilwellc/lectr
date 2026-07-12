'use client';

import { useMemo } from 'react';
import { MarketStats, AuctionLot } from '../../types';
import { formatPrice } from '../../utils';
import { ARTISTS } from '../../constants';

interface Props {
  statsByArtist: Record<string, MarketStats>;
  allLots: AuctionLot[];
}

export default function PortfolioHeader({ statsByArtist, allLots }: Props) {
  const cards = useMemo(() => {
    const stats = Object.values(statsByArtist);
    const totalRevenue = stats.reduce((sum, s) => sum + (s.totalAuctionRevenue || 0), 0);

    const weightedAppreciation = totalRevenue > 0
      ? stats.reduce((sum, s) =>
          sum + (s.appreciationRate || 0) * (s.totalAuctionRevenue || 0), 0) / totalRevenue
      : 0;

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const recentSold = allLots.filter(l =>
      l.status === 'sold' && l.priceUsd && new Date(l.saleDate) >= oneYearAgo
    );
    const avgPrice12mo = recentSold.length
      ? recentSold.reduce((s, l) => s + (l.priceUsd || 0), 0) / recentSold.length
      : 0;

    const lotsWithEstimate = allLots.filter(l =>
      l.status === 'sold' && l.priceUsd && l.estimateHigh && l.estimateHigh > 0
    );
    const avgOverEstimate = lotsWithEstimate.length
      ? lotsWithEstimate.reduce((s, l) =>
          s + ((l.priceUsd! - l.estimateHigh!) / l.estimateHigh!) * 100, 0) / lotsWithEstimate.length
      : 0;

    return [
      { label: 'Total Sales Value', value: formatPrice(totalRevenue), sub: 'aggregate realized prices, all artists' },
      { label: 'Total Lots', value: allLots.length.toLocaleString(), sub: `${ARTISTS.length} artists tracked` },
      { label: 'Appreciation', value: `${weightedAppreciation >= 0 ? '+' : ''}${weightedAppreciation.toFixed(1)}%`, sub: 'sales-weighted avg across artists' },
      { label: 'Avg. % Over Estimate', value: `${avgOverEstimate >= 0 ? '+' : ''}${avgOverEstimate.toFixed(1)}%`, sub: `${lotsWithEstimate.length.toLocaleString()} lots with estimates` },
    ];
  }, [statsByArtist, allLots]);

  return (
    <section className="ray-portfolio-header rail">
      <style>{`
        .ray-portfolio-header { padding-block: 40px; }
        .ray-portfolio-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }
        .ray-portfolio-card {
          padding: 28px 24px;
          min-width: 0;
        }
        .ray-portfolio-value {
          font-family: var(--font-serif), serif;
          font-size: 34px;
          font-weight: 300;
          color: var(--color-accent-gold);
          line-height: 1.1;
          margin-bottom: 8px;
          overflow-wrap: anywhere;
        }
        @media (max-width: 768px) {
          .ray-portfolio-header { padding-block: 32px; }
          .ray-portfolio-grid { grid-template-columns: 1fr 1fr; }
          .ray-portfolio-card { padding: 20px 18px; }
          .ray-portfolio-value { font-size: 26px; }
        }
        @media (max-width: 480px) {
          /* Big dollar values get cramped in two 150px-wide cells —
             stack the stats in a single column on phones. */
          .ray-portfolio-grid { grid-template-columns: 1fr; }
          .ray-portfolio-value { font-size: 30px; }
        }
      `}</style>

      <div className="ray-portfolio-grid">
        {cards.map((card) => (
          <div key={card.label} className="ray-portfolio-card glass glass-quiet">
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
            <div className="ray-portfolio-value">
              {card.value}
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--color-text-muted)',
              fontWeight: 400,
            }}>
              {card.sub}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
