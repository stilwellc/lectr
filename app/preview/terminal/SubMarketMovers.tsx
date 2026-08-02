'use client';
/**
 * SubMarketMovers — a compact lander strip that finally surfaces the flagship
 * drills taxonomy on home (audit rec #1). The top VERIFIED sub-market reads
 * for the active market — CI'd repeat-sale indexes first, measured demand
 * second — each a one-line read linking to its /sub dossier. Descriptive
 * rows are excluded (no fabricated motion); the strip hides entirely when
 * fewer than two verified reads exist.
 *
 * Honesty: green/red only on the real deltas; mono only on the % figures;
 * every row names its horizon (index) or basis (demand).
 */
import Link from 'next/link';
import type { MarketData, SubMarketRead } from '../../hooks/useRayData';
import Flick from '../../components/Flick';

type DrillRow = SubMarketRead & { parent: string };

const CSS = `
.ray-smm{margin-top:10px}
.ray-smm-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:6px}
.ray-smm-title{font-size:12.5px;font-weight:600;color:var(--paper-ink,var(--color-fg))}
.ray-smm-method{font-size:10.5px;color:var(--paper-muted,var(--color-text-faint))}
.ray-smm-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:baseline;padding:7px 0;border-top:2px dotted color-mix(in srgb,var(--paper-ink,var(--color-fg)) 10%,transparent);text-decoration:none;color:inherit}
.ray-smm-row:first-of-type{border-top:none}
.ray-smm-row:hover .ray-smm-name{color:var(--paper-ink,var(--color-fg))}
.ray-smm-name{font-size:13px;color:var(--paper-muted,var(--color-text-secondary));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ray-smm-read{font-size:12.5px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.ray-smm-read .num{font-family:var(--font-mono,ui-monospace),monospace}
.ray-smm-read[data-dir=up] .num{color:var(--paper-up-text,var(--color-up))}
.ray-smm-read[data-dir=down] .num{color:var(--paper-down-text,var(--color-down-text))}
.ray-smm-read .tag{color:var(--paper-muted,var(--color-text-faint));font-size:10.5px;margin-left:5px}
.ray-smm-all{display:inline-flex;align-items:center;gap:4px;margin-top:8px;font-size:11.5px;color:var(--paper-muted,var(--color-text-muted));text-decoration:none}
.ray-smm-all:hover{color:var(--paper-ink,var(--color-fg))}
`;

export default function SubMarketMovers({ marketData, scope }: { marketData: MarketData | null; scope: string }) {
  const drills = marketData?.drills;
  if (!drills) return null;
  const pool: DrillRow[] = scope === 'all' ? Object.values(drills).flat() : (drills[scope] || []);
  const verified = pool.filter(r => (r.readType === 'index' && r.index) || (r.readType === 'demand' && r.demandNow != null));
  if (verified.length < 2) return null;

  const strength = (r: DrillRow) => r.readType === 'index' && r.index ? r.index.changePct : (r.demandNow ?? 0);
  const rank = (r: DrillRow) => (r.readType === 'index' ? 0 : 1);
  const rows = [...verified]
    .sort((a, b) => rank(a) - rank(b) || strength(b) - strength(a))
    .slice(0, 5);

  const analyticsHref = scope === 'all' ? '/analytics' : `/analytics/${scope}`;

  return (
    <div className="ray-smm">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ray-smm-head">
        <span className="ray-smm-title">Sub-markets on the move</span>
        <span className="ray-smm-method">verified reads only · CI&rsquo;d indexes, then demand</span>
      </div>
      {rows.map(r => {
        const v = strength(r);
        const isIdx = r.readType === 'index' && r.index;
        const slug = `/sub/${r.slug.replace(':', '/')}`;
        return (
          <Link key={r.slug} href={slug} className="ray-smm-row">
            <span className="ray-smm-name">
              {r.label}{scope === 'all' ? <span className="tag" style={{ color: 'var(--paper-muted,var(--color-text-faint))', fontSize: 10.5, marginLeft: 6 }}>{r.vertical}</span> : null}
            </span>
            <span className="ray-smm-read" data-dir={v >= 0 ? 'up' : 'down'}>
              <span className="num">{v >= 0 ? '+' : ''}{Math.round(v)}%</span>
              {isIdx && r.index ? <span className="tag">{r.index.horizon} verified</span> : <span className="tag">vs est.</span>}
            </span>
          </Link>
        );
      })}
      <Link href={analyticsHref} className="ray-smm-all">
        Relative strength, the full board <Flick size={9} />
      </Link>
    </div>
  );
}
