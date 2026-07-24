'use client';

import type { Market } from '../../constants';
import styles from './style.module.css';

/* ============================================================
   VerticalGhost — a large, faint category illustration that
   lives on the RIGHT edge only, behind the Terminal content.
   Swaps by active vertical; bleeds off the right edge so it
   reads as texture, not a stamped watermark. Purely decorative:
   pointer-events:none, low z-index, ~0.04–0.08 opacity via CSS.
   Inline SVG only — static-export safe, no deps.
   ============================================================ */

/* Each glyph draws in a 200×200 viewBox, tuned so the "interesting"
   mass sits toward the LEFT of the box — the box's right side then
   bleeds off-screen, cropping the illustration gracefully. */

function ArtGhost() {
  // a few expressive brush strokes
  return (
    <svg viewBox="0 0 200 200" fill="none" aria-hidden>
      <path
        d="M18 150 C60 120 92 132 128 96 C150 74 168 60 196 44"
        stroke="currentColor"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <path
        d="M8 96 C54 84 78 100 118 70 C146 49 170 44 200 30"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        opacity="0.75"
      />
      <path
        d="M40 182 C86 168 110 176 150 150 C176 133 190 128 210 120"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

function DesignGhost() {
  // a cropped mid-century chair silhouette
  return (
    <svg viewBox="0 0 200 200" fill="none" aria-hidden>
      {/* back rail */}
      <path d="M56 26 C120 20 150 34 150 34 L150 118" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
      {/* seat */}
      <path d="M40 116 L156 108" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
      {/* front legs */}
      <path d="M52 118 L44 188" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
      <path d="M142 112 L150 184" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
      {/* back leg */}
      <path d="M60 34 L70 116" stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity="0.7" />
      {/* seat slats hint */}
      <path d="M66 48 L138 42" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.5" />
      <path d="M70 66 L140 60" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

function WatchesGhost() {
  // a cropped watch dial with hands + a couple hour ticks (scaled down a touch)
  return (
    <svg viewBox="0 0 200 200" fill="none" aria-hidden>
      <g transform="translate(96 100) scale(0.8) translate(-96 -100)">
        <circle cx="96" cy="100" r="82" stroke="currentColor" strokeWidth="8" />
        <circle cx="96" cy="100" r="66" stroke="currentColor" strokeWidth="2.5" opacity="0.5" />
        {/* hour hand */}
        <path d="M96 100 L96 52" stroke="currentColor" strokeWidth="9" strokeLinecap="round" />
        {/* minute hand */}
        <path d="M96 100 L146 118" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        {/* center pin */}
        <circle cx="96" cy="100" r="6" fill="currentColor" />
        {/* ticks */}
        <path d="M96 24 L96 36" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <path d="M172 100 L160 100" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <path d="M96 176 L96 164" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <path d="M20 100 L32 100" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity="0.7" />
      </g>
    </svg>
  );
}

function SportsGhost() {
  // a baseball — a fully-visible ball (kept small so it doesn't bleed off) with
  // a central seam and stitch rows on BOTH sides of it
  return (
    <svg viewBox="0 0 200 200" fill="none" aria-hidden>
      <circle cx="88" cy="100" r="64" stroke="currentColor" strokeWidth="7.5" />
      {/* central seam */}
      <path d="M88 40 C70 70 70 130 88 160" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      {/* stitches — left row AND right row of the seam, both inside the crop */}
      <g stroke="currentColor" strokeWidth="4.2" strokeLinecap="round">
        <path d="M66 58 l13 6" /><path d="M62 86 l13 4" /><path d="M62 114 l13 -4" /><path d="M66 142 l13 -6" />
        <path d="M110 58 l-13 6" /><path d="M114 86 l-13 4" /><path d="M114 114 l-13 -4" /><path d="M110 142 l-13 -6" />
      </g>
    </svg>
  );
}

function ScienceGhost() {
  // an atom — nucleus + three crossing electron orbits (the universal science
  // mark; the dino-bone never read as a bone at pill scale)
  return (
    <svg viewBox="0 0 200 200" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="6">
        <ellipse cx="100" cy="100" rx="78" ry="30" />
        <ellipse cx="100" cy="100" rx="78" ry="30" transform="rotate(60 100 100)" />
        <ellipse cx="100" cy="100" rx="78" ry="30" transform="rotate(120 100 100)" />
      </g>
      <circle cx="100" cy="100" r="11" fill="currentColor" />
    </svg>
  );
}

function CultureGhost() {
  // a cropped camera — body + lens (full size, vertically centered in the box)
  return (
    <svg viewBox="0 0 200 200" fill="none" aria-hidden>
      <g transform="translate(0 -6)">
        {/* body */}
        <rect x="20" y="66" width="168" height="102" rx="16" stroke="currentColor" strokeWidth="8" />
        {/* pentaprism / viewfinder hump */}
        <path d="M70 66 L82 44 L124 44 L136 66" stroke="currentColor" strokeWidth="8" strokeLinejoin="round" />
        {/* lens */}
        <circle cx="100" cy="120" r="34" stroke="currentColor" strokeWidth="8" />
        <circle cx="100" cy="120" r="18" stroke="currentColor" strokeWidth="4" opacity="0.6" />
        {/* shutter */}
        <circle cx="46" cy="52" r="5" fill="currentColor" />
      </g>
    </svg>
  );
}

const GLYPH: Partial<Record<Market, () => React.ReactElement>> = {
  art: ArtGhost,
  design: DesignGhost,
  watches: WatchesGhost,
  sports: SportsGhost,
  science: ScienceGhost,
  culture: CultureGhost,
  // 'all' → intentionally none; keep the total-market view clean.
};

/** The bare glyph, for embedding as a faint ghost inside each market pill
    (cropped + bleeding off the pill's right edge). 'all' → null. */
export function GhostGlyph({ market }: { market: Market }) {
  const Glyph = GLYPH[market];
  return Glyph ? <Glyph /> : null;
}

export default function VerticalGhost({ market }: { market: Market }) {
  const Glyph = GLYPH[market];
  if (!Glyph) return null;
  return (
    <div className={styles.ghost} data-market={market} aria-hidden>
      <Glyph />
    </div>
  );
}
