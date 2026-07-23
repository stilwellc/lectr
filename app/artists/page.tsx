'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ARTISTS, MARKETS, marketArtists, rosterNoun } from '../constants';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import { useFullLots } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import { formatDate, getUpcomingCounts } from '../utils';
import { demandSeries, formatDemand } from '../lib/demand';
import CountUp from '../components/CountUp';
import Masthead, { Accent } from '../components/Masthead';
import { Colophon } from '../components/Terminal';
import meta from '../../public/data/ray/meta.json';

const ArtistSparklines = dynamic(() => import('../components/analytics/ArtistSparklines'), { ssr: false });

/**
 * Makers — the roster as a wall of demand curves. Every tracked name (artist,
 * designer, watch maker, science collection, or sports category), each a live
 * market read, one click to its page. The noun follows the market — they are
 * not all artists.
 */
export default function ArtistsPage() {
  // useFullLots: the sparklines gate on fullLoaded, so trigger phase 2.
  const { allLots, statsByArtist, lastCrawl, fullLoaded, fromCache } = useFullLots();
  const { market } = useMarket();
  const activeKey = MARKETS.find(m => m.key === market)?.live ? market : 'all';
  const activeLabel = activeKey === 'all' ? 'full' : MARKETS.find(m => m.key === activeKey)!.label.toLowerCase();
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const marketLots = useMemo(() => allLots.filter(l => mktSet.has(l.artist)), [allLots, mktSet]);
  const rosterCount = useMemo(() => ARTISTS.filter(a => mktSet.has(a.slug)).length, [mktSet]);
  const { savedIds } = useSavedLots();

  // the roster noun follows the market — 'all' has no noun, so name it
  const noun = activeKey === 'all' ? (rosterCount === 1 ? 'tracked name' : 'tracked names') : rosterNoun(activeKey, rosterCount);

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
          <section className="rail ray-enter" style={{ paddingTop: 24, paddingBottom: 8 }}>
            <div style={{ marginBottom: 22 }}><MarketSwitch compact /></div>
            {/* the certificate masthead — roster count rides the serial slot */}
            <Masthead
              kicker={`The roster · ${activeLabel} market`}
              datum={<CountUp to={rosterCount} format={n => `${Math.round(n)} ${noun}`} duration={900} />}
              title={<>Every maker, read as a <Accent>demand curve</Accent>.</>}
              sub={
                <>
                  {rosterCount} {noun} ·{' '}
                  <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {summary.live} live lots
                  </b>{' '}
                  on the block
                  {summary.marketNow !== null && (
                    <>
                      {' '}· market demand{' '}
                      <b style={{ color: summary.marketNow >= 0 ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {formatDemand(summary.marketNow)}
                      </b>
                    </>
                  )}
                </>
              }
            />
          </section>

          <div className="ray-enter" style={{ '--enter-delay': '60ms' } as React.CSSProperties}>
            <ArtistSparklines statsByArtist={statsByArtist} allLots={allLots} limit={ARTISTS.length} market={activeKey} />
          </div>

          {/* the closing colophon — corpus counts from meta.json */}
          <Colophon lotCount={meta.totalLots} houseCount={meta.sources.length} record={null} />
        </RayEntrance>
      )}
    </div>
  );
}
