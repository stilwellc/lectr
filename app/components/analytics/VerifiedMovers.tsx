'use client';

/**
 * VerifiedMovers — the ONLY price-movement reads the hedonic engine will stand
 * behind: a maker publishes a horizon only when its 95% CI resolves the sign.
 * Reused by /analytics and /makers so the defensible reads read identically
 * everywhere. Where a market has none, we say so plainly rather than dress up a
 * number the engine won't back. Scope follows the active MarketSwitch: on
 * Art/Design/etc. this correctly shows the honest empty state.
 */
import React, { useMemo } from 'react';
import type { MarketData } from '../../hooks/useRayData';
import type { Market } from '../../constants';
import { verifiedMovers, fmtPct } from '../../preview/terminal/verified';

export default function VerifiedMovers({
  marketData,
  scope,
  variant = 'panel',
}: {
  marketData: MarketData | null;
  /** the active MarketSwitch key — 'all' returns every publishable maker */
  scope?: Market;
  /** 'panel' = flat band cell (legacy — no current mount); 'card' = standalone
      glass card, the form both /analytics and /makers use */
  variant?: 'panel' | 'card';
}) {
  const movers = useMemo(() => verifiedMovers(marketData, scope), [marketData, scope]);
  const where = !scope || scope === 'all' ? 'the market' : scope;

  const Head = (
    <div className="ray-vm-head">
      <span className="ray-vm-title">Verified movers</span>
      <span className="ray-vm-method">price movement · 95% confidence</span>
    </div>
  );

  // THE WHISKER BOARD — the CI is the whole point, so it IS the figure:
  // every mover renders as an interval bar (lo ─── ● ─── hi) on one shared
  // axis spanning the board's extremes, zero rule marked. The point estimate
  // is the dot; the number annotates rather than carries.
  const shown = movers.slice(0, 5);
  const ext = shown.length
    ? { lo: Math.min(0, ...shown.map(m => m.ciLoPct)), hi: Math.max(0, ...shown.map(m => m.ciHiPct)) }
    : { lo: 0, hi: 1 };
  const X = (v: number) => ((v - ext.lo) / (ext.hi - ext.lo || 1)) * 100;
  const Body = movers.length ? (
    <div className="ray-vm-rows">
      {shown.map((mv) => (
        <div key={mv.slug} className="ray-vm-row" data-dir={mv.dir}>
          <span className="ray-vm-name">{mv.label}</span>
          <span className="ray-vm-whisk" aria-hidden>
            <i className="ray-vm-zero" style={{ left: `${X(0)}%` }} />
            <i className="ray-vm-band" data-dir={mv.dir}
              style={{ left: `${X(mv.ciLoPct)}%`, width: `${Math.max(1.5, X(mv.ciHiPct) - X(mv.ciLoPct))}%` }} />
            <i className="ray-vm-dot" data-dir={mv.dir} style={{ left: `${X(mv.changePct)}%` }} />
          </span>
          <span className="ray-vm-chg" data-dir={mv.dir}>
            {fmtPct(mv.changePct)} <em>{mv.horizon}</em>
          </span>
          <span className="ray-vm-ci">[{mv.ciLoPct.toFixed(0)}, {mv.ciHiPct.toFixed(0)}]</span>
        </div>
      ))}
    </div>
  ) : (
    <p className="ray-vm-empty">
      No maker in {where} clears the 95%-confidence bar yet — we only print a move the data resolves.
    </p>
  );

  return (
    <div className={variant === 'card' ? 'ray-vm ray-vm-card glass glass-quiet' : 'ray-vm ray-vm-panel'}>
      <VerifiedStyles />
      {Head}
      {Body}
    </div>
  );
}

function VerifiedStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
      .ray-vm-panel { background: var(--panel); padding: 18px 20px; }
      .ray-vm-card { padding: var(--card-pad); }
      .ray-vm-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
      .ray-vm-title { font-size: 13.5px; font-weight: 650; color: var(--color-fg); }
      .ray-vm-method { font-size: 10.5px; color: var(--color-text-muted); text-align: right; }
      .ray-vm-rows { display: flex; flex-direction: column; }
      .ray-vm-row {
        display: grid;
        grid-template-columns: minmax(90px, 1fr) minmax(80px, 1.2fr) auto auto;
        align-items: center;
        gap: 10px 14px;
        padding: 9px 0;
        border-top: 1px solid var(--color-border);
      }
      .ray-vm-whisk { position: relative; height: 14px; min-width: 70px; }
      .ray-vm-zero { position: absolute; top: -2px; bottom: -2px; width: 1px; background: var(--chart-ref, rgba(128,128,128,0.3)); }
      .ray-vm-band { position: absolute; top: 5px; height: 4px; border-radius: 2px; opacity: 0.35; }
      .ray-vm-band[data-dir="up"] { background: var(--color-up); }
      .ray-vm-band[data-dir="down"] { background: var(--color-down); }
      .ray-vm-dot { position: absolute; top: 3px; width: 8px; height: 8px; border-radius: 50%; transform: translateX(-50%); }
      .ray-vm-dot[data-dir="up"] { background: var(--color-up); }
      .ray-vm-dot[data-dir="down"] { background: var(--color-down); }
      .ray-vm-row:first-child { border-top: none; }
      .ray-vm-name { font-size: 13.5px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ray-vm-chg { font-size: 14px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .ray-vm-chg[data-dir="up"] { color: var(--color-up); }
      .ray-vm-chg[data-dir="down"] { color: var(--color-down-text, var(--color-down)); }
      .ray-vm-chg em { font-style: normal; font-size: 11.5px; font-weight: 600; color: var(--color-text-muted); margin-left: 2px; }
      .ray-vm-ci { font-family: var(--font-mono), monospace; font-size: 11.5px; color: var(--color-text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; min-width: 72px; }
      .ray-vm-empty { font-size: 13.5px; color: var(--color-text-secondary); line-height: 1.5; margin: 4px 0 0; }
    `}} />
  );
}
