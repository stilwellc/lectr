'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ResponsiveContainer, AreaChart, Area, YAxis, Tooltip } from 'recharts';
import { MarketStats, AuctionLot } from '../../types';
import { formatPrice, fmtSignedPct, toneOf } from '../../utils';
import { ARTISTS, marketArtists, Market, rosterNoun } from '../../constants';
import { useChartDraw } from '../../hooks/useChartDraw';
import { demandSeries, formatDemand } from '../../lib/demand';
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

function SparkTooltip({ active, payload, priceBasis }: { active?: boolean; payload?: Array<{ payload: SparkPoint }>; priceBasis?: boolean }) {
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
      {/* bid-market fallback: avgPrice is a median $ LEVEL (no estimates to
          divide by), so caption the price — never "% vs estimate". */}
      {priceBasis ? (
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
}

function ArtistCard({ artist }: { artist: ArtistCardData }) {
  const drawRef = useChartDraw();
  const hasChart = artist.sparkData.length >= 2;
  // Reserve saturated up/down for STRONG movers only — tinting all 33 lines
  // green makes "up" stop meaning up (breaks one-lit-element). Calm neutral
  // otherwise; the delta chip still carries the exact direction.
  const strongMove = Math.abs(artist.appreciation) >= 25;
  const tint = !strongMove ? 'var(--color-text-muted)'
    : artist.appreciation > 0 ? 'var(--color-up)' : 'var(--color-down)';

  return (
    <Link
      href={`/makers/${artist.slug}`}
      className="ray-spark-card glass glass-quiet"
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

      {hasChart ? (
        <div className="ray-chart-draw" ref={drawRef} style={{ height: 80, marginLeft: -8, marginRight: -8 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={artist.sparkData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`spark-${artist.slug}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={tint} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={tint} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <YAxis hide domain={[(min: number) => min - Math.abs(min) * 0.18 - 1, (max: number) => max + Math.abs(max) * 0.18 + 1]} />
              <Tooltip content={<SparkTooltip priceBasis={artist.priceBasis} />} />
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
            {artist.avgPrice > 0 ? formatPrice(artist.avgPrice) : '\u2014'}
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
              ? '\u2014'
              : fmtSignedPct(artist.overEstimate, 1)}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function ArtistSparklines({ statsByArtist, allLots, limit = 6, market }: Props & { limit?: number; market?: Market }) {
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
      };
    })
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);
  }, [statsByArtist, allLots, limit, market]);

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

      <div className="ray-spark-grid">
        {artists.map(artist => (
          <ArtistCard key={artist.slug} artist={artist} />
        ))}
      </div>
    </section>
  );
}
