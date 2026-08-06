/**
 * VerticalGhost — the faint market watermark inside each switcher pill.
 *
 * v2 (Aug 6 2026): the original hand-drawn 200x200 illustrations (brush
 * strokes, chair silhouette, dial sketch) read as tacky at ghost opacity —
 * cropped mid-stroke, inconsistent weights, craft-project energy. Replaced
 * with the industry-standard Lucide icon geometry (ISC license,
 * lucide.dev): one simple, professionally-drawn icon per market, 24x24,
 * uniform 1.5 stroke, round caps. At watermark opacity these read as a
 * quiet emboss, not a doodle.
 *
 * SVG only — static-export safe, no deps.
 */
import type { Market } from '../../constants';

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/* Lucide 'image' — art */
const ArtGhost = () => (
  <Icon>
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </Icon>
);

/* Lucide 'armchair' — design */
const DesignGhost = () => (
  <Icon>
    <path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3" />
    <path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0Z" />
    <path d="M5 18v2" />
    <path d="M19 18v2" />
  </Icon>
);

/* Lucide 'watch' — watches */
const WatchesGhost = () => (
  <Icon>
    <circle cx="12" cy="12" r="6" />
    <polyline points="12 10 12 12 13 13" />
    <path d="m16.13 7.66-.81-4.05a2 2 0 0 0-2-1.61h-2.68a2 2 0 0 0-2 1.61l-.78 4.05" />
    <path d="m7.88 16.36.8 4a2 2 0 0 0 2 1.61h2.72a2 2 0 0 0 2-1.61l.81-4.05" />
  </Icon>
);

/* Lucide 'trophy' — sports */
const SportsGhost = () => (
  <Icon>
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </Icon>
);

/* Lucide 'rocket' — science */
const ScienceGhost = () => (
  <Icon>
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.09 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.09-1.62 0-5 0-5" />
  </Icon>
);

/* Lucide 'star' — pop culture */
const CultureGhost = () => (
  <Icon>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </Icon>
);

const GLYPH: Partial<Record<Market, () => React.JSX.Element>> = {
  art: ArtGhost,
  design: DesignGhost,
  watches: WatchesGhost,
  sports: SportsGhost,
  science: ScienceGhost,
  culture: CultureGhost,
  // 'all' → intentionally none; keep the total-market view clean.
};

/** The bare glyph, for embedding as a faint watermark inside each market pill.
    'all' → null. */
export function GhostGlyph({ market }: { market: Market }) {
  const Glyph = GLYPH[market];
  return Glyph ? <Glyph /> : null;
}
