'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * The crawl delivers — Ray's loading + arrival choreography.
 *
 * RayLoading: one 1px wine hairline (~120px) in the content column,
 * looping scaleX 0.2 -> 1 origin-left over 1.2s. Reduced motion:
 * static full line + the mono label.
 *
 * RayEntrance: on resolve, elements marked .ray-enter (sections,
 * 90ms stagger via --enter-delay) and .ray-enter-card (grid cards,
 * min(index, 8) * 60ms) rise 16px/12px + fade over 600ms — pure CSS,
 * triggered by flipping ONE data-ray-ready attribute. Gated on
 * useRayData module cache via the animate prop: revisits render
 * instantly (attribute never armed, so late-mounted Show More
 * batches also appear instantly). Final state is transform: none,
 * which releases the containing block for fixed-position modals.
 *
 * NOTE: keep the style blocks free of quotes, apostrophes and angle
 * brackets — React escapes them server-side and hydration of
 * raw-text elements then fails.
 */

const entranceCss = `
  [data-ray-animate] .ray-enter {
    opacity: 0;
    transform: translateY(16px);
  }
  [data-ray-animate] .ray-enter-card {
    opacity: 0;
    transform: translateY(12px);
  }
  [data-ray-animate][data-ray-ready=true] .ray-enter,
  [data-ray-animate][data-ray-ready=true] .ray-enter-card {
    opacity: 1;
    transform: none;
    transition:
      opacity 600ms var(--ease-signature) var(--enter-delay, 0ms),
      transform 600ms var(--ease-signature) var(--enter-delay, 0ms);
  }
`;

export default function RayEntrance({
  animate,
  children,
}: {
  animate: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Decided once at mount: no animation for cached revisits or
  // reduced motion (content renders complete immediately).
  const [armed] = useState(
    () =>
      animate &&
      typeof window !== 'undefined' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    if (!armed) return;
    const el = ref.current;
    if (!el) return;
    let r2 = 0;
    // Double rAF: the hidden pre-state must paint before the flip.
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => el.setAttribute('data-ray-ready', 'true'));
    });
    return () => {
      cancelAnimationFrame(r1);
      if (r2) cancelAnimationFrame(r2);
    };
  }, [armed]);

  return (
    <div ref={ref} data-ray-animate={armed ? 'true' : undefined}>
      <style>{entranceCss}</style>
      {children}
    </div>
  );
}

/**
 * RayLoading — a skeleton of the real layout (label, numeral, chart, strip,
 * cards) shimmering while the crawl delivers, so arrival is a settle rather
 * than a pop. Reduced motion: static blocks.
 */
export function RayLoading() {
  return (
    <div className="ray-loading rail" role="status" aria-label="Loading auction data">
      {/* skeleton styles live in globals.css — raw-text style blocks with
          quotes/apostrophes break hydration (React escapes them server-side) */}
      <div className="ray-sk" style={{ width: 190, height: 15, marginBottom: 12 }} />
      <div className="ray-sk" style={{ width: 280, height: 56, marginBottom: 14 }} />
      <div className="ray-sk" style={{ width: 340, height: 15, marginBottom: 22 }} />
      <div className="ray-sk" style={{ width: '100%', height: 240, borderRadius: 12, marginBottom: 24 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i}>
            <div className="ray-sk" style={{ width: '55%', height: 12, marginBottom: 10 }} />
            <div className="ray-sk" style={{ width: '40%', height: 24 }} />
          </div>
        ))}
      </div>
      <div className="ray-sk-cards">
        {[0, 1, 2].map(i => (
          <div key={i}>
            <div className="ray-sk" style={{ width: '100%', height: 240, borderRadius: 16, marginBottom: 12 }} />
            <div className="ray-sk" style={{ width: '55%', height: 14, marginBottom: 8 }} />
            <div className="ray-sk" style={{ width: '80%', height: 12 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
