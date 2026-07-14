'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ARTISTS, MARKETS, marketArtists } from '../constants';
import type { Market } from '../constants';
import type { AuctionLot, MarketStats } from '../types';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import { useRayData, useSoldArchive, retryArchiveLoad } from '../hooks/useRayData';
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

// The market's analytics grid. `marketLots` already carries any merged archive
// rows; `suppressDemand` drops the estimate-based Demand Index for the
// Goldin verticals (no estimates to measure against). Shared verbatim by the
// standard (phase-2) and archive (phase-3) bodies.
function AnalyticsGrid({
  marketStats,
  marketLots,
  statsByArtist,
  activeKey,
  fromCache,
  suppressDemand,
}: {
  marketStats: Record<string, MarketStats>;
  marketLots: AuctionLot[];
  statsByArtist: Record<string, MarketStats>;
  activeKey: Market;
  fromCache: boolean;
  suppressDemand: boolean;
}) {
  const nodes = [
    <PortfolioHeader key="header" statsByArtist={marketStats} allLots={marketLots} />,
    // sports/science publish no estimates — the % Demand Index is suppressed
    // (the realized cohort curve lives on the home board, not here).
    suppressDemand ? null : <DemandChart key="demand" allLots={marketLots} />,
    <ArtistRankingsTable key="rank" statsByArtist={marketStats} allLots={marketLots} market={activeKey} />,
    <CategoryBreakdown key="cat" allLots={marketLots} />,
    <AuctionHouseDistribution key="house" statsByArtist={statsByArtist} />,
    <TopSales key="top" allLots={marketLots} />,
    <PriceDistribution key="dist" allLots={marketLots} />,
  ].filter((n): n is React.ReactElement => n !== null);

  return (
    <RayEntrance animate={!fromCache}>
      {nodes.map((node, i) => (
        <div
          key={node.key}
          className="ray-enter"
          style={{ '--enter-delay': `${Math.min(i, 3) * 90}ms` } as React.CSSProperties}
        >
          {node}
        </div>
      ))}
    </RayEntrance>
  );
}

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
  // sports/science aggregate over Goldin sold-archive rows (split out of the
  // eager + phase-2 payloads) — only these markets mount useSoldArchive().
  const isArchiveMarket = activeKey === 'sports' || activeKey === 'science';

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
          ? ' ' /* reserve the line — no zero-count flash while the crawl delivers */
          : <>Market-level intelligence across {ARTISTS.length} artists and {houseCount} auction houses.</>}
        timestamp={lastCrawl ? formatDate(lastCrawl) : undefined}
      />

      <div className="rail" style={{ paddingTop: 16 }}><MarketSwitch compact /></div>

      {isArchiveMarket ? (
        <ArchiveAnalyticsBody
          activeKey={activeKey}
          mktSet={mktSet}
          marketStats={marketStats}
          statsByArtist={statsByArtist}
          fromCache={fromCache}
        />
      ) : !fullLoaded ? (
        <RayLoading />
      ) : (
        <AnalyticsGrid
          marketStats={marketStats}
          marketLots={marketLots}
          statsByArtist={statsByArtist}
          activeKey={activeKey}
          fromCache={fromCache}
          suppressDemand={false}
        />
      )}
    </div>
  );
}

// Archive markets only: mounting this triggers useSoldArchive()'s phase-3
// fetch. It aggregates every panel over the archive-merged market lots, gated
// on archiveLoaded (RayLoading / archiveError-retry until then). DemandChart is
// suppressed — Goldin publishes no estimates for the % index to measure.
function ArchiveAnalyticsBody({
  activeKey,
  mktSet,
  marketStats,
  statsByArtist,
  fromCache,
}: {
  activeKey: Market;
  mktSet: Set<string>;
  marketStats: Record<string, MarketStats>;
  statsByArtist: Record<string, MarketStats>;
  fromCache: boolean;
}) {
  const { allLotsWithArchive, archiveLoaded, archiveError } = useSoldArchive();
  const marketLots = useMemo(
    () => allLotsWithArchive.filter(l => mktSet.has(l.artist)),
    [allLotsWithArchive, mktSet]
  );

  if (!archiveLoaded) {
    if (archiveError) {
      return (
        <div style={{ padding: '120px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 24 }}>
            The sold archive didn&rsquo;t load. Check your connection and try again.
          </p>
          <button className="ray-call-btn ray-call-btn-primary" onClick={() => retryArchiveLoad()}>
            Retry
          </button>
        </div>
      );
    }
    return <RayLoading />;
  }

  return (
    <AnalyticsGrid
      marketStats={marketStats}
      marketLots={marketLots}
      statsByArtist={statsByArtist}
      activeKey={activeKey}
      fromCache={fromCache}
      suppressDemand
    />
  );
}
