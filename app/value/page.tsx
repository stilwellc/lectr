'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import LotCard, { lotSignal } from '../components/LotCard';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import CountUp from '../components/CountUp';
import { getUpcomingCounts, formatPrice, formatDate } from '../utils';

/**
 * Value — the reason to open Ray every morning. Every live lot the signal
 * flags below market, ranked by how far under the comps it sits. The signal
 * is the same statistic everywhere: comps median vs estimate midpoint.
 */
export default function ValuePage() {
  const { allLots, statsByArtist, loading, fromCache } = useRayData();
  const { savedIds, toggle, isSaved } = useSavedLots();

  const deals = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return allLots
      .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today)
      .map(l => ({ lot: l, signal: lotSignal(l, allLots) }))
      .filter(d => d.signal && d.signal.label === 'Below Market')
      .sort((a, b) => (b.signal!.pct - a.signal!.pct));
  }, [allLots]);

  const summary = useMemo(() => {
    const withEst = deals.filter(d => (d.lot.estimateLow || 0) > 0 || (d.lot.estimateHigh || 0) > 0);
    const totalEst = withEst.reduce((s, d) => {
      const lo = d.lot.estimateLow || d.lot.estimateHigh || 0;
      const hi = d.lot.estimateHigh || d.lot.estimateLow || 0;
      return s + (lo + hi) / 2;
    }, 0);
    const pcts = deals.map(d => d.signal!.pct).sort((a, b) => a - b);
    const medianGap = pcts.length
      ? (pcts.length % 2 === 0 ? (pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2 : pcts[Math.floor(pcts.length / 2)])
      : 0;
    const soonest = [...deals].sort((a, b) => new Date(a.lot.saleDate).getTime() - new Date(b.lot.saleDate).getTime())[0] || null;
    const artists = new Set(deals.map(d => d.lot.artist)).size;
    return { totalEst, medianGap, soonest, artists };
  }, [deals]);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      color: 'var(--color-fg)',
      fontFamily: 'var(--font-sans), sans-serif',
    }}>
      <style>{`
        .ray-value-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
          gap: 30px 20px;
        }
        .ray-value-section { padding-block: 40px 64px; }
        @media (max-width: 768px) {
          .ray-value-grid { grid-template-columns: 1fr; gap: 26px; }
          .ray-value-section { padding-block: 32px 40px; }
        }
      `}</style>

      <ArtistNav activeSlug="value" savedCount={savedIds.length} upcomingCounts={upcomingCounts} />

      {loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          <section className="ray-hero2 rail ray-enter">
            <p className="ray-hero2-label">Value · below-market lots on the block</p>
            <h1 className="ray-hero2-value">
              <CountUp to={deals.length} format={n => Math.round(n).toString()} duration={900} />
            </h1>
            <p className="ray-hero2-delta">
              {deals.length > 0 && (
                <span className="up">comps run +{Math.round(summary.medianGap)}% over these estimates</span>
              )}
              <span className="ctx">
                {deals.length > 0
                  ? <>{formatPrice(summary.totalEst)} in estimates · {summary.artists} artists
                      {summary.soonest && <> · first hammer {formatDate(summary.soonest.lot.saleDate)}</>}</>
                  : 'No lots are flagged below market right now — the crawl refreshes daily.'}
              </span>
            </p>
          </section>

          <section className="ray-value-section rail">
            {deals.length === 0 ? (
              <div className="ray-enter" style={{ textAlign: 'center', padding: '40px 20px 100px', color: 'var(--color-text-faint)' }}>
                <p style={{ fontSize: 14, marginBottom: 20 }}>Check back after the next crawl, or browse everything live.</p>
                <Link href="/" className="link-action" style={{ color: 'var(--color-fg)' }}>
                  Browse upcoming lots <span className="arrow">&#8594;</span>
                </Link>
              </div>
            ) : (
              <>
                <h2 className="ray-h2 ray-enter" style={{ marginBottom: 18 }}>
                  Deepest value first
                </h2>
                <div className="ray-value-grid">
                  {deals.map((d, i) => (
                    <div
                      key={d.lot.id}
                      className="ray-enter-card"
                      style={{ '--enter-delay': `${Math.min(i, 8) * 60}ms` } as React.CSSProperties}
                    >
                      <LotCard
                        lot={d.lot}
                        showArtist
                        allLots={allLots}
                        stats={statsByArtist[d.lot.artist]}
                        saved={isSaved(d.lot.id)}
                        onToggleSave={toggle}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </RayEntrance>
      )}
    </div>
  );
}
