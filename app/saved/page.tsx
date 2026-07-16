'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots, SavedMeta } from '../hooks/useSavedLots';
import { useAuth } from '../lib/account';
import ArtistNav from '../components/ArtistNav';
import LotCard, { lotSignal } from '../components/LotCard';
import PastResults from '../components/PastResults';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import CountUp from '../components/CountUp';
import { getUpcomingCounts, formatPrice, formatDate } from '../utils';

function daysUntil(dateStr: string): number {
  const t = new Date(dateStr).getTime();
  if (isNaN(t)) return NaN;
  return Math.max(0, Math.ceil((t - Date.now()) / 86_400_000));
}
function hammerWord(days: number): string {
  if (isNaN(days)) return 'scheduled';   // never render "in NaN days"
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
function fmtPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${Math.round(pct)}%`;
}

/** What changed on a watched lot since the save — signal move and new bids.
    Renders nothing when there's no baseline (pre-upgrade saves) or nothing
    moved: absence of data is never dressed as a delta. */
function SavedDelta({ lot, meta, allLots }: { lot: AuctionLot; meta?: SavedMeta; allLots: AuctionLot[] }) {
  const cur = lotSignal(lot, allLots);
  const signalMoved =
    meta?.signalPct != null && cur !== null && Math.round(cur.pct) !== Math.round(meta.signalPct);
  const newBids =
    meta?.bidCount != null && (lot.bidCount || 0) > meta.bidCount
      ? (lot.bidCount || 0) - meta.bidCount
      : 0;
  if (!signalMoved && newBids === 0) return null;
  return (
    <p className="ray-saved-delta">
      {signalMoved && cur && meta && (
        <span>
          signal {fmtPct(meta.signalPct!)} →{' '}
          <b style={{ color: cur.pct > meta.signalPct! ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 700 }}>
            {fmtPct(cur.pct)}
          </b>{' '}
          since you saved
        </span>
      )}
      {signalMoved && newBids > 0 && ' · '}
      {newBids > 0 && <span>{newBids} new {newBids === 1 ? 'bid' : 'bids'}</span>}
    </p>
  );
}

/**
 * Saved — the watchlist. Answers "what am I watching and when must I act":
 * total estimate at stake, the next hammer, which of the watched lots the
 * signal flags as cheap — then the lots in urgency order.
 */
export default function SavedPage() {
  const { allLots, lastCrawl, loading, fullLoaded, fromCache } = useRayData();
  const { savedIds, savedMeta, toggle, isSaved } = useSavedLots();
  const { authEnabled, user, authReady, openLogin } = useAuth();

  const savedLots = useMemo(() =>
    savedIds
      .map(id => allLots.find(l => l.id === id))
      .filter(Boolean) as typeof allLots,
    [savedIds, allLots]
  );

  // Saved ids the crawl no longer carries — they render as stub rows, never
  // as silence, and they never count toward the nav badge.
  const orphanIds = useMemo(() => {
    if (!fullLoaded) return [] as string[];
    const have = new Set(allLots.map(l => l.id));
    return savedIds.filter(id => !have.has(id));
  }, [savedIds, allLots, fullLoaded]);

  // The nav badge counts renderable lots only; before the full archive lands
  // we can't yet judge orphans, so the raw count stands in.
  const badgeCount = fullLoaded ? savedLots.length : savedIds.length;

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

  // Anything you saved that is neither upcoming nor sold (bought-in, withdrawn,
  // results-pending-that-lapsed, etc.) — it must STILL appear. A saved lot never
  // silently vanishes from your watchlist just because its status changed.
  const other = useMemo(() =>
    savedLots
      .filter(l => l.status !== 'upcoming' && l.status !== 'sold')
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

  // Aggregate "what changed" for the hero sub-line: how many watched signals
  // moved and how many new bids arrived since each lot was saved.
  const changes = useMemo(() => {
    let moved = 0;
    let newBids = 0;
    for (const lot of upcoming) {
      const meta = savedMeta[lot.id];
      if (!meta) continue;
      const cur = lotSignal(lot, allLots);
      if (meta.signalPct != null && cur !== null && Math.round(cur.pct) !== Math.round(meta.signalPct)) moved++;
      if (meta.bidCount != null && (lot.bidCount || 0) > meta.bidCount) newBids += (lot.bidCount || 0) - meta.bidCount;
    }
    return { moved, newBids };
  }, [upcoming, savedMeta, allLots]);

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
        .ray-saved-delta {
          margin: 8px 2px 0;
          font-size: 12.5px;
          color: var(--color-text-muted);
        }
        .ray-saved-orphan {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--color-border);
          font-size: 13px;
          color: var(--color-text-muted);
        }
        .ray-saved-orphan:last-child { border-bottom: none; }
        @media (max-width: 768px) {
          .ray-saved-grid { grid-template-columns: 1fr; gap: 26px; }
          .ray-saved-section { padding-block: 32px 32px; }
        }
      `}</style>

      <ArtistNav activeSlug="saved" savedCount={badgeCount} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {authEnabled && authReady && !user ? (
        /* The ONLY auth-gated surface — saved lots are scoped to a user. */
        <RayEntrance animate>
          <section className="ray-hero2 rail ray-enter" style={{ paddingBottom: 8 }}>
            <p className="ray-hero2-label">Your watchlist</p>
            <h1 className="ray-hero2-value">Track the lots you&rsquo;re watching</h1>
            <p className="ray-hero2-delta">
              <span style={{ maxWidth: 460 }}>
                Private to you, synced across every device. lectr follows each saved lot&rsquo;s hammer,
                its comps, and how your call played out.
              </span>
            </p>
          </section>
          <div className="ray-enter" style={{ textAlign: 'center', padding: '28px 20px 72px' }}>
            <button className="ray-call-btn ray-call-btn-primary" style={{ border: 'none', cursor: 'pointer' }} onClick={openLogin}>
              Sign in with Google
            </button>
            <p style={{ fontSize: 12.5, color: 'var(--color-text-faint)', margin: '14px 0 0' }}>
              Free · one tap · nothing else on lectr is gated.
            </p>
          </div>
        </RayEntrance>
      ) : loading ? (
        <RayLoading />
      ) : savedLots.length === 0 && orphanIds.length === 0 ? (
        <RayEntrance animate={!fromCache}>
          <section className="ray-hero2 rail ray-enter">
            <p className="ray-hero2-label">Your watchlist</p>
            <h1 className="ray-hero2-value" style={{ color: 'var(--color-text-faint)' }}>0</h1>
            <p className="ray-hero2-delta">
              <span className="ctx">
                Every collector starts by watching. Bookmark a lot and lectr tracks its
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
              {(changes.moved > 0 || changes.newBids > 0) && (
                <span className="ctx" style={{ display: 'block', marginTop: 4 }}>
                  since you saved
                  {changes.moved > 0 && <> · {changes.moved} {changes.moved === 1 ? 'signal' : 'signals'} moved</>}
                  {changes.newBids > 0 && <> · {changes.newBids} new {changes.newBids === 1 ? 'bid' : 'bids'}</>}
                </span>
              )}
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
                      onToggleSave={id => toggle(id, lot)}
                    />
                    <SavedDelta lot={lot} meta={savedMeta[lot.id]} allLots={allLots} />
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

          {other.length > 0 && (
            <section className="ray-saved-section rail">
              <h2 className="ray-h2 ray-enter" style={{ marginBottom: 6 }}>Concluded &amp; other</h2>
              <p className="ray-enter" style={{ fontSize: 13, color: 'var(--color-text-faint)', margin: '0 0 18px' }}>
                Saved lots that closed without a published hammer, were bought in, or are awaiting results.
              </p>
              <div className="ray-saved-grid">
                {other.map((lot, i) => (
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
                      onToggleSave={id => toggle(id, lot)}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {orphanIds.length > 0 && (
            <section className="rail ray-enter" style={{ paddingBlock: '34px 64px' }}>
              <h2 className="ray-h2" style={{ marginBottom: 6 }}>No longer on the block</h2>
              <p style={{ fontSize: 13, color: 'var(--color-text-faint)', margin: '0 0 14px' }}>
                Saved lots the crawl no longer carries — withdrawn, relisted or purged by the house.
              </p>
              <div className="glass glass-quiet">
                {orphanIds.map(id => {
                  const meta = savedMeta[id];
                  return (
                    <div key={id} className="ray-saved-orphan">
                      <span>
                        No longer listed — removed from the block
                        {meta && (
                          <span style={{ color: 'var(--color-text-faint)' }}>
                            {' '}· saved {formatDate(meta.savedAt)}
                            {meta.estMid != null && <> · was est. {formatPrice(meta.estMid)}</>}
                          </span>
                        )}
                      </span>
                      <button
                        className="ray-call-btn ray-call-btn-quiet"
                        style={{ flexShrink: 0 }}
                        onClick={() => toggle(id)}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </RayEntrance>
      )}
    </div>
  );
}
