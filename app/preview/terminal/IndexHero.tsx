'use client';

import { useMemo } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import type { MarketData, DemandPoint, DemandByMarket, RealizedByMarket } from '../../hooks/useRayData';
import type { RealizedPoint, BidCompetitionPoint } from '../../types';
import type { Market } from '../../constants';
import type { HeroPoint } from './HeroChart';
import { MarketTape, SubTape, TapeMonument, pickLead } from './MarketTape';
import { fmtInt, useReducedMotion } from './hooks';
import { fmtPct } from './verified';
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
}: Props) {
  const reduce = useReducedMotion();
  const hero = useHeroSeries(activeKey, demand, realized);
  const lead = useMemo(() => pickLead(market, demandAll, realized, activeKey), [market, demandAll, realized, activeKey]);
  const serialNo = serial ? `NO. ${String(serial).slice(0, 10).replace(/-/g, '')}` : null;
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


  // ── MOBILE: its own scene — a compact "index card" (a premium trading-app
  // asset tile), NOT the desktop slab scaled down.
  if (isMobile) {
    return (
      <LazyMotion features={domAnimation} strict>
        <section className={styles.mHero}>
          <m.div className={styles.mtMastheadM} {...rise(0.03)}>
            <span className={styles.mtStatement}>We find what the room <em>misprices</em>.</span>
            {serialNo && <span className={styles.mtSerial}>{serialNo}</span>}
          </m.div>

          {lead && (
            <m.div className={styles.mtMonWrapM} {...rise(0.07)}>
              <TapeMonument row={lead} play={play} />
            </m.div>
          )}

          <m.div className={styles.mtStage} {...rise(0.12)}>
            {activeKey === 'all'
              ? <MarketTape market={market} demandAll={demandAll} realized={realized} play={play} omit={lead?.key} />
              : <SubTape market={market} activeKey={activeKey} play={play} />}
          </m.div>

          {/* touch device: the input look, no keyboard glyphs */}
          <button type="button" className={styles.vtCmd} onClick={onCommand} aria-label={`Search ${fmtInt(totalLots)} lots`}>
            <span className={styles.vtCmdGlass} aria-hidden>⌕</span>
            <span className={styles.vtCmdPlaceholder}>Search {fmtInt(totalLots)} lots, makers, references…</span>
          </button>

          <m.div className={styles.mHeroStats} {...rise(0.16)}>
            {roi != null && (
              <span className={styles.mStat} title="Sales-weighted annualized change in typical sale prices — a coarse price-level estimate, not a verified index read.">
                <span className={`${styles.mStatVal} ${styles.pctData}`}>{fmtPct(roi)}</span>
                <span className={styles.mStatLabel}>Value trend · est.</span>
              </span>
            )}
            {bc ? (
              <span className={styles.mStat} title="Median bids drawn per sold lot — a demand primitive from Goldin's bid auctions. Not a price move.">
                <span className={styles.mStatVal}>{bc.now}</span>
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
      <section className={styles.mtHero}>
        <m.div className={styles.mtMasthead} {...rise(0.04)}>
          {/* the value proposition, VISIBLE. It lived in a 1x1px sr-only h1
              while humans got a 14px label — the pitch the paper room makes
              two screens down now opens the page. */}
          <span className={styles.mtStatement}>We find what the room <em>misprices</em>.</span>
          <span className={styles.mtMastheadNote}>
            {activeKey === 'all' ? `${hero.kicker.toLowerCase()} · the strongest honest read of each vertical` : `${hero.kicker.toLowerCase()} · its strongest honest reads`}
          </span>
          {serialNo && <span className={styles.mtSerial}>{serialNo}</span>}
        </m.div>

        <div className={styles.mtBoard}>
          <m.div className={styles.mtBoardMain} {...rise(0.1)}>
            {activeKey === 'all'
              ? <MarketTape market={market} demandAll={demandAll} realized={realized} play={play} omit={lead?.key} />
              : <SubTape market={market} activeKey={activeKey} play={play} />}
          </m.div>

          <m.aside className={styles.mtSide} {...rise(0.16)}>
            {lead && <TapeMonument row={lead} play={play} />}
            <div className={styles.heroRail} data-under-monument={lead ? 'true' : undefined}>
              <div className={styles.railRow}>
                <span className={styles.railLabel}>On the block</span>
                <span className={styles.railVal}>{fmtInt(onBlock)}</span>
              </div>
              {roi != null && (
                <div className={styles.railRow} title="Sales-weighted annualized change in typical sale prices — a coarse price-level estimate, not a verified index read.">
                  <span className={styles.railLabel}>Value trend · est.</span>
                  <span className={`${styles.railVal} ${styles.pctData}`}>{fmtPct(roi)}</span>
                </div>
              )}
              {roiFlag && <div className={styles.railFlagLine}>{roiFlag}</div>}
              {bc && (
                <div className={styles.railRow} title="Median number of bids drawn per sold lot — a demand primitive from Goldin's bid auctions. Not a price move.">
                  <span className={styles.railLabel}>Bid competition</span>
                  <span className={styles.railVal}>{bc.now} bids/lot</span>
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
              {/* the single most powerful action on the page, dressed as an
                  INPUT rather than a fourth stat row */}
              <button type="button" className={styles.vtCmd} onClick={onCommand} aria-label={`Search ${fmtInt(totalLots)} lots`}>
                <span className={styles.vtCmdGlass} aria-hidden>⌕</span>
                <span className={styles.vtCmdPlaceholder}>Search {fmtInt(totalLots)} lots, makers, references…</span>
                <span className={styles.vtCmdKeys} aria-hidden>
                  <kbd className={styles.vtKbd}>⌘</kbd><kbd className={styles.vtKbd}>K</kbd>
                </span>
              </button>
            </div>
          </m.aside>
        </div>
      </section>
    </LazyMotion>
  );
}
