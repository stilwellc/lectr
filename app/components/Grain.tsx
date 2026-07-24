/**
 * Grain — a fixed, full-viewport, whisper-faint warm patina overlay so the
 * vellum-black ground feels like an aged brass/vellum surface, not flat black.
 *
 * Technique: an inline SVG feTurbulence (fractalNoise) rasterized to a data-URI
 * PNG-equivalent and tiled as a small 160px background. No external asset, no
 * network — the SVG is embedded in the CSS itself. `mix-blend-mode: soft-light`
 * lets the noise ride the ground's own luminance (lifts near-black toward warm,
 * leaves text legible) rather than sitting on top as a flat film.
 *
 * Cheap: one static, GPU-composited fixed layer, no animation, no JS, no repaint.
 * Non-interactive & decorative: pointer-events:none + aria-hidden, so it never
 * intercepts taps and never enters the a11y tree. Static-export safe (pure markup).
 * prefers-reduced-motion is N/A (fully static) — nothing here moves.
 */

// A tiny fractalNoise tile. baseFrequency high → fine grain; low octaves → cheap.
// The rect is filled with the turbulence result; the whole thing tints via blend.
const NOISE = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>\
<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>\
<feColorMatrix type='saturate' values='0'/></filter>\
<rect width='100%' height='100%' filter='url(%23g)'/></svg>`;

const CSS = `
.grain-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;                         /* above the ground, below content/interactive layers */
  background-image: url("data:image/svg+xml,${NOISE}");
  background-size: 160px 160px;
  background-repeat: repeat;
  mix-blend-mode: soft-light;         /* rides the ground's luminance; keeps text clean */
  will-change: transform;             /* hint a compositor layer; never animates */
}
`;

export default function Grain({ opacity = 0.035 }: { opacity?: number }): JSX.Element {
  return (
    <div className="grain-layer" aria-hidden="true" style={{ opacity }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </div>
  );
}

/*
 * Usage (mount once, high in the tree — it self-positions fixed):
 *   <Grain />                 // default whisper (~0.035)
 *   <Grain opacity={0.05} />  // slightly more felt on very flat screens
 */
