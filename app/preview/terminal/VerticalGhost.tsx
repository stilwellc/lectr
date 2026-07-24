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
  // a cropped watch dial with hands + a couple hour ticks
  return (
    <svg viewBox="0 0 200 200" fill="none" aria-hidden>
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
    </svg>
  );
}

function SportsGhost() {
  // half a baseball — the curved seam with stitch ticks
  return (
    <svg viewBox="0 0 200 200" fill="none" aria-hidden>
      <circle cx="118" cy="100" r="84" stroke="currentColor" strokeWidth="7" />
      {/* seam arc */}
      <path
        id="seam"
        d="M52 32 C86 70 86 130 52 168"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* stitches straddling the seam */}
      <g stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
        <path d="M56 52 L74 44" />
        <path d="M62 46 L44 54" />
        <path d="M68 82 L86 76" />
        <path d="M72 76 L54 84" />
        <path d="M70 118 L88 124" />
        <path d="M74 124 L56 116" />
        <path d="M56 148 L74 156" />
        <path d="M62 154 L44 146" />
      </g>
    </svg>
  );
}

function ScienceGhost() {
  // a fossil / dino bone (femur), cropped
  return (
    <svg viewBox="0 0 200 200" fill="none" aria-hidden>
      <path
        d="M40 150
           C22 158 20 178 36 184
           C50 190 66 178 66 166
           C86 158 118 118 138 96
           C158 118 186 114 192 96
           C200 76 182 60 168 66
           C170 48 156 32 138 40
           C122 47 122 66 130 76
           C110 96 82 128 66 146
           C56 138 44 140 40 150 Z"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CultureGhost() {
  // a cropped camera — body + lens
  return (
    <svg viewBox="0 0 200 200" fill="none" aria-hidden>
      {/* body */}
      <rect x="20" y="66" width="168" height="102" rx="16" stroke="currentColor" strokeWidth="8" />
      {/* pentaprism / viewfinder hump */}
      <path d="M70 66 L82 44 L124 44 L136 66" stroke="currentColor" strokeWidth="8" strokeLinejoin="round" />
      {/* lens */}
      <circle cx="100" cy="120" r="34" stroke="currentColor" strokeWidth="8" />
      <circle cx="100" cy="120" r="18" stroke="currentColor" strokeWidth="4" opacity="0.6" />
      {/* shutter */}
      <circle cx="46" cy="52" r="5" fill="currentColor" />
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

export default function VerticalGhost({ market }: { market: Market }) {
  const Glyph = GLYPH[market];
  if (!Glyph) return null;
  return (
    <div className={styles.ghost} data-market={market} aria-hidden>
      <Glyph />
    </div>
  );
}
