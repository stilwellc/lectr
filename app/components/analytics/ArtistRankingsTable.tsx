'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { MarketStats, AuctionLot } from '../../types';
import { formatPrice, fmtSignedPct, toneOf, overEstimatePct } from '../../utils';
import { demandSeries, formatDemand } from '../../lib/demand';
import ArtistAvatar from '../ArtistAvatar';
import Flick from '../Flick';
import { ARTISTS, marketArtists, Market } from '../../constants';

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

export default function ArtistRankingsTable({ statsByArtist, allLots, market }: Props & { market?: Market }) {
  const [sortKey, setSortKey] = useState<SortKey>('totalRevenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const rows = useMemo<ArtistRow[]>(() => {
    const roster = market ? ARTISTS.filter(a => marketArtists(market).has(a.slug)) : ARTISTS;
    return roster.map(a => {
      const stats = statsByArtist[a.slug];
      const artistLots = allLots.filter(l => l.artist === a.slug);
      const concluded = artistLots.filter(l => l.status === 'sold' || l.status === 'bought_in');
      const soldCount = concluded.filter(l => l.status === 'sold').length;
      const sellThrough = concluded.length >= 5
        ? Math.round((soldCount / concluded.length) * 100)
        : -1;

      // hammer basis: overEstimatePct divides the buyer's premium out before
      // comparing to the (hammer-basis) estimate mid — median over the
      // maker's sold lots that carry estimates.
      const overPcts = artistLots
        .filter(l => l.status === 'sold')
        .map(l => overEstimatePct(l))
        .filter((v): v is number => v != null)
        .sort((x, y) => x - y);
      const overEstimate = overPcts.length >= 3
        ? (overPcts.length % 2
            ? overPcts[(overPcts.length - 1) / 2]
            : (overPcts[overPcts.length / 2 - 1] + overPcts[overPcts.length / 2]) / 2)
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
  }, [statsByArtist, allLots, market]);

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

  // active sort wears BEIGE (neutral accent) — gold stays brand-only
  const thStyle = (key: SortKey, align: 'left' | 'right' = 'right'): React.CSSProperties => ({
    fontSize: 12,
    letterSpacing: '-0.01em',
    textTransform: 'none',
    color: sortKey === key ? 'var(--color-beige-text)' : 'var(--color-text-faint)',
    fontWeight: 600,
    padding: '14px 16px 10px',
    textAlign: align,
    whiteSpace: 'nowrap',
    borderBottom: sortKey === key ? '2px solid var(--color-beige)' : '1px solid var(--color-border)',
  });

  // sort-direction glyph: the Flick, not a dingbat triangle — up = asc,
  // flipped for desc
  const sortGlyph = (key: SortKey) =>
    sortKey === key
      ? <Flick size={10} style={sortDir === 'desc' ? { transform: 'scaleY(-1)' } : undefined} />
      : null;

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
        /* the maker column stays pinned while the table scrolls sideways so
           rows remain identifiable — solid ground + a right hairline seam */
        .ray-rankings-sticky {
          position: sticky;
          left: 0;
          z-index: 2;
          background: var(--color-bg-elevated);
          border-right: 1px solid var(--color-border);
        }
        @media (max-width: 768px) {
          .ray-rankings { padding-block: 32px 32px; }
          .ray-rankings-hide-mobile { display: none; }
          .ray-rankings-td { padding: 10px 12px; font-size: 12px; }
        }
      `}</style>

      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <h2 style={{
          fontFamily: 'var(--font-sans), sans-serif',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: '-0.02em',
        }}>
          Maker <span style={{ fontStyle: 'normal', color: 'var(--color-fg)' }}>rankings</span>
        </h2>
        {/* rank-and-slice is this table's job; the roster itself lives on /artists */}
        <Link
          href="/artists"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-text-muted)',
            textDecoration: 'none',
            transition: 'color var(--duration-fast) var(--ease-signature)',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-fg)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
        >
          The roster <Flick size={14} />
        </Link>
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
              <th className="ray-rankings-sticky" style={thStyle('name', 'left')} aria-sort={ariaSort('name')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('name')}>
                  Maker {sortGlyph('name')}
                </button>
              </th>
              <th style={thStyle('totalRevenue')} aria-sort={ariaSort('totalRevenue')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('totalRevenue')}>
                  Sales value {sortGlyph('totalRevenue')}
                </button>
              </th>
              <th style={thStyle('avgPrice')} aria-sort={ariaSort('avgPrice')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('avgPrice')}>
                  Avg (12mo) {sortGlyph('avgPrice')}
                </button>
              </th>
              <th className="ray-rankings-hide-mobile" style={thStyle('recordPrice')} aria-sort={ariaSort('recordPrice')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('recordPrice')}>
                  Record {sortGlyph('recordPrice')}
                </button>
              </th>
              <th style={thStyle('demand')} aria-sort={ariaSort('demand')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('demand')}>
                  Demand {sortGlyph('demand')}
                </button>
              </th>
              <th style={thStyle('overEstimate')} aria-sort={ariaSort('overEstimate')} title="Hammer basis \u2014 buyer's premium divided out; median across the maker's sold lots with estimates">
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('overEstimate')}>
                  % over est. {sortGlyph('overEstimate')}
                </button>
              </th>
              <th style={thStyle('totalLots')} aria-sort={ariaSort('totalLots')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('totalLots')}>
                  Lots {sortGlyph('totalLots')}
                </button>
              </th>
              <th className="ray-rankings-hide-mobile" style={thStyle('sellThrough')} aria-sort={ariaSort('sellThrough')}>
                <button type="button" style={sortBtnStyle} onClick={() => handleSort('sellThrough')}>
                  Sell-through {sortGlyph('sellThrough')}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.slug} className="ray-rankings-row">
                <td className="ray-rankings-td ray-rankings-sticky" style={{ fontWeight: 500 }}>
                  <Link
                    href={`/${row.slug}`}
                    style={{
                      textDecoration: 'none',
                      color: 'var(--color-fg)',
                      transition: 'color var(--duration-fast) var(--ease-signature)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-accent-gold)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-fg)')}
                  >
                    <ArtistAvatar label={row.label} size={24} />
                    {row.label}
                  </Link>
                </td>
                <td className="ray-rankings-td" style={{ textAlign: 'right', color: 'var(--color-fg)' }}>
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
                  color: row.demand <= -9999 || toneOf(row.demand) === 'flat'
                    ? 'var(--color-text-muted)'
                    : toneOf(row.demand) === 'up' ? 'var(--color-up)' : 'var(--color-down)',
                }}>
                  {row.demand <= -9999 ? '\u2014' : formatDemand(row.demand)}
                </td>
                <td className="ray-rankings-td" style={{
                  textAlign: 'right',
                  fontWeight: 500,
                  color: row.overEstimate <= -999 || toneOf(row.overEstimate) === 'flat'
                    ? 'var(--color-text-muted)'
                    : toneOf(row.overEstimate) === 'up' ? 'var(--color-up)' : 'var(--color-down)',
                }}>
                  {row.overEstimate <= -999 ? '\u2014' : fmtSignedPct(row.overEstimate, 1)}
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
      <p style={{ marginTop: 10, fontSize: 11.5, color: 'var(--color-text-faint)' }}>
        % over est. is hammer basis — the buyer&rsquo;s premium is divided out before comparing to the estimate mid; median across each maker&rsquo;s sold lots with estimates.
      </p>
    </section>
  );
}
