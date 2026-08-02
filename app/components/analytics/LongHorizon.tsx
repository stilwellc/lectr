'use client';
/**
 * LongHorizon — the decades read on /analytics: the LONG-memory series nobody
 * else has, one curated chart per market scope on the HeroChart instrument.
 *
 *   sports / all → the card ERA DIVERGENCE: classic vs modern vs vintage
 *                  repeat-sale indexes, rebased to Δ% from their common start
 *   culture      → the 23-year story: yearly typical $ (n-gated medians) for
 *                  the biggest subject domains off the RR archive
 *   watches      → the icon model families' measured demand, ~25 years of
 *                  quarters of %-vs-estimate
 *   art / design → kind & material demand series, same basis
 *   science      → the collections' quarterly sold counts — volume facts,
 *                  never dressed as price movement
 *
 * Honesty: index/demand lines are the real measured series (index rebased to
 * a shared window so eras compare like-for-like); volume plots counts and is
 * labeled as counts; green/red appears ONLY on the legend's verified deltas
 * (CI'd index moves, measured demand); $ and count legend values plain ink;
 * mono type reserved for % figures. A scope with no qualifying series
 * renders nothing.
 */
import React, { useMemo } from 'react';
import type { MarketData, SubMarketRead } from '../../hooks/useRayData';
import HeroChart, { HeroLine } from '../../preview/terminal/HeroChart';
import { LAYER_PALETTE } from '../../lib/heroLayers';

type DrillRow = SubMarketRead & { parent: string };

interface LegendRow {
  key: string;
  label: string;
  color: string;
  /** the figure: mono+green/red only when it's a verified delta */
  num: string;
  dir: 'up' | 'down' | null; // null = plain ink (descriptive $ / counts)
  pct: boolean;              // mono ONLY for % figures
  sub: string;               // method + n
}
interface Curated {
  anchor: HeroLine;
  layers: HeroLine[];
  method: string;
  legend: LegendRow[];
  caption?: string;
}

const ANCHOR_INK = '#E8EAED';

const CSS = `
.ray-lh-chart{margin-top:4px}
.ray-lh-legend{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08)}
.ray-lh-key{display:flex;align-items:baseline;gap:7px}
.ray-lh-key i{width:9px;height:9px;border-radius:2px;flex:none;transform:translateY(1px)}
.ray-lh-name{font-size:12.5px;font-weight:600;color:var(--color-fg,#E8EAED)}
.ray-lh-val{font-size:12px;font-variant-numeric:tabular-nums;color:var(--color-fg,#E8EAED)}
.ray-lh-val.pct{font-family:var(--font-mono,ui-monospace),monospace}
.ray-lh-val[data-dir="up"]{color:var(--color-up,#2FBF71)}
.ray-lh-val[data-dir="down"]{color:var(--color-down-text,#E5484D)}
.ray-lh-sub{font-size:10.5px;color:#7A8087;font-variant-numeric:tabular-nums}
.ray-lh-cap{margin:10px 0 0;font-size:11.5px;color:#7A8087;line-height:1.5}
`;

const fmtUsd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n).toLocaleString()}`;

const fmtLots = (n: number) => `${n.toLocaleString()} lots`;

/* ── per-scope curation ────────────────────────────────────── */

/** sports/all — the era divergence: the three cards-era repeat-sale indexes,
    rebased to Δ% from the LATEST common start so the comparison is honest
    (vintage's series reaches further back than classic/modern). */
function eraChart(md: MarketData, forAll: boolean): Curated | null {
  const rows = (md.drills?.sports || []).filter(
    (r): r is DrillRow => r.slug.startsWith('cards-era:') && r.readType === 'index' && !!r.indexSeries && r.indexSeries.length >= 6,
  );
  if (rows.length < 2) return null;
  const commonStart = rows.map(r => r.indexSeries![0].period).sort().pop()!;
  const rebased = rows
    .map(r => {
      const pts = r.indexSeries!.filter(p => p.period >= commonStart);
      if (pts.length < 4) return null;
      const base = pts[0].value || 1;
      return { row: r, points: pts.map(p => ({ period: p.period, value: (p.value / base - 1) * 100, n: p.n })) };
    })
    .filter((x): x is { row: DrillRow; points: HeroLine['points'] } => x !== null)
    // anchor = the strongest era by its CI'd move
    .sort((a, b) => (b.row.index?.changePct ?? -Infinity) - (a.row.index?.changePct ?? -Infinity));
  if (rebased.length < 2) return null;

  const line = (x: (typeof rebased)[number], color: string): HeroLine => ({
    key: x.row.slug, label: x.row.label, color, unit: 'pct', points: x.points,
  });
  const legend: LegendRow[] = rebased.map((x, i) => {
    const idx = x.row.index!;
    return {
      key: x.row.slug,
      label: x.row.label,
      color: i === 0 ? ANCHOR_INK : LAYER_PALETTE[(i - 1) % LAYER_PALETTE.length],
      num: `${idx.changePct >= 0 ? '+' : ''}${idx.changePct.toFixed(0)}% ${idx.horizon}`,
      dir: idx.changePct >= 0 ? 'up' : 'down',
      pct: true,
      sub: `[${idx.ciLoPct.toFixed(0)}, ${idx.ciHiPct.toFixed(0)}] · ${fmtLots(x.row.lots)}`,
    };
  });
  return {
    anchor: line(rebased[0], ANCHOR_INK),
    layers: rebased.slice(1).map((x, i) => line(x, LAYER_PALETTE[i % LAYER_PALETTE.length])),
    method: `card era indexes · repeat-sale, rebased to ${commonStart}`,
    legend,
    caption: forAll
      ? 'Shown for Total: the corpus’s strongest long-memory read — the card era divergence. Switch markets for each vertical’s own long series.'
      : undefined,
  };
}

/** watches/art/design — the longest measured demand series (%-vs-estimate),
    top families/kinds by tracked volume. */
function demandChart(md: MarketData, scope: string, take: number, minLen: number, method: string): Curated | null {
  const rows = (md.drills?.[scope] || [])
    .filter(r => r.readType === 'demand' && r.demandNow != null && r.demandSeries && r.demandSeries.length >= minLen)
    .sort((a, b) => b.lots - a.lots)
    .slice(0, take);
  if (rows.length < 2) return null;
  const line = (r: DrillRow, color: string): HeroLine => ({
    key: r.slug, label: r.label, color, unit: 'pct',
    points: r.demandSeries.map(p => ({ period: p.period, value: p.value, n: p.n })),
  });
  const legend: LegendRow[] = rows.map((r, i) => ({
    key: r.slug,
    label: r.label,
    color: i === 0 ? ANCHOR_INK : LAYER_PALETTE[(i - 1) % LAYER_PALETTE.length],
    num: `${r.demandNow! >= 0 ? '+' : ''}${r.demandNow!.toFixed(0)}%`,
    dir: r.demandNow! >= 0 ? 'up' : 'down',
    pct: true,
    sub: `vs estimate · ${fmtLots(r.lots)}`,
  }));
  return {
    anchor: line(rows[0], ANCHOR_INK),
    layers: rows.slice(1).map((r, i) => line(r, LAYER_PALETTE[i % LAYER_PALETTE.length])),
    method,
    legend,
  };
}

/** culture — the 23-year yearly typical-$ story for the biggest subject
    domains. Descriptive $ facts: plain-ink legend, never green/red. */
function cultureChart(md: MarketData): Curated | null {
  const rows = (md.drills?.culture || [])
    .filter(r => r.histSeries && r.histSeries.length >= 10)
    .sort((a, b) => b.lots - a.lots)
    .slice(0, 5);
  if (rows.length < 2) return null;
  const line = (r: DrillRow, color: string): HeroLine => ({
    key: r.slug, label: r.label, color, unit: 'money',
    points: r.histSeries!.map(p => ({ period: p.period, value: p.value, n: p.n })),
  });
  const legend: LegendRow[] = rows.map((r, i) => {
    const last = r.histSeries![r.histSeries!.length - 1];
    return {
      key: r.slug,
      label: r.label,
      color: i === 0 ? ANCHOR_INK : LAYER_PALETTE[(i - 1) % LAYER_PALETTE.length],
      num: `${fmtUsd(last.value)} typical`,
      dir: null,
      pct: false,
      sub: `${last.period} · n=${last.n.toLocaleString()}`,
    };
  });
  return {
    anchor: line(rows[0], ANCHOR_INK),
    layers: rows.slice(1).map((r, i) => line(r, LAYER_PALETTE[i % LAYER_PALETTE.length])),
    method: '23-year typical price · yearly median · n-gated',
    legend,
  };
}

/** science — the collections' quarterly sold counts. Volume facts only. */
function scienceChart(md: MarketData): Curated | null {
  const pool = md.subMarkets?.science?.length ? md.subMarkets.science : md.drills?.science || [];
  const rows = pool
    .filter(r => r.volSeries && r.volSeries.length >= 8)
    .sort((a, b) => b.lots - a.lots)
    .slice(0, 5);
  if (rows.length < 2) return null;
  const line = (r: SubMarketRead, color: string): HeroLine => ({
    key: r.slug, label: r.label, color, unit: 'count',
    points: r.volSeries!.map(p => ({ period: p.period, value: p.n, n: p.n })),
  });
  const legend: LegendRow[] = rows.map((r, i) => {
    const last = r.volSeries![r.volSeries!.length - 1];
    return {
      key: r.slug,
      label: r.label,
      color: i === 0 ? ANCHOR_INK : LAYER_PALETTE[(i - 1) % LAYER_PALETTE.length],
      num: `${last.n.toLocaleString()}/qtr`,
      dir: null,
      pct: false,
      sub: `${last.period} · ${fmtLots(r.lots)}`,
    };
  });
  return {
    anchor: line(rows[0], ANCHOR_INK),
    layers: rows.slice(1).map((r, i) => line(r, LAYER_PALETTE[i % LAYER_PALETTE.length])),
    method: 'sales volume · quarterly · counts, not prices',
    legend,
  };
}

function curate(md: MarketData, scope: string): Curated | null {
  switch (scope) {
    case 'all': return eraChart(md, true);
    case 'sports': return eraChart(md, false);
    case 'culture': return cultureChart(md);
    case 'watches': return demandChart(md, 'watches', 4, 60, 'model-family demand · % vs estimate, trailing year');
    case 'art': return demandChart(md, 'art', 4, 40, 'kind demand · % vs estimate, trailing year');
    case 'design': return demandChart(md, 'design', 4, 40, 'kind & material demand · % vs estimate, trailing year');
    case 'science': return scienceChart(md);
    default: return null;
  }
}

export default function LongHorizon({ marketData, scope }: {
  marketData: MarketData | null;
  /** the active MarketSwitch key */
  scope: string;
}) {
  const curated = useMemo(() => (marketData ? curate(marketData, scope) : null), [marketData, scope]);
  if (!curated) return null;

  return (
    <div className="ray-vm ray-vm-card glass glass-quiet">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ray-vm-head">
        <span className="ray-vm-title">Long horizon</span>
        <span className="ray-vm-method">{curated.method}</span>
      </div>
      <div className="ray-lh-chart">
        <HeroChart anchor={curated.anchor} layers={curated.layers} play height={260} compact />
      </div>
      <div className="ray-lh-legend">
        {curated.legend.map(l => (
          <span key={l.key} className="ray-lh-key">
            <i style={{ background: l.color }} aria-hidden />
            <span className="ray-lh-name">{l.label}</span>
            <span className={`ray-lh-val${l.pct ? ' pct' : ''}`} data-dir={l.dir ?? undefined}>{l.num}</span>
            <span className="ray-lh-sub">{l.sub}</span>
          </span>
        ))}
      </div>
      {curated.caption ? <p className="ray-lh-cap">{curated.caption}</p> : null}
    </div>
  );
}
