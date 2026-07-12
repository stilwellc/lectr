'use client';

import { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { AuctionLot, MarketStats } from '../types';
import { formatPrice } from '../utils';
import { demandSeries, formatDemand } from '../lib/demand';
import CountUp from './CountUp';
import MethodologyNote from './MethodologyNote';

type Range = '1Y' | '5Y' | 'MAX';

/**
 * ArtistHero — the artist as a demand curve. The numeral is how their typical
 * sale performs against its own estimate (trailing 12 months) and the line is
 * that same quantity through time — mix-proof: every lot is normalized by its
 * own ask, so a print quarter and a canvas quarter read on the same scale.
 * The dashed zero line is "sells at estimate". Price context (typical sale,
 * record) lives in the sentence; the medium lens splits editions from unique
 * works when both sides have the sales to draw honestly.
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
  const [lens, setLens] = useState<'all' | 'original' | 'print'>('all');

  const lensCounts = useMemo(() => {
    const sold = lots.filter(l => l.status === 'sold' && l.priceUsd);
    return {
      original: sold.filter(l => l.category === 'original').length,
      print: sold.filter(l => l.category === 'print').length,
    };
  }, [lots]);
  const showLens = lensCounts.original >= 8 && lensCounts.print >= 8;

  const lensLots = useMemo(() => {
    if (lens === 'all' || !showLens) return lots;
    return lots.filter(l => l.category === lens);
  }, [lots, lens, showLens]);

  // The Demand Index for this artist (per lens).
  const series = useMemo(() => demandSeries(lensLots), [lensLots]);

  const visible = useMemo(() => {
    if (range === '1Y') return series.slice(-4);
    if (range === '5Y') return series.slice(-20);
    return series;
  }, [series, range]);

  const now = series.length ? series[series.length - 1].value : 0;
  const yearAgo = series.length >= 5 ? series[series.length - 5].value : null;
  const delta = yearAgo === null ? null : now - yearAgo;
  const lineColor = (hover ? hover.value : now) >= 0 ? 'var(--color-up)' : 'var(--color-down)';

  // Price context: median sale of the trailing 12 months (per lens).
  const typicalSale = useMemo(() => {
    const cutoff = Date.now() - 365 * 86_400_000;
    const prices = lensLots
      .filter(l => l.status === 'sold' && l.priceUsd && new Date(l.saleDate).getTime() >= cutoff)
      .map(l => l.priceUsd!)
      .sort((a, b) => a - b);
    if (prices.length < 3) return null;
    const m = Math.floor(prices.length / 2);
    return prices.length % 2 === 0 ? (prices[m - 1] + prices[m]) / 2 : prices[m];
  }, [lensLots]);

  const facts = useMemo(() => {
    const concluded = lots.filter(l => l.status === 'sold' || l.status === 'bought_in');
    const soldCount = concluded.filter(l => l.status === 'sold').length;
    const sellThrough = concluded.length >= 5 ? Math.round((soldCount / concluded.length) * 100) : null;
    const houses = new Set(lots.map(l => l.auctionHouse)).size;
    const upcoming = lots.filter(l => l.status === 'upcoming').length;
    return { sellThrough, houses, upcoming, total: lots.length };
  }, [lots]);

  const recordYear = stats?.recordDate ? new Date(stats.recordDate).getUTCFullYear() : null;
  const lensWord = lens === 'original' ? 'unique work' : lens === 'print' ? 'edition' : 'sale';

  return (
    <section className="ray-hero2 rail">
      <p className="ray-hero2-label" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>
          {hover
            ? `${label} · typical ${lensWord} vs estimate · 12 months to ${hover.date}`
            : `${label} · typical ${lensWord} vs its estimate, trailing 12 months`}
        </span>
        <MethodologyNote trigger="what is this?" />
      </p>
      {hover ? (
        <h1 className="ray-hero2-value" style={{ color: lineColor }}>{formatDemand(hover.value)}</h1>
      ) : (
        <h1 className="ray-hero2-value" style={{ color: lineColor }}>
          {series.length ? <CountUp to={now} format={formatDemand} duration={1000} /> : '—'}
        </h1>
      )}
      <p className="ray-hero2-delta">
        {delta !== null && Math.round(delta) !== 0 && yearAgo !== null && (
          <span className={delta > 0 ? 'up' : 'down'}>
            {delta > 0 ? '▲ heating' : '▼ cooling'} · was {formatDemand(yearAgo)} a year ago
          </span>
        )}
        <span className="ctx">
          {typicalSale !== null && <>typical {lensWord} {formatPrice(typicalSale)}</>}
          {stats?.recordPrice ? <> · record {formatPrice(stats.recordPrice)}{recordYear ? ` (${recordYear})` : ''}</> : null}
          {facts.upcoming > 0 && <> · {facts.upcoming} live {facts.upcoming === 1 ? 'lot' : 'lots'}</>}
        </span>
      </p>

      {visible.length >= 2 && (
        <>
          <div key={`${range}-${lens}`} className="ray-hero2-chart ray-chartfade" style={{ height: 230 }} onMouseLeave={() => setHover(null)}>
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
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.13} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} />
                <ReferenceLine y={0} stroke="var(--color-border-mid)" strokeDasharray="4 4" />
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
          <div className="ray-hero2-span" aria-hidden="true">
            <span>{visible[0].date}</span>
            <span style={{ color: 'var(--color-text-faint)' }}>0% = sells at estimate</span>
            <span>{visible[visible.length - 1].date}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
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
            {showLens && (
              <div className="ray-seg" role="radiogroup" aria-label="Medium">
                {([['all', 'All'], ['original', 'Unique works'], ['print', 'Editions']] as const).map(([key, lbl]) => (
                  <button
                    key={key}
                    role="radio"
                    aria-checked={lens === key}
                    className="ray-seg-btn"
                    data-active={lens === key}
                    onClick={() => { setLens(key); setHover(null); }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            )}
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
