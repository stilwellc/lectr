'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import SubMarketDrills from '../../components/analytics/SubMarketDrills';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ARTISTS, ARTIST_LABEL, marketOf } from '../../constants';
import type { AuctionLot, LotCategory, MarketStats } from '../../types';
import { useFullLots, retryFullLoad, useSoldArchive, retryArchiveLoad } from '../../hooks/useRayData';
import { useSavedLots } from '../../hooks/useSavedLots';
import { useMarket } from '../../lib/market';
import { getUpcomingCounts, formatDate, localToday, isLiveUpcoming } from '../../utils';

import ArtistNav from '../../components/ArtistNav';
import ArtistHero from '../../components/ArtistHero';
import MarketSwitch from '../../components/MarketSwitch';
import UpcomingLots from '../../components/UpcomingLots';
import PastResults from '../../components/PastResults';
import RayEntrance, { RayLoading } from '../../components/RayEntrance';
import { Colophon } from '../../components/Terminal';

const PriceChart = dynamic(() => import('../../components/PriceChart'), { ssr: false });

type CategoryFilter = 'all' | LotCategory;

// A retry-able "the archive didn't load" panel — shared by the phase-2
// (fullError) and phase-3 (archiveError) failure paths so a gated section
// never stalls on an eternal skeleton.
function ArchiveErrorPanel({ onRetry }: { onRetry: () => void }) {
  return (
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
      <button className="ray-call-btn ray-call-btn-primary" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

// The gated sold/upcoming sections. `sold`/`chartLots` already carry any
// merged archive rows; the hero re-renders with them too. Kept as a leaf so
// both the standard (phase-2) and archive (phase-3) bodies reuse it verbatim.
function MakerSections({
  slug,
  stats,
  label,
  chartLots,
  upcoming,
  sold,
  allLots,
  savedIds,
  onToggleSave,
  ownedIds,
  onToggleOwned,
  categoryFilter,
  onCategoryChange,
  fromCache,
}: {
  slug: string;
  stats: MarketStats | null;
  label: string;
  chartLots: AuctionLot[];
  upcoming: AuctionLot[];
  sold: AuctionLot[];
  allLots: AuctionLot[];
  savedIds: string[];
  onToggleSave: (id: string) => void;
  ownedIds: string[];
  onToggleOwned: (id: string) => void;
  categoryFilter: CategoryFilter;
  onCategoryChange: (c: CategoryFilter) => void;
  fromCache: boolean;
}) {
  return (
    <RayEntrance animate={!fromCache}>
      {sold.length === 0 && upcoming.length === 0 && (
        <div className="rail ray-enter" style={{ padding: '72px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 16, color: 'var(--color-text-secondary)', margin: 0 }}>
            No lots tracked for {label} right now.
          </p>
          <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: '8px 0 0' }}>
            The desk refreshes daily as auction houses post new sales and results.
          </p>
        </div>
      )}
      {sold.length > 0 && (
        <div className="ray-enter" style={{ '--enter-delay': '90ms' } as React.CSSProperties}>
          <PriceChart
            lots={sold}
            allLots={chartLots}
            categoryFilter={categoryFilter}
            onCategoryChange={onCategoryChange}
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
            onToggleSave={onToggleSave}
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
            onCategoryChange={onCategoryChange}
            savedIds={savedIds}
            onToggleSave={onToggleSave}
            ownedIds={ownedIds}
            onToggleOwned={onToggleOwned}
            mark="03"
          />
        </div>
      )}
    </RayEntrance>
  );
}

export default function ArtistDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  // useFullLots (not useRayData): the lot-level sections below gate on
  // fullLoaded, so this route must trigger the phase-2 corpus on mount.
  const { statsByArtist, allLots, lastCrawl, fullLoaded, fullError, fromCache, market: marketData } = useFullLots();
  const { toggle, savedIds, ownedIds, toggleOwned } = useSavedLots();
  const { setMarket } = useMarket();
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const label = ARTIST_LABEL[slug];
  const valid = ARTISTS.some(a => a.slug === slug);
  // A sports/science maker's Goldin sold history lives in the phase-3 archive
  // (split out of the eager + phase-2 payloads). Only these makers pay for it —
  // art/design/watches/culture makers never mount useSoldArchive() (Goldin
  // culture sold rows are deliberately kept in the phase-2 shards).
  const market = marketOf(slug);
  const isArchiveMaker = valid && (market === 'sports' || market === 'science');

  // A maker page IS its market: the switch under the nav lights the maker's
  // vertical, and the choice persists like landing on the vertical would.
  useEffect(() => {
    if (valid) setMarket(market);
    // once per maker — the user may still flip the switch afterwards
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, valid]);

  // Saves made here carry their baseline (est mid, signal, bids) so /profile
  // can say what changed since.
  const toggleWithLot = useCallback(
    (id: string) => toggle(id, allLots.find(l => l.id === id)),
    [toggle, allLots]
  );

  const stats = statsByArtist[slug] || null;
  // memoized on [allLots, slug]: the full-corpus filter + sort must not re-run
  // on every pill click / save toggle — and stable identities keep the memos
  // inside PriceChart/PastResults from re-aggregating the whole history.
  // `sold` lives here too: an inline filter in the JSX would hand PastResults
  // a fresh array identity every render, defeating exactly that.
  const { lots, upcoming, sold } = useMemo(() => {
    const lots = allLots.filter(l => l.artist === slug);
    const today = localToday(); // the reader's local YYYY-MM-DD
    const upcoming = lots
      .filter(l => isLiveUpcoming(l, today))
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
            The desk follows {ARTISTS.length} artists and makers across art, design, watches, sports, science and pop culture.
          </p>
          <Link href="/" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Back to the market
          </Link>
        </div>
      ) : (
        <>
          {/* The hero is un-gated: it paints from phase-1 statsByArtist the
              moment the stats land — the phase-2 corpus only gates the lot-level
              sections below. For archive makers it re-renders with merged
              sold rows once phase 3 arrives (ArchiveMakerBody re-renders it). */}
          {!isArchiveMaker && (
            <RayEntrance animate={!fromCache}>
              <div className="rail ray-enter" style={{ paddingTop: 'var(--space-4)' }}>
                <MarketSwitch compact />
              </div>
              <div className="ray-enter" style={{ '--enter-delay': '60ms' } as React.CSSProperties}>
                <ArtistHero animate={!fromCache} slug={slug} serial={lastCrawl ? lastCrawl.slice(0, 10).replace(/-/g, '') : undefined} label={label} stats={stats} lots={lots} upcomingCount={upcoming.length} market={market} />
              </div>
              {/* watch makers: the model-family ledger — pre-aggregated drill
                  rows scoped to this maker (Daytona vs Cellini, honest reads) */}
              {market === 'watches' && (
                <div className="rail ray-enter" style={{ '--enter-delay': '80ms', paddingTop: 8 } as React.CSSProperties}>
                  <SubMarketDrills marketData={marketData} scope="watches" parentFilter={slug} title="Model families" method={`${label} sub-markets · performance by family`} />
                </div>
              )}
            </RayEntrance>
          )}

          {isArchiveMaker ? (
            <ArchiveMakerBody
              slug={slug}
              serial={lastCrawl ? lastCrawl.slice(0, 10).replace(/-/g, '') : undefined}
              label={label}
              stats={stats}
              phaseLots={lots}
              upcoming={upcoming}
              savedIds={savedIds}
              onToggleSave={toggleWithLot}
              ownedIds={ownedIds}
              onToggleOwned={toggleOwned}
              categoryFilter={categoryFilter}
              onCategoryChange={setCategoryFilter}
              fromCache={fromCache}
            />
          ) : !fullLoaded ? (
            fullError ? (
              // phase 2 (the full archive) failed after retries — say so and
              // offer a retry, never an eternal skeleton
              <ArchiveErrorPanel onRetry={() => retryFullLoad()} />
            ) : (
              <RayLoading />
            )
          ) : (
            <MakerSections
              slug={slug}
              label={label}
              stats={stats}
              chartLots={lots}
              upcoming={upcoming}
              sold={sold}
              allLots={allLots}
              savedIds={savedIds}
              onToggleSave={toggleWithLot}
              ownedIds={ownedIds}
              onToggleOwned={toggleOwned}
              categoryFilter={categoryFilter}
              onCategoryChange={setCategoryFilter}
              fromCache={fromCache}
            />
          )}

          {/* the closing colophon — corpus counts from meta.json */}
          <Colophon record={null} />
        </>
      )}
    </div>
  );
}

// Archive makers only: mounting this triggers useSoldArchive()'s phase-3
// fetch. It merges the maker's archive sold rows into lots/sold and re-renders
// the hero + the gated sections once the archive lands (RayLoading /
// archiveError-retry until then, mirroring the phase-2 fullError pattern).
function ArchiveMakerBody({
  slug,
  serial,
  label,
  stats,
  phaseLots,
  upcoming,
  savedIds,
  onToggleSave,
  ownedIds,
  onToggleOwned,
  categoryFilter,
  onCategoryChange,
  fromCache,
}: {
  slug: string;
  serial?: string;
  label: string;
  stats: MarketStats | null;
  phaseLots: AuctionLot[];
  upcoming: AuctionLot[];
  savedIds: string[];
  onToggleSave: (id: string) => void;
  ownedIds: string[];
  onToggleOwned: (id: string) => void;
  categoryFilter: CategoryFilter;
  onCategoryChange: (c: CategoryFilter) => void;
  fromCache: boolean;
}) {
  const { allLotsWithArchive, archiveLoaded, archiveError } = useSoldArchive();

  // the maker's full lot set with archive sold rows merged in
  const makerLots = useMemo(
    () => (archiveLoaded ? allLotsWithArchive.filter(l => l.artist === slug) : phaseLots),
    [archiveLoaded, allLotsWithArchive, slug, phaseLots]
  );
  const sold = useMemo(() => makerLots.filter(l => l.status === 'sold'), [makerLots]);

  return (
    <>
      <RayEntrance animate={!fromCache}>
        <div className="rail ray-enter" style={{ paddingTop: 'var(--space-4)' }}>
          <MarketSwitch compact />
        </div>
        <div className="ray-enter" style={{ '--enter-delay': '60ms' } as React.CSSProperties}>
          <ArtistHero animate={!fromCache} slug={slug} serial={serial} label={label} stats={stats} lots={makerLots} upcomingCount={upcoming.length} bidMarket market={marketOf(slug)} />
        </div>
      </RayEntrance>

      {!archiveLoaded ? (
        archiveError ? (
          <ArchiveErrorPanel onRetry={() => retryArchiveLoad()} />
        ) : (
          <RayLoading />
        )
      ) : (
        <MakerSections
          slug={slug}
          label={label}
          stats={stats}
          chartLots={makerLots}
          upcoming={upcoming}
          sold={sold}
          allLots={makerLots}
          savedIds={savedIds}
          onToggleSave={onToggleSave}
          ownedIds={ownedIds}
          onToggleOwned={onToggleOwned}
          categoryFilter={categoryFilter}
          onCategoryChange={onCategoryChange}
          fromCache={fromCache}
        />
      )}
    </>
  );
}
