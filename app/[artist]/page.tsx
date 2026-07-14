'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ARTISTS, ARTIST_LABEL, marketOf } from '../constants';
import type { LotCategory } from '../types';
import { useRayData, retryFullLoad } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { useMarket } from '../lib/market';
import { getUpcomingCounts, formatDate } from '../utils';

import ArtistNav from '../components/ArtistNav';
import ArtistHero from '../components/ArtistHero';
import MarketSwitch from '../components/MarketSwitch';
import UpcomingLots from '../components/UpcomingLots';
import PastResults from '../components/PastResults';
import RayEntrance, { RayLoading } from '../components/RayEntrance';

const PriceChart = dynamic(() => import('../components/PriceChart'), { ssr: false });

type CategoryFilter = 'all' | LotCategory;

export default function ArtistDetailPage() {
  const params = useParams();
  const slug = params.artist as string;
  const { statsByArtist, allLots, lastCrawl, fullLoaded, fullError, fromCache } = useRayData();
  const { toggle, savedIds } = useSavedLots();
  const { setMarket } = useMarket();
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const label = ARTIST_LABEL[slug];
  const valid = ARTISTS.some(a => a.slug === slug);

  // A maker page IS its market: the switch under the nav lights the maker's
  // vertical, and the choice persists like landing on the vertical would.
  useEffect(() => {
    if (valid) setMarket(marketOf(slug));
    // once per maker — the user may still flip the switch afterwards
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, valid]);

  // Saves made here carry their baseline (est mid, signal, bids) so /saved
  // can say what changed since.
  const toggleWithLot = useCallback(
    (id: string) => toggle(id, allLots.find(l => l.id === id)),
    [toggle, allLots]
  );

  const stats = statsByArtist[slug] || null;
  // memoized on [allLots, slug]: the 32k filter + sort must not re-run on
  // every pill click / save toggle — and stable identities keep the memos
  // inside PriceChart/PastResults from re-aggregating the whole history
  const { lots, upcoming, sold } = useMemo(() => {
    const lots = allLots.filter(l => l.artist === slug);
    const today = new Date().toISOString().split('T')[0]; // Get YYYY-MM-DD string
    const upcoming = lots
      .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today)
      .sort((a, b) => {
        if (!a.saleDate) return 1;
        if (!b.saleDate) return -1;
        return new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime();
      });
    const sold = lots.filter(l => l.status === 'sold');
    return { lots, upcoming, sold };
  }, [allLots, slug]);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      color: 'var(--color-fg)',
      fontFamily: "var(--font-sans), sans-serif",
    }}>
      <ArtistNav activeSlug={slug} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {!valid ? (
        <div style={{ padding: '120px 24px', textAlign: 'center' }}>
          <h2 style={{
            fontFamily: 'var(--font-sans), sans-serif',
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            marginBottom: 10,
          }}>
            Nothing tracked at this address
          </h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 24 }}>
            The desk follows {ARTISTS.length} artists and makers across art, design, watches and science.
          </p>
          <Link href="/" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Back to the market
          </Link>
        </div>
      ) : (
        <>
          {/* The hero is un-gated: it paints from phase-1 statsByArtist the
              moment the stats land — the 32k archive only gates the lot-level
              sections below. */}
          <RayEntrance animate={!fromCache}>
            <div className="rail ray-enter" style={{ paddingTop: 16 }}>
              <MarketSwitch compact />
            </div>
            <div className="ray-enter" style={{ '--enter-delay': '60ms' } as React.CSSProperties}>
              <ArtistHero label={label} stats={stats} lots={lots} upcomingCount={upcoming.length} />
            </div>
          </RayEntrance>

          {!fullLoaded ? (
            fullError ? (
              // phase 2 (the full archive) failed after retries — say so and
              // offer a retry, never an eternal skeleton
              <div style={{ padding: '120px 24px', textAlign: 'center' }}>
                <h2 style={{
                  fontFamily: 'var(--font-sans), sans-serif',
                  fontSize: 32,
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  marginBottom: 10,
                }}>
                  The archive didn&rsquo;t load
                </h2>
                <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 24 }}>
                  The crawl couldn&rsquo;t fetch the full sale history. Check your connection and try again.
                </p>
                <button className="ray-call-btn ray-call-btn-primary" onClick={() => retryFullLoad()}>
                  Retry
                </button>
              </div>
            ) : (
              <RayLoading />
            )
          ) : (
            <RayEntrance animate={!fromCache}>
              {sold.length > 0 && (
                <div className="ray-enter" style={{ '--enter-delay': '90ms' } as React.CSSProperties}>
                  <PriceChart
                    lots={sold}
                    allLots={lots}
                    categoryFilter={categoryFilter}
                    onCategoryChange={setCategoryFilter}
                    fallbackData={stats?.priceHistory}
                    mark="01"
                  />
                </div>
              )}
              {upcoming.length > 0 && (
                <div id="upcoming">
                  <UpcomingLots
                    lots={upcoming}
                    allLots={allLots}
                    stats={stats || undefined}
                    savedIds={savedIds}
                    onToggleSave={toggleWithLot}
                    mark="02"
                    enterDelay={180}
                  />
                </div>
              )}
              {sold.length > 0 && (
                <div className="ray-enter" style={{ '--enter-delay': '270ms' } as React.CSSProperties}>
                  <PastResults
                    lots={sold}
                    categoryFilter={categoryFilter}
                    onCategoryChange={setCategoryFilter}
                    savedIds={savedIds}
                    onToggleSave={toggleWithLot}
                    mark="03"
                  />
                </div>
              )}
            </RayEntrance>
          )}
        </>
      )}
    </div>
  );
}
