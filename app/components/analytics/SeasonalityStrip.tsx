'use client';
/**
 * SeasonalityStrip — the calendar. Twelve month cells for the scoped market
 * (fallback 'all') from market.json `seasonality`: hammer-basis median vs
 * estimate mid per calendar month. A real measured delta, so the % earns
 * mono + green/red per the honesty doctrine; counts stay faint and plain.
 * The pipeline emits n<30 months as zeroed placeholders — we suppress them
 * as blank cells, and the one-line takeaway only prints when ≥8 months are
 * usable: an honest year-shape needs most of the calendar.
 */
import React from 'react';
import type { MarketData } from '../../hooks/useRayData';
import { toneOf, fmtSignedPct } from '../../utils';
import { ConditionsMark } from '../marks';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MIN_N = 30;          // per-month floor — matches the pipeline's gate
const MIN_USABLE_MONTHS = 8; // takeaway suppression — most of the calendar must be usable

const fmtN = (n: number) =>
  n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1_000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;

const CSS = `
.ray-ss.ray-vm-card{padding:var(--card-pad)}
.ray-ss .ray-vm-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
.ray-ss .ray-vm-title{font-size:13.5px;font-weight:550;color:var(--color-fg);white-space:nowrap}
.ray-ss .ray-vm-method{font-size:10.5px;color:var(--color-text-muted);text-align:right}
.ray-ss-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:6px}
@media (max-width:720px){.ray-ss-grid{grid-template-columns:repeat(6,1fr)}}
@media (max-width:420px){.ray-ss-grid{grid-template-columns:repeat(4,1fr)}}
.ray-ss-cell{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 2px;border:1px solid var(--color-border);border-radius:6px;min-width:0}
.ray-ss-mo{font-size:10.5px;color:var(--color-text-secondary)}
.ray-ss-pct{font-family:var(--font-mono),monospace;font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ray-ss-cell[data-dir="up"] .ray-ss-pct{color:var(--color-up)}
.ray-ss-cell[data-dir="down"] .ray-ss-pct{color:var(--color-down-text,var(--color-down))}
.ray-ss-cell[data-dir="flat"] .ray-ss-pct{color:var(--color-text-muted)}
.ray-ss-n{font-size:9.5px;color:var(--color-text-muted);font-variant-numeric:tabular-nums}
.ray-ss-blank .ray-ss-pct{color:var(--color-text-muted);opacity:0.5}
.ray-ss-take{font-size:12.5px;color:var(--color-text-secondary);line-height:1.5;margin:12px 0 0}
.ray-ss-take b{font-weight:650;color:var(--color-fg)}
`;

export default function SeasonalityStrip({ marketData, scope }: {
  marketData: MarketData | null;
  /** the active MarketSwitch key — falls back to 'all' when unscoped */
  scope: string;
}) {
  const seasonality = marketData?.seasonality;
  // the all-fallback only serves the 'all' view — on a scoped market a
  // missing per-market calendar must HIDE, not silently show global data
  const cells = seasonality?.[scope] ?? (scope === 'all' ? seasonality?.all : undefined);
  if (!cells || cells.length !== 12) return null;

  const usable = cells
    .map((c, i) => ({ month: MONTHS[i], pct: c.hammerMedPct, n: c.n }))
    .filter(r => r.n >= MIN_N);
  if (!usable.length) return null;

  const best = usable.reduce((a, b) => (b.pct > a.pct ? b : a));
  const worst = usable.reduce((a, b) => (b.pct < a.pct ? b : a));
  const totalN = usable.reduce((s, r) => s + r.n, 0);
  const showTakeaway = usable.length >= MIN_USABLE_MONTHS;

  return (
    <div className="ray-ss ray-vm ray-vm-card glass glass-quiet">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ray-vm-head">
        <span className="ray-vm-title"><span className="ray-sect-mark" aria-hidden><ConditionsMark size={16} /></span>The calendar</span>
        <span className="ray-vm-method">hammer vs estimate by calendar month · trailing full-history · {totalN.toLocaleString()} sales</span>
      </div>
      <div className="ray-ss-grid">
        {cells.map((c, i) => {
          const heat = Math.min(Math.abs(c.hammerMedPct ?? 0), 12) / 12;
          const dir = toneOf(c.hammerMedPct);
          const bg = c.n >= MIN_N && dir === 'up'
            ? `color-mix(in srgb, var(--color-up) ${Math.round(heat * 24)}%, transparent)`
            : c.n >= MIN_N && dir === 'down'
              ? `color-mix(in srgb, var(--color-down) ${Math.round(heat * 24)}%, transparent)`
              : undefined;
          return c.n >= MIN_N ? (
            <div key={MONTHS[i]} className="ray-ss-cell" data-dir={dir} style={bg ? { background: bg } : undefined} title={`${c.n.toLocaleString()} sales`}>
              <span className="ray-ss-mo">{MONTHS[i]}</span>
              <span className="ray-ss-pct">{fmtSignedPct(c.hammerMedPct)}</span>
              <span className="ray-ss-n">{fmtN(c.n)}</span>
            </div>
          ) : (
            <div key={MONTHS[i]} className="ray-ss-cell ray-ss-blank" title={`under ${MIN_N} sales — suppressed`}>
              <span className="ray-ss-mo">{MONTHS[i]}</span>
              <span className="ray-ss-pct">—</span>
              <span className="ray-ss-n">&nbsp;</span>
            </div>
          );
        })}
      </div>
      {showTakeaway && (
        <p className="ray-ss-take">
          <b>{best.month}</b> runs hottest at {fmtSignedPct(best.pct)} · <b>{worst.month}</b> softest at {fmtSignedPct(worst.pct)}
        </p>
      )}
    </div>
  );
}
