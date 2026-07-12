'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ARTISTS } from '../constants';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import { formatDate, getUpcomingCounts } from '../utils';
import PortfolioHeader from '../components/analytics/PortfolioHeader';
import ArtistRankingsTable from '../components/analytics/ArtistRankingsTable';
import TopSales from '../components/analytics/TopSales';
import RayHero from '../components/RayHero';
import RayEntrance, { RayLoading } from '../components/RayEntrance';

const PortfolioPerformanceChart = dynamic(() => import('../components/analytics/PortfolioPerformanceChart'), { ssr: false });
const ArtistSparklines = dynamic(() => import('../components/analytics/ArtistSparklines'), { ssr: false });
const CategoryBreakdown = dynamic(() => import('../components/analytics/CategoryBreakdown'), { ssr: false });
const AuctionHouseDistribution = dynamic(() => import('../components/analytics/AuctionHouseDistribution'), { ssr: false });
const PriceDistribution = dynamic(() => import('../components/analytics/PriceDistribution'), { ssr: false });

export default function AnalyticsPage() {
  const { allLots, statsByArtist, sources, lastCrawl, loading, fromCache } = useRayData();
  const { savedIds } = useSavedLots();

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  const houseCount = useMemo(() =>
    sources.length || new Set(allLots.map(l => l.auctionHouse)).size,
    [sources, allLots]
  );

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      color: 'var(--color-fg)',
      fontFamily: 'var(--font-sans), sans-serif',
    }}>
      <ArtistNav activeSlug="analytics" savedCount={savedIds.length} upcomingCounts={upcomingCounts} />

      <RayHero
        eyebrow="Market Analytics"
        title={<span style={{ fontStyle: 'italic', color: 'var(--color-accent-gold)' }}>Analytics</span>}
        sub={loading
          ? '\u00A0' /* reserve the line — no zero-count flash while the crawl delivers */
          : <>Market-level intelligence across {ARTISTS.length} artists and {houseCount} auction houses.</>}
        timestamp={lastCrawl ? formatDate(lastCrawl) : undefined}
      />

      {loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          {[
            <PortfolioHeader key="header" statsByArtist={statsByArtist} allLots={allLots} />,
            <PortfolioPerformanceChart key="perf" statsByArtist={statsByArtist} />,
            <ArtistSparklines key="spark" statsByArtist={statsByArtist} allLots={allLots} />,
            <ArtistRankingsTable key="rank" statsByArtist={statsByArtist} allLots={allLots} />,
            <CategoryBreakdown key="cat" allLots={allLots} />,
            <AuctionHouseDistribution key="house" statsByArtist={statsByArtist} />,
            <TopSales key="top" allLots={allLots} />,
            <PriceDistribution key="dist" allLots={allLots} />,
          ].map((node, i) => (
            <div
              key={node.key}
              className="ray-enter"
              style={{ '--enter-delay': `${Math.min(i, 3) * 90}ms` } as React.CSSProperties}
            >
              {node}
            </div>
          ))}
        </RayEntrance>
      )}
    </div>
  );
}
