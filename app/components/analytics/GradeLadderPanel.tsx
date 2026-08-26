'use client';
/**
 * GradeLadderPanel — the grade curve, measured. Renders the empirical
 * PSA/BGS multiplier ladder from market.json `gradeLadder`: within-card
 * paired log-ratios (base grade 8 = 1.00), holdout-validated against the
 * hand-set constants it replaced (−6.4% median error). Honesty doctrine:
 * the multiplier is a MULTIPLE, not a measured delta — plain ink, no
 * green/red; pair support faint; the old constant shown struck beside each
 * fitted rung so the correction is visible. Unfitted rungs keep the old
 * constant and say so. Bar heights ∝ log(mult) — a log-scale instrument,
 * labelled as such. Scope-agnostic export; the orchestrator gates it to
 * 'all'/'sports'.
 */
import React from 'react';
import type { MarketData } from '../../hooks/useRayData';
import { GradeMark } from '../marks';

const BAR_MAX = 72; // px — tallest bar (log scale)
const BAR_MIN = 5;  // px — floor so the smallest rung still registers

const fmtMult = (m: number) => (m >= 10 ? m.toFixed(1) : m.toFixed(2));

const CSS = `
.ray-gl.ray-vm-card{padding:var(--card-pad)}
.ray-gl .ray-vm-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
.ray-gl .ray-vm-title{font-size:13.5px;font-weight:650;color:var(--color-fg)}
.ray-gl .ray-vm-method{font-size:10.5px;color:var(--color-text-muted);text-align:right}
.ray-gl-strip{display:grid;column-gap:10px;align-items:end;margin-top:4px}
.ray-gl-rung{display:flex;flex-direction:column;align-items:center;text-align:center;min-width:0}
.ray-gl-mult{font-family:var(--font-mono),monospace;font-size:17px;font-weight:500;letter-spacing:-0.5px;color:var(--color-fg);font-variant-numeric:tabular-nums;white-space:nowrap}
.ray-gl-mult .x{font-size:11px;color:var(--color-text-secondary);margin-left:1px}
.ray-gl-rung[data-fitted="false"] .ray-gl-mult{color:var(--color-text-secondary)}
.ray-gl-barwrap{display:flex;align-items:flex-end;height:${BAR_MAX + 6}px;margin:6px 0 8px}
.ray-gl-bar{width:14px;border-radius:2px 2px 0 0;background:var(--color-fg);opacity:0.7}
.ray-gl-rung[data-fitted="false"] .ray-gl-bar{opacity:0.25}
.ray-gl-grade{font-size:12.5px;font-weight:650;color:var(--color-fg)}
.ray-gl-old{font-size:10.5px;color:var(--color-text-muted);margin-top:2px;white-space:nowrap}
.ray-gl-old s{text-decoration-color:color-mix(in srgb,currentColor 60%,transparent)}
.ray-gl-pairs{font-size:10px;color:var(--color-text-muted);font-variant-numeric:tabular-nums;margin-top:2px;white-space:nowrap}
.ray-gl-caption{font-size:10.5px;color:var(--color-text-muted);line-height:1.5;margin:12px 0 0}
@media (max-width:520px){.ray-gl-strip{column-gap:6px}.ray-gl-mult{font-size:14px}.ray-gl-bar{width:10px}}
`;

export default function GradeLadderPanel({ marketData }: { marketData: MarketData | null }) {
  const ladder = marketData?.gradeLadder;
  if (!ladder || !ladder.rungs?.length) return null;

  const rungs = ladder.rungs.slice().sort((a, b) => a.grade - b.grade);

  // log-scale bar heights: log(mult) mapped onto [BAR_MIN, BAR_MAX]
  const logs = rungs.map(r => Math.log(r.mult));
  const lo = Math.min(...logs);
  const span = Math.max(...logs) - lo || 1;
  const barH = (mult: number) => Math.round(BAR_MIN + ((Math.log(mult) - lo) / span) * (BAR_MAX - BAR_MIN));

  const pairsLabel = ladder.pairs != null && ladder.groups != null
    ? ` · ${ladder.pairs.toLocaleString()} pairs / ${ladder.groups.toLocaleString()} cards`
    : '';

  return (
    <div className="ray-gl ray-vm ray-vm-card glass glass-quiet">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ray-vm-head">
        <span className="ray-vm-title"><span className="ray-sect-mark" aria-hidden><GradeMark size={16} /></span>The grade curve, measured</span>
        <span className="ray-vm-method">card value multiple by grade · base {ladder.base} = 1.00 · log scale</span>
      </div>
      <div className="ray-gl-strip" style={{ gridTemplateColumns: `repeat(${rungs.length}, 1fr)` }}>
        {rungs.map(r => (
          <div key={r.grade} className="ray-gl-rung" data-fitted={r.fitted}>
            <span className="ray-gl-mult">{fmtMult(r.mult)}<span className="x">×</span></span>
            <div className="ray-gl-barwrap"><div className="ray-gl-bar" style={{ height: barH(r.mult) }} /></div>
            <span className="ray-gl-grade">{r.grade}</span>
            <span className="ray-gl-old">
              {r.grade === ladder.base
                ? 'base'
                : r.fitted
                  ? <>was <s>{r.old}×</s></>
                  : `held at ${r.old}×`}
            </span>
            <span className="ray-gl-pairs">{r.pairs.toLocaleString()} pairs</span>
          </div>
        ))}
      </div>
      <p className="ray-gl-caption">
        within-card paired log-ratios, base grade {ladder.base} = 1.00{pairsLabel} · replaced the hand-set constants (holdout &minus;6.4% median error)
      </p>
    </div>
  );
}
