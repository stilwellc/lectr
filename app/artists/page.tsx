'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ARTISTS, MARKETS, marketArtists } from '../constants';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import { formatDate, getUpcomingCounts } from '../utils';
import { demandSeries, formatDemand } from '../lib/demand';
import CountUp from '../components/CountUp';

const ArtistSparklines = dynamic(() => import('../components/analytics/ArtistSparklines'), { ssr: false });

/**
 * Artists — the roster as a wall of demand curves. Every tracked artist, each
 * card a live market read, one click to their asset page.
 */
export default function ArtistsPage() {
  const { allLots, statsByArtist, lastCrawl, fullLoaded, fromCache } = useRayData();
  const { market } = useMarket();
  const activeKey = MARKETS.find(m => m.key === market)?.live ? market : 'all';
  const activeLabel = activeKey === 'all' ? 'full' : MARKETS.find(m => m.key === activeKey)!.label.toLowerCase();
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const marketLots = useMemo(() => allLots.filter(l => mktSet.has(l.artist)), [allLots, mktSet]);
  const rosterCount = useMemo(() => ARTISTS.filter(a => mktSet.has(a.slug)).length, [mktSet]);
  const { savedIds } = useSavedLots();

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  const summary = useMemo(() => {
    const live = Object.values(upcomingCounts).reduce((s, n) => s + n, 0);
    const ds = demandSeries(marketLots);
    const marketNow = ds.length ? ds[ds.length - 1].value : null;
    const liveMkt = ARTISTS.filter(a => mktSet.has(a.slug)).reduce((s, a) => s + (upcomingCounts[a.slug] || 0), 0);
    return { live: liveMkt, marketNow };
  }, [marketLots, upcomingCounts, mktSet]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      color: 'var(--color-fg)',
      fontFamily: 'var(--font-sans), sans-serif',
    }}>
      <ArtistNav activeSlug="artists" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {!fullLoaded ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          <section className="ray-hero2 rail ray-enter" style={{ paddingBottom: 8 }}>
            <div style={{ marginBottom: 18 }}><MarketSwitch compact /></div>
            <p className="ray-hero2-label">The {activeLabel} roster</p>
            <h1 className="ray-hero2-value" style={{ fontSize: 'clamp(34px, 4.5vw, 48px)' }}>
              <CountUp to={rosterCount} format={n => `${Math.round(n)} artists`} duration={900} />
            </h1>
            <p className="ray-hero2-delta">
              <span className="ctx">
                {summary.live} live lots on the block
                {summary.marketNow !== null && (
                  <>
                    {' '}· market demand{' '}
                    <b style={{ color: summary.marketNow >= 0 ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 700 }}>
                      {formatDemand(summary.marketNow)}
                    </b>
                  </>
                )}
              </span>
            </p>
          </section>

          <div className="ray-enter" style={{ '--enter-delay': '60ms' } as React.CSSProperties}>
            <ArtistSparklines statsByArtist={statsByArtist} allLots={allLots} limit={ARTISTS.length} market={activeKey} />
          </div>
        </RayEntrance>
      )}
    </div>
  );
}
