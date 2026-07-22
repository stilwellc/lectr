'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { MARKETS, marketArtists } from '../constants';
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
import MarketIntelligence from '../components/analytics/MarketIntelligence';
import Masthead, { Underscore } from '../components/Masthead';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import DeskNote from '../components/analytics/DeskNote';
import { Colophon } from '../components/Terminal';
import meta from '../../public/data/ray/meta.json';

const Distributions = dynamic(() => import('../components/analytics/Distributions'), { ssr: false });
const CalibrationCurve = dynamic(() => import('../components/analytics/CalibrationCurve'), { ssr: false });

// The market's analytics grid. `marketLots` already carries any merged archive
// rows. The demand read itself lives on the lander hero — this page keeps the
// index context (MarketIntelligence), never a second demand instrument.
// Shared verbatim by the standard (phase-2) and archive (phase-3) bodies.
function AnalyticsGrid({
  marketStats,
  marketLots,
  statsByArtist,
  activeKey,
  marketSeries,
  seasonality,
  fromCache,
  backtest,
}: {
  backtest?: import('../hooks/useRayData').Backtest | null;
  marketStats: Record<string, MarketStats>;
  marketLots: AuctionLot[];
  statsByArtist: Record<string, MarketStats>;
  activeKey: Market;
  fromCache: boolean;
  marketSeries: import('../hooks/useRayData').MarketSeriesJson | null;
  seasonality?: NonNullable<import('../hooks/useRayData').MarketData['seasonality']>[string] | null;
}) {
  const nodes = [
    marketSeries ? <MarketIntelligence key="mi" series={marketSeries} marketLabel={activeKey === 'all' ? 'the market' : activeKey} seasonality={seasonality} /> : null,
    <PortfolioHeader key="header" statsByArtist={marketStats} allLots={marketLots} />,
    <ArtistRankingsTable key="rank" statsByArtist={marketStats} allLots={marketLots} market={activeKey} />,
    backtest ? <CalibrationCurve key="cal" backtest={backtest} /> : null,
    <TopSales key="top" allLots={marketLots} market={activeKey} series={marketSeries} />,
    <Distributions key="dist" allLots={marketLots} statsByArtist={marketStats} market={activeKey} series={marketSeries} />,
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
  const { allLots, statsByArtist, sources, lastCrawl, fullLoaded, fromCache, market: marketData, backtest } = useRayData();
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

      {/* the certificate masthead — same instrument grammar as the ledger */}
      <section className="rail" style={{ paddingTop: 28 }}>
      <Masthead
        kicker="The intelligence desk"
        serial={lastCrawl || undefined}
        title={<>Every market, read as <Underscore>one book</Underscore>.</>}
        sub={!fullLoaded
          ? ' ' /* reserve the line — no zero-count flash while the crawl delivers */
          : <>Demand, rankings, calibration and the tape —{' '}
              <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{Object.keys(marketStats).length} makers</b>,{' '}
              <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{houseCount} auction houses</b>
              {lastCrawl ? <>, read {formatDate(lastCrawl)}</> : null}.</>}
      />
      {/* the market's current-quarter note from the desk — hidden for 'all' */}
      <DeskNote market={activeKey} style={{ marginTop: 12 }} />
      </section>

      <div className="rail" style={{ paddingTop: 16 }}><MarketSwitch compact /></div>

      {isArchiveMarket ? (
        <ArchiveAnalyticsBody
          activeKey={activeKey}
          mktSet={mktSet}
          marketStats={marketStats}
          statsByArtist={statsByArtist}
          fromCache={fromCache}
          marketSeries={marketData?.markets?.[activeKey] || null}
          seasonality={marketData?.seasonality?.[activeKey] || null}
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
          marketSeries={marketData?.markets?.[activeKey] || null}
          seasonality={marketData?.seasonality?.[activeKey] || null}
          backtest={backtest}
        />
      )}

      {/* the closing colophon — corpus counts from meta.json, one base for every number */}
      <Colophon lotCount={meta.totalLots} houseCount={meta.sources.length} record={null} />
    </div>
  );
}

// Archive markets only: mounting this triggers useSoldArchive()'s phase-3
// fetch. It aggregates every panel over the archive-merged market lots, gated
// on archiveLoaded (RayLoading / archiveError-retry until then).
function ArchiveAnalyticsBody({
  activeKey,
  mktSet,
  marketStats,
  statsByArtist,
  fromCache,
  marketSeries,
  seasonality,
}: {
  activeKey: Market;
  mktSet: Set<string>;
  marketStats: Record<string, MarketStats>;
  statsByArtist: Record<string, MarketStats>;
  fromCache: boolean;
  marketSeries: import('../hooks/useRayData').MarketSeriesJson | null;
  seasonality?: NonNullable<import('../hooks/useRayData').MarketData['seasonality']>[string] | null;
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
      marketSeries={marketSeries}
      seasonality={seasonality}
    />
  );
}
