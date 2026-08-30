'use client';

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { ARTISTS, MARKETS, marketArtists, marketOf, rosterNoun, type Market } from '../constants';
import { useMarket } from '../lib/market';
import { classifyForm, formsForMarket } from '../lib/comps';
import { isMisattributed } from '../lib/attribution';
import MarketSwitch from '../components/MarketSwitch';
import MarketIcon from '../components/MarketIcon';
import { useFullLots } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { useSavedSearches } from '../lib/alerts';
import { useAuth } from '../lib/account';
import ArtistNav from '../components/ArtistNav';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import { formatDate, formatPrice, getUpcomingCounts, craftTitle, httpsImg, localToday, isLiveUpcoming } from '../utils';
import { formatEstimate } from '../components/LotCard';
import { formatDemand } from '../lib/demand';
import { verifiedMovers, type VerifiedMover } from '../preview/terminal/verified';
import { CellGrid, Cell, ColorCell, FigureCell, FigCalib, FigGate, FigPools } from '../components/cells';
import CountUp from '../components/CountUp';
import CloseClock from '../components/CloseClock';
import Masthead, { Accent } from '../components/Masthead';
import { Colophon } from '../components/Terminal';
import Flick from '../components/Flick';
import type { AuctionLot, MarketStats } from '../types';

/**
 * Makers — THE DIRECTORY, trading grade (Aug 2026, pass 3). The ledger of
 * every tracked name is now a value surface: rows carry the engine's live
 * flag count, dossiers carry the maker's closing-soonest live lots, compare
 * mode overlays up to four makers' rebased curves, a Display menu chooses
 * the columns, follows ride the saved-search plumbing, and ?open= deep-
 * links a dossier. ENTIRELY PHASE-1 — nothing waits for the corpus.
 */

/* ── THE LABEL SYSTEM — curated disciplines + measured states ── */
const DISCIPLINE: Record<string, string> = {
  'george-condo': 'Contemporary painting',
  'futura-2000': 'Street art',
  'kaws': 'Street & pop',
  'andy-warhol': 'Pop art',
  'tom-sachs': 'Sculpture & bricolage',
  'barry-mcgee': 'Street art',
  'keith-haring': 'Pop & street',
  'peter-saul': 'Pop surrealism',
  'ed-ruscha': 'Pop & conceptual',
  'r-crumb': 'Underground comix',
  'raymond-pettibon': 'Drawing',
  'henri-matisse': 'Modern master',
  'pablo-picasso': 'Modern master',
  'fab-5-freddy': 'Street art',
  'francesco-clemente': 'Neo-expressionism',
  'eddie-martinez': 'Contemporary painting',
  'kenny-scharf': 'Street & pop',
  'jean-michel-basquiat': 'Neo-expressionism',
  'roy-lichtenstein': 'Pop art',
  'francis-bacon': 'Figurative master',
  'alexander-calder': 'Sculpture & mobiles',
  'rashid-johnson': 'Contemporary',
  'jeff-koons': 'Sculpture & editions',
  'george-nakashima': 'Studio furniture',
  'charles-eames': 'Mid-century modern',
  'jean-prouve': 'Modernist metalwork',
  'pierre-jeanneret': 'Chandigarh modernism',
  'rolex': 'Watchmaker',
  'patek-philippe': 'Watchmaker',
  'audemars-piguet': 'Watchmaker',
  'omega': 'Watchmaker',
  'cartier': 'Watchmaker & jeweler',
  'meteorites': 'Natural history',
  'fossils': 'Natural history',
  'space-exploration': 'Space history',
  'scientific-instruments': 'Instruments',
  'science-tech': 'Technology',
};
const BID_MARKETS = new Set<Market>(['sports', 'tcg']);

interface Row {
  slug: string; label: string; market: Market;
  discipline: string | null;
  stats: MarketStats | null;
  /** a real photo of the maker's flagship lot — the category's face */
  hero: string | null;
  spark: number[] | null;
  live: number;
  flags: number;
  sold: number | null;
  median: number | null;
  revenue: number;
  velocity: number;
  record: number | null;
  verified: VerifiedMover | null;
  thin: boolean;
  /** measured momentum: consecutive rising quarterly medians (≥3 prints) */
  rising: number;
  /** the record hammered inside the last 12 months */
  recordFresh: string | null;
  liveLots: AuctionLot[];
}

type SortKey = 'sold' | 'live' | 'flags' | 'median' | 'delta' | 'name';
const SORTS: { k: SortKey; label: string }[] = [
  { k: 'sold', label: 'Sold' },
  { k: 'live', label: 'Live' },
  { k: 'flags', label: 'Flags' },
  { k: 'median', label: 'Median' },
  { k: 'delta', label: 'Verified Δ' },
  { k: 'name', label: 'A–Z' },
];

/* ── THE DISPLAY MENU — Linear's signature: choose the properties ── */
type ColKey = 'curve' | 'median' | 'delta' | 'flags' | 'live' | 'sold' | 'record' | 'settled' | 'velocity';
const COLS: { k: ColKey; label: string; width: string }[] = [
  { k: 'curve', label: '12q curve', width: '96px' },
  { k: 'median', label: 'Median · 12mo', width: '104px' },
  { k: 'delta', label: 'Verified Δ', width: '84px' },
  { k: 'flags', label: 'Flags', width: '56px' },
  { k: 'live', label: 'Live', width: '60px' },
  { k: 'sold', label: 'Sold', width: '84px' },
  { k: 'record', label: 'Record', width: '84px' },
  { k: 'settled', label: 'Settled $', width: '84px' },
  { k: 'velocity', label: '12mo sold', width: '76px' },
];
const DEFAULT_COLS: ColKey[] = ['curve', 'median', 'delta', 'flags', 'live', 'sold'];

const fmtUsd = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B`
  : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M`
  : n >= 1e4 ? `$${Math.round(n / 1e3)}K`
  : `$${Math.round(n).toLocaleString()}`;

function Spark({ values }: { values: number[] }) {
  const w = 90, h = 22;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const px = (i: number) => (i / (values.length - 1)) * (w - 6) + 2;
  const py = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  const pts = values.map((v, i) => `${px(i)},${py(v)}`).join(' ');
  return (
    <svg width={w} height={h} aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--lw-5, rgba(255, 255, 255, 0.5))" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={px(values.length - 1)} cy={py(values[values.length - 1])} r="2" fill="var(--color-fg)" />
    </svg>
  );
}

/* ── THE DOSSIER CHART — line stretches; tick text is HTML, never distorts ── */
function DossierChart({ hist }: { hist: MarketStats['priceHistory'] }) {
  const pts = hist.filter(p => (p.medianPrice || p.avgPrice) > 0);
  if (pts.length < 4) return null;
  const vals = pts.map(p => p.medianPrice || p.avgPrice);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const xPct = (i: number) => (i / (pts.length - 1)) * 100;
  const yPct = (v: number) => (1 - (v - min) / span) * 100;
  const line = vals.map((v, i) => `${xPct(i)},${yPct(v)}`).join(' ');
  const yTicks = [min, min + span / 2, max];
  const years: { i: number; y: string }[] = [];
  pts.forEach((p, i) => {
    const y = String(p.date).slice(0, 4);
    if (!years.length || years[years.length - 1].y !== y) years.push({ i, y });
  });
  const step = Math.ceil(years.length / 6);
  const shownYears = years.filter((_, k) => k % step === 0);
  return (
    <div className="mkx-chart" aria-label="Quarterly median sale price">
      <div className="mkx-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {yTicks.map((t, k) => (
            <line key={k} x1="0" y1={yPct(t)} x2="100" y2={yPct(t)} stroke="var(--lw-07, rgba(255, 255, 255, 0.07))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <polyline points={line} fill="none" stroke="var(--lw-7, rgba(255, 255, 255, 0.7))" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="mkx-dot" style={{ left: '100%', top: `${yPct(vals[vals.length - 1])}%` }} aria-hidden />
        {yTicks.map((t, k) => (
          <span key={k} className="mkx-tick mkx-tick-y" style={{ top: `${yPct(t)}%` }}>{fmtUsd(t)}</span>
        ))}
        {shownYears.map(({ i, y }) => (
          <span key={y} className="mkx-tick mkx-tick-x" style={{ left: `${xPct(i)}%` }}>{y}</span>
        ))}
      </div>
    </div>
  );
}

function CIWhisker({ v }: { v: VerifiedMover }) {
  const lo = v.ciLoPct, hi = v.ciHiPct, pt = v.changePct;
  const dLo = Math.min(lo, 0) - Math.abs(hi - lo) * 0.08;
  const dHi = Math.max(hi, 0) + Math.abs(hi - lo) * 0.08;
  const x = (val: number) => ((val - dLo) / (dHi - dLo || 1)) * 100;
  return (
    <svg viewBox="0 0 100 16" className="mkx-ci" preserveAspectRatio="none" aria-hidden>
      {dLo < 0 && dHi > 0 && <line x1={x(0)} y1="0" x2={x(0)} y2="16" stroke="var(--lw-18, rgba(255, 255, 255, 0.18))" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
      <line x1={x(lo)} y1="8" x2={x(hi)} y2="8" stroke="var(--lw-5, rgba(255, 255, 255, 0.5))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1={x(lo)} y1="4" x2={x(lo)} y2="12" stroke="var(--lw-5, rgba(255, 255, 255, 0.5))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1={x(hi)} y1="4" x2={x(hi)} y2="12" stroke="var(--lw-5, rgba(255, 255, 255, 0.5))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <circle cx={x(pt)} cy="8" r="2.4" fill={pt >= 0 ? 'var(--color-up)' : 'var(--color-down-text)'} />
    </svg>
  );
}

/* ── COMPARE — up to four makers' last-12q medians rebased onto one axis.
   Monochrome differentiation by LINE STYLE (solid/dashed/dotted/dash-dot):
   mint & coral stay reserved for each maker's own signed Δ. ── */
const DASHES = ['', '7 5', '2 4', '9 3 2 3'];
const STROKES = ['var(--lw-92, rgba(255, 255, 255, 0.92))', 'var(--lw-72, rgba(255, 255, 255, 0.72))', 'var(--lw-55, rgba(255, 255, 255, 0.55))', 'var(--lw-4, rgba(255, 255, 255, 0.4))'];
function CompareTray({ sel, rows, onRemove, onClear }: {
  sel: string[];
  rows: Row[];
  onRemove: (slug: string) => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const picked = sel.map(s => rows.find(r => r.slug === s)).filter((r): r is Row => !!r);
  // shared date domain: the union of each maker's last-12q dates
  const series = picked.map(r => {
    const pts = (r.stats?.priceHistory || []).slice(-12)
      .map(p => ({ d: String(p.date), v: p.medianPrice || p.avgPrice }))
      .filter(p => p.v > 0);
    const base = pts.length ? pts[0].v : 0;
    return { r, pts: base > 0 ? pts.map(p => ({ d: p.d, v: (p.v / base - 1) * 100 })) : [] };
  }).filter(s => s.pts.length >= 4);
  // a picked maker with <4 quarters is dropped from `series` — so the bar
  // chip's swatch MUST index by series position (via this map), not by
  // picked position, or every maker after the dropped one gets a swatch
  // that mismatches its plotted line.
  const seriesIdx = new Map(series.map((s, i) => [s.r.slug, i]));
  const dates = Array.from(new Set(series.flatMap(s => s.pts.map(p => p.d)))).sort();
  const vals = series.flatMap(s => s.pts.map(p => p.v));
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const span = max - min || 1;
  const xPct = (d: string) => dates.length > 1 ? (dates.indexOf(d) / (dates.length - 1)) * 100 : 50;
  const yPct = (v: number) => (1 - (v - min) / span) * 100;
  return (
    <div className="mkc" role="region" aria-label="Compare makers">
      <div className="rail mkc-bar">
        <span className="mkc-title">Compare</span>
        {picked.map(r => {
          const si = seriesIdx.get(r.slug);
          return (
            <span key={r.slug} className="mkc-chip" data-thin={si == null || undefined}>
              <svg width="16" height="8" aria-hidden>
                <line x1="1" y1="4" x2="15" y2="4" strokeWidth="1.6"
                  stroke={si != null ? STROKES[si] : 'var(--lw-28, rgba(255, 255, 255, 0.28))'}
                  strokeDasharray={si != null ? (DASHES[si] || undefined) : '2 2'} />
              </svg>
              {r.label}
              {si == null && <span className="mkc-chip-thin" title="not enough history to plot">thin</span>}
              <button type="button" onClick={() => onRemove(r.slug)} aria-label={`Remove ${r.label} from compare`}>×</button>
            </span>
          );
        })}
        <span className="mkc-rule" aria-hidden />
        <button type="button" className="mkc-btn" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
          {expanded ? 'Collapse' : 'Expand'}
        </button>
        <button type="button" className="mkc-btn" onClick={onClear}>Clear</button>
      </div>
      {expanded && (
        <div className="rail mkc-body">
          {series.length >= 2 ? (
            <>
              <div className="mkc-plotwrap">
                <div className="mkc-plot">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                    <line x1="0" y1={yPct(0)} x2="100" y2={yPct(0)} stroke="var(--lw-16, rgba(255, 255, 255, 0.16))" strokeWidth="1" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
                    {series.map((s, i) => (
                      <polyline key={s.r.slug}
                        points={s.pts.map(p => `${xPct(p.d)},${yPct(p.v)}`).join(' ')}
                        fill="none" stroke={STROKES[i]} strokeWidth="1.6"
                        strokeDasharray={DASHES[i] || undefined}
                        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    ))}
                  </svg>
                  <span className="mkx-tick mkx-tick-y" style={{ top: `${yPct(max)}%` }}>{`${max >= 0 ? '+' : ''}${Math.round(max)}%`}</span>
                  <span className="mkx-tick mkx-tick-y" style={{ top: `${yPct(0)}%` }}>0%</span>
                  <span className="mkx-tick mkx-tick-y" style={{ top: `${yPct(min)}%` }}>{`${min >= 0 ? '+' : ''}${Math.round(min)}%`}</span>
                </div>
                <div className="mkc-cap kicker">Δ% from each maker&rsquo;s own 12-quarter start · quarterly medians</div>
              </div>
              <div className="mkc-legend">
                {series.map((s, i) => {
                  const end = s.pts[s.pts.length - 1].v;
                  return (
                    <div key={s.r.slug} className="mkc-leg">
                      <svg width="18" height="8" aria-hidden><line x1="1" y1="4" x2="17" y2="4" stroke={STROKES[i]} strokeWidth="1.6" strokeDasharray={DASHES[i] || undefined} /></svg>
                      <span className="mkc-leg-name">{s.r.label}</span>
                      <b data-dir={end >= 0 ? 'up' : 'down'}>{end >= 0 ? '+' : '−'}{Math.abs(Math.round(end))}%</b>
                      <span className="mkc-leg-sub">
                        {s.r.median ? `med ${formatPrice(s.r.median)}` : ''}
                        {s.r.record ? ` · rec ${fmtUsd(s.r.record)}` : ''}
                        {s.r.sold != null ? ` · ${s.r.sold.toLocaleString()} sold` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="mkc-note">Pick {2 - series.length} more maker{2 - series.length === 1 ? '' : 's'} with enough history — hover a row and hit the compare mark, or press <kbd>c</kbd> on a focused row.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── ONE ROW (memoized — 54 dossiers must not re-render per keystroke) ── */
const MakerRowItem = React.memo(function MakerRowItem({
  r, soldMax, isOpen, cols, isSel, isFollowed, authEnabled,
  onToggleOpen, onToggleCompare, onToggleFollow,
}: {
  r: Row; soldMax: number; isOpen: boolean; cols: ColKey[];
  isSel: boolean; isFollowed: boolean; authEnabled: boolean;
  onToggleOpen: (slug: string) => void;
  onToggleCompare: (slug: string) => void;
  onToggleFollow: (slug: string, label: string) => void;
}) {
  const cell = (k: ColKey): React.ReactNode => {
    switch (k) {
      case 'curve': return <span key={k} className="mk-cell mk-spark" aria-hidden>{r.spark ? <Spark values={r.spark} /> : <span className="mk-sparkgap" />}</span>;
      case 'median': return <span key={k} className="mk-cell">{r.median ? formatPrice(r.median) : '—'}</span>;
      case 'delta': return (
        <span key={k} className="mk-cell mk-delta" data-dir={r.verified ? r.verified.dir : undefined}>
          {r.verified ? `${r.verified.changePct >= 0 ? '+' : '−'}${Math.abs(Math.round(r.verified.changePct))}%` : '—'}
        </span>
      );
      case 'flags': return <span key={k} className="mk-cell mk-flags" data-hot={r.flags > 0 || undefined}>{r.flags > 0 ? r.flags.toLocaleString() : '—'}</span>;
      case 'live': return <span key={k} className="mk-cell" data-live={r.live > 0 || undefined}>{r.live > 0 ? r.live.toLocaleString() : '—'}</span>;
      case 'sold': return (
        <span key={k} className="mk-cell mk-faint mk-soldcell">
          {r.sold != null ? r.sold.toLocaleString() : '—'}
          {r.sold != null && r.sold > 0 && (
            <span className="mk-soldtrack" aria-hidden><span style={{ width: `${Math.max(3, Math.round((r.sold / soldMax) * 100))}%` }} /></span>
          )}
        </span>
      );
      case 'record': return <span key={k} className="mk-cell">{r.record ? fmtUsd(r.record) : '—'}</span>;
      case 'settled': return <span key={k} className="mk-cell mk-faint">{r.revenue > 0 ? fmtUsd(r.revenue) : '—'}</span>;
      case 'velocity': return <span key={k} className="mk-cell mk-faint">{r.velocity > 0 ? r.velocity.toLocaleString() : '—'}</span>;
    }
  };
  return (
    <div
      className="mk-item" data-mk-flip={r.slug} data-open={isOpen || undefined} data-sel={isSel || undefined}
      onKeyDown={e => {
        if (e.key === 'Escape' && isOpen) { e.preventDefault(); onToggleOpen(r.slug); }
      }}
    >
      <div
        role="button" tabIndex={0} data-mk-row data-slug={r.slug}
        className="mk-row"
        aria-expanded={isOpen}
        aria-label={`${r.label} — open the maker's read`}
        onClick={() => onToggleOpen(r.slug)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleOpen(r.slug); }
        }}
      >
        <span className="mk-mono" aria-hidden>
          <span className="mk-mono-letter">{r.label.charAt(0)}</span>
          {r.hero && (
            <img src={httpsImg(r.hero)} alt="" referrerPolicy="no-referrer" loading="lazy"
              onError={e => e.currentTarget.remove()} />
          )}
        </span>
        <span className="mk-id">
          <span className="mk-name">{r.label}</span>
          <span className="mk-tags">
            {r.discipline && <span className="mk-tag">{r.discipline}</span>}
            {BID_MARKETS.has(r.market) && <span className="mk-tag">bid market</span>}
            {r.verified && <span className="mk-tag mk-tag-verified" title={`CI-verified ${r.verified.horizon} move · 95% CI ${Math.round(r.verified.ciLoPct)}% to ${Math.round(r.verified.ciHiPct)}%`}>verified · {r.verified.horizon}</span>}
            {r.recordFresh && <span className="mk-tag mk-tag-verified">record · {r.recordFresh}</span>}
            {r.rising >= 3 && <span className="mk-tag" title={`${r.rising} consecutive quarters of rising median sale`}>{r.rising}q rising</span>}
            {r.thin && <span className="mk-tag">thin history</span>}
          </span>
        </span>
        {cols.map(cell)}
        <span className="mk-go" aria-hidden data-open={isOpen || undefined}><Flick size={10} /></span>
        <span className="mk-mob">
          <span className="mk-mob-median">{r.median ? formatPrice(r.median) : r.live > 0 ? `${r.live} live` : '—'}</span>
          <span className="mk-mob-sub" data-dir={r.verified ? r.verified.dir : undefined}>
            {r.flags > 0 ? `${r.flags} flagged · ` : ''}
            {r.verified ? `${r.verified.changePct >= 0 ? '+' : '−'}${Math.abs(Math.round(r.verified.changePct))}% · ${r.verified.horizon}` : r.sold != null ? `${r.sold.toLocaleString()} sold` : ''}
          </span>
        </span>
      </div>

      {/* hover actions — SIBLINGS of the row button (never nested interactive) */}
      <span className="mk-acts">
        {authEnabled && (
          <button
            type="button" className="mk-act" data-on={isFollowed || undefined}
            aria-pressed={isFollowed} aria-label={isFollowed ? `Unfollow ${r.label}` : `Follow ${r.label}`}
            title={isFollowed ? 'Following — alerts on every new lot' : 'Follow — alerts on every new lot'}
            onClick={e => { e.stopPropagation(); onToggleFollow(r.slug, r.label); }}
          >
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
              {isFollowed
                ? <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                : <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
            </svg>
          </button>
        )}
        <button
          type="button" className="mk-act" data-on={isSel || undefined}
          aria-pressed={isSel} aria-label={isSel ? `Remove ${r.label} from compare` : `Compare ${r.label}`}
          title={isSel ? 'In compare — click to remove' : 'Add to compare (or press c on the row)'}
          onClick={e => { e.stopPropagation(); onToggleCompare(r.slug); }}
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
            <path d="M1.5 12.5L6 6l3 3.5 3.5-6" />
            <path d="M1.5 9L5 4.5" opacity="0.45" />
          </svg>
        </button>
      </span>

      {/* ── THE DOSSIER ── */}
      <div className="mkx">
        <div className="mkx-in">
          {r.hero && (
            <div className="mkx-hero" aria-hidden>
              <img src={httpsImg(r.hero)} alt="" referrerPolicy="no-referrer" loading="lazy"
                onError={e => e.currentTarget.closest('.mkx-hero')?.remove()} />
              <span className="mkx-hero-cap">{r.label}{r.discipline ? ` · ${r.discipline}` : ''}</span>
            </div>
          )}
          {r.stats?.priceHistory && r.stats.priceHistory.length >= 4 ? (
            <div className="mkx-chartwrap">
              <div className="mkx-chart-cap kicker">Quarterly median sale · full tracked history</div>
              <DossierChart hist={r.stats.priceHistory} />
            </div>
          ) : (
            <div className="mkx-none ns-well"><span className="ns-well-body">Not enough sold history for a curve yet — the ledger fills as {r.label} lots settle.</span></div>
          )}
          <div className="mkx-grid">
            <div>
              <span className="kicker">The record</span>
              {r.stats?.recordPrice ? (
                <p><b>{formatPrice(r.stats.recordPrice)}</b>{r.stats.recordTitle ? <> · {r.stats.recordTitle.length > 44 ? `${r.stats.recordTitle.slice(0, 44)}…` : r.stats.recordTitle}</> : null}{r.stats.recordHouse ? <> · {r.stats.recordHouse}</> : null}{r.stats.recordDate ? <> · {formatDate(r.stats.recordDate)}</> : null}</p>
              ) : <p>—</p>}
            </div>
            <div>
              <span className="kicker">The book</span>
              <p>
                {r.sold != null && <><b>{r.sold.toLocaleString()}</b> sold tracked</>}
                {r.revenue > 0 && <> · <b>{fmtUsd(r.revenue)}</b> settled</>}
                {r.velocity > 0 && <> · {r.velocity.toLocaleString()} in 12mo</>}
              </p>
            </div>
            {(r.stats?.houseDistribution?.length ?? 0) > 0 && (
              <div>
                <span className="kicker">The houses</span>
                <div className="mkx-houses">
                  {(r.stats!.houseDistribution.slice().sort((a, b) => b.count - a.count).slice(0, 3)).map((h, _, arr) => (
                    <div key={h.house} className="mkx-house">
                      <span className="mkx-house-name">{h.house}</span>
                      <span className="mkx-house-track" aria-hidden><span style={{ width: `${Math.round((h.count / Math.max(1, arr[0].count)) * 100)}%` }} /></span>
                      <span className="mkx-house-n">{h.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {r.verified && (
              <div>
                <span className="kicker">Verified move · {r.verified.horizon}</span>
                <div className="mkx-verified">
                  <b data-dir={r.verified.dir}>{r.verified.changePct >= 0 ? '+' : '−'}{Math.abs(Math.round(r.verified.changePct))}%</b>
                  <CIWhisker v={r.verified} />
                  <span className="mkx-ci-ends">95% CI {Math.round(r.verified.ciLoPct)}% to {Math.round(r.verified.ciHiPct)}% · n {r.verified.n.toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>

          {/* THE LIVE BOOK — the maker's closing-soonest lots, in place */}
          {r.liveLots.length > 0 && (
            <div className="mkx-live">
              <div className="mkx-live-head kicker">
                On the block · {r.live.toLocaleString()} live{r.flags > 0 ? <> · <b className="mkx-live-flagn">{r.flags} flagged by the engine</b></> : null}
              </div>
              {r.liveLots.slice(0, 3).map(l => {
                const closeSoon = l.saleDateTime && (Date.parse(l.saleDateTime) - Date.now()) < 24 * 3600e3 && Date.parse(l.saleDateTime) > Date.now();
                return (
                  <Link key={l.id} href={`/lot/${l.id}`} className="mkx-lot">
                    <span className="mkx-lot-thumb" aria-hidden>
                      <span className="mkx-lot-letter">{r.label.charAt(0)}</span>
                      {l.imageUrl && (
                        <img src={httpsImg(l.imageUrl)} alt="" referrerPolicy="no-referrer" loading="lazy"
                          onError={e => e.currentTarget.remove()} />
                      )}
                    </span>
                    <span className="mkx-lot-main">
                      <span className="mkx-lot-title">{craftTitle(l.title)}</span>
                      <span className="mkx-lot-sub">
                        {l.auctionHouse}
                        {l.signal?.label === 'Below Market' && <span className="mkx-lot-flag"> · flagged below market</span>}
                      </span>
                    </span>
                    <span className="mkx-lot-cells">
                      <span className="mkx-lot-est">{formatEstimate(l)}</span>
                      <span className="mkx-lot-close">
                        {closeSoon
                          ? <span style={{ color: 'var(--color-up)', fontWeight: 600 }}><CloseClock iso={l.saleDateTime!} windowHours={24} /></span>
                          : <>closes {formatDate(l.saleDate)}</>}
                      </span>
                    </span>
                  </Link>
                );
              })}
              {r.live > 3 && (
                <Link href={`/makers/${r.slug}`} className="mkx-live-more">
                  +{(r.live - 3).toLocaleString()} more on the block <Flick size={9} style={{ marginLeft: 4 }} />
                </Link>
              )}
            </div>
          )}

          <div className="mkx-actions">
            <Link href={`/makers/${r.slug}`} className="ray-call-btn ray-call-btn-primary">
              Open the dossier
            </Link>
            <button type="button" className="mk-chip" data-on={isSel || undefined} onClick={() => onToggleCompare(r.slug)}>
              {isSel ? 'In compare' : 'Add to compare'}
            </button>
            {authEnabled && (
              <button type="button" className="mk-chip" data-on={isFollowed || undefined} onClick={() => onToggleFollow(r.slug, r.label)}>
                {isFollowed ? 'Following' : 'Follow'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default function MakersPage() {
  // useFullLots triggers the corpus in the BACKGROUND: every figure still
  // paints from phase 1 (stats/eager upcoming) instantly, but the maker
  // photos — drawn from real lot images — fill in for makers with no live
  // lot as the sold history lands. An image appearing is decorative
  // progressive enhancement, never a figure that could mislead.
  const { allLots, statsByArtist, lastCrawl, loading, fromCache, market: marketData, demand } = useFullLots();
  const { market } = useMarket();
  const activeKey = MARKETS.find(m => m.key === market)?.live ? market : 'all';
  const activeLabel = activeKey === 'all' ? 'full' : activeKey === 'tcg' ? 'TCG' : MARKETS.find(m => m.key === activeKey)!.label.toLowerCase();
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const rosterCount = useMemo(() => ARTISTS.filter(a => mktSet.has(a.slug)).length, [mktSet]);
  const { savedIds } = useSavedLots();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);
  const noun = activeKey === 'all' ? (rosterCount === 1 ? 'tracked name' : 'tracked names') : rosterNoun(activeKey, rosterCount);

  // follows ride the saved-search plumbing (FollowButton's exact semantics)
  const { authEnabled, user, openLogin } = useAuth();
  const { searches, save: saveSearch, remove: removeSearch } = useSavedSearches();
  const followedSet = useMemo(() => {
    const s = new Set<string>();
    for (const sr of searches) {
      const p = (sr.query as { player?: string }).player;
      if (p) s.add(p);
    }
    return s;
  }, [searches]);

  // ── controls — restored from the URL, written back (owned keys only) ──
  const [q, setQ] = useState('');
  const [fLive, setFLive] = useState(false);
  const [fVerified, setFVerified] = useState(false);
  const [fFlagged, setFFlagged] = useState(false);
  const [fFollowing, setFFollowing] = useState(false);
  const [sort, setSort] = useState<SortKey>('sold');
  const [cols, setCols] = useState<ColKey[]>(DEFAULT_COLS);
  const [open, setOpen] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [showDisplay, setShowDisplay] = useState(false);
  const deepLinked = useRef(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('q')) setQ(p.get('q')!);
    if (p.get('on') === '1') setFLive(true);
    if (p.get('vi') === '1') setFVerified(true);
    if (p.get('fl') === '1') setFFlagged(true);
    if (p.get('fw') === '1') setFFollowing(true);
    const s = p.get('sort') as SortKey | null;
    if (s && SORTS.some(x => x.k === s)) setSort(s);
    const c = p.get('cols');
    if (c) {
      const parsed = c.split('.').filter((k): k is ColKey => COLS.some(x => x.k === k));
      if (parsed.length) setCols(parsed);
    }
    const o = p.get('open');
    if (o && ARTISTS.some(a => a.slug === o)) { setOpen(o); deepLinked.current = true; }
  }, []);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    ['q', 'on', 'vi', 'fl', 'fw', 'sort', 'cols', 'open'].forEach(k => p.delete(k));
    if (q.trim()) p.set('q', q.trim());
    if (fLive) p.set('on', '1');
    if (fVerified) p.set('vi', '1');
    if (fFlagged) p.set('fl', '1');
    if (fFollowing) p.set('fw', '1');
    if (sort !== 'sold') p.set('sort', sort);
    if (cols.join('.') !== DEFAULT_COLS.join('.')) p.set('cols', cols.join('.'));
    if (open) p.set('open', open);
    const qs = p.toString();
    try {
      window.history.replaceState(window.history.state, '', `${qs ? `?${qs}` : window.location.pathname}${window.location.hash}`);
    } catch { /* ignore */ }
  }, [q, fLive, fVerified, fFlagged, fFollowing, sort, cols, open]);

  const searchRef = useRef<HTMLInputElement | null>(null);

  const verifiedBySlug = useMemo(() => {
    const m = new Map<string, VerifiedMover>();
    if (marketData) for (const v of verifiedMovers(marketData)) m.set(v.slug, v);
    return m;
  }, [marketData]);

  // ── THE FACE — a real photo per maker, drawn from their own lots: the
  // single highest-value photographed work (its flagship, most likely the
  // record). A real Rolex for Rolex, a real Basquiat for Basquiat — sourced
  // from the auction inventory we already display, so it never breaks and is
  // always genuinely that maker's work. ──
  const heroBySlug = useMemo(() => {
    const best = new Map<string, { url: string; val: number }>();
    for (const l of allLots) {
      if (!l.imageUrl) continue;
      // the shared attribution guard drops cars in art pools + name-collision
      // lots (the same guard the pipeline scrubs the corpus with — once the
      // rebuild lands these are gone from the corpus, but this keeps the face
      // clean on the current shards too). Plus a form gate so the photo is a
      // real in-market work, never an uncategorized oddity.
      if (isMisattributed(l.artist, l.title || '')) continue;
      const forms = formsForMarket(marketOf(l.artist));
      if (forms) {
        const f = classifyForm(l);
        if (f === 'unknown' || !forms.has(f)) continue;
      }
      const val = l.priceUsd || l.currentBid || l.estimateHigh || l.estimateLow || 0;
      const cur = best.get(l.artist);
      if (!cur || val > cur.val) best.set(l.artist, { url: l.imageUrl, val });
    }
    return best;
  }, [allLots]);

  // ── THE LIVE BOOK + THE ENGINE'S READ, one pass over the eager set ──
  const liveBySlug = useMemo(() => {
    const m = new Map<string, { lots: AuctionLot[]; flags: number }>();
    const today = localToday();
    for (const l of allLots) {
      if (!isLiveUpcoming(l, today)) continue;
      let e = m.get(l.artist);
      if (!e) m.set(l.artist, e = { lots: [], flags: 0 });
      e.lots.push(l);
      if (l.signal?.label === 'Below Market') e.flags++;
    }
    m.forEach(e => {
      e.lots.sort((a, b) => (a.saleDateTime || `${a.saleDate}T99`).localeCompare(b.saleDateTime || `${b.saleDate}T99`));
    });
    return m;
  }, [allLots]);

  const rows = useMemo<Row[]>(() => ARTISTS.map(a => {
    const st = statsByArtist[a.slug] || null;
    const hist = st?.priceHistory || [];
    const sparkVals = hist.slice(-12).map(p => p.medianPrice || p.avgPrice).filter(v => v > 0);
    const sold = st?.totalSoldTracked ?? null;
    const liveE = liveBySlug.get(a.slug);
    // momentum: consecutive rising quarterly medians at the tail
    let rising = 0;
    const meds = hist.map(p => p.medianPrice || p.avgPrice).filter(v => v > 0);
    for (let i = meds.length - 1; i > 0 && meds[i] > meds[i - 1]; i--) rising++;
    const recDate = st?.recordDate ? Date.parse(String(st.recordDate)) : NaN;
    const recordFresh = !isNaN(recDate) && (Date.now() - recDate) < 365 * 86400e3
      ? String(st!.recordDate).slice(0, 4) : null;
    return {
      slug: a.slug, label: a.label, market: a.market as Market,
      discipline: DISCIPLINE[a.slug] || null,
      stats: st,
      hero: heroBySlug.get(a.slug)?.url || null,
      spark: sparkVals.length >= 4 ? sparkVals : null,
      live: liveE?.lots.length || 0,
      flags: liveE?.flags || 0,
      sold,
      median: st?.medianPriceLast12Months || null,
      revenue: st?.totalAuctionRevenue || 0,
      velocity: st ? st.priceHistory.slice(-4).reduce((s, p) => s + (p.totalSales || 0), 0) : 0,
      record: st?.recordPrice || null,
      verified: verifiedBySlug.get(a.slug) || null,
      thin: sold != null && sold > 0 && sold < 50,
      rising,
      recordFresh,
      liveLots: liveE?.lots || [],
    };
  }), [statsByArtist, heroBySlug, liveBySlug, verifiedBySlug]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const cmp = (a: Row, b: Row): number => {
      switch (sort) {
        case 'live': return b.live - a.live || (b.sold ?? 0) - (a.sold ?? 0);
        case 'flags': return b.flags - a.flags || b.live - a.live;
        case 'median': return (b.median ?? -1) - (a.median ?? -1);
        case 'delta': return (b.verified?.changePct ?? -Infinity) - (a.verified?.changePct ?? -Infinity);
        case 'name': return a.label.localeCompare(b.label);
        default: return (b.sold ?? 0) - (a.sold ?? 0);
      }
    };
    return rows
      .filter(r => mktSet.has(r.slug))
      .filter(r => !needle || r.label.toLowerCase().includes(needle) || (r.discipline ?? '').toLowerCase().includes(needle))
      .filter(r => !fLive || r.live > 0)
      .filter(r => !fVerified || !!r.verified)
      .filter(r => !fFlagged || r.flags > 0)
      .filter(r => !fFollowing || followedSet.has(r.slug))
      .sort(cmp);
  }, [rows, mktSet, q, fLive, fVerified, fFlagged, fFollowing, followedSet, sort]);

  const groups = useMemo(() =>
    MARKETS
      .filter(m => m.key !== 'all' && (activeKey === 'all' || m.key === activeKey))
      .map(m => {
        const g = visible.filter(r => r.market === m.key);
        const live = g.reduce((s, r) => s + r.live, 0);
        const flags = g.reduce((s, r) => s + r.flags, 0);
        const revenue = g.reduce((s, r) => s + r.revenue, 0);
        const soldMax = Math.max(1, ...rows.filter(r => r.market === m.key).map(r => r.sold ?? 0));
        const ds = demand?.[m.key] || [];
        const demandNow = ds.length ? ds[ds.length - 1].value : null;
        return { key: m.key as Market, label: m.label, rows: g, live, flags, revenue, soldMax, demandNow };
      })
      .filter(g => g.rows.length > 0),
    [visible, rows, activeKey, demand]);

  const cockpit = useMemo(() =>
    MARKETS
      .filter(m => m.key !== 'all' && (activeKey === 'all' || m.key === activeKey))
      .map(m => {
        const g = rows.filter(r => r.market === m.key);
        const ds = demand?.[m.key] || [];
        return {
          key: m.key as Market, label: m.label,
          makers: g.length,
          live: g.reduce((s, r) => s + r.live, 0),
          flags: g.reduce((s, r) => s + r.flags, 0),
          demandNow: ds.length ? ds[ds.length - 1].value : null,
        };
      }),
    [rows, activeKey, demand]);

  const totalLive = useMemo(() => rows.filter(r => mktSet.has(r.slug)).reduce((s, r) => s + r.live, 0), [rows, mktSet]);
  const totalFlags = useMemo(() => rows.filter(r => mktSet.has(r.slug)).reduce((s, r) => s + r.flags, 0), [rows, mktSet]);
  const verifiedCount = useMemo(() => rows.filter(r => mktSet.has(r.slug) && r.verified).length, [rows, mktSet]);

  // ── THE VERIFIED READ — the strongest CI-verified maker move currently
  // published on the active book: largest |Δ| among the same verifiedMovers
  // rows the ledger already prints (no re-derivation). LAMP LAW: the color
  // cell's dir comes from the REAL sign of the published changePct — a zero
  // (unpublishable by construction, guarded anyway) falls to ink. ──
  const topVerified = useMemo(() => {
    let best: Row | null = null;
    for (const r of rows) {
      if (!mktSet.has(r.slug) || !r.verified) continue;
      if (!best || Math.abs(r.verified.changePct) > Math.abs(best.verified!.changePct)) best = r;
    }
    return best;
  }, [rows, mktSet]);

  // ── stable callbacks for the memoized rows ──
  const onToggleOpen = useCallback((slug: string) => setOpen(o => (o === slug ? null : slug)), []);
  const onToggleCompare = useCallback((slug: string) => {
    setCompare(c => c.includes(slug) ? c.filter(s => s !== slug) : c.length >= 4 ? c : [...c, slug]);
  }, []);
  const onToggleFollow = useCallback((slug: string, label: string) => {
    if (!user) { openLogin(); return; }
    const existing = searches.find(s => (s.query as { player?: string }).player === slug);
    if (existing) void removeSearch(existing.id);
    else void saveSearch(`Following ${label}`, { player: slug, playerName: label });
  }, [user, openLogin, searches, removeSearch, saveSearch]);

  // deep link ?open= — land on the dossier once the ledger has painted.
  // `open` is a dep too: on a WARM cache loading is already false at mount,
  // so the restore effect's setOpen lands on a LATER render — without `open`
  // in deps this never re-fires and the deep link silently never scrolls.
  // The deepLinked ref makes it fire exactly once regardless.
  useEffect(() => {
    if (loading || !deepLinked.current || !open) return;
    deepLinked.current = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector(`[data-mk-flip="${open}"]`)?.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
    }));
  }, [loading, open]);

  // ── INPUT CRAFT — '/', j/k, c (compare), f (follow) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (t?.closest('[role="dialog"],[role="listbox"],[role="menu"]')) return;
      if (document.querySelector('.ray-ck-overlay, .ray-maker-sheet')) return;
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'c' || e.key === 'f') {
        const el = document.activeElement as HTMLElement | null;
        const slug = el?.dataset?.slug;
        if (!slug) return;
        e.preventDefault();
        if (e.key === 'c') onToggleCompare(slug);
        else if (authEnabled) {
          const a = ARTISTS.find(x => x.slug === slug);
          if (a) onToggleFollow(slug, a.label);
        }
        return;
      }
      if (e.key !== 'j' && e.key !== 'k') return;
      const rowEls = Array.from(document.querySelectorAll<HTMLElement>('[data-mk-row]'));
      if (!rowEls.length) return;
      e.preventDefault();
      const cur = rowEls.indexOf(document.activeElement as HTMLElement);
      const next = cur < 0 ? 0 : e.key === 'j' ? Math.min(rowEls.length - 1, cur + 1) : Math.max(0, cur - 1);
      rowEls[next].focus({ preventScroll: true });
      rowEls[next].scrollIntoView({ block: 'nearest', behavior: 'auto' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onToggleCompare, onToggleFollow, authEnabled]);

  // ── FLIP — board-relative, same-id-set only, forced reflow before reset ──
  const listRef = useRef<HTMLDivElement | null>(null);
  const flipPos = useRef<Map<string, number>>(new Map());
  const flipTimers = useRef<number[]>([]);
  const flipKey = groups.map(g => g.rows.map(r => r.slug).join(',')).join('|');
  React.useLayoutEffect(() => {
    const board = listRef.current;
    if (!board) { flipPos.current = new Map(); return; }
    const boardTop = board.getBoundingClientRect().top;
    const prev = flipPos.current;
    const next = new Map<string, number>();
    board.querySelectorAll<HTMLElement>('[data-mk-flip]').forEach(el => {
      next.set(el.dataset.mkFlip!, el.getBoundingClientRect().top - boardTop);
    });
    flipTimers.current.forEach(t => window.clearTimeout(t));
    flipTimers.current = [];
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && prev.size > 0 && next.size === prev.size && Array.from(next.keys()).every(k => prev.has(k))) {
      const moved: HTMLElement[] = [];
      board.querySelectorAll<HTMLElement>('[data-mk-flip]').forEach(el => {
        const delta = (prev.get(el.dataset.mkFlip!) ?? 0) - (next.get(el.dataset.mkFlip!) ?? 0);
        if (Math.abs(delta) > 2) {
          el.style.transform = `translateY(${delta}px)`;
          el.style.transition = 'none';
          moved.push(el);
        }
      });
      // force the style flush — a rAF from this commit runs before the first
      // recalc; without the reflow the transition has no origin (teleports)
      if (moved.length) void board.offsetHeight;
      requestAnimationFrame(() => {
        for (const el of moved) {
          el.style.transform = '';
          el.style.transition = 'transform 360ms var(--ease-signature)';
        }
      });
      flipTimers.current.push(window.setTimeout(() => {
        for (const el of moved) el.style.transition = '';
      }, 420));
    }
    flipPos.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipKey]);
  // dossier open/close shifts rows without changing flipKey — re-measure
  useEffect(() => {
    const t = window.setTimeout(() => {
      const board = listRef.current;
      if (!board) return;
      const boardTop = board.getBoundingClientRect().top;
      const next = new Map<string, number>();
      board.querySelectorAll<HTMLElement>('[data-mk-flip]').forEach(el => {
        next.set(el.dataset.mkFlip!, el.getBoundingClientRect().top - boardTop);
      });
      flipPos.current = next;
    }, 380);
    return () => window.clearTimeout(t);
  }, [open]);

  const jumpTo = useCallback((key: Market) => {
    document.getElementById(`mk-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const gridTemplate = useMemo(() =>
    `30px minmax(0,1fr) ${cols.map(k => COLS.find(c => c.k === k)!.width).join(' ')} 18px`,
    [cols]);

  return (
    <div className="terminal-shell" style={{ minHeight: '100vh', fontFamily: 'var(--font-sans), sans-serif' }}>
      <style dangerouslySetInnerHTML={{ __html: MAKERS_CSS }} />
      {/* the column set is dynamic — the grid template rides a CSS var */}
      <style dangerouslySetInnerHTML={{ __html: `@media(min-width:940px){.mk-row,.mk-cols{grid-template-columns:${gridTemplate}}}` }} />
      <ArtistNav activeSlug="artists" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          <section className="rail ray-enter" style={{ paddingTop: 24, paddingBottom: 4 }}>
            <div style={{ marginBottom: 22 }}><MarketSwitch compact /></div>
            <Masthead
              kicker={`The roster · ${activeLabel} market`}
              datum={<CountUp to={rosterCount} format={n => `${Math.round(n)} ${noun}`} duration={900} animate={!fromCache} />}
              title={<>Every maker, one <Accent>ledger</Accent>.</>}
              sub={
                <>
                  <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{totalLive.toLocaleString()} live lots</b> on the block
                  {totalFlags > 0 && <> · <b style={{ color: 'var(--color-up)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{totalFlags}</b> flagged by the engine</>}
                  {verifiedCount > 0 && <> · {verifiedCount} CI-verified indexes</>}
                </>
              }
            />
          </section>

          {/* ── THE COCKPIT ── */}
          {activeKey === 'all' && (
            <section className="rail ray-enter" style={{ '--enter-delay': '30ms', paddingTop: 4, paddingBottom: 2 } as React.CSSProperties}>
              <div className="mk-cockpit ns-plate" role="list">
                {cockpit.map(c => (
                  <button key={c.key} type="button" role="listitem" className="mk-cock" onClick={() => jumpTo(c.key)}>
                    <span className="mk-cock-head">
                      <span className="mk-cock-icon" aria-hidden><MarketIcon market={c.key} size={13} /></span>
                      <span className="mk-cock-name">{c.label}</span>
                    </span>
                    <span className="mk-cock-v">
                      <CountUp to={c.live} format={n => Math.round(n).toLocaleString()} duration={900} animate={!fromCache} />
                      <i>live</i>
                      {c.flags > 0 && <em className="mk-cock-flag">{c.flags} flagged</em>}
                    </span>
                    <span className="mk-cock-s">
                      {c.makers} {rosterNoun(c.key, c.makers)}
                      {c.demandNow !== null && <> · <b data-dir={c.demandNow >= 0 ? 'up' : 'down'}>{formatDemand(c.demandNow)}</b></>}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ══ THE VERIFIED READ CELL — the cell-system POP (the home page's
              instrument-set grammar): ONE forced-color cell carrying the
              strongest CI-verified maker read on this book — dir is the real
              sign of its published Δ, nothing else — beside quiet cells whose
              big numerals are the same counts the masthead already prints
              (roster / CI-verified indexes / flagged on the block). Honest
              abstention: no verified read on the book → the cell goes ink and
              says so. ══ */}
          <section className="rail ray-enter mk-cellroom" style={{ '--enter-delay': '35ms' } as React.CSSProperties}>
            <CellGrid min={230} className="mk-cells">
              {topVerified && topVerified.verified ? (
                <ColorCell
                  dir={topVerified.verified.changePct > 0 ? 'up' : topVerified.verified.changePct < 0 ? 'down' : 'ink'}
                  span={2}
                  stat={`${topVerified.verified.changePct >= 0 ? '+' : '−'}${Math.abs(Math.round(topVerified.verified.changePct))}%`}
                  label={`The verified read · ${topVerified.verified.horizon}`}
                  body={`${topVerified.label} — the strongest CI-verified move on the ${activeLabel} book · 95% CI ${Math.round(topVerified.verified.ciLoPct)}% to ${Math.round(topVerified.verified.ciHiPct)}% · n ${topVerified.verified.n.toLocaleString()}`}
                  href={`/makers/${topVerified.slug}`}
                />
              ) : (
                <ColorCell
                  dir="ink"
                  span={2}
                  label="The verified read"
                  body={`No CI-verified index on the ${activeLabel} book yet — a maker publishes a move only when its 95% interval resolves the sign; everything else abstains.`}
                />
              )}
              <Cell
                stat={rosterCount.toLocaleString()}
                statNote={noun}
                mark={<FigPools size={96} />}
                label="The roster"
                body={`Every maker lectr tracks on the ${activeLabel} book — sold history, live lots and the engine's flags in one ledger.`}
              />
              <Cell
                stat={verifiedCount.toLocaleString()}
                statNote="CI-verified indexes"
                mark={<FigCalib size={96} />}
                label="Verified indexes"
                body="Repeat-sales reads whose 95% interval resolves the sign — the only price moves the engine will stand behind."
              />
              <Cell
                stat={totalFlags.toLocaleString()}
                statNote="flagged by the engine"
                mark={<FigGate size={96} />}
                label="On the block"
                body={totalFlags > 0
                  ? `${totalLive.toLocaleString()} live ${totalLive === 1 ? 'lot' : 'lots'} on the book tonight — ${totalFlags.toLocaleString()} priced under ${totalFlags === 1 ? 'its' : 'their'} comparables.`
                  : totalLive > 0
                    ? `${totalLive.toLocaleString()} live ${totalLive === 1 ? 'lot' : 'lots'} on the book tonight — none flagged under its comparables.`
                    : 'The book is quiet — the crawl refreshes daily.'}
              />
            </CellGrid>
          </section>

          {/* ── THE FILTER BAR ── */}
          <div className="mk-bar-wrap">
            <div className="rail mk-bar">
              <label className="mk-search">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5" />
                </svg>
                <input
                  ref={searchRef}
                  type="search" value={q} onChange={e => setQ(e.target.value)}
                  placeholder="Filter makers…" aria-label="Filter makers"
                />
                {q ? (
                  <button type="button" className="mk-clear" onClick={() => setQ('')} aria-label="Clear filter">×</button>
                ) : (
                  <kbd className="mk-kbd" aria-hidden>/</kbd>
                )}
              </label>
              <button type="button" className="mk-chip" data-on={fFlagged || undefined} onClick={() => setFFlagged(v => !v)} aria-pressed={fFlagged}>
                Flagged
              </button>
              <button type="button" className="mk-chip" data-on={fLive || undefined} onClick={() => setFLive(v => !v)} aria-pressed={fLive}>
                On the block
              </button>
              <button type="button" className="mk-chip" data-on={fVerified || undefined} onClick={() => setFVerified(v => !v)} aria-pressed={fVerified}>
                Verified index
              </button>
              {authEnabled && (
                <button type="button" className="mk-chip" data-on={fFollowing || undefined}
                  onClick={() => { if (!user) { openLogin(); return; } setFFollowing(v => !v); }} aria-pressed={fFollowing}>
                  Following
                </button>
              )}
              <span className="mk-bar-rule" aria-hidden />
              <span className="mk-count">{visible.length} of {rosterCount}</span>
              <div className="mk-display">
                <button type="button" className="mk-chip" data-on={showDisplay || undefined} onClick={() => setShowDisplay(v => !v)} aria-expanded={showDisplay}>
                  Display
                </button>
                {showDisplay && (
                  <>
                    <button type="button" className="mk-display-veil" aria-label="Close display menu" onClick={() => setShowDisplay(false)} />
                    <div className="mk-display-pop" role="menu" aria-label="Visible columns">
                      <div className="mk-display-head kicker">Columns</div>
                      {COLS.map(c => {
                        const on = cols.includes(c.k);
                        return (
                          <button key={c.k} type="button" role="menuitemcheckbox" aria-checked={on} className="mk-display-item" data-on={on || undefined}
                            onClick={() => setCols(prev => {
                              const nx = on ? prev.filter(k => k !== c.k) : [...COLS.map(x => x.k).filter(k => prev.includes(k) || k === c.k)];
                              return nx.length ? nx : prev; // never zero columns
                            })}>
                            <span className="mk-display-check" aria-hidden>{on ? '✓' : ''}</span>
                            {c.label}
                          </button>
                        );
                      })}
                      <button type="button" className="mk-display-reset" onClick={() => setCols(DEFAULT_COLS)}>Reset</button>
                    </div>
                  </>
                )}
              </div>
              <div className="ray-seg mk-seg" role="tablist" aria-label="Sort the directory">
                {SORTS.map(s => (
                  <button key={s.k} type="button" role="tab" className="ray-seg-btn" data-active={sort === s.k}
                    aria-selected={sort === s.k} onClick={() => setSort(s.k)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── THE DIRECTORY ── */}
          <section className="rail ray-enter" style={{ '--enter-delay': '40ms', paddingTop: 6, paddingBottom: compare.length ? 120 : 30 } as React.CSSProperties}>
            <div className="mk-cols" aria-hidden>
              <span /><span className="kicker">Maker</span>
              {cols.map(k => (
                <span key={k} className="kicker" style={{ textAlign: 'right' }}>{COLS.find(c => c.k === k)!.label}</span>
              ))}
              <span />
            </div>

            <div ref={listRef}>
              {groups.length === 0 ? (
                <div className="mk-empty">
                  {/* the empty state as a patent plate — the gate drawing:
                      many candidates fan in, none leaves under these filters */}
                  <FigureCell
                    figure={<FigGate />}
                    label="The directory"
                    body={<>
                      No maker matches the current filters in the {activeLabel} market.
                      {' '}<button type="button" className="mk-reset" onClick={() => { setQ(''); setFLive(false); setFVerified(false); setFFlagged(false); setFFollowing(false); }}>Clear the filters</button>
                    </>}
                  />
                </div>
              ) : groups.map(g => (
                <div key={g.key} id={`mk-${g.key}`} className="mk-group ns-plate">
                  <div className="mk-group-head">
                    <span className="mk-group-mark" aria-hidden><MarketIcon market={g.key} size={15} /></span>
                    <h2 className="mk-group-name">{g.label}</h2>
                    <span className="mk-group-count">{g.rows.length}</span>
                    <span className="mk-group-rule" aria-hidden />
                    <span className="mk-group-read">
                      {g.flags > 0 && <b className="mk-group-flags">{g.flags} flagged</b>}
                      {g.revenue > 0 && <>{g.flags > 0 ? ' · ' : ''}{fmtUsd(g.revenue)} settled</>}
                      {g.live > 0 && <>{(g.flags > 0 || g.revenue > 0) ? ' · ' : ''}{g.live.toLocaleString()} on the block</>}
                      {g.demandNow !== null && (
                        <>{(g.flags > 0 || g.revenue > 0 || g.live > 0) ? ' · ' : ''}demand <b data-dir={g.demandNow >= 0 ? 'up' : 'down'}>{formatDemand(g.demandNow)}</b></>
                      )}
                    </span>
                  </div>
                  <div className="mk-list">
                    {g.rows.map(r => (
                      <MakerRowItem
                        key={r.slug}
                        r={r} soldMax={g.soldMax} isOpen={open === r.slug} cols={cols}
                        isSel={compare.includes(r.slug)} isFollowed={followedSet.has(r.slug)} authEnabled={authEnabled}
                        onToggleOpen={onToggleOpen} onToggleCompare={onToggleCompare} onToggleFollow={onToggleFollow}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </RayEntrance>
      )}

      {compare.length > 0 && !loading && (
        <CompareTray sel={compare} rows={rows} onRemove={s => onToggleCompare(s)} onClear={() => setCompare([])} />
      )}

      <Colophon record={null} />
    </div>
  );
}

const MAKERS_CSS = `
/* ════ THE MAKERS DIRECTORY — trading grade (Aug 2026 pass 3) ════ */

/* ── THE COCKPIT ── */
/* the plate rule (ns-plate) draws the top hairline + crop marks */
.mk-cockpit{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));border-bottom:1px solid var(--color-border)}
.mk-cock{display:grid;gap:3px;align-content:start;text-align:left;padding:14px 16px 12px;background:none;border:none;border-left:1px solid var(--color-hair,rgba(255,255,255,0.06));cursor:pointer;color:inherit;transition:background var(--duration-fast) var(--ease-signature)}
.mk-cock:first-child{border-left:none}
.mk-cock:hover{background:var(--color-hover-item)}
.mk-cock:focus-visible{outline:1.5px solid color-mix(in srgb,var(--color-fg) 70%,transparent);outline-offset:-1.5px}
.mk-cock-head{display:flex;align-items:center;gap:7px;min-width:0}
.mk-cock-icon{display:inline-flex;color:var(--color-text-muted);flex:none}
.mk-cock-name{font-size:11px;font-weight:550;letter-spacing:0.02em;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-cock-v{font-family:var(--font-mono),monospace;font-size:21px;font-weight:500;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;color:var(--color-fg);line-height:1.15;display:flex;align-items:baseline;flex-wrap:wrap;column-gap:5px}
.mk-cock-v i{font-style:normal;font-size:10.5px;color:var(--color-text-faint);letter-spacing:0.06em}
.mk-cock-v em{font-style:normal;font-family:var(--font-mono),monospace;font-size:10.5px;font-weight:700;color:var(--color-up);letter-spacing:0.02em}
.mk-cock-s{font-size:10.5px;color:var(--color-text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.mk-cock-s b{font-weight:700;font-family:var(--font-mono),monospace}
.mk-cock-s b[data-dir="up"]{color:var(--color-up)}
.mk-cock-s b[data-dir="down"]{color:var(--color-down-text)}
@media(max-width:700px){.mk-cockpit{grid-template-columns:repeat(2,1fr)}.mk-cock{border-bottom:1px solid var(--color-hair,rgba(255,255,255,0.06))}}

/* ── THE VERIFIED READ CELL room ── */
.mk-cellroom{padding-top:10px;padding-bottom:20px}
/* under two-column width the span-2 color cell must stand down: a span-2
   item in a one-track auto-fit grid forces an implicit column and overflows
   the 390px viewport (the home page's own rule; !important because the span
   rides an inline style) */
@media(max-width:679px){.mk-cells > *{grid-column:auto !important}}

/* ── the filter bar ── */
.mk-bar-wrap{position:sticky;top:54px;z-index:30;background:color-mix(in srgb,var(--surface-mix, #0b0c0e) 88%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--color-border)}
.mk-bar{display:flex;align-items:center;gap:8px;padding-top:9px;padding-bottom:9px;flex-wrap:wrap}
.mk-search{display:inline-flex;align-items:center;gap:7px;flex:0 1 210px;min-width:140px;padding:0 12px;height:30px;background:var(--color-bg-elevated);border:1px solid var(--color-border);border-radius:999px;color:var(--color-text-faint)}
.mk-search input{flex:1;min-width:0;background:none;border:none;outline:none;font-family:var(--font-sans),sans-serif;font-size:12.5px;color:var(--color-fg)}
.mk-search input::placeholder{color:var(--color-text-faint)}
.mk-search:focus-within{border-color:var(--color-border-mid)}
.mk-clear{background:none;border:none;color:var(--color-text-faint);cursor:pointer;font-size:14px;padding:0 2px}
.mk-kbd{font-family:var(--font-mono),monospace;font-size:10px;color:var(--color-text-faint);border:1px solid var(--color-border);border-radius:5px;padding:1px 5px;line-height:1.3}
.mk-chip{font-family:var(--font-mono),monospace;font-size:10.5px;letter-spacing:0.08em;padding:0 12px;height:28px;background:none;color:var(--color-text-muted);border:1px solid var(--color-border);border-radius:100px;cursor:pointer;transition:color var(--duration-fast) var(--ease-signature),border-color var(--duration-fast) var(--ease-signature),background var(--duration-fast) var(--ease-signature)}
.mk-chip:hover{color:var(--color-fg)}
.mk-chip[data-on]{background:var(--color-fg);color:var(--color-bg);border-color:var(--color-fg)}
.mk-chip:active,.mkc-btn:active,.mk-act:active{transform:scale(0.98)}
.mk-bar-rule{flex:1}
.mk-count{font-family:var(--font-mono),monospace;font-size:10.5px;color:var(--color-text-faint);font-variant-numeric:tabular-nums;white-space:nowrap}
.mk-seg .ray-seg-btn{font-size:11.5px;padding:5px 10px}
@media(max-width:700px){.mk-seg{order:9;flex-basis:100%;overflow-x:auto}.mk-bar-rule{display:none}}

/* ── the Display menu ── */
.mk-display{position:relative}
.mk-display-veil{position:fixed;inset:0;z-index:39;background:none;border:none;cursor:default}
.mk-display-pop{position:absolute;top:calc(100% + 8px);right:0;z-index:40;min-width:180px;background:var(--surface-tip, #101214);border:1px solid var(--color-border-mid);border-radius:12px;padding:8px;display:grid;gap:1px}
.mk-display-head{font-size:10px;letter-spacing:0.14em;padding:4px 8px 7px}
.mk-display-item{display:flex;align-items:center;gap:8px;padding:6px 8px;background:none;border:none;border-radius:7px;font-family:var(--font-sans),sans-serif;font-size:12px;color:var(--color-text-muted);cursor:pointer;text-align:left;transition:background var(--duration-fast) var(--ease-signature),color var(--duration-fast) var(--ease-signature)}
.mk-display-item:hover{background:var(--color-hover-item);color:var(--color-fg)}
.mk-display-item[data-on]{color:var(--color-fg)}
.mk-display-check{width:13px;flex:none;font-size:11px;color:var(--color-up)}
.mk-display-reset{margin-top:5px;padding:6px 8px;background:none;border:none;border-top:1px solid var(--color-hair,rgba(255,255,255,0.06));font-family:var(--font-mono),monospace;font-size:10.5px;letter-spacing:0.06em;color:var(--color-text-faint);cursor:pointer;text-align:left}
.mk-display-reset:hover{color:var(--color-fg)}

/* ── column kickers ── */
.mk-cols{display:none}
@media(min-width:940px){
  .mk-cols{display:grid;gap:14px;align-items:baseline;padding:12px 14px 8px}
  .mk-cols .kicker{font-size:10px;letter-spacing:0.14em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
}

/* ── group heads — rooms as framed plates, authority through lightness ── */
.mk-group{margin-bottom:22px;scroll-margin-top:150px}
.mk-group-head{position:sticky;top:103px;z-index:20;display:flex;align-items:center;gap:10px;padding:12px 0 9px;background:color-mix(in srgb,var(--color-bg, #08090a) 90%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--color-border)}
.mk-group-mark{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;border:1px solid var(--color-border);border-radius:8px;color:var(--color-text-secondary);background:var(--color-bg-elevated)}
.mk-group-name{margin:0;font-size:20px;font-weight:350;letter-spacing:-0.02em;white-space:nowrap}
.mk-group-count{font-family:var(--font-mono),monospace;font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--color-text-secondary);border:1px solid var(--color-border);border-radius:100px;padding:1px 8px;flex:none}
.mk-group-rule{flex:1;border-top:1px solid var(--color-border)}
.mk-group-read{font-size:11.5px;color:var(--color-text-faint);white-space:nowrap;font-variant-numeric:tabular-nums}
.mk-group-read b{font-weight:700;font-family:var(--font-mono),monospace}
.mk-group-read b[data-dir="up"]{color:var(--color-up)}
.mk-group-read b[data-dir="down"]{color:var(--color-down-text)}
.mk-group-flags{color:var(--color-up)}

/* ── rows ── */
.mk-item{position:relative;border-bottom:1px solid var(--color-hair,rgba(255,255,255,0.06));background:transparent}
.mk-list .mk-item:last-child{border-bottom:none}
.mk-item[data-open]{background:var(--color-hover-item)}
.mk-item[data-sel]{box-shadow:inset 2px 0 0 var(--color-fg)}
.mk-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:12px;align-items:center;padding:9px 14px;min-height:52px;color:inherit;text-decoration:none;cursor:pointer;transition:background var(--duration-fast) var(--ease-signature)}
.mk-row:hover{background:var(--color-hover-item)}
.mk-row:focus-visible{outline:1.5px solid color-mix(in srgb,var(--color-fg) 70%,transparent);outline-offset:-1.5px;background:var(--color-hover-item)}
.mk-mono{position:relative;width:30px;height:30px;flex:none;border-radius:8px;overflow:hidden;background:var(--color-bg-elevated);border:1px solid var(--color-hair,rgba(255,255,255,0.06))}
.mk-mono-letter{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:650;color:var(--color-text-secondary)}
.mk-mono img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.mk-id{min-width:0;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.mk-name{font-size:13.5px;font-weight:550;color:var(--color-fg);white-space:nowrap}
.mk-tags{display:inline-flex;gap:5px;flex-wrap:wrap}
.mk-tag{display:inline-block;padding:1px 7px;font-family:var(--font-mono),monospace;font-size:10px;letter-spacing:0.05em;color:var(--color-text-muted);border:1px solid var(--color-border);border-radius:100px;white-space:nowrap}
.mk-tag-verified{color:var(--color-text-secondary);border-color:var(--color-border-mid)}
.mk-cell{display:none}
.mk-go{display:none}
.mk-mob{text-align:right;flex:none}
.mk-mob-median{display:block;font-family:var(--font-mono),monospace;font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--color-fg)}
.mk-mob-sub{display:block;font-family:var(--font-mono),monospace;font-size:10.5px;color:var(--color-text-faint);font-variant-numeric:tabular-nums}
.mk-mob-sub[data-dir="up"]{color:var(--color-up)}
.mk-mob-sub[data-dir="down"]{color:var(--color-down-text)}
.mk-acts{display:none}
@media(min-width:940px){
  .mk-row{gap:14px;padding-right:64px}
  .mk-mob{display:none}
  .mk-cell{display:block;font-family:var(--font-mono),monospace;font-size:12.5px;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;color:var(--color-fg);text-align:right;white-space:nowrap;overflow:hidden}
  .mk-faint{color:var(--color-text-faint)}
  .mk-cell[data-live]{font-weight:700}
  .mk-flags{color:var(--color-text-faint)}
  .mk-flags[data-hot]{color:var(--color-up);font-weight:700}
  .mk-delta{color:var(--color-text-faint)}
  .mk-delta[data-dir="up"]{color:var(--color-up);font-weight:700}
  .mk-delta[data-dir="down"]{color:var(--color-down-text);font-weight:700}
  .mk-spark{display:flex;justify-content:flex-end;align-items:center}
  .mk-sparkgap{display:inline-block;width:90px}
  .mk-go{display:flex;justify-content:flex-end;color:var(--color-text-faint);transition:transform var(--duration-fast) var(--ease-signature)}
  .mk-go[data-open]{transform:rotate(90deg)}
  .mk-soldcell{overflow:visible}
  .mk-soldtrack{display:block;height:2px;margin-top:4px;background:var(--lw-07, rgba(255, 255, 255, 0.07));border-radius:2px}
  .mk-soldtrack>span{display:block;height:100%;border-radius:2px;background:var(--lw-4, rgba(255, 255, 255, 0.4));margin-left:auto}
  /* hover actions — absolute siblings of the row (valid interactive nesting) */
  .mk-acts{display:flex;gap:4px;position:absolute;top:11px;right:30px;z-index:2;opacity:0;transition:opacity var(--duration-fast) var(--ease-signature)}
  .mk-item:hover .mk-acts,.mk-item:focus-within .mk-acts,.mk-item[data-sel] .mk-acts{opacity:1}
  .mk-act{width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:var(--color-bg-elevated);border:1px solid var(--color-border);border-radius:999px;color:var(--color-text-muted);cursor:pointer;padding:0;transition:color var(--duration-fast) var(--ease-signature),border-color var(--duration-fast) var(--ease-signature)}
  .mk-act:hover{color:var(--color-fg);border-color:var(--color-border-mid)}
  .mk-act[data-on]{color:var(--color-fg);border-color:var(--color-border-mid);background:var(--color-hover-item)}
}

/* ── THE DOSSIER ── */
.mkx{display:grid;grid-template-rows:0fr;transition:grid-template-rows 340ms var(--ease-signature)}
.mk-item[data-open] .mkx{grid-template-rows:1fr}
.mkx-in{overflow:hidden;min-height:0;visibility:hidden;transition:visibility 0s 340ms}
.mk-item[data-open] .mkx-in{visibility:visible;transition:visibility 0s;border-top:1px solid var(--color-hair,rgba(255,255,255,0.06))}
/* the dossier hero — the maker's flagship lot photo as a banner */
.mkx-hero{position:relative;margin:14px 16px 0;height:150px;border-radius:12px;overflow:hidden;background:var(--color-bg-elevated)}
.mkx-hero img{width:100%;height:100%;object-fit:cover;display:block}
.mkx-hero::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,color-mix(in srgb,var(--color-bg, #08090a) 78%,transparent) 100%)}
.mkx-hero-cap{position:absolute;left:14px;bottom:11px;z-index:1;font-size:12px;font-weight:600;letter-spacing:0.01em;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,0.6)}
@media(min-width:940px){.mkx-hero{height:190px}}
.mkx-chartwrap{padding:14px 16px 0}
.mkx-chart-cap{font-size:10px;letter-spacing:0.14em;margin-bottom:8px}
.mkx-chart{width:100%;height:150px;padding:4px 10px 18px 46px;box-sizing:border-box}
.mkx-plot{position:relative;width:100%;height:100%}
.mkx-plot svg{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible}
.mkx-dot{position:absolute;width:5px;height:5px;border-radius:100px;background:var(--color-fg);transform:translate(-50%,-50%)}
.mkx-tick{position:absolute;font-family:var(--font-mono),monospace;font-size:9.5px;color:var(--color-text-faint);font-variant-numeric:tabular-nums;white-space:nowrap}
.mkx-tick-y{left:-8px;transform:translate(-100%,-50%)}
.mkx-tick-x{bottom:-16px;transform:translateX(-50%)}
/* the no-curve explanation — a cream well (ns-well provides ground+radius+pad) */
.mkx-none{margin:14px 16px 0}
.mkx-none .ns-well-body{font-size:12.5px;color:var(--color-text-muted)}
.mkx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px 26px;padding:14px 16px 0}
.mkx-grid .kicker{font-size:10px;letter-spacing:0.14em}
.mkx-grid p{margin:4px 0 0;font-size:12px;color:var(--color-text-muted);line-height:1.55}
.mkx-grid p b{color:var(--color-fg);font-weight:600;font-variant-numeric:tabular-nums}
.mkx-houses{margin-top:6px;display:grid;gap:4px}
.mkx-house{display:grid;grid-template-columns:minmax(64px,96px) minmax(0,1fr) 52px;gap:8px;align-items:center}
.mkx-house-name{font-size:11px;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mkx-house-track{display:block;height:3px;background:var(--lw-07, rgba(255, 255, 255, 0.07));border-radius:2px}
.mkx-house-track>span{display:block;height:100%;border-radius:2px;background:var(--lw-4, rgba(255, 255, 255, 0.4))}
.mkx-house-n{font-family:var(--font-mono),monospace;font-size:10.5px;color:var(--color-text-faint);text-align:right;font-variant-numeric:tabular-nums}
.mkx-verified{margin-top:6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mkx-verified b{font-family:var(--font-mono),monospace;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}
.mkx-verified b[data-dir="up"]{color:var(--color-up)}
.mkx-verified b[data-dir="down"]{color:var(--color-down-text)}
.mkx-ci{width:110px;height:16px;flex:none}
.mkx-ci-ends{font-family:var(--font-mono),monospace;font-size:10px;color:var(--color-text-faint);font-variant-numeric:tabular-nums}
.mkx-actions{display:flex;align-items:center;gap:12px;padding:14px 16px 16px;flex-wrap:wrap}

/* ── the live book inside the dossier ── */
.mkx-live{margin:14px 16px 0;border:1px solid var(--color-hair,rgba(255,255,255,0.07));border-radius:12px;overflow:clip}
.mkx-live-head{font-size:10px;letter-spacing:0.14em;padding:9px 12px 8px;border-bottom:1px solid var(--color-hair,rgba(255,255,255,0.06))}
.mkx-live-flagn{color:var(--color-up);font-weight:700;letter-spacing:0.06em}
.mkx-lot{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 12px;color:inherit;text-decoration:none;border-bottom:1px solid var(--color-hair,rgba(255,255,255,0.05));transition:background var(--duration-fast) var(--ease-signature)}
.mkx-lot:last-of-type{border-bottom:none}
.mkx-lot:hover{background:var(--color-hover-item)}
.mkx-lot-thumb{position:relative;width:44px;height:34px;border-radius:6px;overflow:hidden;background:var(--color-bg-elevated);display:flex;align-items:center;justify-content:center;flex:none}
.mkx-lot-letter{font-size:14px;font-weight:650;color:var(--color-text-faint)}
.mkx-lot-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.mkx-lot-main{min-width:0}
.mkx-lot-title{display:block;font-size:12px;font-weight:550;color:var(--color-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mkx-lot-sub{display:block;font-size:10.5px;color:var(--color-text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mkx-lot-flag{color:var(--color-up);font-weight:600}
.mkx-lot-cells{text-align:right;flex:none}
.mkx-lot-est{display:block;font-family:var(--font-mono),monospace;font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--color-fg)}
.mkx-lot-close{display:block;font-family:var(--font-mono),monospace;font-size:10px;color:var(--color-text-faint);font-variant-numeric:tabular-nums}
.mkx-live-more{display:flex;align-items:center;justify-content:center;padding:8px 12px;font-family:var(--font-mono),monospace;font-size:10.5px;letter-spacing:0.06em;color:var(--color-text-muted);text-decoration:none;border-top:1px solid var(--color-hair,rgba(255,255,255,0.05))}
.mkx-live-more:hover{color:var(--color-fg)}

/* ── THE COMPARE TRAY ── */
.mkc{position:fixed;left:0;right:0;bottom:0;z-index:35;background:color-mix(in srgb,var(--surface-mix, #0b0c0e) 94%,transparent);backdrop-filter:blur(18px);border-top:1px solid var(--color-border-mid)}
.mkc-bar{display:flex;align-items:center;gap:8px;padding-top:9px;padding-bottom:9px;flex-wrap:wrap}
.mkc-title{font-family:var(--font-mono),monospace;font-size:10.5px;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-text-muted)}
.mkc-chip{display:inline-flex;align-items:center;gap:7px;padding:3px 6px 3px 9px;font-size:12px;font-weight:600;color:var(--color-fg);border:1px solid var(--color-border);border-radius:100px}
.mkc-chip button{background:none;border:none;color:var(--color-text-faint);cursor:pointer;font-size:13px;padding:0 3px;line-height:1}
.mkc-chip button:hover{color:var(--color-fg)}
.mkc-chip[data-thin]{color:var(--color-text-muted)}
.mkc-chip-thin{font-family:var(--font-mono),monospace;font-size:9px;letter-spacing:0.06em;color:var(--color-text-faint);text-transform:uppercase}
.mkc-rule{flex:1}
.mkc-btn{font-family:var(--font-mono),monospace;font-size:10.5px;letter-spacing:0.08em;padding:5px 11px;background:none;color:var(--color-text-muted);border:1px solid var(--color-border);border-radius:100px;cursor:pointer}
.mkc-btn:hover{color:var(--color-fg)}
.mkc-body{padding-bottom:14px;display:grid;grid-template-columns:minmax(0,1fr);gap:8px 26px}
@media(min-width:900px){.mkc-body{grid-template-columns:minmax(0,7fr) minmax(0,5fr);align-items:start}}
.mkc-plotwrap{min-width:0}
.mkc-plot{position:relative;height:150px;margin-left:44px;margin-right:8px}
.mkc-plot svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.mkc-cap{font-size:10px;letter-spacing:0.1em;margin-top:8px}
.mkc-legend{display:grid;gap:6px;align-content:start;padding-top:2px}
.mkc-leg{display:flex;align-items:baseline;gap:8px;min-width:0}
.mkc-leg svg{flex:none;align-self:center}
.mkc-leg-name{font-size:12.5px;font-weight:600;color:var(--color-fg);white-space:nowrap}
.mkc-leg b{font-family:var(--font-mono),monospace;font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums}
.mkc-leg b[data-dir="up"]{color:var(--color-up)}
.mkc-leg b[data-dir="down"]{color:var(--color-down-text)}
.mkc-leg-sub{font-family:var(--font-mono),monospace;font-size:10.5px;color:var(--color-text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.mkc-note{margin:0;font-size:12.5px;color:var(--color-text-muted)}
.mkc-note kbd{font-family:var(--font-mono),monospace;font-size:10.5px;border:1px solid var(--color-border);border-radius:5px;padding:1px 5px}

/* ── empty state — a patent-figure plate (FigureCell) ── */
.mk-empty{margin:20px 0}
.mk-empty .ns-cell-body{font-size:13.5px;color:var(--color-text-muted)}
.mk-reset{background:none;border:none;padding:0;font:inherit;color:var(--color-fg);cursor:pointer;text-decoration:underline dotted}
`;
