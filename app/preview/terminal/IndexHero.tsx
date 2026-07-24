'use client';

import { useMemo } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { MarketData, DemandPoint, RealizedByMarket } from '../../hooks/useRayData';
import type { RealizedPoint } from '../../types';
import type { Market } from '../../constants';
import RollingNumber from './RollingNumber';
import MarketChart, { type IndexPoint } from './MarketChart';
import Sparkline from './Sparkline';
import { fmtDelta, fmtInt, useReducedMotion } from './hooks';
import styles from './style.module.css';

/* ============================================================
   THE MARKET-SCOPED INDEX HERO — the Terminal's winning hero,
   rewired to read the ACTIVE market rather than a hardwired
   markets.all. It reads, in order of preference:
     1. market.markets[activeKey].index  (the dollar-normalized
        cohort index, rebased 100 — the majors + all)
     2. the demand[activeKey] %-over-estimate curve
     3. sports/science realized-cohort median ($) — the same
        BoardDemand fallback (Goldin publishes no estimates)
   Whatever series it lands on drives the big glyph, the Q/Y
   deltas, and the MarketChart draw-in. Market-scoped end to end.
   ============================================================ */

const EASE = [0.23, 1, 0.32, 1] as const;

interface Props {
  activeKey: Market;
  marketLabel: string;
  market: MarketData | null;
  demand: DemandPoint[] | undefined;
  realized: RealizedByMarket;
  /** honest full-corpus totals for the thesis line */
  totalLots: number;
  totalSold: number;
  houses: number;
  /** below-market signal count in the current live book (scoped) */
  belowMkt: number;
  /** the market's below-market lens — the flagged figure opens the feed */
  onOpenBelow: () => void;
  /** wire the dead ⌘K to the real palette */
  onCommand: () => void;
  /** the appreciation read, if the market has one */
  appreciation: number | null;
  /** sell-through, when the scoped market series carries it */
  play: boolean;
}

// Resolve the hero series for the active market. Returns index points
// (period/value/n) for MarketChart, plus a unit + kicker describing what it is.
function useHeroSeries(
  activeKey: Market,
  market: MarketData | null,
  demand: DemandPoint[] | undefined,
  realized: RealizedByMarket,
) {
  return useMemo(() => {
    // 1 — the dollar-normalized cohort index (rebased 100)
    const series = market?.markets?.[activeKey];
    if (series?.index?.length && series.index.length >= 4) {
      const idx: IndexPoint[] = series.index.map((p) => ({ period: p.period, value: p.value, n: p.n }));
      const sell = series.sellThrough?.length
        ? series.sellThrough[series.sellThrough.length - 1].value
        : null;
      return {
        idx,
        kicker: `lectr market index · ${activeKey === 'all' ? 'total collectibles' : series.label.toLowerCase()}`,
        chartTag: 'rebased 100 · smoothed',
        unit: 'index' as const,
        sellThrough: sell,
      };
    }
    // 2 — the %-over-estimate demand curve (majors without a rebased index)
    if (demand && demand.length >= 4) {
      const idx: IndexPoint[] = demand.map((p) => ({ period: p.date.slice(0, 7), value: p.value, n: p.n }));
      return {
        idx,
        kicker: `demand index · ${activeKey === 'all' ? 'total collectibles' : activeKey}`,
        chartTag: 'sale vs estimate · trailing',
        unit: 'demand' as const,
        sellThrough: null,
      };
    }
    // 3 — sports/science realized-cohort median ($) — no estimates published
    const rz = (realized[activeKey] as RealizedPoint[] | undefined) || [];
    if (rz.length >= 4) {
      const idx: IndexPoint[] = rz.map((p) => ({ period: p.date.slice(0, 7), value: p.value, n: p.n }));
      return {
        idx,
        kicker: `realized median · ${activeKey}`,
        chartTag: 'like-for-like cohort · $ median',
        unit: 'realized' as const,
        sellThrough: null,
      };
    }
    return { idx: [] as IndexPoint[], kicker: `lectr market index · ${activeKey}`, chartTag: '', unit: 'index' as const, sellThrough: null };
  }, [activeKey, market, demand, realized]);
}

export default function IndexHero({
  activeKey,
  marketLabel,
  market,
  demand,
  realized,
  totalLots,
  belowMkt,
  onOpenBelow,
  onCommand,
  appreciation,
  play,
}: Props) {
  const reduce = useReducedMotion();
  const hero = useHeroSeries(activeKey, market, demand, realized);
  const vals = hero.idx.map((p) => p.value);
  const level = vals.length ? vals[vals.length - 1] : 100;
  const prev = vals.length > 1 ? vals[vals.length - 2] : level;
  const yrAgo = vals.length > 4 ? vals[vals.length - 5] : vals[0] ?? level;
  const dQ = prev ? ((level - prev) / prev) * 100 : 0;
  const dY = yrAgo ? ((level - yrAgo) / yrAgo) * 100 : 0;
  const spark = vals.slice(-12);

  // format the glyph by unit: index/demand read as a level; realized as $ compact
  const fmtLevel = (n: number) =>
    hero.unit === 'realized'
      ? n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${Math.round(n)}`
      : n.toFixed(1);

  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 16, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.6, ease: EASE, delay: reduce ? 0 : delay },
  });

  const hasChart = hero.idx.length >= 4;

  return (
    <LazyMotion features={domAnimation} strict>
      <section className={styles.hero}>
        {/* HEAD — kicker + the number. On mobile this leads, then the chart, then
            the meta row: number → chart → data, never a wall of prose. */}
        <m.div className={styles.heroHead} {...rise(0.05)}>
          <span className={styles.sectionKicker}>{hero.kicker}</span>
          <div className={styles.heroNumberRow}>
            <RollingNumber
              className={styles.heroNumber}
              value={level}
              from={reduce || hero.unit === 'realized' ? level : Math.max(0, level - 22)}
              format={fmtLevel}
              duration={1500}
              delay={220}
              play={play}
            />
            <div className={styles.heroDeltas}>
              <span className={styles.heroDelta} data-dir={dQ >= 0 ? 'up' : 'down'}>
                {fmtDelta(dQ)} <em>quarter</em>
              </span>
              <span className={styles.heroDelta} data-dir={dY >= 0 ? 'up' : 'down'}>
                {fmtDelta(dY)} <em>year</em>
              </span>
            </div>
          </div>
        </m.div>

        {/* CHART — the value prop, right under the number */}
        <m.div className={styles.heroChart} {...rise(0.12)}>
          <div className={styles.chartCard}>
            <div className={styles.chartCardHead}>
              <span>{activeKey === 'all' ? 'Index · quarterly cohort' : `${marketLabel} · quarterly cohort`}</span>
              <span className={styles.chartCardTag}>{hero.chartTag}</span>
            </div>
            {hasChart ? (
              <MarketChart data={hero.idx} play={play} height={300} />
            ) : (
              <div className={styles.heroSparkFallback}>
                <Sparkline data={spark.length >= 2 ? spark : [level, level]} dir={dY >= 0 ? 'up' : 'down'} width={420} height={120} strokeWidth={1.8} />
                <span className={styles.chartCardTag}>series building — sampling this market</span>
              </div>
            )}
          </div>
        </m.div>

        {/* META — the three read-outs + ⌘K. No prose. */}
        <m.div className={styles.heroMeta} {...rise(0.18)}>
          <div className={styles.heroStats}>
            <Stat
              label="Sell-through"
              value={hero.sellThrough != null ? `${hero.sellThrough}%` : '—'}
            />
            <Stat
              label="Appreciation"
              value={appreciation != null ? `${appreciation >= 0 ? '+' : ''}${appreciation.toFixed(1)}%` : '—'}
            />
            <Stat
              label="Below-market now"
              value={belowMkt ? fmtInt(belowMkt) : '—'}
              accent
              onClick={belowMkt ? onOpenBelow : undefined}
            />
          </div>
          <button type="button" className={styles.cmdPill} onClick={onCommand}>
            <kbd className={styles.kbd}>⌘</kbd>
            <kbd className={styles.kbd}>K</kbd>
            <span className={styles.cmdLabel}>Search {fmtInt(totalLots)} lots</span>
            <span className={styles.cmdArrow} aria-hidden>↵</span>
          </button>
        </m.div>
      </section>
    </LazyMotion>
  );
}

function Stat({ label, value, accent, onClick }: { label: string; value: string; accent?: boolean; onClick?: () => void }) {
  const content = (
    <>
      <span className={styles.statVal}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={styles.statBtn} data-accent={accent ? 'true' : undefined} onClick={onClick} aria-label={`${label}: ${value} — see flagged lots`}>
        {content}
      </button>
    );
  }
  return (
    <span className={styles.stat} data-accent={accent ? 'true' : undefined}>
      {content}
    </span>
  );
}
