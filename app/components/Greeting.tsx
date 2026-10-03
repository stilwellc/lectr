'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * THE GREETING — once per session, on the first landing, the signature
 * writes `lectr` on a blank eggshell plate, holds while tonight's book
 * loads, then fades to the call (docs/NORTHSTAR_UI.md §0.10). The plate is
 * opaque eggshell — no skeleton blocks ever show through it.
 *
 *   sign      ~900ms pen stroke (clip-path wipe of the script mark)
 *   hold      until the page reports `ready` (min 1.1s total, max 2.6s)
 *   fade      400ms on the house curve, revealing the call underneath
 *
 * Skipped entirely for prefers-reduced-motion, automation
 * (navigator.webdriver — the shot rig must see the fold), ?nogreet=1, and
 * any later home mount in the same session (sessionStorage 'lectr-greeted').
 */
const MIN_MS = 1100;
const MAX_MS = 2600;
const FADE_MS = 400;

export default function Greeting({ ready = true }: { ready?: boolean }) {
  // effect-mounted (never in the server render) so hydration stays clean
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const armedAt = useRef<number | null>(null);

  useEffect(() => {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (navigator.webdriver && new URLSearchParams(window.location.search).get('greet') !== '1') return;
      if (new URLSearchParams(window.location.search).get('nogreet') === '1') return;
      if (sessionStorage.getItem('lectr-greeted')) return;
    } catch { return; }
    armedAt.current = performance.now();
    setShow(true);
    // stamp once the signature is down — a fast navigation after that point
    // must not replay the plate (audit-lifecycle #7)
    const stamp = setTimeout(() => {
      try { sessionStorage.setItem('lectr-greeted', '1'); } catch { /* private mode */ }
    }, 900);
    // the ceiling: a slow network never holds the reader behind the plate
    const cap = setTimeout(() => setLeaving(true), MAX_MS);
    return () => {
      clearTimeout(stamp); clearTimeout(cap);
      armedAt.current = null;
      setShow(false); setLeaving(false);
    };
  }, []);

  // ready → leave once the minimum hold has elapsed
  useEffect(() => {
    if (!show || leaving || !ready || armedAt.current == null) return;
    const wait = Math.max(0, MIN_MS - (performance.now() - armedAt.current));
    const t = setTimeout(() => setLeaving(true), wait);
    return () => clearTimeout(t);
  }, [show, leaving, ready]);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setShow(false), FADE_MS + 40);
    return () => clearTimeout(t);
  }, [leaving]);

  if (!show) return null;

  return (
    <div className={`ray-greeting${leaving ? ' ray-greeting-out' : ''}`} aria-hidden="true">
      <img src="/brand/lectr.png" alt="" className="ray-greeting-mark" />
    </div>
  );
}
