'use client';

/**
 * MarketIntelligence — the Part-2 engine's flagship surface. Renders the
 * market.json series the value engine builds: a like-for-like price index, a
 * sell-through-rate curve (from the bought-in data most sites throw away), and
 * a house-estimate-accuracy read ("the houses ran their estimates N% light").
 * Every panel names its method and n — the numbers are validated, not asserted.
 */
import React, { useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
import type { MarketSeriesJson } from '../../hooks/useRayData';
import Flick from '../Flick';

const UP = 'var(--color-up)';
const DOWN = 'var(--color-down)';
const INK = '#F4F5F6';
const MUTED = '#7A8087';

// Match the home board's read: the true past-year move — a year ago to now is
// four quarters apart, i.e. five points — so both surfaces measure the same
// span and label it "past year" honestly.
function pctChange(pts: { value: number }[]): number | null {
  if (pts.length < 2) return null;
  const win = pts.slice(-5);
  const base = win[0].value;
  return base ? Math.round((pts[pts.length - 1].value / base - 1) * 100) : null;
}
const tickQ = (d: string) => { const m = /(\d{4}) Q(\d)/.exec(d); return m ? `${m[1].slice(2)} Q${m[2]}` : d; };

function Panel({ title, method, n, children }: { title: string; method: string; n?: number; children: React.ReactNode }) {
  return (
    <div className="ray-mi-panel">
      <div className="ray-mi-head">
        <span className="ray-mi-title">{title}</span>
        <span className="ray-mi-method">{method}{n != null ? ` · ${n.toLocaleString()} sales` : ''}</span>
      </div>
      {children}
    </div>
  );
}

export default function MarketIntelligence({ series, marketLabel }: { series: MarketSeriesJson; marketLabel: string }) {
  const idxChange = useMemo(() => pctChange(series.index), [series.index]);
  const stLatest = series.sellThrough.length ? series.sellThrough[series.sellThrough.length - 1].value : null;
  const accLatest = series.houseAccuracy.length ? series.houseAccuracy[series.houseAccuracy.length - 1].value : null;

  const hasIndex = series.index.length >= 4;

  return (
    <section className="ray-mi">
      <MarketStyles />

      {/* PRICE INDEX — the like-for-like market curve */}
      {hasIndex ? (
        <Panel title={`${marketLabel} price index`} method="like-for-like cohorts, each vs its own average · 3-quarter smoothed · rebased 100" n={series.n}>
          <div className="ray-mi-hero">
            <span className="ray-mi-num">{series.index[series.index.length - 1].value}</span>
            {idxChange != null && (
              <span className="ray-mi-delta" style={{ color: idxChange >= 0 ? UP : DOWN }}>
                <Flick size={11} style={{ verticalAlign: 'baseline', transform: idxChange >= 0 ? undefined : 'scaleY(-1)' }} /> {idxChange >= 0 ? '+' : ''}{idxChange}% past year
              </span>
            )}
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series.index} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="miIdx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={(idxChange || 0) >= 0 ? UP : DOWN} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={(idxChange || 0) >= 0 ? UP : DOWN} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: MUTED }} tickFormatter={tickQ} interval="preserveStartEnd" minTickGap={70} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: MUTED }} width={38} axisLine={false} tickLine={false} domain={['dataMin - 10', 'dataMax + 10']} />
                <ReferenceLine y={100} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 3" />
                <Tooltip contentStyle={{ background: '#0D0F12', border: '1px solid var(--hairline)', fontSize: 12 }} labelStyle={{ color: MUTED }} formatter={(v: number, _n, p) => [`${v} · ${(p.payload.n || 0)} sales`, 'index']} />
                <Area type="monotone" dataKey="value" stroke={(idxChange || 0) >= 0 ? UP : DOWN} strokeWidth={2} fill="url(#miIdx)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      ) : (
        <Panel title={`${marketLabel} price index`} method="insufficient like-for-like depth — suppressed rather than faked">
          <p className="ray-mi-suppress">Not enough repeat like-for-like sales in {marketLabel} to chart an honest price index yet.</p>
        </Panel>
      )}

      <div className="ray-mi-row">
        {/* SELL-THROUGH */}
        {series.sellThrough.length >= 3 && (
          <Panel title="sell-through rate" method="sold ÷ (sold + bought-in), quarterly">
            <div className="ray-mi-hero"><span className="ray-mi-num sm">{stLatest}%</span><span className="ray-mi-sub">of lots found a buyer, latest quarter</span></div>
            <div style={{ height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series.sellThrough} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: MUTED }} tickFormatter={tickQ} interval="preserveStartEnd" minTickGap={60} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: MUTED }} width={30} domain={['dataMin - 8', 'dataMax + 4']} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#0D0F12', border: '1px solid var(--hairline)', fontSize: 12 }} formatter={(v: number) => [`${v}%`, 'sell-through']} />
                  <Line type="monotone" dataKey="value" stroke={INK} strokeWidth={1.8} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        )}

        {/* HOUSE ACCURACY */}
        {series.houseAccuracy.length >= 3 && accLatest != null && (
          <Panel title="house estimate accuracy" method="median hammer ÷ estimate mid, quarterly · hammer basis">
            <div className="ray-mi-hero">
              <span className="ray-mi-num sm">{accLatest > 1 ? '+' : ''}{Math.round((accLatest - 1) * 100)}%</span>
              <span className="ray-mi-sub">lots {accLatest >= 1 ? 'beat' : 'missed'} the houses&rsquo; estimates, latest quarter</span>
            </div>
            <div style={{ height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series.houseAccuracy} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: MUTED }} tickFormatter={tickQ} interval="preserveStartEnd" minTickGap={60} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: MUTED }} width={34} tickFormatter={(v: number) => `${v.toFixed(1)}×`} axisLine={false} tickLine={false} />
                  <ReferenceLine y={1} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 3" />
                  <Tooltip contentStyle={{ background: '#0D0F12', border: '1px solid var(--hairline)', fontSize: 12 }} formatter={(v: number) => [`${v.toFixed(2)}× estimate`, 'realized']} />
                  <Line type="monotone" dataKey="value" stroke={INK} strokeWidth={1.8} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        )}
      </div>
    </section>
  );
}

function MarketStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
      .ray-mi { display: flex; flex-direction: column; gap: 1px; background: var(--hairline); border: 1px solid var(--hairline); }
      .ray-mi-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--hairline); }
      @media (max-width: 760px) { .ray-mi-row { grid-template-columns: 1fr; } }
      .ray-mi-panel { background: var(--panel); padding: 18px 20px; }
      .ray-mi-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
      .ray-mi-title { font-size: 13px; font-weight: 650; color: var(--color-fg); }
      .ray-mi-method { font-size: 10.5px; color: var(--color-text-muted); text-align: right; }
      .ray-mi-hero { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
      .ray-mi-num { font-size: 40px; font-weight: 750; letter-spacing: -2px; color: var(--color-fg); font-variant-numeric: tabular-nums; }
      .ray-mi-num.sm { font-size: 28px; letter-spacing: -1px; }
      .ray-mi-delta { font-size: 13px; font-weight: 600; }
      .ray-mi-sub { font-size: 12px; color: var(--color-text-secondary); }
      .ray-mi-suppress { font-size: 13px; color: var(--color-text-secondary); line-height: 1.5; margin: 4px 0 0; }
    `}} />
  );
}
