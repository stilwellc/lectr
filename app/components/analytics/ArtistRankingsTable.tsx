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

type SortKey = 'name' | 'totalRevenue' | 'avgPrice' | 'recordPrice' | 'demand' | 'overEstimate' | 'totalLots' | 'sellThrough' | 'medianSale' | 'movement' | 'soldLots';

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

/* Realized-only row for the bid market (sports). Goldin publishes no
   estimates, so the vs-estimate columns (demand, % over est.) and the
   sell-through read (a no-reserve market concludes every lot sold — a
   constant 100% is a fake figure) never render here. Both lenses — by
   sport and by collection — share this column set. */
interface BidRow {
  key: string;
  label: string;
  href: string | null;
  totalRevenue: number;
  medianSale: number;   // 0 = window too thin
  recordPrice: number;
  movement: number;     // -9999 = window too thin
  soldLots: number;
  pinLast: boolean;     // 'Other' stays last regardless of sort
}

type BidSortKey = 'name' | 'totalRevenue' | 'medianSale' | 'recordPrice' | 'movement' | 'soldLots';
const BID_SORT_KEYS: readonly BidSortKey[] = ['name', 'totalRevenue', 'medianSale', 'recordPrice', 'movement', 'soldLots'];
const ARTIST_SORT_KEYS: readonly SortKey[] = ['name', 'totalRevenue', 'avgPrice', 'recordPrice', 'demand', 'overEstimate', 'totalLots', 'sellThrough'];

const COLLAPSED_ROWS = 10;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function medianOf(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default function ArtistRankingsTable({ statsByArtist, allLots, market }: Props & { market?: Market }) {
  const [sortKey, setSortKey] = useState<SortKey>('totalRevenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expanded, setExpanded] = useState(false);
  // sports lens: rank the market by sport (default) or by the three
  // collections. Only the bid market carries the toggle.
  const isBid = market === 'sports';
  const [lens, setLens] = useState<'sport' | 'collection'>('sport');

  const rows = useMemo<ArtistRow[]>(() => {
    if (isBid) return []; // the bid market renders bidRows instead
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
        totalLots: stats?.totalLotsTracked ?? artistLots.length, // full corpus, not the loaded sample
        sellThrough,
      };
    });
  }, [statsByArtist, allLots, market, isBid]);

  // bid-market rows: the same realized computation grouped on `sport`
  // (lens = by sport) or on the collection slug (lens = by collection)
  const bidRows = useMemo<BidRow[]>(() => {
    if (!isBid) return [];
    // BY COLLECTION (slug): read the authoritative full-corpus stats.json row
    // per slug — the loaded `allLots` is the ~38k sold-archive SAMPLE, so
    // summing it undercounts the 433k-sold verticals (cards showed a fraction
    // of their real $612M revenue / $2.93M record).
    if (lens === 'collection') {
      const roster = ARTISTS.filter(a => marketArtists('sports').has(a.slug));
      return roster.map(a => {
        const st = statsByArtist[a.slug];
        return {
          key: a.slug,
          label: a.label,
          href: `/makers/${a.slug}`,
          pinLast: false,
          totalRevenue: st?.totalAuctionRevenue || 0,
          medianSale: st?.medianPriceLast12Months || 0,
          recordPrice: st?.recordPrice || 0,
          movement: st && st.appreciationRate != null ? st.appreciationRate : -9999,
          soldLots: st?.totalLotsTracked || 0,
        };
      });
    }
    // BY SPORT: no per-sport stats row exists, so this view still aggregates
    // the loaded lots (a sample). It's a secondary lens; the collection view
    // above is the authoritative one.
    const now = Date.now();
    const groups = new Map<string, { label: string; href: string | null; pinLast: boolean; sales: { t: number; p: number }[] }>();
    for (const l of allLots) {
      if (l.status !== 'sold' || !l.priceUsd) continue;
      const key = l.sport ?? 'Other'; // this branch is the by-sport lens only
      let g = groups.get(key);
      if (!g) {
        g = { label: key, href: null, pinLast: key === 'Other', sales: [] };
        groups.set(key, g);
      }
      const t = new Date(l.saleDate).getTime();
      if (isNaN(t)) continue;
      g.sales.push({ t, p: l.priceUsd });
    }
    return Array.from(groups.entries()).map(([key, g]) => {
      let totalRevenue = 0;
      let recordPrice = 0;
      for (const s of g.sales) { totalRevenue += s.p; if (s.p > recordPrice) recordPrice = s.p; }
      const last12 = g.sales.filter(s => s.t >= now - YEAR_MS).map(s => s.p);
      const prior12 = g.sales.filter(s => s.t < now - YEAR_MS && s.t >= now - 2 * YEAR_MS).map(s => s.p);
      const med12 = medianOf(last12);
      const medPrior = medianOf(prior12);
      return {
        key,
        label: g.label,
        href: g.href,
        pinLast: g.pinLast,
        totalRevenue,
        medianSale: last12.length >= 3 ? med12 : 0,
        recordPrice,
        movement: last12.length >= 5 && prior12.length >= 5 && medPrior > 0
          ? (med12 / medPrior - 1) * 100
          : -9999,
        soldLots: g.sales.length,
      };
    });
  }, [isBid, lens, allLots, statsByArtist]);

  const sorted = useMemo(() => {
    const key = ARTIST_SORT_KEYS.includes(sortKey) ? sortKey : 'totalRevenue';
    return [...rows].sort((a, b) => {
      let cmp: number;
      if (key === 'name') {
        cmp = a.label.localeCompare(b.label);
      } else {
        cmp = (a[key as keyof ArtistRow] as number) - (b[key as keyof ArtistRow] as number);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  const sortedBid = useMemo(() => {
    const key: BidSortKey = (BID_SORT_KEYS as readonly SortKey[]).includes(sortKey) ? sortKey as BidSortKey : 'totalRevenue';
    const s = [...bidRows].sort((a, b) => {
      const cmp = key === 'name'
        ? a.label.localeCompare(b.label)
        : (a[key] as number) - (b[key] as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    // Other = the unattributed remainder — pinned last, never ranked
    return [...s.filter(r => !r.pinLast), ...s.filter(r => r.pinLast)];
  }, [bidRows, sortKey, sortDir]);

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
    fontSize: 12.5,
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

  const sortTh = (key: SortKey, label: string, opts?: { align?: 'left' | 'right'; hideMobile?: boolean; sticky?: boolean; title?: string }) => (
    <th
      className={[opts?.hideMobile ? 'ray-rankings-hide-mobile' : '', opts?.sticky ? 'ray-rankings-sticky' : ''].filter(Boolean).join(' ') || undefined}
      style={thStyle(key, opts?.align)}
      aria-sort={ariaSort(key)}
      title={opts?.title}
    >
      <button type="button" style={sortBtnStyle} onClick={() => handleSort(key)}>
        {label} {sortGlyph(key)}
      </button>
    </th>
  );

  const shownRows = isBid ? sortedBid : sorted;
  const rowNoun = isBid && lens === 'sport' ? 'sports' : 'makers';

  return (
    <section id="artist-rankings" className="ray-rankings rail">
      <style>{`
        .ray-rankings { padding-block: var(--sect-t) var(--sect-b); }
        .ray-rankings-row {
          transition: background var(--duration-fast) var(--ease-signature);
        }
        .ray-rankings-row:hover {
          background: var(--color-hover-item);
        }
        .ray-rankings-td {
          padding: 12px 16px;
          font-size: 13.5px;
          border-bottom: 1px solid var(--color-border);
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
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
        /* the sports lens pills — same seg language as the Distributions tabs.
           Quote-free selector on purpose - quotes in server-rendered style
           text get HTML-escaped and break hydration. */
        .ray-rankings-lens {
          font-family: var(--font-sans), sans-serif;
          font-size: 12.5px;
          font-weight: 600;
          letter-spacing: -0.01em;
          padding: 6px 16px;
          border-radius: 100px;
          border: 1px solid var(--color-border);
          background: transparent;
          color: var(--color-text-muted);
          cursor: pointer;
          transition: border-color var(--duration-fast) var(--ease-signature), color var(--duration-fast) var(--ease-signature), background var(--duration-fast) var(--ease-signature);
        }
        .ray-rankings-lens:hover {
          border-color: var(--color-border-mid);
          color: var(--color-fg);
        }
        .ray-rankings-lens[data-active=true] {
          background: var(--color-fg);
          border-color: var(--color-fg);
          color: var(--color-bg);
        }
        @media (max-width: 768px) {
          .ray-rankings { padding-block: var(--sect-t) var(--sect-b); }
          .ray-rankings-hide-mobile { display: none; }
          .ray-rankings-td { padding: 10px 12px; font-size: 12.5px; }
        }
        /* ── PHONE COMPOSITION (≤768px) ───────────────────────────────
           The table is a desktop instrument — on phones its minWidth-600
           scroll trap clipped headers mid-word. Below 768px the table
           yields to ranked card rows: rank · maker · sales value +
           movement pill. Both live in the DOM; the media query picks. */
        .ray-rankings-cards { display: none; }
        .ray-rankings-card {
          display: grid;
          grid-template-columns: 28px minmax(0, 1fr) auto;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 12px 14px;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--color-border);
          text-decoration: none;
          color: var(--color-fg);
          font-family: var(--font-sans), sans-serif;
          text-align: left;
          transition: background var(--duration-fast) var(--ease-signature);
        }
        .ray-rankings-card:last-child { border-bottom: none; }
        .ray-rankings-card:active { background: var(--color-hover-item); }
        .ray-rankings-card-rank {
          font-family: var(--font-mono), monospace;
          font-size: 11.5px;
          font-variant-numeric: tabular-nums;
          color: var(--color-text-faint);
        }
        .ray-rankings-card-name {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.01em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ray-rankings-card-metric {
          font-family: var(--font-mono), monospace;
          font-size: 13.5px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          color: var(--color-fg);
          text-align: right;
          white-space: nowrap;
        }
        .ray-rankings-card-trend {
          display: block;
          margin-top: 2px;
          font-size: 11.5px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        @media (max-width: 768px) {
          .ray-rankings-scroll { display: none; }
          .ray-rankings-cards { display: block; }
        }
      `}</style>

      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        {/* sans section head — serif stays reserved for masthead titles and
            "On the block" heads; matches TopSales/Distributions/Calibration */}
        <h2 style={{
          fontFamily: 'var(--font-sans), sans-serif',
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: '-0.02em',
        }}>
          Maker <span style={{ fontStyle: 'normal', color: 'var(--color-fg)' }}>rankings</span>
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {isBid && (
            <div style={{ display: 'flex', gap: 6 }} role="tablist" aria-label="Rankings lens">
              {([['sport', 'By sport'], ['collection', 'By collection']] as const).map(([k, label]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={lens === k}
                  className="ray-rankings-lens"
                  data-active={lens === k ? 'true' : 'false'}
                  onClick={() => setLens(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {/* rank-and-slice is this table's job; the roster itself lives on /makers */}
          <Link
            href="/makers"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 13.5,
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
      </div>

      {/* Glass frame; the table keeps its natural min width and scrolls
          inside the inner wrapper instead of widening the page. On ≤768px
          the CSS swaps the whole scroll wrapper for the card list below. */}
      <div className="glass glass-quiet" style={{ overflow: 'hidden' }}>
        <div className="ray-rankings-scroll" style={{
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}>
        {isBid ? (
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 600 }}>
            <thead>
              <tr>
                {sortTh('name', lens === 'sport' ? 'Sport' : 'Maker', { align: 'left', sticky: true })}
                {sortTh('totalRevenue', 'Sales value')}
                {sortTh('medianSale', 'Median sale (12mo)')}
                {sortTh('recordPrice', 'Record', { hideMobile: true })}
                {/* Named per lens — the lenses compute DIFFERENT things and the
                    caption must match the actual source (the collection lens
                    reads stats.appreciationRate, not a 12-mo median compare).
                    Both are descriptive: plain ink in the cells — a shift in
                    what sold is not appreciation (PlayerPage's rule), and
                    green here would claim it is. */}
                {lens === 'sport'
                  ? sortTh('movement', '12-mo median shift', { title: 'Median sale price, trailing year vs the year before, over the loaded sample — a mix-sensitive descriptive shift, not appreciation' })
                  : sortTh('movement', 'Value trend · est.', { title: 'Coarse annualized appreciation estimate from median realized prices — descriptive, not a verified index read' })}
                {sortTh('soldLots', 'Sold lots')}
              </tr>
            </thead>
            <tbody>
              {(expanded ? sortedBid : sortedBid.slice(0, COLLAPSED_ROWS)).map((row) => (
                <tr key={row.key} className="ray-rankings-row">
                  <td className="ray-rankings-td ray-rankings-sticky" style={{ fontWeight: 500 }}>
                    {row.href ? (
                      <Link
                        href={row.href}
                        className="ray-maker-link"
                      >
                        <ArtistAvatar label={row.label} size={24} />
                        {row.label}
                      </Link>
                    ) : (
                      // sport rows are not links — no sport pages exist
                      <span style={{ color: row.pinLast ? 'var(--color-text-muted)' : 'var(--color-fg)' }}>{row.label}</span>
                    )}
                  </td>
                  <td className="ray-rankings-td" style={{ textAlign: 'right', color: 'var(--color-fg)' }}>
                    {row.totalRevenue > 0 ? formatPrice(row.totalRevenue) : '—'}
                  </td>
                  <td className="ray-rankings-td" style={{ textAlign: 'right', color: 'var(--color-fg)' }}>
                    {row.medianSale > 0 ? formatPrice(row.medianSale) : '—'}
                  </td>
                  <td className="ray-rankings-td ray-rankings-hide-mobile" style={{ textAlign: 'right' }}>
                    {row.recordPrice > 0 ? formatPrice(row.recordPrice) : '—'}
                  </td>
                  <td className="ray-rankings-td" style={{
                    textAlign: 'right',
                    fontWeight: 500,
                    // plain ink — descriptive shift (see the column caption),
                    // never the measured-delta green/red
                    color: 'var(--color-text-muted)',
                  }}>
                    {row.movement <= -9999 ? '—' : fmtSignedPct(row.movement)}
                  </td>
                  <td className="ray-rankings-td" style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>
                    {row.soldLots.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 600 }}>
          <thead>
            <tr>
              {sortTh('name', 'Maker', { align: 'left', sticky: true })}
              {sortTh('totalRevenue', 'Sales value')}
              {sortTh('avgPrice', 'Avg (12mo)')}
              {sortTh('recordPrice', 'Record', { hideMobile: true })}
              {sortTh('demand', 'Demand')}
              {sortTh('overEstimate', '% over est.', { title: "Hammer basis — buyer's premium divided out; median across the maker's sold lots with estimates" })}
              {sortTh('totalLots', 'Lots')}
              {sortTh('sellThrough', 'Sell-through', { hideMobile: true })}
            </tr>
          </thead>
          <tbody>
            {(expanded ? sorted : sorted.slice(0, COLLAPSED_ROWS)).map((row) => (
              <tr key={row.slug} className="ray-rankings-row">
                <td className="ray-rankings-td ray-rankings-sticky" style={{ fontWeight: 500 }}>
                  <Link href={`/makers/${row.slug}`} className="ray-maker-link">
                    <ArtistAvatar label={row.label} size={24} />
                    {row.label}
                  </Link>
                </td>
                <td className="ray-rankings-td" style={{ textAlign: 'right', color: 'var(--color-fg)' }}>
                  {formatPrice(row.totalRevenue)}
                </td>
                <td className="ray-rankings-td" style={{ textAlign: 'right', color: 'var(--color-fg)' }}>
                  {row.avgPrice > 0 ? formatPrice(row.avgPrice) : '—'}
                </td>
                <td className="ray-rankings-td ray-rankings-hide-mobile" style={{ textAlign: 'right' }}>
                  {row.recordPrice > 0 ? formatPrice(row.recordPrice) : '—'}
                </td>
                <td className="ray-rankings-td" style={{
                  textAlign: 'right',
                  fontWeight: 500,
                  color: row.demand <= -9999 || toneOf(row.demand) === 'flat'
                    ? 'var(--color-text-muted)'
                    : toneOf(row.demand) === 'up' ? 'var(--color-up)' : 'var(--color-down)',
                }}>
                  {row.demand <= -9999 ? '—' : formatDemand(row.demand)}
                </td>
                <td className="ray-rankings-td" style={{
                  textAlign: 'right',
                  fontWeight: 500,
                  color: row.overEstimate <= -999 || toneOf(row.overEstimate) === 'flat'
                    ? 'var(--color-text-muted)'
                    : toneOf(row.overEstimate) === 'up' ? 'var(--color-up)' : 'var(--color-down)',
                }}>
                  {row.overEstimate <= -999 ? '—' : fmtSignedPct(row.overEstimate, 1)}
                </td>
                <td className="ray-rankings-td" style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>
                  {row.totalLots.toLocaleString()}
                </td>
                <td className="ray-rankings-td ray-rankings-hide-mobile" style={{ textAlign: 'right', color: 'var(--color-text-muted)' }}>
                  {row.sellThrough >= 0 ? `${row.sellThrough}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        </div>

        {/* Ranked card rows — the phone reading of the same sort. One
            headline metric (sales value) + the movement read; tap goes to
            the maker page. Sport rows have no page, so they stay inert. */}
        <div className="ray-rankings-cards">
          {isBid
            ? (expanded ? sortedBid : sortedBid.slice(0, COLLAPSED_ROWS)).map((row, i) => {
                const inner = (
                  <>
                    <span className="ray-rankings-card-rank">{row.pinLast ? '—' : String(i + 1).padStart(2, '0')}</span>
                    <span className="ray-rankings-card-name" style={row.pinLast ? { color: 'var(--color-text-muted)' } : undefined}>
                      {row.href && <ArtistAvatar label={row.label} size={24} />}
                      {row.label}
                    </span>
                    <span className="ray-rankings-card-metric">
                      {row.totalRevenue > 0 ? formatPrice(row.totalRevenue) : '—'}
                      <span className="ray-rankings-card-trend" style={{
                        // plain ink — descriptive shift, see the column caption
                        color: 'var(--color-text-muted)',
                      }}>
                        {row.movement <= -9999 ? '— 12 mo' : `${fmtSignedPct(row.movement)} 12 mo`}
                      </span>
                    </span>
                  </>
                );
                return row.href ? (
                  <Link key={row.key} href={row.href} className="ray-rankings-card">{inner}</Link>
                ) : (
                  <div key={row.key} className="ray-rankings-card">{inner}</div>
                );
              })
            : (expanded ? sorted : sorted.slice(0, COLLAPSED_ROWS)).map((row, i) => (
                <Link key={row.slug} href={`/makers/${row.slug}`} className="ray-rankings-card">
                  <span className="ray-rankings-card-rank">{String(i + 1).padStart(2, '0')}</span>
                  <span className="ray-rankings-card-name">
                    <ArtistAvatar label={row.label} size={24} />
                    {row.label}
                  </span>
                  <span className="ray-rankings-card-metric">
                    {formatPrice(row.totalRevenue)}
                    <span className="ray-rankings-card-trend" style={{
                      color: row.demand <= -9999 || toneOf(row.demand) === 'flat'
                        ? 'var(--color-text-muted)'
                        : toneOf(row.demand) === 'up' ? 'var(--color-up)' : 'var(--color-down)',
                    }}>
                      {row.demand <= -9999 ? '— demand' : `${formatDemand(row.demand)} demand`}
                    </span>
                  </span>
                </Link>
              ))}
        </div>
      </div>
      {!expanded && shownRows.length > COLLAPSED_ROWS && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
          <button
            onClick={() => setExpanded(true)}
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 100,
              padding: '10px 32px',
              fontSize: 12.5,
              letterSpacing: '-0.01em',
              textTransform: 'none',
              color: 'var(--color-text-muted)',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans), sans-serif',
              transition: 'border-color var(--duration-fast) var(--ease-signature)',
            }}
          >
            Show all {shownRows.length} {rowNoun}
          </button>
        </div>
      )}
      {isBid ? (
        <p style={{ marginTop: 10, fontSize: 11.5, color: 'var(--color-text-faint)' }}>
          Realized figures only — these auctions publish no estimates. 12-mo movement compares the median sale over the trailing year to the year before; Other = lots whose title names no sport.
        </p>
      ) : (
        <p style={{ marginTop: 10, fontSize: 11.5, color: 'var(--color-text-faint)' }}>
          % over est. is hammer basis — the buyer&rsquo;s premium is divided out before comparing to the estimate mid; median across each maker&rsquo;s sold lots with estimates.
        </p>
      )}
    </section>
  );
}
