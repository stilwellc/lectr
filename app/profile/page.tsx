'use client';

import React, { useMemo, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import { useFullLots, useSoldLedger, type LedgerEntry } from '../hooks/useRayData';
import { useSavedLots, SavedMeta } from '../hooks/useSavedLots';
import { useAuth } from '../lib/account';
import { supabase } from '../lib/supabase';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';
import LotCard, { lotSignal, formatEstimate } from '../components/LotCard';
import { appraiseLot, soldCompBand, isSportsScienceObject, scienceReferenceBand, cultureReferenceBand } from '../lib/comps';
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
   MY PROFILE — the collector's data center. Three ledgers, one
   desk: WATCHING (live saved lots, tracked to the hammer),
   SETTLED (what happened to the lots you watched — your track
   record, measured), and COLLECTION (the lots you own — engine-
   appraised, charted over time, placed in their sub-markets).

   Honesty rules hold everywhere: green/red only on measured
   deltas; reference bands render as labeled ranges and never
   enter a total; a market read on your holdings is the MARKET's
   move, labeled as such — never dressed as your appreciation.
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

/** What changed on a watched lot since the save (card view). */
function SavedDelta({ lot, meta, allLots }: { lot: AuctionLot; meta?: SavedMeta; allLots: AuctionLot[] }) {
  const cur = lotSignal(lot, allLots);
  const signalMoved =
    meta?.signalPct != null && cur !== null && Math.round(cur.pct) !== Math.round(meta.signalPct);
  const newBids =
    meta?.bidCount != null && (lot.bidCount || 0) > meta.bidCount
      ? (lot.bidCount || 0) - meta.bidCount
      : 0;
  if (!signalMoved && newBids === 0) return null;
  return (
    <p className="ray-saved-delta">
      {signalMoved && cur && meta && (
        <span>
          signal {fmtSignedPct(meta.signalPct!)} <Flick size={10} style={{ marginLeft: 0 }} />{' '}
          <b style={{ color: cur.pct > meta.signalPct! ? 'var(--color-up)' : 'var(--color-down-text)', fontWeight: 700 }}>
            {fmtSignedPct(cur.pct)}
          </b>{' '}
          since you saved
        </span>
      )}
      {signalMoved && newBids > 0 && ' · '}
      {newBids > 0 && <span>{newBids} new {newBids === 1 ? 'bid' : 'bids'}</span>}
    </p>
  );
}

type SavedView = 'ledger' | 'cards';
const SAVEDVIEW_KEY = 'ray-savedview';

interface Snapshot { d: string; paid: number; appraised: number; pieces: number }

// Loads the on-demand sold-outcomes ledger (24-mo id→[price,date]) and lifts it
// to the page. Rendered ONLY when there are orphan saved lots, so a user with
// no orphans never pays the fetch.
function LedgerGate({ onLedger }: { onLedger: (m: Map<string, LedgerEntry>) => void }) {
  const { ledger } = useSoldLedger();
  useEffect(() => { onLedger(ledger); }, [ledger, onLedger]);
  return null;
}

export default function SavedPage() {
  // useFullLots: saved lots may have rolled off upcoming into the corpus, and
  // the collection valuation gates on fullLoaded — trigger phase 2. market
  // carries the drills (sub-market reads) for the exposure block.
  const { allLots, lastCrawl, loading, fullLoaded, fromCache, market: marketData } = useFullLots();
  const { savedIds, savedMeta, toggle, isSaved, ownedIds, toggleOwned } = useSavedLots();
  const { authEnabled, user, authReady, savedReady, signInWithGoogle, signOut } = useAuth();

  const [savedView, setSavedView] = useState<SavedView>('ledger');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const v = localStorage.getItem(SAVEDVIEW_KEY);
      if (v === 'cards' || v === 'ledger') setSavedView(v);
    } catch { /* private mode */ }
  }, []);
  const pickView = (v: SavedView) => {
    setSavedView(v);
    try { localStorage.setItem(SAVEDVIEW_KEY, v); } catch { /* private mode */ }
  };

  const savedLots = useMemo(() =>
    savedIds
      .map(id => allLots.find(l => l.id === id))
      .filter(Boolean) as typeof allLots,
    [savedIds, allLots]
  );

  const orphanIds = useMemo(() => {
    if (!fullLoaded) return [] as string[];
    const have = new Set(allLots.map(l => l.id));
    return savedIds.filter(id => !have.has(id));
  }, [savedIds, allLots, fullLoaded]);

  // Resolve orphans against the sold-outcomes ledger (loaded on-demand by
  // LedgerGate below): a Goldin lot that sold into the archive / corpus-only
  // tier isn't shipped as a full row, but its hammer result is in the ledger.
  // Split into genuinely-sold (show price + date) vs truly gone (withdrawn).
  const [ledger, setLedger] = useState<Map<string, LedgerEntry>>(new Map());
  const { soldOrphans, goneOrphans } = useMemo(() => {
    const soldO: { id: string; priceUsd: number; saleDate: string; provisional: boolean }[] = [];
    const goneO: string[] = [];
    for (const id of orphanIds) {
      const hit = ledger.get(id);
      if (hit) soldO.push({ id, priceUsd: hit[0], saleDate: hit[1], provisional: hit.length > 2 });
      else goneO.push(id);
    }
    soldO.sort((a, b) => (a.saleDate < b.saleDate ? 1 : -1));
    return { soldOrphans: soldO, goneOrphans: goneO };
  }, [orphanIds, ledger]);

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

  /* ── COLLECTION — engine-appraised, with reference-band context where the
     engine abstains. A reference RANGE is context only: it NEVER enters the
     total (un-appraisable pieces carry at their bought price). ── */
  const collection = useMemo(() => {
    const ownedSet = new Set(ownedIds);
    const rows = savedLots
      .filter(l => ownedSet.has(l.id))
      .map(l => {
        const paid = l.priceUsd || null;
        const appr = appraiseLot(l, allLots);
        const band = !appr && isSportsScienceObject(l) ? soldCompBand(l, allLots) : null;
        const appraised = appr?.value ?? band?.median ?? null;
        let basis = appr ? `${appr.n} comps` : band ? `${band.n} realized comps` : null;
        // reference-band context for science/culture pieces the engine won't
        // point-value — a labeled RANGE, never a number in the total
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
    // the headline % compares like with like: only pieces WITH a bought price
    // count toward it (appraised, or carried at bought). A piece with no
    // recorded price still shows in the appraisal total, but it can never
    // claim appreciation over a bought sum it isn't part of.
    const appraisedOfPaid = rows.reduce((s, r) => s + (r.paid != null ? (r.appraised ?? r.paid) : 0), 0);
    const deltaPct = totalPaid > 0 ? Math.round((appraisedOfPaid / totalPaid - 1) * 100) : null;
    return { rows, totalPaid, totalAppraised, deltaPct };
  }, [savedLots, ownedIds, allLots, fullLoaded, marketData]);

  /* ── SUB-MARKET EXPOSURE — where the collection trades. Each row is the
     MARKET's read (index/demand), labeled as the market's move — never the
     pieces' own appreciation. ── */
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

  /* ── COLLECTION HISTORY — write one snapshot per day (existing behavior),
     and READ the trail back for the over-time chart. ── */
  useEffect(() => {
    if (!supabase || !user || !fullLoaded || collection.rows.length === 0) return;
    const day = new Date().toISOString().slice(0, 10);
    const guardKey = `lectr-snap-${user.id.slice(0, 8)}`;
    try { if (localStorage.getItem(guardKey) === day) return; } catch { /* private mode */ }
    supabase.from('collection_snapshots').upsert({
      user_id: user.id, snap_date: day,
      total_paid: Math.round(collection.totalPaid),
      total_appraised: Math.round(collection.totalAppraised),
      pieces: collection.rows.length,
    }, { onConflict: 'user_id,snap_date' }).then(({ error }) => {
      if (!error) { try { localStorage.setItem(guardKey, day); } catch { /* ignore */ } }
    });
    // user?.id, not the user object: Supabase mints a fresh user object on
    // every auth event — an object dep re-fires the write chain needlessly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, fullLoaded, collection]);

  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  useEffect(() => {
    if (!supabase || !user) { setSnaps([]); return; }
    let dead = false;
    supabase.from('collection_snapshots')
      .select('snap_date,total_paid,total_appraised,pieces')
      .eq('user_id', user.id)
      .order('snap_date', { ascending: true })
      .limit(180)
      .then(({ data, error }) => {
        if (dead || error || !data) return;
        setSnaps(data.map(r => ({ d: r.snap_date as string, paid: r.total_paid as number, appraised: r.total_appraised as number, pieces: r.pieces as number })));
      });
    return () => { dead = true; };
    // user?.id, not the user object — see the snapshot write above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  // the chart needs a real trail — 3+ days of snapshots, else nothing renders
  const collectionChart = useMemo(() => {
    if (snaps.length < 3) return null;
    return {
      anchor: {
        key: '_appr', label: 'lectr appraisal', color: '', unit: 'money' as const,
        points: snaps.map(s => ({ period: s.d, value: s.appraised, n: s.pieces })),
      },
      layers: [{
        key: 'paid', label: 'Bought', color: '#8F9BA8', unit: 'money' as const,
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
    const flagged = upcoming.filter(l => {
      const sig = lotSignal(l, allLots);
      return sig && sig.label === 'Below Market';
    }).length;
    const todayIso = localToday();
    const next = upcoming.find(l => l.saleDate && l.saleDate.slice(0, 10) >= todayIso) || null;
    return { totalEst, flagged, next };
  }, [upcoming, allLots]);

  const changes = useMemo(() => {
    let moved = 0;
    let newBids = 0;
    for (const lot of upcoming) {
      const m = savedMeta[lot.id];
      if (!m) continue;
      const cur = lotSignal(lot, allLots);
      if (m.signalPct != null && cur !== null && Math.round(cur.pct) !== Math.round(m.signalPct)) moved++;
      if (m.bidCount != null && (lot.bidCount || 0) > m.bidCount) newBids += (lot.bidCount || 0) - m.bidCount;
    }
    return { moved, newBids };
  }, [upcoming, savedMeta, allLots]);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  /* ── THE BRIEF — the desk's TLDR. Four reads over the watching ledger, each row
     rendered only when its data genuinely exists: hottest day-over-day
     bidding (crawl-measured velocity), lots landing within 48h, lots with
     DIRECT comps (same card & grade, or same edition), and the deepest
     below-market signals. Facts only — nothing is ranked by opinion. ── */
  const brief = useMemo(() => {
    type Row = { key: string; tag: string; lot: AuctionLot; fact: React.ReactNode; tone?: 'up' };
    const rows: Row[] = [];
    // hottest bidding — day-over-day bids added, velocity-measured
    const hot = upcoming
      .filter(l => l.bidVelocity && l.bidVelocity.delta > 0)
      .sort((a, b) => (b.bidVelocity!.delta) - (a.bidVelocity!.delta))
      .slice(0, 2);
    for (const l of hot) {
      const v = l.bidVelocity!;
      rows.push({
        key: `hot-${l.id}`, tag: 'Most bids', lot: l,
        fact: <>+{v.delta} {v.delta === 1 ? 'bid' : 'bids'} in {Math.round(v.hours)}h{v.pctile != null && <> · faster than {v.pctile}% of live lots</>}</>,
      });
    }
    // quietest — the sleeper read, the opposite of most bids: landing THIS
    // WEEK with a PUBLISHED bid count near zero (bid platforms close weekly,
    // so a 72h window would sit empty most days). Only bid-platform lots
    // qualify — an absent bidCount is absent data, never "no interest".
    const quiet = upcoming
      .filter(l => typeof l.bidCount === 'number' && (l.bidCount ?? 0) <= 3)
      .filter(l => !hot.includes(l))
      .filter(l => { const d = daysUntil(l.saleDate); return d >= 0 && d <= 7; })
      .sort((a, b) => (a.bidCount ?? 0) - (b.bidCount ?? 0) || daysUntil(a.saleDate) - daysUntil(b.saleDate))
      .slice(0, 2);
    for (const l of quiet) {
      const d = daysUntil(l.saleDate);
      rows.push({
        key: `q-${l.id}`, tag: 'Quietest', lot: l,
        fact: <>{(l.bidCount ?? 0) === 0 ? 'no bids yet' : `only ${l.bidCount} ${l.bidCount === 1 ? 'bid' : 'bids'}`} · hammers {d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}{(l.currentBid || 0) > 0 ? <> · at {formatPrice(l.currentBid!)}</> : null}</>,
      });
    }
    // lands soon — hammering within 48h
    const soon = upcoming
      .filter(l => { const d = daysUntil(l.saleDate); return d >= 0 && d <= 2; })
      .slice(0, 3);
    for (const l of soon) {
      const d = daysUntil(l.saleDate);
      rows.push({
        key: `soon-${l.id}`, tag: 'Lands soon', lot: l,
        fact: <>hammers {d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}{formatEstimate(l) ? <> · {formatEstimate(l)}</> : null}{typeof l.bidCount === 'number' && l.bidCount > 0 ? <> · {l.bidCount} bids</> : null}</>,
      });
    }
    // direct comps — exact card & grade first, then same-edition pools
    if (fullLoaded) {
      const direct: Row[] = [];
      for (const l of upcoming) {
        if (l.cardComps && l.cardComps.n > 0 && l.cardComps.med != null) {
          direct.push({
            key: `dc-${l.id}`, tag: 'Direct comps', lot: l,
            fact: <>{l.cardComps.n} {l.cardComps.n === 1 ? 'sale' : 'sales'}, same card &amp; grade · {formatPrice(l.cardComps.med)} median</>,
          });
        } else {
          const a = appraiseLot(l, allLots);
          if (a && a.kind === 'edition' && a.n >= 3) {
            direct.push({
              key: `dc-${l.id}`, tag: 'Direct comps', lot: l,
              fact: <>{a.n} same-edition comps · {formatPrice(a.value)} median</>,
            });
          }
        }
        if (direct.length >= 2) break;
      }
      rows.push(...direct);
    }
    // deepest below-market signals
    const under = upcoming
      .map(l => ({ l, sig: lotSignal(l, allLots) }))
      .filter((x): x is { l: AuctionLot; sig: NonNullable<ReturnType<typeof lotSignal>> } => !!x.sig && x.sig.label === 'Below Market')
      .sort((a, b) => a.sig.pct - b.sig.pct)
      .slice(0, 2);
    for (const { l, sig } of under) {
      rows.push({
        key: `bm-${l.id}`, tag: 'Below market', lot: l, tone: 'up',
        fact: <><b style={{ color: 'var(--color-up)', fontVariantNumeric: 'tabular-nums' }}>{fmtSignedPct(sig.pct)}</b> vs comps{formatEstimate(l) ? <> · {formatEstimate(l)}</> : null}</>,
      });
    }
    return rows;
  }, [upcoming, allLots, fullLoaded]);

  /* ── THE TRACK RECORD — how your eye did, measured. Hammer basis via
     overEstimatePct (realized is premium-inclusive; estimates are hammer).
     The flagged/unflagged split publishes only past an n-gate of 3 each. ── */
  const record = useMemo(() => {
    const judged = sold
      .map(l => ({ l, pct: overEstimatePct(l) }))
      .filter((x): x is { l: AuctionLot; pct: number } => x.pct != null);
    if (!judged.length) return null;
    // priceUsd is premium-inclusive — this sum is REALIZED money, never call it hammer
    const realized = judged.reduce((s, x) => s + (x.l.priceUsd || 0), 0);
    const med = median(judged.map(x => x.pct));
    const flaggedAtSave = judged.filter(x => (savedMeta[x.l.id]?.signalPct ?? 0) <= -10);
    const restAtSave = judged.filter(x => (savedMeta[x.l.id]?.signalPct ?? 0) > -10 && savedMeta[x.l.id]?.signalPct != null);
    const split = flaggedAtSave.length >= 3 && restAtSave.length >= 3
      ? { flagged: median(flaggedAtSave.map(x => x.pct)), flaggedN: flaggedAtSave.length, rest: median(restAtSave.map(x => x.pct)), restN: restAtSave.length }
      : null;
    return { n: judged.length, realized, med, split };
  }, [sold, savedMeta]);

  // #56 · SINCE YOUR LAST VISIT — capture the prior visit timestamp once (then
  // stamp now), and diff which watched lots settled in the interim. State (not
  // a ref) so the memo recomputes once the localStorage read lands.
  const [prevVisit, setPrevVisit] = useState<string | null | undefined>(undefined);
  const capturedVisit = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // capture ONCE: read the prior stamp, then write now. A ref guards the
    // read-then-write against StrictMode's dev double-invoke (run 2 would
    // otherwise read the just-written 'now' and the diff would go empty).
    if (capturedVisit.current !== undefined) return;
    try {
      capturedVisit.current = localStorage.getItem('lectr-lastvisit');
      localStorage.setItem('lectr-lastvisit', new Date().toISOString());
      setPrevVisit(capturedVisit.current);
    } catch { capturedVisit.current = null; setPrevVisit(null); }
  }, []);
  const sinceLast = useMemo(() => {
    if (!fullLoaded || !prevVisit) return null;      // first-ever visit → nothing to diff
    const prevDay = prevVisit.slice(0, 10);
    const fresh = sold.filter(l => (l.saleDate || '').slice(0, 10) > prevDay);
    if (!fresh.length) return null;
    const pcts = fresh.map(l => overEstimatePct(l)).filter((x): x is number => x != null);
    return { n: fresh.length, med: pcts.length ? median(pcts) : null };
  }, [fullLoaded, prevVisit, sold]);

  const emptyState = (
    <>
      <section className="ray-hero2 rail ray-enter">
        <p className="ray-hero2-label">My profile</p>
        <h1 className="ray-hero2-value" style={{ color: 'var(--color-text-faint)' }}>0</h1>
        <p className="ray-hero2-delta">
          <span className="ctx">
            Every collector starts by watching. Bookmark a lot and lectr tracks its hammer,
            its comps, your record once it concludes — and your collection when you win.
          </span>
        </p>
      </section>
      <div className="ray-enter" style={{ textAlign: 'center', padding: '48px 20px 120px' }}>
        <Link href="/value" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
          Start with today&rsquo;s below-market lots
        </Link>
      </div>
    </>
  );

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      color: 'var(--color-fg)',
      fontFamily: 'var(--font-sans), sans-serif',
    }}>
      {/* __html, not a text child: '>' combinators entity-escape in SSR text
          while raw-text <style> never decodes — hydration mismatch otherwise */}
      <style dangerouslySetInnerHTML={{ __html: `
        .ray-saved-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
          gap: 30px 20px;
        }
        .ray-saved-grid > * { min-width: 0; }
        .ray-saved-section { padding-block: 40px 48px; }
        .ray-saved-delta { margin: 8px 2px 0; font-size: 12.5px; color: var(--color-text-muted); }
        .ray-saved-orphan {
          display: flex; align-items: center; justify-content: space-between; gap: 14px;
          padding: 14px 16px; border-bottom: 1px solid var(--color-border);
          font-size: 13px; color: var(--color-text-muted);
        }
        .ray-saved-orphan:last-child { border-bottom: none; }
        /* ── THE BRIEF — the desk TLDR under the masthead ── */
        .ray-since {
          display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px;
          margin-top: 20px; padding: 12px 18px;
          border: 2px dotted color-mix(in srgb, var(--color-fg) 16%, transparent);
          border-radius: 18px;
        }
        .ray-since-k { font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--color-text-faint); }
        .ray-since-v { font-size: 13.5px; color: var(--color-fg); }
        .ray-since-go { margin-left: auto; font-size: 12px; color: var(--color-text-muted); text-decoration: none; white-space: nowrap; }
        .ray-since-go:hover { color: var(--color-fg); }
        .ray-brief {
          border: 2px dotted color-mix(in srgb, var(--color-fg) 15%, transparent);
          border-radius: 20px; padding: 6px 18px; margin-top: 22px;
        }
        .ray-brief-row {
          display: flex; align-items: baseline; gap: 12px;
          padding: 10px 0; text-decoration: none; color: inherit;
          border-top: 2px dotted color-mix(in srgb, var(--color-fg) 8%, transparent);
        }
        .ray-brief-row:first-of-type { border-top: none; }
        .ray-brief-row:hover .ray-brief-title { color: var(--color-fg); }
        .ray-brief-tag {
          flex: none; width: 96px; font-size: 10px; letter-spacing: 0.07em;
          text-transform: uppercase; color: var(--color-text-faint); white-space: nowrap;
        }
        .ray-brief-title {
          font-size: 13px; font-weight: 600; color: var(--color-text-secondary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          max-width: 34%; min-width: 90px; flex: none;
          transition: color var(--duration-fast) var(--ease-signature);
        }
        .ray-brief-fact { font-size: 12.5px; color: var(--color-text-muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        @media (max-width: 640px) {
          .ray-brief { padding: 4px 14px; }
          .ray-brief-row { flex-wrap: wrap; gap: 4px 10px; padding: 9px 0; }
          .ray-brief-tag { width: auto; }
          .ray-brief-title { max-width: 100%; flex: 1 1 100%; }
        }
        /* ── the DESK STRIP — the profile's stat rail under the masthead ── */
        .ray-desk-strip {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 14px; margin-top: 22px;
        }
        .ray-desk-cell {
          border: 2px dotted color-mix(in srgb, var(--color-fg) 13%, transparent);
          border-radius: 18px; padding: 14px 16px 12px;
        }
        .ray-desk-cell .k { font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-faint); }
        .ray-desk-cell .v { font-size: 21px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 3px; }
        .ray-desk-cell .s { font-size: 11.5px; color: var(--color-text-muted); margin-top: 2px; }
        /* ── ledgers ── */
        .ray-savedview-toggle { display: none; }
        .ray-saved-ledger { display: none; }
        @media (min-width: 900px) {
          .ray-savedview-toggle { display: inline-flex; gap: 5px; }
          .ray-saved-section[data-view=ledger] .ray-saved-ledger { display: block; }
          .ray-saved-section[data-view=ledger] .ray-saved-grid { display: none; }
        }
        .ray-savedview-btn {
          font-family: var(--font-sans), sans-serif;
          font-size: 11.5px; font-weight: 600; letter-spacing: -0.01em;
          padding: 5px 14px; border-radius: 100px;
          border: 1px solid var(--color-border);
          background: transparent; color: var(--color-text-muted); cursor: pointer;
          transition: border-color var(--duration-fast) var(--ease-signature), color var(--duration-fast) var(--ease-signature), background var(--duration-fast) var(--ease-signature);
        }
        .ray-savedview-btn:hover { border-color: var(--color-border-mid); color: var(--color-fg); }
        .ray-savedview-btn[data-active=true] { background: var(--color-fg); border-color: var(--color-fg); color: var(--color-bg); }
        .ray-saved-cols {
          display: grid;
          grid-template-columns: minmax(110px, 150px) minmax(0, 1fr) 110px 96px 104px 104px;
          gap: 0 16px; align-items: baseline;
        }
        .ray-saved-ledger-head { padding: 0 2px 8px; }
        .ray-savedrow {
          padding: 11px 2px; border-top: 1px solid var(--hairline);
          text-decoration: none; color: inherit;
          transition: background var(--duration-fast) var(--ease-signature);
        }
        .ray-savedrow:hover { background: var(--color-hover-item); }
        .ray-savedrow .maker { font-size: 13px; font-weight: 600; color: var(--color-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .ray-savedrow .work { font-size: 13px; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .ray-savedrow .num {
          font-family: var(--font-mono), monospace; font-size: 12px;
          font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; color: var(--color-fg);
        }
        .ray-savedrow .num .sub { display: block; font-size: 10px; color: var(--color-text-faint); letter-spacing: 0.02em; }
        .ray-saved-ledger .kicker.r { text-align: right; }
        /* ── SETTLED ledger (own-toggle column) ── */
        .ray-settled-cols {
          display: grid;
          grid-template-columns: minmax(100px, 140px) minmax(0, 1fr) 100px 88px 100px 88px 86px;
          gap: 0 14px; align-items: baseline;
        }
        .ray-own-btn {
          font-family: var(--font-sans), sans-serif; font-size: 10.5px; font-weight: 600;
          padding: 3px 10px; border-radius: 100px; cursor: pointer;
          border: 1px solid var(--color-border); background: transparent; color: var(--color-text-muted);
          transition: border-color var(--duration-fast) var(--ease-signature), color var(--duration-fast) var(--ease-signature);
        }
        .ray-own-btn:hover { border-color: var(--color-border-mid); color: var(--color-fg); }
        .ray-own-btn[data-on=true] { background: var(--color-fg); border-color: var(--color-fg); color: var(--color-bg); }
        .ray-settled-mobile { display: none; }
        @media (max-width: 899px) {
          .ray-settled-desk { display: none; }
          .ray-settled-mobile { display: block; }
        }
        .ray-settled-mrow { padding: 12px 0; border-top: 1px solid var(--hairline); }
        /* ── collection ── */
        .ray-coll-exposure-row {
          display: flex; align-items: baseline; gap: 12px; padding: 9px 0;
          border-top: 1px solid var(--hairline); text-decoration: none; color: inherit;
        }
        .ray-coll-exposure-row:hover { background: var(--color-hover-item); }
        .ray-coll-chip {
          font-size: 10.5px; color: var(--color-text-muted); text-decoration: none;
          border: 1px solid var(--color-border); border-radius: 100px; padding: 1px 8px; white-space: nowrap;
        }
        .ray-coll-chip:hover { color: var(--color-fg); border-color: var(--color-border-mid); }
        @media (max-width: 768px) {
          .ray-saved-grid { grid-template-columns: 1fr; gap: 26px; }
          .ray-saved-section { padding-block: 32px 32px; }
        }
      ` }} />

      <ArtistNav activeSlug="saved" savedCount={badgeCount} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {authEnabled && authReady && user && (
        <div className="rail" style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 14 }}>
          <button
            className="ray-call-btn ray-call-btn-quiet"
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12.5, padding: '4px 0' }}
            onClick={() => signOut()}
          >
            {user.email || 'account'} · Sign out
          </button>
        </div>
      )}

      {authEnabled && authReady && !user ? (
        <RayEntrance animate>
          <section className="ray-hero2 rail ray-enter" style={{ paddingBottom: 8 }}>
            <p className="ray-hero2-label">My profile</p>
            <h1 className="ray-hero2-value">Your desk at the auction</h1>
            <p className="ray-hero2-delta">
              <span style={{ maxWidth: 460 }}>
                Watch lots to the hammer, keep your track record, and hold your collection
                against the engine&rsquo;s live appraisal. Private to you, synced everywhere.
              </span>
            </p>
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
      ) : savedLots.length === 0 && !fullLoaded ? (
        /* saves exist but may all be CONCLUDED — pre-phase-2 the eager slice
           can't see them; hold the loader instead of flashing the false
           "0 — every collector starts by watching" hero (audit-lifecycle #5).
           A genuinely empty account (no savedIds) falls through instantly. */
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
              kicker="My profile"
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
                  : <>
                      Watching <Accent>{upcoming.length || savedLots.length} {(upcoming.length || savedLots.length) === 1 ? 'lot' : 'lots'}</Accent> to the hammer.
                    </>}
              sub={
                <>
                  {summary.next && <>Next hammer {hammerWord(daysUntil(summary.next.saleDate))} · </>}
                  watching {upcoming.length} live {upcoming.length === 1 ? 'lot' : 'lots'}
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
                </>
              }
            />

            {/* #56 · SINCE YOUR LAST VISIT — the outcome moment, in-product */}
            {sinceLast && (
              <div className="ray-since ray-enter" role="status">
                <span className="ray-since-k">Since your last visit</span>
                <span className="ray-since-v">
                  {sinceLast.n} watched {sinceLast.n === 1 ? 'lot' : 'lots'} settled
                  {sinceLast.med != null && (
                    <> · your {sinceLast.n === 1 ? 'call went' : 'calls went'}{' '}
                      <b style={{ color: sinceLast.med >= 0 ? 'var(--color-up)' : 'var(--color-down-text)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtSignedPct(Math.round(sinceLast.med))}
                      </b>{' '}
                      vs estimate, median
                    </>
                  )}
                </span>
                <a href="#settled" className="ray-since-go">See what happened <Flick size={9} /></a>
              </div>
            )}

            {/* THE BRIEF — the desk's TLDR: act-on-today reads, facts only */}
            {brief.length > 0 && (
              <div className="ray-brief ray-enter" role="list" aria-label="Today's brief">
                {brief.map(r => (
                  <Link key={r.key} href={`/lot?id=${encodeURIComponent(r.lot.id)}`} className="ray-brief-row" role="listitem">
                    <span className="ray-brief-tag">{r.tag}</span>
                    <span className="ray-brief-title">{craftTitle(r.lot.title)}</span>
                    <span className="ray-brief-fact">{ARTIST_LABEL[r.lot.artist] || r.lot.artist} · {r.fact}</span>
                  </Link>
                ))}
              </div>
            )}

            {/* THE DESK STRIP — one cell per ledger, only where data exists */}
            <div className="ray-desk-strip ray-enter">
              <div className="ray-desk-cell">
                <div className="k">Watching</div>
                <div className="v">{summary.totalEst > 0 ? formatPrice(summary.totalEst) : upcoming.length}</div>
                <div className="s">
                  {upcoming.length} live {upcoming.length === 1 ? 'lot' : 'lots'}
                  {summary.flagged > 0 && <> · {summary.flagged} below market</>}
                </div>
              </div>
              {collection.rows.length > 0 && (
                <div className="ray-desk-cell">
                  <div className="k">Collection</div>
                  <div className="v">
                    {formatPrice(collection.totalAppraised)}
                    {collection.deltaPct != null && collection.deltaPct !== 0 && (
                      <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 600, color: collection.deltaPct > 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>
                        {fmtSignedPct(collection.deltaPct)}
                      </span>
                    )}
                  </div>
                  <div className="s">
                    {collection.rows.length} {collection.rows.length === 1 ? 'piece' : 'pieces'}
                    {collection.totalPaid > 0 && <> · bought {formatPrice(collection.totalPaid)}</>}
                  </div>
                </div>
              )}
              {record && (
                <div className="ray-desk-cell">
                  <div className="k">Your record</div>
                  <div className="v">
                    {record.med != null ? (
                      <span style={{ color: record.med >= 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>{fmtSignedPct(Math.round(record.med))}</span>
                    ) : '—'}
                  </div>
                  <div className="s">{record.n} settled · vs estimate, median · {formatPrice(record.realized)} realized</div>
                </div>
              )}
            </div>
          </section>

          {/* ══ LEDGER 1 · WATCHING ══ */}
          {upcoming.length > 0 && (
            <section className="ray-saved-section rail" data-view={savedView}>
              <div className="ray-enter" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px 14px', flexWrap: 'wrap', marginBottom: 18 }}>
                <h2 className="ray-h2" style={{ margin: 0 }}>
                  Watching · on the block
                </h2>
                <div className="ray-savedview-toggle" role="group" aria-label="Watching view">
                  <button className="ray-savedview-btn" data-active={savedView === 'ledger'} aria-pressed={savedView === 'ledger'} onClick={() => pickView('ledger')}>Ledger</button>
                  <button className="ray-savedview-btn" data-active={savedView === 'cards'} aria-pressed={savedView === 'cards'} onClick={() => pickView('cards')}>Cards</button>
                </div>
              </div>

              <div className="ray-saved-ledger ray-enter">
                <div className="ray-saved-cols ray-saved-ledger-head" aria-hidden>
                  <span className="kicker">Maker</span>
                  <span className="kicker">Work</span>
                  <span className="kicker r">Est</span>
                  <span className="kicker r">Signal now</span>
                  <span className="kicker r">Δ saved</span>
                  <span className="kicker r">Hammers</span>
                </div>
                {upcoming.map(lot => {
                  const sig = lotSignal(lot, allLots);
                  const m = savedMeta[lot.id];
                  const dPP = m?.signalPct != null && sig !== null
                    ? Math.round(sig.pct) - Math.round(m.signalPct)
                    : null;
                  const newBids = m?.bidCount != null && (lot.bidCount || 0) > m.bidCount
                    ? (lot.bidCount || 0) - m.bidCount
                    : 0;
                  const days = daysUntil(lot.saleDate);
                  // bid velocity (crawl-measured) supersedes the since-saved
                  // bid count when present — a fresher read of the same fact
                  const vel = lot.bidVelocity && lot.bidVelocity.delta > 0 ? lot.bidVelocity : null;
                  return (
                    <Link key={lot.id} href={`/lot?id=${encodeURIComponent(lot.id)}`} className="ray-saved-cols ray-savedrow">
                      <span className="maker">{ARTIST_LABEL[lot.artist] || lot.artist}</span>
                      <span className="work">{craftTitle(lot.title)}</span>
                      <span className="num">{formatEstimate(lot) || '—'}</span>
                      <span className="num" style={sig ? { color: sig.label === 'Below Market' ? 'var(--color-up)' : 'var(--color-down-text)', fontWeight: 700 } : { color: 'var(--color-text-faint)' }}>
                        {sig ? fmtSignedPct(sig.pct) : '—'}
                      </span>
                      <span className="num" style={{ color: dPP == null || dPP === 0 ? 'var(--color-text-faint)' : dPP > 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>
                        {dPP != null && dPP !== 0 ? `${dPP > 0 ? '+' : '−'}${Math.abs(dPP)}pp` : '—'}
                        {vel ? (
                          <span className="sub">+{vel.delta} bids/{Math.round(vel.hours)}h</span>
                        ) : newBids > 0 ? (
                          <span className="sub">+{newBids} {newBids === 1 ? 'bid' : 'bids'}</span>
                        ) : null}
                      </span>
                      <span className="num" style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                        {hammerWord(days)}
                      </span>
                    </Link>
                  );
                })}
              </div>

              <div className="ray-saved-grid">
                {upcoming.map((lot, i) => (
                  <div
                    key={lot.id}
                    className="ray-enter-card"
                    style={{ '--enter-delay': `${Math.min(i, 8) * 60}ms` } as React.CSSProperties}
                  >
                    <LotCard
                      lot={lot}
                      showArtist
                      allLots={allLots}
                      saved={isSaved(lot.id)}
                      onToggleSave={id => toggle(id, lot)}
                    />
                    <SavedDelta lot={lot} meta={savedMeta[lot.id]} allLots={allLots} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ══ LEDGER 2 · COLLECTION — the pieces you own ══ */}
          {collection.rows.length > 0 && (
            <div className="ray-band ray-enter" style={{ marginTop: 30, paddingBlock: '28px 30px' }}>
              <section className="rail" aria-label="Your collection">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 14px', marginBottom: 6 }}>
                  <h2 className="ray-h2" style={{ margin: 0 }}>Your collection</h2>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                    {collection.rows.length} {collection.rows.length === 1 ? 'piece' : 'pieces'}
                    {collection.totalPaid > 0 && (
                      <>
                        {' '}· bought{' '}
                        <b style={{ color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(collection.totalPaid)}</b>
                      </>
                    )}
                    {' '}· lectr appraisal{' '}
                    <b style={{ color: 'var(--color-fg)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(collection.totalAppraised)}</b>
                    {collection.deltaPct != null && collection.deltaPct !== 0 && (
                      <b style={{ color: collection.deltaPct > 0 ? 'var(--color-up)' : 'var(--color-down-text)', fontVariantNumeric: 'tabular-nums' }}>
                        {' '}· {fmtSignedPct(collection.deltaPct)}
                      </b>
                    )}
                  </span>
                </div>

                {/* the collection over time — appraisal vs bought, real daily
                    snapshots (renders only once a 3-day trail exists) */}
                {collectionChart && (
                  <div style={{ margin: '18px 0 8px' }}>
                    <div className="kicker" style={{ marginBottom: 4, color: 'var(--paper-muted, var(--color-text-muted))' }}>
                      Your collection over time · appraisal vs bought · daily snapshots
                    </div>
                    <HeroChart anchor={collectionChart.anchor} layers={collectionChart.layers} height={150} compact play={false} />
                  </div>
                )}

                {/* WHERE IT TRADES — the collection's sub-market exposure.
                    Each row is the MARKET's read, labeled as such. */}
                {exposure.length > 0 && (
                  <div style={{ margin: '18px 0 4px' }}>
                    <div className="kicker" style={{ padding: '0 0 2px', color: 'var(--paper-muted, var(--color-text-muted))' }}>
                      Where it trades · the market&rsquo;s move, not your pieces&rsquo;
                    </div>
                    {exposure.map(({ row, n, held }) => {
                      const read = row.readType === 'index' && row.index
                        ? { txt: `${fmtSignedPct(Math.round(row.index.changePct))} ${row.index.horizon} verified`, dir: row.index.changePct >= 0 }
                        : row.readType === 'demand' && row.demandNow != null
                          ? { txt: `${fmtSignedPct(Math.round(row.demandNow))} vs estimate`, dir: row.demandNow >= 0 }
                          : null;
                      return (
                        <Link key={row.slug} href={`/sub/${row.slug.replace(':', '/')}`} className="ray-coll-exposure-row">
                          <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.label} <Flick size={9} style={{ marginLeft: 2 }} />
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {n} {n === 1 ? 'piece' : 'pieces'} · {formatPrice(held)} held
                          </span>
                          <span style={{ width: 150, textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontFamily: read ? 'var(--font-mono), monospace' : undefined, color: read ? (read.dir ? 'var(--color-up)' : 'var(--color-down-text)') : 'var(--color-text-faint)' }}>
                            {read ? read.txt : `${row.lots.toLocaleString()} lots tracked`}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}

                {/* the pieces */}
                <div className="kicker" style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '14px 0 6px', color: 'var(--paper-muted, var(--color-text-muted))' }}>
                  <div style={{ flex: 1 }}>Piece</div>
                  <div style={{ width: 92, textAlign: 'right' }}>Bought</div>
                  <div style={{ width: 128, textAlign: 'right' }}>lectr appraisal</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {collection.rows.map(({ lot, paid, appraised, basis, refOnly, deltaPct, drill, drillSlug }) => (
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
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{basis ?? (fullLoaded ? 'no comps yet' : 'appraising…')}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', margin: '14px 0 0' }}>
                  The lectr appraisal is the median its comparable sales currently trade at — our read from the data,
                  not a formal appraisal. Pieces without a usable comp pool carry at their bought price in the total;
                  a reference range is context only and never enters a number.
                </p>
              </section>
            </div>
          )}

          {/* ══ LEDGER 3 · SETTLED — what happened to the lots you watched ══ */}
          {sold.length > 0 && (
            <section id="settled" className="ray-saved-section rail ray-enter" style={{ '--enter-delay': '90ms' } as React.CSSProperties}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px 14px', flexWrap: 'wrap', marginBottom: 4 }}>
                <h2 className="ray-h2" style={{ margin: 0 }}>Settled · your track record</h2>
                {record && record.med != null && (
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                    {record.n} judged · your picks went{' '}
                    <b style={{ color: record.med >= 0 ? 'var(--color-up)' : 'var(--color-down-text)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtSignedPct(Math.round(record.med))}
                    </b>{' '}
                    vs estimate, median
                  </span>
                )}
              </div>
              {record?.split && (
                <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '0 0 14px' }}>
                  Lots you saved while flagged below market went{' '}
                  <b style={{ color: (record.split.flagged ?? 0) >= 0 ? 'var(--color-up)' : 'var(--color-down-text)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtSignedPct(Math.round(record.split.flagged ?? 0))}
                  </b>{' '}
                  ({record.split.flaggedN}) · the rest{' '}
                  <b style={{ color: (record.split.rest ?? 0) >= 0 ? 'var(--color-up)' : 'var(--color-down-text)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtSignedPct(Math.round(record.split.rest ?? 0))}
                  </b>{' '}
                  ({record.split.restN}) — vs estimate, hammer basis
                </p>
              )}
              {/* #57 · OWN-IT PROMPT — asks, never presumes a win; shown only
                  while settled watched lots aren't yet in the collection */}
              {sold.some(l => l.status === 'sold' && !ownedIds.includes(l.id)) && (
                <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '0 0 14px' }}>
                  Won any of these? Mark it <b style={{ color: 'var(--color-fg)' }}>I won it</b> and the piece joins your collection, appraised against the live market.
                </p>
              )}

              {/* desktop settled ledger */}
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
                {sold.map(lot => {
                  const m = savedMeta[lot.id];
                  const pct = overEstimatePct(lot);
                  const pending = !lot.priceUsd;
                  const owned = ownedIds.includes(lot.id);
                  return (
                    <div key={lot.id} className="ray-settled-cols ray-savedrow" style={{ display: 'grid' }}>
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
                      <span className="num" style={m?.signalPct != null ? { color: m.signalPct <= -10 ? 'var(--color-up)' : 'var(--color-text-secondary)' } : { color: 'var(--color-text-faint)' }}>
                        {m?.signalPct != null ? fmtSignedPct(Math.round(m.signalPct)) : '—'}
                      </span>
                      <span className="num" style={{ fontWeight: 600 }}>
                        {pending ? <span style={{ color: 'var(--color-text-faint)', fontWeight: 500 }}>pending</span> : formatPrice(lot.priceUsd!)}
                      </span>
                      <span className="num" style={pct != null ? { color: pct >= 0 ? 'var(--color-up)' : 'var(--color-down-text)', fontWeight: 700 } : { color: 'var(--color-text-faint)' }}>
                        {pct != null ? fmtSignedPct(Math.round(pct)) : '—'}
                      </span>
                      <span style={{ textAlign: 'right' }}>
                        <button className="ray-own-btn" data-on={owned} aria-pressed={owned} onClick={() => toggleOwned(lot.id)}>
                          {owned ? 'Owned ✓' : 'I won it'}
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* mobile settled rows */}
              <div className="ray-settled-mobile">
                {sold.map(lot => {
                  const m = savedMeta[lot.id];
                  const pct = overEstimatePct(lot);
                  const pending = !lot.priceUsd;
                  const owned = ownedIds.includes(lot.id);
                  return (
                    <div key={lot.id} className="ray-settled-mrow">
                      <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{craftTitle(lot.title)}</div>
                      </Link>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 4 }}>
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                          {ARTIST_LABEL[lot.artist] || lot.artist}
                          {m?.signalPct != null && <> · your call {fmtSignedPct(Math.round(m.signalPct))}</>}
                        </span>
                        <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {pending ? <span style={{ color: 'var(--color-text-faint)' }}>pending</span> : (
                            <>
                              <b>{formatPrice(lot.priceUsd!)}</b>
                              {pct != null && (
                                <b style={{ marginLeft: 6, color: pct >= 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>{fmtSignedPct(Math.round(pct))}</b>
                              )}
                            </>
                          )}
                        </span>
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <button className="ray-own-btn" data-on={owned} aria-pressed={owned} onClick={() => toggleOwned(lot.id)}>
                          {owned ? 'Owned ✓' : 'I won it'}
                        </button>
                      </div>
                    </div>
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
              <div className="ray-saved-grid">
                {other.map((lot, i) => (
                  <div
                    key={lot.id}
                    className="ray-enter-card"
                    style={{ '--enter-delay': `${Math.min(i, 8) * 60}ms` } as React.CSSProperties}
                  >
                    <LotCard
                      lot={lot}
                      showArtist
                      allLots={allLots}
                      saved={isSaved(lot.id)}
                      onToggleSave={id => toggle(id, lot)}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* on-demand: only fetch the ledger when there are orphans to resolve */}
          {orphanIds.length > 0 && <LedgerGate onLedger={setLedger} />}

          {soldOrphans.length > 0 && (
            <section className="rail ray-enter" style={{ paddingBlock: '34px 8px' }}>
              <h2 className="ray-h2" style={{ marginBottom: 6 }}>Settled off the block</h2>
              <p style={{ fontSize: 13, color: 'var(--color-text-faint)', margin: '0 0 14px' }}>
                Saved lots that sold — the hammer result, from the archive.
              </p>
              <div className="glass glass-quiet">
                {soldOrphans.map(o => {
                  const m = savedMeta[o.id];
                  return (
                    <div key={o.id} className="ray-saved-orphan">
                      <span>
                        <span style={{ color: 'var(--color-fg)', fontWeight: 600 }}>
                          {m?.title || o.id}
                          {m?.artist && <>, {ARTIST_LABEL[m.artist] || m.artist}</>}
                        </span>
                        <span style={{ color: 'var(--color-text-faint)' }}> · sold {formatDate(o.saleDate)}</span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                        {o.provisional ? (
                          /* promoted close — our last-tracked bid, NOT the final
                             hammer (extended bidding runs past our snapshot).
                             Never present it as the result; the sold sweep
                             confirms the true figure within a day or two. */
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }} title="Sold — final price settling; Goldin posts results shortly after the close.">
                            result settling…
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-up, #57BE87)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                            {formatPrice(o.priceUsd)}
                          </span>
                        )}
                        <button className="ray-call-btn ray-call-btn-quiet" onClick={() => toggle(o.id)}>Remove</button>
                      </span>
                    </div>
                  );
                })}
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
                      <button
                        className="ray-call-btn ray-call-btn-quiet"
                        style={{ flexShrink: 0 }}
                        onClick={() => toggle(id)}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <AlertsInbox />
        </RayEntrance>
      )}
      <Colophon record={null} />
    </div>
  );
}
