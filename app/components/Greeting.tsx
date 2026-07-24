'use client';

import { useEffect, useState } from 'react';

/**
 * THE GREETING — once per session, on the first landing, the sign writes
 * itself over the closed floor, then LIFTS and HANDS OFF to the board opening.
 *
 * The mask fix: the Greeting no longer runs concurrently over a board that is
 * animating underneath. It owns the first ~1.15s alone (the sign writes on),
 * then it lifts AND fires `onDone()` — that single signal is what arms the
 * board's opening beat (hero split-flap → curve draw → tone resolve → ledger
 * cascade → ticker → pills). One continuous gesture, no overlap.
 *
 * Degradation: the parent decides whether the Greeting plays at all. On a
 * cached revisit, an internal move (sessionStorage 'lectr-greeted'), or
 * reduced-motion, the parent passes play=false → this renders nothing and
 * calls onDone immediately, so the board is already in its final state (no
 * mask, no re-watch, no stranded 0). Only a genuine first visit sees the pen.
 */
export default function Greeting({
  play,
  onDone,
}: {
  /** parent-decided: true only on a genuine first, motion-allowed visit */
  play: boolean;
  /** fired as the sign lifts (or immediately when not playing) — arms the board */
  onDone: () => void;
}) {
  // effect-mounted (never in the server render) so hydration stays clean.
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!play) {
      // Not our turn — hand off at once so the board opens (or, on a cached
      // revisit, is already final). Never mask, never delay.
      onDone();
      return;
    }
    setShow(true);
    // The sign writes on over ~1.0s, holds a beat, then lifts at ~1.15s — and
    // the lift IS the handoff: onDone() arms the board as the mark clears, so
    // the two gestures read as one continuous open (no concurrent masking).
    const HAND_OFF = 1150;
    const GONE = HAND_OFF + 520; // matches the .ray-greeting opacity transition
    const lift = setTimeout(() => {
      setLeaving(true);
      onDone();
    }, HAND_OFF);
    const gone = setTimeout(() => setShow(false), GONE);
    return () => { clearTimeout(lift); clearTimeout(gone); };
    // decided once at mount; onDone is stable from the parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  if (!show) return null;

  return (
    <div className={`ray-greeting${leaving ? ' ray-greeting-out' : ''}`} aria-hidden="true">
      <img src="/brand/lectr.png" alt="" className="ray-greeting-mark" />
    </div>
  );
}
