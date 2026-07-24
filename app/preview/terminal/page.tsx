'use client';

import { useMemo } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import { useRayData } from '../../hooks/useRayData';
import { MARKETS } from '../../constants';
import RollingNumber from './RollingNumber';
import MarketChart from './MarketChart';
import Tape from './Tape';
import RecordBoard from './RecordBoard';
import MoversGrid from './MoversGrid';
import Sparkline from './Sparkline';
import {
  fmtInt,
  fmtDelta,
  fmtMoneyCompact,
  useMediaQuery,
  useMounted,
  useReducedMotion,
} from './hooks';
import styles from './style.module.css';

/* ============================================================
   THE TERMINAL — lectr's substance-forward landing prototype.
   "Bloomberg for collectibles." The product IS the hero: a live
   intelligence dashboard that resolves in the first second.
   Renders entirely from EAGER phase-1 data (useRayData); never
   triggers the full/archive tiers. Distinct desktop + mobile
   compositions (re-authored, not squished).
   ============================================================ */

const EASE = [0.23, 1, 0.32, 1] as const;

// ── derive the headline numbers from eager data ──────────────
function useTerminalModel() {
  const { meta, market, tape, backtest, allLots, totalLots, totalSold } = useRayDataAdapter();

  return useMemo(() => {
    const all = market?.markets?.all;
    const idx = all?.index ?? [];
    const vals = idx.map((p) => p.value);
    const level = vals.length ? vals[vals.length - 1] : 100;
    const prev = vals.length > 1 ? vals[vals.length - 2] : level;
    const yrAgo = vals.length > 4 ? vals[vals.length - 5] : vals[0] ?? level;
    const dQ = prev ? ((level - prev) / prev) * 100 : 0;
    const dY = yrAgo ? ((level - yrAgo) / yrAgo) * 100 : 0;
    const sellThrough = all?.sellThrough?.length
      ? all.sellThrough[all.sellThrough.length - 1].value
      : null;

    // the flagged edge — honest hammer-basis beat over unflagged
    const flaggedMed = backtest?.flagged?.hammerMedianPct ?? backtest?.flagged?.medianPerfPct ?? null;
    const unflaggedMed =
      backtest?.unflagged?.hammerMedianPct ?? backtest?.unflagged?.medianPerfPct ?? null;
    const edge =
      flaggedMed != null && unflaggedMed != null ? flaggedMed - unflaggedMed : null;
    const beatHigh = backtest?.flagged?.beatHighPct ?? null;

    // below-market signals in the current live book
    const belowMkt = allLots.filter((l) => l.signal?.label === 'Below Market').length;

    return {
      level,
      dQ,
      dY,
      sellThrough,
      indexSeries: idx,
      sparkAll: vals.slice(-12),
      tapeAll: tape.all ?? tape[Object.keys(tape)[0]] ?? [],
      totalLots: totalLots ?? allLots.length,
      totalSold: totalSold ?? 0,
      houses: meta.houses,
      makers: meta.makers,
      edge,
      flaggedMed,
      beatHigh,
      flaggedN: backtest?.flagged?.n ?? null,
      belowMkt,
    };
  }, [market, tape, backtest, allLots, totalLots, totalSold, meta]);
}

// Thin adapter so the model reads a stable shape from useRayData.
function useRayDataAdapter() {
  const d = useRayData();
  return {
    meta: {
      houses: d.sources.length || 7,
      makers: 38,
    },
    market: d.market,
    tape: d.tape,
    backtest: d.backtest,
    allLots: d.allLots,
    totalLots: d.totalLots,
    totalSold: d.totalSold,
    loading: d.loading,
    lastCrawl: d.lastCrawl,
  };
}

export default function TerminalPage() {
  const mounted = useMounted();
  const isMobile = useMediaQuery('(max-width: 820px)', false);
  const model = useTerminalModel();
  const { lastCrawl } = useRayDataAdapter();

  return (
    <LazyMotion features={domAnimation} strict>
      <div className={styles.root} data-mounted={mounted}>
        <div className={styles.bgField} aria-hidden />
        <div className={styles.grain} aria-hidden />
        {mounted && isMobile ? (
          <MobileComposition model={model} lastCrawl={lastCrawl} />
        ) : (
          <DesktopComposition model={model} lastCrawl={lastCrawl} />
        )}
      </div>
    </LazyMotion>
  );
}

type Model = ReturnType<typeof useTerminalModel>;

// ── shared: the top status bar ──────────────────────────────
function StatusBar({ lastCrawl, houses }: { lastCrawl: string; houses: number }) {
  const day = lastCrawl ? lastCrawl.slice(0, 10) : '';
  return (
    <div className={styles.statusBar}>
      <span className={styles.wordmark}>
        lectr<span className={styles.wordmarkDot}>.</span>
      </span>
      <span className={styles.statusMeta}>
        <span className={styles.liveDot} aria-hidden />
        LIVE
      </span>
      <span className={styles.statusSep} aria-hidden />
      <span className={styles.statusItem}>{houses} houses</span>
      <span className={styles.statusSep} aria-hidden />
      <span className={styles.statusItem}>
        crawled {day || '—'}
      </span>
    </div>
  );
}

// ── shared: the ⌘K command CTA ──────────────────────────────
function CommandCTA({ full }: { full?: boolean }) {
  return (
    <button type="button" className={full ? styles.cmdPillFull : styles.cmdPill}>
      <kbd className={styles.kbd}>⌘</kbd>
      <kbd className={styles.kbd}>K</kbd>
      <span className={styles.cmdLabel}>Search 507,107 lots</span>
      <span className={styles.cmdArrow} aria-hidden>
        ↵
      </span>
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════
   DESKTOP — a live intelligence dashboard on load.
   ══════════════════════════════════════════════════════════════ */
function DesktopComposition({ model, lastCrawl }: { model: Model; lastCrawl: string }) {
  const reduce = useReducedMotion();
  const { market } = useRayDataAdapter();

  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 16, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.6, ease: EASE, delay: reduce ? 0 : delay },
  });

  return (
    <div className={styles.deskShell}>
      <StatusBar lastCrawl={lastCrawl} houses={model.houses} />

      {/* ── HERO: the index glyph + the chart drawing in beside it ── */}
      <section className={styles.hero}>
        <m.div className={styles.heroLeft} {...rise(0.05)}>
          <span className={styles.sectionKicker}>lectr market index · total collectibles</span>
          <div className={styles.heroNumberRow}>
            <RollingNumber
              className={styles.heroNumber}
              value={model.level}
              from={reduce ? model.level : Math.max(0, model.level - 22)}
              format={(n) => n.toFixed(1)}
              duration={1500}
              delay={220}
            />
            <div className={styles.heroDeltas}>
              <span className={styles.heroDelta} data-dir={model.dQ >= 0 ? 'up' : 'down'}>
                {fmtDelta(model.dQ)} <em>quarter</em>
              </span>
              <span className={styles.heroDelta} data-dir={model.dY >= 0 ? 'up' : 'down'}>
                {fmtDelta(model.dY)} <em>year</em>
              </span>
            </div>
          </div>
          <p className={styles.heroThesis}>
            Bloomberg for collectibles. One dollar-normalized index across art,
            watches, design, sports, science &amp; culture —{' '}
            <strong>{fmtInt(model.totalLots)}</strong> lots,{' '}
            <strong>{fmtInt(model.totalSold)}</strong> sold, back to 1999.
          </p>
          <div className={styles.heroStats}>
            <Stat label="Sell-through" value={model.sellThrough != null ? `${model.sellThrough}%` : '—'} />
            <Stat
              label="Below-market now"
              value={model.belowMkt ? fmtInt(model.belowMkt) : '—'}
            />
            <Stat
              label="Flagged edge"
              value={model.edge != null ? `+${model.edge}pt` : '—'}
              accent
            />
          </div>
          <CommandCTA />
        </m.div>

        <m.div className={styles.heroRight} {...rise(0.16)}>
          <div className={styles.chartCard}>
            <div className={styles.chartCardHead}>
              <span>Index · quarterly cohort</span>
              <span className={styles.chartCardTag}>rebased 100 · smoothed</span>
            </div>
            <MarketChart data={model.indexSeries} play height={300} />
          </div>
        </m.div>
      </section>

      {/* ── the live tape ── */}
      <m.section className={styles.tapeSection} {...rise(0.26)}>
        <span className={styles.tapeLabel}>Realized</span>
        <Tape items={model.tapeAll} />
      </m.section>

      {/* ── movers grid + backtest edge side by side ── */}
      <section className={styles.midGrid}>
        <div className={styles.midGridMain}>
          <MoversGrid market={market} />
        </div>
        <aside className={styles.edgeCard}>
          <span className={styles.sectionKicker}>The track record</span>
          <h3 className={styles.edgeTitle}>We publish our edge.</h3>
          <div className={styles.edgeStatBig}>
            <RollingNumber
              value={model.beatHigh ?? 0}
              format={(n) => `${n.toFixed(0)}%`}
              className={styles.edgeStatNum}
              duration={1200}
            />
            <span className={styles.edgeStatCap}>
              of flagged lots beat their high estimate
            </span>
          </div>
          <div className={styles.edgeRows}>
            <EdgeRow
              label="Flagged median (hammer)"
              value={model.flaggedMed != null ? fmtDelta(model.flaggedMed, 0) : '—'}
              dir={model.flaggedMed != null && model.flaggedMed >= 0 ? 'up' : 'down'}
            />
            <EdgeRow label="Edge vs unflagged" value={model.edge != null ? `+${model.edge}pt` : '—'} dir="up" />
            <EdgeRow label="Sample size" value={model.flaggedN ? fmtInt(model.flaggedN) : '—'} />
          </div>
          <p className={styles.edgeFoot}>
            Backtested on sold history · hammer basis · exclusions published.
          </p>
        </aside>
      </section>

      {/* ── the record board ── */}
      <section className={styles.recordSection}>
        <RecordBoard variant="desktop" />
      </section>

      <footer className={styles.footer}>
        <span>lectr · auction intelligence</span>
        <span className={styles.footerMuted}>
          Prototype · “The Terminal” · reads eager phase-1 data only
        </span>
      </footer>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className={styles.stat} data-accent={accent ? 'true' : undefined}>
      <span className={styles.statVal}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </span>
  );
}

function EdgeRow({ label, value, dir }: { label: string; value: string; dir?: 'up' | 'down' }) {
  return (
    <div className={styles.edgeRow}>
      <span className={styles.edgeRowLabel}>{label}</span>
      <span className={styles.edgeRowVal} data-dir={dir}>
        {value}
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MOBILE — a re-authored single-column card feed. Not squished:
   different composition, thumb-reachable, full-bleed cards.
   ══════════════════════════════════════════════════════════════ */
function MobileComposition({ model, lastCrawl }: { model: Model; lastCrawl: string }) {
  const reduce = useReducedMotion();
  const { market } = useRayDataAdapter();

  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 14, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.55, ease: EASE, delay: reduce ? 0 : delay },
  });

  return (
    <div className={styles.mobShell}>
      <StatusBar lastCrawl={lastCrawl} houses={model.houses} />

      {/* the index-number card */}
      <m.section className={styles.mobIndexCard} {...rise(0.05)}>
        <span className={styles.sectionKicker}>lectr index · total market</span>
        <RollingNumber
          className={styles.mobIndexNum}
          value={model.level}
          from={reduce ? model.level : Math.max(0, model.level - 22)}
          format={(n) => n.toFixed(1)}
          duration={1500}
          delay={200}
        />
        <div className={styles.mobDeltas}>
          <span className={styles.heroDelta} data-dir={model.dQ >= 0 ? 'up' : 'down'}>
            {fmtDelta(model.dQ)} <em>Q</em>
          </span>
          <span className={styles.heroDelta} data-dir={model.dY >= 0 ? 'up' : 'down'}>
            {fmtDelta(model.dY)} <em>Y</em>
          </span>
        </div>
        <div className={styles.mobSpark}>
          <Sparkline
            data={model.sparkAll}
            dir={model.dY >= 0 ? 'up' : 'down'}
            width={300}
            height={64}
            strokeWidth={1.6}
          />
        </div>
        <p className={styles.mobThesis}>
          Bloomberg for collectibles — <strong>{fmtInt(model.totalLots)}</strong> lots
          across {model.houses} houses.
        </p>
      </m.section>

      {/* the tape */}
      <m.section className={styles.mobTape} {...rise(0.14)}>
        <span className={styles.tapeLabel}>Realized</span>
        <Tape items={model.tapeAll} speed={48} />
      </m.section>

      {/* top-movers cards */}
      <m.section className={styles.mobMovers} {...rise(0.2)}>
        <MobileMovers market={market} />
      </m.section>

      {/* the record board as a scroll list */}
      <section className={styles.mobRecords}>
        <RecordBoard variant="mobile" />
      </section>

      {/* edge card */}
      <m.section className={styles.mobEdge} {...rise(0)}>
        <span className={styles.sectionKicker}>The track record</span>
        <div className={styles.mobEdgeNum}>
          <RollingNumber value={model.beatHigh ?? 0} format={(n) => `${n.toFixed(0)}%`} />
        </div>
        <span className={styles.edgeStatCap}>of flagged lots beat their high estimate</span>
      </m.section>

      {/* the search pill (sticky, thumb-reachable) */}
      <div className={styles.mobSearchDock}>
        <CommandCTA full />
      </div>

      <footer className={styles.mobFooter}>
        lectr · prototype “The Terminal” · eager data only
      </footer>
    </div>
  );
}

// Mobile movers = compact cards (no wide table). Reuses the model derivation.
function MobileMovers({ market }: { market: import('../../hooks/useRayData').MarketData | null }) {
  const rows = useMemo(() => {
    if (!market?.markets) return [];
    return MARKETS.filter((m2) => m2.key !== 'all')
      .map((mk) => {
        const s = market.markets[mk.key];
        if (!s?.index?.length) return null;
        const vals = s.index.map((p) => p.value);
        const last = vals[vals.length - 1];
        const ref = vals.length > 4 ? vals[vals.length - 5] : vals[0];
        const delta = ref ? ((last - ref) / ref) * 100 : 0;
        return {
          key: mk.key,
          label: mk.label,
          last,
          delta,
          spark: vals.slice(-10),
          dir: (delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat') as 'up' | 'down' | 'flat',
        };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs((b as { delta: number }).delta) - Math.abs((a as { delta: number }).delta)) as {
      key: string;
      label: string;
      last: number;
      delta: number;
      spark: number[];
      dir: 'up' | 'down' | 'flat';
    }[];
  }, [market]);

  if (!rows.length) return null;

  return (
    <>
      <div className={styles.moversHead}>
        <div>
          <span className={styles.sectionKicker}>Top Movers · 1Y</span>
          <h2 className={styles.moversTitle}>Every vertical.</h2>
        </div>
      </div>
      <div className={styles.mobMoverList}>
        {rows.map((r) => (
          <div key={r.key} className={styles.mobMoverCard}>
            <div className={styles.mobMoverTop}>
              <span className={styles.mobMoverName}>
                <span className={styles.moversTick} data-dir={r.dir} aria-hidden />
                {r.label}
              </span>
              <span className={styles.moversDelta} data-dir={r.dir}>
                {fmtDelta(r.delta)}
              </span>
            </div>
            <div className={styles.mobMoverBot}>
              <span className={styles.mobMoverIndex}>{r.last.toFixed(0)}</span>
              <Sparkline data={r.spark} dir={r.dir} width={110} height={30} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
