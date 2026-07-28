'use client';

/* ============================================================
   THE TERMINAL — the REAL lectr homepage, brought to full
   functional parity with the working lander (app/page.tsx) and
   dressed in the Terminal's winning design grammar.

   STRATEGY (per the build directive): this file copies the
   FUNCTIONAL logic of app/page.tsx verbatim — state, memos,
   market scoping, feed computation, save, phases, effects — and
   only changes presentation: the lander hero is swapped for
   the market-scoped IndexHero + Tape + RecordBoard,
   and the whole page is composed inside the Terminal's dark
   shell. Every MUST-PRESERVE behavior survives because we start
   from the working logic. Reads eager phase-1 data only; phase-2
   via Phase2Sentinel, phase-3 via useSoldArchive. Static-export
   safe (all client hooks guard window/matchMedia).
   ============================================================ */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ARTIST_LABEL, MARKETS, marketArtists, type Market } from '../../constants';
import { useMarket } from '../../lib/market';
import { useRayData, useSoldArchive, retryArchiveLoad, triggerFullLoad } from '../../hooks/useRayData';
import { useSavedLots } from '../../hooks/useSavedLots';
import { formatDate, formatPrice, getUpcomingCounts, craftTitle, sportOf, httpsImg, fmtSignedPct, localToday, trueSaleDay, isLiveUpcoming } from '../../utils';
import ArtistNav from '../../components/ArtistNav';
import LotCard, { lotSignal, confidenceMeter, formatEstimate } from '../../components/LotCard';
import { dealScore } from '../../lib/comps';
import ComparableModal from '../../components/ComparableModal';
import type { AuctionLot } from '../../types';
import PastResults from '../../components/PastResults';
import RayEntrance, { RayLoading } from '../../components/RayEntrance';
import CountUp from '../../components/CountUp';
import SettlementSlip from '../../components/SettlementSlip';
import MarketSwitch from '../../components/MarketSwitch';
import FeedToolbar, { FeedFilters, FEED_DEFAULTS } from '../../components/FeedToolbar';
import { weekDaysFor } from '../../components/HammerWeek';
import { CallPlate, Colophon, daysWord } from '../../components/Terminal';
import Flick from '../../components/Flick';
import Greeting from '../../components/Greeting';
import { OPEN_CK_EVENT } from '../../components/CommandK';

// Terminal design assets (the DESIGN win)
import IndexHero from './IndexHero';
import TonightsWall, { gapGrammar, type WallItem } from './TonightsWall';
import SubMarketBoard, { hasSubMarketRows } from './SubMarketBoard';
import Tape from './Tape';
import RecordBoard from './RecordBoard';
import { useMediaQuery, useMounted } from './hooks';
import styles from './style.module.css';
import { CardEmblem } from './emblems';

// W13 contract: useSavedLots grows a savedMeta record (hook agent's edit).
type SavedMeta = Record<string, { savedAt: string; estMid: number | null; signalPct: number | null; bidCount: number | null }>;
const EMPTY_SAVED_META: SavedMeta = {};

// The eager recentSold slice (from upcoming.json) — lightweight Goldin closes.
type RecentSoldRow = { id: string; title: string; artist: string; priceUsd?: number; house?: string; saleDate?: string; url?: string; priceBasis?: string; category?: string; objectType?: string; eventKey?: string };


// The ledger line's cells.
type StripItem = {
  k: string;
  to: number;
  format: (n: number) => string;
  s: string;
  tone?: 'up';
  lens?: boolean;
};

// The default view's diversity cap: max 8 lots per maker per page window.
const MAKER_CAP = 8;
function diversifyFeed(arr: AuctionLot[], windowSize: number): AuctionLot[] {
  if (arr.length <= MAKER_CAP || windowSize <= 0) return arr;
  const out: AuctionLot[] = [];
  let pool = arr;
  while (pool.length) {
    const counts: Record<string, number> = {};
    const taken: AuctionLot[] = [];
    const deferred: AuctionLot[] = [];
    for (const l of pool) {
      if (taken.length < windowSize && (counts[l.artist] || 0) < MAKER_CAP) {
        taken.push(l);
        counts[l.artist] = (counts[l.artist] || 0) + 1;
      } else {
        deferred.push(l);
      }
    }
    if (taken.length === 0) { out.push(...deferred); break; }
    out.push(...taken);
    pool = deferred;
  }
  return out;
}

// The full sports/science results table — mounted ONLY when the reader opens
// "Show the archive" (which triggers useSoldArchive's phase-3 fetch).
function ArchiveResults({
  mktSet,
  savedIds,
  onToggleSave,
}: {
  mktSet: Set<string>;
  savedIds: string[];
  onToggleSave: (id: string) => void;
}) {
  const { allLotsWithArchive, archiveLoaded, archiveError } = useSoldArchive();
  const archiveSold = useMemo(
    () =>
      allLotsWithArchive
        .filter(l => l.status === 'sold' && l.priceUsd && mktSet.has(l.artist))
        .sort((a, b) => (a.saleDate > b.saleDate ? -1 : a.saleDate < b.saleDate ? 1 : 0)),
    [allLotsWithArchive, mktSet]
  );

  if (archiveError) {
    return (
      <div className="ray-recordband" style={{ marginTop: 24, textAlign: 'center', padding: '48px 20px' }}>
        <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', marginBottom: 16 }}>
          The sold archive didn&rsquo;t load. Check your connection and try again.
        </p>
        <button className="ray-call-btn ray-call-btn-primary" onClick={() => retryArchiveLoad()}>
          Retry
        </button>
      </div>
    );
  }
  if (!archiveLoaded) {
    return <div className="ray-recordband" style={{ marginTop: 24 }}><RayLoading /></div>;
  }
  return (
    <div className="ray-recordband" style={{ marginTop: 24 }}>
      <PastResults lots={archiveSold} showArtist savedIds={savedIds} onToggleSave={onToggleSave} />
    </div>
  );
}

// Below-the-fold sentinel that triggers phase 2 as the reader descends — the
// art/design/watches/all Record band reads sold history from the phase-2 corpus.
function Phase2Sentinel() {
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { triggerFullLoad(); return; }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) { triggerFullLoad(); io.disconnect(); } },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} aria-hidden style={{ height: 1 }} />;
}

// The dead ⌘K → the real CommandK palette.
function openCommandK() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_CK_EVENT));
}

// A lot's TRUE sale day (saleDateTime over crawl-day saleDate) now lives in
// app/utils.ts as `trueSaleDay`, shared with isLiveUpcoming so the feed, the
// nav counts, /value and /[artist] all judge liveness on the same day string.

// Ledger-table dressing: the category cell's short label, and the
// days-to-hammer count (whole days from the reader's local day to the true
// sale day — "In 2d" is a promise to the user, so it runs on the user's clock,
// the same one the feed filter uses).
const CAT_LABEL: Record<string, string> = {
  original: 'Original',
  print: 'Print',
  photograph: 'Photo',
  sculpture: 'Sculpture',
  design: 'Design',
  object: 'Object',
};
function daysToHammer(l: AuctionLot, todayDay: string): number | null {
  const day = trueSaleDay(l);
  if (!day) return null;
  const d = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayDay}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(d) ? d : null;
}

// M13 — the desktop feed's hover preview: a 236px mat plate floating beside
// the table row under the pointer. Photo on the warm mat (object-fit contain,
// never cropped), maker, estimate, and the verdict ring when the engine has a
// call. One plate at a time, 150ms intent delay upstream, instant leave.
function HoverPlate({ lot, x, y, tone, sig, onEnter, onLeave }: {
  lot: AuctionLot;
  x: number;
  y: number;
  tone?: 'up' | 'down';
  sig: ReturnType<typeof lotSignal>;
  /** R3 — the plate is CLICKABLE (→ /lot); these keep it alive while the
      pointer crosses the gap from the row */
  onEnter: () => void;
  onLeave: () => void;
}) {
  if (!lot.imageUrl) return null;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.min(x + 14, vw - 252);
  const top = Math.max(70, Math.min(y - 24, vh - 320));
  return (
    <Link
      href={`/lot?id=${encodeURIComponent(lot.id)}`}
      className={styles.hoverPlate}
      style={{ left, top, pointerEvents: 'auto', textDecoration: 'none', cursor: 'pointer' }}
      data-tone={tone}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      aria-label={`Open the lot page for ${craftTitle(lot.title)}`}
    >
      <span className={styles.hoverPlateMat}>
        <img src={httpsImg(lot.imageUrl)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onError={e => { (e.currentTarget.parentElement!.parentElement as HTMLElement).style.display = 'none'; }} />
      </span>
      <span className={styles.hoverPlateMaker}>{ARTIST_LABEL[lot.artist] || lot.artist}</span>
      <span className={styles.hoverPlateEst}>{formatEstimate(lot)}</span>
      {sig && (
        <span className={styles.hoverPlateSig} data-dir={sig.label === 'Below Market' ? 'up' : 'down'}>
          {gapGrammar(sig.label, sig.pct)}
        </span>
      )}
    </Link>
  );
}

// The mobile feed's compact row — signal-less lots fold to one ruled line
// (thumb · maker · title · est/bid · date) instead of a full-bleed card.
// Tapping opens the same comps context the card offers.
// The row glow's verdict, from EVERY signal tier the engine publishes:
// 1. the comp signal (Below/Above Market), 2. the engine's value read vs
// estimate (below/above comparable market), 3. the live-bid read (bid below/
// above recent comps — the Goldin book, where most of the coverage lives).
// 'at market' / 'in line' stay quiet on purpose.
function feedTone(lot: AuctionLot, belowIds: Set<string>, hasSig: Set<string>): 'up' | 'down' | undefined {
  if (belowIds.has(lot.id)) return 'up';
  if (hasSig.has(lot.id)) return 'down';
  const vs = lot.value?.signal?.label;
  if (vs === 'below comparable market') return 'up';
  if (vs === 'above comparable market') return 'down';
  const vb = lot.value?.vsBid?.label;
  if (vb === 'below recent comps') return 'up';
  if (vb === 'above recent comps') return 'down';
  return undefined;
}

function FeedRow({ lot, onOpen, tone, signal }: { lot: AuctionLot; onOpen: () => void; tone?: 'up' | 'down'; signal?: ReturnType<typeof lotSignal> }) {
  const est =
    lot.estimateLow || lot.estimateHigh
      ? (lot.estimateLow && lot.estimateHigh && formatPrice(lot.estimateLow) !== formatPrice(lot.estimateHigh)
          ? `${formatPrice(lot.estimateLow)}–${formatPrice(lot.estimateHigh)}`
          : formatPrice(lot.estimateLow || lot.estimateHigh!))
      : lot.currentBid
        ? `bid ${formatPrice(lot.currentBid)}`
        : '—';
  return (
    // R3 — the row is a div (not a button) so the explicit lot-page door can
    // be a real <a> inside it: the row body keeps the comps modal, the
    // trailing → navigates to /lot?id=…
    <div
      className="ray-feedrow"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      aria-label={`Comps for ${craftTitle(lot.title)}`}
    >
      <span className="ray-feedrow-thumb" data-tone={tone} aria-hidden>
        {(lot.title || '?').charAt(0)}
        {lot.imageUrl && (
          <img
            src={httpsImg(lot.imageUrl)}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        )}
      </span>
      <span className="ray-feedrow-main">
        <span className="ray-feedrow-maker">{ARTIST_LABEL[lot.artist] || lot.artist}</span>
        <span className="ray-feedrow-title">{craftTitle(lot.title)}</span>
        {/* R8 — the mobile deal-scan line: the one signal grammar + confidence */}
        {signal && (
          <span className={styles.feedrowSig} data-dir={signal.label === 'Below Market' ? 'up' : 'down'}>
            {gapGrammar(signal.label, signal.pct)} · <em>{confidenceMeter(signal.confidence).dots}</em>
          </span>
        )}
      </span>
      <span className="ray-feedrow-right">
        <b>{est}</b>
        <span>{formatDate(lot.saleDate)}</span>
      </span>
      <Link
        href={`/lot?id=${encodeURIComponent(lot.id)}`}
        className="ray-feedrow-go"
        aria-label={`Open the lot page for ${craftTitle(lot.title)}`}
        onClick={e => e.stopPropagation()}
      >
        →
      </Link>
    </div>
  );
}

export default function TerminalHomePage() {
  const ray = useRayData();
  const { allLots, statsByArtist, demand, realized, bidComp, recentSold, backtest, market: marketData, tape, lastCrawl, loading, error, fromCache } = ray;
  const { market, setMarket } = useMarket();
  const marketMeta = MARKETS.find(m => m.key === market)!;
  const mounted = useMounted();
  const isMobile = useMediaQuery('(max-width: 820px)', false);
  // ≥900px — where the instrumentRow's two columns genuinely exist; gates the
  // condensed sub-market board riding beside Today's Call.
  const deskWide = useMediaQuery('(min-width: 900px)', false);

  // ONE TODAY, ONE SERIAL — the crawl day is the data's "today".
  const crawlDay = (lastCrawl || new Date().toISOString()).slice(0, 10);
  const editionSerial = crawlDay.replace(/-/g, '');
  const activeKey = market;

  // The condensed sub-market board rides the instrumentRow's second column
  // beside Today's Call — and it's the ONLY board on desktop (the full section
  // below is desktop-duplicative, so it renders only when this one doesn't:
  // mobile, or narrow desktop, or a scope with no rows).
  const boardBeside = mounted && deskWide && hasSubMarketRows(marketData, activeKey);
  // Fill that column to the call plate's height — measure the left column and
  // render as many rows as fit, so no white space sits beside the plate. Rows
  // then flex to eat the remaining slack for an exact height match.
  const callColRef = React.useRef<HTMLDivElement>(null);
  const [boardRows, setBoardRows] = useState(6);
  useEffect(() => {
    if (!boardBeside || typeof ResizeObserver === 'undefined') return;
    const el = callColRef.current;
    if (!el) return;
    const measure = () => {
      // overhead ≈ condHead + column header (~72px); divide by a conservative
      // 50px (rows are 47px min) so the board never overshoots the plate.
      setBoardRows(Math.max(4, Math.floor((el.offsetHeight - 72) / 50)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [boardBeside, activeKey]);

  // Sales-weighted appreciation across the active market's artists.
  const appreciation = useMemo(() => {
    const set = marketArtists(activeKey);
    const stats = Object.entries(statsByArtist)
      .filter(([slug]) => activeKey === 'all' || set.has(slug))
      .map(([, s]) => s);
    const totalRev = stats.reduce((a, s) => a + (s.totalAuctionRevenue || 0), 0);
    if (!totalRev) return null;
    return stats.reduce((a, s) => a + (s.appreciationRate || 0) * (s.totalAuctionRevenue || 0), 0) / totalRev;
  }, [statsByArtist, activeKey]);

  const meta = ray as unknown as { totalLots?: number; totalSold?: number };
  const totalLots = meta.totalLots ?? allLots.length;
  const isSportsScience = activeKey === 'sports' || activeKey === 'science';
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const marketLots = useMemo(() => allLots.filter(l => mktSet.has(l.artist)), [allLots, mktSet]);
  const marketStats = useMemo(() => {
    const out: typeof statsByArtist = {};
    for (const [k, v] of Object.entries(statsByArtist)) if (mktSet.has(k)) out[k] = v;
    return out;
  }, [statsByArtist, mktSet]);
  const savedApi = useSavedLots();
  const { toggle, isSaved, savedIds } = savedApi;
  const savedMeta = (savedApi as unknown as { savedMeta?: SavedMeta }).savedMeta ?? EMPTY_SAVED_META;

  // 24-card pages on desktop, 12 under 900px — matchMedia, SSR-safe default.
  const [pageSize, setPageSize] = useState(24);
  const [visibleUpcoming, setVisibleUpcoming] = useState(24);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    const apply = () => {
      const size = mq.matches ? 12 : 24;
      setPageSize(size);
      setVisibleUpcoming(v => (v === 12 || v === 24 ? size : v));
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const [feedFilters, setFeedFilters] = useState<FeedFilters>(FEED_DEFAULTS);
  const [tableLot, setTableLot] = useState<AuctionLot | null>(null);
  const [showArchive, setShowArchive] = useState(false);

  // The layout choice persists — read after mount (SSR renders the default).
  // A stored preference always wins; with none, desktop (≥900px) earns the
  // ledger table by default while mobile keeps the cards.
  const [feedView, setFeedView] = useState<'grid' | 'table'>('grid');
  useEffect(() => {
    try {
      const v = localStorage.getItem('ray-feedview');
      if (v === 'grid' || v === 'table') { setFeedView(v); return; }
    } catch { /* storage blocked — fall through to the width default */ }
    if (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 900px)').matches) {
      setFeedView('table');
    }
  }, []);
  const handleView = (v: 'grid' | 'table') => {
    setFeedView(v);
    try { localStorage.setItem('ray-feedview', v); } catch { /* storage blocked */ }
  };
  // Below 640px force the card view (persisted preference survives for desktop).
  const [narrowView, setNarrowView] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => setNarrowView(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  const effectiveView: 'grid' | 'table' = narrowView ? 'grid' : feedView;

  // Lenses are scoped to the market they were picked in — market switches drop
  // the scoped lenses; query, sort and the below-market lens travel with the reader.
  useEffect(() => {
    setFeedFilters(f =>
      f.vertical === null && f.maker === null && f.sport === null && f.category === null && f.saleDay == null
        ? f
        : { ...f, vertical: null, maker: null, sport: null, category: null, saleDay: null }
    );
  }, [activeKey]);

  const upcoming = useMemo(() => {
    // the READER's calendar day — a UTC "today" runs a day ahead every US
    // evening and drops lots that genuinely hammer today
    const today = localToday();
    // On the block = isLiveUpcoming: the sale genuinely hasn't happened yet,
    // judged on the TRUE day (saleDateTime over crawl-day saleDate) — plus the
    // 1-day results-pending grace build-upcoming serves, so a just-closed lot
    // stays visible (sorted to the end, dressed as "results pending" by the
    // card) while the house posts results, exactly as on /value and /[artist].
    return marketLots
      .filter(l => isLiveUpcoming(l, today))
      .sort((a, b) => (trueSaleDay(a) < trueSaleDay(b) ? -1 : trueSaleDay(a) > trueSaleDay(b) ? 1 : 0));
  }, [marketLots]);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  // One shared below-market pass.
  const belowSignal = useMemo(() => {
    const ids = new Set<string>();
    const pct = new Map<string, number>();
    const hasSig = new Set<string>();
    upcoming.forEach(l => {
      const s = lotSignal(l, marketLots);
      if (s) hasSig.add(l.id);
      if (s && s.label === 'Below Market') { ids.add(l.id); pct.set(l.id, s.pct); }
    });
    return { ids, pct, hasSig };
  }, [upcoming, marketLots]);
  const belowIds = belowSignal.ids;

  // The feed the reader actually sees — search + lenses + sort applied.
  const feed = useMemo(() => {
    const f = feedFilters;
    const q = f.query.trim().toLowerCase();
    let arr = upcoming;
    if (f.vertical) {
      const vset = marketArtists(f.vertical);
      arr = arr.filter(l => vset.has(l.artist));
    }
    if (f.maker) arr = arr.filter(l => l.artist === f.maker);
    if (f.sport) arr = arr.filter(l => (sportOf(l.title) || 'Other') === f.sport);
    if (f.category) arr = arr.filter(l => l.category === f.category);
    if (f.saleDay) arr = arr.filter(l => l.saleDate?.slice(0, 10) === f.saleDay);
    if (f.belowOnly) arr = arr.filter(l => belowIds.has(l.id));
    if (q) {
      arr = arr.filter(l =>
        `${ARTIST_LABEL[l.artist] || l.artist} ${l.title} ${l.auctionHouse} ${l.saleName} ${l.medium || ''}`
          .toLowerCase()
          .includes(q)
      );
    }
    const est = (l: typeof arr[number]) => l.estimateHigh || l.estimateLow || l.currentBid || 0;
    if (f.sort === 'est-desc') arr = [...arr].sort((a, b) => est(b) - est(a));
    else if (f.sort === 'est-asc') arr = [...arr].sort((a, b) => est(a) - est(b));
    else if (f.sort === 'gap-desc') {
      const pct = belowSignal.pct;
      const score = (l: AuctionLot) => {
        const p = pct.get(l.id);
        return p == null ? -Infinity : dealScore(l, p);
      };
      arr = [...arr].sort((a, b) => score(b) - score(a));
    } else if (f.sort === 'newest') {
      const seen = (l: AuctionLot) => l.firstSeen || '';
      arr = [...arr].sort((a, b) => (seen(a) < seen(b) ? 1 : seen(a) > seen(b) ? -1 : 0));
    } else {
      const past = (l: AuctionLot) => !!l.resultsPending && trueSaleDay(l) !== '' && trueSaleDay(l) < crawlDay;
      arr = [...arr.filter(l => !past(l)), ...arr.filter(past)];
      if (!q && !f.vertical && !f.maker && !f.sport && !f.category && !f.belowOnly && !f.saleDay) {
        arr = diversifyFeed(arr, pageSize);
      }
    }
    return arr;
  }, [upcoming, feedFilters, belowSignal, belowIds, pageSize, crawlDay]);


  const feedKey = useMemo(() => {
    const f = feedFilters;
    return `${f.vertical}|${f.maker}|${f.sport}|${f.category}|${f.belowOnly}|${f.sort}|${f.saleDay ?? ''}`;
  }, [feedFilters]);
  const handleFilters = (next: FeedFilters) => {
    setFeedFilters(next);
    setVisibleUpcoming(pageSize);
  };

  // The below-market lens: biggest gap first, at the feed.
  const openBelowLens = () => {
    setFeedFilters(f => ({ ...f, belowOnly: true, sort: 'gap-desc' }));
    setVisibleUpcoming(pageSize);
    document.getElementById('on-the-block')?.scrollIntoView({ behavior: 'smooth' });
  };

  const sold = useMemo(() =>
    marketLots
      .filter(l => l.status === 'sold' && l.priceUsd)
      .sort((a, b) => (a.saleDate > b.saleDate ? -1 : a.saleDate < b.saleDate ? 1 : 0)),
    [marketLots]
  );

  const soldMedian12 = useMemo(() => {
    const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const px = sold.filter(l => l.saleDate >= cutoff).map(l => l.priceUsd!).sort((a, b) => a - b);
    if (px.length < 5) return null;
    return px.length % 2 ? px[px.length >> 1] : (px[px.length / 2 - 1] + px[px.length / 2]) / 2;
  }, [sold]);

  const recordSale = useMemo(() => {
    let best: { priceUsd: number; artist: string } | null = null;
    for (const [slug, s] of Object.entries(marketStats)) {
      if ((s.recordPrice || 0) > (best?.priceUsd || 0)) best = { priceUsd: s.recordPrice, artist: slug };
    }
    return best;
  }, [marketStats]);

  const soldMedianPct = useMemo(() => {
    const perf: number[] = [];
    for (const l of sold) {
      const lo = l.estimateLow || 0;
      const hi = l.estimateHigh || 0;
      const mid = lo && hi ? (lo + hi) / 2 : lo || hi;
      if (mid > 0 && l.priceUsd) perf.push(((l.priceUsd - mid) / mid) * 100);
    }
    if (!perf.length) return null;
    perf.sort((a, b) => a - b);
    return perf[Math.floor(perf.length / 2)];
  }, [sold]);


  const recentRows = useMemo(
    () => (isSportsScience ? ((recentSold[activeKey] as RecentSoldRow[] | undefined) || []) : []),
    [isSportsScience, recentSold, activeKey]
  );
  const recentMedian = useMemo(() => {
    const prices = recentRows.map(r => r.priceUsd).filter((p): p is number => typeof p === 'number' && p > 0).sort((a, b) => a - b);
    return prices.length ? prices[Math.floor(prices.length / 2)] : null;
  }, [recentRows]);
  const recentLatest = useMemo(() => {
    let latest = '';
    for (const r of recentRows) if (r.saleDate && r.saleDate > latest) latest = r.saleDate;
    return latest;
  }, [recentRows]);

  const totalRealized = useMemo(
    () => Object.values(marketStats).reduce((s, x) => s + (x.totalAuctionRevenue || 0), 0),
    [marketStats]
  );

  const topArtist = useMemo(() => {
    const topEntry = Object.entries(marketStats)
      .sort((a, b) => (b[1].totalAuctionRevenue || 0) - (a[1].totalAuctionRevenue || 0))[0];
    return topEntry ? (ARTIST_LABEL[topEntry[0]] || topEntry[0]) : '';
  }, [marketStats]);

  const hammerWeek = useMemo(() => {
    const days = new Set(weekDaysFor(crawlDay));
    const weekLots = upcoming.filter(l => days.has(l.saleDate?.slice(0, 10) || ''));
    return { count: weekLots.length, houses: new Set(weekLots.map(l => l.auctionHouse)).size };
  }, [upcoming, crawlDay]);

  const nextHammer = useMemo(() => {
    // "today / tomorrow / in Nd" reads to the USER — count from the reader's
    // local day, the same clock the feed filter runs on (never the crawl day,
    // which can lag and print "in 2d" for tomorrow's hammer).
    const today = localToday();
    const lot = upcoming.find(l => l.saleDate && l.saleDate.slice(0, 10) >= today) || null;
    if (!lot) return null;
    const d = Math.round((Date.parse(`${lot.saleDate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    const word = d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d}d`;
    return { lot, word };
  }, [upcoming]);

  const strip = useMemo<StripItem[]>(() => {
    const active = upcoming;
    const withEst = active.filter(l => (l.estimateLow || 0) > 0 || (l.estimateHigh || 0) > 0);
    const estValue = withEst.reduce((sum, l) => {
      const lo = l.estimateLow || l.estimateHigh || 0;
      const hi = l.estimateHigh || l.estimateLow || 0;
      return sum + (lo + hi) / 2;
    }, 0);
    const liveHouses = new Set(active.map(l => l.auctionHouse)).size;
    const asComma = (n: number) => Math.round(n).toLocaleString();
    const thisWeek = hammerWeek.count;
    const priceOrDash = (n: number) => (n > 0 ? formatPrice(n) : '—');
    const hammersSub = thisWeek === 0
      ? 'none scheduled this week'
      : `across ${hammerWeek.houses} ${hammerWeek.houses === 1 ? 'house' : 'houses'}`;
    // R15 — a dead "0" is a zero-state, not a figure: when nothing hammers this
    // week, the cell answers the reader's actual question — when's the NEXT one.
    const hammersItem: StripItem =
      thisWeek === 0 && nextHammer
        ? {
            k: 'Next hammer',
            to: 0,
            format: () => formatDate(nextHammer.lot.saleDate),
            s: `${nextHammer.word} · ${nextHammer.lot.auctionHouse}`,
          }
        : { k: 'Hammers this week', to: thisWeek, format: asComma, s: hammersSub };
    if (estValue === 0 && active.length > 0) {
      return [
        { k: 'Realized all-time', to: totalRealized, format: priceOrDash, s: topArtist ? `led by ${topArtist}` : 'across the market' },
        { k: 'On the block', to: active.length, format: asComma, s: 'live lots — bid sales, no estimates' },
        hammersItem,
        { k: 'Live houses', to: liveHouses, format: asComma, s: 'sourcing this market' },
      ];
    }
    return [
      { k: 'Realized all-time', to: totalRealized, format: priceOrDash, s: topArtist ? `led by ${topArtist}` : 'across the market' },
      { k: 'On the block', to: estValue, format: priceOrDash, s: estValue > 0 ? `${asComma(active.length)} lots, mid-estimates` : `${asComma(active.length)} lots — bid sales, no estimates` },
      hammersItem,
      { k: 'Flagged below market', to: belowIds.size, format: asComma, s: 'against true comps', tone: 'up', lens: true },
    ];
  }, [upcoming, belowIds, totalRealized, topArtist, hammerWeek, nextHammer]);

  // The watchlist strip — what changed since you saved.
  const watchStrip = useMemo(() => {
    if (savedIds.length === 0) return null;
    const idSet = new Set(savedIds);
    const mine = allLots.filter(l => idSet.has(l.id));
    if (mine.length === 0) return null;
    const today = localToday();
    const live = mine
      .filter(l => l.status === 'upcoming' && trueSaleDay(l) >= today)
      .sort((a, b) => (trueSaleDay(a) < trueSaleDay(b) ? -1 : trueSaleDay(a) > trueSaleDay(b) ? 1 : 0));
    let bestMove: { from: number; to: number } | null = null;
    for (const l of live) {
      const m = savedMeta[l.id];
      if (!m || m.signalPct == null) continue;
      const s = lotSignal(l, allLots);
      if (!s || s.label !== 'Below Market') continue;
      const delta = s.pct - m.signalPct;
      if (delta > 0 && (!bestMove || delta > bestMove.to - bestMove.from)) bestMove = { from: m.signalPct, to: s.pct };
    }
    const future = live.filter(l => trueSaleDay(l) >= today);
    return { count: mine.length, next: future[0] || null, bestMove };
  }, [savedIds, savedMeta, allLots]);

  const callPlateEl = (
    <CallPlate lots={marketLots} allLots={marketLots} market={activeKey} isSaved={isSaved} onToggleSave={toggle} />
  );
  const watchStripEl = watchStrip ? (
    <Link href="/saved" className="ray-watchstrip" aria-label={`Your watchlist — ${watchStrip.count} saved`}>
      <span className="ray-watchstrip-k">Your watchlist</span>
      <span className="ray-watchstrip-line">
        {watchStrip.count} saved
        {watchStrip.next && <> · next hammer {daysWord(watchStrip.next.saleDate)}</>}
        {watchStrip.bestMove && (
          <> · best move <b className="up">+{Math.round(watchStrip.bestMove.from)}% → +{Math.round(watchStrip.bestMove.to)}%</b></>
        )}
      </span>
      <span className="ray-watchstrip-cta">Open saved <Flick size={12} /></span>
    </Link>
  ) : null;
  const marketName = activeKey === 'all' ? 'The total market' : marketMeta.label;

  // below-market count for the hero stat (scoped to the live book)
  const belowMktCount = belowIds.size;
  // tape items for the active market (fall back to 'all', then any).
  const tapeItems = useMemo(() => {
    return tape[activeKey] ?? tape.all ?? tape[Object.keys(tape)[0]] ?? [];
  }, [tape, activeKey]);

  const onMoverSelect = (key: Market) => setMarket(key);

  // M17 — the mobile hero swipe steps through the LIVE markets in pill order,
  // driving the exact same setMarket the pills use.
  const onMarketStep = (dir: 1 | -1) => {
    const live = MARKETS.filter(m => m.live);
    const i = live.findIndex(m => m.key === market);
    const next = live[(i + dir + live.length) % live.length];
    setMarket(next.key);
  };

  // M6 — TONIGHT'S WALL: the call lot + the next best flagged-with-image, then
  // photographed lots in hammer order as backfill. MORE than 5 candidates ship
  // so a dead image drops out and the next one hangs in its place.
  const wallItems = useMemo<WallItem[]>(() => {
    const withImg = upcoming.filter(l => l.imageUrl);
    const pct = belowSignal.pct;
    const flagged = withImg
      .filter(l => belowIds.has(l.id))
      .sort((a, b) => dealScore(b, pct.get(b.id) || 0) - dealScore(a, pct.get(a.id) || 0));
    const call = flagged[0] || null;
    const rest = [...flagged.slice(1), ...withImg.filter(l => !belowIds.has(l.id))];
    const ordered = call ? [call, ...rest] : withImg;
    return ordered.slice(0, 14).map(l => ({
      lot: l,
      flagged: belowIds.has(l.id),
      pct: pct.get(l.id),
      call: !!call && l.id === call.id,
    }));
  }, [upcoming, belowIds, belowSignal]);
  const wallEl = wallItems.length >= 3 ? (
    <TonightsWall
      items={wallItems}
      onOpen={setTableLot}
      variant={mounted && isMobile ? 'mobile' : 'desktop'}
      play={!fromCache}
    />
  ) : null;

  // M15 — THE BELOW-MARKET SWEEP: activating the lens sends a butter tracer
  // down the toolbar hairline and ignites the flagged rings in DOM order;
  // clearing reverses the sweep (the rings persist — they're data).
  const prevBelow = React.useRef(feedFilters.belowOnly);
  const [sweep, setSweep] = useState<null | 'on' | 'off'>(null);
  useEffect(() => {
    if (prevBelow.current === feedFilters.belowOnly) return;
    prevBelow.current = feedFilters.belowOnly;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setSweep(feedFilters.belowOnly ? 'on' : 'off');
    const t = setTimeout(() => setSweep(null), 1500);
    return () => clearTimeout(t);
  }, [feedFilters.belowOnly]);

  // M13 — the feed hover preview (desktop table only): 150ms intent delay,
  // one floating mat plate at a time, instant leave. Lazy by construction —
  // the plate (and its image request) exists only while hovered.
  const hoverFine = useMediaQuery('(hover: hover) and (pointer: fine)', false);
  const [hoverPrev, setHoverPrev] = useState<{ lot: AuctionLot; y: number; x: number } | null>(null);
  const hoverTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowEnter = (lot: AuctionLot) => (e: React.MouseEvent<HTMLTableRowElement>) => {
    if (!hoverFine) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverPrev({ lot, y: r.top, x: r.right }), 150);
  };
  // R3 — the plate is clickable now: leaving the ROW hides it after a 140ms
  // grace so the pointer can cross onto the plate; entering the plate cancels
  // the hide, leaving the plate hides at once.
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHoverPrev(null), 140);
  };
  const plateEnter = () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
  const plateLeave = () => setHoverPrev(null);
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);
  // the preview follows the feed, never a stale market/filter set
  useEffect(() => { setHoverPrev(null); }, [feedKey, activeKey]);

  // M18 — the paper bands PRINT themselves once as the reader arrives: an
  // IO-armed clip reveal (600ms, globals.css). Reduced motion / no IO:
  // instant. Each band plays once — the data-reveal stamp survives
  // re-renders because React reuses the DOM node.
  useEffect(() => {
    if (loading || error || typeof IntersectionObserver === 'undefined') return;
    const fresh = document.querySelectorAll<HTMLElement>('.ray-band:not([data-reveal])');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      fresh.forEach(b => b.setAttribute('data-reveal', 'on'));
      return;
    }
    fresh.forEach(b => b.setAttribute('data-reveal', 'armed'));
    // observe EVERY still-armed band, not just the fresh ones — this effect
    // re-runs when the data hooks settle, and the cleanup below disconnects
    // the previous observer; armed-but-unrevealed bands must be re-adopted
    // or they stay clipped forever.
    const armed = document.querySelectorAll<HTMLElement>('.ray-band[data-reveal="armed"]');
    if (armed.length === 0) return;
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          (e.target as HTMLElement).setAttribute('data-reveal', 'on');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    armed.forEach(b => io.observe(b));
    return () => io.disconnect();
  }, [loading, error, activeKey]);

  return (
    <>
    {/* the page's primary heading — visually hidden (the hero leads with the
        market number, not a title) but present for crawlers/AT. */}
    <h1 style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
      lectr — auction intelligence for the collectibles market
    </h1>
    <Greeting />
    <div className={`${styles.root} terminal-shell`} data-mounted={mounted}>
      {/* the feed grid — global ray-* classes the reused LotCard renders into,
          re-authored here (page.tsx carried these in an inline style block). */}
      <style>{`
        .terminal-shell .ray-upcoming-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(288px, 1fr));
          gap: 30px 20px;
        }
        @media (max-width: 768px) {
          .terminal-shell .ray-upcoming-grid { grid-template-columns: 1fr; gap: 24px; }
        }
        /* ≤640px the feed reads as a ledger: compact rows stack flush on their
           shared hairlines; the earned full cards keep their air around them */
        @media (max-width: 640px) {
          .terminal-shell .ray-upcoming-grid { gap: 0; }
          .terminal-shell .ray-feeditem-card { margin-bottom: 24px; /* the old grid gap */ }
          .terminal-shell .ray-feeditem-row + .ray-feeditem-card,
          .terminal-shell .ray-feeditem-card + .ray-feeditem-row { margin-top: var(--space-2); }
        }
        /* the reused paper/record bands are self-contained; let them breathe
           full-width inside the dark shell rather than fight the deskShell rail */
        .terminal-shell .ray-recordband { border-radius: 14px; }
      `}</style>
      {/* M22 — the golden-hour air (pool + grain) is global now: globals.css
          paints it on body, tinted per market (M9). No local layers. */}

      {/* REAL CHROME — ArtistNav mounts CommandK (⌘K search, alerts, mobile sheet) */}
      <ArtistNav activeSlug={null} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {/* the 7-market switch — re-scopes the WHOLE page in place */}
      <div className="rail" style={{ paddingTop: 'var(--space-4)', position: 'relative', zIndex: 3 }}>
        <MarketSwitch compact lit open={!fromCache} emblems />
      </div>

      {error ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '120px 20px', gap: 12, position: 'relative', zIndex: 2 }}>
          <p style={{ fontSize: 13.5, color: 'var(--tt-muted)', textAlign: 'center' }}>{error}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              fontSize: 12.5, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
              padding: '8px 20px', borderRadius: 100, border: '1px solid var(--tt-hair-2)',
              background: 'none', color: 'var(--tt-muted)', cursor: 'pointer',
              fontFamily: 'var(--font-sans), system-ui, sans-serif',
            }}
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          <div className={styles.deskShell}>

            {/* ══ HERO — the market-scoped index glyph + chart draw-in ══ */}
            <IndexHero
              activeKey={activeKey}
              marketLabel={activeKey === 'all' ? 'Total market' : marketMeta.label}
              market={marketData}
              demand={demand[activeKey]}
              realized={realized}
              bidComp={bidComp[activeKey]}
              totalLots={totalLots}
              totalSold={meta.totalSold ?? 0}
              /* R1 — the corpus line is a FULL-CORPUS truth (507,107 lots · 7
                 houses): the crawl's source list, not the eager slice's houses */
              houses={ray.sources?.length || new Set(marketLots.map(l => l.auctionHouse)).size || 7}
              belowMkt={belowMktCount}
              onOpenBelow={openBelowLens}
              onCommand={openCommandK}
              appreciation={appreciation}
              onBlock={upcoming.length}
              play={!fromCache}
              isMobile={mounted && isMobile}
              backtest={backtest}
              wall={wallEl}
              onMarketStep={onMarketStep}
            />

            {/* ══ the live tape — realized hammers, scoped to the market ══ */}
            {tapeItems.length > 0 && (
              <section className={styles.tapeSection}>
                <span className={styles.tapeLabel}>Realized</span>
                <Tape items={tapeItems} />
              </section>
            )}

            {/* ══ Today's call + watchlist (the working rail) ══
                NOTE: the appreciation barometer was removed here — it printed a
                sales-weighted "+X% appreciation" with no confidence interval,
                which the honest hero + verified-movers deliberately avoid. The
                homepage must not assert a return the engine won't defend. */}
            {/* ray-board-belowrow arms the ≥900px two-column certificate
                (plate 42% left, ruled leader rows right — Terminal.tsx
                CALLPLATE_CSS); below 900px the plate keeps today's stack.
                marginTop:0 neutralizes the class's own offset — the
                instrumentRow already owns this row's rhythm. */}
            {/* On desktop the second column carries a condensed sub-market board
                (top 5 rows) beside the call — the plate keeps its STACKED
                composition there (dropping ray-board-belowrow, whose ≥900px
                two-column certificate needs the full width). With no board the
                row collapses to one column and the wide certificate returns. */}
            <div className={styles.instrumentRow}>
              <div ref={callColRef} className={`${styles.callCol}${boardBeside ? '' : ' ray-board-belowrow'}`} style={{ marginTop: 0 }}>
                {callPlateEl}
                {watchStripEl}
              </div>
              {boardBeside && (
                <div className={styles.boardCol}>
                  <SubMarketBoard
                    market={marketData}
                    activeKey={activeKey}
                    onSelect={onMoverSelect}
                    variant="desktop"
                    condensed
                    maxRows={boardRows}
                  />
                </div>
              )}
            </div>

            {backtest && backtest.flagged.n > 500 && (
              <a href="/value" className="ray-proofstrip" style={{ marginTop: 20 }}>
                Flagged calls hammered <b className="up">{fmtSignedPct(backtest.flagged.hammerMedianPct ?? backtest.flagged.medianPerfPct)}</b> over
                their estimates — unflagged hammered {fmtSignedPct(backtest.unflagged.hammerMedianPct ?? backtest.unflagged.medianPerfPct)} — across {backtest.flagged.n.toLocaleString()} replayed
                sales{activeKey !== 'all' ? ' · all markets' : ''} · the record <Flick size={12} />
              </a>
            )}

            {/* ══ THE LEDGER — the market in four figures; flagged IS the lens ══ */}
            <div className={`ray-band ${styles.ledgerBand}`} style={{ marginTop: 40, paddingBlock: '22px 18px', borderRadius: 14 }}>
              <div style={{ padding: '0 clamp(18px, 3vw, 30px)' }}>
                <div style={{ borderTop: '2px solid currentColor', marginBottom: 2 }} />
                <div style={{ borderTop: '1px solid var(--paper-line)', marginBottom: 10 }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <CardEmblem kind="ledger" />
                    The ledger
                  </span>
                  <span style={{ color: 'var(--paper-muted)', fontWeight: 600 }}>{marketName}</span>
                </div>
                <div className="ray-ledger" style={{ margin: 0 }}>
                  {strip.map((item, i) => item.lens && item.to > 0 ? (
                    <button
                      key={item.k}
                      type="button"
                      onClick={openBelowLens}
                      aria-label="See flagged lots on the block, biggest gap first"
                      style={{ background: 'none', border: 'none', margin: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}
                    >
                      <div className="ray-ledger-k">{item.k}</div>
                      <CountUp to={item.to} format={item.format} duration={900} animate={!fromCache} delay={Math.min(i, 3) * 60} className={`ray-ledger-v${item.tone === 'up' ? ' up' : ''}`} style={{ display: 'block' }} />
                      <div className="ray-ledger-s">{item.s} <Flick size={10} /></div>
                    </button>
                  ) : (
                    <div key={item.k}>
                      <div className="ray-ledger-k">{item.k}</div>
                      <CountUp to={item.to} format={item.format} duration={900} animate={!fromCache} delay={Math.min(i, 3) * 60} className={`ray-ledger-v${item.tone === 'up' ? ' up' : ''}`} style={{ display: 'block' }} />
                      <div className="ray-ledger-s">{item.s}</div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid var(--paper-line)', marginTop: 2, paddingTop: 7, display: 'flex', justifyContent: 'space-between', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--paper-muted)' }}>
                  <span>every estimate, read against every hammer</span>
                  <span>no. {editionSerial}</span>
                </div>
              </div>
            </div>

            {/* ══ THE FEED — On the block (full parity) ══ */}
            {upcoming.length > 0 && (
              <section id="on-the-block" className={styles.feedSection} data-sweep={sweep ?? undefined}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                    padding: '10px 0 14px',
                  }}
                >
                  {/* M11 — the section head earns the serif voice, one italic butter word */}
                  <h2 className={styles.feedTitle}>On the <em>block</em></h2>
                  {nextHammer && (
                    <span style={{ fontSize: 13, color: 'var(--tt-faint)', fontFamily: 'var(--font-mono-data), monospace' }}>
                      Next hammer: {nextHammer.word} · {nextHammer.lot.auctionHouse}
                    </span>
                  )}
                </div>

                <div className={styles.toolbarSweepWrap}>
                  <FeedToolbar
                    lots={upcoming}
                    belowIds={belowIds}
                    filters={feedFilters}
                    onChange={handleFilters}
                    shown={feed.length}
                    total={upcoming.length}
                    market={activeKey}
                    onMarketReset={() => setMarket('all')}
                    view={effectiveView}
                    onViewChange={handleView}
                    pageSize={pageSize}
                    showToggle={!narrowView}
                  />
                  {/* M15 — the lens tracer riding the toolbar hairline */}
                  {sweep && <span key={sweep} className={styles.lensTracer} data-dir={sweep} aria-hidden />}
                </div>

                {effectiveView === 'table' && feed.length > 0 ? (
                  <div key={feedKey} className="ray-feed-rekey" style={{ overflowX: 'auto' }}>
                    <table className="ray-feedtable">
                      <thead>
                        <tr>
                          <th></th>
                          <th>Maker / work</th>
                          <th>House</th>
                          <th>Cat.</th>
                          <th>Hammers</th>
                          <th className="num">In</th>
                          <th className="num">Bids</th>
                          <th className="num">Estimate</th>
                          <th>Signal</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {feed.slice(0, visibleUpcoming).map((lot, ri) => {
                          const sig = lotSignal(lot, marketLots);
                          const dth = daysToHammer(lot, localToday());
                          return (
                            <tr
                              key={lot.id}
                              onClick={() => setTableLot(lot)}
                              onKeyDown={e => { if (e.key === 'Enter') setTableLot(lot); }}
                              onMouseEnter={rowEnter(lot)}
                              onMouseLeave={rowLeave}
                              tabIndex={0}
                              role="button"
                              aria-label={`Comps for ${craftTitle(lot.title)}`}
                              style={{ cursor: 'pointer', ['--ring-i' as string]: Math.min(ri, 14) }}
                            >
                              <td style={{ width: 56 }}>
                                <span className="thumb-plate" data-tone={feedTone(lot, belowIds, belowSignal.hasSig)} style={{ position: 'relative' }}>
                                  {(lot.title || '?').charAt(0)}
                                  {lot.imageUrl && (
                                    <img
                                      className="thumb"
                                      src={httpsImg(lot.imageUrl)}
                                      alt=""
                                      loading="lazy"
                                      decoding="async"
                                      referrerPolicy="no-referrer"
                                      style={{ position: 'absolute', inset: 0 }}
                                      ref={el => { if (el && el.complete && el.naturalWidth === 0) el.style.display = 'none'; }}
                                      onError={e => { e.currentTarget.style.display = 'none'; }}
                                    />
                                  )}
                                </span>
                              </td>
                              <td>
                                <Link
                                  href={`/${lot.artist}`}
                                  className="t-artist"
                                  onClick={e => e.stopPropagation()}
                                >
                                  {ARTIST_LABEL[lot.artist] || lot.artist}
                                </Link>
                                {/* R3 — the title is the explicit door to the
                                    lot page; the row body keeps the comps modal */}
                                <Link
                                  href={`/lot?id=${encodeURIComponent(lot.id)}`}
                                  className="t-title t-lotlink"
                                  title="Open the lot page"
                                  onClick={e => e.stopPropagation()}
                                  style={{ display: 'block', textDecoration: 'none' }}
                                >
                                  {craftTitle(lot.title)}
                                  <span className="t-lotgo" aria-hidden> →</span>
                                </Link>
                              </td>
                              <td>{lot.auctionHouse}</td>
                              <td className="t-cat">{CAT_LABEL[lot.category] || '—'}</td>
                              <td className="t-date">{formatDate(lot.saleDate)}</td>
                              <td className="num t-days">
                                {dth == null ? '—' : dth <= 0 ? 'today' : `${dth}d`}
                              </td>
                              <td className="num t-bids">{typeof lot.bidCount === 'number' ? lot.bidCount.toLocaleString() : '—'}</td>
                              <td className="num t-est">
                                {lot.estimateLow && lot.estimateHigh
                                  ? (formatPrice(lot.estimateLow) === formatPrice(lot.estimateHigh)
                                      ? formatPrice(lot.estimateLow)
                                      : `${formatPrice(lot.estimateLow)}–${formatPrice(lot.estimateHigh)}`)
                                  : '—'}
                              </td>
                              <td>
                                {sig
                                  ? <span className={sig.label === 'Below Market' ? 't-sig-up' : 't-sig-down'}>
                                      {/* R18 — the one signal grammar */}
                                      {gapGrammar(sig.label, sig.pct)}
                                      <span title={`${confidenceMeter(sig.confidence).word} confidence`} style={{ marginLeft: 6, fontSize: 10, letterSpacing: 1, opacity: 0.8 }}>
                                        {confidenceMeter(sig.confidence).dots}
                                      </span>
                                    </span>
                                  : <span style={{ color: 'var(--color-text-faint)' }}>—</span>}
                              </td>
                              <td style={{ width: 44 }}>
                                <button
                                  className="ray-save-btn ray-tbl-save"
                                  onClick={e => { e.stopPropagation(); toggle(lot.id, lot); }}
                                  aria-label={isSaved(lot.id) ? 'Remove from saved' : 'Save lot'}
                                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: isSaved(lot.id) ? 'var(--color-fg)' : 'var(--color-bg-elevated)', border: 'none', borderRadius: 100, cursor: 'pointer', padding: 0 }}
                                >
                                  <svg width="10" height="12" viewBox="0 0 12 14" fill="none" aria-hidden="true">
                                    <path d="M1 1.5C1 1.22386 1.22386 1 1.5 1H10.5C10.7761 1 11 1.22386 11 1.5V12.5C11 12.6894 10.8862 12.8625 10.7096 12.9472C10.533 13.0319 10.3239 13.0136 10.1646 12.8994L6 9.91421L1.83541 12.8994C1.67614 13.0136 1.46698 13.0319 1.29037 12.9472C1.11377 12.8625 1 12.6894 1 12.5V1.5Z" fill={isSaved(lot.id) ? 'var(--color-bg)' : 'var(--color-text-faint)'} />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                <div className="ray-upcoming-grid" key={feedKey}>
                  {feed.length === 0 ? (
                    <div className="ray-feed-empty">
                      <Flick size={28} draw style={{ color: 'var(--color-text-faint)' }} />
                      <p>Nothing on the block matches that.</p>
                      <button className="ray-toolbar-reset" onClick={() => handleFilters(FEED_DEFAULTS)}>
                        Clear the lenses
                      </button>
                    </div>
                  ) : (
                    feed.slice(0, visibleUpcoming).map((lot, i) =>
                      // ≤640px: EVERY lot folds to a compact ruled row — the
                      // engine's verdict shows as a quiet glow behind the
                      // thumb (green = below market, red = reads rich). No
                      // same-sale run folding: it applied only to Goldin runs
                      // (inconsistent + fragile under re-sorts); pagination +
                      // the maker-diversity cap own volume now.
                      narrowView ? (
                        <div
                          key={lot.id}
                          className="ray-feed-rekey ray-feeditem-row"
                          style={{ animationDelay: `${Math.min(i, 10) * 40}ms`, minWidth: 0, ['--ring-i' as string]: Math.min(i, 14) }}
                        >
                          <FeedRow
                            lot={lot}
                            onOpen={() => setTableLot(lot)}
                            tone={feedTone(lot, belowIds, belowSignal.hasSig)}
                            signal={lotSignal(lot, marketLots)}
                          />
                        </div>
                      ) : (
                        <div
                          key={lot.id}
                          className="ray-feed-rekey ray-feeditem-card"
                          style={{ animationDelay: `${Math.min(i, 10) * 40}ms`, minWidth: 0, ['--ring-i' as string]: Math.min(i, 14) }}
                        >
                          <LotCard
                            lot={lot}
                            showArtist
                            allLots={marketLots}
                            saved={isSaved(lot.id)}
                            onToggleSave={toggle}
                            lastCrawl={lastCrawl || undefined}
                          />
                        </div>
                      )
                    )
                  )}
                </div>
                )}

                {/* M13 — the floating preview plate (desktop table, fine pointers) */}
                {hoverFine && effectiveView === 'table' && hoverPrev && !tableLot && (
                  <HoverPlate
                    lot={hoverPrev.lot}
                    x={hoverPrev.x}
                    y={hoverPrev.y}
                    tone={feedTone(hoverPrev.lot, belowIds, belowSignal.hasSig)}
                    sig={lotSignal(hoverPrev.lot, marketLots)}
                    onEnter={plateEnter}
                    onLeave={plateLeave}
                  />
                )}

                {tableLot && (
                  <ComparableModal lot={tableLot} allLots={marketLots} onClose={() => setTableLot(null)} />
                )}

                {visibleUpcoming < feed.length && (
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
                    <button
                      onClick={() => setVisibleUpcoming(v => v + pageSize)}
                      style={{
                        background: 'none',
                        border: '1px solid var(--tt-hair-2)',
                        borderRadius: 100,
                        padding: '10px 32px',
                        fontSize: 12.5,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'var(--tt-muted)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'var(--font-sans), system-ui, sans-serif',
                      }}
                    >
                      Show more ({(feed.length - visibleUpcoming).toLocaleString()} remaining)
                    </button>
                  </div>
                )}
              </section>
            )}

            {/* ══ THE SUB-MARKET BOARD — the FULL board, only where the condensed
                board beside Today's Call isn't already showing it (mobile, or
                narrow desktop). On wide desktop the board rides beside the call
                and this section is dropped as duplicative. ══ */}
            {marketData?.subMarkets && !boardBeside && (
              <section id="sub-markets" className={styles.moversSection}>
                <SubMarketBoard
                  market={marketData}
                  activeKey={activeKey}
                  onSelect={onMoverSelect}
                  variant={mounted && isMobile ? 'mobile' : 'desktop'}
                />
              </section>
            )}

            {/* Phase-2 lazy trigger for the art/design/watches/all Record band */}
            {!isSportsScience && <Phase2Sentinel />}

            {/* ══ THE RECORD — the functional sold band (parity) ══ */}
            {isSportsScience ? (
              recentRows.length > 0 && (
                <div className={styles.recordBandWrap}>
                  <SettlementSlip
                    marketName={marketName}
                    serial={editionSerial}
                    archiveOpen={showArchive}
                    onToggleArchive={() => setShowArchive(s => !s)}
                    lines={[
                      { k: 'Sold lots on the book', v: (meta.totalSold ?? recentRows.length).toLocaleString() },
                      ...(recentMedian !== null ? [{ k: 'Recent median, realized', v: formatPrice(recentMedian) }] : []),
                      ...(recentLatest ? [{ k: 'Latest hammer', v: formatDate(recentLatest) }] : []),
                    ]}
                  />
                  {showArchive && (
                    <section className="rail" style={{ paddingBlock: '8px 40px' }}>
                      <ArchiveResults mktSet={mktSet} savedIds={savedIds} onToggleSave={toggle} />
                    </section>
                  )}
                </div>
              )
            ) : sold.length > 0 && (activeKey === 'all' ? (
              <div className={`${styles.recordBandWrap} ${styles.recordEmblem}`}>
                <SettlementSlip
                  marketName={marketName}
                  serial={editionSerial}
                  archiveOpen={showArchive}
                  onToggleArchive={() => setShowArchive(s => !s)}
                  lines={[
                    { k: 'Sold lots on the book', v: (meta.totalSold ?? sold.length).toLocaleString() },
                    ...(soldMedianPct !== null ? [{ k: 'Median hammer vs estimate', v: fmtSignedPct(soldMedianPct), signed: soldMedianPct }] : []),
                    ...(sold[0].saleDate ? [{ k: 'Latest hammer', v: formatDate(sold[0].saleDate) }] : []),
                  ]}
                />
                {showArchive && (
                  <section className="rail" style={{ paddingBlock: '8px 40px' }}>
                    <div className="ray-recordband" style={{ marginTop: 0 }}>
                      <PastResults lots={sold} showArtist savedIds={savedIds} onToggleSave={toggle} />
                    </div>
                  </section>
                )}
              </div>
            ) : (
              <div className={`ray-recordband ${styles.recordBandWrap} ${styles.recordEmblem}`}>
                <div className="rail">
                  <PastResults lots={sold} showArtist savedIds={savedIds} onToggleSave={toggle} />
                </div>
              </div>
            ))}

            {/* ══ THE RECORD BOARD — the Terminal flourish (curated cross-cat highs) ══ */}
            <section className={styles.recordSection}>
              <RecordBoard variant={mounted && isMobile ? 'mobile' : 'desktop'} market={activeKey} />
            </section>
          </div>

          {/* ══ THE COLOPHON — full route map (nav/SEO) ══ */}
          <Colophon
            lotCount={totalLots}
            houseCount={new Set(allLots.map(l => l.auctionHouse)).size}
            record={backtest?.flagged ? { n: backtest.flagged.n, medianPerfPct: backtest.flagged.hammerMedianPct ?? backtest.flagged.medianPerfPct } : null}
          />
        </RayEntrance>
      )}
    </div>
    </>
  );
}
