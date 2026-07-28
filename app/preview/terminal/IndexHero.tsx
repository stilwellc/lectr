'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { MarketData, DemandPoint, RealizedByMarket, Backtest } from '../../hooks/useRayData';
import type { RealizedPoint, BidCompetitionPoint } from '../../types';
import { ARTIST_MARKET, type Market } from '../../constants';
import RollingNumber from './RollingNumber';
import MarketChart, { type IndexPoint } from './MarketChart';
import Sparkline from './Sparkline';
import { fmtInt, fmtMoneyCompact, useReducedMotion } from './hooks';
import { verifiedMovers, fmtPct, type VerifiedMover } from './verified';
import { GhostGlyph } from './VerticalGhost';
import { openElapsed } from '../../components/Greeting';
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

   THE OPEN (M1): when the Greeting is writing the sign, the whole
   hero syncs to its clock — hairlines land at T+900, the numeral
   rolls 0→value from T+1000 (1200ms, butter bloom over its final
   300ms), the chart draws from T+1200 (1100ms, area fill fading up
   over the last 400ms), rail rows rise from T+1500 in a 70ms
   stagger and the movers cascade after. Without the greeting (or
   under reduced motion) the same choreography compresses to the
   quiet default delays / resolves instantly.

   THE TAPE CUT (M2/M3): a market switch never delays the data —
   the real values swap at once; the choreography stages the
   PERCEPTION: the outgoing stage dims to 60% while a 1px butter
   tracer sweeps left→right (240ms), the numeral rolls old-real →
   new-real (600ms), the chart redraws fast (700ms vs the 1100ms
   first draw) and the movers re-stagger at 30ms. Total ≤450ms of
   stagecraft. Everything is keyed on market+horizon so the
   instruments re-arm on EVERY switch.

   BID-COMPETITION READ (sports/cards): Goldin publishes no estimate, so cards
   get no %-over-estimate demand — but every lot carries bidCount, a genuine
   demand primitive. bidComp[market] (median bids/lot, quarterly) surfaces in
   the rail as an ADDITIONAL, distinctly-labelled read ("Bid competition · N
   bids/lot") — never as a % move or a price.
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
  /** the appreciation read, if the market has one — the 12-mo price trend
      the rail cross-checks against demand (relabelled from "ROI", R5) */
  appreciation: number | null;
  /** lots on the block right now in the scoped market */
  onBlock: number;
  play: boolean;
  /** mobile gets its OWN hero composition — not the desktop scaled down */
  isMobile?: boolean;
  /** the backtest record — the 10-second trust anchor chip (R2) */
  backtest?: Backtest | null;
  /** TONIGHT'S WALL (M6) — rendered under the movers band on desktop,
      under the hero card on mobile */
  wall?: React.ReactNode;
  /** mobile hero swipe (M17) — advance the market ±1 */
  onMarketStep?: (dir: 1 | -1) => void;
}

const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// whole-number signed percent for the record chip / caption (real values only)
const fmtPctRound = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n))}%`;

// R14 — the confidence interval in plain language: "(band 19–92)". Negative
// bounds swap the dash for "to" so −21–−4 never prints as a hyphen pile-up.
const fmtBand = (lo: number, hi: number): string => {
  const f = (n: number) => (n < 0 ? `−${Math.abs(Math.round(n))}` : `${Math.round(n)}`);
  return lo < 0 || hi < 0 ? `band ${f(lo)} to ${f(hi)}` : `band ${f(lo)}–${f(hi)}`;
};

// Resolve the hero series for the active market — DEMAND first (measured,
// defensible), then the realized-cohort median for markets without estimates.
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
  bidComp,
  totalLots,
  houses,
  belowMkt,
  appreciation,
  onBlock,
  onOpenBelow,
  onCommand,
  play,
  isMobile,
  backtest,
  wall,
  onMarketStep,
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

  // ── Price-index × demand cross-check (rail). Demand is a RELATIVE beat
  // (sold over estimate) — it can run hot while houses quietly cut estimates,
  // so it's paired with the absolute value trend. When lots are beating ask
  // (demand up) but typical values are falling YoY, the rail raises a flag.
  const roi = appreciation;
  const roiDir: 'up' | 'down' | undefined = roi == null ? undefined : roi >= 0 ? 'up' : 'down';
  const demandHot = hero.unit === 'demand' && headline > 0;
  const roiFlag = demandHot && roi != null && roi < -1.5 ? 'beating soft estimates' : undefined;

  // the verified movers scoped to this market — the only defensible price moves
  const movers = useMemo(() => verifiedMovers(market, activeKey), [market, activeKey]);
  // ...and the size of the candidate pool they were drawn from (R14 legend M)
  const moverPool = useMemo(() => {
    const mi = market?.makerIndex;
    if (!mi) return 0;
    return Object.keys(mi).filter((slug) => activeKey === 'all' || ARTIST_MARKET[slug] === activeKey).length;
  }, [market, activeKey]);

  // ── BID-COMPETITION read (sports/cards) — labelled "bids/lot", never a %.
  const bc = useMemo(() => {
    const s = bidComp || [];
    if (s.length < 2) return null; // need at least a level + a prior quarter to trend
    const now = s[s.length - 1].value;
    const prev = s[s.length - 2].value;
    const dir: 'up' | 'down' | undefined = now === prev ? undefined : now > prev ? 'up' : 'down';
    return { now: Math.round(now), dir };
  }, [bidComp]);

  // ── THE OPEN's clock (M1). If the greeting is mid-write, sync every delay to
  // its absolute timeline; else use the quiet defaults. All in SECONDS.
  const openBase = useMemo(() => {
    if (reduce || !play) return null;
    const el = openElapsed();
    return el != null && el < 2300 ? el : null;
    // measured once per mount — the choreography is decided at arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const at = (targetMs: number, fallbackS: number) =>
    openBase != null ? Math.max(0, targetMs - openBase) / 1000 : fallbackS;

  // ── THE TAPE CUT (M2) + re-arm (M3). Market change → tracer sweep + dim;
  // market OR horizon change → the chart/numeral replay between real values.
  const prevMarket = useRef(activeKey);
  const [cut, setCut] = useState(0); // increments per market switch (keys the tracer)
  const [switched, setSwitched] = useState(false);
  useEffect(() => {
    if (prevMarket.current === activeKey) return;
    prevMarket.current = activeKey;
    setSwitched(true);
    if (!reduce) setCut((c) => c + 1);
  }, [activeKey, reduce]);
  const [tracerOn, setTracerOn] = useState(false);
  useEffect(() => {
    if (!cut) return;
    setTracerOn(true);
    const t = setTimeout(() => setTracerOn(false), 460);
    return () => clearTimeout(t);
  }, [cut]);
  const prevHorizon = useRef(horizon.key);
  useEffect(() => {
    if (prevHorizon.current !== horizon.key) {
      prevHorizon.current = horizon.key;
      setSwitched(true);
    }
  }, [horizon.key]);

  const chartKey = `${activeKey}:${horizon.key}`;
  const drawMs = switched ? 700 : 1100;
  const chartBegin = switched ? 0 : Math.round(at(1200, 0.25) * 1000);

  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 16, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.6, ease: EASE, delay: reduce ? 0 : delay },
  });

  const hasChart = hero.idx.length >= 4;

  // R5 — one number, properly captioned. The demand headline IS the median
  // priceUsd/estMid beat over the window (demandSeries), so the caption states
  // exactly that, with the real value and the real window. Realized ($) keeps
  // its own explain line.
  const windowWord = horizon.key === '1Y' ? 'past 12 months' : horizon.label;
  const caption =
    hero.unit === 'demand' && windowVals.length
      ? `the median lot hammered ${Math.abs(Math.round(headline))}% ${headline >= 0 ? 'above' : 'below'} its estimate midpoint · ${windowWord}`
      : hero.explain;

  // R2 — the record chip's real backtest numbers (hammer basis)
  const rec = backtest && backtest.flagged.n > 500
    ? {
        f: backtest.flagged.hammerMedianPct ?? backtest.flagged.medianPerfPct,
        u: backtest.unflagged.hammerMedianPct ?? backtest.unflagged.medianPerfPct,
        n: backtest.flagged.n,
      }
    : null;

  // M17 — swipe the mobile hero card between markets. A 30° angle gate keeps
  // vertical scrolling untouched; the swipe drives the same setMarket.
  const touch = useRef<{ x: number; y: number; locked: 'h' | 'v' | null } | null>(null);
  const [slideDir, setSlideDir] = useState<0 | 1 | -1>(0);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, locked: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const st = touch.current;
    if (!st || st.locked) return;
    const t = e.touches[0];
    const dx = t.clientX - st.x;
    const dy = t.clientY - st.y;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    // 30° gate: steeper than 30° off-horizontal → it's a scroll, stand down
    st.locked = Math.abs(dy) <= Math.abs(dx) * Math.tan((30 * Math.PI) / 180) ? 'h' : 'v';
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const st = touch.current;
    touch.current = null;
    if (!st || st.locked !== 'h' || !onMarketStep) return;
    const dx = e.changedTouches[0].clientX - st.x;
    if (Math.abs(dx) < 48) return;
    const dir: 1 | -1 = dx < 0 ? 1 : -1;
    setSlideDir(dir);
    onMarketStep(dir);
  };

  // ── MOBILE: its own scene — a compact "index card" (a premium trading-app
  // asset tile), NOT the desktop slab scaled down.
  if (isMobile) {
    return (
      <LazyMotion features={domAnimation} strict>
        <section className={styles.mHero}>
          <m.div
            className={styles.mHeroCard}
            {...rise(0.04)}
            data-cut={tracerOn ? 'true' : undefined}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {/* M10 — the vertical's ghost emblem, ≤5% opacity, crossfading per market */}
            <span key={`g-${activeKey}`} className={styles.mHeroGhost} aria-hidden>
              <GhostGlyph market={activeKey} />
            </span>
            {tracerOn && <span key={`tr-${cut}`} className={styles.cutTracer} aria-hidden />}
            <div key={`slide-${activeKey}`} className={styles.mHeroSlide} data-dir={slideDir === 0 ? undefined : slideDir === 1 ? 'left' : 'right'}>
              <div className={styles.mHeroHead}>
                <span className={styles.mHeroLabel}>{hero.kicker}</span>
                <span className={styles.mHeroReturnTag}>{metricLabel}</span>
              </div>
              <div className={styles.mHeroNumRow}>
                <RollingNumber
                  className={`${styles.mHeroNum} ${styles.litNumeral}`}
                  value={headline}
                  from={0}
                  format={fmtHeadline}
                  duration={1200}
                  switchDuration={600}
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
                  <MarketChart key={chartKey} data={windowIdx} play={play} height={168} compact drawMs={drawMs} beginDelay={chartBegin} />
                ) : (
                  <Sparkline data={spark.length >= 2 ? spark : [level, level]} dir={trendDir} width={360} height={90} strokeWidth={1.8} />
                )}
              </div>
              <div className={styles.mHeroTag}>{caption}</div>
            </div>
          </m.div>

          {/* M6 — tonight's wall, the snap strip under the hero card */}
          {wall}

          <m.div className={styles.mHeroStats} {...rise(0.12)}>
            <span className={styles.mStat} data-flag={roiFlag ? 'true' : undefined}>
              <span className={styles.mStatVal} data-dir={roiDir}>{roi != null ? fmtPct(roi) : '—'}</span>
              <span className={styles.mStatLabel}>Price index · 12 mo</span>
              {roiFlag && <span className={styles.statFlag}>⚠ {roiFlag}</span>}
            </span>
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

          {rec && (
            <Link href="/value#record" className={styles.recordChip}>
              <span className={styles.recordChipK}>The record</span>
              <span className={styles.recordChipLine}>
                flagged <b data-dir="up">{fmtPctRound(rec.f)}</b> vs <b data-dir={rec.u >= 0 ? 'up' : 'down'}>{fmtPctRound(rec.u)}</b> unflagged · {fmtInt(rec.n)} replayed
              </span>
              <span className={styles.recordChipGo} aria-hidden>→</span>
            </Link>
          )}

          <VerifiedStrip movers={movers} activeKey={activeKey} market={market} compact />

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
      <section className={styles.hero} data-cut={tracerOn ? 'true' : undefined}>
        {tracerOn && <span key={`tr-${cut}`} className={styles.cutTracer} aria-hidden />}
        {/* HEAD — thesis kicker (R1) + the honest headline reading */}
        <m.div className={styles.heroHead} {...rise(at(900, 0.05))}>
          <div className={styles.heroTopRow}>
            <span className={styles.sectionKicker}>{hero.kicker}</span>
            <span className={styles.heroReturnTag}>{metricLabel}</span>
          </div>
          {/* R1 + M11 — the serif thesis over the number, mono corpus line under it */}
          <p className={styles.heroThesisLine}>
            Every estimate, read against <em>every</em> hammer
          </p>
          <div className={styles.heroCorpusLine}>
            {fmtInt(totalLots)} lots · {houses} houses · updated nightly
          </div>
          <div className={styles.heroNumberRow}>
            <RollingNumber
              className={`${styles.heroNumber} ${styles.litNumeral}`}
              value={headline}
              from={0}
              format={fmtHeadline}
              duration={1200}
              switchDuration={600}
              delay={Math.round(at(1000, 0.22) * 1000)}
              play={play}
            />
            <span className={styles.heroReturnPer}>{horizon.label}</span>
          </div>
          <div className={styles.heroExplainLine}>{caption}</div>
          <div className={styles.tfToggle} role="tablist" aria-label="Window">
            {avail.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={t.key === horizon.key}
                className={styles.tfChip} data-on={t.key === horizon.key ? 'true' : undefined}
                onClick={() => setTf(t.key)}>{t.key === 'MAX' ? 'ALL' : t.key}</button>
            ))}
          </div>
        </m.div>

        {/* RAIL — the side metrics as a right-hand ledger: label · hairline · value.
            Rows rise 12px in a 70ms stagger from T+1500; their hairlines DRAW
            scaleX 0→1 origin-left in a 60ms stagger from T+900 (M1). */}
        <div className={styles.heroRail} data-draw={play && !reduce ? 'true' : undefined}>
          {[
            <React.Fragment key="idx">
              <div className={styles.railRow}>
                <span className={styles.railLabel}>Price index · 12 mo</span>
                <span className={styles.railVal} data-dir={roiDir}>{roi != null ? fmtPct(roi) : '—'}</span>
              </div>
              {roiFlag && <div className={styles.railFlagLine}>⚠ {roiFlag}</div>}
            </React.Fragment>,
            <div key="block" className={styles.railRow}>
              <span className={styles.railLabel}>On the block</span>
              <span className={styles.railVal}>{fmtInt(onBlock)}</span>
            </div>,
            ...(bc
              ? [
                  <div key="bc" className={styles.railRow} title="Median number of bids drawn per sold lot — a demand primitive from Goldin's bid auctions. Not a price move.">
                    <span className={styles.railLabel}>Bid competition</span>
                    <span className={styles.railVal} data-dir={bc.dir}>{bc.now} bids/lot</span>
                  </div>,
                ]
              : []),
            belowMkt ? (
              <button key="below" type="button" className={styles.railBtn} onClick={onOpenBelow}
                aria-label={`${belowMkt} below-market lots — see them`}>
                <span className={styles.railLabel}>Below market now</span>
                <span className={styles.railVal} data-accent="true">{fmtInt(belowMkt)}<em className={styles.railGo} aria-hidden>↗</em></span>
              </button>
            ) : (
              <div key="below" className={styles.railRow}>
                <span className={styles.railLabel}>Below market now</span>
                <span className={styles.railVal}>—</span>
              </div>
            ),
            // R2 — the record chip: the product's 10-second trust anchor
            ...(rec
              ? [
                  <Link key="rec" href="/value#record" className={styles.railRecord}>
                    <span className={styles.railLabel}>The record</span>
                    <span className={styles.railRecordLine}>
                      flagged <b data-dir="up">{fmtPctRound(rec.f)}</b> vs <b data-dir={rec.u >= 0 ? 'up' : 'down'}>{fmtPctRound(rec.u)}</b> unflagged · {fmtInt(rec.n)}{' '}replayed{' '}<em aria-hidden>→</em>
                    </span>
                  </Link>,
                ]
              : []),
            <button key="cmd" type="button" className={styles.railCmd} onClick={onCommand}>
              <kbd className={styles.kbd}>⌘</kbd>
              <kbd className={styles.kbd}>K</kbd>
              <span className={styles.cmdLabel}>Search {fmtInt(totalLots)} lots</span>
              <span className={styles.cmdArrow} aria-hidden>↵</span>
            </button>,
          ].map((node, i) => (
            <m.div
              key={i}
              className={styles.railRowWrap}
              style={{ ['--hair-d' as string]: `${(at(900, 0.05) + i * 0.06).toFixed(3)}s` }}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: EASE, delay: reduce ? 0 : at(1500, 0.12) + i * 0.07 }}
            >
              {node}
            </m.div>
          ))}
        </div>

        {/* STAGE — the full-width landscape. No box, no card: the line, its
            directional fill and glow ARE the composition. The vertical's ghost
            emblem sits in the right third at ≤5% opacity (M10). */}
        <m.div className={styles.heroStage} {...rise(at(1200, 0.16))}>
          <span key={`g-${activeKey}`} className={styles.stageGhost} aria-hidden>
            <GhostGlyph market={activeKey} />
          </span>
          <div className={styles.stageMeta}>
            <span>{metricLabel} · {horizon.label}</span>
            <span>{marketLabel.toLowerCase()}</span>
          </div>
          {hasChart ? (
            <MarketChart key={chartKey} data={windowIdx} play={play} height={264} drawMs={drawMs} beginDelay={chartBegin} />
          ) : (
            <div className={styles.heroSparkFallback}>
              <Sparkline data={spark.length >= 2 ? spark : [level, level]} dir={trendDir} width={720} height={140} strokeWidth={1.8} />
              <span className={styles.chartCardTag}>series building — sampling this market</span>
            </div>
          )}
        </m.div>

        {/* MOVERS BAND — the verified ledger running under the landscape.
            Keyed on the market so cells re-stagger (30ms) on every tape cut. */}
        <m.div className={styles.heroMoversArea} {...rise(at(1500, 0.2))}>
          <MoversBand key={activeKey} movers={movers} moverPool={moverPool} activeKey={activeKey} market={market} reduce={reduce} restagger={switched} />
        </m.div>

        {/* M6 — TONIGHT'S WALL under the movers band */}
        {wall}
      </section>
    </LazyMotion>
  );
}

/* The horizontal movers ledger under the desktop stage — same honesty rules as
   VerifiedStrip (CI'd movers first, sub-market reads as the fallback, never a
   fabricated %), recomposed as a single hairline band. R14: the interval reads
   as a plain-language band and the legend states the bar it cleared. */
function MoversBand({ movers, moverPool, activeKey, market, reduce, restagger }: { movers: VerifiedMover[]; moverPool: number; activeKey: Market; market: MarketData | null; reduce: boolean; restagger: boolean }) {
  const stagger = reduce ? 0 : restagger ? 0.03 : 0.07;
  if (movers.length) {
    const shown = movers.slice(0, 5);
    return (
      <div className={styles.moversBand}>
        <span className={styles.moversBandLabel}>
          Verified movers
          <em>95% confidence band — only {movers.length} of {moverPool || movers.length} makers clear the bar</em>
        </span>
        <div className={styles.moversBandRows}>
          {shown.map((mv, i) => (
            <m.span
              key={mv.slug}
              className={styles.moverCell}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE, delay: i * stagger }}
            >
              <span className={styles.moverCellName}>{mv.label}</span>
              <span className={styles.moverCellChg} data-dir={mv.dir}>
                {fmtPct(mv.changePct)} <em>{mv.horizon}</em>
              </span>
              <span className={styles.moverCellCi}>({fmtBand(mv.ciLoPct, mv.ciHiPct)})</span>
            </m.span>
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
          {ordered.map((r, i) => {
            const cell = (children: React.ReactNode) => (
              <m.span
                key={r.slug}
                className={styles.moverCell}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: EASE, delay: i * stagger }}
              >
                {children}
              </m.span>
            );
            if (r.readType === 'index' && r.index) {
              const dir = r.index.changePct >= 0 ? 'up' : 'down';
              return cell(
                <>
                  <span className={styles.moverCellName}>{r.label}</span>
                  <span className={styles.moverCellChg} data-dir={dir}>{fmtPct(r.index.changePct)} <em>{r.index.horizon}</em></span>
                  <span className={styles.moverCellCi}>({fmtBand(r.index.ciLoPct, r.index.ciHiPct)})</span>
                </>
              );
            }
            if (r.readType === 'demand' && r.demandNow != null) {
              const dir = r.demandNow >= 0 ? 'up' : 'down';
              return cell(
                <>
                  <span className={styles.moverCellName}>{r.label}</span>
                  <span className={styles.moverCellChg} data-dir={dir}>{fmtPct(r.demandNow)} <em>demand</em></span>
                  <span className={styles.moverCellCi}>{r.typicalUsd != null ? `typ ${fmtMoneyCompact(r.typicalUsd)}` : `${fmtInt(r.lots)} lots`}</span>
                </>
              );
            }
            return cell(
              <>
                <span className={styles.moverCellName}>{r.label}</span>
                <span className={styles.moverCellChg}>{r.typicalUsd != null ? fmtMoneyCompact(r.typicalUsd) : '—'} <em>typical</em></span>
                <span className={styles.moverCellCi}>{r.record ? `rec ${fmtMoneyCompact(r.record.usd)}` : `${fmtInt(r.lots)} lots`}</span>
              </>
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
              <span className={styles.verifiedCi}>({fmtBand(mv.ciLoPct, mv.ciHiPct)})</span>
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
      return { main: fmtPct(r.index.changePct), dir: r.index.changePct >= 0 ? 'up' : 'down', sub: `(${fmtBand(r.index.ciLoPct, r.index.ciHiPct)})` };
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
