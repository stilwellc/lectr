'use client';
/**
 * SubMarketDirectory — the taxonomy made visible on /makers (the roster).
 * The active market's sub-category tree as a grid of group cards: sports
 * kinds hold their sport splits, watch makers hold their model families,
 * culture splits by subject and by kind, science by collection, design by
 * form and material. Each row is a drills read from market.json — the same
 * honesty ladder as everywhere (CI'd index / demand vs estimate / plain
 * descriptive facts; green-red ONLY on real deltas, mono ONLY on % figures).
 */
import React from 'react';
import Link from 'next/link';
import { ARTISTS, MARKETS } from '../constants';
import { SUBCAT_LABELS } from '../lib/subcat-labels';
import type { MarketData, SubMarketRead } from '../hooks/useRayData';

type DrillRow = SubMarketRead & { parent: string };

const MAKER_LABEL: Record<string, string> = {};
for (const a of ARTISTS) MAKER_LABEL[a.slug] = a.label;

// group-title resolution: watch parents are maker slugs; sports/science
// parents are kind slugs; the synthetic parents name their axis.
const AXIS_TITLES: Record<string, string> = {
  'culture': 'By subject', 'kind': 'By kind', 'art': 'By kind',
  'design': 'By form', 'material': 'By material',
};
const groupTitle = (parent: string): string =>
  AXIS_TITLES[parent] ?? MAKER_LABEL[parent] ?? SUBCAT_LABELS[parent] ?? parent;

// row label inside a group card: the drill's own name (the group already
// names the kind/maker), falling back to the emitted label.
const rowLabel = (r: DrillRow): string => {
  const part = r.slug.split(':')[1];
  return (part && SUBCAT_LABELS[part]) || r.label;
};

const fmtUsd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `$${Math.round(n / 1000)}K` : `$${n.toLocaleString()}`;

const CSS = `
.ray-smd{margin:6px 0 10px}
.ray-smd-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px}
.ray-smd-title{font-size:15px;font-weight:600;color:var(--color-fg,#E8EAED)}
.ray-smd-method{font-size:11.5px;color:#7A8087}
.ray-smd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.ray-smd-card{border:2px dotted rgba(255,255,255,0.11);border-radius:20px;padding:16px 18px 8px}
.ray-smd-cardhead{display:flex;align-items:baseline;justify-content:space-between;padding-bottom:10px;border-bottom:2px dotted rgba(255,255,255,0.09)}
.ray-smd-cardtitle{font-size:13.5px;font-weight:600;color:var(--color-fg,#E8EAED)}
.ray-smd-cardmeta{font-size:11px;color:#7A8087;font-variant-numeric:tabular-nums}
.ray-smd-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:baseline;padding:8px 6px;margin:0 -6px;border-bottom:2px dotted rgba(255,255,255,0.07);border-radius:8px;color:inherit;text-decoration:none;cursor:pointer;transition:background 0.14s ease}
.ray-smd-row:last-child{border-bottom:none}
a.ray-smd-row:hover{background:rgba(255,255,255,0.05)}
a.ray-smd-row:hover .ray-smd-name{color:#FFF}
.ray-smd-name{font-size:13px;color:var(--color-fg,#E8EAED)}
.ray-smd-read{font-size:12.5px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;color:var(--color-fg,#E8EAED)}
.ray-smd-read .num{font-family:var(--font-mono,ui-monospace),monospace}
.ray-smd-read[data-dir="up"] .num{color:var(--color-up,#2FBF71)}
.ray-smd-read[data-dir="down"] .num{color:var(--color-down,#E5484D)}
.ray-smd-read .tag{color:#7A8087;font-size:10.5px;margin-left:5px}
.ray-smd-more{display:block;padding:8px 0 6px;font-size:11px;color:#7A8087;text-decoration:none;transition:color 0.14s ease}
a.ray-smd-more:hover{color:#B8BEC6}
a.ray-smd-more .arw{margin-left:4px}
`;

function readCell(r: DrillRow) {
  if (r.readType === 'index' && r.index) {
    const v = r.index.changePct;
    return (
      <span className="ray-smd-read" data-dir={v >= 0 ? 'up' : 'down'}>
        <span className="num">{v >= 0 ? '+' : ''}{v.toFixed(0)}%</span>
        <span className="tag">{r.index.horizon} verified</span>
      </span>
    );
  }
  if (r.readType === 'demand' && r.demandNow != null) {
    const v = r.demandNow;
    return (
      <span className="ray-smd-read" data-dir={v >= 0 ? 'up' : 'down'}>
        <span className="num">{v >= 0 ? '+' : ''}{v.toFixed(0)}%</span>
        <span className="tag">vs estimate</span>
      </span>
    );
  }
  return (
    <span className="ray-smd-read">
      {r.typicalUsd != null
        ? <>{fmtUsd(r.typicalUsd)}<span className="tag">typical</span></>
        : <span className="tag">{r.lots.toLocaleString()} lots</span>}
    </span>
  );
}

const MAX_ROWS = 7;

function GroupCard({ title, rows, full }: { title: string; rows: DrillRow[]; full?: boolean }) {
  const shown = rows.slice(0, MAX_ROWS);
  const total = rows.reduce((s, r) => s + r.lots, 0);
  // #24 — the honest "shows the rest" destination: the vertical's analytics
  // desk (full sub-market book + maker rankings). Every drill row carries its
  // parent vertical; all rows in a card share it.
  const vertical = rows[0]?.vertical;
  return (
    <div className="ray-smd-card">
      <div className="ray-smd-cardhead">
        <span className="ray-smd-cardtitle">{title}</span>
        <span className="ray-smd-cardmeta">{total.toLocaleString()} lots</span>
      </div>
      {shown.map(r => (
        <Link key={r.slug} href={`/sub/${r.slug.replace(':', '/')}`} className="ray-smd-row">
          {/* cross-market overview mixes kinds in one card — keep the full
              emitted label there ('Soccer · cards' vs 'Soccer · memorabilia');
              a scoped group card already names the kind/maker in its head */}
          <span className="ray-smd-name">{full ? r.label : rowLabel(r)}</span>
          {readCell(r)}
        </Link>
      ))}
      {rows.length > MAX_ROWS && (
        vertical
          ? <Link href={`/analytics/${vertical}`} className="ray-smd-more">+ {rows.length - MAX_ROWS} more tracked<span className="arw">&#8594;</span></Link>
          : <div className="ray-smd-more">+ {rows.length - MAX_ROWS} more tracked</div>
      )}
    </div>
  );
}

export default function SubMarketDirectory({ marketData, scope }: { marketData: MarketData | null; scope: string }) {
  const drills = marketData?.drills;
  if (!drills) return null;

  let cards: { title: string; rows: DrillRow[]; full?: boolean }[] = [];
  if (scope === 'all') {
    // overview: one card per vertical, its strongest few reads. Pass the FULL
    // row set — GroupCard slices to MAX_ROWS itself and needs the real length
    // to render the "+N more → /analytics/<vertical>" door (pre-slicing here
    // hid 54 of the 94 tracked drills with no affordance to reach them).
    for (const m of MARKETS) {
      const rows = drills[m.key];
      if (rows?.length) cards.push({ title: m.label, rows, full: true });
    }
  } else {
    const rows = drills[scope] || [];
    const byParent = new Map<string, DrillRow[]>();
    for (const r of rows) (byParent.get(r.parent) || byParent.set(r.parent, []).get(r.parent)!).push(r);
    cards = Array.from(byParent.entries()).map(([parent, rs]) => ({ title: groupTitle(parent), rows: rs }));
    cards.sort((a, b) => b.rows.reduce((s, r) => s + r.lots, 0) - a.rows.reduce((s, r) => s + r.lots, 0));
  }
  if (!cards.length) return null;

  return (
    <div className="ray-smd">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ray-smd-head">
        <span className="ray-smd-title">Sub-markets</span>
        <span className="ray-smd-method">performance by sub-category · every figure measured, never modeled</span>
      </div>
      <div className="ray-smd-grid">
        {cards.map(c => <GroupCard key={c.title} title={c.title} rows={c.rows} full={c.full} />)}
      </div>
    </div>
  );
}
