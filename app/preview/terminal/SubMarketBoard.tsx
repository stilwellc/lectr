'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, LazyMotion, domAnimation, m } from 'framer-motion';
import type { MarketData, SubMarketRead } from '../../hooks/useRayData';
import { type Market } from '../../constants';
import type { AuctionLot } from '../../types';
import { formatPrice, httpsImg } from '../../utils';
import { fmtInt, fmtMoneyCompact, useInView, useReducedMotion } from './hooks';
import { fmtPct } from './verified';
import { gapGrammar } from './TonightsWall';
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

interface Receipts { flaggedPct: number; unflaggedPct: number; n: number; asOf?: string | null }

/** a flagged lot for the chapter-01 showcase */
export interface FlagShowcase { lot: AuctionLot; pct: number }

interface Props {
  market: MarketData | null;
  activeKey: Market;
  onSelect: (key: Market) => void;
  variant?: 'desktop' | 'mobile';
  condensed?: boolean;
  maxRows?: number;
  /** printed on the paper room (home) — the Value Engine treatment */
  paper?: boolean;
  /** the backtest receipts — flagged/unflagged median % + replayed count */
  receipts?: Receipts | null;
  /** chapter 01: below-market lots to showcase (disjoint from the wall) */
  showcase?: FlagShowcase[];
  /** open a showcased lot in the comparables modal */
  onOpenLot?: (lot: AuctionLot) => void;
}

const demandStrength = (r: SubMarketRead) => r.demandNow ?? -Infinity;

// the curated marquee — the reads that lead the cross-market board before it
// expands to the full list. Matched by label (case-insensitive), rendered in
// this exact order; anything not present is simply skipped.
const FEATURED = ['sports cards', 'cartier', 'rolex', 'patek philippe', 'audemars piguet', 'pablo picasso', 'andy warhol'];

function resolveRows(market: MarketData | null, activeKey: Market): SubMarketRead[] {
  const sm = market?.subMarkets;
  if (!sm) return [];
  if (activeKey === 'all') {
    const all: SubMarketRead[] = Object.values(sm).flat();
    const index = all
      .filter((r) => r.readType === 'index' && r.index)
      .sort((a, b) => Math.abs(b.index!.changePct) - Math.abs(a.index!.changePct));
    const demand = all
      .filter((r) => r.readType === 'demand')
      .sort((a, b) => demandStrength(b) - demandStrength(a));
    const ranked = [...index, ...demand];
    // front-load the marquee in curated order, then the rest (deduped)
    const featured = FEATURED
      .map((name) => ranked.find((r) => r.label.toLowerCase() === name))
      .filter((r): r is SubMarketRead => !!r);
    const featuredSet = new Set(featured);
    return [...featured, ...ranked.filter((r) => !featuredSet.has(r))];
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

export function hasSubMarketRows(market: MarketData | null, activeKey: Market): boolean {
  return resolveRows(market, activeKey).length > 0;
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
function CIBeam({ lo, hi, point, dir, mini = false, play = true, large = false }: {
  lo: number; hi: number; point: number; dir?: 'up' | 'down'; mini?: boolean; play?: boolean; large?: boolean;
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
          transition={{ duration: 0.5, ease: EASE, delay: 0.3 }}
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
          transition={{ duration: 0.18, ease: EASE, delay: play ? 0.8 : 0 }}
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
function DemandLine({ series, mini = false }: { series: { period: string; value: number }[]; mini?: boolean }) {
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
    <div className={mini ? styles.demandLineMini : styles.demandLine} aria-hidden>
      <svg viewBox="0 0 100 72" preserveAspectRatio="none" className={styles.demandSvg}>
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

/* ── a chapter marker — "01 · The engine", hairlines either side ── */
function Chapter({ no, label }: { no: string; label: string }) {
  return (
    <div className={styles.chapter}>
      <b>{no}</b> · {label}
    </div>
  );
}

/* ── chapter 01: one flagged lot as a plate — the engine's read, shown ── */
function FlagPlate({ f, onOpen }: { f: FlagShowcase; onOpen?: (lot: AuctionLot) => void }) {
  const { lot, pct } = f;
  const est = (lot.estimateLow || lot.estimateHigh)
    ? `est ${formatPrice(lot.estimateLow || lot.estimateHigh!)}${lot.estimateHigh && lot.estimateLow && lot.estimateHigh !== lot.estimateLow ? `–${formatPrice(lot.estimateHigh)}` : ''}`
    : lot.currentBid ? `bid ${formatPrice(lot.currentBid)}` : '';
  return (
    <button type="button" className={styles.flagPlate} onClick={() => onOpen?.(lot)}>
      <span className={styles.flagImg}>
        {lot.imageUrl && <img src={httpsImg(lot.imageUrl)} alt="" loading="lazy" />}
      </span>
      <span className={styles.flagMaker}>{lot.artist.replace(/-/g, ' ')}</span>
      <span className={styles.flagTitle}>{lot.title}</span>
      {est && <span className={styles.flagEst}>{est} · {lot.auctionHouse}</span>}
      <span className={styles.flagSignal}>{gapGrammar('Below Market', pct)}</span>
    </button>
  );
}

/* ── chapter 03: THE RECEIPT — the backtest as a thermal slip. Every figure
   real; the slip prints itself (clip reveal), the replay seal stamps it in
   red ink. Mono carries the whole artifact — a receipt IS a printed thing. */
function ValueReceipt({ r, play }: { r: Receipts; play: boolean }) {
  const spread = r.flaggedPct - r.unflaggedPct;
  const reduce = useReducedMotion();
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
        <div className={styles.rcptRow}><span>Flagged · median vs est</span><span className={styles.rcptDots} /><span className={styles.rcptUp}>{fmtPct(r.flaggedPct)}</span></div>
        <div className={styles.rcptRow}><span>Unflagged</span><span className={styles.rcptDots} /><span className={styles.rcptDown}>{fmtPct(r.unflaggedPct)}</span></div>
        <div className={styles.rcptRule} />
        <div className={`${styles.rcptRow} ${styles.rcptTotal}`}><span>The edge (flag − rest)</span><span className={styles.rcptDots} /><span>{spread >= 0 ? '+' : '−'}{Math.abs(spread).toFixed(1)} pts</span></div>
        <div className={styles.rcptRule} />
        <div className={styles.rcptMeta}>settled nightly{r.asOf ? ` · as of ${r.asOf}` : ''}</div>
        <div className={styles.rcptBarcode} aria-hidden />
        <div className={styles.rcptNo}>no. {fmtInt(r.n)}</div>
        <a href="/value" className={styles.rcptLink}>see the full record →</a>
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
    <button
      type="button"
      className={styles.tapeRow}
      data-scoped={active || undefined}
      aria-pressed={active}
      onClick={onPick}
    >
      {active && <m.span layoutId="brassRule" className={styles.brassRule} transition={{ duration: 0.25, ease: EASE }} />}
      <span className={styles.tapeLabelBlock}>
        <span className={styles.tapeLabel}>{r.label}</span>
        <span className={styles.tapeTag}>{tapeTag(r)}</span>
      </span>
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
    </button>
  );
}

export default function SubMarketBoard({
  market, activeKey, onSelect, variant = 'desktop', condensed = false, maxRows, paper = false, receipts = null,
  showcase, onOpenLot,
}: Props) {
  const reduce = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>();
  const [receiptsRef, receiptsSeen] = useInView<HTMLDivElement>();
  const rows = useMemo(() => resolveRows(market, activeKey), [market, activeKey]);

  const CAP = 7;
  const [expanded, setExpanded] = useState(false);
  // which read the monument shows — a LOCAL pick, independent of page scope.
  // Clicking a tape row only re-points the monument; it never re-scopes the
  // page (which would reshuffle the whole table). Resets when the page scope
  // changes via the top nav.
  const keyOf = (r: SubMarketRead) => `${r.vertical}:${r.slug}`;
  const [pickKey, setPickKey] = useState<string | null>(null);
  useEffect(() => { setPickKey(null); }, [activeKey]);

  /* ════ ROOM A — Plate & Tape (the home's paper room) ════ */
  if (paper) {
    if (!rows.length) return null;
    const flag = rows.find((r) => keyOf(r) === pickKey) ?? rows[0];
    const shown = expanded ? rows : rows.slice(0, CAP);
    const play = seen && !reduce;
    return (
      <LazyMotion features={domAnimation} strict>
        <div className={styles.roomA} ref={ref}>
          {/* the altar — centered on the page axis */}
          <div className={styles.altar}>
            <div className={styles.eyebrow}>
              <img src="/brand/lectr-ink.png" alt="" className={styles.eyebrowMark} aria-hidden />
              <span>The value engine</span>
            </div>
            <h2 className={styles.altarHead}>We find what the room <em>misprices</em>.</h2>
            <p className={styles.altarSub}>
              Live lots flagged under their comparables, the market indices behind them,
              and the replayed record that keeps us honest.
            </p>
          </div>

          {/* ── 01 · THE ENGINE — flagged lots, the read spelled out ── */}
          {showcase && showcase.length >= 3 && (
            <>
              <Chapter no="01" label="The engine" />
              <div className={styles.flagRow}>
                {showcase.slice(0, 3).map((f) => (
                  <FlagPlate key={f.lot.id} f={f} onOpen={onOpenLot} />
                ))}
              </div>
              <p className={styles.engineLine}>
                Same maker, same form, size-banded&ensp;→&ensp;the comps&rsquo; median&ensp;→&ensp;the
                gap gets flagged. Medians, never means — and never a guess.
              </p>
            </>
          )}

          {/* ── 02 · THE MARKETS — the verified board ── */}
          <Chapter no="02" label="The markets" />

          {/* the monument — fixed zone, scoped read, stamped whole */}
          <div className={styles.monument}>
            <div className={styles.tickRain} aria-hidden />
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={`${flag.vertical}:${flag.slug}`}
                className={styles.monSwap}
                initial={reduce ? false : { clipPath: 'inset(0 0 100% 0)' }}
                animate={{ clipPath: 'inset(0 0 0% 0)' }}
                exit={reduce ? undefined : { clipPath: 'inset(100% 0 0 0)' }}
                transition={{ duration: 0.26, ease: EASE }}
              >
                <Monument r={flag} play={play} />
              </m.div>
            </AnimatePresence>
          </div>

          {/* the tape — two columns, first half left, second half right */}
          <div className={styles.tape}>
            <div className={styles.tapeCol}>
              {shown.slice(0, Math.ceil(shown.length / 2)).map((r) => (
                <TapeRow key={keyOf(r)} r={r} active={keyOf(r) === keyOf(flag)} onPick={() => setPickKey(keyOf(r))} />
              ))}
            </div>
            <div className={styles.tapeCol}>
              {shown.slice(Math.ceil(shown.length / 2)).map((r) => (
                <TapeRow key={keyOf(r)} r={r} active={keyOf(r) === keyOf(flag)} onPick={() => setPickKey(keyOf(r))} />
              ))}
            </div>
            {rows.length > CAP && (
              <button type="button" className={styles.tapeMore} onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'Show less' : `Show ${rows.length - CAP} more`}
              </button>
            )}
          </div>

          {/* ── 03 · THE RECEIPT — the backtest, printed ── */}
          {receipts && receipts.n > 500 && (
            <div ref={receiptsRef}>
              <Chapter no="03" label="The receipt" />
              <ValueReceipt r={receipts} play={receiptsSeen && !reduce} />
            </div>
          )}
        </div>
      </LazyMotion>
    );
  }

  /* ── legacy non-paper paths (condensed board etc.) — unchanged grammar ── */
  if (condensed) {
    if (!rows.length) return null;
    const shownCond = rows.slice(0, Math.max(1, maxRows ?? 5));
    return (
      <div className={`${styles.movers} ${styles.condensed}`}>
        <div className={styles.condHead}>
          <span className={styles.sectionKicker}>Sub-markets · live board</span>
          <span className={styles.condCount}>{rows.length} tracked</span>
        </div>
        <div className={styles.subTable} role="table">
          {shownCond.map((r) => {
            const isIndex = r.readType === 'index' && r.index;
            const dir = isIndex ? (r.index!.changePct >= 0 ? 'up' : 'down') : undefined;
            return (
              <button key={`${r.vertical}:${r.slug}`} type="button" className={styles.subRow}
                onClick={() => onSelect(r.vertical as Market)}>
                <span className={styles.moversName}>{r.label}</span>
                <span className={styles.moversDelta} data-dir={dir}>
                  {isIndex ? `${fmtPct(r.index!.changePct)} ${r.index!.horizon}`
                    : r.readType === 'demand' && r.demandNow != null ? `demand ${fmtPct(r.demandNow)}`
                    : r.typicalUsd != null ? `typical ${fmtMoneyCompact(r.typicalUsd)}` : '—'}
                </span>
                <span className={styles.moversN}>{fmtInt(r.lots)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
}
