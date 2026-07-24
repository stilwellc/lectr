'use client';

import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { MarketData } from '../../hooks/useRayData';
import { type Market } from '../../constants';
import Sparkline from './Sparkline';
import { fmtInt, useInView, useReducedMotion } from './hooks';
import { verifiedMovers, fmtPct } from './verified';
import styles from './style.module.css';

/* ============================================================
   THE VERIFIED MOVERS BOARD — every maker whose price movement
   clears the 95% confidence bar, ranked by the strongest move.
   These are the ONLY appreciation reads the hedonic engine will
   stand behind: each is a like-for-like fit (reference, form,
   size, era, house held constant) over that maker's own lots,
   shown at its longest defensible horizon with the interval.
   Market-level indices abstain where a quarter can't hold
   quality constant — we say so in the footer rather than fake it.
   A row click re-scopes the page to that maker's market.
   ============================================================ */

const EASE = [0.23, 1, 0.32, 1] as const;

interface Props {
  market: MarketData | null;
  activeKey: Market;
  onSelect: (key: Market) => void;
  /** mobile = card list; desktop = table */
  variant?: 'desktop' | 'mobile';
}

export default function MoversBoard({ market, activeKey, onSelect, variant = 'desktop' }: Props) {
  const reduce = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>();

  const rows = verifiedMovers(market);

  const head = (
    <div className={styles.moversHead}>
      <div>
        <span className={styles.sectionKicker}>Verified movers · 95% confidence</span>
        <h2 className={styles.moversTitle}>What actually moved — and only that.</h2>
      </div>
    </div>
  );

  const foot = (
    <p className={styles.moversFoot}>
      Like-for-like hedonic fit per maker (reference · form · size · era · house held constant), shown at its
      longest horizon whose 95% interval resolves the sign. Market-level indices abstain where a quarter can&apos;t
      hold quality constant — we don&apos;t print a direction the data won&apos;t back.
    </p>
  );

  if (!rows.length) {
    return (
      <div className={styles.movers} ref={ref}>
        {head}
        <div className={styles.moversEmpty}>
          No maker clears the 95%-confidence bar this cycle. As coverage deepens, the makers that resolve a
          direction surface here — never a number the engine can&apos;t defend.
        </div>
        {foot}
      </div>
    );
  }

  if (variant === 'mobile') {
    return (
      <div ref={ref}>
        {head}
        <div className={styles.mobMoverList}>
          {rows.map((r) => (
            <button
              key={r.slug}
              type="button"
              className={styles.mobMoverCard}
              data-active={r.market === activeKey}
              onClick={() => onSelect(r.market)}
              aria-label={`${r.label}: ${fmtPct(r.changePct)} over ${r.horizon} — switch to ${r.market}`}
            >
              <div className={styles.mobMoverTop}>
                <span className={styles.mobMoverName}>
                  <span className={styles.moversTick} data-dir={r.dir} aria-hidden />
                  {r.label}
                </span>
                <span className={styles.moversDelta} data-dir={r.dir}>{fmtPct(r.changePct)} <em>{r.horizon}</em></span>
              </div>
              <div className={styles.mobMoverBot}>
                <span className={styles.moversCi}>95% CI [{r.ciLoPct.toFixed(0)}, {r.ciHiPct.toFixed(0)}]</span>
                <Sparkline data={r.series.slice(-24)} dir={r.dir} width={110} height={30} />
              </div>
            </button>
          ))}
        </div>
        {foot}
      </div>
    );
  }

  const container = { hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.05 } } };
  const rowV = {
    hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
  };

  return (
    <LazyMotion features={domAnimation} strict>
      <div className={styles.movers} ref={ref}>
        {head}
        <div className={styles.moversTable} role="table">
          <div className={styles.moversColHead} role="row">
            <span role="columnheader">Maker</span>
            <span role="columnheader" className={styles.right}>Move</span>
            <span role="columnheader" className={styles.right}>95% CI</span>
            <span role="columnheader" className={styles.moversTrendHead}>Trend</span>
            <span role="columnheader" className={styles.right}>Lots</span>
          </div>
          <m.div variants={container} initial="hidden" animate={seen ? 'show' : 'hidden'}>
            {rows.map((r) => (
              <m.button
                key={r.slug}
                type="button"
                className={styles.moversRow}
                data-active={r.market === activeKey}
                variants={rowV}
                onClick={() => onSelect(r.market)}
                aria-label={`${r.label}: ${fmtPct(r.changePct)} over ${r.horizon}, 95% CI ${r.ciLoPct.toFixed(0)} to ${r.ciHiPct.toFixed(0)} — switch the board to ${r.market}`}
                aria-current={r.market === activeKey ? 'true' : undefined}
              >
                <span className={styles.moversName}>
                  <span className={styles.moversTick} data-dir={r.dir} aria-hidden />
                  {r.label}
                </span>
                <span className={styles.moversDelta} data-dir={r.dir}>{fmtPct(r.changePct)} <em>{r.horizon}</em></span>
                <span className={styles.moversCi}>[{r.ciLoPct.toFixed(0)}, {r.ciHiPct.toFixed(0)}]</span>
                <span className={styles.moversSpark}><Sparkline data={r.series.slice(-24)} dir={r.dir} /></span>
                <span className={styles.moversN}>{fmtInt(r.n)}</span>
              </m.button>
            ))}
          </m.div>
        </div>
        {foot}
      </div>
    </LazyMotion>
  );
}
