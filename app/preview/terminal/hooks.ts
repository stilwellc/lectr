'use client';

import { useEffect, useRef, useState } from 'react';

/* ============================================================
   THE TERMINAL — client-only helpers.
   Every window/matchMedia access is guarded so the route is
   static-export safe (renders to inert HTML at build, wakes on
   the client). No global-CSS or global-state collisions: this
   whole directory is self-contained.
   ============================================================ */

/** SSR-safe media query. Returns `false` on the server + first paint,
    then resolves on mount — so the desktop composition is the static
    fallback and mobile hydrates in without a layout flash on phones. */
export function useMediaQuery(query: string, initial = false): boolean {
  const [match, setMatch] = useState(initial);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Honors the OS reduced-motion switch. When true, every entrance/
    count-up/draw resolves to its FINAL state with no animation. */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)', false);
}

/** True once mounted on the client — gates animation choreography so
    the server HTML is the resolved state (no hydration flash). */
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** IntersectionObserver-backed reveal. Returns a ref + whether it has
    entered the viewport (latched — reveals once, never re-hides). */
export function useInView<T extends HTMLElement>(
  // threshold 0 = fire when ANY pixel enters (a tall element taller than
  // ~6× the viewport can never reach a 0.15 ratio, which silently hid content)
  opts: IntersectionObserverInit = { threshold: 0, rootMargin: '0px 0px -6% 0px' },
): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setSeen(true);
      return;
    }
    const el = ref.current;
    if (!el) { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
          break;
        }
      }
    }, opts);
    io.observe(el);
    // SAFETY: content must NEVER stay hidden if the observer misfires — reveal
    // after a beat regardless. Below-fold content just shows before it's scrolled
    // to (harmless); above-fold still animates in immediately.
    const t = setTimeout(() => setSeen(true), 2200);
    return () => { io.disconnect(); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [ref, seen];
}

/* ── Formatters — tabular, terminal-grade ──────────────────── */

/** $1,234,567 → "$1.23B" / "$482.6M" / "$9.27M". Compact money. */
export function fmtMoneyCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(abs >= 1e8 ? 1 : 2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Full grouped integer, e.g. 507107 → "507,107". */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Signed percentage with a fixed sign glyph, e.g. +12.4% / −3.1%. */
export function fmtDelta(n: number, digits = 1): string {
  const s = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${s}${Math.abs(n).toFixed(digits)}%`;
}
