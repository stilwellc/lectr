'use client';

import { useEffect, useState } from 'react';

/**
 * CloseClock — the real close time, ticking. Renders ONLY when the lot
 * carries a true timestamp (saleDateTime) and the close is inside the
 * window; otherwise returns null so callers keep their date-word fallback.
 * "closes 7:15 PM · in 3h 40m" — reader's local clock, 30s tick, no
 * pseudo-precision (minutes, never seconds).
 */
export default function CloseClock({
  iso,
  windowHours = 48,
  prefix,
  className,
  clock = true,
  tail = true,
}: {
  iso?: string | null;
  /** show only when the close is within this many hours (default 48) */
  windowHours?: number;
  prefix?: string;
  className?: string;
  /** print the wall-clock time ("7:15 PM") — off for a bare countdown */
  clock?: boolean;
  /** print the countdown ("in 3h 40m") — off for the time alone (a phone's
   *  cockpit cell, Oct 29 2026: the pair overflowed a 90px cell) */
  tail?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!iso) return null;
  const at = Date.parse(iso);
  if (isNaN(at)) return null;
  const ms = at - now;
  if (ms > windowHours * 3_600_000) return null;

  const clockText = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  let tailText: string;
  if (ms <= 0) {
    // closed (or closing as we speak) — results usually post shortly after
    if (ms > -3_600_000) tailText = 'closing now';
    else return null;
  } else {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    tailText = h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
  }
  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {prefix}{ms <= 0 ? tailText : [clock ? clockText : null, tail ? tailText : null].filter(Boolean).join(' · ')}
    </span>
  );
}
