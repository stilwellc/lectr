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
 *
 * Every anchor keeps landing: a jump() to a room (or an anchor inside it)
 * opens its fold first — OPEN_TAB_EVENT fires when the target isn't in the
 * DOM yet (a closed room), JUMP_EVENT once it is (a clamped one) — and the
 * landing in rail.tsx finds the element on its next poll.
 */
import React, { useEffect, useRef, useState } from 'react';
import { JUMP_EVENT, OPEN_TAB_EVENT } from '../rail';

/** does `id` (a room id, an anchor inside one, a week day) belong to this fold? */
function owns(ids: readonly string[], id: string | undefined): boolean {
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
  // a deep link into this fold on load (the landing polls for the element)
  useEffect(() => {
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
  const bottoms = rows.concat(blocks).map(m => m.getBoundingClientRect().bottom - top).filter(b => b > 0).sort((a, b) => a - b);
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

/** a room folded to its first screen */
export function Clamp({ ids, label, count, children }: {
  /** the ids a jump may name that live inside (the room, its anchors) */
  ids: readonly string[];
  /** the room's name, for the Show-all line ("Show all 8 · Watching") */
  label: string;
  count?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tall, setTall] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [cut, setCut] = useState<number | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const outer = useRef<HTMLDivElement | null>(null);
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
      const over = h > max + 40;
      setTall(over);
      setCut(over ? Math.round(cutAt(el, max)) : null);
    };
    read();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const toggle = () => {
    if (open) backToTop(outer.current);
    setOpen(v => !v);
  };
  return (
    <div ref={outer} className="dk-fold" data-open={open || !tall || undefined} data-empty={empty || undefined}
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
  const [open, setOpen] = useState(false);
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
