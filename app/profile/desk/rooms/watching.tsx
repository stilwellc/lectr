'use client';
/**
 * WATCHING — the room, action-first, the brief fused in (lifted from
 * page.tsx unchanged): the ledger + cards views, why-now tags, Δ saved,
 * signal now, in-place dossiers, sticky head, FLIP re-ranking, the phone's
 * glance rows with Show all.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../../../types';
import { signalCallOf, type SavedMeta } from '../../../lib/account';
import LotCard, { formatEstimate, LiveStamp } from '../../../components/LotCard';
import { lotVerdict } from '../../../lib/verdict';
import CloseClock from '../../../components/CloseClock';
import { WatchMark } from '../../../components/marks';
import DecisionLine from '../../../components/DecisionLine';
import { formatPrice, formatDate, craftTitle } from '../../../utils';
import { displayMakerOf } from '../../../lib/maker-subjects';
import { RoomHead } from '../../head';
import { closeDays, hammerWord, sigInk, sigText, type LiveSignal } from '../derive';
import { useDeskInternals } from '../provider';
import type { SectionProps, SectionMeta, DeskData } from '../types';
import type { DeskInternals } from '../provider';
import { Term, SavedDelta } from './shared';

type SavedView = 'ledger' | 'cards';
/** rows a phone shows of a long room before "Show all" */
export const PHONE_ROWS = 6;
const SAVEDVIEW_KEY = 'lectr-savedview';

/** The in-place dossier — a watching row opens on its own row. Everything
    the cards view buried (the saved-delta narrative, the engine read with
    its basis, the live bid state) without leaving the ledger. Mounted only
    while open, so collapsed rows keep zero of its links in the tab order. */
function RowDossier({ lot, meta, sig, onRemove }: {
  lot: AuctionLot; meta: SavedMeta | undefined; sig: LiveSignal | null;
  onRemove: () => void;
}) {
  // (Oct 6 2026, wave 4) the ENGINE's appraisal (lot.value, ×5-sane) — never
  // a client appraisal over the loaded slice
  const appr = useMemo(() => { const vd = lotVerdict(lot); return vd ? { value: vd.expectedAllIn, n: vd.compN } : null; }, [lot]);
  const call = signalCallOf(meta);
  const days = closeDays(lot);
  const hasEst = (lot.estimateLow || 0) > 0 || (lot.estimateHigh || 0) > 0;
  return (
    <div className="ck-dossier" role="region" aria-label={`Details for ${lot.title}`}>
      <SavedDelta lot={lot} meta={meta} sig={sig} />
      <div className="ck-dossier-grid">
        {hasEst && (
          <div className="ck-dossier-cell">
            <span className="kicker">Estimate</span>
            <span className="ck-dossier-v">{formatEstimate(lot)}</span>
          </div>
        )}
        {(lot.currentBid || 0) > 0 && (
          <div className="ck-dossier-cell">
            <span className="kicker">On the block</span>
            <span className="ck-dossier-v">
              {formatPrice(lot.currentBid!)} bid
              {typeof lot.bidCount === 'number' && lot.bidCount > 0 && <span className="sub"> · {lot.bidCount} {lot.bidCount === 1 ? 'bid' : 'bids'}</span>}
              {lot.overlayAt && <span className="sub"> · <LiveStamp iso={lot.overlayAt} /></span>}
            </span>
          </div>
        )}
        {sig && (
          <div className="ck-dossier-cell">
            <span className="kicker">Engine read</span>
            <span className="ck-dossier-v" style={{ color: sigInk(sig.label) }}>
              {sigText(sig)}
              {sig.basis != null && sig.basis > 0 && <span className="sub"> · {sig.basis} comps</span>}
            </span>
          </div>
        )}
        {lot.cardComps && lot.cardComps.n > 0 && lot.cardComps.med != null ? (
          <div className="ck-dossier-cell">
            <span className="kicker">Direct comps</span>
            <span className="ck-dossier-v">{formatPrice(lot.cardComps.med)}<span className="sub"> · {lot.cardComps.n} same card &amp; grade</span></span>
          </div>
        ) : appr ? (
          <div className="ck-dossier-cell">
            <span className="kicker">Appraisal</span>
            <span className="ck-dossier-v">{formatPrice(appr.value)}<span className="sub"> · {appr.n} comps</span></span>
          </div>
        ) : null}
        {meta && (
          <div className="ck-dossier-cell">
            <span className="kicker">Your save</span>
            <span className="ck-dossier-v">
              {formatDate(meta.savedAt)}
              {meta.estMid != null && <span className="sub"> · est. {formatPrice(meta.estMid)} then</span>}
              {call && call.dir !== 'unknown' && (
                <span className="sub"> · called {call.dir === 'below' ? '+' : '−'}{Math.round(call.pct)}%</span>
              )}
            </span>
          </div>
        )}
        <div className="ck-dossier-cell">
          <span className="kicker">Hammers</span>
          <span className="ck-dossier-v">
            {days === 0 && lot.saleDateTime ? <CloseClock iso={lot.saleDateTime} windowHours={24} /> : hammerWord(days)}
          </span>
        </div>
      </div>
      <div className="ck-dossier-actions">
        <Link href={`/lot?id=${encodeURIComponent(lot.id)}`}>Open the lot</Link>
        <button type="button" className="quiet" onClick={onRemove}>Remove watch</button>
      </div>
    </div>
  );
}

export function meta(_desk: DeskData, i: DeskInternals): SectionMeta | null {
  if (!i.watchFirst) return null;
  return { id: 'watching', label: 'Watching', count: i.upcoming.length };
}

export default function WatchingRoom(_p: SectionProps) {
  const i = useDeskInternals();
  const { upcoming, summary, room, ledgerCols, signalById, metaFor, allLots, isSaved, savedIdOf, toggle, onCardToggle, isDesktop } = i;

  const [savedView, setSavedView] = useState<SavedView>('ledger');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // the URL is shareable state and wins; localStorage is the memory
      const uv = new URLSearchParams(window.location.search).get('view');
      if (uv === 'cards' || uv === 'ledger') { setSavedView(uv); return; }
      const v = localStorage.getItem(SAVEDVIEW_KEY) ?? localStorage.getItem('ray-savedview');
      if (v === 'cards' || v === 'ledger') setSavedView(v);
    } catch { /* private mode */ }
  }, []);
  const pickView = (v: SavedView) => {
    setSavedView(v);
    try { localStorage.setItem(SAVEDVIEW_KEY, v); } catch { /* private mode */ }
    // round-trip ?view= — seed from the CURRENT search so foreign params and
    // the hash survive; ledger is the default and owns a clean URL
    try {
      const sp = new URLSearchParams(window.location.search);
      if (v === 'ledger') sp.delete('view'); else sp.set('view', v);
      const q = sp.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
    } catch { /* older browsers: state just isn't shareable */ }
  };

  /* ── INPUT CRAFT — Enter/Space toggles the row's dossier (j/k is the
     page's, ../keys) ── */
  const [openRow, setOpenRow] = useState<string | null>(null);
  // phone folds: the long rooms open on their first rows (desktop shows all)
  const [allWatch, setAllWatch] = useState(false);
  const toggleRow = useCallback((id: string) => setOpenRow(o => (o === id ? null : id)), []);

  /* ── FLIP — the action-first ledger re-ranks when data moves; rows should
     visibly travel, not teleport. BOARD-relative tops (never viewport), a
     forced reflow between offset write and reset (or the transition has no
     painted origin), same-id-set only, settle timers tracked. ── */
  const boardRef = useRef<HTMLDivElement | null>(null);
  const flipPos = useRef<Map<string, number>>(new Map());
  const flipTimers = useRef<number[]>([]);
  const measureBoard = useCallback(() => {
    const board = boardRef.current;
    const next = new Map<string, number>();
    if (board) {
      const boardTop = board.getBoundingClientRect().top;
      board.querySelectorAll<HTMLElement>('[data-flip-id]').forEach(el => {
        next.set(el.dataset.flipId!, el.getBoundingClientRect().top - boardTop);
      });
    }
    return next;
  }, []);
  const flipKey = room.map(r => r.l.id).join('|');
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) { flipPos.current = new Map(); return; }
    const prev = flipPos.current;
    const next = measureBoard();
    flipTimers.current.forEach(t => window.clearTimeout(t));
    flipTimers.current = [];
    const sameSet = prev.size === next.size && Array.from(next.keys()).every(k => prev.has(k));
    if (sameSet && prev.size > 0) {
      const moved: HTMLElement[] = [];
      board.querySelectorAll<HTMLElement>('[data-flip-id]').forEach(el => {
        const id = el.dataset.flipId!;
        const dy = (prev.get(id) ?? 0) - (next.get(id) ?? 0);
        if (Math.abs(dy) > 1) {
          el.style.transition = 'none';
          el.style.transform = `translateY(${dy}px)`;
          moved.push(el);
        }
      });
      if (moved.length) {
        void board.offsetHeight; // reflow — the reset below needs this origin painted
        requestAnimationFrame(() => {
          moved.forEach(el => { el.style.transition = 'transform 420ms var(--ease-signature)'; el.style.transform = ''; });
          flipTimers.current.push(window.setTimeout(() => {
            moved.forEach(el => { el.style.transition = ''; });
          }, 470));
        });
      }
    }
    flipPos.current = next;
  }, [flipKey, measureBoard]);
  // a dossier opening/closing shifts every row below it — re-baseline after
  // the expansion settles or the next sort animates from stale tops
  useEffect(() => {
    const t = window.setTimeout(() => { flipPos.current = measureBoard(); }, 380);
    return () => window.clearTimeout(t);
  }, [openRow, measureBoard]);

  if (upcoming.length === 0) return null;
  return (
    <section id="watching" className="ray-saved-section rail" data-view={savedView}>
      {/* the room as a framed plate — ns-plate draws the top rule + crop marks */}
      <div className="ns-plate" style={{ paddingTop: 18 }}>
      <RoomHead className="ray-enter" mark={<WatchMark size={17} />} title="Watching · on the block" style={{ marginBottom: 14 }}
        help={{ name: 'Watching', body: <>
          Every bookmarked lot still on the block, sorted action-first: lands soon, then flagged below
          market, then bid momentum, then quiet. Click a row (or press Enter on it) to open its dossier
          in place — <b>j</b>/<b>k</b> walks the rows. The tag on each row says why it needs you now.
          Under a title, <b>worth up to</b> is the engine&rsquo;s max bid and the gap to the projected close
          beside it. A row with no such line is one the engine abstained on (too little like it has sold) or
          could not price — no value is implied, high or low.
        </> }}
        sub={<>
          {upcoming.length} live {upcoming.length === 1 ? 'lot' : 'lots'}
          {summary.closesToday > 0 && <> · {summary.closesToday} {summary.closesToday === 1 ? 'closes' : 'close'} today</>}
          {summary.flagged > 0 && <> · {summary.flagged} below market</>}
          {summary.totalEst > 0 && <><span className="ck-wide"> · {formatPrice(summary.totalEst)} at estimate midpoint</span></>}
        </>}
        actions={
          <div className="ray-savedview-toggle" role="group" aria-label="Watching view">
            <button className="ray-savedview-btn" data-active={savedView === 'ledger'} aria-pressed={savedView === 'ledger'} onClick={() => pickView('ledger')}>Ledger</button>
            <button className="ray-savedview-btn" data-active={savedView === 'cards'} aria-pressed={savedView === 'cards'} onClick={() => pickView('cards')}>Cards</button>
          </div>
        } />
      {/* desktop ledger */}
      {/* a column with nothing in it on any row folds away (legacy saves
          carry no direction, so Δ saved can be all dashes) */}
      <div className="ray-saved-ledger ray-enter" ref={boardRef}
        data-nosig={ledgerCols.sig ? undefined : ''} data-nodelta={ledgerCols.delta ? undefined : ''}>
        <div className="ray-saved-cols ray-saved-ledger-head">
          <span className="kicker">Why now</span>
          <span className="kicker">Work</span>
          <span className="kicker r">Est</span>
          <span className="kicker r"><Term k="signal now">Signal now</Term></span>
          <span className="kicker r"><Term k="delta saved">Δ saved</Term></span>
          <span className="kicker r">Hammers</span>
        </div>
        {room.map(({ l: lot, reason }) => {
          const sig = signalById.get(lot.id) ?? null;
          const m = metaFor(lot.id);
          const call = signalCallOf(m);
          const sameAxis = call && sig && call.dir !== 'unknown' &&
            ((call.dir === 'below') === (sig.label === 'Below Market'));
          const dPP = sameAxis && sig ? Math.round(sig.pct) - Math.round(call!.pct) : null;
          const flipped = call && sig && call.dir !== 'unknown' && !sameAxis;
          const newBids = m?.bidCount != null && (lot.bidCount || 0) > m.bidCount
            ? (lot.bidCount || 0) - m.bidCount : 0;
          const days = closeDays(lot);
          const vel = lot.bidVelocity && lot.bidVelocity.delta > 0 ? lot.bidVelocity : null;
          // Δ ink: on the below axis deeper (+) is the deal deepening;
          // on the above axis deeper (+) is it worsening
          const dInk = dPP == null || dPP === 0 ? 'var(--color-text-faint)'
            : (call!.dir === 'below' ? dPP > 0 : dPP < 0) ? 'var(--color-up)' : 'var(--color-down-text)';
          const open = openRow === lot.id;
          return (
            <div key={lot.id} data-flip-id={lot.id}>
              {/* the row is the dossier's handle — the work title still
                  deep-links; everything else opens in place */}
              <div
                role="button" tabIndex={0} data-nav-row aria-expanded={open}
                className="ray-saved-cols ray-savedrow ck-expandrow"
                onClick={() => toggleRow(lot.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(lot.id); } }}
              >
                <span className="ck-why">
                  {reason && <span className="ck-tag" data-tone={reason.tag === 'Below market' ? 'up' : reason.tag === 'Lands soon' ? 'hot' : undefined}>{reason.tag}</span>}
                </span>
                <span className="work">
                  {displayMakerOf(lot) && <span className="ck-workmaker">{displayMakerOf(lot)!.name}</span>}
                  <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} style={{ color: 'inherit', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>
                    {craftTitle(lot.title, lot.auctionHouse)}
                  </Link>
                  {/* (N2) the decision: the Est and Hammers columns print the rest */}
                  <DecisionLine lot={lot} estimate={false} when={false} abstain="quiet" style={{ marginTop: 3 }} />
                </span>
                <span className="num">{formatEstimate(lot) || '—'}</span>
                <span className="num" style={sig ? { color: sigInk(sig.label), fontWeight: 700 } : { color: 'var(--color-text-faint)' }}
                  aria-label={sig ? `${sig.label}, ${Math.abs(Math.round(sig.pct))} percent` : 'no signal'}>
                  {sig ? sigText(sig) : '—'}
                </span>
                <span className="num" style={{ color: flipped ? 'var(--color-text-muted)' : dInk }}>
                  {flipped ? 'flipped' : dPP != null && dPP !== 0 ? `${dPP > 0 ? '+' : '−'}${Math.abs(dPP)}pp` : '—'}
                  {vel ? (
                    <span className="sub">+{vel.delta} {vel.delta === 1 ? 'bid' : 'bids'}/{Math.round(vel.hours)}h</span>
                  ) : newBids > 0 ? (
                    <span className="sub">+{newBids} {newBids === 1 ? 'bid' : 'bids'}</span>
                  ) : null}
                </span>
                <span style={{ textAlign: 'right', fontSize: 13, color: days === 0 ? 'var(--color-fg)' : 'var(--color-text-secondary)', fontWeight: days <= 1 ? 600 : 500, whiteSpace: 'nowrap' }}>
                  {days === 0 && lot.saleDateTime
                    ? <CloseClock iso={lot.saleDateTime} windowHours={24} />
                    : hammerWord(days)}
                </span>
              </div>
              {open && (
                <RowDossier lot={lot} meta={m} sig={sig}
                  onRemove={() => { setOpenRow(null); toggle(savedIdOf(lot.id)); }} />
              )}
            </div>
          );
        })}
      </div>

      {/* mobile: the glance rows — same facts, thumb scale */}
      <div className="ck-mledger ray-enter">
        {(allWatch ? room : room.slice(0, PHONE_ROWS)).map(({ l: lot, reason }) => {
          const sig = signalById.get(lot.id) ?? null;
          const days = closeDays(lot);
          return (
            <Link key={lot.id} href={`/lot?id=${encodeURIComponent(lot.id)}`} className="ck-mrow" data-nav-row>
              <span className="ck-mrow-main">
                <span className="ck-mtitle">{craftTitle(lot.title, lot.auctionHouse)}</span>
                <span className="ck-msub">
                  {reason && <span className="ck-tag" data-tone={reason.tag === 'Below market' ? 'up' : reason.tag === 'Lands soon' ? 'hot' : undefined}>{reason.tag}</span>}
                  {[displayMakerOf(lot)?.name, formatEstimate(lot)].filter(Boolean).join(' · ')}
                </span>
                <DecisionLine lot={lot} estimate={false} when={false} abstain="quiet" style={{ marginTop: 2 }} />
              </span>
              <span className="ck-mrow-right">
                {sig && <b style={{ color: sigInk(sig.label) }} aria-label={`${sig.label}, ${Math.abs(Math.round(sig.pct))} percent`}>{sigText(sig)}</b>}
                <span className="ck-mham" style={days <= 1 ? { color: 'var(--color-fg)', fontWeight: 600 } : undefined}>
                  {days === 0 && lot.saleDateTime
                    ? <CloseClock iso={lot.saleDateTime} windowHours={24} />
                    : hammerWord(days)}
                </span>
              </span>
            </Link>
          );
        })}
        {/* a phone opens on the most urgent rows; the rest are one tap */}
        {room.length > PHONE_ROWS && (
          <button type="button" className="ck-today-more" aria-expanded={allWatch} onClick={() => setAllWatch(v => !v)}>
            {allWatch ? 'Show fewer' : `Show all ${room.length} watching`}
          </button>
        )}
      </div>

      {/* cards — desktop opt-in only; mounted only when shown */}
      {savedView === 'cards' && isDesktop === true && (
        <div className="ray-saved-grid">
          {room.map(({ l: lot }, idx) => (
            <div key={lot.id} className="ray-enter-card" style={{ '--enter-delay': `${Math.min(idx, 8) * 60}ms` } as React.CSSProperties}>
              <LotCard lot={lot} showArtist allLots={allLots} saved={isSaved(savedIdOf(lot.id)) || isSaved(lot.id)} onToggleSave={onCardToggle} decision={<DecisionLine lot={lot} estimate={false} abstain="quiet" />} />
              <SavedDelta lot={lot} meta={metaFor(lot.id)} sig={signalById.get(lot.id) ?? null} />
            </div>
          ))}
        </div>
      )}
      </div>
    </section>
  );
}
