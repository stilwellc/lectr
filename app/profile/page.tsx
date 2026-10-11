'use client';

import React, { useMemo, useCallback, useEffect, useLayoutEffect, useState, useRef } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import { retryFullLoad, retrySoldLedger, useFullLotsOnDemand, useSoldLedger, type LedgerEntry } from '../hooks/useRayData';
import { useSavedLots, SavedMeta } from '../hooks/useSavedLots';
import { signalCallOf } from '../lib/account';
import { useAuth } from '../lib/account';
import { useAlerts } from '../lib/alerts';
import { useCollectionSnapshots } from '../lib/snapshots';
import ArtistNav from '../components/ArtistNav';
import { Colophon, daysUntil as daysUntilOrNull } from '../components/Terminal';
import LotCard, { lotSignal, formatEstimate, LiveStamp } from '../components/LotCard';
import { dealScore, scienceReferenceBand, cultureReferenceBand, makerReferenceBand } from '../lib/comps';
import { lotVerdict } from '../lib/verdict';
import { drillRowFor, drillSlugFor, type DrillRow } from '../lib/submarkets';
import { sleeperRead } from '../lib/lanes';
import HeroChart from '../preview/terminal/HeroChart';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import CountUp from '../components/CountUp';
import Masthead, { Accent } from '../components/Masthead';
import Flick from '../components/Flick';
import CloseClock from '../components/CloseClock';
import { WatchMark, RecordMark, CollectionMark, TapeMark, ArchiveMark, HorizonMark, RankMark, SignalMark, AwayMark } from '../components/marks';
import { FeedRow, belowSignalOf, feedTone } from '../components/LotBrowser';
import { useReturnLoop, type ReturnLoop } from '../components/PickStrips';
import { useLastVisit, houseBaselines } from '../lib/feed-filters';
import ComparableModal from '../components/ComparableModal';
import { useLotModal } from '../lib/use-lot-modal';
import { recommend, recNote, recDepth, type Taste, type Rec } from '../lib/recs';
import { closeMsOf } from '../lib/priority';
import { useFollows } from '../lib/follows';
import { useTaste } from '../lib/use-recs';
import { PickFeedback, UndoSeat, usePickFeedback, withUndoSeat } from '../components/PickFeedback';
import QuickStart from '../components/QuickStart';
import { usePricePref, priceText } from '../lib/interests';
import { CellGrid, Cell, ColorCell } from '../components/cells';
import { HelpChip } from './help';
import { PillRail, useHashLanding, type RailItem } from './rail';
import TodayBand from './today';
import YourSignals from './signals';
import PickMenu from './pickmenu';
import PickOutcomes from './outcomes';
import { useLogPicks } from '../lib/pick-log';
import { getUpcomingCounts, formatPrice, formatDate, craftTitle, fmtSignedPct, localToday, median, overEstimatePct, isOnBlock } from '../utils';
import { ARTIST_LABEL, ARTIST_MARKET } from '../constants';
import { makerLineOf, labelLineOf, drillLabelOf } from '../lib/lot-labels';
import { displayMakerOf } from '../lib/maker-subjects';
import PushOptIn from '../components/retention/PushOptIn';
import { TrackOnMount } from '../components/retention/trackers';

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

/** Terminal's shared daysUntil, kept on this page's NaN convention (every
    comparison here is NaN-safe; a null would need `?? NaN` at 14 call sites) */
const daysUntil = (dateStr: string): number => daysUntilOrNull(dateStr) ?? NaN;
function hammerWord(days: number): string {
  if (isNaN(days)) return 'scheduled';
  if (days < 0) return `hammered ${-days} ${days === -1 ? 'day' : 'days'} ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
/** sort key for saleDate — a missing/garbled date must sort DETERMINISTICALLY
    (to the end of any ordering), never feed NaN into a comparator. `missing`
    is the sentinel: MAX for ascending lists, 0 for descending ones, so the
    dateless rows land LAST either way. */
const saleTime = (l: AuctionLot, missing = Number.MAX_SAFE_INTEGER): number => {
  const t = Date.parse(`${(l.saleDate || '').slice(0, 10)}T00:00:00Z`);
  return isNaN(t) ? missing : t;
};

/** past-pending = concluded but unresolved. The resultsPending flag alone
    is NOT enough: a sale that closes between nightlies can carry rows frozen
    as bare status 'upcoming' with a past saleDate and NO flag (RR sale 748's
    Apple lots sat in "Watching" for six days this way). The DATE is the
    truth — anything upcoming whose sale day is behind us has left the block,
    flag or no flag. One-day grace mirrors isLiveUpcoming. A lot with NO
    saleDate can't be date-judged and stays visible in Watching as
    "scheduled" — an honest unknown, not a claim it is live.
    UTC-parsed on both sides (the daysUntil convention) so the two clocks
    can never disagree about whether a day is behind us. */
function isPastPending(l: AuctionLot): boolean {
  if (l.status !== 'upcoming' || !l.saleDate) return false;
  const day = l.saleDate.slice(0, 10);
  if (l.resultsPending) return day < localToday();
  const graceMs = Date.parse(`${day}T00:00:00Z`) + 2 * 86_400_000; // sale day + 1 grace day
  return !isNaN(graceMs) && graceMs < Date.parse(`${localToday()}T00:00:00Z`) + 1;
}

/** every id a save could be keyed under across the corpus AND the sold
    ledger — the save itself, its tilde twin, and the Wright-family mirrors.
    BOTH resolution passes must walk the same aliases: resolving a live row
    through them but looking the ledger up by the raw id dressed real sales
    as "withdrawn" whenever a save was keyed under an alias. */
function idAliases(id: string): string[] {
  const out = [id, id.endsWith('~') ? id.slice(0, -1) : `${id}~`];
  const fam = id.match(/^(wright|rago|lama)-(\d+)~?$/);
  if (fam) {
    for (const h of ['wright', 'rago', 'lama']) {
      if (h !== fam[1]) out.push(`${h}-${fam[2]}`, `${h}-${fam[2]}~`);
    }
  }
  return out;
}

/* ── THE ONE CLASSIFIER — why a live watch needs you now. Both surfaces
   that tag rows (Today's reads and the Watching ledger) read THESE
   thresholds; a tuning change lands in both or in neither. ── */
const TAG_SOON_DAYS = 2;      // "Lands soon": hammers within 2 days
// "Quiet" IS the engine's sleeper read (app/lib/lanes.ts sleeperRead: a dead
// room — zero bids — on a lot whose fairness the engine VERIFIED from its own
// appraisal, closing within the week). The old local rule (≤3 bids, no
// fairness check) was a second sleeper classifier; one-source law.
type WatchTag = { tag: 'Lands soon' | 'Below market' | 'Most bids' | 'Quiet'; rank: number };
function watchTagOf(l: AuctionLot, sig: { label: string } | null | undefined, now = Date.now()): WatchTag | null {
  const d = daysUntil(l.saleDate);
  if (d >= 0 && d <= TAG_SOON_DAYS) return { tag: 'Lands soon', rank: 0 };
  if (sig?.label === 'Below Market') return { tag: 'Below market', rank: 1 };
  if (l.bidVelocity && l.bidVelocity.delta > 0) return { tag: 'Most bids', rank: 2 };
  if (sleeperRead(l, now)) return { tag: 'Quiet', rank: 3 };
  return null;
}

type LiveSignal = NonNullable<ReturnType<typeof lotSignal>>;
/** live-signal ink + text — the app-wide signalMagnitude convention */
const sigInk = (label: LiveSignal['label']) =>
  label === 'Below Market' ? 'var(--color-up)' : 'var(--color-down-text)';
const sigText = (sig: LiveSignal) =>
  `${sig.label === 'Above Market' ? '−' : '+'}${Math.abs(Math.round(sig.pct))}%`;

/* ── THE GLOSSARY — the cockpit's measured jargon, tappable. Terms live in
   captions and heads, never inside an ellipsized cell. ── */
const GLOSSARY: Record<string, string> = {
  'signal now': 'The engine\u2019s live read on the lot \u2014 its comp median against the current ask. Below Market prints +% mint: the comps sit above the price on the block.',
  'delta saved': 'How the signal moved since the day you saved the lot, in percentage points. \u201cFlipped\u201d means it crossed to the other side of market \u2014 directions compare only for saves that recorded one.',
  'vs estimate': 'The realized all-in price against the house estimate midpoint \u2014 the one yardstick every settled watch is judged by. All-in = hammer plus buyer\u2019s premium.',
  'appraisal': 'The median its comparable sales currently trade at \u2014 our read from the data, not a formal appraisal. Pieces without a usable comp pool carry at their bought price.',
  'judged': 'A watch grades once it settles with a published price and carried an estimate to be judged against \u2014 no estimate, no judgment.',
};
function Term({ k, children }: { k: keyof typeof GLOSSARY; children: React.ReactNode }) {
  return (
    <span className="ck-term" tabIndex={0}>
      {children}
      <span className="ck-term-tip" role="tooltip">{GLOSSARY[k]}</span>
    </span>
  );
}


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

/** Inline cost-basis + note editor for a collection piece. Paid overrides
    the hammer price in every collection figure; the note is private ink on
    the row. Both persist per save (Enter or Save commits). */
function PieceEditor({ paid, note, onSave, onClose }: {
  paid: number | null; note: string | null;
  onSave: (patch: { paidUsd: number | null; note: string | null }) => void;
  onClose: () => void;
}) {
  const [paidStr, setPaidStr] = useState(paid != null ? String(paid) : '');
  const [noteStr, setNoteStr] = useState(note || '');
  const commit = () => {
    const cleaned = paidStr.replace(/[$,\s]/g, '');
    const n = cleaned === '' ? null : Number(cleaned);
    onSave({ paidUsd: n != null && Number.isFinite(n) && n >= 0 ? Math.round(n) : null, note: noteStr.trim() || null });
    onClose();
  };
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onClose(); };
  return (
    <div className="ck-piece-edit">
      <label>
        <span className="kicker">Paid</span>
        <input inputMode="decimal" value={paidStr} onChange={e => setPaidStr(e.target.value)} onKeyDown={onKey}
          placeholder="what you paid, $" aria-label="What you paid, in dollars" />
      </label>
      <label style={{ flex: 1, minWidth: 180 }}>
        <span className="kicker">Note</span>
        <input value={noteStr} onChange={e => setNoteStr(e.target.value)} onKeyDown={onKey}
          placeholder="private note" maxLength={200} aria-label="Private note" />
      </label>
      <button type="button" className="ray-own-btn" onClick={commit}>Save</button>
      <button type="button" className="ray-own-x" style={{ fontSize: 12 }} aria-label="Cancel" onClick={onClose}>Cancel</button>
    </div>
  );
}

/** The in-place dossier — a watching row opens on its own row. Everything
    the cards view buried (the saved-delta narrative, the engine read with
    its basis, the live bid state) without leaving the ledger. Mounted only
    while open, so collapsed rows keep zero of its links in the tab order. */
function RowDossier({ lot, meta, sig, allLots, fullLoaded, onRemove }: {
  lot: AuctionLot; meta: SavedMeta | undefined; sig: LiveSignal | null;
  allLots: AuctionLot[]; fullLoaded: boolean; onRemove: () => void;
}) {
  // (Oct 6 2026, wave 4) the ENGINE's appraisal (lot.value, ×5-sane) — never
  // a client appraisal over the loaded slice
  const appr = useMemo(() => { const vd = lotVerdict(lot); return vd ? { value: vd.expectedAllIn, n: vd.compN } : null; }, [lot]);
  const call = signalCallOf(meta);
  const days = daysUntil(lot.saleDate);
  const hasEst = (lot.estimateLow || 0) > 0 || (lot.estimateHigh || 0) > 0;
  return (
    <div className="ck-dossier" role="region" aria-label={`Details for ${lot.title}`}>
      <SavedDelta lot={lot} meta={meta} sig={sig} />
      <div className="ck-dossier-grid">
        {hasEst && (
          <div className="ck-dossier-cell">
            <span className="kicker">Estimate</span>
            <span className="ck-dossier-v">{formatEstimate(lot)}</span>
          </div>
        )}
        {(lot.currentBid || 0) > 0 && (
          <div className="ck-dossier-cell">
            <span className="kicker">On the block</span>
            <span className="ck-dossier-v">
              {formatPrice(lot.currentBid!)} bid
              {typeof lot.bidCount === 'number' && lot.bidCount > 0 && <span className="sub"> · {lot.bidCount} {lot.bidCount === 1 ? 'bid' : 'bids'}</span>}
              {lot.overlayAt && <span className="sub"> · <LiveStamp iso={lot.overlayAt} /></span>}
            </span>
          </div>
        )}
        {sig && (
          <div className="ck-dossier-cell">
            <span className="kicker">Engine read</span>
            <span className="ck-dossier-v" style={{ color: sigInk(sig.label) }}>
              {sigText(sig)}
              {sig.basis != null && sig.basis > 0 && <span className="sub"> · {sig.basis} comps</span>}
            </span>
          </div>
        )}
        {lot.cardComps && lot.cardComps.n > 0 && lot.cardComps.med != null ? (
          <div className="ck-dossier-cell">
            <span className="kicker">Direct comps</span>
            <span className="ck-dossier-v">{formatPrice(lot.cardComps.med)}<span className="sub"> · {lot.cardComps.n} same card &amp; grade</span></span>
          </div>
        ) : appr ? (
          <div className="ck-dossier-cell">
            <span className="kicker">Appraisal</span>
            <span className="ck-dossier-v">{formatPrice(appr.value)}<span className="sub"> · {appr.n} comps</span></span>
          </div>
        ) : null}
        {meta && (
          <div className="ck-dossier-cell">
            <span className="kicker">Your save</span>
            <span className="ck-dossier-v">
              {formatDate(meta.savedAt)}
              {meta.estMid != null && <span className="sub"> · est. {formatPrice(meta.estMid)} then</span>}
              {call && call.dir !== 'unknown' && (
                <span className="sub"> · called {call.dir === 'below' ? '+' : '−'}{Math.round(call.pct)}%</span>
              )}
            </span>
          </div>
        )}
        <div className="ck-dossier-cell">
          <span className="kicker">Hammers</span>
          <span className="ck-dossier-v">
            {days === 0 && lot.saleDateTime ? <CloseClock iso={lot.saleDateTime} windowHours={24} /> : hammerWord(days)}
          </span>
        </div>
      </div>
      <div className="ck-dossier-actions">
        <Link href={`/lot?id=${encodeURIComponent(lot.id)}`}>Open the lot</Link>
        <button type="button" className="quiet" onClick={onRemove}>Remove watch</button>
      </div>
    </div>
  );
}

/** THE RECORD TIMELINE — every judged call in hammer order around the
    estimate line: mint beat it, coral missed it. Height rides a sqrt scale
    clamped at ±300% so one runaway outcome can't flatten the sequence.
    Each bar deep-links to its lot; the receipts stay attached. */
function RecordTimeline({ series }: { series: { id: string; d: string; pct: number; title: string }[] }) {
  if (series.length < 5) return null;
  const HALF = 52;
  const h = (pct: number) => Math.max(2, Math.round(Math.sqrt(Math.min(Math.abs(pct), 300) / 300) * HALF));
  return (
    <div className="ck-rec-tl">
      <span className="kicker">Call by call</span>
      <div className="ck-rec-tl-band" role="list" aria-label={`${series.length} judged calls in hammer order`}>
        {series.map(x => {
          const flat = Math.round(x.pct) === 0;
          const up = x.pct > 0;
          return (
            <Link key={x.id} href={`/lot?id=${encodeURIComponent(x.id)}`} className="ck-rec-tl-bar" role="listitem"
              aria-label={`${fmtSignedPct(Math.round(x.pct))} vs estimate, ${formatDate(x.d)}`}
              title={`${craftTitle(x.title)} — ${fmtSignedPct(Math.round(x.pct))} vs estimate · ${formatDate(x.d)}`}>
              <i style={{
                height: h(x.pct),
                background: flat ? 'var(--color-text-faint)' : up ? 'var(--color-up)' : 'var(--color-down-text)',
                ...(up || flat ? { bottom: '50%' } : { top: '50%' }),
              }} />
            </Link>
          );
        })}
      </div>
      <span className="ck-rec-tl-cap">each judged call in hammer order · above the line beat its estimate</span>
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

/* ══ LOTS YOU MAY LIKE — the desk's recommender (app/lib/recs). Every lot
   on the block scored against what this reader saved, owns, follows and
   searched; each pick prints its reason on the note line the feed's cards
   and rows already carry. Desktop = the feed's cards, phone = the feed's
   rows. The same taste drives home's For-you tab, so the two agree. A
   reader with nothing to go on is told so — never shown fake picks.
   (Oct 11 redesign) the deal is computed once at the page (useDeal) so the
   Today band, the rail's count and this room read the same picks. ══ */
const RECS_MAX = 24;
interface Deal { pool: AuctionLot[]; recs: Rec<AuctionLot>[]; loop: ReturnLoop | null }
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

function RecsRoom({ book, deal, compLots, taste, ready, lastCrawl, isSaved, onToggleSave, signedOut = false }: {
  book: AuctionLot[]; deal: Deal; compLots: AuctionLot[]; taste: Taste; ready: boolean; lastCrawl?: string;
  isSaved: (id: string) => boolean; onToggleSave: (id: string, lot?: AuctionLot) => void; signedOut?: boolean;
}) {
  const { pool, recs } = deal;
  // (Oct 11) the reader's stated price range (quick start, app/lib/interests)
  // rides inside the taste as a strong band (recs' statedFit) — named here only
  const pricePref = usePricePref();
  const [editing, setEditing] = useState(false);
  // Tune keeps the reader's place: focus lands on the editor's head when it
  // opens, and returns to Tune when it closes (Done / Cancel)
  const tuneRef = useRef<HTMLButtonElement | null>(null);
  const editRef = useRef<HTMLDivElement | null>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) {
      const t = window.setTimeout(() => {
        const root = editRef.current;
        const head = root?.querySelector<HTMLElement>('.ray-feedsheet-head') ?? root?.querySelector<HTMLElement>('button, input');
        if (!head) return; // phone: the sheet traps its own focus
        if (!head.matches('button, input')) head.tabIndex = -1;
        head.focus({ preventScroll: false });
      }, 30);
      wasEditing.current = true;
      return () => window.clearTimeout(t);
    }
    if (wasEditing.current) { wasEditing.current = false; tuneRef.current?.focus(); }
  }, [editing]);
  const below = useMemo(() => belowSignalOf(recs.map(r => r.lot), compLots), [recs, compLots]);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // two full rows of the desk's card grid (3 across at the rail's width)
  const page = 6;
  const [shown, setShown] = useState<number | null>(null);
  const visible = shown ?? page;
  const [openLot, setOpenLot] = useLotModal<AuctionLot>();
  // "More like this / Not for me" — this device only (app/lib/recs-signals)
  const fb = usePickFeedback();

  const c = taste.counts;
  const from = [
    c.saved ? `${c.saved} ${c.saved === 1 ? 'save' : 'saves'}` : null,
    c.owned ? `${c.owned} owned` : null,
    c.follows ? `${c.follows} ${c.follows === 1 ? 'follow' : 'follows'}` : null,
    c.searches ? `${c.searches} saved ${c.searches === 1 ? 'search' : 'searches'}` : null,
    // what this browser learned (visits, searches AND More like this marks —
    // not all of them "looks", R4 P3-15)
    c.signals ? `${c.signals} ${c.signals === 1 ? 'signal' : 'signals'} on this device` : null,
  ].filter(Boolean).join(', ');
  const cold = ready && taste.seeds.length === 0;
  // a pick you just asked "More like this" of keeps its seat: the list re-reads
  // at once and the new kin would otherwise push it off the screen under
  // your finger (the lit pill must stay where you pressed it)
  const lastShown = useRef<Rec<AuctionLot>[]>([]);
  const shownList = useMemo(() => {
    const base = recs.slice(0, visible);
    const keep = lastShown.current.map((r, i) => ({ r, i })).filter(x => fb.marks.get(x.r.lot.id) === 'more');
    if (!keep.length) return base;
    const out = base.filter(r => !keep.some(k => k.r.lot.id === r.lot.id));
    for (const k of keep) out.splice(Math.min(k.i, out.length), 0, recs.find(x => x.lot.id === k.r.lot.id) ?? k.r);
    return out.slice(0, Math.max(visible, keep.length));
  }, [recs, visible, fb.marks]);
  useEffect(() => { lastShown.current = shownList; }, [shownList]);
  // the picks on screen, noted on this device with what lectr said then (N4)
  useLogPicks(useMemo(() => (ready && !editing ? shownList.map(r => ({ lot: r.lot, rec: r })) : null), [ready, editing, shownList]), 'p');
  const seats = withUndoSeat(shownList, fb.undo);

  return (
    <section id="for-you" className="ray-saved-section rail ray-enter ck-foryou" aria-label="Lots you may like">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <div className="ck-room-head" style={{ marginBottom: cold ? 4 : 16 }}>
          <h2 className="ray-h2" style={{ margin: 0 }}><span className="ray-sect-mark" aria-hidden><RankMark size={17} /></span>Lots you may like</h2>
          <HelpChip name="Lots you may like">
            Every lot on the block is read against what you <b>own</b>, <b>save</b>, <b>follow</b> and <b>search</b> — in
            that order of weight, recent saves louder than old ones. A lot qualifies only through a real tie: the same
            maker, player, Pokémon or subject; the same card in another grade; the same franchise or model line; or,
            inside one category, the same era, grader or language at a price like yours. A category you follow counts
            only for the kind of thing it names. Then the strongest ties that matter most and close soonest lead. The
            names you keep may fill much of the list; looser matches are spread out, so one sale, one category or one
            single signal never takes over. Lots at the prices you save and own — or the range you set in Tune — lead
            lots far from them, and a lot well outside your range comes last and says so. A lot the engine reads below
            market says so. When a name you follow has only a few lots live, the list goes on to its nearest kin —
            another Pokémon, another player of the same sport and era — and each such pick says that is why it is here.
            Lots on your desk never come back here. The line under each lot says why it is here; the picks re-read with
            every crawl and every save. What you open and search on this device leans the list (a few seats are kept
            for it), and More like this / Not for me steer it at once — Not for me also quiets what led to that pick.
            Kept in this browser, never uploaded.
            Everything that tunes the list is under <a href="#signals" className="ck-away-link">Your signals</a>.
          </HelpChip>
          {ready && !cold && !editing && (
            <button ref={tuneRef} type="button" className="ray-toolbar-pill ck-tune" aria-haspopup="dialog" onClick={() => setEditing(true)}>Tune</button>
          )}
          {ready && !cold && (
            <span className="ck-room-sub ck-room-subline">
              {recs.length > 0 ? <>{recs.length} picked</> : <>nothing ties yet</>}<span className="ck-wide"> from {pool.length.toLocaleString()} live lots</span>
              {pricePref ? <> · {priceText(pricePref)}</> : null} · <span className="ck-wide">tuning </span>from {from}
            </span>
          )}
        </div>

        {!ready ? (
          <p className="ck-sig-note" aria-busy="true">Reading the block against your desk…</p>
        ) : cold ? (
          <QuickStart book={book} mode="cold" surface="profile" />
        ) : editing ? (
          <div ref={editRef} style={{ marginBottom: 20 }}>
            <QuickStart book={book} mode="edit" surface="profile" onClose={() => setEditing(false)} />
          </div>
        ) : null}
        {!ready || cold ? null : recs.length === 0 ? (
          <div>
            <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', margin: 0, maxWidth: 640, lineHeight: 1.55 }}>
              Nothing on the block ties to your desk right now — no live lot shares a name, card, franchise or close
              enough cut with what you hold. New lots land with every crawl.
            </p>
            {!editing && <button type="button" className="ray-toolbar-pill" style={{ marginTop: 14 }} onClick={() => setEditing(true)}>Add a follow</button>}
          </div>
        ) : narrow ? (
          <div>
            {seats.map((r, i) => ('undoSeat' in r
              ? <UndoSeat key={`undo-${r.undoSeat.id}`} undo={r.undoSeat} onUndo={fb.undoIt} row />
              : (
                <div key={r.lot.id} className="ck-pickrow" data-pick data-nav-row>
                  {/* the reason is the row's one line that never truncates
                      (the honesty payload) — it wraps; the price rides under */}
                  <FeedRow stack lot={r.lot} onOpen={() => setOpenLot(r.lot)}
                    tone={feedTone(r.lot, below.ids, below.hasSig)} note={recNote(r)} />
                  <PickMenu lot={r.lot} mark={fb.marks.get(r.lot.id)} onMark={fb.mark} at={i} />
                </div>
              )))}
          </div>
        ) : (
          <div className="ray-saved-grid ck-picks">
            {seats.map((r, i) => ('undoSeat' in r
              // the seat spans the grid's row as one slim strip (the grid packs
              // densely around it) — a hidden pick never leaves a blank card slot
              ? <div key={`undo-${r.undoSeat.id}`} className="ck-undoseat"><UndoSeat undo={r.undoSeat} onUndo={fb.undoIt} /></div>
              : (
              // the card fills its row; the pick's feedback rides under it
              <div key={r.lot.id} data-pick data-nav-row className="ray-enter-card" style={{ '--enter-delay': `${Math.min(i, 8) * 60}ms`, display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto' } as React.CSSProperties}>
                <LotCard lot={r.lot} showArtist subjectMaker allLots={compLots} saved={isSaved(r.lot.id)} onToggleSave={onToggleSave}
                  lastCrawl={lastCrawl} note={recNote(r)} />
                <PickFeedback lot={r.lot} mark={fb.marks.get(r.lot.id)} onMark={fb.mark} at={i} />
              </div>
            )))}
          </div>
        )}

        {ready && visible < recs.length && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
            <button className="ray-show-more" onClick={() => setShown(Math.min(recs.length, visible + page))}>
              Show more ({recs.length - visible} more {recs.length - visible === 1 ? 'pick' : 'picks'})
            </button>
          </div>
        )}
        {signedOut && null}
      </div>
      {openLot && <ComparableModal lot={openLot} allLots={compLots} onClose={() => setOpenLot(null)} />}
    </section>
  );
}

type SavedView = 'ledger' | 'cards';
const SAVEDVIEW_KEY = 'lectr-savedview';

/* ── SETTLED — one row implementation for both shells ── */
type SettledRowData =
  | { kind: 'lot'; lot: AuctionLot; date: string }
  | { kind: 'ledger'; o: { id: string; priceUsd: number; saleDate: string; provisional: boolean }; date: string };

const SettledRowView = React.memo(function SettledRowView({ row, meta, owned, savedId, onOwn, onRemove, mobile }: {
  row: SettledRowData;
  meta: SavedMeta | undefined;
  owned: boolean;
  /** the id the save is keyed under — handlers are STABLE and take it back */
  savedId: string;
  onOwn: (savedId: string) => void;
  onRemove: (savedId: string) => void;
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
              {meta?.artist ? makerLineOf({ artist: meta.artist, title: meta.title }).name : 'archive'}
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
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            {o.provisional ? (
              <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>price settling</span>
            ) : (
              <button className="ray-own-btn" data-on={owned} aria-pressed={owned} onClick={() => onOwn(savedId)}>
                {owned ? 'Owned' : 'I won it'}
              </button>
            )}
            <button className="ray-own-x" title="Remove this watch from your desk" aria-label={`Remove watch: ${name}`} onClick={() => onRemove(savedId)}>×</button>
          </div>
        </div>
      );
    }
    return (
      <div className="ray-settled-cols ray-savedrow" style={{ display: 'grid' }}>
        <span className="maker">{meta?.artist ? makerLineOf({ artist: meta.artist, title: meta.title }).name : '—'}</span>
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
        <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          {o.provisional ? (
            <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>—</span>
          ) : (
            <button className="ray-own-btn" data-on={owned} aria-pressed={owned} onClick={() => onOwn(savedId)}>
              {owned ? 'Owned' : 'I won it'}
            </button>
          )}
          <button className="ray-own-x" title="Remove this watch from your desk" aria-label={`Remove watch: ${name}`} onClick={() => onRemove(savedId)}>×</button>
        </span>
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
          <div className="ck-mtitle">{craftTitle(lot.title, lot.auctionHouse)}</div>
        </Link>
        <div className="ck-mline">
          <span className="ck-msub">{makerLineOf(lot).name}</span>
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
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          {pending ? (
            // no price yet — claiming it now would enter a $null piece into
            // the collection; the button arrives with the result
            <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>result pending</span>
          ) : (
            <button className="ray-own-btn" data-on={owned} aria-pressed={owned} onClick={() => onOwn(savedId)}>
              {owned ? 'Owned' : 'I won it'}
            </button>
          )}
          <button className="ray-own-x" title="Remove this watch from your desk" aria-label={`Remove watch: ${craftTitle(lot.title, lot.auctionHouse)}`} onClick={() => onRemove(savedId)}>×</button>
        </div>
      </div>
    );
  }
  return (
    <div className="ray-settled-cols ray-savedrow" style={{ display: 'grid' }}>
      <span className="maker">
        <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
          {makerLineOf(lot).name}
        </Link>
      </span>
      <span className="work">
        <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
          {craftTitle(lot.title, lot.auctionHouse)}
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
      <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {pending ? (
          <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>—</span>
        ) : (
          <button className="ray-own-btn" data-on={owned} aria-pressed={owned} onClick={() => onOwn(savedId)}>
            {owned ? 'Owned' : 'I won it'}
          </button>
        )}
        <button className="ray-own-x" title="Remove this watch from your desk" aria-label={`Remove watch: ${craftTitle(lot.title, lot.auctionHouse)}`} onClick={() => onRemove(savedId)}>×</button>
      </span>
    </div>
  );
});

export default function SavedPage() {
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
  // the reader's taste — saves resolve against whatever book has landed,
  // else their own snapshot (app/lib/use-recs)
  const { taste: recTaste, ready: tasteReady } = useTaste(allLots);

  const [savedView, setSavedView] = useState<SavedView>('ledger');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // the URL is shareable state and wins; localStorage is the memory
      const uv = new URLSearchParams(window.location.search).get('view');
      if (uv === 'cards' || uv === 'ledger') { setSavedView(uv); return; }
      const v = localStorage.getItem(SAVEDVIEW_KEY) ?? localStorage.getItem('ray-savedview');
      if (v === 'cards' || v === 'ledger') setSavedView(v);
    } catch { /* private mode */ }
  }, []);
  const pickView = (v: SavedView) => {
    setSavedView(v);
    try { localStorage.setItem(SAVEDVIEW_KEY, v); } catch { /* private mode */ }
    // round-trip ?view= — seed from the CURRENT search so foreign params and
    // the hash survive; ledger is the default and owns a clean URL
    try {
      const sp = new URLSearchParams(window.location.search);
      if (v === 'ledger') sp.delete('view'); else sp.set('view', v);
      const q = sp.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
    } catch { /* older browsers: state just isn't shareable */ }
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

  /* ── INPUT CRAFT — the /value grammar: j/k walks every [data-nav-row] on
     the page, Enter/Space toggles the row's dossier (native on links).
     Typing surfaces and overlays keep their own keys. ── */
  const [openRow, setOpenRow] = useState<string | null>(null);
  // which collection piece has its cost-basis/note editor open
  const [editPiece, setEditPiece] = useState<string | null>(null);
  const toggleRow = useCallback((id: string) => setOpenRow(o => (o === id ? null : id)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (t?.closest('[role="dialog"],[role="listbox"],[role="menu"]')) return;
      if (document.querySelector('.ray-ck-overlay, .ray-maker-sheet')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'j' && e.key !== 'k') return;
      const rowEls = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-row]'));
      if (!rowEls.length) return;
      // a pick (data-pick) is a wrapper: its card / row button takes focus,
      // so "where am I" is the row that CONTAINS focus (signed-out j/k, R4 P3-14)
      const active = document.activeElement as HTMLElement | null;
      const cur = rowEls.findIndex(r => r === active || (!!active && r.contains(active)));
      const next = e.key === 'j' ? Math.min(cur + 1, rowEls.length - 1) : Math.max(cur - 1, 0);
      const row = rowEls[next];
      const target = row?.hasAttribute('data-pick') ? row.querySelector<HTMLElement>('button, a[href]') ?? row : row;
      target?.focus();
      row?.scrollIntoView({ block: 'nearest' });
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
  const [ledgerState, setLedgerState] = useState<{ ledger: Map<string, LedgerEntry>; loaded: boolean; error: boolean }>({ ledger: new Map(), loaded: false, error: false });
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
  const collection = useMemo(() => {
    const rows = savedLots
      .filter(l => ownedLotIds.has(l.id))
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
              ? `${ARTIST_LABEL[l.artist] || l.artist} ${rb.scope} reference ${formatPrice(rb.q1)}–${formatPrice(rb.q3)} · ${rb.n} sales`
              : `reference ${formatPrice(rb.q1)}–${formatPrice(rb.q3)} · ${rb.n} sales`;
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
    const totalAppraised = rows.reduce((s, r) => s + (r.appraised ?? r.paid ?? 0), 0);
    const appraisedOfPaid = rows.reduce((s, r) => s + (r.paid != null ? (r.appraised ?? r.paid) : 0), 0);
    const deltaPct = totalPaid > 0 ? Math.round((appraisedOfPaid / totalPaid - 1) * 100) : null;
    // pieces the engine actually appraised (a comp pool) — and of those, the
    // ones with a bought price. With none, "appraised vs bought" compares cost
    // with cost (every piece carries at its bought price): no measurement.
    const appraisedN = rows.filter(r => r.appraised != null).length;
    const appraisedPaidN = rows.filter(r => r.appraised != null && r.paid != null && r.paid > 0).length;
    return { rows, totalPaid, totalAppraised, deltaPct, appraisedN, appraisedPaidN };
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
  const summary = useMemo(() => {
    const withEst = upcoming.filter(l => (l.estimateLow || 0) > 0 || (l.estimateHigh || 0) > 0);
    // a sum of estimate MIDPOINTS over the estimate-bearing subset — every
    // surface that prints it labels it so ("at estimate midpoint · N of M
    // lots priced"); a bid-only lot contributes nothing and must say so
    const totalEst = withEst.reduce((s, l) => {
      const lo = l.estimateLow || l.estimateHigh || 0;
      const hi = l.estimateHigh || l.estimateLow || 0;
      return s + (lo + hi) / 2;
    }, 0);
    const priced = withEst.length;
    const flagged = upcoming.filter(l => signalById.get(l.id)?.label === 'Below Market').length;
    const todayIso = localToday();
    const next = upcoming.find(l => l.saleDate && l.saleDate.slice(0, 10) >= todayIso) || null;
    const closesToday = upcoming.filter(l => daysUntil(l.saleDate) === 0).length;
    return { totalEst, priced, flagged, next, closesToday };
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
  const reads = useMemo(() => {
    type Read = { key: string; tag: string; lot: AuctionLot; fact: React.ReactNode; tone?: 'up' | 'hot' };
    const rows: Read[] = [];
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
      .sort((a, b) => daysUntil(a.l.saleDate) - daysUntil(b.l.saleDate))
      .slice(0, 2);
    for (const { l, read } of quiet) {
      const d = daysUntil(l.saleDate);
      rows.push({
        key: `q-${claim(l).id}`, tag: 'Quietest', lot: l,
        fact: <>no bids yet · hammers {d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}{read.entry != null ? <> · opens at {formatPrice(read.entry)}</> : null} · appraised {formatPrice(read.cvu)}{read.anchor === 'fair-est' ? ', at estimate' : ''}</>,
      });
    }
    const soon = upcoming
      .filter(l => !used.has(l.id))
      .filter(l => { const d = daysUntil(l.saleDate); return d >= 0 && d <= TAG_SOON_DAYS; })
      .slice(0, 3);
    for (const l of soon) {
      const d = daysUntil(l.saleDate);
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
            fact: <>{l.cardComps.n} {l.cardComps.n === 1 ? 'sale' : 'sales'}, same card &amp; grade · {formatPrice(l.cardComps.med)} median</>,
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
        fact: <><b style={{ color: 'var(--color-up)', fontVariantNumeric: 'tabular-nums' }}>+{Math.abs(Math.round(sig.pct))}%</b> vs comps{estText ? <> · {estText}</> : null}{!printedBid && (l.currentBid || 0) > 0 ? <> · {formatPrice(l.currentBid!)} bid</> : null}</>,
      });
    }
    return rows.slice(0, 8);
  }, [upcoming, allLots, fullLoaded, signalById]);

  /* ── THE ROOM — the watching ledger with the brief fused in: every row
     carries its reason tag and the ledger sorts action-first. ── */
  const room = useMemo(() => {
    // watchTagOf — the ONE classifier Today's reads shares
    const rows = upcoming.map(l => ({ l, reason: watchTagOf(l, signalById.get(l.id)) }));
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

  /* ── FLIP — the action-first ledger re-ranks when data moves; rows should
     visibly travel, not teleport. BOARD-relative tops (never viewport), a
     forced reflow between offset write and reset (or the transition has no
     painted origin), same-id-set only, settle timers tracked. ── */
  const boardRef = useRef<HTMLDivElement | null>(null);
  const flipPos = useRef<Map<string, number>>(new Map());
  const flipTimers = useRef<number[]>([]);
  const measureBoard = useCallback(() => {
    const board = boardRef.current;
    const next = new Map<string, number>();
    if (board) {
      const boardTop = board.getBoundingClientRect().top;
      board.querySelectorAll<HTMLElement>('[data-flip-id]').forEach(el => {
        next.set(el.dataset.flipId!, el.getBoundingClientRect().top - boardTop);
      });
    }
    return next;
  }, []);
  const flipKey = room.map(r => r.l.id).join('|');
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) { flipPos.current = new Map(); return; }
    const prev = flipPos.current;
    const next = measureBoard();
    flipTimers.current.forEach(t => window.clearTimeout(t));
    flipTimers.current = [];
    const sameSet = prev.size === next.size && Array.from(next.keys()).every(k => prev.has(k));
    if (sameSet && prev.size > 0) {
      const moved: HTMLElement[] = [];
      board.querySelectorAll<HTMLElement>('[data-flip-id]').forEach(el => {
        const id = el.dataset.flipId!;
        const dy = (prev.get(id) ?? 0) - (next.get(id) ?? 0);
        if (Math.abs(dy) > 1) {
          el.style.transition = 'none';
          el.style.transform = `translateY(${dy}px)`;
          moved.push(el);
        }
      });
      if (moved.length) {
        void board.offsetHeight; // reflow — the reset below needs this origin painted
        requestAnimationFrame(() => {
          moved.forEach(el => { el.style.transition = 'transform 420ms var(--ease-signature)'; el.style.transform = ''; });
          flipTimers.current.push(window.setTimeout(() => {
            moved.forEach(el => { el.style.transition = ''; });
          }, 470));
        });
      }
    }
    flipPos.current = next;
  }, [flipKey, measureBoard]);
  // a dossier opening/closing shifts every row below it — re-baseline after
  // the expansion settles or the next sort animates from stale tops
  useEffect(() => {
    const t = window.setTimeout(() => { flipPos.current = measureBoard(); }, 380);
    return () => window.clearTimeout(t);
  }, [openRow, measureBoard]);

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
  const taste = useMemo(() => {
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
  const recsReady = !loading && tasteReady && (!deskNeedsCorpus || fullLoaded || fullError || savedLots.length >= savedIds.length);
  // ONE deal per page: the Today band, the rail's count and the room agree
  const deal = useDeal(allLots, recTaste, recsReady);
  // the picks, then how the ones shown before did (N4, app/profile/outcomes)
  const recsRoom = (signedOut = false) => (
    <>
      <RecsRoom book={allLots} deal={deal} compLots={allLots} taste={recTaste} ready={recsReady} lastCrawl={lastCrawl || undefined}
        isSaved={isSaved} onToggleSave={toggle} signedOut={signedOut} />
      <PickOutcomes book={allLots} />
    </>
  );

  // the one settled count every surface prints (Settled head, the cell room)
  const settledCount = sold.length + soldOrphans.length;

  const hasDeskDetails = summary.totalEst > 0 || changes.moved > 0 || changes.newBids > 0 || taste.length > 0 || !!tenure || !!user;
  const [deskDetails, setDeskDetails] = useState(false);
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
    .filter(l => daysUntil(l.saleDate) === 0)
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

  /* ── THE RAIL — one item per section that renders; counts replace the
     old gauge line's duplicate figures ── */
  const { follows: myFollows } = useFollows();
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
  const railItems: RailItem[] = useMemo(() => {
    const r: RailItem[] = [];
    const forYou: RailItem = { id: 'for-you', label: 'For you', mark: <RankMark size={15} />, count: deal.recs.length || undefined };
    if (watchFirst) r.push({ id: 'watching', label: 'Watching', mark: <WatchMark size={15} />, count: upcoming.length });
    r.push(forYou);
    r.push({ id: 'signals', label: 'Signals', mark: <SignalMark size={15} />, count: myFollows.length || undefined, dot: unseenAlerts > 0 });
    if (deskView && hasRecordRoom) {
      const med = record && record.med != null ? Math.round(record.med) : null;
      r.push({ id: 'record', label: 'Record', mark: <RecordMark size={15} />, count: med != null ? fmtSignedPct(med) : undefined, tone: med != null && med > 0 ? 'up' : med != null && med < 0 ? 'down' : undefined });
    }
    if (deskView && collection.rows.length > 0) r.push({ id: 'collection', label: 'Collection', mark: <CollectionMark size={15} />, count: formatPrice(collection.totalAppraised) });
    if (deskView && (historyCount > 0 || orphanIds.length > 0)) r.push({ id: 'history', label: 'History', mark: <TapeMark size={15} />, count: historyCount || undefined });
    return r;
  }, [deal.recs.length, deskView, watchFirst, upcoming.length, myFollows.length, unseenAlerts, hasRecordRoom, record, collection, historyCount, orphanIds.length]);
  // "Today" leads the rail wherever the band renders — TodayBand's own gate:
  // the return loop answered, or there is an away fact, a closing watch or a read
  const railWith = (band: { away: boolean; closing: number; reads: number }): RailItem[] =>
    (deal.loop || band.away || band.closing > 0 || band.reads > 0)
      ? [{ id: 'today', label: 'Today', mark: <AwayMark size={15} /> }, ...railItems]
      : railItems;

  useHashLanding(recsReady && !loading && authReady && savedReady && (!deskNeedsCorpus || fullLoaded || !!fullError));

  /* ── ACCOUNT — who is signed in, where the desk lives, sign out ── */
  const accountStrip = (
    <section id="account" className="rail ck-account" aria-label="Account">
      <div className="ck-account-in">
        <span className="kicker">Account</span>
        {authEnabled && user ? (
          <span>
            {user.email || 'Signed in'} · your desk syncs to your account ·{' '}
            <button type="button" className="ck-warn-btn ck-account-btn" onClick={() => signOut()}>Sign out</button>
          </span>
        ) : signedOutView ? (
          <span>
            Not signed in — follows, interests and what this device learned stay in this browser ·{' '}
            <button type="button" className="ck-warn-btn ck-account-btn" onClick={() => signInWithGoogle()}>Sign in with Google</button>
          </span>
        ) : authEnabled && !user ? (
          <span>
            Saved on this device — sign in to keep your saves, follows, record and collection on every device ·{' '}
            <button type="button" className="ck-warn-btn ck-account-btn" onClick={() => signInWithGoogle()}>Sign in with Google</button>
          </span>
        ) : (
          <span>Saved on this device</span>
        )}
        <a href="#on-device" className="ck-away-link">Clear on-device signals</a>
      </div>
      {/* notifications for this device — renders nothing until push is configured */}
      <PushOptIn />
      <TrackOnMount event="profile_view" onceKey="profile" />
    </section>
  );

  // the ghost desk — what this page becomes, before it has data
  const ghost = (
    <div className="ck-ghost" aria-hidden>
      <div className="ck-ghost-row"><span className="kicker">Watching</span><span>your live lots · signals + bids tracked to the hammer</span></div>
      <div className="ck-ghost-row"><span className="kicker">Your record</span><span>every settled watch judged vs its estimate — your eye, measured</span></div>
      <div className="ck-ghost-row"><span className="kicker">Collection</span><span>the pieces you own, appraised against the live market nightly</span></div>
    </div>
  );

  const emptyState = (
    <>
      <section id="desk" className="rail ray-enter ck-desk" style={{ paddingTop: 24 }}>
        <Masthead
          kicker={deskKicker}
          serial={lastCrawl || undefined}
          title={<>Your desk at <Accent>the auction</Accent>.</>}
          sub="Bookmark a lot anywhere on lectr and it tracks here to the hammer — comps, signals, your record once it settles, your collection when you win."
        />
      </section>
      <PillRail items={railWith({ away: unseenAlerts > 0 && !!awayLine, closing: 0, reads: 0 })} />
      <TodayBand loop={deal.loop} closingWatches={[]} reads={[]} away={unseenAlerts > 0 ? awayLine : null} />
      {recsRoom()}
      <YourSignals book={allLots} signedOut={authEnabled && !user} />
      <section className="rail ray-enter" style={{ paddingTop: 34 }}>
        <div className="ns-plate" style={{ paddingTop: 18 }}>
          <h2 className="ray-h2" style={{ margin: 0 }}>What else this page becomes</h2>
          {ghost}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: '26px 0 24px' }}>
            <Link href="/value" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
              Start with today&rsquo;s below-market lots
            </Link>
            <Link href="/" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none', display: 'inline-block' }}>
              Browse the markets
            </Link>
          </div>
        </div>
      </section>
      {accountStrip}
    </>
  );

  return (
    <div className="terminal-shell ck-page" style={{ minHeight: '100vh', fontFamily: 'var(--font-sans), sans-serif' }}>
      <ArtistNav activeSlug="saved" savedCount={badgeCount} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {signedOutView ? (
        <RayEntrance animate>
          <section id="desk" className="rail ray-enter ck-desk" style={{ paddingTop: 24 }}>
            <Masthead
              kicker="My desk"
              title={<>Your desk at <Accent>the auction</Accent>.</>}
              sub={tunedLine ?? 'Tell lectr what you collect and live lots tied to it land below.'}
            />
          </section>
          <PillRail items={railWith({ away: false, closing: 0, reads: 0 })} />
          <TodayBand loop={deal.loop} closingWatches={[]} reads={[]} away={null} />
          {recsRoom(true)}
          {/* the slim sign-in line — after value, never before it */}
          <section className="rail ray-enter">
            <div className="ck-signin">
              {/* a cold visit's one primary action is the quick start — sign-in
                  rides as a text link under it, never a second black button */}
              {coldOut ? (
                <button type="button" className="ck-warn-btn ck-account-btn" onClick={() => signInWithGoogle()}>Sign in with Google</button>
              ) : (
                <button className="ray-call-btn ray-call-btn-primary" style={{ border: 'none', cursor: 'pointer' }} onClick={() => signInWithGoogle()}>
                  Sign in with Google
                </button>
              )}
              <span>to keep this everywhere — your follows and saves carry over. Free · one tap · nothing on lectr is gated.</span>
            </div>
          </section>
          <YourSignals book={allLots} signedOut />
          <section className="rail ray-enter" style={{ paddingTop: 34, paddingBottom: 8 }}>
            <div className="ns-plate" style={{ paddingTop: 18 }}>
              <div className="ns-split" style={{ marginBottom: 6 }}>
                <h2 className="ray-h2" style={{ margin: 0 }}>What else this page becomes</h2>
                <p>Watch lots to the hammer, keep your track record, and hold your collection against the engine&rsquo;s live appraisal. Private to you, synced everywhere.</p>
              </div>
              {ghost}
            </div>
          </section>
          {accountStrip}
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
          {/* ══ 0 · THE MASTHEAD — compressed: title + one sub-line; the rest
              of the old sub-line lives in Desk details ══ */}
          <section id="desk" className="rail ray-enter ck-desk" style={{ paddingTop: 24 }}>
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
                  : upcoming.length > 0
                  ? <>
                      Watching <Accent>{upcoming.length} {upcoming.length === 1 ? 'lot' : 'lots'}</Accent> to the hammer.
                    </>
                  // nothing live: the desk is a record, not a watch — falling
                  // back to savedLots.length claimed "Watching 3 lots to the
                  // hammer" over a sub-line that said "0 live lots"
                  : <>Your desk: <Accent>{savedLots.length} settled {savedLots.length === 1 ? 'watch' : 'watches'}</Accent>, judged below.</>}
              sub={
                <>
                  {summary.next && (
                    <>Next hammer {hammerWord(daysUntil(summary.next.saleDate))}
                      {summary.next.saleDateTime && <CloseClock iso={summary.next.saleDateTime} windowHours={24} prefix=" · " />}
                      {' '}·{' '}
                    </>
                  )}
                  {upcoming.length} live {upcoming.length === 1 ? 'lot' : 'lots'}
                  {summary.flagged > 0 && (
                    <>
                      {' '}·{' '}
                      {/* a count of flags, not a market direction — ink (lamp law) */}
                      <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {summary.flagged} below market
                      </b>
                    </>
                  )}
                  {hasDeskDetails && (
                    <>
                      {' '}·{' '}
                      <button type="button" className="ck-deskdetails-btn" aria-expanded={deskDetails} aria-controls="desk-details"
                        onClick={() => setDeskDetails(v => !v)}>Desk details</button>
                    </>
                  )}
                </>
              }
            />
            {/* the rest of the old sub-line — coverage, moves, taste, tenure */}
            {hasDeskDetails && deskDetails && (
              <div className="ck-deskdetails" id="desk-details">
                <p>
                  {summary.totalEst > 0 && <>{formatPrice(summary.totalEst)} at estimate midpoint · {summary.priced} of {upcoming.length} lots priced</>}
                  {(changes.moved > 0 || changes.newBids > 0) && (
                    <>
                      {summary.totalEst > 0 ? ' · ' : ''}since you saved
                      {changes.moved > 0 && <> · {changes.moved} {changes.moved === 1 ? 'signal' : 'signals'} moved</>}
                      {changes.newBids > 0 && <> · {changes.newBids} new {changes.newBids === 1 ? 'bid' : 'bids'}</>}
                    </>
                  )}
                  {taste.length > 0 && <> · you watch {taste.join(' · ')}</>}
                  {tenure && <> · since {tenure}</>}
                  {authEnabled && user && <> · signed in as {user.email || 'you'} · <a href="#account" className="ck-away-link">Account</a></>}
                </p>
              </div>
            )}

            {/* partial phase-2 failure — say so where the data would be */}
            {partialLoadFailed && (
              <div className="ck-warn ray-enter" role="status">
                Couldn&apos;t load the archive that resolves your concluded lots —{' '}
                {savedIds.length - savedLots.length > 0
                  ? <>{savedIds.length - savedLots.length} of your {savedIds.length} saved {savedIds.length === 1 ? 'watch is' : 'watches are'} not shown, and </>
                  : null}
                settled results and appraisals are incomplete.{' '}
                <button className="ck-warn-btn" onClick={() => retryFullLoad()}>Try again</button>
              </div>
            )}
          </section>

          <PillRail items={railWith({ away: !!awayLine, closing: closingWatches.length, reads: reads.length })} />

          {/* ══ 1 · TODAY — new since, closing tonight, today's reads; the
              away facts ride its header line ══ */}
          <TodayBand loop={deal.loop} closingWatches={closingWatches} reads={reads} away={awayLine} />

          {/* ══ 2 · LOTS YOU MAY LIKE — first only when nothing is live on the
              desk; a reader with live watches sees their own lots first ══ */}
          {!watchFirst && recsRoom()}

          {/* ══ 3 · WATCHING — the room, action-first, brief fused in ══ */}
          {upcoming.length > 0 && (
            <section id="watching" className="ray-saved-section rail" data-view={savedView}>
              {/* the room as a framed plate — ns-plate draws the top rule + crop marks */}
              <div className="ns-plate" style={{ paddingTop: 18 }}>
              <div className="ray-enter" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px 14px', flexWrap: 'wrap', marginBottom: 16 }}>
                <h2 className="ray-h2" style={{ margin: 0 }}><span className="ray-sect-mark" aria-hidden><WatchMark size={17} /></span>Watching · on the block</h2>
                <div className="ray-savedview-toggle" role="group" aria-label="Watching view">
                  <button className="ray-savedview-btn" data-active={savedView === 'ledger'} aria-pressed={savedView === 'ledger'} onClick={() => pickView('ledger')}>Ledger</button>
                  <button className="ray-savedview-btn" data-active={savedView === 'cards'} aria-pressed={savedView === 'cards'} onClick={() => pickView('cards')}>Cards</button>
                </div>
                <HelpChip name="Watching">
                  Every bookmarked lot still on the block, sorted action-first: lands soon, then flagged below
                  market, then bid momentum, then quiet. Click a row (or press Enter on it) to open its dossier
                  in place — <b>j</b>/<b>k</b> walks the rows. The tag on each row says why it needs you now.
                </HelpChip>
              </div>
              {/* desktop ledger */}
              <div className="ray-saved-ledger ray-enter" ref={boardRef}>
                <div className="ray-saved-cols ray-saved-ledger-head">
                  <span className="kicker">Why now</span>
                  <span className="kicker">Work</span>
                  <span className="kicker r">Est</span>
                  <span className="kicker r"><Term k="signal now">Signal now</Term></span>
                  <span className="kicker r"><Term k="delta saved">Δ saved</Term></span>
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
                  const open = openRow === lot.id;
                  return (
                    <div key={lot.id} data-flip-id={lot.id}>
                      {/* the row is the dossier's handle — the work title still
                          deep-links; everything else opens in place */}
                      <div
                        role="button" tabIndex={0} data-nav-row aria-expanded={open}
                        className="ray-saved-cols ray-savedrow ck-expandrow"
                        onClick={() => toggleRow(lot.id)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(lot.id); } }}
                      >
                        <span className="ck-why">
                          {reason && <span className="ck-tag" data-tone={reason.tag === 'Below market' ? 'up' : reason.tag === 'Lands soon' ? 'hot' : undefined}>{reason.tag}</span>}
                        </span>
                        <span className="work">
                          {displayMakerOf(lot) && <span className="ck-workmaker">{displayMakerOf(lot)!.name}</span>}
                          <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} style={{ color: 'inherit', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>
                            {craftTitle(lot.title, lot.auctionHouse)}
                          </Link>
                        </span>
                        <span className="num">{formatEstimate(lot) || '—'}</span>
                        <span className="num" style={sig ? { color: sigInk(sig.label), fontWeight: 700 } : { color: 'var(--color-text-faint)' }}
                          aria-label={sig ? `${sig.label}, ${Math.abs(Math.round(sig.pct))} percent` : 'no signal'}>
                          {sig ? sigText(sig) : '—'}
                        </span>
                        <span className="num" style={{ color: flipped ? 'var(--color-text-muted)' : dInk }}>
                          {flipped ? 'flipped' : dPP != null && dPP !== 0 ? `${dPP > 0 ? '+' : '−'}${Math.abs(dPP)}pp` : '—'}
                          {vel ? (
                            <span className="sub">+{vel.delta} {vel.delta === 1 ? 'bid' : 'bids'}/{Math.round(vel.hours)}h</span>
                          ) : newBids > 0 ? (
                            <span className="sub">+{newBids} {newBids === 1 ? 'bid' : 'bids'}</span>
                          ) : null}
                        </span>
                        <span style={{ textAlign: 'right', fontSize: 13, color: days === 0 ? 'var(--color-fg)' : 'var(--color-text-secondary)', fontWeight: days <= 1 ? 600 : 500, whiteSpace: 'nowrap' }}>
                          {days === 0 && lot.saleDateTime
                            ? <CloseClock iso={lot.saleDateTime} windowHours={24} />
                            : hammerWord(days)}
                        </span>
                      </div>
                      {open && (
                        <RowDossier lot={lot} meta={m} sig={sig} allLots={allLots} fullLoaded={fullLoaded}
                          onRemove={() => { setOpenRow(null); toggle(savedIdOf(lot.id)); }} />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* mobile: the glance rows — same facts, thumb scale */}
              <div className="ck-mledger ray-enter">
                {room.map(({ l: lot, reason }) => {
                  const sig = signalById.get(lot.id) ?? null;
                  const days = daysUntil(lot.saleDate);
                  return (
                    <Link key={lot.id} href={`/lot?id=${encodeURIComponent(lot.id)}`} className="ck-mrow" data-nav-row>
                      <span className="ck-mrow-main">
                        <span className="ck-mtitle">{craftTitle(lot.title, lot.auctionHouse)}</span>
                        <span className="ck-msub">
                          {reason && <span className="ck-tag" data-tone={reason.tag === 'Below market' ? 'up' : reason.tag === 'Lands soon' ? 'hot' : undefined}>{reason.tag}</span>}
                          {[displayMakerOf(lot)?.name, formatEstimate(lot)].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="ck-mrow-right">
                        {sig && <b style={{ color: sigInk(sig.label) }} aria-label={`${sig.label}, ${Math.abs(Math.round(sig.pct))} percent`}>{sigText(sig)}</b>}
                        <span className="ck-mham" style={days <= 1 ? { color: 'var(--color-fg)', fontWeight: 600 } : undefined}>
                          {days === 0 && lot.saleDateTime
                            ? <CloseClock iso={lot.saleDateTime} windowHours={24} />
                            : hammerWord(days)}
                        </span>
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
              </div>
            </section>
          )}

          {/* ══ 3b · LOTS YOU MAY LIKE — after Watching on a live desk ══ */}
          {watchFirst && recsRoom()}

          {/* ══ 4 · YOUR SIGNALS — follows, saved searches + inbox, what this
              device learned ══ */}
          <YourSignals book={allLots} signedOut={authEnabled && !user} />

          {/* ══ 5 · YOUR RECORD — the figures row (once), the receipt, the
              timeline ══ */}
          {hasRecordRoom && (
            <section id="record" className="ray-saved-section rail ray-enter" aria-label="Your record">
              <div className="ns-plate" style={{ paddingTop: 18 }}>
                <div className="ck-room-head" style={{ marginBottom: 16 }}>
                  <h2 className="ray-h2" style={{ margin: 0 }}><span className="ray-sect-mark" aria-hidden><RecordMark size={17} /></span>Your record</h2>
                  <HelpChip name="Your record">
                    <b>Appraised vs bought</b>: the engine&rsquo;s appraisal of your pieces against what you paid — only pieces with a
                    recorded price enter the read. <b>Your record</b>: each settled watch judged against its estimate, median, all-in.
                    The signed figure is green only when it is a real gain, red only when it is a real loss; with no signed read
                    yet it stays ink. <b>Collection</b>: pieces held, at the engine&rsquo;s appraisal — pieces without a usable comp
                    pool carry at their bought price. <b>On the block</b>: your live watches, at estimate midpoint over the lots
                    that carry one. <b>Settled</b>: every watch that has hammered — the line-item receipts are under History.
                  </HelpChip>
                </div>
                {/* THE DESK IN FIGURES — one forced-color cell carries the
                    desk's signed read (collection.deltaPct / record.med exactly
                    as computed; zero or none → ink abstention); the quiet cells
                    are counts the page prints nowhere else now */}
                <CellGrid min={200} className="ck-cells ck-figs">
                  {/* the lead is a MEASUREMENT: appraised vs bought only once ≥1
                      piece with a bought price has a comp-based appraisal;
                      until then the record's median vs estimate leads */}
                  {collection.deltaPct != null && collection.totalPaid > 0 && collection.appraisedPaidN > 0 ? (
                    <ColorCell
                      dir={collection.deltaPct > 0 ? 'up' : collection.deltaPct < 0 ? 'down' : 'ink'}
                      stat={fmtSignedPct(collection.deltaPct)}
                      label="Appraised vs bought"
                      body={`${formatPrice(collection.totalAppraised)} vs ${formatPrice(collection.totalPaid)} bought`}
                      href="#collection"
                    />
                  ) : record && record.med != null ? (
                    <ColorCell
                      dir={record.med > 0 ? 'up' : record.med < 0 ? 'down' : 'ink'}
                      stat={fmtSignedPct(Math.round(record.med))}
                      label="Your record"
                      body={`${record.n} judged · median vs estimate`}
                      href="#settled"
                    />
                  ) : (
                    <ColorCell dir="ink" stat="—" label="Your record" body="No signed read yet" />
                  )}
                  {collection.rows.length > 0 && (
                    <Cell
                      stat={collection.rows.length.toLocaleString()}
                      statNote={collection.rows.length === 1 ? 'piece held' : 'pieces held'}
                      label="Collection"
                      body={collection.appraisedN > 0
                        ? `${formatPrice(collection.totalAppraised)} at appraisal`
                        : `Not appraised yet · 0 of ${collection.rows.length} ${collection.rows.length === 1 ? 'piece has' : 'pieces have'} comps`}
                      href="#collection"
                    />
                  )}
                  {upcoming.length > 0 && (
                    <Cell
                      stat={upcoming.length.toLocaleString()}
                      statNote="watching, live"
                      label="On the block"
                      body={summary.totalEst > 0 ? `${formatPrice(summary.totalEst)} at est. midpoint${summary.flagged > 0 ? ` · ${summary.flagged} below market` : ''}` : 'tracked to the hammer'}
                      href="#watching"
                    />
                  )}
                  {settledCount > 0 && (
                    <Cell
                      stat={settledCount.toLocaleString()}
                      statNote={settledCount === 1 ? 'settled watch' : 'settled watches'}
                      label="Settled"
                      body={record ? `${record.n} judged · ${formatPrice(record.realized)} realized` : 'awaiting judgment'}
                      href="#settled"
                    />
                  )}
                </CellGrid>
                {record && record.med != null && (
                  <div className="ck-record" style={{ marginTop: 26 }}>
                    <div className="ck-record-lead">
                      <span className="kicker">Median vs estimate</span>
                      <span className="ck-record-fig" style={{ color: record.med > 0 ? 'var(--color-up)' : record.med < 0 ? 'var(--color-down-text)' : 'var(--color-fg)' }}>
                        {fmtSignedPct(Math.round(record.med))}
                      </span>
                      <span className="ck-record-s">
                        {record.n} {record.n === 1 ? 'watch' : 'watches'} <Term k="judged">judged</Term> <Term k="vs estimate">vs estimate</Term> · median, all-in · {formatPrice(record.realized)} realized ·{' '}
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
                    <RecordTimeline series={record.series} />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ══ 5 · COLLECTION — the certificate for what you own ══ */}
          {collection.rows.length > 0 && (
            <div id="collection" className="ray-band ray-enter" style={{ marginTop: 30, paddingBlock: '28px 30px' }}>
              <section className="rail" aria-label="Your collection">
                <h2 className="ray-h2" style={{ margin: 0 }}><span className="ray-sect-mark" aria-hidden><CollectionMark size={17} /></span>Your collection</h2>
                {/* the certificate's provenance ledger — gray label over black
                    value, dotted closing rule; the signed delta keeps its ink */}
                <div className="ns-byline" style={{ margin: '14px 0 2px' }}>
                  <div>
                    <div className="k">Pieces</div>
                    <div className="v">{collection.rows.length}</div>
                  </div>
                  {collection.totalPaid > 0 && (
                    <div>
                      <div className="k">Bought</div>
                      <div className="v">{formatPrice(collection.totalPaid)}</div>
                    </div>
                  )}
                  <div>
                    <div className="k">lectr appraisal</div>
                    <div className="v">{formatPrice(collection.totalAppraised)}</div>
                  </div>
                  {collection.deltaPct != null && collection.deltaPct !== 0 && collection.appraisedPaidN > 0 && (
                    <div>
                      <div className="k">Appraised vs bought</div>
                      <div className="v" style={{ fontWeight: 600, color: collection.deltaPct > 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>
                        {fmtSignedPct(collection.deltaPct)}
                      </div>
                    </div>
                  )}
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
                            {drillLabelOf(row.slug, row.label)} <Flick size={9} style={{ marginLeft: 2 }} />
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

                <div className="kicker ck-piece-head" style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '14px 0 6px', color: 'var(--paper-muted, var(--color-text-muted))' }}>
                  <div style={{ flex: 1 }}>Piece</div>
                  <div style={{ width: 92, textAlign: 'right' }}>Bought</div>
                  <div style={{ width: 128, textAlign: 'right' }}><Term k="appraisal">lectr appraisal</Term></div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {collection.rows.map(({ lot, paid, paidIsOverride, note, savedId, appraised, basis, deltaPct, drill, drillSlug }) => (
                    <React.Fragment key={lot.id}>
                      {/* the spec-sheet row — dotted hairline ledger (ns-ledger-row);
                          a phone stacks it: title (2 lines), meta, then
                          Bought · Appraisal side by side with their labels */}
                      <div className="ns-ledger-row ck-piece" style={{ gap: 12 }}>
                        <div className="ck-piece-main">
                          <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                            <div className="ck-piece-title">{craftTitle(lot.title, lot.auctionHouse)}</div>
                          </Link>
                          <div className="ck-piece-meta">
                            <span>{[makerLineOf(lot).name, labelLineOf(lot), lot.auctionHouse, lot.saleDate ? formatDate(lot.saleDate) : ''].filter(Boolean).join(' · ')}</span>
                            {drill && drillSlug && (
                              <Link href={`/sub/${drillSlug.replace(':', '/')}`} className="ray-coll-chip">{drillLabelOf(drillSlug, drill.label)}</Link>
                            )}
                            <button type="button" className="ck-piece-editbtn"
                              aria-expanded={editPiece === lot.id}
                              aria-label={`Edit cost basis and note for ${craftTitle(lot.title, lot.auctionHouse)}`}
                              onClick={() => setEditPiece(p => (p === lot.id ? null : lot.id))}>
                              {paidIsOverride || note ? 'edit' : 'set what you paid'}
                            </button>
                          </div>
                          {note && <div className="ck-piece-note">{note}</div>}
                        </div>
                        <div className="ck-piece-paid"
                          title={paidIsOverride ? 'Your recorded cost basis' : 'Realized price — set what you paid to override'}>
                          <span className="ck-piece-k kicker">Bought</span>
                          {paid != null ? formatPrice(paid) : '—'}
                          {paidIsOverride && <span className="ck-piece-basis">your basis</span>}
                        </div>
                        <div className="ck-piece-appr">
                          <span className="ck-piece-k kicker">Appraisal</span>
                          <div className="ck-piece-v">
                            {appraised != null ? formatPrice(appraised) : '—'}
                            {deltaPct != null && deltaPct !== 0 && (
                              <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 600, color: deltaPct > 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>
                                {deltaPct > 0 ? '+' : '−'}{Math.abs(deltaPct)}%
                              </span>
                            )}
                          </div>
                          <div className="ck-piece-src">
                            {basis ?? (fullLoaded ? 'no comps yet' : fullError ? 'couldn’t load comps' : 'appraising…')}
                          </div>
                        </div>
                      </div>
                      {editPiece === lot.id && (
                        <PieceEditor paid={paidIsOverride ? paid : null} note={note}
                          onSave={patch => setSavedFields(savedId, patch)}
                          onClose={() => setEditPiece(null)} />
                      )}
                    </React.Fragment>
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

          {/* ══ 7 · HISTORY — settled receipts, concluded & other, no longer
              on the block ══ */}
          {(settledCount > 0 || other.length > 0 || orphanIds.length > 0) && (
          <div id="history" className="ck-history">
          {/* ══ 6 · SETTLED — the line-item receipts ══ */}
          {(sold.length > 0 || soldOrphans.length > 0) && (
            <section id="settled" className="ray-saved-section rail ray-enter" style={{ '--enter-delay': '90ms' } as React.CSSProperties}>
              <div className="ns-plate" style={{ paddingTop: 18 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px 14px', flexWrap: 'wrap', marginBottom: 4 }}>
                {/* the rail's "History" lands here — one name for one room */}
                <h2 className="ray-h2" style={{ margin: 0 }}><span className="ray-sect-mark" aria-hidden><TapeMark size={17} /></span>History</h2>
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
                <div className="ray-settled-cols ray-settled-head kicker" style={{ padding: '0 2px 8px' }}>
                  <span>Maker</span>
                  <span>Work</span>
                  <span style={{ textAlign: 'right' }}>Est</span>
                  <span style={{ textAlign: 'right' }}>Your call</span>
                  <span style={{ textAlign: 'right' }}>Realized</span>
                  <span style={{ textAlign: 'right' }}><Term k="vs estimate">vs est</Term></span>
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
                      owned={row.kind === 'lot' ? ownedLotIds.has(row.lot.id) : ownedIdSet.has(row.o.id)}
                      savedId={row.kind === 'lot' ? savedIdOf(row.lot.id) : row.o.id}
                      onOwn={onSettledOwn}
                      onRemove={onSettledRemove}
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
                      owned={row.kind === 'lot' ? ownedLotIds.has(row.lot.id) : ownedIdSet.has(row.o.id)}
                      savedId={row.kind === 'lot' ? savedIdOf(row.lot.id) : row.o.id}
                      onOwn={onSettledOwn}
                      onRemove={onSettledRemove}
                      mobile
                    />
                  );
                })}
              </div>
              </div>
            </section>
          )}

          {other.length > 0 && (
            <section className="ray-saved-section rail ck-fold-section">
              <details className="ns-plate ck-fold" open={isDesktop !== false}>
                <summary className="ck-fold-sum">
                  <h2 className="ray-h2" style={{ margin: 0 }}><span className="ray-sect-mark" aria-hidden><ArchiveMark size={17} /></span>Concluded &amp; other</h2>
                  <span className="ck-fold-n">{other.length}</span>
                </summary>
                <p className="ck-fold-dek">
                  Saved lots that closed without a published hammer, were bought in, or are awaiting results.
                </p>
                <div className="ray-saved-grid" style={{ display: 'grid' }}>
                  {other.map((lot, i) => (
                    <div key={lot.id} className="ray-enter-card" style={{ '--enter-delay': `${Math.min(i, 8) * 60}ms` } as React.CSSProperties}>
                      <LotCard lot={lot} showArtist allLots={allLots} saved={isSaved(savedIdOf(lot.id)) || isSaved(lot.id)} onToggleSave={onCardToggle} />
                    </div>
                  ))}
                </div>
              </details>
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
            <section className="ray-saved-section rail ray-enter ck-fold-section">
              <details className="ns-plate ck-fold" open={isDesktop !== false}>
                <summary className="ck-fold-sum">
                  <h2 className="ray-h2" style={{ margin: 0 }}><span className="ray-sect-mark" aria-hidden><HorizonMark size={17} /></span>No longer on the block</h2>
                  <span className="ck-fold-n">{goneOrphans.length}</span>
                </summary>
                <p className="ck-fold-dek">
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
                              {m.artist && <>, {makerLineOf({ artist: m.artist, title: m.title }).name}</>}
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
              </details>
            </section>
          )}
          </div>
          )}

          {accountStrip}
        </RayEntrance>
      )}
      <Colophon record={null} />
    </div>
  );
}
