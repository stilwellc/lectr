'use client';

import { m } from 'framer-motion';
import styles from './style.module.css';

/* Extracted from SubMarketBoard (Aug 2026): /value imports only the caliper,
   and the static import was dragging the whole 811-line board module (32.5KB)
   into that route's initial bundle. Callers must provide a LazyMotion
   ancestor (features={domAnimation} strict) — every existing mount does. */

const EASE = [0.22, 1, 0.36, 1] as const;

// signed integer for CI terminals: +79 / −4
const fmtCI = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}`;

/* ── THE CI BEAM — the caliper. A 1px rule, tick terminals at the
   95% bounds, a solid diamond at the point estimate. Never a slider. */
export function CIBeam({ lo, hi, point, dir, mini = false, play = true, large = false, delay = 0 }: {
  lo: number; hi: number; point: number; dir?: 'up' | 'down'; mini?: boolean; play?: boolean; large?: boolean;
  /** extra seconds before the draw — lets a beam draw WITH its tape row */
  delay?: number;
}) {
  // the beam IS the interval: lo→hi spans the instrument, terminals at the
  // ends, the diamond at the point estimate. Zero gets a dashed witness tick
  // only when the interval actually crosses it.
  const span = (hi - lo) || 1;
  const pad = span * 0.06;
  const x = (v: number) => ((v - lo + pad) / (span + pad * 2)) * 100;
  const tick = mini ? 4 : 6;   // half-height of terminals
  const dia = mini ? 3.2 : 5;  // half-diagonal of the diamond
  return (
    <div className={`${mini ? styles.beamMini : styles.beam}${large ? ` ${styles.beamLarge}` : ''}`} data-dir={dir} aria-hidden>
      {!mini && <span className={styles.beamLabel}>95% confidence range</span>}
      <div className={styles.beamStage}>
        <m.svg
          viewBox="0 0 100 24" preserveAspectRatio="none" className={styles.beamSvg}
          initial={play ? { scaleX: 0.6, opacity: 0 } : false}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.3 + delay }}
        >
          <line x1={x(lo)} y1="12" x2={x(hi)} y2="12" className={styles.beamRule} vectorEffect="non-scaling-stroke" />
          <line x1={x(lo)} y1={12 - tick} x2={x(lo)} y2={12 + tick} className={styles.beamRule} vectorEffect="non-scaling-stroke" />
          <line x1={x(hi)} y1={12 - tick} x2={x(hi)} y2={12 + tick} className={styles.beamRule} vectorEffect="non-scaling-stroke" />
          {lo < 0 && hi > 0 && (
            <line x1={x(0)} y1={12 - tick - 2} x2={x(0)} y2={12 + tick + 2} className={styles.beamZero} vectorEffect="non-scaling-stroke" />
          )}
        </m.svg>
        <m.span
          className={styles.beamDiamond}
          style={{ left: `${x(point)}%`, width: dia * 2, height: dia * 2 }}
          initial={play ? { scale: 0 } : false}
          animate={{ scale: 1 }}
          transition={{ duration: 0.18, ease: EASE, delay: play ? 0.8 + delay : 0 }}
        />
      </div>
      {!mini && (
        <div className={styles.beamEnds}>
          <span className={styles.pctData}>{fmtCI(lo)}</span>
          <span className={styles.pctData}>{fmtCI(hi)}</span>
        </div>
      )}
    </div>
  );
}
