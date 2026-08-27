'use client';

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { ARTISTS, MARKETS, marketArtists, rosterNoun, type Market } from '../constants';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import MarketIcon from '../components/MarketIcon';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import { formatDate, formatPrice, getUpcomingCounts } from '../utils';
import { formatDemand } from '../lib/demand';
import { verifiedMovers, type VerifiedMover } from '../preview/terminal/verified';
import CountUp from '../components/CountUp';
import Masthead, { Accent } from '../components/Masthead';
import { Colophon } from '../components/Terminal';
import Flick from '../components/Flick';
import type { MarketStats } from '../types';

/**
 * Makers — THE DIRECTORY, full instrument grade (Aug 2026, pass 2).
 * One filterable ledger of every tracked name, grouped by top-level
 * category — and every row now opens IN PLACE into its dossier: the
 * maker's full median curve on real axes, the record sale, the house
 * ledger, the CI-beamed verified read. The category cockpit up top jumps
 * the reader around the ledger; '/' focuses the filter, j/k walk the
 * rows, enter opens a dossier, sorts re-rank with visible travel.
 * ENTIRELY PHASE-1 — everything derives from stats.json + market.json +
 * the eager upcoming set. Nothing waits for the corpus, nothing painted
 * early ever changes.
 */

/* ── THE LABEL SYSTEM — curated disciplines (facts, one per maker; no
   entry → no chip, never a bare roster noun) + measured states. ── */
const DISCIPLINE: Record<string, string> = {
  // art
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
  // design
  'george-nakashima': 'Studio furniture',
  'charles-eames': 'Mid-century modern',
  'jean-prouve': 'Modernist metalwork',
  'pierre-jeanneret': 'Chandigarh modernism',
  // watches
  'rolex': 'Watchmaker',
  'patek-philippe': 'Watchmaker',
  'audemars-piguet': 'Watchmaker',
  'omega': 'Watchmaker',
  'cartier': 'Watchmaker & jeweler',
  // science
  'meteorites': 'Natural history',
  'fossils': 'Natural history',
  'space-exploration': 'Space history',
  'scientific-instruments': 'Instruments',
  'science-tech': 'Technology',
};
/** markets whose books post no estimates — their reads are realized-$.
    Culture is NOT here: the build publishes a real demand index for it. */
const BID_MARKETS = new Set<Market>(['sports', 'tcg']);

interface Row {
  slug: string; label: string; market: Market;
  discipline: string | null;
  stats: MarketStats | null;
  spark: number[] | null;
  live: number;
  sold: number | null;
  median: number | null;
  revenue: number;
  verified: VerifiedMover | null;
  thin: boolean;
}

type SortKey = 'sold' | 'live' | 'median' | 'delta' | 'name';
const SORTS: { k: SortKey; label: string }[] = [
  { k: 'sold', label: 'Sold' },
  { k: 'live', label: 'Live' },
  { k: 'median', label: 'Median' },
  { k: 'delta', label: 'Verified Δ' },
  { k: 'name', label: 'A–Z' },
];

const fmtUsd = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B`
  : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M`
  : n >= 1e4 ? `$${Math.round(n / 1e3)}K`
  : `$${Math.round(n).toLocaleString()}`;

/* ── the row spark — monoline with an end dot ── */
function Spark({ values }: { values: number[] }) {
  const w = 90, h = 22;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const px = (i: number) => (i / (values.length - 1)) * (w - 6) + 2;
  const py = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  const pts = values.map((v, i) => `${px(i)},${py(v)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <svg width={w} height={h} aria-hidden>
      <polyline points={pts} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={px(values.length - 1)} cy={py(last)} r="2" fill="var(--color-fg)" />
    </svg>
  );
}

/* ── THE DOSSIER CHART — the maker's full quarterly median curve on real
   axes. Hand-rolled hairline instrument: 3 y-ticks, year x-ticks, end dot.
   Height fixed so the expansion animation has a stable target. ── */
function DossierChart({ hist }: { hist: MarketStats['priceHistory'] }) {
  const pts = hist.filter(p => (p.medianPrice || p.avgPrice) > 0);
  if (pts.length < 4) return null;
  // the LINE stretches to the container (preserveAspectRatio none, hairlines
  // held by vector-effect); the TICK TEXT is HTML positioned by %, so glyphs
  // never distort no matter the container's aspect
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
            <line key={k} x1="0" y1={yPct(t)} x2="100" y2={yPct(t)} stroke="rgba(255,255,255,0.07)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          <polyline points={line} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
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

/* ── the CI whisker — a verified read's honest width, hand-rolled ── */
function CIWhisker({ v }: { v: VerifiedMover }) {
  const lo = v.ciLoPct, hi = v.ciHiPct, pt = v.changePct;
  const dLo = Math.min(lo, 0) - Math.abs(hi - lo) * 0.08;
  const dHi = Math.max(hi, 0) + Math.abs(hi - lo) * 0.08;
  const x = (val: number) => ((val - dLo) / (dHi - dLo || 1)) * 100;
  return (
    <svg viewBox="0 0 100 16" className="mkx-ci" preserveAspectRatio="none" aria-hidden>
      {dLo < 0 && dHi > 0 && <line x1={x(0)} y1="0" x2={x(0)} y2="16" stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
      <line x1={x(lo)} y1="8" x2={x(hi)} y2="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1={x(lo)} y1="4" x2={x(lo)} y2="12" stroke="rgba(255,255,255,0.5)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1={x(hi)} y1="4" x2={x(hi)} y2="12" stroke="rgba(255,255,255,0.5)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <circle cx={x(pt)} cy="8" r="2.4" fill={pt >= 0 ? 'var(--color-up)' : 'var(--color-down-text)'} />
    </svg>
  );
}

export default function MakersPage() {
  const { allLots, statsByArtist, lastCrawl, loading, fromCache, market: marketData, demand } = useRayData();
  const { market } = useMarket();
  const activeKey = MARKETS.find(m => m.key === market)?.live ? market : 'all';
  const activeLabel = activeKey === 'all' ? 'full' : activeKey === 'tcg' ? 'TCG' : MARKETS.find(m => m.key === activeKey)!.label.toLowerCase();
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const rosterCount = useMemo(() => ARTISTS.filter(a => mktSet.has(a.slug)).length, [mktSet]);
  const { savedIds } = useSavedLots();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);
  const noun = activeKey === 'all' ? (rosterCount === 1 ? 'tracked name' : 'tracked names') : rosterNoun(activeKey, rosterCount);

  // ── controls — restored from the URL so a filtered view is shareable ──
  const [q, setQ] = useState('');
  const [fLive, setFLive] = useState(false);
  const [fVerified, setFVerified] = useState(false);
  const [sort, setSort] = useState<SortKey>('sold');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('q')) setQ(p.get('q')!);
    if (p.get('on') === '1') setFLive(true);
    if (p.get('vi') === '1') setFVerified(true);
    const s = p.get('sort') as SortKey | null;
    if (s && SORTS.some(x => x.k === s)) setSort(s);
  }, []);
  useEffect(() => {
    // seed from the CURRENT search — building from scratch erased foreign
    // params (utm_*, anything app-level) and the hash on mount
    const p = new URLSearchParams(window.location.search);
    ['q', 'on', 'vi', 'sort'].forEach(k => p.delete(k));
    if (q.trim()) p.set('q', q.trim());
    if (fLive) p.set('on', '1');
    if (fVerified) p.set('vi', '1');
    if (sort !== 'sold') p.set('sort', sort);
    const qs = p.toString();
    try {
      window.history.replaceState(window.history.state, '', `${qs ? `?${qs}` : window.location.pathname}${window.location.hash}`);
    } catch { /* ignore */ }
  }, [q, fLive, fVerified, sort]);

  const searchRef = useRef<HTMLInputElement | null>(null);

  const verifiedBySlug = useMemo(() => {
    const m = new Map<string, VerifiedMover>();
    if (marketData) for (const v of verifiedMovers(marketData)) m.set(v.slug, v);
    return m;
  }, [marketData]);

  const rows = useMemo<Row[]>(() => ARTISTS.map(a => {
    const st = statsByArtist[a.slug] || null;
    const hist = st?.priceHistory || [];
    const sparkVals = hist.slice(-12).map(p => p.medianPrice || p.avgPrice).filter(v => v > 0);
    const sold = st?.totalSoldTracked ?? null;
    return {
      slug: a.slug, label: a.label, market: a.market as Market,
      discipline: DISCIPLINE[a.slug] || null,
      stats: st,
      spark: sparkVals.length >= 4 ? sparkVals : null,
      live: upcomingCounts[a.slug] || 0,
      sold,
      median: st?.medianPriceLast12Months || null,
      revenue: st?.totalAuctionRevenue || 0,
      verified: verifiedBySlug.get(a.slug) || null,
      thin: sold != null && sold > 0 && sold < 50,
    };
  }), [statsByArtist, upcomingCounts, verifiedBySlug]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const cmp = (a: Row, b: Row): number => {
      switch (sort) {
        case 'live': return b.live - a.live || (b.sold ?? 0) - (a.sold ?? 0);
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
      .sort(cmp);
  }, [rows, mktSet, q, fLive, fVerified, sort]);

  // ── grouped by top-level category, MARKETS order ──
  const groups = useMemo(() =>
    MARKETS
      .filter(m => m.key !== 'all' && (activeKey === 'all' || m.key === activeKey))
      .map(m => {
        const g = visible.filter(r => r.market === m.key);
        const live = g.reduce((s, r) => s + r.live, 0);
        const revenue = g.reduce((s, r) => s + r.revenue, 0);
        // soldMax over the UNFILTERED market roster — a filter must never
        // silently rescale the surviving rows' sold tracks
        const soldMax = Math.max(1, ...rows.filter(r => r.market === m.key).map(r => r.sold ?? 0));
        const ds = demand?.[m.key] || [];
        const demandNow = ds.length ? ds[ds.length - 1].value : null;
        return { key: m.key as Market, label: m.label, rows: g, live, revenue, soldMax, demandNow };
      })
      .filter(g => g.rows.length > 0),
    [visible, rows, activeKey, demand]);

  // ── the category cockpit — unfiltered reads (a map, not a result set) ──
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
          demandNow: ds.length ? ds[ds.length - 1].value : null,
        };
      }),
    [rows, activeKey, demand]);

  const totalLive = useMemo(() => ARTISTS.filter(a => mktSet.has(a.slug)).reduce((s, a) => s + (upcomingCounts[a.slug] || 0), 0), [mktSet, upcomingCounts]);
  const verifiedCount = useMemo(() => rows.filter(r => mktSet.has(r.slug) && r.verified).length, [rows, mktSet]);

  // ── INPUT CRAFT — '/' focuses the filter, j/k walk rows, enter opens ──
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
  }, []);

  // ── FLIP — a re-sort re-RANKS the same rows; they travel, never teleport.
  // Board-relative tops (never viewport), same-id-set only. ──
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
      // FORCE a style flush between the offset write and the reset — a rAF
      // scheduled from this commit runs BEFORE the first style recalc, so
      // without this reflow the computed transform never lands and the CSS
      // transition has nothing to travel from (rows teleport)
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
  // a dossier opening/closing shifts every row below it WITHOUT changing
  // flipKey — re-measure after the 340ms expansion settles, or the next
  // sort's deltas carry the expansion height and the board lurches
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

  /* ── the dossier — a maker's whole phase-1 case, opened in place ── */
  const dossier = (r: Row) => {
    const st = r.stats;
    const houses = (st?.houseDistribution || []).slice().sort((a, b) => b.count - a.count).slice(0, 3);
    const houseMax = Math.max(1, ...houses.map(h => h.count));
    const sold12 = st ? st.priceHistory.slice(-4).reduce((s, p) => s + (p.totalSales || 0), 0) : 0;
    return (
      <div className="mkx">
        <div className="mkx-in">
          {st?.priceHistory && st.priceHistory.length >= 4 ? (
            <div className="mkx-chartwrap">
              <div className="mkx-chart-cap kicker">Quarterly median sale · full tracked history</div>
              <DossierChart hist={st.priceHistory} />
            </div>
          ) : (
            <p className="mkx-none">Not enough sold history for a curve yet — the ledger fills as {r.label} lots settle.</p>
          )}
          <div className="mkx-grid">
            <div>
              <span className="kicker">The record</span>
              {st?.recordPrice ? (
                <p><b>{formatPrice(st.recordPrice)}</b>{st.recordTitle ? <> · {st.recordTitle.length > 44 ? `${st.recordTitle.slice(0, 44)}…` : st.recordTitle}</> : null}{st.recordHouse ? <> · {st.recordHouse}</> : null}{st.recordDate ? <> · {formatDate(st.recordDate)}</> : null}</p>
              ) : <p>—</p>}
            </div>
            <div>
              <span className="kicker">The book</span>
              <p>
                {r.sold != null && <><b>{r.sold.toLocaleString()}</b> sold tracked</>}
                {r.revenue > 0 && <> · <b>{fmtUsd(r.revenue)}</b> settled</>}
                {sold12 > 0 && <> · {sold12.toLocaleString()} in 12mo</>}
                {r.live > 0 && <> · <b>{r.live.toLocaleString()}</b> on the block now</>}
              </p>
            </div>
            {houses.length > 0 && (
              <div>
                <span className="kicker">The houses</span>
                <div className="mkx-houses">
                  {houses.map(h => (
                    <div key={h.house} className="mkx-house">
                      <span className="mkx-house-name">{h.house}</span>
                      <span className="mkx-house-track" aria-hidden><span style={{ width: `${Math.round((h.count / houseMax) * 100)}%` }} /></span>
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
          <div className="mkx-actions">
            <Link href={`/makers/${r.slug}`} className="ray-call-btn ray-call-btn-primary">
              Open the dossier
            </Link>
            {r.live > 0 && (
              <Link href={`/makers/${r.slug}`} className="link-action" style={{ color: 'var(--color-fg)' }}>
                {r.live.toLocaleString()} on the block <span className="arrow"><Flick size={10} style={{ marginLeft: 5 }} /></span>
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  };

  const row = (r: Row, soldMax: number) => {
    const isOpen = open === r.slug;
    return (
      <div
        key={r.slug} className="mk-item" data-mk-flip={r.slug} data-open={isOpen || undefined}
        // Escape closes the dossier from ANYWHERE inside it (the row's own
        // handler can't hear a keydown on the dossier's links)
        onKeyDown={e => { if (e.key === 'Escape' && isOpen) { e.preventDefault(); setOpen(null); } }}
      >
        <div
          role="button" tabIndex={0} data-mk-row
          className="mk-row"
          aria-expanded={isOpen}
          aria-label={`${r.label} — open the maker's read`}
          onClick={() => setOpen(o => (o === r.slug ? null : r.slug))}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => (o === r.slug ? null : r.slug)); }
            if (e.key === 'Escape' && isOpen) { e.preventDefault(); setOpen(null); }
          }}
        >
          <span className="mk-mono" aria-hidden>{r.label.charAt(0)}</span>
          <span className="mk-id">
            <span className="mk-name">{r.label}</span>
            <span className="mk-tags">
              {r.discipline && <span className="mk-tag">{r.discipline}</span>}
              {BID_MARKETS.has(r.market) && <span className="mk-tag">bid market</span>}
              {r.verified && <span className="mk-tag mk-tag-verified" title={`CI-verified ${r.verified.horizon} move · 95% CI ${Math.round(r.verified.ciLoPct)}% to ${Math.round(r.verified.ciHiPct)}%`}>verified · {r.verified.horizon}</span>}
              {r.thin && <span className="mk-tag">thin history</span>}
            </span>
          </span>
          <span className="mk-cell mk-spark" aria-hidden>{r.spark ? <Spark values={r.spark} /> : <span className="mk-sparkgap" />}</span>
          <span className="mk-cell">{r.median ? formatPrice(r.median) : '—'}</span>
          <span className="mk-cell mk-delta" data-dir={r.verified ? r.verified.dir : undefined}>
            {r.verified ? `${r.verified.changePct >= 0 ? '+' : '−'}${Math.abs(Math.round(r.verified.changePct))}%` : '—'}
          </span>
          <span className="mk-cell" data-live={r.live > 0 || undefined}>{r.live > 0 ? r.live.toLocaleString() : '—'}</span>
          <span className="mk-cell mk-faint mk-soldcell">
            {r.sold != null ? r.sold.toLocaleString() : '—'}
            {r.sold != null && r.sold > 0 && (
              <span className="mk-soldtrack" aria-hidden><span style={{ width: `${Math.max(3, Math.round((r.sold / soldMax) * 100))}%` }} /></span>
            )}
          </span>
          <span className="mk-go" aria-hidden data-open={isOpen || undefined}><Flick size={10} /></span>
          <span className="mk-mob">
            <span className="mk-mob-median">{r.median ? formatPrice(r.median) : r.live > 0 ? `${r.live} live` : '—'}</span>
            <span className="mk-mob-sub" data-dir={r.verified ? r.verified.dir : undefined}>
              {r.verified ? `${r.verified.changePct >= 0 ? '+' : '−'}${Math.abs(Math.round(r.verified.changePct))}% · ${r.verified.horizon}` : r.sold != null ? `${r.sold.toLocaleString()} sold` : ''}
            </span>
          </span>
        </div>
        {dossier(r)}
      </div>
    );
  };

  return (
    <div className="terminal-shell" style={{ minHeight: '100vh', fontFamily: 'var(--font-sans), sans-serif' }}>
      <style dangerouslySetInnerHTML={{ __html: MAKERS_CSS }} />
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
                  {verifiedCount > 0 && <> · {verifiedCount} CI-verified indexes</>}
                  {' '}· medians, never means
                </>
              }
            />
          </section>

          {/* ── THE COCKPIT — the categories as one instrument strip; each
              cell is a door (click jumps the ledger to its group) ── */}
          {activeKey === 'all' && (
            <section className="rail ray-enter" style={{ '--enter-delay': '30ms', paddingTop: 4, paddingBottom: 2 } as React.CSSProperties}>
              <div className="mk-cockpit" role="list">
                {cockpit.map(c => (
                  <button key={c.key} type="button" role="listitem" className="mk-cock" onClick={() => jumpTo(c.key)}>
                    <span className="mk-cock-head">
                      <span className="mk-cock-icon" aria-hidden><MarketIcon market={c.key} size={13} /></span>
                      <span className="mk-cock-name">{c.label}</span>
                    </span>
                    <span className="mk-cock-v">
                      <CountUp to={c.live} format={n => Math.round(n).toLocaleString()} duration={900} animate={!fromCache} />
                      <i>live</i>
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

          {/* ── THE FILTER BAR — pinned under the nav ── */}
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
              <button type="button" className="mk-chip" data-on={fLive || undefined} onClick={() => setFLive(v => !v)} aria-pressed={fLive}>
                On the block
              </button>
              <button type="button" className="mk-chip" data-on={fVerified || undefined} onClick={() => setFVerified(v => !v)} aria-pressed={fVerified}>
                Verified index
              </button>
              <span className="mk-bar-rule" aria-hidden />
              <span className="mk-count">{visible.length} of {rosterCount}</span>
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
          <section className="rail ray-enter" style={{ '--enter-delay': '40ms', paddingTop: 6, paddingBottom: 30 } as React.CSSProperties}>
            <div className="mk-cols" aria-hidden>
              <span /><span className="kicker">Maker</span>
              <span className="kicker" style={{ textAlign: 'right' }}>12q curve</span>
              <span className="kicker" style={{ textAlign: 'right' }}>Median · 12mo</span>
              <span className="kicker" style={{ textAlign: 'right' }}>Verified Δ</span>
              <span className="kicker" style={{ textAlign: 'right' }}>Live</span>
              <span className="kicker" style={{ textAlign: 'right' }}>Sold</span>
              <span />
            </div>

            <div ref={listRef}>
              {groups.length === 0 ? (
                <p className="mk-empty">
                  No maker matches{q ? <> &ldquo;{q}&rdquo;</> : null}{fLive ? ' with lots on the block' : ''}{fVerified ? ' carrying a verified index' : ''} in the {activeLabel} market.
                  {' '}<button type="button" className="mk-reset" onClick={() => { setQ(''); setFLive(false); setFVerified(false); }}>Clear the filters</button>
                </p>
              ) : groups.map(g => (
                <div key={g.key} id={`mk-${g.key}`} className="mk-group">
                  <div className="mk-group-head">
                    <span className="mk-group-mark" aria-hidden><MarketIcon market={g.key} size={15} /></span>
                    <h2 className="mk-group-name">{g.label}</h2>
                    <span className="mk-group-count">{g.rows.length}</span>
                    <span className="mk-group-rule" aria-hidden />
                    <span className="mk-group-read">
                      {g.revenue > 0 && <>{fmtUsd(g.revenue)} settled</>}
                      {g.live > 0 && <>{g.revenue > 0 ? ' · ' : ''}{g.live.toLocaleString()} on the block</>}
                      {g.demandNow !== null && (
                        <>{(g.revenue > 0 || g.live > 0) ? ' · ' : ''}demand <b data-dir={g.demandNow >= 0 ? 'up' : 'down'}>{formatDemand(g.demandNow)}</b></>
                      )}
                    </span>
                  </div>
                  <div className="mk-list">
                    {g.rows.map(r => row(r, g.soldMax))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </RayEntrance>
      )}

      <Colophon record={null} />
    </div>
  );
}

const MAKERS_CSS = `
/* ════ THE MAKERS DIRECTORY — instrument grade (Aug 2026 pass 2) ════ */

/* ── THE COCKPIT — the categories as one fused strip of doors ── */
.mk-cockpit{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));border-top:1px solid var(--color-border);border-bottom:1px solid var(--color-border)}
.mk-cock{display:grid;gap:3px;align-content:start;text-align:left;padding:14px 16px 12px;background:none;border:none;border-left:1px solid var(--color-hair,rgba(255,255,255,0.06));cursor:pointer;color:inherit;transition:background var(--duration-fast) var(--ease-signature)}
.mk-cock:first-child{border-left:none}
.mk-cock:hover{background:var(--color-hover-item)}
.mk-cock:focus-visible{outline:1.5px solid color-mix(in srgb,var(--color-fg) 70%,transparent);outline-offset:-1.5px}
.mk-cock-head{display:flex;align-items:center;gap:7px;min-width:0}
.mk-cock-icon{display:inline-flex;color:var(--color-text-muted);flex:none}
.mk-cock-name{font-size:11px;font-weight:650;letter-spacing:0.02em;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-cock-v{font-family:var(--font-mono),monospace;font-size:21px;font-weight:500;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;color:var(--color-fg);line-height:1.15}
.mk-cock-v i{font-style:normal;font-size:10.5px;color:var(--color-text-faint);margin-left:5px;letter-spacing:0.06em}
.mk-cock-s{font-size:10.5px;color:var(--color-text-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.mk-cock-s b{font-weight:700;font-family:var(--font-mono),monospace}
.mk-cock-s b[data-dir="up"]{color:var(--color-up)}
.mk-cock-s b[data-dir="down"]{color:var(--color-down-text)}
@media(max-width:700px){.mk-cockpit{grid-template-columns:repeat(2,1fr)}.mk-cock{border-bottom:1px solid var(--color-hair,rgba(255,255,255,0.06))}}

/* ── the filter bar — pinned under the sticky nav ── */
.mk-bar-wrap{position:sticky;top:54px;z-index:30;background:color-mix(in srgb,#0b0c0e 88%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--color-border)}
.mk-bar{display:flex;align-items:center;gap:8px;padding-top:9px;padding-bottom:9px;flex-wrap:wrap}
.mk-search{display:inline-flex;align-items:center;gap:7px;flex:0 1 240px;min-width:150px;padding:0 10px;height:30px;background:var(--color-bg-elevated);border:1px solid var(--color-border);border-radius:8px;color:var(--color-text-faint)}
.mk-search input{flex:1;min-width:0;background:none;border:none;outline:none;font-family:var(--font-sans),sans-serif;font-size:12.5px;color:var(--color-fg)}
.mk-search input::placeholder{color:var(--color-text-faint)}
.mk-search:focus-within{border-color:var(--color-border-mid)}
.mk-clear{background:none;border:none;color:var(--color-text-faint);cursor:pointer;font-size:14px;padding:0 2px}
.mk-kbd{font-family:var(--font-mono),monospace;font-size:10px;color:var(--color-text-faint);border:1px solid var(--color-border);border-radius:5px;padding:1px 5px;line-height:1.3}
.mk-chip{font-family:var(--font-mono),monospace;font-size:10.5px;letter-spacing:0.08em;padding:0 12px;height:28px;background:none;color:var(--color-text-muted);border:1px solid var(--color-border);border-radius:100px;cursor:pointer;transition:color var(--duration-fast) var(--ease-signature),border-color var(--duration-fast) var(--ease-signature),background var(--duration-fast) var(--ease-signature)}
.mk-chip:hover{color:var(--color-fg)}
.mk-chip[data-on]{background:var(--color-fg);color:var(--color-bg);border-color:var(--color-fg)}
.mk-bar-rule{flex:1}
.mk-count{font-family:var(--font-mono),monospace;font-size:10.5px;color:var(--color-text-faint);font-variant-numeric:tabular-nums;white-space:nowrap}
.mk-seg .ray-seg-btn{font-size:11.5px;padding:5px 11px}
@media(max-width:700px){.mk-seg{order:5;flex-basis:100%;overflow-x:auto}.mk-bar-rule{display:none}}

/* ── column kickers (desktop) ── */
.mk-cols{display:none}
@media(min-width:940px){
  .mk-cols{display:grid;grid-template-columns:30px minmax(0,1fr) 96px 104px 84px 64px 84px 18px;gap:14px;align-items:baseline;padding:12px 14px 8px}
  .mk-cols .kicker{font-size:10px;letter-spacing:0.14em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
}

/* ── group heads — sticky under the bar ── */
.mk-group{margin-bottom:6px;scroll-margin-top:150px}
.mk-group-head{position:sticky;top:103px;z-index:20;display:flex;align-items:center;gap:10px;padding:12px 0 9px;background:color-mix(in srgb,#08090a 90%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--color-border)}
.mk-group-mark{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;flex:none;border:1px solid var(--color-border);border-radius:8px;color:var(--color-text-secondary);background:var(--color-bg-elevated)}
.mk-group-name{margin:0;font-size:14px;font-weight:650;letter-spacing:-0.01em;white-space:nowrap}
.mk-group-count{font-family:var(--font-mono),monospace;font-size:10.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--color-text-secondary);border:1px solid var(--color-border);border-radius:100px;padding:1px 8px;flex:none}
.mk-group-rule{flex:1;border-top:1px solid var(--color-border)}
.mk-group-read{font-size:11.5px;color:var(--color-text-faint);white-space:nowrap;font-variant-numeric:tabular-nums}
.mk-group-read b{font-weight:700;font-family:var(--font-mono),monospace}
.mk-group-read b[data-dir="up"]{color:var(--color-up)}
.mk-group-read b[data-dir="down"]{color:var(--color-down-text)}

/* ── rows ── */
.mk-item{border-bottom:1px solid var(--color-hair,rgba(255,255,255,0.06));background:transparent}
.mk-list .mk-item:last-child{border-bottom:none}
.mk-item[data-open]{background:var(--color-hover-item)}
.mk-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:12px;align-items:center;padding:9px 14px;min-height:52px;color:inherit;text-decoration:none;cursor:pointer;transition:background var(--duration-fast) var(--ease-signature)}
.mk-row:hover{background:var(--color-hover-item)}
.mk-row:focus-visible{outline:1.5px solid color-mix(in srgb,var(--color-fg) 70%,transparent);outline-offset:-1.5px;background:var(--color-hover-item)}
.mk-mono{width:30px;height:30px;display:flex;align-items:center;justify-content:center;flex:none;border-radius:8px;background:var(--color-bg-elevated);border:1px solid var(--color-hair,rgba(255,255,255,0.06));font-size:13px;font-weight:650;color:var(--color-text-secondary)}
.mk-id{min-width:0;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.mk-name{font-size:13.5px;font-weight:600;color:var(--color-fg);white-space:nowrap}
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
@media(min-width:940px){
  .mk-row{grid-template-columns:30px minmax(0,1fr) 96px 104px 84px 64px 84px 18px;gap:14px}
  .mk-mob{display:none}
  .mk-cell{display:block;font-family:var(--font-mono),monospace;font-size:12.5px;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;color:var(--color-fg);text-align:right;white-space:nowrap;overflow:hidden}
  .mk-faint{color:var(--color-text-faint)}
  .mk-cell[data-live]{font-weight:700}
  .mk-delta{color:var(--color-text-faint)}
  .mk-delta[data-dir="up"]{color:var(--color-up);font-weight:700}
  .mk-delta[data-dir="down"]{color:var(--color-down-text);font-weight:700}
  .mk-spark{display:flex;justify-content:flex-end;align-items:center}
  .mk-sparkgap{display:inline-block;width:90px}
  .mk-go{display:flex;justify-content:flex-end;color:var(--color-text-faint);transition:transform var(--duration-fast) var(--ease-signature)}
  .mk-go[data-open]{transform:rotate(90deg)}
  .mk-soldcell{overflow:visible}
  .mk-soldtrack{display:block;height:2px;margin-top:4px;background:rgba(255,255,255,0.07);border-radius:2px}
  .mk-soldtrack>span{display:block;height:100%;border-radius:2px;background:rgba(255,255,255,0.4);margin-left:auto}
}

/* ── THE DOSSIER — the maker's case, opened in place ── */
.mkx{display:grid;grid-template-rows:0fr;transition:grid-template-rows 340ms var(--ease-signature)}
.mk-item[data-open] .mkx{grid-template-rows:1fr}
.mkx-in{overflow:hidden;min-height:0;visibility:hidden;transition:visibility 0s 340ms}
.mk-item[data-open] .mkx-in{visibility:visible;transition:visibility 0s;border-top:1px solid var(--color-hair,rgba(255,255,255,0.06))}
.mkx-chartwrap{padding:14px 16px 0}
.mkx-chart-cap{font-size:10px;letter-spacing:0.14em;margin-bottom:8px}
.mkx-chart{width:100%;height:150px;padding:4px 10px 18px 46px;box-sizing:border-box}
.mkx-plot{position:relative;width:100%;height:100%}
.mkx-plot svg{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible}
.mkx-dot{position:absolute;width:5px;height:5px;border-radius:100px;background:var(--color-fg);transform:translate(-50%,-50%)}
.mkx-tick{position:absolute;font-family:var(--font-mono),monospace;font-size:9.5px;color:var(--color-text-faint);font-variant-numeric:tabular-nums;white-space:nowrap}
.mkx-tick-y{left:-8px;transform:translate(-100%,-50%)}
.mkx-tick-x{bottom:-16px;transform:translateX(-50%)}
.mkx-none{margin:0;padding:14px 16px 0;font-size:12.5px;color:var(--color-text-muted)}
.mkx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px 26px;padding:14px 16px 0}
.mkx-grid .kicker{font-size:10px;letter-spacing:0.14em}
.mkx-grid p{margin:4px 0 0;font-size:12px;color:var(--color-text-muted);line-height:1.55}
.mkx-grid p b{color:var(--color-fg);font-weight:600;font-variant-numeric:tabular-nums}
.mkx-houses{margin-top:6px;display:grid;gap:4px}
.mkx-house{display:grid;grid-template-columns:minmax(64px,96px) minmax(0,1fr) 52px;gap:8px;align-items:center}
.mkx-house-name{font-size:11px;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mkx-house-track{display:block;height:3px;background:rgba(255,255,255,0.07);border-radius:2px}
.mkx-house-track>span{display:block;height:100%;border-radius:2px;background:rgba(255,255,255,0.4)}
.mkx-house-n{font-family:var(--font-mono),monospace;font-size:10.5px;color:var(--color-text-faint);text-align:right;font-variant-numeric:tabular-nums}
.mkx-verified{margin-top:6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mkx-verified b{font-family:var(--font-mono),monospace;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}
.mkx-verified b[data-dir="up"]{color:var(--color-up)}
.mkx-verified b[data-dir="down"]{color:var(--color-down-text)}
.mkx-ci{width:110px;height:16px;flex:none}
.mkx-ci-ends{font-family:var(--font-mono),monospace;font-size:10px;color:var(--color-text-faint);font-variant-numeric:tabular-nums}
.mkx-actions{display:flex;align-items:center;gap:20px;padding:14px 16px 16px;flex-wrap:wrap}

/* ── empty state ── */
.mk-empty{font-size:13.5px;color:var(--color-text-muted);padding:34px 14px;margin:0}
.mk-reset{background:none;border:none;padding:0;font:inherit;color:var(--color-fg);cursor:pointer;text-decoration:underline dotted}
`;
