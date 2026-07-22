'use client';

import { useMemo, useState } from 'react';
import { AuctionLot, TopSaleRow } from '../../types';
import { formatDate, formatPrice, houseColors, craftTitle, overEstimatePct, toneOf, fmtSignedPct } from '../../utils';
import { ARTIST_LABEL, Market } from '../../constants';
import type { MarketSeriesJson } from '../../hooks/useRayData';

interface Props {
  allLots: AuctionLot[];
  market?: Market;
  series?: MarketSeriesJson | null;
}

const COLLAPSED_ROWS = 5;

export default function TopSales({ allLots, market, series }: Props) {
  const [expanded, setExpanded] = useState(false);
  // Prefer the build-time top-sales (ranked over the FULL corpus): the loaded
  // `allLots` is a slim/sample slice, so its #1 "record" and ladder can be
  // wrong for any vertical whose true top lots weren't shipped (esp. cards).
  const topSales = useMemo<TopSaleRow[]>(() => {
    if (series?.analytics?.topSales?.length) return series.analytics.topSales;
    return allLots
      .filter(l => l.status === 'sold' && l.priceUsd)
      .sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0))
      .slice(0, 20)
      .map(l => ({
        id: String(l.id), artist: l.artist, title: l.title || '', priceUsd: l.priceUsd || 0,
        url: l.url || '', auctionHouse: l.auctionHouse || '', saleDate: l.saleDate || '',
        sport: (l as AuctionLot & { sport?: string }).sport ?? null, overEst: overEstimatePct(l),
      }));
  }, [series, allLots]);

  if (topSales.length === 0) return null;

  const shown = expanded ? topSales : topSales.slice(0, COLLAPSED_ROWS);

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

      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{
          fontFamily: 'var(--font-sans), sans-serif',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: '-0.02em',
        }}>
          Top <span style={{ fontStyle: 'normal', color: 'var(--color-fg)' }}>sales</span>
        </h2>
        <span style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>
          % over est. on hammer basis — buyer&rsquo;s premium divided out
        </span>
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
                fontSize: 12, letterSpacing: '-0.01em', textTransform: 'none',
                color: 'var(--color-text-faint)', fontWeight: 600,
                padding: '14px 16px 10px', textAlign: 'left', width: 40,
                borderBottom: '1px solid var(--color-border)',
              }}>
                #
              </th>
              <th style={{
                fontSize: 12, letterSpacing: '-0.01em', textTransform: 'none',
                color: 'var(--color-text-faint)', fontWeight: 600,
                padding: '14px 16px 10px', textAlign: 'left',
                borderBottom: '1px solid var(--color-border)',
              }}>
                Lot
              </th>
              <th style={{
                fontSize: 12, letterSpacing: '-0.01em', textTransform: 'none',
                color: 'var(--color-text-faint)', fontWeight: 600,
                padding: '14px 16px 10px', textAlign: 'right',
                borderBottom: '1px solid var(--color-border)',
              }}>
                Price
              </th>
              <th style={{
                fontSize: 12, letterSpacing: '-0.01em', textTransform: 'none',
                color: 'var(--color-text-faint)', fontWeight: 600,
                padding: '14px 16px 10px', textAlign: 'right',
                borderBottom: '1px solid var(--color-border)',
              }}>
                % over est.
              </th>
              <th className="ray-top-hide-mobile" style={{
                fontSize: 12, letterSpacing: '-0.01em', textTransform: 'none',
                color: 'var(--color-text-faint)', fontWeight: 600,
                padding: '14px 16px 10px', textAlign: 'left',
                borderBottom: '1px solid var(--color-border)',
              }}>
                House
              </th>
              <th className="ray-top-hide-mobile" style={{
                fontSize: 12, letterSpacing: '-0.01em', textTransform: 'none',
                color: 'var(--color-text-faint)', fontWeight: 600,
                padding: '14px 16px 10px', textAlign: 'right',
                borderBottom: '1px solid var(--color-border)',
              }}>
                Date
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((lot, i) => {
              const ct = craftTitle(lot.title);
              const title = ct.length > 50 ? ct.slice(0, 47) + '…' : ct;
              // precomputed at build (hammer basis, premium divided out;
              // null when the lot carries no estimate)
              const overEst = lot.overEst;
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
                      letterSpacing: '-0.01em',
                      textTransform: 'none',
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
                    color: overEst === null || toneOf(overEst) === 'flat'
                      ? 'var(--color-text-muted)'
                      : toneOf(overEst) === 'up' ? 'var(--color-up)' : 'var(--color-down-text)',
                  }}>
                    {overEst === null
                      ? '\u2014'
                      : fmtSignedPct(overEst)}
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
                    {/* sports market only: which sport the lot belongs to —
                        one muted word, no chip */}
                    {market === 'sports' && lot.sport ? (
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400 }}>
                        {' '}&middot; {lot.sport}
                      </span>
                    ) : null}
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
      {!expanded && topSales.length > COLLAPSED_ROWS && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
          <button
            onClick={() => setExpanded(true)}
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 100,
              padding: '10px 32px',
              fontSize: 12,
              letterSpacing: '-0.01em',
              textTransform: 'none',
              color: 'var(--color-text-muted)',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans), sans-serif',
              transition: 'border-color var(--duration-fast) var(--ease-signature)',
            }}
          >
            Show all {topSales.length}
          </button>
        </div>
      )}
    </section>
  );
}
