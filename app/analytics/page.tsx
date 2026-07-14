'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ARTISTS, MARKETS, marketArtists } from '../constants';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import { formatDate, getUpcomingCounts } from '../utils';
import PortfolioHeader from '../components/analytics/PortfolioHeader';
import ArtistRankingsTable from '../components/analytics/ArtistRankingsTable';
import TopSales from '../components/analytics/TopSales';
import RayHero from '../components/RayHero';
import RayEntrance, { RayLoading } from '../components/RayEntrance';

const DemandChart = dynamic(() => import('../components/analytics/DemandChart'), { ssr: false });
const CategoryBreakdown = dynamic(() => import('../components/analytics/CategoryBreakdown'), { ssr: false });
const AuctionHouseDistribution = dynamic(() => import('../components/analytics/AuctionHouseDistribution'), { ssr: false });
const PriceDistribution = dynamic(() => import('../components/analytics/PriceDistribution'), { ssr: false });

export default function AnalyticsPage() {
  const { allLots, statsByArtist, sources, lastCrawl, fullLoaded, fromCache } = useRayData();
  const { market } = useMarket();
  const activeKey = MARKETS.find(m => m.key === market)?.live ? market : 'all';
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const marketLots = useMemo(() => allLots.filter(l => mktSet.has(l.artist)), [allLots, mktSet]);
  const marketStats = useMemo(() => {
    const out: typeof statsByArtist = {};
    for (const [k, v] of Object.entries(statsByArtist)) if (mktSet.has(k)) out[k] = v;
    return out;
  }, [statsByArtist, mktSet]);
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
      <ArtistNav activeSlug="analytics" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      <RayHero
        eyebrow="Market Analytics"
        title={<span style={{ fontStyle: 'normal', color: 'var(--color-fg)' }}>Analytics</span>}
        sub={!fullLoaded
          ? '\u00A0' /* reserve the line — no zero-count flash while the crawl delivers */
          : <>Market-level intelligence across {ARTISTS.length} artists and {houseCount} auction houses.</>}
        timestamp={lastCrawl ? formatDate(lastCrawl) : undefined}
      />

      <div className="rail" style={{ paddingTop: 16 }}><MarketSwitch compact /></div>

      {!fullLoaded ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          {[
            <PortfolioHeader key="header" statsByArtist={marketStats} allLots={marketLots} />,
            <DemandChart key="demand" allLots={marketLots} />,
            <ArtistRankingsTable key="rank" statsByArtist={marketStats} allLots={marketLots} market={activeKey} />,
            <CategoryBreakdown key="cat" allLots={marketLots} />,
            <AuctionHouseDistribution key="house" statsByArtist={statsByArtist} />,
            <TopSales key="top" allLots={marketLots} />,
            <PriceDistribution key="dist" allLots={marketLots} />,
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
