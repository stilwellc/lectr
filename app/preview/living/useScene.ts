'use client';

/**
 * Scene primitives for THE LIVING INDEX. Every hook is static-export safe:
 * window / matchMedia / WebGL are all guarded so nothing throws during
 * prerender, and everything lands in a sensible final state with JS off or
 * motion reduced.
 */

import { useEffect, useRef, useState } from 'react';

/** SSR-safe: true only in the browser. */
const isBrowser = typeof window !== 'undefined';

/** Live `prefers-reduced-motion`. Defaults to false (full motion) on the server. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (!isBrowser || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** Live coarse-pointer / small-viewport test → the re-authored mobile scene. */
export function useIsMobile(breakpoint = 820): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (!isBrowser || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [breakpoint]);
  return mobile;
}

/**
 * Feature-detect WebGL WITHOUT mounting the shader. If this returns false we
 * render the CSS gold-gradient fallback and never touch the GL context — so a
 * no-WebGL browser can't crash the hero. Runs once, client-only.
 */
export function useWebGL(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!isBrowser) return;
    try {
      const c = document.createElement('canvas');
      const gl =
        c.getContext('webgl2') ||
        c.getContext('webgl') ||
        c.getContext('experimental-webgl');
      setOk(!!gl);
      // release the probe context immediately
      const lose = gl && (gl as WebGLRenderingContext).getExtension?.('WEBGL_lose_context');
      lose?.loseContext?.();
    } catch {
      setOk(false);
    }
  }, []);
  return ok;
}

/** Live `document.hidden` so we can hard-pause the shader on tab-away. */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!isBrowser) return;
    const on = () => setVisible(!document.hidden);
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/**
 * IntersectionObserver in-view flag — the fallback (and driver) for reveals and
 * the shader offscreen-pause. `once` latches true (for entrance reveals);
 * without it, tracks live visibility (for pausing the shader).
 */
export function useInViewport<T extends Element>(
  opts: { once?: boolean; rootMargin?: string; threshold?: number } = {},
): [React.RefObject<T>, boolean] {
  const { once = true, rootMargin = '0px 0px -12% 0px', threshold = 0.15 } = opts;
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!isBrowser || !el || typeof IntersectionObserver === 'undefined') {
      // no IO → show immediately (never leave content hidden)
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once, rootMargin, threshold]);
  return [ref, inView];
}

/**
 * Tabular count-up. Fires only when `active` (in view). Honors reduced motion by
 * LANDING FINAL immediately — the number never strands at 0. Uses the signature
 * ease-out; "fast digits" settle in ~1.6s.
 */
export function useCountUp(
  target: number,
  active: boolean,
  opts: { durationMs?: number; reduced?: boolean } = {},
): number {
  const { durationMs = 1600, reduced = false } = opts;
  // Seed at the FINAL value so SSR + no-JS render the real number (never a
  // stranded 0), and the first client render matches the server → no hydration
  // mismatch. The effect then drops to 0 and animates up (motion-on only).
  const [value, setValue] = useState(target);
  const started = useRef(false);

  useEffect(() => {
    // reduced motion or no rAF → stay final, no animation, no stranded 0
    if (reduced || !isBrowser || typeof requestAnimationFrame === 'undefined') {
      setValue(target);
      return;
    }
    if (!active || started.current) return;
    started.current = true;

    let raf = 0;
    setValue(0); // begin the count-up from zero, client-only
    const t0 = performance.now();
    // signature ease-out cubic-bezier(0.23,1,0.32,1) ≈ this closed form
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      setValue(Math.round(target * ease(p)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setValue(target); // guarantee the exact final value
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, durationMs, reduced]);

  // if the target changes after landing (data arrives), keep it truthful
  useEffect(() => {
    if (started.current || reduced) setValue(target);
  }, [target, reduced]);

  return value;
}
