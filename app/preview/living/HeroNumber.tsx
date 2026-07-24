'use client';

/**
 * THE HERO NUMBER — the biggest glyph on screen is a financial truth. One
 * tabular-mono count-up of the corpus size (507,107 lots), with the live lectr
 * all-market index level riding beneath as the market read. "Fast digits, slow
 * color": the digits settle in ~1.6s; the delta tint on the index resolves a
 * beat slower. Reduced motion → lands final, no stranded 0.
 */

import type { HeroTruth } from './data';
import { grouped } from './data';
import { useCountUp, useReducedMotion } from './useScene';
import s from './style.module.css';

export default function HeroNumber({ truth, mobile = false }: { truth: HeroTruth; mobile?: boolean }) {
  const reduced = useReducedMotion();
  // the hero count-up starts immediately on mount (it IS the first-second wow)
  const lots = useCountUp(truth.totalLots, true, { reduced, durationMs: 1800 });

  const delta = truth.indexDeltaPct;
  const dir = delta == null ? 'flat' : delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat';

  return (
    <div className={s.heroNum} data-mobile={mobile ? 'true' : 'false'}>
      <div className={s.heroEyebrow}>The Living Index — auction intelligence, all of it</div>

      <div className={s.heroFigure} aria-label={`${grouped(truth.totalLots)} lots`}>
        <span className={s.heroFigureVal}>{grouped(lots)}</span>
        <span className={s.heroFigureUnit}>lots priced</span>
      </div>

      <div className={s.heroSub}>
        <span className={s.heroSubItem}>
          <span className={s.heroSubK}>{grouped(truth.totalSold)}</span> sold
        </span>
        <span className={s.heroSubSep} aria-hidden="true">·</span>
        <span className={s.heroSubItem}>7 houses</span>
        <span className={s.heroSubSep} aria-hidden="true">·</span>
        <span className={s.heroSubItem}>back to 1991</span>
      </div>

      {truth.indexLevel != null && (
        <div className={s.heroIndex} data-dir={dir}>
          <span className={s.heroIndexLabel}>lectr all-market index</span>
          <span className={s.heroIndexVal}>{truth.indexLevel.toFixed(0)}</span>
          {delta != null && (
            <span className={s.heroIndexDelta} data-dir={dir}>
              {delta > 0 ? '+' : ''}
              {delta.toFixed(1)}%
            </span>
          )}
          {truth.lastPeriod && <span className={s.heroIndexPeriod}>{truth.lastPeriod}</span>}
        </div>
      )}
    </div>
  );
}
