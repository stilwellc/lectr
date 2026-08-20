'use client';

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import { ARTIST_LABEL, MARKETS, marketArtists } from '../constants';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import { Colophon, pickCall, CallPlate, daysUntil } from '../components/Terminal';
import { useFullLots, retryFullLoad } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import { lotSignal, formatEstimate, confidenceMeter } from '../components/LotCard';
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
import { getUpcomingCounts, formatPrice, formatDate, craftTitle, httpsImg, fmtSignedPct, localToday, isLiveUpcoming, trueSaleDay, overEstimatePct, toneOf } from '../utils';
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
  const { allLots, backtest, lastCrawl, loading, fullLoaded, fullError, fromCache, deepValue } = useFullLots();
  const { market } = useMarket();
  const activeKey = MARKETS.find(m => m.key === market)?.live ? market : 'all';
  const activeLabel = activeKey === 'all' ? 'collectible' : MARKETS.find(m => m.key === activeKey)!.label.toLowerCase();
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const marketLots = useMemo(() => allLots.filter(l => mktSet.has(l.artist)), [allLots, mktSet]);
  const { savedIds, toggle, isSaved } = useSavedLots();
  // One modal for the whole page — the call plate and every row open the
  // same comps view, and a lot can be saved without closing it.
  const [modalLot, setModalLotRaw] = useState<AuctionLot | null>(null);
  // THE MODAL JOINS HISTORY (A2-4, TerminalHome's pattern hardened per
  // B3-terminal 1b/2): opening pushes a `lectrLot` entry so browser Back (and
  // the mobile back-gesture) CLOSES the modal instead of leaving the site.
  // Closing via ✕/ESC pops our entry — but only while it's still the live
  // entry — and a rapid close→reopen before the async back() lands re-pushes
  // instead of letting the pending pop swallow the fresh modal.
  const modalPushed = useRef(false);
  const pendingBack = useRef(false);       // our history.back() hasn't landed yet
  const reopenedDuringBack = useRef(false); // reader reopened inside that window
  const setModalLot = useCallback((lot: AuctionLot | null) => {
    if (lot) {
      if (pendingBack.current) {
        // close→reopen race: our entry is mid-pop — mark it; onPop re-pushes
        reopenedDuringBack.current = true;
        modalPushed.current = true;
      } else if (!modalPushed.current) {
        try { window.history.pushState({ ...window.history.state, lectrLot: true }, ''); modalPushed.current = true; } catch { /* ignore */ }
      }
      setModalLotRaw(lot);
    } else {
      if (modalPushed.current) {
        modalPushed.current = false;
        // only pop while our entry is still live — after a pushState landed
        // on top (e.g. a market switch), back() would eat the wrong entry
        if (window.history.state?.lectrLot) {
          pendingBack.current = true;
          try { window.history.back(); } catch { pendingBack.current = false; }
        }
      }
      setModalLotRaw(null);
    }
  }, []);
  useEffect(() => {
    const onPop = () => {
      if (pendingBack.current) {
        pendingBack.current = false;
        if (reopenedDuringBack.current) {
          // the reopen won the race — restore the history entry it deserves
          reopenedDuringBack.current = false;
          try { window.history.pushState({ ...window.history.state, lectrLot: true }, ''); } catch { /* ignore */ }
        }
        return; // our own close-pop settling — the modal is already closed
      }
      if (modalPushed.current) { modalPushed.current = false; setModalLotRaw(null); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
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
    // trueSaleDay, not raw saleDate — the crawl-day artifact must never pick
    // (or date) the "first hammer" line. YYYY-MM-DD sorts lexically.
    const soonest = [...deals].sort((a, b) => trueSaleDay(a.lot).localeCompare(trueSaleDay(b.lot)))[0] || null;
    const artists = new Set(deals.map(d => d.lot.artist)).size;
    return { totalEst, medianGap, soonest, artists };
  }, [deals]);

  // SETTLED CALLS (#17) — the honesty-critical tape. A lot only carries a
  // below-market `signal` if it was in the eager upcoming set while LIVE (the
  // build stamps it; the corpus shards never do — useRayData re-attaches by id).
  // So a lot with signal.label === 'Below Market' AND a realized priceUsd is an
  // HONEST settled call: the flag was measured before the outcome was known,
  // exactly like /profile's save-time track record — never a post-hoc recompute
  // against a pool that now includes the sale itself. Dual-basis: realized
  // (all-in) leads; overEstimatePct divides the premium out for the honest
  // vs-comps read. If none qualify, the tape simply doesn't render.
  const settled = useMemo(() => {
    const today = localToday();
    return marketLots
      .filter(l =>
        l.signal && l.signal.label === 'Below Market' &&
        (l.priceUsd || 0) > 0 &&
        trueSaleDay(l) && trueSaleDay(l) < today)          // genuinely concluded
      .map(l => ({ lot: l, oe: overEstimatePct(l), med: (l.signal as { med?: number }).med ?? null }))
      .sort((a, b) => trueSaleDay(b.lot).localeCompare(trueSaleDay(a.lot))) // most recent first
      .slice(0, 3);
  }, [marketLots]);

  // HONESTY-FLEX ON THE RECORD (#20) — name our WORST cohort year openly. Only
  // years with an adequate flagged sample (≥30) are eligible; among those, the
  // lowest flaggedMedianPct. Naming the low is the strongest trust signal.
  const worstYear = useMemo(() => {
    if (!backtest?.series) return null;
    const eligible = backtest.series.filter(s => s.flaggedMedianPct != null && s.nFlagged >= 30);
    if (!eligible.length) return null;
    return eligible.reduce((w, s) => (s.flaggedMedianPct! < w.flaggedMedianPct! ? s : w));
  }, [backtest]);

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
    <div className="ray-mobnav-pad terminal-shell" style={{
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
          border-bottom: 2px dotted var(--color-border);
          text-align: left;
          font-family: var(--font-sans), sans-serif;
          color: var(--color-fg);
          cursor: pointer;
          transition: background var(--duration-fast) var(--ease-signature);
        }
        .ray-value-row:last-child,
        .ray-value-rowwrap:last-child .ray-value-row { border-bottom: none; }
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
            /* hammers column fits "Aug 13, 2026" in the mono size — 88px
               ellipsized the year on every long-month date */
            grid-template-columns: 56px minmax(0, 1fr) 92px 100px 118px 84px 52px 64px;
            gap: 16px;
          }
          .ray-value-head {
            display: grid;
            align-items: baseline;
            width: 100%;
            padding: 12px 16px 9px;
            border-bottom: 2px dotted var(--color-border);
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

        /* ── #14 ROW SAVE AFFORDANCE — the row IS a <button> (opens comps), so
           a save toggle can't nest inside it (invalid interactive-in-
           interactive). The row lives in a positioned wrapper; the save control
           is a SIBLING, floated over the row's right edge, its own tab stop. On
           the desktop ledger the gap column already owns the right edge, so the
           control tucks just inside without colliding. ── */
        .ray-value-rowwrap { position: relative; }
        .ray-value-rowwrap .ray-value-row { padding-right: 46px; }
        .ray-value-save {
          position: absolute;
          top: 50%;
          right: 8px;
          transform: translateY(-50%);
          width: 30px; height: 30px;
          display: flex; align-items: center; justify-content: center;
          background: none; border: none; border-radius: 100px;
          cursor: pointer; padding: 0; z-index: 2;
          opacity: 0.55;
          transition: opacity var(--duration-fast) var(--ease-signature);
        }
        .ray-value-save:hover, .ray-value-save:focus-visible,
        .ray-value-save[data-saved="true"] { opacity: 1; }
        .ray-value-save:active .ray-value-save-glyph { transform: scale(0.92); }
        .ray-value-row:active { background: var(--color-bg-elevated); }
        .ray-deepvalue-row:hover { background: var(--color-hover-item); }
        @media (max-width: 768px) {
          .ray-value-save { width: 44px; height: 44px; right: 2px; }
        }
        .ray-value-save-glyph {
          width: 26px; height: 26px; display: flex; align-items: center;
          justify-content: center; border-radius: 100px;
          background: var(--color-bg-elevated);
        }
        .ray-value-save[data-saved="true"] .ray-value-save-glyph { background: var(--color-fg); }
        @media (min-width: 900px) {
          .ray-value-rowwrap .ray-value-row { padding-right: 42px; }
          .ray-value-save { right: 6px; }
        }

        /* ── #18 CONFIDENCE DOTS — a monochrome ●●●○ glance-read beside the odds
           figure, only where a tier exists. Same register as the CallPlate's
           meter dots; never colored (dots are a count, not a delta). ── */
        .ray-value-conf {
          font-size: 9px; letter-spacing: 0.5px;
          color: var(--color-text-faint);
          margin-left: 6px; white-space: nowrap;
        }

        /* ── #19 ROW-HOVER LEADER LINE — on hover/focus a row extends the
           certificate sentence (comps median vs ask · n sales) below its cells,
           the plate grammar carried down the board. CSS-only reveal; also opens
           on keyboard focus of the row button. Collapses to zero height so it
           never shifts the resting layout. ── */
        .ray-value-leader {
          grid-column: 1 / -1;
          overflow: hidden;
          max-height: 0;
          opacity: 0;
          font-size: 11.5px;
          color: var(--color-text-muted);
          font-variant-numeric: tabular-nums;
          transition: max-height var(--duration-fast) var(--ease-signature),
                      opacity var(--duration-fast) var(--ease-signature),
                      margin-top var(--duration-fast) var(--ease-signature);
        }
        .ray-value-row:hover .ray-value-leader,
        .ray-value-row:focus-visible .ray-value-leader {
          max-height: 40px;
          opacity: 1;
          margin-top: 6px;
        }
        .ray-value-leader b { color: var(--color-fg); font-weight: 600; }
        .ray-value-leader .up { color: var(--color-up); font-weight: 700; }

        /* ── #17 SETTLED TAPE — three concluded flagged calls in the ledger
           register: what they hammered and how far over the comps. ── */
        .ray-value-tape { margin-top: 30px; }
        .ray-value-tape-row {
          display: flex; align-items: baseline; gap: 10px;
          padding: 11px 2px; font-size: 13px;
          border-top: 2px dotted var(--color-border);
        }
        .ray-value-tape-row:first-of-type { border-top: 2px solid var(--color-fg); }
        .ray-value-tape-maker { font-weight: 600; color: var(--color-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; }
        .ray-value-tape-fill { flex: 1; border-bottom: 2px dotted var(--color-border); transform: translateY(-3px); min-width: 12px; }
        .ray-value-tape-v { font-variant-numeric: tabular-nums; color: var(--color-text-muted); white-space: nowrap; }
        .ray-value-tape-v b { color: var(--color-fg); font-weight: 700; }
        .ray-value-tape-v .up { color: var(--color-up); font-family: var(--font-mono), monospace; font-weight: 700; }
      ` }} />

      <ArtistNav activeSlug="value" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {/* C3 BLOCKER: paint from PHASE 1 — the engine call/signal is
          precomputed on the eager upcoming.json lots (every eager lot carries
          the `signal` stamp; `lotSignal` never client-recomputes past it), so
          the masthead, Today's Call and the flagged ledger render the SAME
          numbers at ~2s that they rendered after the 32MB corpus (measured
          31.4s to first content on mobile Fast-4G behind the old
          `!fullLoaded` gate). Corpus-dependent extras — the call plate's
          PriceBand (gated on fullLoaded below), settled tape (needs realized
          prices), modal comp rows (compsPending) — hydrate in behind without
          ever swapping a printed figure. */}
      {loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          <div className="rail ray-enter" style={{ paddingTop: 'var(--space-4)' }}><MarketSwitch compact /></div>

          {/* phase-2 failed: the ledger above still stands on the precomputed
              stamps — say what's missing instead of blanking the page */}
          {fullError && (
            <div className="rail ray-enter" style={{ paddingTop: 12, textAlign: 'center' }}>
              <button className="ray-call-btn ray-call-btn-quiet" style={{ cursor: 'pointer' }} onClick={() => retryFullLoad()}>
                Part of the book didn&rsquo;t load — comps depth is missing · try again
              </button>
            </div>
          )}

          {/* The certificate masthead — the flagged count and totals fold
              into the data subline; full numbers, no second display numeral. */}
          <section className="rail ray-enter" style={{ paddingTop: 'calc(var(--space-4) + var(--space-2))' }}>
            <Masthead
              kicker="The signal · ranked by calibrated odds"
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
                    {summary.soonest && <> · first hammer {formatDate(trueSaleDay(summary.soonest.lot))}</>}
                  </>
                : 'No lots are flagged below market right now — the crawl refreshes daily.'}
            />
          </section>

          {/* ── DEEP VALUE · CLOSING SOON — the bid-house read (Aug 14):
              projected close (bid × the fitted close-day curve, all-in) still
              ≥25% under the lot's value floor inside the final days. A
              PROJECTION product — its receipt is accumulating in the calls
              ledger; it wears no certified language. */}
          {(deepValue?.[activeKey]?.length ?? 0) > 0 && (
            <section className="rail ray-enter" style={{ '--enter-delay': '40ms', paddingTop: 'calc(var(--space-4) + var(--space-2))' } as React.CSSProperties}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <h2 className="ray-h2" style={{ marginBottom: 0 }}>
                  Deep value · closing soon
                </h2>
                <span style={{ fontSize: 11, color: 'var(--color-faint)' }}>
                  projected close vs value floor · projection read, record accruing
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {deepValue[activeKey].slice(0, 12).map(r => {
                  const lot = allLots.find(l => String(l.id) === r.id);
                  if (!lot) return null;
                  return (
                    <Link key={r.id} href={`/lot/${r.id}`} className="ray-deepvalue-row" style={{
                      display: 'flex', alignItems: 'baseline', gap: 14, padding: '10px 2px',
                      borderTop: '2px dotted var(--color-hair, rgba(255,255,255,0.06))',
                      color: 'inherit', textDecoration: 'none',
                      transition: 'background var(--duration-fast) var(--ease-signature)',
                    }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--color-up)', minWidth: 72 }}>
                        {Math.round(r.depth * 100)}% under
                      </span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {lot.title}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                        {lot.auctionHouse} · proj {formatPrice(r.allIn)} vs {formatPrice(r.floor)} · closes {formatDate(r.closes)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

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
            <div className="ray-band" style={{ marginTop: 34, paddingBlock: '28px 34px' }}>
            <section className="rail ray-enter" style={{ '--enter-delay': '90ms', paddingTop: 0 } as React.CSSProperties}>
              {/* DUAL BASIS, premium-led (the decree): the headline medians are
                  all-in (realized prices include the buyer's premium ~25%) with
                  the hammer read as the sub-line — EXCEPT beat-the-estimate,
                  where estimates are hammer-basis so the hammer figure is the
                  only honest lead (labeled "at the hammer"). Every cell names
                  its basis; falls back to all-in when an old cached
                  backtest.json lacks the hammer fields. */}
              <RecordBand
                title="The record"
                context="every call replayed against history"
                serial={(lastCrawl || new Date().toISOString()).slice(0, 10).replace(/-/g, '')}
                footer="each figure names its basis · refit nightly from the full replay"
                cells={[
                  {
                    k: 'Flagged lots hammered',
                    v: fmtSignedPct(backtest.flagged.medianPerfPct),
                    signed: backtest.flagged.medianPerfPct,
                    sub: `median realized vs estimate · ${backtest.flagged.n.toLocaleString()} calls${backtest.flagged.hammerMedianPct != null ? ` · ${fmtSignedPct(backtest.flagged.hammerMedianPct)} hammer-only` : ''}`,
                  },
                  {
                    k: 'Unflagged hammered',
                    v: fmtSignedPct(backtest.unflagged.medianPerfPct),
                    signed: backtest.unflagged.medianPerfPct,
                    sub: <>{backtest.unflagged.n.toLocaleString()} lots · the signal&rsquo;s edge: {backtest.flagged.medianPerfPct - backtest.unflagged.medianPerfPct} pts</>,
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
                        v: fmtSignedPct(backtest.above.medianPerfPct),
                        signed: backtest.above.medianPerfPct,
                        sub: 'underperformed both — the ordering holds',
                      },
                ]}
              />
            </section>
            </div>
          )}

          {backtest && backtest.flagged.n >= 100 && <RecordByYear backtest={backtest} />}

          {/* PER-MARKET RECORD + HONESTY PROOFS (Aug 14) — the global receipt
              was art/design-dominant; a vertical's user deserves ITS number.
              byMarket + bandCoverage fill from the next backtest replay; the
              section renders only when present. */}
          {backtest && (backtest as { byMarket?: Record<string, { flagged: { n: number; medPct: number | null }; unflagged: { n: number; medPct: number | null } }> }).byMarket && (
            <section className="rail ray-enter" style={{ paddingTop: 8 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 22px', fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                <span style={{ letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 10.5, color: 'var(--color-text-faint)' }}>By market</span>
                {Object.entries((backtest as unknown as { byMarket: Record<string, { flagged: { n: number; medPct: number | null }; unflagged: { n: number; medPct: number | null } }> }).byMarket)
                  .filter(([, r]) => r.flagged.medPct != null && r.unflagged.medPct != null)
                  .map(([m, r]) => (
                    <span key={m} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <b style={{ color: 'var(--color-fg)' }}>{m}</b>{' '}
                      flagged {r.flagged.medPct! >= 0 ? '+' : ''}{r.flagged.medPct}% vs {r.unflagged.medPct! >= 0 ? '+' : ''}{r.unflagged.medPct}% · n {r.flagged.n.toLocaleString()}
                    </span>
                  ))}
              </div>
              {(backtest as unknown as { calibration?: { bandCoverage?: Record<string, number | null> } }).calibration?.bandCoverage && (
                <p style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 6 }}>
                  Band honesty: realized landed inside our published band{' '}
                  {Object.entries((backtest as unknown as { calibration: { bandCoverage: Record<string, number | null> } }).calibration.bandCoverage)
                    .filter(([, v]) => v != null)
                    .map(([conf, v]) => `${v}% of the time (${conf})`)
                    .join(' · ')}.
                </p>
              )}
            </section>
          )}

          {/* #20 HONESTY-FLEX — name the WEAKEST cohort year openly (adequate
              sample only, ≥30 flagged). Naming the low, not just the average,
              is the strongest trust signal. Green/red only because it's a real
              measured median; mono only on the %-figure. */}
          {worstYear && (
            <section className="rail ray-enter" style={{ paddingTop: 8 }}>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', maxWidth: 620 }}>
                Our weakest year, {worstYear.year}, flagged calls still hammered{' '}
                <b style={{
                  fontFamily: 'var(--font-mono), monospace',
                  fontWeight: 700,
                  color: toneOf(worstYear.flaggedMedianPct!) === 'up' ? 'var(--color-up)'
                    : toneOf(worstYear.flaggedMedianPct!) === 'down' ? 'var(--color-down-text)' : 'var(--color-fg)',
                }}>{fmtSignedPct(worstYear.flaggedMedianPct!)}</b>{' '}
                median over estimate · {worstYear.nFlagged.toLocaleString()} calls.
              </p>
            </section>
          )}

          <section className="ray-value-section rail">
            {deals.length === 0 ? (
              /* #15 THIN-VERTICAL EMPTY STATE — a specific market with nothing
                 flagged shouldn't dead-end. Point to the cross-market flags
                 (/value 'all') and this vertical's own research desk, honestly
                 framed; the total-market view keeps the plain browse line. */
              <div className="ray-enter" style={{ textAlign: 'center', padding: '40px 20px 100px', color: 'var(--color-text-faint)' }}>
                {activeKey !== 'all' ? (
                  <>
                    <p style={{ fontSize: 15.5, marginBottom: 8, color: 'var(--color-text-muted)' }}>
                      Nothing in the {activeLabel} market clears under its comps right now.
                    </p>
                    <p style={{ fontSize: 13.5, marginBottom: 22 }}>
                      The engine abstains rather than force a thin call — the crawl refreshes daily.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 22px', justifyContent: 'center' }}>
                      <Link href="/value" className="link-action" style={{ color: 'var(--color-fg)' }}>
                        See cross-market flags <span className="arrow"><Flick size={10} style={{ marginLeft: 5 }} /></span>
                      </Link>
                      <Link href={`/analytics/${activeKey}`} className="link-action" style={{ color: 'var(--color-fg)' }}>
                        Open the {activeLabel} research desk <span className="arrow"><Flick size={10} style={{ marginLeft: 5 }} /></span>
                      </Link>
                    </div>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: 15.5, marginBottom: 20 }}>Check back after the next crawl, or browse everything live.</p>
                    <Link href="/" className="link-action" style={{ color: 'var(--color-fg)' }}>
                      Browse upcoming lots <span className="arrow"><Flick size={10} style={{ marginLeft: 5 }} /></span>
                    </Link>
                  </>
                )}
              </div>
            ) : (
              <>
                <h2 className="ray-h2 ray-enter" style={{ marginBottom: 18 }}>
                  Calibrated odds first · the deepest gap breaks ties
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
                    <span className="kicker" style={{ textAlign: 'right' }}>Odds</span>
                    <span className="kicker" style={{ textAlign: 'right' }}>Gap</span>
                  </div>
                  {gridDeals.slice(0, shown).map((d, i) => {
                    const conf = d.lot.value?.signal ? null : (d.lot.signal?.confidence ?? d.signal?.confidence);
                    // odds column carries the tier's dots; where the engine
                    // published a calibrated beatRate there's no coarse tier to
                    // show alongside it, so dots defer to the number.
                    const rowMed = (d.signal as { med?: number } | null)?.med ?? (() => {
                      const lo = d.lot.estimateLow || d.lot.estimateHigh || 0;
                      const hi = d.lot.estimateHigh || d.lot.estimateLow || 0;
                      const mid = (lo + hi) / 2;
                      return mid > 0 ? mid * (1 + d.signal!.pct / 100) : null;
                    })();
                    return (
                    <div key={d.lot.id} className="ray-value-rowwrap ray-enter-card"
                      style={{ '--enter-delay': `${Math.min(i, 8) * 40}ms` } as React.CSSProperties}>
                    <button
                      type="button"
                      className="ray-value-row"
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
                          {craftTitle(d.lot.title)}
                          <span className="ray-value-mobdate">
                            {/* trueSaleDay on BOTH sides — a results-pending lot in
                                the grace window reads "hammered", and a crawl-day
                                saleDate can neither mislabel nor misdate a live one.
                                #12: a still-open lot closing today names the urgency. */}
                            {(() => {
                              const day = trueSaleDay(d.lot) || d.lot.saleDate;
                              const past = trueSaleDay(d.lot) && trueSaleDay(d.lot) < localToday();
                              const dU = daysUntil(day);
                              if (!past && dU != null && dU <= 0) {
                                const tonight = !!d.lot.saleDateTime && new Date(d.lot.saleDateTime).getHours() >= 17;
                                return <> · <span style={{ color: 'var(--color-up)', fontWeight: 600 }}>{tonight ? 'closes tonight' : 'closes today'}</span></>;
                              }
                              return <>{' '}· {past ? 'hammered' : 'hammers'} {formatDate(day)}</>;
                            })()}
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
                      <span className="ray-value-cell">{formatDate(trueSaleDay(d.lot) || d.lot.saleDate)}</span>
                      <span className="ray-value-cell ray-value-cell-num ray-value-cell-est">{formatEstimate(d.lot).replace(/ est\.$/, '')}</span>
                      <span className="ray-value-cell ray-value-cell-num">
                        {rowMed ? formatPrice(rowMed) : '—'}
                      </span>
                      <span className="ray-value-cell ray-value-cell-num ray-value-cell-odds">
                        {d.lot.value?.signal?.beatRatePct != null
                          ? `${Math.round(d.lot.value.signal.beatRatePct)}%`
                          : conf
                            ? <span className="ray-value-conf" aria-label={`${confidenceMeter(conf).word} confidence`}>{confidenceMeter(conf).dots}</span>
                            : '—'}
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
                      {/* #19 ROW-HOVER LEADER LINE — the certificate sentence,
                          revealed on hover or keyboard focus of the row. Same
                          statistic the modal shows; mono only on the %-figure. */}
                      <span className="ray-value-leader" aria-hidden="true">
                        {rowMed
                          ? <>comps median <b>{formatPrice(rowMed)}</b> vs {formatEstimate(d.lot).replace(/ est\.$/, '')} ask · <span className="up">{signalMagnitude('Below Market', Math.round(d.signal!.pct))}</span> over{d.signal!.basis ? <> · {d.signal!.basis} sales</> : null}</>
                          : <>{signalMagnitude('Below Market', Math.round(d.signal!.pct))} over ask{d.signal!.basis ? <> · {d.signal!.basis} sales</> : null}</>}
                      </span>
                    </button>
                    {/* #14 SAVE — sibling of the row button, not nested (both are
                        interactive); its own tab stop, floated on the right edge */}
                    <button
                      type="button"
                      className="ray-value-save"
                      data-saved={isSaved(d.lot.id)}
                      onClick={() => toggle(d.lot.id, d.lot)}
                      aria-label={isSaved(d.lot.id) ? 'Remove from saved' : 'Save lot'}
                      aria-pressed={isSaved(d.lot.id)}
                    >
                      <span className="ray-value-save-glyph">
                        <svg width="10" height="12" viewBox="0 0 12 14" fill="none" aria-hidden="true">
                          <path d="M1 1.5C1 1.22386 1.22386 1 1.5 1H10.5C10.7761 1 11 1.22386 11 1.5V12.5C11 12.6894 10.8862 12.8625 10.7096 12.9472C10.533 13.0319 10.3239 13.0136 10.1646 12.8994L6 9.91421L1.83541 12.8994C1.67614 13.0136 1.46698 13.0319 1.29037 12.9472C1.11377 12.8625 1 12.6894 1 12.5V1.5Z"
                            fill={isSaved(d.lot.id) ? 'var(--color-bg)' : 'var(--color-text-faint)'} />
                        </svg>
                      </span>
                    </button>
                    </div>
                    );
                  })}
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

                {/* #17 SETTLED CALLS — the last flagged lots that hammered and
                    what they did. Honest by construction: only lots that
                    carried a live below-market signal (the build stamp, kept
                    on the eager set) AND have a realized price qualify — the
                    flag was measured before the outcome. Realized (all-in)
                    leads; the hammer-basis vs-comps read is the sub. Renders
                    only when the data actually supports it. */}
                {settled.length > 0 && (
                  <div className="ray-value-tape ray-enter">
                    <h2 className="ray-h2" style={{ marginBottom: 4 }}>Settled calls</h2>
                    <p style={{ fontSize: 12.5, color: 'var(--color-text-faint)', marginBottom: 14 }}>
                      Recently flagged below market — what they hammered, and how the realized price landed against comps.
                    </p>
                    {settled.map(s => (
                      <div key={s.lot.id} className="ray-value-tape-row">
                        <span className="ray-value-tape-maker">{ARTIST_LABEL[s.lot.artist] || s.lot.artist}</span>
                        <span className="ray-value-tape-fill" aria-hidden />
                        <span className="ray-value-tape-v">
                          hammered <b>{formatPrice(s.lot.priceUsd!)}</b> all-in
                          {s.oe != null && <> · <span style={{
                            fontFamily: 'var(--font-mono), monospace', fontWeight: 700,
                            color: toneOf(s.oe) === 'up' ? 'var(--color-up)'
                              : toneOf(s.oe) === 'down' ? 'var(--color-down-text)' : 'var(--color-text-muted)',
                          }}>{fmtSignedPct(s.oe)}</span> vs estimate at the hammer</>}
                          {s.med != null && s.lot.priceUsd! > 0 && (() => {
                            // hammer-basis realized vs the signal's comps median —
                            // divide the premium out so it's an apples read
                            const hammer = (s.lot.hammerUsd ?? s.lot.hammerPrice ?? 0) > 0
                              ? (s.lot.hammerUsd ?? s.lot.hammerPrice)!
                              : s.lot.priceUsd! / 1.25;
                            const vsComps = (hammer / s.med - 1) * 100;
                            return <span style={{ color: 'var(--color-text-faint)' }}> · {toneOf(vsComps) === 'up' ? 'above' : toneOf(vsComps) === 'down' ? 'below' : 'at'} comps med</span>;
                          })()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          {/* ── THE ENGINE CARD — the paper slab that closes the page: what
              the engine is, in its own room grammar (lander paper language),
              with the full read one click away. Figures are the live
              backtest's own. ── */}
          <section className="rail ray-enter" style={{ paddingBlock: '18px 8px' }}>
            <div className="ray-engine-card">
              <div className="ray-engine-eyebrow">
                <img src="/brand/lectr-ink.png" alt="" aria-hidden />
                <span>The value engine</span>
              </div>
              <h2 className="ray-engine-head">Every flag here <em>earned its ink</em>.</h2>
              <p className="ray-engine-body">
                A read is comps, not opinion: same maker, same form, size-banded —
                medians, never means. Each vertical carries its own gate (a jersey
                only comps that player&rsquo;s jerseys; a Daytona only same-reference,
                same-metal Daytonas), and where the data can&rsquo;t carry a call, the
                engine abstains rather than guesses.
              </p>
              {backtest && backtest.flagged.n > 500 && (
                <div className="ray-engine-stats">
                  <span><b>{backtest.flagged.n.toLocaleString()}</b> calls replayed</span>
                  <span className="ray-engine-dot" aria-hidden />
                  {/* the all-in median, named as such — "hammered +41%" would
                      dress the premium-inclusive figure in the hammer's word */}
                  <span>flagged realized <b className="up">{fmtSignedPct(backtest.flagged.medianPerfPct)}</b> all-in vs estimate</span>
                  <span className="ray-engine-dot" aria-hidden />
                  <span>the edge: <b>{backtest.flagged.medianPerfPct - backtest.unflagged.medianPerfPct} pts</b></span>
                </div>
              )}
              <Link href="/blog/how-we-built-the-pricing-engine" className="ray-engine-cta">
                Read how it&rsquo;s built &rarr;
              </Link>
            </div>
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
      <Colophon record={null} />
    </div>
  );
}
