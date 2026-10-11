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
import { useFullLotsOnDemand, useVisibilityTrigger, useSoldArchive, retryFullLoad, retryArchiveLoad } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import { useRefs } from '../hooks/useRefs';
import { safeHref } from '../lib/safe-href';
import { splitTitle, deglue, formatDate, formatPrice, craftTitle, httpsImg, sizedImg, cleanText, getUpcomingCounts, houseColors, refLabel } from '../utils';
import { isSportsScienceObject, FORM_LABEL, signalMagnitude, scienceReferenceBand, cultureReferenceBand, contextComps } from '../lib/comps';
import { enginePoolOf } from '../lib/engine-pool';
import { lotFace, fmtFace, medianRowId, FACE_LABEL } from '../lib/lot-face';
import { lotAllInFactor } from '../lib/premiums';
import { lotFloor, lotMaxBid, lotProjectedClose } from '../lib/verdict';
import { formatEstimate, estimateOnly, lotSignal, confidenceMeter } from './LotCard';
import { daysWord, Colophon } from './Terminal';
import ArtistNav from './ArtistNav';
import Flick from './Flick';
// hotlinked photo that unmounts on failure so the monogram plate under it shows
import PlateImg from './PlateImg';
import { crossSibs } from '../lib/fold';

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
/* ≥900px the plate column is STICKY: the certificate + comp ledger run
   2–3× the plate's height, and the column sat empty under the photograph
   for most of the scroll. align-items:start on the grid lets the column
   keep its own height, so sticky rides it down until the row ends. */
@media (min-width:900px){
  .lectr-lot-cola{position:sticky;top:84px;align-self:start}
}
/* the plate head — north star: quiet gray sentence case over a single
   hairline with crop-mark dots at the rule ends (registration grammar);
   the old tracked-uppercase form is retired on this surface */
.lectr-lot-head{position:relative;padding-top:14px;border-top:1px solid var(--hairline);font-size:13.5px;font-weight:400;letter-spacing:0.01em;color:var(--color-text-muted);display:flex;justify-content:space-between;gap:8px 18px;flex-wrap:wrap;margin-bottom:14px}
.lectr-lot-head::before,.lectr-lot-head::after{content:"";position:absolute;top:-2px;width:3px;height:3px;border-radius:50%;background:var(--color-border-mid)}
.lectr-lot-head::before{left:-1.5px}
.lectr-lot-head::after{right:-1.5px}
.lectr-lot-head .no{color:var(--color-text-faint);font-weight:400;font-variant-numeric:tabular-nums}
/* the lot's name goes light-display — authority through lightness */
.lectr-lot-title{font-size:clamp(28px,4vw,42px);font-weight:330;letter-spacing:-0.02em;line-height:1.08;color:var(--color-fg);margin:0 0 6px}
.lectr-lot-medium{font-size:13px;color:var(--color-text-muted);line-height:1.5;margin:2px 0 0}
.lectr-lot-leaders{margin-top:16px;border-top:1px solid var(--hairline);padding-top:4px}
.lectr-lot-row{display:flex;align-items:baseline;gap:10px;padding:10px 0;font-size:13.5px}
.lectr-lot-k{color:var(--color-text-muted)}
.lectr-lot-fill{flex:1;border-bottom:1px dotted var(--color-border-mid);transform:translateY(-3px)}
.lectr-lot-v{font-weight:700;font-variant-numeric:tabular-nums;color:var(--color-fg);white-space:nowrap}
.lectr-lot-v.up{color:var(--color-up)}
.lectr-lot-v.down{color:var(--color-down)}
.lectr-lot-sub{font-size:11px;font-weight:500;color:var(--color-text-muted);margin-right:2px;white-space:nowrap}
.lectr-lot-mono{display:flex;align-items:center;justify-content:center;background:var(--color-bg-elevated)}
.lectr-lot-monorules{position:absolute;top:10px;left:12px;right:12px;height:5px;background:linear-gradient(to bottom,var(--color-fg) 0,var(--color-fg) 2px,transparent 2px,transparent 4px,var(--color-border-mid) 4px,var(--color-border-mid) 5px)}
.lectr-lot-monoglyph{font-size:64px;font-weight:700;color:var(--color-text-faint);letter-spacing:0.02em;line-height:1}
.lectr-lot .ray-plate-mat{padding:18px;margin-bottom:0}
.lectr-lot .ray-plate-img{height:380px;background:var(--color-bg-elevated)}
.lectr-lot .ray-plate-img img{object-fit:contain}
.lectr-lot .ray-plate-cap{margin-top:12px;border-top:1px solid var(--hairline);padding-top:9px;font-size:11px;color:var(--color-text-muted);text-align:left}
.lectr-lot-ctas{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px;padding-top:16px;border-top:1px dotted var(--color-border-mid)}
.lectr-lot-comps{margin-top:44px}
.lectr-lot-comps-head{position:relative;padding-top:9px;border-top:2px dotted var(--hairline);font-size:10.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-butter-text);display:flex;justify-content:space-between;gap:8px 18px;flex-wrap:wrap}
.lectr-lot-comps-head::before{content:"";position:absolute;top:2px;left:0;right:0;border-top:1px solid var(--hairline)}
.lectr-lot-comps-head .ctx{color:var(--color-text-muted);font-weight:600}
.lectr-lot-comp{display:flex;align-items:center;gap:14px;padding:11px 2px;border-bottom:1px solid var(--hairline-soft);text-decoration:none;color:inherit;transition:background var(--duration-fast) var(--ease-signature)}
.lectr-lot-comp:hover{background:var(--color-hover-item)}
.lectr-lot-comp-i{font-size:12px;color:var(--color-text-faint);font-variant-numeric:tabular-nums;width:18px;text-align:right;flex-shrink:0}
.lectr-lot-comp-thumb{width:40px;height:40px;flex-shrink:0;position:relative;overflow:hidden;border-radius:8px;background:var(--color-bg-elevated);border:1px solid color-mix(in srgb, var(--color-butter) 13%, transparent);display:flex;align-items:center;justify-content:center}
.lectr-lot-comp-thumb span{font-family:var(--font-serif), serif;font-style:normal;font-weight:500;font-size:17px;line-height:1;color:color-mix(in srgb, var(--color-butter) 55%, var(--color-text-faint))}
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
/* ── NORTH STAR, lot-only additions — every rule below is scoped under
   .lectr-lot (or an -lk/-lval/-read/-shead class only this page renders),
   so the shared comp-ledger grammar Ref/Sub/Player reuse is untouched.
   The .lectr-lot-row/-k/-v/-fill/-sub family above now serves PlayerPage;
   this page's spec rows speak .ns-ledger-row. ── */
.lectr-lot-byline{margin:18px 0 2px}
.lectr-lot .ns-byline .s{font-size:11px;line-height:1.45;color:var(--color-text-faint);margin-top:3px;max-width:230px}
.lectr-lot .lectr-lot-leaders{border-top:none;padding-top:0;margin-top:8px}
.lectr-lot-lk{font-size:13px;color:var(--color-text-muted);flex:none}
.lectr-lot-lval{display:flex;align-items:baseline;justify-content:flex-end;gap:10px;min-width:0;text-align:right}
.lectr-lot-lsub{font-size:11px;font-weight:500;color:var(--color-text-muted);white-space:nowrap}
.lectr-lot-lv{font-size:13.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--color-fg);white-space:nowrap}
.lectr-lot-lv.up{color:var(--color-up)}
.lectr-lot-lv.down{color:var(--color-down)}
/* the read as color — compact ns-cell-color face; ground = the signal */
.lectr-lot-read{min-height:0;padding:20px 22px;border-radius:16px;margin:18px 0 4px}
.lectr-lot-read-stat{font-family:var(--font-mono),monospace;font-size:clamp(30px,3.2vw,40px);font-weight:500;letter-spacing:-0.02em;line-height:1;font-variant-numeric:tabular-nums;margin:10px 0 8px}
.lectr-lot-read .ns-cell-label{font-size:13px}
.lectr-lot-read .ns-cell-body{font-size:13px;font-weight:450;line-height:1.5;max-width:40ch}
/* section heads — quiet kicker + light headline on a registration plate */
.lectr-lot-shead{display:flex;justify-content:space-between;align-items:flex-end;gap:8px 18px;flex-wrap:wrap;padding-top:14px}
.lectr-lot-shead .ns-kicker{margin-bottom:4px}
.lectr-lot-h2{font-size:clamp(19px,2.2vw,23px);font-weight:350;letter-spacing:-0.02em;line-height:1.15;color:var(--color-fg);margin:0}
.lectr-lot-shctx{font-size:11.5px;color:var(--color-text-faint);padding-bottom:2px}
.lectr-lot .lectr-lot-comp{border-bottom:1px dotted var(--color-border-mid)}
.lectr-lot .lectr-lot-note{padding:14px 16px;margin-top:14px}
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
  /* north-star rows: same wrap doctrine on the new ledger grammar */
  .lectr-lot-lval{flex-wrap:wrap}
  .lectr-lot-lsub{white-space:normal}
  .lectr-lot-lv{max-width:100%;overflow:hidden;text-overflow:ellipsis}
  .lectr-lot .ns-byline .s{max-width:100%}
  .lectr-lot-read-stat{font-size:30px}
}
/* tablet band only — under 641px the byline rides the global 2-up grid
   and its own gap rhythm; this flex-era tightening must not override it */
@media (min-width:641px) and (max-width:899px){
  .lectr-lot .ns-byline{gap:8px 28px}
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

/** One certificate spec row in the north-star ledger grammar: label left,
    sub + value right, dotted hairline between rows (.ns-ledger-row). Tone
    stays lamp-lawful — up/down only ever carry the signal's own direction. */
function LeaderRow({ k, v, tone, sub, children }: {
  k: string; v?: string; tone?: 'up' | 'down'; sub?: string; children?: React.ReactNode;
}) {
  return (
    <div className="ns-ledger-row">
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
  const preResolved = live || initialLot || dbLot || shardHit || null;

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
  const isPastPending = !!lot && isUpcoming && !!lot.resultsPending && !!lot.saleDate && !!todayIso && lot.saleDate.slice(0, 10) < todayIso;

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
  const poolPartial = !!called && !corpusSettled
    && (!engineCalled || (called.pool.length > 0 && called.n > called.pool.length));
  // (r7) rows the pack doesn't carry (a valued lot whose pack predates r7,
  // an abstained lot's context read) wait on a real pool, not on the pack
  const compsNeedCorpus = !rowsSettled && (poolPartial || needEvidence || (!band && !called) || (!!called && called.pool.length === 0));
  const compsSentinel = useVisibilityTrigger(requestPool, { rootMargin: '0px 0px -180px 0px', enabled: compsNeedCorpus && pack !== undefined });

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
            <section className="lectr-lot-comps lectr-lot-ladder ns-plate" aria-label="Grade ladder">
              <div className="lectr-lot-shead">
                <div>
                  <span className="ns-kicker">The grade ladder</span>
                  <h2 className="lectr-lot-h2">This card, every grade</h2>
                </div>
                <span className="lectr-lot-shctx">medians, never means</span>
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
                {/* the market rides the byline's Category column now —
                    printing it here too would say it twice */}
                {lot.artist in ARTIST_LABEL
                  ? <Link href={maker.href} style={{ color: 'inherit', textDecoration: 'none' }}>{makerName}</Link>
                  : makerName}
              </span>
              <span className="no">no. {lot.id}</span>
            </div>

            {/* the SHORT title carries the h1; a catalogue description the
                house poured into the title field rides beneath as prose */}
            <h1 className="lectr-lot-title">{titleParts.short}</h1>
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
                <div className="k">{isSold || isPastPending ? 'Hammered' : 'Hammers'}</div>
                <div className="v">{formatDate(lot.saleDate)}</div>
                {isPastPending
                  ? <div className="s">results pending</div>
                  : !isSold && mounted && !isNaN(new Date(lot.saleDate).getTime())
                    ? <div className="s">{daysWord(lot.saleDate)}</div>
                    : null}
              </div>
              <div>
                <div className="k">
                  {isSold
                    ? (lot.status === 'bought_in' ? 'Result' : 'Realized')
                    : lot.auctionHouse === 'Goldin' || (!(lot.estimateLow && lot.estimateHigh) && (lot.currentBid || 0) > 0) ? 'Current bid' : 'Ask'}
                </div>
                <div className="v">
                  {isSold
                    ? (lot.status === 'bought_in' ? 'bought in' : lot.priceUsd ? formatPrice(lot.priceUsd) : '—')
                    : (formatEstimate(lot) || '—')}
                </div>
                {!isSold && !(lot.estimateLow && lot.estimateHigh) && !!(lot.estimateLow || lot.estimateHigh) && (lot.currentBid || 0) > 0 && (
                  <div className="s">{estimateOnly(lot)} est.</div>
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
                  const mb = lotMaxBid(lot);
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

            <div className="lectr-lot-leaders">
              {isSold && (lot.estimateLow || lot.estimateHigh) ? (
                <LeaderRow k="Estimate" v={formatEstimate(lot)} />
              ) : null}

              {compsMed != null && (
                <LeaderRow k={FACE_LABEL.comps} v={fmtFace(compsMed)}
                  sub={calledIsHonest && face?.comps && enginePool ? face.comps.sub : compsN != null ? `${compsN} sales` : undefined} />
              )}

              {/* (r8) the engine's value on a valued lot without a read cell —
                  the modal's and the plate's figure (the read cell carries it
                  when there is a call) */}
              {isUpcoming && face?.value && lot.value?.basis !== 'card-comp' && !(sig && !!(lot.estimateLow || lot.estimateHigh)) && (
                <LeaderRow k={FACE_LABEL.value} v={face.value.text} sub={`${FACE_LABEL.valueSub} · ${FACE_LABEL.range} ${face.value.range}`} />
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
                // (Oct 6 2026, wave 3) the engine's own max bid (verdict.ts —
                // one source), not the hammer under the band's all-in low
                const mb = lotMaxBid(lot);
                if (!mb) return null;
                return (
                  <LeaderRow
                    k="Max bid"
                    v={`≤ ${fmtFace(mb.hammer)} hammer`}
                    sub={`walk-away price · ${fmtFace(mb.allIn)} all-in`}
                  />
                );
              })()}
              {isUpcoming && lotProjectedClose(lot) != null && (() => {
                // (Oct 6 2026, wave 3) only a projection whose cell is
                // validated on the graded tape (bidProj.ok) prints.
                // the build stamps bidProj.floor UNGATED (value.low at any
                // confidence); the floor a reader may lean on is the gated
                // one — no gated floor, no "under the floor" and no lamp
                const proj = lotProjectedClose(lot)!;
                const floor = gatedFloor(lot);
                const below = !!floor && proj < floor;
                return (
                  <LeaderRow
                    k="Projected close"
                    v={`~${formatPrice(proj)}`}
                    tone={below ? 'up' : undefined}
                    sub={floor
                      ? (below ? `still under the ${formatPrice(floor)} floor` : `vs ${formatPrice(floor)} floor`)
                      : 'bid × close-day curve · all-in'}
                  />
                );
              })()}
              {isUpcoming && crossSibs(lot).length ? (() => {
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
                    v={`${sibs[0].house} · ${sibs[0].bid > 0 ? formatPrice(sibs[0].bid) + ' bid' : 'open'}`}
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
                  // (wave 3) the median is all-in: the bid is compared all-in too
                  tone={lot.cardComps.med != null && (lot.currentBid || 0) > 0 && lot.currentBid! * lotAllInFactor(lot, lot.currentBid!) < lot.cardComps.med ? 'up' : undefined}
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
                      {comp.medium ? ` · ${deglue(cleanText(comp.medium))}` : ''}
                      {/* (r8) the weighted median IS one of these sales — name it */}
                      {!band && compsMed != null && face?.comps && enginePool && comp.id === medianRowId(all, compsMed) ? ' · the median' : ''}
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
