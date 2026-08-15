'use client';

import { useEffect, useInsertionEffect, useMemo, useRef, useState } from 'react';
import { encodeRefPath } from '../ref/ref-path';
import { drillRowFor, drillSlugFor } from '../lib/submarkets';
import { loadCompEvidence, evRowsToLots } from '../lib/comp-evidence';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import { ARTIST_LABEL, ARTIST_MARKET, MARKETS } from '../constants';
import { useFullLots, useSoldArchive, retryFullLoad, retryArchiveLoad } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { useRefs } from '../hooks/useRefs';
import { safeHref } from '../lib/safe-href';
import { formatDate, formatPrice, craftTitle, httpsImg, sizedImg, cleanText, getUpcomingCounts, houseColors, refLabel } from '../utils';
import { signalWithPool, appraiseLot, soldCompBand, isSportsScienceObject, FORM_LABEL, signalMagnitude, scienceReferenceBand, cultureReferenceBand } from '../lib/comps';
import { lotAllInFactor, maxHammerFor } from '../lib/premiums';
import { formatEstimate, lotSignal, confidenceMeter } from './LotCard';
import { daysWord, Colophon } from './Terminal';
import ArtistNav from './ArtistNav';
import Flick from './Flick';
// hotlinked photo that unmounts on failure so the monogram plate under it shows
import PlateImg from './PlateImg';

/**
 * LotPage — one lot as a CATALOGUE PAGE in the certificate language: the
 * matted photograph plate (monogram fallback, CallPlate's pattern) beside a
 * ruled certificate column — microcap kicker, title, dotted-leader rows, the
 * comp pool as compact ledger rows, and the CTA row (view at house / save /
 * copy permalink). Serves BOTH permalink shapes:
 *   /lot?id=<id>        — universal client resolution from the served data
 *   /lot/<id> (static)  — the flagged set, prerendered with initialLot so the
 *                         first paint (and the crawler) sees real content.
 * Sold lots print the realized price, never ask-forward framing; lots past
 * their hammer with no result say "results pending".
 */

/* The copy button styles itself (id-guarded head injection, LotCard's
   pattern) — it mounts inside ComparableModal too, where LOTPAGE_CSS never
   renders. Also concatenated into LOTPAGE_CSS so the prerendered flagged
   pages carry it in their first HTML. */
const COPY_BTN_STYLE_ID = 'lectr-lot-copy-style';
const COPY_BTN_CSS = `
.lectr-lot-copy{display:inline-flex;align-items:center;gap:7px;background:none;border:1px solid var(--color-butter-deep);color:var(--color-butter-text);border-radius:12px;padding:10px 18px;font-family:var(--font-sans);font-size:13.5px;font-weight:600;letter-spacing:-0.01em;cursor:pointer;transition:background var(--duration-fast) var(--ease-signature),color var(--duration-fast) var(--ease-signature)}
.lectr-lot-copy:hover{background:var(--color-butter-subtle)}
.lectr-lot-copy[data-copied=true]{background:var(--color-butter-subtle);color:var(--color-butter)}
`;

/* The catalogue-page layout. Injected via dangerouslySetInnerHTML — raw-text
   <style> children with quotes break hydration on prerendered pages
   (see RecordBand/ComparableModal); __html serializes raw, deterministic. */
// exported for RefPage, which reuses the comp-row ledger grammar
export const LOTPAGE_CSS = COPY_BTN_CSS + `
.lectr-lot{padding-block:26px 64px}
.lectr-lot-grid{display:grid;grid-template-columns:minmax(0,42%) minmax(0,1fr);column-gap:44px;row-gap:26px;align-items:start}
/* ≥900px the two columns are independent flows: the certificate column
   carries the comps ledger under the leader rows, and provenance / the grade
   ladder ride the plate column — no dead space under the plate, no
   full-width band below the certificate. ≤899px the wrappers dissolve
   (display:contents) and CSS order restores the single-column reading order:
   plate → certificate → provenance → ladder → comps. */
.lectr-lot-cola,.lectr-lot-colb{min-width:0}
.lectr-lot-head{position:relative;padding-top:9px;border-top:2px dotted var(--hairline);font-size:10.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-butter-text);display:flex;justify-content:space-between;gap:8px 18px;flex-wrap:wrap;margin-bottom:12px}
.lectr-lot-head::before{content:"";position:absolute;top:2px;left:0;right:0;border-top:1px solid var(--hairline)}
.lectr-lot-head .no{color:var(--color-text-muted);font-weight:600;font-variant-numeric:tabular-nums}
.lectr-lot-title{font-size:clamp(24px,3.4vw,34px);font-weight:650;letter-spacing:-0.02em;line-height:1.15;color:var(--color-fg);margin:0 0 4px}
.lectr-lot-medium{font-size:13px;color:var(--color-text-muted);line-height:1.5;margin:2px 0 0}
.lectr-lot-leaders{margin-top:16px;border-top:1px solid var(--hairline);padding-top:4px}
.lectr-lot-row{display:flex;align-items:baseline;gap:10px;padding:10px 0;font-size:13.5px}
.lectr-lot-k{color:var(--color-text-muted)}
.lectr-lot-fill{flex:1;border-bottom:1px dotted rgba(255,255,255,0.09);transform:translateY(-3px)}
.lectr-lot-v{font-weight:700;font-variant-numeric:tabular-nums;color:var(--color-fg);white-space:nowrap}
.lectr-lot-v.up{color:var(--color-up)}
.lectr-lot-v.down{color:var(--color-down)}
.lectr-lot-sub{font-size:11px;font-weight:500;color:var(--color-text-muted);margin-right:2px;white-space:nowrap}
.lectr-lot-dots{font-size:8.5px;letter-spacing:1px;color:var(--color-butter);margin-right:7px}
.lectr-lot-mono{display:flex;align-items:center;justify-content:center;background:var(--color-bg-elevated)}
.lectr-lot-monorules{position:absolute;top:10px;left:12px;right:12px;height:5px;background:linear-gradient(to bottom,var(--color-fg) 0,var(--color-fg) 2px,transparent 2px,transparent 4px,rgba(255,255,255,0.28) 4px,rgba(255,255,255,0.28) 5px)}
.lectr-lot-monoglyph{font-size:64px;font-weight:700;color:var(--color-text-faint);letter-spacing:0.02em;line-height:1}
.lectr-lot .ray-plate-mat{padding:18px;margin-bottom:0}
.lectr-lot .ray-plate-img{height:380px;background:var(--color-bg-elevated)}
.lectr-lot .ray-plate-img img{object-fit:contain}
.lectr-lot .ray-plate-cap{margin-top:12px;border-top:1px solid var(--hairline);padding-top:9px;font-size:11px;color:var(--color-text-muted);text-align:left}
.lectr-lot-ctas{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--hairline)}
.lectr-lot-comps{margin-top:44px}
.lectr-lot-comps-head{position:relative;padding-top:9px;border-top:2px dotted var(--hairline);font-size:10.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-butter-text);display:flex;justify-content:space-between;gap:8px 18px;flex-wrap:wrap}
.lectr-lot-comps-head::before{content:"";position:absolute;top:2px;left:0;right:0;border-top:1px solid var(--hairline)}
.lectr-lot-comps-head .ctx{color:var(--color-text-muted);font-weight:600}
.lectr-lot-comp{display:flex;align-items:center;gap:14px;padding:11px 2px;border-bottom:1px solid var(--hairline-soft);text-decoration:none;color:inherit;transition:background var(--duration-fast) var(--ease-signature)}
.lectr-lot-comp:hover{background:var(--color-hover-item)}
.lectr-lot-comp-i{font-size:12px;color:var(--color-text-faint);font-variant-numeric:tabular-nums;width:18px;text-align:right;flex-shrink:0}
.lectr-lot-comp-thumb{width:40px;height:40px;flex-shrink:0;position:relative;overflow:hidden;background:var(--color-bg-elevated);outline:1px solid rgba(255,255,255,0.1);outline-offset:-1px;display:flex;align-items:center;justify-content:center}
.lectr-lot-comp-thumb span{font-size:16px;font-weight:600;color:var(--color-text-faint)}
.lectr-lot-comp-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.lectr-lot-comp-t{flex:1;min-width:0}
.lectr-lot-comp-title{font-size:13.5px;font-weight:600;color:var(--color-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lectr-lot-comp-meta{font-size:11.5px;color:var(--color-text-faint);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lectr-lot-comp-p{font-size:13.5px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--color-fg);flex-shrink:0}
.lectr-lot-quiet{padding:34px 0;text-align:center;color:var(--color-text-faint);font-size:13px}
.lectr-lot-skel-block{background:var(--color-bg-elevated);border-radius:4px}
@media (prefers-reduced-motion: no-preference){
  .lectr-lot-skel-block{animation:lectrLotPulse 1.4s ease-in-out infinite}
  @keyframes lectrLotPulse{0%,100%{opacity:1}50%{opacity:0.45}}
}
.lectr-lot-noimg .ray-plate-img{height:220px}
@media (max-width:899px){
  .lectr-lot{padding-block-start:14px}
  .lectr-lot-grid{grid-template-columns:minmax(0,1fr)}
  .lectr-lot-cola,.lectr-lot-colb{display:contents}
  /* dissolved wrappers make the sections grid items — kill the auto
     min-content floor or a nowrap comp title widens the page */
  .lectr-lot-grid>*{min-width:0}
  .lectr-lot-cola>.ray-plate-mat{order:1}
  .lectr-lot-cert{order:2}
  .lectr-lot-prov{order:3}
  .lectr-lot-ladder{order:4}
  .lectr-lot-pool{order:5}
  /* inside the grid the 26px row-gap already separates the sections — trim
     the section margin so the total stays the original 44px */
  .lectr-lot-grid .lectr-lot-comps{margin-top:18px}
  .lectr-lot .ray-plate-img{height:240px}
  .lectr-lot-noimg .ray-plate-img{height:160px}
  .lectr-lot-monoglyph{font-size:44px}
  /* narrow screens: subs wrap, rows may stack, values ellipsize — the
     desktop nowrap pair otherwise forces a >390px page render */
  .lectr-lot-row{flex-wrap:wrap}
  .lectr-lot-sub{white-space:normal}
  .lectr-lot-v{max-width:100%;overflow:hidden;text-overflow:ellipsis}
}
`;

const SITE = 'https://lectr.bid';
export function lotPermalink(id: string): string {
  return `${SITE}/lot?id=${encodeURIComponent(id)}`;
}

/** The share affordance: copies the universal permalink, confirms for 1.5s.
    Butter outline — the accent family, never green/red. */
export function CopyLinkButton({ id, style }: { id: string; style?: React.CSSProperties }) {
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
    <button type="button" className="lectr-lot-copy" data-copied={copied} onClick={onCopy} style={style} aria-live="polite">
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
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

/** One dotted-leader certificate row: label — dotted fill — value. */
function LeaderRow({ k, v, tone, sub, children }: {
  k: string; v?: string; tone?: 'up' | 'down'; sub?: string; children?: React.ReactNode;
}) {
  return (
    <div className="lectr-lot-row">
      <span className="lectr-lot-k">{k}</span>
      <span className="lectr-lot-fill" aria-hidden />
      {sub && <span className="lectr-lot-sub">{sub}</span>}
      <span className={`lectr-lot-v${tone ? ` ${tone}` : ''}`}>{children ?? v}</span>
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
          <div className="lectr-lot-skel-block" style={{ width: '70%', height: 30, marginBottom: 10 }} />
          <div className="lectr-lot-leaders">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="lectr-lot-row">
                <span className="lectr-lot-skel-block" style={{ width: 74, height: 12 }} />
                <span className="lectr-lot-fill" aria-hidden />
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
      <div className="kicker" style={{ marginBottom: 14, fontVariantNumeric: 'tabular-nums' }}>
        {id ? `no. ${id}` : 'no lot number'}
      </div>
      <h1 style={{ fontSize: 'clamp(24px, 4vw, 32px)', fontWeight: 650, letterSpacing: '-0.02em', color: 'var(--color-fg)', margin: '0 0 10px' }}>
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
  // useFullLots: a permalink to a lot outside the eager slice (rolled-off or
  // sold) settles only once fullLoaded||fullError, and comps/appraisal read the
  // full corpus — so this route must trigger phase 2.
  const { allLots, loading, fullLoaded, fullError, lastCrawl, market, totalLots } = useFullLots();
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
  // never deleted, so a permalink keeps resolving after the lot rolls off
  // the tape. Live shard data supersedes it the moment it arrives.
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
  const preResolved = live || initialLot || dbLot || null;
  const isGoldinId = lotId.startsWith('goldin');
  const wantsArchive =
    (!!preResolved && isSportsScienceObject(preResolved)) ||
    (!preResolved && isGoldinId && (fullLoaded || fullError));
  const archiveLot = useMemo(
    () => (!preResolved && archive.archiveLoaded ? archive.soldArchive.find(l => l.id === lotId) || null : null),
    [preResolved, archive.archiveLoaded, archive.soldArchive, lotId],
  );
  const lot = preResolved || archiveLot;

  // set the tab title on the query route (the static set gets real metadata)
  useEffect(() => {
    if (lot) document.title = `${craftTitle(lot.title)} — lectr`;
  }, [lot]);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);
  const houseCount = useMemo(() => new Set(allLots.map(l => l.auctionHouse)).size, [allLots]);

  // ── the certificate's numbers ─────────────────────────────────────────
  const isUpcoming = lot?.status === 'upcoming';
  const todayIso = (lastCrawl || (mounted ? new Date().toISOString() : '')).slice(0, 10);
  const isPastPending = !!lot && isUpcoming && !!lot.resultsPending && !!lot.saleDate && !!todayIso && lot.saleDate.slice(0, 10) < todayIso;

  // the number every card shows: crawl-time signal first, client compute after
  const sig = useMemo(() => (lot && isUpcoming ? lotSignal(lot, allLots) : null), [lot, allLots, isUpcoming]);

  // the comp pool behind the rows — the ENGINE's pool when it made the call
  // (same doctrine as ComparableModal: one lot, one statistic), else the
  // client read; sports/science objects get the descriptive realized band.
  const bandPoolLots = useMemo(
    () => (archive.archiveLoaded && archive.soldArchive.length ? [...allLots, ...archive.soldArchive] : allLots),
    [allLots, archive.archiveLoaded, archive.soldArchive],
  );
  const band = useMemo(
    () => (lot && isSportsScienceObject(lot) ? soldCompBand(lot, bandPoolLots) : null),
    [lot, bandPoolLots],
  );
  const called = useMemo(() => {
    if (!lot || band) return null;
    const ev = lot.value;
    // ×5 ESTIMATE-BAND SANITY (mirrors scripts/build-upcoming.ts): a compRatio
    // outside [1/5, 5] is a data fault the build killed at the source — the
    // certificate must never resurrect it. Treat it as no engine call and fall
    // through to the uncalled-lot path.
    const evSane = !ev || ev.compRatio == null || (ev.compRatio <= 5 && ev.compRatio >= 1 / 5);
    if (ev && ev.signal && ev.compRatio != null && evSane) {
      // 'at comparable market' = the engine looked and called it fair — no
      // call, no comp pool, no client second-guessing (ComparableModal's
      // exact doctrine).
      if (ev.signal.label.startsWith('at')) return null;
      const byId = new Map(allLots.map(l => [l.id, l]));
      // sold-with-price only (ComparableModal's exact guard): a pool id
      // resolving to a relisted/faulted lot must never feed a price read
      const pool = (ev.poolIds || [])
        .map(id => byId.get(id))
        .filter((x): x is AuctionLot => !!x && x.status === 'sold' && !!x.priceUsd);
      // pool may resolve EMPTY (engine pools draw on the off-wire corpus
      // tier) — keep the engine call anyway; the evidence fetch below fills
      // the rows. Falling through to signalWithPool would print a DIFFERENT
      // read against the same header (the contradiction Collin caught).
      return { pool, n: ev.n || pool.length, med: ev.compValueUsd, form: lot.formKey || null, kind: 'form' as const };
    }
    const read = signalWithPool(lot, allLots);
    return read ? { pool: read.pool, n: read.pool.length, med: read.signal.med, form: read.signal.form as string, kind: read.signal.kind } : null;
  }, [lot, allLots, band]);

  // build-shipped evidence rows for engine calls whose poolIds aren't on-wire
  // (undefined = loading · null = fetched, nothing there)
  const [evRows, setEvRows] = useState<AuctionLot[] | null | undefined>(undefined);
  const needEvidence = (!!lot && !!called && called.pool.length === 0 && !band)
    || (!!lot && !called && !band && !isSportsScienceObject(lot) && lot.status === 'upcoming' && !!lot.signal && (lot.signal.basis || 0) > 0);
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
    const pool = band ? band.pool : called ? (called.pool.length ? called.pool : (evRows || [])) : (evRows || []);
    return [...pool]
      .sort((a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime())
      .slice(0, 12);
  }, [band, called, evRows]);

  // ── provenance: the same physical object across the book ──
  // repeatSaleGroupId is the engine's strict physical-match verdict (photo/
  // edition/serial-justified, price-sanity-guarded) — never fuzzy title echo.
  const provenance = useMemo(() => {
    const gid = lot?.repeatSaleGroupId;
    if (!lot || !gid) return [];
    const rows = bandPoolLots.filter(l => l.repeatSaleGroupId === gid);
    if (!rows.some(r => r.id === lot.id)) rows.push(lot);
    return rows.length >= 2
      ? rows.slice().sort((a, b) => ((a.saleDate || '') < (b.saleDate || '') ? -1 : 1))
      : [];
  }, [lot, bandPoolLots]);

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
  const compsMed = useMemo(() => {
    if (!lot) return null;
    const sigMed = (sig as (NonNullable<typeof sig> & { med?: number }) | null)?.med;
    if (sigMed != null) return sigMed;
    if (called?.med != null) return called.med;
    if (band) return band.median;
    if (fullLoaded) return appraiseLot(lot, allLots)?.value ?? null;
    return null;
  }, [lot, sig, called, band, fullLoaded, allLots]);
  const compsN = sig?.basis ?? (band ? band.n : called?.n) ?? null;

  // ── reference comps: a low-confidence measured RANGE, never a flag ──
  // scienceReferenceBand/cultureReferenceBand scan the whole corpus, so gate
  // on fullLoaded. Purely descriptive $ context — the render carries no tone,
  // no %, no mono; it labels itself low-confidence reference.
  const refBand = useMemo(() => {
    if (!lot || !fullLoaded) return null;
    const mkt = ARTIST_MARKET[lot.artist];
    if (mkt === 'science') return scienceReferenceBand(lot, allLots);
    if (mkt === 'culture') return cultureReferenceBand(lot, allLots);
    return null;
  }, [lot, fullLoaded, allLots]);

  // ── resolution states ─────────────────────────────────────────────────
  if (!lot) {
    const mainSettled = fullLoaded || fullError;
    const archiveSettled = !isGoldinId || archive.archiveLoaded || archive.archiveError;
    const settled = !lotId || (!loading && mainSettled && archiveSettled && dbSettled);
    return (
      <div className="terminal-shell">
        <ArtistNav activeSlug={null} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />
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
  const makerName = ARTIST_LABEL[lot.artist] || lot.artist;
  const marketKey = ARTIST_MARKET[lot.artist];
  const marketLabel = MARKETS.find(m => m.key === marketKey)?.label || null;
  const monogram = (makerName.trim().charAt(0) || craftTitle(lot.title).charAt(0) || '?').toUpperCase();
  const imgOk = !!lot.imageUrl && !imgFailed;
  const saved = isSaved(lot.id);
  const isSold = lot.status === 'sold' || lot.status === 'bought_in';
  const houseColor = houseColors[lot.auctionHouse] || 'var(--color-text-secondary)';
  const beatRate = lot.value?.signal?.beatRatePct ?? null;
  const caption = `${lot.lotNumber != null ? `Lot ${lot.lotNumber} · ` : ''}${lot.auctionHouse}${lot.saleName ? ` · ${cleanText(lot.saleName)}` : ''}`;
  const formLabel = (band && ((FORM_LABEL as Record<string, string>)[band.form] || band.form))
    || (called?.form && (FORM_LABEL as Record<string, string>)[called.form])
    || 'sales';
  const compsPending = (!band && !called && !fullLoaded && !fullError)
    || (needEvidence && evRows === undefined);
  // D2 P1 — ComparableModal's isCardComp suppression, mirrored: a card-comp
  // lot's proof surface IS the exact-card rows + grade ladder already on the
  // certificate (its poolIds are sold-card ids outside the client corpus), so
  // an empty generic pool must not print "No comparable sales clear the
  // gates" under a "This card — N sales" row — a self-contradiction.
  const isCardComp = lot.value?.basis === 'card-comp' && (lot.cardComps?.n ?? 0) > 0;
  const hideComps = isCardComp && compRows.length === 0;

  return (
    <div className="terminal-shell">
      <ArtistNav activeSlug={lot.artist in ARTIST_LABEL ? lot.artist : null} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />
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
                  alt={craftTitle(lot.title)}
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
            <section className="lectr-lot-comps lectr-lot-prov" aria-label="Provenance">
              <div className="lectr-lot-comps-head">
                <span>Provenance · this exact object, {provenance.length} appearances</span>
                <span className="ctx">physical matches, engine-confirmed</span>
              </div>
              <div style={{ marginTop: 6 }}>
                {provenance.map(p => {
                  const here = p.id === lot.id;
                  const money = p.status === 'sold' && p.priceUsd
                    ? formatPrice(p.priceUsd)
                    : p.status === 'bought_in' ? 'bought in'
                    : p.status === 'upcoming' ? (formatEstimate(p) || 'on the block') : '—';
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

          {/* the grade ladder — same card, every grade: the economics of the
              card market in one table. Build-stamped from exact identity
              matches, never similarity. */}
          {lot.cardComps && lot.cardComps.gradeLadder.length > 1 && (
            <section className="lectr-lot-comps lectr-lot-ladder" aria-label="Grade ladder">
              <div className="lectr-lot-comps-head">
                <span>The grade ladder · this card, every grade</span>
                <span className="ctx">medians, never means</span>
              </div>
              <div style={{ marginTop: 6 }}>
                {lot.cardComps.gradeLadder.map(r => (
                  <span key={r.g} className="lectr-lot-comp" style={{ cursor: 'default' }}>
                    <span className="lectr-lot-comp-t">
                      <span className="lectr-lot-comp-title" style={{ display: 'block' }}>{r.g}</span>
                      <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>{r.n} {r.n === 1 ? 'sale' : 'sales'}</span>
                    </span>
                    <span className="lectr-lot-comp-p">{formatPrice(r.med)}</span>
                  </span>
                ))}
              </div>
            </section>
          )}
          </div>

          {/* the certificate column — leader rows, then the comp ledger */}
          <div className="lectr-lot-colb">
          {/* the certificate */}
          <div className="lectr-lot-cert">
            <div className="lectr-lot-head">
              <span>
                {lot.artist in ARTIST_LABEL
                  ? <Link href={`/makers/${lot.artist}`} style={{ color: 'inherit', textDecoration: 'none' }}>{makerName}</Link>
                  : makerName}
                {marketLabel ? ` · ${marketLabel}` : ''}
              </span>
              <span className="no">no. {lot.id}</span>
            </div>

            <h1 className="lectr-lot-title">{craftTitle(lot.title)}</h1>
            {(lot.year || lot.medium) && (
              <p className="lectr-lot-medium">
                {[lot.year, lot.medium ? cleanText(lot.medium) : null, lot.dimensions].filter(Boolean).join(' · ')}
              </p>
            )}

            <div className="lectr-lot-leaders">
              {isSold ? (
                <>
                  <LeaderRow
                    k={lot.status === 'bought_in' ? 'Result' : 'Realized'}
                    v={lot.status === 'bought_in' ? 'bought in' : lot.priceUsd ? formatPrice(lot.priceUsd) : '—'}
                  />
                  {(lot.estimateLow || lot.estimateHigh) && <LeaderRow k="Estimate" v={formatEstimate(lot)} />}
                </>
              ) : (
                <LeaderRow
                  // label by the value's shape: formatEstimate prints "$4K bid ·
                  // 9 bids" whenever the two-sided estimate is missing and live
                  // bids exist (RR runs bid sales too) — "Ask" over a bid
                  // reading is a mislabel
                  k={lot.auctionHouse === 'Goldin' || (!(lot.estimateLow && lot.estimateHigh) && (lot.currentBid || 0) > 0) ? 'Current bid' : 'Ask'}
                  v={formatEstimate(lot)}
                />
              )}

              {compsMed != null && (
                <LeaderRow k="Comps median" v={formatPrice(compsMed)} sub={compsN != null ? `${compsN} sales` : undefined} />
              )}

              {/* ask-forward framing is for open lots only */}
              {isUpcoming && sig && (
                <LeaderRow
                  k="The gap"
                  v={signalMagnitude(sig.label, sig.pct)}
                  tone={sig.label === 'Below Market' ? 'up' : 'down'}
                  sub={beatRate != null
                    ? `${beatRate}% of flags like this beat their estimate`
                    : sig.label === 'Below Market' ? 'comps over ask' : 'comps under ask'}
                />
              )}
              {isUpcoming && sig && (
                <LeaderRow k="Confidence">
                  <span className="lectr-lot-dots" aria-hidden>{confidenceMeter(sig.confidence).dots}</span>
                  {confidenceMeter(sig.confidence).word}
                </LeaderRow>
              )}
              {isUpcoming && !sig && band && (
                <LeaderRow k="Similar sold" v={`${formatPrice(band.low)}–${formatPrice(band.high)}`} sub={`${band.n} sales`} />
              )}

              {/* ── the action rows (Aug 13 value audit): turn the read into a bid ── */}
              {isUpcoming && (lot.currentBid || 0) > 0 && (
                <LeaderRow
                  k="All-in today"
                  v={formatPrice(Math.round(lot.currentBid! * lotAllInFactor(lot, lot.currentBid)))}
                  sub={`${formatPrice(lot.currentBid!)} bid + ~${Math.round((lotAllInFactor(lot, lot.currentBid) - 1) * 100)}% premium`}
                />
              )}
              {isUpcoming && (() => {
                const floor = (lot.value?.low && lot.value.low > 0 ? lot.value.low : null)
                  ?? (lot.cardComps?.med ? Math.round(lot.cardComps.med * 0.85) : null);
                if (!floor) return null;
                return (
                  <LeaderRow
                    k="Max bid"
                    v={`≤ ${formatPrice(maxHammerFor(floor, lot))} hammer`}
                    sub={`walk-away at the value floor · ${formatPrice(floor)} all-in`}
                  />
                );
              })()}
              {isUpcoming && lot.bidProj?.allIn != null && (
                <LeaderRow
                  k="Projected close"
                  v={`~${formatPrice(lot.bidProj.allIn)}`}
                  tone={lot.bidProj.below ? 'up' : undefined}
                  sub={lot.bidProj.floor
                    ? (lot.bidProj.below ? `still under the ${formatPrice(lot.bidProj.floor)} floor` : `vs ${formatPrice(lot.bidProj.floor)} floor`)
                    : 'bid × close-day curve · all-in'}
                />
              )}
              {isUpcoming && lot.crossLive?.length ? (
                <LeaderRow
                  k="Also live at"
                  v={`${lot.crossLive[0].house} · ${lot.crossLive[0].bid > 0 ? formatPrice(lot.crossLive[0].bid) + ' bid' : 'open'}`}
                  sub={lot.crossLive.length > 1 ? `same card at ${lot.crossLive.length} other venues` : 'the same card, head to head'}
                />
              ) : null}

              {isSold ? (
                <LeaderRow k="Hammered" v={formatDate(lot.saleDate)} />
              ) : isPastPending ? (
                <LeaderRow k="Hammered" v={`${formatDate(lot.saleDate)} · results pending`} />
              ) : (
                <LeaderRow
                  k="Hammers"
                  v={mounted && !isNaN(new Date(lot.saleDate).getTime())
                    ? `${formatDate(lot.saleDate)} · ${daysWord(lot.saleDate)}`
                    : formatDate(lot.saleDate)}
                />
              )}

              <LeaderRow k="House" sub={houseIntel ?? undefined}>
                <span style={{ color: houseColor }}>{lot.auctionHouse}</span>
              </LeaderRow>

              {/* watch lots link into their reference dossier — the page a
                  bidder reads before trusting the estimate. Link gated on the
                  dossier actually existing (ReferenceRow). */}
              {marketKey === 'watches' && lot.reference && (
                <ReferenceRow maker={lot.artist} reference={lot.reference} />
              )}

              {/* sports lots link to the athlete's cross-market dossier */}
              {marketKey === 'sports' && lot.playerSlug && (
                <LeaderRow k="Player">
                  <Link href={`/player?id=${encodeURIComponent(lot.playerSlug)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
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
                    : `${dr.lots.toLocaleString()} lots tracked${dr.typicalUsd != null ? ` · ${formatPrice(dr.typicalUsd)} typical` : ''}`;
                const ref = drillSlugFor(lot);
                const tone: 'up' | 'down' | undefined = pct != null ? (pct >= 0 ? 'up' : 'down') : undefined;
                if (ref) {
                  return (
                    <LeaderRow k="Sub-market" sub={sub} tone={tone}>
                      <Link href={`/sub/${ref.slug.replace(':', '/')}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        {dr.label} <Flick size={10} style={{ marginLeft: 2 }} />
                      </Link>
                    </LeaderRow>
                  );
                }
                return (
                  <LeaderRow k="Sub-market" v={dr.label} sub={sub} tone={tone} />
                );
              })()}

              {/* reference comps — a low-confidence measured RANGE, never a
                  flag. Descriptive $ context: no tone, no %, no mono. The
                  label and sub say "reference · low-confidence" so it can
                  never be read as a verified index or a point estimate. */}
              {refBand && (
                <LeaderRow
                  k="Reference comps"
                  v={`${formatPrice(refBand.q1)}–${formatPrice(refBand.q3)}`}
                  sub={`${formatPrice(refBand.med)} median · ${refBand.n} sales · low-confidence reference`}
                />
              )}

              {/* bid velocity — a descriptive count of recent bids on a live
                  lot. Plain ink: no tone, no mono, never a price. Rendered
                  only when the sibling stamped it and the lot is still open. */}
              {isUpcoming && lot.bidVelocity && lot.bidVelocity.delta > 0 && (
                <LeaderRow
                  k="Bid velocity"
                  v={`+${lot.bidVelocity.delta} ${lot.bidVelocity.delta === 1 ? 'bid' : 'bids'}`}
                  sub={`in the last ${Math.round(lot.bidVelocity.hours)}h${lot.bidVelocity.pctile != null ? ` · faster than ${lot.bidVelocity.pctile}% of live lots` : ''}`}
                />
              )}

              {/* live card: the exact-card record — same card, same grade */}
              {isUpcoming && lot.cardComps && lot.cardComps.n > 0 && (
                <LeaderRow
                  k="This card"
                  v={lot.cardComps.med != null ? formatPrice(lot.cardComps.med) : '—'}
                  sub={`${lot.cardComps.n} ${lot.cardComps.n === 1 ? 'sale' : 'sales'}, same card & grade`}
                  tone={lot.cardComps.med != null && (lot.currentBid || 0) > 0 && lot.currentBid! < lot.cardComps.med ? 'up' : undefined}
                />
              )}
              {isUpcoming && lot.cardComps && lot.cardComps.lastSales.length > 0 && (
                <LeaderRow
                  k="Last sold"
                  v={`${formatPrice(lot.cardComps.lastSales[0].p)}${lot.cardComps.lastSales[0].d ? ` · ${formatDate(lot.cardComps.lastSales[0].d, { month: 'short', year: 'numeric' })}` : ''}`}
                />
              )}
            </div>

            <div className="lectr-lot-ctas">
              {/* scheme-allowlisted (safe-href): a crawler-faulted URL means
                  no house CTA — Save and Copy link still carry the row */}
              {safeHref(lot.url) && (
                <a className="ray-call-btn ray-call-btn-primary" href={safeHref(lot.url)} target="_blank" rel="noopener noreferrer">
                  View at {lot.auctionHouse} <Flick size={11} style={{ marginLeft: 2 }} />
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
              <CopyLinkButton id={lot.id} />
            </div>
          </div>

          {/* the comp pool — the evidence, as ledger rows under the
              certificate (desktop); last in the single-column read (mobile).
              Suppressed for card-comp lots with no client-resolvable pool —
              the exact-card certificate rows are their proof surface. */}
          {!hideComps && (
          <section className="lectr-lot-comps lectr-lot-pool" aria-label="Comparable sales">
          <div className="lectr-lot-comps-head">
            <span>
              {band
                ? `Recent sold · ${band.n} comparable ${formLabel}`
                : called
                  ? called.kind === 'edition'
                    ? `The comps · this exact work, sold ${called.n} times`
                    : `The comps · ${called.n} comparable ${formLabel}`
                  : 'The comps'}
            </span>
            <span className="ctx">medians, never means</span>
          </div>
          {band && (
            <p style={{ fontSize: 12, color: 'var(--color-text-faint)', margin: '10px 0 0', lineHeight: 1.5 }}>
              Realized prices — winning bid plus buyer&rsquo;s premium. Goldin publishes no estimates.
            </p>
          )}

          {compsPending || (lot && isSportsScienceObject(lot) && wantsArchive && !archive.archiveLoaded && !archive.archiveError) ? (
            <div className="lectr-lot-quiet">Loading comparable sales&hellip;</div>
          ) : compRows.length === 0 ? (
            <div className="lectr-lot-quiet">
              {fullError
                ? <>
                    Comparable sales couldn&rsquo;t be loaded.{' '}
                    <button onClick={() => retryFullLoad()} style={{ background: 'none', border: 'none', color: 'var(--color-butter-text)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3, padding: 0 }}>
                      Try again
                    </button>
                  </>
                : (called && called.n > 0) || (lot?.status === 'upcoming' && (lot?.signal?.basis || 0) > 0)
                  ? <>The {(called && called.n) || lot?.signal?.basis} sales behind this call sit in the deep corpus — the evidence rows couldn&rsquo;t be loaded right now.</>
                  : <>No comparable sales clear the gates for this lot — lectr doesn&rsquo;t manufacture a pool.</>}
            </div>
          ) : (
            <div style={{ marginTop: 6 }}>
              {compRows.map((comp, i) => (
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
                      {comp.medium ? ` · ${cleanText(comp.medium)}` : ''}
                    </span>
                  </span>
                  <span className="lectr-lot-comp-p">{comp.priceUsd ? formatPrice(comp.priceUsd) : '—'}</span>
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
