'use client';

import { useCallback, useRef } from 'react';

/**
 * The market draws itself — chart bodies wipe in left-to-right along
 * the time axis on first intersection. ONE shared IntersectionObserver
 * for every chart on the page; each target is unobserved after firing.
 *
 * Usage: attach the returned callback ref to the chart body element
 * and give it className="ray-chart-draw". The clip contract lives in
 * layout.tsx (clip-path inset(0 100% 0 0) -> inset(0), 800ms, applied
 * to the recharts series groups only — axes and labels stay outside
 * the clip).
 *
 * Never replays: the fired flag lives on the hook instance, so
 * category-filter changes (or a chart body remounting after a filter
 * empties it) render already-drawn. Reduced motion: no clip — drawn
 * is set immediately, no observer attached.
 */

let sharedIO: IntersectionObserver | null = null;
const onFired = new WeakMap<Element, () => void>();

function getIO(): IntersectionObserver {
  if (!sharedIO) {
    sharedIO = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).setAttribute('data-drawn', 'true');
            onFired.get(entry.target)?.();
            onFired.delete(entry.target);
            sharedIO!.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.2 }
    );
  }
  return sharedIO;
}

export function useChartDraw(): (el: HTMLElement | null) => void {
  const firedRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  return useCallback((el: HTMLElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!el) return;

    if (
      firedRef.current ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      el.setAttribute('data-drawn', 'true');
      firedRef.current = true;
      return;
    }

    const io = getIO();
    onFired.set(el, () => { firedRef.current = true; });
    io.observe(el);
    cleanupRef.current = () => {
      io.unobserve(el);
      onFired.delete(el);
    };
  }, []);
}
