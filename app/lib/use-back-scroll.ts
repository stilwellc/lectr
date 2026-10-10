'use client';
/**
 * use-back-scroll.ts — Back to a page whose body mounts AFTER its data loads
 * (a maker page's live book) lands where the reader left it. The browser's
 * and the router's own scroll restoration run before the lots exist, so they
 * restore onto a short page and give up.
 *
 * The page's scroll is written (sessionStorage, per path + query) when the
 * page unmounts or the tab hides; it is read back ONLY on a history
 * traversal — a popstate in the last few seconds (client-side Back) or a
 * back_forward document navigation (a hard Back) — never on a fresh visit.
 */
import { useEffect } from 'react';

const KEY = 'lectr-back-scroll:';
let lastPopAt = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => { lastPopAt = Date.now(); });
}

function cameBack(): boolean {
  if (Date.now() - lastPopAt < 4000) return true;
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === 'back_forward' && performance.now() < 20_000;
  } catch { return false; }
}

/** the per-view slot: the path + query (the URL-held filters are the view) */
const slotOf = () => `${KEY}${window.location.pathname}${window.location.search}`;

/** remembers this view's scroll; on a Back, restores it once `ready` */
export function useBackScroll(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const save = () => {
      try { sessionStorage.setItem(slotOf(), String(Math.round(window.scrollY))); } catch { /* storage blocked */ }
    };
    const onHide = () => { if (document.visibilityState === 'hidden') save(); };
    // anchor clicks fire before the route swaps the page out — the last
    // reliable moment the URL and scroll still belong to this view
    const onClick = (e: MouseEvent) => { if ((e.target as Element | null)?.closest?.('a[href]')) save(); };
    document.addEventListener('visibilitychange', onHide);
    document.addEventListener('click', onClick, true);
    window.addEventListener('pagehide', save);

    const timers: number[] = [];
    if (cameBack()) {
      let y: number | null = null;
      try { const v = sessionStorage.getItem(slotOf()); y = v == null ? null : Number(v); } catch { /* blocked */ }
      if (y != null && Number.isFinite(y) && y > 0) {
        // the sections above can still settle (chart wells, shards) — land
        // again a beat later unless the reader has already moved
        const go = () => { if (Math.abs(window.scrollY - y!) > 40) window.scrollTo(0, y!); };
        timers.push(window.setTimeout(go, 0), window.setTimeout(go, 350), window.setTimeout(go, 900));
        const stop = () => { timers.forEach(t => window.clearTimeout(t)); };
        window.addEventListener('wheel', stop, { once: true, passive: true });
        window.addEventListener('touchstart', stop, { once: true, passive: true });
      }
    }
    // (no save on unmount: by then the router has already moved the URL on)
    return () => {
      timers.forEach(t => window.clearTimeout(t));
      document.removeEventListener('visibilitychange', onHide);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('pagehide', save);
    };
  }, [ready]);
}
