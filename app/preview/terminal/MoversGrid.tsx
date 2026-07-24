'use client';

import { useMemo, useState } from 'react';
import { m } from 'framer-motion';
import type { MarketData } from '../../hooks/useRayData';
import { MARKETS } from '../../constants';
import Sparkline from './Sparkline';
import { fmtDelta, fmtInt, useInView, useReducedMotion } from './hooks';
import styles from './style.module.css';

/* ============================================================
   THE MOVERS GRID — Kaito grammar. Mono rows, a Δ column tinted
   up/down only, a sparkline per row, timeframe toggles. Built
   entirely from market.json's per-market cohort index series
   (dollar-normalized, rebased to 100). The toggle re-reads the
   lookback window over the quarterly index — labeled honestly.
   ============================================================ */

const EASE = [0.23, 1, 0.32, 1] as const;

// Quarterly series → these are the honest lookbacks the eager data supports.
const FRAMES = [
  { key: 'Q', label: '1Q', back: 1 },
  { key: '2Q', label: '2Q', back: 2 },
  { key: 'Y', label: '1Y', back: 4 },
  { key: 'MAX', label: 'MAX', back: Infinity },
] as const;
type FrameKey = (typeof FRAMES)[number]['key'];

interface Row {
  key: string;
  label: string;
  last: number;
  delta: number; // % change over the selected window
  n: number;
  spark: number[];
  dir: 'up' | 'down' | 'flat';
}

interface Props {
  market: MarketData | null;
}

export default function MoversGrid({ market }: Props) {
  const reduce = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>();
  const [frame, setFrame] = useState<FrameKey>('Y');

  const back = FRAMES.find((f) => f.key === frame)!.back;

  const rows = useMemo<Row[]>(() => {
    if (!market?.markets) return [];
    const out: Row[] = [];
    for (const mk of MARKETS) {
      if (mk.key === 'all') continue; // 'all' is the hero index, shown above
      const series = market.markets[mk.key];
      if (!series?.index?.length) continue;
      const idx = series.index;
      const vals = idx.map((p) => p.value);
      const last = vals[vals.length - 1];
      const refIdx =
        back === Infinity ? 0 : Math.max(0, vals.length - 1 - back);
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
    // biggest absolute movers first — the "top movers" read
    return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [market, back]);

  if (!rows.length) return null;

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.04 } },
  };
  const rowV = {
    hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
  };

  return (
    <div className={styles.movers} ref={ref}>
      <div className={styles.moversHead}>
        <div>
          <span className={styles.sectionKicker}>Top Movers</span>
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

      <div className={styles.moversTable} role="table">
        <div className={styles.moversColHead} role="row">
          <span role="columnheader">Vertical</span>
          <span role="columnheader" className={styles.right}>
            Index
          </span>
          <span role="columnheader" className={styles.right}>
            Δ
          </span>
          <span role="columnheader" className={styles.moversTrendHead}>
            Trend
          </span>
          <span role="columnheader" className={styles.right}>
            Lots
          </span>
        </div>
        <m.div variants={container} initial="hidden" animate={seen ? 'show' : 'hidden'}>
          {rows.map((r) => (
            <m.div key={r.key} className={styles.moversRow} variants={rowV} role="row">
              <span className={styles.moversName} role="cell">
                <span className={styles.moversTick} data-dir={r.dir} aria-hidden />
                {r.label}
              </span>
              <span className={styles.moversIndex} role="cell">
                {r.last.toFixed(0)}
              </span>
              <span className={styles.moversDelta} data-dir={r.dir} role="cell">
                {fmtDelta(r.delta)}
              </span>
              <span className={styles.moversSpark} role="cell">
                <Sparkline data={r.spark} dir={r.dir} />
              </span>
              <span className={styles.moversN} role="cell">
                {fmtInt(r.n)}
              </span>
            </m.div>
          ))}
        </m.div>
      </div>
      <p className={styles.moversFoot}>
        Like-for-like cohort index · rebased to 100 · smoothed. Δ = change over selected window.
      </p>
    </div>
  );
}
