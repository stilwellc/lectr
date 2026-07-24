'use client';

import { useMemo } from 'react';
import type { TapeItem } from '../../hooks/useRayData';
import { useReducedMotion } from './hooks';
import styles from './style.module.css';

/* ============================================================
   The live tape — ONE quiet, tasteful ticker of recently
   realized hammers (maker · title · price). A slow continuous
   crawl (CSS, GPU transform). Reduced-motion → a static,
   scannable strip (no crawl). Never a second tape anywhere.
   ============================================================ */

interface Props {
  items: TapeItem[];
  /** seconds for one full loop — slower = quieter */
  speed?: number;
}

export default function Tape({ items, speed = 64 }: Props) {
  const reduce = useReducedMotion();

  // de-dupe adjacent identical prices (the source repeats a sale across lots)
  const clean = useMemo(() => {
    const seen = new Set<string>();
    const out: TapeItem[] = [];
    for (const it of items) {
      const key = `${it.artist}|${it.title}|${it.price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
    return out.slice(0, 16);
  }, [items]);

  if (!clean.length) return null;

  const Row = ({ it, k }: { it: TapeItem; k: string }) => (
    <span className={styles.tapeItem} key={k}>
      <span className={styles.tapeDot} aria-hidden />
      <span className={styles.tapeMaker}>{it.artist}</span>
      <span className={styles.tapeTitle}>{it.title}</span>
      <span className={styles.tapePrice}>{it.price}</span>
      <span className={styles.tapeHouse}>{it.house}</span>
    </span>
  );

  if (reduce) {
    return (
      <div className={styles.tape} role="marquee" aria-label="Recently realized hammers">
        <div className={styles.tapeStatic}>
          {clean.map((it, i) => (
            <Row it={it} k={`s${i}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tape} role="marquee" aria-label="Recently realized hammers">
      <div className={styles.tapeTrack} style={{ ['--tape-dur' as string]: `${speed}s` }}>
        {clean.map((it, i) => (
          <Row it={it} k={`a${i}`} />
        ))}
        {/* duplicate for a seamless loop */}
        {clean.map((it, i) => (
          <Row it={it} k={`b${i}`} />
        ))}
      </div>
    </div>
  );
}
