'use client';

/**
 * THE EDGE — the backtest track record, the payoff at the end of the scroll.
 * Two count-ups (flagged vs unflagged beat-rate) on a shared baseline so the
 * gap reads instantly; the flagged number takes the gold. n is stated for
 * trust. Count-ups fire on scroll-in; reduced motion lands them final.
 */

import type { EdgeSummary } from './data';
import { grouped } from './data';
import { useCountUp, useInViewport, useReducedMotion } from './useScene';
import s from './style.module.css';

export default function Edge({ edge }: { edge: EdgeSummary }) {
  const reduced = useReducedMotion();
  const [ref, inView] = useInViewport<HTMLDivElement>({ once: true, threshold: 0.3 });
  const flagged = useCountUp(edge.flaggedBeatPct, inView, { reduced, durationMs: 1400 });
  const unflagged = useCountUp(edge.unflaggedBeatPct, inView, { reduced, durationMs: 1400 });

  return (
    <div ref={ref} className={s.edge}>
      <div className={s.edgeThesis}>
        We flag lots trading below the market. Then we check ourselves against
        history.
      </div>
      <div className={s.edgeGrid}>
        <div className={s.edgeCard} data-lit="true">
          <span className={s.edgeCardLabel}>lectr-flagged lots</span>
          <span className={s.edgeCardVal}>
            {flagged}
            <span className={s.edgeCardPct}>%</span>
          </span>
          <span className={s.edgeCardSub}>beat the high estimate</span>
        </div>
        <div className={s.edgeCard}>
          <span className={s.edgeCardLabel}>everything else</span>
          <span className={s.edgeCardVal} data-muted="true">
            {unflagged}
            <span className={s.edgeCardPct}>%</span>
          </span>
          <span className={s.edgeCardSub}>beat the high estimate</span>
        </div>
      </div>
      <div className={s.edgeFoot}>
        <span className={s.edgeEdgePts} data-dir="up">
          +{edge.edgePts} pts edge
        </span>
        <span className={s.edgeN}>
          replayed across {grouped(edge.nFlagged)} flagged lots, 2000–2026 · median flagged lot
          realized +{edge.flaggedMedianPct}% over mid-estimate vs +{edge.unflaggedMedianPct}%
        </span>
      </div>
    </div>
  );
}
