'use client';

import React, { useMemo, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import { ARTIST_LABEL, MARKETS, marketArtists } from '../constants';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import { Colophon, pickCall, CallPlate } from '../components/Terminal';
import { useFullLots, retryFullLoad } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import { lotSignal, formatEstimate } from '../components/LotCard';
import ComparableModal, { PriceBand } from '../components/ComparableModal';
// RecordByYear is the value page's ONLY recharts consumer and renders deep in
// the page (below the fold, gated on a big-enough backtest) — dynamic-import it
// (ssr:false, static export) so recharts leaves the value page's initial
// bundle. A fixed-height fallback matches the 240px chart so it can't shift.
const RecordByYear = dynamic(() => import('../components/RecordByYear'), {
  ssr: false,
  loading: () => <div style={{ height: 240, margin: '30px 0', borderRadius: 12, background: 'var(--color-surface)', opacity: 0.5 }} aria-hidden />,
});
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import RecordBand from '../components/RecordBand';
import Masthead, { Accent } from '../components/Masthead';
import Flick from '../components/Flick';
import meta from '../../public/data/ray/meta.json';
import { getUpcomingCounts, formatPrice, formatDate, craftTitle, httpsImg, fmtSignedPct, localToday, isLiveUpcoming } from '../utils';
import { signalWithPool, dealScore, signalMagnitude } from '../lib/comps';

const ROWS_PAGE = 12;

/**
 * Value — the reason to open Ray every morning. Every live lot the signal
 * flags below market, ranked by how far under the comps it sits. The signal
 * is the same statistic everywhere: comps median vs estimate midpoint.
 */
export default function ValuePage() {
  // useFullLots: the value engine (callPool/appraisal) reads the full corpus
  // and gates on fullLoaded, so this route must trigger phase 2.
  const { allLots, statsByArtist, backtest, lastCrawl, loading, fullLoaded, fullError, fromCache } = useFullLots();
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
    const today = localToday();
    // THE ONE FLAGGED RANKING — dealScore (lib/comps): calibrated odds first,
    // then the gap capped at 400%. Same ordering as every other surface.
    return marketLots
      .filter(l => isLiveUpcoming(l, today))
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
  const call = useMemo(() => pickCall(marketLots, marketLots, activeKey), [marketLots, activeKey]);
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
      {/* __html, not a text child: this CSS carries '<date>' inside a comment
          (and any '>'/'<' gets entity-escaped by SSR while the browser leaves
          <style> raw text undecoded) — a guaranteed hydration mismatch
          (React #418/#423/#425) on every load. RecordBand's pattern. */}
      <style dangerouslySetInnerHTML={{ __html: `
        .ray-value-section { padding-block: var(--sect-t) calc(var(--sect-b) + var(--space-4)); }
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
        .ray-value-row { text-decoration: none; }
        /* the compact record strip pinned under the headline — the proof in
           one mono line, linking the full certificate at /record */
        .ray-value-recstrip {
          margin: 14px 0 0;
          font-family: var(--font-mono), monospace;
          font-size: 12px;
          letter-spacing: 0.02em;
          font-variant-numeric: tabular-nums;
          color: var(--color-text-muted);
        }
        .ray-value-recstrip b.up { color: var(--color-up); font-weight: 600; }
        .ray-value-recstrip b.down { color: var(--color-down-text); font-weight: 600; }
        .ray-value-recstrip a { color: var(--color-butter-text); text-decoration: none; }
        .ray-value-recstrip a:hover { text-decoration: underline; text-underline-offset: 3px; }
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
          font-size: 13.5px;
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
          font-size: 13.5px;
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
          .ray-value-section { padding-block: var(--sect-t) calc(var(--sect-b) + var(--space-2)); }
          .ray-value-row { grid-template-columns: 44px minmax(0, 1fr) auto; gap: 10px; padding: 10px 12px; }
          .ray-value-row-thumb { width: 44px; height: 36px; }
        }
        /* ── DESKTOP LEDGER (≥900px) ──────────────────────────────────
           The mobile 3-col row is the phone composition; at rail width the
           middle went empty while three numbers stacked on the right. Here
           the same row spreads into true terminal ledger columns:
           thumb · maker/work · house · hammers · estimate · comps median ·
           odds · gap. Mono data cells, right-aligned numerics, header in
           the kicker register. The stacked mobile cell and the inline
           "hammers <date>" fragment hide — the date owns a column. */
        .ray-value-head { display: none; }
        .ray-value-cell { display: none; }
        @media (min-width: 900px) {
          .ray-value-row,
          .ray-value-head {
            grid-template-columns: 56px minmax(0, 1fr) 92px 88px 118px 84px 68px 64px;
            gap: 16px;
          }
          .ray-value-head {
            display: grid;
            align-items: baseline;
            width: 100%;
            padding: 12px 16px 9px;
            border-bottom: 1px solid var(--color-border);
          }
          .ray-value-head .kicker { font-size: 10px; letter-spacing: 0.14em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .ray-value-mob { display: none; }
          .ray-value-mobdate { display: none; }
          .ray-value-cell {
            display: block;
            font-family: var(--font-mono), monospace;
            font-size: var(--text-data);
            letter-spacing: -0.01em;
            font-variant-numeric: tabular-nums;
            color: var(--color-text-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 0;
          }
          .ray-value-cell-num { text-align: right; }
          .ray-value-cell-gap { color: var(--color-up); font-weight: 700; }
          .ray-value-cell-odds { color: var(--color-text-secondary); font-weight: 600; }
          .ray-value-cell-est { color: var(--color-fg); }
        }
      ` }} />

      <ArtistNav activeSlug="value" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {fullError ? (
        <div style={{ padding: '120px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 15.5, color: 'var(--color-text-muted)', marginBottom: 24 }}>
            The sold archive didn&rsquo;t load. Check your connection and try again.
          </p>
          <button className="ray-call-btn ray-call-btn-primary" onClick={() => retryFullLoad()}>
            Retry
          </button>
        </div>
      ) : loading || !fullLoaded ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          <div className="rail ray-enter" style={{ paddingTop: 'var(--space-4)' }}><MarketSwitch compact /></div>

          {/* The certificate masthead — the flagged count and totals fold
              into the data subline; full numbers, no second display numeral. */}
          <section className="rail ray-enter" style={{ paddingTop: 'calc(var(--space-4) + var(--space-2))' }}>
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
            {/* the record strip — real replay numbers, pinned to the headline */}
            {backtest && backtest.flagged.n >= 100 && (
              <p className="ray-value-recstrip">
                Flagged <b className="up">{fmtSignedPct(backtest.flagged.hammerMedianPct ?? backtest.flagged.medianPerfPct)}</b>
                {' '}· unflagged <b className="down">{fmtSignedPct(backtest.unflagged.hammerMedianPct ?? backtest.unflagged.medianPerfPct)}</b>
                {' '}· {backtest.flagged.n.toLocaleString()} replayed{' '}
                <Link href="/record">→ the record</Link>
              </p>
            )}
          </section>

          {call && (
            <section className="rail ray-enter" style={{ '--enter-delay': '60ms', paddingTop: 'calc(var(--space-4) + var(--space-2))' } as React.CSSProperties}>
              {/* ONE CALLPLATE — the lander's component in compact density:
                  same pickCall lot, same numbers, the modal one click away. */}
              <CallPlate
                lots={marketLots}
                allLots={marketLots}
                market={activeKey}
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
            <div className="ray-band" id="record" style={{ marginTop: 34, paddingBlock: '28px 34px' }}>
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
                <p style={{ fontSize: 15.5, marginBottom: 20 }}>Check back after the next crawl, or browse everything live.</p>
                <Link href="/" className="link-action" style={{ color: 'var(--color-fg)' }}>
                  Browse upcoming lots <span className="arrow"><Flick size={10} style={{ marginLeft: 5 }} /></span>
                </Link>
              </div>
            ) : (
              <>
                <h2 className="ray-h2 ray-enter" style={{ marginBottom: 18 }}>
                  Deepest value first · calibrated odds
                </h2>
                {/* Compact rows — thumb · maker · signal % · est on mobile;
                    ≥900px the same rows spread into the full ledger. Each row
                    opens the comps modal; the house link lives inside it. */}
                <div className="glass glass-quiet ray-enter" style={{ overflow: 'hidden' }}>
                  <div className="ray-value-head" aria-hidden="true">
                    <span />
                    <span className="kicker">Lot</span>
                    <span className="kicker">House</span>
                    <span className="kicker">Hammers</span>
                    <span className="kicker" style={{ textAlign: 'right' }}>Estimate</span>
                    <span className="kicker" style={{ textAlign: 'right' }}>Comps med</span>
                    <span className="kicker" style={{ textAlign: 'right' }}>Beat odds</span>
                    <span className="kicker" style={{ textAlign: 'right' }}>Gap</span>
                  </div>
                  {gridDeals.slice(0, shown).map((d, i) => (
                    /* R3 — the row's primary click is lectr's OWN lot page;
                       the comps modal stays one click away on the plate above
                       and on the lot page itself */
                    <Link
                      key={d.lot.id}
                      href={`/lot?id=${encodeURIComponent(d.lot.id)}`}
                      className="ray-value-row ray-enter-card"
                      style={{ '--enter-delay': `${Math.min(i, 8) * 40}ms` } as React.CSSProperties}
                      aria-label={`${ARTIST_LABEL[d.lot.artist] || d.lot.artist} — open the lot page`}
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
                          {craftTitle(d.lot.title)}
                          <span className="ray-value-mobdate">
                            {' '}· {d.lot.saleDate && d.lot.saleDate.slice(0, 10) < localToday() ? 'hammered' : 'hammers'} {formatDate(d.lot.saleDate)}
                          </span>
                        </span>
                      </span>
                      {/* ≥900px ledger cells — the date, estimate, comps
                          median, calibrated odds and gap each own a mono
                          column. The comps median is the signal's own med
                          when the deep engine carried it; else re-derived
                          from the estimate mid × the signal ratio (the same
                          statistic, inverted). */}
                      <span className="ray-value-cell">{d.lot.auctionHouse}</span>
                      <span className="ray-value-cell">{formatDate(d.lot.saleDate)}</span>
                      <span className="ray-value-cell ray-value-cell-num ray-value-cell-est">{formatEstimate(d.lot).replace(/ est\.$/, '')}</span>
                      <span className="ray-value-cell ray-value-cell-num">
                        {(() => {
                          const med = (d.signal as { med?: number } | null)?.med ?? (() => {
                            const lo = d.lot.estimateLow || d.lot.estimateHigh || 0;
                            const hi = d.lot.estimateHigh || d.lot.estimateLow || 0;
                            const mid = (lo + hi) / 2;
                            return mid > 0 ? mid * (1 + d.signal!.pct / 100) : null;
                          })();
                          return med ? formatPrice(med) : '—';
                        })()}
                      </span>
                      <span className="ray-value-cell ray-value-cell-num ray-value-cell-odds">
                        {d.lot.value?.signal?.beatRatePct != null ? `${Math.round(d.lot.value.signal.beatRatePct)}%` : '—'}
                      </span>
                      <span className="ray-value-cell ray-value-cell-num ray-value-cell-gap">
                        {signalMagnitude('Below Market', Math.round(d.signal!.pct))}
                      </span>
                      {/* MOBILE stack — the audited-good phone composition */}
                      <span className="ray-value-mob" style={{ textAlign: 'right' }}>
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
                    </Link>
                  ))}
                </div>
                {/* R21 — what "Beat odds" measures, said plainly */}
                <p className="ray-enter" style={{ fontSize: 12, color: 'var(--color-text-faint)', margin: '10px 2px 0', lineHeight: 1.5 }}>
                  Beat odds — share of past flags like this that beat their estimate — measured, not modeled
                </p>
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
