'use client';

/**
 * THE TAPE — a quiet, single drifting ticker of real realized hammers. ONE hero
 * tape (not tickers everywhere — the tacky tell). Pure CSS marquee (transform
 * only), duplicated once for a seamless loop, paused under reduced motion (the
 * global media query freezes the animation → it reads as a static list, still
 * legible). Numbers are tabular mono; the price is the lit glyph.
 */

import { useMemo } from 'react';
import type { TapeLine } from './data';
import s from './style.module.css';

export default function Tape({ lines, mobile = false }: { lines: TapeLine[]; mobile?: boolean }) {
  // duplicate for the seamless wrap; guard against an empty feed
  const run = useMemo(() => {
    const base = lines.length ? lines : [];
    return [...base, ...base];
  }, [lines]);

  if (!run.length) return null;

  return (
    <div
      className={s.tape}
      data-mobile={mobile ? 'true' : 'false'}
      role="marquee"
      aria-label="Recent realized hammers"
    >
      <div className={s.tapeTrack}>
        {run.map((l, i) => (
          <span key={i} className={s.tapeItem} aria-hidden={i >= lines.length ? 'true' : undefined}>
            <span className={s.tapeMaker}>{l.maker}</span>
            <span className={s.tapeTitle}>{l.title}</span>
            <span className={s.tapePrice}>{l.price}</span>
            <span className={s.tapeHouse}>{l.house}</span>
            <span className={s.tapeDot} aria-hidden="true">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}
