'use client';
/**
 * RelativeStrength — the flagship strength board on /analytics: WHAT'S
 * RUNNING vs WHAT'S COOLING across the tracked sub-markets, ranked ONLY by
 * verified reads. Index rows rank by their CI'd changePct (green/red + CI),
 * demand rows by measured %-vs-estimate (green/red); descriptive rows are
 * EXCLUDED from the board — no fabricated motion — and counted in the foot.
 * Honesty: mono type reserved for % figures; counts and ranks plain ink;
 * every read carries its method (horizon+CI / 'vs est') and its n.
 */
import React, { useMemo } from 'react';
import Link from 'next/link';
import type { MarketData, SubMarketRead } from '../../hooks/useRayData';
import { StrengthMark } from '../marks';

type DrillRow = SubMarketRead & { parent: string };
interface Ranked { row: DrillRow; value: number; rank: number }

const CSS = `
.ray-rs-spread{margin:0 0 10px;font-size:11.5px;color:var(--color-text-muted,#8a8f98)}
.ray-rs-spread .num{font-family:var(--font-mono,ui-monospace),monospace;font-variant-numeric:tabular-nums;color:var(--color-fg,#E8EAED)}
.ray-rs-cols{display:grid;grid-template-columns:1fr 1fr;gap:2px 30px}
.ray-rs-colhead{font-family:var(--font-mono,ui-monospace),monospace;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-text-muted,#8a8f98);padding:4px 0 7px;border-bottom:1px solid var(--hairline,rgba(255,255,255,0.09))}
.ray-rs-row{display:grid;grid-template-columns:20px minmax(0,1fr) 90px auto;gap:10px;align-items:center;padding:8px 6px;margin:0 -6px;border-bottom:2px dotted var(--hairline,rgba(255,255,255,0.09));border-radius:8px;color:inherit;text-decoration:none;cursor:pointer;transition:background 0.14s ease}
.ray-rs-row:last-child{border-bottom:none}
a.ray-rs-row:hover{background:var(--color-hover-item,rgba(255,255,255,0.045))}
a.ray-rs-row:hover .ray-rs-name{color:var(--color-fg,#f7f8f8)}
.ray-rs-rank{font-size:11px;color:var(--color-text-muted,#8a8f98);font-variant-numeric:tabular-nums;text-align:right}
.ray-rs-name{display:block;font-size:13px;color:var(--color-fg,#f7f8f8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ray-rs-kind{color:var(--color-text-muted,#8a8f98);font-size:11px;margin-left:6px}
.ray-rs-n{display:block;color:var(--color-text-muted,#8a8f98);font-size:10.5px;font-variant-numeric:tabular-nums}
.ray-rs-spark{display:block;opacity:0.9}
.ray-rs-sparkgap{display:block;width:90px}
.ray-rs-read{text-align:right;white-space:nowrap}
.ray-rs-read .num{display:block;font-family:var(--font-mono,ui-monospace),monospace;font-size:13px;font-variant-numeric:tabular-nums}
.ray-rs-read[data-dir="up"] .num{color:var(--color-up,#57be87)}
.ray-rs-read[data-dir="down"] .num{color:var(--color-down-text,#cc6a5c)}
.ray-rs-read .sub{display:block;color:var(--color-text-muted,#8a8f98);font-size:10px;font-variant-numeric:tabular-nums}
.ray-rs-foot{margin:12px 0 0;padding-top:10px;border-top:1px solid var(--hairline,rgba(255,255,255,0.08));font-size:11.5px;color:var(--color-text-muted,#8a8f98)}
@media (max-width:720px){.ray-rs-cols{grid-template-columns:1fr}.ray-rs-col+.ray-rs-col{margin-top:14px}.ray-rs-row{grid-template-columns:20px minmax(0,1fr) auto}.ray-rs-spark,.ray-rs-sparkgap{display:none}}
`;

/** the row's honest series, sized for a 90×24 spark: index rows plot the BMN
    level rebased to Δ% (shape of the verified move), demand rows the raw
    measured %-vs-estimate, trailing ~24 quarters. No axes — shape only. */
function sparkValues(r: DrillRow): number[] {
  if (r.readType === 'index' && r.indexSeries && r.indexSeries.length >= 4) {
    const base = r.indexSeries[0].value || 1;
    return r.indexSeries.map(p => (p.value / base - 1) * 100);
  }
  if (r.readType === 'demand' && r.demandSeries && r.demandSeries.length >= 4) {
    return r.demandSeries.slice(-24).map(p => p.value);
  }
  return [];
}

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 4) return <span className="ray-rs-sparkgap" aria-hidden />;
  const w = 90, h = 24, pad = 2;
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const pts = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (v - min) / (max - min)) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  // the dashed rule marks the window's STARTING level — the spark now answers
  // "up or down since then" at a glance instead of drawing decoration
  const y0 = pad + (1 - (values[0] - min) / (max - min)) * (h - pad * 2);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="ray-rs-spark" aria-hidden>
      <line x1={pad} x2={w - pad} y1={y0} y2={y0} stroke="var(--chart-ref)" strokeWidth={0.75} strokeDasharray="2 3" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w - pad} cy={pad + (1 - (values[values.length - 1] - min) / (max - min)) * (h - pad * 2)} r={1.8} fill={color} />
    </svg>
  );
}

function ReadCell({ r, value }: { r: DrillRow; value: number }) {
  const dir = value >= 0 ? 'up' : 'down';
  return (
    <span className="ray-rs-read" data-dir={dir}>
      <span className="num">{value >= 0 ? '+' : ''}{value.toFixed(0)}%</span>
      {r.readType === 'index' && r.index ? (
        <span className="sub">{r.index.horizon} [{r.index.ciLoPct.toFixed(0)}, {r.index.ciHiPct.toFixed(0)}]</span>
      ) : (
        <span className="sub">vs estimate</span>
      )}
    </span>
  );
}

function BoardColumn({ head, rows, showKind }: { head: string; rows: Ranked[]; showKind: boolean }) {
  return (
    <div className="ray-rs-col">
      <div className="ray-rs-colhead">{head}</div>
      {rows.map(({ row, value, rank }) => (
        <Link key={row.slug} href={`/sub/${row.slug.replace(':', '/')}`} className="ray-rs-row">
          <span className="ray-rs-rank">{rank}</span>
          <span style={{ minWidth: 0 }}>
            <span className="ray-rs-name">
              {row.label}
              {showKind ? <span className="ray-rs-kind">{row.vertical}</span> : null}
            </span>
            <span className="ray-rs-n">{row.lots.toLocaleString()} lots</span>
          </span>
          <Spark values={sparkValues(row)} color={value >= 0 ? 'var(--color-up)' : 'var(--color-down)'} />
          <ReadCell r={row} value={value} />
        </Link>
      ))}
    </div>
  );
}

export default function RelativeStrength({ marketData, scope }: {
  marketData: MarketData | null;
  /** the active MarketSwitch key — 'all' pools every vertical's drills */
  scope: string;
}) {
  const board = useMemo(() => {
    const drills = marketData?.drills;
    if (!drills) return null;
    const pool: DrillRow[] = scope === 'all' ? Object.values(drills).flat() : drills[scope] || [];
    if (!pool.length) return null;

    // verified reads only: CI'd index moves first-class, measured demand next
    const typeOrder = (r: DrillRow) => (r.readType === 'index' ? 0 : 1);
    const verified: { row: DrillRow; value: number }[] = [];
    for (const r of pool) {
      if (r.readType === 'index' && r.index) verified.push({ row: r, value: r.index.changePct });
      else if (r.readType === 'demand' && r.demandNow != null) verified.push({ row: r, value: r.demandNow });
    }
    const descriptive = pool.length - verified.length;
    if (verified.length < 4) return null; // a board of fewer isn't a board — abstain

    verified.sort((a, b) => b.value - a.value || typeOrder(a.row) - typeOrder(b.row) || b.row.lots - a.row.lots);
    const ranked: Ranked[] = verified.map((v, i) => ({ ...v, rank: i + 1 }));

    const leaders = ranked.filter(x => x.value > 0).slice(0, 6);
    // laggards: the bottom of the field, never overlapping the leaders; weakest first
    const laggards = ranked.slice(Math.max(leaders.length, ranked.length - 6)).reverse();
    const spreadPp = ranked[0].value - ranked[ranked.length - 1].value;
    return { leaders, laggards, spreadPp, descriptive, nVerified: ranked.length };
  }, [marketData, scope]);

  if (!board) return null;
  const { leaders, laggards, spreadPp, descriptive } = board;

  return (
    <div className="ray-vm ray-vm-card glass glass-quiet">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ray-vm-head" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <span style={{ minWidth: 0 }}>
          <span className="ns-kicker" style={{ marginBottom: 4 }}>What&rsquo;s running, what&rsquo;s cooling</span>
          <span style={{ display: 'block', fontSize: 30, fontWeight: 340, letterSpacing: '-0.02em', lineHeight: 1.12, color: 'var(--color-fg)' }}>
            <span className="ray-sect-mark" aria-hidden><StrengthMark size={18} /></span>Relative strength
          </span>
        </span>
        <span className="ray-vm-method">CI-verified indexes first, measured demand second · descriptive markets excluded</span>
      </div>
      <p className="ray-rs-spread">
        spread: <span className="num">+{Math.round(spreadPp)}pp</span> between the strongest and weakest verified read
      </p>
      <div className="ray-rs-cols">
        {leaders.length > 0 && <BoardColumn head="Leaders" rows={leaders} showKind={scope === 'all'} />}
        {laggards.length > 0 && <BoardColumn head="Laggards" rows={laggards} showKind={scope === 'all'} />}
      </div>
      {descriptive > 0 && (
        <p className="ray-rs-foot">{descriptive} more tracked descriptively — no verified motion, so not ranked.</p>
      )}
    </div>
  );
}
