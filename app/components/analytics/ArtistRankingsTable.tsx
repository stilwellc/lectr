'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { MarketStats, AuctionLot } from '../../types';
import { formatPrice } from '../../utils';
import { demandSeries, formatDemand } from '../../lib/demand';
import { ARTISTS } from '../../constants';

interface Props {
  statsByArtist: Record<string, MarketStats>;
  allLots: AuctionLot[];
}

type SortKey = 'name' | 'totalRevenue' | 'avgPrice' | 'recordPrice' | 'demand' | 'overEstimate' | 'totalLots' | 'sellThrough';

interface ArtistRow {
  slug: string;
  label: string;
  totalRevenue: number;
  avgPrice: number;
  recordPrice: number;
  demand: number;
  overEstimate: number;
  totalLots: number;
  sellThrough: number;
}

export default function ArtistRankingsTable({ statsByArtist, allLots }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('totalRevenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const rows = useMemo<ArtistRow[]>(() => {
    return ARTISTS.map(a => {
      const stats = statsByArtist[a.slug];
      const artistLots = allLots.filter(l => l.artist === a.slug);
      const concluded = artistLots.filter(l => l.status === 'sold' || l.status === 'bought_in');
      const soldCount = concluded.filter(l => l.status === 'sold').length;
      const sellThrough = concluded.length >= 5
        ? Math.round((soldCount / concluded.length) * 100)
        : -1;

      const withEstimate = artistLots.filter(l =>
        l.status === 'sold' && l.priceUsd && l.estimateHigh && l.estimateHigh > 0
      );
      const overEstimate = withEstimate.length >= 3
        ? withEstimate.reduce((s, l) =>
            s + ((l.priceUsd! - l.estimateHigh!) / l.estimateHigh!) * 100, 0) / withEstimate.length
        : -999;

      return {
        slug: a.slug,
        label: a.label,
        totalRevenue: stats?.totalAuctionRevenue || 0,
        avgPrice: stats?.avgPriceLast12Months || 0,
        recordPrice: stats?.recordPrice || 0,
        demand: (() => { const ds = demandSeries(artistLots); return ds.length ? ds[ds.length - 1].value : -9999; })(),
        overEstimate,
        totalLots: artistLots.length,
        sellThrough,
      };
    });
  }, [statsByArtist, allLots]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let cmp: number;
      if (sortKey === 'name') {
        cmp = a.label.localeCompare(b.label);
      } else {
        cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  }

  const thStyle = (key: SortKey, align: 'left' | 'right' = 'right'): React.CSSProperties => ({
    fontSize: 12,
    letterSpacing: '-0.01em',
    textTransform: 'none',
    color: sortKey === key ? 'var(--color-accent-gold)' : 'var(--color-text-faint)',
    fontWeight: 600,
    padding: '14px 16px 10px',
    textAlign: align,
    whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--color-border)',
  });

  // Real buttons inside the th, styled to inherit, so sorting is
  // focusable and keyboard-operable.
  const sortBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    padding: 0,
    margin: 0,
    font: 'inherit',
    color: 'inherit',
    letterSpacing: 'inherit',
    textTransform: 'inherit',
    whiteSpace: 'inherit',
    cursor: 'pointer',
    userSelect: 'none',
  };

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | undefined =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined;

  return (
    <section id="artist-rankings" className="ray-rankings rail">
      <style>{`
        .ray-rankings { padding-block: 40px 48px; }
        .ray-rankings-row {
          transition: background var(--duration-fast) var(--ease-signature);
        }
        .ray-rankings-row:hover {
          background: var(--color-hover-item);
        }
        .ray-rankings-td {
          padding: 12px 16px;
          font-size: 13px;
          border-bottom: 1px solid var(--color-border);
          white-space: nowrap;
        }
        @media (max-width: 768px) {
          .ray-rankings { padding-block: 32px 32px; }
          .ray-rankings-hide-mobile { display: none; }
          .ray-rankings-td { padding: 10px 12px; font-size: 12px; }
        }
      `}</style>

      <div style={{ marginBottom: 20 }}>
        <h2 style={{
          fontFamily: 'var(--font-sans), sans-serif',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: '-0.02em',
        }}>
          Artist <span style={{ fontStyle: 'normal', color: 'var(--color-fg)' }}>Rankings</span>
        </h2>
      </div>

      {/* Glass frame; the table keeps its natural min width and scrolls
          inside the inner wrapper instead of widening the page. */}
      <div className="glass glass-quiet" style={{ overflow: 'hidden' }}>
        <div style={{
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={thStyle('name', 'left')} aria-sort={ariaSort('name')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('name')}>
                  Artist {sortKey === 'name' && (sortDir === 'asc' ? '\u25B2' : '\u25BC')}
                </button>
              </th>
              <th className="ray-rankings-hide-mobile" style={thStyle('totalRevenue')} aria-sort={ariaSort('totalRevenue')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('totalRevenue')}>
                  Sales Value {sortKey === 'totalRevenue' && (sortDir === 'asc' ? '\u25B2' : '\u25BC')}
                </button>
              </th>
              <th style={thStyle('avgPrice')} aria-sort={ariaSort('avgPrice')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('avgPrice')}>
                  Avg (12mo) {sortKey === 'avgPrice' && (sortDir === 'asc' ? '\u25B2' : '\u25BC')}
                </button>
              </th>
              <th className="ray-rankings-hide-mobile" style={thStyle('recordPrice')} aria-sort={ariaSort('recordPrice')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('recordPrice')}>
                  Record {sortKey === 'recordPrice' && (sortDir === 'asc' ? '\u25B2' : '\u25BC')}
                </button>
              </th>
              <th style={thStyle('demand')} aria-sort={ariaSort('demand')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('demand')}>
                  Demand {sortKey === 'demand' && (sortDir === 'asc' ? '\u25B2' : '\u25BC')}
                </button>
              </th>
              <th style={thStyle('overEstimate')} aria-sort={ariaSort('overEstimate')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('overEstimate')}>
                  % Over Est. {sortKey === 'overEstimate' && (sortDir === 'asc' ? '\u25B2' : '\u25BC')}
                </button>
              </th>
              <th style={thStyle('totalLots')} aria-sort={ariaSort('totalLots')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('totalLots')}>
                  Lots {sortKey === 'totalLots' && (sortDir === 'asc' ? '\u25B2' : '\u25BC')}
                </button>
              </th>
              <th className="ray-rankings-hide-mobile" style={thStyle('sellThrough')} aria-sort={ariaSort('sellThrough')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('sellThrough')}>
                  Sell-Through {sortKey === 'sellThrough' && (sortDir === 'asc' ? '\u25B2' : '\u25BC')}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.slug} className="ray-rankings-row">
                <td className="ray-rankings-td" style={{ fontWeight: 500 }}>
                  <Link
                    href={`/${row.slug}`}
                    style={{
                      textDecoration: 'none',
                      color: 'var(--color-fg)',
                      transition: 'color var(--duration-fast) var(--ease-signature)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-gold)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-fg)')}
                  >
                    {row.label}
                  </Link>
                </td>
                <td className="ray-rankings-td ray-rankings-hide-mobile" style={{ textAlign: 'right', color: 'var(--color-fg)' }}>
                  {formatPrice(row.totalRevenue)}
                </td>
                <td className="ray-rankings-td" style={{ textAlign: 'right', color: 'var(--color-fg)' }}>
                  {row.avgPrice > 0 ? formatPrice(row.avgPrice) : '\u2014'}
                </td>
                <td className="ray-rankings-td ray-rankings-hide-mobile" style={{ textAlign: 'right' }}>
                  {row.recordPrice > 0 ? formatPrice(row.recordPrice) : '\u2014'}
                </td>
                <td className="ray-rankings-td" style={{
                  textAlign: 'right',
                  fontWeight: 500,
                  color: row.demand <= -9999
                    ? 'var(--color-text-muted)'
                    : row.demand >= 0 ? 'var(--color-up)' : 'var(--color-down)',
                }}>
                  {row.demand <= -9999 ? '\u2014' : formatDemand(row.demand)}
                </td>
                <td className="ray-rankings-td" style={{
                  textAlign: 'right',
                  fontWeight: 500,
                  color: row.overEstimate <= -999
                    ? 'var(--color-text-muted)'
                    : row.overEstimate >= 0 ? 'var(--color-up)' : 'var(--color-down)',
                }}>
                  {row.overEstimate <= -999 ? '\u2014' : `${row.overEstimate >= 0 ? '+' : ''}${row.overEstimate.toFixed(1)}%`}
                </td>
                <td className="ray-rankings-td" style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>
                  {row.totalLots.toLocaleString()}
                </td>
                <td className="ray-rankings-td ray-rankings-hide-mobile" style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>
                  {row.sellThrough >= 0 ? `${row.sellThrough}%` : '\u2014'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}
