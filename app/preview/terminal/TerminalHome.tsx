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

import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { MARKETS, ROSTER, marketArtists, type Market } from '../../constants';
import { useMarket } from '../../lib/market';
import { useRayData, useSoldArchive, retryArchiveLoad, triggerFullLoad, retryFullLoad } from '../../hooks/useRayData';
import { loadPageStats, type PageStats } from '../../lib/page-data';
import { signalCallOf } from '../../lib/account';
import { useSavedLots } from '../../hooks/useSavedLots';
import { formatDate, formatPrice, getUpcomingCounts, craftTitle, fmtSignedPct, localToday, trueSaleDay, isLiveUpcoming, overEstimatePct } from '../../utils';
import ArtistNav from '../../components/ArtistNav';
import { lotSignal } from '../../components/LotCard';
import { dealScore } from '../../lib/comps';
import ComparableModal from '../../components/ComparableModal';
import type { AuctionLot } from '../../types';
import PastResults from '../../components/PastResults';
import RayEntrance, { RayLoading } from '../../components/RayEntrance';
import SettlementSlip from '../../components/SettlementSlip';
import MarketSwitch from '../../components/MarketSwitch';
import { FeedFilters, FEED_DEFAULTS, FEED_PARAM_KEYS, feedFromParams, feedToParams } from '../../components/FeedToolbar';
import { useUrlState, useLastVisit, houseBaselines, memoryOf, restoreParams, readFeedMemory, writeFeedMemory } from '../../lib/feed-filters';
import { closeIsTimed } from '../../lib/house-tz';
import { makerLineOf } from '../../lib/lot-labels';
import { usePlayerDossiers } from '../../lib/use-player-dossiers';
import { useFollows } from '../../lib/follows';
import { Colophon, daysWord, pickCall } from '../../components/Terminal';
import Flick from '../../components/Flick';
import Greeting from '../../components/Greeting';
import { OPEN_CK_EVENT } from '../../components/CommandK';
import LotBrowser, { belowSignalOf } from '../../components/LotBrowser';
import { useLotModal } from '../../lib/use-lot-modal';

// Terminal design assets (the DESIGN win)
import IndexHero from './IndexHero';
import SubMarketBoard from './SubMarketBoard';
import TonightsWall, { type WallItem, gapMultiple } from './TonightsWall';
import { CellGrid, Cell, ColorCell, FigGate, FigCorpus, FigPools, FigTape } from '../../components/cells';
import { useMediaQuery, useMounted } from './hooks';
import styles from './style.module.css';

// W13 contract: useSavedLots grows a savedMeta record (hook agent's edit).
type SavedMeta = Record<string, { savedAt: string; estMid: number | null; signalPct: number | null; bidCount: number | null }>;
const EMPTY_SAVED_META: SavedMeta = {};

// The eager recentSold slice (from upcoming.json) — lightweight Goldin closes.
type RecentSoldRow = { id: string; title: string; artist: string; priceUsd?: number; house?: string; saleDate?: string; url?: string; priceBasis?: string; category?: string; objectType?: string; eventKey?: string };


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
// The feed itself (table / cards / phone rows, folds, pagination) lives in
// components/LotBrowser — shared with the maker pages.

/* THE INSTRUMENT SET's chip icons — 20px cuts of the cell system's patent
   grammar (solid ink + dotted construction lines, currentColor). Drawn here,
   not in cells.tsx: the figures there are 132px plates; these are chips. */
const ICO = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 } as const;
const ICO_DOT = { ...ICO, strokeDasharray: '1 2.4' } as const;
function IcoRecord() { // the settled tape — ticks print, one result steps up
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <line x1="2.5" y1="13.5" x2="17.5" y2="13.5" {...ICO} />
      <line x1="5.5" y1="13.5" x2="5.5" y2="11.5" {...ICO} />
      <line x1="14.5" y1="13.5" x2="14.5" y2="11.5" {...ICO} />
      <path d="M8.5 13.5 L8.5 8 L11.5 8 L11.5 13.5" {...ICO} />
      <line x1="2.5" y1="8" x2="17.5" y2="8" {...ICO_DOT} />
    </svg>
  );
}
function IcoDesk() { // the save mark — the same bookmark the feed prints
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path d="M5.5 3.5 H14.5 V16.5 L10 13.2 L5.5 16.5 Z" {...ICO} />
      <line x1="5.5" y1="6.8" x2="14.5" y2="6.8" {...ICO_DOT} />
    </svg>
  );
}

// The instrument set's honest platform counts — static, from the same
// constants every page already trusts ('all' is the anchor, not a vertical).
// ROSTER splits named makers from category pseudo-artists: "54 makers" was
// counting 22 categories as people.
const VERTICAL_COUNT = MARKETS.length - 1;

export default function TerminalHomePage() {
  const ray = useRayData();
  usePlayerDossiers(); // athlete names on memorabilia rows link to /player once the dossier index lands
  const { allLots, statsByArtist, demand, realized, bidComp, recentSold, backtest, market: marketData, lastCrawl, loading, error, fromCache } = ray;
  const { market, setMarket } = useMarket();
  const marketMeta = MARKETS.find(m => m.key === market)!;
  const mounted = useMounted();
  const isMobile = useMediaQuery('(max-width: 820px)', false);

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

  // #4 · HONEST SCOPED SOLD COUNT — sum the per-slug sold totals over the
  // active market (statsByArtist carries totalSoldTracked). Lets the
  // settlement slip print a count that actually wears its scope, instead of
  // the corpus-wide "all markets" fallback.
  const scopedSold = useMemo(() => {
    if (activeKey === 'all') return null;
    const set = marketArtists(activeKey);
    let n = 0, any = false;
    for (const [slug, st] of Object.entries(statsByArtist)) {
      if (!set.has(slug)) continue;
      const t = (st as { totalSoldTracked?: number }).totalSoldTracked;
      if (typeof t === 'number') { n += t; any = true; }
    }
    return any ? n : null;
  }, [statsByArtist, activeKey]);

  const meta = ray as unknown as { totalLots?: number; totalSold?: number };
  const totalLots = meta.totalLots ?? allLots.length;
  const isSportsScience = activeKey === 'sports' || activeKey === 'science';
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const marketLots = useMemo(() => allLots.filter(l => mktSet.has(l.artist)), [allLots, mktSet]);
  const savedApi = useSavedLots();
  const { toggle, isSaved, savedIds } = savedApi;
  const savedMeta = (savedApi as unknown as { savedMeta?: SavedMeta }).savedMeta ?? EMPTY_SAVED_META;

  // Oct 8: the feed state lives in the URL (reload / share reopens the view)
  const [feedFilters, setFeedFilters] = useUrlState<FeedFilters>(FEED_DEFAULTS, feedFromParams, feedToParams);
  const prevVisitDay = useLastVisit();
  // a house's first-crawl flood is not "new" (feed-filters houseBaselines),
  // read off the whole loaded book so every market agrees
  const baselines = useMemo(() => houseBaselines(allLots), [allLots]);
  // Oct 9 — "open my feed the way I left it": a bare visit (no feed param in
  // the URL) restores the reader's last triage + tab + sort on this device;
  // a URL with any feed param wins untouched. Runs after useUrlState's own
  // mount read (effects fire in order), so the restore lands in the URL too.
  const [restoredView, setRestoredView] = useState(false);
  useEffect(() => {
    const here = new URLSearchParams(window.location.search);
    if (FEED_PARAM_KEYS.some(k => here.has(k))) return;
    const p = restoreParams(readFeedMemory(), activeKey);
    if (!p) return;
    setFeedFilters(feedFromParams(p));
    setRestoredView(true);
    // mount-only: the memory is read once per visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // every reader-made change is the new "way I left it"
  const rememberFeed = useCallback((next: FeedFilters) => {
    const p = new URLSearchParams();
    feedToParams(next, p);
    writeFeedMemory(memoryOf(p, activeKey));
  }, [activeKey]);
  const { follows } = useFollows();
  // the comps modal, joined to history (app/lib/use-lot-modal) — shared by
  // the feed, Tonight's Wall and the verified board
  const [tableLot, setTableLot] = useLotModal<AuctionLot>();
  const [showArchive, setShowArchive] = useState(false);
  // THE SETTLEMENT, precomputed (Sep 27 2026): the slip's three numbers used
  // to wait on the whole sold corpus (~35MB) — a black slab for most of a
  // visit. The build prints them into pages/page-stats.json (same filter,
  // same median pick, same served book), so the slip paints from ~40KB and
  // the corpus is fetched only when the reader opens the archive table.
  // undefined = loading · null = a data build without page-stats (the old
  // corpus path below still stands).
  const [pageStats, setPageStats] = useState<PageStats | null | undefined>(undefined);
  useEffect(() => {
    let dead = false;
    loadPageStats().then(s => { if (!dead) setPageStats(s); });
    return () => { dead = true; };
  }, []);
  const statsFallback = pageStats === null;
  // opening the archive is what asks for the corpus (PastResults browses it)
  useEffect(() => { if (showArchive && !statsFallback) triggerFullLoad(); }, [showArchive, statsFallback]);

  // Lenses are scoped to the market they were picked in — market switches drop
  // the scoped lenses; query, sort and the below-market lens travel with the reader.
  // (only on a real market FLIP — never on mount, or a shared link's
  // ?v=/?cat= lens would be wiped the instant the URL state hydrates)
  const lensMarket = useRef(activeKey);
  useEffect(() => {
    if (lensMarket.current === activeKey) return;
    lensMarket.current = activeKey;
    setFeedFilters(f =>
      f.vertical === null && f.maker === null && f.sport === null && f.category === null && f.saleDay == null && f.cat == null && f.sub == null
        ? f
        : { ...f, vertical: null, maker: null, sport: null, category: null, saleDay: null, cat: null, sub: null }
    );
  }, [activeKey, setFeedFilters]);

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

  // THE RAIL'S MICRO-READS — one standardized read per cell: live lots on
  // the block (Collin, Aug 22 2026: no % in the rail — one grammar, eight
  // cells). The anchor carries the total.
  const railReads = useMemo(() => {
    const out: Partial<Record<Market, number>> = {};
    let total = 0;
    for (const m of MARKETS) {
      if (m.key === 'all') continue;
      const set = marketArtists(m.key);
      let live = 0;
      for (const a of Array.from(set)) live += upcomingCounts[a] || 0;
      total += live;
      out[m.key] = live;
    }
    out.all = total;
    return out;
  }, [upcomingCounts]);

  // The pulse board's "closing next" line: each house's NEAREST close in the
  // scoped live book, soonest first. n = lots that settle that day.
  const closingNext = useMemo(() => {
    // "tonight" is earned by a real close time this evening (house-tz
    // closeIsTimed) — a date-only house closing today reads "today"
    const byHouse = new Map<string, { house: string; when: string; n: number; tonight?: boolean }>();
    const evening = (l: AuctionLot) => closeIsTimed(l) && new Date(l.saleDateTime as string).getHours() >= 17;
    for (const l of upcoming) {
      if (l.resultsPending) continue;
      const h = l.auctionHouse;
      if (!h) continue;
      const when = trueSaleDay(l);
      if (!when) continue;
      const cur = byHouse.get(h);
      if (!cur || when < cur.when) byHouse.set(h, { house: h, when, n: 1, tonight: evening(l) });
      else if (when === cur.when) { cur.n++; if (evening(l)) cur.tonight = true; }
    }
    return Array.from(byHouse.values()).sort((a, b) => (a.when < b.when ? -1 : 1)).slice(0, 3);
  }, [upcoming]);

  // One shared below-market pass.
  const belowSignal = useMemo(() => belowSignalOf(upcoming, marketLots), [upcoming, marketLots]);
  const belowIds = belowSignal.ids;

  // TONIGHT'S WALL — the call lot + the next best flagged-with-image, then
  // photographed lots in hammer order as backfill. MORE than 5 candidates ship
  // so a dead image drops out and the next one hangs in its place.
  // TODAY'S CALL — ONE selector for the whole product: pickCall, the exact
  // function /value's CallPlate runs over the same scoped book (confidence
  // gate, actionable clock, lotFitsMarket, dealScore). Home used to crown the
  // wall's own top dealScore flag instead — Goddard here, KAWS on /value.
  const call = useMemo(() => pickCall(marketLots, marketLots, activeKey), [marketLots, activeKey]);
  const todaysCall = useMemo(
    () => (call && call.signal ? { lot: call.lot, pct: call.signal.pct } : null),
    [call],
  );

  // TONIGHT'S WALL — lots that genuinely hammer within 48 hours (the audit
  // caught a "tonight" wall hanging lots 25 days out). Flagged-with-image
  // first by dealScore, then photographed lots in hammer order. MORE than 5
  // candidates ship so a dead image drops out and the next one hangs. Under
  // three photographed lots in the window → no wall (never padded with next
  // month). The call tag marks the call only if it hammers in the window.
  const wallItems = useMemo<WallItem[]>(() => {
    const now = Date.now();
    const horizon = now + 48 * 3600_000;
    const today = localToday();
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
    const within48h = (l: AuctionLot) => {
      if (l.resultsPending) return false;
      if (l.saleDateTime) { const t = Date.parse(l.saleDateTime); if (Number.isFinite(t)) return t > now && t <= horizon; }
      const d = trueSaleDay(l);
      return !!d && d >= today && d <= tomorrow;
    };
    const withImg = upcoming.filter(l => l.imageUrl && within48h(l));
    const pct = belowSignal.pct;
    const flagged = withImg
      .filter(l => belowIds.has(l.id))
      .sort((a, b) => dealScore(b, pct.get(b.id) || 0) - dealScore(a, pct.get(a.id) || 0));
    const ordered = [...flagged, ...withImg.filter(l => !belowIds.has(l.id))];
    const callId = todaysCall?.lot.id;
    if (callId) {
      const i = ordered.findIndex(l => l.id === callId);
      if (i > 0) ordered.unshift(...ordered.splice(i, 1));
    }
    return ordered.slice(0, 14).map(l => ({
      lot: l,
      flagged: belowIds.has(l.id),
      pct: pct.get(l.id),
      call: l.id === callId,
    }));
  }, [upcoming, belowIds, belowSignal, todaysCall]);
  const wallEl = wallItems.length >= 3 ? (
    <TonightsWall
      items={wallItems}
      onOpen={setTableLot}
      variant={mounted && isMobile ? 'mobile' : 'desktop'}
      play={!fromCache}
    />
  ) : null;


  // The Value Engine's chapter-01 hero: ONE lot — the best flag on the book
  // by THE ONE FLAGGED RANKING (dealScore: calibrated odds first, then the
  // capped gap — never confidence+pct, which is a second ranking).
  // Prefers a high-confidence lot not already hanging on Tonight's Wall
  // (confidence is a GATE here, not the sort); falls back to the absolute
  // best when no high-confidence flag exists off the wall.
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
      .sort((a, b) => dealScore(b.lot, b.signal.pct) - dealScore(a.lot, a.signal.pct));
    const offWall = cands.find(x => !wallSet.has(x.lot.id) && CONF[x.signal.confidence || 'low'] >= 2);
    return offWall ?? cands[0] ?? null;
  }, [upcoming, belowIds, allLots, wallItems]);


  // every reader-made change is remembered; a folded note's group search is not
  const handleFilters = useCallback((next: FeedFilters, source: 'reader' | 'fold' = 'reader') => {
    setFeedFilters(next);
    if (source === 'reader') rememberFeed(next);
  }, [setFeedFilters, rememberFeed]);
  // the quiet way back: defaults, and the remembered view is forgotten
  const resetView = () => {
    setFeedFilters(FEED_DEFAULTS);
    writeFeedMemory(null);
    setRestoredView(false);
  };
  const viewIsDefault = useMemo(() => {
    const p = new URLSearchParams();
    feedToParams(feedFilters, p);
    return p.toString() === '';
  }, [feedFilters]);

  // The below-market lens: biggest gap first, at the feed.
  const openBelowLens = () => {
    setFeedFilters(f => { const next: FeedFilters = { ...f, belowOnly: true, sort: 'gap-desc' }; rememberFeed(next); return next; });
    document.getElementById('on-the-block')?.scrollIntoView({ behavior: 'smooth' });
  };

  const sold = useMemo(() =>
    marketLots
      .filter(l => l.status === 'sold' && l.priceUsd)
      .sort((a, b) => (a.saleDate > b.saleDate ? -1 : a.saleDate < b.saleDate ? 1 : 0)),
    [marketLots]
  );

  const slipStat = pageStats ? pageStats.settlement[activeKey] || null : null;
  const soldMedianPct = useMemo(() => {
    // hammer-basis via overEstimatePct — raw priceUsd is premium-inclusive and
    // comparing it to hammer-basis estimates overstated this figure ~25pts
    const perf: number[] = [];
    for (const l of sold) {
      const pct = overEstimatePct(l);
      if (pct != null) perf.push(pct);
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
      // saved-time meta may be keyed by a pre-resolve/pre-dedupe id (id~ flip,
      // wright/rago/lama mirror) — try the aliases before giving up.
      const m = savedMeta[l.id]
        ?? savedMeta[l.id.endsWith('~') ? l.id.slice(0, -1) : `${l.id}~`]
        ?? (() => {
          const fam = l.id.match(/^(wright|rago|lama)-(\d+)~?$/);
          if (!fam) return undefined;
          for (const h of ['wright', 'rago', 'lama']) {
            const hit = savedMeta[`${h}-${fam[2]}`] ?? savedMeta[`${h}-${fam[2]}~`];
            if (hit) return hit;
          }
          return undefined;
        })();
      // signalCallOf is the single interpreter of at-save signals — legacy
      // saves lost their direction and never claim a measured move
      const call = signalCallOf(m);
      if (!call || call.dir !== 'below') continue;
      const s = lotSignal(l, allLots);
      if (!s || s.label !== 'Below Market') continue; // same axis only
      const delta = s.pct - call.pct;
      if (delta > 0 && (!bestMove || delta > bestMove.to - bestMove.from)) bestMove = { from: call.pct, to: s.pct };
    }
    const future = live.filter(l => trueSaleDay(l) >= today);
    return { count: mine.length, next: future[0] || null, bestMove };
  }, [savedIds, savedMeta, allLots]);

  const watchStripEl = watchStrip ? (
    <Link href="/profile" className="ray-watchstrip" aria-label={`Your watchlist — ${watchStrip.count} saved`}>
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

  return (
    <>
    {/* the page's primary heading — visually hidden (the hero leads with the
        market number, not a title) but present for crawlers/AT. */}
    <h1 style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
      lectr — auction intelligence for the collectibles market
    </h1>
    <Greeting />
    <div className={`${styles.root} terminal-shell`} data-mounted={mounted}>
      {/* (the feed grid's rules ride with the feed — components/LotBrowser) */}
      <style>{`
        /* the reused paper/record bands are self-contained; let them breathe
           full-width inside the dark shell rather than fight the deskShell rail */
        .terminal-shell .ray-recordband { border-radius: 14px; }
      `}</style>
      <div className={styles.bgField} aria-hidden />
      <div className={styles.grain} aria-hidden />

      {/* REAL CHROME — ArtistNav mounts CommandK (⌘K search, alerts, mobile sheet) */}
      <ArtistNav activeSlug={null} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {/* THE EXCHANGE RAIL — the door; re-scopes the WHOLE page in place */}
      <div className={`rail ${styles.switchStrip}`} style={{ paddingTop: 'var(--space-4)', position: 'relative', zIndex: 3 }}>
        <MarketSwitch lit open={!fromCache} reads={railReads} />
      </div>

      {error ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '120px 20px', gap: 12, position: 'relative', zIndex: 2 }}>
          <Flick size={28} draw style={{ color: 'var(--color-text-faint)' }} />
          <p style={{ fontSize: 13.5, color: 'var(--tt-muted)', textAlign: 'center', margin: 0 }}>{error}</p>
          <button className="ray-show-more" style={{ marginTop: 4 }} onClick={() => window.location.reload()}>
            Try again
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
              demandAll={demand}
              realized={realized}
              bidComp={bidComp[activeKey]}
              totalLots={totalLots}
              belowMkt={belowMktCount}
              onOpenBelow={openBelowLens}
              onCommand={openCommandK}
              appreciation={appreciation}
              onBlock={upcoming.length}
              play={!fromCache}
              isMobile={mounted && isMobile}
              serial={lastCrawl}
              closingNext={closingNext}
            />

            {/* Oct 8: the feed opens right under the hero — the shortlist
                ("What matters") is the first thing a reader triages, not
                ~4,200px down beneath the wall, the board and the cells. */}
            {/* ══ THE FEED — On the block (full parity) ══ */}
            {upcoming.length > 0 && (
              <section id="on-the-block" className={`${styles.feedSection} ns-plate`}>
                <div className={`ns-split ${styles.feedHead}`}>
                  <div>
                    <span className="ns-kicker">The live book</span>
                    <h2 className={styles.feedTitle}>On the block</h2>
                  </div>
                  {nextHammer && (
                    <p>
                      Next hammer: {nextHammer.word} · {nextHammer.lot.auctionHouse}
                    </p>
                  )}
                </div>

                <LotBrowser
                  lots={upcoming}
                  compLots={marketLots}
                  filters={feedFilters}
                  onFiltersChange={handleFilters}
                  market={activeKey}
                  onMarketReset={() => setMarket('all')}
                  belowSignal={belowSignal}
                  follows={follows}
                  isSaved={isSaved}
                  onToggleSave={toggle}
                  lastCrawl={lastCrawl}
                  fromCache={fromCache}
                  prevVisitDay={prevVisitDay}
                  baselines={baselines}
                  onResetView={restoredView && !viewIsDefault ? resetView : undefined}
                  onOpenLot={setTableLot}
                  anchorId="on-the-block"
                />

                {tableLot && (
                  <ComparableModal lot={tableLot} allLots={marketLots} onClose={() => setTableLot(null)} />
                )}
              </section>
            )}


            {/* ══ TONIGHT'S WALL — the photographed front row (kept). The
                section opens on a registration plate (north-star frame). ══ */}
            {wallEl && <div className={`${styles.wallSeparator} ns-plate`}>{wallEl}</div>}

            {/* ══ ROOM · THE VERIFIED BOARD — every certified read, on paper.
                The movers ARE the board's top rows (one table, no duplicate
                strip); the record sentence prints ONCE as the room's footer.
                NORTH STAR: the engine's intro head lives OUT HERE on the page
                ground in the split grammar; the vault below stays the one
                dark room. ══ */}
            {marketData?.subMarkets && (
              <div className="ns-plate">
                <div className={`ns-split ${styles.engineIntro}`}>
                  <div>
                    <span className="ns-kicker">The value engine</span>
                    <h2 className={styles.engineIntroHead}>We find what the room misprices.</h2>
                  </div>
                  <p>
                    Live lots flagged under their comparables, the market indices behind
                    them, and the replayed record that keeps us honest.
                  </p>
                </div>
              <section className={styles.roomPaper}>
                <div className={styles.roomInner}>
                  <SubMarketBoard
                    market={marketData}
                    activeKey={activeKey}
                    variant={mounted && isMobile ? 'mobile' : 'desktop'}
                    paper
                    receipts={backtest ? {
                      flaggedPct: backtest.flagged.medianPerfPct,
                      unflaggedPct: backtest.unflagged.medianPerfPct,
                      flaggedHammerPct: backtest.flagged.hammerMedianPct ?? null,
                      unflaggedHammerPct: backtest.unflagged.hammerMedianPct ?? null,
                      n: backtest.flagged.n,
                      asOf: marketData?.generatedAt?.slice(0, 10) ?? null,
                    } : null}
                    hero={engineHero}
                    onOpenLot={setTableLot}
                  />
                </div>
              </section>
              </div>
            )}

            {/* ══ ROOM · THE INSTRUMENT SET — the platform cells, taken
                directly from the elevenlabs.io feature-cell grammar: four
                quiet cream wells for the desk's four surfaces, and ONE
                forced-color cell carrying today's call. LAMP LAW: the color
                cell's dir is the call's real signal direction — 'up' because
                a Below Market flag means comps sell ABOVE this ask (the same
                tone the wall's ring wears) — or 'ink' when no call exists.
                Its multiple prints through gapMultiple, the wall's own
                formatter. Never invented, never decorative. ══ */}
            <section className={`${styles.cellsSection} ns-plate`}>
              <div className={`ns-split ${styles.cellsHead}`}>
                <div>
                  <span className="ns-kicker">The instrument set</span>
                  <h2 className={styles.engineIntroHead}>One desk, four instruments.</h2>
                </div>
                <p>
                  Every number on this page is made in one of these rooms — the
                  engine that prices the book, the record that keeps it honest,
                  the makers it tracks, and the desk you keep.
                </p>
              </div>
              <CellGrid min={300} className={styles.cellsGrid}>
                {todaysCall ? (
                  <ColorCell
                    dir="up"
                    span={2}
                    stat={gapMultiple(todaysCall.pct)}
                    label="Today's call"
                    body={`${makerLineOf(todaysCall.lot).name} · ${craftTitle(todaysCall.lot.title, todaysCall.lot.auctionHouse)}`}
                    href={`/lot/${todaysCall.lot.id}`}
                  />
                ) : (
                  <ColorCell
                    dir="ink"
                    span={2}
                    stat={belowMktCount > 0 ? belowMktCount.toLocaleString() : upcoming.length > 0 ? upcoming.length.toLocaleString() : undefined}
                    label="Today's call"
                    body={
                      belowMktCount > 0
                        ? `No single call tonight — ${belowMktCount.toLocaleString()} ${belowMktCount === 1 ? 'lot' : 'lots'} flagged under their comparables on the live book.`
                        : upcoming.length > 0
                          ? `No flags on this book tonight — ${upcoming.length.toLocaleString()} ${upcoming.length === 1 ? 'lot' : 'lots'} on the block, priced in line with their comps.`
                          : 'The book is quiet — the crawl refreshes daily.'
                    }
                    href="#on-the-block"
                  />
                )}
                {/* THE POP (Collin: "nothing POPs, dead space"): every cell
                    leads with its big mono numeral — numbers are the desk's
                    product art — and carries its patent figure as a top-right
                    watermark. Stats are the same live values the bodies
                    already printed; nothing invented. */}
                <Cell
                  stat={belowMktCount > 0 ? belowMktCount.toLocaleString() : '1.3×'}
                  statNote={belowMktCount > 0 ? 'flagged on the book tonight' : 'where a flag becomes legal'}
                  mark={<FigGate size={96} />}
                  label="The value engine"
                  body={belowMktCount > 0
                    ? 'Live asks priced against where their comparables actually sold.'
                    : 'Live asks priced against where their comparables actually sold — every flag on this page starts here.'}
                  href="/value"
                />
                <Cell
                  stat={backtest?.flagged?.n ? backtest.flagged.n.toLocaleString() : undefined}
                  statNote={backtest?.flagged?.n ? 'settled calls replayed' : undefined}
                  icon={<IcoRecord />}
                  mark={<FigCorpus size={96} />}
                  label="The record"
                  body={backtest?.flagged?.n
                    ? 'Every flagged call replayed against the hammer that followed — the desk grades its own work.'
                    : 'Every flagged call replayed against the hammer that followed — the desk grades its own work.'}
                  href="/analytics"
                />
                <Cell
                  stat={ROSTER.makers.toLocaleString()}
                  statNote={`makers · ${ROSTER.categories} categories across ${VERTICAL_COUNT} verticals`}
                  mark={<FigPools size={96} />}
                  label="The makers ledger"
                  body="Sale history, live coverage and market reads, one dossier per name."
                  href="/makers"
                />
                <Cell
                  stat={savedIds.length > 0 ? savedIds.length.toLocaleString() : undefined}
                  statNote={savedIds.length > 0 ? (savedIds.length === 1 ? 'lot on your desk' : 'lots on your desk') : undefined}
                  icon={<IcoDesk />}
                  mark={<FigTape size={96} />}
                  label="Your desk"
                  body={savedIds.length > 0
                    ? 'What moved since you saved it, the next hammers, and your own record.'
                    : 'Save any lot on the block and it reports here — what moved since you saved it, and when it hammers.'}
                  href="/profile"
                />
              </CellGrid>
            </section>

            {/* the watchlist strip — the reader's saved lots (small, personal) */}
            {watchStripEl}

            {/* ══ MARKET-LEVEL EMPTY STATE — a thin vertical (e.g. watches)
                can gate off the wall, the board AND the feed at once, leaving
                the hero stranded over nothing. Mirror the value page's
                thin-vertical pattern: a short honest line + the two live
                surfaces this market always has. Only shows when all three
                body sections are absent. ══ */}
            {upcoming.length === 0 && !wallEl && !marketData?.subMarkets && (
              <section className={`${styles.feedSection} ns-plate`}>
                <div className="ray-enter" style={{ textAlign: 'center', padding: '40px 20px 60px' }}>
                  <p style={{ fontSize: 15.5, lineHeight: 1.6, marginBottom: 8, color: 'var(--tt-muted)' }}>
                    Nothing on the block in the {activeKey === 'all' ? 'total' : marketMeta.label} market yet — the crawl refreshes daily.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 22px', justifyContent: 'center', marginTop: 18 }}>
                    <Link href={`/value/${activeKey}`} className="link-action" style={{ color: 'var(--color-fg)' }}>
                      See {activeKey === 'all' ? 'the' : `the ${marketMeta.label}`} buy signals <Flick size={10} style={{ marginLeft: 5 }} />
                    </Link>
                    <Link href={`/analytics/${activeKey}`} className="link-action" style={{ color: 'var(--color-fg)' }}>
                      Open the {activeKey === 'all' ? 'research desk' : `${marketMeta.label} research desk`} <Flick size={10} style={{ marginLeft: 5 }} />
                    </Link>
                  </div>
                </div>
              </section>
            )}

            {/* phase-2 trigger — ONLY for a data build without page-stats
                (the old path: the slip below read the full sold corpus) */}
            {statsFallback && <Phase2Sentinel />}

            {/* ══ ROOM · THE SETTLEMENT — the slip is the room. ══ */}
            <div className="ns-plate">
            <section className={styles.roomPaper}>
            <div className={styles.roomInner}>
            <div className={styles.slipRoom}>
            {/* CLS: the settlement slip below needs the phase-2 corpus, which
                Phase2Sentinel deliberately defers until the reader approaches
                (it is a ~28MB fetch). So the slip mounts mid-scroll and its
                287px pushes everything under it — measured 0.27–0.52 on home,
                the site's worst vital, and the shift the footer was wrongly
                blamed for. Hold the room open while that fetch is in flight so
                the slip lands in space already reserved. `:empty` collapses
                .slipRoom, so this placeholder is what keeps it open; it yields
                the moment real content exists. Only while phase 2 is pending —
                a market that resolves to no sold rows keeps its natural
                collapse rather than a permanent gap. */}
            {((pageStats === undefined && !isSportsScience) || (statsFallback && !ray.fullLoaded && sold.length === 0 && recentRows.length === 0)) && (
              <div aria-hidden className={styles.slipHold} />
            )}
            {isSportsScience ? (
              recentRows.length > 0 && (
                <div className={styles.recordBandWrap}>
                  <SettlementSlip
                    marketName={marketName}
                    serial={editionSerial}
                    archiveOpen={showArchive}
                    onToggleArchive={() => setShowArchive(s => !s)}
                    lines={[
                      // meta.totalSold is the FULL corpus — under a scoped
                      // market name the label must say so (honesty: a count
                      // never wears a scope it doesn't have)
                      scopedSold != null
                        ? { k: `Sold ${marketName} lots on the book`, v: scopedSold.toLocaleString() }
                        : { k: 'Sold lots on the book, all markets', v: (meta.totalSold ?? recentRows.length).toLocaleString() },
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
            ) : slipStat && slipStat.sold > 0 ? (
              <div className={`${styles.recordBandWrap}${activeKey === 'all' ? ` ${styles.recordEmblem}` : ''}`}>
                <SettlementSlip
                  marketName={marketName}
                  serial={editionSerial}
                  archiveOpen={showArchive}
                  onToggleArchive={() => setShowArchive(s => !s)}
                  lines={[
                    activeKey === 'all'
                      ? { k: 'Sold lots on the book', v: (meta.totalSold ?? slipStat.sold).toLocaleString() }
                      : { k: `Sold ${marketName} lots on the book`, v: (scopedSold ?? slipStat.sold).toLocaleString() },
                    ...(slipStat.medianPct !== null ? [{ k: 'Median hammer vs estimate', v: fmtSignedPct(slipStat.medianPct), signed: slipStat.medianPct }] : []),
                    ...(slipStat.latest ? [{ k: 'Latest hammer', v: formatDate(slipStat.latest) }] : []),
                  ]}
                />
                {showArchive && (
                  <section className="rail" style={{ paddingBlock: '8px 40px' }}>
                    <div className="ray-recordband" style={{ marginTop: 0 }}>
                      {ray.fullLoaded
                        ? <PastResults lots={sold} showArtist savedIds={savedIds} onToggleSave={toggle} />
                        : ray.fullError
                          ? <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', textAlign: 'center', padding: '32px 0' }}>The sold archive didn&rsquo;t load. <button className="link-action" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', textDecoration: 'underline' }} onClick={() => retryFullLoad()}>Try again</button></p>
                          : <RayLoading />}
                    </div>
                  </section>
                )}
              </div>
            ) : statsFallback && sold.length > 0 && (activeKey === 'all' ? (
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
          </div>

        </RayEntrance>
      )}

      {/* ══ THE COLOPHON — full route map (nav/SEO) ══
          Rendered OUTSIDE the loading gate, deliberately. It used to live in
          the loaded branch, with app/components/Footer.tsx standing in during
          phase 1 so the prerendered HTML still carried internal links (C4
          PRE-GA-5). But that made the two swap: when phase 1 resolved, the
          stand-in unmounted (407px -> 0) as this one mounted, and a reader
          already scrolled to the bottom ate a 0.27-0.51 layout shift — home's
          worst vital, measured by node attribution to FOOTER.ray-close.
          Rendering one Colophon unconditionally satisfies BOTH goals: it is in
          the prerendered HTML (links crawlable) and it never unmounts. `record`
          simply fills in when the backtest lands — one line of text, not a
          whole footer. /makers already resolved it this way. */}
      <Colophon
        record={backtest?.flagged ? { n: backtest.flagged.n, medianPerfPct: backtest.flagged.hammerMedianPct ?? backtest.flagged.medianPerfPct } : null}
      />
    </div>
    </>
  );
}
