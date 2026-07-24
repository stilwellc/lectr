'use client';

import { m } from 'framer-motion';
import { RECORD_BOARD } from './records';
import { fmtMoneyCompact, useInView, useReducedMotion } from './hooks';
import styles from './style.module.css';

/* ============================================================
   THE RECORD BOARD — the signature artifact. A ranked, cross-
   category leaderboard of all-time hammer records. Curated +
   source-flagged (these live in the full/stats tier, not the
   eager corpus). Bars are normalized to the top record; rows
   stagger in on scroll. Desktop = table; mobile = card list.
   ============================================================ */

const EASE = [0.23, 1, 0.32, 1] as const;

interface Props {
  variant?: 'desktop' | 'mobile';
}

export default function RecordBoard({ variant = 'desktop' }: Props) {
  const reduce = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>();

  const ranked = [...RECORD_BOARD].sort((a, b) => b.usd - a.usd);
  const top = ranked[0].usd;

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.05 } },
  };
  const row = {
    hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 10, scale: 0.98 },
    show: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: 0.5, ease: EASE },
    },
  };

  return (
    <div className={styles.recordBoard} ref={ref}>
      <div className={styles.recordHead}>
        <div>
          <span className={styles.sectionKicker}>The Record Board</span>
          <h2 className={styles.recordTitle}>All-time hammer records, every category.</h2>
        </div>
        <span className={styles.recordCaption}>
          Curated cross-category highs · source-flagged, all-in
        </span>
      </div>

      <m.ol
        className={variant === 'mobile' ? styles.recordListMobile : styles.recordList}
        variants={container}
        initial="hidden"
        animate={seen ? 'show' : 'hidden'}
      >
        {ranked.map((r, i) => {
          const w = Math.max(6, (r.usd / top) * 100);
          return (
            <m.li key={r.title} className={styles.recordRow} variants={row}>
              <span className={styles.recordRank}>{String(i + 1).padStart(2, '0')}</span>
              <span className={styles.recordCat} data-cat={r.category}>
                {r.category}
              </span>
              <span className={styles.recordMain}>
                <span className={styles.recordObj}>{r.title}</span>
                <span className={styles.recordMaker}>{r.maker}</span>
              </span>
              <span className={styles.recordBarCell}>
                <span className={styles.recordBarTrack}>
                  <m.span
                    className={styles.recordBar}
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={seen ? { scaleX: w / 100 } : { scaleX: 0 }}
                    transition={{ duration: 0.9, ease: EASE, delay: reduce ? 0 : 0.12 + i * 0.04 }}
                  />
                </span>
              </span>
              <span className={styles.recordPrice}>{fmtMoneyCompact(r.usd)}</span>
              <span className={styles.recordSource}>{r.source}</span>
            </m.li>
          );
        })}
      </m.ol>
    </div>
  );
}
