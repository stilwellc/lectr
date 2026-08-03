'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ResponsiveContainer, AreaChart, Area, YAxis, Tooltip } from 'recharts';
import { MarketStats, AuctionLot } from '../../types';
import { formatPrice, fmtSignedPct, toneOf } from '../../utils';
import { ARTISTS, marketArtists, Market, rosterNoun } from '../../constants';
import { useChartDraw } from '../../hooks/useChartDraw';
import { demandSeries, formatDemand } from '../../lib/demand';
import type { MarketData } from '../../hooks/useRayData';
import { verifiedMovers } from '../../preview/terminal/verified';
import ArtistAvatar from '../ArtistAvatar';
import Flick from '../Flick';

interface Props {
  statsByArtist: Record<string, MarketStats>;
  allLots: AuctionLot[];
}

interface SparkPoint {
  date: string;
  avgPrice: number;
}

/** the strongest CI-backed read market.json will stand behind for a maker —
 *  keyed by maker slug (makerIndex[slug]); only 3 makers publish today (rolex,
 *  cartier, patek-philippe). This is genuinely additive to the card's header
 *  demand chip: it is confidence-bounded, the header read is not. */
interface VerifiedRead {
  changePct: number;
  horizon: string;
  dir: 'up' | 'down';
}

function computeSparkData(lots: AuctionLot[]): SparkPoint[] {
  const sold = lots.filter(l => l.status === 'sold' && l.priceUsd);
  if (sold.length === 0) return [];

  const quarters: Record<string, number[]> = {};
  for (const lot of sold) {
    const d = new Date(lot.saleDate);
    if (isNaN(d.getTime())) continue;
    // UTC getters: saleDate is date-only (UTC midnight); local getters can
    // shift a sale into the previous quarter/year depending on timezone.
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    const key = `${d.getUTCFullYear()} Q${q}`;
    if (!quarters[key]) quarters[key] = [];
    quarters[key].push(lot.priceUsd!);
  }

  return Object.entries(quarters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, prices]) => ({
      date,
      avgPrice: prices.reduce((s, p) => s + p, 0) / prices.length,
    }));
}

function SparkTooltip({ active, payload, priceBasis, rebased }: { active?: boolean; payload?: Array<{ payload: SparkPoint }>; priceBasis?: boolean; rebased?: boolean }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border)',
      borderRadius: 8,
      padding: '6px 10px',
      fontFamily: "var(--font-sans), sans-serif",
    }}>
      <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', letterSpacing: '-0.01em', textTransform: 'none', marginBottom: 3 }}>
        {d.date}
      </div>
      {/* compare-on-one-axis: every card is rebased to Δ% from its own window
          start, so the point is a change-from-start, never a $ level or a
          %-over-estimate. Caption it as exactly that. */}
      {rebased ? (
        <div style={{ fontSize: 12.5, fontWeight: 600, color: toneOf(d.avgPrice) === 'flat' ? 'var(--color-text-muted)' : toneOf(d.avgPrice) === 'up' ? 'var(--color-up)' : 'var(--color-down-text)' }}>
          {`${fmtSignedPct(Math.round(d.avgPrice))} from window start`}
        </div>
      ) : priceBasis ? (
        /* bid-market fallback: avgPrice is a median $ LEVEL (no estimates to
           divide by), so caption the price — never "% vs estimate". */
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-fg)' }}>
          {`${formatPrice(d.avgPrice)} median realized`}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, fontWeight: 600, color: toneOf(d.avgPrice) === 'flat' ? 'var(--color-text-muted)' : toneOf(d.avgPrice) === 'up' ? 'var(--color-up)' : 'var(--color-down-text)' }}>
          {`${fmtSignedPct(Math.round(d.avgPrice))} vs estimate`}
        </div>
      )}
    </div>
  );
}

interface ArtistCardData {
  slug: string;
  label: string;
  sparkData: SparkPoint[];
  /** true when sparkData is the bid-market $ median fallback (no estimates) —
      the tooltip then reads a price level, not a % over estimate */
  priceBasis: boolean;
  totalRevenue: number;
  avgPrice: number;
  appreciation: number;
  overEstimate: number;
  totalLots: number;
  /** live lots on the block right now (getUpcomingCounts) — 0 when none */
  live: number;
  /** all-time sold-lot count (stats) — a sort key, never a price movement */
  soldCount: number;
  /** the CI-backed verified read where market.json publishes one; else null */
  verified: VerifiedRead | null;
}

/** rebase a spark to Δ% from its own window start — the shared basis for
 *  compare-on-one-axis. Both %-over-estimate levels and $-price levels rebase
 *  to a comparable "change from window start". */
function rebase(data: SparkPoint[]): SparkPoint[] {
  if (data.length < 2) return data;
  const base = data[0].avgPrice;
  if (base === 0) return data;
  return data.map(p => ({ date: p.date, avgPrice: ((p.avgPrice / base) - 1) * 100 }));
}

function ArtistCard({ artist, compare, sharedDomain }: { artist: ArtistCardData; compare: boolean; sharedDomain: [number, number] | null }) {
  const drawRef = useChartDraw();
  const displayData = useMemo(() => compare ? rebase(artist.sparkData) : artist.sparkData, [compare, artist.sparkData]);
  const hasChart = displayData.length >= 2;
  // Reserve saturated up/down for STRONG movers only — tinting all 33 lines
  // green makes "up" stop meaning up (breaks one-lit-element). Calm neutral
  // otherwise; the delta chip still carries the exact direction.
  const strongMove = Math.abs(artist.appreciation) >= 25;
  const tint = !strongMove ? 'var(--color-text-muted)'
    : artist.appreciation > 0 ? 'var(--color-up)' : 'var(--color-down)';

  return (
    <Link
      href={`/makers/${artist.slug}`}
      className="ray-spark-card ray-cert glass glass-quiet"
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{
          fontSize: 13.5,
          fontWeight: 600,
          color: 'var(--color-fg)',
          letterSpacing: '-0.01em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          marginRight: 8,
        }}>
          {artist.label}
        </div>
        {toneOf(artist.appreciation) !== 'flat' && (
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 5,
            whiteSpace: 'nowrap',
          }}
            // priceBasis makers have no estimates: this is stats.appreciationRate,
            // a coarse median-price appreciation estimate — NOT the confidence-
            // bounded demand read, and never labelled as one.
            title={artist.priceBasis
              ? 'Coarse appreciation estimate from median realized price — not a confidence-bounded return. See Verified movers for the reads the engine will stand behind.'
              : 'Demand: median price realized vs the houses’ estimate.'}
          >
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-text-faint)',
            }}>
              {artist.priceBasis ? 'appr. est.' : 'demand'}
            </span>
            <span style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: artist.appreciation > 0 ? 'var(--color-up)' : 'var(--color-down-text)',
            }}>
              <Flick size={10} style={{ marginLeft: 0, transform: artist.appreciation > 0 ? undefined : 'scaleY(-1)' }} /> {formatDemand(artist.appreciation)}
            </span>
          </div>
        )}
      </div>

      {/* #25 + #22 — quiet chip row: the CI-backed verified read (mono,
          coloured only on the real delta, horizon named) and the live-lot
          chip. Only render the row when at least one chip is present. */}
      {(artist.verified || artist.live > 0) && (
        <div className="ray-cert-chips">
          {artist.verified && (
            <span className="ray-cert-verified" data-dir={artist.verified.dir}
              title="The strongest price move market.json will stand behind for this maker — hedonic index, 95% confidence.">
              <span className="num">{artist.verified.changePct >= 0 ? '+' : ''}{artist.verified.changePct.toFixed(0)}%</span>
              <span className="lab">{artist.verified.horizon} verified</span>
            </span>
          )}
          {artist.live > 0 && (
            <span className="ray-cert-live" title={`${artist.live} lot${artist.live === 1 ? '' : 's'} on the block now`}>
              {artist.live} on the block
            </span>
          )}
        </div>
      )}

      {hasChart ? (
        <div className="ray-chart-draw" ref={drawRef} style={{ height: 80, marginLeft: -8, marginRight: -8 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={displayData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`spark-${artist.slug}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={tint} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={tint} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              {/* compare mode: a SHARED fixed domain across every card so the
                  rebased curves are visually comparable; per-card auto domain
                  otherwise. */}
              {compare && sharedDomain
                ? <YAxis hide domain={sharedDomain} />
                : <YAxis hide domain={[(min: number) => min - Math.abs(min) * 0.18 - 1, (max: number) => max + Math.abs(max) * 0.18 + 1]} />}
              <Tooltip content={<SparkTooltip priceBasis={artist.priceBasis} rebased={compare} />} />
              <Area
                type="monotone"
                dataKey="avgPrice"
                stroke={tint}
                strokeWidth={1.5}
                fill={`url(#spark-${artist.slug})`}
                dot={false}
                activeDot={{ r: 2, fill: tint, stroke: 'var(--color-bg-elevated)', strokeWidth: 1.5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div style={{
          height: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-faint)',
          fontSize: 12.5,
        }}>
          Insufficient data
        </div>
      )}

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 10,
        paddingTop: 10,
        borderTop: '1px solid var(--color-border)',
      }}>
        <div>
          <div style={{ fontSize: 12.5, letterSpacing: '-0.01em', textTransform: 'none', color: 'var(--color-text-faint)', fontWeight: 600, marginBottom: 3 }}>
            Sales value
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-fg)' }}>
            {formatPrice(artist.totalRevenue)}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 12.5, letterSpacing: '-0.01em', textTransform: 'none', color: 'var(--color-text-faint)', fontWeight: 600, marginBottom: 3 }}>
            Avg (12mo)
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-muted)' }}>
            {artist.avgPrice > 0 ? formatPrice(artist.avgPrice) : '—'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12.5, letterSpacing: '-0.01em', textTransform: 'none', color: 'var(--color-text-faint)', fontWeight: 600, marginBottom: 3 }}>
            % over est.
          </div>
          <div style={{
            fontSize: 14,
            fontWeight: 500,
            color: artist.overEstimate <= -999 || toneOf(artist.overEstimate) === 'flat'
              ? 'var(--color-text-muted)'
              : toneOf(artist.overEstimate) === 'up' ? 'var(--color-up)' : 'var(--color-down)',
          }}>
            {artist.overEstimate <= -999
              ? '—'
              : fmtSignedPct(artist.overEstimate, 1)}
          </div>
        </div>
      </div>
    </Link>
  );
}

type SortKey = 'revenue' | 'demand' | 'sales' | 'live';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'revenue', label: 'Sales value' },
  { key: 'demand', label: 'Demand now' },
  { key: 'sales', label: 'Sold count' },
  { key: 'live', label: 'On the block' },
];

export default function ArtistSparklines({ statsByArtist, allLots, limit = 6, market, marketData, upcomingCounts }: Props & { limit?: number; market?: Market; marketData?: MarketData | null; upcomingCounts?: Record<string, number> }) {
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [compare, setCompare] = useState(false);

  // #25 — verified reads keyed by maker slug (makerIndex → CI-backed move).
  const verifiedBySlug = useMemo(() => {
    const map = new Map<string, VerifiedRead>();
    if (!marketData) return map;
    for (const mv of verifiedMovers(marketData)) {
      map.set(mv.slug, { changePct: mv.changePct, horizon: mv.horizon, dir: mv.dir });
    }
    return map;
  }, [marketData]);

  const artists = useMemo<ArtistCardData[]>(() => {
    const roster = market ? ARTISTS.filter(a => marketArtists(market).has(a.slug)) : ARTISTS;
    // one O(n) pass over the 32k lots instead of a full-dataset filter per
    // roster entry
    const bySlug = new Map<string, AuctionLot[]>();
    for (const l of allLots) {
      const arr = bySlug.get(l.artist);
      if (arr) arr.push(l); else bySlug.set(l.artist, [l]);
    }
    return roster.map(a => {
      const stats = statsByArtist[a.slug];
      const artistLots = bySlug.get(a.slug) || [];
      let sparkData = demandSeries(artistLots).map(p => ({ date: p.date, avgPrice: p.value }));

      // BID-MARKET FALLBACK: sports/science (Goldin) lots carry NO estimates —
      // and the sold-cards corpus isn't even loaded client-side — so
      // demandSeries yields nothing and the card blanks to "Insufficient data".
      // Mirror ArtistHero's stats path: draw the sparkline from the
      // full-corpus quarterly medianPrice in stats.json, and headline the
      // movement chip off stats.appreciationRate. `priceBasis` retargets the
      // tooltip/tone so a $ level is never captioned as "% vs estimate".
      let priceBasis = false;
      if (sparkData.length < 2 && stats?.priceHistory?.length) {
        const pts = stats.priceHistory
          .filter(p => p.medianPrice > 0)
          .map(p => ({ date: p.date, avgPrice: p.medianPrice }));
        if (pts.length >= 2) { sparkData = pts; priceBasis = true; }
      }

      const withEstimate = artistLots.filter(l =>
        l.status === 'sold' && l.priceUsd && l.estimateHigh && l.estimateHigh > 0
      );
      // HAMMER basis: estimates are hammer-basis but priceUsd includes the
      // buyer's premium (~1.25×) — comparing raw overstated "over estimate" by
      // ~25pts. Divide out the measured flat premium (matches PortfolioHeader).
      const overEstimate = withEstimate.length >= 3
        ? withEstimate.reduce((s, l) =>
            s + ((l.priceUsd! / 1.25 - l.estimateHigh!) / l.estimateHigh!) * 100, 0) / withEstimate.length
        : -999;

      return {
        slug: a.slug,
        label: a.label,
        sparkData,
        priceBasis,
        totalRevenue: stats?.totalAuctionRevenue || 0,
        avgPrice: stats?.avgPriceLast12Months || 0,
        // the last spark point IS the appreciation for estimate markets
        // (demandSeries' value carried through as avgPrice); on the bid-market
        // price fallback that quantity is a $ level, so read the authoritative
        // appreciationRate from stats.json instead.
        appreciation: priceBasis
          ? (stats?.appreciationRate || 0)
          : sparkData.length ? sparkData[sparkData.length - 1].avgPrice : 0,
        overEstimate,
        totalLots: artistLots.length,
        live: upcomingCounts?.[a.slug] || 0,
        soldCount: stats?.totalSoldTracked ?? stats?.totalLotsTracked ?? 0,
        verified: verifiedBySlug.get(a.slug) || null,
      };
    })
      // default order stays revenue (unchanged); the roster is capped to limit
      // on that key so the wall is a stable set the other sorts reorder.
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);
  }, [statsByArtist, allLots, limit, market, upcomingCounts, verifiedBySlug]);

  // #21 — reorder the already-capped wall by the chosen honest key. Demand
  // sort uses the current demand read (last spark point on estimate markets,
  // else the appreciation estimate); descriptive/price-basis makers still sort
  // by their appreciation figure, never dressed as a demand %.
  const ordered = useMemo(() => {
    const arr = [...artists];
    switch (sortKey) {
      case 'demand': return arr.sort((a, b) => b.appreciation - a.appreciation);
      case 'sales': return arr.sort((a, b) => b.soldCount - a.soldCount);
      case 'live': return arr.sort((a, b) => b.live - a.live);
      default: return arr; // 'revenue' — already sorted
    }
  }, [artists, sortKey]);

  // #31 — a single SHARED domain for compare mode so every rebased spark is
  // read against one axis. Δ% from window start across all cards' rebased
  // curves; a small pad keeps the extreme lines off the frame.
  const sharedDomain = useMemo<[number, number] | null>(() => {
    if (!compare) return null;
    let lo = Infinity, hi = -Infinity;
    for (const a of ordered) {
      const r = rebase(a.sparkData);
      if (r.length < 2) continue;
      for (const p of r) { if (p.avgPrice < lo) lo = p.avgPrice; if (p.avgPrice > hi) hi = p.avgPrice; }
    }
    if (!isFinite(lo) || !isFinite(hi) || lo === hi) return null;
    const pad = (hi - lo) * 0.12 + 1;
    return [lo - pad, hi + pad];
  }, [compare, ordered]);

  return (
    <section className="ray-sparklines rail">
      <style>{`
        .ray-sparklines { padding-block: var(--sect-t) var(--sect-b); }
        .ray-spark-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        .ray-spark-card {
          padding: 20px;
        }
        /* per-card chips (#22 live-lot, #25 verified read) — .ray-cert is
           kept only as their positioning context */
        .ray-cert { position: relative; }
        .ray-cert-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
        .ray-cert-verified {
          display: inline-flex; align-items: baseline; gap: 5px;
          padding: 2px 8px; border-radius: 999px;
          border: 1px solid var(--color-border);
          background: var(--color-bg-elevated);
        }
        .ray-cert-verified .num {
          font-family: var(--font-mono), monospace; font-size: 11.5px; font-weight: 600;
        }
        .ray-cert-verified[data-dir="up"] .num { color: var(--color-up); }
        .ray-cert-verified[data-dir="down"] .num { color: var(--color-down); }
        .ray-cert-verified .lab { font-size: 10px; color: var(--color-text-faint); }
        .ray-cert-live {
          display: inline-flex; align-items: center;
          padding: 2px 8px; border-radius: 999px;
          border: 1px solid var(--color-border);
          font-size: 10.5px; font-weight: 600; color: var(--color-text-muted);
          font-variant-numeric: tabular-nums;
        }
        .ray-roster-controls {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
        }
        .ray-roster-controls .ray-seg-btn { padding: 5px 11px; font-size: 11.5px; }
        .ray-roster-compare {
          display: inline-flex; align-items: center; gap: 7px;
          font-size: 11.5px; font-weight: 600; color: var(--color-text-muted);
          cursor: pointer; user-select: none;
          padding: 5px 11px; border-radius: 8px;
          border: 1px solid var(--color-border); background: none;
          transition: color var(--duration-fast) var(--ease-signature), border-color var(--duration-fast) var(--ease-signature);
        }
        .ray-roster-compare[data-active="true"] {
          color: var(--color-fg); border-color: var(--color-border-mid);
          background: var(--color-bg-elevated);
        }
        @media (max-width: 1024px) {
          .ray-spark-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 768px) {
          .ray-sparklines { padding-block: var(--sect-t) var(--sect-b); }
          .ray-spark-grid { grid-template-columns: 1fr; }
          .ray-spark-card { padding: 16px; }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <h2 style={{
          fontFamily: 'var(--font-serif), serif',
          fontSize: 24,
          fontWeight: 400,
          letterSpacing: '-0.015em',
        }}>
          {market && market !== 'all' ? rosterNoun(market).charAt(0).toUpperCase() + rosterNoun(market).slice(1) : 'Roster'} <span style={{ fontStyle: 'normal', color: 'var(--color-fg)' }}>performance</span>
        </h2>
        <a
          href="/analytics#artist-rankings"
          style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 12.5,
            letterSpacing: '-0.01em',
            textTransform: 'none',
            color: 'var(--color-text-muted)',
            textDecoration: 'none',
          }}
        >
          All {market ? ARTISTS.filter(a => marketArtists(market).has(a.slug)).length : ARTISTS.length} {market && market !== 'all' ? rosterNoun(market) : 'names'} &#8595;
        </a>
      </div>

      {/* #21 + #31 — reorder + compare-on-one-axis controls above the wall.
          Local state only, no URL; honest labels; default order = sales value. */}
      <div className="ray-roster-controls" style={{ marginBottom: 18 }}>
        <div className="ray-seg" role="group" aria-label="Sort the roster">
          {SORTS.map(s => (
            <button
              key={s.key}
              type="button"
              className="ray-seg-btn"
              data-active={sortKey === s.key}
              onClick={() => setSortKey(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ray-roster-compare"
          data-active={compare}
          onClick={() => setCompare(c => !c)}
          title="Repaint every spark on one shared axis, each rebased to its change since its window start — for visual comparison only."
        >
          Compare on one axis
        </button>
      </div>

      <div className="ray-spark-grid">
        {ordered.map((artist, i) => (
          <ArtistCard
            key={artist.slug}
            artist={artist}
            compare={compare}
            sharedDomain={sharedDomain}
          />
        ))}
      </div>
    </section>
  );
}
