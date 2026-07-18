'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots, SavedMeta } from '../hooks/useSavedLots';
import { useAuth } from '../lib/account';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';
import LotCard, { lotSignal } from '../components/LotCard';
import { appraiseLot, soldCompBand, isSportsScienceObject } from '../lib/comps';
import PastResults from '../components/PastResults';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import CountUp from '../components/CountUp';
import Masthead, { Accent } from '../components/Masthead';
import Flick from '../components/Flick';
import meta from '../../public/data/ray/meta.json';
import { getUpcomingCounts, formatPrice, formatDate, craftTitle, fmtSignedPct } from '../utils';
import { ARTIST_LABEL } from '../constants';

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
          signal {fmtSignedPct(meta.signalPct!)} <Flick size={10} style={{ marginLeft: 0 }} />{' '}
          <b style={{ color: cur.pct > meta.signalPct! ? 'var(--color-up)' : 'var(--color-down-text)', fontWeight: 700 }}>
            {fmtSignedPct(cur.pct)}
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
  const { savedIds, savedMeta, toggle, isSaved, ownedIds, toggleOwned } = useSavedLots();
  const { authEnabled, user, authReady, savedReady, signInWithGoogle, signOut } = useAuth();

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

  // YOUR COLLECTION — saved past lots the user marked as owned. Each piece
  // carries TWO figures: the BOUGHT price (what it realized on the block) and
  // lectr's APPRAISAL — the median its comparable pool currently trades at
  // (same pools and guards as the card signal, returned unconditionally);
  // estimate-less sports/science pieces appraise off the realized comp band.
  const collection = useMemo(() => {
    const ownedSet = new Set(ownedIds);
    const rows = savedLots
      .filter(l => ownedSet.has(l.id))
      .map(l => {
        const paid = l.priceUsd || null;
        const appr = appraiseLot(l, allLots);
        const band = !appr && isSportsScienceObject(l) ? soldCompBand(l, allLots) : null;
        const appraised = appr?.value ?? band?.median ?? null;
        const basis = appr ? `${appr.n} comps` : band ? `${band.n} realized comps` : null;
        const deltaPct = paid && appraised ? Math.round((appraised / paid - 1) * 100) : null;
        return { lot: l, paid, appraised, basis, deltaPct };
      })
      .sort((a, b) => (b.appraised ?? b.paid ?? 0) - (a.appraised ?? a.paid ?? 0));
    const totalPaid = rows.reduce((s, r) => s + (r.paid || 0), 0);
    // the collection total carries un-appraisable pieces at their bought price
    const totalAppraised = rows.reduce((s, r) => s + (r.appraised ?? r.paid ?? 0), 0);
    return { rows, totalPaid, totalAppraised };
  }, [savedLots, ownedIds, allLots]);

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
    // next hammer = genuinely future only (past-dated resultsPending lots are
    // watched, but they already hammered — they can't be "next")
    const todayIso = new Date().toISOString().slice(0, 10);
    const next = upcoming.find(l => l.saleDate && l.saleDate.slice(0, 10) >= todayIso) || null;
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

  // The verdict — how your eye did once the hammer fell. Rendered as the sub
  // line of the results table rather than a standalone section.
  const verdict = useMemo<React.ReactNode>(() => {
    const judged = sold.filter(l => l.priceUsd && l.estimateLow && l.estimateHigh);
    if (!judged.length) return undefined;
    const pcts = judged
      .map(l => (l.priceUsd! / ((l.estimateLow! + l.estimateHigh!) / 2) - 1) * 100)
      .sort((a, b) => a - b);
    const medianPct = Math.round(pcts.length % 2 === 0
      ? (pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2
      : pcts[Math.floor(pcts.length / 2)]);
    const hammered = judged.reduce((s, l) => s + l.priceUsd!, 0);
    return (
      <>
        How your eye did: {judged.length} watched {judged.length === 1 ? 'lot' : 'lots'} concluded ·{' '}
        {formatPrice(hammered)} hammered · your picks went{' '}
        <b style={{ color: medianPct >= 0 ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 700 }}>
          {fmtSignedPct(medianPct)}
        </b>{' '}
        vs estimate, median
      </>
    );
  }, [sold]);

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

      {/* the quiet account row — sign-out lives on the profile now, not in the
          nav. Right-aligned over the masthead; renders for signed-in users in
          EVERY profile state (watchlist, empty, loading), so sign-out is never
          unreachable. */}
      {authEnabled && authReady && user && (
        <div className="rail" style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 14 }}>
          <button
            className="ray-call-btn ray-call-btn-quiet"
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12.5, padding: '4px 0' }}
            onClick={() => signOut()}
          >
            {user.email || 'account'} · Sign out
          </button>
        </div>
      )}

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
          {/* paddingBlock, not the padding shorthand — the shorthand zeroes the
              inline padding and kills the .rail clamp */}
          <div className="rail ray-enter" style={{ paddingBlock: '26px 72px' }}>
            <button className="ray-call-btn ray-call-btn-primary" style={{ border: 'none', cursor: 'pointer' }} onClick={() => signInWithGoogle()}>
              Sign in with Google
            </button>
            <p style={{ fontSize: 12.5, color: 'var(--color-text-faint)', margin: '14px 0 0' }}>
              Free · one tap · nothing else on lectr is gated.
            </p>
          </div>
        </RayEntrance>
      ) : loading || !authReady || !savedReady ? (
        /* hold the loading state until the saved-lots load has RESOLVED — a
           signed-in user must never flash the "0" empty state mid-fetch */
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
          <section className="rail ray-enter" style={{ paddingTop: 24 }}>
            {/* the certificate masthead — the stake IS the accent figure */}
            <Masthead
              kicker="My profile"
              serial={lastCrawl || undefined}
              title={summary.totalEst > 0
                ? <>
                    Watching{' '}
                    <Accent>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        <CountUp to={summary.totalEst} format={formatPrice} duration={1100} />
                      </span>
                    </Accent>{' '}
                    to the hammer.
                  </>
                : <>
                    Watching <Accent>{upcoming.length || savedLots.length} {(upcoming.length || savedLots.length) === 1 ? 'lot' : 'lots'}</Accent> to the hammer.
                  </>}
              sub={
                <>
                  {summary.next && <>Next hammer {hammerWord(daysUntil(summary.next.saleDate))} · </>}
                  watching {upcoming.length} live {upcoming.length === 1 ? 'lot' : 'lots'}
                  {summary.flagged > 0 && (
                    <>
                      {' '}·{' '}
                      <b style={{ color: 'var(--color-up)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {summary.flagged} below market
                      </b>
                    </>
                  )}
                  {sold.length > 0 && <> · {sold.length} concluded</>}
                  {(changes.moved > 0 || changes.newBids > 0) && (
                    <>
                      {' '}· since you saved
                      {changes.moved > 0 && <> · {changes.moved} {changes.moved === 1 ? 'signal' : 'signals'} moved</>}
                      {changes.newBids > 0 && <> · {changes.newBids} new {changes.newBids === 1 ? 'bid' : 'bids'}</>}
                    </>
                  )}
                </>
              }
            />
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

          {collection.rows.length > 0 && (
            /* the collection rides the paper banner — pure type + numerals */
            <div className="ray-band ray-enter" style={{ marginTop: 30, paddingBlock: '28px 30px' }}>
              <section className="rail" aria-label="Your collection">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 14px', marginBottom: 6 }}>
                  <h2 className="ray-h2" style={{ margin: 0 }}>Your collection</h2>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                    {collection.rows.length} {collection.rows.length === 1 ? 'piece' : 'pieces'} · bought{' '}
                    <b style={{ color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(collection.totalPaid)}</b>
                    {' '}· lectr appraisal{' '}
                    <b style={{ color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(collection.totalAppraised)}</b>
                    {collection.totalPaid > 0 && collection.totalAppraised !== collection.totalPaid && (
                      <b style={{ color: collection.totalAppraised >= collection.totalPaid ? 'var(--color-up)' : 'var(--color-down-text)', fontVariantNumeric: 'tabular-nums' }}>
                        {' '}· {collection.totalAppraised >= collection.totalPaid ? '+' : '−'}
                        {Math.abs(Math.round((collection.totalAppraised / collection.totalPaid - 1) * 100))}%
                      </b>
                    )}
                  </span>
                </div>
                {/* column heads */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '8px 0 6px', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                  <div style={{ flex: 1 }}>Piece</div>
                  <div style={{ width: 92, textAlign: 'right' }}>Bought</div>
                  <div style={{ width: 118, textAlign: 'right' }}>lectr appraisal</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {collection.rows.map(({ lot, paid, appraised, basis, deltaPct }) => (
                    <div key={lot.id} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '10px 0', borderTop: '1px solid var(--hairline)' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{craftTitle(lot.title)}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                          {ARTIST_LABEL[lot.artist] || lot.artist} · {lot.auctionHouse}{lot.saleDate ? ` · ${formatDate(lot.saleDate)}` : ''}
                        </div>
                      </div>
                      <div style={{ width: 92, textAlign: 'right', flexShrink: 0, fontSize: 14.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {paid != null ? formatPrice(paid) : '—'}
                      </div>
                      <div style={{ width: 118, textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {appraised != null ? formatPrice(appraised) : '—'}
                          {deltaPct != null && deltaPct !== 0 && (
                            <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 600, color: deltaPct > 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>
                              {deltaPct > 0 ? '+' : '−'}{Math.abs(deltaPct)}%
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{basis ?? 'no comps yet'}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', margin: '14px 0 0' }}>
                  The lectr appraisal is the median its comparable sales currently trade at — our read from the data, not a formal appraisal. Pieces without a usable comp pool carry at their bought price in the total.
                </p>
              </section>
            </div>
          )}

          {sold.length > 0 && (
            <div className="ray-enter" style={{ '--enter-delay': '90ms' } as React.CSSProperties}>
              <PastResults lots={sold} showArtist savedIds={savedIds} onToggleSave={toggle} ownedIds={ownedIds} onToggleOwned={toggleOwned} sub={verdict} />
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
                        {meta?.title ? (
                          /* the save carried a snapshot — say WHAT the lot was */
                          <>
                            <span style={{ color: 'var(--color-fg)', fontWeight: 600 }}>
                              was: {meta.title}
                              {meta.artist && <>, {ARTIST_LABEL[meta.artist] || meta.artist}</>}
                            </span>
                            <span style={{ color: 'var(--color-text-faint)' }}>
                              {meta.estMid != null && <> · est. {formatPrice(meta.estMid)}</>}
                              {' '}· saved {formatDate(meta.savedAt)}
                            </span>
                          </>
                        ) : (
                          <>
                            No longer listed — removed from the block
                            {meta && (
                              <span style={{ color: 'var(--color-text-faint)' }}>
                                {' '}· saved {formatDate(meta.savedAt)}
                                {meta.estMid != null && <> · was est. {formatPrice(meta.estMid)}</>}
                              </span>
                            )}
                          </>
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
      <Colophon lotCount={meta.totalLots} houseCount={meta.sources.length} record={null} />
    </div>
  );
}
