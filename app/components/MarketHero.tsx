'use client';

import { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { AuctionLot } from '../types';
import { formatPrice } from '../utils';
import { demandSeries, formatDemand } from '../lib/demand';
import CountUp from './CountUp';
import { useChartDraw } from '../hooks/useChartDraw';
import MethodologyNote from './MethodologyNote';

type Range = '1Y' | '5Y' | 'MAX';

interface Pulse {
  weightedAppreciation: number;
  topArtist: string;
  thisWeek: number;
  belowFlagged: number;
}

/**
 * MarketHero — the market as a demand curve. The numeral is the Demand Index
 * (how the typical sale performs against its own estimate, trailing 12 months)
 * and the line is the same quantity through time — mix-proof, because every
 * lot is normalized by its own ask. The dashed zero line is "sells exactly at
 * estimate"; above it the market is beating the houses' asks. Hover scrubs
 * the numeral; total realized and the price delta live in the context line.
 */
export default function MarketHero({
  allLots,
  demand,
  marketLabel = 'art',
  totalValue,
  pulse,
}: {
  allLots: AuctionLot[];
  /** precomputed at crawl time (eager payload) — computed locally as fallback */
  demand?: { date: string; value: number }[];
  marketLabel?: string;
  totalValue: number;
  pulse: Pulse;
}) {
  const [range, setRange] = useState<Range>('MAX');
  const [hover, setHover] = useState<{ date: string; value: number } | null>(null);
  const drawRef = useChartDraw();

  const series = useMemo(
    () => (demand && demand.length ? demand : demandSeries(allLots)),
    [demand, allLots]
  );

  const visible = useMemo(() => {
    if (range === '1Y') return series.slice(-4);
    if (range === '5Y') return series.slice(-20);
    return series;
  }, [series, range]);

  const now = series.length ? series[series.length - 1].value : 0;
  const yearAgo = series.length >= 5 ? series[series.length - 5].value : null;
  const delta = yearAgo === null ? null : now - yearAgo;

  // Demand above the ask is green; below it, red. The line reads the same way.
  const lineColor = (hover ? hover.value : now) >= 0 ? 'var(--color-up)' : 'var(--color-down)';

  // The context sentence lives beside the trend on desktop and moves below
  // the chart on mobile, so pillars + numeral + chart share one viewport.
  const ctxLine = (
    <>
      {formatPrice(totalValue)} realized all-time
      {pulse.topArtist && <> · led by {pulse.topArtist}</>}
      {pulse.thisWeek > 0 && (
        <>
          {' '}· {pulse.thisWeek} lots hammer this week
          {pulse.belowFlagged > 0 && <> · {pulse.belowFlagged} below estimate</>}
        </>
      )}
    </>
  );

  return (
    <section className="ray-hero2 rail" data-tone={(hover ? hover.value : now) >= 0 ? 'up' : 'down'}>
      <p className="ray-hero2-label" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>
          {hover
            ? `Typical sale vs estimate · 12 months to ${hover.date}`
            : <>The {marketLabel} market<span className="ray-hero2-label-tail"> · typical sale vs its estimate, trailing 12 months</span></>}
        </span>
        <MethodologyNote trigger="what is this?" />
      </p>
      {hover ? (
        <h1 className="ray-hero2-value" style={{ color: lineColor }}>{formatDemand(hover.value)}</h1>
      ) : (
        <h1 className="ray-hero2-value" style={{ color: lineColor }}>
          <CountUp to={now} format={formatDemand} duration={1100} />
        </h1>
      )}
      <p className="ray-hero2-delta">
        {delta !== null && Math.round(delta) !== 0 && yearAgo !== null && (
          <span className={delta > 0 ? 'up' : 'down'}>
            {delta > 0 ? '▲ heating' : '▼ cooling'} · was {formatDemand(yearAgo)} a year ago
          </span>
        )}
        <span className="ctx">{ctxLine}</span>
      </p>

      {visible.length >= 2 && (
        <>
          <div
            key={range} ref={drawRef} className="ray-hero2-chart ray-chartfade ray-chart-draw"
            onMouseLeave={() => setHover(null)}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={visible}
                margin={{ top: 8, right: 0, left: 0, bottom: 0 }}
                onMouseMove={(s: { activePayload?: Array<{ payload: { date: string; value: number } }> }) => {
                  const p = s?.activePayload?.[0]?.payload;
                  if (p) setHover({ date: p.date, value: p.value });
                }}
                onMouseLeave={() => setHover(null)}
              >
                <defs>
                  <linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.13} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} />
                <ReferenceLine y={0} stroke="var(--color-border-mid)" strokeDasharray="4 4" />
                <Tooltip
                  content={() => null}
                  cursor={{ stroke: 'var(--color-border-mid)', strokeWidth: 1 }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={lineColor}
                  strokeWidth={2.25}
                  fill="url(#heroGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: lineColor, stroke: 'var(--color-bg)', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="ray-hero2-span" aria-hidden="true">
            <span>{visible[0].date}</span>
            <span style={{ color: 'var(--color-text-faint)' }}>0% = sells at estimate</span>
            <span>{visible[visible.length - 1].date}</span>
          </div>
          <p className="ray-hero2-ctx">{ctxLine}</p>
          <div className="ray-hero2-ranges" role="radiogroup" aria-label="Chart range">
            {(['1Y', '5Y', 'MAX'] as Range[]).map(r => (
              <button
                key={r}
                role="radio"
                aria-checked={range === r}
                className="ray-range-btn"
                data-active={range === r}
                onClick={() => { setRange(r); setHover(null); }}
              >
                {r === 'MAX' ? 'Max' : r}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
