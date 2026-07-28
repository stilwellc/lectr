'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './hooks';

/* ============================================================
   RollingNumber — a TASTEFUL count-up. NOT a slot machine and
   NOT a mechanical odometer: it animates the VALUE (with an
   ease-out ramp) and re-renders the formatted string, on
   tabular figures, so digits settle in place without jitter.

   RE-ARMED (the tape cut): after the intro, a VALUE CHANGE
   rolls from the figure currently on screen to the new one over
   `switchDuration` (600ms) — always between two TRUE data
   values, never a re-intro from 0. The honesty doctrine lives
   here: the roll is only ever old-real → new-real.

   The span carries data-settled — "true" once the figure rests
   on its real value — so CSS can bloom the lit-numeral glow
   over the count's final moments and drop it while rolling.
   Reduced-motion / SSR / play=false: renders the final value
   immediately, settled.
   ============================================================ */

interface Props {
  /** target value */
  value: number;
  /** format the interpolated number → display string */
  format: (n: number) => string;
  /** ms; the intro ramp duration */
  duration?: number;
  /** ms; the between-true-values roll on later changes */
  switchDuration?: number;
  /** ms; delay before starting (stagger with the entrance) */
  delay?: number;
  /** start the intro count from this value (default 0) */
  from?: number;
  className?: string;
  /** gate the intro run on external readiness; false = resolved at once */
  play?: boolean;
}

// ease-out cubic — matches the site signature feel (slow settle).
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export default function RollingNumber({
  value,
  format,
  duration = 1400,
  switchDuration = 600,
  delay = 0,
  from = 0,
  className,
  play = true,
}: Props) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(play ? from : value);
  const [settled, setSettled] = useState(!play);
  const raf = useRef<number>();
  const shown = useRef(play ? from : value);
  const started = useRef(false);

  useEffect(() => {
    if (!play || reduce) {
      // resolved state at once — cached revisits and reduced motion never wait
      shown.current = value;
      setDisplay(value);
      setSettled(true);
      return;
    }
    // intro sweeps from `from`; later changes roll from the on-screen figure
    const isIntro = !started.current;
    started.current = true;
    const fromVal = isIntro ? from : shown.current;
    const dur = isIntro ? duration : switchDuration;
    const wait = isIntro ? delay : 0;
    if (fromVal === value) {
      shown.current = value;
      setDisplay(value);
      setSettled(true);
      return;
    }
    setSettled(false);
    let start = 0;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const elapsed = ts - start - wait;
      if (elapsed < 0) {
        raf.current = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(1, elapsed / dur);
      const next = fromVal + (value - fromVal) * easeOut(t);
      shown.current = next;
      setDisplay(next);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else {
        shown.current = value;
        setDisplay(value);
        setSettled(true);
      }
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, from, duration, switchDuration, delay, reduce, play]);

  return (
    <span
      className={className}
      data-settled={settled ? 'true' : 'false'}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {format(display)}
    </span>
  );
}
