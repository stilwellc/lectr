'use client';

import { useMemo, useState } from 'react';
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

type TfKey = '1Y' | '3Y' | '5Y' | 'MAX';

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
  /** mobile gets its OWN hero composition — not the desktop scaled down */
  isMobile?: boolean;
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
        kicker: activeKey === 'all' ? 'The collectibles market' : `The ${series.label.toLowerCase()} market`,
        explain: '100 = its long-run average price',
        unit: 'index' as const,
        sellThrough: sell,
      };
    }
    // 2 — the %-over-estimate demand curve (majors without a rebased index)
    if (demand && demand.length >= 4) {
      const idx: IndexPoint[] = demand.map((p) => ({ period: p.date.slice(0, 7), value: p.value, n: p.n }));
      return {
        idx,
        kicker: activeKey === 'all' ? 'The collectibles market' : `The ${activeKey} market`,
        explain: 'how much lots beat their estimates',
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
        kicker: `The ${activeKey} market`,
        explain: 'typical price paid, last 12 months',
        unit: 'realized' as const,
        sellThrough: null,
      };
    }
    return { idx: [] as IndexPoint[], kicker: `The ${activeKey} market`, explain: '', unit: 'index' as const, sellThrough: null };
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
  play,
  isMobile,
}: Props) {
  const reduce = useReducedMotion();
  const hero = useHeroSeries(activeKey, market, demand, realized);
  const vals = hero.idx.map((p) => p.value);
  const level = vals.length ? vals[vals.length - 1] : 100;

  // ── RATE OF RETURN over a selectable horizon — the intuitive read. Collectors
  // think in returns + momentum, not index points. "Return" = the market's price
  // movement from the start of the window to now.
  const HORIZONS: { key: TfKey; label: string; q: number }[] = [
    { key: '1Y', label: 'past year', q: 4 },
    { key: '3Y', label: 'past 3 years', q: 12 },
    { key: '5Y', label: 'past 5 years', q: 20 },
    { key: 'MAX', label: 'all time', q: Infinity },
  ];
  const avail = HORIZONS.filter((t) => (t.q === Infinity ? vals.length >= 6 : vals.length > t.q));
  const [tf, setTf] = useState<TfKey>('1Y');
  const horizon = avail.find((t) => t.key === tf) || avail[avail.length - 1] || HORIZONS[0];
  const startI = horizon.q === Infinity ? 0 : Math.max(0, vals.length - 1 - horizon.q);
  const startVal = vals[startI] ?? vals[0] ?? level;
  const roi = startVal ? (level / startVal - 1) * 100 : 0;
  const dir = roi >= 0 ? 'up' : 'down';
  const windowIdx = horizon.q === Infinity ? hero.idx : hero.idx.slice(startI);
  const spark = (horizon.q === Infinity ? vals : vals.slice(startI)).slice(-16);

  // momentum — the most recent quarter-over-quarter move (price movement / demand)
  const qMove = vals.length > 1 && vals[vals.length - 2]
    ? ((level - vals[vals.length - 2]) / vals[vals.length - 2]) * 100
    : 0;

  const fmtRoi = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 16, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.6, ease: EASE, delay: reduce ? 0 : delay },
  });

  const hasChart = hero.idx.length >= 4;

  // ── MOBILE: its own scene — a compact "index card" (a premium trading-app
  // asset tile), NOT the desktop slab scaled down. Refined number with the
  // deltas inline, and the CHART is the hero visual, full-width in the card.
  if (isMobile) {
    return (
      <LazyMotion features={domAnimation} strict>
        <section className={styles.mHero}>
          <m.div className={styles.mHeroCard} {...rise(0.04)}>
            <div className={styles.mHeroHead}>
              <span className={styles.mHeroLabel}>{hero.kicker}</span>
              <span className={styles.mHeroReturnTag}>total return</span>
            </div>
            <div className={styles.mHeroNumRow}>
              <RollingNumber
                className={`${styles.mHeroNum} ${dir === 'up' ? styles.roiUp : styles.roiDown}`}
                value={roi}
                from={reduce ? roi : 0}
                format={fmtRoi}
                duration={1300}
                delay={200}
                play={play}
              />
              <span className={styles.mHeroReturnPer}>{horizon.label}</span>
            </div>
            <div className={styles.tfToggle} role="tablist" aria-label="Return horizon">
              {avail.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={t.key === horizon.key}
                  className={styles.tfChip} data-on={t.key === horizon.key ? 'true' : undefined}
                  onClick={() => setTf(t.key)}>{t.key === 'MAX' ? 'ALL' : t.key}</button>
              ))}
            </div>
            <div className={styles.mHeroChart}>
              {hasChart ? (
                <MarketChart data={windowIdx} play={play} height={168} compact />
              ) : (
                <Sparkline data={spark.length >= 2 ? spark : [level, level]} dir={dir} width={360} height={90} strokeWidth={1.8} />
              )}
            </div>
            <div className={styles.mHeroTag}>price movement · {horizon.label}</div>
          </m.div>

          <m.div className={styles.mHeroStats} {...rise(0.12)}>
            <span className={styles.mStat}>
              <span className={styles.mStatVal} data-dir={qMove >= 0 ? 'up' : 'down'}>{fmtDelta(qMove)}</span>
              <span className={styles.mStatLabel}>Last quarter</span>
            </span>
            <span className={styles.mStat}>
              <span className={styles.mStatVal}>{hero.sellThrough != null ? `${hero.sellThrough}%` : '—'}</span>
              <span className={styles.mStatLabel}>Sell-through</span>
            </span>
            {belowMkt ? (
              <button type="button" className={styles.mStat} data-accent="true" onClick={onOpenBelow} aria-label={`${belowMkt} below-market lots — see them`}>
                <span className={styles.mStatVal}>{fmtInt(belowMkt)}</span>
                <span className={styles.mStatLabel}>Below market ↗</span>
              </button>
            ) : (
              <span className={styles.mStat}>
                <span className={styles.mStatVal}>—</span>
                <span className={styles.mStatLabel}>Below market</span>
              </span>
            )}
          </m.div>

          <button type="button" className={styles.cmdPillFull} onClick={onCommand}>
            <kbd className={styles.kbd}>⌘K</kbd>
            <span className={styles.cmdLabel}>Search {fmtInt(totalLots)} lots</span>
            <span className={styles.cmdArrow} aria-hidden>↵</span>
          </button>
        </section>
      </LazyMotion>
    );
  }

  return (
    <LazyMotion features={domAnimation} strict>
      <section className={styles.hero}>
        {/* HEAD — kicker + the number. On mobile this leads, then the chart, then
            the meta row: number → chart → data, never a wall of prose. */}
        <m.div className={styles.heroHead} {...rise(0.05)}>
          <div className={styles.heroTopRow}>
            <span className={styles.sectionKicker}>{hero.kicker}</span>
            <span className={styles.heroReturnTag}>total return</span>
          </div>
          <div className={styles.heroNumberRow}>
            <RollingNumber
              className={`${styles.heroNumber} ${dir === 'up' ? styles.roiUp : styles.roiDown}`}
              value={roi}
              from={reduce ? roi : 0}
              format={fmtRoi}
              duration={1500}
              delay={220}
              play={play}
            />
            <span className={styles.heroReturnPer}>{horizon.label}</span>
          </div>
          <div className={styles.tfToggle} role="tablist" aria-label="Return horizon">
            {avail.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={t.key === horizon.key}
                className={styles.tfChip} data-on={t.key === horizon.key ? 'true' : undefined}
                onClick={() => setTf(t.key)}>{t.key === 'MAX' ? 'ALL' : t.key}</button>
            ))}
          </div>
        </m.div>

        {/* CHART — the value prop, right under the number */}
        <m.div className={styles.heroChart} {...rise(0.12)}>
          <div className={styles.chartCard}>
            <div className={styles.chartCardHead}>
              <span>price movement · {horizon.label}</span>
              <span className={styles.chartCardTag}>{marketLabel.toLowerCase()}</span>
            </div>
            {hasChart ? (
              <MarketChart data={windowIdx} play={play} height={300} />
            ) : (
              <div className={styles.heroSparkFallback}>
                <Sparkline data={spark.length >= 2 ? spark : [level, level]} dir={dir} width={420} height={120} strokeWidth={1.8} />
                <span className={styles.chartCardTag}>series building — sampling this market</span>
              </div>
            )}
          </div>
        </m.div>

        {/* META — the three read-outs + ⌘K. No prose. */}
        <m.div className={styles.heroMeta} {...rise(0.18)}>
          <div className={styles.heroStats}>
            <Stat label="Last quarter" value={fmtDelta(qMove)} />
            <Stat
              label="Sell-through"
              value={hero.sellThrough != null ? `${hero.sellThrough}%` : '—'}
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
