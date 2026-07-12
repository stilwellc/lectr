'use client';

import React, { useMemo, useState } from 'react';
import { ARTISTS, ARTIST_LABEL } from './constants';
import { useRayData } from './hooks/useRayData';
import { useSavedLots } from './hooks/useSavedLots';
import { formatDate, formatPrice, getUpcomingCounts } from './utils';
import ArtistNav from './components/ArtistNav';
import LotCard, { computeBuySignal } from './components/LotCard';
import PastResults from './components/PastResults';
import RayHero from './components/RayHero';
import RayEntrance, { RayLoading } from './components/RayEntrance';
import SectionMark from './components/SectionMark';
import CountUp from './components/CountUp';
import MarketTape from './components/MarketTape';

const PAGE_SIZE = 48;

export default function RayPage() {
  const { allLots, statsByArtist, sources, lastCrawl, loading, error, fromCache } = useRayData();
  const { toggle, isSaved, savedIds } = useSavedLots();
  const [visibleUpcoming, setVisibleUpcoming] = useState(PAGE_SIZE);

  const upcoming = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return allLots
      .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today)
      .sort((a, b) => {
        if (!a.saleDate) return 1;
        if (!b.saleDate) return -1;
        return new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime();
      });
  }, [allLots]);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  const sold = useMemo(() =>
    allLots
      .filter(l => l.status === 'sold' && l.priceUsd)
      .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime()),
    [allLots]
  );

  // Truthful house count: crawler meta first, otherwise derived from the lots themselves
  const houseCount = useMemo(() =>
    sources.length || new Set(allLots.map(l => l.auctionHouse)).size,
    [sources, allLots]
  );

  const overviewStats = useMemo(() => {
    const totalLots = allLots.length;
    const totalSalesValue = Object.values(statsByArtist).reduce((sum, s) => sum + (s.totalAuctionRevenue || 0), 0);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const recentSold = sold.filter(l => {
      const d = new Date(l.saleDate);
      return !isNaN(d.getTime()) && d >= oneYearAgo;
    });
    const avgPrice = recentSold.length
      ? recentSold.reduce((sum, l) => sum + (l.priceUsd || 0), 0) / recentSold.length
      : 0;
    const asInt = (n: number) => Math.round(n).toString();
    const asComma = (n: number) => Math.round(n).toLocaleString();
    return [
      { label: 'Artists', to: ARTISTS.length, format: asInt, sub: `${houseCount} auction houses` },
      { label: 'Total Lots', to: totalLots, format: asComma, sub: 'sold, upcoming & bought-in' },
      { label: 'Total Sales Value', to: totalSalesValue, format: formatPrice, sub: 'aggregate realized prices' },
      { label: 'Avg. Price (12mo)', to: avgPrice, format: formatPrice, sub: `${recentSold.length.toLocaleString()} recent sales` },
    ];
  }, [allLots, sold, statsByArtist, houseCount]);

  // A living read on the market — one derived, honest line (revenue-weighted
  // appreciation matching the analytics page, the top house by revenue, this
  // week's hammers, and how many upcoming lots the buy-signal flags as cheap).
  const pulse = useMemo(() => {
    const stats = Object.values(statsByArtist);
    const totalRevenue = stats.reduce((s, x) => s + (x.totalAuctionRevenue || 0), 0);
    const weightedAppreciation = totalRevenue > 0
      ? stats.reduce((s, x) => s + (x.appreciationRate || 0) * (x.totalAuctionRevenue || 0), 0) / totalRevenue
      : 0;
    const topEntry = Object.entries(statsByArtist)
      .sort((a, b) => (b[1].totalAuctionRevenue || 0) - (a[1].totalAuctionRevenue || 0))[0];
    const topArtist = topEntry ? (ARTIST_LABEL[topEntry[0]] || topEntry[0]) : '';
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
    const thisWeekLots = upcoming.filter(l => {
      const d = new Date(l.saleDate);
      return !isNaN(d.getTime()) && d >= now && d <= weekAhead;
    });
    // Flagged count is among *this week's* lots so the sentence stays honest.
    const belowFlagged = thisWeekLots.filter(l => {
      const sig = computeBuySignal(l, allLots);
      return sig && sig.label === 'Below Market';
    }).length;
    return { weightedAppreciation, topArtist, thisWeek: thisWeekLots.length, belowFlagged };
  }, [statsByArtist, upcoming, allLots]);

  // The tape: the biggest hammers among recent sales (recent-first, then by
  // value) — records the market actually just paid.
  const tapeItems = useMemo(() =>
    sold.slice(0, 90)
      .filter(l => l.priceUsd && l.title)
      .sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0))
      .slice(0, 18)
      .map(l => ({
        artist: ARTIST_LABEL[l.artist] || l.artist,
        title: l.title.length > 44 ? l.title.slice(0, 42) + '…' : l.title,
        price: formatPrice(l.priceUsd!),
        house: l.auctionHouse,
      })),
    [sold]
  );

  const accent: React.CSSProperties = { color: 'var(--color-accent-wine-text)', fontWeight: 600 };
  const pulseLine = (
    <>
      The market is{' '}
      <b style={accent}>
        {pulse.weightedAppreciation >= 0 ? 'up' : 'down'} {Math.abs(pulse.weightedAppreciation).toFixed(1)}%
      </b>{' '}
      year over year{pulse.topArtist && <>, led by <b style={accent}>{pulse.topArtist}</b></>}.
      {pulse.thisWeek > 0 && (
        <>
          {' '}<b style={accent}>{pulse.thisWeek} {pulse.thisWeek === 1 ? 'lot' : 'lots'}</b> hammer this week
          {pulse.belowFlagged > 0 && <> — <b style={accent}>{pulse.belowFlagged}</b> flagged below estimate</>}.
        </>
      )}
    </>
  );

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      color: 'var(--color-fg)',
      fontFamily: 'var(--font-sans), sans-serif',
    }}>
      <style>{`
        .ray-overview-stats {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }
        .ray-overview-stats .ray-stat-card {
          padding: 28px 24px;
        }
        .ray-upcoming-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }
        .ray-overview-stats-section { padding-block: 40px 0; }
        .ray-upcoming-section { padding-block: 40px 48px; }
        @media (max-width: 768px) {
          .ray-overview-stats { grid-template-columns: repeat(2, 1fr); }
          .ray-overview-stats .ray-stat-card { padding: 20px 18px; }
          .ray-upcoming-grid { grid-template-columns: 1fr; gap: 14px; }
          .ray-overview-stats-section { padding-block: 32px 0; }
          .ray-upcoming-section { padding-block: 32px; }
        }
      `}</style>

      <ArtistNav activeSlug={null} savedCount={savedIds.length} upcomingCounts={upcomingCounts} />

      <RayHero
        eyebrow="Market Intelligence"
        title={<span style={{ fontStyle: 'italic', color: 'var(--color-accent-wine)' }}>Ray</span>}
        sub={loading
          ? '\u00A0' /* reserve the line — no zero-count flash while the crawl delivers */
          : pulseLine}
        timestamp={lastCrawl ? formatDate(lastCrawl) : undefined}
      />

      {!loading && !error && tapeItems.length > 0 && <MarketTape items={tapeItems} />}

      {error ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '120px 20px', gap: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center' }}>{error}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
              padding: '8px 20px', borderRadius: 100, border: '1px solid var(--color-border)',
              background: 'none', color: 'var(--color-text-muted)', cursor: 'pointer',
              fontFamily: 'var(--font-sans), sans-serif',
            }}
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          <section className="ray-overview-stats-section ray-enter rail">
            <div className="ray-overview-stats">
              {overviewStats.map((card) => (
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
                  <CountUp
                    to={card.to}
                    format={card.format}
                    style={{
                      display: 'block',
                      fontFamily: 'var(--font-serif), serif',
                      fontSize: 34,
                      fontWeight: 300,
                      color: 'var(--color-fg)',
                      lineHeight: 1,
                      marginBottom: 8,
                    }}
                  />
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

          {upcoming.length > 0 && (
            <section className="ray-upcoming-section rail">
              {/* Ghost ordinal clipped to the header band — never under the cards */}
              <div style={{ position: 'relative', overflow: 'hidden', marginBottom: 16 }}>
                <SectionMark n="01" style={{ fontSize: 'clamp(96px, 12vw, 150px)' }} />
                <div
                  className="ray-enter"
                  style={{
                    '--enter-delay': '90ms',
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                    padding: '16px 0 12px',
                  } as React.CSSProperties}
                >
                  <h2 style={{
                    fontFamily: 'var(--font-serif), serif',
                    fontSize: 32,
                    fontWeight: 300,
                    letterSpacing: '-0.02em',
                  }}>
                    Upcoming <span style={{ fontStyle: 'italic' }}>Lots</span>
                  </h2>
                  <span style={{
                    fontFamily: 'var(--font-mono), monospace',
                    fontSize: 12,
                    color: 'var(--color-text-faint)',
                  }}>
                    {upcoming.length.toLocaleString()} lots
                  </span>
                </div>
              </div>

              <div className="ray-upcoming-grid">
                {upcoming.slice(0, visibleUpcoming).map((lot, i) => (
                  <div
                    key={lot.id}
                    className="ray-enter-card"
                    style={{ '--enter-delay': `${90 + Math.min(i, 8) * 60}ms` } as React.CSSProperties}
                  >
                    <LotCard
                      lot={lot}
                      showArtist
                      allLots={allLots}
                      stats={statsByArtist[lot.artist]}
                      saved={isSaved(lot.id)}
                      onToggleSave={toggle}
                    />
                  </div>
                ))}
              </div>

              {visibleUpcoming < upcoming.length && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
                  <button
                    onClick={() => setVisibleUpcoming(v => v + PAGE_SIZE)}
                    style={{
                      background: 'none',
                      border: '1px solid var(--color-border)',
                      borderRadius: 100,
                      padding: '10px 32px',
                      fontSize: 12,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'var(--color-text-muted)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans), sans-serif',
                      transition: 'border-color var(--duration-fast) var(--ease-signature)',
                    }}
                  >
                    Show more ({(upcoming.length - visibleUpcoming).toLocaleString()} remaining)
                  </button>
                </div>
              )}
            </section>
          )}

          {sold.length > 0 && (
            <div className="ray-enter" style={{ '--enter-delay': '180ms' } as React.CSSProperties}>
              <PastResults lots={sold} showArtist savedIds={savedIds} onToggleSave={toggle} mark="02" />
            </div>
          )}
        </RayEntrance>
      )}
    </div>
  );
}
