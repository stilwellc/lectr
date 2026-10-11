'use client';

import { useCallback, useEffect, useInsertionEffect, useMemo, useRef, useState } from 'react';
import { encodeRefPath } from '../ref/ref-path';
import { drillRowFor, drillSlugFor } from '../lib/submarkets';
import { makerLineOf, catSubLineOf, drillLabelOf } from '../lib/lot-labels';
import { cardBadgesOf } from '../lib/facets';
import { loadCompEvidence, evRowsToLots } from '../lib/comp-evidence';
import { loadLotPack, loadLotFromShard, loadPageStats, loadMakerLots, packRowsToLots, type LotPack } from '../lib/page-data';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import { ARTIST_LABEL, ARTIST_MARKET } from '../constants';
import { useFullLotsOnDemand, useVisibilityTrigger, useSoldArchive, retryFullLoad, retryArchiveLoad, settleLiveRow } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { useLearnVisit } from '../lib/recs-signals';
import { useRefs } from '../hooks/useRefs';
import { safeHref } from '../lib/safe-href';
import { closeDayOf, isLiveUpcoming, localToday, splitTitle, deglue, formatDate, craftTitle, httpsImg, sizedImg, cleanText, getUpcomingCounts, houseColors, refLabel } from '../utils';
import { isSportsScienceObject, FORM_LABEL, signalMagnitude, scienceReferenceBand, cultureReferenceBand, contextComps } from '../lib/comps';
import { enginePoolOf } from '../lib/engine-pool';
import { lotFace, fmtFace, medianRowId, FACE_LABEL, projectedCloseFace } from '../lib/lot-face';
import { lotAllInFactor } from '../lib/premiums';
import { lotFloor } from '../lib/verdict';
import { formatEstimate, lotSignal, confidenceMeter } from './LotCard';
import { daysWord, Colophon } from './Terminal';
import ArtistNav from './ArtistNav';
import FollowButton from './FollowButton';
import { lotFollowOf } from '../lib/lot-follow';
import Flick from './Flick';
// hotlinked photo that unmounts on failure so the monogram plate under it shows
import PlateImg from './PlateImg';
import { crossSibs } from '../lib/fold';
import { playerHrefOf } from '../lib/entity/aliases';
import { parseCard } from '../lib/cards';
import { editionIdentityKey, isEditionLot } from '../lib/identity';
import { addLotToCalendar } from '../lib/remind';
import { closeMs as houseCloseMs, closeIsTimed } from '../lib/house-tz';
import DecisionLine, { decisionLineShows } from './DecisionLine';
import { decisionOf } from '../lib/lot-face';
import { ladderBasisText, rungView, valueRowFlags } from '../lib/card-record';
import { COPY_BTN_STYLE_ID, COPY_BTN_CSS, LOTPAGE_CSS } from './lotpage-css';

/**
 * LotPage — one lot as a CATALOGUE PAGE in the north-star grammar: the
 * matted photograph plate (monogram fallback, CallPlate's pattern) beside a
 * certificate column — quiet sentence-case head, light-display title, the
 * ns-byline provenance ledger (House / Hammers / the money / Category), the
 * engine's read as a compact ns-cell-color face (lamp-lawful: up only for a
 * real Below Market call, ink otherwise), dotted .ns-ledger-row spec rows,
 * the comp pool as dotted ledger rows under kicker + light headline plates,
 * and the CTA row (view at house / save / copy permalink). Serves BOTH
 * permalink shapes:
 *   /lot?id=<id>        — universal client resolution from the served data
 *   /lot/<id> (static)  — the flagged set, prerendered with initialLot so the
 *                         first paint (and the crawler) sees real content.
 * Sold lots print the realized price, never ask-forward framing; lots past
 * their hammer with no result say "results pending".
 */

/** THE VALUE FLOOR a reader may bid against — lanes.ts valueFloor, the ONE
 *  floor rule (value.low only at non-low confidence, else 0.85 × the exact-
 *  card median at n ≥ 3). The old read here took value.low at ANY confidence
 *  and cardComps.med at n = 1, so "Max bid" and "still under the floor"
 *  leaned on a floor the engine itself would not certify. */
function gatedFloor(lot: AuctionLot): number | null {
  return lotFloor(lot);
}

/** (W23) THE LOT PAGE'S MONEY IN ONE FORMAT — lot-face fmtFace, the figure
 *  the decision line, the value and the max bid print — with estimate-text's
 *  wording (formatEstimate / estimateOnly) but never its whole-K rounding: a
 *  $1,272 bid read "$1K bid", its all-in "$2K", beside "projected close
 *  ~$3.3K"; one Bonhams estimate read "$7K–$9K est." in the byline and
 *  "estimate $6.9K–$9.2K" in the decision line under it. */
const foldText = (t: string | null | undefined): string =>
  String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function estimateFaceOnly(lot: AuctionLot): string {
  const lo = lot.estimateLow || 0, hi = lot.estimateHigh || 0;
  if (lo > 0 && hi > 0) { const a = fmtFace(lo), b = fmtFace(hi); return a === b ? a : `${a}–${b}`; }
  if (lo > 0) return `from ${fmtFace(lo)}`;
  if (hi > 0) return `to ${fmtFace(hi)}`;
  return '—';
}
function estimateFace(lot: AuctionLot): string {
  if (lot.estimateLow && lot.estimateHigh) return `${estimateFaceOnly(lot)} est.`;
  // a bid sale's live bid is the honest number (formatEstimate's rule)
  if (lot.currentBid && lot.currentBid > 0) {
    return `${fmtFace(lot.currentBid)} bid${lot.bidCount ? ` · ${lot.bidCount} ${lot.bidCount === 1 ? 'bid' : 'bids'}` : ''}`;
  }
  if (lot.estimateLow || lot.estimateHigh) return `${estimateFaceOnly(lot)} est.`;
  return formatEstimate(lot);
}

// (W27) re-exported for importers that still read it from here
export { LOTPAGE_CSS };

const SITE = 'https://lectr.bid';
export function lotPermalink(id: string): string {
  return `${SITE}/lot?id=${encodeURIComponent(id)}`;
}

/** The share affordance: copies the universal permalink, confirms for 1.5s.
    Butter outline — the accent family, never green/red. */
export function CopyLinkButton({ id, style, compact }: {
  id: string; style?: React.CSSProperties;
  /** "Copy" — the lot page's five-button row fits one desktop line */
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useInsertionEffect(() => {
    if (document.getElementById(COPY_BTN_STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = COPY_BTN_STYLE_ID;
    el.textContent = COPY_BTN_CSS;
    document.head.appendChild(el);
  }, []);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const onCopy = async () => {
    const url = lotPermalink(id);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard API denied (http, permissions) — the textarea fallback
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* nothing left to try */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button type="button" className="lectr-lot-copy" data-copied={copied} onClick={onCopy} style={style} title={compact ? 'Copy link' : undefined} aria-live="polite">
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M5.75 8.25a2.5 2.5 0 003.54 0l2.5-2.5a2.5 2.5 0 10-3.54-3.54l-1 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M8.25 5.75a2.5 2.5 0 00-3.54 0l-2.5 2.5a2.5 2.5 0 103.54 3.54l1-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      )}
      {copied ? 'Copied' : compact ? 'Copy' : 'Copy link'}
    </button>
  );
}

/** One certificate spec row in the north-star ledger grammar: label left,
    sub + value right, dotted hairline between rows (.ns-ledger-row). Tone
    stays lamp-lawful — up/down only ever carry the signal's own direction. */
/** a sub past this many characters cannot sit beside label + figure on a
    phone (≈150px left at 360) — it rides under them (.lectr-lot-lrow-long) */
const LONG_SUB = 44;
function LeaderRow({ k, v, tone, sub, children }: {
  k: string; v?: string; tone?: 'up' | 'down'; sub?: string; children?: React.ReactNode;
}) {
  return (
    <div className={`ns-ledger-row${sub && sub.length > LONG_SUB ? ' lectr-lot-lrow-long' : ''}`}>
      <span className="lectr-lot-lk">{k}</span>
      <span className="lectr-lot-lval">
        {sub && <span className="lectr-lot-lsub">{sub}</span>}
        <span className={`lectr-lot-lv${tone ? ` ${tone}` : ''}`}>{children ?? v}</span>
      </span>
    </div>
  );
}

/** The phase-3 trigger, isolated so only Goldin-sports/science needs mount it
    (useSoldArchive fetches on mount by contract — the 10MB tier must never
    ride along on an art lot's permalink). Renders nothing. */
function ArchiveProbe({ onState }: {
  onState: (s: { soldArchive: AuctionLot[]; archiveLoaded: boolean; archiveError: boolean }) => void;
}) {
  const { soldArchive, archiveLoaded, archiveError } = useSoldArchive();
  useEffect(() => {
    onState({ soldArchive, archiveLoaded, archiveError });
  }, [soldArchive, archiveLoaded, archiveError, onState]);
  return null;
}

/** The reference certificate row — the /ref dossier link renders ONLY when
    refs.json proves the page exists (dynamicParams=false: every ungated link
    is a potential 404 — A2-3 measured 3/3 watch lots dead). Isolated as a
    child so only watch lots with a reference pay the lazy refs.json fetch
    (useRefs is module-cached; the maker dossier already shares it). While
    refs are unloaded or failed, the row prints the plain label — never a
    maybe-404 link. */
function ReferenceRow({ maker, reference }: { maker: string; reference: string }) {
  const { refs } = useRefs();
  const exists = useMemo(
    // the static page's own truth condition: a refs.json row whose encoded
    // path equals this reference's encoded path (ref-path codec, both sides)
    () => !!refs && refs.some(r => r.maker === maker && encodeRefPath(r.ref) === encodeRefPath(reference)),
    [refs, maker, reference],
  );
  return (
    <LeaderRow k="Reference">
      {exists ? (
        <Link href={`/ref/${maker}/${encodeRefPath(reference)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
          {refLabel(reference)} <Flick size={10} style={{ marginLeft: 2 }} />
        </Link>
      ) : (
        refLabel(reference)
      )}
    </LeaderRow>
  );
}

/** One sold row in the paper-trail sections (same card, same reference, same
    edition) — the comp ledger's row grammar; a row with a lot id links to its
    own certificate. */
function TrailRow({ id, when, house, title, img, price, note }: {
  id?: string | null; when: string; house?: string | null; title?: string | null; img?: string | null; price: number;
  /** a same-card row's meta, in place of "same card, same grade" */
  note?: string;
}) {
  const inner = (
    <>
      {(img || title) && (
        <span className="lectr-lot-comp-thumb" aria-hidden>
          <span>{(craftTitle(title || '') || '?').charAt(0)}</span>
          {img && <PlateImg src={sizedImg(httpsImg(img), 160)} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        </span>
      )}
      <span className="lectr-lot-comp-t">
        <span className="lectr-lot-comp-title" style={{ display: 'block' }}>{title ? craftTitle(title) : when}</span>
        <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>
          {house && <span style={{ color: houseColors[house] || 'var(--color-text-faint)', fontWeight: 600 }}>{house}</span>}
          {title ? `${house ? ' · ' : ''}${when}` : house ? '' : (note ?? 'same card, same grade')}
        </span>
      </span>
      <span className="lectr-lot-comp-p">{fmtFace(price)}</span>
    </>
  );
  return id
    ? <Link href={`/lot?id=${encodeURIComponent(id)}`} className="lectr-lot-comp">{inner}</Link>
    : <span className="lectr-lot-comp" style={{ cursor: 'default' }}>{inner}</span>;
}

/** THE REFERENCE'S OWN RECORD — a watch lot whose reference has a dossier
    (refs.json) shows that reference's most recent sales beside the
    certificate: the exact model, every house, realized prices. Identity is
    the dossier's own (maker + reference, ref-path codec both sides — the
    ReferenceRow's existence test), never similarity. */
function ReferenceSales({ maker, reference, selfId, quietMedian }: {
  maker: string; reference: string; selfId: string;
  /** (W23) the page already prints this lot's comps median — the dossier's
   *  all-sales median (every metal, every dial: Daytona 6265 "$59K median ·
   *  150 sales" over a gold lot's "$78K" comps median) would be a second
   *  median for the same question; the count stays */
  quietMedian?: boolean;
}) {
  const { refs } = useRefs();
  const entry = useMemo(
    () => refs?.find(r => r.maker === maker && encodeRefPath(r.ref) === encodeRefPath(reference)) || null,
    [refs, maker, reference],
  );
  const rows = useMemo(() => (entry?.recent || []).filter(r => r.id !== selfId && r.p > 0).slice(0, 8), [entry, selfId]);
  if (!entry || !rows.length) return null;
  return (
    <section className="lectr-lot-comps lectr-lot-record ns-plate" aria-label="This reference, recent sales">
      <div className="lectr-lot-shead">
        <div>
          <span className="ns-kicker">{refLabel(reference)}</span>
          <h2 className="lectr-lot-h2">This reference, recent sales</h2>
        </div>
        <span className="lectr-lot-shctx">
          {quietMedian
            ? `${entry.n.toLocaleString()} ${entry.n === 1 ? 'sale' : 'sales'} of this reference on file`
            : `${fmtFace(entry.medianUsd)} median · ${entry.n.toLocaleString()} ${entry.n === 1 ? 'sale' : 'sales'}`}
        </span>
      </div>
      <div style={{ marginTop: 6 }}>
        {rows.map(r => (
          <TrailRow key={r.id} id={r.id} title={r.t} house={r.h} img={r.img} price={r.p}
            when={formatDate(r.d, { month: 'short', year: 'numeric' })} />
        ))}
      </div>
      <Link href={`/ref/${maker}/${encodeRefPath(reference)}`} className="lectr-lot-more">
        The {refLabel(reference)} dossier <Flick size={10} />
      </Link>
    </section>
  );
}

/** the ladder rung a card lot sits on ("PSA 8") — the build's own key
    (gradeCo + gradeNum off the title, scripts/build-market) */
function ownRungOf(lot: AuctionLot): string | null {
  const c = parseCard(lot.title || '');
  return c.gradeCo && c.gradeNum != null ? `${c.gradeCo} ${c.gradeNum}` : null;
}

/** the grade ladder folds to the rungs around the lot's own grade past this */
const LADDER_FOLD = 7;

/** The loading state — a certificate-shaped skeleton, no spinners. Also the
    Suspense fallback for the query route. */
export function LotPageSkeleton() {
  return (
    <div className="lectr-lot rail" aria-busy="true" aria-label="Loading lot">
      <style dangerouslySetInnerHTML={{ __html: LOTPAGE_CSS }} />
      <div className="lectr-lot-grid" style={{ paddingTop: 12 }}>
        <div className="ray-plate-mat">
          <div className="ray-plate-img lectr-lot-skel-block" />
          <div className="ray-plate-cap"><span className="lectr-lot-skel-block" style={{ display: 'inline-block', width: 180, height: 10 }} /></div>
        </div>
        <div>
          <div className="lectr-lot-head"><span className="lectr-lot-skel-block" style={{ width: 190, height: 10 }} /></div>
          <div className="lectr-lot-skel-block" style={{ width: '70%', height: 36, marginBottom: 10 }} />
          <div className="lectr-lot-leaders">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="ns-ledger-row">
                <span className="lectr-lot-skel-block" style={{ width: 74, height: 12 }} />
                <span className="lectr-lot-skel-block" style={{ width: 96, height: 12 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function NotOnTheBook({ id }: { id: string }) {
  return (
    <div className="lectr-lot rail" style={{ paddingTop: 60, paddingBottom: 100, textAlign: 'center' }}>
      <style dangerouslySetInnerHTML={{ __html: LOTPAGE_CSS }} />
      <span className="ns-kicker" style={{ marginBottom: 14, fontVariantNumeric: 'tabular-nums' }}>
        {id ? `no. ${id}` : 'no lot number'}
      </span>
      <h1 style={{ fontSize: 'clamp(26px, 4vw, 36px)', fontWeight: 340, letterSpacing: '-0.02em', color: 'var(--color-fg)', margin: '0 0 10px' }}>
        This lot isn&rsquo;t on the book
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', maxWidth: 420, margin: '0 auto 26px', lineHeight: 1.55 }}>
        It may have left the tape — concluded sales roll off as the crawl moves on — or the link may be misprinted.
      </p>
      <Link href="/" className="ray-call-btn ray-call-btn-primary" style={{ textDecoration: 'none' }}>
        Back to the tape <Flick size={11} />
      </Link>
    </div>
  );
}

export default function LotPage({ lotId, initialLot }: {
  lotId: string;
  /** the build-time lot for the static flagged set — first paint is instant
      and the crawler sees real content; live data supersedes it on arrival */
  initialLot?: AuctionLot | null;
}) {
  // LAZY CORPUS (Sep 2026 perf pass). This page used to stream the whole sold
  // corpus (~35MB brotli) on mount — even when the certificate had already
  // resolved from the eager tape, the prerendered initialLot, or the Supabase
  // fast path below, and even for a reader who never scrolled to the comps.
  // Now the corpus is requested only when THIS lot's own stamped fields say
  // the page will compute a number from it (needsCorpusRead), or when the
  // comps section becomes reachable (compsSentinel). Nothing this page can
  // eventually show has been given up — it just arrives on demand.
  const { allLots, loading, fullLoaded, fullError, lastCrawl, market, totalLots, sources, requestFullLots } =
    useFullLotsOnDemand(false);
  const { savedIds, isSaved, toggle } = useSavedLots();
  // Date.now() lives behind mount so SSG HTML (built on another day) never
  // hydrates against a different "in Nd" string.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [imgFailed, setImgFailed] = useState(false);

  const live = useMemo(() => allLots.find(l => l.id === lotId) || null, [allLots, lotId]);

  // Phase-3 sold-archive tier (10MB, Goldin) — mounted ONLY when this page can
  // actually need it: a resolved sports/science object (band pool) or an
  // unresolved goldin-* id after the main corpus finished (sports sold lots
  // live nowhere else). Every archive id is goldin-*, so a fake art id never
  // pays the download to learn it's fake.
  const [archive, setArchive] = useState<{ soldArchive: AuctionLot[]; archiveLoaded: boolean; archiveError: boolean }>({
    soldArchive: [], archiveLoaded: false, archiveError: false,
  });
  // Phase-2 permalink fast path — one indexed row from the Supabase lots
  // table resolves the certificate in ~1KB instead of waiting on the 25MB
  // shard stream. It is also the long memory: rows are upserted nightly and
  // sold rows are kept 24 months, so a permalink keeps resolving well after
  // the lot rolls off the tape. Live shard data supersedes it the moment it
  // arrives.
  const [dbLot, setDbLot] = useState<AuctionLot | null>(null);
  const [dbSettled, setDbSettled] = useState(false);
  useEffect(() => {
    const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const dbAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!lotId || !dbUrl || !dbAnon || live || initialLot) { setDbSettled(true); return; }
    let dead = false;
    fetch(`${dbUrl}/rest/v1/lots?id=eq.${encodeURIComponent(lotId)}&select=data`, {
      headers: { apikey: dbAnon, Authorization: `Bearer ${dbAnon}` },
    })
      .then(r => (r.ok ? r.json() : []))
      .then(rows => { if (!dead && rows?.[0]?.data) setDbLot(rows[0].data as AuctionLot); })
      .catch(() => { /* shards remain the resolution path */ })
      .finally(() => { if (!dead) setDbSettled(true); });
    return () => { dead = true; };
    // one shot per id on mount — live/initialLot arriving later is fine, they win below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotId]);
  // SINGLE-SHARD RESOLUTION (Sep 27 2026): a permalink the eager tape, the
  // prerender and Supabase all missed used to pull the WHOLE corpus (~35MB)
  // to find one row. The build's lot index (pages/lot-idx-XX.json, ~20KB)
  // names the one served shard that carries the id — fetch only that.
  // undefined = looking · null = the index answered "not on the book" ·
  // 'noindex' = no index on this data build (fall back to the corpus).
  const [shardLot, setShardLot] = useState<AuctionLot | null | undefined | 'noindex'>(undefined);
  useEffect(() => {
    if (!lotId || live || initialLot) { setShardLot(null); return; }
    if (loading) return;                       // wait for the crawl stamp (?v=)
    let dead = false;
    loadLotFromShard(lotId, lastCrawl).then(r => {
      if (dead) return;
      setShardLot(r.indexed ? r.lot : 'noindex');
    });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotId, loading]);
  const shardHit = shardLot && shardLot !== 'noindex' ? shardLot : null;
  // (r9, QA4 B1) a row resolved off the eager tape (prerender, Supabase, the
  // per-lot shard) is nightly history: a stale 'upcoming' on a lot the eager
  // book closed out settles to closed (app/lib/live-pool) — never "Current bid"
  const offTape = initialLot || dbLot || shardHit || null;
  const settledOffTape = useMemo(() => (offTape && !loading ? settleLiveRow(offTape) : offTape), [offTape, loading]);
  const preResolved = live || settledOffTape || null;

  // THE LOT PACK: the build-time corpus reads for this upcoming lot (comps,
  // band, appraisal, reference band, provenance) — ~15KB instead of the
  // corpus. undefined = loading · null = no pack (not an upcoming lot, or a
  // data build that predates the emitter → the corpus paths below stand).
  const [pack, setPack] = useState<LotPack | null | undefined>(undefined);
  useEffect(() => {
    if (!lotId) { setPack(null); return; }
    if (loading) return;
    let dead = false;
    loadLotPack(lotId, lastCrawl).then(p => { if (!dead) setPack(p); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotId, loading]);
  const hasPack = !!pack && !fullLoaded;
  // set when no maker shard could answer → the corpus (+ archive) path stands
  const [poolFallback, setPoolFallback] = useState(false);
  const isGoldinId = lotId.startsWith('goldin');
  const wantsArchive =
    (!!preResolved && isSportsScienceObject(preResolved) && pack === null && poolFallback) ||
    (!preResolved && isGoldinId && shardLot === 'noindex' && (fullLoaded || fullError));
  const archiveLot = useMemo(
    () => (!preResolved && archive.archiveLoaded ? archive.soldArchive.find(l => l.id === lotId) || null : null),
    [preResolved, archive.archiveLoaded, archive.soldArchive, lotId],
  );
  const lot = preResolved || archiveLot;
  // on-device memory (app/lib/recs-signals): an opened lot leans "Lots you
  // may like" toward its kind — never sent anywhere
  useLearnVisit('lot', lot ? lot.id : null, () => (lot ? { lot } : null));

  // THE MAKER POOL (Sep 27 2026): every comp read here (signalWithPool,
  // appraiseLot, soldCompBand, the science reference band) pools SAME-ARTIST
  // rows only — so a lot with no build-time pack (a settled lot) reads its
  // comps over its maker's own shard (pages/maker-<slug>-N.json, archive tier
  // included for sports/science) instead of the ~35MB corpus. Same pool, same
  // answer; a maker without a shard (or an old data build) still asks for
  // the corpus.
  const [makerPool, setMakerPool] = useState<AuctionLot[] | null>(null);

  const poolAsked = useRef(false);
  const requestPool = useCallback(() => {
    if (poolAsked.current || fullLoaded) return;
    poolAsked.current = true;
    const artist = lot?.artist;
    const fallback = () => { setPoolFallback(true); requestFullLots(); };
    if (!artist) { fallback(); return; }
    loadPageStats().then(st => {
      const n = st?.makerShards?.[artist];
      if (!n) { fallback(); return; }
      loadMakerLots(artist, n, lastCrawl).then(rows => {
        if (rows) setMakerPool(rows); else fallback();
      });
    });
  }, [lot, fullLoaded, requestFullLots, lastCrawl]);
  const poolLots = fullLoaded || !makerPool ? allLots : makerPool;
  // a settled sports/science object prints its realized band near the top —
  // ask for the maker pool at mount (it replaces the 25MB archive probe)
  useEffect(() => {
    if (lot && pack === null && isSportsScienceObject(lot)) requestPool();
  }, [lot, pack, requestPool]);

  /* ── THE CORPUS GATE ───────────────────────────────────────────────────
     Read off the lot's OWN stamped fields — never off the pool, which is the
     thing we are deciding whether to fetch.

     `engineCalled` = the nightly engine made this call over the whole corpus
     and stamped its n / median / poolIds onto the lot. Those numbers are
     honest with zero shards on the wire, and the evidence rows behind them
     have a build-shipped fallback (loadCompEvidence). Everything else — an
     uncalled lot's client-computed read, an "at comparable market" lot's
     appraisal, the science/culture reference band, the repeat-sale
     provenance ledger, and resolving a permalink the fast paths all missed —
     is computed here, over the corpus, so it must ask for it. */
  // (r7) the engine VALUED this lot (any call, or none): its pool, n and
  // median are stamped — app/lib/engine-pool, one lot one number
  const enginePool = useMemo(() => enginePoolOf(lot?.value), [lot]);
  // ONE LOT, ONE NUMBER (r8): every value figure this page prints
  const face = useMemo(() => (lot ? lotFace(lot) : null), [lot]);
  const engineCalled = !!enginePool;
  const needsCorpusRead = useMemo(() => {
    // last-resort resolution — only when the build ships no lot index
    if (!lot) return dbSettled && shardLot === 'noindex';
    if (pack === undefined) return false;                     // the pack is still answering
    if (pack) return false;                                   // the build already read the corpus
    // a settled/unpacked lot's comps are read on demand (the comps sentinel),
    // never at first paint — the certificate itself needs nothing more
    if (lot.status !== 'upcoming') return false;
    if (lot.repeatSaleGroupId) return true;                   // provenance ledger
    const mkt = ARTIST_MARKET[lot.artist];
    if (mkt === 'science' || mkt === 'culture') return true;  // reference band
    if (isSportsScienceObject(lot)) return false;             // the archive tier answers
    // (r7) every valued lot prints the engine's stamped median; its rows
    // resolve on demand (the comps sentinel), never at first paint
    if (engineCalled) return false;
    return true;                                              // client-computed (guarded) read
  }, [lot, dbSettled, shardLot, pack, engineCalled]);
  useEffect(() => { if (needsCorpusRead) requestFullLots(); }, [needsCorpusRead, requestFullLots]);
  // a pack IS a settled corpus read (computed over the whole book at build)
  const corpusSettled = fullLoaded || fullError || hasPack || !!makerPool;
  // (r7) a pool the ROWS can be read over: the maker's shard or the corpus
  // (a pack settles the stamped numbers, not rows it doesn't carry)
  const rowsSettled = fullLoaded || fullError || !!makerPool;

  // set the tab title on the query route (the static set gets real metadata)
  useEffect(() => {
    if (lot) document.title = `${splitTitle(lot.title, lot.auctionHouse).short} — lectr`;
  }, [lot]);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);
  // meta.json's source list first (the honest full-corpus house count, eager);
  // the pool scan is only a fallback, and would print SMALL before the shards
  // land — PlayerPage's exact pattern.
  const houseCount = useMemo(
    () => sources.length || new Set(allLots.map(l => l.auctionHouse)).size,
    [sources, allLots],
  );

  // ── the certificate's numbers ─────────────────────────────────────────
  const isUpcoming = lot?.status === 'upcoming';
  const todayIso = (lastCrawl || (mounted ? new Date().toISOString() : '')).slice(0, 10);
  // (r9) 'unknown-result' = the sale closed, the house's result isn't
  // reconciled (a stale shard 'upcoming' the eager book closed out settles
  // here — app/lib/live-pool): past tense, results pending, never "Current bid"
  const isClosedUnknown = lot?.status === 'unknown-result';
  // (W11) an 'upcoming' row whose sale is over where it is held (utils
  // isLiveUpcoming, the feed's one "live" predicate — no grace day) is closed
  // too, flagged or not: the page read "Hammers · hammered 3d ago" over an
  // ask and a bid button on a past Sotheby's lot. Read at the reader's clock,
  // after mount (the SSG HTML was built on another day).
  const isPastPending = isClosedUnknown || (!!lot && isUpcoming && (
    (!!lot.resultsPending && !!lot.saleDate && !!todayIso && lot.saleDate.slice(0, 10) < todayIso)
    || (mounted && !isLiveUpcoming(lot, localToday(), 0))));

  // the number every card shows: crawl-time signal first, client compute after
  const sig = useMemo(() => (lot && isUpcoming ? lotSignal(lot, allLots) : null), [lot, allLots, isUpcoming]);

  // the comp pool behind the rows — the ENGINE's pool when it made the call
  // (same doctrine as ComparableModal: one lot, one statistic), else the
  // client read; sports/science objects get the descriptive realized band.
  const bandPoolLots = useMemo(
    () => (!makerPool && archive.archiveLoaded && archive.soldArchive.length ? [...poolLots, ...archive.soldArchive] : poolLots),
    [poolLots, makerPool, archive.archiveLoaded, archive.soldArchive],
  );
  const band = useMemo(() => {
    if (!lot || !isSportsScienceObject(lot)) return null;
    if (hasPack) return pack!.b ? { ...pack!.b, pool: packRowsToLots(pack!.b.rows) } : null;
    // (Oct 6 2026, wave 4) no client-computed band: only the build's pack
    return null;
  }, [lot, hasPack, pack]);
  const called = useMemo(() => {
    if (!lot || band) return null;
    if (hasPack && pack!.c) {
      const c = pack!.c;
      // the pack is the build's read of the SAME pool; its rows are held to
      // the pool's ids and its n / median to the stamp (lot-face) — a pack
      // from a neighbouring build can never add a row or move the median
      const ids = enginePool ? new Set(enginePool.ids) : null;
      const rows = packRowsToLots(c.rows).filter(r => !ids || ids.has(r.id));
      return { pool: rows, n: enginePool?.n ?? c.n, med: enginePool?.med ?? c.med ?? undefined, form: c.form, kind: c.kind as 'form' | 'edition' };
    }
    // (r7, QA2 Q3) THE ENGINE'S POOL whenever the engine valued the lot —
    // a below / above call, "at comparable market", or no direction (it
    // held the flag back): one lot, one number (app/lib/engine-pool). Before
    // r7 only a directional call carried its rows; every other valued lot
    // printed a client appraisal as "Comps median" over an empty list.
    // enginePoolOf applies the x5 estimate-band sanity (a ratio outside
    // [1/5, 5] is a data fault the build killed — never resurrected).
    if (!enginePool) return null;
    const byId = new Map(poolLots.map(l => [l.id, l]));
    // sold-with-price only (ComparableModal's exact guard): a pool id
    // resolving to a relisted/faulted lot must never feed a price read
    const pool = enginePool.ids
      .map(id => byId.get(id))
      .filter((x): x is AuctionLot => !!x && x.status === 'sold' && !!x.priceUsd);
    // pool may resolve EMPTY (engine pools draw on the off-wire corpus
    // tier) — keep the engine's numbers anyway; the evidence fetch / the
    // maker pool below fill the rows. A client read here would print a
    // DIFFERENT number against the same lot (the contradiction Collin caught).
    return { pool, n: enginePool.n, med: enginePool.med, form: lot.formKey || null, kind: 'form' as const };
  }, [lot, poolLots, band, hasPack, pack, enginePool]);
  // the engine abstained outright (no value): the client's context read —
  // comps.contextComps, the modal's exact read, GUARDED (floor >=3,
  // dispersion, x5 of the estimate). Rows and median come from one pool; a
  // pool that fails the guards is no pool. Card-comp lots keep their card
  // block. Read only over a real pool (the maker shard or the corpus).
  const ctx = useMemo(() => {
    if (!lot || band || called || !rowsSettled || isSportsScienceObject(lot)) return null;
    if (lot.value?.basis === 'card-comp') return null;
    return contextComps(lot, poolLots);
  }, [lot, band, called, rowsSettled, poolLots]);

  // build-shipped evidence rows for engine calls whose poolIds aren't on-wire
  // (undefined = loading · null = fetched, nothing there)
  const [evRows, setEvRows] = useState<AuctionLot[] | null | undefined>(undefined);
  // (r8) a PARTLY resolved engine pool fetches its evidence too — the rows
  // are the pool behind the median, all of it (the modal showed "4 sales · 1
  // shown" while the evidence file carried three)
  const needEvidence = (!!lot && !!called && !band && called.pool.length < (enginePool?.ids.length ?? 1))
    || (!!lot && !called && !band && !ctx?.rows.length && !isSportsScienceObject(lot) && lot.status === 'upcoming' && !!lot.signal && (lot.signal.basis || 0) > 0);
  useEffect(() => {
    if (!needEvidence || !lot) { setEvRows(null); return; }
    let live = true;
    setEvRows(undefined);
    loadCompEvidence().then(map => {
      if (!live) return;
      const rows = map?.[String(lot.id)];
      setEvRows(rows && rows.length ? evRowsToLots(rows, lot) : null);
    });
    return () => { live = false; };
  }, [needEvidence, lot]);

  const compRows = useMemo(() => {
    let calledRows: AuctionLot[] = [];
    if (called) {
      // the resolved pool rows, completed by the evidence rows — both held
      // to the pool's own ids when the engine stamped them
      const ids = enginePool ? new Set(enginePool.ids) : null;
      const seen = new Set(called.pool.map(r => r.id));
      calledRows = [...called.pool, ...(evRows || []).filter(r => !seen.has(r.id) && (!ids || ids.has(r.id)))];
    }
    const pool = band ? band.pool : called ? calledRows : ctx?.rows.length ? ctx.rows : (evRows || []);
    return [...pool]
      .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime())
      .slice(0, 12);
  }, [band, called, ctx, evRows, enginePool]);

  // ── provenance: the same physical object across the book ──
  // repeatSaleGroupId is the engine's strict physical-match verdict (photo/
  // edition/serial-justified, price-sanity-guarded) — never fuzzy title echo.
  const provenance = useMemo(() => {
    const gid = lot?.repeatSaleGroupId;
    if (!lot || !gid) return [];
    if (hasPack) return pack!.p ? packRowsToLots(pack!.p) : [];
    const rows = bandPoolLots.filter(l => l.repeatSaleGroupId === gid);
    if (!rows.some(r => r.id === lot.id)) rows.push(lot);
    return rows.length >= 2
      ? rows.slice().sort((a, b) => ((a.saleDate || '') < (b.saleDate || '') ? -1 : 1))
      : [];
  }, [lot, bandPoolLots, hasPack, pack]);

  // ── house calibration: does this house's estimate historically hold? ──
  // hammer-led per the dual-basis doctrine; market cell first, 'all' fallback.
  const houseIntel = useMemo(() => {
    if (!lot?.auctionHouse || !market?.houseCal) return null;
    const mkt = ARTIST_MARKET[lot.artist] || 'all';
    const cell = market.houseCal[lot.auctionHouse]?.[mkt] || market.houseCal[lot.auctionHouse]?.all;
    if (!cell) return null;
    const sign = cell.hammerMedPct > 0 ? '+' : '';
    const word = cell.hammerMedPct >= 3 ? 'run conservative' : cell.hammerMedPct <= -3 ? 'run rich' : 'hold';
    return `estimates here ${word} · hammers ${sign}${cell.hammerMedPct}% vs mid · ${cell.n.toLocaleString()} sales`;
  }, [lot, market]);

  // Comps median: the signal's own median first (crawl-time signals carry it),
  // else the appraisal through the same pools, else the realized band.
  // HONESTY GATE (the standing law): a comp median / count may print from a
  // STAMPED read — the crawl-time signal, or an engine call whose n and
  // median were computed over the whole corpus at build time — or from a
  // SETTLED corpus. A client read taken over the eager slice alone is a small
  // number wearing a big one's clothes; it abstains into the loading state
  // below instead. (Before the lazy pass this hole was a few seconds wide on
  // every lot page; it is now closed outright.)
  const calledIsHonest = !!called && (engineCalled || corpusSettled);
  // (r7, QA2 Q3 — one lot, one number) the engine's stamped median FIRST
  // whenever it valued the lot; the realized band; a crawl-stamped signal's
  // own median; else the guarded context read, and only while its rows show.
  // The build's unguarded appraisal (pack.a) never prints: on a valued lot
  // it was a second number ($3.30M beside the engine's $2.04M), on an
  // abstained one an unguarded read over rows the page never showed.
  const compsMed = useMemo(() => {
    if (!lot) return null;
    if (calledIsHonest && face?.comps && enginePool) return face.comps.med;
    if (calledIsHonest && called?.med != null) return called.med;
    if (band) return band.median;
    const sigMed = (sig as (NonNullable<typeof sig> & { med?: number }) | null)?.med;
    if (sigMed != null) return sigMed;
    if (ctx?.median != null && ctx.rows.length) return ctx.median;
    return null;
  }, [lot, sig, called, calledIsHonest, band, ctx, face, enginePool]);
  const compsN = (calledIsHonest && face?.comps && enginePool ? face.comps.n : null)
    ?? (calledIsHonest && called ? called.n : null) ?? (band ? band.n : null) ?? sig?.basis ?? (ctx?.median != null && ctx.rows.length ? ctx.rows.length : null);

  // ── reference comps: a low-confidence measured RANGE, never a flag ──
  // scienceReferenceBand/cultureReferenceBand scan the whole corpus, so gate
  // on fullLoaded. Purely descriptive $ context — the render carries no tone,
  // no %, no mono; it labels itself low-confidence reference.
  const refBand = useMemo(() => {
    if (!lot) return null;
    const mkt = ARTIST_MARKET[lot.artist];
    if (hasPack && !fullLoaded) return pack!.r ?? null;
    // (Oct 6 2026, wave 4) a client-computed reference range only on a lot
    // the engine valued
    if (!lot.value) return hasPack ? pack!.r ?? null : null;
    if (!fullLoaded) {
      // science pools same-artist → the maker shard answers it exactly
      if (makerPool && mkt === 'science') return scienceReferenceBand(lot, makerPool);
      return null;
    }
    if (mkt === 'science') return scienceReferenceBand(lot, allLots);
    if (mkt === 'culture') return cultureReferenceBand(lot, allLots);
    return null;
  }, [lot, fullLoaded, allLots, hasPack, pack, makerPool]);

  /* ── THE COMPS SENTINEL ────────────────────────────────────────────────
     The comps block has a CHEAPER source than the corpus for its first paint:
     an engine call stamps its own n and median, and comp-evidence.json
     (370KB) ships that call's evidence rows — title, house, date, realized
     price — for pools whose ids live off the wire. Measured: all 160
     prerendered lot pages are covered, so a flagged permalink paints nine
     real comp rows with zero shards. The corpus is still what UPGRADES those
     rows (the comp photograph, the medium line, a pool the evidence file
     doesn't carry), so the sentinel is armed whenever it has something to
     add, and the reader who actually engages with the block gets it.

     rootMargin is NEGATIVE at the bottom, not positive: this section starts
     at the fold on a 1440x900 desk (measured top 897px — it is the right
     column's second block), so a normal "is it visible" test fires on every
     desktop load and gates nothing. -180px means the block has to be 180px
     INTO the viewport, which is height-independent (a threshold would fail on
     a section taller than the viewport) and holds at both 1440 and 390 (where
     the comps sit 1,370px down, two screens in). */
  // ── the same edition's own record (prints / multiples) ──
  // identity.editionIdentityKey — the engine's edition identity (maker + the
  // catalogue number, else the normalized title + signed + after), the same
  // key its edition pools read. Other impressions of THIS edition, read over
  // the maker's own rows; never a similarity call.
  const editionKey = useMemo(() => (lot && isEditionLot(lot) ? editionIdentityKey(lot) : null), [lot]);
  const editionRows = useMemo(() => {
    if (!lot || !editionKey || !rowsSettled) return [];
    return poolLots
      .filter(l => l.artist === lot.artist && l.id !== lot.id && l.status === 'sold' && (l.priceUsd || 0) > 0
        && isEditionLot(l) && editionIdentityKey(l) === editionKey)
      .sort((a, b) => ((a.saleDate || '') < (b.saleDate || '') ? 1 : -1));
  }, [lot, editionKey, rowsSettled, poolLots]);
  const [ladderOpen, setLadderOpen] = useState(false);
  const [reminded, setReminded] = useState(false);
  const remindTimer = useRef<number | null>(null);
  useEffect(() => () => { if (remindTimer.current) window.clearTimeout(remindTimer.current); }, []);
  // the hammer's clock time on the reader's clock, when the house publishes
  // one (house-tz) — after mount: the SSG HTML was built on another day/zone
  const closeClock = useMemo(() => {
    if (!lot || !mounted || !closeIsTimed(lot)) return null;
    const ms = houseCloseMs(lot);
    return ms == null ? null : new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00 ', ' ');
  }, [lot, mounted]);

  const poolPartial = !!called && !corpusSettled
    && (!engineCalled || (called.pool.length > 0 && called.n > called.pool.length));
  // (r7) rows the pack doesn't carry (a valued lot whose pack predates r7,
  // an abstained lot's context read) wait on a real pool, not on the pack
  const compsNeedCorpus = !rowsSettled && (poolPartial || needEvidence || (!band && !called) || (!!called && called.pool.length === 0));
  // (W11) a print also asks for its maker's rows once the reader reaches the
  // comps — the same edition's own record reads over them
  const compsSentinel = useVisibilityTrigger(requestPool, { rootMargin: '0px 0px -180px 0px', enabled: (compsNeedCorpus || (!!editionKey && !rowsSettled)) && pack !== undefined });

  // ── resolution states ─────────────────────────────────────────────────
  if (!lot) {
    const mainSettled = fullLoaded || fullError;
    const archiveSettled = !isGoldinId || archive.archiveLoaded || archive.archiveError;
    // the lot index settles "not on the book" without the corpus; only a
    // data build with no index falls back to the corpus + archive scan
    const indexSettled = shardLot === null;
    const settled = !lotId || (!loading && dbSettled && (indexSettled || (shardLot === 'noindex' && mainSettled && archiveSettled)));
    return (
      <div className="terminal-shell">
        <ArtistNav activeSlug="" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />
        {wantsArchive && <ArchiveProbe onState={setArchive} />}
        {settled ? (
          <>
            <NotOnTheBook id={lotId} />
            {(fullError || archive.archiveError) && lotId && (
              <div className="rail" style={{ textAlign: 'center', paddingBottom: 60, marginTop: -60 }}>
                <button
                  className="ray-call-btn ray-call-btn-quiet"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    if (fullError) retryFullLoad();
                    if (archive.archiveError) { setArchive(a => ({ ...a, archiveError: false })); retryArchiveLoad(); }
                  }}
                >
                  Part of the book didn&rsquo;t load — try again
                </button>
              </div>
            )}
          </>
        ) : (
          <LotPageSkeleton />
        )}
      </div>
    );
  }

  // ── the catalogue page ────────────────────────────────────────────────
  // the name the lot is filed under + its label, in the home feed's words
  // (app/lib/lot-labels): the card's player / the Pokémon, "Category · Sub",
  // the facet badges ("PSA 8 · Japanese")
  const maker = makerLineOf(lot);
  const makerName = maker.name;
  const catSubLine = catSubLineOf(lot);
  const badgeLine = cardBadgesOf(lot).join(' · ');
  const titleParts = splitTitle(lot.title, lot.auctionHouse);
  const marketKey = ARTIST_MARKET[lot.artist];
  const monogram = (makerName.trim().charAt(0) || craftTitle(lot.title, lot.auctionHouse).charAt(0) || '?').toUpperCase();
  const imgOk = !!lot.imageUrl && !imgFailed;
  const saved = isSaved(lot.id);
  // the lot's named maker / player / subject — Follow shapes For you and
  // the nightly matches (app/lib/lot-follow; null: nothing named to follow)
  const lotFollow = lotFollowOf(lot);
  const isSold = lot.status === 'sold' || lot.status === 'bought_in';
  const houseColor = houseColors[lot.auctionHouse] || 'var(--color-text-secondary)';
  // (Oct 6 2026, wave 3) the calibrated odds print only on a BELOW call: on
  // an above / at read the bucket's beat rate is not a rate "of flags like
  // this" (and an uncalibrated read carries 0) — suppressed, never reworded
  const beatRate = lot.value?.signal?.label?.startsWith('below') && (lot.value.signal.beatRatePct || 0) > 0
    ? lot.value.signal.beatRatePct : null;
  // (wave 3, wording) an ABOVE read prints its bucket's odds as what they are:
  // how often lots priced like this beat their estimate
  const aboveBeatRate = lot.value?.signal?.label?.startsWith('above') && (lot.value.signal.beatRatePct || 0) > 0
    ? lot.value.signal.beatRatePct : null;
  const caption = `${lot.lotNumber != null ? `Lot ${lot.lotNumber} · ` : ''}${lot.auctionHouse}${lot.saleName ? ` · ${cleanText(lot.saleName)}` : ''}`;
  // poolPartial (above): an engine pool that resolved only PART of its stamped
  // ids is the same fault as a client read — the rows under an honest
  // "N comparable sales" head would be a silent subset. (An EMPTY pool is
  // different: the ids live off-wire, and loadCompEvidence ships those rows.)
  const compsPending = (!band && !called && !rowsSettled && lot.value?.basis !== 'card-comp')
    || poolPartial
    || (needEvidence && evRows === undefined)
    // the evidence file shipped nothing for this lot: the rows exist only in
    // the corpus, so hold the quiet loading state rather than print "the
    // evidence rows couldn't be loaded" at a reader who simply hasn't
    // reached the block yet (the sentinel above is armed for exactly this)
    || (needEvidence && evRows === null && !rowsSettled);
  // the head reads from the pending-safe call, so a partial read never sets
  // the headline count either
  const headCalled = compsPending ? null : called;
  const formLabel = (band && ((FORM_LABEL as Record<string, string>)[band.form] || band.form))
    || (headCalled?.form && (FORM_LABEL as Record<string, string>)[headCalled.form])
    || 'sales';
  // D2 P1 — ComparableModal's isCardComp suppression, mirrored: a card-comp
  // lot's proof surface IS the exact-card rows + grade ladder already on the
  // certificate (its poolIds are sold-card ids outside the client corpus), so
  // an empty generic pool must not print "No comparable sales clear the
  // gates" under a "This card — N sales" row — a self-contradiction.
  const isCardComp = lot.value?.basis === 'card-comp' && (lot.cardComps?.n ?? 0) > 0;
  const hideComps = isCardComp && compRows.length === 0;
  // a withdrawn lot never went under the hammer: no ask, no "hammered"
  const isWithdrawn = lot.status === 'withdrawn';
  // a live lot a reader can still act on (not withdrawn, not past its hammer)
  const isActionable = isUpcoming && !isPastPending;
  // ONE LOT, ONE NUMBER: the low-confidence reference range carries its own
  // median — beside the engine's (or the band's) comps median it would be a
  // second, different "median" for the same lot (RR's Madison passport read
  // "Comps median $2.3K" over "Reference comps · $1K median")
  const showRefBand = !!refBand && compsMed == null;
  // the grade ladder: the lot's own rung marked; a long ladder (the 1951
  // Bowman Mantle carries 27 rungs) folds to the rungs around it
  const ladder = lot.cardComps?.gradeLadder || [];
  const ownAll = (() => {
    const cc = lot.cardComps;
    return cc && cc.med != null && cc.med > 0 && cc.n > 0 ? { med: cc.med, n: cc.n } : null;
  })();
  const ownRung = ladder.length > 1 ? ownRungOf(lot) : null;
  const ladderView = (() => {
    if (ladderOpen || ladder.length <= LADDER_FOLD) return ladder;
    const at = ownRung ? ladder.findIndex(r => r.g === ownRung) : -1;
    if (at < 0) return ladder.slice(0, LADDER_FOLD);
    const from = Math.max(0, Math.min(at - Math.floor(LADDER_FOLD / 2), ladder.length - LADDER_FOLD));
    return ladder.slice(from, from + LADDER_FOLD);
  })();
  // the same card & grade, sold before (build-stamped cardComps.lastSales)
  const cardSales = (lot.cardComps?.lastSales || []).filter(s => s.p > 0);
  // (W17) the rows the card value was read from — the engine's pool (its
  // stamped ids; on older data the exact tier's newest value.n rows)
  const cardUsed = valueRowFlags(lot, cardSales);
  // the same edition's record — not when the comps ARE this edition already
  const editionShow = headCalled?.kind === 'edition' ? [] : editionRows.slice(0, 8);
  const editionMed = editionRows.length >= 3
    ? (() => { const v = editionRows.map(r => r.priceUsd!).sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; })()
    : null;
  const onRemind = () => {
    if (!addLotToCalendar(lot)) return;
    setReminded(true);
    if (remindTimer.current) window.clearTimeout(remindTimer.current);
    remindTimer.current = window.setTimeout(() => setReminded(false), 2500);
  };

  return (
    <div className="terminal-shell">
      <ArtistNav activeSlug={lot.artist in ARTIST_LABEL ? lot.artist : ''} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />
      {wantsArchive && <ArchiveProbe onState={setArchive} />}
      <div className="lectr-lot rail">
        <style dangerouslySetInnerHTML={{ __html: LOTPAGE_CSS }} />

        <div className="lectr-lot-grid" style={{ paddingTop: 12 }}>
          {/* the plate column — the photograph, then the object's paper trail
              (provenance, the grade ladder) riding beneath it on desktop */}
          <div className="lectr-lot-cola">
          {/* the plate: photograph on the elevated mat — or the monogram when
              the house blocks the hotlink (CallPlate's exact fallback) */}
          <figure className={`ray-plate-mat${imgOk ? '' : ' lectr-lot-noimg'}`} style={{ margin: 0 }}>
            {imgOk ? (
              <div className="ray-plate-img">
                <img
                  src={httpsImg(lot.imageUrl)}
                  alt={craftTitle(lot.title, lot.auctionHouse)}
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                  // cache hits never fire onError — complete with zero
                  // naturalWidth at attach is a cached failure
                  ref={el => { if (el && el.complete && el.naturalWidth === 0) setImgFailed(true); }}
                />
              </div>
            ) : (
              <div className="ray-plate-img lectr-lot-mono" style={{ position: 'relative' }}>
                <span className="lectr-lot-monorules" aria-hidden />
                <span className="lectr-lot-monoglyph">{monogram}</span>
              </div>
            )}
            <figcaption className="ray-plate-cap">{caption}</figcaption>
          </figure>

          {/* provenance — the same physical object's trips across the block.
              Strict physical-match groups only; absence of the section means
              the engine confirmed nothing, never that nothing exists. */}
          {provenance.length >= 2 && (
            <section className="lectr-lot-comps lectr-lot-prov ns-plate" aria-label="Provenance">
              <div className="lectr-lot-shead">
                <div>
                  <span className="ns-kicker">Provenance</span>
                  <h2 className="lectr-lot-h2">This exact object, {provenance.length} appearances</h2>
                </div>
                <span className="lectr-lot-shctx">physical matches, engine-confirmed</span>
              </div>
              <div style={{ marginTop: 6 }}>
                {provenance.map(p => {
                  const here = p.id === lot.id;
                  const money = p.status === 'sold' && p.priceUsd
                    ? fmtFace(p.priceUsd)
                    : p.status === 'bought_in' ? 'bought in'
                    : p.status === 'upcoming' ? (estimateFace(p) || 'on the block') : '—';
                  const inner = (
                    <>
                      <span className="lectr-lot-comp-i" aria-hidden>{here ? '·' : ''}</span>
                      <span className="lectr-lot-comp-t">
                        <span className="lectr-lot-comp-title" style={{ display: 'block' }}>
                          {formatDate(p.saleDate, { month: 'long', year: 'numeric' })}
                          {here ? ' — this listing' : ''}
                        </span>
                        <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>
                          <span style={{ color: houseColors[p.auctionHouse] || 'var(--color-text-faint)', fontWeight: 600 }}>{p.auctionHouse}</span>
                          {p.saleName ? ` · ${cleanText(p.saleName)}` : ''}
                        </span>
                      </span>
                      <span className="lectr-lot-comp-p">{money}</span>
                    </>
                  );
                  return here
                    ? <span key={p.id} className="lectr-lot-comp" style={{ cursor: 'default' }}>{inner}</span>
                    : <Link key={p.id} href={`/lot?id=${encodeURIComponent(p.id)}`} className="lectr-lot-comp">{inner}</Link>;
                })}
              </div>
            </section>
          )}

          {/* (W11) THIS CARD, SOLD BEFORE — the same card in the same grade,
              its most recent sales (build-stamped cardComps.lastSales: exact
              card identity incl. grade, the pair-checked same-object pool) */}
          {cardSales.length > 0 && (
            <section className="lectr-lot-comps lectr-lot-record ns-plate" aria-label="This card, sold before">
              <div className="lectr-lot-shead">
                <div>
                  <span className="ns-kicker">{ownRungOf(lot) ?? 'Same card, same grade'}</span>
                  <h2 className="lectr-lot-h2">This card, sold before</h2>
                </div>
                {/* (W17) dated: the last year's median beside a value read
                    from the last year, the all-time figure with its years */}
                <span className="lectr-lot-shctx">
                  {face?.card?.head || `${cardSales.length} ${cardSales.length === 1 ? 'sale' : 'sales'} on file`}
                </span>
              </div>
              <div style={{ marginTop: 6 }}>
                {cardSales.map((s, i) => (
                  <TrailRow key={`${s.d}-${i}`} price={s.p}
                    when={s.d ? formatDate(s.d, { month: 'long', day: 'numeric', year: 'numeric' }) : 'date not published'}
                    note={cardUsed[i] ? 'same card, same grade · in the last year · in the value' : undefined} />
                ))}
              </div>
              {face?.card?.window === 'year' && face.card.allTime && (face.card.n < (lot.cardComps?.n || 0)) && (
                <p className="lectr-lot-shctx" style={{ margin: '8px 0 0' }}>All-time: {face.card.allTime}</p>
              )}
              {face?.card?.note && (
                <div className="ns-well lectr-lot-note">
                  <div className="ns-well-label">How these prices read</div>
                  <div className="ns-well-body">{face.card.note}</div>
                </div>
              )}
            </section>
          )}

          {/* (W11) the reference's own record — watch lots with a dossier */}
          {marketKey === 'watches' && lot.reference && (
            <ReferenceSales maker={lot.artist} reference={lot.reference} selfId={lot.id} quietMedian={compsMed != null} />
          )}

          {/* (W11) THIS EDITION, SOLD BEFORE — other impressions of the same
              print (the engine's edition identity: the catalogue number, else
              the title), read over the maker's own rows once they load */}
          {editionShow.length > 0 && (
            <section className="lectr-lot-comps lectr-lot-record ns-plate" aria-label="This edition, sold before">
              <div className="lectr-lot-shead">
                <div>
                  <span className="ns-kicker">Same edition</span>
                  <h2 className="lectr-lot-h2">This edition, sold before</h2>
                </div>
                <span className="lectr-lot-shctx">
                  {editionMed != null ? `${fmtFace(editionMed)} median · ` : ''}{editionRows.length} {editionRows.length === 1 ? 'sale' : 'sales'}{editionRows.length > editionShow.length ? ` · ${editionShow.length} latest` : ''}
                </span>
              </div>
              <div style={{ marginTop: 6 }}>
                {editionShow.map(r => (
                  <TrailRow key={r.id} id={r.id} title={r.title} house={r.auctionHouse} img={r.imageUrl} price={r.priceUsd!}
                    when={formatDate(r.saleDate, { month: 'short', year: 'numeric' })} />
                ))}
              </div>
            </section>
          )}

          {/* the grade ladder — same card, every grade: the economics of the
              card market in one table. Build-stamped from exact identity
              matches, never similarity. The lot's own rung is marked; a long
              ladder folds to the rungs around it. */}
          {ladder.length > 1 && (
            <section className="lectr-lot-comps lectr-lot-ladder ns-plate" aria-label="Grade ladder">
              <div className="lectr-lot-shead">
                <div>
                  <span className="ns-kicker">The grade ladder</span>
                  <h2 className="lectr-lot-h2">This card, every grade</h2>
                </div>
                {/* (W17) each rung says which window its median reads */}
                <span className="lectr-lot-shctx">{ladderBasisText(ladder)}</span>
              </div>
              <div style={{ marginTop: 6 }}>
                {ladderView.map(r0 => {
                  const own = r0.g === ownRung;
                  // (W23) the lot's own rung IS this card & grade — the record
                  // the section above and the "This card" row print (the rung
                  // read "19 sales $2K" under "$2.5K median · 18 sales")
                  const r = own && ownAll ? { ...r0, med: ownAll.med, n: ownAll.n } : r0;
                  const rv = rungView(r, fmtFace);
                  return (
                    <span key={r.g} className="lectr-lot-comp" style={{ cursor: 'default' }} aria-current={own ? 'true' : undefined}>
                      <span className="lectr-lot-comp-t">
                        <span className="lectr-lot-comp-title" style={{ display: 'block' }}>{r.g}{own ? ' — this lot' : ''}</span>
                        <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>{rv.meta}</span>
                      </span>
                      <span className="lectr-lot-comp-p">{fmtFace(rv.price)}</span>
                    </span>
                  );
                })}
              </div>
              {ladder.length > LADDER_FOLD && (
                <button type="button" className="lectr-lot-more" onClick={() => setLadderOpen(o => !o)} aria-expanded={ladderOpen}>
                  {ladderOpen ? 'Fewer grades' : `All ${ladder.length} grades`}
                </button>
              )}
            </section>
          )}
          </div>

          {/* the certificate column — leader rows, then the comp ledger */}
          <div className="lectr-lot-colb">
          {/* the certificate */}
          <div className="lectr-lot-cert">
            <div className="lectr-lot-head">
              <span>
                {/* the market rides the byline's Category column now —
                    printing it here too would say it twice */}
                {lot.artist in ARTIST_LABEL
                  ? <Link href={maker.href} style={{ color: 'inherit', textDecoration: 'none' }}>{makerName}</Link>
                  : makerName}
              </span>
              {/* the catalogue id on one line — a 60-character Goldin uuid
                  wrapped to two lines above the title on every phone */}
              <span className="no" title={lot.id}>no. {lot.id}</span>
            </div>

            {/* the SHORT title carries the h1; a catalogue description the
                house poured into the title field rides beneath as prose */}
            <h1 className={`lectr-lot-title${titleParts.short.length > 64 ? ' lectr-lot-title-long' : ''}`}>{titleParts.short}</h1>
            {titleParts.rest && <p className="lectr-lot-medium">{titleParts.rest}</p>}
            {(lot.year || lot.medium) && (
              <p className="lectr-lot-medium">
                {[lot.year, lot.medium ? deglue(cleanText(lot.medium)) : null, lot.dimensions].filter(Boolean).join(' · ')}
              </p>
            )}

            {/* the byline ledger — the lot's provenance columns (gray label
                over ink value, dotted closing rule): House / Hammers /
                the money / Category. Label logic preserved verbatim —
                formatEstimate prints "$4K bid · 9 bids" whenever the
                two-sided estimate is missing and live bids exist (RR runs
                bid sales too), and "Ask" over a bid reading is a mislabel;
                sold lots print the realized price, never ask-forward. */}
            <div className="ns-byline lectr-lot-byline">
              <div>
                <div className="k">House</div>
                <div className="v" style={{ color: houseColor }}>{lot.auctionHouse}</div>
                {houseIntel && <div className="s">{houseIntel}</div>}
              </div>
              <div>
                {/* (W11) a withdrawn lot never went under the hammer — the
                    page read "Hammers · hammered 3d ago" over a live-looking
                    ask on Sotheby's withdrawn Warhol Apple */}
                <div className="k">{isWithdrawn ? 'Sale' : isSold || isPastPending ? 'Hammered' : 'Hammers'}</div>
                <div className="v">{formatDate(mounted ? closeDayOf(lot) : lot.saleDate)}</div>
                {isWithdrawn
                  ? <div className="s">withdrawn before the sale</div>
                  : isPastPending
                  ? <div className="s">results pending</div>
                  : !isSold && mounted && !isNaN(new Date(closeDayOf(lot)).getTime())
                    // the house's published close, on the reader's clock
                    ? <div className="s">{daysWord(closeDayOf(lot))}{closeClock ? ` · closes ${closeClock}` : ''}</div>
                    : null}
              </div>
              <div>
                <div className="k">
                  {isSold
                    ? (lot.status === 'bought_in' ? 'Result' : 'Realized')
                    : isWithdrawn ? 'Result'
                    : isPastPending ? ((lot.currentBid || 0) > 0 && !(lot.estimateLow && lot.estimateHigh) ? 'Last bid seen' : 'Estimate')
                    : lot.auctionHouse === 'Goldin' || (!(lot.estimateLow && lot.estimateHigh) && (lot.currentBid || 0) > 0) ? 'Current bid' : 'Ask'}
                </div>
                <div className="v">
                  {isSold
                    ? (lot.status === 'bought_in' ? 'bought in' : lot.priceUsd ? fmtFace(lot.priceUsd) : '—')
                    : isWithdrawn ? 'withdrawn'
                    : (estimateFace(lot) || '—')}
                </div>
                {isWithdrawn && (lot.estimateLow || lot.estimateHigh) ? (
                  <div className="s">{estimateFaceOnly(lot)} est.</div>
                ) : null}
                {!isSold && !isWithdrawn && !(lot.estimateLow && lot.estimateHigh) && !!(lot.estimateLow || lot.estimateHigh) && (lot.currentBid || 0) > 0 && (
                  <div className="s">{estimateFaceOnly(lot)} est.</div>
                )}
              </div>
              <div>
                <div className="k">Category</div>
                <div className="v">{catSubLine}</div>
                {badgeLine && <div className="s">{badgeLine}</div>}
              </div>
            </div>

            {/* THE READ AS COLOR — the engine's face in ns-cell-color
                grammar. dir comes STRICTLY from the signal the row already
                printed: 'up' only when the engine called Below Market (the
                lamp); anything else falls to ink — never red, never
                manufactured. Every figure is the gap row's own number. */}
            {/* no printed estimate → no "vs. estimate" plate: the label would
                name a number the page never shows (the byline prints a bid) */}
            {isUpcoming && sig && !!(lot.estimateLow || lot.estimateHigh) && (
              <div className="ns-cell ns-cell-color lectr-lot-read" data-dir={sig.label === 'Below Market' ? 'up' : 'ink'}>
                {/* "vs. estimate", not "the gap" — THE GAP is the no-estimate
                    lane's name (lanes.ts); this cell is the FLAGS read */}
                <span className="ns-cell-label">vs. estimate · {sig.label.toLowerCase()}</span>
                <span className="lectr-lot-read-stat">{face?.call?.text ?? signalMagnitude(sig.label, sig.pct)}</span>
                <span className="ns-cell-body">
                  {beatRate != null
                    ? `${beatRate}% of flags like this beat their estimate`
                    : aboveBeatRate != null && sig.label === 'Above Market'
                      ? `only ${aboveBeatRate}% of lots priced like this beat their estimate`
                      : sig.label === 'Below Market' ? 'comps over ask' : 'comps under ask'}
                  {' · '}{confidenceMeter(sig.confidence).word} confidence
                </span>
                {/* the engine's buyer fields (hammer basis, same as the
                    estimate) — one secondary line, only the fields served */}
                {(() => {
                  // (r8) lot-face: the ratio's own derivation from printed
                  // numbers, then the engine's value — the plate's and the
                  // modal's exact figures and labels
                  const mb = face?.maxBid;
                  const parts = [
                    face?.call?.derivation ?? null,
                    face?.value ? `${FACE_LABEL.value} ${face.value.text}` : null,
                    face?.value ? `${FACE_LABEL.range} ${face.value.range}` : null,
                    mb ? `max bid ${fmtFace(mb.hammer)}` : null,
                  ].filter((x): x is string => !!x);
                  // each figure keeps its words together — a wrap lands on a separator
                  return parts.length ? (
                    <span className="ns-cell-body">
                      {parts.map((t, i) => <span key={t}>{i > 0 && ' · '}<span style={{ whiteSpace: 'nowrap' }}>{t}</span></span>)}
                    </span>
                  ) : null;
                })()}
              </div>
            )}

            {/* (W11) THE DECISION, at the top: what the room is expected to
                pay, what the engine says it is worth up to, the gap, and the
                way to act — lot-face decisionOf through DecisionLine, the
                feed's exact line (one lot, one number). The byline already
                prints the estimate and the close day, so the line leaves them
                out; the ledger below is its derivation. */}
            {isActionable && mounted && decisionLineShows(decisionOf(lot), { estimate: false, when: false }) && (
              <div className="lectr-lot-decision">
                <DecisionLine lot={lot} estimate={false} when={false} />
              </div>
            )}
            <div className="lectr-lot-ctas">
              {/* scheme-allowlisted (safe-href): a crawler-faulted URL means
                  no house CTA — Save and Copy link still carry the row */}
              {safeHref(lot.url) && (
                <a className="ray-call-btn ray-call-btn-primary" href={safeHref(lot.url)} target="_blank" rel="noopener noreferrer">
                  {isActionable ? `Bid at ${lot.auctionHouse}` : `View at ${lot.auctionHouse}`} <Flick size={11} style={{ marginLeft: 2 }} />
                </a>
              )}
              <button
                type="button"
                className="ray-call-btn ray-call-btn-quiet"
                style={{ cursor: 'pointer', background: saved ? 'var(--color-bg-elevated)' : 'var(--color-bg)' }}
                onClick={() => toggle(lot.id, lot)}
                aria-pressed={saved}
              >
                <svg width="11" height="13" viewBox="0 0 12 14" fill="none" aria-hidden="true" style={{ marginRight: 1 }}>
                  <path
                    d="M1 1.5C1 1.22386 1.22386 1 1.5 1H10.5C10.7761 1 11 1.22386 11 1.5V12.5C11 12.6894 10.8862 12.8625 10.7096 12.9472C10.533 13.0319 10.3239 13.0136 10.1646 12.8994L6 9.91421L1.83541 12.8994C1.67614 13.0136 1.46698 13.0319 1.29037 12.9472C1.11377 12.8625 1 12.6894 1 12.5V1.5Z"
                    fill={saved ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="1.1"
                  />
                </svg>
                {saved ? 'Saved' : 'Save'}
              </button>
              {/* (W11) Remind me — the close handed to the reader's calendar
                  (.ics, app/lib/remind; the lot card's exact handler) */}
              {isActionable && (
                <button type="button" className="ray-call-btn ray-call-btn-quiet" style={{ cursor: 'pointer', background: 'var(--color-bg)' }}
                  onClick={onRemind} aria-live="polite">
                  {reminded ? (
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <rect x="1" y="2" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.25" fill="none" />
                      <line x1="4" y1="1" x2="4" y2="4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                      <line x1="10" y1="1" x2="10" y2="4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
                      <line x1="1" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth="1.25" />
                    </svg>
                  )}
                  {reminded ? 'Added' : 'Remind'}
                </button>
              )}
              {lotFollow && <FollowButton name={lotFollow.label} follow={lotFollow} short />}
              <CopyLinkButton id={lot.id} compact={isActionable} />
            </div>

            <div className="lectr-lot-leaders">
              {isSold && (lot.estimateLow || lot.estimateHigh) ? (
                <LeaderRow k="Estimate" v={estimateFace(lot)} />
              ) : null}

              {compsMed != null && (
                <LeaderRow k={FACE_LABEL.comps} v={fmtFace(compsMed)}
                  sub={calledIsHonest && face?.comps && enginePool ? face.comps.sub : compsN != null ? `${compsN} sales` : undefined} />
              )}

              {/* (r8) the engine's value on a valued lot without a read cell —
                  the modal's and the plate's figure (the read cell carries it
                  when there is a call). (r9, QA4 B2) card lots too: the max
                  bid below is read off this value, so it prints beside it —
                  the modal's exact sentence (lot-face card path) */}
              {isUpcoming && face?.value && !(sig && !!(lot.estimateLow || lot.estimateHigh)) && (
                <LeaderRow k={FACE_LABEL.value} v={face.value.text} sub={`${FACE_LABEL.valueSub} · ${FACE_LABEL.range} ${face.value.range}${face.card?.basis ? ` · ${face.card.basis}` : ''}`} />
              )}

              {isUpcoming && !sig && band && (
                <LeaderRow k="Similar sold" v={`${fmtFace(band.low)}–${fmtFace(band.high)}`} sub={`${band.n} sales`} />
              )}

              {/* ── the action rows (Aug 13 value audit): turn the read into a bid ── */}
              {isActionable && (lot.currentBid || 0) > 0 && (
                <LeaderRow
                  k="All-in today"
                  v={fmtFace(Math.round(lot.currentBid! * lotAllInFactor(lot, lot.currentBid)))}
                  sub={`${fmtFace(lot.currentBid!)} bid + ~${Math.round((lotAllInFactor(lot, lot.currentBid) - 1) * 100)}% premium`}
                />
              )}
              {isActionable && (() => {
                // (Oct 6 2026, wave 3) the engine's own max bid (verdict.ts —
                // one source), not the hammer under the band's all-in low
                const mb = face?.maxBid;
                if (!mb) return null;
                return <LeaderRow k="Max bid" v={mb.text} sub={mb.sub} />;
              })()}
              {isActionable && mounted && (() => {
                // (Oct 11 2026) THE ONE PROJECTED CLOSE — lot-face
                // projectedCloseFace, the figure the decision line, the reason
                // line and the Gap print: the live bid × this room's measured
                // close multiple (close-k), hammer; the all-in rides beside it,
                // labelled. Read at the reader's clock (after mount — the SSG
                // HTML was built on another day). The old served growth-curve
                // figure (bidProj, all-in) ran ~3–4× this one off Goldin.
                // The floor a reader may lean on is the gated one (lotFloor);
                // it is all-in, so the all-in is what is held against it.
                const pc = projectedCloseFace(lot);
                if (!pc) return null;
                const floor = gatedFloor(lot);
                // (W23) held against the lectr value's PRINTED likely range,
                // hammer to hammer — the floor (value.low) is that range's low
                // edge all-in, and printed as "$3K floor" beside "likely
                // $2.2K–$5.3K" it read as a third, unexplained number
                const fv = face?.value;
                const below = fv ? pc.hammer < fv.lo : !!floor && pc.allIn < floor;
                const where = fv
                  ? (below ? `under the likely low ${fmtFace(fv.lo)}` : pc.hammer > fv.hi ? `over the likely high ${fmtFace(fv.hi)}` : 'inside the likely range')
                  : null;
                return (
                  <LeaderRow
                    k="Projected close"
                    v={pc.text}
                    tone={below && floor ? 'up' : undefined}
                    sub={where && floor
                      ? `hammer · ${pc.allInText} · ${where}`
                      : floor
                        ? (below ? `${pc.allInText} · still under the ${fmtFace(floor)} all-in floor` : `${pc.allInText} vs ${fmtFace(floor)} all-in floor`)
                        : `hammer · ${pc.allInText} with ~${pc.premiumPct}% premium`}
                  />
                );
              })()}
              {isActionable && crossSibs(lot).length ? (() => {
                // the build caps crossLive at 3 siblings — the array's
                // length is a cap, not a count. A stamped total (crossLiveN)
                // prints; otherwise no number at all. Same-house entries
                // (copies at this house) are never "also live at" (fold.crossSibs).
                const sibs = crossSibs(lot);
                const n = (lot as AuctionLot & { crossLiveN?: number }).crossLiveN;
                const others = typeof n === 'number' && n > 0 ? n : null;
                return (
                  <LeaderRow
                    k="Also live at"
                    v={`${sibs[0].house} · ${sibs[0].bid > 0 ? fmtFace(sibs[0].bid) + ' bid' : 'open'}`}
                    sub={sibs.length > 1
                      ? (others ? `same card at ${others} other venues` : 'same card at other venues')
                      : 'the same card, head to head'}
                  />
                );
              })() : null}

              {/* Hammers/Hammered, House (+ calibration) and the money row
                  moved up into the byline ledger — same values, same guards */}

              {/* watch lots link into their reference dossier — the page a
                  bidder reads before trusting the estimate. Link gated on the
                  dossier actually existing (ReferenceRow). */}
              {marketKey === 'watches' && lot.reference && (
                <ReferenceRow maker={lot.artist} reference={lot.reference} />
              )}

              {/* sports lots link to the athlete's cross-market dossier */}
              {marketKey === 'sports' && lot.playerSlug && (
                <LeaderRow k="Player">
                  <Link href={playerHrefOf(lot.playerSlug)} style={{ color: 'inherit', textDecoration: 'none' }}>
                    {lot.playerName || lot.playerSlug} <Flick size={10} style={{ marginLeft: 2 }} />
                  </Link>
                </LeaderRow>
              )}

              {/* the lot's sub-market — its taxonomy split's strongest honest
                  read from market.json drills (index/demand tones only) */}
              {(() => {
                const dr = drillRowFor(lot, market);
                if (!dr) return null;
                const pct = dr.readType === 'index' && dr.index ? dr.index.changePct
                  : dr.readType === 'demand' ? dr.demandNow : null;
                const sub = dr.readType === 'index' && dr.index
                  ? `${dr.index.horizon} ${pct! >= 0 ? '+' : ''}${pct!.toFixed(0)}% verified [${dr.index.ciLoPct.toFixed(0)}, ${dr.index.ciHiPct.toFixed(0)}] · ${dr.lots.toLocaleString()} lots`
                  : dr.readType === 'demand' && pct != null
                    ? `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% vs estimate, trailing year · ${dr.lots.toLocaleString()} lots`
                    : `${dr.lots.toLocaleString()} lots tracked${dr.typicalUsd != null ? ` · ${fmtFace(dr.typicalUsd)} typical` : ''}`;
                const ref = drillSlugFor(lot);
                const tone: 'up' | 'down' | undefined = pct != null ? (pct >= 0 ? 'up' : 'down') : undefined;
                if (ref) {
                  return (
                    <LeaderRow k="Sub-market" sub={sub} tone={tone}>
                      <Link href={`/sub/${ref.slug.replace(':', '/')}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        {drillLabelOf(dr.slug, dr.label)} <Flick size={10} style={{ marginLeft: 2 }} />
                      </Link>
                    </LeaderRow>
                  );
                }
                return (
                  <LeaderRow k="Sub-market" v={drillLabelOf(dr.slug, dr.label)} sub={sub} tone={tone} />
                );
              })()}

              {/* reference comps — a low-confidence measured RANGE, never a
                  flag. Descriptive $ context: no tone, no %, no mono. The
                  label and sub say "reference · low-confidence" so it can
                  never be read as a verified index or a point estimate. */}
              {showRefBand && refBand && (
                <LeaderRow
                  k="Reference comps"
                  v={`${fmtFace(refBand.q1)}–${fmtFace(refBand.q3)}`}
                  sub={`${fmtFace(refBand.med)} median · ${refBand.n} sales · low-confidence reference`}
                />
              )}

              {/* bid velocity — a descriptive count of recent bids on a live
                  lot. Plain ink: no tone, no mono, never a price. Rendered
                  only when the sibling stamped it and the lot is still open. */}
              {isActionable && lot.bidVelocity && lot.bidVelocity.delta > 0 && (
                <LeaderRow
                  k="Bid velocity"
                  v={`+${lot.bidVelocity.delta} ${lot.bidVelocity.delta === 1 ? 'bid' : 'bids'}`}
                  sub={`in the last ${Math.round(lot.bidVelocity.hours)}h${lot.bidVelocity.pctile != null ? ` · faster than ${lot.bidVelocity.pctile}% of live lots` : ''}`}
                />
              )}

              {/* live card: the exact-card record — same card, same grade */}
              {/* (r9) the card's own record, from lot-face: the same-card
                  median is CONTEXT beside the value, labelled as a median */}
              {isUpcoming && face?.card && face.card.n > 0 && (
                <LeaderRow
                  k="This card"
                  v={face.card.text ?? '—'}
                  sub={face.card.sub}
                  // (wave 3) the median is all-in: the bid is compared all-in too
                  tone={face.card.med != null && (lot.currentBid || 0) > 0 && lot.currentBid! * lotAllInFactor(lot, lot.currentBid!) < face.card.med ? 'up' : undefined}
                />
              )}
            </div>

          </div>

          {/* the comp pool — the evidence, as ledger rows under the
              certificate (desktop); last in the single-column read (mobile).
              Suppressed for card-comp lots with no client-resolvable pool —
              the exact-card certificate rows are their proof surface. */}
          {!hideComps && (
          <section ref={compsSentinel} className="lectr-lot-comps lectr-lot-pool ns-plate" aria-label="Comparable sales">
          <div className="lectr-lot-shead">
            <div>
              <span className="ns-kicker">{band ? 'Recent sold' : 'The comps'}</span>
              <h2 className="lectr-lot-h2">
                {band
                  ? `${band.n} comparable ${formLabel}`
                  : headCalled
                    ? headCalled.kind === 'edition'
                      ? `This exact work, sold ${headCalled.n} times`
                      : `${headCalled.n} comparable ${formLabel}${!compsPending && compRows.length && compRows.length < headCalled.n && compRows.length < 12 ? ` · ${compRows.length} shown` : ''}`
                    : 'Comparable sales'}
              </h2>
            </div>
            <span className="lectr-lot-shctx">{!band && calledIsHonest && face?.comps && enginePool ? 'weighted median: closest, most recent count most' : 'medians, never means'}</span>
          </div>
          {/* explanation copy rides a cream well — the printed-bid gate
              language below is preserved verbatim */}
          {band && (
            <div className="ns-well lectr-lot-note">
              <div className="ns-well-label">How these prices read</div>
              <div className="ns-well-body">
                Realized prices — winning bid plus buyer&rsquo;s premium. Goldin publishes no estimates.
              </div>
            </div>
          )}

          {compsPending || (lot && isSportsScienceObject(lot) && wantsArchive && !archive.archiveLoaded && !archive.archiveError) ? (
            <div className="lectr-lot-quiet">Loading comparable sales&hellip;</div>
          ) : compRows.length === 0 ? (
            /* the honest empty state — explanation copy in a cream well,
               wording preserved verbatim */
            <div className="ns-well lectr-lot-note">
              <div className="ns-well-body">
                {fullError
                  ? <>
                      Comparable sales couldn&rsquo;t be loaded.{' '}
                      <button onClick={() => retryFullLoad()} style={{ background: 'none', border: 'none', color: 'var(--color-butter-text)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3, padding: 0 }}>
                        Try again
                      </button>
                    </>
                  : (calledIsHonest && called && called.n > 0) || (lot?.status === 'upcoming' && (lot?.signal?.basis || 0) > 0)
                    ? <>The {(calledIsHonest && called && called.n) || lot?.signal?.basis} sales behind this call sit in the deep corpus — the evidence rows couldn&rsquo;t be loaded right now.</>
                    : <>No comparable sales clear the gates for this lot — lectr doesn&rsquo;t manufacture a pool.</>}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 6 }}>
              {compRows.map((comp, i, all) => (
                // safe-href: undefined renders a non-navigating row — the
                // comp's facts still read, no javascript:-shaped click
                <a key={comp.id} href={safeHref(comp.url)} target="_blank" rel="noopener noreferrer" className="lectr-lot-comp">
                  <span className="lectr-lot-comp-i">{i + 1}</span>
                  <span className="lectr-lot-comp-thumb" aria-hidden>
                    <span>{(craftTitle(comp.title) || '?').charAt(0)}</span>
                    {comp.imageUrl && (
                      <PlateImg src={sizedImg(httpsImg(comp.imageUrl), 160)} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    )}
                  </span>
                  <span className="lectr-lot-comp-t">
                    <span className="lectr-lot-comp-title" style={{ display: 'block' }}>{craftTitle(comp.title)}</span>
                    <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>
                      <span style={{ color: houseColors[comp.auctionHouse] || 'var(--color-text-faint)', fontWeight: 600 }}>{comp.auctionHouse}</span>
                      {' · '}{formatDate(comp.saleDate, { month: 'short', year: 'numeric' })}
                      {/* (r8) the weighted median IS one of these sales — name
                          it (W23: ahead of the medium, which the ellipsis cuts) */}
                      {!band && compsMed != null && face?.comps && enginePool && comp.id === medianRowId(all, compsMed) ? ' · the median' : ''}
                      {(() => {
                        // a medium the title already carries (Christie's rows
                        // echo the secondary title there) is not printed twice
                        const m = comp.medium ? deglue(cleanText(comp.medium)) : '';
                        return m && !foldText(comp.title).includes(foldText(m)) ? ` · ${m}` : '';
                      })()}
                    </span>
                  </span>
                  <span className="lectr-lot-comp-p">{comp.priceUsd ? fmtFace(comp.priceUsd) : '—'}</span>
                </a>
              ))}
            </div>
          )}
        </section>
          )}
          </div>
        </div>
      </div>
      <Colophon lotCount={totalLots || allLots.length} houseCount={houseCount} record={null} />
    </div>
  );
}
