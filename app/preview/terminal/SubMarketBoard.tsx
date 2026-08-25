'use client';

import { useEffect, useId, useMemo, useState, useRef } from 'react';
import Link from 'next/link';
import { AnimatePresence, LazyMotion, domAnimation, m } from 'framer-motion';
import type { MarketData, SubMarketRead } from '../../hooks/useRayData';
import { ARTIST_LABEL, type Market } from '../../constants';
import type { AuctionLot } from '../../types';
import { formatPrice, httpsImg } from '../../utils';
import { fmtInt, fmtMoneyCompact, useInView, useReducedMotion } from './hooks';
import { fmtPct } from './verified';
import { daysWord } from '../../components/Terminal';
import { confidenceMeter } from '../../components/LotCard';
import MarketIcon from '../../components/MarketIcon';
import styles from './style.module.css';

/* ============================================================
   ROOM A — "THE VALUE ENGINE" · the platform's sell, in three
   chapters down one page axis:

     01 · THE ENGINE — live lots the engine has flagged under
          their comparables: real plates with the read spelled
          out (est vs where comps actually sell), plus the
          method in one honest line. Picked to NOT duplicate
          Tonight's Wall above.
     02 · THE MARKETS — the verified board: the scoped read as
          a monument (95% CI beam — the range IS the headline)
          over the full-market tape. Plate & Tape grammar.
     03 · THE RECEIPT — the backtest, printed as an actual
          thermal receipt: perforated edges, mono line items,
          the replay seal stamped in red ink, a barcode footer.
          It PRINTS itself on scroll. Fun, but every figure on
          it is real — stamped, never spun.

   Typography: Fraunces speaks in the headline + monument; Plex
   Mono in percent-change figures — and on the receipt, which
   is a printed ARTIFACT, mono carries the whole slip.
   ============================================================ */

const EASE = [0.22, 1, 0.36, 1] as const;

interface Receipts {
  flaggedPct: number;
  unflaggedPct: number;
  /** hammer-only basis (backtest ships dual basis; the fine print names both) */
  flaggedHammerPct?: number | null;
  unflaggedHammerPct?: number | null;
  n: number;
  asOf?: string | null;
}

/** the chapter-01 hero: the highest-confidence, deepest-value flagged lot */
export interface EngineHeroData {
  lot: AuctionLot;
  signal: { pct: number; basis?: number; med?: number; confidence?: 'very-high' | 'high' | 'medium' | 'low' };
}

interface Props {
  market: MarketData | null;
  activeKey: Market;
  variant?: 'desktop' | 'mobile';
  /** printed on the paper room (home) — the Value Engine treatment */
  paper?: boolean;
  /** the backtest receipts — flagged/unflagged median % + replayed count */
  receipts?: Receipts | null;
  /** chapter 01: the single hero lot the engine showcases */
  hero?: EngineHeroData | null;
  /** open a showcased lot in the comparables modal */
  onOpenLot?: (lot: AuctionLot) => void;
}

const demandStrength = (r: SubMarketRead) => r.demandNow ?? -Infinity;

// THE MARQUEE (Collin's curation, Aug 4 2026) — the eight reads that open the
// board on the all-markets view, in this order. Matched case-insensitively
// against the row label, and drawn from BOTH pools: the specific ones are
// drills (a card era, one watch reference, a game-used category), the "(all)"
// ones are maker/collection-level reads that live in subMarkets. Any name that
// stops resolving simply drops out — the blend behind it still fills the board.
const FEATURED: string[] = [
  'classic cards (1980–99)',   // sports · card era
  'daytona · rolex',           // watches · reference
  'pablo picasso',             // art · maker, all work
  'george nakashima',          // design · maker, all work
  'fossils & dinosaurs',       // science · collection, all
  'andy warhol',               // art · maker, all work
  'vintage cards (pre-1980)',  // sports · card era
  'basketball · game-used',    // sports · game used
];

/** Where a board row points. Drills carry a `vertical:slug` key and own a
 *  /sub/<a>/<b> page; maker & collection reads (subMarkets) carry a single-
 *  segment slug and live at /makers/<slug>. Routing them all to /sub/ would
 *  404 every maker row, since /sub/[a]/[b] needs two segments. */
function rowHref(r: SubMarketRead): string {
  return r.slug.includes(':') ? `/sub/${r.slug.replace(':', '/')}` : `/makers/${r.slug}`;
}

function resolveRows(market: MarketData | null, activeKey: Market): SubMarketRead[] {
  // THE TAXONOMY (drills): cards by era & sport, watch families, art kinds,
  // design materials — the flagship sub-market work. (Was market.subMarkets,
  // the older per-maker reads; those now live in the Verified movers band.)
  const sm = market?.drills as Record<string, SubMarketRead[]> | undefined;
  if (!sm) return [];
  if (activeKey === 'all') {
    const all: SubMarketRead[] = Object.values(sm).flat();
    const index = all
      .filter((r) => r.readType === 'index' && r.index)
      .sort((a, b) => Math.abs(b.index!.changePct) - Math.abs(a.index!.changePct));
    const demand = all
      .filter((r) => r.readType === 'demand')
      .sort((a, b) => demandStrength(b) - demandStrength(a));
    // Descriptive rows (no index, no demand read — 43 of the 95 drills, e.g.
    // "Basketball · game-used" at 9,217 lots) were dropped from the ALL view
    // entirely, while every single-market view already ranks them last. That
    // inconsistency also made them unreachable from the marquee. They rank
    // last here too, ordered by depth, and carry no movement number — the
    // honesty ladder is unchanged, they're simply no longer invisible.
    const descriptive = all
      .filter((r) => r.readType === 'descriptive')
      .sort((a, b) => b.lots - a.lots);
    const ranked = [...index, ...demand, ...descriptive];
    // ── BLEND THE CONDENSED VIEW ACROSS MARKETS ──────────────────────────
    // `ranked` puts every 'index' row above every 'demand' row, and the card
    // markets are the ones with repeat-sale INDEXES while art/design/watches
    // carry DEMAND reads — so a straight ranking made the visible top rows
    // (the board caps at 8 before "show all") entirely sports cards, on the
    // view that is supposed to survey the whole market.
    //
    // Round-robin by vertical instead: take each vertical's strongest
    // remaining row in turn, so the condensed board spans art, design,
    // watches, sports, science and culture, and only repeats a vertical once
    // every other one has had a turn. Within a vertical the original
    // strength order is preserved, and EXPANDING still reveals all rows —
    // this reorders the survey, it never hides anything.
    const byVertical = new Map<string, SubMarketRead[]>();
    for (const r of ranked) {
      const v = r.vertical || 'other';
      (byVertical.get(v) || byVertical.set(v, []).get(v)!).push(r);
    }
    // vertical turn order follows each one's strongest row, so the single
    // best read on the board still leads — the blend decides what FOLLOWS it,
    // not what opens it.
    const turns = Array.from(byVertical.keys()).sort(
      (a, b) => ranked.indexOf(byVertical.get(a)![0]) - ranked.indexOf(byVertical.get(b)![0]),
    );
    const blended: SubMarketRead[] = [];
    for (let i = 0; blended.length < ranked.length; i++) {
      let placedThisPass = false;
      for (const v of turns) {
        const q = byVertical.get(v)!;
        if (i < q.length) { blended.push(q[i]); placedThisPass = true; }
      }
      if (!placedThisPass) break; // every queue drained — guard against a spin
    }
    // The marquee draws from BOTH pools. The drills above are sub-market
    // taxonomy (a card era, one watch reference); the curated list also names
    // maker- and collection-level reads ("Picasso, all"), which live in
    // subMarkets — searching only `blended` would silently drop half the
    // marquee. Maker rows are appended to the tail too, so expanding the board
    // reveals them rather than hiding them behind the eight.
    const makerRows: SubMarketRead[] = Object.values(
      (market?.subMarkets as Record<string, SubMarketRead[]> | undefined) ?? {},
    ).flat();
    const pool = [...blended, ...makerRows];
    const featured = FEATURED
      .map((name) => pool.find((r) => r.label.toLowerCase() === name))
      .filter((r): r is SubMarketRead => !!r);
    const featuredSet = new Set(featured);
    return [...featured, ...pool.filter((r) => !featuredSet.has(r))];
  }
  const rows = sm[activeKey] || [];
  const rank = { index: 0, demand: 1, descriptive: 2 } as const;
  return [...rows].sort((a, b) => {
    if (rank[a.readType] !== rank[b.readType]) return rank[a.readType] - rank[b.readType];
    if (a.readType === 'index' && a.index && b.index) return Math.abs(b.index.changePct) - Math.abs(a.index.changePct);
    if (a.readType === 'demand') return demandStrength(b) - demandStrength(a);
    return b.lots - a.lots;
  });
}

// the readType tag, caps-tracked on the tape
function tapeTag(r: SubMarketRead): string {
  if (r.readType === 'index') return r.indexMethod === 'repeat-sale' ? 'Repeat-sale index' : 'Hedonic index';
  if (r.readType === 'demand') return 'Demand read';
  return 'Descriptive — no index';
}

// signed integer for CI terminals: +79 / −4
const fmtCI = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}`;

/* ── THE CI BEAM — the caliper. A 1px rule, tick terminals at the
   95% bounds, a solid diamond at the point estimate. Never a slider. */
export function CIBeam({ lo, hi, point, dir, mini = false, play = true, large = false, delay = 0 }: {
  lo: number; hi: number; point: number; dir?: 'up' | 'down'; mini?: boolean; play?: boolean; large?: boolean;
  /** extra seconds before the draw — lets a beam draw WITH its tape row */
  delay?: number;
}) {
  // the beam IS the interval: lo→hi spans the instrument, terminals at the
  // ends, the diamond at the point estimate. Zero gets a dashed witness tick
  // only when the interval actually crosses it.
  const span = (hi - lo) || 1;
  const pad = span * 0.06;
  const x = (v: number) => ((v - lo + pad) / (span + pad * 2)) * 100;
  const tick = mini ? 4 : 6;   // half-height of terminals
  const dia = mini ? 3.2 : 5;  // half-diagonal of the diamond
  return (
    <div className={`${mini ? styles.beamMini : styles.beam}${large ? ` ${styles.beamLarge}` : ''}`} data-dir={dir} aria-hidden>
      {!mini && <span className={styles.beamLabel}>95% confidence range</span>}
      <div className={styles.beamStage}>
        <m.svg
          viewBox="0 0 100 24" preserveAspectRatio="none" className={styles.beamSvg}
          initial={play ? { scaleX: 0.6, opacity: 0 } : false}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.3 + delay }}
        >
          <line x1={x(lo)} y1="12" x2={x(hi)} y2="12" className={styles.beamRule} vectorEffect="non-scaling-stroke" />
          <line x1={x(lo)} y1={12 - tick} x2={x(lo)} y2={12 + tick} className={styles.beamRule} vectorEffect="non-scaling-stroke" />
          <line x1={x(hi)} y1={12 - tick} x2={x(hi)} y2={12 + tick} className={styles.beamRule} vectorEffect="non-scaling-stroke" />
          {lo < 0 && hi > 0 && (
            <line x1={x(0)} y1={12 - tick - 2} x2={x(0)} y2={12 + tick + 2} className={styles.beamZero} vectorEffect="non-scaling-stroke" />
          )}
        </m.svg>
        <m.span
          className={styles.beamDiamond}
          style={{ left: `${x(point)}%`, width: dia * 2, height: dia * 2 }}
          initial={play ? { scale: 0 } : false}
          animate={{ scale: 1 }}
          transition={{ duration: 0.18, ease: EASE, delay: play ? 0.8 + delay : 0 }}
        />
      </div>
      {!mini && (
        <div className={styles.beamEnds}>
          <span className={styles.pctData}>{fmtCI(lo)}</span>
          <span className={styles.pctData}>{fmtCI(hi)}</span>
        </div>
      )}
    </div>
  );
}

/* ── the demand line — the real quarterly series over its median. */
export function DemandLine({ series, mini = false, dir }: { series: { period: string; value: number }[]; mini?: boolean; dir?: 'up' | 'down' }) {
  const gid = useId();
  const pts = useMemo(() => {
    // decimate to ≤48 points
    const step = Math.max(1, Math.ceil(series.length / 48));
    const vals = series.filter((_, i) => i % step === 0 || i === series.length - 1).map((s) => s.value);
    if (vals.length < 2) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = (hi - lo) || 1;
    const px = (i: number) => (i / (vals.length - 1)) * 100;
    const py = (v: number) => 66 - ((v - lo) / span) * 60;
    return {
      d: vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(2)} ${py(v).toFixed(2)}`).join(' '),
      medianY: py(median),
      endY: py(vals[vals.length - 1]),
      first: series[0].period,
      last: series[series.length - 1].period,
    };
  }, [series]);
  if (!pts) return null;
  return (
    <div className={mini ? styles.demandLineMini : styles.demandLine} data-dir={dir} aria-hidden>
      <svg viewBox="0 0 100 72" preserveAspectRatio="none" className={styles.demandSvg}>
        {/* the area under the line — Robinhood's gradient wash. Stops ride
            currentColor at falling opacity, so it only appears on surfaces
            that set a color on the svg (the hero); paper boards stay ink. */}
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${pts.d} L 100 72 L 0 72 Z`} fill={`url(#${gid})`} stroke="none" className={styles.demandFill} />
        <line x1="0" y1={pts.medianY} x2="100" y2={pts.medianY} className={styles.demandBase} vectorEffect="non-scaling-stroke" />
        <path d={pts.d} className={styles.demandPath} fill="none" vectorEffect="non-scaling-stroke" />
        <circle cx="100" cy={pts.endY} r="2.6" className={styles.demandDot} />
      </svg>
      {!mini && (
        <div className={styles.demandEnds}>
          <span>{pts.first}</span>
          <span>sold over estimate · by quarter</span>
          <span>{pts.last}</span>
        </div>
      )}
    </div>
  );
}

/* ── THE MONUMENT — the scoped read as an engraved plate.
   Fixed-height zone; the figure stamps in whole (clip reveal). */
function Monument({ r, play }: { r: SubMarketRead; play: boolean }) {
  const stamp = {
    initial: play ? { clipPath: 'inset(100% 0 0 0)', opacity: 0.6 } : false,
    animate: { clipPath: 'inset(0% 0 0 0)', opacity: 1 },
    transition: { duration: 0.7, ease: EASE, delay: 0.15 },
  } as const;

  if (r.readType === 'index' && r.index) {
    const dir = r.index.changePct >= 0 ? 'up' : 'down';
    return (
      // no single point figure — a lone "+86.9%" reads as a precise market
      // headline when the honest picture is the 95% RANGE. The beam is the
      // monument; the number lives on its own row in the tape below.
      <div className={styles.monBody}>
        <m.div className={styles.monBeamStamp} {...stamp}>
          <CIBeam lo={r.index.ciLoPct} hi={r.index.ciHiPct} point={r.index.changePct} dir={dir} play={play} large />
        </m.div>
        <div className={styles.monChip}>{tapeTag(r)} · {r.index.horizon} · {fmtInt(r.lots)} lots</div>
        {r.bidCompNow != null && <div className={styles.monBids}>{r.bidCompNow} median bids per lot</div>}
      </div>
    );
  }

  if (r.readType === 'demand' && r.demandNow != null) {
    return (
      <div className={styles.monBody}>
        <m.div className={styles.monFigureRow} {...stamp}>
          <span className={styles.monFigure}>
            <sup>{r.demandNow >= 0 ? '+' : '−'}</sup>
            {Math.abs(r.demandNow).toFixed(1)}
            <sup>%</sup>
          </span>
          <span className={styles.monHorizon}>demand now</span>
        </m.div>
        {r.demandSeries.length >= 2 && <DemandLine series={r.demandSeries} />}
        <div className={styles.monChip}>Demand read · quarterly · {fmtInt(r.lots)} lots</div>
      </div>
    );
  }

  // descriptive — the abstention worn as the room's most confident badge
  return (
    <div className={styles.monBody}>
      <m.div className={styles.monFigureRow} {...stamp}>
        <span className={`${styles.monFigure} ${styles.monFigureDesc}`}>
          <span className={styles.monDescLabel}>Typical</span>{' '}
          {r.typicalUsd != null ? fmtMoneyCompact(r.typicalUsd) : '—'}
        </span>
      </m.div>
      {r.record && <div className={styles.monRecordLine}>Record {fmtMoneyCompact(r.record.usd)}</div>}
      <div className={styles.monChip} data-abstain="true">Descriptive market — no index published</div>
    </div>
  );
}

/* ── THE REPLAY SEAL — a line-drawn hallmark; draws once on entry. */
function ReplaySeal({ n, play }: { n: number; play: boolean }) {
  const draw = (delay: number) => ({
    initial: play ? { pathLength: 0 } : false,
    animate: { pathLength: 1 },
    transition: { duration: 0.9, ease: 'easeOut' as const, delay },
  });
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const r1 = 40, r2 = 45;
    return { x1: 48 + Math.cos(a) * r1, y1: 48 + Math.sin(a) * r1, x2: 48 + Math.cos(a) * r2, y2: 48 + Math.sin(a) * r2 };
  });
  return (
    <div className={styles.seal} aria-label={`Replayed against ${fmtInt(n)} historical sales`}>
      <svg viewBox="0 0 96 96">
        <m.circle cx="48" cy="48" r="46" {...draw(0)} />
        <m.circle cx="48" cy="48" r="38" {...draw(0.15)} />
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className={styles.sealTick} />
        ))}
        {/* the gavel: two parallel head strokes over a baseline dash */}
        <m.line x1="34" y1="40" x2="52" y2="52" {...draw(0.5)} />
        <m.line x1="38" y1="34" x2="56" y2="46" {...draw(0.55)} />
        <m.line x1="50" y1="42" x2="62" y2="30" {...draw(0.6)} />
        <m.line x1="36" y1="62" x2="60" y2="62" strokeDasharray="4 3" {...draw(0.7)} />
      </svg>
    </div>
  );
}

/* ── section glyphs — the constructed-mark language, one per chapter:
   the engine (a gear/mechanism), the markets (an index of bars), the receipt
   (a perforated settlement slip). 24-grid, currentColor, round caps. ── */
const CHAPTER_GLYPHS: Record<string, React.ReactNode> = {
  'the engine': (
    <>
      <circle cx="12" cy="12" r="4.1" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <path d="M12 3.9v2.3M12 17.8v2.3M3.9 12h2.3M17.8 12h2.3M6.4 6.4l1.6 1.6M16 16l1.6 1.6M17.6 6.4l-1.6 1.6M6.4 17.6l1.6-1.6" />
    </>
  ),
  'the markets': (
    <>
      <path d="M4 19h16" />
      <path d="M7 19v-5M12 19V8.5M17 19v-8" />
    </>
  ),
  'the receipt': (
    <>
      <path d="M7 4.5h10v13l-1.65-1.15-1.6 1.15-1.65-1.15-1.6 1.15-1.65-1.15L7 17.5z" />
      <path d="M10 8.6h4M10 11.6h4" />
    </>
  ),
};

/* ── a chapter marker — "01 · The engine", hairlines either side ── */
function Chapter({ no, label }: { no: string; label: string }) {
  void no; // ordinal retired — chapters introduce themselves by name alone
  const glyph = CHAPTER_GLYPHS[label.toLowerCase()];
  return (
    <div className={styles.chapter}>
      {glyph && (
        <svg className={styles.chapterGlyph} width="15" height="15" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {glyph}
        </svg>
      )}
      {label}
    </div>
  );
}

/* ── chapter 01: THE ENGINE, demonstrated on ONE lot — the highest-
   confidence, deepest-value flag on the book. A dossier: the photograph
   matted left, the engine's full read right (ask · comps median · basis ·
   confidence), the verdict as a small monument (the multiple, in green),
   and the method as fine print. The whole plate opens the comparables. ── */
function EngineHero({ h, onOpen }: { h: EngineHeroData; onOpen?: (lot: AuctionLot) => void }) {
  const { lot, signal } = h;
  const makerName = ARTIST_LABEL[lot.artist] || lot.artist.replace(/-/g, ' ');
  const estLo = lot.estimateLow ?? lot.estimateHigh ?? null;
  const estHi = lot.estimateHigh ?? lot.estimateLow ?? null;
  const askText = estLo != null
    ? (estLo === estHi ? `${formatPrice(estLo)}` : `${formatPrice(estLo!)}–${formatPrice(estHi!)}`)
    : lot.currentBid ? `${formatPrice(lot.currentBid)} bid` : '—';
  // comps median: the engine's shipped value, else the vetted derivation from
  // the estimate midpoint × the measured gap (the old CallPlate's exact rule)
  const estMid = estLo != null && estHi != null ? (estLo + estHi) / 2 : (lot.currentBid ?? null);
  const med = (signal as { med?: number }).med
    ?? (estMid != null ? Math.round(estMid * (1 + signal.pct / 100)) : null);
  const ratioText = signal.pct > 400 ? '5×+' : `${(signal.pct / 100 + 1).toFixed(1)}×`;
  const conf = confidenceMeter(signal.confidence);
  return (
    <button type="button" className={styles.engineHero} onClick={() => onOpen?.(lot)}>
      <span className={styles.ehImg}>
        {/* the maker's monogram holds the mat — a dead image hides itself and
            leaves the letter (the feed thumb's exact fallback grammar) */}
        <span className={styles.ehMonogram} aria-hidden>{(lot.title || '?').charAt(0)}</span>
        {lot.imageUrl && (
          <img
            src={httpsImg(lot.imageUrl)}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
      </span>
      <span className={styles.ehRead}>
        <span className={styles.ehTopRow}>
          <span className={styles.ehMaker}>{makerName}</span>
          <span className={styles.ehWhen}>{lot.auctionHouse} · hammers {daysWord(lot.saleDate)}</span>
        </span>
        <span className={styles.ehTitle}>{lot.title}</span>
        <span className={styles.ehVerdict}>
          <span className={styles.ehRatio}>{ratioText}</span>
          <span className={styles.ehVerdictCap}>its comparables sell above<br />this ask, at the median</span>
        </span>
        <span className={styles.ehRows}>
          <span className={styles.ehRow}><span>The ask</span><span className={styles.ehDots} /><span>{askText}</span></span>
          {med != null && (
            <span className={styles.ehRow}><span>Comps median</span><span className={styles.ehDots} /><span>{formatPrice(med)}{signal.basis ? ` · ${signal.basis} sales` : ''}</span></span>
          )}
          <span className={styles.ehRow}><span>Confidence</span><span className={styles.ehDots} /><span><b className={styles.ehConfDots}>{conf.dots}</b> {conf.word}</span></span>
        </span>
        <span className={styles.ehFine}>read from same-maker, same-form, size-banded comps · medians, never means</span>
        <span className={styles.ehCta}>Open the full read →</span>
      </span>
    </button>
  );
}

/* ── chapter 03: THE RECEIPT — the backtest as a thermal slip. Every figure
   real; the slip prints itself (clip reveal), the replay seal stamps it in
   red ink. Mono carries the whole artifact — a receipt IS a printed thing. */
function ValueReceipt({ r, play }: { r: Receipts; play: boolean }) {
  const spread = r.flaggedPct - r.unflaggedPct;
  const reduce = useReducedMotion();
  // #7 · "vs your last read" — the receipt reprints each visit; a ref guards
  // the read-then-write against StrictMode's double effect (else run 2 reads
  // the just-written value and the delta zeroes). Shown only when it moved.
  const [lastRead, setLastRead] = useState<number | null>(null);
  const captured = useRef(false);
  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    try {
      const prior = localStorage.getItem('lectr-receipt-flagged');
      localStorage.setItem('lectr-receipt-flagged', String(r.flaggedPct));
      setLastRead(prior != null ? Number(prior) : null);
    } catch { setLastRead(null); }
  }, [r.flaggedPct]);
  const move = lastRead != null && Math.abs(r.flaggedPct - lastRead) >= 0.1 ? r.flaggedPct - lastRead : null;
  return (
    <div className={styles.rcptWrap}>
      <m.div
        className={styles.rcpt}
        initial={reduce ? false : { clipPath: 'inset(0 0 100% 0)' }}
        animate={play || reduce ? { clipPath: 'inset(0 0 0% 0)' } : undefined}
        transition={{ duration: 1.1, ease: 'easeOut' as const, delay: 0.2 }}
      >
        <div className={styles.rcptHead}>lectr · value engine</div>
        <div className={styles.rcptSub}>backtest receipt — every flag replayed against history</div>
        <div className={styles.rcptRule} />
        <div className={styles.rcptRow}><span>Replayed sales</span><span className={styles.rcptDots} /><span>{fmtInt(r.n)}</span></div>
        <div className={styles.rcptRow}><span>Flagged · median vs est</span><span className={styles.rcptDots} /><span className={r.flaggedPct >= 0 ? styles.rcptUp : styles.rcptDown}>{fmtPct(r.flaggedPct)}</span></div>
        <div className={styles.rcptRow}><span>Unflagged</span><span className={styles.rcptDots} /><span className={r.unflaggedPct >= 0 ? styles.rcptUp : styles.rcptDown}>{fmtPct(r.unflaggedPct)}</span></div>
        <div className={styles.rcptRule} />
        <div className={`${styles.rcptRow} ${styles.rcptTotal}`}><span>The edge (flag − rest)</span><span className={styles.rcptDots} /><span>{spread >= 0 ? '+' : '−'}{Math.abs(spread).toFixed(1)} pts</span></div>
        <div className={styles.rcptRule} />
        <div className={styles.rcptMeta}>
          all-in basis
          {r.flaggedHammerPct != null && r.unflaggedHammerPct != null
            ? ` · hammer-only ${fmtPct(r.flaggedHammerPct)} vs ${fmtPct(r.unflaggedHammerPct)}`
            : ''}
          {' '}· settled nightly{r.asOf ? ` · as of ${r.asOf}` : ''}
        </div>
        {move != null && (
          <div className={styles.rcptMeta}>vs your last read · {move >= 0 ? '▲' : '▼'} {Math.abs(move).toFixed(1)} pts</div>
        )}
        <div className={styles.rcptBarcode} aria-hidden />
        <div className={styles.rcptNo}>no. {fmtInt(r.n)}</div>
        <Link href="/value" className={styles.rcptLink}>see the full record →</Link>
        {/* the stamp — the replay seal pressed in red ink over the totals */}
        <div className={styles.rcptStamp} aria-hidden>
          <ReplaySeal n={r.n} play={play && !reduce} />
        </div>
      </m.div>
    </div>
  );
}

/* ── one tape row ── */
function TapeRow({ r, active, onPick }: { r: SubMarketRead; active: boolean; onPick: () => void }) {
  const isIndex = r.readType === 'index' && r.index;
  const dir = isIndex ? (r.index!.changePct >= 0 ? 'up' : 'down') : undefined;
  return (
    <div
      className={styles.tapeRow}
      data-scoped={active || undefined}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onPick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}
    >
      {active && <m.span layoutId="brassRule" className={styles.brassRule} transition={{ duration: 0.25, ease: EASE }} />}
      {/* #3 · the label is a direct link to its dossier — one fewer tap than
          opening the read card first; stopPropagation so it navigates instead
          of toggling the card */}
      <Link
        href={rowHref(r)}
        className={styles.tapeLabelBlock}
        style={{ textDecoration: 'none', color: 'inherit' }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className={styles.tapeLabel}>
          <span className={styles.tapeGlyph} aria-hidden>
            <MarketIcon market={r.vertical as Market} size={13} />
          </span>
          {r.label}
        </span>
        <span className={styles.tapeTag}>{tapeTag(r)}</span>
      </Link>
      <span className={styles.tapeInstrument} aria-hidden>
        {isIndex ? (
          <CIBeam lo={r.index!.ciLoPct} hi={r.index!.ciHiPct} point={r.index!.changePct} dir={dir} mini play={false} />
        ) : r.readType === 'demand' && r.demandSeries.length >= 2 ? (
          <DemandLine series={r.demandSeries} mini />
        ) : (
          <span className={styles.tapeAbstain}>—</span>
        )}
      </span>
      <span className={styles.tapeRight}>
        {isIndex ? (
          <>
            <span className={`${styles.tapeFigure} ${styles.pctData}`} data-dir={dir}>
              <span className={styles.tri} data-dir={dir} aria-hidden />
              {fmtPct(r.index!.changePct)} · {r.index!.horizon}
            </span>
            <span className={styles.tapeSub}>CI {fmtCI(r.index!.ciLoPct)} to {fmtCI(r.index!.ciHiPct)} · {fmtInt(r.lots)} lots</span>
          </>
        ) : r.readType === 'demand' && r.demandNow != null ? (
          <>
            <span className={styles.tapeFigure}>Demand {fmtPct(r.demandNow)}</span>
            <span className={styles.tapeSub}>over estimate · {fmtInt(r.lots)} lots</span>
          </>
        ) : (
          <>
            <span className={styles.tapeFigureDesc}>
              {r.typicalUsd != null ? `Typical ${fmtMoneyCompact(r.typicalUsd)}` : '—'}
              {r.record ? ` · Record ${fmtMoneyCompact(r.record.usd)}` : ''}
            </span>
            <span className={styles.tapeSub}>{fmtInt(r.lots)} lots</span>
          </>
        )}
      </span>
      <span className={styles.tapeChevron} aria-hidden />
    </div>
  );
}

export default function SubMarketBoard({
  market, activeKey, variant = 'desktop', paper = false, receipts = null,
  hero, onOpenLot,
}: Props) {
  const reduce = useReducedMotion();
  const [ref] = useInView<HTMLDivElement>();
  const [receiptsRef, receiptsSeen] = useInView<HTMLDivElement>();
  const rows = useMemo(() => resolveRows(market, activeKey), [market, activeKey]);

  const CAP = 8;
  const [expanded, setExpanded] = useState(false);
  // the pop-up read: tapping a row opens its full instrument (the CI beam /
  // demand series at monument scale) in an overlay — the tape stays compact,
  // the deep read is one tap away. Purely local; never re-scopes the page.
  const keyOf = (r: SubMarketRead) => `${r.vertical}:${r.slug}`;
  const [openRead, setOpenRead] = useState<SubMarketRead | null>(null);
  useEffect(() => { setOpenRead(null); }, [activeKey]);
  useEffect(() => {
    if (!openRead) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenRead(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openRead]);
  // Focus discipline (ComparableModal's pattern, B3 finding 7): move focus to
  // the close button on open, trap Tab inside the card, restore the invoking
  // element's focus on close — aria-modal otherwise strands AT focus behind
  // the overlay.
  const readOpen = !!openRead;
  const readCardRef = useRef<HTMLDivElement>(null);
  const readCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!readOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    readCloseRef.current?.focus();
    const trapTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !readCardRef.current) return;
      const focusables = Array.from(
        readCardRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && readCardRef.current.contains(active);
      if (e.shiftKey) {
        if (active === first || !inside) { e.preventDefault(); last.focus(); }
      } else if (active === last || !inside) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', trapTab);
    return () => { window.removeEventListener('keydown', trapTab); previouslyFocused?.focus(); };
  }, [readOpen]);

  /* ════ ROOM A — Plate & Tape (the home's paper room) ════ */
  if (paper) {
    if (!rows.length) return null;
    // mobile collapses further: only the certified indices until expanded —
    // the demand reads join on "Show more" (less scroll, same data one tap away).
    // Markets with NO certified index (culture, science are all descriptive)
    // fall back to the capped list — never an empty tape over a "Show more".
    const capped = rows.slice(0, CAP);
    const mobileRows = capped.filter((r) => r.readType === 'index');
    const shown = expanded ? rows
      : variant === 'mobile' && mobileRows.length > 0 ? mobileRows
      : capped;
    return (
      <LazyMotion features={domAnimation} strict>
        <div className={styles.roomA} ref={ref}>
          {/* the altar — centered on the page axis */}
          <div className={styles.altar}>
            <h2 className={styles.altarHead}>We find what the room misprices.</h2>
            <p className={styles.altarSub}>
              Live lots flagged under their comparables, the market indices behind them,
              and the replayed record that keeps us honest.
            </p>
          </div>

          {/* ── 01 · THE ENGINE — demonstrated on one lot ── */}
          {hero && (
            <>
              <Chapter no="01" label="The engine" />
              <EngineHero h={hero} onOpen={onOpenLot} />
              <div className={styles.engineCtaRow}>
                <Link href="/value" className={styles.roomPill}>See all value lots →</Link>
              </div>
            </>
          )}

          {/* ── 02 · THE MARKETS — the tape IS the story; tap a row for the
              full instrument in a pop-up read card. Chapters renumber when
              the engine has no call to showcase (no orphaned "02" after a
              missing "01"). ── */}
          <Chapter no={hero ? '02' : '01'} label="The markets" />
          <p className={styles.chapterSub}>
            {/* the cross-market enumeration is true only at full scope — a
                scoped lander (culture: 17 sub-markets) must not claim cards
                and watch families it doesn't show */}
            {fmtInt(rows.length)} sub-markets{activeKey === 'all' ? ' — cards by era and sport, watch model families, art and design kinds —' : ','} each read at the strength its data supports:{' '}
            <svg className={styles.legendGlyph} viewBox="0 0 34 12" aria-label="confidence-range glyph">
              <line x1="3" y1="6" x2="31" y2="6" /><line x1="3" y1="2.5" x2="3" y2="9.5" /><line x1="31" y1="2.5" x2="31" y2="9.5" />
              <path d="M20 2.8 L23.2 6 L20 9.2 L16.8 6 Z" className={styles.legendFill} />
            </svg>{' '}
            a 95% confidence range,{' '}
            <svg className={styles.legendGlyph} viewBox="0 0 34 12" aria-label="demand-series glyph">
              <path d="M2 8.5 C5 8.5 5 3.5 8.5 3.5 S12 8.5 15.5 8.5 19 3.5 22.5 3.5 26 8.5 29 8 32 6 32 6" fill="none" />
            </svg>{' '}
            demand against estimate. Tap any row for the full instrument.
          </p>

          {(() => {
            const left = shown.slice(0, Math.ceil(shown.length / 2));
            const right = shown.slice(Math.ceil(shown.length / 2));
            // type headers only when the split is pure (the curated marquee is:
            // certified indices left, demand reads right)
            const pure = !expanded
              && left.length > 0 && left.every((r) => r.readType === 'index')
              && right.length > 0 && right.every((r) => r.readType !== 'index');
            return (
              <div className={styles.tape}>
                <div className={styles.tapeCol}>
                  {pure && <div className={styles.colHead}>Certified indices · 95% CI</div>}
                  {left.map((r) => (
                    <TapeRow key={keyOf(r)} r={r} active={!!openRead && keyOf(openRead) === keyOf(r)} onPick={() => setOpenRead(r)} />
                  ))}
                </div>
                <div className={styles.tapeCol}>
                  {pure && <div className={styles.colHead}>Demand reads · vs estimate</div>}
                  {right.map((r) => (
                    <TapeRow key={keyOf(r)} r={r} active={!!openRead && keyOf(openRead) === keyOf(r)} onPick={() => setOpenRead(r)} />
                  ))}
                </div>
                {rows.length > shown.length || expanded ? (
                  <button type="button" className={styles.tapeMore} onClick={() => setExpanded((v) => !v)}>
                    {expanded ? 'Show less' : `Show ${rows.length - shown.length} more`}
                  </button>
                ) : null}
              </div>
            );
          })()}

          {/* the pop-up read card — the monument, summoned */}
          <AnimatePresence>
            {openRead && (
              <m.div
                className={styles.readPop}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setOpenRead(null)}
                role="dialog"
                aria-modal="true"
                aria-label={`${openRead.label} — the full read`}
              >
                <m.div
                  ref={readCardRef}
                  className={styles.readPopCard}
                  initial={reduce ? false : { opacity: 0, y: 14, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className={styles.readPopHead}>
                    <span className={styles.readPopTitle}>{openRead.label}</span>
                    <button ref={readCloseRef} type="button" className={styles.readPopClose} onClick={() => setOpenRead(null)} aria-label="Close">×</button>
                  </div>
                  <Monument r={openRead} play={!reduce} />
                  {/* every drill row has a /sub dossier — the full instrument,
                      record and history for that sub-market */}
                  {openRead.slug.includes(':') && (
                    <div className={styles.engineCtaRow}>
                      <Link href={rowHref(openRead)} className={styles.roomPill}>
                        Open the {openRead.label} dossier →
                      </Link>
                    </div>
                  )}
                </m.div>
              </m.div>
            )}
          </AnimatePresence>

          {/* ── 03 · THE RECEIPT — the backtest, printed ── */}
          {receipts && receipts.n > 500 && (
            <div ref={receiptsRef}>
              <Chapter no={hero ? '03' : '02'} label="The receipt" />
              <ValueReceipt r={receipts} play={receiptsSeen && !reduce} />
            </div>
          )}
        </div>
      </LazyMotion>
    );
  }

  // non-paper variants retired — the board renders only as the home's paper room
  return null;
}
