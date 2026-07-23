'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * CountUp — animates a figure to its real value, formatting every frame through
 * the same formatter the static value would use (so a total counts up through
 * its own magnitudes: $0 -> $45M -> $4.54B). It animates from the value
 * currently on screen whenever the target changes — not the last settled
 * value, so an A→B→A flip mid-animation (market-pill toggles, phase-2 data
 * landing) restarts toward A instead of freezing on an interpolated frame.
 * Handles data arriving after mount (0 -> real) without getting stuck.
 * Reduced motion lands on the value at once. The app is client-rendered, so
 * starting at 0 costs nothing in SSR/SEO terms.
 */
export default function CountUp({
  to,
  format,
  duration = 1500,
  className,
  style,
  animate = true,
  delay = 0,
}: {
  to: number;
  format: (n: number) => string;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
  /** When false, land on `to` immediately with no tween — cached revisits and
   *  any surface that must show its final figure at once. Reduced motion always
   *  lands instantly regardless. Default true preserves every existing caller. */
  animate?: boolean;
  /** Hold at the from-value this many ms before tweening — lets a row of
   *  figures ignite in a stagger while still finishing together. Ignored when
   *  not animating. */
  delay?: number;
}) {
  // Start already on target when we will not animate, so no "0" can ever paint
  // for a cached/reduced-motion reader even for a single frame.
  const [val, setVal] = useState(() => (animate ? 0 : (Number.isFinite(to) ? to : 0)));
  // the value actually painted right now — updated every frame, so a target
  // change mid-animation compares/starts against the screen, not the last
  // settled value (which would early-return and freeze mid-count)
  const shownRef = useRef(animate ? 0 : (Number.isFinite(to) ? to : 0));
  // Whether we've ever run the tween. The armed callers (BoardDemand pass
  // animate={armed}) flip animate false→true AFTER mount, like RayEntrance —
  // so the instant init above may have already seeded shownRef at `to`. On the
  // first armed pass we must sweep from 0 regardless, or the count never plays.
  const ranRef = useRef(false);

  useEffect(() => {
    // NaN/undefined `to` would tween into format(NaN) → "$NaN"/"NaN%". Land on
    // a safe 0 instead of animating garbage.
    if (!Number.isFinite(to)) {
      shownRef.current = 0;
      setVal(0);
      return;
    }

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Not armed (cached revisit) or reduced motion: land on the final figure at
    // once — the count-up is pure entrance enhancement, never a gate.
    if (!animate || reduce) {
      shownRef.current = to;
      setVal(to);
      return;
    }

    // first armed tween sweeps from 0; later target changes sweep from screen
    const from = ranRef.current ? shownRef.current : 0;
    ranRef.current = true;
    if (to === from) return;
    if (from === 0) { shownRef.current = 0; setVal(0); }

    let raf = 0;
    let start = 0;
    const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
    const tick = (ts: number) => {
      if (!start) start = ts;
      const elapsed = ts - start - delay;
      if (elapsed <= 0) { raf = requestAnimationFrame(tick); return; }
      const p = Math.min(1, elapsed / duration);
      const next = p < 1 ? from + (to - from) * easeOutQuart(p) : to;
      shownRef.current = next;
      setVal(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration, animate, delay]);

  return (
    <span className={className} style={style}>
      {format(val)}
    </span>
  );
}
