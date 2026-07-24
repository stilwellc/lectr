'use client';

/**
 * HERO FIELD — the one big effect: a slow warm gold mesh-gradient drifting on
 * vellum-black, with a grain overlay so it never bands.
 *
 * FALLBACK CHAIN (proven, no blank / no crash):
 *   1. reduced-motion OR no-WebGL  → a static CSS radial+conic gold gradient.
 *      The shader is NEVER mounted in this branch, so a GL-less browser can't
 *      throw.
 *   2. WebGL + motion              → MeshGradient, DPR capped ≤ 1.5, speed
 *      gated to 0 when offscreen or the tab is hidden (rAF fully stops).
 * The grain sits on top of BOTH branches. The CSS gradient is also the SSR
 * paint, so first frame is warm before hydration.
 */

import { useMemo } from 'react';
import { MeshGradient } from '@paper-design/shaders-react';
import { useReducedMotion, useWebGL, useDocumentVisible, useInViewport } from './useScene';
import s from './style.module.css';

/** Warm butter/gold spots on vellum-black. Restrained — one lit thing. */
const COLORS_DESKTOP = ['#0D0B08', '#151007', '#3A2E12', '#8A6A2A', '#E8DAB6', '#120E09'];
/** Mobile: fewer spots, lighter — its own scene, not the desktop downscaled. */
const COLORS_MOBILE = ['#0D0B08', '#1A1409', '#6A5220', '#E8DAB6', '#100C08'];

export default function HeroField({ mobile = false }: { mobile?: boolean }) {
  const reduced = useReducedMotion();
  const webgl = useWebGL();
  const visible = useDocumentVisible();
  // live visibility (not once) so the shader pauses when scrolled far past
  const [wrapRef, onscreen] = useInViewport<HTMLDivElement>({
    once: false,
    rootMargin: '0px',
    threshold: 0,
  });

  const useShader = webgl && !reduced;
  const colors = mobile ? COLORS_MOBILE : COLORS_DESKTOP;

  // speed 0 halts rAF entirely (library contract) → true offscreen/hidden pause
  const speed = onscreen && visible ? (mobile ? 0.14 : 0.18) : 0;

  const style = useMemo(
    () => ({ width: '100%', height: '100%', display: 'block' as const }),
    [],
  );

  return (
    <div ref={wrapRef} className={s.heroField} aria-hidden="true">
      {/* CSS gold gradient — the SSR paint AND the reduced/no-WebGL fallback */}
      <div className={s.heroCssGradient} data-hidden={useShader ? 'true' : 'false'} />

      {useShader && (
        <div className={s.heroShaderWrap}>
          <MeshGradient
            style={style}
            colors={colors}
            speed={speed}
            distortion={mobile ? 0.7 : 0.85}
            swirl={mobile ? 0.35 : 0.5}
            grainMixer={0.18}
            grainOverlay={0}
            scale={mobile ? 1.1 : 1.25}
            // hard DPR / pixel-count cap — never render above 1.5×
            minPixelRatio={1}
            maxPixelCount={mobile ? 1280 * 720 * 1.5 : 1920 * 1080 * 1.5}
          />
        </div>
      )}

      {/* grain — kills banding on both branches. Static SVG noise, no animation. */}
      <div className={s.heroGrain} />
      {/* bottom vignette so text/tape read against the light */}
      <div className={s.heroVignette} />
    </div>
  );
}
