'use client';
/**
 * THE FOLD (THE DESK v4, Oct 29 2026) — one page, layered. Every room still
 * mounts on the desk, in one column; a fold decides how much of it shows:
 *
 *   clamp    the room mounts whole but shows its first screen (its head and
 *            the rows that matter), faded at the foot with one "Show all 8 ·
 *            Watching" that opens it in place — nothing is removed, only
 *            folded. A room shorter than the clamp shows no fold at all, and
 *            a clamped room never cuts a row in half: the clamp sits on the
 *            last whole row that fits (the j/k rows, [data-nav-row], and the
 *            heads are the row marks). "Show less" closes it and brings the
 *            room's head back under the chrome.
 *   closed   (the More rooms — Budget, Signals, Market, History) one row:
 *            the room's mark, name, figure and one-line hint, and the tap
 *            that mounts it; an open room closes from a "Close" at its foot.
 *   seat     (pass 5, Oct 29) a clamped room below the first screen does not
 *            mount until it is within one viewport of the reader
 *            (IntersectionObserver, rootMargin 100%): until then a seat as
 *            tall as the clamp holds its place, so nothing below it jumps.
 *            A jump, a g-chord or a deep link into the room mounts it first
 *            (owns()); the section bar's figures never depend on it (they
 *            come from the registry, sections.ts tabItemsOf).
 *
 * Every anchor keeps landing: a jump() to a room (or an anchor inside it)
 * opens its fold first — OPEN_TAB_EVENT fires when the target isn't in the
 * DOM yet (a closed room), JUMP_EVENT once it is (a clamped one) — and the
 * landing in rail.tsx finds the element on its next poll.
 */
import React, { useEffect, useRef, useState } from 'react';
import { JUMP_EVENT, OPEN_TAB_EVENT } from '../rail';
import { noteOpen, noteNear, noteClosed, wasOpen, wasNear, wasClosedOpen, snapFor } from './restore';

/** does `id` (a room id, an anchor inside one, a week day) belong to this fold?
 *  Exported for the landing tests (push-parity): a push's /profile#anchor opens
 *  the fold that owns it. */
export function owns(ids: readonly string[], id: string | undefined): boolean {
  if (!id) return false;
  if (ids.includes(id)) return true;
  if (id.startsWith('week-') && ids.includes('week')) return true;
  return false;
}

function useOpensOnJump(ids: readonly string[], setOpen: (v: boolean) => void) {
  useEffect(() => {
    const on = (e: Event) => { if (owns(ids, (e as CustomEvent<{ id: string }>).detail?.id)) setOpen(true); };
    window.addEventListener(OPEN_TAB_EVENT, on);
    window.addEventListener(JUMP_EVENT, on);
    return () => { window.removeEventListener(OPEN_TAB_EVENT, on); window.removeEventListener(JUMP_EVENT, on); };
  }, [ids, setOpen]);
  // a deep link into this fold on load (the landing polls for the element) —
  // not on a return (restore.ts): the fold is what the reader left it
  useEffect(() => {
    if (snapFor(window.location.pathname)) return;
    let id = '';
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    if (owns(ids, id)) setOpen(true);
  }, [ids, setOpen]);
}

/** the room's head is above the viewport: bring it back under the chrome
 *  (scroll-margin-top on the element carries the measured sticky offset) */
function backToTop(el: HTMLElement | null) {
  if (!el) return;
  requestAnimationFrame(() => {
    if (el.getBoundingClientRect().top >= 0) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  });
}

/** the marks a clamp may sit on — a boundary is the bottom of one of these.
 *  The rows first (the j/k rows, the call cards); then the blocks a room
 *  without rows is made of (its head, a paragraph, a figure grid, a table),
 *  never one nested inside a row (a row's own paragraph is not a boundary) */
const ROWS = '[data-nav-row], .pe-call, .pe-trow, .pe-card, .ray-lot-card, .pf-shelf > *, .pf-chart, .ck-call-well';
const BLOCKS = '.ck-head, .ray-saved-ledger-head, .ck-reads-head, p, ul, ol, table, .ck-cells, .ck-record, .ck-rec-tl';
/** a fold that would show less than this much of its clamp stretches to the
 *  first whole row instead (a card grid whose first row is taller than half the clamp) */
const SHORT = 0.65;
/** …but never past this much of it */
const STRETCH = 1.6;

/** where the clamp cuts: the bottom of the last whole row within `max` (plus
 *  a hair, so the row's own foot clears the fade), or `max` when no mark is in reach */
function cutAt(inner: HTMLElement, max: number): number {
  const top = inner.getBoundingClientRect().top;
  const rows = Array.from(inner.querySelectorAll<HTMLElement>(ROWS));
  const blocks = Array.from(inner.querySelectorAll<HTMLElement>(BLOCKS)).filter(m => !m.parentElement?.closest(ROWS));
  // (pass 7) a boundary never falls INSIDE a row: a block's bottom that lands
  // within a row's box (a name's head row over its lots in Names, a row's
  // own sub-line) is not a cut — the Names fold faded mid-row on the owner's desk
  const spans = rows.map(r => { const b = r.getBoundingClientRect(); return [b.top - top, b.bottom - top] as const; });
  const inside = (y: number) => spans.some(([a, b]) => y > a + 1 && y < b - 1);
  const every = rows.concat(blocks).map(m => m.getBoundingClientRect().bottom - top).filter(b => b > 0).sort((a, b) => a - b);
  const safe = every.filter(b => !inside(b));
  // (a room whose rows overlap — the week's day columns — keeps every mark)
  const bottoms = safe.length ? safe : every;
  if (!bottoms.length) return max;
  let best = 0;
  for (const b of bottoms) { if (b <= max) best = b; else break; }
  if (best < max * SHORT) {
    const next = bottoms.find(b => b > max);
    if (next != null && next <= max * STRETCH) best = next;
  }
  // + the row's own rule (1px), so the hairline under the last whole row still prints
  return best > 0 ? Math.min(best + 2, max * STRETCH) : max;
}

/** a count reads before the name ("Show all 8 · Watching"); a figure
 *  (+44%, $12K, a node) reads after it ("Show all · Record +44%") */
const plain = (c: React.ReactNode): boolean => typeof c === 'number' || (typeof c === 'string' && /^\d[\d,]*$/.test(c));

/** the fold's motion: max-height from the cut to the room's height and back,
 *  on the house easing; reduced motion = no transition (CSS) */
const FOLD_MS = 360;
/** how far ahead of the reader a seat mounts its room: one viewport */
const SEAT_MARGIN = '100% 0px';

/** true once the seat is within SEAT_MARGIN of the viewport (or at once:
 *  not lazy, no observer, or a landing names the room) */
function useNear(el: HTMLElement | null, lazy: boolean, ids: readonly string[]): [boolean, () => void] {
  // mounted at once: not lazy, no observer, or the address bar already names
  // the room (client-only render: the initializer may read it)
  const [near, setNear] = useState(() => {
    if (!lazy || typeof window === 'undefined') return true;
    if (typeof IntersectionObserver === 'undefined') return true;
    // a return to the desk (restore.ts): the rooms that were mounted mount again
    if (wasNear(ids)) return true;
    let id = '';
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { /* ignore */ }
    return owns(ids, id);
  });
  useEffect(() => { if (near && lazy) noteNear(ids[0]); }, [near, lazy, ids]);
  const wake = () => setNear(true);
  // a jump / chord / link into the room: mount before the landing polls for it
  useEffect(() => {
    if (near) return;
    const on = (e: Event) => { if (owns(ids, (e as CustomEvent<{ id: string }>).detail?.id)) setNear(true); };
    window.addEventListener(OPEN_TAB_EVENT, on);
    window.addEventListener(JUMP_EVENT, on);
    return () => { window.removeEventListener(OPEN_TAB_EVENT, on); window.removeEventListener(JUMP_EVENT, on); };
  }, [near, ids]);
  useEffect(() => {
    if (near || !el) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setNear(true); }, { rootMargin: SEAT_MARGIN });
    io.observe(el);
    return () => io.disconnect();
  }, [near, el]);
  return [near, wake];
}

/** a room folded to its first screen */
export function Clamp({ ids, label, count, whole = false, lazy = false, children }: {
  /** the ids a jump may name that live inside (the room, its anchors) */
  ids: readonly string[];
  /** the room's name, for the Show-all line ("Show all 8 · Watching") */
  label: string;
  count?: React.ReactNode;
  /** the room reads whole — never a fold (a cold desk's quick start) */
  whole?: boolean;
  /** the room mounts only within a viewport of the reader; a seat holds its place until then */
  lazy?: boolean;
  children: React.ReactNode;
}) {
  // a return to the desk (restore.ts) opens the folds that were open
  const [open, setOpen] = useState(() => wasOpen(ids));
  useEffect(() => { noteOpen(ids[0], open); }, [open, ids]);
  const [tall, setTall] = useState(false);
  const [empty, setEmpty] = useState(false);
  // not before the first measure: a tall room mounts clamped at --fold-max
  // (never whole, then snapped shut once measured — the page jumped)
  const [measured, setMeasured] = useState(false);
  const [cut, setCut] = useState<number | null>(null);
  // 'open' / 'close' while the height travels; the inline --fold-h is the
  // room's measured height, the far end of the travel
  const [anim, setAnim] = useState<'open' | 'close' | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const outer = useRef<HTMLDivElement | null>(null);
  const [seatEl, setSeatEl] = useState<HTMLDivElement | null>(null);
  const [near] = useNear(seatEl, lazy, ids);
  useOpensOnJump(ids, setOpen);
  // does the room overflow its clamp? measured, so a short room shows no fold;
  // where does it cut? on the last whole row, so no row is ever halved
  useEffect(() => {
    const el = inner.current, box = outer.current;
    if (!el || !box) return;
    const read = () => {
      const max = parseFloat(getComputedStyle(box).getPropertyValue('--fold-max')) || 560;
      const h = el.scrollHeight;
      setEmpty(el.childElementCount === 0 || h === 0);
      const over = !whole && h > max + 40;
      setTall(over);
      setCut(over ? Math.round(cutAt(el, max)) : null);
      setMeasured(true);
    };
    read();
    // (pass 7) the clamped box never changes size once its room overflows it
    // (max-height), so observing it alone left the cut where the room's FIRST
    // layout put it — rows grew (photos, bids, the sold history) and the cut
    // sat mid-row on the owner's desk. Observe the room itself (the inner's
    // children) and re-observe when children come and go.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    const watch = () => { ro?.disconnect(); ro?.observe(el); for (const c of Array.from(el.children)) ro?.observe(c); };
    watch();
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => { watch(); read(); }) : null;
    mo?.observe(el, { childList: true });
    // and once more as the fold comes into view (the layout is final by then —
    // a photo that landed, a line that stopped wrapping) and on every image load
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) read(); }, { rootMargin: '50% 0px' }) : null;
    io?.observe(box);
    el.addEventListener('load', read, true);
    return () => { ro?.disconnect(); mo?.disconnect(); io?.disconnect(); el.removeEventListener('load', read, true); };
  }, [whole, near]);
  // the travel: set the far end, let the transition run, then release the height
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const setHeight = (px: number | null) => { outer.current?.style.setProperty('--fold-h', px == null ? '' : `${px}px`); };
  const toggle = () => {
    const el = inner.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (open) backToTop(outer.current);
    if (!el || reduce) { setOpen(v => !v); return; }
    window.clearTimeout(timer.current);
    setHeight(el.scrollHeight);
    if (open) {
      // close: from the room's height (set, one frame) down to the cut
      setAnim('close');
      requestAnimationFrame(() => requestAnimationFrame(() => { setOpen(false); timer.current = window.setTimeout(() => { setAnim(null); setHeight(null); }, FOLD_MS + 40); }));
    } else {
      // open: from the cut up to the room's height, then no cap at all
      setAnim('open'); setOpen(true);
      timer.current = window.setTimeout(() => { setAnim(null); setHeight(null); }, FOLD_MS + 40);
    }
  };
  // THE SEAT: the clamp's height, a quiet skeleton, until the reader is a screen away
  if (!near) {
    return (
      <div ref={setSeatEl} className="dk-fold dk-seat" aria-busy="true" aria-label={`${label} — loads as you scroll`}>
        <div className="dk-seat-in rail" aria-hidden>
          <i className="ray-sk" style={{ width: 220, height: 26 }} />
          <i className="ray-sk" style={{ width: '46%', height: 12, marginTop: 12 }} />
          {[0, 1, 2].map(k => <i key={k} className="ray-sk dk-seat-row" />)}
        </div>
      </div>
    );
  }
  return (
    <div ref={outer} className="dk-fold" data-open={open || (measured && !tall) || undefined} data-empty={empty || undefined} data-anim={anim ?? undefined}
      style={cut != null ? ({ '--fold-cut': `${cut}px` } as React.CSSProperties) : undefined}>
      <div className="dk-fold-in" ref={inner}>{children}</div>
      {tall && (
        <div className="dk-fold-bar rail">
          <button type="button" className="dk-fold-btn" aria-expanded={open} onClick={toggle}>
            {open
              ? <>Show less<span className="dk-fold-sep" aria-hidden>·</span>{label}</>
              : plain(count)
                ? <>Show all <b>{count}</b><span className="dk-fold-sep" aria-hidden>·</span>{label}</>
                : <>Show all<span className="dk-fold-sep" aria-hidden>·</span>{label}{count != null && <> <b>{count}</b></>}</>}
          </button>
        </div>
      )}
    </div>
  );
}

/** a room closed to one row; the tap mounts it */
export function Closed({ ids, label, count, mark, hint, children }: {
  ids: readonly string[];
  label: string;
  count?: React.ReactNode;
  mark?: React.ReactNode;
  /** one line on what the room holds */
  hint?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => wasClosedOpen(ids));
  useEffect(() => { noteClosed(ids[0], open); }, [open, ids]);
  const box = useRef<HTMLDivElement | null>(null);
  useOpensOnJump(ids, setOpen);
  const close = () => { backToTop(box.current); setOpen(false); };
  return (
    <div ref={box} className="dk-closed" data-open={open || undefined}>
      <button type="button" className="dk-closed-row rail" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        {mark && <span className="ray-sect-mark" aria-hidden>{mark}</span>}
        <span className="dk-closed-l">{label}{count != null && <b>{count}</b>}</span>
        {hint && <span className="dk-closed-h">{hint}</span>}
        <span className="dk-closed-chev" aria-hidden><i /></span>
      </button>
      {open && (
        <div className="dk-closed-in">
          {children}
          <div className="dk-closed-foot rail">
            <button type="button" className="dk-fold-btn dk-fold-btn-quiet" onClick={close}>Close<span className="dk-fold-sep" aria-hidden>·</span>{label}</button>
          </div>
        </div>
      )}
    </div>
  );
}
