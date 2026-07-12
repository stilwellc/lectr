'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * CountUp — animates a figure to its real value, formatting every frame through
 * the same formatter the static value would use (so a total counts up through
 * its own magnitudes: $0 -> $45M -> $4.54B). It animates from the last settled
 * value whenever the target changes, so it handles data arriving after mount
 * (0 -> real) without getting stuck. Reduced motion lands on the value at once.
 * The app is client-rendered, so starting at 0 costs nothing in SSR/SEO terms.
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
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (to === from) return;

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      fromRef.current = to;
      setVal(to);
      return;
    }

    let raf = 0;
    let start = 0;
    const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
    const tick = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      setVal(from + (to - from) * easeOutQuart(p));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        setVal(to);
      }
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
