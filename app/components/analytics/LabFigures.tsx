'use client';

/**
 * LabFigures — the second-wave observatory instruments (Aug 29). Five
 * figures over data the pipeline has served nightly but nothing plotted:
 *
 *   · CloseCurveFigure — how bids arrive: the fitted close-day growth
 *     multiple by days-out bucket (the Gap lane's own curve, drawn)
 *   · CoverageFunnel — how wide the engine's prediction bands really are,
 *     by confidence tier, with measured coverage
 *   · VenueStrip — the venue factor: what each house's room does to a
 *     price, as a dot strip around 1.0× (zero consumers before this)
 *   · DepthField — the live board as a scatter field: every appraised
 *     live lot, bid-vs-comps against comp value, ink density = confidence
 *   · RepeatSaleRoom — same-object-sold-twice index + horizon whiskers,
 *     the cleanest price-movement evidence the corpus carries
 *
 * Grammar: hand-rolled, token inks only (ink ladder for tiers, signal
 * inks only for signed reads), HTML %-positioned labels (svg text under
 * preserveAspectRatio:none distorts — the DossierChart law), FigCap under
 * every figure. Structural in both modes.
 */
import React, { useMemo } from 'react';
import Link from 'next/link';
import HeroChart, { type HeroLine } from '../../preview/terminal/HeroChart';
import type { MarketData, Backtest, HedonicEntry } from '../../hooks/useRayData';
import type { AuctionLot } from '../../types';
import { marketOf } from '../../constants';
import { MARKET_COLOR } from '../../lib/heroLayers';
import FigCap from '../FigCap';
import { GapMark, OddsMark, DepthMark, SalesMark } from '../marks';

const CSS = `
.ray-lf-card { padding: var(--card-pad); min-width: 0; }
.ray-lf-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
.ray-lf-title { font-size: 13.5px; font-weight: 550; color: var(--color-fg); }
.ray-lf-title .ray-sect-mark { margin-right: 8px; }
.ray-lf-method { font-size: 10.5px; color: var(--color-text-muted); text-align: right; }
.ray-lf-plot { position: relative; overflow: hidden; }
.ray-lf-lbl { position: absolute; font-family: var(--font-mono), monospace; font-size: 10px; color: var(--color-text-muted); white-space: nowrap; transform: translateX(-50%); }
.ray-lf-vlbl { position: absolute; font-family: var(--font-mono), monospace; font-size: 10px; color: var(--color-text-muted); white-space: nowrap; }
.ray-lf-note { position: absolute; font-size: 10.5px; color: var(--color-text-faint); white-space: nowrap; }
.ray-lf-grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; align-items: stretch; }
.ray-lf-grid3 > .ray-lf-card { display: flex; flex-direction: column; }
.ray-lf-grid3 > .ray-lf-card .ray-lf-plot, .ray-lf-grid3 > .ray-lf-card .ray-lf-venue { flex: 1 1 auto; }
.ray-lf-grid3 > .ray-lf-card figcaption, .ray-lf-grid3 > .ray-lf-card .ray-figcap { margin-top: auto; }
.ray-lf-grid3 > * { min-width: 0; }
@media (max-width: 1000px) { .ray-lf-grid3 { grid-template-columns: 1fr; } }
.ray-lf-dot { position: absolute; border-radius: 50%; transform: translate(-50%, 50%); }
.ray-lf-venue { display: flex; flex-direction: column; }
.ray-lf-vrow { display: grid; grid-template-columns: minmax(88px, 120px) 1fr 52px; align-items: center; gap: 10px; min-height: 27px; }
.ray-lf-vname { font-size: 12px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ray-lf-vtrack { position: relative; height: 100%; min-height: 22px; }
.ray-lf-vrule { position: absolute; top: -3px; bottom: -3px; border-left: 1px dashed var(--chart-ref); }
.ray-lf-vval { font-family: var(--font-mono), monospace; font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
.ray-lf-axis { position: absolute; left: 0; right: 0; border-top: 1px solid var(--chart-grid); }
.ray-lf-zero { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--chart-ref); }
.ray-lf-comp { --lfgut: 100px; }
.ray-lf-cend { position: absolute; font-size: 10.5px; white-space: nowrap; transform: translateY(-50%); max-width: calc(var(--lfgut) - 6px); overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 640px) { .ray-lf-comp { --lfgut: 78px; } .ray-lf-cend { font-size: 9.5px; } }
`;

/* ── shared: the ink ladder for confidence tiers — labs rank by density,
   not by hue ── */
const TIER_INK: Record<string, string> = {
  high: 'var(--color-fg)',
  medium: 'var(--color-text-muted)',
  low: 'var(--color-text-faint)',
};

/* the field speaks the index laboratory's exact color language — one
   market→ink map, exported from heroLayers (single source of truth) */
const MARKET_INK = MARKET_COLOR;
const MARKET_LABEL: Record<string, string> = {
  watches: 'watches', art: 'art', design: 'design', sports: 'sports',
  tcg: 'tcg', science: 'science', culture: 'pop culture',
};

/* ═══ 1 · THE CLOSE CURVE ═══ */
export function CloseCurveFigure({ marketData }: { marketData: MarketData | null }) {
  const cc = (marketData?.markets?.all?.analytics as unknown as {
    closeCurve?: { buckets: number[]; edges: number[]; n: number[] };
  } | undefined)?.closeCurve;
  if (!cc?.buckets?.length) return null;
  const labels = ['<1d', '1–2d', '2–4d', '4–8d', '8d+'].slice(0, cc.buckets.length);
  const max = Math.max(...cc.buckets);
  const H = 150;
  const totalN = cc.n.reduce((s, v) => s + v, 0);
  return (
    <div className="ray-lf-card glass glass-quiet">
      <div className="ray-lf-head">
        <span className="ray-lf-title"><span className="ray-sect-mark" aria-hidden><GapMark size={15} /></span>How bids arrive</span>
        <span className="ray-lf-method">final ÷ current bid, by days out</span>
      </div>
      <div className="ray-lf-plot" style={{ height: H + 28 }}>
        {cc.buckets.map((v, i) => {
          const h = Math.max(4, (v / max) * H);
          const x = (i + 0.5) / cc.buckets.length;
          return (
            <React.Fragment key={i}>
              <span style={{
                position: 'absolute', bottom: 28, left: `${x * 100}%`, transform: 'translateX(-50%)',
                width: `${Math.max(8, 46 / cc.buckets.length)}%`, height: h,
                background: 'color-mix(in srgb, var(--color-fg) 14%, transparent)',
                borderTop: '2px solid var(--color-fg)', borderRadius: '3px 3px 0 0',
              }} aria-hidden />
              <span className="ray-lf-lbl" style={{ bottom: 28 + h + 5, left: `${x * 100}%`, color: 'var(--color-fg)', fontWeight: 600 }}>
                {v.toFixed(1)}×
              </span>
              <span className="ray-lf-lbl" style={{ bottom: 10, left: `${x * 100}%` }}>{labels[i]}</span>
            </React.Fragment>
          );
        })}
        <span className="ray-lf-axis" style={{ bottom: 28 }} aria-hidden />
      </div>
      <FigCap>
        Median growth from the current bid to the final price by time remaining, fitted from {totalN.toLocaleString()} bid
        histories — a lot 8+ days out multiplies {cc.buckets[cc.buckets.length - 1].toFixed(1)}× by the close. This is the
        curve the Gap lane projects with.
      </FigCap>
    </div>
  );
}

/* ═══ 2 · THE COVERAGE FUNNEL ═══ */
export function CoverageFunnel({ backtest }: { backtest: Backtest | null }) {
  const band = backtest?.calibration?.band as Record<string, { lo: number; hi: number }> | undefined;
  const cov = (backtest?.calibration as unknown as { bandCoverage?: Record<string, number> } | undefined)?.bandCoverage;
  if (!band?.high) return null;
  const tiers = (['high', 'medium', 'low'] as const).filter(t => band[t]);
  // shared log-x axis over the union of bands, 1.0× marked
  const lo = Math.min(...tiers.map(t => band[t].lo)) * 0.9;
  const hi = Math.max(...tiers.map(t => band[t].hi)) * 1.1;
  const X = (v: number) => ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * 100;
  return (
    <div className="ray-lf-card glass glass-quiet">
      <div className="ray-lf-head">
        <span className="ray-lf-title"><span className="ray-sect-mark" aria-hidden><OddsMark size={15} /></span>Band width</span>
        <span className="ray-lf-method">prediction interval by confidence</span>
      </div>
      <div className="ray-lf-plot" style={{ height: 150 }}>
        <span style={{ position: 'absolute', top: 0, bottom: 26, left: `${X(1)}%`, borderLeft: '1px dashed var(--chart-ref)' }} aria-hidden />
        <span className="ray-lf-lbl" style={{ bottom: 8, left: `${X(1)}%` }}>1.0× · the call</span>
        {tiers.map((t, i) => {
          const y = 14 + i * 38;
          return (
            <React.Fragment key={t}>
              <span className="ray-lf-vlbl" style={{ top: y - 4, left: 0, color: TIER_INK[t], fontWeight: 600 }}>{t}</span>
              <span style={{
                position: 'absolute', top: y + 12, left: `${X(band[t].lo)}%`, width: `${X(band[t].hi) - X(band[t].lo)}%`,
                height: 5, borderRadius: 3, background: TIER_INK[t], opacity: t === 'high' ? 0.9 : t === 'medium' ? 0.55 : 0.3,
              }} aria-hidden />
              <span className="ray-lf-vlbl" style={{ top: y + 6, left: `calc(${X(band[t].lo)}% - 4px)`, transform: 'translateX(-100%)' }}>
                {band[t].lo.toFixed(2)}×
              </span>
              <span className="ray-lf-vlbl" style={X(band[t].hi) > 62
                ? { top: y - 4, left: `${X(band[t].hi)}%`, transform: 'translateX(-100%)' }
                : { top: y + 6, left: `calc(${X(band[t].hi)}% + 6px)` }}>
                {band[t].hi.toFixed(2)}×{cov?.[t] != null ? ` · ${cov[t]}% inside` : ''}
              </span>
            </React.Fragment>
          );
        })}
      </div>
      <FigCap>
        Conformal prediction bands around the engine&apos;s value calls, by confidence tier — the realized price landed
        inside its band {cov?.high ?? 70}% of the time at every tier (that symmetry is the design: the tier moves the
        WIDTH, never the promise).
      </FigCap>
    </div>
  );
}

/* ═══ 3 · THE VENUE FACTOR ═══ */
export function VenueStrip({ marketData }: { marketData: MarketData | null }) {
  const vf = (marketData?.markets?.all?.analytics as unknown as {
    venueFactors?: Record<string, number>;
  } | undefined)?.venueFactors;
  if (!vf || !Object.keys(vf).length) return null;
  const rows = Object.entries(vf).sort((a, b) => b[1] - a[1]);
  const lo = Math.min(0.85, ...rows.map(r => r[1])) - 0.04;
  const hi = Math.max(1.15, ...rows.map(r => r[1])) + 0.04;
  const X = (v: number) => ((v - lo) / (hi - lo)) * 100;
  return (
    <div className="ray-lf-card glass glass-quiet">
      <div className="ray-lf-head">
        <span className="ray-lf-title"><span className="ray-sect-mark" aria-hidden><SalesMark size={15} /></span>The venue factor</span>
        <span className="ray-lf-method">what the room does to a price</span>
      </div>
      {/* ROW GRAMMAR (the collision fix): every row is a grid of three
          gutters — name | track | value. Labels can never sit on names
          because they never share a column. The 1.00× rule spans the
          track gutter only. */}
      <div className="ray-lf-venue">
        {rows.map(([house, f]) => {
          const up = f > 1.001; const down = f < 0.999;
          return (
            <div key={house} className="ray-lf-vrow">
              <span className="ray-lf-vname" title={house}>{house}</span>
              <span className="ray-lf-vtrack" aria-hidden>
                <i className="ray-lf-vrule" style={{ left: `${X(1)}%` }} />
                <i style={{
                  position: 'absolute', top: '50%', marginTop: -1, height: 2,
                  left: `${Math.min(X(1), X(f))}%`, width: `${Math.abs(X(f) - X(1))}%`,
                  background: 'var(--chart-grid)',
                }} />
                <i className="ray-lf-dot" style={{
                  top: '50%', left: `${X(f)}%`, width: 9, height: 9, marginTop: -0.5,
                  background: up ? 'var(--color-up)' : down ? 'var(--color-down)' : 'var(--color-text-muted)',
                }} />
              </span>
              <span className="ray-lf-vval" style={{ color: 'var(--color-fg)' }}>{f.toFixed(2)}×</span>
            </div>
          );
        })}
        <div className="ray-lf-vrow" aria-hidden>
          <span className="ray-lf-vname" />
          <span className="ray-lf-vtrack" style={{ height: 14 }}>
            <span className="ray-lf-lbl" style={{ top: 0, left: `${X(1)}%` }}>1.00×</span>
          </span>
          <span className="ray-lf-vval" />
        </div>
      </div>
      <FigCap>
        The venue multiplier the engine applies when a comp sold in a different room — the same object trades
        {' '}{Math.max(...rows.map(r => r[1])).toFixed(2)}× in the hottest room against {Math.min(...rows.map(r => r[1])).toFixed(2)}×
        in the coolest. Signed inks here are measured venue effects, fitted from cross-house repeat comparisons.
      </FigCap>
    </div>
  );
}

/* ═══ 4 · THE DEPTH FIELD — the live board as a scatter ═══ */
export function DepthField({ lots, scope = 'all' }: { lots: AuctionLot[]; scope?: string }) {
  const pts = useMemo(() => {
    const out: { id: string; x: number; y: number; n: number; conf: string; title: string; mkt: string; kind: 'bid' | 'ask' }[] = [];
    for (const l of lots) {
      if (l.status !== 'upcoming') continue;
      const v = (l as AuctionLot & { value?: { compValueUsd?: number; vsBid?: { pct: number } | null; n?: number; confidence?: string } }).value;
      if (v?.compValueUsd && v.compValueUsd >= 50 && v.vsBid && typeof v.vsBid.pct === 'number') {
        out.push({
          id: l.id, x: v.compValueUsd, y: Math.max(-95, Math.min(150, v.vsBid.pct)),
          n: v.n || 1, conf: v.confidence || 'low', title: l.title || '',
          mkt: marketOf(l.artist) || 'culture', kind: 'bid',
        });
        continue;
      }
      // ESTIMATE-HOUSE lots (art, watches, science…) carry the same read on
      // the ASK: signal.pct is comps-vs-ask, inverted here onto the shared
      // "price on the block vs comps" axis. Rings, not dots — the price is
      // an estimate midpoint, not money already on the table.
      const sig = l.signal as (NonNullable<AuctionLot['signal']> & { med?: number }) | null | undefined;
      if (sig && typeof sig.pct === 'number' && sig.med && sig.med >= 50 && (l.estimateLow || l.estimateHigh)) {
        const askVs = sig.label === 'Below Market'
          ? (1 / (1 + sig.pct / 100) - 1) * 100
          : (1 / Math.max(0.05, 1 - sig.pct / 100) - 1) * 100;
        out.push({
          id: l.id, x: sig.med, y: Math.max(-95, Math.min(150, askVs)),
          n: sig.basis || 1, conf: sig.confidence === 'very-high' ? 'high' : (sig.confidence || 'low'), title: l.title || '',
          mkt: marketOf(l.artist) || 'culture', kind: 'ask',
        });
      }
    }
    return scope === 'all' ? out : out.filter(p => p.mkt === scope);
  }, [lots, scope]);
  if (pts.length < (scope === 'all' ? 40 : 12)) return null;
  const xs = pts.map(p => Math.log(p.x));
  const xLo = Math.min(...xs), xHi = Math.max(...xs);
  const yLo = -100, yHi = 155;
  const X = (v: number) => ((Math.log(v) - xLo) / (xHi - xLo || 1)) * 100;
  const Y = (v: number) => (1 - (v - yLo) / (yHi - yLo)) * 100;
  const below = pts.filter(p => p.y < 0).length;
  const H = 300;
  const decades = [100, 1000, 10000, 100000, 1000000].filter(d => Math.log(d) > xLo && Math.log(d) < xHi);
  const fmt$ = (v: number) => (v >= 1e6 ? '$1M' : v >= 1e3 ? `$${v / 1e3}K` : `$${v}`);
  return (
    <div className="ray-lf-card ray-lf-field glass glass-quiet">
      <div className="ray-lf-head">
        <span className="ray-lf-title"><span className="ray-sect-mark" aria-hidden><DepthMark size={15} /></span>The depth field</span>
        <span className="ray-lf-method">the live board vs its comps · ● bid · ○ ask · hue = market · opacity = confidence</span>
      </div>
      <div className="ray-lf-plot" style={{ height: H + 26 }}>
        <span className="ray-lf-zero" style={{ top: `${(Y(0) / 100) * H}px` }} aria-hidden />
        <span className="ray-lf-note" style={{ top: `${(Y(0) / 100) * H - 16}px`, right: 0 }}>bid at comp level · 0%</span>
        <span className="ray-lf-note" style={{ top: `${(Y(-60) / 100) * H}px`, left: 0, color: 'var(--color-up)' }}>the under-bid mass ↓</span>
        {decades.map(d => (
          <React.Fragment key={d}>
            <span style={{ position: 'absolute', top: 0, height: H, left: `${X(d)}%`, borderLeft: '1px solid var(--chart-grid)' }} aria-hidden />
            <span className="ray-lf-lbl" style={{ bottom: 6, left: `${X(d)}%` }}>{fmt$(d)}</span>
          </React.Fragment>
        ))}
        {pts.map(p => (
          <Link key={p.id} href={`/lot?id=${encodeURIComponent(p.id)}`} title={`${p.title.slice(0, 60)} · comps ${fmt$(Math.round(p.x))} · bid ${p.y > 0 ? '+' : ''}${Math.round(p.y)}% vs comps · ${p.n} comps`}
            className="ray-lf-dot" style={{
              top: `${(Y(p.y) / 100) * H}px`, left: `${X(p.x)}%`,
              width: Math.min(13, 4 + Math.sqrt(p.n) * 1.6), height: Math.min(13, 4 + Math.sqrt(p.n) * 1.6),
              ...(p.kind === 'bid'
                ? { background: MARKET_INK[p.mkt] || 'var(--color-text-faint)' }
                : { background: 'transparent', border: `1.5px solid ${MARKET_INK[p.mkt] || 'var(--color-text-faint)'}` }),
              opacity: p.conf === 'high' ? 0.92 : p.conf === 'medium' ? 0.6 : 0.35,
            }} aria-label={`Open lot: ${p.title.slice(0, 50)}`} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', padding: '10px 0 0', fontSize: 11.5, color: 'var(--color-text-muted)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <i style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-text-secondary)', display: 'inline-block' }} aria-hidden /> live bid
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <i style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--color-text-secondary)', display: 'inline-block', boxSizing: 'border-box' }} aria-hidden /> ask
        </span>
        {scope === 'all' && Object.keys(MARKET_INK).filter(m => pts.some(p => p.mkt === m)).map(m => (
          <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <i style={{ width: 8, height: 8, borderRadius: '50%', background: MARKET_INK[m], display: 'inline-block' }} aria-hidden />
            {MARKET_LABEL[m] || m}
          </span>
        ))}
      </div>
      <FigCap>
        {pts.length} live lots against their comps — filled dots carry a printed bid, rings carry only an ask
        (estimate midpoint vs the comp median). Vertical is the price&apos;s distance from the comps (below the dashed
        rule = priced under them, {Math.round((below / pts.length) * 100)}% of the field right now); horizontal is the
        comp median (log). Hue is the market, size is comp-pool depth, opacity is engine confidence. Every point opens
        its lot.
      </FigCap>
    </div>
  );
}

/* ═══ 5 · THE REPEAT-SALE ROOM ═══ */
export function RepeatSaleRoom({ marketData, scope }: { marketData: MarketData | null; scope: string }) {
  const rsAll = (marketData as MarketData & { repeatSale?: Record<string, {
    method?: string; basis?: string; nPairs?: number; nObjects?: number;
    horizons?: Record<string, { publishable?: boolean; changePct?: number | null; ciLoPct?: number | null; ciHiPct?: number | null }>;
    series?: { period: string; value: number; n?: number }[];
  }> } | null)?.repeatSale;
  const key = rsAll?.[scope] ? scope : (scope === 'all' && rsAll?.watches ? 'watches' : null);
  const rs = key ? rsAll![key] : null;
  const built = useMemo(() => {
    if (!rs?.series || rs.series.length < 6) return null;
    const base = rs.series[0].value;
    if (!(base > 0)) return null;
    const anchor: HeroLine = {
      key: '_rs', label: 'Repeat-sale index', color: '', unit: 'pct',
      points: rs.series.map(p => ({ period: p.period, value: ((p.value / base) - 1) * 100, n: p.n ?? 0 })),
    };
    return anchor;
  }, [rs]);
  if (!rs || !built) return null;
  const horizons = (['1Y', '3Y', '5Y'] as const)
    .map(h => ({ h, v: rs.horizons?.[h] }))
    .filter(x => x.v?.publishable && x.v.changePct != null && x.v.ciLoPct != null && x.v.ciHiPct != null);
  const ext = horizons.length
    ? { lo: Math.min(0, ...horizons.map(x => x.v!.ciLoPct!)), hi: Math.max(0, ...horizons.map(x => x.v!.ciHiPct!)) }
    : null;
  const HX = (v: number) => ext ? ((v - ext.lo) / (ext.hi - ext.lo || 1)) * 100 : 0;
  return (
    <div className="ray-lf-card glass glass-quiet">
      <div className="ray-lf-head">
        <span className="ray-lf-title"><span className="ray-sect-mark" aria-hidden><SalesMark size={15} /></span>Same object, sold twice{key !== scope ? ` · ${key}` : ''}</span>
        <span className="ray-lf-method">repeat-sale index · {rs.nPairs?.toLocaleString()} pairs · {rs.nObjects?.toLocaleString()} objects</span>
      </div>
      <HeroChart anchor={built} height={170} compact play={false} hideTickLabels={false} />
      {horizons.length > 0 && (
        <div className="ray-lf-plot" style={{ height: horizons.length * 26 + 26, marginTop: 8 }}>
          <span style={{ position: 'absolute', top: 0, bottom: 22, left: `${HX(0)}%`, borderLeft: '1px dashed var(--chart-ref)' }} aria-hidden />
          <span className="ray-lf-lbl" style={{ bottom: 4, left: `${HX(0)}%` }}>0%</span>
          {horizons.map((x, i) => {
            const y = 4 + i * 26;
            const dir = (x.v!.changePct ?? 0) >= 0;
            return (
              <React.Fragment key={x.h}>
                <span className="ray-lf-vlbl" style={{ top: y, left: 0, fontWeight: 600, color: 'var(--color-fg)' }}>{x.h}</span>
                <span style={{
                  position: 'absolute', top: y + 5, left: `${HX(x.v!.ciLoPct!)}%`, width: `${HX(x.v!.ciHiPct!) - HX(x.v!.ciLoPct!)}%`,
                  height: 4, borderRadius: 2, background: dir ? 'var(--color-up)' : 'var(--color-down)', opacity: 0.32,
                }} aria-hidden />
                <span className="ray-lf-dot" style={{
                  top: y + 11, left: `${HX(x.v!.changePct!)}%`, width: 8, height: 8,
                  background: dir ? 'var(--color-up)' : 'var(--color-down)',
                }} aria-hidden />
                <span className="ray-lf-vlbl" style={HX(x.v!.ciHiPct!) > 72
                  ? { top: y, left: `calc(${HX(x.v!.ciLoPct!)}% - 10px)`, transform: 'translateX(-100%)', fontVariantNumeric: 'tabular-nums' }
                  : { top: y, left: `calc(${HX(x.v!.ciHiPct!)}% + 10px)`, fontVariantNumeric: 'tabular-nums' }}>
                  {(x.v!.changePct! >= 0 ? '+' : '')}{x.v!.changePct!.toFixed(0)}% [{x.v!.ciLoPct!.toFixed(0)}, {x.v!.ciHiPct!.toFixed(0)}]
                </span>
              </React.Fragment>
            );
          })}
        </div>
      )}
      <FigCap>
        The same physical object selling twice is the cleanest price evidence auctions produce — {rs.nPairs?.toLocaleString()}
        {' '}pairs across {rs.nObjects?.toLocaleString()} objects, GLS-fit, rebased to the window start. Whiskers are the
        95% intervals of the published horizons; unpublishable horizons abstain and are absent.
      </FigCap>
    </div>
  );
}

/* ═══ 6 · THE COMPOSITE AND ITS PARTS — dispersion, drawn ═══
   The all-market hedonic composite against its seven per-vertical component
   fits, every line rebased over the same window (IndexLab's rebase form:
   window slice → base = first value → Δ%). The window is the pooled fit's
   ONLY publishable horizon (1Y, complete quarters): its own gates print
   composition breaks beyond that, and drawing the raw 3Y series would dress
   a mix artifact (Q3'23→Q1'24 ×4.4) as a price move. Honest window or none. */
export function CompositeParts({ marketData }: { marketData: MarketData | null }) {
  const built = useMemo(() => {
    const hed = marketData?.hedonic as unknown as Record<string, HedonicEntry & {
      lastCompleteQuarter?: string; diag?: { nLots?: number };
    }> | undefined;
    const all = hed?.all;
    const h1 = all?.horizons?.['1Y'];
    // no publishable pooled read → no figure: dispersion around an abstained
    // composite would print a break as a move
    if (!all?.series?.length || !h1?.publishable || h1.changePct == null) return null;
    const endI = all.lastCompleteQuarter ? all.series.findIndex(p => p.period === all.lastCompleteQuarter) : -1;
    if (endI < 4) return null;
    const win = all.series.slice(endI - 4, endI + 1); // the 1Y horizon, complete quarters only
    const periods = win.map(p => p.period);
    const pIdx = new Map(periods.map((p, i) => [p, i] as const));
    const base = win[0].value;
    if (!(base > 0)) return null;
    const reb = (v: number, b: number) => ((v / b) - 1) * 100;
    const comps: { key: string; label: string; ink: string; pts: { i: number; v: number }[] }[] = [];
    for (const key of Object.keys(MARKET_INK)) {
      const w = (hed?.[key]?.series || []).filter(p => pIdx.has(p.period));
      if (w.length < periods.length || w[0].period !== periods[0]) continue;
      const b = w[0].value;
      if (!(b > 0)) continue;
      comps.push({
        key, label: MARKET_LABEL[key] || key, ink: MARKET_INK[key] || 'var(--color-text-faint)',
        pts: w.map(p => ({ i: pIdx.get(p.period)!, v: reb(p.value, b) })),
      });
    }
    if (comps.length < 3) return null;
    const cPts = win.map((p, i) => ({ i, v: reb(p.value, base) }));
    const finals = comps.map(c => c.pts[c.pts.length - 1].v);
    const spread = Math.max(...finals) - Math.min(...finals);
    const vals = [...cPts.map(p => p.v), ...comps.flatMap(c => c.pts.map(p => p.v))];
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const pad = (hi - lo) * 0.07 || 10; lo -= pad; hi += pad;
    const step = [10, 20, 25, 50, 100, 200, 500].find(s => (hi - lo) / s <= 5.5) || 500;
    const grid: number[] = [];
    for (let g = Math.ceil(lo / step) * step; g <= hi; g += step) grid.push(g);
    const abst = all.horizons?.['3Y']?.reason || all.horizons?.['5Y']?.reason || '';
    return { periods, cPts, comps, lo, hi, grid, spread, h1, nEndQ: win[win.length - 1].n ?? 0, nLots: all.diag?.nLots, abst };
  }, [marketData]);
  if (!built) return null;
  const H = 235;
  const X = (i: number) => (i / (built.periods.length - 1)) * 100;
  const Y = (v: number) => (1 - (v - built.lo) / (built.hi - built.lo)) * 100;
  const path = (pts: { i: number; v: number }[]) => pts.map(p => `${X(p.i)},${Y(p.v)}`).join(' ');
  // direct end labels, collision-nudged down the right gutter (no legend)
  const items = [
    ...built.comps.map(c => ({ label: c.label, ink: c.ink, v: c.pts[c.pts.length - 1].v, strong: false })),
    {
      label: `all markets ${built.h1.changePct! >= 0 ? '+' : ''}${built.h1.changePct!.toFixed(0)}%`,
      ink: 'var(--color-fg)', v: built.cPts[built.cPts.length - 1].v, strong: true,
    },
  ].map(it => ({ ...it, y: (Y(it.v) / 100) * H })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < items.length; i++) items[i].y = Math.max(items[i].y, items[i - 1].y + 14);
  if (items[items.length - 1].y > H - 2) {
    items[items.length - 1].y = H - 2;
    for (let i = items.length - 2; i >= 0; i--) items[i].y = Math.min(items[i].y, items[i + 1].y - 14);
  }
  const ci = built.h1.ciLoPct != null && built.h1.ciHiPct != null
    ? ` [${built.h1.ciLoPct.toFixed(1)}, ${built.h1.ciHiPct.toFixed(1)}]` : '';
  const last = built.periods.length - 1;
  return (
    <div className="ray-lf-card ray-lf-comp glass glass-quiet">
      <div className="ray-lf-head">
        <span className="ray-lf-title">The composite and its parts</span>
        <span className="ray-lf-method">pooled hedonic fit vs seven vertical fits · rebased Δ% · complete quarters</span>
      </div>
      <div className="ray-lf-plot" style={{ height: H + 26 }}>
        {built.grid.map(g => (
          <React.Fragment key={g}>
            <span style={{
              position: 'absolute', top: (Y(g) / 100) * H, left: 0, right: 'var(--lfgut)',
              borderTop: g === 0 ? '1px dashed var(--chart-ref)' : '1px solid var(--chart-grid)',
            }} aria-hidden />
            <span className="ray-lf-vlbl" style={{ top: Math.max(2, (Y(g) / 100) * H - 14), left: 0 }}>{g > 0 ? '+' : ''}{g}%</span>
          </React.Fragment>
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden
          style={{ position: 'absolute', top: 0, left: 0, width: 'calc(100% - var(--lfgut))', height: H, overflow: 'visible' }}>
          {built.comps.map(c => (
            <polyline key={c.key} points={path(c.pts)} fill="none" stroke={c.ink} strokeWidth={1.25}
              opacity={0.55} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          <polyline points={path(built.cPts)} fill="none" stroke="var(--color-fg)" strokeWidth={2}
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {items.map(it => (
          <span key={it.label} className="ray-lf-cend" style={{
            top: it.y, left: 'calc(100% - var(--lfgut) + 8px)', color: it.ink,
            fontWeight: it.strong ? 600 : 450, opacity: it.strong ? 1 : 0.85,
          }}>{it.label}</span>
        ))}
        {[0, Math.floor(last / 2), last].map(i => (
          <span key={i} className="ray-lf-lbl" style={{
            bottom: 0, left: `calc((100% - var(--lfgut)) * ${X(i) / 100})`,
            transform: i === 0 ? 'none' : i === last ? 'translateX(-100%)' : 'translateX(-50%)',
          }}>{built.periods[i].replace('-', ' ')}</span>
        ))}
      </div>
      <FigCap>
        The all-market hedonic composite (ink) over its seven vertical component fits, every line rebased to{' '}
        {built.periods[0].replace('-', ' ')} and ending at the last complete quarter — the composite glides while its
        parts whipsaw, ending {Math.round(built.spread)} points apart. Over this window the pooled fit prints{' '}
        {built.h1.changePct! >= 0 ? '+' : ''}{built.h1.changePct!.toFixed(1)}%{ci}, the only horizon its own gates
        publish; longer windows abstain{built.abst ? <> (&ldquo;{built.abst}&rdquo;)</> : null}. Same nightly IRLS fits
        as the laboratory above{built.nLots ? <> — {built.nLots.toLocaleString()} lots pooled,</> : <> —</>}{' '}
        {built.nEndQ.toLocaleString()} in the end quarter. Component lines are context in the laboratory&rsquo;s market
        inks, not certified moves.
      </FigCap>
    </div>
  );
}

/* ═══ 7 · BID VELOCITY — the live book's bid distribution ═══ */
const VEL_LABELS = ['0', '1', '2', '3–5', '6–10', '11–20', '21–50', '50+'];
const velBucket = (v: number) => (v <= 0 ? 0 : v === 1 ? 1 : v === 2 ? 2 : v <= 5 ? 3 : v <= 10 ? 4 : v <= 20 ? 5 : v <= 50 ? 6 : 7);

export function BidVelocityFigure({ lots, scope = 'all' }: { lots: AuctionLot[]; scope?: string }) {
  const d = useMemo(() => {
    const counts: number[] = [];
    const houses = new Map<string, number>();
    for (const l of lots) {
      // only lots whose house prints a live book carry bidCount at all — the
      // printed-bid gate: ask-only rooms are absent from this figure, not zero
      if (l.status !== 'upcoming' || typeof l.bidCount !== 'number') continue;
      if (scope !== 'all' && (marketOf(l.artist) || 'culture') !== scope) continue;
      counts.push(l.bidCount);
      houses.set(String(l.auctionHouse), (houses.get(String(l.auctionHouse)) || 0) + 1);
    }
    counts.sort((a, b) => a - b);
    const active = counts.filter(c => c > 0);
    const med = (a: number[]) => (a.length ? a[Math.floor(a.length / 2)] : 0);
    return {
      counts, active, zero: counts.length - active.length,
      med: med(counts), medActive: med(active),
      houses: Array.from(houses.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0]),
    };
  }, [lots, scope]);
  const n = d.counts.length;
  // under 20 exposed books the shape would be noise — the figure abstains
  if (n < 20) return null;
  const basis = (
    <>counted on the {d.houses.length === 1 ? 'one house' : `${d.houses.length} houses`} whose live books print
    bids ({d.houses.join(', ')}) — ask-only rooms are absent by the printed-bid gate, not
    zero{scope !== 'all' ? <> · {scope} lots only</> : null}.</>
  );
  if (n >= 100) {
    const cnt: number[] = new Array(VEL_LABELS.length).fill(0);
    for (const v of d.counts) cnt[velBucket(v)]++;
    const maxC = Math.max(...cnt);
    const H = 150;
    return (
      <div className="ray-lf-card glass glass-quiet">
        <div className="ray-lf-head">
          <span className="ray-lf-title">Bid velocity</span>
          <span className="ray-lf-method">bids per lot · the live book</span>
        </div>
        <div className="ray-lf-plot" style={{ height: H + 28 }}>
          {cnt.map((c, i) => {
            const h = Math.max(2, (c / maxC) * H);
            const x = (i + 0.5) / cnt.length;
            const zero = i === 0; // exposed book, no money yet — drawn hollow
            return (
              <React.Fragment key={i}>
                <span style={{
                  position: 'absolute', bottom: 28, left: `${x * 100}%`, transform: 'translateX(-50%)',
                  width: `${Math.max(6, 46 / cnt.length)}%`, height: h,
                  background: zero ? 'transparent' : 'color-mix(in srgb, var(--color-fg) 14%, transparent)',
                  borderTop: zero ? '2px dashed var(--color-text-faint)' : '2px solid var(--color-fg)',
                  borderRadius: '3px 3px 0 0',
                }} aria-hidden />
                <span className="ray-lf-lbl" style={{ bottom: 28 + h + 5, left: `${x * 100}%`, color: zero ? 'var(--color-text-muted)' : 'var(--color-fg)', fontWeight: 600 }}>
                  {Math.round((c / n) * 100)}%
                </span>
                <span className="ray-lf-lbl" style={{ bottom: 10, left: `${x * 100}%` }}>{VEL_LABELS[i]}</span>
              </React.Fragment>
            );
          })}
          <span className="ray-lf-axis" style={{ bottom: 28 }} aria-hidden />
        </div>
        <FigCap>
          Bids per lot across {n.toLocaleString()} upcoming lots, {basis} The median lot holds {d.med} bid{d.med === 1 ? '' : 's'}
          {' '}({d.medActive} among the {d.active.length.toLocaleString()} already bid on); the hollow bar is
          the {d.zero.toLocaleString()} at zero — an exposed book no one has bid into yet, not a missing read.
          Counts refresh nightly, close-day lots intraday.
        </FigCap>
      </div>
    );
  }
  // 20 ≤ n < 100 — the thin-data form: every lot drawn as its own dot on a
  // log bids axis; a histogram here would pretend density the book can't back
  const max = Math.max(2, ...d.active);
  const LX = (v: number) => (Math.log(v) / Math.log(max)) * 100;
  const H = 110;
  const groups = new Map<number, number>();
  const dots = d.active.map(v => {
    const j = groups.get(v) || 0; groups.set(v, j + 1);
    // fan ties vertically, cycling after ±4 so a heavy tie overplots (translucent
    // ink shows the pile-up) instead of escaping the plot
    const ring = j % 9;
    return { v, y: 48 + (ring % 2 === 0 ? 1 : -1) * Math.ceil(ring / 2) * 9 };
  });
  const medX = LX(Math.max(1, d.medActive));
  return (
    <div className="ray-lf-card glass glass-quiet">
      <div className="ray-lf-head">
        <span className="ray-lf-title">Bid velocity</span>
        <span className="ray-lf-method">bids per lot · the live book · thin sample, every lot drawn</span>
      </div>
      <div className="ray-lf-plot" style={{ height: H + 26 }}>
        {[1, 3, 10, 30, 100].filter(t => t <= max).map(t => (
          <React.Fragment key={t}>
            <span style={{ position: 'absolute', top: 0, height: H, left: `${LX(t)}%`, borderLeft: '1px solid var(--chart-grid)' }} aria-hidden />
            <span className="ray-lf-lbl" style={{ bottom: 8, left: `${LX(t)}%` }}>{t}</span>
          </React.Fragment>
        ))}
        <span style={{ position: 'absolute', top: 0, height: H, left: `${medX}%`, borderLeft: '1px dashed var(--chart-ref)' }} aria-hidden />
        <span className="ray-lf-lbl" style={{ top: 2, left: `${medX}%`, color: 'var(--color-fg)', fontWeight: 600 }}>median {d.medActive}</span>
        {dots.map((p, i) => (
          <span key={i} className="ray-lf-dot" style={{ top: p.y - 7, left: `${LX(p.v)}%`, width: 7, height: 7, background: 'var(--color-text-muted)', opacity: 0.7 }} aria-hidden />
        ))}
        <span className="ray-lf-axis" style={{ bottom: 26 }} aria-hidden />
      </div>
      <FigCap>
        Each dot is one upcoming lot placed by its printed bid count (log axis) — {d.active.length} lots carrying at
        least one bid out of {n} exposed books{d.zero > 0 ? <> ({d.zero} at zero sit off the log axis)</> : null},{' '}
        {basis} Too thin for a histogram, so every lot is drawn; the dashed rule is the median.
      </FigCap>
    </div>
  );
}

export function LabFiguresStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
