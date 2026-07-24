'use client';

import { useMemo, useState } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { MarketData, DemandPoint, RealizedByMarket } from '../../hooks/useRayData';
import type { RealizedPoint } from '../../types';
import type { Market } from '../../constants';
import RollingNumber from './RollingNumber';
import MarketChart, { type IndexPoint } from './MarketChart';
import Sparkline from './Sparkline';
import { fmtDelta, fmtInt, fmtMoneyCompact, useReducedMotion } from './hooks';
import { verifiedMovers, fmtPct, type VerifiedMover } from './verified';
import styles from './style.module.css';

/* ============================================================
   THE MARKET-SCOPED INDEX HERO. The honest engine will NOT
   stand behind a market-level return (the pooled index abstains
   when a quarter can't hold quality constant), so the hero leads
   with DEMAND — the median amount lots beat their estimates over
   the window, a real measured quantity — never a fabricated
   appreciation number. Beneath it, the VERIFIED MOVERS: the only
   makers whose price movement clears the 95% confidence bar.
     1. demand[market]  (%-over-estimate, quarterly) — the lead
     2. realized[market] ($ median) — sports, which has no estimates
   The horizon toggle scopes the window; the chart draws the same
   series. Market-scoped end to end.
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

const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Resolve the hero series for the active market — DEMAND first (measured,
// defensible), then the realized-cohort median for markets without estimates.
// Returns index points (period/value/n) for the chart + a unit describing them.
function useHeroSeries(
  activeKey: Market,
  demand: DemandPoint[] | undefined,
  realized: RealizedByMarket,
) {
  return useMemo(() => {
    // 1 — the %-over-estimate demand curve (the honest market-heat read)
    if (demand && demand.length >= 4) {
      const idx: IndexPoint[] = demand.map((p) => ({ period: p.date, value: p.value, n: p.n }));
      return {
        idx,
        kicker: activeKey === 'all' ? 'The collectibles market' : `The ${activeKey} market`,
        explain: 'how much lots beat their estimates',
        unit: 'demand' as const,
      };
    }
    // 2 — realized-cohort median ($) — sports (Goldin publishes no estimates)
    const rz = (realized[activeKey] as RealizedPoint[] | undefined) || [];
    if (rz.length >= 4) {
      const idx: IndexPoint[] = rz.map((p) => ({ period: p.date, value: p.value, n: p.n }));
      return {
        idx,
        kicker: `The ${activeKey} market`,
        explain: 'typical price paid at hammer',
        unit: 'realized' as const,
      };
    }
    return { idx: [] as IndexPoint[], kicker: `The ${activeKey} market`, explain: '', unit: 'demand' as const };
  }, [activeKey, demand, realized]);
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
  const hero = useHeroSeries(activeKey, demand, realized);
  const vals = hero.idx.map((p) => p.value);
  const level = vals.length ? vals[vals.length - 1] : 0;
  const isMoney = hero.unit === 'realized';

  // ── the metric over a selectable horizon. Demand/realized are LEVELS, not
  // returns — the headline is the median reading across the window, and the
  // toggle scopes both that median and the chart. No compounding, no fake ROI.
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
  const windowVals = horizon.q === Infinity ? vals : vals.slice(startI);
  const headline = median(windowVals.length ? windowVals : vals);
  const windowIdx = horizon.q === Infinity ? hero.idx : hero.idx.slice(startI);
  const spark = (horizon.q === Infinity ? vals : vals.slice(startI)).slice(-16);

  // momentum — the most recent quarter-over-quarter shift in the reading
  const qMove = vals.length > 1 && vals[vals.length - 2]
    ? ((level - vals[vals.length - 2]) / vals[vals.length - 2]) * 100
    : 0;
  const trendDir = qMove >= 0 ? 'up' : 'down';

  const fmtHeadline = (n: number) => (isMoney ? fmtMoneyCompact(n) : fmtPct(n));
  const metricLabel = isMoney ? 'typical price' : 'demand';

  // the verified movers scoped to this market — the only defensible price moves
  const movers = useMemo(() => verifiedMovers(market, activeKey), [market, activeKey]);

  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 16, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.6, ease: EASE, delay: reduce ? 0 : delay },
  });

  const hasChart = hero.idx.length >= 4;

  // ── MOBILE: its own scene — a compact "index card" (a premium trading-app
  // asset tile), NOT the desktop slab scaled down.
  if (isMobile) {
    return (
      <LazyMotion features={domAnimation} strict>
        <section className={styles.mHero}>
          <m.div className={styles.mHeroCard} {...rise(0.04)}>
            <div className={styles.mHeroHead}>
              <span className={styles.mHeroLabel}>{hero.kicker}</span>
              <span className={styles.mHeroReturnTag}>{metricLabel}</span>
            </div>
            <div className={styles.mHeroNumRow}>
              <RollingNumber
                className={`${styles.mHeroNum} ${styles.roiNeutral}`}
                value={headline}
                from={reduce ? headline : 0}
                format={fmtHeadline}
                duration={1300}
                delay={200}
                play={play}
              />
              <span className={styles.mHeroReturnPer}>{horizon.label}</span>
            </div>
            <div className={styles.tfToggle} role="tablist" aria-label="Window">
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
                <Sparkline data={spark.length >= 2 ? spark : [level, level]} dir={trendDir} width={360} height={90} strokeWidth={1.8} />
              )}
            </div>
            <div className={styles.mHeroTag}>{hero.explain} · {horizon.label}</div>
          </m.div>

          <m.div className={styles.mHeroStats} {...rise(0.12)}>
            <span className={styles.mStat}>
              <span className={styles.mStatVal} data-dir={trendDir}>{fmtDelta(qMove)}</span>
              <span className={styles.mStatLabel}>Last quarter</span>
            </span>
            <span className={styles.mStat}>
              <span className={styles.mStatVal}>{fmtInt(vals.length ? hero.idx[hero.idx.length - 1].n : 0)}</span>
              <span className={styles.mStatLabel}>Lots read</span>
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

          <VerifiedStrip movers={movers} activeKey={activeKey} compact />

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
        {/* HEAD — kicker + the honest headline reading */}
        <m.div className={styles.heroHead} {...rise(0.05)}>
          <div className={styles.heroTopRow}>
            <span className={styles.sectionKicker}>{hero.kicker}</span>
            <span className={styles.heroReturnTag}>{metricLabel}</span>
          </div>
          <div className={styles.heroNumberRow}>
            <RollingNumber
              className={`${styles.heroNumber} ${styles.roiNeutral}`}
              value={headline}
              from={reduce ? headline : 0}
              format={fmtHeadline}
              duration={1500}
              delay={220}
              play={play}
            />
            <span className={styles.heroReturnPer}>{horizon.label}</span>
          </div>
          <div className={styles.heroExplainLine}>{hero.explain}</div>
          <div className={styles.tfToggle} role="tablist" aria-label="Window">
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
              <span>{metricLabel} · {horizon.label}</span>
              <span className={styles.chartCardTag}>{marketLabel.toLowerCase()}</span>
            </div>
            {hasChart ? (
              <MarketChart data={windowIdx} play={play} height={300} />
            ) : (
              <div className={styles.heroSparkFallback}>
                <Sparkline data={spark.length >= 2 ? spark : [level, level]} dir={trendDir} width={420} height={120} strokeWidth={1.8} />
                <span className={styles.chartCardTag}>series building — sampling this market</span>
              </div>
            )}
          </div>
        </m.div>

        {/* META — read-outs + verified movers + ⌘K */}
        <m.div className={styles.heroMeta} {...rise(0.18)}>
          <div className={styles.heroStats}>
            <Stat label="Last quarter" value={fmtDelta(qMove)} dir={trendDir} />
            <Stat
              label="Lots read"
              value={fmtInt(vals.length ? hero.idx[hero.idx.length - 1].n : 0)}
            />
            <Stat
              label="Below-market now"
              value={belowMkt ? fmtInt(belowMkt) : '—'}
              accent
              onClick={belowMkt ? onOpenBelow : undefined}
            />
          </div>
          <VerifiedStrip movers={movers} activeKey={activeKey} />
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

/* The verified movers — the only price-movement reads that clear the 95%
   confidence bar. Where a market has none yet, we say so plainly rather than
   dress up a number the engine won't back. */
function VerifiedStrip({ movers, activeKey, compact }: { movers: VerifiedMover[]; activeKey: Market; compact?: boolean }) {
  if (!movers.length) {
    return (
      <div className={styles.verifiedEmpty}>
        <span className={styles.verifiedEmptyDot} aria-hidden />
        No maker in {activeKey === 'all' ? 'the market' : `${activeKey}`} clears the 95%-confidence bar yet — we only print a move the data resolves.
      </div>
    );
  }
  return (
    <div className={styles.verifiedStrip}>
      <div className={styles.verifiedHead}>
        <span>Verified movers</span>
        <span>price movement · 95% confidence</span>
      </div>
      <div className={styles.verifiedRows}>
        {movers.slice(0, compact ? 3 : 5).map((mv) => (
          <div key={mv.slug} className={styles.verifiedRow} data-dir={mv.dir}>
            <span className={styles.verifiedName}>{mv.label}</span>
            <span className={styles.verifiedChg} data-dir={mv.dir}>
              {fmtPct(mv.changePct)} <em>{mv.horizon}</em>
            </span>
            <span className={styles.verifiedCi}>[{mv.ciLoPct.toFixed(0)}, {mv.ciHiPct.toFixed(0)}]</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, accent, dir, onClick }: { label: string; value: string; accent?: boolean; dir?: 'up' | 'down'; onClick?: () => void }) {
  const content = (
    <>
      <span className={styles.statVal} data-dir={dir}>{value}</span>
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
