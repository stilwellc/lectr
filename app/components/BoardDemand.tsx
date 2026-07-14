'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
import { AuctionLot } from '../types';
import { demandSeries, formatDemand } from '../lib/demand';
import CountUp from './CountUp';
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
 *  — never a % Demand Index. Compact so the numeral reads at display scale. */
function formatRealized(n: number): string {
  const v = Math.round(n);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 10_000) return `$${Math.round(v / 1000)}K`;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toLocaleString()}`;
}

export default function BoardDemand({
  allLots,
  demand,
  marketLabel = 'collectibles',
  ledger,
  mode = 'estimate',
  cohortLabel,
}: {
  allLots: AuctionLot[];
  demand?: { date: string; value: number }[];
  marketLabel?: string;
  /** optional — when absent the pane stays chart-pure and the ledger renders elsewhere */
  ledger?: LedgerItem[];
  /** 'estimate' = the frozen Demand Index (byte-identical). 'realized' = the
   *  sports variant: a $ cohort-median curve, no zero-at-estimate line, no
   *  Demand Index / % vs estimate copy — colored on YoY delta, never level. */
  mode?: 'estimate' | 'realized' | 'index';
  /** the like-for-like cohort named in the realized label (e.g. 'tickets & passes') */
  cohortLabel?: string;
}) {
  const isRealized = mode === 'realized';
  const isIndex = mode === 'index';
  // realized swaps the numeral/tick/scrub formatter to $; index shows the
  // rebased-100 level; estimate path is untouched (formatDemand, % Demand Index).
  const fmt = isIndex ? ((n: number) => Math.round(n).toString()) : isRealized ? formatRealized : formatDemand;
  // 1Y default: the lit numeral IS the trailing-12-month claim the kicker
  // makes — the chart shows the sentence. Max stays one click away.
  const [range, setRange] = useState<Range>('1Y');
  const [hover, setHover] = useState<{ date: string; value: number } | null>(null);
  const drawRef = useChartDraw();

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
    return allLots.filter(l => l.status === 'upcoming' && l.saleDate && l.saleDate >= today).length;
  }, [allLots, hasIndex]);

  // color says direction, never level. Realized keys on the YoY delta (the
  // level is a $ price and must never be colored); estimate keeps its
  // first-vs-last-of-window read byte-identically.
  const dir = isRealized
    ? (delta ?? 0)
    : (visible.length >= 2 ? visible[visible.length - 1].value - visible[0].value : 0);
  // index change over the visible window, as a % of the window's first level
  const idxPct = isIndex && visible.length >= 2 && visible[0].value
    ? Math.round((visible[visible.length - 1].value / visible[0].value - 1) * 100) : 0;
  const lineColor = dir >= 0 ? 'var(--color-up)' : 'var(--color-down)';

  // the scrub chip's period context: the hovered quarter vs a year prior
  const hoverPrior = useMemo(() => {
    if (!hover) return null;
    const i = series.findIndex(p => p.date === hover.date);
    return i >= 4 ? series[i - 4].value : null;
  }, [hover, series]);

  return (
    <div className="ray-board-demand" data-tone={dir >= 0 ? 'up' : 'down'}>
      <div className="ray-demand-head">
        <span className="ray-demand-label">
          {isIndex ? (
            <span>The {marketLabel} market · like-for-like price index, rebased 100 · 3-quarter smoothed</span>
          ) : isRealized ? (
            <>
              <span>Typical realized price · {cohortLabel || marketLabel} · like-for-like, trailing 12 months</span>
              <RealizedNote />
            </>
          ) : (
            <>
              <span>Every lot at auction, called against its true comps · the {marketLabel} market, trailing 12 months</span>
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
          <h1 className="ray-hero2-value"><CountUp to={liveCount} format={n => Math.round(n).toString()} duration={900} /></h1>
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
          <h1 className="ray-hero2-value"><CountUp to={now} format={fmt} duration={900} /></h1>
        )}
        <span className="ray-numrow-delta">
          {hover
            ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>12 months to {hover.date}</span>
            : isIndex ? (
                idxPct !== 0 && (
                  <span className={idxPct > 0 ? 'up' : 'down'}>
                    {idxPct > 0 ? '▲' : '▼'} {idxPct > 0 ? '+' : ''}{idxPct}% since {visible[0]?.date}
                  </span>
                )
              )
            : delta !== null && Math.round(delta) !== 0 && (
              isRealized
                ? (yearAgo !== null && yearAgo !== 0 && (
                    <span className={delta > 0 ? 'up' : 'down'}>
                      {delta > 0 ? '▲ up' : '▼ down'} · {delta > 0 ? '+' : '−'}{Math.abs(Math.round((delta / yearAgo) * 100))}% vs a year ago
                    </span>
                  ))
                : (
                    <span className={delta > 0 ? 'up' : 'down'}>
                      {delta > 0 ? '▲ heating' : '▼ cooling'} · {delta > 0 ? '+' : '−'}{Math.abs(Math.round(delta))} pts vs a year ago
                    </span>
                  )
            )}
        </span>
        {hover && (
          <span className="ray-scrubchip">
            {hover.date}{hoverPrior !== null && <> · vs {fmt(hoverPrior)} a year prior</>}
          </span>
        )}
      </div>
      )}

      {ledger && (
        <div className="ray-ledger">
          {ledger.map(item => (
            <div key={item.k}>
              <div className="ray-ledger-k">{item.k}</div>
              <CountUp to={item.to} format={item.format} className={`ray-ledger-v${item.tone === 'up' ? ' up' : ''}`} style={{ display: 'block' }} />
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
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#7A8087', fontFamily: 'var(--font-sans), sans-serif' }}
                tickFormatter={(d: string, i: number) => {
                  // "2026 Q2" ticks: within a 1Y window every tick shares the
                  // year, so bare years print "2026 2026 2026" — lead with the
                  // year once, then quarters carry the axis.
                  const [y, q] = d.split(' ');
                  return i === 0 || !q ? y : q;
                }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={90}
                padding={{ left: 4, right: 4 }}
              />
              <YAxis
                orientation="right"
                width={isRealized ? 48 : 40}
                tick={{ fontSize: 11, fill: '#7A8087', fontFamily: 'var(--font-sans), sans-serif' }}
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
                  stroke="rgba(255,255,255,0.16)"
                  strokeDasharray="4 4"
                  label={{ value: '0 — sells at estimate', position: 'insideBottomLeft', fill: '#7A8087', fontSize: 11, fontFamily: 'var(--font-sans), sans-serif', dy: -4 }}
                />
              )}
              <Tooltip content={() => null} cursor={{ stroke: 'rgba(255,255,255,0.3)', strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={1.75}
                fill="url(#boardGrad)"
                dot={false}
                activeDot={{ r: 3.5, fill: lineColor, stroke: '#0A0B0D', strokeWidth: 2 }}
                isAnimationActive={false}
                style={{ filter: `drop-shadow(0 0 6px ${dir >= 0 ? 'rgba(47,191,113,0.35)' : 'rgba(229,84,75,0.3)'})` }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
