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

  const Body = movers.length ? (
    <div className="ray-vm-rows">
      {movers.slice(0, 5).map((mv) => (
        <div key={mv.slug} className="ray-vm-row" data-dir={mv.dir}>
          <span className="ray-vm-name">{mv.label}</span>
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
        grid-template-columns: 1fr auto auto;
        align-items: baseline;
        gap: 10px 14px;
        padding: 9px 0;
        border-top: 1px solid var(--color-border);
      }
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
