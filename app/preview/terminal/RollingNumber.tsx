'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './hooks';

/* ============================================================
   RollingNumber — a TASTEFUL count-up. NOT a slot machine and
   NOT a mechanical odometer: it animates the VALUE (with an
   ease-out ramp) and re-renders the formatted string, on
   tabular figures, so digits settle in place without jitter.
   Reduced-motion / SSR: renders the final value immediately.
   ============================================================ */

interface Props {
  /** target value */
  value: number;
  /** format the interpolated number → display string */
  format: (n: number) => string;
  /** ms; the ramp duration */
  duration?: number;
  /** ms; delay before starting (stagger with the entrance) */
  delay?: number;
  /** start the count from this value (default 0) */
  from?: number;
  className?: string;
  /** gate the run on some external readiness (e.g. in-view) */
  play?: boolean;
}

// ease-out cubic — matches the site signature feel (slow settle).
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export default function RollingNumber({
  value,
  format,
  duration = 1400,
  delay = 0,
  from = 0,
  className,
  play = true,
}: Props) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(from);
  const raf = useRef<number>();
  const started = useRef(false);

  useEffect(() => {
    if (!play) {
      // no animation for this mount — the display must still LAND on the real
      // value (the from=0 seed stuck the hero at +0%/$0 on every cached
      // back-nav; audit-lifecycle #1)
      setDisplay(value);
      return;
    }
    if (reduce) {
      setDisplay(value);
      return;
    }
    if (started.current) {
      // value changed after the intro — settle quickly, no re-intro
      setDisplay(value);
      return;
    }
    started.current = true;
    let start = 0;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const elapsed = ts - start - delay;
      if (elapsed < 0) {
        raf.current = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(1, elapsed / duration);
      setDisplay(from + (value - from) * easeOut(t));
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, from, duration, delay, reduce, play]);

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {format(display)}
    </span>
  );
}
