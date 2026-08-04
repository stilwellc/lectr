'use client';
/**
 * SubMarketDrills — the sub-category performance table on /analytics.
 * Renders the `drills` rows from market.json for the active market: each row
 * is an approved A-vs-B split (cards x sport, watch model families, culture
 * subject domains, space programs, art/design kinds) with the strongest
 * honest read its data supports. Honesty rules: green/red ONLY on real
 * deltas (CI'd index moves, measured demand); descriptive rows show observed
 * facts in plain ink; mono type reserved for percent-change figures.
 */
import React from 'react';
import Link from 'next/link';
import type { MarketData, SubMarketRead } from '../../hooks/useRayData';

type DrillRow = SubMarketRead & { parent: string };

const fmtUsd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `$${Math.round(n / 1000)}K` : `$${n.toLocaleString()}`;

const CSS = `
/* self-contained panel frame (HouseMatrix's pattern): this component mounts on
   dossier pages WITHOUT VerifiedMovers, whose injected global styles the bare
   .ray-vm-* classes otherwise lean on — without these the card lost its
   padding and the title ran into the method line */
.ray-dr.ray-vm-card{padding:var(--card-pad)}
.ray-dr .ray-vm-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
.ray-dr .ray-vm-title{font-size:13.5px;font-weight:650;color:var(--color-fg)}
.ray-dr .ray-vm-method{font-size:10.5px;color:var(--color-text-muted);text-align:right}
.ray-dr-rows{display:flex;flex-direction:column;margin-top:10px}
.ray-dr-row{display:grid;grid-template-columns:1fr auto auto;gap:14px;align-items:baseline;padding:9px 6px;margin:0 -6px;border-bottom:2px dotted rgba(255,255,255,0.09);border-radius:8px;color:inherit;text-decoration:none;cursor:pointer;transition:background 0.14s ease}
.ray-dr-row:last-child{border-bottom:none}
a.ray-dr-row:hover{background:rgba(255,255,255,0.045)}
a.ray-dr-row:hover .ray-dr-name{color:#FFF}
.ray-dr-name{font-size:13.5px;color:var(--fg,#E8EAED)}
.ray-dr-kind{color:#7A8087;font-size:12px;margin-left:6px}
.ray-dr-read{font-size:13px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.ray-dr-read .num{font-family:var(--font-mono,ui-monospace),monospace}
.ray-dr-read[data-dir="up"] .num{color:#2FBF71}
.ray-dr-read[data-dir="down"] .num{color:#E5484D}
.ray-dr-read .ci{color:#7A8087;font-size:11px;margin-left:5px}
.ray-dr-read .tag{color:#7A8087;font-size:11px;margin-left:5px}
.ray-dr-meta{color:#7A8087;font-size:11.5px;font-variant-numeric:tabular-nums;text-align:right;min-width:74px}
@media (max-width:640px){.ray-dr-row{grid-template-columns:1fr auto}.ray-dr-meta{display:none}}
`;

function readCell(r: DrillRow) {
  if (r.readType === 'index' && r.index) {
    const v = r.index.changePct;
    return (
      <span className="ray-dr-read" data-dir={v >= 0 ? 'up' : 'down'}>
        <span className="num">{v >= 0 ? '+' : ''}{v.toFixed(0)}%</span>
        <span className="ci">{r.index.horizon} [{r.index.ciLoPct.toFixed(0)}, {r.index.ciHiPct.toFixed(0)}]</span>
      </span>
    );
  }
  if (r.readType === 'demand' && r.demandNow != null) {
    const v = r.demandNow;
    return (
      <span className="ray-dr-read" data-dir={v >= 0 ? 'up' : 'down'}>
        <span className="num">{v >= 0 ? '+' : ''}{v.toFixed(0)}%</span>
        <span className="tag">vs estimate</span>
      </span>
    );
  }
  return (
    <span className="ray-dr-read">
      {r.typicalUsd != null ? <>{fmtUsd(r.typicalUsd)}<span className="tag">typical</span></> : <span className="tag">—</span>}
    </span>
  );
}

export default function SubMarketDrills({ marketData, scope, parentFilter, title, method, limit }: {
  marketData: MarketData | null; scope: string;
  /** show only rows whose parent matches (e.g. a watch maker's families) */
  parentFilter?: string;
  title?: string; method?: string;
  /** row cap — defaults to the desk digest (12 pooled / 16 scoped); pass
      Infinity for the full book, where the caption promises every row */
  limit?: number;
}) {
  const drills = marketData?.drills;
  if (!drills) return null;
  let rows: DrillRow[] = [];
  if (parentFilter) {
    rows = (drills[scope] || []).filter(r => r.parent === parentFilter);
  } else if (scope === 'all') {
    // cross-market view: each vertical's strongest few, index reads first
    const pool = Object.values(drills).flat();
    const rank = (r: DrillRow) => (r.readType === 'index' ? 0 : r.readType === 'demand' ? 1 : 2);
    rows = pool.sort((a, b) => rank(a) - rank(b) || b.lots - a.lots).slice(0, limit ?? 12);
  } else {
    rows = (drills[scope] || []).slice(0, limit ?? 16);
  }
  if (rows.length < 2) return null;

  return (
    <div className="ray-dr ray-vm ray-vm-card glass glass-quiet">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ray-vm-head">
        <span className="ray-vm-title">{title ?? 'Sub-markets'}</span>
        <span className="ray-vm-method">{method ?? 'performance by sub-category'}</span>
      </div>
      <div className="ray-dr-rows">
        {rows.map(r => (
          <Link key={r.slug} href={`/sub/${r.slug.replace(':', '/')}`} className="ray-dr-row">
            <span className="ray-dr-name">
              {r.label}
              {scope === 'all' ? <span className="ray-dr-kind">{r.vertical}</span> : null}
            </span>
            {readCell(r)}
            <span className="ray-dr-meta">{r.lots.toLocaleString()} lots</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
