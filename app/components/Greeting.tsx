'use client';

import { useEffect, useState } from 'react';

/**
 * THE GREETING — once per session, on the first landing, the sign writes
 * itself over the closed floor before the terminal appears. Same gesture as
 * the footer's write-on, promoted to a welcome: ~1.4s of pen, a breath, then
 * the floor lifts away. Back-navigation and internal moves never replay it
 * (sessionStorage 'lectr-greeted'); reduced-motion skips it entirely.
 */
export default function Greeting() {
  // effect-mounted (never in the server render) so hydration stays clean —
  // the skeleton paints for a frame, then the floor drops over it.
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (sessionStorage.getItem('lectr-greeted')) return;
      sessionStorage.setItem('lectr-greeted', '1');
    } catch { return; }
    setShow(true);
    const hold = setTimeout(() => setLeaving(true), 1750);
    const gone = setTimeout(() => setShow(false), 2300);
    return () => { clearTimeout(hold); clearTimeout(gone); };
  }, []);

  if (!show) return null;

  return (
    <div className={`ray-greeting${leaving ? ' ray-greeting-out' : ''}`} aria-hidden="true">
      <img src="/brand/lectr.png" alt="" className="ray-greeting-mark" />
    </div>
  );
}
