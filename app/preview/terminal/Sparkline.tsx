'use client';

import { useId } from 'react';

/* ============================================================
   Sparkline — a hand-rolled inline SVG trend line (no recharts
   overhead per-row). Direction-tinted (up teal / down coral),
   with a soft area wash under the line. Purely presentational.
   ============================================================ */

interface Props {
  data: number[];
  /** 'up' | 'down' | 'flat' — semantic tint */
  dir?: 'up' | 'down' | 'flat';
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
}

const COLOR = {
  up: 'var(--color-up, #57BE87)',
  down: 'var(--color-down, #CC6A5C)',
  flat: 'var(--tt-muted, #9A8F7D)',
};

export default function Sparkline({
  data,
  dir = 'flat',
  width = 84,
  height = 26,
  strokeWidth = 1.4,
  className,
}: Props) {
  const gid = useId();
  const pts = data.filter((n) => Number.isFinite(n));
  if (pts.length < 2) {
    return <svg width={width} height={height} className={className} aria-hidden />;
  }
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const pad = strokeWidth + 1;
  const stepX = (width - pad * 2) / (pts.length - 1);
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / range);
  const coords = pts.map((v, i) => [pad + i * stepX, y(v)] as const);
  const line = coords.map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${yy.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${height} L${coords[0][0].toFixed(1)},${height} Z`;
  const color = COLOR[dir];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={`sg-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        {/* soft directional glow — the line casts a faint colored shadow,
            tinted by `dir` (up/down/flat). Decorative; matches the hero chart. */}
        <filter id={`sgl-${gid}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <path d={area} fill={`url(#sg-${gid})`} stroke="none" />
      {/* the glow: a blurred, low-opacity copy of the line beneath it */}
      <path
        className="ray-chart-glow"
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth + 1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.28}
        filter={`url(#sgl-${gid})`}
      />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
