'use client';
/**
 * THE PICKS GROUP — one room in three parts (lifted from page.tsx): what
 * lectr picks for you (Lots you may like), what the block would do to what
 * you hold (For your collection, ../collection), and how the picks it showed
 * you closed (How your picks did, ../outcomes). One plate, one rail pill;
 * the two followers are sub-rooms.
 *
 * (THE DESK v4, Oct 29 2026) every pick is the desk's one row (../row
 * DeskRow): photo · title · maker / house / the reason (recNote) · the
 * decision line · the estimate or live bid as the figure · Watch and More
 * like this / Not for me (a phone: the ⋯ sheet) in the action slot. The
 * deal's order is kept as the engine ranked it — a "New to you" tag marks
 * the discover lane, "Below market" the engine's flag — rather than regrouped
 * under seed heads, so the strongest ties still lead and Show more pages on.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AuctionLot } from '../../../types';
import { RankMark } from '../../../components/marks';
import { belowSignalOf, feedTone } from '../../../components/LotBrowser';
import { recNote, type Taste, type Rec } from '../../../lib/recs';
import { DeskRow, priceFigureOf, rowWhoOf } from '../row';
import { PickFeedback, UndoSeat, usePickFeedback, withUndoSeat } from '../../../components/PickFeedback';
import QuickStart from '../../../components/QuickStart';
import { usePricePref, priceText } from '../../../lib/interests';
import DecisionLine from '../../../components/DecisionLine';
import { useLogPicks } from '../../../lib/pick-log';
import { craftTitle } from '../../../utils';
import { RoomHead } from '../../head';
import { useGridCols, PickSkeleton } from '../../grid';
import PickMenu from '../../pickmenu';
import PickOutcomes from '../../outcomes';
import ForYourCollection from '../../collection';
import { useStalled } from '../../stall';
import { useDeskInternals, useDesk, type Deal, type DeskInternals } from '../provider';
import { jump } from '../../rail';
import type { SectionProps, SectionMeta, DeskData } from '../types';

export function RecsRoom({ book, deal, compLots, taste, ready, isSaved, onToggleSave, compact = false, top }: {
  book: AuctionLot[]; deal: Deal; compLots: AuctionLot[]; taste: Taste; ready: boolean; lastCrawl?: string;
  isSaved: (id: string) => boolean; onToggleSave: (id: string, lot?: AuctionLot) => void; signedOut?: boolean;
  /** a desk with live watches: the picks open as one row, Show more deals the rest */
  compact?: boolean;
  /** the picks the Today band already prints (its Top 3 strip) — the room
   *  starts after them, so no pick shows twice on the page */
  top?: readonly Rec<AuctionLot>[];
}) {
  const { pool } = deal;
  const recs = useMemo(() => {
    if (!top?.length) return deal.recs;
    const ids = new Set(top.map(r => r.lot.id));
    return deal.recs.filter(r => !ids.has(r.lot.id));
  }, [deal.recs, top]);
  // (deadline) a book that never lands: the seat stops pretending to load
  const slow = useStalled(!ready, 15_000);
  // (Oct 11) the reader's stated price range (quick start, app/lib/interests)
  // rides inside the taste as a strong band (recs' statedFit) — named here only
  const pricePref = usePricePref();
  const [editing, setEditing] = useState(false);
  // Tune keeps the reader's place: focus lands on the editor's head when it
  // opens, and returns to Tune when it closes (Done / Cancel)
  const tuneRef = useRef<HTMLButtonElement | null>(null);
  const editRef = useRef<HTMLDivElement | null>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) {
      const t = window.setTimeout(() => {
        const root = editRef.current;
        const head = root?.querySelector<HTMLElement>('.ray-feedsheet-head') ?? root?.querySelector<HTMLElement>('button, input');
        if (!head) return; // phone: the sheet traps its own focus
        if (!head.matches('button, input')) head.tabIndex = -1;
        head.focus({ preventScroll: false });
      }, 30);
      wasEditing.current = true;
      return () => window.clearTimeout(t);
    }
    if (wasEditing.current) { wasEditing.current = false; tuneRef.current?.focus(); }
  }, [editing]);
  const below = useMemo(() => belowSignalOf(recs.map(r => r.lot), compLots), [recs, compLots]);
  const cols = useGridCols();
  // a phone keeps the ⋯ sheet for More like this / Not for me (44px targets)
  const { narrow } = useDesk();
  // the rows the room opens on: six (a desk whose own watches lead the page: three)
  const page = compact ? 3 : 6;
  const [shown, setShown] = useState<number | null>(null);
  const visible = shown ?? page;
  // "More like this / Not for me" — this device only (app/lib/recs-signals)
  const fb = usePickFeedback();

  const c = taste.counts;
  const from = [
    c.saved ? `${c.saved} ${c.saved === 1 ? 'save' : 'saves'}` : null,
    c.owned ? `${c.owned} owned` : null,
    c.follows ? `${c.follows} ${c.follows === 1 ? 'follow' : 'follows'}` : null,
    c.searches ? `${c.searches} saved ${c.searches === 1 ? 'search' : 'searches'}` : null,
    // what this browser learned (visits, searches AND More like this marks —
    // not all of them "looks", R4 P3-15)
    c.signals ? `${c.signals} ${c.signals === 1 ? 'signal' : 'signals'} on this device` : null,
  ].filter(Boolean).join(', ');
  const cold = ready && taste.seeds.length === 0;
  // (R3#9) "Show my picks" on a cold desk: the picks deal and the page lands
  // so the masthead's "Tuned to …" line and the cockpit are in view, then the
  // picks — not the middle of a room that just changed shape under the tap
  const wasCold = useRef(false);
  useEffect(() => {
    if (cold) { wasCold.current = true; return; }
    if (wasCold.current && ready) { wasCold.current = false; window.setTimeout(() => jump('desk', { focus: false }), 60); }
  }, [cold, ready]);
  // a pick you just asked "More like this" of keeps its seat: the list re-reads
  // at once and the new kin would otherwise push it off the screen under
  // your finger (the lit pill must stay where you pressed it)
  const lastShown = useRef<Rec<AuctionLot>[]>([]);
  const shownList = useMemo(() => {
    const base = recs.slice(0, visible);
    const keep = lastShown.current.map((r, i) => ({ r, i })).filter(x => fb.marks.get(x.r.lot.id) === 'more');
    if (!keep.length) return base;
    const out = base.filter(r => !keep.some(k => k.r.lot.id === r.lot.id));
    for (const k of keep) out.splice(Math.min(k.i, out.length), 0, recs.find(x => x.lot.id === k.r.lot.id) ?? k.r);
    return out.slice(0, Math.max(visible, keep.length));
  }, [recs, visible, fb.marks]);
  useEffect(() => { lastShown.current = shownList; }, [shownList]);
  // the picks on screen, noted on this device with what lectr said then (N4)
  // (the Today band's Top 3 are on screen too — noted with the room's)
  useLogPicks(useMemo(() => (ready && !editing ? [...(top ?? []), ...shownList].map(r => ({ lot: r.lot, rec: r })) : null), [ready, editing, shownList, top]), 'p');
  const seats = withUndoSeat(shownList, fb.undo);

  return (
    <section id="for-you" className="ray-saved-section rail ray-enter ck-foryou" aria-label="Lots you may like">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <RoomHead mark={<RankMark size={17} />} title="Lots you may like" style={{ marginBottom: cold ? 4 : 16 }}
          help={{ name: 'Lots you may like', body: <>            Every lot on the block is read against what you <b>own</b>, <b>save</b>, <b>follow</b> and <b>search</b> — in
            that order of weight, recent saves louder than old ones. A lot qualifies only through a real tie: the same
            maker, player, Pokémon or subject; the same card in another grade; the same franchise or model line; or,
            inside one category, the same era, grader or language at a price like yours. A category you follow counts
            only for the kind of thing it names. Then the strongest ties that matter most and close soonest lead. The
            names you keep may fill much of the list; looser matches are spread out, so one sale, one category or one
            single signal never takes over. Lots at the prices you save and own — or the range you set in Tune — lead
            lots far from them, and a lot well outside your range comes last and says so. A lot the engine reads below
            market says so. When a name you follow has only a few lots live, the list goes on to its nearest kin —
            another Pokémon, another player of the same sport and era — and each such pick says that is why it is here.
            Lots on your desk never come back here. The line under each lot says why it is here; the picks re-read with
            every crawl and every save. What you open and search on this device leans the list (a few seats are kept
            for it), and More like this / Not for me steer it at once — Not for me also quiets what led to that pick.
            Kept in this browser, never uploaded.
            Everything that tunes the list is under <a href="#signals" className="ck-away-link">Your signals</a>.
          </> }}
          actions={ready && !cold && !editing
            ? <button ref={tuneRef} type="button" className="ray-toolbar-pill ck-tune" aria-haspopup="dialog" onClick={() => setEditing(true)}>Tune</button>
            : null}
          sub={ready && !cold ? (
            <>
              {deal.recs.length > 0 ? <>{deal.recs.length} picked</> : <>nothing ties yet</>}<span className="ck-wide"> from {pool.length.toLocaleString()} live lots</span>
              {top?.length ? <> · top {top.length} <a href="#today" className="ck-away-link">in Today</a></> : null}
              {pricePref ? <> · {priceText(pricePref)}</> : null} · <span className="ck-wide">tuning </span>from {from}
            </>
          ) : null} />

        {!ready ? (
          <div aria-busy="true">
            {slow
              ? <p className="ck-sig-note" role="status" style={{ margin: '0 0 14px' }}>The live book is slow to arrive — your picks land here the moment it does.</p>
              : <>
                  <p className="ck-sig-note" style={{ margin: '0 0 14px' }}>Reading the block against your desk…</p>
                  <PickSkeleton cols={cols} n={page} />
                </>}
          </div>
        ) : cold ? (
          // the cold start and the Tune editor sit on the room's own spacing (rooms.css .dk-tune)
          <div className="dk-tune"><QuickStart book={book} mode="cold" surface="profile" /></div>
        ) : editing ? (
          <div ref={editRef} className="dk-tune">
            <QuickStart book={book} mode="edit" surface="profile" onClose={() => setEditing(false)} />
          </div>
        ) : null}
        {!ready || cold ? null : recs.length === 0 && top?.length ? (
          <p className="ck-sig-note" style={{ margin: 0 }}>
            {top.length === 1 ? 'Your one pick is' : `All ${top.length} of your picks are`} in the <a href="#today" className="ck-away-link">Today</a> tab — new lots land with every crawl.
          </p>
        ) : recs.length === 0 ? (
          <div>
            <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: 0, maxWidth: 640, lineHeight: 1.55 }}>
              Nothing on the block ties to your desk right now — no live lot shares a name, card, franchise or close
              enough cut with what you hold. New lots land with every crawl.
            </p>
            {!editing && <button type="button" className="ray-toolbar-pill" style={{ marginTop: 14 }} onClick={() => setEditing(true)}>Add a follow</button>}
          </div>
        ) : (
          <div className="dk-list ck-picks-list">
            {seats.map((r, i) => {
              if ('undoSeat' in r) return <UndoSeat key={`undo-${r.undoSeat.id}`} undo={r.undoSeat} onUndo={fb.undoIt} row />;
              const price = priceFigureOf(r.lot);
              const saved = isSaved(r.lot.id);
              const tone = feedTone(r.lot, below.ids, below.hasSig);
              return (
                <DeskRow key={r.lot.id} lot={r.lot} pick={r.lot.id} wrap tone={tone}
                  // the reason is the row's honesty payload — it wraps, never cut
                  sub={<>{[rowWhoOf(r.lot), r.lot.auctionHouse].filter(Boolean).join(' · ')} · <b>{recNote(r)}</b></>}
                  tag={r.lane === 'discover' ? { text: 'New to you' } : r.flagged ? { text: 'Below market', tone: 'up' } : null}
                  figure={<span data-quiet={price.quiet || undefined}>{price.fig}</span>} figureKind={price.kind} figureSub={price.sub}
                  decision={<DecisionLine lot={r.lot} estimate={false} abstain="quiet" />}
                  action={<>
                    <button type="button" className="ray-toolbar-pill" data-active={saved} aria-pressed={saved} onClick={() => onToggleSave(r.lot.id, r.lot)}
                      aria-label={saved ? `Stop watching ${craftTitle(r.lot.title, r.lot.auctionHouse)}` : `Watch ${craftTitle(r.lot.title, r.lot.auctionHouse)}`}>
                      {saved ? 'Watching' : 'Watch'}
                    </button>
                    {narrow
                      ? <PickMenu lot={r.lot} mark={fb.marks.get(r.lot.id)} onMark={fb.mark} at={i} />
                      : <PickFeedback lot={r.lot} mark={fb.marks.get(r.lot.id)} onMark={fb.mark} at={i} bare />}
                  </>} />
              );
            })}
          </div>
        )}

        {ready && visible < recs.length && (
          <div className="ck-more-row">
            <button className="ray-show-more" onClick={() => setShown(Math.min(recs.length, visible + 6))}>
              Show more ({recs.length - visible} more {recs.length - visible === 1 ? 'pick' : 'picks'})
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function meta(desk: DeskData): SectionMeta {
  return { id: 'for-you', label: 'For you', count: desk.recs.length || undefined };
}

/** the group: For you → For your collection → How your picks did */
export default function PicksGroup(_p: SectionProps) {
  const i: DeskInternals = useDeskInternals();
  const { allLots, tasteBook, deal, recTaste, recsReady, lastCrawl, isSaved, toggle, signedOutView, watchFirst, todayTop } = i;
  const compact = watchFirst;
  return (
    <div className="ck-group" data-compact={compact || undefined}>
      <RecsRoom book={allLots} deal={deal} compLots={allLots} taste={recTaste} ready={recsReady} lastCrawl={lastCrawl || undefined}
        isSaved={isSaved} onToggleSave={toggle} signedOut={signedOutView} compact={compact} top={compact ? todayTop : undefined} />
      <ForYourCollection book={tasteBook} pool={deal.pool} compLots={allLots} ready={recsReady} lastCrawl={lastCrawl || undefined}
        isSaved={isSaved} onToggleSave={toggle} />
      <PickOutcomes book={allLots} />
    </div>
  );
}
