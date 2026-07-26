'use client';

/**
 * MarketIntelligence — the Part-2 engine's flagship surface. Renders the
 * market.json series the value engine builds: a like-for-like price index, a
 * sell-through-rate curve (from the bought-in data most sites throw away), and
 * a house-estimate-accuracy read ("the houses ran their estimates N% light").
 * Every panel names its method and n — the numbers are validated, not asserted.
 */
import React, { useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
import type { MarketSeriesJson } from '../../hooks/useRayData';
import Flick from '../Flick';
import { toneOf, fmtSignedPct } from '../../utils';

const UP = 'var(--color-up)';
const DOWN = 'var(--color-down)';
const FLAT = 'var(--color-text-muted)';
const INK = '#F2EEE3';
const MUTED = '#8F887A';

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

/** the quarter we are currently inside — its point is a PARTIAL read */
function currentQuarter(): string {
  const d = new Date();
  return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/**
 * The sell-through headline: the last COMPLETE quarter with a real base
 * (n ≥ 30 lots, else fall back one quarter) — never the noisy partial
 * quarter, which was printing three different rates across surfaces in one
 * session. Returns null when no complete quarter exists.
 */
function headlineSellThrough(pts: { period: string; value: number; n: number }[]): { period: string; value: number } | null {
  const nowQ = currentQuarter();
  const complete = pts.filter(p => p.period !== nowQ);
  if (!complete.length) return null;
  for (let i = complete.length - 1; i >= 0; i--) {
    if (complete[i].n >= 30) return complete[i];
  }
  return complete[complete.length - 1];
}

/** 3-quarter trailing average — the same smoothing the price index uses */
function smooth3(pts: { period: string; value: number; n: number }[]) {
  return pts.map((p, i, arr) => {
    const win = arr.slice(Math.max(0, i - 2), i + 1);
    return { ...p, value: Math.round(win.reduce((s, q) => s + q.value, 0) / win.length) };
  });
}

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

type MonthCell = { n: number; hammerMedPct: number; allInMedPct: number; sellThroughPct: number | null };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function MarketIntelligence({ series, marketLabel, seasonality }: { series: MarketSeriesJson; marketLabel: string; seasonality?: MonthCell[] | null }) {
  const idxChange = useMemo(() => pctChange(series.index), [series.index]);
  const stHead = useMemo(() => headlineSellThrough(series.sellThrough), [series.sellThrough]);
  const stSmooth = useMemo(() => smooth3(series.sellThrough), [series.sellThrough]);
  const accLatest = series.houseAccuracy.length ? series.houseAccuracy[series.houseAccuracy.length - 1].value : null;

  const hasIndex = series.index.length >= 4;

  // zero is FLAT — muted, no glyph, never green
  const idxTone = idxChange != null ? toneOf(idxChange) : 'flat';
  const idxColor = idxTone === 'up' ? UP : idxTone === 'down' ? DOWN : FLAT;

  // A no-reserve market (all-Goldin sports) records zero bought-in lots, so
  // every quarter reads a constant 100% — a meaningless figure, not a signal.
  // Detect it from the data (every point pinned at 100) rather than hardcoding
  // a market key: keeps science/culture if they carry real bought-in lots.
  const sellThroughIsFake = series.sellThrough.length > 0 && series.sellThrough.every(p => p.value === 100);
  const showSellThrough = series.sellThrough.length >= 3 && stHead !== null && !sellThroughIsFake;
  const showAccuracy = series.houseAccuracy.length >= 3 && accLatest != null;

  // seasonality: months with n≥30 chart; thinner months are suppressed, and
  // the whole panel is suppressed under 8 usable months (an honest year-shape
  // needs most of the calendar). Hammer basis leads, per the doctrine.
  const seasonRows = useMemo(() => {
    if (!seasonality) return [];
    const rows = seasonality
      .map((c, i) => ({ month: MONTHS[i], pct: c.n >= 30 ? c.hammerMedPct : null, n: c.n }))
      .filter((r): r is { month: string; pct: number; n: number } => r.pct !== null);
    return rows.length >= 8 ? rows : [];
  }, [seasonality]);
  const seasonBest = useMemo(() => (seasonRows.length ? seasonRows.reduce((a, b) => (b.pct > a.pct ? b : a)) : null), [seasonRows]);
  const seasonWorst = useMemo(() => (seasonRows.length ? seasonRows.reduce((a, b) => (b.pct < a.pct ? b : a)) : null), [seasonRows]);
  const seasonN = useMemo(() => seasonRows.reduce((s, r) => s + r.n, 0), [seasonRows]);

  // market depth: sales per quarter — the honest liquidity read. The volume
  // series INCLUDES the in-progress quarter (a partial, ~a few weeks of lots),
  // so headline the last COMPLETE quarter — mirror headlineSellThrough's guard.
  const showDepth = series.volume.length >= 4;
  const depthLatest = useMemo(() => {
    const nowQ = currentQuarter();
    for (let i = series.volume.length - 1; i >= 0; i--) {
      if (series.volume[i].period !== nowQ) return series.volume[i];
    }
    return null;
  }, [series.volume]);
  // when one panel is suppressed the survivor spans the whole band instead of
  // leaving a vacant half
  const soloPanel = showSellThrough !== showAccuracy;

  return (
    <section className="ray-mi">
      <MarketStyles />

      {/* PRICE INDEX — the like-for-like market curve */}
      {hasIndex ? (
        <Panel title={`${marketLabel} price index`} method="like-for-like cohorts, each vs its own average · 3-quarter smoothed · rebased 100" n={series.n}>
          <div className="ray-mi-hero">
            <span className="ray-mi-num">{series.index[series.index.length - 1].value}</span>
            {idxChange != null && (
              <span className="ray-mi-delta" style={{ color: idxColor }}>
                {idxTone !== 'flat' && <Flick size={11} style={{ verticalAlign: 'baseline', marginLeft: 0, marginRight: 4, transform: idxTone === 'up' ? undefined : 'scaleY(-1)' }} />}{fmtSignedPct(idxChange)} past year
              </span>
            )}
          </div>
          {idxChange != null && (
            <p className="ray-mi-caveat">
              A descriptive index reading — mix-sensitive, not a confidence-bounded investment return. For price movement the engine will stand behind, see the <b>Verified movers</b> (95% CI).
            </p>
          )}
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series.index} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="miIdx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={idxColor} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={idxColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: MUTED }} tickFormatter={tickQ} interval="preserveStartEnd" minTickGap={70} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: MUTED }} width={38} axisLine={false} tickLine={false} domain={['dataMin - 10', 'dataMax + 10']} />
                <ReferenceLine y={100} stroke="var(--chart-ref)" strokeDasharray="3 3" />
                <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--hairline)', fontSize: 12 }} labelStyle={{ color: MUTED }} formatter={(v: number, _n, p) => [`${v} · ${(p.payload.n || 0)} sales`, 'index']} />
                <Area type="monotone" dataKey="value" stroke={idxColor} strokeWidth={2} fill="url(#miIdx)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      ) : (
        <Panel title={`${marketLabel} price index`} method="insufficient like-for-like depth — suppressed rather than faked">
          <p className="ray-mi-suppress">Not enough repeat like-for-like sales in {marketLabel} to chart an honest price index yet.</p>
        </Panel>
      )}

      <div className="ray-mi-row" style={soloPanel ? { gridTemplateColumns: '1fr' } : undefined}>
        {/* SELL-THROUGH */}
        {showSellThrough && stHead && (
          <Panel title="sell-through rate" method="sold ÷ (sold + bought-in), quarterly · 3-quarter smoothed">
            <div className="ray-mi-hero"><span className="ray-mi-num sm">{stHead.value}%</span><span className="ray-mi-sub">of lots found a buyer, latest complete quarter ({tickQ(stHead.period)})</span></div>
            <div style={{ height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stSmooth} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: MUTED }} tickFormatter={tickQ} interval="preserveStartEnd" minTickGap={60} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: MUTED }} width={30} domain={['dataMin - 8', 'dataMax + 4']} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--hairline)', fontSize: 12 }} formatter={(v: number) => [`${v}%`, 'sell-through']} />
                  <Line type="monotone" dataKey="value" stroke={INK} strokeWidth={1.8} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        )}

        {/* HOUSE ACCURACY */}
        {showAccuracy && accLatest != null && (
          <Panel title="house estimate accuracy" method="median hammer ÷ estimate mid, quarterly · hammer basis">
            <div className="ray-mi-hero">
              <span className="ray-mi-num sm">{fmtSignedPct(Math.round((accLatest - 1) * 100))}</span>
              <span className="ray-mi-sub">
                {toneOf(Math.round((accLatest - 1) * 100)) === 'flat'
                  ? <>lots landed right on the houses&rsquo; estimates, latest quarter</>
                  : <>lots {accLatest > 1 ? 'beat' : 'missed'} the houses&rsquo; estimates, latest quarter</>}
              </span>
            </div>
            <div style={{ height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series.houseAccuracy} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: MUTED }} tickFormatter={tickQ} interval="preserveStartEnd" minTickGap={60} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: MUTED }} width={34} domain={[0, (max: number) => Math.ceil(max * 2) / 2]} ticks={[0, 0.5, 1, 1.5, 2]} allowDataOverflow={false} tickFormatter={(v: number) => `${v.toFixed(1)}×`} axisLine={false} tickLine={false} />
                  <ReferenceLine y={1} stroke="var(--chart-ref)" strokeDasharray="3 3" />
                  <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--hairline)', fontSize: 12 }} formatter={(v: number) => [`${v.toFixed(2)}× estimate`, 'hammer']} />
                  <Line type="monotone" dataKey="value" stroke={INK} strokeWidth={1.8} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        )}
      </div>

      {(seasonRows.length > 0 || showDepth) && (
        <div className="ray-mi-row" style={seasonRows.length > 0 !== showDepth ? { gridTemplateColumns: '1fr' } : undefined}>
          {/* SEASONALITY — the calendar as a lever */}
          {seasonRows.length > 0 && seasonBest && seasonWorst && (
            <Panel title="seasonality" method={`median hammer vs estimate mid, by calendar month · hammer basis · ${seasonN.toLocaleString()} sales`}>
              <div className="ray-mi-hero">
                <span className="ray-mi-num sm">{seasonBest.month}</span>
                <span className="ray-mi-sub">
                  runs hottest ({fmtSignedPct(seasonBest.pct)} vs mid) · {seasonWorst.month} coolest ({fmtSignedPct(seasonWorst.pct)})
                </span>
              </div>
              <div style={{ height: 130 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={seasonRows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: MUTED }} interval={0} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: MUTED }} width={34} tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}%`} axisLine={false} tickLine={false} />
                    <ReferenceLine y={0} stroke="var(--chart-ref)" />
                    <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ background: 'var(--panel)', border: '1px solid var(--hairline)', fontSize: 12 }} formatter={(v: number, _n, p) => [`${v > 0 ? '+' : ''}${v}% vs mid · ${(p.payload.n || 0).toLocaleString()} sales`, 'hammer']} />
                    <Bar dataKey="pct" radius={[2, 2, 0, 0]}>
                      {seasonRows.map(r => (
                        <Cell key={r.month} fill={INK} fillOpacity={r.month === seasonBest.month || r.month === seasonWorst.month ? 0.95 : 0.35} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}

          {/* MARKET DEPTH — sales per quarter, the honest liquidity read */}
          {showDepth && depthLatest && (
            <Panel title="market depth" method="catalogued sales per quarter — how liquid this market actually is">
              <div className="ray-mi-hero">
                <span className="ray-mi-num sm">{depthLatest.value.toLocaleString()}</span>
                <span className="ray-mi-sub">sales in the latest complete quarter ({tickQ(depthLatest.period)})</span>
              </div>
              <div style={{ height: 130 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series.volume} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="period" tick={{ fontSize: 10, fill: MUTED }} tickFormatter={tickQ} interval="preserveStartEnd" minTickGap={60} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: MUTED }} width={38} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ background: 'var(--panel)', border: '1px solid var(--hairline)', fontSize: 12 }} formatter={(v: number) => [`${v.toLocaleString()} sales`, 'depth']} />
                    <Bar dataKey="value" fill={INK} fillOpacity={0.5} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}
        </div>
      )}
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
      .ray-mi-num { font-family: var(--font-mono), monospace; font-size: 40px; font-weight: 500; letter-spacing: -2px; color: var(--color-fg); font-variant-numeric: tabular-nums; }
      .ray-mi-num.sm { font-size: 28px; letter-spacing: -1px; }
      .ray-mi-delta { font-size: 13px; font-weight: 600; }
      .ray-mi-sub { font-size: 12px; color: var(--color-text-secondary); }
      .ray-mi-suppress { font-size: 13px; color: var(--color-text-secondary); line-height: 1.5; margin: 4px 0 0; }
      .ray-mi-caveat { font-size: 11.5px; color: var(--color-text-muted); line-height: 1.5; margin: -2px 0 12px; max-width: 620px; }
      .ray-mi-caveat b { font-weight: 650; color: var(--color-text-secondary); }
    `}} />
  );
}
