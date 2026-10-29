'use client';
/**
 * WATCHING — the room, action-first, the brief fused in (lifted from
 * page.tsx unchanged): the ledger + cards views, why-now tags, Δ saved,
 * signal now, in-place dossiers, FLIP re-ranking, the phone's glance rows
 * with Show all.
 *
 * (THE DESK v4, Oct 29 2026) ONE ROW GRAMMAR: the seven-column ledger and
 * the phone's separate glance rows are one list of DeskRows (../row) at
 * every width — photo · title · maker / house / estimate · the why-now tag,
 * the signal pill, Δ saved, bid velocity and the hammer on the meta line ·
 * the decision line · the live bid (or the estimate) as the figure with My
 * max under it. The whole row opens the lot; "Details ›" (a BUTTON —
 * aria-expanded, aria-controls; the j/k focus target) opens the same dossier
 * in place: estimate, the block, the engine read, comps / appraisal, your
 * save, the hammer, My max, Bid at the house, Open the lot, Remove watch.
 * The Ledger / Cards toggle stays the reader's at every width.
 */
import { MyMax } from '../mymax';
import { safeHref } from '../../../lib/safe-href';
import { SigPill } from '../thumb';
import { DeskRow, rowWhoOf, bidsSubOf, priceFigureOf } from '../row';
import { contextComps } from '../../../lib/comps';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../../../types';
import { signalCallOf, type SavedMeta } from '../../../lib/account';
import LotCard, { formatEstimate, LiveStamp } from '../../../components/LotCard';
import { lotVerdict } from '../../../lib/verdict';
import CloseClock from '../../../components/CloseClock';
import { WatchMark } from '../../../components/marks';
import DecisionLine from '../../../components/DecisionLine';
import { formatDate, craftTitle, closeDayOf } from '../../../utils';
import { fmtFace } from '../../../lib/lot-face';
import { fromText } from '../priced';
import { displayMakerOf } from '../../../lib/maker-subjects';
import { RoomHead } from '../../head';
import { closeDays, hammerWord, sigText, type LiveSignal } from '../derive';
import { useDeskInternals } from '../provider';
import type { SectionProps, SectionMeta, DeskData, DeskActions } from '../types';
import type { DeskInternals } from '../provider';
import { GLOSSARY, SavedDelta, callText } from './shared';
import { ClosingNow } from '../../week';
import { closingNowOf, offsetWord, dayOffsetOf, dayWords, localClock } from '../../week/week';
import { useDesk } from '../provider';

type SavedView = 'ledger' | 'cards';
/** rows a phone shows of a long room before "Show all" */
export const PHONE_ROWS = 6;
const SAVEDVIEW_KEY = 'lectr-savedview';

/** The in-place dossier — a watching row opens on its own row. Everything
    the cards view buried (the saved-delta narrative, the engine read with
    its basis, the live bid state) without leaving the ledger. Mounted only
    while open, so collapsed rows keep zero of its links in the tab order.

    (pass 4) on the row grammar: the facts as one line of pills (the signal,
    the estimate, the block, velocity, your call at save, the appraisal or
    the direct comps, the hammer), the comparable sales as compact DeskRows
    (contextComps — the same pool the comps modal reads), My max as an
    inline editor, and the foot: Bid at the house · Open the lot · Remove
    watch · Close. The wrapper keeps .ck-dossier / .ck-dossier-actions (the
    page's own dossier styling); the content wears dk-dossier-*. */
const DOSSIER_COMPS = 3;
function RowDossier({ lot, meta, sig, allLots, act, onRemove, onClose, id }: {
  lot: AuctionLot; meta: SavedMeta | undefined; sig: LiveSignal | null;
  act: Pick<DeskActions, 'openLot'>;
  /** the loaded book — the comparable sales are read from it */
  allLots: AuctionLot[];
  onRemove: () => void;
  onClose: () => void;
  /** the dossier's DOM id — its expand control's aria-controls */
  id?: string;
}) {
  // (Oct 6 2026, wave 4) the ENGINE's appraisal (lot.value, ×5-sane) — never
  // a client appraisal over the loaded slice
  const appr = useMemo(() => { const vd = lotVerdict(lot); return vd ? { value: vd.expectedAllIn, n: vd.compN } : null; }, [lot]);
  const comps = useMemo(() => contextComps(lot, allLots), [lot, allLots]);
  const call = signalCallOf(meta);
  const days = closeDays(lot);
  const hasEst = (lot.estimateLow || 0) > 0 || (lot.estimateHigh || 0) > 0;
  const vel = lot.bidVelocity && lot.bidVelocity.delta > 0 ? lot.bidVelocity : null;
  const title = craftTitle(lot.title, lot.auctionHouse);
  // (pass 6) focus moves into the opened dossier (the region itself, so the
  // reader hears its name first); Close hands it back to Details
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  return (
    <div className="ck-dossier dk-dossier" id={id} role="region" aria-label={`Details for ${title}`} tabIndex={-1} ref={ref}>
      {/* (pass 7) the full title — the row above keeps one line and an ellipsis */}
      <p className="dk-dossier-title">{title}</p>
      <SavedDelta lot={lot} meta={meta} sig={sig} />
      {/* the facts, one line of pills (they wrap on a phone, never clip) */}
      <div className="dk-dossier-pills" role="list" aria-label="The lot's facts">
        {sig && (
          <span className="dk-fact" role="listitem" title={`${GLOSSARY['signal now']}${sig.basis != null && sig.basis > 0 ? ` · ${sig.basis} comps` : ''}`}>
            <SigPill dir={sig.label === 'Below Market' ? 'up' : 'down'} label={`${sig.label}, ${sigText(sig)}`}>{sigText(sig)}</SigPill> vs comps{sig.basis != null && sig.basis > 0 ? ` · ${sig.basis}` : ''}
          </span>
        )}
        {hasEst && (
          // ONE "priced" rule (../priced): a one-sided estimate prints "from $X" and never enters a total
          <span className="dk-fact" role="listitem" title={fromText(lot) ? 'one bound published — not in the desk’s total' : 'the house estimate'}>
            est <b>{fromText(lot) ?? formatEstimate(lot).replace(/ est\.$/, '')}</b>{fromText(lot) ? ' · one bound' : ''}
          </span>
        )}
        {(lot.currentBid || 0) > 0 && (
          <span className="dk-fact" role="listitem">
            <b>{fmtFace(lot.currentBid!)}</b> bid · {bidsSubOf(lot)}{lot.overlayAt && <> · <LiveStamp iso={lot.overlayAt} /></>}
          </span>
        )}
        {vel && <span className="dk-fact" role="listitem" title="bids added in the trailing window — the engine's bid velocity">+{vel.delta} {vel.delta === 1 ? 'bid' : 'bids'}/{Math.round(vel.hours)}h</span>}
        {lot.cardComps && lot.cardComps.n > 0 && lot.cardComps.med != null ? (
          <span className="dk-fact" role="listitem" title="the median of the same card and grade's sales">direct comps <b>{fmtFace(lot.cardComps.med)}</b> · {lot.cardComps.n} same card &amp; grade</span>
        ) : appr ? (
          <span className="dk-fact" role="listitem" title={GLOSSARY['appraisal']}>appraisal <b>{fmtFace(appr.value)}</b> · {appr.n} comps</span>
        ) : null}
        {meta && (
          <span className="dk-fact" role="listitem" title="your save: the day, the estimate then, the engine's call then">
            saved {formatDate(meta.savedAt)}{meta.estMid != null && <> · est {fmtFace(meta.estMid)} then</>}{call && call.dir !== 'unknown' && <> · called <b style={{ color: call.dir === 'below' ? 'var(--color-up)' : 'var(--color-down-text)' }}>{callText(call)}</b></>}
          </span>
        )}
        <span className="dk-fact" role="listitem">
          {days === 0 && lot.saleDateTime ? <CloseClock iso={lot.saleDateTime} windowHours={24} prefix="hammers " /> : /^(today|tomorrow|in )/.test(hammerWord(days)) ? `hammers ${hammerWord(days)}` : hammerWord(days)}
        </span>
      </div>
      {/* the comparable sales as compact rows — the comps modal's own pool, its first three */}
      {comps.rows.length > 0 && (
        <div className="dk-dossier-comps">
          <div className="ck-reads-head">
            <span className="kicker">Comps · {comps.rows.length}{comps.median != null ? <> · median {fmtFace(comps.median)}</> : null}</span>
            <i className="ck-reads-rule" />
            <button type="button" className="dk-link" onClick={() => act.openLot(lot)}>All comps</button>
          </div>
          <div className="dk-list">
            {comps.rows.slice(0, DOSSIER_COMPS).map(c => (
              <DeskRow key={c.id} lot={c} compact
                sub={[rowWhoOf(c), c.auctionHouse, closeDayOf(c) ? formatDate(closeDayOf(c)) : null].filter(Boolean).join(' · ')}
                figure={c.priceUsd ? fmtFace(c.priceUsd) : <span data-quiet>—</span>} figureKind="hammer" figureText={c.priceUsd ? fmtFace(c.priceUsd) : 'no price'} />
            ))}
          </div>
        </div>
      )}
      {/* your max, inline — set or change it here */}
      <div className="dk-dossier-max">
        <span className="kicker">Your max</span>
        <MyMax lot={lot} />
        <span className="dk-dossier-max-note">the most you would pay at hammer — Record grades it against the hammer</span>
      </div>
      <div className="ck-dossier-actions dk-dossier-foot">
        {/* one action set on every live row: bid at the house · open · remove · close (Oct 20 audit; pass 4 adds the close) */}
        {safeHref(lot.url) && <a href={safeHref(lot.url)!} target="_blank" rel="noopener noreferrer">Bid at {lot.auctionHouse} ↗</a>}
        <Link href={`/lot?id=${encodeURIComponent(lot.id)}`}>Open the lot</Link>
        <button type="button" className="quiet" onClick={onRemove}>Remove watch</button>
        <button type="button" className="dk-dossier-close" onClick={onClose} aria-label={`Close details for ${title}`}>Close <span aria-hidden>‹</span></button>
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
  const { desk, act, narrow } = useDesk();
  // (Phase 2) the ≤24h closers ride as a live strip above the ledger; with
  // none inside 24h the strip's one-liner folds into the head's sub-line
  const closingNow = useMemo(() => closingNowOf(desk.saved, desk.now), [desk.saved, desk.now]);
  const cnNext = closingNow.next;
  const { upcoming, summary, room, signalById, metaFor, allLots, isSaved, savedIdOf, toggle, onCardToggle } = i;

  // read in the initializer (the desk renders client-side only): a tab switch
  // remounts this room, and an effect-based read flashed ledger → cards
  const [savedView, setSavedView] = useState<SavedView>(() => {
    if (typeof window === 'undefined') return 'ledger';
    try {
      // the URL is shareable state and wins; localStorage is the memory
      const uv = new URLSearchParams(window.location.search).get('view');
      if (uv === 'cards' || uv === 'ledger') return uv;
      const v = localStorage.getItem(SAVEDVIEW_KEY) ?? localStorage.getItem('ray-savedview');
      if (v === 'cards' || v === 'ledger') return v;
    } catch { /* private mode */ }
    return 'ledger';
  });
  const [closersOpen, setClosersOpen] = useState(false);
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

  /* ── INPUT CRAFT — Enter on the Details button toggles the row's dossier
     (j/k is the page's, ../keys) ── */
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
          Every bookmarked lot still on the block, soonest hammer first (the same day: flagged below
          market, then bid momentum, then quiet). <b>vs comps</b> is the engine&rsquo;s read now; <b>since saved</b> is how far that read
          moved since you saved the lot, in points. <b>My max</b> on each row is the most you would pay — tap it to set or change it.
          The row opens the lot; <b>Details ›</b> (or Enter on a row <b>j</b>/<b>k</b> landed on) opens its dossier in place. The tag on each row says why it needs you now.
          Under a title, <b>worth up to</b> is the engine&rsquo;s max bid and the gap to the projected close
          beside it. A row with no such line is one the engine abstained on (too little like it has sold) or
          could not price — no value is implied, high or low.
        </> }}
        sub={<>
          {upcoming.length} live {upcoming.length === 1 ? 'lot' : 'lots'}
          {summary.closesToday > 0 && <> · {summary.closesToday} {summary.closesToday === 1 ? 'closes' : 'close'} today</>}
          {summary.flagged > 0 && <> · {summary.flagged} below market</>}
          {summary.totalEst > 0 && <><span className="ck-wide"> · {fmtFace(summary.totalEst)} at estimate midpoint{summary.priced < upcoming.length && <> · {summary.priced} of {upcoming.length} priced</>}</span></>}
          {closingNow.live > 0 && closingNow.rows.length === 0 && (
            <> · none close in the next 24h{cnNext ? <> · next: <Link href={`/lot?id=${encodeURIComponent(cnNext.lot.id)}`} className="ck-away-link">{craftTitle(cnNext.lot.title, cnNext.lot.auctionHouse)}</Link>, {offsetWord(dayOffsetOf(cnNext.day, desk.now)) ?? `${dayWords(cnNext.day).wd}, ${dayWords(cnNext.day).md}`}{cnNext.timed ? ` at ${localClock(cnNext.closeMs)}` : ''}</> : null}</>
          )}
        </>}
        actions={
          <div className="ray-savedview-toggle" role="group" aria-label="Watching view">
            <button className="ray-savedview-btn" data-active={savedView === 'ledger'} aria-pressed={savedView === 'ledger'} onClick={() => pickView('ledger')}>Ledger</button>
            <button className="ray-savedview-btn" data-active={savedView === 'cards'} aria-pressed={savedView === 'cards'} onClick={() => pickView('cards')}>Cards</button>
          </div>
        } />
      {/* (Oct 20 audit) a signed-out desk keeps its watches on this device only —
          from the third watch the room says so, once, with the one tap that fixes it */}
      {i.auth.authEnabled && !i.auth.user && upcoming.length >= 3 && (
        <p className="ck-keepline">
          These {upcoming.length} watches live on this device only.{' '}
          <button type="button" className="ck-deskdetails-btn" onClick={() => i.auth.signInWithGoogle()}>Sign in to keep them everywhere</button>
        </p>
      )}
      {/* (Phase 2) CLOSING NOW — the ≤24h closers as a live ticker row,
          countdown + bids + decision line, above the ledger */}
      {/* (Oct 20) in the Ledger view the closers' rows lead the ledger already —
          the bid cards fold to one line (one tap opens them, bid buttons and all);
          the Cards view keeps them open */}
      {closingNow.rows.length > 0 && (savedView === 'cards' || closersOpen
        ? <ClosingNow desk={desk} act={act} narrow={narrow} />
        : (
          <p className="ck-head-sub ck-closers-line">
            {closingNow.rows.length} {closingNow.rows.length === 1 ? 'watch closes' : 'watches close'} in the next 24h ·{' '}
            <button type="button" className="ck-deskdetails-btn" aria-expanded={false} onClick={() => setClosersOpen(true)}>Show the bid cards</button>
          </p>
        ))}
      {/* THE LIST — one DeskRow per watch (../row): the figure is the live bid
          (the estimate when nothing is bid yet), My max under it; the why-now
          tag, the signal pill, Δ saved, bid velocity and the hammer ride the
          meta line; Details › opens the same dossier in place. One list at
          every width — a phone opens on its most urgent rows, the rest one tap */}
      {savedView === 'ledger' && (
        <div className="dk-ledger ray-enter" ref={boardRef}>
          <div className="dk-list" role="list">
            {(narrow && !allWatch ? room.slice(0, PHONE_ROWS) : room).map(({ l: lot, reason }) => {
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
              const dossierId = `ck-dossier-${lot.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
              const bid = (lot.currentBid || 0) > 0 ? lot.currentBid! : 0;
              // the estimate as the figure: the range alone, "estimate" under it; a
              // one-sided "from $X" prints as it is; the house's no-estimate words
              // ("No reserve · opening bid") as a short quiet figure, the rest under
              const price = priceFigureOf(lot);
              const twoSided = price.kind === 'est' && !price.quiet && !fromText(lot);
              const est = price.fig;
              // the hammer, in words — the Hammers column's fact, on the meta line
              const hammer = days === 0 && lot.saleDateTime
                ? <CloseClock iso={lot.saleDateTime} windowHours={24} prefix="hammers " />
                : /^(today|tomorrow|in )/.test(hammerWord(days)) ? `hammers ${hammerWord(days)}` : hammerWord(days);
              return (
                <DeskRow key={lot.id} lot={lot} as="div" attrs={{ 'data-flip-id': lot.id, role: 'listitem' }}
                  tone={sig?.label === 'Below Market' ? 'up' : undefined}
                  // with a live bid as the figure the sub-line keeps a two-sided estimate
                  // (a one-sided one is the decision line's "estimate from $X"); without
                  // a bid the estimate IS the figure — the sub-line never repeats the figure
                  sub={[displayMakerOf(lot)?.name, lot.auctionHouse, bid && twoSided ? `${est} est.` : null].filter(Boolean).join(' · ')}
                  tag={reason ? { text: reason.tag, tone: reason.tag === 'Below market' ? 'up' : reason.tag === 'Lands soon' ? 'hot' : undefined } : null}
                  meta={<>
                    <span className="dk-meta-fact" style={days >= 0 && days <= 1 ? { color: 'var(--color-fg)' } : undefined}>{hammer}</span>
                    {sig && (
                      <span title={GLOSSARY['signal now']}>
                        <SigPill dir={sig.label === 'Below Market' ? 'up' : 'down'} label={`${sig.label}, ${sigText(sig)} vs comps`}>{sigText(sig)}</SigPill>
                      </span>
                    )}
                    {(flipped || (dPP != null && dPP !== 0)) && (
                      <span className="dk-meta-fact" title={GLOSSARY['delta saved']} style={{ color: flipped ? 'var(--color-text-muted)' : dInk }}>
                        {flipped ? 'flipped since saved' : `${dPP! > 0 ? '+' : '−'}${Math.abs(dPP!)}pp since saved`}
                      </span>
                    )}
                    {vel ? <span className="dk-meta-fact">+{vel.delta} {vel.delta === 1 ? 'bid' : 'bids'}/{Math.round(vel.hours)}h</span>
                      : newBids > 0 ? <span className="dk-meta-fact">+{newBids} {newBids === 1 ? 'bid' : 'bids'} since saved</span> : null}
                  </>}
                  figure={bid ? fmtFace(bid) : <span data-quiet={price.quiet || undefined}>{est}</span>} figureKind={bid ? 'bid' : 'est'} figureText={bid ? fmtFace(bid) : est}
                  figureSub={bid ? bidsSubOf(lot) : price.sub}
                  pill={<MyMax lot={lot} compact />}
                  decision={<DecisionLine lot={lot} estimate={false} when={false} abstain="quiet" style={{ marginTop: 0 }} />}
                  expand={{ open, id: dossierId, onToggle: () => toggleRow(lot.id) }}>
                  <RowDossier lot={lot} meta={m} sig={sig} id={dossierId} allLots={allLots} act={act}
                    onRemove={() => { setOpenRow(null); toggle(savedIdOf(lot.id)); }}
                    onClose={() => { setOpenRow(null); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[aria-controls="${dossierId}"]`)?.focus()); }} />
                </DeskRow>
              );
            })}
          </div>
          {/* a phone opens on the most urgent rows; the rest are one tap */}
          {narrow && room.length > PHONE_ROWS && (
            <button type="button" className="ck-today-more" aria-expanded={allWatch} onClick={() => setAllWatch(v => !v)}>
              {allWatch ? 'Show fewer' : `Show all ${room.length} watching`}
            </button>
          )}
        </div>
      )}

      {/* cards — an opt-in at every width (R2 c: the toggle stays reachable on a phone); mounted only when shown */}
      {savedView === 'cards' && (
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
