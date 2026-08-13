'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { MarketData, DemandPoint, DemandByMarket, RealizedByMarket } from '../../hooks/useRayData';
import type { RealizedPoint, BidCompetitionPoint } from '../../types';
import type { Market } from '../../constants';
import type { HeroPoint } from './HeroChart';
import { MarketTape, SubTape, TapeMonument, pickLead } from './MarketTape';
import { fmtInt, useReducedMotion } from './hooks';
import { fmtPct } from './verified';
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

/** The trend block's spine — the scoped market's real hero series (demand /
 *  realized quarterly medians), drawn as a single quiet line. Descriptive ink
 *  only: it never wears the up/down register (the CI'd reads live elsewhere). */
function Spark({ pts, play }: { pts: number[]; play: boolean }) {
  if (pts.length < 3) return null;
  const w = 120, h = 26, pad = 2;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const d = pts
    .map((v, i) => {
      const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (v - min) / span) * (h - pad * 2);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = pts[pts.length - 1];
  const lx = w - pad, ly = pad + (1 - (last - min) / span) * (h - pad * 2);
  return (
    <svg className={styles.pulseSpark} viewBox={`0 0 ${w} ${h}`} width={w} height={h}
      data-play={play ? 'true' : undefined} aria-hidden>
      <path d={d} pathLength={1} fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
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
  demandAll,
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
  serial,
  closingNext,
}: Props) {
  const reduce = useReducedMotion();
  const hero = useHeroSeries(activeKey, demand, realized);
  const lead = useMemo(() => pickLead(market, demandAll, realized, activeKey), [market, demandAll, realized, activeKey]);
  const serialNo = serial ? `NO. ${String(serial).slice(0, 10).replace(/-/g, '')}` : null;
  const showMonument = activeKey !== 'all' && !!lead;   // never on Total market
  const vals = hero.idx.map((p) => p.value);
  const level = vals.length ? vals[vals.length - 1] : 0;

  // ── ROI × DEMAND cross-check (the left read-out). Demand is a RELATIVE beat
  // (sold over estimate) — it can run hot while houses quietly cut estimates,
  // so it's paired with the absolute value trend (annualized appreciation). When
  // lots are beating ask (demand up) but typical values are falling YoY, the
  // tile raises a flag: the heat is beating a softening bar, not real strength.
  // Rendered NEUTRAL and labelled an estimate: appreciationRate is a coarse
  // price-level read, not a verified repeat-comparison index — descriptive
  // figures never wear green/red or a "verified" claim (the CI'd reads live
  // in makerIndex/drills).
  const roi = appreciation;
  const demandHot = hero.unit === 'demand' && level > 0;
  const roiFlag = demandHot && roi != null && roi < -1.5 ? 'beating soft estimates' : undefined;

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
  const sparkPts = useMemo(() => hero.idx.slice(-12).map((p) => p.value), [hero.idx]);
  const closes = (closingNext || []).slice(0, 3);
  const pulseBoard = (
    <div className={styles.pulse} data-play={play ? 'true' : undefined}>
      <div className={styles.pulseHead} aria-hidden>
        <span className={styles.pulseTitle}>Right now</span>
        <span className={styles.pulseLiveTag}><i className={styles.pulseDot} />Live</span>
      </div>

      <div className={styles.pulseGrid}>
        {/* the lead block — the room's population, at display scale */}
        <div className={styles.pulseBlock} data-lead="true">
          <span className={styles.pulseLabel}><RailMark k="onBlock" />On the block</span>
          <span className={styles.pulseValLead}>{fmtInt(onBlockShown)}</span>
          <span className={styles.pulseSub}>lots open across the room</span>
        </div>

        {/* a lone small block spans the row — the bento never shows a hole */}
        {roi != null && (
          <div className={styles.pulseBlock} data-span2={!bc ? 'true' : undefined}
            title="Sales-weighted annualized change in typical sale prices — a coarse price-level estimate, not a verified index read.">
            <span className={styles.pulseLabel}><RailMark k="trend" />Value trend · est.</span>
            <span className={`${styles.pulseVal} ${styles.pctData}`}>{fmtPct(roi)}</span>
            <Spark pts={sparkPts} play={settle} />
            {roiFlag && <span className={styles.pulseFlag}>{roiFlag}</span>}
          </div>
        )}

        {bc && (
          <div className={styles.pulseBlock} data-span2={roi == null ? 'true' : undefined}
            title="Median number of bids drawn per sold lot — a demand primitive from Goldin's bid auctions. Not a price move.">
            <span className={styles.pulseLabel}><RailMark k="bids" />Bid competition</span>
            <span className={styles.pulseVal}>
              {bc.now}
              <em className={styles.pulseUnit}>bids/lot</em>
              {bc.dir && <i className={styles.pulseDir} data-dir={bc.dir} aria-hidden>{bc.dir === 'up' ? '▲' : '▼'}</i>}
            </span>
          </div>
        )}

        {/* the one action on the board — butter, full width, unmissable */}
        {belowMkt ? (
          <button type="button" className={styles.pulseAction} onClick={onOpenBelow}
            aria-label={`${belowMkt} below-market lots — see them`}>
            <span className={styles.pulseLabel}><RailMark k="below" />Below market now</span>
            <span className={styles.pulseActionVal}>{fmtInt(belowShown)}<em className={styles.pulseGo} aria-hidden>↗</em></span>
          </button>
        ) : (
          <div className={styles.pulseBlock} data-span2="true">
            <span className={styles.pulseLabel}><RailMark k="below" />Below market now</span>
            <span className={styles.pulseVal}>—</span>
            <span className={styles.pulseSub}>no flags in the live book</span>
          </div>
        )}
      </div>

      {closes.length > 0 && (
        <div className={styles.pulseTicker} aria-label="Auctions closing next">
          <span className={styles.pulseTickerLabel}>Closing next</span>
          <span className={styles.pulseTickerChips}>
            {closes.map((c) => (
              <span key={c.house} className={styles.pulseChip} data-tonight={relDay(c.when) === 'tonight' ? 'true' : undefined}>
                {c.house}<em>{relDay(c.when)}</em>
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );


  // ── MOBILE: its own scene — a compact "index card" (a premium trading-app
  // asset tile), NOT the desktop slab scaled down.
  if (isMobile) {
    return (
      <LazyMotion features={domAnimation} strict>
        <section className={styles.mHero}>
          <m.div className={styles.mtMastheadM} {...rise(0.03)}>
            <span className={styles.sectionKicker}>{hero.kicker}</span>
            {serialNo && <span className={styles.mtSerial}>{serialNo}</span>}
          </m.div>

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
              Settles AFTER the tape. */}
          <m.div className={styles.mRightNow} {...rise(0.64)}>
            {pulseBoard}
            <button type="button" className={styles.cmdPillFull} onClick={onCommand}>
              <kbd className={styles.kbd}>⌘K</kbd>
              <span className={styles.cmdLabel}>Search {fmtInt(totalLots)} lots</span>
              <span className={styles.cmdArrow} aria-hidden>↵</span>
            </button>
          </m.div>
        </section>
      </LazyMotion>
    );
  }

  // ── DESKTOP: "the board and the monument". No numeral wearing the whole
  // market — the masthead is a line, the focal object is the signature
  // instrument at display scale (the strongest honest read, certified where
  // one certifies), and the tape reads down the left like a departures board.
  // The functional rail sits under the monument: glance the state, act.
  return (
    <LazyMotion features={domAnimation} strict>
      {/* data-play gates the CSS choreography (masthead glint, serial stamp,
          rail settle) on the same fresh-arrival contract as the framer rises */}
      <section className={styles.mtHero} data-play={play ? 'true' : undefined}>
        <m.div className={styles.mtMasthead} {...rise(0.04)}>
          <span className={styles.sectionKicker}>{hero.kicker}</span>
          <span className={styles.mtMastheadNote}>
            {activeKey === 'all' ? 'six verticals · the strongest honest read each' : 'the sub-markets · strongest honest read each'}
          </span>
          {serialNo && <span className={styles.mtSerial}>{serialNo}</span>}
        </m.div>

        <div className={styles.mtBoard}>
          <m.div className={styles.mtBoardMain} {...rise(0.1)}>
            {activeKey === 'all'
              ? <MarketTape market={market} demandAll={demandAll} realized={realized} play={play} />
              : <SubTape market={market} activeKey={activeKey} play={play} />}
          </m.div>

          <m.aside className={styles.mtSide} {...rise(0.16)}>
            {showMonument && <TapeMonument row={lead!} play={play} />}
            <div className={styles.heroRail} data-under-monument={showMonument ? 'true' : undefined}>
              {pulseBoard}
              <button type="button" className={styles.railCmd} onClick={onCommand}>
                <RailMark k="search" />
                <kbd className={styles.kbd}>⌘</kbd>
                <kbd className={styles.kbd}>K</kbd>
                <span className={styles.cmdLabel}>Search {fmtInt(totalLots)} lots</span>
                <span className={styles.cmdArrow} aria-hidden>↵</span>
              </button>
            </div>
          </m.aside>
        </div>
      </section>
    </LazyMotion>
  );
}
