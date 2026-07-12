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

export function RayLoading() {
  return (
    <div
      className="ray-loading rail"
      role="status"
      aria-label="Loading auction data"
    >
      <style>{`
        .ray-loading { padding-block: 72px 160px; }
        @keyframes rayCrawl {
          0% { transform: scaleX(0.2); opacity: 0.35; }
          45% { opacity: 1; }
          100% { transform: scaleX(1); opacity: 0; }
        }
        .ray-loading-line {
          width: 120px;
          height: 1px;
          background: var(--color-accent-wine);
          transform-origin: left;
          animation: rayCrawl 1.2s var(--ease-signature) infinite;
        }
        .ray-loading-label { display: none; }
        @media (prefers-reduced-motion: reduce) {
          .ray-loading-line { animation: none; opacity: 0.6; }
          .ray-loading-label { display: inline-block; margin-top: 14px; }
        }
        @media (max-width: 768px) {
          .ray-loading { padding-block: 56px 120px; }
        }
      `}</style>
      <div className="ray-loading-line" />
      <span className="ray-loading-label" style={{
        fontFamily: 'var(--font-mono), monospace',
        fontSize: 12,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--color-text-faint)',
      }}>
        Loading
      </span>
    </div>
  );
}
