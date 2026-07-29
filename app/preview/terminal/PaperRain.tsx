'use client';

import styles from './style.module.css';

/* ============================================================
   THE PAPER RAIN — the record room's air: a slow fall of
   hammer ticks in ink across the cream, the Robinhood
   "Join a new generation" rain in lectr's material. Layout is
   deterministic per index (SSR-stable, no Math.random); pure
   CSS animation; hidden under reduced motion.
   ============================================================ */

export default function PaperRain({ count = 46, fall = 1600 }: { count?: number; fall?: number }) {
  return (
    <div className={styles.paperRain} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          style={{
            left: `${(i * 61) % 100}%`,
            animationDelay: `${((i * 37) % 70) / 10}s`,
            animationDuration: `${9 + ((i * 13) % 60) / 10}s`,
            height: `${11 + ((i * 29) % 4) * 4}px`,
            ['--fall' as string]: `${fall}px`,
          }}
        />
      ))}
    </div>
  );
}
