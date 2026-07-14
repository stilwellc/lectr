import React from 'react';

/**
 * The Flick — the r's terminal zigzag as a monoline polyline, the product's
 * only ornament. Inherits color from context (muted gray or ink white) and
 * never wears green or red. The optional `draw` prop plays the flick-draw
 * stroke-dashoffset keyframes from globals.css (reduced-motion gated there;
 * when the keyframes are absent the line simply renders complete).
 */
export default function Flick({
  size = 14,
  draw = false,
  style,
}: {
  /** rendered width in px; height scales 11/16 */
  size?: number;
  /** animate the stroke writing itself via the flick-draw keyframes */
  draw?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={(size * 11) / 16}
      viewBox="0 0 16 11"
      fill="none"
      aria-hidden="true"
      // a global reset sets svg { display: block }, which would drop the
      // Flick onto its own line after every CTA — force it inline, riding the
      // text baseline, so it always sits with the words it punctuates.
      style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 4, ...style }}
    >
      <polyline
        points="1,9 5.5,2.5 9.5,8 15,2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={
          draw
            ? {
                // full path length ≈ 22.9 — 24 covers it with round caps
                strokeDasharray: 24,
                animation: 'lectrFlickDraw 500ms var(--ease-draw, ease-out) both',
              }
            : undefined
        }
      />
    </svg>
  );
}
