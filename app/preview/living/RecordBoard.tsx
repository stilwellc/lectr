'use client';

/**
 * THE RECORD BOARD — the signature artifact. A ranked, cross-category
 * leaderboard of all-time hammer records, source-flagged. Nobody else owns
 * cross-category records. Rows enter staggered (scale 0.95 + fade, signature
 * ease) via framer-motion `m` under LazyMotion(domAnimation); a relative gold
 * bar encodes each amount against the $195M top. Numbers tabular mono.
 *
 * On mobile it re-authors into full-bleed vertical plates (own layout in CSS).
 */

import { LazyMotion, domAnimation, m } from 'framer-motion';
import { RECORD_BOARD, RECORD_MAX } from './data';
import { useInViewport, useReducedMotion } from './useScene';
import s from './style.module.css';

export default function RecordBoard({ mobile = false }: { mobile?: boolean }) {
  const reduced = useReducedMotion();
  const [ref, inView] = useInViewport<HTMLDivElement>({ once: true, threshold: 0.12 });
  const show = inView || reduced;

  return (
    <LazyMotion features={domAnimation} strict>
      <div ref={ref} className={s.board} data-mobile={mobile ? 'true' : 'false'}>
        <ol className={s.boardList}>
          {RECORD_BOARD.map((r, i) => {
            const pct = Math.max(6, (r.amount / RECORD_MAX) * 100);
            return (
              <m.li
                key={`${r.object}-${r.rank}`}
                className={s.boardRow}
                initial={reduced ? false : { opacity: 0, scale: 0.95, y: 10 }}
                animate={show ? { opacity: 1, scale: 1, y: 0 } : {}}
                transition={{
                  duration: 0.5,
                  delay: reduced ? 0 : Math.min(i * 0.05, 0.5),
                  ease: [0.23, 1, 0.32, 1],
                }}
              >
                <span className={s.boardRank}>{String(r.rank).padStart(2, '0')}</span>
                <div className={s.boardMain}>
                  <div className={s.boardTop}>
                    <span className={s.boardCat}>{r.category}</span>
                    <span className={s.boardMaker}>{r.maker}</span>
                  </div>
                  <div className={s.boardObject}>{r.object}</div>
                  <div className={s.boardBarTrack} aria-hidden="true">
                    <m.div
                      className={s.boardBar}
                      initial={reduced ? false : { scaleX: 0 }}
                      animate={show ? { scaleX: pct / 100 } : {}}
                      transition={{
                        duration: 0.9,
                        delay: reduced ? 0 : Math.min(i * 0.05, 0.5) + 0.15,
                        ease: [0.23, 1, 0.32, 1],
                      }}
                    />
                  </div>
                  <div className={s.boardSource}>
                    {r.source} · {r.year}
                  </div>
                </div>
                <span className={s.boardAmount}>{r.display}</span>
              </m.li>
            );
          })}
        </ol>
        <p className={s.boardFoot}>
          All-time hammer records, cross-category. Prices as reported by the selling house, premium inclusive.
        </p>
      </div>
    </LazyMotion>
  );
}
