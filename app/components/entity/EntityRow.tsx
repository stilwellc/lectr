'use client';
/**
 * EntityRow — ONE ledger row for every kind (makers overhaul P2): a maker, a
 * player, a Pokémon / film / mission / team (a subject), a set, a clean
 * sub-category, a market's remainder. Face · name · one kind tag · live (with
 * the flag dot) · 12-month median with its n · 12-month sold · the
 * complete-quarter trend (gaps drawn as gaps) · year-over-year only where the
 * build's n gate passed. Phone: name, live, the labeled median.
 *
 * Memoized: every prop is a primitive or a stable reference, so a chip click
 * re-renders only the rows whose live pool or summary changed.
 */
import React, { useState } from 'react';
import { formatPrice, httpsImg, sizedImg } from '../../utils';
import Flick from '../Flick';
import type { ColKey, LiveSort, SortKey } from '../../lib/entity/view-state';
import { fmtPct, fmtUsd, type Row } from '../../lib/entity/ledger';
import EntityPanel from './EntityPanel';

/* ── THE COLUMNS — the Display menu toggles them; a sortable head sorts ── */
export interface ColSpec { k: ColKey; label: string; width: string; note: string; sort?: SortKey }
export const COLS: ColSpec[] = [
  { k: 'live', label: 'Live', width: '72px', note: 'Live lots on the block that pass the filters (the dot: some are flagged below their comparables)', sort: 'live' },
  { k: 'median', label: 'Median · 12 mo', width: '128px', note: 'Median sale over the trailing 12 months, with its n (hover a cell for the scope it covers)', sort: 'median' },
  { k: 'sold12', label: 'Sold · 12 mo', width: '92px', note: 'Sales tracked in the last 12 months', sort: 'sold12' },
  { k: 'curve', label: 'Trend · 12 q', width: '96px', note: 'Quarterly median sale, the last 12 complete quarters — a gap is a quarter with under 3 sales' },
  { k: 'yoy', label: 'YoY', width: '64px', note: 'Year over year, like for like: the median price ratio of the same items sold in both years (20+ matched), else the median sale when both years sold a similar number (n ≥ 10 each side)', sort: 'movers' },
  { k: 'flags', label: 'Flags', width: '56px', note: 'Live lots the engine prices below their comparables', sort: 'flags' },
  { k: 'sold', label: 'Sold · all', width: '88px', note: 'Sales tracked, all time' },
  { k: 'record', label: 'Record', width: '84px', note: 'Highest price tracked' },
  { k: 'settled', label: 'Settled $', width: '84px', note: 'Total hammer tracked, all time' },
  { k: 'delta', label: 'Verified Δ', width: '84px', note: 'CI-verified repeat-sales move (the 95% interval resolves the sign)' },
];
export const colSpec = (k: ColKey) => COLS.find(c => c.k === k)!;

/** the grid template a column set prints on (rides a CSS var) */
export const gridTemplateOf = (cols: readonly ColKey[]) =>
  `30px minmax(0,1fr) ${cols.map(k => colSpec(k).width).join(' ')} 18px`;

/* ── THE TREND — complete quarters; a thin quarter (null) breaks the line ── */
export function Spark({ values, w = 90, h = 22 }: { values: readonly (number | null)[]; w?: number; h?: number }) {
  const nums = values.filter((v): v is number => v != null && v > 0);
  if (nums.length < 2) return null;
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = max - min || 1;
  const px = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * (w - 6) + 2 : w / 2);
  const py = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  const segs: string[][] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v == null || v <= 0) { if (cur.length) segs.push(cur); cur = []; return; }
    cur.push(`${px(i).toFixed(1)},${py(v).toFixed(1)}`);
  });
  if (cur.length) segs.push(cur);
  let last = values.length - 1;
  while (last >= 0 && !(values[last] != null && values[last]! > 0)) last--;
  return (
    <svg width={w} height={h} aria-hidden>
      {segs.map((pts, i) => pts.length > 1
        ? <polyline key={i} points={pts.join(' ')} fill="none" stroke="var(--lw-5, rgba(255, 255, 255, 0.5))" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        : <circle key={i} cx={pts[0].split(',')[0]} cy={pts[0].split(',')[1]} r="1.1" fill="var(--lw-5, rgba(255, 255, 255, 0.5))" />)}
      {last >= 0 && <circle cx={px(last)} cy={py(values[last]!)} r="2" fill="var(--color-fg)" />}
    </svg>
  );
}

/** the median cell's hover: n + scope */
export function medianTitle(r: Pick<Row, 'median' | 'medianN' | 'medianScope'>): string | undefined {
  if (!r.median) return 'No 12-month median: under 5 sales in the trailing year';
  return `12-month median${r.medianN ? ` · n ${r.medianN.toLocaleString()}` : ''}${r.medianScope ? ` · ${r.medianScope}` : ''}`;
}

/** perf instrumentation: NEXT_PUBLIC_MK_PROFILE=1 counts row renders on
 *  window.__mkR (the P1/P2 re-render measurements); compiled out otherwise */
function countRender(id: string) {
  if (process.env.NEXT_PUBLIC_MK_PROFILE && typeof window !== 'undefined') {
    const w = window as unknown as { __mkR?: number; __mkIds?: string[] };
    w.__mkR = (w.__mkR || 0) + 1;
    (w.__mkIds = w.__mkIds || []).push(id);
  }
}

export interface EntityRowProps {
  r: Row; soldMax: number; isOpen: boolean; cols: ColKey[];
  isSel: boolean; isFollowed: boolean; authEnabled: boolean;
  /** the panel's live-book order (the URL's `ls`, while this row is open) */
  liveSort: LiveSort;
  /** the /makers view as a query string (links carry it) */
  search: string;
  onToggleOpen: (id: string) => void;
  onToggleCompare: (id: string) => void;
  onToggleFollow: (key: string, label: string) => void;
  onLiveSort: (ls: LiveSort) => void;
  /** the lots body, scoped to this row */
  onSeeLots: (id: string) => void;
}

const EntityRow = React.memo(function EntityRow({
  r, soldMax, isOpen, cols, isSel, isFollowed, authEnabled, liveSort, search,
  onToggleOpen, onToggleCompare, onToggleFollow, onLiveSort, onSeeLots,
}: EntityRowProps) {
  countRender(r.id);
  // the panel mounts on first open and stays (so it can animate closed) —
  // thousands of rows must not each carry a hidden panel in the DOM
  const [opened, setOpened] = useState(isOpen);
  if (isOpen && !opened) setOpened(true);
  const cell = (k: ColKey): React.ReactNode => {
    switch (k) {
      case 'live': return (
        <span key={k} className="mk-cell mk-livecell" data-live={r.live > 0 || undefined}
          title={r.flags > 0 ? `${r.live.toLocaleString()} live · ${r.flags} flagged below comparables` : undefined}>
          {r.flags > 0 && <span className="mk-flagdot" aria-label={`${r.flags} flagged`} />}
          {r.live > 0 ? r.live.toLocaleString() : '—'}
        </span>
      );
      case 'median': return (
        <span key={k} className="mk-cell" title={medianTitle(r)}>
          {r.median ? <>{formatPrice(r.median)}{r.medianN ? <i className="mk-n">n {r.medianN.toLocaleString()}</i> : null}</> : <span className="mk-faint">—</span>}
        </span>
      );
      case 'sold12': return (
        <span key={k} className="mk-cell mk-faint" title={r.sold12Since ? `last ${r.sold12} sales, since ${r.sold12Since} — not a 12-month window` : undefined}>
          {r.sold12 > 0 ? (r.sold12Since ? `${r.sold12.toLocaleString()} since ${r.sold12Since}` : r.sold12.toLocaleString()) : '—'}
        </span>
      );
      case 'curve': return <span key={k} className="mk-cell mk-spark" aria-hidden>{r.spark ? <Spark values={r.spark} /> : <span className="mk-sparkgap" />}</span>;
      case 'yoy': return (
        <span key={k} className="mk-cell mk-delta" data-dir={r.yoy ? (r.yoy.pct >= 0 ? 'up' : 'down') : undefined}
          title={r.yoy ? `Year over year · ${r.yoy.basis === 'index' ? `repeat-sales index · n ${r.yoy.n.toLocaleString()}` : r.yoy.basis === 'matched' ? `same items, both years · ${r.yoy.n.toLocaleString()} matched` : `median sale · n ${r.yoy.n.toLocaleString()}`}` : 'No year-over-year read: too few of the same items sold in both years, and the two years\' volumes differ too much for a median to compare'}>
          {r.yoy ? fmtPct(r.yoy.pct) : '—'}
        </span>
      );
      case 'flags': return <span key={k} className="mk-cell mk-flags" data-hot={r.flags > 0 || undefined}>{r.flags > 0 ? r.flags.toLocaleString() : '—'}</span>;
      case 'sold': return (
        <span key={k} className="mk-cell mk-faint mk-soldcell">
          {r.sold != null && r.sold > 0 ? r.sold.toLocaleString() : '—'}
          {r.sold != null && r.sold > 0 && (
            <span className="mk-soldtrack" aria-hidden><span style={{ width: `${Math.max(3, Math.round((r.sold / soldMax) * 100))}%` }} /></span>
          )}
        </span>
      );
      case 'record': return <span key={k} className="mk-cell">{r.record ? fmtUsd(r.record.p) : '—'}</span>;
      case 'settled': return <span key={k} className="mk-cell mk-faint">{r.revenue > 0 ? fmtUsd(r.revenue) : '—'}</span>;
      case 'delta': return (
        <span key={k} className="mk-cell mk-delta" data-dir={r.verified ? r.verified.dir : undefined}>
          {r.verified ? fmtPct(r.verified.changePct) : '—'}
        </span>
      );
    }
  };
  return (
    <div className="mk-item" data-mk-flip={r.id} data-open={isOpen || undefined} data-sel={isSel || undefined}
      onKeyDown={e => { if (e.key === 'Escape' && isOpen) { e.preventDefault(); onToggleOpen(r.id); } }}>
      <div
        role="button" tabIndex={0} data-mk-row data-slug={r.id}
        className="mk-row" aria-expanded={isOpen}
        aria-label={`${r.label} — open the read`}
        onClick={() => onToggleOpen(r.id)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleOpen(r.id); } }}
      >
        <span className="mk-mono" aria-hidden>
          <span className="mk-mono-letter">{r.label.charAt(0)}</span>
          {r.hero && (
            <img src={sizedImg(httpsImg(r.hero), 120)} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async"
              onError={e => e.currentTarget.remove()} />
          )}
        </span>
        <span className="mk-id">
          <span className="mk-name">{r.label}</span>
          <span className="mk-tags">
            {r.tag && <span className="mk-tag">{r.tag}</span>}
            {r.verified && <span className="mk-tag mk-tag-verified" title={`CI-verified ${r.verified.horizon} move · 95% CI ${Math.round(r.verified.ciLoPct)}% to ${Math.round(r.verified.ciHiPct)}%`}>verified · {r.verified.horizon}</span>}
            {r.thin && r.kind !== 'rest' && <span className="mk-tag" title="Under 5 sales in the last 12 months — sorts below well-supported rows">thin</span>}
            {r.scoped && <span className="mk-tag" title="The search matched some of this row's live lots — the counts are those lots">matching lots</span>}
          </span>
        </span>
        {cols.map(cell)}
        <span className="mk-go" aria-hidden data-open={isOpen || undefined}><Flick size={10} /></span>
        <span className="mk-mob">
          <span className="mk-mob-live" data-live={r.live > 0 || undefined}>
            {r.flags > 0 && <span className="mk-flagdot" aria-label={`${r.flags} flagged`} />}
            {r.live > 0 ? <>{r.live.toLocaleString()}<i> live</i></> : <i>none live</i>}
          </span>
          <span className="mk-mob-sub">{r.median ? `median ${formatPrice(r.median)}` : r.sold12 > 0 ? `${r.sold12.toLocaleString()} sold 12 mo` : ''}</span>
        </span>
      </div>

      {/* hover actions — SIBLINGS of the row button (never nested interactive) */}
      <span className="mk-acts">
        {authEnabled && r.follow && (
          <button type="button" className="mk-act" data-on={isFollowed || undefined}
            aria-pressed={isFollowed} aria-label={isFollowed ? `Unfollow ${r.label}` : `Follow ${r.label}`}
            title={isFollowed ? 'Following — alerts on every new lot' : 'Follow — alerts on every new lot'}
            onClick={e => { e.stopPropagation(); onToggleFollow(r.follow!, r.label); }}>
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
              {isFollowed
                ? <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                : <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
            </svg>
          </button>
        )}
        {r.canCompare && (
          <button type="button" className="mk-act" data-on={isSel || undefined}
            aria-pressed={isSel} aria-label={isSel ? `Remove ${r.label} from compare` : `Compare ${r.label}`}
            title={isSel ? 'In compare — click to remove' : 'Add to compare (or press c on the row)'}
            onClick={e => { e.stopPropagation(); onToggleCompare(r.id); }}>
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="M1.5 12.5L6 6l3 3.5 3.5-6" />
              <path d="M1.5 9L5 4.5" opacity="0.45" />
            </svg>
          </button>
        )}
      </span>

      <div className="mkx">
        <div className="mkx-in">
          {opened && (
            <EntityPanel r={r} open={isOpen} liveSort={liveSort} search={search}
              isSel={isSel} isFollowed={isFollowed} authEnabled={authEnabled}
              onLiveSort={onLiveSort} onToggleCompare={onToggleCompare} onToggleFollow={onToggleFollow} onSeeLots={onSeeLots} />
          )}
        </div>
      </div>
    </div>
  );
});
export default EntityRow;
