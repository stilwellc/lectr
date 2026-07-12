'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ARTISTS, ARTIST_LABEL } from '../constants';
import type { LotCategory } from '../types';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { formatDate, getUpcomingCounts } from '../utils';

import ArtistNav from '../components/ArtistNav';
import StatsGrid from '../components/StatsGrid';
import UpcomingLots from '../components/UpcomingLots';
import PastResults from '../components/PastResults';
import RayHero from '../components/RayHero';
import RayEntrance, { RayLoading } from '../components/RayEntrance';

const PriceChart = dynamic(() => import('../components/PriceChart'), { ssr: false });

type CategoryFilter = 'all' | LotCategory;

export default function ArtistDetailPage() {
  const params = useParams();
  const slug = params.artist as string;
  const { statsByArtist, allLots, lastCrawl, loading, fromCache } = useRayData();
  const { toggle, savedIds } = useSavedLots();
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const label = ARTIST_LABEL[slug];
  const valid = ARTISTS.some(a => a.slug === slug);

  const stats = statsByArtist[slug] || null;
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

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      color: 'var(--color-fg)',
      fontFamily: "var(--font-sans), sans-serif",
    }}>
      <ArtistNav activeSlug={slug} savedCount={savedIds.length} upcomingCounts={upcomingCounts} />

      {!valid ? (
        <div style={{ padding: '120px 56px', textAlign: 'center' }}>
          <h2 style={{
            fontFamily: "var(--font-serif), serif",
            fontSize: 36,
            fontWeight: 300,
            marginBottom: 16,
          }}>
            Artist not found
          </h2>
          <Link href="/" className="link-action" style={{ color: 'var(--color-accent-wine-text)' }}>
            <span className="arrow" data-dir="back">&#8592;</span> Back to overview
          </Link>
        </div>
      ) : (
        <>
          <RayHero
            eyebrow="Artist Detail"
            title={<span style={{ fontStyle: 'italic', color: 'var(--color-accent-wine)' }}>{label}</span>}
            sub={loading
              ? '\u00A0' /* reserve the line — no zero-count flash while the crawl delivers */
              : <>{lots.length} lots across {stats?.houseDistribution?.length || 0} auction houses.</>}
            timestamp={lastCrawl ? formatDate(lastCrawl) : undefined}
          />

          {loading ? (
            <RayLoading />
          ) : (
            <RayEntrance animate={!fromCache}>
              {stats && (
                <div className="ray-enter">
                  <StatsGrid stats={stats} lots={lots} categoryFilter={categoryFilter} />
                </div>
              )}
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
                <UpcomingLots
                  lots={upcoming}
                  allLots={allLots}
                  stats={stats || undefined}
                  savedIds={savedIds}
                  onToggleSave={toggle}
                  mark="02"
                  enterDelay={180}
                />
              )}
              {sold.length > 0 && (
                <div className="ray-enter" style={{ '--enter-delay': '270ms' } as React.CSSProperties}>
                  <PastResults
                    lots={sold}
                    categoryFilter={categoryFilter}
                    onCategoryChange={setCategoryFilter}
                    savedIds={savedIds}
                    onToggleSave={toggle}
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
