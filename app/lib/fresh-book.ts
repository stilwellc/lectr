/**
 * fresh-book.ts — when a new deploy's book reaches an open page (W25, Oct 11
 * 2026). public/sw.js tells the tab a new book is whole in its cache
 * (`genReady`); app/hooks/useRayData prepareNewBook builds it off-screen;
 * app/components/ServiceWorker decides here WHEN it goes on screen:
 *
 *   - a visitor who has not touched the page (no scroll, tap, key, wheel)
 *     gets it silently — nothing they were reading moves;
 *   - a reader gets one line in the existing toast, "Book updated OCT 11",
 *     and a Refresh they tap. Rows never change under a reader unasked, and
 *     a tap keeps their place: the feed row at the top of the viewport is
 *     held where it was while the page re-lays (app/lib/use-back-scroll's
 *     row anchor).
 */
import { readStamp } from './sw-register';
import { captureAnchor, landingY, ROW_ATTR, type BackAnchor } from './use-back-scroll';

/** a page scrolled past this has a reader on it */
export const READ_SCROLL_PX = 8;

export type FreshAction = 'swap' | 'offer';

/** silently, or offered — pure */
export function freshAction(s: { touched: boolean; scrollY: number }): FreshAction {
  return !s.touched && s.scrollY <= READ_SCROLL_PX ? 'swap' : 'offer';
}

/** the toast line (the offline line's date grammar, sw-register readStamp) */
export function updatedLine(lastCrawl: string | null | undefined): string {
  const d = readStamp(lastCrawl);
  return d ? `Book updated ${d}` : 'Book updated';
}

const TOUCH_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** has the visitor touched the page since this was installed? */
export function watchTouch(): { touched: () => boolean; stop: () => void } {
  let touched = false;
  const on = () => { touched = true; };
  const onScroll = () => { if (window.scrollY > READ_SCROLL_PX) touched = true; };
  for (const t of TOUCH_EVENTS) window.addEventListener(t, on, { capture: true, passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  return {
    touched: () => touched,
    stop: () => {
      for (const t of TOUCH_EVENTS) window.removeEventListener(t, on, { capture: true });
      window.removeEventListener('scroll', onScroll);
    },
  };
}

const HOLD_MS = 1200;

/**
 * Run `commit` (the swap) and keep the reader's place: the feed row at the
 * top of the viewport stays at the same offset while the page re-lays; a
 * row the new book no longer carries leaves the scroll where it was. Stops
 * the moment the reader scrolls themselves. Returns commit's answer.
 */
export function swapHoldingPlace(commit: () => boolean): boolean {
  const anchor: BackAnchor = captureAnchor();
  const ok = commit();
  if (!ok || anchor.y <= 0) return ok;
  let stopped = false;
  const stop = () => { stopped = true; };
  for (const t of TOUCH_EVENTS) window.addEventListener(t, stop, { capture: true, passive: true, once: true });
  const t0 = performance.now();
  const step = () => {
    if (stopped) return done();
    let el: Element | null = null;
    if (anchor.row) { try { el = document.querySelector(`[${ROW_ATTR}="${CSS.escape(anchor.row)}"]`); } catch { el = null; } }
    const rowTop = el ? el.getBoundingClientRect().top : null;
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    const y = landingY(anchor, rowTop, window.scrollY, maxY);
    if (Math.abs(window.scrollY - y) > 2) window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
    if (performance.now() - t0 < HOLD_MS) requestAnimationFrame(step);
    else done();
  };
  const done = () => { for (const t of TOUCH_EVENTS) window.removeEventListener(t, stop, { capture: true }); };
  requestAnimationFrame(step);
  return ok;
}
