'use client';

import React, { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import { ARTIST_LABEL, MARKETS, marketArtists } from '../constants';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import { Colophon, pickCall, CallPlate } from '../components/Terminal';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import { lotSignal, formatEstimate } from '../components/LotCard';
import ComparableModal, { PriceBand } from '../components/ComparableModal';
import RecordByYear from '../components/RecordByYear';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import RecordBand from '../components/RecordBand';
import Masthead, { Accent } from '../components/Masthead';
import Flick from '../components/Flick';
import meta from '../../public/data/ray/meta.json';
import { getUpcomingCounts, formatPrice, formatDate, craftTitle, httpsImg, fmtSignedPct } from '../utils';
import { signalWithPool, dealScore, signalMagnitude } from '../lib/comps';

const ROWS_PAGE = 12;

/**
 * Value — the reason to open Ray every morning. Every live lot the signal
 * flags below market, ranked by how far under the comps it sits. The signal
 * is the same statistic everywhere: comps median vs estimate midpoint.
 */
export default function ValuePage() {
  const { allLots, statsByArtist, backtest, lastCrawl, loading, fullLoaded, fromCache } = useRayData();
  const { market } = useMarket();
  const activeKey = MARKETS.find(m => m.key === market)?.live ? market : 'all';
  const activeLabel = activeKey === 'all' ? 'collectible' : MARKETS.find(m => m.key === activeKey)!.label.toLowerCase();
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const marketLots = useMemo(() => allLots.filter(l => mktSet.has(l.artist)), [allLots, mktSet]);
  const { savedIds, toggle, isSaved } = useSavedLots();
  // One modal for the whole page — the call plate and every row open the
  // same comps view, and a lot can be saved without closing it.
  const [modalLot, setModalLot] = useState<AuctionLot | null>(null);
  const [shown, setShown] = useState(ROWS_PAGE);

  const deals = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    // THE ONE FLAGGED RANKING — dealScore (lib/comps): calibrated odds first,
    // then the gap capped at 400%. Same ordering as every other surface.
    return marketLots
      .filter(l => l.status === 'upcoming' && l.saleDate && (l.saleDate >= today || l.resultsPending))
      .map(l => ({ lot: l, signal: lotSignal(l, marketLots) }))
      .filter(d => d.signal && d.signal.label === 'Below Market')
      .sort((a, b) => dealScore(b.lot, b.signal!.pct) - dealScore(a.lot, a.signal!.pct));
  }, [marketLots]);

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

  // A market flip starts the rows over at the first page.
  useEffect(() => { setShown(ROWS_PAGE); }, [activeKey]);

  // Today's call: the strongest deal Ray can STAND BEHIND — highest
  // confidence tier first, never low (one thin comp is not a headline).
  const call = useMemo(() => pickCall(marketLots, marketLots), [marketLots]);
  const gridDeals = useMemo(
    () => (call ? deals.filter(d => d.lot.id !== call.lot.id) : deals),
    [deals, call]
  );
  // ONE LOT, ONE NUMBER: the band draws the signal's own pool via the same
  // function that made the call — the card sentence, this band, and the comps
  // modal can never disagree.
  const callPool = useMemo(() => {
    if (!call || !fullLoaded) return null;
    return signalWithPool(call.lot, marketLots);
  }, [call, marketLots, fullLoaded]);
  const callComps = useMemo(
    () => (callPool ? callPool.pool.map(l => l.priceUsd!).sort((a: number, b: number) => a - b) : []),
    [callPool]
  );
  const callMedian = callPool?.signal.med ?? null;

  return (
    <div className="ray-mobnav-pad" style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      color: 'var(--color-fg)',
      fontFamily: 'var(--font-sans), sans-serif',
    }}>
      <style>{`
        .ray-value-section { padding-block: 40px 64px; }
        .ray-value-row {
          display: grid;
          grid-template-columns: 56px minmax(0, 1fr) auto;
          gap: 14px;
          align-items: center;
          width: 100%;
          padding: 10px 16px;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--color-border);
          text-align: left;
          font-family: var(--font-sans), sans-serif;
          color: var(--color-fg);
          cursor: pointer;
          transition: background var(--duration-fast) var(--ease-signature);
        }
        .ray-value-row:last-child { border-bottom: none; }
        .ray-value-row:hover { background: var(--color-hover-item); }
        .ray-value-row-thumb {
          width: 56px;
          height: 44px;
          border-radius: 6px;
          overflow: hidden;
          background: var(--color-bg-elevated);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: 700;
          color: var(--color-text-faint);
          flex-shrink: 0;
        }
        .ray-value-row-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .ray-value-row-maker {
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ray-value-row-title {
          font-size: 12.5px;
          font-weight: 400;
          color: var(--color-text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ray-value-row-sig {
          font-size: 13px;
          font-weight: 700;
          color: var(--color-up);
          text-align: right;
          white-space: nowrap;
        }
        .ray-value-row-est {
          font-size: 12.5px;
          color: var(--color-text-muted);
          text-align: right;
          white-space: nowrap;
        }
        @media (max-width: 768px) {
          .ray-value-section { padding-block: 32px 40px; }
          .ray-value-row { grid-template-columns: 44px minmax(0, 1fr) auto; gap: 10px; padding: 10px 12px; }
          .ray-value-row-thumb { width: 44px; height: 36px; }
        }
      `}</style>

      <ArtistNav activeSlug="value" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          <div className="rail ray-enter" style={{ paddingTop: 16 }}><MarketSwitch compact /></div>

          {/* The certificate masthead — the flagged count and totals fold
              into the data subline; full numbers, no second display numeral. */}
          <section className="rail ray-enter" style={{ paddingTop: 24 }}>
            <Masthead
              kicker="The signal · ranked by comps gap"
              serial={lastCrawl || undefined}
              title={<>Priced <Accent>under</Accent> where the {activeLabel === 'collectible' ? 'market' : `${activeLabel} market`} clears.</>}
              sub={deals.length > 0
                ? <>
                    <b style={{ color: 'var(--color-fg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{deals.length}</b> flagged{' '}
                    {deals.length === 1 ? 'lot' : 'lots'} on the block ·{' '}
                    <span style={{ color: 'var(--color-up)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      comps run +{Math.round(summary.medianGap)}% over these estimates
                    </span>{' '}
                    · {formatPrice(summary.totalEst)} in estimates · {summary.artists} makers
                    {summary.soonest && <> · first hammer {formatDate(summary.soonest.lot.saleDate)}</>}
                  </>
                : 'No lots are flagged below market right now — the crawl refreshes daily.'}
            />
          </section>

          {call && (
            <section className="rail ray-enter" style={{ '--enter-delay': '60ms', paddingTop: 22 } as React.CSSProperties}>
              {/* ONE CALLPLATE — the lander's component in compact density:
                  same pickCall lot, same numbers, the modal one click away. */}
              <CallPlate
                lots={marketLots}
                allLots={marketLots}
                density="compact"
                isSaved={isSaved}
                onToggleSave={toggle}
                onSeeComps={l => setModalLot(l)}
                band={callMedian !== null ? (
                  <PriceBand
                    prices={callComps}
                    median={callMedian}
                    estLow={call.lot.estimateLow}
                    estHigh={call.lot.estimateHigh}
                    below={true}
                  />
                ) : null}
              />
            </section>
          )}

          {backtest && backtest.flagged.n >= 100 && (
            <div className="ray-band" style={{ marginTop: 34, paddingBlock: '28px 34px' }}>
            <section className="rail ray-enter" style={{ '--enter-delay': '90ms', paddingTop: 0 } as React.CSSProperties}>
              {/* HAMMER BASIS leads — estimates are hammer-basis while realized
                  prices include the buyer's premium (~25%), so the hammer read
                  is the honest "beat the estimate" test. The all-in figure stays
                  as context. Falls back to all-in when an old cached backtest.json
                  lacks the hammer fields. */}
              <RecordBand
                title="The record"
                context="every call replayed against history"
                serial={(lastCrawl || new Date().toISOString()).slice(0, 10).replace(/-/g, '')}
                footer="hammer basis · refit nightly from the full replay"
                cells={[
                  {
                    k: 'Flagged lots hammered',
                    v: fmtSignedPct(backtest.flagged.hammerMedianPct ?? backtest.flagged.medianPerfPct),
                    signed: backtest.flagged.hammerMedianPct ?? backtest.flagged.medianPerfPct,
                    sub: `median hammer vs estimate · ${backtest.flagged.n.toLocaleString()} calls${backtest.flagged.hammerMedianPct != null ? ` · +${backtest.flagged.medianPerfPct}% with premium` : ''}`,
                  },
                  {
                    k: 'Unflagged hammered',
                    v: fmtSignedPct(backtest.unflagged.hammerMedianPct ?? backtest.unflagged.medianPerfPct),
                    signed: backtest.unflagged.hammerMedianPct ?? backtest.unflagged.medianPerfPct,
                    sub: <>the signal&rsquo;s edge: {(backtest.flagged.hammerMedianPct ?? backtest.flagged.medianPerfPct) - (backtest.unflagged.hammerMedianPct ?? backtest.unflagged.medianPerfPct)} pts</>,
                  },
                  {
                    k: 'Beat their high estimate',
                    v: `${Math.round(backtest.flagged.hammerBeatPct ?? backtest.flagged.beatHighPct)}%`,
                    sub: `at the hammer · vs ${backtest.unflagged.hammerBeatPct ?? backtest.unflagged.beatHighPct}% unflagged`,
                  },
                  backtest.flagged.failToSellPct != null && backtest.above.failToSellPct != null
                    ? {
                        k: 'Failed to sell',
                        v: `${backtest.flagged.failToSellPct.toFixed(1)}%`,
                        sub: <>of flagged lots · vs {backtest.above.failToSellPct}% of &ldquo;above market&rdquo;</>,
                      }
                    : {
                        k: '“Above market” calls',
                        v: fmtSignedPct(backtest.above.hammerMedianPct ?? backtest.above.medianPerfPct),
                        signed: backtest.above.hammerMedianPct ?? backtest.above.medianPerfPct,
                        sub: 'underperformed both — the ordering holds',
                      },
                ]}
              />
            </section>
            </div>
          )}

          {backtest && backtest.flagged.n >= 100 && <RecordByYear backtest={backtest} />}

          <section className="ray-value-section rail">
            {deals.length === 0 ? (
              <div className="ray-enter" style={{ textAlign: 'center', padding: '40px 20px 100px', color: 'var(--color-text-faint)' }}>
                <p style={{ fontSize: 14, marginBottom: 20 }}>Check back after the next crawl, or browse everything live.</p>
                <Link href="/" className="link-action" style={{ color: 'var(--color-fg)' }}>
                  Browse upcoming lots <span className="arrow"><Flick size={10} style={{ marginLeft: 5 }} /></span>
                </Link>
              </div>
            ) : (
              <>
                <h2 className="ray-h2 ray-enter" style={{ marginBottom: 18 }}>
                  Deepest value first · calibrated odds
                </h2>
                {/* Compact rows — thumb · maker · signal % · est. Each row
                    opens the comps modal; the house link lives inside it. */}
                <div className="glass glass-quiet ray-enter" style={{ overflow: 'hidden' }}>
                  {gridDeals.slice(0, shown).map((d, i) => (
                    <button
                      key={d.lot.id}
                      type="button"
                      className="ray-value-row ray-enter-card"
                      style={{ '--enter-delay': `${Math.min(i, 8) * 40}ms` } as React.CSSProperties}
                      onClick={() => setModalLot(d.lot)}
                      aria-label={`${ARTIST_LABEL[d.lot.artist] || d.lot.artist} — see the comps`}
                    >
                      {/* Thumbnail — serif-initial plate always behind, photo overlays;
                          on a hotlink-block the plate shows through, never a gap */}
                      <span className="ray-value-row-thumb" aria-hidden="true" style={{
                        position: 'relative',
                        background: 'radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--color-accent-gold) 8%, transparent), transparent 72%), var(--color-bg-elevated)',
                      }}>
                        <span style={{ fontFamily: 'var(--font-serif), serif', fontStyle: 'italic', fontWeight: 300, fontSize: 18, lineHeight: 1, color: 'color-mix(in srgb, var(--color-accent-gold) 55%, var(--color-text-faint))' }}>
                          {(ARTIST_LABEL[d.lot.artist] || d.lot.artist).charAt(0)}
                        </span>
                        {d.lot.imageUrl && (
                          <img src={httpsImg(d.lot.imageUrl)} alt="" referrerPolicy="no-referrer" loading="lazy"
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={e => e.currentTarget.remove()} />
                        )}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="ray-value-row-maker" style={{ display: 'block' }}>
                          {ARTIST_LABEL[d.lot.artist] || d.lot.artist}
                        </span>
                        <span className="ray-value-row-title" style={{ display: 'block' }}>
                          {craftTitle(d.lot.title)} · {d.lot.saleDate && d.lot.saleDate.slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'hammered' : 'hammers'} {formatDate(d.lot.saleDate)}
                        </span>
                      </span>
                      <span style={{ textAlign: 'right' }}>
                        <span className="ray-value-row-sig" style={{ display: 'block' }}>
                          {signalMagnitude('Below Market', Math.round(d.signal!.pct))}
                        </span>
                        {/* THE RANKING KEY, visible: the engine's calibrated
                            beat rate — why a +140% can outrank a +375% */}
                        {d.lot.value?.signal?.beatRatePct != null && (
                          <span className="ray-value-row-est" style={{ display: 'block', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                            {Math.round(d.lot.value.signal.beatRatePct)}% odds
                          </span>
                        )}
                        <span className="ray-value-row-est" style={{ display: 'block' }}>
                          {formatEstimate(d.lot)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                {gridDeals.length > shown && (
                  <div className="ray-enter" style={{ textAlign: 'center', marginTop: 20 }}>
                    <button
                      className="ray-call-btn ray-call-btn-quiet"
                      onClick={() => setShown(s => s + ROWS_PAGE)}
                    >
                      Show {Math.min(ROWS_PAGE, gridDeals.length - shown)} more · {gridDeals.length - shown} below
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {modalLot && (
            <ComparableModal
              lot={modalLot}
              allLots={marketLots}
              onClose={() => setModalLot(null)}
              saved={isSaved(modalLot.id)}
              onToggleSave={id => toggle(id, modalLot)}
            />
          )}
        </RayEntrance>
      )}
      <Colophon lotCount={meta.totalLots} houseCount={meta.sources.length} record={null} />
    </div>
  );
}
