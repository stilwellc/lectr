'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * THE OPEN — once per session, on the first landing, the sign writes itself
 * in BUTTER over the house's own ground, then hangs itself in the nav.
 *
 * The old gesture had two bugs on the brand's opening move: an ~800ms black
 * void before anything painted, and the script writing in WHITE inside a
 * visibly lighter radial box. Rebuilt:
 *
 *   0ms      first paint is NEVER black — the ground (the page's own bg) and
 *            the nav hairline render statically, immediately.
 *   150–900  the lectr mark writes itself in butter (#E8DAB6) with a soft
 *            12px halo, centered at 64px, on TRANSPARENT ground. The white
 *            PNG is used as a CSS MASK over a butter fill — no box, no
 *            blend-mode guesswork, exact brand color.
 *   900–1220 the mark translate+scales into its nav slot (320ms — the sign
 *            hangs itself), the ground fading away beneath it so the hero
 *            choreography (synced via openElapsed) is already moving.
 *   ~1220+   the flying mark crossfades into the real nav mark and the
 *            overlay unmounts.
 *
 * Back-navigation and internal moves never replay it (sessionStorage
 * 'lectr-greeted'); reduced-motion skips it entirely — the page paints
 * resolved, the session-gate pattern for everything downstream.
 */

// the open's clock — IndexHero reads this to sync the hero choreography
let openStart: number | null = null;
export function openElapsed(): number | null {
  if (openStart == null || typeof performance === 'undefined') return null;
  return performance.now() - openStart;
}

const openCss = `
  .lectr-open {
    position: fixed;
    inset: 0;
    z-index: 200;
    pointer-events: none;
  }
  .lectr-open-ground {
    position: absolute;
    inset: 0;
    background: var(--color-bg, #0d0b08);
    transition: opacity 420ms var(--ease-ui, ease);
  }
  .lectr-open-hair {
    position: absolute;
    top: 57px;
    left: 0;
    right: 0;
    height: 1px;
    background: rgba(232, 218, 182, 0.12);
  }
  .lectr-open-mark {
    position: fixed;
    left: 50%;
    top: 50%;
    height: 64px;
    aspect-ratio: 1146 / 735;
    transform: translate(-50%, -50%);
    transform-origin: top left;
    filter: drop-shadow(0 0 12px rgba(232, 218, 182, 0.35));
    transition: opacity 200ms var(--ease-ui, ease);
  }
  .lectr-open-ink {
    display: block;
    width: 100%;
    height: 100%;
    background: #e8dab6;
    -webkit-mask: url(/brand/lectr.png) center / contain no-repeat;
    mask: url(/brand/lectr.png) center / contain no-repeat;
    clip-path: inset(0 100% 0 0);
    animation: lectrOpenWrite 750ms var(--ease-draw, ease-out) 150ms forwards;
  }
  @keyframes lectrOpenWrite {
    to { clip-path: inset(0 0 0 0); }
  }
`;

export default function Greeting() {
  // effect-mounted (never in the server render) so hydration stays clean —
  // the page paints for a frame, then the ground settles over it.
  const [show, setShow] = useState(false);
  const [groundGone, setGroundGone] = useState(false);
  const [markGone, setMarkGone] = useState(false);
  const markRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (sessionStorage.getItem('lectr-greeted')) return;
      sessionStorage.setItem('lectr-greeted', '1');
    } catch { return; }
    openStart = performance.now();
    setShow(true);

    // T+900 — the sign hangs itself: FLIP the centered mark into the nav slot
    // (320ms), the ground already fading beneath it.
    const fly = setTimeout(() => {
      setGroundGone(true);
      const el = markRef.current;
      const target = document.querySelector<HTMLElement>('.ray-mark-r');
      if (el && target) {
        const from = el.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        // the nav mark is the same asset — scale by height, align top-left
        const scale = to.height / from.height;
        el.style.transition = 'transform 320ms var(--ease-signature, cubic-bezier(0.23,1,0.32,1))';
        el.style.transform = `translate(${to.left - from.left - from.width / 2}px, ${to.top - from.top - from.height / 2}px) scale(${scale})`;
        // the drop-shadow halo dims as it docks
        el.style.filter = 'drop-shadow(0 0 4px rgba(232, 218, 182, 0.18))';
      }
    }, 900);
    // T+1240 — landed: crossfade into the real nav mark, then strike the set
    const land = setTimeout(() => setMarkGone(true), 1240);
    const gone = setTimeout(() => setShow(false), 1500);
    return () => { clearTimeout(fly); clearTimeout(land); clearTimeout(gone); };
  }, []);

  if (!show) return null;

  return (
    <div className="lectr-open" aria-hidden="true">
      <style>{openCss}</style>
      <div className="lectr-open-ground" style={groundGone ? { opacity: 0 } : undefined}>
        <div className="lectr-open-hair" />
      </div>
      <div ref={markRef} className="lectr-open-mark" style={markGone ? { opacity: 0 } : undefined}>
        <span className="lectr-open-ink" />
      </div>
    </div>
  );
}
