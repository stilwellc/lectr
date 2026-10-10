'use client';

import React, { useMemo, useState, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import { ARTISTS, MARKETS, MAKER_MARKETS, rosterNoun, type Market } from '../constants';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import MarketIcon from '../components/MarketIcon';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { useSavedSearches } from '../lib/alerts';
import { useAuth } from '../lib/account';
import ArtistNav from '../components/ArtistNav';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import { formatDate, getUpcomingCounts, localToday } from '../utils';
import { formatDemand } from '../lib/demand';
import { FigureCell, FigGate } from '../components/cells';
import { Accent } from '../components/Masthead';
import { Colophon } from '../components/Terminal';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import TriageBar from '../components/TriageBar';
import LotBrowser from '../components/LotBrowser';
import { FEED_DEFAULTS, type FeedFilters } from '../components/FeedToolbar';
import { useLastVisit, passesTriage, houseBaselines, isTriageActive, TRIAGE_DEFAULTS, type TriageFilters } from '../lib/feed-filters';
import { taxonOf, SUBS, SPORTS, MARKET_CATS, type CatKey } from '../lib/taxonomy';
import { useFollows, catFollow } from '../lib/follows';
import { isFlagged } from '../lib/flags';
import { makerId, makerSlugOf, subId, subPartsOf } from '../lib/entity/model';
import { NAME_HEAD, COLLECTION_CATS, COLLECTION_MARKETS, SUBJECT_MARKETS } from '../lib/entity/kinds';
import { useLivePool, entityIdOf, nameBucketOf, catIdOf, type LiveEntry } from '../lib/entity/live';
import { useEntities, subBundle, prefetchSubs, loadEntities, loadEntitiesTail, type EntityBundle } from '../hooks/useEntities';
import { parseEntityId } from '../lib/entity/key';
import { makerHref } from '../lib/entity/retired';
import {
  useMakersView, viewSearch, DEFAULT_COLS, COMPARE_MAX, COL_KEYS, LOT_ORDERS,
  type SortKey, type LiveSort, type RowsBy, type LotOrder, type ViewBody, type MakersView,
} from '../lib/entity/view-state';
import { buildRow, sortRows, searchRow, flaggedRow, needleOf, lotMatches, gradePlusOf, fmtPct, type Row } from '../lib/entity/ledger';
import EntityRow, { COLS, colSpec, gridTemplateOf } from '../components/entity/EntityRow';
import CompareTray from '../components/entity/CompareTray';
import './makers.css';

/**
 * Makers — THE LEDGER (makers overhaul P2, Oct 10 2026). The first screen is
 * the ledger: one compact header line (the counts and the one verified read)
 * over one search that finds names AND lots, the quick lenses, and the rows.
 *
 *   - Every row is one EntityRow (app/components/entity), every kind the same
 *     shape (app/lib/entity/ledger buildRow) — a maker, a player, a Pokémon,
 *     a film, a set, a clean sub-category, a market's remainder.
 *   - The body is the NAMES (entity rows) or the LOTS (the live lots the
 *     filters + search match, in the shared LotBrowser's rows). The
 *     lot-centric lenses — Closing tonight, Flagged, New since last visit —
 *     open the lots; a search offers its matching lots as the first row.
 *   - Every control lives in the URL (app/lib/entity/view-state), compare
 *     and the body included.
 *   - Rows page 40 at a time per group; sold-only names (the entities file's
 *     main + tail tiers) join the live ones.
 */

/** rows per group before "Show more" */
const CAP_ONE = 40;
const CAP_ALL = 8;
const CAP_STEP = 40;
const NO_CAPS: Partial<Record<Market, number>> = {};
const SCROLL_KEY = 'mk-scroll:';

const SORTS: { k: SortKey; label: string; note: string }[] = [
  { k: 'matters', label: 'Matters', note: 'What matters most: the summed priority of each row\'s three most important live lots — size, measured edge, bids, closing time' },
  { k: 'live', label: 'Live', note: 'Live lots passing the filters' },
  { k: 'flags', label: 'Flags', note: 'Live lots priced below their comparables' },
  { k: 'movers', label: 'Movers', note: 'The biggest year-over-year moves, either way — only rows whose two years both clear the sample gate' },
  { k: 'median', label: 'Median', note: 'Median sale, trailing 12 months (thin rows last)' },
  { k: 'sold12', label: 'Sold 12 mo', note: 'Sales tracked in the last 12 months' },
  { k: 'name', label: 'A–Z', note: 'Alphabetical' },
];
const LOT_ORDER_LABEL: Record<LotOrder, string> = {
  priority: 'Matters', soonest: 'Closing', 'est-desc': 'Estimate', 'gap-desc': 'Gap', newest: 'Newest',
};

/** a live lot is one of these entities' (a row id: entity, remainder, category) */
function lotInScope(l: AuctionLot, ids: ReadonlySet<string>): boolean {
  const id = entityIdOf(l);
  if (id && ids.has(id)) return true;
  if (id && ids.has(nameBucketOf(id, l))) return true;
  return ids.has(catIdOf(l));
}

/** rows keep their identity while their bundle and live entry do — the
 *  React.memo on EntityRow then holds across a filter re-cut */
function useRowCache(dossiers: ReadonlySet<string>) {
  const cache = useRef(new Map<string, { b: EntityBundle; live: LiveEntry | undefined; d: ReadonlySet<string>; row: Row }>());
  return useCallback((id: string, b: EntityBundle, live: LiveEntry | undefined): Row => {
    const hit = cache.current.get(id);
    if (hit && hit.b === b && hit.live === live && hit.d === dossiers) return hit.row;
    const row = buildRow(id, b, live, dossiers);
    cache.current.set(id, { b, live, d: dossiers, row });
    return row;
  }, [dossiers]);
}

/** compare picks from another market than the one on screen: their own
 *  market's entities file (main, then the tail for a sold-only pick) — the
 *  same summary that market's ledger prints, never an adapter stand-in */
function useForeignPicks(ids: readonly string[], active: Market): Map<string, EntityBundle> {
  const [got, setGot] = useState<Map<string, EntityBundle>>(() => new Map());
  const want = useMemo(() => (active === 'all' ? [] : ids.filter(id => {
    const m = parseEntityId(id)?.market;
    return !!m && m !== active;
  })), [ids, active]);
  const key = want.join(',');
  useEffect(() => {
    if (!want.length) return;
    let on = true;
    (async () => {
      const out = new Map<string, EntityBundle>();
      for (const id of want) {
        const m = parseEntityId(id)!.market;
        let f = await loadEntities(m);
        let s = f?.entities.find(e => e.id === id);
        if (!s && f?.tailN) { f = await loadEntitiesTail(m); s = f?.entities.find(e => e.id === id); }
        if (s) out.set(id, { s, detail: null, sparkQ: f?.sparkQ ?? null });
      }
      if (on) setGot(out);
    })();
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return got;
}

export default function MakersPage() {
  const { allLots, lastCrawl, loading, fromCache, demand } = useRayData();
  const { market } = useMarket();
  const activeKey = MARKETS.find(m => m.key === market)?.live ? market : 'all';
  const activeLabel = activeKey === 'all' ? 'full' : activeKey === 'tcg' ? 'TCG' : MARKETS.find(m => m.key === activeKey)!.label.toLowerCase();
  const { savedIds, isSaved, toggle: toggleSave } = useSavedLots();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  // ── THE VIEW — one URL codec (app/lib/entity/view-state) ──
  const [view, setView, hydrated] = useMakersView(activeKey);
  const { q, on: fLive, vi: fVerified, fl: fFlagged, fw: fFollowing, sort, cols, open, spk: sportPick, by: rowsBy, cmp: compare, vw, lk, lo, triage } = view;
  const search = useMemo(() => viewSearch(view), [view]);

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
    for (const f of allFollows) if (f.kind === 'cat' && f.key.includes(':')) s.add(`cs:${f.key}`);
    return s;
  }, [searches, allFollows]);

  const [capState, setCapState] = useState<{ k: string; caps: Partial<Record<Market, number>> }>({ k: '', caps: {} });
  const prevVisitDay = useLastVisit();
  const baselines = useMemo(() => houseBaselines(allLots), [allLots]);
  const setTriage = useCallback((next: TriageFilters | ((prev: TriageFilters) => TriageFilters)) =>
    setView(v => ({ triage: typeof next === 'function' ? next(v.triage) : next })), [setView]);
  // sub-categories are market-scoped: drop them on a real market flip (never on mount)
  const triageMarket = useRef(activeKey);
  useEffect(() => {
    if (triageMarket.current === activeKey) return;
    triageMarket.current = activeKey;
    setView(v => ({ triage: v.triage.cat || v.triage.sub ? { ...v.triage, cat: null, sub: null } : v.triage, spk: null, lk: [] }));
  }, [activeKey, setView]);
  const [showDisplay, setShowDisplay] = useState(false);
  const deepLinked = useRef(false);
  const deepChecked = useRef(false);
  useEffect(() => {
    if (!hydrated || deepChecked.current) return;
    deepChecked.current = true;
    if (open) deepLinked.current = true;
  }, [hydrated, open]);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // ── THE LIVE BOOK — the DEFERRED filters: a chip press repaints the chip
  // at once and the ledger re-cuts right behind it ──
  const dTriage = useDeferredValue(triage);
  const dSport = useDeferredValue(sportPick);
  const dQ = useDeferredValue(q);
  const dFl = useDeferredValue(fFlagged);
  const words = useMemo(() => needleOf(dQ), [dQ]);
  const collection = activeKey === 'all' || SUBJECT_MARKETS.has(activeKey);
  const wantSubs = rowsBy === 'cat' && collection;
  const pool = useLivePool(allLots, activeKey, dTriage, {
    sport: dSport, prevVisitDay, baselines,
    names: collection, cats: wantSubs,
  });
  // the sold-only tail: a search (any name lectr tracks), or an order that
  // reads sold history
  const wantTail = words.length > 0 || sort === 'median' || sort === 'movers' || sort === 'sold12' || sort === 'name';
  const entities = useEntities(activeKey, {
    namesAll: pool.namesAll, subs: wantSubs, sport: dSport,
    players: rowsBy === 'name' && (activeKey === 'all' || activeKey === 'sports'),
    tail: wantTail,
  });
  const shownBy: RowsBy = rowsBy === 'cat' && !entities.subsReady ? 'name' : rowsBy;
  const booting = loading || entities.source === 'pending';
  const filtersOn = isTriageActive(dTriage) || !!dSport;

  // ── THE ROWS — one row-model path for every kind ──
  const rowOf = useRowCache(entities.dossiers);
  const makerRows = useMemo<Row[]>(() => ARTISTS.map(a => {
    const id = makerId(a.slug);
    return rowOf(id, entities.makers.get(id)!, pool.byMaker.get(id));
  }), [entities.makers, pool.byMaker, rowOf]);
  const liveOnlySubs = useMemo(() => {
    const m = new Map<string, EntityBundle>();
    for (const c of COLLECTION_CATS) for (const sub of SUBS[c.cat]) {
      const label = c.prefix && !(c.cat === 'tcg' && sub.key === 'other-tcg') ? `${c.prefix} · ${sub.label}` : sub.label;
      m.set(subId(c.cat, sub.key), subBundle(c.cat, sub.key, label, c.market, null, dSport));
    }
    return m;
  }, [dSport]);
  const subRows = useMemo<Row[]>(() => {
    if (shownBy !== 'cat') return [];
    const out: Row[] = [];
    for (const c of COLLECTION_CATS) {
      for (const sub of SUBS[c.cat]) {
        const id = subId(c.cat, sub.key);
        const b = entities.subs.get(id);
        const live = pool.byCat.get(id);
        if (!b?.s.sold && !b?.detail && !live) continue;
        out.push(rowOf(id, b ?? liveOnlySubs.get(id)!, live));
      }
    }
    return out;
  }, [shownBy, entities.subs, pool.byCat, liveOnlySubs, rowOf]);
  // By name: every live subject (passing the filters), plus — with no live
  // filter on — the sold-only names the entities file tracks
  const subjectRows = useMemo<Row[]>(() => {
    if (shownBy !== 'name' || !collection) return [];
    const out: Row[] = [];
    pool.byName.forEach((live, id) => {
      const b = entities.names.get(id);
      if (b) out.push(rowOf(id, b, live));
    });
    if (!filtersOn && entities.file) {
      entities.file.forEach((b, id) => {
        if (pool.byName.has(id) || !COLLECTION_MARKETS.has(b.s.market)) return;
        const k = b.s.kind;
        if (k !== 'player' && k !== 'subject' && k !== 'set') return;
        out.push(rowOf(id, b, undefined));
      });
    }
    return out;
  }, [shownBy, collection, pool.byName, entities.names, entities.file, filtersOn, rowOf]);

  const rows = useMemo<Row[]>(() => {
    const coll = shownBy === 'name' ? subjectRows : subRows;
    return [...makerRows.filter(r => !COLLECTION_MARKETS.has(r.market)), ...coll];
  }, [makerRows, subRows, subjectRows, shownBy]);
  const rowById = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of makerRows) m.set(r.id, r);
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [makerRows, rows]);
  const rowByIdRef = useRef(rowById);
  useEffect(() => { rowByIdRef.current = rowById; }, [rowById]);
  const inMarket = useCallback((r: Row) => activeKey === 'all' || r.market === activeKey, [activeKey]);

  // ── THE VISIBLE LEDGER — search (names AND lots), lenses, chips, order ──
  const visible = useMemo(() => {
    const out: Row[] = [];
    for (const r0 of rows) {
      if (!inMarket(r0)) continue;
      let r = searchRow(r0, words);
      if (!r) continue;
      if (dFl) { r = flaggedRow(r); if (!r) continue; }
      if (fLive && r.live === 0) continue;
      if (fVerified && !r.verified) continue;
      // a filtered book shows only the rows with a live lot passing it
      if (filtersOn && r.live === 0) continue;
      if (fFollowing && !(r.follow && followedSet.has(r.follow))) continue;
      out.push(r);
    }
    return sortRows(out, sort);
  }, [rows, inMarket, words, dFl, fLive, fVerified, filtersOn, fFollowing, followedSet, sort]);

  const cutKey = JSON.stringify([dTriage, dSport, dQ, dFl, sort, shownBy, activeKey, fLive, fVerified, fFollowing]);
  const caps = capState.k === cutKey ? capState.caps : NO_CAPS;
  const showMore = (m: Market) => setCapState(st => {
    const cur = st.k === cutKey ? st.caps : {};
    return { k: cutKey, caps: { ...cur, [m]: (cur[m] ?? (activeKey === 'all' ? CAP_ALL : CAP_ONE)) + CAP_STEP } };
  });

  const soldMaxBy = useMemo(() => {
    const m = new Map<Market, number>();
    for (const r of rows) m.set(r.market, Math.max(m.get(r.market) ?? 1, r.sold ?? 0));
    return m;
  }, [rows]);

  const groups = useMemo(() =>
    MARKETS
      .filter(m => m.key !== 'all' && (activeKey === 'all' || m.key === activeKey))
      .map(m => {
        const g = visible.filter(r => r.market === m.key);
        const cap = caps[m.key] ?? (activeKey === 'all' && !MAKER_MARKETS.has(m.key) ? CAP_ALL : CAP_ONE);
        const named = g.filter(r => r.kind !== 'rest');
        let shown = g, more = 0;
        if (named.length > cap) {
          shown = [...named.slice(0, cap), ...g.filter(r => r.kind === 'rest')];
          more = named.length - cap;
        }
        const live = g.reduce((s, r) => s + r.live, 0);
        const flags = g.reduce((s, r) => s + r.flags, 0);
        const ds = demand?.[m.key] || [];
        return {
          key: m.key as Market, label: m.label, rows: g, named: named.length, shown, more, live, flags,
          soldMax: soldMaxBy.get(m.key as Market) ?? 1,
          demandNow: ds.length ? ds[ds.length - 1].value : null,
        };
      })
      .filter(g => g.rows.length > 0),
    [visible, soldMaxBy, activeKey, demand, caps]);

  // ── THE LOTS — the market's live book under the same filters + search ──
  const lkSet = useMemo(() => new Set(lk), [lk]);
  const lotsPool = useMemo<AuctionLot[]>(() => {
    const base = lkSet.size ? pool.all.filter(l => lotInScope(l, lkSet)) : pool.marketPool;
    return words.length ? base.filter(l => lotMatches(l, words)) : base;
  }, [lkSet, pool.all, pool.marketPool, words]);
  // the counts the body switch, the lenses and the search row print — the
  // same predicates LotBrowser's pass applies (triage, flagged), so a count
  // is exactly the list it opens
  // per-lot lens bits, once per pool (never per chip click)
  const lensBits = useMemo(() => {
    const o = { today: localToday(), prevVisitDay, baselines };
    const tonight = new Uint8Array(lotsPool.length), fresh = new Uint8Array(lotsPool.length), flag = new Uint8Array(lotsPool.length);
    lotsPool.forEach((l, i) => {
      tonight[i] = passesTriage(l, { ...TRIAGE_DEFAULTS, win: 'today' }, o) ? 1 : 0;
      fresh[i] = passesTriage(l, { ...TRIAGE_DEFAULTS, newOnly: true }, o) ? 1 : 0;
      flag[i] = isFlagged(l) ? 1 : 0;
    });
    return { tonight, fresh, flag };
  }, [lotsPool, prevVisitDay, baselines]);
  const lensCounts = useMemo(() => {
    const o = { today: localToday(), prevVisitDay, baselines };
    const tri = { ...dTriage, win: null, newOnly: false };
    const triOn = isTriageActive(tri);
    const win = dTriage.win;
    let shown = 0, tonight = 0, flagged = 0, fresh = 0;
    for (let i = 0; i < lotsPool.length; i++) {
      const l = lotsPool[i];
      if (triOn && !passesTriage(l, tri, o)) continue;
      const fl = lensBits.flag[i] === 1, t = lensBits.tonight[i] === 1, n = lensBits.fresh[i] === 1;
      const winOk = !win || (win === 'today' ? t : passesTriage(l, { ...TRIAGE_DEFAULTS, win }, o));
      const newOk = !dTriage.newOnly || n;
      if (t && newOk && (!dFl || fl)) tonight++;
      if (fl && winOk && newOk) flagged++;
      if (n && winOk && (!dFl || fl)) fresh++;
      if (winOk && newOk && (!dFl || fl)) shown++;
    }
    return { shown, tonight, flagged, fresh };
  }, [lotsPool, lensBits, dTriage, dFl, prevVisitDay, baselines]);
  // the search row's count: the whole market (never the lk scope)
  const searchLots = useMemo(() => {
    if (!words.length) return 0;
    const today = localToday();
    let n = 0;
    for (const l of pool.marketPool) {
      if (lotMatches(l, words) && passesTriage(l, dTriage, { today, prevVisitDay, baselines }) && (!dFl || isFlagged(l))) n++;
    }
    return n;
  }, [words, pool.marketPool, dTriage, dFl, prevVisitDay, baselines]);
  // a grade search is EXACT ("PSA 7" = 7 only): when its "and up" form finds
  // more live lots, the search row offers it in one line (QA S1)
  const gradePlus = useMemo(() => {
    const g = gradePlusOf(words);
    if (!g) return null;
    const today = localToday();
    let n = 0;
    for (const l of pool.marketPool) {
      if (lotMatches(l, g.plus) && passesTriage(l, dTriage, { today, prevVisitDay, baselines }) && (!dFl || isFlagged(l))) n++;
    }
    if (n <= searchLots) return null;
    return { label: g.label, n, q: g.q(q) };
  }, [words, q, pool.marketPool, dTriage, dFl, prevVisitDay, baselines, searchLots]);

  const rosterTotal = useMemo(() => rows.filter(r => inMarket(r) && r.kind !== 'rest').length, [rows, inMarket]);
  const shownTotal = useMemo(() => visible.filter(r => r.kind !== 'rest').length, [visible]);
  const marketLiveAll = pool.marketAll;
  const totalLive = useMemo(() => {
    if (!filtersOn) return marketLiveAll.length;
    let n = 0;
    for (const g of groups) n += g.live;
    return n;
  }, [filtersOn, marketLiveAll, groups]);
  const totalFlags = useMemo(() => marketLiveAll.reduce((n, l) => n + (isFlagged(l) ? 1 : 0), 0), [marketLiveAll]);

  // ── THE VERIFIED READ — the strongest CI-verified move published on this
  // book (the same verifiedMovers the rows print; dir = the real sign) ──
  const topVerified = useMemo(() => {
    let best: Row | null = null;
    for (const r of makerRows) {
      if (!r.verified || !(activeKey === 'all' || r.market === activeKey)) continue;
      if (!best || Math.abs(r.verified.changePct) > Math.abs(best.verified!.changePct)) best = r;
    }
    return best;
  }, [makerRows, activeKey]);

  // ── stable callbacks for the memoized rows ──
  const onToggleOpen = useCallback((id: string) => setView(v => ({ open: v.open === id ? null : id })), [setView]);
  const onToggleCompare = useCallback((id: string) => {
    setView(v => ({ cmp: v.cmp.includes(id) ? v.cmp.filter(s => s !== id) : v.cmp.length >= COMPARE_MAX ? v.cmp : [...v.cmp, id] }));
  }, [setView]);
  const onLiveSort = useCallback((ls: LiveSort) => setView({ ls }), [setView]);
  const onToggleFollow = useCallback((key: string, label: string) => {
    const sp = subPartsOf(key);
    if (sp) { void toggleCatFollow(catFollow(sp.cat as CatKey, sp.sub)); return; }
    if (!user) { openLogin(); return; }
    const existing = searches.find(s => (s.query as { player?: string }).player === key);
    if (existing) void removeSearch(existing.id);
    else void saveSearch(`Following ${label}`, { player: key, playerName: label });
  }, [user, openLogin, searches, removeSearch, saveSearch, toggleCatFollow]);
  const listTop = useRef<HTMLDivElement | null>(null);
  const toBody = useCallback(() => {
    // the body swaps under the reader: bring its top under the sticky bar
    requestAnimationFrame(() => {
      const el = listTop.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top < 0) window.scrollTo({ top: window.scrollY + top - 140, behavior: 'instant' as ScrollBehavior });
    });
  }, []);
  const onSeeLots = useCallback((id: string) => { setView({ vw: 'lots', lk: [id] }); toBody(); }, [setView, toBody]);
  const onSeeLotsMany = useCallback((ids: string[]) => { setView({ vw: 'lots', lk: ids }); toBody(); }, [setView, toBody]);
  const setBody = useCallback((b: ViewBody) => { setView({ vw: b, lk: [] }); toBody(); }, [setView, toBody]);
  // a lot-centric lens turned ON opens the lots
  const lens = useCallback((patch: (v: MakersView) => Partial<MakersView>, turningOn: boolean) => {
    setView(v => ({ ...patch(v), ...(turningOn ? { vw: 'lots' as ViewBody } : {}) }));
  }, [setView]);

  // deep link ?open= — land on the dossier once the ledger has painted
  useEffect(() => {
    if (booting || !deepLinked.current || !open) return;
    deepLinked.current = false;
    let saved: number | null = null;
    try {
      const v = sessionStorage.getItem(SCROLL_KEY + window.location.pathname + window.location.search);
      if (v != null && Number.isFinite(Number(v))) saved = Number(v);
    } catch { /* ignore */ }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (saved != null) window.scrollTo({ top: saved, behavior: 'instant' as ScrollBehavior });
      else document.querySelector(`[data-mk-flip="${CSS.escape(open)}"]`)?.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
    }));
  }, [booting, open]);
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
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (t?.closest('[role="dialog"],[role="listbox"],[role="menu"]')) return;
      if (document.querySelector('.ray-ck-overlay, .ray-maker-sheet')) return;
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'c' || e.key === 'f') {
        const id = (document.activeElement as HTMLElement | null)?.dataset?.slug;
        const row = id ? rowByIdRef.current.get(id) : undefined;
        if (!row) return;
        if (e.key === 'c') {
          if (!row.canCompare) return;
          e.preventDefault();
          onToggleCompare(row.id);
        } else {
          if (!authEnabled || !row.follow) return;
          e.preventDefault();
          onToggleFollow(row.follow, row.label);
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
  const flipKey = vw === 'names' ? groups.map(g => g.shown.map(r => r.id).join(',')).join('|') : '';
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
    if (!reduce && prev.size > 0 && next.size === prev.size && next.size <= 120 && Array.from(next.keys()).every(k => prev.has(k))) {
      const moved: HTMLElement[] = [];
      board.querySelectorAll<HTMLElement>('[data-mk-flip]').forEach(el => {
        const delta = (prev.get(el.dataset.mkFlip!) ?? 0) - (next.get(el.dataset.mkFlip!) ?? 0);
        if (Math.abs(delta) > 2) {
          el.style.transform = `translateY(${delta}px)`;
          el.style.transition = 'none';
          moved.push(el);
        }
      });
      if (moved.length) void board.offsetHeight;
      requestAnimationFrame(() => {
        for (const el of moved) {
          el.style.transform = '';
          el.style.transition = 'transform 360ms var(--ease-signature)';
        }
      });
      flipTimers.current.push(window.setTimeout(() => { for (const el of moved) el.style.transition = ''; }, 420));
    }
    flipPos.current = next;
  }, [flipKey]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const board = listRef.current;
      if (!board) return;
      const boardTop = board.getBoundingClientRect().top;
      const next = new Map<string, number>();
      board.querySelectorAll<HTMLElement>('[data-mk-flip]').forEach(el => next.set(el.dataset.mkFlip!, el.getBoundingClientRect().top - boardTop));
      flipPos.current = next;
    }, 380);
    return () => window.clearTimeout(t);
  }, [open]);

  // the sticky bar's MEASURED height — the group heads stick under it
  const barRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--mk-bar-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    });
    ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--mk-bar-h'); };
  }, [booting]);

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
  const marketCats = useMemo<CatKey[] | undefined>(() => (activeKey === 'all' ? undefined : MARKET_CATS[activeKey]), [activeKey]);
  const nameHead = (m: Market) => shownBy === 'cat' && SUBJECT_MARKETS.has(m) ? 'Category' : NAME_HEAD[m] ?? (MAKER_MARKETS.has(m) ? rosterNoun(m, 1).replace(/^./, c => c.toUpperCase()) : 'Name');
  const namesNoun = activeKey === 'all' ? 'names' : shownBy === 'cat' && SUBJECT_MARKETS.has(activeKey) ? 'categories' : SUBJECT_MARKETS.has(activeKey) ? 'names' : rosterNoun(activeKey, 2);
  const bodyNoun = namesNoun.replace(/^./, c => c.toUpperCase());

  // the compare tray prints every pick that resolves — any kind, any market
  // whose summaries are loaded (a pick from elsewhere waits in the URL)
  const foreign = useForeignPicks(compare, activeKey);
  const picked = useMemo(() => compare.map(id => {
    const live = pool.byMaker.get(id) ?? pool.byName.get(id) ?? pool.byCat.get(id);
    const fb = foreign.get(id);
    if (fb) return rowOf(id, fb, live);
    const m = parseEntityId(id)?.market;
    // another market's pick waits for its own file (never an adapter figure)
    if (activeKey !== 'all' && m && m !== activeKey) return null;
    const hit = rowById.get(id);
    if (hit) return hit;
    const b = entities.makers.get(id) ?? entities.names.get(id) ?? entities.file?.get(id) ?? entities.subs.get(id);
    return b ? rowOf(id, b, live) : null;
  }).filter((r): r is Row => !!r), [compare, rowById, entities, pool, rowOf, foreign, activeKey]);

  // the lots body's LotBrowser filters: the shared triage + flagged + order
  const lotFilters = useMemo<FeedFilters>(() => ({
    ...FEED_DEFAULTS, ...triage, query: '', belowOnly: fFlagged, sort: lo, tab: 'all',
  }), [triage, fFlagged, lo]);
  const onLotFilters = useCallback((next: FeedFilters) => {
    const { win, cat, sub, house, minUsd, maxUsd, newOnly, fx } = next;
    setView({ triage: { win, cat, sub, house, minUsd, maxUsd, newOnly, fx }, fl: next.belowOnly, ...(LOT_ORDERS.includes(next.sort as LotOrder) ? { lo: next.sort as LotOrder } : {}) });
  }, [setView]);
  const scopeLabel = useMemo(() => lk.map(id => rowById.get(id)?.label ?? picked.find(r => r.id === id)?.label ?? id.replace(/^[a-z~]+:/, '')).join(' · '), [lk, rowById, picked]);

  const set = setView;
  const clearAll = () => set({ q: '', on: false, vi: false, fl: false, fw: false, triage: TRIAGE_DEFAULTS, spk: null, lk: [] });

  const lensLead = (
    <>
      <button type="button" className="ray-toolbar-pill" data-active={triage.win === 'today'} aria-pressed={triage.win === 'today'}
        aria-disabled={lensCounts.tonight === 0 && triage.win !== 'today' ? true : undefined}
        title="Lots whose sale closes today, on your calendar"
        onClick={() => lens(v => ({ triage: { ...v.triage, win: v.triage.win === 'today' ? null : 'today' } }), triage.win !== 'today')}>
        Closing tonight <i>{lensCounts.tonight.toLocaleString()}</i>
      </button>
      <button type="button" className="ray-toolbar-pill" data-active={fFlagged} aria-pressed={fFlagged}
        aria-disabled={lensCounts.flagged === 0 && !fFlagged ? true : undefined}
        title="Live lots the engine prices below their comparables"
        onClick={() => lens(v => ({ fl: !v.fl }), !fFlagged)}>
        Flagged <i>{lensCounts.flagged.toLocaleString()}</i>
      </button>
      {(lensCounts.fresh > 0 || triage.newOnly) && (
        <button type="button" className="ray-toolbar-pill" data-active={triage.newOnly} aria-pressed={triage.newOnly}
          onClick={() => lens(v => ({ triage: { ...v.triage, newOnly: !v.triage.newOnly } }), !triage.newOnly)}>
          {prevVisitDay ? 'New since last visit' : 'New today'} <i>{lensCounts.fresh.toLocaleString()}</i>
        </button>
      )}
      <span className="ray-toolbar-divider" aria-hidden="true" />
    </>
  );

  // phone: the market keys are one swipeable strip — the active key in view
  const switchRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = switchRef.current?.querySelector<HTMLElement>('.ray-rail-cell[data-active="true"]');
    const box = switchRef.current;
    if (!el || !box || box.scrollWidth <= box.clientWidth) return;
    box.scrollLeft = Math.max(0, el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2);
  }, [activeKey, booting]);

  const v = topVerified?.verified ?? null;
  const vSlug = topVerified ? makerSlugOf(topVerified.id) : null;
  const vHref = vSlug ? makerHref(vSlug) : null;

  return (
    <div className="terminal-shell mk-shell">
      <ArtistNav activeSlug="artists" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {booting ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          {/* ── THE HEADER — the market switch, then ONE line: the statement,
              the counts, the one verified read ── */}
          <section className="rail ray-enter mk-top">
            <div className="mk-switch" ref={switchRef}><MarketSwitch compact /></div>
            <header className="mk-head">
              <h1 className="mk-h1">Every maker, one <Accent>ledger</Accent></h1>
              <p className="mk-read">
                <b>{totalLive.toLocaleString()}</b> live{filtersOn ? <> of {marketLiveAll.length.toLocaleString()}</> : null}
                {totalFlags > 0 && <> · <b>{totalFlags.toLocaleString()}</b> flagged</>}
                {' '}· <b>{rosterTotal.toLocaleString()}</b> {namesNoun}
                {v && (
                  <span className="mk-vread" title={`The strongest CI-verified move on the ${activeLabel} book · 95% CI ${Math.round(v.ciLoPct)}% to ${Math.round(v.ciHiPct)}% · n ${v.n.toLocaleString()}`}>
                    {' '}· verified {v.horizon}{' '}
                    {vHref ? <Link href={vHref}>{topVerified!.label}</Link> : topVerified!.label}{' '}
                    <b data-dir={v.changePct >= 0 ? 'up' : 'down'}>{fmtPct(v.changePct)}</b>
                  </span>
                )}
              </p>
            </header>
          </section>

          {/* ── THE BAR — one search (names AND lots), the body, the order ── */}
          <div className="mk-bar-wrap" ref={barRef}>
            <div className="rail mk-bar">
              <label className="mk-search">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5" />
                </svg>
                <input ref={searchRef} type="search" value={q} onChange={e => set({ q: e.target.value })}
                  placeholder={activeKey === 'sports' ? 'Search players and lots…' : MAKER_MARKETS.has(activeKey) ? 'Search makers and lots…' : 'Search names and lots…'}
                  aria-label="Search names and live lots" />
                {q ? <button type="button" className="mk-clear" onClick={() => set({ q: '' })} aria-label="Clear search">×</button>
                  : <kbd className="mk-kbd" aria-hidden>/</kbd>}
              </label>
              <div className="ray-seg mk-seg mk-body" role="tablist" aria-label="Show">
                {([['names', `${bodyNoun}`, shownTotal], ['lots', 'Lots', lensCounts.shown]] as [ViewBody, string, number][]).map(([k, label, n]) => (
                  <button key={k} type="button" role="tab" className="ray-seg-btn" data-active={vw === k} aria-selected={vw === k}
                    onClick={() => setBody(k)}>
                    {label} <span className="mk-seg-n">{n.toLocaleString()}</span>
                  </button>
                ))}
              </div>
              {collection && vw === 'names' && (
                <div className="ray-seg mk-seg mk-by" role="tablist" aria-label="Rows in the collection markets">
                  {([['name', 'By name'], ['cat', 'By category']] as [RowsBy, string][]).map(([k, label]) => (
                    <button key={k} type="button" role="tab" className="ray-seg-btn" data-active={rowsBy === k}
                      aria-selected={rowsBy === k} onClick={() => set({ by: k })}
                      onPointerEnter={k === 'cat' ? prefetchSubs : undefined} onFocus={k === 'cat' ? prefetchSubs : undefined}
                      title={k === 'name' ? 'Players, Pokémon, people, films, franchises, missions and sets' : 'Clean sub-categories, with their sold history'}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <span className="mk-bar-rule" aria-hidden />
              {vw === 'names' && (
                <div className="mk-display">
                  <button type="button" className="mk-chip" data-on={showDisplay || fLive || fVerified || fFollowing || undefined} onClick={() => setShowDisplay(x => !x)} aria-expanded={showDisplay}>
                    Display
                  </button>
                  {showDisplay && (
                    <>
                      <button type="button" className="mk-display-veil" aria-label="Close display menu" onClick={() => setShowDisplay(false)} />
                      <div className="mk-display-pop" role="menu" aria-label="Columns and rows">
                        <div className="mk-display-head kicker">Columns</div>
                        {COLS.map(c => {
                          const on = cols.includes(c.k);
                          return (
                            <button key={c.k} type="button" role="menuitemcheckbox" aria-checked={on} className="mk-display-item" data-on={on || undefined}
                              title={c.note}
                              onClick={() => set(x => {
                                const prev = x.cols;
                                const nx = on ? prev.filter(k => k !== c.k) : COL_KEYS.filter(k => prev.includes(k) || k === c.k);
                                return { cols: nx.length ? nx : prev };
                              })}>
                              <span className="mk-display-check" aria-hidden>{on ? '✓' : ''}</span>
                              {c.label}
                            </button>
                          );
                        })}
                        <div className="mk-display-head kicker mk-display-sep">Rows</div>
                        {([['on', 'Only on the block', fLive], ['vi', 'Only verified indexes', fVerified], ...(authEnabled ? [['fw', 'Only followed', fFollowing]] : [])] as ['on' | 'vi' | 'fw', string, boolean][]).map(([k, label, on]) => (
                          <button key={k} type="button" role="menuitemcheckbox" aria-checked={on} className="mk-display-item" data-on={on || undefined}
                            onClick={() => { if (k === 'fw' && !user) { openLogin(); return; } set(x => ({ [k]: !x[k] })); }}>
                            <span className="mk-display-check" aria-hidden>{on ? '✓' : ''}</span>
                            {label}
                          </button>
                        ))}
                        <button type="button" className="mk-display-reset" onClick={() => set({ cols: DEFAULT_COLS, on: false, vi: false, fw: false })}>Reset</button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {vw === 'names' ? (
                <select className="ray-toolbar-pill ray-toolbar-select mk-sortsel" aria-label="Order the ledger" data-active={sort !== 'matters'}
                  value={sort} onChange={e => set({ sort: e.target.value as SortKey })} title={SORTS.find(s => s.k === sort)?.note}>
                  {SORTS.map(s => <option key={s.k} value={s.k}>Sort · {s.label}</option>)}
                </select>
              ) : (
                <select className="ray-toolbar-pill ray-toolbar-select mk-sortsel" aria-label="Order the lots" data-active={lo !== 'priority'}
                  value={lo} onChange={e => set({ lo: e.target.value as LotOrder })}>
                  {LOT_ORDERS.map(k => <option key={k} value={k}>Sort · {LOT_ORDER_LABEL[k]}</option>)}
                </select>
              )}
            </div>
          </div>

          {/* ── THE LENSES + THE TRIAGE — narrow every row's live book (and the
              lots body) at once; the lot-centric lenses open the lots ── */}
          <div className="rail mk-filters">
            <TriageBar
              lots={pool.marketPool}
              filters={triage}
              countFilters={dTriage}
              onChange={setTriage}
              prevVisitDay={prevVisitDay}
              baselines={baselines}
              cats={marketCats}
              label="Narrow the live lots"
              lead={lensLead}
              omit={['today', 'new']}
            />
            {activeKey === 'sports' && (
              <div className="ray-triagebar-row ray-triagebar-subs ray-markets-fade mk-sports" role="group" aria-label="Sport">
                <button type="button" className="ray-toolbar-pill" data-active={sportPick == null} aria-pressed={sportPick == null} onClick={() => set({ spk: null })}>All sports</button>
                {SPORTS.filter(sp => (sportCounts.get(sp.key) || 0) > 0 || sportPick === sp.key)
                  .sort((a, b) => (a.key === 'other-sports' ? 1 : 0) - (b.key === 'other-sports' ? 1 : 0) || (sportCounts.get(b.key) || 0) - (sportCounts.get(a.key) || 0))
                  .map(sp => (
                    <button key={sp.key} type="button" className="ray-toolbar-pill" data-active={sportPick === sp.key} aria-pressed={sportPick === sp.key}
                      onClick={() => set({ spk: sportPick === sp.key ? null : sp.key })}>
                      {sp.label} <i>{(sportCounts.get(sp.key) || 0).toLocaleString()}</i>
                    </button>
                  ))}
              </div>
            )}
          </div>

          <section className="rail ray-enter mk-body-room" style={{ '--enter-delay': '30ms', paddingBottom: picked.length > 1 ? 420 : picked.length ? 70 : 30 } as React.CSSProperties}>
            <div ref={listTop} />
            {vw === 'lots' ? (
              /* ── THE LOTS — the shared LotBrowser's rows over exactly the
                 lots the counts promised ── */
              <div className="mk-lots">
                <div className="mk-lots-head">
                  <span className="mk-lots-n"><b>{lensCounts.shown.toLocaleString()}</b> live {lensCounts.shown === 1 ? 'lot' : 'lots'}</span>
                  {lk.length > 0 && (
                    <span className="mkc-chip mk-scope">
                      {scopeLabel}
                      <button type="button" onClick={() => set({ lk: [] })} aria-label="Show the whole market's lots">×</button>
                    </span>
                  )}
                  {words.length > 0 && <span className="mk-lots-q">matching &ldquo;{dQ.trim()}&rdquo;</span>}
                  {gradePlus && (
                    <button type="button" className="mk-chip" onClick={() => set({ q: gradePlus.q })} title="Grades match exactly; the + form is that grade and up">
                      {gradePlus.label} · {gradePlus.n.toLocaleString()}
                    </button>
                  )}
                  <span className="mk-bar-rule" aria-hidden />
                  <button type="button" className="mk-chip" onClick={() => setBody('names')}>Back to {namesNoun}</button>
                </div>
                <LotBrowser
                  bare
                  lots={lotsPool}
                  compLots={allLots}
                  filters={lotFilters}
                  onFiltersChange={onLotFilters}
                  market={activeKey}
                  savedIds={savedIds}
                  isSaved={isSaved}
                  onToggleSave={toggleSave}
                  lastCrawl={lastCrawl}
                  fromCache={fromCache}
                  prevVisitDay={prevVisitDay}
                  baselines={baselines}
                  anchorId="mk-lots"
                  persistKey={`/makers/lots/${activeKey}`}
                />
              </div>
            ) : (
              <div ref={listRef} className="mk-list-room" style={{ '--mk-grid': gridTemplateOf(cols) } as React.CSSProperties}>
                {words.length > 0 && searchLots > 0 && (
                  <button type="button" className="mk-lotsrow" onClick={() => setBody('lots')}>
                    <span className="mk-mono" aria-hidden>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5" /></svg>
                    </span>
                    <span className="mk-lotsrow-t"><b>{searchLots.toLocaleString()}</b> live {searchLots === 1 ? 'lot matches' : 'lots match'} &ldquo;{dQ.trim()}&rdquo;</span>
                    <span className="mk-lotsrow-go">See the lots <span aria-hidden>→</span></span>
                  </button>
                )}
                {gradePlus && (
                  <button type="button" className="mk-lotsrow" onClick={() => set({ q: gradePlus.q })}>
                    <span className="mk-mono" aria-hidden>+</span>
                    <span className="mk-lotsrow-t"><b>{gradePlus.n.toLocaleString()}</b> live at {gradePlus.label.slice(0, -1)} and up · grades match exactly</span>
                    <span className="mk-lotsrow-go">Search {gradePlus.label} <span aria-hidden>→</span></span>
                  </button>
                )}
                {groups.length === 0 ? (
                  <div className="mk-empty">
                    <FigureCell
                      figure={<FigGate />}
                      label="Nothing matches"
                      body={<>
                        No {activeKey === 'sports' ? 'player' : 'name'} matches the current filters in the {activeLabel} market.
                        {' '}<button type="button" className="mk-reset" onClick={clearAll}>Clear the filters</button>
                      </>}
                    />
                  </div>
                ) : groups.map(g => (
                  <div key={g.key} id={`mk-${g.key}`} className="mk-group" data-solo={activeKey !== 'all' || undefined}>
                    <div className="mk-group-head">
                      <span className="mk-group-mark" aria-hidden><MarketIcon market={g.key} size={15} /></span>
                      <h2 className="mk-group-name">{g.label}</h2>
                      <span className="mk-group-count">{g.named.toLocaleString()}</span>
                      <span className="mk-group-rule" aria-hidden />
                      <span className="mk-group-read">
                        {g.flags > 0 && <b className="mk-group-flags">{g.flags} flagged</b>}
                        {g.live > 0 && <>{g.flags > 0 ? ' · ' : ''}{g.live.toLocaleString()} on the block</>}
                        {g.demandNow !== null && <>{g.flags > 0 || g.live > 0 ? ' · ' : ''}demand <b data-dir={g.demandNow >= 0 ? 'up' : 'down'}>{formatDemand(g.demandNow)}</b></>}
                      </span>
                      <div className="mk-cols">
                        <span /><span className="mk-col-name">{nameHead(g.key)}</span>
                        {cols.map(k => {
                          const c = colSpec(k);
                          return c.sort
                            ? <button key={k} type="button" className="mk-col-k" data-on={sort === c.sort || undefined} title={c.note} onClick={() => set({ sort: sort === c.sort ? 'matters' : c.sort })}>{c.label}</button>
                            : <span key={k} className="mk-col-k" title={c.note}>{c.label}</span>;
                        })}
                        <span className="mk-col-mob">Live · median 12 mo</span>
                        <span className="mk-col-end" />
                      </div>
                    </div>
                    <div className="mk-list">
                      {g.shown.map(r => (
                        <EntityRow
                          key={r.id}
                          r={r} soldMax={g.soldMax} isOpen={open === r.id} cols={cols}
                          isSel={compare.includes(r.id)} isFollowed={!!r.follow && followedSet.has(r.follow)} authEnabled={authEnabled}
                          liveSort={open === r.id ? view.ls : 'matters'} search={open === r.id ? search : ''}
                          onToggleOpen={onToggleOpen} onToggleCompare={onToggleCompare} onToggleFollow={onToggleFollow}
                          onLiveSort={onLiveSort} onSeeLots={onSeeLots}
                        />
                      ))}
                      {g.more > 0 && (
                        <button type="button" className="mkx-live-more mk-more" onClick={() => showMore(g.key)}>
                          Show {Math.min(CAP_STEP, g.more)} more · {g.more.toLocaleString()} more {g.key === 'sports' ? 'players and sets' : MAKER_MARKETS.has(g.key) ? rosterNoun(g.key, 2) : 'names'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </RayEntrance>
      )}

      {picked.length > 0 && !booting && (
        <CompareTray picked={picked} search={search} onRemove={onToggleCompare} onClear={() => set({ cmp: [] })} onSeeLots={onSeeLotsMany} />
      )}

      <Colophon record={null} />
    </div>
  );
}
