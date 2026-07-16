'use client';

import React, { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import { ARTIST_LABEL, MARKETS, marketArtists } from '../constants';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import { pickCall } from '../components/Terminal';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import { lotSignal, confidenceMeter, formatEstimate } from '../components/LotCard';
import ComparableModal, { PriceBand } from '../components/ComparableModal';
import RecordByYear from '../components/RecordByYear';
import MethodologyNote from '../components/MethodologyNote';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import CountUp from '../components/CountUp';
import { getUpcomingCounts, formatPrice, formatDate, categoryLabels, craftTitle, httpsImg } from '../utils';
import { FORM_LABEL, signalWithPool } from '../lib/comps';

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
    return marketLots
      .filter(l => l.status === 'upcoming' && l.saleDate && (l.saleDate >= today || l.resultsPending))
      .map(l => ({ lot: l, signal: lotSignal(l, marketLots) }))
      .filter(d => d.signal && d.signal.label === 'Below Market')
      .sort((a, b) => (b.signal!.pct - a.signal!.pct));
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

          {/* One hero: today's call. The count and totals live in the
              sentence — full numbers, no second display numeral. */}
          <section className="rail ray-enter" style={{ paddingTop: 24 }}>
            <p className="ray-hero2-label" style={{ marginBottom: 6 }}>
              Value · below-market {activeLabel} lots on the block
            </p>
            <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: 0 }}>
              {deals.length > 0
                ? <>
                    <b style={{ color: 'var(--color-fg)', fontWeight: 700 }}>{deals.length}</b> flagged{' '}
                    {deals.length === 1 ? 'lot' : 'lots'} ·{' '}
                    <span style={{ color: 'var(--color-up)', fontWeight: 600 }}>
                      comps run +{Math.round(summary.medianGap)}% over these estimates
                    </span>{' '}
                    · {formatPrice(summary.totalEst)} in estimates · {summary.artists} makers
                    {summary.soonest && <> · first hammer {formatDate(summary.soonest.lot.saleDate)}</>}
                  </>
                : 'No lots are flagged below market right now — the crawl refreshes daily.'}
            </p>
          </section>

          {call && (
            <section className="rail ray-enter" style={{ '--enter-delay': '60ms', paddingTop: 22 } as React.CSSProperties}>
              <div className="ray-call lit">
                <div className="ray-call-copy">
                  <div className="ray-call-eyebrow">
                    <span>Today&rsquo;s call</span>
                    <MethodologyNote />
                  </div>
                  <div className="ray-call-artist">{ARTIST_LABEL[call.lot.artist] || call.lot.artist}</div>
                  <div className="ray-call-title">{craftTitle(call.lot.title)}</div>
                  <div className="ray-call-meta">
                    {call.lot.auctionHouse}
                    {call.lot.category !== 'unknown' && categoryLabels[call.lot.category] ? ` · ${categoryLabels[call.lot.category]}` : ''}
                    {` · hammers ${formatDate(call.lot.saleDate)} · ${formatEstimate(call.lot)}`}
                  </div>
                  {callMedian !== null && (
                    <div className="ray-call-band">
                      <PriceBand
                        prices={callComps}
                        median={callMedian}
                        estLow={call.lot.estimateLow}
                        estHigh={call.lot.estimateHigh}
                        below={true}
                      />
                    </div>
                  )}
                  <div className="ray-call-line">
                    {call.signal!.kind === 'edition'
                      ? `This exact edition has sold ${call.signal!.pct}% above this estimate (${call.signal!.basis} sales).`
                      : `${call.signal!.basis} comparable ${(FORM_LABEL as Record<string, string>)[call.signal!.form!] || 'works'} put the median ${call.signal!.pct}% above this estimate.`}
                    <span style={{ display: 'block', marginTop: 4, fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                      {confidenceMeter(call.signal!.confidence).dots}{' '}
                      {confidenceMeter(call.signal!.confidence).word} confidence
                      {call.signal!.kind === 'edition' ? ' — the strongest comp there is' : ''}
                    </span>
                  </div>
                  <div className="ray-call-ctas">
                    <button className="ray-call-btn ray-call-btn-primary" onClick={() => setModalLot(call.lot)}>
                      See the comps
                    </button>
                    <a className="ray-call-btn ray-call-btn-quiet" href={call.lot.url} target="_blank" rel="noopener noreferrer">
                      View lot ↗
                    </a>
                  </div>
                </div>
                <div className="ray-call-art">
                  <div className="ray-lot-plate" aria-hidden={call.lot.imageUrl ? 'true' : undefined}>
                    <span className="ray-lot-plate-letter">{call.lot.title.charAt(0)}</span>
                    <span className="ray-lot-plate-rule" />
                  </div>
                  {call.lot.imageUrl && (
                    <img src={httpsImg(call.lot.imageUrl)} alt={call.lot.title} referrerPolicy="no-referrer"
                      onError={e => e.currentTarget.remove()} />
                  )}
                </div>
              </div>
            </section>
          )}

          {backtest && backtest.flagged.n >= 100 && (
            <div className="ray-band" style={{ marginTop: 34, paddingBlock: '28px 34px' }}>
            <section className="rail ray-enter" style={{ '--enter-delay': '90ms', paddingTop: 0 } as React.CSSProperties}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
                <h2 className="ray-h2">The record</h2>
                <span style={{ fontSize: 13, color: 'var(--color-text-faint)' }}>
                  every historical call replayed with only the data lectr had that day
                </span>
              </div>
              {/* HAMMER BASIS leads — estimates are hammer-basis while realized
                  prices include the buyer's premium (~25%), so the hammer read
                  is the honest "beat the estimate" test. The all-in figure stays
                  as context. Falls back to all-in when an old cached backtest.json
                  lacks the hammer fields. */}
              <div className="ray-strip">
                <div>
                  <div className="ray-strip-k">Flagged lots hammered</div>
                  <div className="ray-strip-v" style={{ color: 'var(--color-up)' }}>
                    <CountUp to={backtest.flagged.hammerMedianPct ?? backtest.flagged.medianPerfPct} format={n => `${n >= 0 ? '+' : ''}${Math.round(n)}%`} duration={1200} />
                  </div>
                  <div className="ray-strip-s">median hammer vs estimate · {backtest.flagged.n.toLocaleString()} calls{backtest.flagged.hammerMedianPct != null ? ` · +${backtest.flagged.medianPerfPct}% with premium` : ''}</div>
                </div>
                <div>
                  <div className="ray-strip-k">Unflagged hammered</div>
                  <div className="ray-strip-v"><CountUp to={backtest.unflagged.hammerMedianPct ?? backtest.unflagged.medianPerfPct} format={n => `${n >= 0 ? '+' : ''}${Math.round(n)}%`} duration={1200} /></div>
                  <div className="ray-strip-s">the signal&rsquo;s edge: {(backtest.flagged.hammerMedianPct ?? backtest.flagged.medianPerfPct) - (backtest.unflagged.hammerMedianPct ?? backtest.unflagged.medianPerfPct)} pts</div>
                </div>
                <div>
                  <div className="ray-strip-k">Beat their high estimate</div>
                  <div className="ray-strip-v" style={{ color: 'var(--color-up)' }}>
                    <CountUp to={backtest.flagged.hammerBeatPct ?? backtest.flagged.beatHighPct} format={n => `${Math.round(n)}%`} duration={1200} />
                  </div>
                  <div className="ray-strip-s">at the hammer · vs {backtest.unflagged.hammerBeatPct ?? backtest.unflagged.beatHighPct}% unflagged</div>
                </div>
                {backtest.flagged.failToSellPct != null && backtest.above.failToSellPct != null ? (
                  <div>
                    <div className="ray-strip-k">Failed to sell</div>
                    <div className="ray-strip-v" style={{ color: 'var(--color-up)' }}>
                      <CountUp to={backtest.flagged.failToSellPct} format={n => `${n.toFixed(1)}%`} duration={1200} />
                    </div>
                    <div className="ray-strip-s">of flagged lots · vs {backtest.above.failToSellPct}% of &ldquo;above market&rdquo;</div>
                  </div>
                ) : (
                  <div>
                    <div className="ray-strip-k">&ldquo;Above market&rdquo; calls</div>
                    <div className="ray-strip-v" style={{ color: 'var(--color-down)' }}>
                      <CountUp to={backtest.above.hammerMedianPct ?? backtest.above.medianPerfPct} format={n => `${n >= 0 ? '+' : ''}${Math.round(n)}%`} duration={1200} />
                    </div>
                    <div className="ray-strip-s">underperformed both — the ordering holds</div>
                  </div>
                )}
              </div>
            </section>
            <RecordByYear backtest={backtest} />
            </div>
          )}

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
                      <span className="ray-value-row-thumb" aria-hidden="true">
                        {d.lot.imageUrl
                          ? <img src={httpsImg(d.lot.imageUrl)} alt="" referrerPolicy="no-referrer" loading="lazy"
                              onError={e => e.currentTarget.remove()} />
                          : d.lot.title.charAt(0)}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="ray-value-row-maker" style={{ display: 'block' }}>
                          {ARTIST_LABEL[d.lot.artist] || d.lot.artist}
                        </span>
                        <span className="ray-value-row-title" style={{ display: 'block' }}>
                          {craftTitle(d.lot.title)} · hammers {formatDate(d.lot.saleDate)}
                        </span>
                      </span>
                      <span style={{ textAlign: 'right' }}>
                        <span className="ray-value-row-sig" style={{ display: 'block' }}>
                          +{Math.round(d.signal!.pct)}%
                        </span>
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
    </div>
  );
}
