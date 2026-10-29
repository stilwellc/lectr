'use client';
/**
 * THE FOLD (THE DESK v4, Oct 29 2026) — one page, layered. Every room still
 * mounts on the desk, in one column; a fold decides how much of it shows:
 *
 *   clamp    the room mounts whole but shows its first screen (its head and
 *            the rows that matter), faded at the foot with one "Show all"
 *            that opens it in place — nothing is removed, only folded. A room
 *            shorter than the clamp shows no fold at all.
 *   closed   (the More rooms — Budget, Signals, Market, History) one row:
 *            the room's mark, name and figure, and the tap that mounts it.
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

/** a room folded to its first screen */
export function Clamp({ ids, label, count, children }: {
  /** the ids a jump may name that live inside (the room, its anchors) */
  ids: readonly string[];
  /** the room's name, for the Show-all line ("Show all · Watching 8") */
  label: string;
  count?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [tall, setTall] = useState(false);
  const inner = useRef<HTMLDivElement | null>(null);
  const outer = useRef<HTMLDivElement | null>(null);
  useOpensOnJump(ids, setOpen);
  // does the room overflow its clamp? measured on the CONTENT (never the
  // clamped box itself — reading the box's height while clamping it made the
  // fold open and close in a loop on the live desk), so a short room shows no fold
  useEffect(() => {
    const el = inner.current, box = outer.current;
    if (!el || !box) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const max = parseFloat(getComputedStyle(box).getPropertyValue('--fold-max')) || 520;
      setTall(el.offsetHeight > max + 40);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(on) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return (
    <div ref={outer} className="dk-fold" data-open={open || !tall || undefined}>
      <div className="dk-fold-in"><div className="dk-fold-content" ref={inner}>{children}</div></div>
      {tall && (
        <div className="dk-fold-bar rail">
          <button type="button" className="dk-fold-btn" aria-expanded={open} onClick={() => setOpen(v => !v)}>
            {open ? <>Show less</> : <>Show all{count != null ? <> · {label} <b>{count}</b></> : <> · {label}</>}</>}
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
  useOpensOnJump(ids, setOpen);
  return (
    <div className="dk-closed" data-open={open || undefined}>
      <button type="button" className="dk-closed-row rail" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        {mark && <span className="ray-sect-mark" aria-hidden>{mark}</span>}
        <span className="dk-closed-l">{label}{count != null && <b>{count}</b>}</span>
        {hint && !open && <span className="dk-closed-h">{hint}</span>}
        <span className="dk-closed-chev" aria-hidden>{open ? '–' : '+'}</span>
      </button>
      {open && <div className="dk-closed-in">{children}</div>}
    </div>
  );
}
