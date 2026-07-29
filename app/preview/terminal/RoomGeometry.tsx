'use client';

import { LazyMotion, domAnimation, m } from 'framer-motion';
import { useInView, useReducedMotion } from './hooks';
import styles from './style.module.css';

/* ============================================================
   ROOM GEOMETRY — the paper rooms' graphic language. Giant
   drafted ink shapes, cropped by the room edges (the Robinhood
   mega-shape move, drawn in lectr's drafting ink):

     · 'bell'  — a monumental 95% confidence bell spanning the
                 verified board, its CI drops dashed. The math
                 the room stands on, drawn at room scale.
     · 'arcs'  — concentric hammer arcs radiating from the top
                 corner of the record board: the strike, rippling.

   Each shape DRAWS ITSELF as the room scrolls into view (pure
   line work, pathLength), then holds. Ink at whisper opacity —
   composition, never noise. Static under reduced motion.
   ============================================================ */

const EASE = [0.23, 1, 0.32, 1] as const;

export default function RoomGeometry({ kind }: { kind: 'bell' | 'arcs' }) {
  const reduce = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>();
  const draw = (delay: number, dur = 1.8) => ({
    initial: reduce ? undefined : { pathLength: 0 },
    animate: reduce ? undefined : seen ? { pathLength: 1 } : { pathLength: 0 },
    transition: { duration: dur, ease: EASE, delay },
  });

  return (
    <div className={styles.roomGeo} ref={ref} aria-hidden>
      <LazyMotion features={domAnimation} strict>
        {kind === 'bell' ? (
          /* the bell DOMES the room head — crest behind the monument title,
             legs running down past the first card row (top-anchored, not
             buried behind the bento) */
          <svg viewBox="0 0 1440 460" preserveAspectRatio="none" className={styles.geoTop}>
            <m.path
              d="M -40 452 C 360 452, 520 64, 720 64 C 920 64, 1080 452, 1480 452"
              className={styles.geoLine}
              fill="none"
              {...draw(0.15, 2.2)}
            />
            <m.line x1="520" y1="452" x2="520" y2="180" strokeDasharray="3 6" className={styles.geoLine} {...draw(1.5, 0.7)} />
            <m.line x1="920" y1="452" x2="920" y2="180" strokeDasharray="3 6" className={styles.geoLine} {...draw(1.6, 0.7)} />
          </svg>
        ) : (
          <svg viewBox="0 0 1440 640" preserveAspectRatio="xMaxYMin slice">
            {/* the hammer strike, rippling out of the corner */}
            <m.circle cx="1350" cy="-60" r="200" className={styles.geoLine} fill="none" {...draw(0, 1.4)} />
            <m.circle cx="1350" cy="-60" r="360" className={styles.geoLine} fill="none" {...draw(0.2, 1.6)} />
            <m.circle cx="1350" cy="-60" r="520" className={styles.geoLine} fill="none" {...draw(0.4, 1.8)} />
            <m.circle cx="1350" cy="-60" r="680" className={styles.geoLine} fill="none" {...draw(0.6, 2.0)} />
            <m.circle cx="1350" cy="-60" r="6" className={styles.geoDot} {...(reduce ? {} : {
              initial: { scale: 0 },
              animate: seen ? { scale: 1 } : { scale: 0 },
              transition: { duration: 0.5, ease: EASE, delay: 0.1 },
            })} />
          </svg>
        )}
      </LazyMotion>
    </div>
  );
}
