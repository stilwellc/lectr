'use client';

import { LazyMotion, domAnimation, m } from 'framer-motion';
import { useInView, useReducedMotion } from './hooks';
import styles from './style.module.css';

/* ============================================================
   THE GUARANTEE — the verified board's closing band, the
   Robinhood "Protection Guarantee" grammar in lectr's voice:
   one centered statement, then four LARGE drafted ink objects,
   each naming a rule the engine will not break. The objects are
   content, not texture — display scale, visible ink, drafting
   hatches — and they draw themselves in as the reader arrives.
   ============================================================ */

const EASE = [0.23, 1, 0.32, 1] as const;

type Draw = { initial?: { pathLength: number }; animate?: { pathLength: number }; transition?: object };

function ObjectOrbit({ d }: { d: (i: number) => Draw }) {
  return (
    <svg viewBox="0 0 96 96" aria-hidden>
      <m.circle cx="48" cy="48" r="15" {...d(0)} />
      <m.ellipse cx="48" cy="48" rx="41" ry="15" transform="rotate(-18 48 48)" {...d(1)} />
      <circle cx="86" cy="35.5" r="3" className={styles.guarFill} />
    </svg>
  );
}

function ObjectRings({ d }: { d: (i: number) => Draw }) {
  return (
    <svg viewBox="0 0 96 96" aria-hidden>
      <m.circle cx="38" cy="48" r="20" {...d(0)} />
      <m.circle cx="58" cy="48" r="20" {...d(1)} />
      {/* the overlap, hatched — the same object, seen twice */}
      <m.line x1="46" y1="36" x2="42" y2="44" {...d(2)} />
      <m.line x1="50" y1="38" x2="44" y2="50" {...d(2)} />
      <m.line x1="52" y1="44" x2="46" y2="56" {...d(2)} />
      <m.line x1="54" y1="50" x2="50" y2="58" {...d(2)} />
    </svg>
  );
}

function ObjectBell({ d }: { d: (i: number) => Draw }) {
  return (
    <svg viewBox="0 0 96 96" aria-hidden>
      <m.line x1="6" y1="74" x2="90" y2="74" {...d(0)} />
      <m.path d="M 6 74 C 28 74, 34 22, 48 22 C 62 22, 68 74, 90 74" fill="none" {...d(1)} />
      <m.line x1="34" y1="74" x2="34" y2="42" strokeDasharray="3 4" {...d(2)} />
      <m.line x1="62" y1="74" x2="62" y2="42" strokeDasharray="3 4" {...d(2)} />
      {/* the band, hatched */}
      <m.line x1="40" y1="74" x2="44" y2="34" {...d(3)} />
      <m.line x1="48" y1="74" x2="48" y2="30" {...d(3)} />
      <m.line x1="56" y1="74" x2="52" y2="34" {...d(3)} />
    </svg>
  );
}

function ObjectBalance({ d }: { d: (i: number) => Draw }) {
  return (
    <svg viewBox="0 0 96 96" aria-hidden>
      <m.line x1="48" y1="76" x2="48" y2="26" {...d(0)} />
      <m.line x1="36" y1="78" x2="60" y2="78" {...d(0)} />
      <m.line x1="20" y1="30" x2="76" y2="30" {...d(1)} />
      <m.line x1="20" y1="30" x2="20" y2="44" {...d(2)} />
      <m.line x1="76" y1="30" x2="76" y2="44" {...d(2)} />
      <m.path d="M 10 44 A 10 10 0 0 0 30 44" fill="none" {...d(3)} />
      <m.path d="M 66 44 A 10 10 0 0 0 86 44" fill="none" {...d(3)} />
    </svg>
  );
}

const RULES = [
  { Obj: ObjectOrbit, caption: 'Crawled nightly across the major houses.' },
  { Obj: ObjectRings, caption: 'Repeat sales matched — the same object, resold.' },
  { Obj: ObjectBell, caption: 'Indices published only at 95% confidence.' },
  { Obj: ObjectBalance, caption: 'Comps by medians, never means — same maker, same form.' },
];

export default function PaperGuarantee() {
  const reduce = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>();

  return (
    <div className={styles.guarantee} ref={ref}>
      <LazyMotion features={domAnimation} strict>
        <h3 className={styles.guarTitle}>No number we won&rsquo;t <em>defend</em>.</h3>
        <div className={styles.guarRow}>
          {RULES.map(({ Obj, caption }, gi) => {
            const d = (i: number): Draw => (reduce ? {} : {
              initial: { pathLength: 0 },
              animate: { pathLength: seen ? 1 : 0 },
              transition: { duration: 0.9, ease: EASE, delay: 0.15 + gi * 0.18 + i * 0.14 },
            });
            return (
              <div key={caption} className={styles.guarItem}>
                <Obj d={d} />
                <p>{caption}</p>
              </div>
            );
          })}
        </div>
      </LazyMotion>
    </div>
  );
}
