'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import LotCard, { lotSignal } from '../components/LotCard';
import PastResults from '../components/PastResults';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import CountUp from '../components/CountUp';
import { getUpcomingCounts, formatPrice, formatDate } from '../utils';

function daysUntil(dateStr: string): number {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000));
}
function hammerWord(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/**
 * Saved — the watchlist. Answers "what am I watching and when must I act":
 * total estimate at stake, the next hammer, which of the watched lots the
 * signal flags as cheap — then the lots in urgency order.
 */
export default function SavedPage() {
  const { allLots, statsByArtist, lastCrawl, loading, fromCache } = useRayData();
  const { savedIds, toggle, isSaved } = useSavedLots();

  const savedLots = useMemo(() =>
    savedIds
      .map(id => allLots.find(l => l.id === id))
      .filter(Boolean) as typeof allLots,
    [savedIds, allLots]
  );

  const upcoming = useMemo(() =>
    savedLots
      .filter(l => l.status === 'upcoming')
      .sort((a, b) => new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime()),
    [savedLots]
  );

  const sold = useMemo(() =>
    savedLots
      .filter(l => l.status === 'sold')
      .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime()),
    [savedLots]
  );

  const summary = useMemo(() => {
    const withEst = upcoming.filter(l => (l.estimateLow || 0) > 0 || (l.estimateHigh || 0) > 0);
    const totalEst = withEst.reduce((s, l) => {
      const lo = l.estimateLow || l.estimateHigh || 0;
      const hi = l.estimateHigh || l.estimateLow || 0;
      return s + (lo + hi) / 2;
    }, 0);
    const flagged = upcoming.filter(l => {
      const sig = lotSignal(l, allLots);
      return sig && sig.label === 'Below Market';
    }).length;
    const next = upcoming[0] || null;
    return { totalEst, flagged, next };
  }, [upcoming, allLots]);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      color: 'var(--color-fg)',
      fontFamily: 'var(--font-sans), sans-serif',
    }}>
      <style>{`
        .ray-saved-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
          gap: 30px 20px;
        }
        .ray-saved-section { padding-block: 40px 48px; }
        @media (max-width: 768px) {
          .ray-saved-grid { grid-template-columns: 1fr; gap: 26px; }
          .ray-saved-section { padding-block: 32px 32px; }
        }
      `}</style>

      <ArtistNav activeSlug="saved" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {loading ? (
        <RayLoading />
      ) : savedLots.length === 0 ? (
        <RayEntrance animate={!fromCache}>
          <section className="ray-hero2 rail ray-enter">
            <p className="ray-hero2-label">Your watchlist</p>
            <h1 className="ray-hero2-value">—</h1>
            <p className="ray-hero2-delta">
              <span className="ctx">Nothing watched yet.</span>
            </p>
          </section>
          <div
            className="ray-enter"
            style={{
              textAlign: 'center',
              padding: '60px 20px 120px',
              color: 'var(--color-text-faint)',
            }}
          >
            <svg width="32" height="38" viewBox="0 0 12 14" fill="none" style={{ opacity: 0.2, margin: '0 auto 16px', display: 'block' }} aria-hidden="true">
              <path
                d="M1 1.5C1 1.22386 1.22386 1 1.5 1H10.5C10.7761 1 11 1.22386 11 1.5V12.5C11 12.6894 10.8862 12.8625 10.7096 12.9472C10.533 13.0319 10.3239 13.0136 10.1646 12.8994L6 9.91421L1.83541 12.8994C1.67614 13.0136 1.46698 13.0319 1.29037 12.9472C1.11377 12.8625 1 12.6894 1 12.5V1.5Z"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
            <p style={{ fontSize: 14, fontWeight: 400, marginBottom: 24 }}>
              Tap the bookmark on any lot to watch it here.
            </p>
            <Link href="/" className="link-action" style={{ color: 'var(--color-fg)' }}>
              Browse upcoming lots <span className="arrow">&#8594;</span>
            </Link>
          </div>
        </RayEntrance>
      ) : (
        <RayEntrance animate={!fromCache}>
          <section className="ray-hero2 rail ray-enter">
            <p className="ray-hero2-label">Your watchlist · total at stake</p>
            <h1 className="ray-hero2-value">
              {summary.totalEst > 0
                ? <CountUp to={summary.totalEst} format={formatPrice} duration={1100} />
                : `${upcoming.length || savedLots.length}`}
            </h1>
            <p className="ray-hero2-delta">
              {summary.next && (
                <span className="up">
                  next hammer {hammerWord(daysUntil(summary.next.saleDate))}
                </span>
              )}
              <span className="ctx">
                watching {upcoming.length} live {upcoming.length === 1 ? 'lot' : 'lots'}
                {summary.flagged > 0 && <> · {summary.flagged} below market</>}
                {sold.length > 0 && <> · {sold.length} concluded</>}
              </span>
            </p>

            <div className="ray-strip" style={{ marginTop: 22 }}>
              <div>
                <div className="ray-strip-k">Watching</div>
                <div className="ray-strip-v">{upcoming.length}</div>
                <div className="ray-strip-s">live lots on the block</div>
              </div>
              <div>
                <div className="ray-strip-k">Total estimate</div>
                <div className="ray-strip-v">{summary.totalEst > 0 ? formatPrice(summary.totalEst) : '—'}</div>
                <div className="ray-strip-s">aggregate mid-estimates</div>
              </div>
              <div>
                <div className="ray-strip-k">Below market</div>
                <div className="ray-strip-v" style={summary.flagged > 0 ? { color: 'var(--color-up)' } : undefined}>
                  {summary.flagged}
                </div>
                <div className="ray-strip-s">flagged against comps</div>
              </div>
              <div>
                <div className="ray-strip-k">Next hammer</div>
                <div className="ray-strip-v">{summary.next ? formatDate(summary.next.saleDate) : '—'}</div>
                <div className="ray-strip-s">
                  {summary.next ? hammerWord(daysUntil(summary.next.saleDate)) : 'nothing scheduled'}
                </div>
              </div>
            </div>
          </section>

          {upcoming.length > 0 && (
            <section className="ray-saved-section rail">
              <h2 className="ray-h2 ray-enter" style={{ marginBottom: 18 }}>
                On the block, soonest first
              </h2>
              <div className="ray-saved-grid">
                {upcoming.map((lot, i) => (
                  <div
                    key={lot.id}
                    className="ray-enter-card"
                    style={{ '--enter-delay': `${Math.min(i, 8) * 60}ms` } as React.CSSProperties}
                  >
                    <LotCard
                      lot={lot}
                      showArtist
                      allLots={allLots}
                      stats={statsByArtist[lot.artist]}
                      saved={isSaved(lot.id)}
                      onToggleSave={toggle}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {sold.length > 0 && (
            <div className="ray-enter" style={{ '--enter-delay': '90ms' } as React.CSSProperties}>
              <PastResults lots={sold} showArtist savedIds={savedIds} onToggleSave={toggle} />
            </div>
          )}
        </RayEntrance>
      )}
    </div>
  );
}
