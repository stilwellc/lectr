'use client';
/**
 * IndexLab — the research desk's primary instrument. The market's
 * like-for-like cohort index (drift-free, rebased to Δ% over the visible
 * window) as the anchor, with the market's curated sub-market layers behind
 * it — the same curation the lander hero uses (heroLayers), on the full
 * HeroChart instrument (grid, ticks, scrub readout). A horizon toggle
 * windows everything together.
 *
 * Honesty: the anchor is the cohort index — each cohort vs its OWN average,
 * never chained; layers rebase to the window start; the method line names
 * both. Green/red never paints a line (ink only); the legend's current
 * values are the only colored figures, and only for real deltas.
 */
import React, { useMemo, useState } from 'react';
import HeroChart, { type HeroLine } from '../../preview/terminal/HeroChart';
import { resolveHeroLayers, type HeroLayer } from '../../lib/heroLayers';
import type { MarketData } from '../../hooks/useRayData';
import { IndexLabMark } from '../marks';
import FigCap from '../FigCap';

const CSS = `
.ray-il-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ray-il-tf{display:inline-flex;gap:5px}
.ray-il-tfbtn{font-family:var(--font-sans),sans-serif;font-size:11px;font-weight:600;padding:4px 12px;border-radius:100px;border:1px solid var(--color-border);background:transparent;color:var(--color-text-muted);cursor:pointer;transition:border-color var(--duration-fast) var(--ease-signature),color var(--duration-fast) var(--ease-signature)}
.ray-il-tfbtn:hover{border-color:var(--color-border-mid);color:var(--color-fg)}
@media (max-width:768px){.ray-il-tfbtn{position:relative}.ray-il-tfbtn::before{content:'';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:100%;height:100%;min-width:44px;min-height:44px}}
.ray-il-tfbtn[data-on=true]{background:var(--color-fg);border-color:var(--color-fg);color:var(--color-bg)}
.ray-il-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:12px}
.ray-il-key{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;color:var(--color-text-muted)}
.ray-il-key i{width:7px;height:7px;border-radius:50%;flex:none}
.ray-il-key .v{font-family:var(--font-mono),monospace;font-variant-numeric:tabular-nums;font-size:11px}
.ray-il-key .v[data-dir=up]{color:var(--color-up)}
.ray-il-key .v[data-dir=down]{color:var(--color-down-text)}
`;

const WINDOWS = [
  { key: '1Y', quarters: 4 },
  { key: '3Y', quarters: 12 },
  { key: 'MAX', quarters: Infinity },
] as const;

export default function IndexLab({ marketData, scope }: { marketData: MarketData | null; scope: string }) {
  const [tf, setTf] = useState<'1Y' | '3Y' | 'MAX'>('3Y');
  // THE OBSERVATORY UPGRADE (Aug 29): the anchor is the HEDONIC index when
  // the market publishes one — the statistically-defensible read, and its
  // per-quarter confidence interval rides the chart as a shaded ribbon
  // (uncertainty as a shape, the lab grammar). Cohort index remains the
  // fallback for markets the hedonic engine can't yet carry.
  const hed = marketData?.hedonic?.[scope]?.series;
  const hasHedonic = Array.isArray(hed) && hed.length >= 8;
  const idx = useMemo(
    () => (hasHedonic ? hed! : (marketData?.markets?.[scope]?.index || [])),
    [hasHedonic, hed, marketData, scope],
  );

  const layerDefs = useMemo(() => resolveHeroLayers(scope, marketData), [scope, marketData]);

  const built = useMemo(() => {
    if (idx.length < 6) return null;
    const q = WINDOWS.find(w => w.key === tf)!.quarters;
    const startI = q === Infinity ? 0 : Math.max(0, idx.length - 1 - q);
    const win = idx.slice(startI);
    const base = win[0]?.value;
    if (!(base > 0)) return null;
    const reb = (v: number) => ((v / base) - 1) * 100;
    const anchor: HeroLine = {
      key: '_idx', label: hasHedonic ? 'Hedonic index' : 'Cohort index', color: '', unit: 'pct',
      points: win.map(p => {
        const w = p as { period: string; value: number; n?: number; ciLo?: number; ciHi?: number };
        return {
          period: w.period, value: reb(w.value), n: w.n ?? 0,
          ...(hasHedonic && w.ciLo != null && w.ciHi != null && w.ciLo > 0
            ? { lo: reb(w.ciLo), hi: reb(w.ciHi) } : {}),
        };
      }),
    };
    const startPeriod = win[0].period;
    const windowLayer = (l: HeroLayer): { line: HeroLine; last: number; kind: HeroLayer['kind'] } | null => {
      let pts = l.points.filter(p => p.period >= startPeriod);
      if (pts.length < 2) return null;
      if (l.kind === 'index') {
        const b = pts[0].value;
        if (!(b > 0)) return null;
        pts = pts.map(p => ({ ...p, value: ((p.value / b) - 1) * 100 }));
      }
      return { line: { key: l.key, label: l.label, color: l.color, unit: l.kind === 'volume' ? 'count' : 'pct', points: pts }, last: pts[pts.length - 1].value, kind: l.kind };
    };
    const main = layerDefs.main.map(windowLayer).filter((x): x is NonNullable<typeof x> => !!x);
    const sub = layerDefs.sub.map(windowLayer).filter((x): x is NonNullable<typeof x> => !!x);
    return { anchor, main, sub, anchorLast: anchor.points[anchor.points.length - 1].value };
  }, [idx, tf, layerDefs, hasHedonic]);

  // thin history: keep the plate (a silent gap reads as a bug) and say why —
  // an explanation, not an instrument, so it sits on the cream well
  if (!built) {
    return (
      <div className="ns-well">
        <div className="ns-well-label"><span className="ray-sect-mark" aria-hidden><IndexLabMark size={15} /></span>The index laboratory</div>
        <div className="ns-well-body">
          Not enough settled history to chart an index for this market yet — it lights up as quarters accrue.
        </div>
      </div>
    );
  }

  const key = (label: string, color: string, last: number, kind: HeroLayer['kind'] | 'anchor') => (
    <span key={label} className="ray-il-key">
      <i style={{ background: color || 'var(--color-fg)' }} aria-hidden />
      {label}
      <span
        className="v"
        data-dir={kind === 'volume' ? undefined : last >= 0 ? 'up' : 'down'}
      >
        {kind === 'volume' ? `${Math.round(last).toLocaleString()}/qtr` : `${last >= 0 ? '+' : ''}${Math.abs(last) >= 100 ? Math.round(last) : last.toFixed(1)}%`}
      </span>
    </span>
  );

  return (
    <div className="ray-vm ray-vm-card glass glass-quiet">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ray-vm-head ray-il-head" style={{ alignItems: 'flex-end' }}>
        <span style={{ minWidth: 0 }}>
          <span className="ns-kicker" style={{ marginBottom: 4 }}>The research desk&rsquo;s primary instrument</span>
          <span style={{ display: 'block', fontSize: 30, fontWeight: 340, letterSpacing: '-0.02em', lineHeight: 1.12, color: 'var(--color-fg)' }}>
            <span className="ray-sect-mark" aria-hidden><IndexLabMark size={18} /></span>The index laboratory
          </span>
        </span>
        <span className="ray-il-tf" role="tablist" aria-label="Window">
          {WINDOWS.map(w => (
            <button key={w.key} type="button" role="tab" className="ray-il-tfbtn" data-on={tf === w.key}
              aria-selected={tf === w.key} onClick={() => setTf(w.key)}>{w.key}</button>
          ))}
        </span>
      </div>
      <div className="ray-vm-method" style={{ margin: '2px 0 10px', textAlign: 'left' }}>
        {hasHedonic
          ? <>hedonic index — like-for-like controls, IRLS fit, rebased Δ% over the window · the shaded ribbon is the model&rsquo;s own 95% interval</>
          : <>like-for-like cohort index, rebased Δ% over the window · layers: the market&rsquo;s tracked sub-markets</>}
      </div>
      <HeroChart
        anchor={built.anchor}
        layers={built.main.map(x => x.line)}
        subLayers={built.sub.map(x => x.line)}
        subLabel={built.sub.length ? (built.sub[0].line.unit === 'count' ? 'sales volume · quarterly' : 'rebased Δ%') : null}
        height={230}
        subHeight={72}
        compact
        play={false}
        band={hasHedonic}
      />
      <div className="ray-il-legend">
        {key(hasHedonic ? 'Hedonic index' : 'Cohort index', '', built.anchorLast, 'anchor')}
        {built.main.map(x => key(x.line.label, x.line.color, x.last, x.kind))}
        {built.sub.map(x => key(x.line.label, x.line.color, x.last, x.kind))}
      </div>
      <FigCap>
        {hasHedonic
          ? <>Hedonic price index, quarterly — log-price regression with reference/form/size/house controls, IRLS-weighted,
              refit nightly; the ribbon is the per-quarter 95% CI. Rebased to the window start; {idx.length} quarters on file.</>
          : <>Like-for-like cohort index, quarterly — each cohort measured against its own average, never chained;
              {' '}{idx.length} quarters on file.</>}
      </FigCap>
    </div>
  );
}
