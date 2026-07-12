'use client';

import { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, YAxis, Tooltip } from 'recharts';
import { AuctionLot, MarketStats } from '../types';
import { formatPrice } from '../utils';
import CountUp from './CountUp';

type Range = '1Y' | '5Y' | 'MAX';

/**
 * ArtistHero — the artist as an asset page. Their number (avg sale, 12mo),
 * their movement (appreciation, green/red), their price line with range
 * control, and a flat strip of the facts. Hovering the line swaps the
 * numeral to that quarter's average — same grammar as the market hero.
 */
export default function ArtistHero({
  label,
  stats,
  lots,
}: {
  label: string;
  stats: MarketStats | null;
  lots: AuctionLot[];
}) {
  const [range, setRange] = useState<Range>('MAX');
  const [hover, setHover] = useState<{ date: string; value: number } | null>(null);

  // Quarterly average sale price from the artist's own sold lots.
  const series = useMemo(() => {
    const q: Record<string, number[]> = {};
    for (const l of lots) {
      if (l.status !== 'sold' || !l.priceUsd) continue;
      const d = new Date(l.saleDate);
      if (isNaN(d.getTime())) continue;
      const key = `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
      (q[key] = q[key] || []).push(l.priceUsd);
    }
    return Object.entries(q)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, prices]) => ({ date, value: prices.reduce((s, p) => s + p, 0) / prices.length }));
  }, [lots]);

  const visible = useMemo(() => {
    if (range === '1Y') return series.slice(-4);
    if (range === '5Y') return series.slice(-20);
    return series;
  }, [series, range]);

  const rangeUp = visible.length >= 2 ? visible[visible.length - 1].value >= visible[0].value : true;
  const lineColor = rangeUp ? 'var(--color-up)' : 'var(--color-down)';

  const facts = useMemo(() => {
    const concluded = lots.filter(l => l.status === 'sold' || l.status === 'bought_in');
    const soldCount = concluded.filter(l => l.status === 'sold').length;
    const sellThrough = concluded.length >= 5 ? Math.round((soldCount / concluded.length) * 100) : null;
    const houses = new Set(lots.map(l => l.auctionHouse)).size;
    const upcoming = lots.filter(l => l.status === 'upcoming').length;
    return { sellThrough, houses, upcoming, total: lots.length };
  }, [lots]);

  const appr = stats?.appreciationRate || 0;
  const avg12 = stats?.avgPriceLast12Months || 0;
  const recordYear = stats?.recordDate ? new Date(stats.recordDate).getUTCFullYear() : null;

  return (
    <section className="ray-hero2 rail">
      <p className="ray-hero2-label">
        {hover ? `${label} · avg sale, ${hover.date}` : `${label} · avg sale price, last 12 months`}
      </p>
      {hover ? (
        <h1 className="ray-hero2-value">{formatPrice(hover.value)}</h1>
      ) : (
        <h1 className="ray-hero2-value">
          {avg12 > 0 ? <CountUp to={avg12} format={formatPrice} duration={1100} /> : '—'}
        </h1>
      )}
      <p className="ray-hero2-delta">
        {appr !== 0 && (
          <span className={appr > 0 ? 'up' : 'down'}>
            {appr > 0 ? '▲' : '▼'} {Math.abs(appr).toFixed(1)}% this year
          </span>
        )}
        <span className="ctx">
          {stats?.recordPrice ? <>record {formatPrice(stats.recordPrice)}{recordYear ? ` (${recordYear})` : ''}</> : null}
          {facts.upcoming > 0 && <> · {facts.upcoming} live {facts.upcoming === 1 ? 'lot' : 'lots'}</>}
        </span>
      </p>

      {visible.length >= 2 && (
        <>
          <div key={range} className="ray-hero2-chart ray-chartfade" style={{ height: 230 }} onMouseLeave={() => setHover(null)}>
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
                  <linearGradient id="artistHeroGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={['dataMin', 'dataMax']} />
                <Tooltip content={() => null} cursor={{ stroke: 'var(--color-border-mid)', strokeWidth: 1 }} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={lineColor}
                  strokeWidth={2.25}
                  fill="url(#artistHeroGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: lineColor, stroke: 'var(--color-bg)', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
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

      <div className="ray-strip">
        <div>
          <div className="ray-strip-k">Record sale</div>
          <div className="ray-strip-v">{stats?.recordPrice ? formatPrice(stats.recordPrice) : '—'}</div>
          <div className="ray-strip-s">
            {stats?.recordTitle
              ? `${stats.recordTitle.length > 34 ? stats.recordTitle.slice(0, 32) + '…' : stats.recordTitle}${recordYear ? `, ${recordYear}` : ''}`
              : 'no concluded sales yet'}
          </div>
        </div>
        <div>
          <div className="ray-strip-k">Sell-through</div>
          <div className="ray-strip-v">{facts.sellThrough !== null ? `${facts.sellThrough}%` : '—'}</div>
          <div className="ray-strip-s">of concluded lots found buyers</div>
        </div>
        <div>
          <div className="ray-strip-k">Lots tracked</div>
          <div className="ray-strip-v">{facts.total.toLocaleString()}</div>
          <div className="ray-strip-s">{facts.upcoming} live right now</div>
        </div>
        <div>
          <div className="ray-strip-k">Auction houses</div>
          <div className="ray-strip-v">{facts.houses}</div>
          <div className="ray-strip-s">selling this artist</div>
        </div>
      </div>
    </section>
  );
}
