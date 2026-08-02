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
    } catch { return; }
    setShow(true);
    // stamp at the HOLD point (write-on visually complete): stamping only at
    // full completion let a fast navigation replay the floor on the next
    // home mount (audit-lifecycle #7); still after-arm, so StrictMode's
    // double-mount cannot strand the floor
    const hold = setTimeout(() => {
      setLeaving(true);
      try { sessionStorage.setItem('lectr-greeted', '1'); } catch { /* private mode */ }
    }, 1750);
    // greeted = the write-on COMPLETED — stamping at completion (not on arm)
    // keeps StrictMode's dev double-mount from stranding the floor at full
    // opacity forever (run 1 stamped + armed, cleanup killed the timers,
    // run 2 saw the stamp and bailed with show still true)
    const gone = setTimeout(() => setShow(false), 2300);
    return () => { clearTimeout(hold); clearTimeout(gone); setShow(false); setLeaving(false); };
  }, []);

  if (!show) return null;

  return (
    <div className={`ray-greeting${leaving ? ' ray-greeting-out' : ''}`} aria-hidden="true">
      <img src="/brand/lectr.png" alt="" className="ray-greeting-mark" />
    </div>
  );
}
