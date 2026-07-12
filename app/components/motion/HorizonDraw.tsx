'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * Client wrapper behind Horizon's `draw` prop. Applies the
 * .horizon-draw / .is-drawn contract (globals.css) with a one-shot
 * IntersectionObserver.
 *
 * No-JS safety: server HTML renders the full static line; the mask
 * class is only added after mount. prefers-reduced-motion: stays
 * static full width, no observer.
 */
export default function HorizonDraw({
  origin,
  background,
  style,
}: {
  origin: 'left' | 'center';
  background: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'idle' | 'armed' | 'drawn'>('idle');

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = ref.current;
    if (!el) return;
    setPhase('armed');
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPhase('drawn');
          io.disconnect();
        }
      },
      { threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const cls =
    phase === 'idle'
      ? undefined
      : `horizon-draw${phase === 'drawn' ? ' is-drawn' : ''}`;

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cls}
      data-origin={origin}
      style={{
        height: 1,
        width: '100%',
        background,
        opacity: 0.35,
        ...style,
      }}
    />
  );
}
