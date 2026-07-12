'use client';

import { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
import { AuctionLot } from '../types';
import { demandSeries, formatDemand } from '../lib/demand';
import CountUp from './CountUp';
import { useChartDraw } from '../hooks/useChartDraw';
import MethodologyNote from './MethodologyNote';

type Range = '1Y' | '5Y' | '10Y' | 'MAX';

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
export default function BoardDemand({
  allLots,
  demand,
  marketLabel = 'collectibles',
  ledger,
}: {
  allLots: AuctionLot[];
  demand?: { date: string; value: number }[];
  marketLabel?: string;
  ledger: LedgerItem[];
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
    if (range === '10Y') return series.slice(-40);
    return series;
  }, [series, range]);

  const now = series.length ? series[series.length - 1].value : 0;
  const yearAgo = series.length >= 5 ? series[series.length - 5].value : null;
  const delta = yearAgo === null ? null : now - yearAgo;

  // color says direction, never level
  const dir = visible.length >= 2 ? visible[visible.length - 1].value - visible[0].value : 0;
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
          <span>The {marketLabel} market · typical sale vs its estimate, trailing 12 months</span>
          <MethodologyNote trigger="what is this?" />
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

      <div className="ray-numrow">
        {hover ? (
          <h1 className="ray-hero2-value">{formatDemand(hover.value)}</h1>
        ) : (
          <h1 className="ray-hero2-value"><CountUp to={now} format={formatDemand} duration={900} /></h1>
        )}
        <span className="ray-numrow-delta">
          {hover
            ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>12 months to {hover.date}</span>
            : delta !== null && Math.round(delta) !== 0 && (
              <span className={delta > 0 ? 'up' : 'down'}>
                {delta > 0 ? '▲ heating' : '▼ cooling'} · {delta > 0 ? '+' : '−'}{Math.abs(Math.round(delta))} pts vs a year ago
              </span>
            )}
        </span>
        {hover && (
          <span className="ray-scrubchip">
            {hover.date}{hoverPrior !== null && <> · vs {formatDemand(hoverPrior)} a year prior</>}
          </span>
        )}
      </div>

      <div className="ray-ledger">
        {ledger.map(item => (
          <div key={item.k}>
            <div className="ray-ledger-k">{item.k}</div>
            <CountUp to={item.to} format={item.format} className={`ray-ledger-v${item.tone === 'up' ? ' up' : ''}`} style={{ display: 'block' }} />
            <div className="ray-ledger-s">{item.s}</div>
          </div>
        ))}
      </div>

      {visible.length >= 2 && (
        <div
          key={range}
          ref={drawRef}
          className="ray-chartfade ray-chart-draw"
          style={{ height: 320, marginTop: 6 }}
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
                tickFormatter={(d: string) => d.split(' ')[0]}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={90}
                padding={{ left: 4, right: 4 }}
              />
              <YAxis
                orientation="right"
                width={40}
                tick={{ fontSize: 11, fill: '#7A8087', fontFamily: 'var(--font-sans), sans-serif' }}
                tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}%`}
                axisLine={false}
                tickLine={false}
                domain={[(min: number) => Math.min(-5, Math.floor(min)), (max: number) => Math.ceil(max)]}
              />
              <ReferenceLine
                y={0}
                stroke="rgba(255,255,255,0.16)"
                strokeDasharray="4 4"
                label={{ value: '0 — sells at estimate', position: 'insideBottomLeft', fill: '#7A8087', fontSize: 11, fontFamily: 'var(--font-sans), sans-serif', dy: -4 }}
              />
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
