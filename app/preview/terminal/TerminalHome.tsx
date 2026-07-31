'use client';

/* ============================================================
   THE TERMINAL — the REAL lectr homepage, brought to full
   functional parity with the working lander (app/page.tsx) and
   dressed in the Terminal's winning design grammar.

   STRATEGY (per the build directive): this file copies the
   FUNCTIONAL logic of app/page.tsx verbatim — state, memos,
   market scoping, feed computation, save, phases, effects — and
   only changes presentation: the lander hero is swapped for
   the market-scoped IndexHero + RecordBoard,
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
import LotCard, { lotSignal, confidenceMeter } from '../../components/LotCard';
import { dealScore, signalMagnitude } from '../../lib/comps';
import ComparableModal from '../../components/ComparableModal';
import type { AuctionLot } from '../../types';
import PastResults from '../../components/PastResults';
import RayEntrance, { RayLoading } from '../../components/RayEntrance';
import CountUp from '../../components/CountUp';
import SettlementSlip from '../../components/SettlementSlip';
import MarketSwitch from '../../components/MarketSwitch';
import FeedToolbar, { FeedFilters, FEED_DEFAULTS } from '../../components/FeedToolbar';
import { weekDaysFor } from '../../components/HammerWeek';
import { Colophon, daysWord } from '../../components/Terminal';
import Flick from '../../components/Flick';
import Greeting from '../../components/Greeting';
import { OPEN_CK_EVENT } from '../../components/CommandK';

// Terminal design assets (the DESIGN win)
import IndexHero from './IndexHero';
import SubMarketBoard, { hasSubMarketRows } from './SubMarketBoard';
import TonightsWall, { type WallItem } from './TonightsWall';
import { useMediaQuery, useMounted } from './hooks';
import styles from './style.module.css';

// W13 contract: useSavedLots grows a savedMeta record (hook agent's edit).
type SavedMeta = Record<string, { savedAt: string; estMid: number | null; signalPct: number | null; bidCount: number | null }>;
const EMPTY_SAVED_META: SavedMeta = {};

// The eager recentSold slice (from upcoming.json) — lightweight Goldin closes.
type RecentSoldRow = { id: string; title: string; artist: string; priceUsd?: number; house?: string; saleDate?: string; url?: string; priceBasis?: string; category?: string; objectType?: string; eventKey?: string };


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

function FeedRow({ lot, onOpen, tone }: { lot: AuctionLot; onOpen: () => void; tone?: 'up' | 'down' }) {
  const est =
    lot.estimateLow || lot.estimateHigh
      ? (lot.estimateLow && lot.estimateHigh && formatPrice(lot.estimateLow) !== formatPrice(lot.estimateHigh)
          ? `${formatPrice(lot.estimateLow)}–${formatPrice(lot.estimateHigh)}`
          : formatPrice(lot.estimateLow || lot.estimateHigh!))
      : lot.currentBid
        ? `bid ${formatPrice(lot.currentBid)}`
        : '—';
  return (
    <button type="button" className="ray-feedrow" onClick={onOpen} aria-label={`Comps for ${craftTitle(lot.title)}`}>
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
      </span>
      <span className="ray-feedrow-right">
        <b>{est}</b>
        <span>{formatDate(lot.saleDate)}</span>
      </span>
    </button>
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

  // TONIGHT'S WALL — the call lot + the next best flagged-with-image, then
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

  // The Value Engine's chapter-01 hero: ONE lot — the highest-confidence,
  // deepest-value flag on the book (confidence tier first, then gap depth).
  // Prefers a lot not already hanging on Tonight's Wall; falls back to the
  // absolute best when no high-confidence flag exists off the wall.
  const engineHero = useMemo(() => {
    const CONF: Record<string, number> = { 'very-high': 3, high: 2, medium: 1, low: 0 };
    const wallSet = new Set(wallItems.map(w => w.lot.id));
    const cands = upcoming
      .filter(l => l.imageUrl && belowIds.has(l.id)
        // the engine's showcase must be ACTIONABLE: live by the true sale day
        // AND, when the close time is known, the clock not yet run out (a
        // timed lot that closed earlier today slips day-level guards)
        && isLiveUpcoming(l) && !l.resultsPending
        && (!l.saleDateTime || Date.parse(l.saleDateTime) > Date.now()))
      .map(l => ({ lot: l, signal: lotSignal(l, allLots) }))
      .filter((x): x is { lot: AuctionLot; signal: NonNullable<ReturnType<typeof lotSignal>> } =>
        !!x.signal && x.signal.label === 'Below Market')
      .sort((a, b) =>
        (CONF[b.signal.confidence || 'low'] - CONF[a.signal.confidence || 'low'])
        || (b.signal.pct - a.signal.pct));
    const offWall = cands.find(x => !wallSet.has(x.lot.id) && CONF[x.signal.confidence || 'low'] >= 2);
    return offWall ?? cands[0] ?? null;
  }, [upcoming, belowIds, allLots, wallItems]);


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

  const onMoverSelect = (key: Market) => setMarket(key);

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
      <div className={styles.bgField} aria-hidden />
      <div className={styles.grain} aria-hidden />

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
              houses={new Set(marketLots.map(l => l.auctionHouse)).size || (ray.sources?.length ?? 7)}
              belowMkt={belowMktCount}
              onOpenBelow={openBelowLens}
              onCommand={openCommandK}
              appreciation={appreciation}
              onBlock={upcoming.length}
              play={!fromCache}
              isMobile={mounted && isMobile}
            />

            {/* ══ TONIGHT'S WALL — the photographed front row (kept). A padded
                seam sets it apart from the hero's search. ══ */}
            {wallEl && <div className={styles.wallSeparator}>{wallEl}</div>}

            {/* ══ ROOM · THE VERIFIED BOARD — every certified read, on paper.
                The movers ARE the board's top rows (one table, no duplicate
                strip); the record sentence prints ONCE as the room's footer. ══ */}
            {marketData?.subMarkets && (
              <section className={styles.roomPaper}>
                <div className={styles.roomInner}>
                  <SubMarketBoard
                    market={marketData}
                    activeKey={activeKey}
                    onSelect={onMoverSelect}
                    variant={mounted && isMobile ? 'mobile' : 'desktop'}
                    paper
                    receipts={backtest ? {
                      flaggedPct: backtest.flagged.hammerMedianPct ?? backtest.flagged.medianPerfPct,
                      unflaggedPct: backtest.unflagged.hammerMedianPct ?? backtest.unflagged.medianPerfPct,
                      n: backtest.flagged.n,
                      asOf: marketData?.generatedAt?.slice(0, 10) ?? null,
                    } : null}
                    hero={engineHero}
                    onOpenLot={setTableLot}
                  />
                </div>
              </section>
            )}

            {/* the watchlist strip — the reader's saved lots (small, personal) */}
            {watchStripEl}

            {/* ══ THE FEED — On the block (full parity) ══ */}
            {upcoming.length > 0 && (
              <section id="on-the-block" className={styles.feedSection}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    padding: '10px 0 18px',
                  }}
                >
                  <h2 className={styles.feedTitle}>On the <em>block</em></h2>
                  {nextHammer && (
                    <span style={{ fontSize: 13.5, color: 'var(--tt-muted)' }}>
                      Next hammer: {nextHammer.word} · {nextHammer.lot.auctionHouse}
                    </span>
                  )}
                </div>

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
                        {feed.slice(0, visibleUpcoming).map(lot => {
                          const sig = lotSignal(lot, marketLots);
                          const dth = daysToHammer(lot, localToday());
                          return (
                            <tr
                              key={lot.id}
                              onClick={() => setTableLot(lot)}
                              onKeyDown={e => { if (e.key === 'Enter') setTableLot(lot); }}
                              tabIndex={0}
                              role="button"
                              aria-label={`Comps for ${craftTitle(lot.title)}`}
                              style={{ cursor: 'pointer' }}
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
                                <div className="t-title">{craftTitle(lot.title)}</div>
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
                                      {signalMagnitude(sig.label, sig.pct)}<span style={{ color: 'var(--color-text-faint)', marginLeft: 5 }}>{sig.label === 'Below Market' ? 'under comps' : 'over comps'}</span>
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
                          style={{ animationDelay: `${Math.min(i, 10) * 40}ms`, minWidth: 0 }}
                        >
                          <FeedRow
                            lot={lot}
                            onOpen={() => setTableLot(lot)}
                            tone={feedTone(lot, belowIds, belowSignal.hasSig)}
                          />
                        </div>
                      ) : (
                        <div
                          key={lot.id}
                          className="ray-feed-rekey ray-feeditem-card"
                          style={{ animationDelay: `${Math.min(i, 10) * 40}ms`, minWidth: 0 }}
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
                        fontSize: 13,
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

            {/* phase-2 trigger — the settlement slip below reads the full sold
                corpus; the sentinel starts that fetch as the reader approaches */}
            <Phase2Sentinel />

            {/* ══ ROOM · THE SETTLEMENT — the slip is the room. ══ */}
            <section className={styles.roomPaper}>
            <div className={styles.roomInner}>
            <div className={styles.slipRoom}>
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
            </div>
            </div>
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
