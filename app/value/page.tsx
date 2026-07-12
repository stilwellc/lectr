'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ARTIST_LABEL } from '../constants';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import LotCard, { lotSignal } from '../components/LotCard';
import ComparableModal, { PriceBand } from '../components/ComparableModal';
import MethodologyNote from '../components/MethodologyNote';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import CountUp from '../components/CountUp';
import { getUpcomingCounts, formatPrice, formatDate, categoryLabels } from '../utils';
import { FORM_LABEL, areComparable, normalizeTitle, classifyForm } from '../lib/comps';

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
  const { allLots, statsByArtist, lastCrawl, loading, fullLoaded, fromCache } = useRayData();
  const { savedIds, toggle, isSaved } = useSavedLots();
  const [compsOpen, setCompsOpen] = useState(false);

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

  // Today's call: the strongest deal, preferring one with an artwork image
  // among the top five so the moment lands visually.
  const call = useMemo(() => {
    if (!deals.length) return null;
    return deals.slice(0, 5).find(d => d.lot.imageUrl) || deals[0];
  }, [deals]);
  const gridDeals = useMemo(
    () => (call ? deals.filter(d => d.lot.id !== call.lot.id) : deals),
    [deals, call]
  );
  // The band draws the signal's own pool: same-edition sales when that made
  // the call, otherwise the gated same-form comps.
  const callComps = useMemo(() => {
    if (!call || !fullLoaded) return [];
    const lot = call.lot;
    const sold = allLots.filter(l => l.artist === lot.artist && l.status === 'sold' && l.priceUsd && l.id !== lot.id);
    if (call.signal!.kind === 'edition') {
      const nt = normalizeTitle(lot.title);
      const form = classifyForm(lot);
      return sold.filter(l => normalizeTitle(l.title) === nt && classifyForm(l) === form).map(l => l.priceUsd!).sort((a, b) => a - b);
    }
    return sold.filter(l => areComparable(lot, l)).map(l => l.priceUsd!).sort((a, b) => a - b).slice(0, 60);
  }, [call, allLots, fullLoaded]);
  const callMedian = useMemo(() => {
    if (callComps.length < 3) return null;
    const m = Math.floor(callComps.length / 2);
    return callComps.length % 2 === 0 ? (callComps[m - 1] + callComps[m]) / 2 : callComps[m];
  }, [callComps]);

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

          {call && (
            <section className="rail ray-enter" style={{ '--enter-delay': '60ms' } as React.CSSProperties}>
              <div className="ray-call">
                <div className="ray-call-copy">
                  <div className="ray-call-eyebrow">
                    <span>Today&rsquo;s call</span>
                    <MethodologyNote />
                  </div>
                  <div className="ray-call-artist">{ARTIST_LABEL[call.lot.artist] || call.lot.artist}</div>
                  <div className="ray-call-title">{call.lot.title}</div>
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
                <ComparableModal lot={call.lot} allLots={allLots} onClose={() => setCompsOpen(false)} />
              )}
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
