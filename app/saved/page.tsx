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
            <h1 className="ray-hero2-value" style={{ color: 'var(--color-text-faint)' }}>0</h1>
            <p className="ray-hero2-delta">
              <span className="ctx">
                Every collector starts by watching. Bookmark a lot and Ray tracks its
                hammer, its comps, and — once it concludes — how your eye did.
              </span>
            </p>
          </section>
          <div
            className="ray-enter"
            style={{
              textAlign: 'center',
              padding: '48px 20px 120px',
            }}
          >
            <Link href="/value" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
              Start with today&rsquo;s below-market lots
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
                <div className="ray-strip-v"><CountUp to={upcoming.length} format={n => `${Math.round(n)}`} duration={1000} /></div>
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
                  <CountUp to={summary.flagged} format={n => `${Math.round(n)}`} duration={1000} />
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
              {/* The outcome — how your eye did once the hammer fell */}
              {(() => {
                const judged = sold.filter(l => l.priceUsd && l.estimateLow && l.estimateHigh);
                if (!judged.length) return null;
                const pcts = judged
                  .map(l => (l.priceUsd! / ((l.estimateLow! + l.estimateHigh!) / 2) - 1) * 100)
                  .sort((a, b) => a - b);
                const medianPct = Math.round(pcts.length % 2 === 0
                  ? (pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2
                  : pcts[Math.floor(pcts.length / 2)]);
                const hammered = judged.reduce((s, l) => s + l.priceUsd!, 0);
                return (
                  <section className="rail" style={{ paddingTop: 34 }}>
                    <h2 className="ray-h2" style={{ marginBottom: 6 }}>How your eye did</h2>
                    <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: 0 }}>
                      {judged.length} watched {judged.length === 1 ? 'lot' : 'lots'} concluded ·{' '}
                      {formatPrice(hammered)} hammered · your picks went{' '}
                      <b style={{ color: medianPct >= 0 ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 700 }}>
                        {medianPct >= 0 ? '+' : ''}{medianPct}%
                      </b>{' '}
                      vs estimate, median
                    </p>
                  </section>
                );
              })()}
              <PastResults lots={sold} showArtist savedIds={savedIds} onToggleSave={toggle} />
            </div>
          )}
        </RayEntrance>
      )}
    </div>
  );
}
