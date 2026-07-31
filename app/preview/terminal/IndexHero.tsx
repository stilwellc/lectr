'use client';

import { useEffect, useMemo, useState } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { MarketData, DemandPoint, RealizedByMarket } from '../../hooks/useRayData';
import type { RealizedPoint, BidCompetitionPoint } from '../../types';
import type { Market } from '../../constants';
import RollingNumber from './RollingNumber';
import MarketChart, { LayerPane, type IndexPoint, type ChartLayer } from './MarketChart';
import { resolveHeroLayers, type HeroLayer } from '../../lib/heroLayers';
import Sparkline from './Sparkline';
import { fmtInt, fmtMoneyCompact, useReducedMotion } from './hooks';
import { verifiedMovers, fmtPct, type VerifiedMover } from './verified';
import type { SubMarketRead } from '../../hooks/useRayData';
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

   BID-COMPETITION READ (sports/cards): Goldin publishes no estimate, so cards
   get no %-over-estimate demand — but every lot carries bidCount, a genuine
   demand primitive. bidComp[market] (median bids/lot, quarterly) surfaces in
   the rail as an ADDITIONAL, distinctly-labelled read ("Bid competition · N
   bids/lot") — never as a % move or a price. It rides ALONGSIDE the headline
   (which stays the realized-$ cohort median for sports) and never masquerades
   as the CI'd repeat-sale index.
   ============================================================ */

const EASE = [0.23, 1, 0.32, 1] as const;

type TfKey = '1Y' | '3Y' | '5Y' | 'MAX';

interface Props {
  activeKey: Market;
  marketLabel: string;
  market: MarketData | null;
  demand: DemandPoint[] | undefined;
  realized: RealizedByMarket;
  /** bid-competition series (median bids/lot, quarterly) for the scoped market —
      populated for sports/cards only. A DEMAND primitive from Goldin's bidCount,
      surfaced as a distinct rail read, never a % move or a price. */
  bidComp?: BidCompetitionPoint[] | undefined;
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
  /** the appreciation read, if the market has one — the yearly value trend
      that the left tile cross-checks against demand */
  appreciation: number | null;
  /** lots on the block right now in the scoped market */
  onBlock: number;
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
        explain: 'How far lots hammer above their estimates',
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
        explain: 'Typical price paid at hammer',
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
  bidComp,
  totalLots,
  belowMkt,
  appreciation,
  onBlock,
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

  // ── THE LAYERS — the market's curated sub-market lines (heroLayers.ts),
  // sliced to the visible window; index kinds rebase to the window's first
  // value (Δ%), demand plots raw measured %, volume plots counts (subpane).
  const layerDefs = useMemo(() => resolveHeroLayers(activeKey, market), [activeKey, market]);
  const startPeriod = windowIdx.length ? windowIdx[0].period : null;
  const windowLayer = (l: HeroLayer): { chart: ChartLayer; kind: HeroLayer['kind']; last: number } | null => {
    let pts = startPeriod ? l.points.filter((p) => p.period >= startPeriod) : l.points;
    if (pts.length < 2) return null;
    if (l.kind === 'index') {
      const base = pts[0].value;
      if (!(base > 0)) return null;
      pts = pts.map((p) => ({ ...p, value: ((p.value / base) - 1) * 100 }));
    }
    return { chart: { key: l.key, label: l.label, color: l.color, points: pts }, kind: l.kind, last: pts[pts.length - 1].value };
  };
  const mainLayers = layerDefs.main.map(windowLayer).filter((x): x is NonNullable<typeof x> => !!x);
  const subLayers = layerDefs.sub.map(windowLayer).filter((x): x is NonNullable<typeof x> => !!x);
  const [litLayer, setLitLayer] = useState<string | null>(null);
  useEffect(() => { setLitLayer(null); }, [activeKey]);
  const chipFor = (x: { chart: ChartLayer; kind: HeroLayer['kind']; last: number }) => {
    const on = litLayer === x.chart.key;
    const val = x.kind === 'volume' ? `${Math.round(x.last).toLocaleString()}/qtr` : fmtPct(x.last);
    const dir = x.kind === 'volume' ? undefined : x.last >= 0 ? 'up' : 'down';
    return (
      <button
        key={x.chart.key}
        type="button"
        className={styles.layerChip}
        data-on={on ? 'true' : undefined}
        onMouseEnter={() => setLitLayer(x.chart.key)}
        onMouseLeave={() => setLitLayer((cur) => (cur === x.chart.key ? null : cur))}
        onClick={() => setLitLayer((cur) => (cur === x.chart.key ? null : x.chart.key))}
        aria-pressed={on}
      >
        <span className={styles.layerChipDot} style={{ background: x.chart.color }} aria-hidden />
        {x.chart.label}
        <span className={`${styles.layerChipVal}${x.kind === 'volume' ? '' : ` ${styles.pctData}`}`} data-dir={dir}>{val}</span>
      </button>
    );
  };

  // momentum — the most recent quarter-over-quarter shift in the reading
  const qMove = vals.length > 1 && vals[vals.length - 2]
    ? ((level - vals[vals.length - 2]) / vals[vals.length - 2]) * 100
    : 0;
  const trendDir = qMove >= 0 ? 'up' : 'down';

  const fmtHeadline = (n: number) => (isMoney ? fmtMoneyCompact(n) : fmtPct(n));
  const metricLabel = isMoney ? 'typical price' : 'demand';

  // ── ROI × DEMAND cross-check (the left read-out). Demand is a RELATIVE beat
  // (sold over estimate) — it can run hot while houses quietly cut estimates,
  // so it's paired with the absolute value trend (annualized appreciation). When
  // lots are beating ask (demand up) but typical values are falling YoY, the
  // tile raises a flag: the heat is beating a softening bar, not real strength.
  const roi = appreciation;
  const roiDir: 'up' | 'down' | undefined = roi == null ? undefined : roi >= 0 ? 'up' : 'down';
  const demandHot = hero.unit === 'demand' && headline > 0;
  const roiFlag = demandHot && roi != null && roi < -1.5 ? 'beating soft estimates' : undefined;

  // the verified movers scoped to this market — the only defensible price moves
  const movers = useMemo(() => verifiedMovers(market, activeKey), [market, activeKey]);

  // ── BID-COMPETITION read (sports/cards). Goldin publishes no estimate, so the
  // cards vertical has no %-over-estimate demand — but every lot carries a
  // bidCount, a genuine demand primitive (competitive tension). Surface the
  // latest quarter's MEDIAN bids/lot + its quarter-over-quarter trend as a
  // distinct rail read. This is NOT a % move and NOT a price — it's labelled
  // "bids/lot" and can never render through fmtPct/fmtMoneyCompact.
  const bc = useMemo(() => {
    const s = bidComp || [];
    if (s.length < 2) return null; // need at least a level + a prior quarter to trend
    const now = s[s.length - 1].value;
    const prev = s[s.length - 2].value;
    // dir tints the read by its quarter-over-quarter move (rising/falling
    // competition) — never implies price appreciation.
    const dir: 'up' | 'down' | undefined = now === prev ? undefined : now > prev ? 'up' : 'down';
    return { now: Math.round(now), dir };
  }, [bidComp]);

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
              </div>
            <div className={styles.mHeroNumRow}>
              <RollingNumber
                className={`${styles.mHeroNum} ${styles.roiNeutral}${isMoney ? '' : ` ${styles.pctData}`}`}
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
                <MarketChart data={windowIdx} play={play} height={168} compact format={fmtHeadline} isPct={!isMoney} />
              ) : (
                <Sparkline data={spark.length >= 2 ? spark : [level, level]} dir={trendDir} width={360} height={90} strokeWidth={1.8} />
              )}
            </div>
            <div className={styles.mHeroTag}>{hero.explain} · {horizon.label}</div>
          </m.div>

          <m.div className={styles.mHeroStats} {...rise(0.12)}>
            {roi != null && (
              <span className={styles.mStat} title="Sales-weighted annualized value trend across this market's verified repeat comparisons.">
                <span className={`${styles.mStatVal} ${styles.pctData}`} data-dir={roiDir}>{fmtPct(roi)}</span>
                <span className={styles.mStatLabel}>Yearly ROI</span>
              </span>
            )}
            {bc ? (
              <span className={styles.mStat} title="Median bids drawn per sold lot — a demand primitive from Goldin's bid auctions. Not a price move.">
                <span className={styles.mStatVal} data-dir={bc.dir}>{bc.now}</span>
                <span className={styles.mStatLabel}>Bids/lot</span>
              </span>
            ) : (
              <span className={styles.mStat}>
                <span className={styles.mStatVal}>{fmtInt(onBlock)}</span>
                <span className={styles.mStatLabel}>On the block</span>
              </span>
            )}
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

  // ── DESKTOP: "the observatory". The chart is the STAGE, not a widget — a
  // full-width, unboxed landscape under the typography. Type top-left, the
  // side metrics as a hairline ledger RAIL top-right, and the verified movers
  // as a ticker BAND beneath the landscape. One composition, no cards.
  return (
    <LazyMotion features={domAnimation} strict>
      <section className={styles.hero}>
        {/* HEAD — kicker + the honest headline reading */}
        <m.div className={styles.heroHead} {...rise(0.05)}>
          <div className={styles.heroTopRow}>
            <span className={styles.sectionKicker}>{hero.kicker}</span>
          </div>
          <div className={styles.heroNumberRow}>
            <RollingNumber
              className={`${styles.heroNumber} ${styles.roiNeutral}${isMoney ? '' : ` ${styles.pctData}`}`}
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

        {/* RAIL — the side metrics as a right-hand ledger: label · hairline · value */}
        <m.div className={styles.heroRail} {...rise(0.12)}>
          <div className={styles.railRow}>
            <span className={styles.railLabel}>On the block</span>
            <span className={styles.railVal}>{fmtInt(onBlock)}</span>
          </div>
          {roi != null && (
            <div className={styles.railRow} title="Sales-weighted annualized value trend across this market's verified repeat comparisons — the absolute check on demand.">
              <span className={styles.railLabel}>Yearly ROI</span>
              <span className={`${styles.railVal} ${styles.pctData}`} data-dir={roiDir}>{fmtPct(roi)}</span>
            </div>
          )}
          {roiFlag && <div className={styles.railFlagLine}>{roiFlag}</div>}
          {bc && (
            <div className={styles.railRow} title="Median number of bids drawn per sold lot — a demand primitive from Goldin's bid auctions. Not a price move.">
              <span className={styles.railLabel}>Bid competition</span>
              <span className={styles.railVal} data-dir={bc.dir}>{bc.now} bids/lot</span>
            </div>
          )}
          {belowMkt ? (
            <button type="button" className={styles.railBtn} onClick={onOpenBelow}
              aria-label={`${belowMkt} below-market lots — see them`}>
              <span className={styles.railLabel}>Below market now</span>
              <span className={styles.railVal} data-accent="true">{fmtInt(belowMkt)}<em className={styles.railGo} aria-hidden>↗</em></span>
            </button>
          ) : (
            <div className={styles.railRow}>
              <span className={styles.railLabel}>Below market now</span>
              <span className={styles.railVal}>—</span>
            </div>
          )}
          <button type="button" className={styles.railCmd} onClick={onCommand}>
            <kbd className={styles.kbd}>⌘</kbd>
            <kbd className={styles.kbd}>K</kbd>
            <span className={styles.cmdLabel}>Search {fmtInt(totalLots)} lots</span>
            <span className={styles.cmdArrow} aria-hidden>↵</span>
          </button>
        </m.div>

        {/* STAGE — the full-width landscape. No box, no card: the line, its
            directional fill and glow ARE the composition. */}
        <m.div className={styles.heroStage} {...rise(0.16)}>
          <div className={styles.stageMeta}>
            <span>{metricLabel} · {horizon.label}</span>
            <span>{marketLabel.toLowerCase()}</span>
          </div>
          {hasChart ? (
            <MarketChart data={windowIdx} play={play} height={264} format={fmtHeadline} isPct={!isMoney}
              layers={mainLayers.map((x) => x.chart)} highlight={litLayer} />
          ) : (
            <div className={styles.heroSparkFallback}>
              <Sparkline data={spark.length >= 2 ? spark : [level, level]} dir={trendDir} width={720} height={140} strokeWidth={1.8} />
              <span className={styles.chartCardTag}>series building — sampling this market</span>
            </div>
          )}
          {/* the volume/era subpane — series that can't share the anchor's axis */}
          {hasChart && subLayers.length > 0 && (
            <div className={styles.subPane}>
              <div className={styles.subPaneMeta}>
                <span>{layerDefs.subLabel}</span>
              </div>
              <LayerPane layers={subLayers.map((x) => x.chart)} highlight={litLayer} />
            </div>
          )}
          {/* the legend — every layered line, its current reading, tap to isolate */}
          {hasChart && (mainLayers.length > 0 || subLayers.length > 0) && (
            <div className={styles.layerChips}>
              {mainLayers.map(chipFor)}
              {subLayers.map(chipFor)}
            </div>
          )}
        </m.div>

      </section>
    </LazyMotion>
  );
}

/* The horizontal movers ledger under the desktop stage — same honesty rules as
   VerifiedStrip (CI'd movers first, sub-market reads as the fallback, never a
   fabricated %), recomposed as a single hairline band. */
function MoversBand({ movers, activeKey, market }: { movers: VerifiedMover[]; activeKey: Market; market: MarketData | null }) {
  if (movers.length) {
    return (
      <div className={styles.moversBand}>
        <span className={styles.moversBandLabel}>Verified movers<em>95% confidence</em></span>
        <div className={styles.moversBandRows}>
          {movers.slice(0, 5).map((mv) => (
            <span key={mv.slug} className={styles.moverCell}>
              <span className={styles.moverCellName}>{mv.label}</span>
              <span className={styles.moverCellChg} data-dir={mv.dir}>
                {fmtPct(mv.changePct)} <em>{mv.horizon}</em>
              </span>
              <span className={styles.moverCellCi}>[{mv.ciLoPct.toFixed(0)}, {mv.ciHiPct.toFixed(0)}]</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  // no CI'd maker — this vertical's strongest sub-market reads, same band shape
  const subs = activeKey === 'all' ? [] : (market?.subMarkets?.[activeKey] || []);
  if (subs.length) {
    const rank = { index: 0, demand: 1, descriptive: 2 } as const;
    const ordered = [...subs].sort((a, b) => {
      if (rank[a.readType] !== rank[b.readType]) return rank[a.readType] - rank[b.readType];
      if (a.readType === 'demand') return (b.demandNow ?? -Infinity) - (a.demandNow ?? -Infinity);
      return b.lots - a.lots;
    }).slice(0, 4);
    return (
      <div className={styles.moversBand}>
        <span className={styles.moversBandLabel}>Sub-markets<em>strongest honest read</em></span>
        <div className={styles.moversBandRows}>
          {ordered.map((r) => {
            if (r.readType === 'index' && r.index) {
              const dir = r.index.changePct >= 0 ? 'up' : 'down';
              return (
                <span key={r.slug} className={styles.moverCell}>
                  <span className={styles.moverCellName}>{r.label}</span>
                  <span className={styles.moverCellChg} data-dir={dir}>{fmtPct(r.index.changePct)} <em>{r.index.horizon}</em></span>
                  <span className={styles.moverCellCi}>[{r.index.ciLoPct.toFixed(0)}, {r.index.ciHiPct.toFixed(0)}]</span>
                </span>
              );
            }
            if (r.readType === 'demand' && r.demandNow != null) {
              const dir = r.demandNow >= 0 ? 'up' : 'down';
              return (
                <span key={r.slug} className={styles.moverCell}>
                  <span className={styles.moverCellName}>{r.label}</span>
                  <span className={styles.moverCellChg} data-dir={dir}>{fmtPct(r.demandNow)} <em>demand</em></span>
                  <span className={styles.moverCellCi}>{r.typicalUsd != null ? `typ ${fmtMoneyCompact(r.typicalUsd)}` : `${fmtInt(r.lots)} lots`}</span>
                </span>
              );
            }
            return (
              <span key={r.slug} className={styles.moverCell}>
                <span className={styles.moverCellName}>{r.label}</span>
                <span className={styles.moverCellChg}>{r.typicalUsd != null ? fmtMoneyCompact(r.typicalUsd) : '—'} <em>typical</em></span>
                <span className={styles.moverCellCi}>{r.record ? `rec ${fmtMoneyCompact(r.record.usd)}` : `${fmtInt(r.lots)} lots`}</span>
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.verifiedEmpty}>
      <span className={styles.verifiedEmptyDot} aria-hidden />
      No maker in {activeKey === 'all' ? 'the market' : `${activeKey}`} clears the 95%-confidence bar yet — we only print a move the data resolves.
    </div>
  );
}

/* The verified movers — the only price-movement reads that clear the 95%
   confidence bar. Where a market has NO verified index maker, we fall back to
   that vertical's tracked sub-markets (demand / descriptive) so every hero
   carries real depth — never a bare empty line, and never a fabricated %. */
function VerifiedStrip({ movers, activeKey, market, compact }: { movers: VerifiedMover[]; activeKey: Market; market: MarketData | null; compact?: boolean }) {
  if (movers.length) {
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

  // no CI'd maker — surface this vertical's sub-market reads instead of the bare line
  const subs = activeKey === 'all' ? [] : (market?.subMarkets?.[activeKey] || []);
  if (subs.length) return <SubMarketStrip subs={subs} compact={compact} />;

  return (
    <div className={styles.verifiedEmpty}>
      <span className={styles.verifiedEmptyDot} aria-hidden />
      No maker in {activeKey === 'all' ? 'the market' : `${activeKey}`} clears the 95%-confidence bar yet — we only print a move the data resolves.
    </div>
  );
}

/* The sub-market depth line for a hero with no verified maker — the strongest
   honest read per sub-market (demand %-over-est or the descriptive typical/
   record), ranked demand-first. Compact by design. */
function SubMarketStrip({ subs, compact }: { subs: SubMarketRead[]; compact?: boolean }) {
  const rank = { index: 0, demand: 1, descriptive: 2 } as const;
  const ordered = [...subs].sort((a, b) => {
    if (rank[a.readType] !== rank[b.readType]) return rank[a.readType] - rank[b.readType];
    if (a.readType === 'demand') return (b.demandNow ?? -Infinity) - (a.demandNow ?? -Infinity);
    return b.lots - a.lots;
  });
  const rows = ordered.slice(0, compact ? 3 : 3);
  const line = (r: SubMarketRead): { main: string; dir?: 'up' | 'down'; sub: string } => {
    if (r.readType === 'index' && r.index) {
      return { main: fmtPct(r.index.changePct), dir: r.index.changePct >= 0 ? 'up' : 'down', sub: `[${r.index.ciLoPct.toFixed(0)}, ${r.index.ciHiPct.toFixed(0)}]` };
    }
    if (r.readType === 'demand' && r.demandNow != null) {
      return { main: `demand ${fmtPct(r.demandNow)}`, dir: r.demandNow >= 0 ? 'up' : 'down', sub: r.typicalUsd != null ? fmtMoneyCompact(r.typicalUsd) : (r.record ? fmtMoneyCompact(r.record.usd) : `${r.lots} lots`) };
    }
    return { main: r.typicalUsd != null ? fmtMoneyCompact(r.typicalUsd) : '—', sub: r.record ? `rec ${fmtMoneyCompact(r.record.usd)}` : `${r.lots} lots` };
  };
  return (
    <div className={styles.verifiedStrip}>
      <div className={styles.verifiedHead}>
        <span>Sub-markets</span>
        <span>strongest honest read</span>
      </div>
      <div className={styles.verifiedRows}>
        {rows.map((r) => {
          const l = line(r);
          return (
            <div key={r.slug} className={styles.verifiedRow} data-dir={l.dir}>
              <span className={styles.verifiedName}>{r.label}</span>
              <span className={styles.verifiedChg} data-dir={l.dir}>{l.main}</span>
              <span className={styles.verifiedCi}>{l.sub}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

