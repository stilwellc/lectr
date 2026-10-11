'use client';
/**
 * use-back-scroll.ts — Back to a page whose body mounts AFTER its data loads
 * (home's feed, a maker / player page's live book) lands on the SAME ROW the
 * reader left. The browser's and the router's own scroll restoration run
 * before the lots exist, so they restore onto a short page and give up.
 *
 * (W20, Oct 11) A pixel offset was not enough: home paints from a first-
 * screen slice, then the whole book replaces it, the tape / wall / chart
 * wells settle above the feed, and a slow phone takes longer than any fixed
 * retry window — Back from 5,200px landed near 1,400px. So the view now
 * remembers the ROW at the top of the viewport (`data-lot-row` on every feed
 * row, components/LotBrowser) and its offset there, beside the pixel
 * fallback; on a Back it keeps landing that row at that offset as the page
 * grows — no fixed time cap while the row has yet to mount, a short settle
 * once it has — and stops the moment the reader takes over.
 *
 * Written (sessionStorage, per path + query) as the reader scrolls (settled),
 * on an anchor click, when the tab hides and on pagehide; read back ONLY on
 * a history traversal to THIS url — a popstate that landed here (client-side
 * Back) or a back_forward document navigation (a hard Back) — never on a
 * fresh visit.
 */
import { useEffect, useRef } from 'react';

const KEY = 'lectr-back-scroll:';
/** the feed row grammar (LotBrowser) */
export const ROW_ATTR = 'data-lot-row';

let lastPop: { at: number; href: string } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => { lastPop = { at: Date.now(), href: window.location.href }; });
}

/** this page view is a history traversal (Back / Forward) to the current url */
export function cameBack(): boolean {
  // the pop must have landed HERE: a modal-closing Back on home followed by
  // a link to a maker page is not a Back to that maker page
  if (lastPop && Date.now() - lastPop.at < 4000 && lastPop.href === window.location.href) return true;
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === 'back_forward' && performance.now() < 20_000;
  } catch { return false; }
}

export interface BackAnchor {
  /** the window scroll the reader left — the fallback when no row is known */
  y: number;
  /** the feed row at the top of the viewport */
  row?: string;
  /** that row's top edge, viewport px */
  off?: number;
}

export interface RowBox { id: string; top: number; bottom: number }

/**
 * The row the reader is "on": the first row whose body is still below the
 * top edge (the sticky nav's foot) — a row scrolled almost entirely under
 * the nav belongs to the reader's past, the next one is where they are.
 * Pure (boxes are viewport rects, in document order).
 */
export function pickAnchorRow(rows: readonly RowBox[], topEdge: number, viewportH: number): RowBox | null {
  for (const r of rows) {
    if (r.bottom - topEdge < Math.min(24, (r.bottom - r.top) / 2)) continue; // (mostly) under the nav
    if (r.top >= viewportH) return null;                                       // nothing on screen
    return r;
  }
  return null;
}

/**
 * Where the window should scroll so `anchor` lands where it was. `rowTop` is
 * the anchor row's CURRENT viewport top (null: not mounted yet), `maxY` the
 * page's current scroll range. Pure.
 */
export function landingY(anchor: BackAnchor, rowTop: number | null, scrollY: number, maxY: number): number {
  const want = rowTop != null && anchor.off != null ? scrollY + rowTop - anchor.off : anchor.y;
  return Math.max(0, Math.min(Math.round(want), Math.max(0, maxY)));
}

/** read a stored slot — the old plain-number format still reads as `{ y }` */
export function parseAnchor(v: string | null): BackAnchor | null {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 0 ? { y: n } : null;
  try {
    const a = JSON.parse(v) as BackAnchor;
    if (!a || typeof a.y !== 'number' || !Number.isFinite(a.y)) return null;
    if (a.y <= 0 && !a.row) return null;
    return { y: a.y, row: typeof a.row === 'string' ? a.row : undefined, off: typeof a.off === 'number' ? a.off : undefined };
  } catch { return null; }
}

/** the per-view slot: the path + query (the URL-held filters are the view) */
const slotOf = () => `${KEY}${window.location.pathname}${window.location.search}`;

/** the sticky chrome's foot: the nav (and a pinned feed toolbar) cover the top */
function topEdge(): number {
  const nav = document.querySelector('nav, header');
  const b = nav?.getBoundingClientRect().bottom ?? 0;
  return Math.max(0, Math.min(140, b));
}

function rowBoxes(): RowBox[] {
  const out: RowBox[] = [];
  document.querySelectorAll<HTMLElement>(`[${ROW_ATTR}]`).forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.height === 0) return;
    out.push({ id: el.getAttribute(ROW_ATTR)!, top: r.top, bottom: r.bottom });
  });
  return out;
}

/** the anchor of the view as it stands now */
export function captureAnchor(): BackAnchor {
  const y = Math.round(window.scrollY);
  const row = y > 0 ? pickAnchorRow(rowBoxes(), topEdge(), window.innerHeight) : null;
  return row ? { y, row: row.id, off: Math.round(row.top) } : { y };
}

function rowEl(id: string): HTMLElement | null {
  try { return document.querySelector<HTMLElement>(`[${ROW_ATTR}="${CSS.escape(id)}"]`); } catch { return null; }
}

/**
 * Remembers this view's place; on a Back, restores it. `ready` = the body
 * is in its FINAL shape (the whole book, not a first-screen slice): the
 * restore watches the page from mount — a book that lands after any fixed
 * window still lands the reader on their row — but only starts its short
 * settle once the page is ready, so a row found in the slice is re-landed
 * when the whole book re-lays the feed.
 */
export function useBackScroll(ready: boolean): void {
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // Back is judged at MOUNT: a slow book used to arrive after the 4s pop
  // window, and the restore never ran at all
  useEffect(() => {
    const slot = slotOf();
    const path = window.location.pathname;
    let restoring = false;
    const save = () => {
      // never mid-landing, never once the route has moved on (the query is
      // the view's own filters and may change; the path may not)
      if (restoring || window.location.pathname !== path) return;
      const here = slotOf();
      try { sessionStorage.setItem(here, JSON.stringify(captureAnchor())); } catch { /* storage blocked */ }
    };
    const onHide = () => { if (document.visibilityState === 'hidden') save(); };
    // anchor clicks fire before the route swaps the page out — the last
    // reliable moment the URL and scroll still belong to this view
    const onClick = (e: MouseEvent) => { if ((e.target as Element | null)?.closest?.('a[href]')) save(); };
    // a settled scroll keeps the slot current, however the page is left
    // (a router.push from the palette, a lot page opened from the modal)
    let scrollT = 0;
    const onScroll = () => { window.clearTimeout(scrollT); scrollT = window.setTimeout(save, 180); };
    document.addEventListener('visibilitychange', onHide);
    document.addEventListener('click', onClick, true);
    window.addEventListener('pagehide', save);
    window.addEventListener('scroll', onScroll, { passive: true });

    let stopRestore = () => { /* nothing to stop */ };
    if (cameBack()) {
      let anchor: BackAnchor | null = null;
      try { anchor = parseAnchor(sessionStorage.getItem(slot)); } catch { /* blocked */ }
      if (anchor) stopRestore = landOn(anchor, () => readyRef.current, () => { restoring = false; save(); });
      restoring = !!anchor;
    }
    // (no save on unmount: by then the router has already moved the URL on)
    return () => {
      stopRestore();
      window.clearTimeout(scrollT);
      document.removeEventListener('visibilitychange', onHide);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  void ready;
}

/** keep landing `anchor` as the page grows; returns the stop */
function landOn(anchor: BackAnchor, isReady: () => boolean, done: () => void): () => void {
  const t0 = Date.now();
  // the row has yet to mount: wait for it (the whole book on a slow phone)
  // up to 25s; once it has, hold it through the settling above for 1.5s
  const WAIT_ROW = 25_000, SETTLE = 1500;
  let seenAt = 0, readyAt = 0;
  let stopped = false;
  let raf = 0;
  const step = () => {
    raf = 0;
    if (stopped) return;
    const el = anchor.row ? rowEl(anchor.row) : null;
    const rowTop = el ? el.getBoundingClientRect().top : null;
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    const y = landingY(anchor, rowTop, window.scrollY, maxY);
    if (Math.abs(window.scrollY - y) > 2) window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
    const now = Date.now();
    // landed: the row is mounted (a pixel-only slot: the page can hold it)
    // on the page's final shape
    if (!seenAt && isReady() && (el || (!anchor.row && maxY >= anchor.y - 2))) seenAt = now;
    // the page is final and the row never came (the lot left the book, a
    // depth not restored): the pixel place stands
    if (isReady() && !readyAt) readyAt = now;
    if (!el && readyAt && now - readyAt > 2500) return stop();
    if (seenAt && now - seenAt > SETTLE) return stop();
    if (now - t0 > WAIT_ROW) return stop();
  };
  const kick = () => { if (!raf && !stopped) raf = requestAnimationFrame(step); };
  const mo = new MutationObserver(kick);
  mo.observe(document.body, { childList: true, subtree: true });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(kick) : null;
  ro?.observe(document.body);
  const tick = window.setInterval(kick, 200); // images settling don't mutate
  const userTook = () => stop();
  // `quiet`: torn down with the page (or a StrictMode re-mount) — no save,
  // or the half-landed place would overwrite the reader's
  const stop = (quiet = false) => {
    if (stopped) return;
    stopped = true;
    mo.disconnect();
    ro?.disconnect();
    window.clearInterval(tick);
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('wheel', userTook);
    window.removeEventListener('touchstart', userTook);
    window.removeEventListener('keydown', userTook);
    window.removeEventListener('pointerdown', userTook);
    if (!quiet) done();
  };
  window.addEventListener('wheel', userTook, { passive: true });
  window.addEventListener('touchstart', userTook, { passive: true });
  window.addEventListener('keydown', userTook);
  window.addEventListener('pointerdown', userTook);
  kick();
  return () => stop(true);
}
