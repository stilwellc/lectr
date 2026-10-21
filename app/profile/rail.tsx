'use client';
/**
 * THE DESK'S LANDING (Oct 11 2026; Oct 20 the pill rail retired for the tabs,
 * app/profile/tabs.tsx). What stays here is how a reader lands on a room:
 *
 *   jump(id)       scroll a room (or an anchor in one) under the sticky bar,
 *                  stamp the hash (replaceState — Back leaves the page), focus
 *                  it so j/k continue from there, and re-anchor for ~8s while
 *                  the rooms above settle, unless the reader takes the wheel.
 *                  A room under another tab: the tab opens first
 *                  (OPEN_TAB_EVENT), the landing waits for the room to mount,
 *                  and a room this desk doesn't have says so (MISSING_EVENT).
 *   useHashLanding a deep link (/profile#budget) lands once the desk is ready.
 */
import React, { useEffect, useState } from 'react';

export interface RailItem {
  id: string;
  label: string;
  /** the section's mark (kept on the item for any future glyph use) */
  mark?: React.ReactNode;
  /** the figure beside the label (a count, a signed %, a money total) */
  count?: React.ReactNode;
  /** signed ink for a measured delta (lamp law: only a real sign) */
  tone?: 'up' | 'down';
  /** unseen matches waiting (the inbox dot — ink, never a lamp) */
  dot?: boolean;
  /** the page's grouping (now · picks · desk) — a hairline parts the groups */
  group?: string;
  /** the pill's title — the `g`-chord that lands here ("g then w") */
  hint?: string;
  /** the section has nothing to say on this desk: the pill folds (muted,
   *  no count) but stays reachable — the room is mounted and says so */
  quiet?: boolean;
}

/** the jump's own event — the rail pins the pill as current at once */
export const JUMP_EVENT = 'lectr:jump';
/** how long a landing keeps re-anchoring while the rooms above it settle */
export const SETTLE_MS = 8000;
const INTENTS: (keyof WindowEventMap)[] = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

let stopSettle: (() => void) | null = null;

/** keep `el` anchored at the top of the viewport for `ms` while the page
 *  settles around it (lazily-read rooms above change height) — ends at once
 *  when the reader scrolls, swipes, presses a key or taps */
export function settleOn(el: HTMLElement, ms = SETTLE_MS, startAfter = 0): () => void {
  stopSettle?.();
  let done = false;
  let raf = 0;
  let timer = 0;
  let poll = 0;
  let armed = startAfter <= 0;
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const check = () => {
    raf = 0;
    if (done || !armed) return;
    if (!el.isConnected) { stop(); return; }   // the room unmounted (a tab switch): never chase a detached node
    const top = el.getBoundingClientRect().top - margin;
    if (Math.abs(top) > 2) window.scrollBy({ top, behavior: 'auto' });
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(check); };
  const stop = () => {
    if (done) return;
    done = true;
    ro?.disconnect();
    window.clearTimeout(timer); window.clearTimeout(arm); window.clearInterval(poll);
    if (raf) cancelAnimationFrame(raf);
    for (const ev of INTENTS) window.removeEventListener(ev, stop);
    if (stopSettle === stop) stopSettle = null;
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(queue) : null;
  ro?.observe(document.body);
  // a smooth scroll is still travelling for a moment — the first check waits for it
  const arm = window.setTimeout(() => { armed = true; queue(); }, startAfter);
  poll = window.setInterval(queue, 250);
  timer = window.setTimeout(stop, ms);
  for (const ev of INTENTS) window.addEventListener(ev, stop, { passive: true });
  stopSettle = stop;
  return stop;
}

/** focus a section without scrolling it again: the room takes tabindex −1
 *  so j/k continues from its first row (keys.ts reads the focus position) */
export function focusSection(el: HTMLElement): void {
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  try { el.focus({ preventScroll: true }); } catch { el.focus(); }
}

/** scroll a section into view and stamp its hash (replaceState — Back
 *  leaves the page rather than walking sections); then hold the landing
 *  while the page settles and focus the section */
/** a jump to a room under another tab: the desk switches tab (tabs.tsx
 *  listens), then the jump retries once the room has mounted */
export const OPEN_TAB_EVENT = 'lectr:open-tab';
/** a jump that found no room (its tab opened, the room isn't on this desk) */
export const MISSING_EVENT = 'lectr:missing-room';

/** the pending cross-tab landing, if any — a newer jump always cancels it */
let stopOpen: (() => void) | null = null;

export function jump(id: string, opts: { focus?: boolean; retried?: boolean } = {}) {
  if (!opts.retried) { stopOpen?.(); stopOpen = null; }
  const el = document.getElementById(id);
  if (!el) {
    if (opts.retried) return;
    window.dispatchEvent(new CustomEvent(OPEN_TAB_EVENT, { detail: { id } }));
    // the tab commits, then the room mounts (some rooms render their section
    // late, after data) — poll for it, then land; give up quietly after 3s
    let n = 0;
    const stop = () => { window.clearInterval(t); for (const ev of INTENTS) window.removeEventListener(ev, stop); if (stopOpen === stop) stopOpen = null; };
    const t = window.setInterval(() => {
      if (document.getElementById(id)) { stop(); jump(id, { ...opts, retried: true }); return; }
      if (++n < 30) return;
      // never landed (the room isn't on this desk): say so where the reader
      // now is — the hash names the room, the panel takes focus, the missing
      // line explains how it fills — never strand them on a blank tab
      stop();
      try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${id}`); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent(MISSING_EVENT, { detail: { id } }));
      // land on the explanation itself (it mounts on this event), else the panel
      // two frames: the event schedules MissingLanding's render, then it paints
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const note = document.querySelector<HTMLElement>('.ck-landnote') ?? document.getElementById('dt-panel');
        if (!note) return;
        note.scrollIntoView({ block: 'start', behavior: 'auto' });
        focusSection(note);
      }));
    }, 100);
    stopOpen = stop;
    // the reader starts scrolling or typing: they've moved on, don't yank them later
    for (const ev of INTENTS) window.addEventListener(ev, stop, { passive: true });
    return;
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${id}`); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id } }));
  if (opts.focus !== false) focusSection(el);
  settleOn(el, SETTLE_MS, reduce ? 0 : 700);
}
/* (Oct 20 2026) the 14-pill PillRail, its phone Sections sheet and their
   useActive/usePinned/useMedia helpers retired with the desk tabs (tabs.tsx). */

/** a deep link (/profile#settled) arrives before its section exists — the
 *  desk renders after the saves resolve — so land on it once it does.
 *  Returns the hash id when it names NO section that exists after the wait
 *  (the page prints the room's fill line under the rail). */
export function useHashLanding(ready: boolean): string | null {
  const done = React.useRef(false);
  const [missing, setMissing] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || done.current) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    // a tab's own hash (#tab-watching) opens the tab — there is no room to land on
    if (!id || id.startsWith('tab-')) { done.current = true; return; }
    let tries = 0;
    let stop: (() => void) | null = null;
    const t = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el) {
        done.current = true;
        window.clearInterval(t);
        // after layout settles (images, the Today band) — instant, no animation
        requestAnimationFrame(() => {
          el.scrollIntoView({ block: 'start', behavior: 'auto' });
          focusSection(el);
          window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail: { id } }));
          // (desk3) the rooms above a deep link keep growing after it lands —
          // Your week's columns, Names' sold-history reads — and the anchor
          // drifts down the screen. Re-land while the page settles (8s), unless
          // the reader has started scrolling.
          stop = settleOn(el);
        });
      } else if (++tries > 40) { done.current = true; window.clearInterval(t); setMissing(id); }
    }, 150);
    return () => { window.clearInterval(t); stop?.(); };
  }, [ready]);
  return missing;
}
