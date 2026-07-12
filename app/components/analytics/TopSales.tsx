'use client';

import { useMemo } from 'react';
import { AuctionLot } from '../../types';
import { formatDate, formatPrice, houseColors } from '../../utils';
import { ARTIST_LABEL } from '../../constants';

interface Props {
  allLots: AuctionLot[];
}

export default function TopSales({ allLots }: Props) {
  const topSales = useMemo(() => {
    return allLots
      .filter(l => l.status === 'sold' && l.priceUsd)
      .sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0))
      .slice(0, 20);
  }, [allLots]);

  if (topSales.length === 0) return null;

  return (
    <section className="ray-top-sales rail">
      <style>{`
        .ray-top-sales { padding-block: 40px 48px; }
        .ray-top-row {
          transition: background var(--duration-fast) var(--ease-signature);
        }
        .ray-top-row:hover {
          background: var(--color-hover-item);
        }
        .ray-top-td {
          padding: 14px 16px;
          font-size: 13px;
          border-bottom: 1px solid var(--color-border);
          vertical-align: middle;
        }
        @media (max-width: 768px) {
          .ray-top-sales { padding-block: 32px 32px; }
          .ray-top-hide-mobile { display: none; }
          .ray-top-td { padding: 12px 12px; font-size: 12px; }
        }
      `}</style>

      <div style={{ marginBottom: 20 }}>
        <h2 style={{
          fontFamily: "var(--font-serif), serif",
          fontSize: 32,
          fontWeight: 300,
          letterSpacing: '-0.02em',
        }}>
          Top <span style={{ fontStyle: 'italic', color: 'var(--color-accent-gold)' }}>Sales</span>
        </h2>
      </div>

      {/* Glass frame; the table keeps its natural min width and scrolls
          inside the inner wrapper instead of widening the page. */}
      <div className="glass glass-quiet" style={{ overflow: 'hidden' }}>
        <div style={{
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 500 }}>
          <thead>
            <tr>
              <th style={{
                fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--color-text-faint)', fontWeight: 600,
                padding: '14px 16px 10px', textAlign: 'left', width: 40,
                borderBottom: '1px solid var(--color-border)',
              }}>
                #
              </th>
              <th style={{
                fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--color-text-faint)', fontWeight: 600,
                padding: '14px 16px 10px', textAlign: 'left',
                borderBottom: '1px solid var(--color-border)',
              }}>
                Lot
              </th>
              <th style={{
                fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--color-text-faint)', fontWeight: 600,
                padding: '14px 16px 10px', textAlign: 'right',
                borderBottom: '1px solid var(--color-border)',
              }}>
                Price
              </th>
              <th style={{
                fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--color-text-faint)', fontWeight: 600,
                padding: '14px 16px 10px', textAlign: 'right',
                borderBottom: '1px solid var(--color-border)',
              }}>
                % Over Est.
              </th>
              <th className="ray-top-hide-mobile" style={{
                fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--color-text-faint)', fontWeight: 600,
                padding: '14px 16px 10px', textAlign: 'left',
                borderBottom: '1px solid var(--color-border)',
              }}>
                House
              </th>
              <th className="ray-top-hide-mobile" style={{
                fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--color-text-faint)', fontWeight: 600,
                padding: '14px 16px 10px', textAlign: 'right',
                borderBottom: '1px solid var(--color-border)',
              }}>
                Date
              </th>
            </tr>
          </thead>
          <tbody>
            {topSales.map((lot, i) => {
              const title = lot.title.length > 50 ? lot.title.substring(0, 47) + '...' : lot.title;
              const hasEstimate = lot.estimateHigh && lot.estimateHigh > 0 && lot.priceUsd;
              const overEst = hasEstimate
                ? ((lot.priceUsd! - lot.estimateHigh!) / lot.estimateHigh!) * 100
                : null;
              return (
                <tr key={lot.id} className="ray-top-row">
                  {/* Rank 1 is the single wine record marker for this view */}
                  <td className="ray-top-td" style={{
                    fontFamily: "var(--font-serif), serif",
                    fontSize: 20,
                    fontWeight: 300,
                    color: i === 0 ? 'var(--color-accent-wine-text)' : 'var(--color-text-faint)',
                  }}>
                    {i + 1}
                  </td>
                  <td className="ray-top-td">
                    <div style={{
                      fontSize: 12,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-muted)',
                      fontWeight: 600,
                      marginBottom: 3,
                    }}>
                      {ARTIST_LABEL[lot.artist] || lot.artist}
                    </div>
                    <a
                      href={lot.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontFamily: "var(--font-serif), serif",
                        fontSize: 17,
                        fontWeight: 400,
                        color: 'var(--color-fg)',
                        textDecoration: 'none',
                        lineHeight: 1.3,
                        transition: 'color var(--duration-fast) var(--ease-signature)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-gold)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-fg)')}
                    >
                      {title}
                    </a>
                  </td>
                  <td className="ray-top-td" style={{
                    textAlign: 'right',
                    fontWeight: 500,
                    fontSize: 15,
                    color: 'var(--color-fg)',
                    whiteSpace: 'nowrap',
                  }}>
                    {formatPrice(lot.priceUsd || 0)}
                  </td>
                  <td className="ray-top-td" style={{
                    textAlign: 'right',
                    fontWeight: 500,
                    fontSize: 13,
                    whiteSpace: 'nowrap',
                    color: overEst === null
                      ? 'var(--color-text-muted)'
                      : 'var(--color-text-secondary)',
                  }}>
                    {overEst === null
                      ? '\u2014'
                      : `${overEst >= 0 ? '+' : ''}${overEst.toFixed(0)}%`}
                  </td>
                  <td className="ray-top-td ray-top-hide-mobile">
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: houseColors[lot.auctionHouse] || 'var(--color-text-muted)',
                      fontWeight: 500,
                    }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: houseColors[lot.auctionHouse] || 'var(--color-text-muted)',
                        opacity: 0.7, flexShrink: 0,
                      }} />
                      {lot.auctionHouse}
                    </span>
                  </td>
                  <td className="ray-top-td ray-top-hide-mobile" style={{
                    textAlign: 'right',
                    fontSize: 12,
                    color: 'var(--color-text-faint)',
                    whiteSpace: 'nowrap',
                  }}>
                    {formatDate(lot.saleDate, { month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}
