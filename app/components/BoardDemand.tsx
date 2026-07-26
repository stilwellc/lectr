'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
import { AuctionLot } from '../types';
import { demandSeries, formatDemand } from '../lib/demand';
import { formatMoneyAxis } from '../utils';
import CountUp from './CountUp';
import Flick from './Flick';
import { useChartDraw } from '../hooks/useChartDraw';
import MethodologyNote from './MethodologyNote';

type Range = '1Y' | '5Y' | '10Y' | 'MAX';

/**
 * RealizedNote — the realized variant's own methodology card. The frozen
 * MethodologyNote explains the estimate-based Demand Index; this explains the
 * like-for-like realized median, because Goldin publishes no estimates to
 * measure against. Reuses the same portal/overlay chrome for visual parity.
 */
function RealizedNote() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button className="ray-method-trigger" onClick={() => setOpen(true)}>
        <span aria-hidden="true">ⓘ</span> what is this?
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="ray-ck-overlay" onClick={() => setOpen(false)} role="presentation">
          <div className="ray-method" role="dialog" aria-modal="true" aria-label="How lectr reads this market" onClick={e => e.stopPropagation()}>
            <h3>How lectr reads this market</h3>
            <p className="ray-method-lede">
              These auctions publish no estimates — so there is no estimate to
              measure a sale against, and lectr shows no Demand Index here.
              Instead the tile plots a <b style={{ color: 'var(--color-fg)' }}>like-for-like
              realized median</b>: the typical price actually paid, over the
              trailing twelve months, for one tight cohort of comparable objects.
            </p>
            <p className="ray-method-lede">
              The cohort is held constant — the same kind of object in the same
              price band — so the curve tracks what a comparable lot really
              clears, not a shift in what happened to come up for sale. Each
              point is the median winning bid for that quarter, buyer&rsquo;s
              premium included.
            </p>
            <p className="ray-method-foot">
              Colour marks direction only, year over year — never the level.
              Every figure links to the auction record it came from.
            </p>
            <button className="ray-method-close" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export interface LedgerItem {
  k: string;
  to: number;
  format: (n: number) => string;
  s: string;
  tone?: string;
}

/**
 * BoardDemand — the terminal's main screen. The Demand Index numeral at
 * display scale, the mini-ledger (the market in four figures, seamed by
 * hairlines), and the instrumented curve: horizontal gridlines, y-ticks
 * inside the right edge, the zero line captioned, and scrub-rewrites-the-
 * numeral with a period chip pinned top-right. Numeral = line = sentence.
 */
/** Realized-price formatter for the sports variant. Goldin publishes no
 *  estimates, so the tile shows a $ median (a like-for-like realized level)
 *  — never a % Demand Index. Thin wrapper over the shared formatMoneyAxis:
 *  identical from $10K up; below that the tape keeps its one-decimal K
 *  ($1.5K) so thin cohorts still read at display scale. */
function formatRealized(n: number): string {
  const v = Math.round(n);
  if (v >= 10_000) return formatMoneyAxis(v);
  if (v >= 1000) return `$${((v / 1000).toFixed(1)).replace(/\.0$/, '')}K`;
  return `$${v.toLocaleString()}`;
}

export default function BoardDemand({
  allLots,
  demand,
  marketLabel = 'collectibles',
  ledger,
  mode = 'estimate',
  cohortLabel,
  indexKind = 'price',
  secondaryStat,
  open = false,
}: {
  allLots: AuctionLot[];
  demand?: { date: string; value: number }[];
  marketLabel?: string;
  /** an optional second metric tucked to the right of the hero numeral —
   *  same baseline, no extra vertical space (e.g. sales-weighted appreciation) */
  secondaryStat?: { label: string; value: string; sub?: string; tone?: 'up' | 'down' } | null;
  /** optional — when absent the pane stays chart-pure and the ledger renders elsewhere */
  ledger?: LedgerItem[];
  /** 'estimate' = the frozen Demand Index (byte-identical). 'realized' = the
   *  sports variant: a $ cohort-median curve, no zero-at-estimate line, no
   *  Demand Index / % vs estimate copy — colored on YoY delta, never level. */
  mode?: 'estimate' | 'realized' | 'index';
  /** the like-for-like cohort named in the realized label (e.g. 'tickets & passes') */
  cohortLabel?: string;
  /** index mode sub-kind: 'price' = pure appreciation, 'blend' = price × demand */
  indexKind?: 'price' | 'blend';
  /** MARKET OPEN — armed on the entrance's first non-cached paint. Runs the
   *  hero count-up + tone-resolve beat once. Cached revisits pass false, so the
   *  numeral, line and tone all render final at once (no "0", no neutral flash). */
  open?: boolean;
}) {
  const isRealized = mode === 'realized';
  const isIndex = mode === 'index';
  // realized swaps the numeral/tick/scrub formatter to $; index shows the
  // rebased-100 level; estimate path is untouched (formatDemand, % Demand Index).
  const fmt = isIndex ? ((n: number) => Math.round(n).toString()) : isRealized ? formatRealized : formatDemand;
  // Default to the FULL history: the demand curve reaches back to the early
  // 2000s for the majors, and that whole arc is the point — the numeral still
  // reads the latest trailing-12-month value ("currently +27%"), the chart
  // shows how the market got there. 1Y stays one click away. (Realized keeps
  // its trailing-year default — Goldin cohorts are thin further back.)
  const [range, setRange] = useState<Range>(mode === 'realized' ? '1Y' : 'MAX');
  const [hover, setHover] = useState<{ date: string; value: number } | null>(null);
  const drawRef = useChartDraw();

  // MARKET OPEN — the hero beat. `armed` is decided ONCE, synchronously at the
  // first render: this whole subtree is only ever client-rendered (it lives
  // behind the loading gate + fromCache branch, never in the SSG HTML), so
  // reading matchMedia in the initializer is hydration-safe here and — unlike a
  // post-mount flip — the numeral starts at 0 on its very first paint (no
  // final-value flash before the count-up). `resolved` flips the numeral + line
  // from neutral (--color-fg) to the trend tone at ~70% of the ~900ms draw, so
  // the number and the line finish colouring together.
  //   armed=false → tone + final figure paint at once (cached / reduced motion):
  //                 no neutral flash, no stranded "0".
  const [armed] = useState(
    () =>
      open &&
      typeof window !== 'undefined' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [resolved, setResolved] = useState(false);
  // `arming` is the ONE-SHOT count-up switch: true only during the entrance
  // beat, then off. The numeral is a hover-ternary (scrub value ⇄ CountUp), so
  // CountUp REMOUNTS every time the reader scrubs off the chart — if it kept
  // seeing animate=true it would re-sweep 0→now on every hover-out. Flip it off
  // once the beat finishes so post-entrance remounts land on the value at once.
  const [arming, setArming] = useState(armed);
  useEffect(() => {
    if (!armed) return;
    // resolve the tone at 70% of the 900ms count-up/draw — number and line land
    // fully coloured together at ~T900. A late timer can only ADD the tone, so a
    // JS hiccup leaves the (already-correct) final tone, never a stranded state.
    const t = setTimeout(() => setResolved(true), 630);
    // end the count-up window after the last figure settles (hero 900 + ledger
    // stagger ≤180) so a mid-beat remount can't strand a "0".
    const tArm = setTimeout(() => setArming(false), 1100);
    return () => { clearTimeout(t); clearTimeout(tArm); };
  }, [armed]);
  // Neutral only while armed-but-unresolved; every other path is trend tone.
  const heroNeutral = armed && !resolved;

  const series = useMemo(
    () => (demand && demand.length ? demand : demandSeries(allLots)),
    [demand, allLots]
  );
  const visible = useMemo(() => {
    if (range === '1Y') return series.slice(-4);
    if (range === '5Y') return series.slice(-20);
    if (range === '10Y') return series.slice(-40);
    return series;
  }, [series, range]);

  const hasIndex = series.length >= 2;
  const now = series.length ? series[series.length - 1].value : 0;
  const yearAgo = series.length >= 5 ? series[series.length - 5].value : null;
  const delta = yearAgo === null ? null : now - yearAgo;

  // a live market with no index yet (bid auctions publish no estimates):
  // lead with the honest figure it does have
  const liveCount = useMemo(() => {
    if (hasIndex) return 0;
    const today = new Date().toISOString().split('T')[0];
    return allLots.filter(l => l.status === 'upcoming' && l.saleDate && (l.saleDate >= today || (l.resultsPending && l.saleDate.slice(0, 10) >= today))).length;
  }, [allLots, hasIndex]);

  // the index/blend board shows the full arc but headlines the past-year move
  // (trailing 4 quarters), so the curve reads as a market while the numeral
  // matches the analytics surface exactly ("+8% past year"), never the whole
  // 6-year swing. Demand/realized keep their window-based reads.
  const idxWin = isIndex ? series.slice(-5) : [];   // 5 pts → 4 quarters of change
  const idxPct = isIndex && idxWin.length >= 2 && idxWin[0].value
    ? Math.round((idxWin[idxWin.length - 1].value / idxWin[0].value - 1) * 100) : 0;
  // color says direction, never level. Realized keys on the YoY delta (the
  // level is a $ price and must never be colored); index keys on the past-year
  // move; estimate keeps its first-vs-last-of-window read byte-identically.
  const dir = isRealized
    ? (delta ?? 0)
    : isIndex
      ? idxPct
      : (visible.length >= 2 ? visible[visible.length - 1].value - visible[0].value : 0);
  const lineColor = dir >= 0 ? 'var(--color-up)' : 'var(--color-down)';

  // the scrub chip's period context: the hovered quarter vs a year prior
  const hoverPrior = useMemo(() => {
    if (!hover) return null;
    const i = series.findIndex(p => p.date === hover.date);
    return i >= 4 ? series[i - 4].value : null;
  }, [hover, series]);

  return (
    <div
      className="ray-board-demand"
      data-tone={dir >= 0 ? 'up' : 'down'}
      data-open={open ? 'true' : undefined}
      // neutral drives the numeral/line to --color-fg until the draw resolves;
      // absent on every non-armed path, so the tone is present from paint
      data-neutral={heroNeutral ? 'true' : undefined}
    >
      <div className="ray-demand-head">
        <span className="ray-demand-label">
          {isIndex ? (
            <span>{indexKind === 'blend'
              ? `The ${marketLabel} market · price appreciation blended with demand vs estimate, rebased 100`
              : `The ${marketLabel} market · like-for-like price index, rebased 100 · 3-quarter smoothed`}</span>
          ) : isRealized ? (
            <>
              <span>Typical realized price · {cohortLabel || marketLabel} · like-for-like, trailing 12 months</span>
              <RealizedNote />
            </>
          ) : (
            <>
              <span>Market demand · the {marketLabel} market · typical sale vs its estimate, trailing 12 months</span>
              <MethodologyNote trigger="what is this?" />
            </>
          )}
        </span>
        <span className="ray-ranges2" role="radiogroup" aria-label="Chart range">
          {(['1Y', '5Y', '10Y', 'MAX'] as Range[]).map(r => (
            <button
              key={r}
              role="radio"
              aria-checked={range === r}
              className="ray-range2"
              data-active={range === r}
              onClick={() => { setRange(r); setHover(null); }}
            >
              {r === 'MAX' ? 'Max' : r}
            </button>
          ))}
        </span>
      </div>

      {!hasIndex && (
        <div className="ray-numrow">
          <h1 className="ray-hero2-value"><CountUp to={liveCount} format={n => Math.round(n).toString()} duration={900} animate={arming} /></h1>
          <span className="ray-numrow-delta">
            <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>
              lots on the block · demand index pending — these auctions publish no estimates to measure against
            </span>
          </span>
        </div>
      )}

      {hasIndex && (
      <div className="ray-numrow">
        {hover ? (
          <h1 className="ray-hero2-value">{fmt(hover.value)}</h1>
        ) : (
          <h1 className="ray-hero2-value"><CountUp to={now} format={fmt} duration={900} animate={arming} /></h1>
        )}
        <span className="ray-numrow-delta">
          {hover
            ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>12 months to {hover.date}</span>
            : isIndex ? (
                idxPct !== 0 && (
                  <span className={idxPct > 0 ? 'up' : 'down'}>
                    <Flick size={10} style={{ transform: idxPct > 0 ? undefined : 'scaleY(-1)' }} /> {idxPct > 0 ? '+' : ''}{idxPct}% past year
                  </span>
                )
              )
            : delta !== null && Math.round(delta) !== 0 && (
              isRealized
                ? (yearAgo !== null && yearAgo !== 0 && (
                    <span className={delta > 0 ? 'up' : 'down'}>
                      <Flick size={10} style={{ transform: delta > 0 ? undefined : 'scaleY(-1)' }} /> {delta > 0 ? 'up' : 'down'} · {delta > 0 ? '+' : '−'}{Math.abs(Math.round((delta / yearAgo) * 100))}% vs a year ago
                    </span>
                  ))
                : (
                    <span className={delta > 0 ? 'up' : 'down'}>
                      <Flick size={10} style={{ transform: delta > 0 ? undefined : 'scaleY(-1)' }} /> {delta > 0 ? 'heating' : 'cooling'} · {delta > 0 ? '+' : '−'}{Math.abs(Math.round(delta))} pts vs a year ago
                    </span>
                  )
            )}
        </span>
        {secondaryStat && !hover && (
          <span className="ray-numrow-aux">
            <span className="ray-numrow-aux-v">
              {secondaryStat.label}{' '}
              <b className={secondaryStat.tone}>{secondaryStat.value}</b>
            </span>
            {secondaryStat.sub && <span className="ray-numrow-aux-s">{secondaryStat.sub}</span>}
          </span>
        )}
        {hover && (
          <span className="ray-scrubchip">
            {hover.date}{hoverPrior !== null && <> · vs {fmt(hoverPrior)} a year prior</>}
          </span>
        )}
      </div>
      )}

      {ledger && (
        <div className="ray-ledger">
          {ledger.map((item, i) => (
            <div key={item.k}>
              <div className="ray-ledger-k">{item.k}</div>
              <CountUp to={item.to} format={item.format} duration={900} animate={arming} delay={Math.min(i, 3) * 60} className={`ray-ledger-v${item.tone === 'up' ? ' up' : ''}`} style={{ display: 'block' }} />
              <div className="ray-ledger-s">{item.s}</div>
            </div>
          ))}
        </div>
      )}

      {visible.length >= 2 && (
        <div
          key={range}
          ref={drawRef}
          className="ray-chartfade ray-chart-draw ray-demand-chartbox"
          style={{ marginTop: 6 }}
          onMouseLeave={() => setHover(null)}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={visible}
              margin={{ top: 10, right: 4, left: 0, bottom: 0 }}
              onMouseMove={(s: { activePayload?: Array<{ payload: { date: string; value: number } }> }) => {
                const p = s?.activePayload?.[0]?.payload;
                if (p) setHover({ date: p.date, value: p.value });
              }}
              onMouseLeave={() => setHover(null)}
            >
              <defs>
                <linearGradient id="boardGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.14} />
                  <stop offset="55%" stopColor={lineColor} stopOpacity={0.04} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10.5, fill: 'var(--chart-tick)', fontFamily: 'var(--font-sans), sans-serif' }}
                tickFormatter={(d: string) => {
                  // Always date the tick ("2026 Q2"); recharts thins to fit via
                  // minTickGap. A bare "Q3 Q3 Q3" axis with no year is unreadable.
                  const [y, q] = d.split(' ');
                  return q ? `${y} ${q}` : y;
                }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={64}
                padding={{ left: 4, right: 4 }}
              />
              <YAxis
                orientation="right"
                width={isRealized ? 48 : 40}
                tick={{ fontSize: 10.5, fill: 'var(--chart-tick)', fontFamily: 'var(--font-sans), sans-serif' }}
                tickFormatter={isIndex ? (v: number) => `${Math.round(v)}` : isRealized ? (v: number) => formatRealized(v) : (v: number) => `${v > 0 ? '+' : ''}${v}%`}
                axisLine={false}
                tickLine={false}
                domain={(isRealized || isIndex)
                  ? [(min: number) => Math.max(0, Math.floor(min * 0.9)), (max: number) => Math.ceil(max * 1.05)]
                  : [(min: number) => Math.min(-5, Math.floor(min)), (max: number) => Math.ceil(max)]}
              />
              {/* estimate-only: the 0 line means "sells at estimate". Realized
                  has no estimate baseline, so the line is dropped entirely. */}
              {!isRealized && !isIndex && (
                <ReferenceLine
                  y={0}
                  stroke="var(--chart-ref)"
                  strokeDasharray="4 4"
                  label={{ value: 'sells at estimate', position: 'insideBottomRight', fill: 'var(--chart-tick)', fontSize: 10.5, fontFamily: 'var(--font-sans), sans-serif', dy: 12, dx: -2 }}
                />
              )}
              <Tooltip content={() => null} cursor={{ stroke: 'var(--chart-cursor)', strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={1.75}
                fill="url(#boardGrad)"
                dot={false}
                activeDot={{ r: 3.5, fill: lineColor, stroke: 'var(--color-bg-board)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {!isRealized && !isIndex && hasIndex && (
        <p className="ray-demand-foot">
          How much the typical lot beats or misses its estimate — currently{' '}
          <b className={now > 0 ? 'up' : 'down'}>{formatDemand(now)}</b>.
        </p>
      )}
    </div>
  );
}
