'use client';
/**
 * SubMarketDirectory — the taxonomy made visible on /makers (the roster).
 * The active market's sub-category tree as cream wells: sports kinds hold
 * their sport splits, watch makers hold their model families, culture splits
 * by subject and by kind, science by collection, design by form and
 * material. Each row is a drills read from market.json — the same honesty
 * ladder as everywhere (CI'd index / demand vs estimate / plain descriptive
 * facts; green-red ONLY on real deltas, mono ONLY on % figures).
 *
 * North-star grammar: quiet kicker head, borderless cream wells with the
 * inverted hierarchy (gray group title, ink rows), dotted ledger rows. The
 * well + grouping are exported so the /sub index speaks the same voice.
 */
import React from 'react';
import Link from 'next/link';
import { ARTISTS, MARKETS } from '../constants';
import { SUBCAT_LABELS } from '../lib/subcat-labels';
import type { MarketData, SubMarketRead } from '../hooks/useRayData';
import '../northstar-pages.css';

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

// row label inside a group well: the drill's own name (the group already
// names the kind/maker), falling back to the emitted label.
const rowLabel = (r: DrillRow): string => {
  const part = r.slug.split(':')[1];
  return (part && SUBCAT_LABELS[part]) || r.label;
};

/** SIGNED-SIGNAL LAW: the glyph and the ink agree. A rounded 0 is flat —
    no sign, no color; only a real up wears '+' and green, a real down '−'
    and red. Shared by every sub-market surface that prints these reads. */
export const signedPct = (v: number): string => {
  const r = Math.round(v);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}%`;
};
export const dirOf = (v: number): 'up' | 'down' | undefined => {
  const r = Math.round(v);
  return r > 0 ? 'up' : r < 0 ? 'down' : undefined;
};

const fmtUsd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `$${Math.round(n / 1000)}K` : `$${n.toLocaleString()}`;

/** One vertical's drills, grouped by taxonomy parent and ranked by depth. */
export function groupDrillsByParent(rows: DrillRow[]): { title: string; rows: DrillRow[] }[] {
  const byParent = new Map<string, DrillRow[]>();
  for (const r of rows) (byParent.get(r.parent) || byParent.set(r.parent, []).get(r.parent)!).push(r);
  const wells = Array.from(byParent.entries()).map(([parent, rs]) => ({ title: groupTitle(parent), rows: rs }));
  wells.sort((a, b) => b.rows.reduce((s, r) => s + r.lots, 0) - a.rows.reduce((s, r) => s + r.lots, 0));
  return wells;
}

function readCell(r: DrillRow) {
  if (r.readType === 'index' && r.index) {
    return (
      <span className="nsp-read-cell" data-dir={dirOf(r.index.changePct)}>
        <span className="num">{signedPct(r.index.changePct)}</span>
        <span className="tag">{r.index.horizon} verified</span>
      </span>
    );
  }
  if (r.readType === 'demand' && r.demandNow != null) {
    return (
      <span className="nsp-read-cell" data-dir={dirOf(r.demandNow)}>
        <span className="num">{signedPct(r.demandNow)}</span>
        <span className="tag">vs estimate</span>
      </span>
    );
  }
  return (
    <span className="nsp-read-cell">
      {r.typicalUsd != null
        ? <>{fmtUsd(r.typicalUsd)}<span className="tag">typical</span></>
        : <span className="tag">{r.lots.toLocaleString()} lots</span>}
    </span>
  );
}

const MAX_ROWS = 7;

/** A cream well: gray group title + lot count over dotted ledger rows, each
    a sub-market dossier link with its honest read. `full` keeps the emitted
    label ('Soccer · cards' vs 'Soccer · memorabilia') for cross-market wells;
    `limit` caps the rows (the makers directory folds at 7 behind a door to
    the vertical's desk; the /sub index prints every row). */
export function SubMarketWell({ title, rows, full, limit = MAX_ROWS }: { title: string; rows: DrillRow[]; full?: boolean; limit?: number }) {
  const shown = rows.slice(0, limit);
  const total = rows.reduce((s, r) => s + r.lots, 0);
  // the honest "shows the rest" destination: the vertical's analytics desk
  // (full sub-market book + maker rankings). Every drill row carries its
  // parent vertical; all rows in a well share it.
  const vertical = rows[0]?.vertical;
  return (
    <div className="ns-well">
      <div className="nsp-well-head">
        <span className="ns-well-label">{title}</span>
        <span className="nsp-well-meta">{total.toLocaleString()} lots</span>
      </div>
      <div className="nsp-well-rows">
        {shown.map(r => (
          <Link key={r.slug} href={`/sub/${r.slug.replace(':', '/')}`} className="nsp-row">
            <span className="nsp-row-name">{full ? r.label : rowLabel(r)}</span>
            {readCell(r)}
          </Link>
        ))}
      </div>
      {rows.length > limit && (
        vertical
          ? <Link href={`/analytics/${vertical}`} className="nsp-more">+ {rows.length - limit} more tracked &#8594;</Link>
          : <span className="nsp-more">+ {rows.length - limit} more tracked</span>
      )}
    </div>
  );
}

export default function SubMarketDirectory({ marketData, scope }: { marketData: MarketData | null; scope: string }) {
  const drills = marketData?.drills;
  if (!drills) return null;

  let wells: { title: string; rows: DrillRow[]; full?: boolean }[] = [];
  if (scope === 'all') {
    // overview: one well per vertical, its strongest few reads. Pass the FULL
    // row set — the well slices to MAX_ROWS itself and needs the real length
    // to render the "+N more → /analytics/<vertical>" door (pre-slicing here
    // hid 54 of the 94 tracked drills with no affordance to reach them).
    for (const m of MARKETS) {
      const rows = drills[m.key];
      if (rows?.length) wells.push({ title: m.label, rows, full: true });
    }
  } else {
    wells = groupDrillsByParent(drills[scope] || []);
  }
  if (!wells.length) return null;

  return (
    <div style={{ margin: '6px 0 10px' }}>
      <div className="nsp-dir-head">
        <span className="ns-kicker">
          <Link href="/sub" style={{ color: 'inherit', textDecoration: 'none' }}>Sub-markets</Link>
        </span>
        <span className="nsp-shctx">performance by sub-category · every figure measured, never modeled</span>
      </div>
      <div className="nsp-wells" style={{ marginTop: 14 }}>
        {wells.map(w => <SubMarketWell key={w.title} title={w.title} rows={w.rows} full={w.full} />)}
      </div>
    </div>
  );
}
