'use client';

import { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, YAxis, Tooltip } from 'recharts';
import { MarketStats } from '../types';
import { formatPrice } from '../utils';
import CountUp from './CountUp';

type Range = '1Y' | '5Y' | 'MAX';

interface Pulse {
  weightedAppreciation: number;
  topArtist: string;
  thisWeek: number;
  belowFlagged: number;
}

/**
 * MarketHero — the market as a portfolio view. One giant numeral (total
 * realized across every tracked artist) and the same quantity drawn through
 * time: a chrome-less cumulative curve that ends exactly at the number.
 * Hover scrubs "total realized through <quarter>"; green/red never touch
 * this line — they belong to the price delta in the sentence above.
 */
export default function MarketHero({
  statsByArtist,
  totalValue,
  pulse,
}: {
  statsByArtist: Record<string, MarketStats>;
  totalValue: number;
  pulse: Pulse;
}) {
  const [range, setRange] = useState<Range>('MAX');
  const [hover, setHover] = useState<{ date: string; value: number } | null>(null);

  // The line IS the numeral, through time: cumulative $ realized across the
  // roster, quarter by quarter. It ends exactly at the headline total, hover
  // reads "through <quarter>", and the slope is market activity — quarterly
  // turnover would spike with the auction calendar and read as volatility.
  const series = useMemo(() => {
    const q: Record<string, number> = {};
    for (const stats of Object.values(statsByArtist)) {
      for (const p of stats.priceHistory || []) {
        q[p.date] = (q[p.date] || 0) + p.avgPrice * p.totalSales;
      }
    }
    let running = 0;
    return Object.entries(q)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => {
        running += v;
        return { date: date.replace('-', ' '), value: running };
      });
  }, [statsByArtist]);

  const visible = useMemo(() => {
    if (range === '1Y') return series.slice(-4);
    if (range === '5Y') return series.slice(-20);
    return series;
  }, [series, range]);

  // Accumulation only ever rises — the line is activity, not gains, so it
  // stays neutral-white; green/red are reserved for the price delta above.
  const lineColor = 'var(--color-fg)';

  const apprUp = pulse.weightedAppreciation >= 0;

  return (
    <section className="ray-hero2 rail">
      <p className="ray-hero2-label">
        {hover ? `Total realized through ${hover.date}` : 'The art market · total realized, all time'}
      </p>
      {hover ? (
        <h1 className="ray-hero2-value">{formatPrice(hover.value)}</h1>
      ) : (
        <h1 className="ray-hero2-value">
          <CountUp to={totalValue} format={formatPrice} duration={1300} />
        </h1>
      )}
      <p className="ray-hero2-delta">
        <span className={apprUp ? 'up' : 'down'}>
          {apprUp ? '▲' : '▼'} prices {apprUp ? 'up' : 'down'} {Math.abs(pulse.weightedAppreciation).toFixed(1)}% this year
        </span>
        <span className="ctx">
          {pulse.topArtist && <>led by {pulse.topArtist}</>}
          {pulse.thisWeek > 0 && (
            <>
              {' '}· {pulse.thisWeek} lots hammer this week
              {pulse.belowFlagged > 0 && <> · {pulse.belowFlagged} below estimate</>}
            </>
          )}
        </span>
      </p>

      {visible.length >= 2 && (
        <>
          <div
            key={range} className="ray-hero2-chart ray-chartfade"
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
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.1} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={['dataMin', 'dataMax']} />
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
            <span>{visible[visible.length - 1].date}</span>
          </div>
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
