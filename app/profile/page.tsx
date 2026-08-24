'use client';

import React, { useMemo, useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import { retryFullLoad, retrySoldLedger, useFullLots, useSoldLedger, type LedgerEntry } from '../hooks/useRayData';
import { useSavedLots, SavedMeta } from '../hooks/useSavedLots';
import { signalCallOf } from '../lib/account';
import { useAuth } from '../lib/account';
import { useAlerts } from '../lib/alerts';
import { supabase } from '../lib/supabase';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';
import LotCard, { lotSignal, formatEstimate } from '../components/LotCard';
import { appraiseLot, dealScore, soldCompBand, isSportsScienceObject, scienceReferenceBand, cultureReferenceBand } from '../lib/comps';
import { drillRowFor, drillSlugFor, type DrillRow } from '../lib/submarkets';
import HeroChart from '../preview/terminal/HeroChart';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import CountUp from '../components/CountUp';
import Masthead, { Accent } from '../components/Masthead';
import AlertsInbox from '../components/AlertsInbox';
import Flick from '../components/Flick';
import { getUpcomingCounts, formatPrice, formatDate, craftTitle, fmtSignedPct, localToday, overEstimatePct } from '../utils';
import { ARTIST_LABEL, ARTIST_MARKET } from '../constants';

/* ============================================================
   MY PROFILE — THE COCKPIT (Aug 24 2026 rebuild). The page is
   organized around the collector's three questions, in order:

     1. WHAT HAPPENED WHILE I WAS AWAY — the away strip: settled
        outcomes since the last visit, unseen alert matches,
        wins awaiting "I won it".
     2. WHAT NEEDS ME NOW — the gauge line, then the WATCHING
        ledger with the old desk-brief DISSOLVED INTO IT: each
        row carries its reason tag (lands soon / below market /
        most bids / quiet) and the ledger sorts action-first.
     3. HOW AM I DOING — THE RECORD, the page's receipt, at
        display scale; then the collection (the paper band — the
        certificate for what you own), then SETTLED as the
        line-item receipts.

   Honesty rules hold everywhere: green/red only on measured
   deltas; reference bands are labeled ranges that never enter a
   total; a market read on holdings is the MARKET's move, labeled
   as such; abstention prints its reason (a failed fetch is never
   dressed as a fact about a lot).

   SIGNAL SIGN LAW (see account.tsx SIGNED_SIGNAL_SINCE): the
   at-save signal is interpreted through signalCallOf() — legacy
   saves lost their direction and render unsigned + neutral,
   never green/red. Live signals print the app-wide convention:
   Below Market = +pct mint (comps sit above the ask), Above
   Market = −pct coral.
   ============================================================ */

function daysUntil(dateStr: string): number {
  const day = (dateStr || '').slice(0, 10);
  const t = Date.parse(`${day}T00:00:00Z`);
  if (isNaN(t)) return NaN;
  return Math.round((t - Date.parse(`${localToday()}T00:00:00Z`)) / 86_400_000);
}
function hammerWord(days: number): string {
  if (isNaN(days)) return 'scheduled';
  if (days < 0) return `hammered ${-days} ${days === -1 ? 'day' : 'days'} ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

type LiveSignal = NonNullable<ReturnType<typeof lotSignal>>;
/** live-signal ink + text — the app-wide signalMagnitude convention */
const sigInk = (label: LiveSignal['label']) =>
  label === 'Below Market' ? 'var(--color-up)' : 'var(--color-down-text)';
const sigText = (sig: LiveSignal) =>
  `${sig.label === 'Above Market' ? '−' : '+'}${Math.abs(Math.round(sig.pct))}%`;

/** the at-save call rendered honestly: legacy saves lost direction → neutral */
function CallCell({ meta }: { meta: SavedMeta | undefined }) {
  const call = signalCallOf(meta);
  if (!call) return <span className="num" style={{ color: 'var(--color-text-faint)' }}>—</span>;
  if (call.dir === 'unknown') {
    return (
      <span className="num" style={{ color: 'var(--color-text-muted)' }}
        title="Saved before signals recorded their direction — magnitude only.">
        ±{Math.round(call.pct)}%
      </span>
    );
  }
  return (
    <span className="num" style={{ color: call.dir === 'below' ? 'var(--color-up)' : 'var(--color-down-text)', fontWeight: 600 }}>
      {call.dir === 'below' ? '+' : '−'}{Math.round(call.pct)}%
    </span>
  );
}

/** What changed on a watched lot since the save (cards view caption). */
function SavedDelta({ lot, meta, sig }: { lot: AuctionLot; meta?: SavedMeta; sig: LiveSignal | null }) {
  const call = signalCallOf(meta);
  const bits: React.ReactNode[] = [];
  if (call && sig) {
    const sameAxis = (call.dir === 'below' && sig.label === 'Below Market') || (call.dir === 'above' && sig.label === 'Above Market');
    if (call.dir === 'unknown') {
      bits.push(<span key="s">signal now <b style={{ color: sigInk(sig.label) }}>{sigText(sig)}</b></span>);
    } else if (!sameAxis) {
      bits.push(<span key="s">signal flipped since you saved · now <b style={{ color: sigInk(sig.label) }}>{sigText(sig)}</b></span>);
    } else if (Math.round(sig.pct) !== Math.round(call.pct)) {
      bits.push(
        <span key="s">
          signal {call.dir === 'below' ? '+' : '−'}{Math.round(call.pct)}% <span aria-hidden>↝</span>{' '}
          <b style={{ color: sigInk(sig.label) }}>{sigText(sig)}</b> since you saved
        </span>
      );
    }
  }
  if (meta?.bidCount != null && (lot.bidCount || 0) > meta.bidCount) {
    const n = (lot.bidCount || 0) - meta.bidCount;
    bits.push(<span key="b">+{n} {n === 1 ? 'bid' : 'bids'} since you saved</span>);
  }
  if (!bits.length) return null;
  return (
    <div className="ray-saved-delta">
      {bits.map((b, i) => <React.Fragment key={i}>{i > 0 && ' · '}{b}</React.Fragment>)}
    </div>
  );
}

/** Mount-triggered sold-ledger fetch — lifts data AND load/error state, so a
    network failure is never rendered as a fact about a lot. */
function LedgerGate({ onState }: { onState: (s: { ledger: Map<string, LedgerEntry>; loaded: boolean; error: boolean }) => void }) {
  const { ledger, ledgerLoaded, ledgerError } = useSoldLedger();
  useEffect(() => { onState({ ledger, loaded: ledgerLoaded, error: ledgerError }); }, [ledger, ledgerLoaded, ledgerError, onState]);
  return null;
}

interface Snapshot { d: string; paid: number; appraised: number; pieces: number }
type SavedView = 'ledger' | 'cards';
const SAVEDVIEW_KEY = 'lectr-savedview';

/* ── SETTLED — one row implementation for both shells ── */
type SettledRowData =
  | { kind: 'lot'; lot: AuctionLot; date: string }
  | { kind: 'ledger'; o: { id: string; priceUsd: number; saleDate: string; provisional: boolean }; date: string };

function SettledRowView({ row, meta, owned, onOwn, onRemove, mobile }: {
  row: SettledRowData;
  meta: SavedMeta | undefined;
  owned: boolean;
  onOwn: () => void;
  onRemove: () => void;
  mobile: boolean;
}) {
  if (row.kind === 'ledger') {
    const o = row.o;
    // the save's own estimate (frozen at save time) can still judge an
    // archive outcome — labeled as such, never dressed as a house estimate
    const vsSaveEst = meta?.estMid && o.priceUsd && !o.provisional
      ? Math.round((o.priceUsd / meta.estMid - 1) * 100) : null;
    const name = meta?.title || 'Archived lot';
    const price = o.provisional
      ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }} title="Sold — final price settling; the house posts results shortly after the close.">settling…</span>
      : formatPrice(o.priceUsd);
    if (mobile) {
      return (
        <div className="ray-settled-mrow">
          <div className="ck-mtitle">{name}</div>
          <div className="ck-mline">
            <span className="ck-msub">
              {meta?.artist ? (ARTIST_LABEL[meta.artist] || meta.artist) : 'archive'}
              {meta?.estMid != null && <> · est. {formatPrice(meta.estMid)} at save</>}
            </span>
            <span className="ck-mnum">
              {price}
              {vsSaveEst != null && (
                <b style={{ marginLeft: 6, color: vsSaveEst > 0 ? 'var(--color-up)' : vsSaveEst < 0 ? 'var(--color-down-text)' : 'var(--color-text-muted)' }}>
                  {fmtSignedPct(vsSaveEst)}
                </b>
              )}
            </span>
          </div>
          <div style={{ marginTop: 6 }}><button className="ray-own-btn" onClick={onRemove}>Remove</button></div>
        </div>
      );
    }
    return (
      <div className="ray-settled-cols ray-savedrow" style={{ display: 'grid' }}>
        <span className="maker">{meta?.artist ? (ARTIST_LABEL[meta.artist] || meta.artist) : '—'}</span>
        <span className="work">{name}<span style={{ color: 'var(--color-text-faint)' }}> · archive</span></span>
        <span className="num" style={{ color: meta?.estMid != null ? undefined : 'var(--color-text-faint)' }}
          title={meta?.estMid != null ? 'The estimate as it stood when you saved the lot' : 'No estimate published'}>
          {meta?.estMid != null ? <>{formatPrice(meta.estMid)}<span className="sub">at save</span></> : '—'}
        </span>
        <CallCell meta={meta} />
        <span className="num" style={{ fontWeight: 600 }}>{price}</span>
        <span className="num" style={vsSaveEst != null ? { color: vsSaveEst > 0 ? 'var(--color-up)' : vsSaveEst < 0 ? 'var(--color-down-text)' : 'var(--color-text-muted)', fontWeight: 700 } : { color: 'var(--color-text-faint)' }}
          title={vsSaveEst != null ? 'vs the estimate at save — all-in price against the estimate midpoint' : 'No estimate on file — outside the vs-est median'}>
          {vsSaveEst != null ? <>{fmtSignedPct(vsSaveEst)}<span className="sub">vs est at save</span></> : '—'}
        </span>
        <span style={{ textAlign: 'right' }}><button className="ray-own-btn" onClick={onRemove}>Remove</button></span>
      </div>
    );
  }

  const lot = row.lot;
  const pct = overEstimatePct(lot);
  const pending = !lot.priceUsd;
  if (mobile) {
    return (
      <div className="ray-settled-mrow">
        <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="ck-mtitle">{craftTitle(lot.title)}</div>
        </Link>
        <div className="ck-mline">
          <span className="ck-msub">{ARTIST_LABEL[lot.artist] || lot.artist}</span>
          <span className="ck-mnum">
            {pending ? <span style={{ color: 'var(--color-text-faint)' }}>pending</span> : (
              <>
                <b>{formatPrice(lot.priceUsd!)}</b>
                {pct != null && (
                  <b style={{ marginLeft: 6, color: pct > 0 ? 'var(--color-up)' : pct < 0 ? 'var(--color-down-text)' : 'var(--color-text-muted)' }}>{fmtSignedPct(Math.round(pct))}</b>
                )}
              </>
            )}
          </span>
        </div>
        <div style={{ marginTop: 6 }}>
          <button className="ray-own-btn" data-on={owned} aria-pressed={owned} onClick={onOwn}>
            {owned ? 'Owned' : 'I won it'}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="ray-settled-cols ray-savedrow" style={{ display: 'grid' }}>
      <span className="maker">
        <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
          {ARTIST_LABEL[lot.artist] || lot.artist}
        </Link>
      </span>
      <span className="work">
        <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
          {craftTitle(lot.title)}
        </Link>
      </span>
      <span className="num">{formatEstimate(lot) || '—'}</span>
      <CallCell meta={meta} />
      <span className="num" style={{ fontWeight: 600 }}>
        {pending ? <span style={{ color: 'var(--color-text-faint)', fontWeight: 500 }}>pending</span> : formatPrice(lot.priceUsd!)}
      </span>
      <span className="num" style={pct != null ? { color: pct > 0 ? 'var(--color-up)' : pct < 0 ? 'var(--color-down-text)' : 'var(--color-text-muted)', fontWeight: 700 } : { color: 'var(--color-text-faint)' }}>
        {pct != null ? fmtSignedPct(Math.round(pct)) : '—'}
      </span>
      <span style={{ textAlign: 'right' }}>
        <button className="ray-own-btn" data-on={owned} aria-pressed={owned} onClick={onOwn}>
          {owned ? 'Owned' : 'I won it'}
        </button>
      </span>
    </div>
  );
}

export default function SavedPage() {
  const { allLots, lastCrawl, loading, fullLoaded, fullError, fromCache, market: marketData } = useFullLots();
  const { savedIds, savedMeta, toggle, isSaved, ownedIds, toggleOwned } = useSavedLots();
  const { authEnabled, user, authReady, savedReady, signInWithGoogle, signOut } = useAuth();
  const { unseen: unseenAlerts } = useAlerts();

  const [savedView, setSavedView] = useState<SavedView>('ledger');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const v = localStorage.getItem(SAVEDVIEW_KEY) ?? localStorage.getItem('ray-savedview');
      if (v === 'cards' || v === 'ledger') setSavedView(v);
    } catch { /* private mode */ }
  }, []);
  const pickView = (v: SavedView) => {
    setSavedView(v);
    try { localStorage.setItem(SAVEDVIEW_KEY, v); } catch { /* private mode */ }
  };
  // cards are a desktop opt-in; SSR + first client render agree on ledger-only
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
      const direct = byId.get(id);
      if (direct) return direct;
      const flipped = id.endsWith('~') ? id.slice(0, -1) : `${id}~`;
      const t = byId.get(flipped);
      if (t) return t;
      const fam = id.match(/^(wright|rago|lama)-(\d+)~?$/);
      if (fam) {
        for (const h of ['wright', 'rago', 'lama']) {
          if (h === fam[1]) continue;
          const hit = byId.get(`${h}-${fam[2]}`) ?? byId.get(`${h}-${fam[2]}~`);
          if (hit) return hit;
        }
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
  const ownedLotIds = useMemo(() => {
    const ownedSet = new Set(ownedIds);
    return new Set(savedLots.filter(l => ownedSet.has(savedIdByLotId.get(l.id) ?? l.id)).map(l => l.id));
  }, [ownedIds, savedLots, savedIdByLotId]);

  // sold-outcomes ledger — data + state lifted together (a fetch failure must
  // never be printed as "withdrawn by the house")
  const [ledgerState, setLedgerState] = useState<{ ledger: Map<string, LedgerEntry>; loaded: boolean; error: boolean }>({ ledger: new Map(), loaded: false, error: false });
  const { soldOrphans, goneOrphans } = useMemo(() => {
    const soldO: { id: string; priceUsd: number; saleDate: string; provisional: boolean }[] = [];
    const goneO: string[] = [];
    if (!ledgerState.loaded) return { soldOrphans: soldO, goneOrphans: goneO };
    for (const id of orphanIds) {
      const hit = ledgerState.ledger.get(id);
      if (hit) soldO.push({ id, priceUsd: hit[0], saleDate: hit[1], provisional: hit.length > 2 });
      else goneO.push(id);
    }
    soldO.sort((a, b) => (a.saleDate < b.saleDate ? 1 : -1));
    return { soldOrphans: soldO, goneOrphans: goneO };
  }, [orphanIds, ledgerState]);

  const badgeCount = fullLoaded ? savedLots.length : savedIds.length;

  const isPastPending = (l: AuctionLot) =>
    l.status === 'upcoming' && !!l.resultsPending && !!l.saleDate && l.saleDate.slice(0, 10) < localToday();

  const upcoming = useMemo(() =>
    savedLots
      .filter(l => l.status === 'upcoming' && !isPastPending(l))
      .sort((a, b) => new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime()),
    [savedLots]
  );
  const sold = useMemo(() =>
    savedLots
      .filter(l => l.status === 'sold' || isPastPending(l))
      .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime()),
    [savedLots]
  );
  const other = useMemo(() =>
    savedLots
      .filter(l => l.status !== 'upcoming' && l.status !== 'sold')
      .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime()),
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
  const collection = useMemo(() => {
    const rows = savedLots
      .filter(l => ownedLotIds.has(l.id))
      .map(l => {
        const paid = l.priceUsd || null;
        const appr = appraiseLot(l, allLots);
        const band = !appr && isSportsScienceObject(l) ? soldCompBand(l, allLots) : null;
        const appraised = appr?.value ?? band?.median ?? null;
        const basis = appr ? `${appr.n} comps` : band ? `${band.n} realized comps` : null;
        let refRange: string | null = null;
        if (appraised == null && fullLoaded) {
          const mkt = ARTIST_MARKET[l.artist];
          const rb = mkt === 'science' ? scienceReferenceBand(l, allLots)
            : mkt === 'culture' ? cultureReferenceBand(l, allLots) : null;
          if (rb) refRange = `reference ${formatPrice(rb.q1)}–${formatPrice(rb.q3)} · ${rb.n} sales`;
        }
        const deltaPct = paid && appraised ? Math.round((appraised / paid - 1) * 100) : null;
        const drill = drillRowFor(l, marketData);
        const drillRef = drillSlugFor(l);
        return { lot: l, paid, appraised, basis: basis ?? refRange, refOnly: !basis && !!refRange, deltaPct, drill, drillSlug: drillRef?.slug ?? null };
      })
      .sort((a, b) => (b.appraised ?? b.paid ?? 0) - (a.appraised ?? a.paid ?? 0));
    const totalPaid = rows.reduce((s, r) => s + (r.paid || 0), 0);
    const totalAppraised = rows.reduce((s, r) => s + (r.appraised ?? r.paid ?? 0), 0);
    const appraisedOfPaid = rows.reduce((s, r) => s + (r.paid != null ? (r.appraised ?? r.paid) : 0), 0);
    const deltaPct = totalPaid > 0 ? Math.round((appraisedOfPaid / totalPaid - 1) * 100) : null;
    return { rows, totalPaid, totalAppraised, deltaPct };
  }, [savedLots, ownedLotIds, allLots, fullLoaded, marketData]);

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

  /* ── collection history — one snapshot per LOCAL day; read the trail back ── */
  useEffect(() => {
    if (!supabase || !user || !fullLoaded || collection.rows.length === 0) return;
    const day = localToday(); // local day — the page's whole clock runs local
    const guardKey = `lectr-snap-${user.id.slice(0, 8)}`;
    const guardVal = `${day}:${Math.round(collection.totalPaid)}:${Math.round(collection.totalAppraised)}:${collection.rows.length}`;
    try { if (localStorage.getItem(guardKey) === guardVal) return; } catch { /* private mode */ }
    supabase.from('collection_snapshots').upsert({
      user_id: user.id, snap_date: day,
      total_paid: Math.round(collection.totalPaid),
      total_appraised: Math.round(collection.totalAppraised),
      pieces: collection.rows.length,
    }, { onConflict: 'user_id,snap_date' }).then(({ error }) => {
      if (!error) { try { localStorage.setItem(guardKey, guardVal); } catch { /* ignore */ } }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, fullLoaded, collection]);

  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  useEffect(() => {
    if (!supabase || !user) { setSnaps([]); return; }
    let dead = false;
    // MOST RECENT 180 days — ascending+limit returned the OLDEST 180, which
    // would freeze the chart in the past once a user out-lives the window
    supabase.from('collection_snapshots')
      .select('snap_date,total_paid,total_appraised,pieces')
      .eq('user_id', user.id)
      .order('snap_date', { ascending: false })
      .limit(180)
      .then(({ data, error }) => {
        if (dead || error || !data) return;
        const rows = data.map(r => ({ d: r.snap_date as string, paid: r.total_paid as number, appraised: r.total_appraised as number, pieces: r.pieces as number }));
        rows.reverse(); // chart reads oldest → newest
        setSnaps(rows);
      });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
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
  const summary = useMemo(() => {
    const withEst = upcoming.filter(l => (l.estimateLow || 0) > 0 || (l.estimateHigh || 0) > 0);
    const totalEst = withEst.reduce((s, l) => {
      const lo = l.estimateLow || l.estimateHigh || 0;
      const hi = l.estimateHigh || l.estimateLow || 0;
      return s + (lo + hi) / 2;
    }, 0);
    const flagged = upcoming.filter(l => signalById.get(l.id)?.label === 'Below Market').length;
    const todayIso = localToday();
    const next = upcoming.find(l => l.saleDate && l.saleDate.slice(0, 10) >= todayIso) || null;
    const closesToday = upcoming.filter(l => daysUntil(l.saleDate) === 0).length;
    return { totalEst, flagged, next, closesToday };
  }, [upcoming, signalById]);

  const changes = useMemo(() => {
    let moved = 0;
    let newBids = 0;
    for (const lot of upcoming) {
      const m = metaFor(lot.id);
      if (!m) continue;
      const cur = signalById.get(lot.id);
      const call = signalCallOf(m);
      if (call && cur) {
        const flipped = (call.dir === 'below' && cur.label !== 'Below Market') || (call.dir === 'above' && cur.label !== 'Above Market');
        if (flipped || Math.round(cur.pct) !== Math.round(call.pct)) moved++;
      }
      if (m.bidCount != null && (lot.bidCount || 0) > m.bidCount) newBids += (lot.bidCount || 0) - m.bidCount;
    }
    return { moved, newBids };
  }, [upcoming, metaFor, signalById]);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  /* ── THE ROOM — the watching ledger with the brief fused in: every row
     carries its reason tag and the ledger sorts action-first. ── */
  const room = useMemo(() => {
    type Reason = { tag: string; rank: number };
    const reasonOf = (l: AuctionLot): Reason | null => {
      const d = daysUntil(l.saleDate);
      const sig = signalById.get(l.id);
      if (d >= 0 && d <= 2) return { tag: 'Lands soon', rank: 0 };
      if (sig?.label === 'Below Market') return { tag: 'Below market', rank: 1 };
      if (l.bidVelocity && l.bidVelocity.delta > 0) return { tag: 'Most bids', rank: 2 };
      if (typeof l.bidCount === 'number' && (l.bidCount ?? 0) <= 3 && d >= 0 && d <= 7) {
        return { tag: 'Quiet', rank: 3 };
      }
      return null;
    };
    const rows = upcoming.map(l => ({ l, reason: reasonOf(l) }));
    rows.sort((a, b) => {
      const ra = a.reason?.rank ?? 9;
      const rb = b.reason?.rank ?? 9;
      if (ra !== rb) return ra - rb;
      if (ra === 0) return daysUntil(a.l.saleDate) - daysUntil(b.l.saleDate);
      if (ra === 1) {
        const sa = signalById.get(a.l.id);
        const sb = signalById.get(b.l.id);
        // the ONE flagged ranking — dealScore, never raw pct
        return dealScore(b.l, sb?.pct ?? 0) - dealScore(a.l, sa?.pct ?? 0);
      }
      if (ra === 2) return (b.l.bidVelocity?.delta ?? 0) - (a.l.bidVelocity?.delta ?? 0);
      return new Date(a.l.saleDate).getTime() - new Date(b.l.saleDate).getTime();
    });
    return rows;
  }, [upcoming, signalById]);

  /* ── THE RECORD — measured, receipts attached ── */
  const record = useMemo(() => {
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
    return { n: judged.length, realized, med, split };
  }, [sold, metaFor]);

  /* ── since your last visit ── */
  const [prevVisit, setPrevVisit] = useState<string | null | undefined>(undefined);
  const capturedVisit = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (capturedVisit.current !== undefined) return;
    try {
      capturedVisit.current = localStorage.getItem('lectr-lastvisit');
      localStorage.setItem('lectr-lastvisit', new Date().toISOString());
      setPrevVisit(capturedVisit.current);
    } catch { capturedVisit.current = null; setPrevVisit(null); }
  }, []);
  const sinceLast = useMemo(() => {
    if (!fullLoaded || !prevVisit) return null;
    const prevDay = prevVisit.slice(0, 10);
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
  const taste = useMemo(() => {
    // present tense earns present data: only LIVE watches shape "you watch X"
    const counts = new Map<string, number>();
    for (const l of upcoming) {
      const d = drillRowFor(l, marketData);
      if (d?.label) counts.set(d.label, (counts.get(d.label) || 0) + 1);
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
    () => sold.filter(l => l.status === 'sold' && !ownedLotIds.has(l.id)).length,
    [sold, ownedLotIds],
  );

  // cards view (desktop opt-in) needs the lot back from its id
  const lotById = useMemo(() => new Map(upcoming.concat(other).map(l => [l.id, l])), [upcoming, other]);
  const onCardToggle = useCallback((id: string) => {
    toggle(savedIdOf(id), lotById.get(id));
  }, [toggle, savedIdOf, lotById]);

  // phase-2 failed but SOME saves resolved eagerly — never silently thin the desk
  const partialLoadFailed = fullError && !fullLoaded && savedIds.length > 0;

  const deskKicker = givenName ? `${givenName}’s desk` : 'My desk';

  const emptyState = (
    <>
      <section className="rail ray-enter" style={{ paddingTop: 24 }}>
        <Masthead
          kicker={deskKicker}
          serial={lastCrawl || undefined}
          title={<>Your desk at <Accent>the auction</Accent>.</>}
          sub="Bookmark a lot anywhere on lectr and it tracks here to the hammer — comps, signals, your record once it settles, your collection when you win."
        />
        {/* the ghost desk — what this page becomes, before it has data */}
        <div className="ck-ghost ray-enter" aria-hidden>
          <div className="ck-ghost-row"><span className="kicker">Watching</span><span>your live lots · signals + bids tracked to the hammer</span></div>
          <div className="ck-ghost-row"><span className="kicker">Your record</span><span>every settled watch judged vs its estimate — your eye, measured</span></div>
          <div className="ck-ghost-row"><span className="kicker">Collection</span><span>the pieces you own, appraised against the live market nightly</span></div>
        </div>
        <div className="ray-enter" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: '26px 0 64px' }}>
          <Link href="/value" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Start with today&rsquo;s below-market lots
          </Link>
          <Link href="/" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Browse the markets
          </Link>
        </div>
      </section>
      <AlertsInbox />
    </>
  );

  return (
    <div className="terminal-shell" style={{ minHeight: '100vh', fontFamily: 'var(--font-sans), sans-serif' }}>
      <ArtistNav activeSlug="saved" savedCount={badgeCount} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {authEnabled && authReady && user && (
        <div className="rail" style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 14 }}>
          <button
            className="ray-call-btn ray-call-btn-quiet"
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12.5, padding: '4px 0', minHeight: 44 }}
            onClick={() => signOut()}
          >
            {user.email || 'account'} · Sign out
          </button>
        </div>
      )}

      {authEnabled && authReady && !user ? (
        <RayEntrance animate>
          <section className="rail ray-enter" style={{ paddingTop: 24 }}>
            <Masthead
              kicker="My desk"
              title={<>Your desk at <Accent>the auction</Accent>.</>}
              sub="Watch lots to the hammer, keep your track record, and hold your collection against the engine’s live appraisal. Private to you, synced everywhere."
            />
          </section>
          <div className="rail ray-enter" style={{ paddingBlock: '26px 72px' }}>
            <button className="ray-call-btn ray-call-btn-primary" style={{ border: 'none', cursor: 'pointer' }} onClick={() => signInWithGoogle()}>
              Sign in with Google
            </button>
            <p style={{ fontSize: 12.5, color: 'var(--color-text-faint)', margin: '14px 0 0' }}>
              Free · one tap · nothing else on lectr is gated.
            </p>
          </div>
        </RayEntrance>
      ) : loading || !authReady || !savedReady ? (
        <RayLoading />
      ) : savedLots.length === 0 && !fullLoaded && fullError ? (
        <RayEntrance animate={false}>
          <section className="rail" style={{ paddingBlock: 48, textAlign: 'center' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 14 }}>
              Couldn&apos;t load the full book to resolve your saved lots.
            </p>
            <button className="ray-call-btn ray-call-btn-primary" onClick={() => retryFullLoad()}>Try again</button>
          </section>
        </RayEntrance>
      ) : savedLots.length === 0 && !fullLoaded ? (
        savedIds.length === 0 ? (
          <RayEntrance animate={!fromCache}>{emptyState}</RayEntrance>
        ) : (
          <RayLoading />
        )
      ) : savedLots.length === 0 && orphanIds.length === 0 ? (
        <RayEntrance animate={!fromCache}>{emptyState}</RayEntrance>
      ) : (
        <RayEntrance animate={!fromCache}>
          <section className="rail ray-enter" style={{ paddingTop: 24 }}>
            <Masthead
              kicker={deskKicker}
              serial={lastCrawl || undefined}
              title={summary.totalEst > 0
                ? <>
                    Watching{' '}
                    <Accent>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        <CountUp to={summary.totalEst} format={formatPrice} duration={1100} animate={!fromCache} />
                      </span>
                    </Accent>{' '}
                    to the hammer.
                  </>
                : collection.rows.length > 0
                  ? <>Your desk: <Accent>{collection.rows.length} owned</Accent>, {sold.length + soldOrphans.length} settled.</>
                  : upcoming.length === 0 && savedLots.length === 0 && orphanIds.length > 0
                  ? <>Your desk: <Accent>{orphanIds.length} settled {orphanIds.length === 1 ? 'watch' : 'watches'}</Accent>, resolving results.</>
                  : <>
                      Watching <Accent>{upcoming.length || savedLots.length} {(upcoming.length || savedLots.length) === 1 ? 'lot' : 'lots'}</Accent> to the hammer.
                    </>}
              sub={
                <>
                  {summary.next && <>Next hammer {hammerWord(daysUntil(summary.next.saleDate))} · </>}
                  {upcoming.length} live {upcoming.length === 1 ? 'lot' : 'lots'}
                  {summary.flagged > 0 && (
                    <>
                      {' '}·{' '}
                      <b style={{ color: 'var(--color-up)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {summary.flagged} below market
                      </b>
                    </>
                  )}
                  {(changes.moved > 0 || changes.newBids > 0) && (
                    <>
                      {' '}· since you saved
                      {changes.moved > 0 && <> · {changes.moved} {changes.moved === 1 ? 'signal' : 'signals'} moved</>}
                      {changes.newBids > 0 && <> · {changes.newBids} new {changes.newBids === 1 ? 'bid' : 'bids'}</>}
                    </>
                  )}
                  {taste.length > 0 && <> · you watch {taste.join(' · ')}</>}
                  {tenure && <> · since {tenure}</>}
                </>
              }
            />

            {/* partial phase-2 failure — say so where the data would be */}
            {partialLoadFailed && (
              <div className="ck-warn ray-enter" role="status">
                Couldn&apos;t load the archive that resolves your concluded lots — settled results and appraisals are incomplete.{' '}
                <button className="ck-warn-btn" onClick={() => retryFullLoad()}>Try again</button>
              </div>
            )}

            {/* ── 1 · WHILE YOU WERE AWAY ── */}
            {(sinceLast || unseenAlerts > 0 || summary.closesToday > 0 || unclaimedWins > 0) && (
              <div className="ck-away ray-enter" role="status">
                <span className="kicker">While you were away</span>
                <span className="ck-away-line">
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
                    <>{(sinceLast || unseenAlerts > 0) ? ' · ' : ''}{summary.closesToday} {summary.closesToday === 1 ? 'lot closes' : 'lots close'} today</>
                  )}
                  {unclaimedWins > 0 && (
                    <>{(sinceLast || unseenAlerts > 0 || summary.closesToday > 0) ? ' · ' : ''}<a href="#settled" className="ck-away-link">{unclaimedWins} settled {unclaimedWins === 1 ? 'win' : 'wins'} unclaimed — won any?</a></>
                  )}
                </span>
                {sinceLast && <a href="#settled" className="ck-away-go">See what happened <Flick size={9} /></a>}
              </div>
            )}

            {/* ── 2 · THE GAUGE LINE — one fused band, no boxes ── */}
            {(collection.rows.length > 0 || record || unseenAlerts > 0) && (
              <div className="ck-gauge ray-enter">
                {collection.rows.length > 0 && (
                  <a href="#collection" className="ck-gauge-cell">
                    <span className="kicker">Collection</span>
                    <span className="ck-gauge-v">
                      {formatPrice(collection.totalAppraised)}
                      {collection.deltaPct != null && collection.deltaPct !== 0 && (
                        <em style={{ color: collection.deltaPct > 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>
                          {fmtSignedPct(collection.deltaPct)}
                        </em>
                      )}
                    </span>
                    <span className="ck-gauge-s">{collection.rows.length} {collection.rows.length === 1 ? 'piece' : 'pieces'} · appraised vs bought</span>
                  </a>
                )}
                {record && record.med != null && (
                  <a href="#record" className="ck-gauge-cell">
                    <span className="kicker">Your record</span>
                    <span className="ck-gauge-v" style={{ color: record.med > 0 ? 'var(--color-up)' : record.med < 0 ? 'var(--color-down-text)' : 'var(--color-fg)' }}>
                      {fmtSignedPct(Math.round(record.med))}
                    </span>
                    <span className="ck-gauge-s">{record.n} judged · vs estimate, median</span>
                  </a>
                )}
                {unseenAlerts > 0 && (
                  <a href="#inbox" className="ck-gauge-cell">
                    <span className="kicker">Inbox</span>
                    <span className="ck-gauge-v">{unseenAlerts}<em style={{ color: 'var(--color-up)' }}>new</em></span>
                    <span className="ck-gauge-s">nightly matches to your searches</span>
                  </a>
                )}
              </div>
            )}
          </section>

          {/* ══ 3 · WATCHING — the room, action-first, brief fused in ══ */}
          {upcoming.length > 0 && (
            <section className="ray-saved-section rail" data-view={savedView}>
              <div className="ray-enter" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px 14px', flexWrap: 'wrap', marginBottom: 16 }}>
                <h2 className="ray-h2" style={{ margin: 0 }}>Watching · on the block</h2>
                <div className="ray-savedview-toggle" role="group" aria-label="Watching view">
                  <button className="ray-savedview-btn" data-active={savedView === 'ledger'} aria-pressed={savedView === 'ledger'} onClick={() => pickView('ledger')}>Ledger</button>
                  <button className="ray-savedview-btn" data-active={savedView === 'cards'} aria-pressed={savedView === 'cards'} onClick={() => pickView('cards')}>Cards</button>
                </div>
              </div>

              {/* desktop ledger */}
              <div className="ray-saved-ledger ray-enter">
                <div className="ray-saved-cols ray-saved-ledger-head" aria-hidden>
                  <span className="kicker">Why now</span>
                  <span className="kicker">Work</span>
                  <span className="kicker r">Est</span>
                  <span className="kicker r">Signal now</span>
                  <span className="kicker r">Δ saved</span>
                  <span className="kicker r">Hammers</span>
                </div>
                {room.map(({ l: lot, reason }) => {
                  const sig = signalById.get(lot.id) ?? null;
                  const m = metaFor(lot.id);
                  const call = signalCallOf(m);
                  const sameAxis = call && sig && call.dir !== 'unknown' &&
                    ((call.dir === 'below') === (sig.label === 'Below Market'));
                  const dPP = sameAxis && sig ? Math.round(sig.pct) - Math.round(call!.pct) : null;
                  const flipped = call && sig && call.dir !== 'unknown' && !sameAxis;
                  const newBids = m?.bidCount != null && (lot.bidCount || 0) > m.bidCount
                    ? (lot.bidCount || 0) - m.bidCount : 0;
                  const days = daysUntil(lot.saleDate);
                  const vel = lot.bidVelocity && lot.bidVelocity.delta > 0 ? lot.bidVelocity : null;
                  // Δ ink: on the below axis deeper (+) is the deal deepening;
                  // on the above axis deeper (+) is it worsening
                  const dInk = dPP == null || dPP === 0 ? 'var(--color-text-faint)'
                    : (call!.dir === 'below' ? dPP > 0 : dPP < 0) ? 'var(--color-up)' : 'var(--color-down-text)';
                  return (
                    <Link key={lot.id} href={`/lot?id=${encodeURIComponent(lot.id)}`} className="ray-saved-cols ray-savedrow">
                      <span className="ck-why">
                        {reason && <span className="ck-tag" data-tone={reason.tag === 'Below market' ? 'up' : reason.tag === 'Lands soon' ? 'hot' : undefined}>{reason.tag}</span>}
                      </span>
                      <span className="work">
                        <span className="ck-workmaker">{ARTIST_LABEL[lot.artist] || lot.artist}</span>
                        {craftTitle(lot.title)}
                      </span>
                      <span className="num">{formatEstimate(lot) || '—'}</span>
                      <span className="num" style={sig ? { color: sigInk(sig.label), fontWeight: 700 } : { color: 'var(--color-text-faint)' }}>
                        {sig ? sigText(sig) : '—'}
                      </span>
                      <span className="num" style={{ color: flipped ? 'var(--color-text-muted)' : dInk }}>
                        {flipped ? 'flipped' : dPP != null && dPP !== 0 ? `${dPP > 0 ? '+' : '−'}${Math.abs(dPP)}pp` : '—'}
                        {vel ? (
                          <span className="sub">+{vel.delta} bids/{Math.round(vel.hours)}h</span>
                        ) : newBids > 0 ? (
                          <span className="sub">+{newBids} {newBids === 1 ? 'bid' : 'bids'}</span>
                        ) : null}
                      </span>
                      <span style={{ textAlign: 'right', fontSize: 13, color: days === 0 ? 'var(--color-fg)' : 'var(--color-text-secondary)', fontWeight: days <= 1 ? 600 : 500, whiteSpace: 'nowrap' }}>
                        {hammerWord(days)}
                      </span>
                    </Link>
                  );
                })}
              </div>

              {/* mobile: the glance rows — same facts, thumb scale */}
              <div className="ck-mledger ray-enter">
                {room.map(({ l: lot, reason }) => {
                  const sig = signalById.get(lot.id) ?? null;
                  const days = daysUntil(lot.saleDate);
                  return (
                    <Link key={lot.id} href={`/lot?id=${encodeURIComponent(lot.id)}`} className="ck-mrow">
                      <span className="ck-mrow-main">
                        <span className="ck-mtitle">{craftTitle(lot.title)}</span>
                        <span className="ck-msub">
                          {reason && <span className="ck-tag" data-tone={reason.tag === 'Below market' ? 'up' : reason.tag === 'Lands soon' ? 'hot' : undefined}>{reason.tag}</span>}
                          {ARTIST_LABEL[lot.artist] || lot.artist}
                          {formatEstimate(lot) ? <> · {formatEstimate(lot)}</> : null}
                        </span>
                      </span>
                      <span className="ck-mrow-right">
                        {sig && <b style={{ color: sigInk(sig.label) }}>{sigText(sig)}</b>}
                        <span className="ck-mham" style={days <= 1 ? { color: 'var(--color-fg)', fontWeight: 600 } : undefined}>{hammerWord(days)}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>

              {/* cards — desktop opt-in only; mounted only when shown */}
              {savedView === 'cards' && isDesktop === true && (
                <div className="ray-saved-grid">
                  {room.map(({ l: lot }, i) => (
                    <div key={lot.id} className="ray-enter-card" style={{ '--enter-delay': `${Math.min(i, 8) * 60}ms` } as React.CSSProperties}>
                      <LotCard lot={lot} showArtist allLots={allLots} saved={isSaved(savedIdOf(lot.id)) || isSaved(lot.id)} onToggleSave={onCardToggle} />
                      <SavedDelta lot={lot} meta={metaFor(lot.id)} sig={signalById.get(lot.id) ?? null} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* the inbox rides directly under the room — new matches are watch-adjacent */}
          <div id="inbox"><AlertsInbox /></div>

          {/* ══ 4 · THE RECORD — the receipt, at display scale ══ */}
          {record && record.med != null && (
            <section id="record" className="rail ray-enter" style={{ paddingBlock: '38px 10px' }}>
              <div className="ck-record">
                <div className="ck-record-lead">
                  <span className="kicker">Your record</span>
                  <span className="ck-record-fig" style={{ color: record.med > 0 ? 'var(--color-up)' : record.med < 0 ? 'var(--color-down-text)' : 'var(--color-fg)' }}>
                    {fmtSignedPct(Math.round(record.med))}
                  </span>
                  <span className="ck-record-s">
                    {record.n} {record.n === 1 ? 'watch' : 'watches'} judged vs estimate · median, all-in · {formatPrice(record.realized)} realized ·{' '}
                    <a href="#settled" className="ck-away-link">receipts below</a>
                  </span>
                </div>
                {record.split ? (
                  <div className="ck-record-split">
                    <span className="kicker">Flagged vs the rest</span>
                    <span className="ck-record-splitline">
                      saved while flagged below market{' '}
                      <b style={{ color: (record.split.flagged ?? 0) > 0 ? 'var(--color-up)' : (record.split.flagged ?? 0) < 0 ? 'var(--color-down-text)' : 'var(--color-fg)' }}>{fmtSignedPct(Math.round(record.split.flagged ?? 0))}</b>{' '}
                      ({record.split.flaggedN}) · saved while showing above market{' '}
                      <b style={{ color: (record.split.rest ?? 0) > 0 ? 'var(--color-up)' : (record.split.rest ?? 0) < 0 ? 'var(--color-down-text)' : 'var(--color-fg)' }}>{fmtSignedPct(Math.round(record.split.rest ?? 0))}</b>{' '}
                      ({record.split.restN}) — vs estimate, all-in
                    </span>
                  </div>
                ) : (
                  <div className="ck-record-split">
                    <span className="kicker">Flagged vs the rest</span>
                    <span className="ck-record-splitline" style={{ color: 'var(--color-text-muted)' }}>
                      publishes once 3 watches saved while flagged below market and 3 saved while showing above settle — saves with no live signal at save time count toward neither; direction recorded since Aug&nbsp;2026
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ══ 5 · COLLECTION — the certificate for what you own ══ */}
          {collection.rows.length > 0 && (
            <div id="collection" className="ray-band ray-enter" style={{ marginTop: 30, paddingBlock: '28px 30px' }}>
              <section className="rail" aria-label="Your collection">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 14px', marginBottom: 6 }}>
                  <h2 className="ray-h2" style={{ margin: 0 }}>Your collection</h2>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                    {collection.rows.length} {collection.rows.length === 1 ? 'piece' : 'pieces'}
                    {collection.totalPaid > 0 && (
                      <>{' '}· bought <b style={{ color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(collection.totalPaid)}</b></>
                    )}
                    {' '}· lectr appraisal <b style={{ color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(collection.totalAppraised)}</b>
                    {collection.deltaPct != null && collection.deltaPct !== 0 && (
                      <b style={{ color: collection.deltaPct > 0 ? 'var(--color-up)' : 'var(--color-down-text)', fontVariantNumeric: 'tabular-nums' }}>
                        {' '}· {fmtSignedPct(collection.deltaPct)}
                      </b>
                    )}
                  </span>
                </div>

                {collectionChart && (
                  <div style={{ margin: '18px 0 8px' }}>
                    <div className="kicker" style={{ marginBottom: 4, color: 'var(--paper-muted, var(--color-text-muted))' }}>
                      Your collection over time · appraisal vs bought · daily snapshots
                    </div>
                    <HeroChart anchor={collectionChart.anchor} layers={collectionChart.layers} height={150} compact play={false} />
                  </div>
                )}

                {exposure.length > 0 && (
                  <div style={{ margin: '18px 0 4px' }}>
                    <div className="kicker" style={{ padding: '0 0 2px', color: 'var(--paper-muted, var(--color-text-muted))' }}>
                      Where it trades · the market&rsquo;s move, not your pieces&rsquo;
                    </div>
                    {exposure.map(({ row, n, held }) => {
                      const read = row.readType === 'index' && row.index
                        ? (() => { const r = Math.round(row.index!.changePct); return { txt: `${fmtSignedPct(r)} ${row.index!.horizon} verified`, dir: r > 0 ? 'up' : r < 0 ? 'down' : 'flat' }; })()
                        : row.readType === 'demand' && row.demandNow != null
                          ? (() => { const r = Math.round(row.demandNow!); return { txt: `${fmtSignedPct(r)} vs estimate`, dir: r > 0 ? 'up' : r < 0 ? 'down' : 'flat' }; })()
                          : null;
                      return (
                        <Link key={row.slug} href={`/sub/${row.slug.replace(':', '/')}`} className="ray-coll-exposure-row">
                          <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.label} <Flick size={9} style={{ marginLeft: 2 }} />
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {n} {n === 1 ? 'piece' : 'pieces'} · {formatPrice(held)} held
                          </span>
                          <span style={{ width: 150, textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontFamily: read ? 'var(--font-mono), monospace' : undefined, color: read ? (read.dir === 'up' ? 'var(--color-up)' : read.dir === 'down' ? 'var(--color-down-text)' : 'var(--color-fg)') : 'var(--color-text-faint)' }}>
                            {read ? read.txt : `${row.lots.toLocaleString()} lots tracked`}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}

                <div className="kicker" style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '14px 0 6px', color: 'var(--paper-muted, var(--color-text-muted))' }}>
                  <div style={{ flex: 1 }}>Piece</div>
                  <div style={{ width: 92, textAlign: 'right' }}>Bought</div>
                  <div style={{ width: 128, textAlign: 'right' }}>lectr appraisal</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {collection.rows.map(({ lot, paid, appraised, basis, deltaPct, drill, drillSlug }) => (
                    <div key={lot.id} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '10px 0', borderTop: '1px solid var(--hairline)' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                          <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{craftTitle(lot.title)}</div>
                        </Link>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                          <span>{ARTIST_LABEL[lot.artist] || lot.artist} · {lot.auctionHouse}{lot.saleDate ? ` · ${formatDate(lot.saleDate)}` : ''}</span>
                          {drill && drillSlug && (
                            <Link href={`/sub/${drillSlug.replace(':', '/')}`} className="ray-coll-chip">{drill.label}</Link>
                          )}
                        </div>
                      </div>
                      <div style={{ width: 92, textAlign: 'right', flexShrink: 0, fontSize: 14.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {paid != null ? formatPrice(paid) : '—'}
                      </div>
                      <div style={{ width: 128, textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {appraised != null ? formatPrice(appraised) : '—'}
                          {deltaPct != null && deltaPct !== 0 && (
                            <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 600, color: deltaPct > 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>
                              {deltaPct > 0 ? '+' : '−'}{Math.abs(deltaPct)}%
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          {basis ?? (fullLoaded ? 'no comps yet' : fullError ? 'couldn’t load comps' : 'appraising…')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', margin: '14px 0 0' }}>
                  The lectr appraisal is the median its comparable sales currently trade at — our read from the data,
                  not a formal appraisal. Pieces without a usable comp pool carry at their bought price in the total;
                  a reference range is context only and never enters a number. The headline &plusmn;% compares
                  only pieces with a recorded bought price.
                </p>
              </section>
            </div>
          )}

          {/* ══ 6 · SETTLED — the line-item receipts ══ */}
          {(sold.length > 0 || soldOrphans.length > 0) && (
            <section id="settled" className="ray-saved-section rail ray-enter" style={{ '--enter-delay': '90ms' } as React.CSSProperties}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px 14px', flexWrap: 'wrap', marginBottom: 4 }}>
                <h2 className="ray-h2" style={{ margin: 0 }}>Settled</h2>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {sold.length + soldOrphans.length} settled {sold.length + soldOrphans.length === 1 ? 'watch' : 'watches'}
                  {record && <> · {record.n} judged vs estimate</>}
                </span>
              </div>
              {unclaimedWins > 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '0 0 14px' }}>
                  Won any of these? Mark it <b style={{ color: 'var(--color-fg)' }}>I won it</b> and the piece joins your collection, appraised against the live market.
                </p>
              )}

              <div className="ray-settled-desk" style={{ marginTop: 12 }}>
                <div className="ray-settled-cols kicker" aria-hidden style={{ padding: '0 2px 8px' }}>
                  <span>Maker</span>
                  <span>Work</span>
                  <span style={{ textAlign: 'right' }}>Est</span>
                  <span style={{ textAlign: 'right' }}>Your call</span>
                  <span style={{ textAlign: 'right' }}>Realized</span>
                  <span style={{ textAlign: 'right' }}>vs est</span>
                  <span style={{ textAlign: 'right' }}>Own it</span>
                </div>
                {settledRows.map(row => {
                  const key = row.kind === 'lot' ? row.lot.id : row.o.id;
                  const meta = row.kind === 'lot' ? metaFor(row.lot.id) : savedMeta[row.o.id];
                  return (
                    <SettledRowView
                      key={key}
                      row={row}
                      meta={meta}
                      owned={row.kind === 'lot' ? ownedLotIds.has(row.lot.id) : false}
                      onOwn={() => row.kind === 'lot' && toggleOwned(savedIdOf(row.lot.id))}
                      onRemove={() => toggle(row.kind === 'lot' ? savedIdOf(row.lot.id) : row.o.id)}
                      mobile={false}
                    />
                  );
                })}
              </div>
              <div className="ray-settled-mobile">
                {settledRows.map(row => {
                  const key = row.kind === 'lot' ? row.lot.id : row.o.id;
                  const meta = row.kind === 'lot' ? metaFor(row.lot.id) : savedMeta[row.o.id];
                  return (
                    <SettledRowView
                      key={key}
                      row={row}
                      meta={meta}
                      owned={row.kind === 'lot' ? ownedLotIds.has(row.lot.id) : false}
                      onOwn={() => row.kind === 'lot' && toggleOwned(savedIdOf(row.lot.id))}
                      onRemove={() => toggle(row.kind === 'lot' ? savedIdOf(row.lot.id) : row.o.id)}
                      mobile
                    />
                  );
                })}
              </div>
            </section>
          )}

          {other.length > 0 && (
            <section className="ray-saved-section rail">
              <h2 className="ray-h2 ray-enter" style={{ marginBottom: 6 }}>Concluded &amp; other</h2>
              <p className="ray-enter" style={{ fontSize: 13, color: 'var(--color-text-faint)', margin: '0 0 18px' }}>
                Saved lots that closed without a published hammer, were bought in, or are awaiting results.
              </p>
              <div className="ray-saved-grid" style={{ display: 'grid' }}>
                {other.map((lot, i) => (
                  <div key={lot.id} className="ray-enter-card" style={{ '--enter-delay': `${Math.min(i, 8) * 60}ms` } as React.CSSProperties}>
                    <LotCard lot={lot} showArtist allLots={allLots} saved={isSaved(savedIdOf(lot.id)) || isSaved(lot.id)} onToggleSave={onCardToggle} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* on-demand: only fetch the ledger when there are orphans to resolve */}
          {orphanIds.length > 0 && <LedgerGate onState={setLedgerState} />}

          {/* orphans render ONLY once the outcomes ledger has loaded — a fetch
              in flight (or failed) is never printed as "withdrawn" */}
          {orphanIds.length > 0 && !ledgerState.loaded && !ledgerState.error && (
            <section className="rail ray-enter" style={{ paddingBlock: '20px 8px' }}>
              <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: 0 }}>
                Resolving results for {orphanIds.length} settled {orphanIds.length === 1 ? 'watch' : 'watches'}&hellip;
              </p>
            </section>
          )}
          {orphanIds.length > 0 && ledgerState.error && !ledgerState.loaded && (
            <section className="rail ray-enter" style={{ paddingBlock: '30px 40px' }}>
              <div className="ck-warn" role="status">
                Couldn&apos;t check outcomes for {orphanIds.length} saved {orphanIds.length === 1 ? 'lot' : 'lots'} — the results ledger didn&apos;t load.{' '}
                <button className="ck-warn-btn" onClick={() => retrySoldLedger()}>Try again</button>
              </div>
            </section>
          )}
          {goneOrphans.length > 0 && (
            <section className="rail ray-enter" style={{ paddingBlock: '34px 64px' }}>
              <h2 className="ray-h2" style={{ marginBottom: 6 }}>No longer on the block</h2>
              <p style={{ fontSize: 13, color: 'var(--color-text-faint)', margin: '0 0 14px' }}>
                Saved lots the crawl no longer carries — withdrawn, relisted or purged by the house.
              </p>
              <div className="glass glass-quiet">
                {goneOrphans.map(id => {
                  const m = savedMeta[id];
                  return (
                    <div key={id} className="ray-saved-orphan">
                      <span>
                        {m?.title ? (
                          <>
                            <span style={{ color: 'var(--color-fg)', fontWeight: 600 }}>
                              was: {m.title}
                              {m.artist && <>, {ARTIST_LABEL[m.artist] || m.artist}</>}
                            </span>
                            <span style={{ color: 'var(--color-text-faint)' }}>
                              {m.estMid != null && <> · est. {formatPrice(m.estMid)}</>}
                              {' '}· saved {formatDate(m.savedAt)}
                            </span>
                          </>
                        ) : (
                          <>
                            No longer listed — removed from the block
                            {m && (
                              <span style={{ color: 'var(--color-text-faint)' }}>
                                {' '}· saved {formatDate(m.savedAt)}
                                {m.estMid != null && <> · was est. {formatPrice(m.estMid)}</>}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                      <button className="ray-call-btn ray-call-btn-quiet" style={{ flexShrink: 0 }} onClick={() => toggle(id)}>
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </RayEntrance>
      )}
      <Colophon record={null} />
    </div>
  );
}
