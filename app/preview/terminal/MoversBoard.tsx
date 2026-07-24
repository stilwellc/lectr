'use client';

import { useMemo, useState } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { MarketData } from '../../hooks/useRayData';
import { MARKETS, type Market } from '../../constants';
import Sparkline from './Sparkline';
import { fmtDelta, fmtInt, useInView, useReducedMotion } from './hooks';
import styles from './style.module.css';

/* ============================================================
   THE MOVERS BOARD — the Terminal's per-market index grid,
   but every row is a MARKET SWITCH: clicking a vertical calls
   setMarket(key), re-scoping the whole page in place (the hero,
   ledger, feed, record band all re-read). The active market is
   marked. Kaito grammar: mono rows, a tinted Δ, a sparkline,
   a timeframe toggle over the quarterly cohort index.
   ============================================================ */

const EASE = [0.23, 1, 0.32, 1] as const;

const FRAMES = [
  { key: 'Q', label: '1Q', back: 1 },
  { key: '2Q', label: '2Q', back: 2 },
  { key: 'Y', label: '1Y', back: 4 },
  { key: 'MAX', label: 'MAX', back: Infinity },
] as const;
type FrameKey = (typeof FRAMES)[number]['key'];

interface Row {
  key: Market;
  label: string;
  last: number;
  delta: number;
  n: number;
  spark: number[];
  dir: 'up' | 'down' | 'flat';
}

interface Props {
  market: MarketData | null;
  activeKey: Market;
  onSelect: (key: Market) => void;
  /** mobile = 2-up cards; desktop = table */
  variant?: 'desktop' | 'mobile';
}

export default function MoversBoard({ market, activeKey, onSelect, variant = 'desktop' }: Props) {
  const reduce = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>();
  const [frame, setFrame] = useState<FrameKey>('Y');
  const back = FRAMES.find((f) => f.key === frame)!.back;

  const rows = useMemo<Row[]>(() => {
    if (!market?.markets) return [];
    const out: Row[] = [];
    for (const mk of MARKETS) {
      if (mk.key === 'all') continue; // 'all' is the hero index above
      const series = market.markets[mk.key];
      if (!series?.index?.length) continue;
      const vals = series.index.map((p) => p.value);
      const last = vals[vals.length - 1];
      const refIdx = back === Infinity ? 0 : Math.max(0, vals.length - 1 - back);
      const refVal = vals[refIdx];
      const delta = refVal ? ((last - refVal) / refVal) * 100 : 0;
      out.push({
        key: mk.key,
        label: mk.label,
        last,
        delta,
        n: series.n,
        spark: vals.slice(-10),
        dir: delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat',
      });
    }
    return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [market, back]);

  if (!rows.length) return null;

  const container = { hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.04 } } };
  const rowV = {
    hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
  };

  const head = (
    <div className={styles.moversHead}>
      <div>
        <span className={styles.sectionKicker}>Top Movers · switch the board</span>
        <h2 className={styles.moversTitle}>Every vertical, one board.</h2>
      </div>
      <div className={styles.frameToggle} role="tablist" aria-label="Timeframe">
        {FRAMES.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={frame === f.key}
            className={styles.frameBtn}
            data-active={frame === f.key}
            onClick={() => setFrame(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (variant === 'mobile') {
    return (
      <div ref={ref}>
        {head}
        <div className={styles.mobMoverList}>
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              className={styles.mobMoverCard}
              data-active={r.key === activeKey}
              onClick={() => onSelect(r.key)}
              aria-label={`Switch to ${r.label}`}
            >
              <div className={styles.mobMoverTop}>
                <span className={styles.mobMoverName}>
                  <span className={styles.moversTick} data-dir={r.dir} aria-hidden />
                  {r.label}
                </span>
                <span className={styles.moversDelta} data-dir={r.dir}>{fmtDelta(r.delta)}</span>
              </div>
              <div className={styles.mobMoverBot}>
                <span className={styles.mobMoverIndex}>{r.last.toFixed(0)}</span>
                <Sparkline data={r.spark} dir={r.dir} width={110} height={30} />
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <LazyMotion features={domAnimation} strict>
      <div className={styles.movers} ref={ref}>
        {head}
        <div className={styles.moversTable} role="table">
          <div className={styles.moversColHead} role="row">
            <span role="columnheader">Vertical</span>
            <span role="columnheader" className={styles.right}>Index</span>
            <span role="columnheader" className={styles.right}>Δ</span>
            <span role="columnheader" className={styles.moversTrendHead}>Trend</span>
            <span role="columnheader" className={styles.right}>Lots</span>
          </div>
          <m.div variants={container} initial="hidden" animate={seen ? 'show' : 'hidden'}>
            {rows.map((r) => (
              <m.button
                key={r.key}
                type="button"
                className={styles.moversRow}
                data-active={r.key === activeKey}
                variants={rowV}
                onClick={() => onSelect(r.key)}
                aria-label={`Switch the board to ${r.label}`}
                aria-current={r.key === activeKey ? 'true' : undefined}
              >
                <span className={styles.moversName}>
                  <span className={styles.moversTick} data-dir={r.dir} aria-hidden />
                  {r.label}
                </span>
                <span className={styles.moversIndex}>{r.last.toFixed(0)}</span>
                <span className={styles.moversDelta} data-dir={r.dir}>{fmtDelta(r.delta)}</span>
                <span className={styles.moversSpark}><Sparkline data={r.spark} dir={r.dir} /></span>
                <span className={styles.moversN}>{fmtInt(r.n)}</span>
              </m.button>
            ))}
          </m.div>
        </div>
        <p className={styles.moversFoot}>
          Like-for-like cohort index · rebased to 100 · smoothed. Tap a vertical to re-scope the board.
        </p>
      </div>
    </LazyMotion>
  );
}
