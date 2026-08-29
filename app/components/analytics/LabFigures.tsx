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
import type { MarketData, Backtest } from '../../hooks/useRayData';
import type { AuctionLot } from '../../types';
import { marketOf } from '../../constants';
import { MARKET_COLOR } from '../../lib/heroLayers';
import FigCap from '../FigCap';
import { GapMark, OddsMark, DepthMark, SalesMark } from '../marks';

const CSS = `
.ray-lf-card { padding: var(--card-pad); min-width: 0; }
.ray-lf-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
.ray-lf-title { font-size: 13.5px; font-weight: 650; color: var(--color-fg); }
.ray-lf-title .ray-sect-mark { margin-right: 8px; }
.ray-lf-method { font-size: 10.5px; color: var(--color-text-muted); text-align: right; }
.ray-lf-plot { position: relative; }
.ray-lf-lbl { position: absolute; font-family: var(--font-mono), monospace; font-size: 10px; color: var(--color-text-muted); white-space: nowrap; transform: translateX(-50%); }
.ray-lf-vlbl { position: absolute; font-family: var(--font-mono), monospace; font-size: 10px; color: var(--color-text-muted); white-space: nowrap; }
.ray-lf-note { position: absolute; font-size: 10.5px; color: var(--color-text-faint); white-space: nowrap; }
.ray-lf-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; align-items: start; }
.ray-lf-grid3 > * { min-width: 0; }
@media (max-width: 1000px) { .ray-lf-grid3 { grid-template-columns: 1fr; } }
.ray-lf-dot { position: absolute; border-radius: 50%; transform: translate(-50%, 50%); }
.ray-lf-axis { position: absolute; left: 0; right: 0; border-top: 1px solid var(--chart-grid); }
.ray-lf-zero { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--chart-ref); }
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
        <span className="ray-lf-title"><span className="ray-sect-mark" aria-hidden><OddsMark size={15} /></span>How wide the bands run</span>
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
      <div className="ray-lf-plot" style={{ height: rows.length * 26 + 30 }}>
        <span style={{ position: 'absolute', top: 0, bottom: 24, left: `${X(1)}%`, borderLeft: '1px dashed var(--chart-ref)' }} aria-hidden />
        <span className="ray-lf-lbl" style={{ bottom: 6, left: `${X(1)}%` }}>1.00×</span>
        {rows.map(([house, f], i) => {
          const y = 6 + i * 26;
          const up = f > 1.001; const down = f < 0.999;
          return (
            <React.Fragment key={house}>
              <span className="ray-lf-vlbl" style={{ top: y, left: 0, color: 'var(--color-text-secondary)', maxWidth: '30%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{house}</span>
              <span style={{
                position: 'absolute', top: y + 4, left: `${Math.min(X(1), X(f))}%`, width: `${Math.abs(X(f) - X(1))}%`,
                height: 2, background: 'var(--chart-grid)',
              }} aria-hidden />
              <span className="ray-lf-dot" style={{
                top: y + 10, left: `${X(f)}%`, width: 9, height: 9,
                background: up ? 'var(--color-up)' : down ? 'var(--color-down)' : 'var(--color-text-muted)',
              }} aria-hidden />
              <span className="ray-lf-vlbl" style={{ top: y, left: `calc(${X(f)}% ${X(f) < 52 ? '- 14px' : '+ 10px'})`, ...(X(f) < 52 ? { transform: 'translateX(-100%)' } : {}), fontWeight: 600, color: 'var(--color-fg)' }}>
                {f.toFixed(2)}×
              </span>
            </React.Fragment>
          );
        })}
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
export function DepthField({ lots }: { lots: AuctionLot[] }) {
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
    return out;
  }, [lots]);
  if (pts.length < 40) return null;
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
    <div className="ray-lf-card glass glass-quiet">
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
        {Object.keys(MARKET_INK).filter(m => pts.some(p => p.mkt === m)).map(m => (
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

export function LabFiguresStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
