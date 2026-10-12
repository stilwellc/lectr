'use client';
/**
 * THE DESK PROVIDER (THE DESK v3, Oct 11 2026) — the page's resolved state,
 * computed ONCE and handed down as the contract (./types: DeskData +
 * DeskActions + narrow) plus the page's own richer reads (DeskInternals) the
 * existing rooms were written against.
 *
 * The resolution chain is page.tsx's, moved here unchanged and in the SAME
 * order — the order is the behavior:
 *   1. the saves (localStorage / account) decide whether the corpus is needed
 *   2. the live book lands; the settled rows kept on this device
 *      (./settled-cache) join it so the picks deal before the archive
 *   3. the taste reads saves + follows + searches + signals
 *   4. the stall deadlines (./stall) cap every wait: archive 20s, the deep
 *      link 30s, the page loader 15s
 *   5. the deal (recs) runs once; Today, the rail and the room read it
 *
 * `useDesk()` is the contract every section reads. `useDeskInternals()` is
 * for the rooms that predate the contract (Watching, Record, Collection,
 * History, the picks group) — new sections never need it.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuctionLot } from '../../types';
import { useFullLotsOnDemand, type LedgerEntry } from '../../hooks/useRayData';
import { useSavedLots, type SavedMeta } from '../../hooks/useSavedLots';
import { signalCallOf, useAuth } from '../../lib/account';
import { useAlerts } from '../../lib/alerts';
import { useCollectionSnapshots } from '../../lib/snapshots';
import { lotSignal, formatEstimate } from '../../components/LotCard';
import { dealScore, scienceReferenceBand, cultureReferenceBand, makerReferenceBand } from '../../lib/comps';
import { lotVerdict } from '../../lib/verdict';
import { drillRowFor, drillSlugFor, type DrillRow } from '../../lib/submarkets';
import { sleeperRead } from '../../lib/lanes';
import Flick from '../../components/Flick';
import { useReturnLoop, type ReturnLoop } from '../../components/PickStrips';
import { useLastVisit, houseBaselines } from '../../lib/feed-filters';
import { recommend, recDepth, idAliases, type Taste, type Rec } from '../../lib/recs';
import { closeMsOf } from '../../lib/priority';
import { useFollows } from '../../lib/follows';
import { useTaste } from '../../lib/use-recs';
import { usePricePref, priceText, readInterests, writeInterests, type PricePref } from '../../lib/interests';
import { useLotModal } from '../../lib/use-lot-modal';
import type { Follow } from '../../lib/follows';
import { topPicksOf, type TodayRead } from '../today';
import { closeDayOf, getUpcomingCounts, fmtSignedPct, localToday, median, overEstimatePct, isOnBlock } from '../../utils';
import { ARTIST_LABEL, ARTIST_MARKET } from '../../constants';
import { drillLabelOf } from '../../lib/lot-labels';
import { useStalled, useAfterPaint } from '../stall';
import { readSettledRows, writeSettledRows, type SettledRows } from '../settled-cache';
import { closeDays, isPastPending, saleTime, watchTagOf, TAG_SOON_DAYS, type LiveSignal } from './derive';
import { pricedTotal } from './priced';
import { fmtFace } from '../../lib/lot-face';
import type { DeskData, DeskActions } from './types';

/* ══ LOTS YOU MAY LIKE — the desk's recommender (app/lib/recs). The deal is
   computed once at the page (useDeal) so the Today band, the rail's count
   and the picks room read the same picks. ══ */
export const RECS_MAX = 24;
const EMPTY_RECS: readonly Rec<AuctionLot>[] = [];
export interface Deal { pool: AuctionLot[]; recs: Rec<AuctionLot>[]; loop: ReturnLoop | null }
function useDeal(book: AuctionLot[], taste: Taste, ready: boolean): Deal {
  // the block (isOnBlock — every live count's pool), re-cut per book
  const pool = useMemo(() => {
    const today = localToday(), now = Date.now();
    return book.filter(l => l.status === 'upcoming' && isOnBlock(l, today, now));
  }, [book]);
  // (r9) a narrow taste (one followed maker) deals deeper — Show more walks it
  const recs = useMemo(() => (ready && taste.seeds.length ? recommend(pool, taste, { n: Math.max(RECS_MAX, recDepth(taste)) }) : []), [ready, pool, taste]);
  // THE RETURN LOOP — what is new in your picks since you were last here,
  // and what of them closes tonight (app/components/PickStrips → Today band)
  const prevVisitDay = useLastVisit();
  const baselines = useMemo(() => houseBaselines(book), [book]);
  const loop = useReturnLoop(pool, taste, { ready, prevVisitDay, baselines });
  return { pool, recs, loop };
}

/* ── SETTLED — one row shape for both shells (History reads it) ── */
export type SettledRowData =
  | { kind: 'lot'; lot: AuctionLot; date: string }
  | { kind: 'ledger'; o: { id: string; priceUsd: number; saleDate: string; provisional: boolean }; date: string };

export interface CollectionRow {
  lot: AuctionLot; paid: number | null; paidIsOverride: boolean; note: string | null; savedId: string;
  appraised: number | null; basis: string | null; refOnly: boolean; deltaPct: number | null;
  drill: DrillRow | null; drillSlug: string | null;
}
export interface CollectionRead {
  rows: CollectionRow[];
  /** Σ bought over every piece with a price (your basis, else the realized price) */
  totalPaid: number;
  /** Σ the ENGINE's appraisal over the pieces it appraised — only those
   *  (R4#4: a piece without a comp pool never carries at cost into a
   *  figure called an appraisal) */
  totalAppraised: number;
  /** Σ bought over the appraised pieces that also carry a bought price —
   *  the denominator of `deltaPct` */
  appraisedPaid: number;
  /** appraised vs bought over the `appraisedPaidN` pieces that have both; null = no measurement */
  deltaPct: number | null;
  appraisedN: number; appraisedPaidN: number;
  /** saves marked owned while still on the block — a live lot can't be
   *  owned yet: it stays in Watching and joins the collection when it
   *  hammers (the mark is kept, never deleted) */
  pendingOwned: AuctionLot[];
}
export interface RecordRead {
  n: number; realized: number; med: number | null;
  split: { flagged: number | null; flaggedN: number; rest: number | null; restN: number } | null;
  series: { id: string; d: string; pct: number; title: string }[];
}
export interface WatchSummary {
  /** Σ estimate midpoints over the PRICED live watches (./priced: both bounds) */
  totalEst: number;
  priced: number;
  /** live watches with a one-sided estimate ("from $X") — counted, never summed */
  oneSided: number;
  flagged: number; next: AuctionLot | null; closesToday: number;
}
export type LedgerState = { ledger: Map<string, LedgerEntry>; loaded: boolean; error: boolean };

/** the page's own reads — what the rooms written before the contract use */
export interface DeskInternals {
  auth: { authEnabled: boolean; user: ReturnType<typeof useAuth>['user']; authReady: boolean; savedReady: boolean; signInWithGoogle: () => void; signOut: () => void };
  /** raw saved ids (the badge's truth) and the meta keyed by them */
  savedIds: string[]; savedMeta: Record<string, SavedMeta>;
  isSaved: (id: string) => boolean;
  toggle: (id: string, lot?: AuctionLot) => void;
  toggleOwned: (id: string) => void;
  setSavedFields: (id: string, fields: Partial<SavedMeta>) => void;
  /** savedMeta is keyed by the id AT SAVE TIME — reach it through the alias */
  metaFor: (rowId: string) => SavedMeta | undefined;
  /** the id a resolved row is saved under */
  savedIdOf: (rowId: string) => string;
  ownedLotIds: Set<string>; ownedIdSet: Set<string>;
  /** every save resolved to a corpus row (the page's partition base) */
  savedLots: AuctionLot[];
  allLots: AuctionLot[]; tasteBook: AuctionLot[]; lastCrawl: string | null;
  loading: boolean; fullLoaded: boolean; fullError: boolean; fromCache: boolean;
  marketData: ReturnType<typeof useFullLotsOnDemand>['market'];
  fullSlow: boolean; partialLoadFailed: boolean; pageLoading: boolean; landReady: boolean;
  recTaste: Taste; recsReady: boolean; deal: Deal; todayTop: Rec<AuctionLot>[];
  watchFirst: boolean; deskView: boolean; signedOutView: boolean; coldOut: boolean;
  upcoming: AuctionLot[]; sold: AuctionLot[]; other: AuctionLot[];
  orphanIds: string[]; soldOrphans: { id: string; priceUsd: number; saleDate: string; provisional: boolean }[]; goneOrphans: string[];
  ledgerState: LedgerState; setLedgerState: (s: LedgerState) => void;
  signalById: Map<string, LiveSignal | null>;
  settledRows: SettledRowData[]; settledCount: number; settledHasCall: boolean;
  record: RecordRead | null; recordLedByAppraisal: boolean;
  collection: CollectionRead; exposure: { row: DrillRow; n: number; held: number }[];
  collectionChart: { anchor: { key: string; label: string; color: string; unit: 'money'; points: { period: string; value: number; n: number }[] }; layers: { key: string; label: string; color: string; unit: 'money'; points: { period: string; value: number; n: number }[] }[] } | null;
  summary: WatchSummary; changes: { moved: number; newBids: number };
  reads: TodayRead[]; room: { l: AuctionLot; reason: ReturnType<typeof watchTagOf> }[];
  ledgerCols: { sig: boolean; delta: boolean };
  closingWatches: AuctionLot[]; awayLine: React.ReactNode | null; unseenAlerts: number;
  myFollows: Follow[]; marketOwned: AuctionLot[]; hasMarket: boolean; tunedLine: string | null;
  historyCount: number; hasRecordRoom: boolean; unclaimedWins: number;
  givenName: string | null; deskKicker: string; tasteLabels: string[]; tenure: string | null; hasDeskDetails: boolean;
  /** the Today band renders (its rail pill's gate) */
  todayShows: boolean;
  isDesktop: boolean | null; upcomingCounts: Record<string, number>; badgeCount: number;
  onCardToggle: (id: string) => void; onSettledOwn: (savedId: string) => void; onSettledRemove: (savedId: string) => void;
  /** the page-level comps modal (DeskActions.openLot) */
  modalLot: AuctionLot | null; closeModal: () => void;
}

export interface DeskState { desk: DeskData; act: DeskActions; narrow: boolean; i: DeskInternals }

/** the page's one clock: a minute tick, so every day boundary and "closes
 *  in" on the desk agrees and re-cuts together */
function useDeskClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export function useDeskState(): DeskState {
  // ORDER MATTERS: the saves answer whether this desk needs the corpus at all,
  // so they are read BEFORE the data layer.
  const { savedIds, savedMeta, toggle, isSaved, ownedIds, toggleOwned, setSavedFields } = useSavedLots();
  const { authEnabled, user, authReady, savedReady, signInWithGoogle, signOut } = useAuth();
  // LAZY CORPUS (Sep 2026 perf pass). Everything corpus-fed on this desk is
  // ABOUT THE SAVES — resolving each saved id to its live row, appraising the
  // collection, the reference bands, the settled record. An empty desk (signed
  // out, or signed in with nothing saved) needs none of it, and used to stream
  // ~35MB to render a ghost desk and two buttons. So the request is gated on
  // there being something to resolve. Once there is, it fires immediately:
  // every figure below is already `fullLoaded`-gated, and a saved lot must
  // never resolve against half a corpus and be printed as an orphan.
  const deskNeedsCorpus = savedReady && (savedIds.length > 0 || ownedIds.length > 0);
  const { allLots, lastCrawl, loading, fullLoaded, fullError, fromCache, market: marketData } =
    useFullLotsOnDemand(deskNeedsCorpus);
  const { unseen: unseenAlerts } = useAlerts();
  const now = useDeskClock();
  // TIME-TO-USEFUL (W19): the corpus rows of this desk's settled saves, kept
  // on this device once the archive resolved them (../settled-cache) — the
  // picks deal the moment the live book lands instead of waiting ~20s+ for
  // the archive, from the same rows it will hand over (no reshuffle)
  const [keptRows, setKeptRows] = useState<SettledRows>(() => new Map());
  useEffect(() => { setKeptRows(readSettledRows()); }, []);
  const liveIds = useMemo(() => (fullLoaded ? null : new Set(allLots.map(l => l.id))), [allLots, fullLoaded]);
  const tasteBook = useMemo(() => {
    if (!liveIds || !keptRows.size) return allLots;
    const extra: AuctionLot[] = [];
    keptRows.forEach(r => { if (r && !liveIds.has(r.id)) extra.push(r); });
    return extra.length ? allLots.concat(extra) : allLots;
  }, [allLots, liveIds, keptRows]);
  // every save is in the live book or kept here: the picks need no archive
  const savesInHand = useMemo(() => {
    if (!liveIds) return false;
    return savedIds.every(id => keptRows.has(id) || idAliases(id).some(a => liveIds.has(a)));
  }, [savedIds, keptRows, liveIds]);
  // the reader's taste — saves resolve against whatever book has landed
  // (plus the kept settled rows), else their own snapshot (app/lib/use-recs)
  const { taste: recTaste, ready: tasteReady } = useTaste(tasteBook);
  // NO INFINITE SPINNERS (../stall): the archive that resolves the desk has a
  // deadline — past it every surface waiting on it fails soft and says so
  // (20s: the archive is ~35MB — a slow phone legitimately takes a while,
  // and dealing picks before it lands means a reshuffle when it does)
  const fullWait = deskNeedsCorpus && !loading && !fullLoaded && !fullError;
  const fullSlow = useStalled(fullWait, 20_000);
  // a deep link lands after the archive (rows above it change height when it
  // arrives); one that never arrives still lands, later
  const landSlow = useStalled(fullWait, 30_000);

  // phone vs desk — decided here, once, for every section (SSR + first client
  // render agree on "unknown": ledger-only, nothing desktop-only mounted)
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const on = () => setIsDesktop(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  /* ── resolve saved ids through the alias map (id~ flips, Wright-family
     mirrors) BEFORE declaring an orphan — a settled watch must never
     silently drop out of the record (selection bias). ── */
  const { savedLots, savedIdByLotId, orphanIds } = useMemo(() => {
    const byId = new Map(allLots.map(l => [l.id, l]));
    const resolve = (id: string): AuctionLot | undefined => {
      for (const a of idAliases(id)) {
        const hit = byId.get(a);
        if (hit) return hit;
      }
      return undefined;
    };
    const lots: AuctionLot[] = [];
    const idMap = new Map<string, string>(); // resolved row id → original saved id
    const seen = new Set<string>();
    const orphans: string[] = [];
    for (const id of savedIds) {
      const l = resolve(id);
      if (l) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        lots.push(l);
        if (l.id !== id) idMap.set(l.id, id);
      } else if (fullLoaded) {
        orphans.push(id);
      }
    }
    return { savedLots: lots, savedIdByLotId: idMap, orphanIds: orphans };
  }, [savedIds, allLots, fullLoaded]);

  /** savedMeta is keyed by the id AT SAVE TIME — reach it through the alias. */
  const metaFor = useCallback(
    (rowId: string) => savedMeta[savedIdByLotId.get(rowId) ?? rowId],
    [savedMeta, savedIdByLotId],
  );
  /** the OWNED flag lives on the saved id too — write through the alias, or
      "I won it" silently no-ops on any alias-resolved row. */
  const savedIdOf = useCallback(
    (rowId: string) => savedIdByLotId.get(rowId) ?? rowId,
    [savedIdByLotId],
  );
  /** owned flags keyed by the RAW saved id — archive orphans never resolve
      to a corpus row, so this set (not ownedLotIds) answers for them */
  const ownedIdSet = useMemo(() => new Set(ownedIds), [ownedIds]);
  const ownedLotIds = useMemo(() => {
    const ownedSet = new Set(ownedIds);
    return new Set(savedLots.filter(l => ownedSet.has(savedIdByLotId.get(l.id) ?? l.id)).map(l => l.id));
  }, [ownedIds, savedLots, savedIdByLotId]);

  // sold-outcomes ledger — data + state lifted together (a fetch failure must
  // never be printed as "withdrawn by the house")
  const [ledgerState, setLedgerState] = useState<LedgerState>({ ledger: new Map(), loaded: false, error: false });
  const { soldOrphans, goneOrphans } = useMemo(() => {
    const soldO: { id: string; priceUsd: number; saleDate: string; provisional: boolean }[] = [];
    const goneO: string[] = [];
    if (!ledgerState.loaded) return { soldOrphans: soldO, goneOrphans: goneO };
    for (const id of orphanIds) {
      // walk the SAME aliases corpus resolution walks — the ledger keys
      // canonical ids, and a raw-id miss here dressed a real sale as
      // "withdrawn by the house"
      let hit: LedgerEntry | undefined;
      for (const a of idAliases(id)) { hit = ledgerState.ledger.get(a); if (hit) break; }
      if (hit) soldO.push({ id, priceUsd: hit[0], saleDate: hit[1], provisional: hit.length > 2 });
      else goneO.push(id);
    }
    soldO.sort((a, b) => (a.saleDate < b.saleDate ? 1 : -1));
    return { soldOrphans: soldO, goneOrphans: goneO };
  }, [orphanIds, ledgerState]);

  // the badge is the count of SAVES — a truth localStorage/cloud own outright.
  // (Counting resolved rows made the badge silently shrink by the orphan
  // count the moment phase 2 landed.)
  const badgeCount = savedIds.length;

  // the page's calendar day, as STATE — a long-lived tab crosses midnight,
  // and every date-bucketed memo below must re-cut when the day flips, not
  // stay frozen on yesterday until the corpus happens to change identity
  const [todayKey, setTodayKey] = useState(() => localToday());
  useEffect(() => {
    const t = window.setInterval(() => {
      setTodayKey(k => { const now = localToday(); return now === k ? k : now; });
    }, 5 * 60_000);
    return () => window.clearInterval(t);
  }, []);

  const upcoming = useMemo(() =>
    savedLots
      .filter(l => l.status === 'upcoming' && !isPastPending(l))
      .sort((a, b) => saleTime(a) - saleTime(b)),
    // todayKey: isPastPending reads the calendar — re-cut at midnight
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savedLots, todayKey]
  );
  const sold = useMemo(() =>
    savedLots
      .filter(l => l.status === 'sold' || isPastPending(l))
      .sort((a, b) => saleTime(b, 0) - saleTime(a, 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [savedLots, todayKey]
  );
  const other = useMemo(() =>
    savedLots
      .filter(l => l.status !== 'upcoming' && l.status !== 'sold')
      .sort((a, b) => saleTime(b, 0) - saleTime(a, 0)),
    [savedLots]
  );

  /** live signals computed ONCE per data change — never in a render body
      (a corpus-resolved row without a stamped signal is an O(corpus) scan) */
  const signalById = useMemo(() => {
    const m = new Map<string, LiveSignal | null>();
    for (const l of upcoming) m.set(l.id, lotSignal(l, allLots));
    return m;
  }, [upcoming, allLots]);

  const settledRows = useMemo<SettledRowData[]>(() => {
    const rows: SettledRowData[] = [
      ...sold.map(lot => ({ kind: 'lot' as const, lot, date: lot.saleDate || '' })),
      ...soldOrphans.map(o => ({ kind: 'ledger' as const, o, date: o.saleDate || '' })),
    ];
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    return rows;
  }, [sold, soldOrphans]);

  /* ── COLLECTION — engine-appraised; a reference RANGE is context only ── */
  const collection = useMemo<CollectionRead>(() => {
    // OWNED ∩ LIVE (R1#9, R4#11): a lot marked owned while still on the block
    // is not a piece yet — it stays in Watching (and the Budget plan) and
    // joins here, with its totals, when it hammers; the mark is kept
    const pendingOwned = savedLots.filter(l => ownedLotIds.has(l.id) && l.status === 'upcoming' && !isPastPending(l));
    const pendingIds = new Set(pendingOwned.map(l => l.id));
    const rows: CollectionRow[] = savedLots
      .filter(l => ownedLotIds.has(l.id) && !pendingIds.has(l.id))
      .map(l => {
        const m = metaFor(l.id);
        // YOUR number first: the recorded cost basis beats the hammer price
        const paid = m?.paidUsd ?? (l.priceUsd || null);
        // (Oct 6 2026, wave 4) the ENGINE's appraisal only (lot.value,
        // ×5-sane) — no client appraisal / realized band
        const vd = lotVerdict(l);
        const appraised = vd ? vd.expectedAllIn : null;
        const basis = vd ? `${vd.compN} comps` : null;
        let refRange: string | null = null;
        if (appraised == null && fullLoaded) {
          const mkt = ARTIST_MARKET[l.artist];
          // domain reference tiers first; then the maker band — a unique work
          // reads against the maker's own sold record for the same form
          const rb = (mkt === 'science' ? scienceReferenceBand(l, allLots)
            : mkt === 'culture' ? cultureReferenceBand(l, allLots) : null)
            ?? makerReferenceBand(l, allLots);
          if (rb) {
            refRange = rb.scope
              ? `${ARTIST_LABEL[l.artist] || l.artist} ${rb.scope} reference ${fmtFace(rb.q1)}–${fmtFace(rb.q3)} · ${rb.n} sales`
              : `reference ${fmtFace(rb.q1)}–${fmtFace(rb.q3)} · ${rb.n} sales`;
          }
        }
        const deltaPct = paid && appraised ? Math.round((appraised / paid - 1) * 100) : null;
        const drill = drillRowFor(l, marketData);
        const drillRef = drillSlugFor(l);
        return { lot: l, paid, paidIsOverride: m?.paidUsd != null, note: m?.note ?? null, savedId: savedIdOf(l.id), appraised, basis: basis ?? refRange, refOnly: !basis && !!refRange, deltaPct, drill, drillSlug: drillRef?.slug ?? null };
      })
      .sort((a, b) => (b.appraised ?? b.paid ?? 0) - (a.appraised ?? a.paid ?? 0));
    // owned ARCHIVE wins — the lot left the corpus, but the win is real:
    // it joins at its realized price (carried, never engine-appraised; no
    // comp pool exists for a row we no longer hold). Without this, claiming
    // an archive row silently vanished from the collection.
    for (const o of soldOrphans) {
      if (o.provisional || !ownedIdSet.has(o.id)) continue;
      const m = savedMeta[o.id];
      const ghost = {
        id: o.id, title: m?.title || 'Archived piece', artist: m?.artist || '',
        auctionHouse: 'archive', saleDate: o.saleDate, priceUsd: o.priceUsd, status: 'sold',
      } as unknown as AuctionLot;
      rows.push({
        lot: ghost, paid: m?.paidUsd ?? (o.priceUsd || null), paidIsOverride: m?.paidUsd != null,
        note: m?.note ?? null, savedId: o.id, appraised: null,
        basis: 'archive record · carried at bought price', refOnly: false,
        deltaPct: null, drill: null, drillSlug: null,
      });
    }
    const totalPaid = rows.reduce((s, r) => s + (r.paid || 0), 0);
    // (R4#4, R1#4) the appraisal total is the ENGINE's over the pieces it
    // appraised — never cost carried forward under the word "appraisal";
    // the ±% compares those same pieces with their bought price, n said
    const appraisedRows = rows.filter(r => r.appraised != null);
    const bothRows = appraisedRows.filter(r => r.paid != null && r.paid > 0);
    const totalAppraised = appraisedRows.reduce((s, r) => s + (r.appraised ?? 0), 0);
    const appraisedPaid = bothRows.reduce((s, r) => s + (r.paid ?? 0), 0);
    const appraisedOfPaid = bothRows.reduce((s, r) => s + (r.appraised ?? 0), 0);
    const deltaPct = appraisedPaid > 0 ? Math.round((appraisedOfPaid / appraisedPaid - 1) * 100) : null;
    const appraisedN = appraisedRows.length;
    const appraisedPaidN = bothRows.length;
    return { rows, totalPaid, totalAppraised, appraisedPaid, deltaPct, appraisedN, appraisedPaidN, pendingOwned };
  }, [savedLots, ownedLotIds, allLots, fullLoaded, marketData, soldOrphans, ownedIdSet, savedMeta, metaFor, savedIdOf]);

  /* ── sub-market exposure — the MARKET's read, labeled as such ── */
  const exposure = useMemo(() => {
    const by = new Map<string, { row: DrillRow; n: number; held: number }>();
    for (const r of collection.rows) {
      if (!r.drill) continue;
      const cur = by.get(r.drill.slug) || { row: r.drill, n: 0, held: 0 };
      cur.n += 1;
      cur.held += r.appraised ?? r.paid ?? 0;
      by.set(r.drill.slug, cur);
    }
    return Array.from(by.values()).sort((a, b) => b.held - a.held);
  }, [collection]);

  /* ── collection history — one snapshot per LOCAL day; read the trail back
     (lib/snapshots owns the DB round-trip; this page only renders it) ── */
  const snaps = useCollectionSnapshots(collection, fullLoaded);
  const collectionChart = useMemo(() => {
    if (snaps.length < 3) return null;
    return {
      anchor: {
        key: '_appr', label: 'lectr appraisal', color: '', unit: 'money' as const,
        points: snaps.map(s => ({ period: s.d, value: s.appraised, n: s.pieces })),
      },
      layers: [{
        key: 'paid', label: 'Bought', color: 'var(--chart-line-2)', unit: 'money' as const,
        points: snaps.map(s => ({ period: s.d, value: s.paid, n: s.pieces })),
      }],
    };
  }, [snaps]);

  /* ── WATCHING summary ── */
  const summary = useMemo<WatchSummary>(() => {
    // ONE "priced" rule (./priced, R4#3): a sum of estimate MIDPOINTS over the
    // lots with BOTH bounds — every surface that prints it labels it so ("at
    // estimate midpoint · N of M priced"); a one-sided estimate is "from $X"
    // on its row and never enters the total; a bid-only lot adds nothing
    const { total: totalEst, priced, oneSided } = pricedTotal(upcoming);
    const flagged = upcoming.filter(l => signalById.get(l.id)?.label === 'Below Market').length;
    const todayIso = localToday();
    const next = upcoming.find(l => { const d = closeDayOf(l).slice(0, 10); return !!d && d >= todayIso; }) || null;
    const closesToday = upcoming.filter(l => closeDays(l) === 0).length;
    return { totalEst, priced, oneSided, flagged, next, closesToday };
  }, [upcoming, signalById]);

  const changes = useMemo(() => {
    let moved = 0;
    let newBids = 0;
    for (const lot of upcoming) {
      const m = metaFor(lot.id);
      if (!m) continue;
      const cur = signalById.get(lot.id);
      const call = signalCallOf(m);
      if (call && cur && call.dir !== 'unknown') {
        // legacy saves have no recorded direction — SavedDelta and the Δ
        // column render them neutral, so the masthead must not count them
        // as "moved" on magnitude alone (the two surfaces would disagree)
        const flipped = (call.dir === 'below' && cur.label !== 'Below Market') || (call.dir === 'above' && cur.label !== 'Above Market');
        if (flipped || Math.round(cur.pct) !== Math.round(call.pct)) moved++;
      }
      if (m.bidCount != null && (lot.bidCount || 0) > m.bidCount) newBids += (lot.bidCount || 0) - m.bidCount;
    }
    return { moved, newBids };
  }, [upcoming, metaFor, signalById]);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  /* ── THE READS — the desk's insight layer: hot vs quiet vs landing vs
     underpriced, each with its measured evidence. Facts only. ── */
  const reads = useMemo<TodayRead[]>(() => {
    const rows: TodayRead[] = [];
    // ONE read per lot — the same LeBron card led "Most bids" AND "Lands
    // soon" in adjacent rows; each read type claims from the not-yet-used
    // pool, in evidence order (velocity > quiet > landing > comps > flags)
    const used = new Set<string>();
    const claim = (l: AuctionLot) => { used.add(l.id); return l; };
    const hot = upcoming
      .filter(l => l.bidVelocity && l.bidVelocity.delta > 0)
      .sort((a, b) => (b.bidVelocity!.delta) - (a.bidVelocity!.delta))
      .slice(0, 2);
    for (const l of hot) {
      const v = l.bidVelocity!;
      rows.push({
        key: `hot-${claim(l).id}`, tag: 'Most bids', lot: l, tone: 'hot',
        // pctile is a BRAG — printing "faster than 19% of live lots" reads
        // as praise for a bottom-quintile pace; cite it only above median
        fact: <>+{v.delta} {v.delta === 1 ? 'bid' : 'bids'} in {Math.round(v.hours)}h{v.pctile != null && v.pctile >= 50 && <> · faster than {v.pctile}% of live lots</>}</>,
      });
    }
    // the sleeper read: bid-platform lots landing THIS WEEK with a published
    // near-zero count — absent bidCount is absent data, never "no interest"
    // the sleeper lane's own read (lanes.ts) — verified-fair, dead room
    const nowMs = Date.now();
    const quiet = upcoming
      .filter(l => !used.has(l.id))
      .map(l => ({ l, read: sleeperRead(l, nowMs) }))
      .filter((x): x is { l: AuctionLot; read: NonNullable<ReturnType<typeof sleeperRead>> } => !!x.read)
      .sort((a, b) => closeDays(a.l) - closeDays(b.l))
      .slice(0, 2);
    for (const { l, read } of quiet) {
      const d = closeDays(l);
      rows.push({
        key: `q-${claim(l).id}`, tag: 'Quietest', lot: l,
        fact: <>no bids yet · hammers {d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}{read.entry != null ? <> · opens at {fmtFace(read.entry)}</> : null} · appraised {fmtFace(read.cvu)}{read.anchor === 'fair-est' ? ', at estimate' : ''}</>,
      });
    }
    const soon = upcoming
      .filter(l => !used.has(l.id))
      .filter(l => { const d = closeDays(l); return d >= 0 && d <= TAG_SOON_DAYS; })
      .slice(0, 3);
    for (const l of soon) {
      const d = closeDays(l);
      // when formatEstimate prints the live-bid form ("$402 bid · 10 bids" —
      // it does this for ANY lot with a live bid and no two-sided estimate),
      // appending bid state again printed "· 10 bids · 10 bids". Gate on what
      // it PRINTED, not on which fields exist (one-sided estimates still take
      // the bid branch).
      const estText = formatEstimate(l);
      const printedBid = estText.includes('bid');
      rows.push({
        key: `soon-${claim(l).id}`, tag: 'Lands soon', lot: l, tone: 'hot',
        fact: <>hammers {d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}{estText ? <> · {estText}</> : null}{!printedBid && typeof l.bidCount === 'number' && l.bidCount > 0 ? <> · {l.bidCount} {l.bidCount === 1 ? 'bid' : 'bids'}</> : null}</>,
      });
    }
    if (fullLoaded) {
      let found = 0;
      for (const l of upcoming) {
        if (used.has(l.id)) continue;
        if (l.cardComps && l.cardComps.n > 0 && l.cardComps.med != null) {
          rows.push({
            key: `dc-${claim(l).id}`, tag: 'Direct comps', lot: l,
            fact: <>{l.cardComps.n} {l.cardComps.n === 1 ? 'sale' : 'sales'}, same card &amp; grade · {fmtFace(l.cardComps.med)} median</>,
          });
          found++;
        }
        // (Oct 6 2026, wave 4) the client same-edition appraisal row is gone:
        // only the build's same-card comps seat a 'Direct comps' row
        if (found >= 2) break;
      }
    }
    // deepest below-market — dealScore, THE one flagged ranking
    const under = upcoming
      .filter(l => !used.has(l.id))
      .map(l => ({ l, sig: signalById.get(l.id) }))
      .filter((x): x is { l: AuctionLot; sig: LiveSignal } => !!x.sig && x.sig.label === 'Below Market')
      .sort((a, b) => dealScore(b.l, b.sig.pct) - dealScore(a.l, a.sig.pct))
      .slice(0, 2);
    for (const { l, sig } of under) {
      // same printed-bid gate as the lands-soon read: formatEstimate takes
      // the live-bid branch for any lot without a two-sided estimate, and
      // appending currentBid on top printed "· $220 bid · 2 bids · $220 bid"
      const estText = formatEstimate(l);
      const printedBid = estText.includes('bid');
      rows.push({
        key: `bm-${claim(l).id}`, tag: 'Below market', lot: l, tone: 'up',
        fact: <><b style={{ color: 'var(--color-up)', fontVariantNumeric: 'tabular-nums' }}>+{Math.abs(Math.round(sig.pct))}%</b> vs comps{estText ? <> · {estText}</> : null}{!printedBid && (l.currentBid || 0) > 0 ? <> · {fmtFace(l.currentBid!)} bid</> : null}</>,
      });
    }
    return rows.slice(0, 8);
  }, [upcoming, fullLoaded, signalById]);

  /* ── THE ROOM — the watching ledger with the brief fused in: every row
     carries its reason tag and the ledger sorts action-first. ── */
  const room = useMemo(() => {
    // watchTagOf — the ONE classifier Today's reads shares
    const rows = upcoming.map(l => ({ l, reason: watchTagOf(l, signalById.get(l.id)) }));
    rows.sort((a, b) => {
      const ra = a.reason?.rank ?? 9;
      const rb = b.reason?.rank ?? 9;
      if (ra !== rb) return ra - rb;
      if (ra === 0) return closeDays(a.l) - closeDays(b.l);
      if (ra === 1) {
        const sa = signalById.get(a.l.id);
        const sb = signalById.get(b.l.id);
        // the ONE flagged ranking — dealScore, never raw pct
        return dealScore(b.l, sb?.pct ?? 0) - dealScore(a.l, sa?.pct ?? 0);
      }
      if (ra === 2) return (b.l.bidVelocity?.delta ?? 0) - (a.l.bidVelocity?.delta ?? 0);
      return closeDayOf(a.l).localeCompare(closeDayOf(b.l));
    });
    return rows;
  }, [upcoming, signalById]);

  /* which ledger columns carry anything (an all-dash column folds away) */
  const ledgerCols = useMemo(() => {
    let sig = false, delta = false;
    for (const { l } of room) {
      const sg = signalById.get(l.id) ?? null;
      if (sg) sig = true;
      const m = metaFor(l.id);
      const call = signalCallOf(m);
      if ((call && sg && call.dir !== 'unknown') || (l.bidVelocity && l.bidVelocity.delta > 0)
        || (m?.bidCount != null && (l.bidCount || 0) > m.bidCount)) delta = true;
    }
    return { sig, delta };
  }, [room, signalById, metaFor]);

  /* ── THE RECORD — measured, receipts attached ── */
  const record = useMemo<RecordRead | null>(() => {
    const judged = sold
      .map(l => ({ l, pct: overEstimatePct(l) }))
      .filter((x): x is { l: AuctionLot; pct: number } => x.pct != null);
    if (!judged.length) return null;
    const realized = judged.reduce((s, x) => s + (x.l.priceUsd || 0), 0);
    const med = median(judged.map(x => x.pct));
    // the flagged-vs-rest split reads DIRECTIONS, which only post-convention
    // saves carry; legacy direction-unknown saves stay in the blended median
    // but never claim a side of the split.
    const flaggedAtSave = judged.filter(x => signalCallOf(metaFor(x.l.id))?.dir === 'below');
    const restAtSave = judged.filter(x => {
      const c = signalCallOf(metaFor(x.l.id));
      return c != null && c.dir !== 'below' && c.dir !== 'unknown';
    });
    const split = flaggedAtSave.length >= 3 && restAtSave.length >= 3
      ? { flagged: median(flaggedAtSave.map(x => x.pct)), flaggedN: flaggedAtSave.length, rest: median(restAtSave.map(x => x.pct)), restN: restAtSave.length }
      : null;
    // the TIMELINE — every judged call in hammer order, most recent 60. The
    // median is the headline; the sequence is the receipt trail (and shows
    // whether the eye is improving).
    const series = judged
      .slice()
      .sort((a, b) => ((a.l.saleDate || '') < (b.l.saleDate || '') ? -1 : 1))
      .slice(-60)
      .map(x => ({ id: x.l.id, d: (x.l.saleDate || '').slice(0, 10), pct: x.pct, title: x.l.title }));
    return { n: judged.length, realized, med, split, series };
  }, [sold, metaFor]);

  /* ── since your last visit — the site's ONE last-visit clock (feed-filters
     useLastVisit: the previous visit DAY, any page, stable for the session),
     so this line and the Today band's "New since" can never disagree ── */
  const prevVisit = useLastVisit();
  const sinceLast = useMemo(() => {
    if (!fullLoaded || !prevVisit) return null;
    const prevDay = prevVisit;
    const fresh = sold.filter(l => (l.saleDate || '').slice(0, 10) > prevDay);
    if (!fresh.length) return null;
    const pcts = fresh.map(l => overEstimatePct(l)).filter((x): x is number => x != null);
    return { n: fresh.length, med: pcts.length ? median(pcts) : null };
  }, [fullLoaded, prevVisit, sold]);

  /* ── personalization — whose desk this is, what they watch, since when ── */
  const givenName = useMemo(() => {
    const md = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const raw = (typeof md.given_name === 'string' && md.given_name)
      || (typeof md.full_name === 'string' && md.full_name.split(' ')[0])
      || (typeof md.name === 'string' && md.name.split(' ')[0])
      || null;
    return raw && raw.length <= 20 ? raw : null;
  }, [user]);
  const tasteLabels = useMemo(() => {
    // present tense earns present data: only LIVE watches shape "you watch X"
    const counts = new Map<string, number>();
    for (const l of upcoming) {
      const d = drillRowFor(l, marketData);
      // the sub-market in the label vocabulary ("Vintage (1996–2003)", not "Vintage ≤'02")
      const label = d?.label ? drillLabelOf(d.slug, d.label) : null;
      if (label) counts.set(label, (counts.get(label) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label]) => label);
  }, [upcoming, marketData]);
  const tenure = useMemo(() => {
    let min: string | null = null;
    for (const id of savedIds) {
      const at = savedMeta[id]?.savedAt;
      if (at && (!min || at < min)) min = at;
    }
    if (!min) return null;
    const days = (Date.now() - Date.parse(min)) / 86_400_000;
    if (!(days > 30)) return null;
    return new Date(min).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [savedIds, savedMeta]);

  // the away strip's own-it prompts: settled wins not yet in the collection
  const unclaimedWins = useMemo(
    () => sold.filter(l => l.status === 'sold' && !ownedLotIds.has(l.id)).length
      + soldOrphans.filter(o => !o.provisional && !ownedIdSet.has(o.id)).length,
    [sold, ownedLotIds, soldOrphans, ownedIdSet],
  );

  // cards view (desktop opt-in) needs the lot back from its id
  const lotById = useMemo(() => new Map(upcoming.concat(other).map(l => [l.id, l])), [upcoming, other]);
  const onCardToggle = useCallback((id: string) => {
    toggle(savedIdOf(id), lotById.get(id));
  }, [toggle, savedIdOf, lotById]);
  // STABLE settled-row handlers — SettledRowView is memoized; fresh inline
  // closures per row would defeat it on every keystroke-level re-render
  const onSettledOwn = useCallback((savedId: string) => toggleOwned(savedId), [toggleOwned]);
  const onSettledRemove = useCallback((savedId: string) => toggle(savedId), [toggle]);

  // phase-2 failed but SOME saves resolved eagerly — never silently thin the desk
  const partialLoadFailed = fullError && !fullLoaded && savedIds.length > 0;

  // the room waits for every save to resolve (or the corpus to answer), so a
  // settled watch reads as its row, not its snapshot — no reshuffle on arrival
  // (deadline) an archive that never answers stops holding the picks: they
  // deal from the live book already in hand
  const recsInputsReady = !loading && tasteReady && (!deskNeedsCorpus || fullLoaded || fullError || fullSlow || savedLots.length >= savedIds.length || savesInHand);
  // the desk paints first; the picks deal one frame later (../stall)
  const recsReady = useAfterPaint(recsInputsReady);
  // the archive resolved every save: keep the settled rows for next visit
  useEffect(() => {
    if (!fullLoaded || !savedReady) return;
    const byId = new Map<string, AuctionLot>();
    for (const l of savedLots) byId.set(l.id, l);
    const resolve = (id: string) => { for (const a of idAliases(id)) { const l = byId.get(a); if (l) return l; } return undefined; };
    writeSettledRows(savedIds, resolve);
  }, [fullLoaded, savedReady, savedIds, savedLots]);
  // ONE deal per page: the Today band, the rail's count and the room agree
  const deal = useDeal(allLots, recTaste, recsReady);

  // the record's lead cell is appraised-vs-bought only once it measures
  // something (≥1 piece with a bought price has a comp-based appraisal)
  const recordLedByAppraisal = collection.deltaPct != null && collection.totalPaid > 0 && collection.appraisedPaidN > 0;
  const settledHasCall = useMemo(() => settledRows.some(r => !!signalCallOf(r.kind === 'lot' ? metaFor(r.lot.id) : savedMeta[r.o.id])), [settledRows, metaFor, savedMeta]);
  // the one settled count every surface prints (Settled head, the cell room)
  const settledCount = sold.length + soldOrphans.length;

  const hasDeskDetails = summary.totalEst > 0 || changes.moved > 0 || changes.newBids > 0 || tasteLabels.length > 0 || !!tenure || !!user;
  const deskKicker = givenName ? `${givenName}’s desk` : 'My desk';

  // dev-only preview of the signed-out page (local mode has no auth); the
  // NODE_ENV check folds away in production builds
  const [previewOut, setPreviewOut] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    try { setPreviewOut(new URLSearchParams(window.location.search).get('preview') === 'signedout'); } catch { /* ignore */ }
  }, []);
  // signed out WITH saves on this device (save works without an account,
  // app/lib/account) → the real desk, exactly as the no-auth mode renders it
  const signedOutView = (authEnabled && authReady && !user && savedIds.length === 0) || previewOut;

  /* ── TODAY: watches that hammer today, soonest first ── */
  const closingWatches = useMemo(() => upcoming
    .filter(l => closeDays(l) === 0)
    .sort((a, b) => (closeMsOf(a) ?? Infinity) - (closeMsOf(b) ?? Infinity)), [upcoming]);
  /* ── the while-you-were-away facts, as the Today band's header line ── */
  const awayLine = (sinceLast || unseenAlerts > 0 || summary.closesToday > 0 || unclaimedWins > 0) ? (
    <>
      {sinceLast && (
        <>
          {sinceLast.n} watched {sinceLast.n === 1 ? 'lot' : 'lots'} settled
          {sinceLast.med != null && (
            <> · your {sinceLast.n === 1 ? 'call went' : 'calls went'}{' '}
              <b style={{ color: sinceLast.med > 0 ? 'var(--color-up)' : sinceLast.med < 0 ? 'var(--color-down-text)' : 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>
                {fmtSignedPct(Math.round(sinceLast.med))}
              </b>{' '}
              vs estimate
            </>
          )}
        </>
      )}
      {unseenAlerts > 0 && (
        <>{sinceLast ? ' · ' : ''}<a href="#inbox" className="ck-away-link">{unseenAlerts} new {unseenAlerts === 1 ? 'match' : 'matches'} in your inbox</a></>
      )}
      {summary.closesToday > 0 && (
        <>{(sinceLast || unseenAlerts > 0) ? ' · ' : ''}{summary.closesToday} {summary.closesToday === 1 ? 'watch closes' : 'watches close'} today</>
      )}
      {unclaimedWins > 0 && (
        <>{(sinceLast || unseenAlerts > 0 || summary.closesToday > 0) ? ' · ' : ''}<a href="#settled" className="ck-away-link">{unclaimedWins === 1 ? '1 of your watches sold — did you win it?' : `${unclaimedWins} of your watches sold — did you win any?`}</a></>
      )}
      {sinceLast && <> · <a href="#settled" className="ck-away-go">See what happened <Flick size={9} /></a></>}
    </>
  ) : null;

  /* ── THE RAIL's inputs — one item per section that renders ── */
  const followsApi = useFollows();
  const myFollows = followsApi.follows;
  // YOUR MARKET (N5): the owned pieces' names join the follows
  const marketOwned = useMemo(() => collection.rows.map(r => r.lot), [collection.rows]);
  const hasMarket = myFollows.some(f => f.kind !== 'house') || marketOwned.length > 0;
  // signed out: a reader who already told lectr what they collect gets the
  // STATE as the hero's sub-line, never the "tell lectr" prompt again
  const statedPrice = usePricePref();
  const tunedLine = useMemo(() => {
    if (!myFollows.length) return null;
    const lp = deal.loop;
    const since = lp?.since && lp.since < localToday() ? lp.since : null;
    const fresh = lp?.fresh.length ?? 0;
    return [
      `Tuned to ${myFollows.length} ${myFollows.length === 1 ? 'follow' : 'follows'}`,
      priceText(statedPrice),
      fresh > 0 ? `${fresh} new ${since ? `since ${new Date(`${since}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'today'}` : null,
    ].filter(Boolean).join(' · ');
  }, [myFollows.length, statedPrice, deal.loop]);
  const coldOut = recsReady && recTaste.seeds.length === 0;
  const historyCount = settledCount + other.length + goneOrphans.length;
  const hasRecordRoom = !!(record && record.med != null) || collection.rows.length > 0 || settledCount > 0;
  const deskView = !signedOutView && !(savedLots.length === 0 && orphanIds.length === 0);
  // the room order the page prints: Watching leads For you when the reader
  // has live watches (their own lots, on a hammer clock, before lectr's
  // suggestions); with nothing live, the picks lead
  const watchFirst = deskView && upcoming.length > 0;
  // (follow-up) a desk whose watches lead the page pushes its picks below
  // Watching — the Today band carries the top three so they stay in the
  // first screen, and the picks room below starts after them
  const todayTop = useMemo(() => {
    if (!watchFirst || !recsReady) return [];
    const claimed = new Set<string>(closingWatches.map(l => l.id));
    for (const r of deal.loop?.closing ?? []) claimed.add(r.lot.id);
    return topPicksOf(deal.recs, claimed);
  }, [watchFirst, recsReady, closingWatches, deal.recs, deal.loop]);
  // "Today" leads the rail wherever the band renders — TodayBand's own gate:
  // the return loop answered, or there is an away fact, a closing watch or a read
  const band = deskView
    ? { away: !!awayLine, closing: closingWatches.length, reads: reads.length }
    : signedOutView
      ? { away: false, closing: 0, reads: 0 }
      : { away: unseenAlerts > 0 && !!awayLine, closing: 0, reads: 0 };
  const todayShows = !!deal.loop || band.away || band.closing > 0 || band.reads > 0;

  const landReady = recsReady && !loading && authReady && savedReady && (!deskNeedsCorpus || fullLoaded || !!fullError || landSlow);
  // the whole-page loader's own deadline: past it the loader says the book is
  // slow and offers a reload — never a skeleton forever
  const pageLoading = !signedOutView && (loading || !authReady || !savedReady || (savedLots.length === 0 && !fullLoaded && !fullError && savedIds.length > 0));

  // the page-level comps modal — DeskActions.openLot (the picks room keeps its own)
  const [modalLot, setModalLot] = useLotModal<AuctionLot>();
  const closeModal = useCallback(() => setModalLot(null), [setModalLot]);

  /* ══ THE CONTRACT ══ */
  const saved = useMemo<AuctionLot[]>(() => {
    const out = savedLots.slice();
    // the saves the crawl dropped: their own snapshot, as the row
    for (const o of soldOrphans) {
      const m = savedMeta[o.id];
      out.push({ id: o.id, title: m?.title || 'Archived lot', artist: m?.artist || '', auctionHouse: 'archive', saleDate: o.saleDate, priceUsd: o.provisional ? null : o.priceUsd, status: 'sold', resultsPending: o.provisional || undefined } as unknown as AuctionLot);
    }
    for (const id of goneOrphans) {
      const m = savedMeta[id];
      out.push({ id, title: m?.title || 'No longer listed', artist: m?.artist || '', auctionHouse: '', saleDate: m?.savedAt ? m.savedAt.slice(0, 10) : null, priceUsd: null, status: 'withdrawn' } as unknown as AuctionLot);
    }
    return out;
  }, [savedLots, soldOrphans, goneOrphans, savedMeta]);
  const savedIdSet = useMemo(() => {
    const s = new Set<string>(savedIds);
    for (const l of savedLots) s.add(l.id);
    return s;
  }, [savedIds, savedLots]);
  const ownedAll = useMemo(() => { const s = new Set(ownedLotIds); ownedIdSet.forEach(id => s.add(id)); return s; }, [ownedLotIds, ownedIdSet]);
  // the contract's collection: every owned save as a row — the resolved row,
  // else the settled-cache row kept on this device (a corpus row, with its
  // entity key, so Portfolio and Names can read the maker / player behind a
  // Goldin ghost), else the archive ghost the collection built
  const collectionLots = useMemo(() => {
    const out: AuctionLot[] = [];
    const seen = new Set<string>();
    for (const r of collection.rows) {
      const kept = (r.lot.auctionHouse as string) === 'archive' ? keptRows.get(r.savedId) : null;
      const l = kept ?? r.lot;
      if (seen.has(l.id)) continue;
      seen.add(l.id); out.push(l);
    }
    if (!fullLoaded) {
      // before the archive: owned saves not yet resolved, from the kept rows
      for (const id of ownedIds) {
        if (seen.has(id)) continue;
        const k = keptRows.get(id);
        if (k && !seen.has(k.id)) { seen.add(k.id); seen.add(id); out.push(k); }
      }
    }
    return out;
  }, [collection.rows, keptRows, fullLoaded, ownedIds]);
  const metaForContract = useCallback((id: string) => metaFor(id) ?? savedMeta[id] ?? null, [metaFor, savedMeta]);
  const price = useMemo<PricePref>(() => statedPrice ?? { minUsd: null, maxUsd: null }, [statedPrice]);
  const lastVisitMs = useMemo(() => (prevVisit ? Date.parse(`${prevVisit}T00:00:00`) : null), [prevVisit]);

  const desk = useMemo<DeskData>(() => ({
    now,
    signedIn: authEnabled && !!user,
    book: tasteBook,
    fullLoaded, fullError, lastCrawl: lastCrawl || null,
    saved, savedIds: savedIdSet, metaFor: metaForContract,
    collection: collectionLots, ownedIds: ownedAll,
    ledger: ledgerState.ledger, ledgerLoaded: ledgerState.loaded,
    taste: tasteReady ? recTaste : null,
    follows: myFollows,
    price,
    recs: deal.recs,
    closingPicks: deal.loop?.closing ?? EMPTY_RECS,
    lastVisitMs,
  }), [now, authEnabled, user, tasteBook, fullLoaded, fullError, lastCrawl, saved, savedIdSet, metaForContract, collectionLots, ownedAll, ledgerState, tasteReady, recTaste, myFollows, price, deal.recs, deal.loop, lastVisitMs]);

  const act = useMemo<DeskActions>(() => ({
    toggleSave: (lot) => toggle(savedIdOf(lot.id), lot),
    toggleOwned: (lotId) => toggleOwned(savedIdOf(lotId)),
    setSavedFields: (lotId, fields) => setSavedFields(savedIdOf(lotId), fields),
    setPrice: (p) => { const cur = readInterests(); writeInterests({ markets: cur.markets, at: cur.at, minUsd: p.minUsd, maxUsd: p.maxUsd }); },
    openLot: (lot) => setModalLot(lot),
    follow: (f) => { if (!followsApi.isFollowing(f)) void followsApi.toggle(f); },
    unfollow: (f) => { if (followsApi.isFollowing(f)) void followsApi.toggle(f); },
  }), [toggle, toggleOwned, setSavedFields, savedIdOf, setModalLot, followsApi]);

  const i: DeskInternals = {
    auth: { authEnabled, user, authReady, savedReady, signInWithGoogle, signOut },
    savedIds, savedMeta, isSaved, toggle, toggleOwned, setSavedFields, metaFor, savedIdOf, ownedLotIds, ownedIdSet,
    savedLots, allLots, tasteBook, lastCrawl: lastCrawl || null, loading, fullLoaded, fullError, fromCache, marketData,
    fullSlow, partialLoadFailed, pageLoading, landReady,
    recTaste, recsReady, deal, todayTop, watchFirst, deskView, signedOutView, coldOut,
    upcoming, sold, other, orphanIds, soldOrphans, goneOrphans, ledgerState, setLedgerState,
    signalById, settledRows, settledCount, settledHasCall, record, recordLedByAppraisal,
    collection, exposure, collectionChart, summary, changes, reads, room, ledgerCols,
    closingWatches, awayLine, unseenAlerts, myFollows, marketOwned, hasMarket, tunedLine,
    historyCount, hasRecordRoom, unclaimedWins, givenName, deskKicker, tasteLabels, tenure, hasDeskDetails,
    todayShows, isDesktop, upcomingCounts, badgeCount, onCardToggle, onSettledOwn, onSettledRemove,
    modalLot, closeModal,
  };
  return { desk, act, narrow: isDesktop === false, i };
}

const DeskCtx = createContext<DeskState | null>(null);

export function DeskProvider({ value, children }: { value: DeskState; children: React.ReactNode }) {
  return <DeskCtx.Provider value={value}>{children}</DeskCtx.Provider>;
}

/** THE CONTRACT — what every section reads (./types) */
export function useDesk(): { desk: DeskData; act: DeskActions; narrow: boolean } {
  const v = useContext(DeskCtx);
  if (!v) throw new Error('useDesk() outside <DeskProvider>');
  return v;
}

/** the page's own reads — for the rooms that predate the contract */
export function useDeskInternals(): DeskInternals {
  const v = useContext(DeskCtx);
  if (!v) throw new Error('useDeskInternals() outside <DeskProvider>');
  return v.i;
}
