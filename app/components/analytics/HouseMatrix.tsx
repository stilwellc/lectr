'use client';
/**
 * HouseMatrix — the house calibration matrix on /analytics: WHO estimates
 * honestly. Rows are auction houses, cells are the hammer-basis median vs the
 * house's OWN estimate mid per market (from market.json `houseCal`, which the
 * pipeline builds hammer-led per the dual-basis doctrine). Green = the house
 * hammers above its own estimates (runs conservative), red = below (runs
 * rich) — a real measured delta, so it earns color and mono per the honesty
 * doctrine. Cells under n=40 are suppressed as '—' (the pipeline already
 * drops them; we re-gate anyway). Counts stay faint and plain.
 */
import React from 'react';
import type { MarketData } from '../../hooks/useRayData';
import { toneOf, fmtSignedPct } from '../../utils';
import { CalibrationMark } from '../marks';

const LIVE_MARKETS = ['art', 'design', 'watches', 'sports', 'tcg', 'science', 'culture'];
const MIN_N = 40; // statistical floor — matches the pipeline's houseCal gate

const fmtN = (n: number) =>
  n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1_000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;

const CSS = `
.ray-hm.ray-vm-card{padding:var(--card-pad)}
.ray-hm .ray-vm-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
.ray-hm .ray-vm-title{font-size:13.5px;font-weight:650;color:var(--color-fg)}
.ray-hm .ray-vm-method{font-size:10.5px;color:var(--color-text-muted);text-align:right}
.ray-hm-scroll{overflow-x:auto;margin:0 -6px;padding:0 6px}
.ray-hm-grid{display:grid;align-items:stretch;column-gap:12px;min-width:min-content}
.ray-hm-corner{font-size:10.5px;color:var(--color-text-muted)}
.ray-hm-col{font-size:10.5px;color:var(--color-text-muted);text-align:center;padding:2px 0 6px;white-space:nowrap}
.ray-hm-house{font-size:13px;font-weight:600;color:var(--color-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:8px 0;border-top:1px solid var(--color-border);display:flex;align-items:center}
.ray-hm-cell{text-align:center;padding:8px 0;border-top:1px solid var(--color-border);white-space:nowrap;display:flex;flex-direction:column;justify-content:center}
.ray-hm-cell .num{font-family:var(--font-mono),monospace;font-size:12.5px;font-variant-numeric:tabular-nums}
.ray-hm-cell[data-dir="up"] .num{color:var(--color-up)}
.ray-hm-cell[data-dir="down"] .num{color:var(--color-down-text,var(--color-down))}
.ray-hm-cell[data-dir="flat"] .num{color:var(--color-text-muted)}
.ray-hm-cell .n{display:block;font-size:9.5px;color:var(--color-text-muted);font-variant-numeric:tabular-nums;margin-top:1px}
.ray-hm-empty{font-size:12.5px;color:var(--color-text-muted);opacity:0.55}
`;

export default function HouseMatrix({ marketData, scope }: {
  marketData: MarketData | null;
  /** the active MarketSwitch key — 'all' shows the full house×market matrix */
  scope: string;
}) {
  const cal = marketData?.houseCal;
  if (!cal) return null;

  const cols = scope === 'all' ? [...LIVE_MARKETS, 'all'] : [scope];
  const houses = Object.keys(cal)
    .filter(h => cols.some(c => (cal[h][c]?.n ?? 0) >= MIN_N))
    .sort((a, b) => (cal[b].all?.n ?? 0) - (cal[a].all?.n ?? 0));
  if (!houses.length) return null;

  return (
    <div className="ray-hm ray-vm ray-vm-card glass glass-quiet" data-wide={cols.length > 2 || undefined}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ray-vm-head">
        <span className="ray-vm-title"><span className="ray-sect-mark" aria-hidden><CalibrationMark size={16} /></span>House calibration</span>
        <span className="ray-vm-method">median hammer vs the house&rsquo;s own estimate · hammer basis · n≥40 cells only</span>
      </div>
      <div className="ray-hm-scroll">
        <div
          className="ray-hm-grid"
          style={{ gridTemplateColumns: `minmax(84px, 1.4fr) repeat(${cols.length}, minmax(58px, 1fr))` }}
        >
          <span className="ray-hm-corner">house</span>
          {cols.map(c => <span key={c} className="ray-hm-col">{c}</span>)}
          {houses.map(h => (
            <React.Fragment key={h}>
              <span className="ray-hm-house" title={h}>{h}</span>
              {cols.map(c => {
                const cell = cal[h][c];
                if (!cell || cell.n < MIN_N) {
                  return <span key={c} className="ray-hm-cell ray-hm-empty">—</span>;
                }
                // HEAT: the cell's ground carries the magnitude (|pct| capped
                // at 15 → alpha ramp) so the matrix pattern reads at a glance —
                // the diverging-heatmap grammar, in the two signal inks only
                const heat = Math.min(Math.abs(cell.hammerMedPct), 15) / 15;
                const dir = toneOf(cell.hammerMedPct);
                const bg = dir === 'up'
                  ? `color-mix(in srgb, var(--color-up) ${Math.round(heat * 26)}%, transparent)`
                  : dir === 'down'
                    ? `color-mix(in srgb, var(--color-down) ${Math.round(heat * 26)}%, transparent)`
                    : undefined;
                return (
                  <span
                    key={c}
                    className="ray-hm-cell"
                    data-dir={dir}
                    style={bg ? { background: bg, borderRadius: 6 } : undefined}
                    title={`${cell.n.toLocaleString()} sales · hammers ${fmtSignedPct(cell.hammerMedPct)} vs the house's estimate mid`}
                  >
                    <span className="num">{fmtSignedPct(cell.hammerMedPct)}</span>
                    <span className="n">{fmtN(cell.n)}</span>
                  </span>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
