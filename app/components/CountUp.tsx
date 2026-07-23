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
}: {
  to: number;
  format: (n: number) => string;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [val, setVal] = useState(0);
  // the value actually painted right now — updated every frame, so a target
  // change mid-animation compares/starts against the screen, not the last
  // settled value (which would early-return and freeze mid-count)
  const shownRef = useRef(0);

  useEffect(() => {
    // NaN/undefined `to` would tween into format(NaN) → "$NaN"/"NaN%". Land on
    // a safe 0 instead of animating garbage.
    if (!Number.isFinite(to)) {
      shownRef.current = 0;
      setVal(0);
      return;
    }
    const from = shownRef.current;
    if (to === from) return;

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      shownRef.current = to;
      setVal(to);
      return;
    }

    let raf = 0;
    let start = 0;
    const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
    const tick = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      const next = p < 1 ? from + (to - from) * easeOutQuart(p) : to;
      shownRef.current = next;
      setVal(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);

  return (
    <span className={className} style={style}>
      {format(val)}
    </span>
  );
}
