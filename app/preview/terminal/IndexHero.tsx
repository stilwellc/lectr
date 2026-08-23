'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { MarketData, DemandPoint, DemandByMarket, RealizedByMarket } from '../../hooks/useRayData';
import type { RealizedPoint, BidCompetitionPoint } from '../../types';
import { MARKETS, type Market } from '../../constants';
import type { HeroPoint } from './HeroChart';
import { MarketTape, SubTape, TapeMonument, pickLead } from './MarketTape';
import { CIBeam } from './SubMarketBoard';
import { fmtMoneyCompact } from './hooks';
import { fmtPct } from './verified';
import { fmtInt, useReducedMotion } from './hooks';


/** Market keys read naturally lowercase in the kicker ("the design market") —
 *  except initialisms, which keep their case ("the TCG market"). */
const KICKER_NAME: Partial<Record<Market, string>> = { tcg: 'TCG' };
const kickerName = (k: Market): string => KICKER_NAME[k] ?? k;
/** the conduit tag — what the selector is feeding the instrument column */
const feedName = (k: Market): string => (k === 'all' ? 'Total market' : kickerName(k));
import styles from './style.module.css';

/* RAIL MARKS — the constructed-mark language on the "Right now" metrics:
   on the block = an auction paddle, value trend = a rising line + arrow, bid
   competition = competing bids, below market = a lot under the market line,
   search = a loupe. 24-grid, currentColor, round caps. */
function RailMark({ k }: { k: 'onBlock' | 'trend' | 'bids' | 'below' | 'search' }) {
  const paths: Record<string, React.ReactNode> = {
    onBlock: <><rect x="6.5" y="4" width="9" height="7" rx="2" /><path d="M11 11v8.5" /></>,
    trend: <><path d="M4.5 15.5l4-4 3 2.5 5-6" /><path d="M14.5 8H18.5V12" /></>,
    bids: <><path d="M8 19V8M8 8l-2.4 2.4M8 8l2.4 2.4" /><path d="M16 19v-7M16 12l-2.4 2.4M16 12l2.4 2.4" /></>,
    below: <><path d="M4.5 9h15" /><path d="M12 15.6V11" /><circle cx="12" cy="16.4" r="2" fill="currentColor" stroke="none" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6" /><path d="M19.5 19.5l-4.8-4.8" /></>,
  };
  return (
    <svg className={styles.railMark} width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[k]}
    </svg>
  );
}

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
   The horizon toggle scopes the window the headline median reads over.
   THE STAGE (Aug 2026): the multi-line HeroChart is gone — it drew six
   base-100-rebased index lines and a demand median on one stage, two
   different measures sharing axes, which read as a portfolio but wasn't.
   The stage is now the MARKET TAPE (MarketTape.tsx): per-vertical rows
   on the 02 board's honesty ladder, and on a scoped lander the
   vertical's CI-gated horizon ladder with abstentions shown verbatim.

   BID-COMPETITION READ (sports/cards): Goldin publishes no estimate, so cards
   get no %-over-estimate demand — but every lot carries bidCount, a genuine
   demand primitive. bidComp[market] (median bids/lot, quarterly) surfaces in
   the rail as an ADDITIONAL, distinctly-labelled read ("Bid competition · N
   bids/lot") — never as a % move or a price. It rides ALONGSIDE the headline
   (which stays the realized-$ cohort median for sports) and never masquerades
   as the CI'd repeat-sale index.
   ============================================================ */

const EASE = [0.23, 1, 0.32, 1] as const;
const MARKET_COUNT = MARKETS.filter((m) => m.key !== 'all').length;

/* ── THE PULSE BOARD PRIMITIVES ─────────────────────────────────────────────
   The "Right now" panel is the lander's heartbeat: a bento of live blocks
   (Block's geometry), numerals that settle like a ticker (Robinhood's data-as-
   protagonist), hairline precision and choreographed micro-motion (Linear).
   Everything below is display grammar only — every figure keeps its existing
   honest label; nothing new masquerades as a verified read. */

/** Ticker settle: the numeral counts to its value on fresh arrival. Tabular
 *  nums upstream keep the width stable; reduced-motion (or a cached back-nav)
 *  renders resolved instantly. */
function useCountUp(target: number, animate: boolean): number {
  const [shown, setShown] = useState(animate ? 0 : target);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!animate) { setShown(target); return; }
    const t0 = performance.now();
    const dur = 900;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3); // ease-out cubic — fast start, soft landing
      setShown(Math.round(target * e));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, animate]);
  return shown;
}

/** 'YYYY-MM-DD' → the room's shorthand: tonight / tmrw / Fri / Aug 16. */
function relDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d.getTime())) return iso;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / 86400000);
  if (days <= 0) return 'tonight';
  if (days === 1) return 'tmrw';
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export interface ClosingHouse { house: string; when: string; n: number }

// the hero series' point shape (period/value/n)
type IndexPoint = HeroPoint;

interface Props {
  activeKey: Market;
  marketLabel: string;
  market: MarketData | null;
  demand: DemandPoint[] | undefined;
  /** the FULL per-market demand map — the tape reads every vertical, not
      just the scoped one */
  demandAll: DemandByMarket;
  realized: RealizedByMarket;
  /** bid-competition series (median bids/lot, quarterly) for the scoped market —
      populated for sports/cards only. A DEMAND primitive from Goldin's bidCount,
      surfaced as a distinct rail read, never a % move or a price. */
  bidComp?: BidCompetitionPoint[] | undefined;
  /** honest full-corpus lot total for the ⌘K search pill */
  totalLots: number;
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
  /** gate the entrance animation — a cached back-nav renders resolved */
  play: boolean;
  /** mobile gets its OWN hero composition — not the desktop scaled down */
  isMobile?: boolean;
  /** the data date, worn as the masthead serial (NO. YYYYMMDD) */
  serial?: string | null;
  /** the live book's nearest closes, per house (soonest first) — the pulse
      board's "closing next" ticker */
  closingNext?: ClosingHouse[];
}

/* ══ THE LANDSCAPE (Aug 2026) ══ the hero's opening beat: the scoped
   market's real series drawn at full page width — the chart IS the page,
   not a postage stamp in a table cell. ONE measure per landscape, labelled
   with its own unit (demand %-over-estimate in direction ink; realized-$
   cohort medians NEUTRAL — delta ink is for measured reads only). */
function StageChart({ idx, unit, play }: { idx: IndexPoint[]; unit: 'demand' | 'realized'; play: boolean }) {
  const gid = useId();
  const g = useMemo(() => {
    if (idx.length < 4) return null;
    const step = Math.max(1, Math.ceil(idx.length / 72));
    const pts = idx.filter((_, i) => i % step === 0 || i === idx.length - 1);
    const vals = pts.map((p) => p.value);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (unit === 'demand') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const span = (hi - lo) || 1;
    lo -= span * 0.1; hi += span * 0.08;
    const X = (i: number) => (i / (pts.length - 1)) * 100;
    const Y = (v: number) => ((hi - v) / (hi - lo)) * 100;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${X(i).toFixed(2)} ${Y(p.value).toFixed(2)}`).join(' ');
    // three round-valued gridlines inside the domain
    const rawStep = (hi - lo) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)));
    const nice = [1, 2, 2.5, 5, 10].map((m) => m * mag).reduce((a, b) =>
      Math.abs(b - rawStep) < Math.abs(a - rawStep) ? b : a);
    const grid: { y: number; v: number }[] = [];
    for (let v = Math.ceil(lo / nice) * nice; v < hi; v += nice) {
      if (grid.length >= 4) break;
      grid.push({ y: Y(v), v });
    }
    return {
      d, grid,
      endX: 100, endY: Y(vals[vals.length - 1]),
      zeroY: unit === 'demand' && lo < 0 ? Y(0) : null,
      first: pts[0].period, last: pts[pts.length - 1].period,
      now: vals[vals.length - 1],
    };
  }, [idx, unit]);
  if (!g) return null;
  const dir = unit === 'demand' ? (g.now >= 0 ? 'up' : 'down') : undefined;
  const fmtV = (v: number) => unit === 'demand' ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}%` : fmtMoneyCompact(v);
  return (
    <div className={styles.mtLand} data-dir={dir} data-play={play ? 'true' : undefined} aria-hidden>
      <div className={styles.mtLandStage}>
        <div className={styles.mtLandPlot}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={styles.mtLandSvg}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {g.grid.map((ln) => (
            <line key={ln.v} x1="0" x2="100" y1={ln.y} y2={ln.y} className={styles.mtLandGrid} vectorEffect="non-scaling-stroke" />
          ))}
          {g.zeroY != null && (
            <line x1="0" x2="100" y1={g.zeroY} y2={g.zeroY} className={styles.mtLandZero} vectorEffect="non-scaling-stroke" />
          )}
          <path d={`${g.d} L 100 100 L 0 100 Z`} fill={`url(#${gid})`} stroke="none" className={styles.mtLandFill} />
          <path d={g.d} className={styles.mtLandPath} fill="none" vectorEffect="non-scaling-stroke" pathLength={1} />
        </svg>
        {/* the live end of the line — HTML so the stretched SVG can't warp it */}
        <i className={styles.mtLandDot} style={{ left: `${g.endX}%`, top: `${g.endY}%` }} aria-hidden />
        </div>
        {/* gridline values live in the price-scale gutter */}
        {g.grid.map((ln) => (
          <span key={ln.v} className={styles.mtLandTick} style={{ top: `${ln.y}%` }}>{fmtV(ln.v)}</span>
        ))}
      </div>
      <div className={styles.mtLandEnds}>
        <span>{g.first}</span>
        <span>{unit === 'demand' ? 'sold over estimate · by quarter' : 'typical $ at hammer · by quarter'}</span>
        <span>{g.last}</span>
      </div>
    </div>
  );
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
        kicker: activeKey === 'all' ? 'The collectibles market' : `The ${kickerName(activeKey)} market`,
        // NOT "hammer": the series is the raw published sold price vs estimate,
        // and for most houses that price already includes their buyer's premium.
        // Saying "sell" keeps the sentence true to the number underneath it.
        explain: 'How far lots sell above their estimates',
        unit: 'demand' as const,
      };
    }
    // 2 — realized-cohort median ($) — sports (Goldin publishes no estimates)
    const rz = (realized[activeKey] as RealizedPoint[] | undefined) || [];
    if (rz.length >= 4) {
      const idx: IndexPoint[] = rz.map((p) => ({ period: p.date, value: p.value, n: p.n }));
      return {
        idx,
        kicker: `The ${kickerName(activeKey)} market`,
        explain: 'Typical price paid at hammer',
        unit: 'realized' as const,
      };
    }
    return { idx: [] as IndexPoint[], kicker: `The ${kickerName(activeKey)} market`, explain: '', unit: 'demand' as const };
  }, [activeKey, demand, realized]);
}

export default function IndexHero({
  activeKey,
  marketLabel,
  market,
  demand,
  demandAll,
  realized,
  bidComp,
  totalLots,
  belowMkt,
  onBlock,
  onOpenBelow,
  onCommand,
  play,
  isMobile,
  serial,
  closingNext,
}: Props) {
  const reduce = useReducedMotion();
  const hero = useHeroSeries(activeKey, demand, realized);
  const lead = useMemo(() => pickLead(market, demandAll, realized, activeKey), [market, demandAll, realized, activeKey]);
  const showMonument = activeKey !== 'all' && !!lead;   // never on Total market

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
    // gated on play: a cached back-nav must render RESOLVED, not re-fade the
    // hero from nothing (audit-lifecycle #3c)
    initial: reduce || !play ? false : { opacity: 0, y: 16, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.6, ease: EASE, delay: reduce || !play ? 0 : delay },
  });

  // ── THE PULSE BOARD — the shared "Right now" composition (desktop rail +
  // mobile card render the same instrument; only the shell differs).
  const settle = play && !reduce;
  const onBlockShown = useCountUp(onBlock, settle);
  const belowShown = useCountUp(belowMkt, settle);
  const closes = (closingNext || []).slice(0, 3);
  const pulseBoard = (
    <div className={styles.pulse} data-play={play ? 'true' : undefined}>
      <div className={styles.pulseHead} data-live="true" aria-hidden>
        <span className={styles.pulseTitle}>Right now</span>
        <i className={styles.pulseRule} />
      </div>

      {/* every cell speaks the same grammar: words left, instrument right —
          slim rows, zero dead space */}
      <div className={styles.pulseGrid}>
        <div className={styles.pulseBlock} data-lead="true">
          <span className={styles.pulseCellText}>
            <span className={styles.pulseLabel}>On the block</span>
            <span className={styles.pulseSub}>{onBlock === 0 ? 'the room is quiet right now' : 'lots open across the room'}</span>
          </span>
          <span className={styles.pulseValLead} data-zero={onBlock === 0 ? 'true' : undefined}>
            {fmtInt(onBlockShown)}
          </span>
        </div>

        {bc && (
          <div className={styles.pulseBlock}
            title="Median number of bids drawn per sold lot — a demand primitive from Goldin's bid auctions. Not a price move.">
            <span className={styles.pulseCellText}>
              <span className={styles.pulseLabel}>Bid competition</span>
            </span>
            <span className={styles.pulseVal}>
              {bc.now}
              <em className={styles.pulseUnit}>bids/lot</em>
              {bc.dir && <i className={styles.pulseDir} data-dir={bc.dir} aria-hidden>{bc.dir === 'up' ? '▲' : '▼'}</i>}
            </span>
          </div>
        )}

        {/* the one action on the board — butter, full width, unmissable */}
        {belowMkt ? (
          <button type="button" className={styles.pulseAction} data-below="true" onClick={onOpenBelow}
            aria-label={`${belowMkt} below-market lots — see them`}>
            <span className={styles.pulseLabel}>Below market now</span>
            <span className={styles.pulseTag}>
              <span className={styles.pulseTagVal}>{fmtInt(belowShown)}</span>
            </span>
          </button>
        ) : activeKey === 'all' ? (
          // the empty state keeps the object language: blank tag stock,
          // waiting to be hung. TOTAL MARKET ONLY — a scoped lander with no
          // flags just drops the row (several verticals rarely flag, and a
          // permanent ghost there reads as a broken feature, not a fact).
          <div className={styles.pulseBlock} data-below="true">
            <span className={styles.pulseCellText}>
              <span className={styles.pulseLabel}>Below market now</span>
              <span className={styles.pulseSub}>no flags in the live book</span>
            </span>
            <span className={`${styles.pulseTag} ${styles.pulseTagGhost}`} aria-hidden>
              <span className={styles.pulseTagVal}>0</span>
            </span>
          </div>
        ) : null}
      </div>

    </div>
  );

  // the departures line — inside the board on desktop, after the search on
  // the phone (the shell decides; the element is one and the same)
  const tickerEl = closes.length > 0 ? (
    <div className={styles.pulseTicker} aria-label="Auctions closing next">
      <div className={styles.pulseHead} aria-hidden>
        <span className={styles.pulseTitle}>Closing next</span>
        <i className={styles.pulseRule} />
      </div>
      <span className={styles.pulseTickerChips}>
        {closes.map((c) => (
          <span key={c.house} className={styles.pulseChip} data-tonight={relDay(c.when) === 'tonight' ? 'true' : undefined}>
            {c.house}<em>{relDay(c.when)}</em>
          </span>
        ))}
      </span>
    </div>
  ) : null;


  // ── MOBILE: its own scene — a compact "index card" (a premium trading-app
  // asset tile), NOT the desktop slab scaled down.
  if (isMobile) {
    return (
      <LazyMotion features={domAnimation} strict>
        <section className={styles.mHero}>
          {/* masthead retired — the keypad above is the orientation */}
          {showMonument && (
            <m.div className={styles.mtMonWrapM} {...rise(0.07)}>
              <TapeMonument row={lead!} play={play} />
            </m.div>
          )}

          <m.div className={styles.mtStage} {...rise(0.12)}>
            {activeKey === 'all'
              ? <MarketTape market={market} demandAll={demandAll} realized={realized} play={play} />
              : <SubTape market={market} activeKey={activeKey} play={play} />}
          </m.div>

          {/* the pulse board — the lander's heartbeat, phone-native shell.
              Settles AFTER the tape. Phone order: board → search → departures. */}
          <m.div className={styles.mRightNow} {...rise(0.64)}>
            {pulseBoard}
            <button type="button" className={styles.cmdPillFull} onClick={onCommand}>
              <RailMark k="search" />
              <span className={styles.cmdLabel}>Search {fmtInt(totalLots)} lots</span>
            </button>
            {tickerEl}
          </m.div>
        </section>
      </LazyMotion>
    );
  }

  // ── DESKTOP: "the quote and the board" (Aug 2026 — Robinhood's asset-page
  // anatomy). The first screen opens with THE STATEMENT (the market's
  // strongest honest read at quote scale) over THE LANDSCAPE (the market's
  // real series at full page width, its own label, its own unit), then the
  // board: the tape reading down the left, the functional rail on the right.
  // The monument card retired into the statement — one enthronement, not two.
  const stmt = (() => {
    if (activeKey === 'all') {
      const now = hero.idx.length ? hero.idx[hero.idx.length - 1].value : null;
      return {
        kicker: 'Measured · demand', name: 'The collectibles market',
        fig: now != null ? fmtPct(now) : null, dir: now != null ? (now >= 0 ? 'up' as const : 'down' as const) : undefined,
        beam: null as null | { lo: number; hi: number; pt: number },
        metaL: hero.explain, metaR: `${fmtInt(totalLots)} lots · ${MARKET_COUNT} markets`,
        horizon: null as string | null,
      };
    }
    const r = lead?.read;
    if (r?.kind === 'index') {
      return {
        kicker: r.method === 'repeat-sale' ? 'Certified · repeat-sale' : r.method === 'composite' ? 'Certified · composite' : 'Certified · hedonic',
        name: marketLabel,
        fig: fmtPct(r.changePct), dir: r.changePct >= 0 ? 'up' as const : 'down' as const,
        beam: { lo: r.ciLo, hi: r.ciHi, pt: r.changePct },
        metaL: r.method === 'repeat-sale'
          ? `same ${activeKey === 'sports' || activeKey === 'tcg' ? 'card' : activeKey === 'watches' ? 'reference' : 'edition'} resold${r.scope ? ` · ${r.scope}` : ''}`
          : r.method === 'composite' ? 'hedonic composite' : 'hedonic index',
        metaR: r.method === 'repeat-sale' ? `${fmtInt(r.n)} pairs` : `${fmtInt(lead!.lots)} lots`,
        horizon: r.horizon,
      };
    }
    if (r?.kind === 'demand') {
      return {
        kicker: 'Measured · demand', name: marketLabel,
        fig: fmtPct(r.now), dir: r.now >= 0 ? 'up' as const : 'down' as const, beam: null,
        metaL: 'demand · sold over estimate', metaR: `${fmtInt(lead!.lots)} lots`, horizon: null,
      };
    }
    if (r?.kind === 'descriptive') {
      return {
        kicker: 'Descriptive · typical', name: marketLabel,
        fig: fmtMoneyCompact(r.typicalUsd), dir: undefined, beam: null,
        metaL: 'typical at hammer', metaR: `${fmtInt(lead!.lots)} lots`, horizon: null,
      };
    }
    return { kicker: 'The read', name: marketLabel, fig: null, dir: undefined, beam: null, metaL: '', metaR: `${fmtInt(totalLots)} lots`, horizon: null };
  })();

  return (
    <LazyMotion features={domAnimation} strict>
      {/* data-play gates the CSS choreography (masthead glint, serial stamp,
          rail settle) on the same fresh-arrival contract as the framer rises */}
      <section className={styles.mtHero} data-play={play ? 'true' : undefined}>
        {/* the masthead line retired Aug 22 2026 (Collin) — the Exchange Rail
            above IS the orientation; a second title row was saying it twice. */}
        {/* THE STATEMENT + THE LANDSCAPE — the opening beat, full width */}
        <m.div className={styles.mtQuoteWrap} data-dir={stmt.dir} {...rise(0.05)}>
          <div className={styles.mtQuote}>
            <div className={styles.mtQuoteLead}>
              <span className={styles.mtQuoteKicker}>
                {stmt.kicker}
                {stmt.horizon && <em className={styles.mtQuoteHz}>{stmt.horizon}</em>}
              </span>
              <span className={styles.mtQuoteName}>{stmt.name}</span>
              <span className={styles.mtQuoteMeta}>
                <span>{stmt.metaL}</span>
                <i aria-hidden />
                <span>{stmt.metaR}</span>
              </span>
            </div>
            <div className={styles.mtQuoteRead}>
              {stmt.fig && (
                <span className={styles.mtQuoteFig} data-dir={stmt.dir}>{stmt.fig}</span>
              )}
              {stmt.beam && (
                <div className={styles.mtQuoteBeam} data-dir={stmt.dir} aria-hidden>
                  <CIBeam lo={stmt.beam.lo} hi={stmt.beam.hi} point={stmt.beam.pt}
                    dir={stmt.dir} play={play} large />
                </div>
              )}
            </div>
          </div>
          {hero.idx.length >= 4 && (
            <StageChart idx={hero.idx} unit={hero.unit} play={play} />
          )}
        </m.div>

        <div className={styles.mtBoard}>
          <m.div className={styles.mtBoardMain} {...rise(0.14)}>
            {activeKey === 'all'
              ? <MarketTape market={market} demandAll={demandAll} realized={realized} play={play} />
              : <SubTape market={market} activeKey={activeKey} play={play} />}
          </m.div>

          <m.aside className={styles.mtSide} {...rise(0.2)}>
            {/* THE FEED CONDUIT: the hairline from the selector grounds the
                functional rail; the statement above owns the enthronement. */}
            <div className={`${styles.mtConduit} ${styles.mtConduitTop}`} aria-hidden="true">
              <i className={styles.mtConduitNode} />
              <span className={styles.mtConduitTag}>{feedName(activeKey)} · feed</span>
              <i className={styles.mtConduitLine} />
            </div>
            <div className={styles.heroRail}>
              {pulseBoard}
              <button type="button" className={styles.railCmd} onClick={onCommand}>
                <RailMark k="search" />
                <span className={styles.cmdLabel}>Search {fmtInt(totalLots)} lots</span>
                <kbd className={styles.cmdKbd} aria-hidden>⌘K</kbd>
              </button>
              {tickerEl}
            </div>
            <div className={`${styles.mtConduit} ${styles.mtConduitBottom}`} aria-hidden="true">
              <i className={styles.mtConduitLine} />
              <i className={styles.mtConduitNode} />
              <span className={styles.mtConduitTag}>read nightly</span>
            </div>
          </m.aside>
        </div>
      </section>
    </LazyMotion>
  );
}
