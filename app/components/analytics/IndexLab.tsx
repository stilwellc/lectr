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

const CSS = `
.ray-il-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ray-il-tf{display:inline-flex;gap:5px}
.ray-il-tfbtn{font-family:var(--font-sans),sans-serif;font-size:11px;font-weight:600;padding:4px 12px;border-radius:100px;border:1px solid var(--color-border);background:transparent;color:var(--color-text-muted);cursor:pointer}
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
  const idx = marketData?.markets?.[scope]?.index || [];

  const layerDefs = useMemo(() => resolveHeroLayers(scope, marketData), [scope, marketData]);

  const built = useMemo(() => {
    if (idx.length < 6) return null;
    const q = WINDOWS.find(w => w.key === tf)!.quarters;
    const startI = q === Infinity ? 0 : Math.max(0, idx.length - 1 - q);
    const win = idx.slice(startI);
    const base = win[0]?.value;
    if (!(base > 0)) return null;
    const anchor: HeroLine = {
      key: '_idx', label: 'Cohort index', color: '', unit: 'pct',
      points: win.map(p => ({ period: p.period, value: ((p.value / base) - 1) * 100, n: p.n ?? 0 })),
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
  }, [idx, tf, layerDefs]);

  if (!built) return null;

  const key = (label: string, color: string, last: number, kind: HeroLayer['kind'] | 'anchor') => (
    <span key={label} className="ray-il-key">
      <i style={{ background: color || 'var(--color-fg)' }} aria-hidden />
      {label}
      <span
        className="v"
        data-dir={kind === 'volume' ? undefined : last >= 0 ? 'up' : 'down'}
      >
        {kind === 'volume' ? `${Math.round(last).toLocaleString()}/qtr` : `${last >= 0 ? '+' : ''}${last.toFixed(1)}%`}
      </span>
    </span>
  );

  return (
    <div className="ray-vm ray-vm-card glass glass-quiet">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ray-vm-head ray-il-head">
        <span className="ray-vm-title">The index laboratory</span>
        <span className="ray-il-tf" role="tablist" aria-label="Window">
          {WINDOWS.map(w => (
            <button key={w.key} type="button" role="tab" className="ray-il-tfbtn" data-on={tf === w.key}
              aria-selected={tf === w.key} onClick={() => setTf(w.key)}>{w.key}</button>
          ))}
        </span>
      </div>
      <div className="ray-vm-method" style={{ margin: '2px 0 10px' }}>
        like-for-like cohort index, rebased Δ% over the window · layers: the market&rsquo;s tracked sub-markets · every point a real quarterly reading
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
      />
      <div className="ray-il-legend">
        {key('Cohort index', '', built.anchorLast, 'anchor')}
        {built.main.map(x => key(x.line.label, x.line.color, x.last, x.kind))}
        {built.sub.map(x => key(x.line.label, x.line.color, x.last, x.kind))}
      </div>
    </div>
  );
}
