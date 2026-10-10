'use client';

import React, { useMemo, useState, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import Link from 'next/link';
import { ARTISTS, ARTIST_LABEL, MARKETS, marketArtists, marketOf, rosterNoun, type Market } from '../constants';
import { useMarket } from '../lib/market';
import { classifyForm, formsForMarket } from '../lib/comps';
import { isMisattributed } from '../lib/attribution';
import MarketSwitch from '../components/MarketSwitch';
import MarketIcon from '../components/MarketIcon';
import { useFullLotsOnDemand } from '../hooks/useRayData';
import { loadPageStats, type PageStats } from '../lib/page-data';
import { useSavedLots } from '../hooks/useSavedLots';
import { useSavedSearches } from '../lib/alerts';
import { useAuth } from '../lib/account';
import ArtistNav from '../components/ArtistNav';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import { formatDate, formatPrice, getUpcomingCounts, craftTitle, httpsImg, localToday, trueSaleDay } from '../utils';
import { formatEstimate } from '../components/LotCard';
import { formatDemand } from '../lib/demand';
import { verifiedMovers, type VerifiedMover } from '../preview/terminal/verified';
import { FigureCell, FigGate } from '../components/cells';
import CountUp from '../components/CountUp';
import CloseClock from '../components/CloseClock';
import Masthead, { Accent } from '../components/Masthead';
import { Colophon } from '../components/Terminal';
import Flick from '../components/Flick';
import type { AuctionLot, MarketStats } from '../types';
import TriageBar from '../components/TriageBar';
import { useUrlState, useLastVisit, passesTriage, houseBaselines, isTriageActive, TRIAGE_DEFAULTS, triageFromParams, triageToParams, type TriageFilters } from '../lib/feed-filters';
import { priorityOf } from '../lib/priority';
import { liveBookHref } from '../lib/lot-browser';
import { taxonOf, SUBS, CAT_LABEL, SPORTS, subLabel, subLabelOf, MARKET_CATS, type CatKey } from '../lib/taxonomy';
import { makerLineOf, labelLineOf, searchTextOf } from '../lib/lot-labels';
import { groupBySubject, subjectFeedHref, OTHER, SUBJECT_MARKETS, type SubjectGroup } from '../lib/maker-subjects';
import { livePool, feedQueryMatches, feedSearchHref, sortByPriority } from '../lib/maker-pool';
import { useFollows, catFollow } from '../lib/follows';
import type { CatStat } from '../../scripts/cat-stats';

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
  /** the tail's start year when velocity is NOT a true 12-month count */
  velocitySince: string | null;
  record: number | null;
  verified: VerifiedMover | null;
  thin: boolean;
  /** measured momentum: consecutive rising quarterly medians (≥3 prints) */
  rising: number;
  /** the record hammered inside the last 12 months */
  recordFresh: string | null;
  liveLots: AuctionLot[];
  /** the "matters most" score of the maker's best live lot (app/lib/priority) */
  topScore: number;
  /** where "Open the dossier" / "+N more" lead — sub-category rows (Oct 9) go
   *  to the feed filtered to that sub; maker rows to /makers/<slug>; subject
   *  rows to the player dossier, else the feed scoped by ?subj= (r5) */
  href?: string;
  /** maker (a real roster slug) · sub (a clean sub-category, "By category")
   *  · subject (a player / Pokémon / person / film / franchise / mission —
   *  app/lib/maker-subjects) · rest (the market's lots no reader names) */
  kind?: 'maker' | 'sub' | 'subject' | 'rest';
  /** subject rows: the athlete's /player dossier, when one exists */
  dossierHref?: string | null;
  /** what follow toggles (a players.json slug for athletes); absent = no follow */
  followKey?: string | null;
  /** tooltip scoping a cell that is narrower than its column (a player's
   *  median is the median of the category most of their live lots sit in) */
  medianNote?: string | null;
}

/* ── SUBJECT ROWS (Oct 9, r4) — the collection markets list who the lots are
   ABOUT: players, Pokémon, people, films, franchises, missions. The clean
   sub-category rows stay one toggle away ("By category"). ── */
type RowsBy = 'name' | 'cat';
const SUBJECT_ROW = 's:';
const SCROLL_KEY = 'mk-scroll:';
/** rows per collection group before "Show more" (2,000+ players on sports) */
const CAP_ONE = 40;
const CAP_ALL = 8;
const CAP_STEP = 40;
const NO_CAPS: Partial<Record<Market, number>> = {};
/** a players.json dossier — the sold history an athlete row can honestly carry */
interface PlayerRec {
  slug: string; n: number; sport: string | null;
  cats: Record<string, { n: number; medUsd: number | null; ttmMedUsd: number | null }>;
  objects: { id: string; d: string; p: number; t: string; cat: string }[];
}
/** the name column's head, per market, when rows are subjects */
const NAME_HEAD: Partial<Record<Market, string>> = {
  sports: 'Player', tcg: 'Pokémon', science: 'Mission · person', culture: 'Person · film · franchise',
};

/* ── COLLECTION MARKETS (Oct 9) — where the "maker" is really a category,
   the roster lists CLEAN sub-categories (app/lib/taxonomy + cat-stats.json)
   instead of one pseudo-maker row (TCG used to be a single "Pokémon" row). ── */
const COLLECTION_CATS: { cat: CatKey; market: Market; prefix: string }[] = [
  { cat: 'sports-cards', market: 'sports', prefix: 'Cards' },
  { cat: 'sports-memorabilia', market: 'sports', prefix: 'Memorabilia' },
  { cat: 'tcg', market: 'tcg', prefix: 'Pokémon' },
  { cat: 'space-science', market: 'science', prefix: '' },
  { cat: 'entertainment', market: 'culture', prefix: 'Entertainment' },
  { cat: 'historical', market: 'culture', prefix: 'Historical' },
];
const COLLECTION_MARKETS = new Set<Market>(COLLECTION_CATS.map(c => c.market));
const SUBROW = 'c:';

/** a live lot's quiet line under its title — the home feed's label line
 *  (app/lib/lot-labels), then the house. Under a sub row the sub is the row's
 *  own name, so the lot's player / Pokémon leads and the sub drops; under a
 *  subject row the subject is the row's name, so the label line alone. */
function lotSubLine(l: AuctionLot, kind: Row['kind']): string {
  let parts: string[];
  if (kind === 'sub') {
    const who = makerLineOf(l).name;
    parts = [who !== (ARTIST_LABEL[l.artist] || l.artist) ? who : '', ...labelLineOf(l).split(' · ').filter(p => p !== subLabelOf(l))];
  } else parts = [labelLineOf(l)];
  return [...parts, l.auctionHouse].filter(Boolean).join(' · ');
}

type SortKey = 'matters' | 'sold' | 'live' | 'flags' | 'median' | 'delta' | 'name';
// Oct 8: "Matters" (the maker's best live lot by app/lib/priority) is the
// default — the roster opens on who has something important on the block
const DEFAULT_SORT: SortKey = 'matters';
const SORT_NOTE: Record<SortKey, string> = {
  matters: 'What matters most: the summed priority of each row\'s three most important live lots — size, measured edge, bids, closing time',
  sold: 'Sales tracked, all time',
  live: 'Live lots passing the filters',
  flags: 'Live lots priced below their comparables',
  median: 'Median sale, trailing 12 months',
  delta: 'CI-verified repeat-sales move',
  name: 'Alphabetical',
};
const SORTS: { k: SortKey; label: string }[] = [
  { k: 'matters', label: 'Matters' },
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
// (Oct 9 r4) Verified Δ is opt-in: it prints a dash on all but a handful of rows
const DEFAULT_COLS: ColKey[] = ['curve', 'median', 'flags', 'live', 'sold'];
/** what each column head means (hover) */
const COL_NOTE: Record<ColKey, string> = {
  curve: 'Quarterly median sale, last 12 complete quarters',
  median: 'Median sale price over the trailing 12 months',
  delta: 'CI-verified repeat-sales move (95% interval resolves the sign)',
  flags: 'Live lots the engine prices below their comparables',
  live: 'Live lots on the block that pass the filters above',
  sold: 'Sales tracked, all time',
  record: 'Highest price tracked',
  settled: 'Total hammer tracked, all time',
  velocity: 'Sales tracked in the last 12 months',
};

/** the quarter now under way ("2026-Q4") — its median is a handful of early
 *  sales, never a print to draw (Rolex read −95% off one $851 lot) */
function currentQuarter(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}
function completeQuarters<T extends { date: string | number }>(hist: readonly T[]): T[] {
  const cur = currentQuarter();
  return hist.filter(p => String(p.date) !== cur);
}

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
  const pts = completeQuarters(hist).filter(p => (p.medianPrice || p.avgPrice) > 0);
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
  // two reads of the same picks: the 12-quarter trend, or what each has on
  // the block right now (count, engine flags, its three that matter most)
  const [view, setView] = useState<'trend' | 'live'>('trend');
  const picked = sel.map(s => rows.find(r => r.slug === s)).filter((r): r is Row => !!r);
  const liveTotal = picked.reduce((n, r) => n + r.live, 0);
  // shared date domain: the union of each maker's last-12q dates
  const series = picked.map(r => {
    const pts = completeQuarters(r.stats?.priceHistory || []).slice(-12)
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
        <span role="radiogroup" aria-label="Compare view" style={{ display: 'inline-flex', gap: 6 }}>
          {([['trend', 'Trend'], ['live', 'Live']] as const).map(([k, lbl]) => (
            <button key={k} type="button" role="radio" aria-checked={view === k} className="mk-chip" data-on={view === k || undefined}
              style={{ height: 24, padding: '0 10px', letterSpacing: '0.06em', textTransform: 'none' }}
              onClick={() => { setView(k); setExpanded(true); }}>
              {lbl}
            </button>
          ))}
        </span>
        <button type="button" className="mkc-btn" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
          {expanded ? 'Collapse' : 'Expand'}
        </button>
        <button type="button" className="mkc-btn" onClick={onClear}>Clear</button>
      </div>
      {expanded && view === 'live' && (
        <div className="rail mkc-body" data-live style={{ '--n': picked.length, maxHeight: '52vh', overflowY: 'auto' } as React.CSSProperties}>
          {picked.map(r => (
            <div key={r.slug} className="mkx-live" style={{ margin: 0 }}>
              <div className="mkx-live-head kicker">
                {r.label} · {r.live > 0 ? `${r.live.toLocaleString()} live` : 'nothing live'}{r.flags > 0 ? <> · <b className="mkx-live-flagn">{r.flags} flagged</b></> : null}
              </div>
              {r.liveLots.slice(0, 3).map(l => (
                <LiveLotRow key={l.id} l={l} letter={r.label.charAt(0)} kind={r.kind ?? 'maker'} />
              ))}
              {r.live > 3 && (
                <Link href={liveBookHref(r.href ?? `/makers/${r.slug}`, typeof window === 'undefined' ? '' : window.location.search)} className="mkx-live-more">
                  +{(r.live - 3).toLocaleString()} more on the block <Flick size={9} style={{ marginLeft: 4 }} />
                </Link>
              )}
            </div>
          ))}
          {picked.length > 1 && liveTotal > 0 && picked.every(r => !r.href) && (
            <Link href={compareLiveHref(picked, typeof window === 'undefined' ? '' : window.location.search)} className="ray-call-btn ray-call-btn-primary" style={{ gridColumn: '1 / -1', justifySelf: 'start' }}>
              See all {liveTotal.toLocaleString()} live lots together
            </Link>
          )}
        </div>
      )}
      {expanded && view === 'trend' && (
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

/* one live lot as the dossier's live book prints it (and the compare tray's) */
function LiveLotRow({ l, letter, kind }: { l: AuctionLot; letter: string; kind: Row['kind'] }) {
  const closeSoon = l.saleDateTime && (Date.parse(l.saleDateTime) - Date.now()) < 24 * 3600e3 && Date.parse(l.saleDateTime) > Date.now();
  return (
    <Link href={`/lot/${l.id}`} className="mkx-lot">
      <span className="mkx-lot-thumb" aria-hidden>
        <span className="mkx-lot-letter">{letter}</span>
        {l.imageUrl && (
          <img src={httpsImg(l.imageUrl)} alt="" referrerPolicy="no-referrer" loading="lazy"
            onError={e => e.currentTarget.remove()} />
        )}
      </span>
      <span className="mkx-lot-main">
        <span className="mkx-lot-title">{craftTitle(l.title, l.auctionHouse)}</span>
        <span className="mkx-lot-sub">
          {lotSubLine(l, kind)}
          {l.signal?.label === 'Below Market' && <span className="mkx-lot-flag"> · flagged below market</span>}
        </span>
      </span>
      <span className="mkx-lot-cells">
        <span className="mkx-lot-est">{formatEstimate(l)}</span>
        <span className="mkx-lot-close">
          {closeSoon
            ? <span style={{ color: 'var(--color-fg)', fontWeight: 600 }}><CloseClock iso={l.saleDateTime!} windowHours={24} /></span>
            : <>closes {formatDate(l.saleDate)}</>}
        </span>
      </span>
    </Link>
  );
}

/** the compare tray's combined live list: the home feed scoped to the picked
 *  makers (mk=a,b — app/lib/lot-browser feedPass), on their shared market
 *  when they have one, the /makers triage view carried along */
function compareLiveHref(picked: Row[], search: string): string {
  const mkts = new Set(picked.map(r => r.market));
  const base = mkts.size === 1 ? `/${picked[0].market}` : '/';
  const p = new URLSearchParams();
  p.set('mk', picked.map(r => r.slug).join(','));
  p.set('tab', 'all');
  return liveBookHref(`${base}?${p.toString()}`, search);
}

/* the expanded dossier's live book: eight rows, three orders */
type LiveSort = 'matters' | 'closing' | 'est';
const LIVE_SORTS: [LiveSort, string][] = [['matters', 'Matters'], ['closing', 'Closing'], ['est', 'Est.']];
const LIVE_ROWS = 8;
/** the close instant (timed close, else the true sale day's start) */
const closeKey = (l: AuctionLot) => {
  const t = l.saleDateTime ? Date.parse(l.saleDateTime) : NaN;
  if (Number.isFinite(t)) return t;
  const d = trueSaleDay(l);
  return d ? Date.parse(`${d}T00:00:00Z`) : Infinity;
};
/** the asking level: estimate high, else low, else the live bid */
const estKey = (l: AuctionLot) => l.estimateHigh || l.estimateLow || l.currentBid || 0;

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
  // the dossier mounts on first open and stays (so it can animate closed) —
  // 2,000+ subject rows must not each carry a hidden dossier in the DOM
  const [opened, setOpened] = useState(isOpen);
  if (isOpen && !opened) setOpened(true);
  const inline = r.kind === 'subject' || r.kind === 'rest';
  const canCompare = r.kind !== 'subject' && r.kind !== 'rest';
  const followKey = r.kind === 'subject' || r.kind === 'rest' ? r.followKey ?? null : r.slug;
  // the dossier's live-book order (row-local: re-ordering one maker's eight
  // lots never re-renders the ledger)
  const [liveSort, setLiveSort] = useState<LiveSort>('matters');
  const liveShown = useMemo(() => {
    const ls = r.liveLots;
    const pick = liveSort === 'matters' ? ls
      : liveSort === 'closing' ? [...ls].sort((a, b) => closeKey(a) - closeKey(b))
      : [...ls].sort((a, b) => estKey(b) - estKey(a));
    return pick.slice(0, LIVE_ROWS);
  }, [r.liveLots, liveSort]);
  const cell = (k: ColKey): React.ReactNode => {
    switch (k) {
      case 'curve': return <span key={k} className="mk-cell mk-spark" aria-hidden>{r.spark ? <Spark values={r.spark} /> : <span className="mk-sparkgap" />}</span>;
      case 'median': return <span key={k} className="mk-cell" title={r.median && r.medianNote ? r.medianNote : undefined}>{r.median ? formatPrice(r.median) : '—'}</span>;
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
      case 'velocity': return (
        <span key={k} className="mk-cell mk-faint" title={r.velocitySince ? `last ${r.velocity} sales, since ${r.velocitySince} — not a 12-month window` : undefined}>
          {r.velocity > 0 ? (r.velocitySince ? `${r.velocity.toLocaleString()} since ${r.velocitySince}` : r.velocity.toLocaleString()) : '—'}
        </span>
      );
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
            {!inline && BID_MARKETS.has(r.market) && <span className="mk-tag">bid market</span>}
            {r.verified && <span className="mk-tag mk-tag-verified" title={`CI-verified ${r.verified.horizon} move · 95% CI ${Math.round(r.verified.ciLoPct)}% to ${Math.round(r.verified.ciHiPct)}%`}>verified · {r.verified.horizon}</span>}
            {r.recordFresh && <span className="mk-tag mk-tag-verified">record · {r.recordFresh}</span>}
            {r.rising >= 3 && <span className="mk-tag" title={`${r.rising} consecutive quarters of rising median sale`}>{r.rising}q rising</span>}
            {r.thin && <span className="mk-tag">thin history</span>}
          </span>
        </span>
        {cols.map(cell)}
        <span className="mk-go" aria-hidden data-open={isOpen || undefined}><Flick size={10} /></span>
        <span className="mk-mob">
          <span className="mk-mob-median">{r.median ? formatPrice(r.median) : r.live > 0 ? `${r.live.toLocaleString()} live` : '—'}</span>
          <span className="mk-mob-sub" data-dir={r.flags === 0 && r.verified ? r.verified.dir : undefined}>
            {/* phone: live first, then ONE more read — never a line that runs into the tags */}
            {[
              r.median && r.live > 0 ? `${r.live.toLocaleString()} live` : '',
              r.flags > 0 ? `${r.flags} flagged`
                : r.verified ? `${r.verified.changePct >= 0 ? '+' : '−'}${Math.abs(Math.round(r.verified.changePct))}% · ${r.verified.horizon}`
                : r.sold != null ? `${r.sold.toLocaleString()} sold` : '',
            ].filter(Boolean).join(' · ')}
          </span>
        </span>
      </div>

      {/* hover actions — SIBLINGS of the row button (never nested interactive) */}
      <span className="mk-acts">
        {authEnabled && followKey && (
          <button
            type="button" className="mk-act" data-on={isFollowed || undefined}
            aria-pressed={isFollowed} aria-label={isFollowed ? `Unfollow ${r.label}` : `Follow ${r.label}`}
            title={isFollowed ? 'Following — alerts on every new lot' : 'Follow — alerts on every new lot'}
            onClick={e => { e.stopPropagation(); onToggleFollow(followKey, r.label); }}
          >
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
              {isFollowed
                ? <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                : <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
            </svg>
          </button>
        )}
        {canCompare && (
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
        )}
      </span>

      {/* ── THE DOSSIER ── */}
      <div className="mkx">
        <div className="mkx-in">
          {opened && <>
          {/* THE LIVE BOOK — the maker's lots, first in the dossier (Oct 9:
              on a phone it sat ~680px down under the photo and the curve).
              Eight rows, re-orderable: what matters most (the row's own
              order) · closing soonest · highest estimate. */}
          {r.liveLots.length > 0 && (
            <div className="mkx-live">
              <div className="mkx-live-head kicker" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span>On the block · {r.live.toLocaleString()} live{r.flags > 0 ? <> · <b className="mkx-live-flagn">{r.flags} flagged by the engine</b></> : null}</span>
                {r.liveLots.length > 1 && (
                  <span role="radiogroup" aria-label="Order the live lots" style={{ display: 'inline-flex', gap: 6 }}>
                    {LIVE_SORTS.map(([k, lbl]) => (
                      <button key={k} type="button" role="radio" aria-checked={liveSort === k} className="mk-chip" data-on={liveSort === k || undefined}
                        style={{ height: 24, padding: '0 10px', letterSpacing: '0.06em', textTransform: 'none' }}
                        onClick={() => setLiveSort(k)}>
                        {lbl}
                      </button>
                    ))}
                  </span>
                )}
              </div>
              {liveShown.map(l => (
                <LiveLotRow key={l.id} l={l} letter={r.label.charAt(0)} kind={r.kind ?? (r.slug.startsWith(SUBROW) ? 'sub' : 'maker')} />
              ))}
              {/* every row's "+N more" lands on an exact list: a maker's lot
                  browser, a player's dossier, or the feed scoped to the
                  subject (?subj=) — the /makers triage view carried along */}
              {r.live > liveShown.length && (
                <Link href={liveBookHref(r.href ?? `/makers/${r.slug}`, typeof window === 'undefined' ? '' : window.location.search)} className="mkx-live-more">
                  +{(r.live - liveShown.length).toLocaleString()} more on the block <Flick size={9} style={{ marginLeft: 4 }} />
                </Link>
              )}
            </div>
          )}

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
          ) : !inline ? (
            <div className="mkx-none ns-well"><span className="ns-well-body">Not enough sold history for a curve yet — the ledger fills as {r.label} lots settle.</span></div>
          ) : null}
          {/* a subject with no matched sold history prints no empty record/book */}
          {(!inline || r.stats) && <div className="mkx-grid">
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
                {r.velocity > 0 && (r.velocitySince
                  ? <> · last {r.velocity.toLocaleString()} sales · since {r.velocitySince}</>
                  : <> · {r.velocity.toLocaleString()} in 12mo</>)}
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
          </div>}

          {(!inline || r.href || (authEnabled && followKey)) && (
            <div className="mkx-actions">
              {inline ? (r.href && (
                <Link href={liveBookHref(r.href, typeof window === 'undefined' ? '' : window.location.search, { land: !r.dossierHref })} className="ray-call-btn ray-call-btn-primary">
                  {r.dossierHref ? 'Open the player dossier' : 'See every lot'}
                </Link>
              )) : (
                <Link href={liveBookHref(r.href ?? `/makers/${r.slug}`, typeof window === 'undefined' ? '' : window.location.search, { land: !!r.href })} className="ray-call-btn ray-call-btn-primary">
                  {r.href ? 'See every lot' : 'Open the dossier'}
                </Link>
              )}
              {canCompare && (
                <button type="button" className="mk-chip" data-on={isSel || undefined} onClick={() => onToggleCompare(r.slug)}>
                  {isSel ? 'In compare' : 'Add to compare'}
                </button>
              )}
              {authEnabled && followKey && (
                <button type="button" className="mk-chip" data-on={isFollowed || undefined} onClick={() => onToggleFollow(followKey, r.label)}>
                  {isFollowed ? 'Following' : 'Follow'}
                </button>
              )}
            </div>
          )}
          {inline && !r.href && !(authEnabled && followKey) && <div style={{ height: 16 }} aria-hidden />}
          </>}
        </div>
      </div>
    </div>
  );
});

/** a players.json cats key for a live lot's maker slug (graded slabs file under cards) */
const PLAYER_CAT: Record<string, string> = { 'graded-cards': 'sports-cards' };
const REST_TAG: Partial<Record<Market, string>> = { sports: 'no player named', tcg: 'no Pokémon named' };
const FR_DOMAIN: Record<string, string> = { 'fr-beatles': 'Music', 'fr-stones': 'Music' };

/** "Matters" for a ROW: the summed priority of its three most important live
 *  lots (sorted best-first already) — depth counts, one lot can't carry a
 *  maker past a book of 100 */
function mattersOf(lots: readonly AuctionLot[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(3, lots.length); i++) s += priorityOf(lots[i])?.score ?? 0;
  return s;
}

function topKey(m: Map<string, number>): string | null {
  let best: string | null = null, n = 0;
  m.forEach((c, k) => { if (c > n) { n = c; best = k; } });
  return best;
}

/** one subject group → a ledger row with the maker rows' anatomy. Sold
 *  history only where it is really that subject's: an athlete's players.json
 *  dossier (sales tracked, the record, the 12-month median of the category
 *  most of their live lots sit in). No quarterly series exists per subject,
 *  so the curve cell stays the dash — never a borrowed line. */
function subjectRow(g: SubjectGroup<AuctionLot>, players: Map<string, PlayerRec> | null, dossiers: ReadonlySet<string>): Row {
  // the pool arrives in priority order (sortByPriority), so the group does too
  const lots = g.lots;
  const s = g.subject;
  const artN = new Map<string, number>(), subN = new Map<string, number>(), sportN = new Map<string, number>();
  let flags = 0;
  for (const l of lots) {
    artN.set(l.artist, (artN.get(l.artist) || 0) + 1);
    const t = taxonOf(l);
    const sk = `${t.cat}:${t.sub}`; subN.set(sk, (subN.get(sk) || 0) + 1);
    if (t.sport) sportN.set(t.sport, (sportN.get(t.sport) || 0) + 1);
    if (l.signal?.label === 'Below Market') flags++;
  }
  const domArt = topKey(artN);
  const domSub = topKey(subN);
  const domSport = topKey(sportN);
  const subTag = domSub ? subLabel(domSub.split(':')[0] as CatKey, domSub.split(':')[1]).replace(/ \(.*\)$/, '') : null;
  const isPlayer = s?.kind === 'player' && !!s.playerSlug;
  const pr = isPlayer ? players?.get(s!.playerSlug!) : undefined;
  const catKey = domArt ? (PLAYER_CAT[domArt] ?? domArt) : null;
  const catRow = pr && catKey ? pr.cats[catKey] : undefined;
  const rec = pr?.objects?.[0];
  const recDate = rec ? Date.parse(rec.d) : NaN;
  const stats = pr ? ({
    totalSoldTracked: pr.n, medianPriceLast12Months: catRow?.ttmMedUsd ?? 0, totalAuctionRevenue: 0,
    priceHistory: [], houseDistribution: [],
    recordPrice: rec?.p ?? 0, recordTitle: rec?.t ?? '', recordDate: rec?.d ?? '', recordHouse: '',
  } as unknown as MarketStats) : null;
  let discipline: string | null;
  if (!s) discipline = REST_TAG[g.market] ?? 'no subject named';
  else if (s.kind === 'player') discipline = (domSport && SPORTS.find(x => x.key === domSport)?.label) || pr?.sport || subTag;
  else if (s.kind === 'film') discipline = 'Film & TV';
  else if (s.kind === 'franchise') discipline = FR_DOMAIN[s.key.slice(3)] ?? 'Film & TV';
  else discipline = subTag;
  const dossier = isPlayer && dossiers.has(s!.playerSlug!);
  return {
    slug: `${SUBJECT_ROW}${g.id}`,
    label: s ? g.name : 'Other lots',
    market: g.market,
    discipline,
    stats,
    hero: lots.find(l => l.imageUrl)?.imageUrl || null,
    spark: null,
    live: lots.length,
    flags,
    sold: pr ? pr.n : null,
    median: catRow?.ttmMedUsd || null,
    medianNote: catRow?.ttmMedUsd && catKey ? `12-month median · ${(ARTIST_LABEL[catKey] || catKey).toLowerCase()} sales` : null,
    revenue: 0,
    velocity: 0,
    velocitySince: null,
    record: rec?.p ?? null,
    verified: null,
    thin: !!pr && pr.n < 50,
    rising: 0,
    recordFresh: !isNaN(recDate) && Date.now() - recDate < 365 * 86400e3 ? rec!.d.slice(0, 4) : null,
    liveLots: lots,
    topScore: lots.length ? mattersOf(lots) : -1,
    kind: s ? 'subject' : 'rest',
    dossierHref: dossier ? `/player?id=${encodeURIComponent(s!.playerSlug!)}` : null,
    // "+N more" / "See every lot": the athlete's dossier (its live book is
    // this row's pool), else the market's feed scoped to exactly this row
    href: dossier ? `/player?id=${encodeURIComponent(s!.playerSlug!)}` : subjectFeedHref(g.market, s ? s.key : OTHER),
    followKey: dossier ? s!.playerSlug : null,
  };
}

export default function MakersPage() {
  // LAZY CORPUS (Sep 2026 perf pass). EVERY FIGURE on this page is phase-1
  // eager: the directory rows read statsByArtist (stats.json), the verified
  // reads read market.json, and the live book / flags read the eager upcoming
  // lots — which carry every live lot, so those counts are complete without
  // the corpus. The ONLY corpus consumer is heroBySlug: the maker face photo
  // (and the dossier's hero banner), sourced from the maker's own highest-
  // value photographed lot. That is decorative progressive enhancement, never
  // a figure that could mislead — so the ~35MB stream now waits for a reader
  // who is actually looking: opening a dossier, or the first scroll/keypress/
  // pointer on the directory. A bounce pays nothing.
  const { allLots, statsByArtist, lastCrawl, loading, fromCache, market: marketData, demand, requestFullLots } =
    useFullLotsOnDemand(false);
  const { market } = useMarket();
  const activeKey = MARKETS.find(m => m.key === market)?.live ? market : 'all';
  const activeLabel = activeKey === 'all' ? 'full' : activeKey === 'tcg' ? 'TCG' : MARKETS.find(m => m.key === activeKey)!.label.toLowerCase();
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const { savedIds } = useSavedLots();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  // follows ride the saved-search plumbing (FollowButton's exact semantics)
  const { authEnabled, user, openLogin } = useAuth();
  const { searches, save: saveSearch, remove: removeSearch } = useSavedSearches();
  const { follows: allFollows, toggle: toggleCatFollow } = useFollows();
  const followedSet = useMemo(() => {
    const s = new Set<string>();
    for (const sr of searches) {
      const p = (sr.query as { player?: string }).player;
      if (p) s.add(p);
    }
    // sub-category rows (c:<cat>:<sub>) — category follows, signed in or not
    for (const f of allFollows) if (f.kind === 'cat' && f.key.includes(':')) s.add(`${SUBROW}${f.key}`);
    return s;
  }, [searches, allFollows]);

  // ── controls — restored from the URL, written back (owned keys only) ──
  const [q, setQ] = useState('');
  const [fLive, setFLive] = useState(false);
  const [fVerified, setFVerified] = useState(false);
  const [fFlagged, setFFlagged] = useState(false);
  const [fFollowing, setFFollowing] = useState(false);
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  // sports collection rows: one sport at a time (cat-stats "cat:sub:sport")
  const [sportPick, setSportPick] = useState<string | null>(null);
  // collection markets: subject rows (default) or the clean sub-category rows
  const [rowsBy, setRowsBy] = useState<RowsBy>('name');
  // rows shown per collection group before "Show more" — keyed to the cut,
  // so any re-cut (filters, sort, search, market) starts back at page one
  const [capState, setCapState] = useState<{ k: string; caps: Partial<Record<Market, number>> }>({ k: '', caps: {} });
  // the triage row narrows each maker's LIVE book (window, sub-category,
  // house, value floor, new); the roster's sold history is untouched
  const [triage, setTriage] = useUrlState<TriageFilters>(TRIAGE_DEFAULTS, triageFromParams, triageToParams);
  const prevVisitDay = useLastVisit();
  // a house's first-crawl flood is not "new" (feed-filters houseBaselines)
  const baselines = useMemo(() => houseBaselines(allLots), [allLots]);
  // sub-categories are market-scoped: drop them on a real market flip (never on mount)
  const triageMarket = useRef(activeKey);
  useEffect(() => {
    if (triageMarket.current === activeKey) return;
    triageMarket.current = activeKey;
    setTriage(t => (t.cat || t.sub ? { ...t, cat: null, sub: null } : t));
    setSportPick(null);
  }, [activeKey, setTriage]);
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
    if (p.get('by') === 'cat') setRowsBy('cat');
    const sp = p.get('spk');
    if (sp && SPORTS.some(x => x.key === sp)) setSportPick(sp);
    const c = p.get('cols');
    if (c) {
      const parsed = c.split('.').filter((k): k is ColKey => COLS.some(x => x.k === k));
      if (parsed.length) setCols(parsed);
    }
    const o = p.get('open');
    if (o && (ARTISTS.some(a => a.slug === o) || o.startsWith(SUBJECT_ROW) || o.startsWith(SUBROW))) { setOpen(o); deepLinked.current = true; }
  }, []);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    ['q', 'on', 'vi', 'fl', 'fw', 'sort', 'cols', 'open', 'spk', 'by'].forEach(k => p.delete(k));
    if (sportPick) p.set('spk', sportPick);
    if (rowsBy === 'cat') p.set('by', 'cat');
    if (q.trim()) p.set('q', q.trim());
    if (fLive) p.set('on', '1');
    if (fVerified) p.set('vi', '1');
    if (fFlagged) p.set('fl', '1');
    if (fFollowing) p.set('fw', '1');
    if (sort !== DEFAULT_SORT) p.set('sort', sort);
    if (cols.join('.') !== DEFAULT_COLS.join('.')) p.set('cols', cols.join('.'));
    if (open) p.set('open', open);
    const qs = p.toString();
    try {
      window.history.replaceState(window.history.state, '', `${qs ? `?${qs}` : window.location.pathname}${window.location.hash}`);
    } catch { /* ignore */ }
  }, [q, fLive, fVerified, fFlagged, fFollowing, sort, cols, open, sportPick, rowsBy]);

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
  // THE FACES now ship precomputed (pages/page-stats.json makerFaces — the
  // exact loop below, run once at build over the same served book). The
  // corpus path survives only for a data build without page-stats.
  const [pageStats, setPageStats] = useState<PageStats | null | undefined>(undefined);
  useEffect(() => {
    let on = true;
    loadPageStats().then(p => { if (on) setPageStats(p); });
    return () => { on = false; };
  }, []);
  const facesFallback = pageStats === null;
  const askCorpus = useCallback(() => { if (facesFallback) requestFullLots(); }, [facesFallback, requestFullLots]);
  const heroBySlug = useMemo(() => {
    const best = new Map<string, { url: string; val: number }>();
    if (pageStats?.makerFaces) {
      for (const [slug, f] of Object.entries(pageStats.makerFaces)) best.set(slug, f);
      return best;
    }
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
  }, [allLots, pageStats]);

  // ── THE LIVE BOOK + THE ENGINE'S READ, one pass over the eager set ──
  // The rows read the DEFERRED filters: a chip press repaints the chip at
  // once and the ledger re-cuts right behind it (was ~400ms blocked per click).
  const dTriage = useDeferredValue(triage);
  const dSport = useDeferredValue(sportPick);
  const liveAll = useMemo(() => sortByPriority(livePool(allLots)), [allLots]);
  // the sport pick narrows the SPORTS market's lots (by the lot's market, the
  // same membership the triage counts use — a sport-less lot never passes it)
  const sportOk = useCallback((l: AuctionLot, sp: string | null) =>
    !sp || marketOf(l.artist) !== 'sports' || taxonOf(l).sport === sp, []);
  // THE ONE FILTERED POOL every row, count and dossier below derives from —
  // a row's live count is exactly the lots it would list
  const livePass = useMemo(() => {
    const today = localToday();
    // sorted ONCE, what matters most first — every row's lot list below is a
    // stable in-order slice of it, so no row re-sorts
    return liveAll.filter(l => sportOk(l, dSport) && passesTriage(l, dTriage, { today, prevVisitDay, baselines }));
  }, [liveAll, dTriage, dSport, sportOk, prevVisitDay, baselines]);
  const filtersOn = isTriageActive(dTriage) || !!dSport;
  const liveBySlug = useMemo(() => {
    const m = new Map<string, { lots: AuctionLot[]; flags: number }>();
    for (const l of livePass) {
      let e = m.get(l.artist);
      if (!e) m.set(l.artist, e = { lots: [], flags: 0 });
      e.lots.push(l);
      if (l.signal?.label === 'Below Market') e.flags++;
    }
    // what matters most first: livePass is already in priority order
    return m;
  }, [livePass]);
  // every live lot in the active market — the masthead's "of N"
  const marketLiveAll = useMemo(() => liveAll.filter(l => mktSet.has(l.artist)), [liveAll, mktSet]);
  // …and inside the sport pick, for the triage row's chip counts
  const marketLive = useMemo(() => (sportPick ? marketLiveAll.filter(l => sportOk(l, sportPick)) : marketLiveAll), [marketLiveAll, sportPick, sportOk]);

  // sold stats per clean category / sub / sport (scripts/cat-stats, nightly)
  const [catStats, setCatStats] = useState<Record<string, CatStat> | null>(null);
  useEffect(() => {
    let on = true;
    fetch('/data/ray/cat-stats.json').then(r => (r.ok ? r.json() : null))
      .then(j => { if (on && j?.rows) setCatStats(j.rows); }).catch(() => {});
    return () => { on = false; };
  }, []);

  const makerRows = useMemo<Row[]>(() => ARTISTS.map(a => {
    const st = statsByArtist[a.slug] || null;
    const hist = completeQuarters(st?.priceHistory || []);
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
    const st12 = st as (typeof st & { sold12m?: number; sold12mWindow?: { days: number } }) | null;
    const velocityTrue = !!st12 && typeof st12.sold12m === 'number' && st12.sold12mWindow?.days === 365;
    const tail = hist.slice(-4);
    const tailCount = tail.reduce((s, p) => s + (p.totalSales || 0), 0);
    const tailSince = tail.length ? String(tail[0].date).slice(0, 4) : null;
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
      // "12mo sold" only from compute-stats' calendar-365 field; the old
      // slice(-4) (last four NON-EMPTY quarters) spans years on a thin maker
      // and prints with its true span instead
      velocity: velocityTrue ? st12!.sold12m! : tailCount,
      velocitySince: velocityTrue ? null : tailSince,
      record: st?.recordPrice || null,
      verified: verifiedBySlug.get(a.slug) || null,
      thin: sold != null && sold > 0 && sold < 50,
      rising,
      recordFresh,
      liveLots: liveE?.lots || [],
      topScore: liveE?.lots.length ? mattersOf(liveE.lots) : -1,
    };
  }), [statsByArtist, heroBySlug, liveBySlug, verifiedBySlug]);

  // live lots per clean sub (same triage as the maker rows), best first
  const liveBySub = useMemo(() => {
    const m = new Map<string, AuctionLot[]>();
    for (const l of livePass) {
      const t = taxonOf(l);
      const k = `${t.cat}:${t.sub}`;
      const arr = m.get(k); if (arr) arr.push(l); else m.set(k, [l]);
    }
    return m;
  }, [livePass]);

  const subRows = useMemo<Row[]>(() => {
    if (!catStats) return [];
    const out: Row[] = [];
    for (const c of COLLECTION_CATS) {
      for (const sub of SUBS[c.cat]) {
        const key = `${c.cat}:${sub.key}`;
        const sportsCat = c.cat === 'sports-cards' || c.cat === 'sports-memorabilia';
        const st = catStats[sportsCat && dSport ? `${key}:${dSport}` : key] || null;
        const lots = liveBySub.get(key) || [];
        if (!st && !lots.length) continue;
        const hist = completeQuarters((st?.q || []).map(([date, med, n]) => ({ date, medianPrice: med, avgPrice: med, totalSales: n, highPrice: 0 })));
        const meds = hist.map(h => h.medianPrice).filter(v => v > 0);
        let rising = 0;
        for (let i = meds.length - 1; i > 0 && meds[i] > meds[i - 1]; i--) rising++;
        const recDate = st?.record?.date ? Date.parse(st.record.date) : NaN;
        const stats = st ? ({
          totalSoldTracked: st.sold, sold12m: st.sold12m, medianPriceLast12Months: st.median12m,
          totalAuctionRevenue: st.revenue, priceHistory: hist, houseDistribution: [],
          recordPrice: st.record?.price ?? 0, recordTitle: st.record?.title ?? '', recordDate: st.record?.date ?? '',
          recordHouse: st.record?.house ?? '',
        } as unknown as MarketStats) : null;
        const params = new URLSearchParams({ cat: c.cat, sub: sub.key, tab: 'all' });
        out.push({
          slug: `${SUBROW}${key}`,
          label: c.prefix && !(c.cat === 'tcg' && sub.key === 'other-tcg') ? `${c.prefix} · ${sub.label}` : sub.label,
          market: c.market,
          discipline: sportsCat && dSport ? (SPORTS.find(x => x.key === dSport)?.label ?? null) : CAT_LABEL[c.cat],
          stats,
          hero: lots.find(l => l.imageUrl)?.imageUrl || null,
          spark: meds.length >= 4 ? meds : null,
          live: lots.length,
          flags: lots.filter(l => l.signal?.label === 'Below Market').length,
          sold: st?.sold ?? null,
          median: st?.median12m || null,
          revenue: st?.revenue ?? 0,
          velocity: st?.sold12m ?? 0,
          velocitySince: null,
          record: st?.record?.price ?? null,
          verified: null,
          thin: !!st && st.sold < 50,
          rising,
          recordFresh: !isNaN(recDate) && Date.now() - recDate < 365 * 86400e3 ? String(st!.record!.date).slice(0, 4) : null,
          liveLots: lots,
          topScore: lots.length ? mattersOf(lots) : -1,
          href: `/?${params.toString()}`,
          kind: 'sub',
        });
      }
    }
    return out;
  }, [catStats, liveBySub, dSport]);

  // ── THE SUBJECT ROWS — players, Pokémon, people, films, franchises,
  // missions (app/lib/maker-subjects), straight off the filtered pool ──
  // (art / design / watches pages never show a subject row — skip the ~100ms
  // first read of every card title there)
  const needSubjects = rowsBy === 'name' && (activeKey === 'all' || SUBJECT_MARKETS.has(activeKey));
  const subjectGroups = useMemo(() => (needSubjects ? groupBySubject(livePass) : new Map<string, SubjectGroup<AuctionLot>>()), [livePass, needSubjects]);
  // athletes' sold history (players.json, ~3MB) — only where athlete rows show,
  // after first paint; until it lands their history cells print the dash
  const [players, setPlayers] = useState<Map<string, PlayerRec> | null>(null);
  const wantPlayers = rowsBy === 'name' && (activeKey === 'all' || activeKey === 'sports');
  useEffect(() => {
    if (!wantPlayers || players) return;
    let on = true;
    const t = window.setTimeout(() => {
      fetch('/data/ray/players.json').then(r => (r.ok ? r.json() : null))
        .then((j: { players?: PlayerRec[] } | null) => {
          if (on && j?.players) setPlayers(new Map(j.players.map(p => [p.slug, p])));
        }).catch(() => {});
    }, 300);
    return () => { on = false; window.clearTimeout(t); };
  }, [wantPlayers, players]);
  const dossierSet = useMemo(() => new Set((pageStats?.playerIndex || []).map(p => p.slug)), [pageStats]);
  const subjectRows = useMemo<Row[]>(
    () => Array.from(subjectGroups.values()).map(g => subjectRow(g, players, dossierSet)),
    [subjectGroups, players, dossierSet]
  );

  // collection markets list subjects (default) or, "By category", the clean
  // sub rows once cat-stats has loaded; art/design/watches keep their makers
  const rows = useMemo<Row[]>(() => {
    const coll = rowsBy === 'name' ? subjectRows : subRows;
    if (rowsBy === 'cat' && !coll.length) return makerRows;
    return [...makerRows.filter(r => !COLLECTION_MARKETS.has(r.market)), ...coll];
  }, [makerRows, subRows, subjectRows, rowsBy]);
  const inMarket = useCallback((r: Row) => activeKey === 'all' || r.market === activeKey, [activeKey]);
  // the roster as shown — collection markets count their rows (never the
  // "Other lots" remainder), not slugs
  const rosterTotal = useMemo(() => rows.filter(r => inMarket(r) && r.kind !== 'rest').length, [rows, inMarket]);
  const rowNoun = useCallback((m: Market, n: number) =>
    (rowsBy === 'name' && SUBJECT_MARKETS.has(m) ? (n === 1 ? 'name' : 'names') : rosterNoun(m, n)), [rowsBy]);
  const noun = activeKey === 'all' ? (rosterTotal === 1 ? 'tracked name' : 'tracked names') : rowNoun(activeKey, rosterTotal);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const cmp = (a: Row, b: Row): number => {
      switch (sort) {
        case 'matters': return b.topScore - a.topScore || b.live - a.live || (b.sold ?? 0) - (a.sold ?? 0);
        case 'live': return b.live - a.live || (b.sold ?? 0) - (a.sold ?? 0);
        case 'flags': return b.flags - a.flags || b.live - a.live;
        case 'median': return (b.median ?? -1) - (a.median ?? -1);
        case 'delta': return (b.verified?.changePct ?? -Infinity) - (a.verified?.changePct ?? -Infinity);
        case 'name': return a.label.localeCompare(b.label);
        default: return (b.sold ?? 0) - (a.sold ?? 0);
      }
    };
    return rows
      .filter(inMarket)
      .filter(r => !needle || r.label.toLowerCase().includes(needle) || (r.discipline ?? '').toLowerCase().includes(needle)
        // the label vocabulary on the row's live lots — "PSA 10", "GMT", "Apollo", a player
        || r.liveLots.some(l => searchTextOf(l).includes(needle)))
      .filter(r => !fLive || r.live > 0)
      .filter(r => !fVerified || !!r.verified)
      .filter(r => !fFlagged || r.flags > 0)
      // a filtered book shows only the rows with a live lot passing it
      .filter(r => !filtersOn || r.live > 0)
      .filter(r => !fFollowing || followedSet.has(r.followKey ?? r.slug))
      // the remainder row always closes its group
      .sort((a, b) => (a.kind === 'rest' ? 1 : 0) - (b.kind === 'rest' ? 1 : 0) || cmp(a, b));
  }, [rows, inMarket, q, fLive, fVerified, fFlagged, fFollowing, followedSet, sort, filtersOn]);

  const cutKey = JSON.stringify([dTriage, dSport, q, sort, rowsBy, activeKey, fLive, fVerified, fFlagged, fFollowing]);
  const caps = capState.k === cutKey ? capState.caps : NO_CAPS;
  const showMore = (m: Market) => setCapState(st => {
    const cur = st.k === cutKey ? st.caps : {};
    return { k: cutKey, caps: { ...cur, [m]: (cur[m] ?? (activeKey === 'all' ? CAP_ALL : CAP_ONE)) + CAP_STEP } };
  });

  const groups = useMemo(() =>
    MARKETS
      .filter(m => m.key !== 'all' && (activeKey === 'all' || m.key === activeKey))
      .map(m => {
        const g = visible.filter(r => r.market === m.key);
        // subject groups page: the first `cap` names, then the remainder row
        let shown = g, more = 0;
        if (rowsBy === 'name' && SUBJECT_MARKETS.has(m.key)) {
          const cap = caps[m.key] ?? (activeKey === 'all' ? CAP_ALL : CAP_ONE);
          const named = g.filter(r => r.kind !== 'rest');
          if (named.length > cap) {
            shown = [...named.slice(0, cap), ...g.filter(r => r.kind === 'rest')];
            more = named.length - cap;
          }
        }
        const live = g.reduce((s, r) => s + r.live, 0);
        const flags = g.reduce((s, r) => s + r.flags, 0);
        const revenue = g.reduce((s, r) => s + r.revenue, 0);
        const soldMax = Math.max(1, ...rows.filter(r => r.market === m.key).map(r => r.sold ?? 0));
        const ds = demand?.[m.key] || [];
        const demandNow = ds.length ? ds[ds.length - 1].value : null;
        return { key: m.key as Market, label: m.label, rows: g, shown, more, live, flags, revenue, soldMax, demandNow };
      })
      .filter(g => g.rows.length > 0),
    [visible, rows, activeKey, demand, rowsBy, caps]);

  const cockpit = useMemo(() =>
    MARKETS
      .filter(m => m.key !== 'all' && (activeKey === 'all' || m.key === activeKey))
      .map(m => {
        const g = rows.filter(r => r.market === m.key);
        const ds = demand?.[m.key] || [];
        return {
          key: m.key as Market, label: m.label,
          makers: g.filter(r => r.kind !== 'rest').length,
          live: g.reduce((s, r) => s + r.live, 0),
          flags: g.reduce((s, r) => s + r.flags, 0),
          demandNow: ds.length ? ds[ds.length - 1].value : null,
        };
      }),
    [rows, activeKey, demand]);

  const totalLive = useMemo(() => rows.filter(inMarket).reduce((s, r) => s + r.live, 0), [rows, inMarket]);
  const totalFlags = useMemo(() => rows.filter(inMarket).reduce((s, r) => s + r.flags, 0), [rows, inMarket]);
  const verifiedCount = useMemo(() => rows.filter(r => inMarket(r) && r.verified).length, [rows, inMarket]);

  // ── THE VERIFIED READ — the strongest CI-verified maker move currently
  // published on the active book: largest |Δ| among the same verifiedMovers
  // rows the ledger already prints (no re-derivation). LAMP LAW: the color
  // cell's dir comes from the REAL sign of the published changePct — a zero
  // (unpublishable by construction, guarded anyway) falls to ink. ──
  const topVerified = useMemo(() => {
    let best: Row | null = null;
    // makerRows, not rows: the verified indices live on the roster slugs
    // (e.g. sports-cards), which collection markets now show as sub rows
    for (const r of makerRows) {
      if (!mktSet.has(r.slug) || !r.verified) continue;
      if (!best || Math.abs(r.verified.changePct) > Math.abs(best.verified!.changePct)) best = r;
    }
    return best;
  }, [makerRows, mktSet]);

  // ── stable callbacks for the memoized rows ──
  // opening a dossier is the explicit ask for the maker's own photograph —
  // the corpus is the only place that image comes from
  const onToggleOpen = useCallback((slug: string) => {
    askCorpus();
    setOpen(o => (o === slug ? null : slug));
  }, [askCorpus]);
  const onToggleCompare = useCallback((slug: string) => {
    setCompare(c => c.includes(slug) ? c.filter(s => s !== slug) : c.length >= 4 ? c : [...c, slug]);
  }, []);
  const onToggleFollow = useCallback((slug: string, label: string) => {
    if (slug.startsWith(SUBROW)) {
      const [cat, sub] = slug.slice(SUBROW.length).split(':') as [CatKey, string];
      void toggleCatFollow(catFollow(cat, sub));
      return;
    }
    if (!user) { openLogin(); return; }
    const existing = searches.find(s => (s.query as { player?: string }).player === slug);
    if (existing) void removeSearch(existing.id);
    else void saveSearch(`Following ${label}`, { player: slug, playerName: label });
  }, [user, openLogin, searches, removeSearch, saveSearch, toggleCatFollow]);

  /* PRE-WARM on the first sign of engagement — one shot, passive listeners,
     removed the moment it fires. First paint stays free of the corpus; a
     reader who scrolls or reaches for the keyboard gets the faces streaming
     before they open anything. (Deep-linked ?open= asks for it outright.) */
  useEffect(() => {
    if (!facesFallback) return;             // faces ship in page-stats — no corpus
    if (deepLinked.current) { requestFullLots(); return; }
    const ev = ['scroll', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    const fire = () => { off(); requestFullLots(); };
    const off = () => ev.forEach(e => window.removeEventListener(e, fire));
    ev.forEach(e => window.addEventListener(e, fire, { passive: true, once: true }));
    return off;
  }, [requestFullLots, facesFallback]);

  // deep link ?open= — land on the dossier once the ledger has painted.
  // `open` is a dep too: on a WARM cache loading is already false at mount,
  // so the restore effect's setOpen lands on a LATER render — without `open`
  // in deps this never re-fires and the deep link silently never scrolls.
  // The deepLinked ref makes it fire exactly once regardless.
  useEffect(() => {
    if (loading || !deepLinked.current || !open) return;
    deepLinked.current = false;
    // Back from a lot: return to the exact scroll the reader left (saved
    // below), not a re-centred row (~340px jump). A fresh shared link centres.
    let saved: number | null = null;
    try {
      const v = sessionStorage.getItem(SCROLL_KEY + window.location.pathname + window.location.search);
      if (v != null && Number.isFinite(Number(v))) saved = Number(v);
    } catch { /* ignore */ }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (saved != null) window.scrollTo({ top: saved, behavior: 'instant' as ScrollBehavior });
      else document.querySelector(`[data-mk-flip="${open}"]`)?.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
    }));
  }, [loading, open]);
  // remember where the reader was when they leave for a lot (or the page)
  useEffect(() => {
    const save = () => {
      try { sessionStorage.setItem(SCROLL_KEY + window.location.pathname + window.location.search, String(Math.round(window.scrollY))); } catch { /* ignore */ }
    };
    const onClick = (e: MouseEvent) => { if ((e.target as HTMLElement | null)?.closest?.('a[href]')) save(); };
    document.addEventListener('click', onClick, true);
    window.addEventListener('pagehide', save);
    return () => { document.removeEventListener('click', onClick, true); window.removeEventListener('pagehide', save); };
  }, []);

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
  const flipKey = groups.map(g => g.shown.map(r => r.slug).join(',')).join('|');
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

  // the sticky bar wraps to two rows on narrower desktops — the group heads
  // stick under its MEASURED height, never behind it
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--mk-bar-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    });
    ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--mk-bar-h'); };
  }, [loading]);

  const jumpTo = useCallback((key: Market) => {
    document.getElementById(`mk-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const gridTemplate = useMemo(() =>
    `30px minmax(0,1fr) ${cols.map(k => COLS.find(c => c.k === k)!.width).join(' ')} 18px`,
    [cols]);

  // the roster split the masthead prints: real makers · named subjects (or categories)
  const rosterSplit = useMemo(() => {
    let makers = 0, other = 0;
    for (const r of rows) {
      if (!inMarket(r) || r.kind === 'rest') continue;
      if (r.kind === 'subject' || r.kind === 'sub') other++; else makers++;
    }
    return { makers, other };
  }, [rows, inMarket]);
  // sport pills count the market's lots under every other filter
  const sportCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (activeKey !== 'sports') return m;
    const today = localToday();
    for (const l of marketLiveAll) {
      if (!passesTriage(l, dTriage, { today, prevVisitDay, baselines })) continue;
      const sp = taxonOf(l).sport;
      if (sp) m.set(sp, (m.get(sp) || 0) + 1);
    }
    return m;
  }, [activeKey, marketLiveAll, dTriage, prevVisitDay, baselines]);
  // a search the names can't answer is offered to the lots (home feed search)
  const searchLots = useMemo(() => {
    const needle = q.trim();
    if (!needle) return 0;
    const today = localToday();
    let n = 0;
    for (const l of marketLiveAll) if (feedQueryMatches(l, needle) && passesTriage(l, dTriage, { today, prevVisitDay, baselines })) n++;
    return n;
  }, [q, marketLiveAll, dTriage, prevVisitDay, baselines]);
  // the triage chips offer only this market's own categories (a stray film
  // piece filed under a sports pseudo-maker is still counted, never chipped)
  const marketCats = useMemo<CatKey[] | undefined>(() => {
    if (activeKey === 'all') return undefined;
    return MARKET_CATS[activeKey];
  }, [activeKey]);
  const nameHead = rowsBy === 'cat' && activeKey !== 'all' && SUBJECT_MARKETS.has(activeKey) ? 'Category' : activeKey === 'all' ? 'Maker · name' : NAME_HEAD[activeKey] ?? 'Maker';

  return (
    <div className="terminal-shell" style={{ minHeight: '100vh', fontFamily: 'var(--font-sans), sans-serif' }}>
      <style dangerouslySetInnerHTML={{ __html: MAKERS_CSS }} />
      {/* the column set is dynamic — the grid template rides a CSS var */}
      <style dangerouslySetInnerHTML={{ __html: `@media(min-width:940px){.mk-row,.mk-group-head .mk-cols{grid-template-columns:${gridTemplate}}}` }} />
      <ArtistNav activeSlug="artists" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          <section className="rail ray-enter" style={{ paddingTop: 24, paddingBottom: 4 }}>
            <div style={{ marginBottom: 22 }}><MarketSwitch compact /></div>
            <Masthead
              kicker={`The roster · ${activeLabel} market`}
              datum={activeKey === 'all'
                // the full roster is 32 named makers + 22 category pseudo-
                // artists — "54 tracked names" counted categories as names
                ? `${rosterSplit.makers} makers · ${rosterSplit.other.toLocaleString()} ${rowsBy === 'name' ? 'names' : 'categories'}`
                : <CountUp to={rosterTotal} format={n => `${Math.round(n)} ${noun}`} duration={900} animate={!fromCache} />}
              title={<>Every maker, one <Accent>ledger</Accent>.</>}
              sub={
                <>
                  {filtersOn
                    ? <><b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{totalLive.toLocaleString()} of {marketLiveAll.length.toLocaleString()} live lots</b> match the filters</>
                    : <><b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{totalLive.toLocaleString()} live lots</b> on the block</>}
                  {totalFlags > 0 && <> · <b style={{ color: 'var(--color-fg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{totalFlags}</b> flagged by the engine</>}
                  {verifiedCount > 0 && <> · {verifiedCount} CI-verified indexes</>}
                </>
              }
            />
          </section>

          {/* ── THE COCKPIT ── */}
          {activeKey === 'all' && (
            <section className="rail ray-enter mk-cockroom" style={{ '--enter-delay': '30ms', paddingTop: 4, paddingBottom: 2 } as React.CSSProperties}>
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
                      {c.makers.toLocaleString()} {rowNoun(c.key, c.makers)}
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
            {/* hairline rows, not a bento (de-slop law 7): four facts, one
                ruled ledger — no orphan card on a 4-track grid */}
            <div className="mk-facts" role="list">
              {(() => {
                const v = topVerified && topVerified.verified ? topVerified.verified : null;
                const dir = v ? (v.changePct > 0 ? 'up' : v.changePct < 0 ? 'down' : undefined) : undefined;
                const facts: { k: string; stat: string; note: string; body: string; dir?: string; href?: string }[] = [
                  v ? {
                    k: `The verified read · ${v.horizon}`,
                    stat: `${v.changePct >= 0 ? '+' : '−'}${Math.abs(Math.round(v.changePct))}%`,
                    note: topVerified!.label,
                    body: `The strongest CI-verified move on the ${activeLabel} book · 95% CI ${Math.round(v.ciLoPct)}% to ${Math.round(v.ciHiPct)}% · n ${v.n.toLocaleString()}`,
                    dir, href: `/makers/${topVerified!.slug}`,
                  } : {
                    k: 'The verified read', stat: '—', note: 'abstaining',
                    body: `No CI-verified index on the ${activeLabel} book yet — a maker publishes a move only when its 95% interval resolves the sign.`,
                  },
                  { k: 'The roster', stat: activeKey === 'all' ? rosterSplit.makers.toLocaleString() : rosterTotal.toLocaleString(), note: activeKey === 'all' ? `makers · ${rosterSplit.other.toLocaleString()} ${rowsBy === 'name' ? 'names' : 'categories'}` : noun, body: `Every name lectr tracks on the ${activeLabel} book — sold history, live lots and the engine's flags in one ledger.` },
                  { k: 'Verified indexes', stat: verifiedCount.toLocaleString(), note: 'CI-verified indexes', body: 'Repeat-sales reads whose 95% interval resolves the sign — the only price moves the engine will stand behind.' },
                  { k: 'On the block', stat: totalFlags.toLocaleString(), note: 'flagged by the engine', body: totalFlags > 0
                    ? `${totalLive.toLocaleString()} live ${totalLive === 1 ? 'lot' : 'lots'} on the book tonight — ${totalFlags.toLocaleString()} priced under ${totalFlags === 1 ? 'its' : 'their'} comparables.`
                    : totalLive > 0 ? `${totalLive.toLocaleString()} live ${totalLive === 1 ? 'lot' : 'lots'} on the book tonight — none flagged under its comparables.` : 'The book is quiet — the crawl refreshes daily.' },
                ];
                return facts.map(f => {
                  const inner = (
                    <>
                      <span className="mk-fact-k">{f.k}<span className="mk-fact-body">{f.body}</span></span>
                      <span className="mk-fact-v"><b data-dir={f.dir}>{f.stat}</b><span>{f.note}</span></span>
                    </>
                  );
                  return f.href
                    ? <Link key={f.k} role="listitem" href={f.href} className="mk-fact">{inner}</Link>
                    : <div key={f.k} role="listitem" className="mk-fact" data-abstain={f.note === 'abstaining' || undefined}>{inner}</div>;
                });
              })()}
            </div>
          </section>

          {/* ── THE TRIAGE ROW (Oct 8) — narrows every maker's live book ── */}
          <div className="rail" style={{ marginTop: 10 }}>
            <TriageBar
              lots={marketLive}
              filters={triage}
              onChange={setTriage}
              prevVisitDay={prevVisitDay}
              baselines={baselines}
              cats={marketCats}
              shown={totalLive}
              total={marketLiveAll.length}
              label="Narrow the live lots"
            />
            {activeKey === 'sports' && (
              <div className="ray-triagebar-row ray-triagebar-subs ray-markets-fade mk-sports" role="group" aria-label="Sport">
                <button type="button" className="ray-toolbar-pill" data-active={sportPick == null} aria-pressed={sportPick == null} onClick={() => setSportPick(null)}>All sports</button>
                {/* biggest first like the home feed's sport chips, the catch-all last */}
                {SPORTS.filter(sp => (sportCounts.get(sp.key) || 0) > 0 || sportPick === sp.key)
                  .sort((a, b) => (a.key === 'other-sports' ? 1 : 0) - (b.key === 'other-sports' ? 1 : 0) || (sportCounts.get(b.key) || 0) - (sportCounts.get(a.key) || 0))
                  .map(sp => (
                  <button key={sp.key} type="button" className="ray-toolbar-pill" data-active={sportPick === sp.key} aria-pressed={sportPick === sp.key}
                    onClick={() => setSportPick(sportPick === sp.key ? null : sp.key)}>
                    {sp.label} <i>{(sportCounts.get(sp.key) || 0).toLocaleString()}</i>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── THE FILTER BAR ── */}
          <div className="mk-bar-wrap" ref={barRef}>
            <div className="rail mk-bar">
              <label className="mk-search">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5" />
                </svg>
                <input
                  ref={searchRef}
                  type="search" value={q} onChange={e => setQ(e.target.value)}
                  placeholder={activeKey === 'sports' ? 'Filter players…' : SUBJECT_MARKETS.has(activeKey) || activeKey === 'all' ? 'Filter names…' : 'Filter makers…'} aria-label="Filter the roster"
                />
                {q ? (
                  <button type="button" className="mk-clear" onClick={() => setQ('')} aria-label="Clear filter">×</button>
                ) : (
                  <kbd className="mk-kbd" aria-hidden>/</kbd>
                )}
              </label>
              {/* phone: the chips ride one swipeable strip under the search */}
              <span className="mk-bar-chips">
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
              {(activeKey === 'all' || SUBJECT_MARKETS.has(activeKey)) && (
                <div className="ray-seg mk-seg mk-by" role="tablist" aria-label="Rows in the collection markets">
                  {([['name', 'By name'], ['cat', 'By category']] as [RowsBy, string][]).map(([k, label]) => (
                    <button key={k} type="button" role="tab" className="ray-seg-btn" data-active={rowsBy === k}
                      aria-selected={rowsBy === k} onClick={() => setRowsBy(k)}
                      title={k === 'name' ? 'Players, Pokémon, people, films, franchises and missions' : 'Clean sub-categories, with their sold history'}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              </span>
              <span className="mk-bar-rule" aria-hidden />
              <span className="mk-count" title="Roster rows shown">{visible.filter(r => r.kind !== 'rest').length.toLocaleString()} of {rosterTotal.toLocaleString()}</span>
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
              <div className="ray-seg mk-seg mk-sortseg" role="tablist" aria-label="Sort the directory">
                {SORTS.map(s => (
                  <button key={s.k} type="button" role="tab" className="ray-seg-btn" data-active={sort === s.k}
                    aria-selected={sort === s.k} onClick={() => setSort(s.k)} title={SORT_NOTE[s.k]}>
                    {s.label}
                  </button>
                ))}
              </div>
              {/* phone: one select instead of seven wrapping tabs */}
              <select className="ray-toolbar-pill ray-toolbar-select mk-sortsel" aria-label="Sort the directory" data-active={sort !== DEFAULT_SORT}
                value={sort} onChange={e => setSort(e.target.value as SortKey)}>
                {SORTS.map(s => <option key={s.k} value={s.k}>Sort · {s.label}</option>)}
              </select>
            </div>
          </div>

          {/* ── THE DIRECTORY ── */}
          <section className="rail ray-enter" style={{ '--enter-delay': '40ms', paddingTop: 6, paddingBottom: compare.length ? 120 : 30 } as React.CSSProperties}>
            <div ref={listRef}>
              {groups.length === 0 ? (
                <div className="mk-empty">
                  {/* the empty state as a patent plate — the gate drawing:
                      many candidates fan in, none leaves under these filters */}
                  <FigureCell
                    figure={<FigGate />}
                    label="The directory"
                    body={<>
                      No {activeKey === 'sports' ? 'player' : 'name'} matches the current filters in the {activeLabel} market.
                      {q.trim() && searchLots > 0 && <>{' '}<Link className="mk-reset" href={feedSearchHref(activeKey, q, triage)}>Search {searchLots.toLocaleString()} live {searchLots === 1 ? 'lot' : 'lots'} for &ldquo;{q.trim()}&rdquo;</Link> ·</>}
                      {' '}<button type="button" className="mk-reset" onClick={() => { setQ(''); setFLive(false); setFVerified(false); setFFlagged(false); setFFollowing(false); setTriage(TRIAGE_DEFAULTS); setSportPick(null); }}>Clear the filters</button>
                    </>}
                  />
                </div>
              ) : groups.map(g => (
                <div key={g.key} id={`mk-${g.key}`} className="mk-group ns-plate">
                  <div className="mk-group-head">
                    <span className="mk-group-mark" aria-hidden><MarketIcon market={g.key} size={15} /></span>
                    <h2 className="mk-group-name">{g.label}</h2>
                    <span className="mk-group-count">{g.rows.filter(r => r.kind !== 'rest').length.toLocaleString()}</span>
                    <span className="mk-group-rule" aria-hidden />
                    <span className="mk-group-read">
                      {g.flags > 0 && <b className="mk-group-flags">{g.flags} flagged</b>}
                      {g.revenue > 0 && <>{g.flags > 0 ? ' · ' : ''}{fmtUsd(g.revenue)} settled</>}
                      {g.live > 0 && <>{(g.flags > 0 || g.revenue > 0) ? ' · ' : ''}{g.live.toLocaleString()} on the block</>}
                      {g.demandNow !== null && (
                        <>{(g.flags > 0 || g.revenue > 0 || g.live > 0) ? ' · ' : ''}demand <b data-dir={g.demandNow >= 0 ? 'up' : 'down'}>{formatDemand(g.demandNow)}</b></>
                      )}
                    </span>
                    {/* the column heads ride the sticky group head — always over their numbers */}
                    <div className="mk-cols" aria-hidden>
                      <span /><span className="kicker">{activeKey === 'all' && SUBJECT_MARKETS.has(g.key) && rowsBy === 'name' ? NAME_HEAD[g.key] : activeKey === 'all' && SUBJECT_MARKETS.has(g.key) ? 'Category' : activeKey === 'all' ? 'Maker' : nameHead}</span>
                      {cols.map(k => (
                        <span key={k} className="kicker mk-col-k" title={COL_NOTE[k]}>{COLS.find(c => c.k === k)!.label}</span>
                      ))}
                      <span className="kicker mk-col-mob">Median · live</span>
                      <span className="mk-col-end" />
                    </div>
                  </div>
                  <div className="mk-list">
                    {g.shown.map(r => (
                      <MakerRowItem
                        key={r.slug}
                        r={r} soldMax={g.soldMax} isOpen={open === r.slug} cols={cols}
                        isSel={compare.includes(r.slug)} isFollowed={followedSet.has(r.followKey ?? r.slug)} authEnabled={authEnabled}
                        onToggleOpen={onToggleOpen} onToggleCompare={onToggleCompare} onToggleFollow={onToggleFollow}
                      />
                    ))}
                    {g.more > 0 && (
                      <button type="button" className="mkx-live-more mk-more"
                        onClick={() => showMore(g.key)}>
                        Show {Math.min(CAP_STEP, g.more)} more · {g.more.toLocaleString()} more {g.key === 'sports' ? 'players' : 'names'} on the block
                      </button>
                    )}
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
.mk-cock-v em{font-style:normal;font-family:var(--font-mono),monospace;font-size:10.5px;font-weight:700;color:var(--color-fg);letter-spacing:0.02em}
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
/* the facts ledger — hairline rows (was a 5-unit bento with an orphan) */
.mk-facts{border-top:1px solid var(--color-border)}
.mk-fact{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 24px;align-items:baseline;padding:14px 2px;border-bottom:1px solid var(--color-border);color:inherit;text-decoration:none}
a.mk-fact:hover{background:var(--color-hover-item)}
a.mk-fact:focus-visible{outline:2px solid var(--color-fg);outline-offset:2px}
.mk-fact-k{font-size:14px;font-weight:500;color:var(--color-fg);min-width:0}
.mk-fact-body{display:block;font-size:12.5px;font-weight:400;color:var(--color-text-muted);line-height:1.5;margin-top:3px;max-width:68ch}
.mk-fact-v{text-align:right;white-space:nowrap}
.mk-fact-v b{display:block;font-family:var(--font-mono),monospace;font-size:26px;font-weight:500;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;color:var(--color-fg);line-height:1.1}
.mk-fact-v b[data-dir="up"]{color:var(--color-up)}
.mk-fact-v b[data-dir="down"]{color:var(--color-down-text)}
.mk-fact-v span{display:block;font-size:11.5px;color:var(--color-text-faint);margin-top:2px}
@media(max-width:560px){.mk-fact{grid-template-columns:1fr}.mk-fact-v{text-align:left;order:-1}.mk-fact-v b{display:inline;margin-right:8px}.mk-fact-v span{display:inline}}

/* ── the filter bar ── */
.mk-bar-wrap{position:sticky;top:54px;z-index:30;background:color-mix(in srgb,var(--surface-mix, #0b0c0e) 88%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--color-border)}
.mk-bar{display:flex;align-items:center;gap:8px;padding-top:9px;padding-bottom:9px;flex-wrap:wrap}
.mk-search{display:inline-flex;align-items:center;gap:7px;flex:0 1 210px;min-width:140px;padding:0 12px;height:30px;background:var(--color-bg-elevated);border:1px solid var(--color-border);border-radius:999px;color:var(--color-text-faint)}
.mk-search input{flex:1;min-width:0;background:none;border:none;outline:none;font-family:var(--font-sans),sans-serif;font-size:12.5px;color:var(--color-fg)}
.mk-search input::placeholder{color:var(--color-text-faint)}
.mk-search:focus-within{border-color:var(--color-fg);box-shadow:0 0 0 2px color-mix(in srgb,var(--color-fg) 22%,transparent)}
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
.mk-display-check{width:13px;flex:none;font-size:11px;color:var(--color-fg)}
.mk-display-reset{margin-top:5px;padding:6px 8px;background:none;border:none;border-top:1px solid var(--color-hair,rgba(255,255,255,0.06));font-family:var(--font-mono),monospace;font-size:10.5px;letter-spacing:0.06em;color:var(--color-text-faint);cursor:pointer;text-align:left}
.mk-display-reset:hover{color:var(--color-fg)}

/* ── column kickers — inside the sticky group head (Oct 9 r4) ── */
.mk-group-head{flex-wrap:wrap}
.mk-group-head .mk-cols{flex:0 0 100%;display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:12px;align-items:baseline;padding:6px 14px 0}
.mk-cols .kicker{font-size:10px;letter-spacing:0.14em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default}
.mk-col-k,.mk-col-end{display:none}
.mk-col-mob{text-align:right}
@media(min-width:940px){
  .mk-group-head .mk-cols{gap:14px;padding-right:64px}
  .mk-col-k{display:block;text-align:right}
  .mk-col-end{display:block}
  .mk-col-mob{display:none}
}

/* ── the paging row under a long subject group ── */
button.mkx-live-more{width:100%;background:none;border:none;border-top:1px solid var(--color-hair,rgba(255,255,255,0.05));cursor:pointer}
.mk-more{padding:12px}

/* ── sport pills / phone sort select ── */
.mk-sports{margin:-4px 0 12px}
.mk-bar .ray-toolbar-select{-webkit-appearance:none;appearance:none;cursor:pointer;padding-right:26px;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 13px) 52%,calc(100% - 9px) 52%;background-size:4px 4px,4px 4px;background-repeat:no-repeat}
@media(min-width:940px){.mk-sortsel{display:none}}
@media(max-width:939px){.mk-sortseg,.mk-display{display:none}}

/* ── phone: the ledger within reach — the market keypad already switches
   markets, so the cockpit tiles and the facts' prose stand down ── */
@media(min-width:701px){.mk-bar-chips{display:contents}}
@media(max-width:700px){
  .mk-cockroom{display:none}
  .mk-fact[data-abstain]{display:none}
  .mk-facts:has(.mk-fact[data-abstain]){border-top:none}
  .mk-bar-wrap{position:static}
  .mk-group .mk-group-head{top:65px}
  .mk-search{flex:1 1 0;min-width:0;order:0}
  .mk-sortsel{order:1;flex:none}
  .mk-bar-chips{order:2;flex:0 0 100%;display:flex;gap:8px;overflow-x:auto;scrollbar-width:none}
  .mk-bar-chips::-webkit-scrollbar{display:none}
  .mk-bar-chips .mk-chip{flex:none}
  .mk-count{display:none}
  .mk-by.mk-seg{order:0;flex:none;flex-basis:auto;overflow:visible}
  .mk-cellroom{padding-bottom:8px}
  .mk-fact:not(:first-child){display:none}
  .mk-fact-body{display:none}
}

/* ── group heads — rooms as framed plates, authority through lightness ── */
.mk-group{margin-bottom:22px;scroll-margin-top:150px}
.mk-group-head{position:sticky;top:calc(54px + var(--mk-bar-h, 49px));z-index:20;display:flex;align-items:center;gap:10px;padding:12px 0 9px;background:color-mix(in srgb,var(--color-bg, #08090a) 90%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--color-border)}
.mk-group-mark{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;border:1px solid var(--color-border);border-radius:8px;color:var(--color-text-secondary);background:var(--color-bg-elevated)}
.mk-group-name{margin:0;font-size:20px;font-weight:350;letter-spacing:-0.02em;white-space:nowrap}
.mk-group-count{font-family:var(--font-mono),monospace;font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--color-text-secondary);border:1px solid var(--color-border);border-radius:100px;padding:1px 8px;flex:none}
.mk-group-rule{flex:1;border-top:1px solid var(--color-border)}
.mk-group-read{font-size:11.5px;color:var(--color-text-faint);white-space:nowrap;font-variant-numeric:tabular-nums}
.mk-group-read b{font-weight:700;font-family:var(--font-mono),monospace}
.mk-group-read b[data-dir="up"]{color:var(--color-up)}
.mk-group-read b[data-dir="down"]{color:var(--color-down-text)}
@media(max-width:939px){
  /* the read shrinks and ellipsizes inside the head instead of running past
     the 390px viewport (right edge measured at 466–509px) */
  .mk-group-head{min-width:0}
  .mk-group-rule{flex:1 1 8px;min-width:8px}
  .mk-group-read{min-width:0;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis}
}
.mk-group-flags{color:var(--color-fg)}

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
.mk-tags{display:inline-flex;gap:5px;flex-wrap:wrap;min-width:0;max-width:100%;overflow:hidden}
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
  .mk-flags[data-hot]{color:var(--color-fg);font-weight:700}
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
.mkx-tick{position:absolute;font-family:var(--font-mono),monospace;font-size:10px;color:var(--color-text-faint);font-variant-numeric:tabular-nums;white-space:nowrap}
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
.mkx-live-flagn{color:var(--color-fg);font-weight:700;letter-spacing:0.06em}
.mkx-lot{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 12px;color:inherit;text-decoration:none;border-bottom:1px solid var(--color-hair,rgba(255,255,255,0.05));transition:background var(--duration-fast) var(--ease-signature)}
.mkx-lot:last-of-type{border-bottom:none}
.mkx-lot:hover{background:var(--color-hover-item)}
.mkx-lot-thumb{position:relative;width:44px;height:34px;border-radius:6px;overflow:hidden;background:var(--color-bg-elevated);display:flex;align-items:center;justify-content:center;flex:none}
.mkx-lot-letter{font-size:14px;font-weight:650;color:var(--color-text-faint)}
.mkx-lot-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.mkx-lot-main{min-width:0}
.mkx-lot-title{display:block;font-size:12px;font-weight:550;color:var(--color-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mkx-lot-sub{display:block;font-size:10.5px;color:var(--color-text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mkx-lot-flag{color:var(--color-fg);font-weight:600}
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
.mkc-chip-thin{font-family:var(--font-mono),monospace;font-size:10px;letter-spacing:0.06em;color:var(--color-text-faint);text-transform:uppercase}
.mkc-rule{flex:1}
.mkc-btn{font-family:var(--font-mono),monospace;font-size:10.5px;letter-spacing:0.08em;padding:5px 11px;background:none;color:var(--color-text-muted);border:1px solid var(--color-border);border-radius:100px;cursor:pointer}
.mkc-btn:hover{color:var(--color-fg)}
.mkc-body{padding-bottom:14px;display:grid;grid-template-columns:minmax(0,1fr);gap:8px 26px}
@media(min-width:900px){.mkc-body{grid-template-columns:minmax(0,7fr) minmax(0,5fr);align-items:start}.mkc-body[data-live]{grid-template-columns:repeat(var(--n),minmax(0,1fr))}}
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
