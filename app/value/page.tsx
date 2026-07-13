'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ARTIST_LABEL, MARKETS, marketArtists } from '../constants';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import { pickCall } from '../components/Terminal';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import LotCard, { lotSignal, confidenceMeter } from '../components/LotCard';
import ComparableModal, { PriceBand } from '../components/ComparableModal';
import MethodologyNote from '../components/MethodologyNote';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import CountUp from '../components/CountUp';
import { getUpcomingCounts, formatPrice, formatDate, categoryLabels, craftTitle } from '../utils';
import { FORM_LABEL, signalWithPool } from '../lib/comps';

function fmtEst(lo: number | null, hi: number | null): string {
  const f = (n: number) => formatPrice(n);
  if (lo && hi) return `${f(lo)}–${f(hi)}`;
  if (lo || hi) return f((lo || hi)!);
  return 'estimate on request';
}

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
  const [compsOpen, setCompsOpen] = useState(false);

  const deals = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return marketLots
      .filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today)
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

      <ArtistNav activeSlug="value" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          <section className="ray-hero2 rail ray-enter">
            <div style={{ marginBottom: 18 }}><MarketSwitch compact /></div>
            <p className="ray-hero2-label">Value · below-market {activeLabel} lots on the block</p>
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

          {call && (
            <section className="rail ray-enter" style={{ '--enter-delay': '60ms' } as React.CSSProperties}>
              <div className="ray-call">
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
                    {` · hammers ${formatDate(call.lot.saleDate)} · est. ${fmtEst(call.lot.estimateLow, call.lot.estimateHigh)}`}
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
                    <button className="ray-call-btn ray-call-btn-primary" onClick={() => setCompsOpen(true)}>
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
                    <img src={call.lot.imageUrl} alt={call.lot.title} referrerPolicy="no-referrer"
                      onError={e => e.currentTarget.remove()} />
                  )}
                </div>
              </div>
              {compsOpen && (
                <ComparableModal lot={call.lot} allLots={marketLots} onClose={() => setCompsOpen(false)} />
              )}
            </section>
          )}

          {backtest && backtest.flagged.n >= 100 && (
            <section className="rail ray-enter" style={{ '--enter-delay': '90ms', paddingTop: 34 } as React.CSSProperties}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
                <h2 className="ray-h2">The record</h2>
                <span style={{ fontSize: 13, color: 'var(--color-text-faint)' }}>
                  every historical call replayed with only the data Ray had that day
                </span>
              </div>
              <div className="ray-strip">
                <div>
                  <div className="ray-strip-k">Flagged lots delivered</div>
                  <div className="ray-strip-v" style={{ color: 'var(--color-up)' }}>
                    <CountUp to={backtest.flagged.medianPerfPct} format={n => `+${Math.round(n)}%`} duration={1200} />
                  </div>
                  <div className="ray-strip-s">median result vs estimate · {backtest.flagged.n.toLocaleString()} calls</div>
                </div>
                <div>
                  <div className="ray-strip-k">Unflagged delivered</div>
                  <div className="ray-strip-v"><CountUp to={backtest.unflagged.medianPerfPct} format={n => `+${Math.round(n)}%`} duration={1200} /></div>
                  <div className="ray-strip-s">the signal&rsquo;s edge: {backtest.flagged.medianPerfPct - backtest.unflagged.medianPerfPct} pts</div>
                </div>
                <div>
                  <div className="ray-strip-k">Beat their high estimate</div>
                  <div className="ray-strip-v" style={{ color: 'var(--color-up)' }}>
                    <CountUp to={backtest.flagged.beatHighPct} format={n => `${Math.round(n)}%`} duration={1200} />
                  </div>
                  <div className="ray-strip-s">of flagged lots · vs {backtest.unflagged.beatHighPct}% unflagged</div>
                </div>
                <div>
                  <div className="ray-strip-k">&ldquo;Above market&rdquo; calls</div>
                  <div className="ray-strip-v" style={{ color: 'var(--color-down)' }}>
                    <CountUp to={backtest.above.medianPerfPct} format={n => `+${Math.round(n)}%`} duration={1200} />
                  </div>
                  <div className="ray-strip-s">underperformed both — the ordering holds</div>
                </div>
              </div>
            </section>
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
                <div className="ray-value-grid">
                  {gridDeals.map((d, i) => (
                    <div
                      key={d.lot.id}
                      className="ray-enter-card"
                      style={{ '--enter-delay': `${Math.min(i, 8) * 60}ms` } as React.CSSProperties}
                    >
                      <LotCard
                        lot={d.lot}
                        showArtist
                        allLots={marketLots}
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
