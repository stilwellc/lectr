'use client';

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { LazyMotion, domAnimation } from 'framer-motion';
import type { AuctionLot } from '../types';
import { ARTIST_LABEL, MARKETS, marketArtists } from '../constants';
import { useMarket } from '../lib/market';
import MarketSwitch from '../components/MarketSwitch';
import { Colophon, pickCall, CallPlate, daysUntil } from '../components/Terminal';
import { useRayData, triggerFullLoad, retryFullLoad } from '../hooks/useRayData';
import type { Backtest } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
import ArtistNav from '../components/ArtistNav';
import { lotSignal, formatEstimate, confidenceMeter, LiveStamp } from '../components/LotCard';
import ComparableModal, { PriceBand } from '../components/ComparableModal';
// The paper room's two recharts consumers stay OUT of the initial bundle
// (dynamic, ssr:false, fixed-height fallbacks so the swap can never shift).
const RecordByYear = dynamic(() => import('../components/RecordByYear'), {
  ssr: false,
  // 380px = the settled component's real flow height (section pad 30 + head
  // ~48 + glass panel ~302) — a 300px reserve shifted the paper room ~75px
  loading: () => <div style={{ height: 380, borderRadius: 12, opacity: 0.4 }} aria-hidden />,
});
// The market-pulse index line rides the lander's hand-rolled instrument —
// ssr:false because it measures its container with a ResizeObserver.
const HeroChart = dynamic(() => import('../preview/terminal/HeroChart'), {
  ssr: false,
  loading: () => <div style={{ height: 120 }} aria-hidden />,
});
// The CI caliper — the signature instrument for any CI'd claim. Framer m.
// components: every mount wraps in <LazyMotion features={domAnimation} strict>.
import { CIBeam } from '../preview/terminal/CIBeam';
import { useReducedMotion } from '../preview/terminal/hooks';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import FigCap from '../components/FigCap';
import RecordBand from '../components/RecordBand';
import Masthead, { Accent } from '../components/Masthead';
import Flick from '../components/Flick';
import CloseClock from '../components/CloseClock';
import CountUp from '../components/CountUp';
import {
  FlagsMark, GapMark, SleeperMark, PulseMark,
  DistMark, TapeMark, EngineMark,
} from '../components/marks';
// THE CELL SYSTEM — the shared ElevenLabs cell grammar (cells.tsx +
// globals.css "THE CELL SYSTEM"): figure cells for the reads room, the
// forced-color cell classes re-plate the call. Never redefined here.
import { CellGrid, FigureCell, FigGate, FigReplay, FigPools } from '../components/cells';
import { getUpcomingCounts, formatPrice, formatDate, craftTitle, httpsImg, fmtSignedPct, localToday, isLiveUpcoming, trueSaleDay, overEstimatePct, toneOf } from '../utils';
import { signalWithPool, dealScore, signalMagnitude } from '../lib/comps';
import { gapRead, sleeperRead, type GapRead, type SleeperRead } from '../lib/lanes';

const ROWS_PAGE = 12;

/* ── PHASE-2 SENTINEL — /value no longer pulls the 28MB corpus eagerly.
   Everything above the settled tape paints from phase 1 (signal stamps,
   backtest, market.json) + the 540KB comp-evidence pool rows; the corpus
   fires only as the reader approaches the tape (or opens the comps modal). */
function Phase2Sentinel() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { triggerFullLoad(); return; }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { triggerFullLoad(); io.disconnect(); }
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} aria-hidden />;
}

/* comp-evidence.json — the engine pool's actual rows for lots whose comps
   live in the corpus-only tier (the modal's own fallback source). Module-
   cached; one 540KB fetch serves the session. */
type EvidenceMap = Record<string, { i: string; t: string; h: string; d: string; p: number }[]>;
let evidenceCache: EvidenceMap | null = null;
let evidenceInflight: Promise<EvidenceMap | null> | null = null;
function loadEvidence(): Promise<EvidenceMap | null> {
  if (evidenceCache) return Promise.resolve(evidenceCache);
  if (!evidenceInflight) {
    evidenceInflight = fetch('/data/ray/comp-evidence.json')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { evidenceCache = (j?.byLot as EvidenceMap) || null; return evidenceCache; })
      .catch(() => { evidenceInflight = null; return null; });
  }
  return evidenceInflight;
}

/** "653878" → "653.9K" — coverage-dial compaction, one decimal max */
function compactCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}
function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s.length % 2 === 0 ? (s[s.length / 2 - 1] + s[s.length / 2]) / 2 : s[Math.floor(s.length / 2)];
}

/* ── ROOM 1c · THE DIAL STRIP — one fused stat band, never boxed tiles.
   Numerals ride fixed min-width slots so CountUp can't shift a neighbor. ── */
interface Dial { k: string; v: React.ReactNode; sub: React.ReactNode; tone?: 'up' | 'down' }
function DialStrip({ dials }: { dials: Dial[] }) {
  return (
    <div className="vd-dials" role="list">
      {dials.map(d => (
        <div key={d.k} className="vd-dial" role="listitem">
          <span className="vd-dial-k kicker">{d.k}</span>
          <span className="vd-dial-v" data-tone={d.tone || undefined}>{d.v}</span>
          <span className="vd-dial-s">{d.sub}</span>
        </div>
      ))}
    </div>
  );
}

/* ── ROOM 1d · THE MARKET PULSE — the scoped market's index line + the
   honesty-ladder read beneath it (repeat-sale → hedonic → demand →
   coverage; the strongest read the data supports, its basis named). ── */
type PulseRead =
  | { kind: 'ci'; changePct: number; lo: number; hi: number; label: string }
  | { kind: 'plain'; text: React.ReactNode };

function MarketPulse({ ray, activeKey, activeLabel, play }: {
  ray: ReturnType<typeof useRayData>;
  activeKey: string;
  activeLabel: string;
  play: boolean;
}) {
  const reduce = useReducedMotion();
  const series = ray.market?.markets?.[activeKey]?.index;
  const read = useMemo<PulseRead | null>(() => {
    const rs = ray.market?.repeatSale?.[activeKey];
    const rs1 = rs?.horizons?.['1Y'];
    if (rs && rs1?.publishable && rs1.changePct != null && rs1.ciLoPct != null && rs1.ciHiPct != null) {
      return { kind: 'ci', changePct: rs1.changePct, lo: rs1.ciLoPct, hi: rs1.ciHiPct, label: `1Y · repeat-sale · ${(rs.nPairs || 0).toLocaleString()} pairs` };
    }
    const hd = ray.market?.hedonic?.[activeKey]?.horizons?.['1Y'];
    if (hd && hd.changePct != null && hd.ciLoPct != null && hd.ciHiPct != null) {
      return { kind: 'ci', changePct: hd.changePct, lo: hd.ciLoPct, hi: hd.ciHiPct, label: '1Y · hedonic index' };
    }
    const dm = ray.demand?.[activeKey];
    if (dm?.length) {
      const last = dm[dm.length - 1];
      return { kind: 'plain', text: <>demand read <b style={{ color: 'var(--color-fg)' }}>{fmtSignedPct(Math.round(last.value))}</b> vs estimate · {last.date}</> };
    }
    const n = ray.market?.markets?.[activeKey]?.n;
    if (n) return { kind: 'plain', text: <>{n.toLocaleString()} sold {activeLabel} lots read — no publishable index yet</> };
    return null;
  }, [ray.market, ray.demand, activeKey, activeLabel]);

  const anchor = useMemo(() => series && series.length >= 4 ? {
    key: 'idx',
    label: `${activeLabel} index`,
    color: 'var(--lw-45, rgba(255, 255, 255, 0.45))',
    unit: 'count' as const,
    points: series,
  } : null, [series, activeLabel]);

  if (!anchor && !read) return null;
  return (
    <div className="vd-pulse">
      <div className="vd-pulse-head">
        <span className="vd-sect-mark" aria-hidden><PulseMark size={15} /></span>
        <span className="ns-kicker">Market pulse</span>
        <span className="vd-pulse-rule" aria-hidden />
      </div>
      {anchor && <HeroChart anchor={anchor} height={120} compact hideTickLabels play={play} />}
      {read && (
        <div className="vd-pulse-read">
          {read.kind === 'ci' ? (
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className="vd-pulse-fig" data-tone={toneOf(read.changePct)}>{fmtSignedPct(Math.round(read.changePct))}</span>
                <span className="vd-pulse-beam">
                  <LazyMotion features={domAnimation} strict>
                    <CIBeam lo={read.lo} hi={read.hi} point={read.changePct} dir={read.changePct >= 0 ? 'up' : 'down'} mini play={play && !reduce} />
                  </LazyMotion>
                </span>
                <span className="vd-pulse-sub" style={{ flex: 'none' }}>95% CI {fmtSignedPct(Math.round(read.lo))} to {fmtSignedPct(Math.round(read.hi))}</span>
              </span>
              <span className="vd-pulse-sub" style={{ display: 'block', marginTop: 4, whiteSpace: 'normal' }}>{read.label}</span>
            </span>
          ) : (
            <span className="vd-pulse-sub" style={{ whiteSpace: 'normal' }}>{read.text}</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ── THE GLOSSARY — the desk explains its own vocabulary. A Term renders a
   dotted-underlined word whose definition surfaces on hover/focus. Tips are
   positioned tooltips, so Terms must live OUTSIDE overflow-clipped panels
   (captions, meters, help strips) — never inside a ledger. ── */
const GLOSSARY: Record<string, string> = {
  'all-in': 'Hammer price plus buyer’s premium — the price a buyer actually pays. Every graded figure on this desk is all-in unless it says hammer.',
  'comps': 'Recent sold results for the same maker, form and size band — medians, never means. Auction results only; asking prices never enter the pool.',
  'odds': 'The share of historical calls at this comp-ratio that beat the high estimate — read from the calibration curve, refit nightly.',
  'floor': 'The engine’s conservative lower bound: the appraisal low at medium-or-better confidence, else 0.85× the card-comps median at three-plus sales.',
  'forming': '3.5–8 days from the close — the projection is still tightening, so the bar is 15 points harder than at the wire.',
  'wire': 'Closing inside 3.5 days — near enough that the close-curve projection has its full accuracy.',
  'graded': 'A call grades when its lot hammers: the realized price is measured against the number the engine put on the tape before the outcome was known.',
  'verified fair': 'The engine’s own appraisal sits within 0.75–1.3× the estimate midpoint — fairness is measured, never inferred from a missing signal.',
  'forward tape': 'The append-only ledger of calls stamped before their outcomes. Each lane publishes its record only after 20 graded calls.',
};
function Term({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="vd-term" tabIndex={0}>
      {children}
      <span className="vd-term-tip" role="tooltip">{GLOSSARY[k]}</span>
    </span>
  );
}

/* ── the shared lane head: mark + name + live count + tagline + rule.
   `help` arms the "?" chip — a one-tap how-to-read strip under the head. ── */
function LaneHead({ mark, name, count, tag, right, help, play }: {
  mark: React.ReactNode; name: string; count?: number | null;
  tag: React.ReactNode; right?: React.ReactNode; help?: React.ReactNode;
  play?: boolean;
}) {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <>
      <div className="vd-lane-head">
        <span className="vd-lane-mark" aria-hidden>{mark}</span>
        <h2 className="vd-lane-name">{name}</h2>
        {count != null && count > 0 && (
          <span className="vd-lane-count">
            <CountUp to={count} format={v => Math.round(v).toLocaleString()} animate={!!play} duration={900} />
          </span>
        )}
        {help && (
          <button
            type="button" className="vd-lane-helpbtn" aria-expanded={showHelp}
            aria-label={`How to read ${name}`}
            onClick={() => setShowHelp(v => !v)}
          >?</button>
        )}
        <span className="vd-pulse-rule" aria-hidden />
        <span className="vd-sect-cap">{tag}</span>
        {right}
      </div>
      {help && showHelp && <div className="ns-well vd-lane-help">{help}</div>}
    </>
  );
}

/* ── cell micro-instruments: a 2px fill track (share-of-cap) and a witness
   track (a dot on a bounded window with a 1.0 center mark). Purely
   presentational — the number stays the statement, the track is the shape. ── */
function CellTrack({ pct, tone }: { pct: number; tone?: 'up' }) {
  return (
    <span className={`vd-cell-track${tone === 'up' ? ' vd-track-up' : ''}`} aria-hidden>
      <span style={{ width: `${Math.max(3, Math.min(100, Math.round(pct)))}%` }} />
    </span>
  );
}
function WitnessTrack({ at }: { at: number }) {
  return (
    <span className="vd-cell-track vd-track-witness" aria-hidden>
      <span className="vd-track-dot" style={{ left: `${Math.max(0, Math.min(100, at))}%` }} />
    </span>
  );
}

/* ── ROOM 2c · THE GAP — "the bidding is behind the value" on no-estimate
   lots: the growth-projected close vs the value floor. Two shelves — AT THE
   WIRE (≤3.5d, depth ≥25%) and FORMING (3.5–8d, ≥40%). A PROJECTION product:
   neutral ink, every entry logs to the forward tape, publishes at 20 graded.
   Same ledger grammar as the Flags board — sibling boards, one language. ── */
function GapAnnex({ rows, receipts, activeKey, play, isSaved, onToggleSave }: {
  rows: { lot: AuctionLot; g: GapRead }[];
  receipts: { record: { gap?: { n: number; graded: number } } } | null;
  activeKey: string;
  play: boolean;
  isSaved: (id: string) => boolean;
  onToggleSave: (id: string, lot?: AuctionLot) => void;
}) {
  const [showForming, setShowForming] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // display caps only — the head pill counts the TRUE lane, and a cut is
  // said out loud (no silent caps: a capped board must not read as complete)
  const wireAll = rows.filter(r => r.g.shelf === 'wire').sort((a, b) => b.g.depth - a.g.depth);
  const formingAll = rows.filter(r => r.g.shelf === 'forming').sort((a, b) => b.g.depth - a.g.depth);
  const wire = wireAll.slice(0, 8);
  const forming = formingAll.slice(0, 6);
  const wireCut = wireAll.length - wire.length;
  if (!wire.length && !forming.length) return null;
  const gapRec = receipts?.record?.gap;
  const row = ({ lot, g }: { lot: AuctionLot; g: GapRead }) => {
    const isOpen = open === lot.id;
    return (
      <div key={lot.id} className="vd-lane-item" data-open={isOpen || undefined}>
        <div
          role="button" tabIndex={0} data-nav-row
          className="vd-lane-row vd-gap-grid"
          aria-expanded={isOpen}
          onClick={() => setOpen(o => (o === lot.id ? null : lot.id))}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => (o === lot.id ? null : lot.id)); } }}
        >
          <span className="ray-value-row-thumb" aria-hidden style={{ position: 'relative' }}>
            <span className="vd-thumb-letter">{(ARTIST_LABEL[lot.artist] || lot.artist).charAt(0)}</span>
            {lot.imageUrl && (
              <img src={httpsImg(lot.imageUrl)} alt="" referrerPolicy="no-referrer" loading="lazy"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => e.currentTarget.remove()} />
            )}
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="ray-value-row-maker" style={{ display: 'block' }}>
              {ARTIST_LABEL[lot.artist] || lot.artist}
              {g.shelf === 'forming' && <span className="vd-lane-tag">early</span>}
            </span>
            <span className="ray-value-row-title" style={{ display: 'block' }}>{craftTitle(lot.title)}</span>
          </span>
          <span className="vd-cell vd-cell-strong">
            −{Math.round(g.depth * 100)}%
            <CellTrack pct={g.depth * 100} />
          </span>
          <span className="vd-cell">
            {formatPrice(g.allIn)} → {formatPrice(g.floor)}
          </span>
          <span className="vd-cell">{(lot.currentBid || 0) > 0 ? formatPrice(lot.currentBid!) : 'no bids'}</span>
          <span className="vd-cell">
            {lot.saleDateTime && (Date.parse(lot.saleDateTime) - Date.now()) < 24 * 3600e3 && (Date.parse(lot.saleDateTime) > Date.now())
              ? <span className="vd-breathe" style={{ color: 'var(--color-fg)', fontWeight: 600 }}><CloseClock iso={lot.saleDateTime} windowHours={24} /></span>
              : formatDate(lot.saleDate)}
          </span>
          {/* mobile stack */}
          <span className="vd-lane-mob">
            <span className="vd-cell-strong" style={{ display: 'block' }}>−{Math.round(g.depth * 100)}% under floor</span>
            <span style={{ display: 'block' }}>{formatPrice(g.allIn)} proj → floor {formatPrice(g.floor)}</span>
            <span style={{ display: 'block' }}>closes {formatDate(lot.saleDate)}</span>
          </span>
        </div>
        {/* THE EVIDENCE — the row's whole case, interrogated in place */}
        <div className="vd-lane-detail">
          <div className="vd-lane-detail-in">
            <p className="vd-detail-lead">
              The room projects <b>{formatPrice(g.allIn)}</b> all-in at the close — <b>{Math.round(g.depth * 100)}%</b> under
              the <b>{formatPrice(g.floor)}</b> floor.
            </p>
            <div className="vd-detail-grid">
              <div>
                <span className="kicker">The floor</span>
                <p>{g.floorSrc === 'value.low'
                  ? 'the engine’s appraisal low — confidence medium or better'
                  : '0.85 × the card-comps median — three or more sales'}</p>
              </div>
              <div>
                <span className="kicker">The projection</span>
                <p>close-day growth curve fitted from Goldin bid histories · current bid {(lot.currentBid || 0) > 0 ? formatPrice(lot.currentBid!) : 'none'}</p>
              </div>
              <div>
                <span className="kicker">The tape</span>
                <p>logged as a gap call · grades at the hammer · publishes at 20 graded</p>
              </div>
            </div>
            {/* the close on the curve's 8-day fitted window */}
            <div className="vd-curve" aria-label={`Closes in ${g.daysOut.toFixed(1)} days — the curve is fitted to 8`}>
              <span className="vd-curve-rail" aria-hidden>
                <span className="vd-curve-wire" style={{ width: `${(3.5 / 8) * 100}%` }} />
                <span className="vd-curve-dot" style={{ left: `${Math.min(100, (g.daysOut / 8) * 100)}%` }} />
              </span>
              <span className="vd-curve-labels" aria-hidden>
                <span>now</span>
                <span style={{ position: 'absolute', left: `${(3.5 / 8) * 100}%`, transform: 'translateX(-50%)' }}>wire ≤3.5d</span>
                <span>8d · curve edge</span>
              </span>
              <span className="vd-curve-read">closes in {g.daysOut < 1 ? `${Math.round(g.daysOut * 24)}h` : `${g.daysOut.toFixed(1)}d`} · {g.shelf === 'wire' ? 'at the wire' : 'forming'}{lot.overlayAt && <> · <LiveStamp iso={lot.overlayAt} /></>}</span>
            </div>
            <div className="vd-detail-actions">
              <Link href={`/lot/${lot.id}`} className="link-action" style={{ color: 'var(--color-fg)' }} onClick={e => e.stopPropagation()}>
                Open the lot <span className="arrow"><Flick size={10} style={{ marginLeft: 5 }} /></span>
              </Link>
              <button
                type="button" className="vd-detail-save" data-save-btn
                aria-pressed={isSaved(lot.id)}
                onClick={e => { e.stopPropagation(); onToggleSave(lot.id, lot); }}
              >
                {isSaved(lot.id) ? 'Saved to your desk' : 'Save to your desk'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };
  return (
    <section id="gap" className="rail ray-enter vd-annex vd-room ns-plate" style={{ '--enter-delay': '80ms' } as React.CSSProperties}>
      <LaneHead
        mark={<GapMark />}
        name="The Gap"
        count={wireAll.length + formingAll.length}
        play={play}
        tag={<>projected close vs floor · no-estimate books · record accruing</>}
        help={
          <>These lots post no estimate, so the engine projects the close from Goldin bid-history
          curves instead. A lot prints when the projection sits at least 25% under
          its <Term k="floor">floor</Term> — at the <Term k="wire">wire</Term> inside
          3.5 days, or <Term k="forming">forming</Term> at a harder bar. Every entry logs to
          the <Term k="forward tape">forward tape</Term> and is <Term k="graded">graded</Term> at
          the hammer. Click a row for its whole case.</>
        }
      />
      <div className="glass glass-quiet vd-lane-panel">
        <div className="vd-lane-cols vd-gap-grid" aria-hidden>
          <span />
          <span className="kicker">Lot</span>
          <span className="kicker" style={{ textAlign: 'right' }}>Under floor</span>
          <span className="kicker" style={{ textAlign: 'right' }}>Proj → floor</span>
          <span className="kicker" style={{ textAlign: 'right' }}>Bid now</span>
          <span className="kicker" style={{ textAlign: 'right' }}>Closes</span>
        </div>
        {wire.map(row)}
        {wireCut > 0 && (
          <div className="vd-forming-toggle" style={{ cursor: 'default' }}>
            {wireCut} more at the wire below the depth cut — the deepest {wire.length} print here
          </div>
        )}
        {forming.length > 0 && (
          <>
            <button type="button" className="vd-forming-toggle" onClick={() => setShowForming(v => !v)} aria-expanded={showForming}>
              {showForming ? 'hide' : 'show'} {forming.length} forming · 3.5–8d out · the projection tightens as the close nears
            </button>
            {showForming && forming.map(row)}
          </>
        )}
      </div>
      <div className="vd-annex-meter">
        {gapRec
          ? <>forward tape: {gapRec.n.toLocaleString()} logged · {gapRec.graded} <Term k="graded">graded</Term> · publishes at 20 graded</>
          : <>forward tape: — · publishes at 20 <Term k="graded">graded</Term></>}
        {' '}· curve fitted from goldin bid histories · estimate-house books abstain{activeKey === 'tcg' || activeKey === 'all' ? <> · tcg: no comp basis yet</> : null}
      </div>
    </section>
  );
}

/* ── ROOM 2d · THE SLEEPERS — "the price is right and nobody's looking":
   verified-fair lots with a dead room, closing ≤7 days. Bursty by
   construction — when empty it prints its calendar, never vanishes. ── */
function SleepersAnnex({ rows, queued, receipts, activeLabel, play, isSaved, onToggleSave }: {
  rows: { lot: AuctionLot; q: SleeperRead }[];
  queued: number;
  receipts: { record: { quiet?: { n: number; graded: number } } } | null;
  activeLabel: string;
  play: boolean;
  isSaved: (id: string) => boolean;
  onToggleSave: (id: string, lot?: AuctionLot) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length && !queued) return null;
  const rec = receipts?.record?.quiet;
  return (
    <section id="sleepers" className="rail ray-enter vd-annex vd-room ns-plate" style={{ '--enter-delay': '100ms' } as React.CSSProperties}>
      <LaneHead
        mark={<SleeperMark />}
        name="The Sleepers"
        count={rows.length}
        play={play}
        tag={<>verified fair · zero bids · closing ≤7d · record accruing</>}
        help={
          <><Term k="verified fair">Verified-fair</Term> lots nobody has bid on, closing inside 7
          days. Fairness is measured against the engine&rsquo;s own appraisal — never inferred from a
          missing signal. The median live estimate lot carries 4 bids; zero is a dead room. Each
          entry logs to the <Term k="forward tape">forward tape</Term> and
          is <Term k="graded">graded</Term> against the appraisal, both <Term k="all-in">all-in</Term>.</>
        }
      />
      {rows.length ? (
        <div className="glass glass-quiet vd-lane-panel">
          <div className="vd-lane-cols vd-slp-grid" aria-hidden>
            <span />
            <span className="kicker">Lot</span>
            <span className="kicker" style={{ textAlign: 'right' }}>Estimate</span>
            <span className="kicker" style={{ textAlign: 'right' }}>Appraised</span>
            <span className="kicker" style={{ textAlign: 'right' }}>The room</span>
            <span className="kicker" style={{ textAlign: 'right' }}>Closes</span>
          </div>
          {rows.slice(0, 6).map(({ lot, q }) => {
            const isOpen = open === lot.id;
            const ratio = q.estMid ? q.cvu / q.estMid : null;
            return (
              <div key={lot.id} className="vd-lane-item" data-open={isOpen || undefined}>
                <div
                  role="button" tabIndex={0} data-nav-row
                  className="vd-lane-row vd-slp-grid"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(o => (o === lot.id ? null : lot.id))}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => (o === lot.id ? null : lot.id)); } }}
                >
                  <span className="ray-value-row-thumb" aria-hidden style={{ position: 'relative' }}>
                    <span className="vd-thumb-letter">{(ARTIST_LABEL[lot.artist] || lot.artist).charAt(0)}</span>
                    {lot.imageUrl && (
                      <img src={httpsImg(lot.imageUrl)} alt="" referrerPolicy="no-referrer" loading="lazy"
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={e => e.currentTarget.remove()} />
                    )}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="ray-value-row-maker" style={{ display: 'block' }}>{ARTIST_LABEL[lot.artist] || lot.artist}</span>
                    <span className="ray-value-row-title" style={{ display: 'block' }}>{craftTitle(lot.title)}</span>
                  </span>
                  <span className="vd-cell">{q.estMid ? formatPrice(q.estMid) : '—'}</span>
                  <span className="vd-cell vd-cell-strong">
                    {formatPrice(q.cvu)}
                    {ratio != null && <WitnessTrack at={((ratio - 0.75) / (1.3 - 0.75)) * 100} />}
                  </span>
                  <span className="vd-cell">0 bids{q.entry != null ? ` · opens ${formatPrice(q.entry)}` : ''}</span>
                  <span className="vd-cell">
                    {lot.saleDateTime && (Date.parse(lot.saleDateTime) - Date.now()) < 24 * 3600e3 && (Date.parse(lot.saleDateTime) > Date.now())
                      ? <span className="vd-breathe" style={{ color: 'var(--color-fg)', fontWeight: 600 }}><CloseClock iso={lot.saleDateTime} windowHours={24} /></span>
                      : formatDate(q.closes)}
                  </span>
                  <span className="vd-lane-mob">
                    <span className="vd-cell-strong" style={{ display: 'block' }}>appraised {formatPrice(q.cvu)}</span>
                    <span style={{ display: 'block' }}>{q.estMid ? `est ${formatPrice(q.estMid)} · ` : ''}0 bids{q.entry != null ? ` · opens ${formatPrice(q.entry)}` : ''}</span>
                    <span style={{ display: 'block' }}>closes {formatDate(q.closes)}</span>
                  </span>
                </div>
                <div className="vd-lane-detail">
                  <div className="vd-lane-detail-in">
                    <p className="vd-detail-lead">
                      {q.anchor === 'fair-est'
                        ? <>Appraised <b>{formatPrice(q.cvu)}</b> against a <b>{formatPrice(q.estMid!)}</b> estimate
                            midpoint — <b>{ratio!.toFixed(2)}×</b>, inside the 0.75–1.3× at-market window.</>
                        : <>No estimate posted — the lane stands on the engine&rsquo;s <b>{formatPrice(q.cvu)}</b> appraisal
                            at high or medium confidence.</>}
                    </p>
                    <div className="vd-detail-grid">
                      <div>
                        <span className="kicker">The room</span>
                        <p>0 bids on the book{q.entry != null ? <> · opens at {formatPrice(q.entry)} — under the appraisal</> : null} · the median live estimate lot carries 4</p>
                      </div>
                      <div>
                        <span className="kicker">The window</span>
                        <p>closes {formatDate(q.closes)} — attention only means something near the hammer</p>
                      </div>
                      <div>
                        <span className="kicker">The tape</span>
                        <p>logged as a quiet call · grades vs the appraisal, both all-in · publishes at 20 graded</p>
                      </div>
                    </div>
                    <div className="vd-detail-actions">
                      <Link href={`/lot/${lot.id}`} className="link-action" style={{ color: 'var(--color-fg)' }} onClick={e => e.stopPropagation()}>
                        Open the lot <span className="arrow"><Flick size={10} style={{ marginLeft: 5 }} /></span>
                      </Link>
                      <button
                        type="button" className="vd-detail-save" data-save-btn
                        aria-pressed={isSaved(lot.id)}
                        onClick={e => { e.stopPropagation(); onToggleSave(lot.id, lot); }}
                      >
                        {isSaved(lot.id) ? 'Saved to your desk' : 'Save to your desk'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {rows.length > 6 && (
            <div className="vd-forming-toggle" style={{ cursor: 'default' }}>
              {rows.length - 6} more in the window — the 6 closing soonest print here
            </div>
          )}
        </div>
      ) : (
        <div className="glass glass-quiet vd-lane-panel">
          <p className="vd-lane-empty">
            0 in the 7-day window · {queued.toLocaleString()} dead-room {activeLabel} lots queued further out — the lane fills as their final week opens.
          </p>
        </div>
      )}
      <div className="vd-annex-meter">
        {rec
          ? <>forward tape: {rec.n.toLocaleString()} logged · {rec.graded} graded · publishes at 20 graded · graded vs appraisal, both all-in</>
          : <>forward tape: — · publishes at 20 graded · graded vs appraisal, both all-in</>}
      </div>
    </section>
  );
}

/* ── ROOM 3b · WHERE THEY LANDED — the outcome distribution as paired
   share bars, ink on paper. Each cohort normalized to its own n (38.7K vs
   28.8K would lie as raw counts); square tops, no y-axis, counts on title. ── */
function OutcomeDistribution({ backtest }: { backtest: Backtest }) {
  const dist = (backtest as Backtest & { distribution?: { bins: { label: string; flagged: number; unflagged: number }[] } }).distribution;
  if (!dist?.bins?.length) return null;
  const fN = dist.bins.reduce((a, b) => a + b.flagged, 0);
  const uN = dist.bins.reduce((a, b) => a + b.unflagged, 0);
  if (fN < 500 || uN < 500) return null;
  const rows = dist.bins.map(b => ({ label: b.label, f: b.flagged / fN, u: b.unflagged / uN }));
  const max = Math.max(...rows.flatMap(r => [r.f, r.u]));
  return (
    <section className="rail ray-enter" style={{ paddingTop: 26 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <span className="vd-sect-mark" style={{ color: 'var(--paper-muted)', alignSelf: 'center' }} aria-hidden><DistMark size={17} /></span>
        <h2 className="ray-h2" style={{ margin: 0 }}>Where they landed</h2>
        <span style={{ fontSize: 13.5, color: 'var(--paper-muted)' }}>
          share of each cohort by realized vs estimate, all-in — the flagged mass sits to the right
        </span>
      </div>
      <div className="vd-dist" aria-label="Outcome distribution: flagged vs unflagged share by result bucket">
        {rows.map(r => (
          <div key={r.label} className="vd-dist-col">
            <div className="vd-dist-bars" aria-hidden>
              <span className="vd-dist-bar vd-dist-bar-f" style={{ height: `${Math.round((r.f / max) * 100)}%` }} />
              <span className="vd-dist-bar vd-dist-bar-u" style={{ height: `${Math.round((r.u / max) * 100)}%` }} />
            </div>
            <span className="vd-dist-pcts">
              <b>{Math.round(r.f * 100)}%</b> · {Math.round(r.u * 100)}%
            </span>
            <span className="vd-dist-label">{r.label}</span>
          </div>
        ))}
      </div>
      <div className="vd-dist-legend">
        <span><span className="vd-dist-key vd-dist-bar-f" /> flagged · n {fN.toLocaleString()}</span>
        <span><span className="vd-dist-key vd-dist-bar-u" /> unflagged · n {uN.toLocaleString()}</span>
      </div>
      <FigCap>
        Share of each cohort by realized price vs estimate midpoint, all-in — flagged n {fN.toLocaleString()} against
        unflagged n {uN.toLocaleString()}, every settled sale replayed nightly. The rightward mass is the edge,
        printed as a distribution rather than a median alone.
      </FigCap>
    </section>
  );
}



/**
 * Value — THE DESK. The first viewport is a five-dial cockpit read of the
 * scoped market (structurally never empty), the ranked signal ledger under
 * one butter lamp is the centerpiece, and everything after it is proof: the
 * certified record on paper, the odds ladder that ranks the board, the
 * settled tape, the engine's plate. Every figure names its basis.
 */
export default function ValuePage() {
  // useRayData + sentinel: the cockpit/board/record all paint from phase 1;
  // the corpus loads only on approach to the settled tape or on modal open.
  const ray = useRayData();
  const { allLots, backtest, lastCrawl, loading, fullLoaded, fullError, fromCache, receipts } = ray;
  const { market, setMarket } = useMarket();
  const activeKey = MARKETS.find(m => m.key === market)?.live ? market : 'all';
  const activeLabel = activeKey === 'all' ? 'collectible' : activeKey === 'tcg' ? 'TCG' : MARKETS.find(m => m.key === activeKey)!.label.toLowerCase();
  const mktSet = useMemo(() => marketArtists(activeKey), [activeKey]);
  const marketLots = useMemo(() => allLots.filter(l => mktSet.has(l.artist)), [allLots, mktSet]);
  const { savedIds, toggle, isSaved } = useSavedLots();
  // One modal for the whole page — the call plate and every row open the
  // same comps view, and a lot can be saved without closing it.
  const [modalLot, setModalLotRaw] = useState<AuctionLot | null>(null);
  // THE MODAL JOINS HISTORY (A2-4, TerminalHome's pattern hardened per
  // B3-terminal 1b/2): opening pushes a `lectrLot` entry so browser Back (and
  // the mobile back-gesture) CLOSES the modal instead of leaving the site.
  // Closing via ✕/ESC pops our entry — but only while it's still the live
  // entry — and a rapid close→reopen before the async back() lands re-pushes
  // instead of letting the pending pop swallow the fresh modal.
  const modalPushed = useRef(false);
  const pendingBack = useRef(false);       // our history.back() hasn't landed yet
  const reopenedDuringBack = useRef(false); // reader reopened inside that window
  const setModalLot = useCallback((lot: AuctionLot | null) => {
    if (lot) {
      triggerFullLoad(); // comps depth rides the corpus — start it now
      if (pendingBack.current) {
        // close→reopen race: our entry is mid-pop — mark it; onPop re-pushes
        reopenedDuringBack.current = true;
        modalPushed.current = true;
      } else if (!modalPushed.current) {
        try { window.history.pushState({ ...window.history.state, lectrLot: true }, ''); modalPushed.current = true; } catch { /* ignore */ }
      }
      setModalLotRaw(lot);
    } else {
      if (modalPushed.current) {
        modalPushed.current = false;
        // only pop while our entry is still live — after a pushState landed
        // on top (e.g. a market switch), back() would eat the wrong entry
        if (window.history.state?.lectrLot) {
          pendingBack.current = true;
          try { window.history.back(); } catch { pendingBack.current = false; }
        }
      }
      setModalLotRaw(null);
    }
  }, []);
  useEffect(() => {
    const onPop = () => {
      if (pendingBack.current) {
        pendingBack.current = false;
        if (reopenedDuringBack.current) {
          // the reopen won the race — restore the history entry it deserves
          reopenedDuringBack.current = false;
          try { window.history.pushState({ ...window.history.state, lectrLot: true }, ''); } catch { /* ignore */ }
        }
        return; // our own close-pop settling — the modal is already closed
      }
      if (modalPushed.current) { modalPushed.current = false; setModalLotRaw(null); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [shown, setShown] = useState(ROWS_PAGE);
  // the board's two orderings: the engine's odds (default) or hammer time
  const [sortMode, setSortMode] = useState<'odds' | 'closing'>('odds');

  // ── INPUT CRAFT — j/k walks every board row on the page, enter opens
  // (native on the flags <button>, handled on the lane rows), s saves.
  // Typing surfaces and the modal keep their own keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalLot) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      // any open overlay owns the keyboard — the ⌘K palette's results are
      // focusable buttons that pass the tagName check, and walking board
      // rows underneath a palette scrolls the page under it
      if (t?.closest('[role="dialog"],[role="listbox"],[role="menu"]')) return;
      if (document.querySelector('.ray-ck-overlay, .ray-maker-sheet')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'j' && e.key !== 'k' && e.key !== 's') return;
      const rowEls = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-row]'));
      if (!rowEls.length) return;
      const cur = rowEls.indexOf(document.activeElement as HTMLElement);
      if (e.key === 's') {
        if (cur < 0) return;
        e.preventDefault();
        rowEls[cur].closest('.ray-value-rowwrap, .vd-lane-item')
          ?.querySelector<HTMLElement>('[data-save-btn]')?.click();
        return;
      }
      e.preventDefault();
      const next = cur < 0
        ? 0
        : e.key === 'j' ? Math.min(rowEls.length - 1, cur + 1) : Math.max(0, cur - 1);
      const el = rowEls[next];
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalLot]);

  // deep link: /value#gap etc. — land on the room once the desk has painted
  useEffect(() => {
    if (loading) return;
    const id = window.location.hash.slice(1);
    if (!id) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // 'instant', not 'auto' — html carries scroll-behavior:smooth, and a
      // deep link should LAND on its room, not tour the whole desk first
      document.getElementById(id)?.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'start' });
    }));
  }, [loading]);

  const deals = useMemo(() => {
    const today = localToday();
    // THE ONE FLAGGED RANKING — dealScore (lib/comps): calibrated odds first,
    // then the gap capped at 400%. Same ordering as every other surface.
    return marketLots
      .filter(l => isLiveUpcoming(l, today))
      .map(l => ({ lot: l, signal: lotSignal(l, marketLots) }))
      .filter(d => d.signal && d.signal.label === 'Below Market')
      .sort((a, b) => dealScore(b.lot, b.signal!.pct) - dealScore(a.lot, a.signal!.pct));
  }, [marketLots]);

  const summary = useMemo(() => {
    const withEst = deals.filter(d => (d.lot.estimateLow || 0) > 0 || (d.lot.estimateHigh || 0) > 0);
    const totalEst = withEst.reduce((s, d) => {
      const lo = d.lot.estimateLow || d.lot.estimateHigh || 0;
      const hi = d.lot.estimateHigh || d.lot.estimateLow || 0;
      return s + (lo + hi) / 2;
    }, 0);
    const medianGap = median(deals.map(d => d.signal!.pct));
    // trueSaleDay, not raw saleDate — the crawl-day artifact must never pick
    // (or date) the "first hammer" line; grace-window lots (already hammered,
    // results pending) must never print yesterday as "first hammer".
    const today = localToday();
    const soonest = [...deals]
      .filter(d => trueSaleDay(d.lot) >= today)
      .sort((a, b) => trueSaleDay(a.lot).localeCompare(trueSaleDay(b.lot)))[0] || null;
    const artists = new Set(deals.map(d => d.lot.artist)).size;
    return { totalEst, medianGap, soonest, artists };
  }, [deals]);

  // the LIVE book in scope — post-phase-2 marketLots is the whole sold
  // corpus, so every "in the book" denominator must re-scope to live lots
  const liveLots = useMemo(() => {
    const today = localToday();
    return marketLots.filter(l => isLiveUpcoming(l, today));
  }, [marketLots]);

  // ── THE GAP + THE SLEEPERS: the two uncertified lanes, computed from the
  // SAME readers the nightly ledger logs from (app/lib/lanes) — one lot,
  // one statistic. The close-board overlay refreshes currentBid/bidProj
  // every ~4h, so these client reads inherit that freshness for free.
  const gapRows = useMemo(() => {
    const now = Date.now();
    return liveLots
      .map(lot => ({ lot, g: gapRead(lot, now) }))
      .filter((x): x is { lot: AuctionLot; g: GapRead } => !!x.g);
  }, [liveLots]);
  const sleeperRows = useMemo(() => {
    const now = Date.now();
    return liveLots
      .map(lot => ({ lot, q: sleeperRead(lot, now) }))
      .filter((x): x is { lot: AuctionLot; q: SleeperRead } => !!x.q)
      .sort((a, b) => (a.q.closes || '').localeCompare(b.q.closes || ''));
  }, [liveLots]);
  // the sleeper QUEUE: dead-room lots further out than the 7-day window —
  // the empty-state calendar's honest denominator
  const sleeperQueue = useMemo(() => {
    const now = Date.now();
    return liveLots.filter(l => {
      if (typeof l.bidCount !== 'number' || l.bidCount !== 0) return false;
      const cvu = l.value?.compValueUsd;
      if (!cvu || cvu <= 0) return false;
      const iso = l.saleDateTime || (l.saleDate ? `${l.saleDate}T23:59:59Z` : null);
      if (!iso) return false;
      const ms = Date.parse(iso);
      return !isNaN(ms) && (ms - now) / 86400000 > 7;
    }).length;
  }, [liveLots]);

  // NEXT HAMMER — book-wide (survives a zero-flag scope): the soonest close
  // still strictly ahead (the results-pending grace window must never print
  // yesterday as "next").
  const nextHammer = useMemo(() => {
    const today = localToday();
    const ahead = liveLots.filter(l => trueSaleDay(l) && trueSaleDay(l) >= today);
    if (!ahead.length) return null;
    return ahead.sort((a, b) => trueSaleDay(a).localeCompare(trueSaleDay(b)))[0];
  }, [liveLots]);

  // live scoped lots the engine actually read (a value or signal stamp
  // exists) — the abstention copy's honest denominator
  const appraisedCount = useMemo(
    () => liveLots.filter(l => (l as { value?: unknown }).value || (l.signal !== undefined && l.signal !== null)).length,
    [liveLots]
  );
  const allFlagCount = useMemo(() => {
    const today = localToday();
    return allLots.filter(l => isLiveUpcoming(l, today) && l.signal?.label === 'Below Market').length;
  }, [allLots]);

  // SETTLED CALLS — the honesty-critical tape. A lot only carries a
  // below-market `signal` if it was in the eager upcoming set while LIVE (the
  // build stamps it; the corpus shards never do — useRayData re-attaches by id).
  // So a lot with signal.label === 'Below Market' AND a realized priceUsd is an
  // HONEST settled call: the flag was measured before the outcome was known —
  // never a post-hoc recompute against a pool that now includes the sale itself.
  const settled = useMemo(() => {
    const today = localToday();
    return marketLots
      .filter(l =>
        l.signal && l.signal.label === 'Below Market' &&
        (l.priceUsd || 0) > 0 &&
        trueSaleDay(l) && trueSaleDay(l) < today)          // genuinely concluded
      .map(l => ({ lot: l, oe: overEstimatePct(l), med: (l.signal as { med?: number }).med ?? null }))
      .sort((a, b) => trueSaleDay(b.lot).localeCompare(trueSaleDay(a.lot))) // most recent first
      .slice(0, 6);
  }, [marketLots]);

  // HONESTY-FLEX — name our WORST cohort year openly. Only years with an
  // adequate flagged sample (≥30) are eligible; among those, the lowest
  // flaggedMedianPct. Naming the low is the strongest trust signal.
  const worstYear = useMemo(() => {
    if (!backtest?.series) return null;
    const eligible = backtest.series.filter(s => s.flaggedMedianPct != null && s.nFlagged >= 30);
    if (!eligible.length) return null;
    return eligible.reduce((w, s) => (s.flaggedMedianPct! < w.flaggedMedianPct! ? s : w));
  }, [backtest]);
  // the current year's row (the certificate's YTD leader line)
  const ytd = useMemo(() => {
    const rows = backtest?.series;
    if (!rows?.length) return null;
    const last = rows[rows.length - 1];
    return last.flaggedMedianPct != null && last.unflaggedMedianPct != null ? last : null;
  }, [backtest]);
  const tiers = (backtest as (Backtest & { flaggedTiers?: Record<string, { n: number; medianPerfPct: number }> }) | null)?.flaggedTiers;

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);

  // A market flip starts the rows over at the first page.
  useEffect(() => { setShown(ROWS_PAGE); setSortMode('odds'); }, [activeKey]);

  // Today's call: the strongest deal Ray can STAND BEHIND — highest
  // confidence tier first, never low (one thin comp is not a headline).
  const call = useMemo(() => pickCall(marketLots, marketLots, activeKey), [marketLots, activeKey]);
  const gridDeals = useMemo(() => {
    const base = call ? deals.filter(d => d.lot.id !== call.lot.id) : deals;
    if (sortMode !== 'closing') return base;
    // hammer time: exact close first, day-only after, ties by odds order
    return [...base].sort((a, b) => {
      const ka = a.lot.saleDateTime || `${trueSaleDay(a.lot)}T99`;
      const kb = b.lot.saleDateTime || `${trueSaleDay(b.lot)}T99`;
      return ka.localeCompare(kb);
    });
  }, [deals, call, sortMode]);
  // ONE LOT, ONE NUMBER: the band prefers the BUILD ENGINE's stamp
  // (value.compValueUsd + poolIds — the same numbers the plate sentence and
  // the modal print); the client signalWithPool runs only for unstamped
  // calls. Measured: 80/83 live call candidates recompute to NULL client-side
  // because their pools live in the corpus-only tier — the stamp is the band.
  const callStamp = useMemo(() => {
    const ev = call?.lot.value as { compValueUsd?: number; poolIds?: string[] } | undefined | null;
    return ev?.compValueUsd && (ev.poolIds?.length ?? 0) >= 3 ? ev : null;
  }, [call]);
  // evidence rows arrive from the 540KB sidecar well before the corpus
  const [evidence, setEvidence] = useState<EvidenceMap | null>(evidenceCache);
  useEffect(() => {
    if (!call || evidence) return;
    let on = true;
    loadEvidence().then(ev => { if (on) setEvidence(ev); });
    return () => { on = false; };
  }, [call, evidence]);
  const callBand = useMemo(() => {
    if (!call) return null;
    if (callStamp) {
      // 1) the shipped pool rows (phase-1-fast, the modal's own source)
      const rows = evidence?.[String(call.lot.id)];
      if (rows && rows.length >= 3) {
        return { prices: rows.map(r => r.p).sort((a, b) => a - b), median: callStamp.compValueUsd! };
      }
      // 2) pool ids resolved against the corpus once it lands
      if (fullLoaded) {
        const byId = new Map(marketLots.map(l => [l.id, l]));
        const prices = (callStamp.poolIds || [])
          .map(id => byId.get(id))
          .filter((x): x is AuctionLot => !!x && x.status === 'sold' && !!x.priceUsd)
          .map(l => l.priceUsd!)
          .sort((a, b) => a - b);
        return { prices, median: callStamp.compValueUsd! };
      }
      return null;
    }
    // 3) signal-stamped call (no deep-engine pool): the evidence rows still
    //    carry its comps — the median is the SIGNAL's own med (one number)
    const sigMed = (call.lot.signal as { med?: number } | null | undefined)?.med;
    const rows = evidence?.[String(call.lot.id)];
    if (sigMed && rows && rows.length >= 3) {
      return { prices: rows.map(r => r.p).sort((a, b) => a - b), median: sigMed };
    }
    // 4) last resort: the client engine over the corpus
    if (!fullLoaded) return null;
    const pool = signalWithPool(call.lot, marketLots);
    if (!pool || pool.signal.med == null) return null;
    return { prices: pool.pool.map(l => l.priceUsd!).sort((a: number, b: number) => a - b), median: pool.signal.med };
  }, [call, callStamp, evidence, marketLots, fullLoaded]);

  const hasFlags = deals.length > 0;
  const coverage = ray.market?.markets?.[activeKey]?.n;

  // ── the reads room's one live figure: the Gap curve's fitted population,
  // summed from the served closeCurve buckets (LabFigures' own precedent —
  // "fitted from N bid histories"). Read from data, never a typed constant.
  const curveSnaps = useMemo(() => {
    const cc = (ray.market?.markets?.all?.analytics as {
      closeCurve?: { n?: number[] };
    } | undefined)?.closeCurve;
    return Array.isArray(cc?.n) && cc!.n!.length ? cc!.n!.reduce((a, b) => a + b, 0) : null;
  }, [ray.market]);

  // ── FLIP — a sort flip re-RANKS the same rows, so they should visibly
  // travel, not teleport. Animate only when the id set is unchanged (pure
  // reorder); data swaps, pagination and market flips stay instant.
  const boardRef = useRef<HTMLDivElement | null>(null);
  const flipPos = useRef<Map<string, number>>(new Map());
  const flipTimers = useRef<number[]>([]);
  const flipKey = gridDeals.slice(0, shown).map(d => d.lot.id).join('|');
  React.useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) { flipPos.current = new Map(); return; }
    // BOARD-relative tops, never viewport-relative — the previous measurement
    // can be an arbitrary scroll distance (and any layout shift above the
    // board) away, and a viewport delta would lurch the whole ledger by it
    const boardTop = board.getBoundingClientRect().top;
    const prev = flipPos.current;
    const next = new Map<string, number>();
    board.querySelectorAll<HTMLElement>('[data-flip-id]').forEach(el => {
      next.set(el.dataset.flipId!, el.getBoundingClientRect().top - boardTop);
    });
    // a re-sort inside the settle window must not let run 1's cleanup strip
    // run 2's transition mid-flight
    flipTimers.current.forEach(t => window.clearTimeout(t));
    flipTimers.current = [];
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && prev.size > 0 && next.size === prev.size && Array.from(next.keys()).every(k => prev.has(k))) {
      const moved: HTMLElement[] = [];
      board.querySelectorAll<HTMLElement>('[data-flip-id]').forEach(el => {
        const delta = (prev.get(el.dataset.flipId!) ?? 0) - (next.get(el.dataset.flipId!) ?? 0);
        if (Math.abs(delta) > 2) {
          el.style.transform = `translateY(${delta}px)`;
          el.style.transition = 'none';
          moved.push(el);
        }
      });
      // FORCE a style flush between offset and reset — a rAF scheduled from
      // this commit runs BEFORE the first style recalc, so without the
      // reflow the offset never lands and the transition has nothing to
      // travel from (rows teleport; the makers review caught this)
      if (moved.length) void board.offsetHeight;
      requestAnimationFrame(() => {
        for (const el of moved) {
          el.style.transform = '';
          el.style.transition = 'transform 380ms var(--ease-signature)';
        }
      });
      flipTimers.current.push(window.setTimeout(() => {
        for (const el of moved) el.style.transition = '';
      }, 440));
    }
    flipPos.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipKey]);

  // the five dials — three of them (hammer, record, coverage) are corpus/
  // record-backed and survive a zero-flag night at full strength
  const dials = useMemo<Dial[]>(() => {
    const out: Dial[] = [
      {
        k: 'Flags live',
        v: <CountUp to={deals.length} format={v => Math.round(v).toLocaleString()} animate={!fromCache} />,
        sub: hasFlags ? <>of {liveLots.length.toLocaleString()} live in the book</> : <>abstaining — a blank beats a wrong number</>,
      },
      {
        k: 'Median gap',
        v: hasFlags ? signalMagnitude('Below Market', Math.round(summary.medianGap)) : '—',
        tone: hasFlags ? 'up' : undefined,
        sub: hasFlags ? 'comps med over ask' : 'no flags in scope',
      },
    ];
    {
      const gw = gapRows.filter(r => r.g.shelf === 'wire').length;
      const gf = gapRows.length - gw;
      if (gw + gf > 0 || sleeperRows.length > 0 || sleeperQueue > 0) {
        out.push({
          k: 'The gap · sleepers',
          v: <span style={{ fontSize: 21 }}>{gw + gf} · {sleeperRows.length}</span>,
          sub: <>{gw} at the wire{gf > 0 ? <> · {gf} forming</> : null} · {sleeperRows.length > 0 ? <>{sleeperRows.length} asleep ≤7d</> : <>{sleeperQueue} queued</>}</>,
        });
      }
    }
    if (nextHammer) {
      const day = trueSaleDay(nextHammer);
      const dU = daysUntil(day);
      const closeMs = nextHammer.saleDateTime ? Date.parse(nextHammer.saleDateTime) - Date.now() : null;
      out.push({
        k: 'Next hammer',
        // the clock only when the close is genuinely ahead and inside the
        // window — CloseClock returns null past close, which would blank the
        // dial; the date always stands behind it
        v: closeMs != null && closeMs > 0 && closeMs < 24 * 3600e3 && dU != null && dU <= 0
          ? <CloseClock iso={nextHammer.saleDateTime!} windowHours={24} />
          : <span style={{ fontSize: 21 }}>{formatDate(day)}</span>,
        sub: nextHammer.auctionHouse,
      });
    }
    if (backtest) {
      // the SCOPED record when the replay has published this market's median
      // (n≥50 gate lives in the build; medPct is null under it) — a sports
      // user deserves the sports number, not the art-heavy global
      const scoped = activeKey !== 'all'
        ? (backtest as Backtest & { byMarket?: Record<string, { flagged: { n: number; medPct: number | null } }> }).byMarket?.[activeKey]?.flagged
        : null;
      if (scoped?.medPct != null && scoped.n >= 50) {
        out.push({
          k: 'The record',
          v: fmtSignedPct(scoped.medPct),
          tone: toneOf(scoped.medPct) === 'up' ? 'up' : undefined,
          sub: <>{activeLabel} flags realized vs estimate, all-in · n&nbsp;{scoped.n.toLocaleString()}</>,
        });
      } else out.push(backtest.flagged.n >= 100 ? {
        k: 'The record',
        v: fmtSignedPct(backtest.flagged.medianPerfPct),
        tone: toneOf(backtest.flagged.medianPerfPct) === 'up' ? 'up' : undefined,
        sub: <>realized vs estimate, all-in{backtest.flagged.hammerMedianPct != null ? <> · hammer {fmtSignedPct(backtest.flagged.hammerMedianPct)}</> : null} · n&nbsp;{backtest.flagged.n.toLocaleString()}</>,
      } : {
        k: 'The record',
        v: '—',
        sub: <>n {backtest.flagged.n.toLocaleString()} · publishes at 100</>,
      });
    }
    if (coverage) {
      out.push({
        k: 'Coverage',
        v: <CountUp to={coverage} format={v => compactCount(Math.round(v))} animate={!fromCache} />,
        sub: <>sold {activeLabel} lots read</>,
      });
    }
    return out;
  }, [deals.length, hasFlags, liveLots.length, summary.medianGap, nextHammer, backtest, coverage, activeKey, activeLabel, fromCache, gapRows, sleeperRows.length, sleeperQueue]);

  return (
    <div className="ray-mobnav-pad terminal-shell" style={{
      fontFamily: 'var(--font-sans), sans-serif',
    }}>
      {/* __html, not a text child: this CSS carries '<'/'>' characters (and
          SSR entity-escapes text children of raw-text elements) — a
          guaranteed hydration mismatch otherwise. RecordBand's pattern. */}
      <style dangerouslySetInnerHTML={{ __html: `
        /* ════ THE DESK — page skin (Aug 2026 rebuild) ════ */
        .ray-value-section { padding-block: calc(var(--sect-t) - 8px) calc(var(--sect-b) + var(--space-4)); }

        /* ── ROOM 1 · the cockpit ── */
        .vd-cockpit { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px 40px; }
        @media (min-width: 900px) {
          .vd-cockpit { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); align-items: center; }
          .vd-cockpit-main { grid-column: 1; }
          .vd-cockpit-pulse { grid-column: 2; padding-top: 6px; }
          .vd-dials-wrap { grid-column: 1 / -1; }
        }
        /* the pulse panel — the room's only surfaced panel */
        .vd-pulse {
          background: var(--surface-well, #0d0f11);
          border: 1px solid var(--color-border);
          border-radius: 16px;
          padding: 16px 18px 14px;
        }
        .vd-pulse-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
        .vd-pulse-rule { flex: 1; border-top: 1px solid var(--color-border); }
        .vd-sect-cap { font-size: 12px; color: var(--color-text-faint); white-space: nowrap; }
        .vd-pulse-read { display: flex; align-items: center; gap: 14px; margin-top: 10px; min-height: 30px; }
        .vd-pulse-fig {
          font-family: var(--font-mono), monospace; font-size: 20px; font-weight: 600;
          font-variant-numeric: tabular-nums; letter-spacing: -0.01em; color: var(--color-fg);
          flex: none;
        }
        .vd-pulse-fig[data-tone="up"] { color: var(--color-up); }
        .vd-pulse-fig[data-tone="down"] { color: var(--color-down-text); }
        .vd-pulse-beam { flex: 1 1 170px; min-width: 110px; max-width: 240px; }
        .vd-pulse-sub { font-size: 12px; color: var(--color-text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* ── the dial strip — one fused band, hairline splits, no boxes;
           byline grammar: gray label over value, dotted closing rule ── */
        .vd-dials {
          display: flex;
          margin-top: 18px;
          border-top: 1px solid var(--color-border);
          border-bottom: 1px dotted var(--color-border-mid);
        }
        .vd-dial {
          flex: 1 1 0; min-width: 0;
          display: grid; gap: 4px; align-content: start;
          padding: 16px 20px 15px;
          border-left: 1px solid var(--color-hair, rgba(255,255,255,0.06));
        }
        .vd-dial:first-child { border-left: none; padding-left: 2px; }
        .vd-dial-k { font-size: 10px; letter-spacing: 0.18em; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .vd-dial-v {
          font-family: var(--font-mono), monospace;
          font-size: 27px; font-weight: 500; letter-spacing: -0.01em;
          font-variant-numeric: tabular-nums; color: var(--color-fg);
          line-height: 1.15; min-height: 31px;
          display: flex; align-items: baseline;
          white-space: nowrap;
        }
        .vd-dial-v[data-tone="up"] { color: var(--color-up); }
        .vd-dial-v[data-tone="down"] { color: var(--color-down-text); }
        .vd-dial-s { font-size: 11.5px; color: var(--color-text-faint); }
        @media (max-width: 899px) {
          .vd-dials { display: block; margin-top: 18px; border-bottom: none; }
          .vd-dial {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            grid-template-areas: 'k v' 's v';
            align-items: baseline;
            gap: 2px 16px;
            padding: 11px 2px;
            border-left: none;
            border-bottom: 1px dotted var(--color-border-mid);
            min-height: 44px;
          }
          .vd-dial-k { grid-area: k; }
          .vd-dial-s { grid-area: s; font-size: 11px; }
          .vd-dial-v { grid-area: v; font-size: 20px; justify-content: flex-end; min-height: 0; min-width: 76px; }
          .vd-pulse { margin-top: 14px; }
        }

        /* ── section heads (quiet ns-kicker beside a rule) ── */
        .vd-sect-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .vd-sect-head .ns-kicker, .vd-pulse-head .ns-kicker { margin-bottom: 0; white-space: nowrap; }
        @media (max-width: 640px) {
          .vd-sect-head { flex-wrap: wrap; }
          .vd-sect-cap { white-space: normal; flex-basis: 100%; }
          .vd-sect-head .vd-pulse-rule { display: none; }
        }

        /* ── ROOM 2 board rows (dark: solid hairlines — dotted is paper-only) ── */
        .ray-value-row {
          display: grid;
          grid-template-columns: 56px minmax(0, 1fr) auto;
          gap: 14px;
          align-items: center;
          width: 100%;
          padding: 10px 16px;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--color-border);
          text-align: left;
          font-family: var(--font-sans), sans-serif;
          color: var(--color-fg);
          cursor: pointer;
          transition: background var(--duration-fast) var(--ease-signature);
        }
        .ray-value-row:last-child,
        .ray-value-rowwrap:last-child .ray-value-row { border-bottom: none; }
        .ray-value-row:hover { background: var(--color-hover-item); }
        .ray-value-row-thumb {
          width: 56px;
          height: 44px;
          border-radius: 6px;
          overflow: hidden;
          background: var(--color-bg-elevated);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: 700;
          color: var(--color-text-faint);
          flex-shrink: 0;
        }
        .ray-value-row-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .vd-thumb-letter { font-family: var(--font-inter), sans-serif; font-weight: 600; font-size: 18px; line-height: 1; color: color-mix(in srgb, var(--color-accent-gold) 55%, var(--color-text-faint)); }
        .ray-value-row-maker { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ray-value-row-title { font-size: 12.5px; font-weight: 400; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        /* phones: the hammer date is its own line under the title (never inside
           the ellipsized title span, where it was the first thing cut) */
        .ray-value-mobdate { display: block; font-size: 11.5px; color: var(--color-text-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
        .ray-value-row-sig { font-size: 13.5px; font-weight: 700; color: var(--color-up); text-align: right; white-space: nowrap; }
        .ray-value-row-est { font-size: 12.5px; color: var(--color-text-muted); text-align: right; white-space: nowrap; }
        @media (max-width: 768px) {
          .ray-value-section { padding-block: calc(var(--sect-t) - 10px) calc(var(--sect-b) + var(--space-2)); }
          .ray-value-row { grid-template-columns: 44px minmax(0, 1fr) auto; gap: 10px; padding: 10px 12px; }
          .ray-value-row-thumb { width: 44px; height: 36px; }
        }
        /* desktop ledger (≥900px): thumb · maker/work · house · hammers ·
           estimate · comps median · odds · gap — mono cells, right numerics */
        .ray-value-head { display: none; }
        .ray-value-cell { display: none; }
        @media (min-width: 900px) {
          .ray-value-row,
          .ray-value-head {
            grid-template-columns: 56px minmax(0, 1fr) 92px 100px 118px 84px 52px 64px;
            gap: 16px;
          }
          .ray-value-head {
            display: grid;
            align-items: baseline;
            width: 100%;
            padding: 12px 16px 9px;
            border-bottom: 1px solid var(--color-border);
          }
          .ray-value-head .kicker { font-size: 11.5px; letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .ray-value-mob { display: none; }
          .ray-value-mobdate { display: none; }
          .ray-value-cell {
            display: block;
            font-family: var(--font-mono), monospace;
            font-size: var(--text-data);
            letter-spacing: -0.01em;
            font-variant-numeric: tabular-nums;
            color: var(--color-text-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 0;
          }
          .ray-value-cell-num { text-align: right; }
          .ray-value-cell-gap { color: var(--color-up); font-weight: 700; }
          .ray-value-cell-odds { color: var(--color-text-secondary); font-weight: 600; }
          .ray-value-cell-est { color: var(--color-fg); }
        }
        /* row save affordance — sibling of the row button, floated right */
        .ray-value-rowwrap { position: relative; }
        .ray-value-rowwrap .ray-value-row { padding-right: 46px; }
        .ray-value-save {
          position: absolute;
          top: 50%;
          right: 8px;
          transform: translateY(-50%);
          width: 30px; height: 30px;
          display: flex; align-items: center; justify-content: center;
          background: none; border: none; border-radius: 100px;
          cursor: pointer; padding: 0; z-index: 2;
          opacity: 0.55;
          transition: opacity var(--duration-fast) var(--ease-signature);
        }
        .ray-value-save:hover, .ray-value-save:focus-visible,
        .ray-value-save[data-saved="true"] { opacity: 1; }
        .ray-value-save:active .ray-value-save-glyph { transform: scale(0.92); }
        .ray-value-row:active { background: var(--color-bg-elevated); }
        @media (max-width: 899px) {
          .ray-value-save { width: 44px; height: 44px; right: 2px; }
        }
        .ray-value-save-glyph {
          width: 26px; height: 26px; display: flex; align-items: center;
          justify-content: center; border-radius: 100px;
          background: var(--color-bg-elevated);
        }
        .ray-value-save[data-saved="true"] .ray-value-save-glyph { background: var(--color-fg); }
        @media (min-width: 900px) {
          .ray-value-rowwrap .ray-value-row { padding-right: 42px; }
          .ray-value-save { right: 6px; }
        }
        .ray-value-conf {
          font-size: 10px; letter-spacing: 0.5px;
          color: var(--color-text-faint);
          white-space: nowrap;
        }
        /* row-hover leader line — collapses to zero so it never shifts rest */
        .ray-value-leader {
          grid-column: 1 / -1;
          overflow: hidden;
          max-height: 0;
          opacity: 0;
          font-size: 11.5px;
          color: var(--color-text-muted);
          font-variant-numeric: tabular-nums;
          transition: max-height var(--duration-fast) var(--ease-signature),
                      opacity var(--duration-fast) var(--ease-signature),
                      margin-top var(--duration-fast) var(--ease-signature);
        }
        .ray-value-row:hover .ray-value-leader,
        .ray-value-row:focus-visible .ray-value-leader {
          max-height: 40px;
          opacity: 1;
          margin-top: 6px;
        }
        .ray-value-leader b { color: var(--color-fg); font-weight: 600; }
        .ray-value-leader .up { color: var(--color-up); font-weight: 700; }

        /* ── the board's order chips ── */
        .vd-sort { display: inline-flex; gap: 6px; margin-left: 4px; }
        .vd-sort button {
          font-family: var(--font-mono), monospace;
          font-size: 10.5px; letter-spacing: 0.08em;
          padding: 6px 12px; min-height: 28px;
          background: none; color: var(--color-text-muted);
          border: 1px solid var(--color-border); border-radius: 100px;
          cursor: pointer;
          transition: color var(--duration-fast) var(--ease-signature), border-color var(--duration-fast) var(--ease-signature), background var(--duration-fast) var(--ease-signature);
        }
        .vd-sort button:hover { color: var(--color-fg); }
        .vd-sort button[data-on] { background: var(--color-fg); color: var(--color-bg); border-color: var(--color-fg); }
        @media (max-width: 640px) { .vd-sort { margin-left: 0; } .vd-sort button { min-height: 34px; } }

        /* ── ROOM 3b outcome distribution (ink on paper) ── */
        .vd-dist { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 10px; align-items: end; }
        .vd-dist-col { display: grid; gap: 6px; justify-items: center; min-width: 0; }
        .vd-dist-bars { display: flex; align-items: flex-end; gap: 3px; height: 120px; width: 100%; justify-content: center; }
        .vd-dist-bar { width: min(26px, 40%); min-height: 2px; }
        .vd-dist-bar-f { background: var(--paper-up, #1B7A48); }
        .vd-dist-bar-u { background: rgba(28, 23, 18, 0.28); }
        .vd-dist-pcts { font-family: var(--font-mono), monospace; font-size: 11px; color: var(--paper-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .vd-dist-pcts b { color: var(--paper-up-text); font-weight: 700; }
        .vd-dist-label { font-size: 10.5px; color: var(--paper-muted); text-align: center; line-height: 1.25; }
        .vd-dist-legend { display: flex; gap: 22px; margin-top: 12px; font-size: 12px; color: var(--paper-muted); }
        .vd-dist-key { display: inline-block; width: 12px; height: 8px; margin-right: 6px; vertical-align: baseline; }
        @media (max-width: 700px) {
          .vd-dist { grid-auto-flow: row; grid-template-columns: repeat(4, 1fr); gap: 14px 8px; }
          .vd-dist-bars { height: 72px; }
          .vd-dist-label { font-size: 10px; }
        }


        /* ── ROOM 2 zero-flag frame — the instrument keeps its chrome ── */
        .vd-empty {
          padding: 34px 20px 38px;
          text-align: center;
          border-bottom: 1px solid var(--color-border);
        }
        .vd-empty p { font-size: 13.5px; color: var(--color-text-muted); max-width: 560px; margin: 0 auto 18px; }
        .vd-empty-links { display: flex; flex-wrap: wrap; gap: 10px 26px; justify-content: center; }

        /* ── ROOM 2c projection desk ── */
        .vd-annex { padding-top: calc(var(--space-4) + var(--space-2)); }
        .vd-annex-row {
          display: grid;
          grid-template-columns: 44px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          padding: 9px 2px;
          border-bottom: 1px solid var(--color-hair, rgba(255,255,255,0.06));
          color: inherit; text-decoration: none;
          transition: background var(--duration-fast) var(--ease-signature);
          min-height: 44px;
        }
        .vd-annex-row:hover { background: var(--color-hover-item); }
        .vd-annex-thumb { width: 44px; height: 36px; position: relative; }
        .vd-annex-main { min-width: 0; }
        .vd-annex-maker { display: block; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .vd-annex-title { display: block; font-size: 12px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .vd-annex-cells { text-align: right; font-variant-numeric: tabular-nums; }
        .vd-annex-depth { display: block; font-family: var(--font-mono), monospace; font-size: 13px; font-weight: 600; color: var(--color-fg); }
        .vd-annex-proj { display: block; font-size: 11.5px; color: var(--color-text-muted); }
        .vd-annex-close { display: block; font-size: 11.5px; color: var(--color-text-faint); }
        /* ── the lane head: constructed mark + name + live count + rule ── */
        .vd-lane-head {
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 14px;
        }
        .vd-lane-mark {
          display: inline-flex; align-items: center; justify-content: center;
          width: 36px; height: 36px; flex: none;
          border: 1px solid var(--color-border); border-radius: 10px;
          color: var(--color-text-secondary);
          background: var(--color-bg-elevated);
        }
        /* north star: authority through lightness — the room title is
           bigger and thinner, never bold */
        .vd-lane-name {
          font-size: 28px; font-weight: 340; letter-spacing: -0.02em;
          line-height: 1.1; margin: 0; white-space: nowrap;
        }
        @media (max-width: 640px) { .vd-lane-name { font-size: 23px; } }
        .vd-lane-count {
          font-family: var(--font-mono), monospace;
          font-size: 12px; font-weight: 600;
          font-variant-numeric: tabular-nums;
          color: var(--color-text-secondary);
          border: 1px solid var(--color-border); border-radius: 100px;
          padding: 2px 9px; flex: none;
        }
        .vd-lane-head .vd-sect-cap { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        @media (max-width: 640px) {
          .vd-lane-head { flex-wrap: wrap; gap: 10px 12px; }
          .vd-lane-head .vd-pulse-rule { display: none; }
          .vd-lane-head .vd-sect-cap { flex-basis: 100%; white-space: normal; }
        }

        /* ── the lane ledger panel: the Flags board's grammar, shared ──
           overflow: clip, not hidden — clip keeps the radius crop without
           becoming a scroll container, so the sticky column heads can stick */
        .vd-lane-panel { overflow: clip; }
        .vd-lane-cols {
          display: none;
          align-items: baseline;
          padding: 12px 16px 9px;
          border-bottom: 1px solid var(--color-border);
        }
        .vd-lane-cols .kicker { font-size: 11.5px; letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .vd-lane-row {
          display: grid;
          gap: 14px;
          align-items: center;
          width: 100%;
          padding: 10px 16px;
          border-bottom: 1px solid var(--color-border);
          color: inherit; text-decoration: none;
          min-height: 56px;
          transition: background var(--duration-fast) var(--ease-signature);
        }
        .vd-lane-row:last-child { border-bottom: none; }
        .vd-lane-row:hover { background: var(--color-hover-item); }
        .vd-cell {
          display: none;
          font-family: var(--font-mono), monospace;
          font-size: var(--text-data);
          letter-spacing: -0.01em;
          font-variant-numeric: tabular-nums;
          color: var(--color-text-muted);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          text-align: right; min-width: 0;
        }
        .vd-cell-strong { color: var(--color-fg); font-weight: 700; }
        .vd-lane-mob {
          text-align: right; font-variant-numeric: tabular-nums;
          font-size: 11.5px; color: var(--color-text-muted);
          white-space: nowrap;
        }
        .vd-lane-mob .vd-cell-strong { font-family: var(--font-mono), monospace; font-size: 13px; }
        .vd-gap-grid { grid-template-columns: 44px minmax(0, 1fr) auto; }
        .vd-slp-grid { grid-template-columns: 44px minmax(0, 1fr) auto; }
        @media (min-width: 900px) {
          .vd-gap-grid { grid-template-columns: 56px minmax(0, 1fr) 96px 170px 90px 110px; gap: 16px; }
          .vd-slp-grid { grid-template-columns: 56px minmax(0, 1fr) 100px 100px 150px 110px; gap: 16px; }
          .vd-lane-cols { display: grid; }
          .vd-cell { display: block; }
          .vd-lane-mob { display: none; }
        }
        .vd-lane-empty { font-size: 13px; color: var(--color-text-muted); margin: 0; padding: 22px 16px; }

        /* doubled selector outguns the global '.ray-value-row-maker span'
           display:block descendant rule — the tag must stay an inline chip */
        .vd-lane-tag.vd-lane-tag {
          display: inline-block; margin-left: 8px; padding: 1px 7px;
          font-family: var(--font-mono), monospace; font-size: 10px;
          letter-spacing: 0.06em; color: var(--color-text-muted);
          border: 1px solid var(--color-border); border-radius: 100px;
          vertical-align: 1px;
        }
        .vd-forming-toggle {
          display: block; width: 100%; text-align: left;
          background: none; border: none; cursor: pointer;
          padding: 10px 16px; min-height: 44px;
          border-bottom: 1px solid var(--color-border);
          font-family: var(--font-mono), monospace; font-size: 11.5px;
          letter-spacing: 0.02em; color: var(--color-text-muted);
          transition: color var(--duration-fast) var(--ease-signature);
        }
        .vd-forming-toggle:hover { color: var(--color-fg); }
        .vd-annex-meter {
          margin-top: 10px;
          padding-top: 9px;
          border-top: 1px dotted var(--color-border-mid);
          font-family: var(--font-mono), monospace;
          font-size: 11px; letter-spacing: 0.02em;
          color: var(--color-text-faint);
          font-variant-numeric: tabular-nums;
        }

        /* ── ROOM 3 honesty ledger (paper: dotted leaders are period-correct) ── */
        .vd-honesty { margin-top: 22px; }
        .vd-honesty-row {
          display: flex; align-items: baseline; gap: 10px;
          padding: 7px 0;
          font-family: var(--font-mono), monospace;
          font-size: 12.5px;
          font-variant-numeric: tabular-nums;
          color: var(--paper-muted);
        }
        .vd-honesty-row b { color: var(--paper-ink); font-weight: 600; }
        .vd-honesty-fill { flex: 1; border-bottom: 2px dotted var(--paper-line); transform: translateY(-3px); min-width: 16px; }
        .vd-honesty-up { color: var(--paper-up-text); font-weight: 700; }
        .vd-honesty-down { color: var(--paper-down-text); font-weight: 700; }

        /* ── ROOM 4b settled tape ── */
        .vd-tape-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 4px 16px;
          align-items: baseline;
          padding: 10px 2px;
          border-bottom: 1px solid var(--color-hair, rgba(255,255,255,0.06));
          color: inherit; text-decoration: none;
          min-height: 44px;
          transition: background var(--duration-fast) var(--ease-signature);
        }
        .vd-tape-row:hover { background: var(--color-hover-item); }
        .vd-tape-maker { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .vd-tape-title { font-size: 12px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .vd-tape-cells { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .vd-tape-real { font-family: var(--font-mono), monospace; font-size: 12.5px; color: var(--color-fg); }
        .vd-tape-vs { display: block; font-family: var(--font-mono), monospace; font-size: 11.5px; color: var(--color-text-muted); }
        .vd-tape-vs [data-tone="up"] { color: var(--color-up); font-weight: 700; }
        .vd-tape-vs [data-tone="down"] { color: var(--color-down-text); font-weight: 700; }
        .vd-tape-ghost { height: 44px; border-bottom: 1px solid var(--color-hair, rgba(255,255,255,0.06)); background: var(--lw-02, rgba(255, 255, 255, 0.02)); }
        @media (max-width: 640px) {
          .vd-tape-row { grid-template-columns: minmax(0, 1fr); }
          .vd-tape-cells { text-align: left; }
        }

        /* ════ THE DESIGNED-APP LAYER (Aug 2026) ════ */

        /* ── rooms are addressable — anchors land under the sticky nav ── */
        .vd-room { scroll-margin-top: 76px; }

        /* ── sub-room head marks (bare glyph beside the kicker) ── */
        .vd-sect-mark { display: inline-flex; align-items: center; color: var(--color-text-muted); flex: none; }

        /* ── STICKY COLUMN HEADS — the ledger keeps its map while you read ── */
        @media (min-width: 900px) {
          .ray-value-head, .vd-lane-cols {
            position: sticky; top: 54px; z-index: 20;
            background: color-mix(in srgb, var(--surface-mix, #0b0c0e) 90%, transparent);
            backdrop-filter: blur(14px);
          }
        }

        /* ── INPUT CRAFT — a real focus ring on every walked row ── */
        .ray-value-row:focus-visible, .vd-lane-row:focus-visible {
          outline: 1.5px solid color-mix(in srgb, var(--color-fg) 70%, transparent);
          outline-offset: -1.5px;
          background: var(--color-hover-item);
        }
        .vd-lane-row { cursor: pointer; }

        /* ── cell micro-instruments — the number is the statement, the
           track is its shape (2px, neutral ink; mint only where the cell
           itself is already a signed outcome) ── */
        .vd-cell-track {
          display: block; height: 2px; margin-top: 5px;
          background: var(--lw-08, rgba(255, 255, 255, 0.08)); border-radius: 2px;
          position: relative; overflow: visible;
        }
        .vd-cell-track > span:not(.vd-track-dot) {
          display: block; height: 100%; border-radius: 2px;
          background: var(--lw-45, rgba(255, 255, 255, 0.45));
          margin-left: auto; /* right-aligned cells fill from the right */
        }
        .vd-track-up > span:not(.vd-track-dot) { background: var(--color-up); opacity: 0.7; }
        .vd-track-witness::before {
          content: ''; position: absolute; top: -3px; bottom: -3px;
          left: 45.45%; width: 1px; background: var(--lw-28, rgba(255, 255, 255, 0.28));
        }
        .vd-track-dot {
          position: absolute; top: 50%; width: 5px; height: 5px;
          border-radius: 100px; background: var(--color-fg);
          transform: translate(-50%, -50%);
        }

        /* ── INLINE INTERROGATION — the row's whole case, opened in place ── */
        .vd-lane-item { border-bottom: 1px solid var(--color-border); }
        .vd-lane-item:last-child { border-bottom: none; }
        .vd-lane-item .vd-lane-row { border-bottom: none; }
        .vd-lane-item[data-open] > .vd-lane-row { background: var(--color-hover-item); }
        .vd-lane-detail {
          display: grid; grid-template-rows: 0fr;
          transition: grid-template-rows 340ms var(--ease-signature);
        }
        .vd-lane-item[data-open] .vd-lane-detail { grid-template-rows: 1fr; }
        /* visibility keeps the collapsed detail's link/save OUT of the tab
           order and away from screen readers; the 340ms delay lets the
           collapse animation finish before the content vanishes */
        .vd-lane-detail-in { overflow: hidden; min-height: 0; visibility: hidden; transition: visibility 0s 340ms; }
        .vd-lane-item[data-open] .vd-lane-detail-in { visibility: visible; transition: visibility 0s; }
        .vd-lane-item[data-open] .vd-lane-detail-in {
          border-top: 1px solid var(--color-hair, rgba(255,255,255,0.06));
        }
        .vd-detail-lead {
          margin: 0; padding: 14px 16px 0;
          font-size: 13px; color: var(--color-text-secondary);
        }
        .vd-detail-lead b { color: var(--color-fg); font-weight: 600; font-variant-numeric: tabular-nums; }
        .vd-detail-grid {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 12px 26px; padding: 12px 16px 0;
        }
        /* explanatory labels go quiet sentence-case (ledger column heads
           keep the mono instrument register) */
        .vd-detail-grid .kicker {
          font-family: var(--font-sans), sans-serif;
          font-size: 12px; font-weight: 500;
          letter-spacing: 0.01em; text-transform: none;
        }
        .vd-detail-grid p { margin: 4px 0 0; font-size: 12px; color: var(--color-text-muted); line-height: 1.5; }
        .vd-curve { position: relative; padding: 16px 16px 0; }
        .vd-curve-rail {
          display: block; position: relative; height: 2px;
          background: var(--lw-10, rgba(255, 255, 255, 0.10)); border-radius: 2px;
        }
        .vd-curve-wire {
          position: absolute; left: 0; top: 0; bottom: 0;
          background: var(--lw-26, rgba(255, 255, 255, 0.26)); border-radius: 2px;
        }
        .vd-curve-dot {
          position: absolute; top: 50%; width: 7px; height: 7px;
          border-radius: 100px; background: var(--color-fg);
          transform: translate(-50%, -50%);
          box-shadow: 0 0 0 3px var(--lw-08, rgba(255, 255, 255, 0.08));
        }
        .vd-curve-labels {
          position: relative; display: flex; justify-content: space-between;
          margin-top: 6px;
          font-family: var(--font-mono), monospace; font-size: 10px;
          letter-spacing: 0.04em; color: var(--color-text-faint);
        }
        .vd-curve-read {
          display: block; margin-top: 8px;
          font-family: var(--font-mono), monospace; font-size: 11px;
          color: var(--color-text-secondary); font-variant-numeric: tabular-nums;
        }
        .vd-detail-actions {
          display: flex; align-items: center; gap: 22px;
          padding: 14px 16px 16px; flex-wrap: wrap;
        }
        .vd-detail-save {
          font-family: var(--font-mono), monospace; font-size: 10.5px;
          letter-spacing: 0.08em; padding: 7px 13px; min-height: 30px;
          background: none; color: var(--color-text-muted);
          border: 1px solid var(--color-border); border-radius: 100px;
          cursor: pointer;
          transition: color var(--duration-fast) var(--ease-signature), border-color var(--duration-fast) var(--ease-signature);
        }
        .vd-detail-save:hover, .vd-detail-save[aria-pressed="true"] { color: var(--color-fg); border-color: var(--color-border-mid); }

        /* ── THE GLOSSARY — dotted terms that explain themselves ── */
        .vd-term {
          position: relative;
          border-bottom: 1px dotted var(--color-text-faint);
          cursor: help; outline: none;
        }
        .vd-term:focus-visible { outline: 2px solid var(--color-fg); outline-offset: 2px; border-radius: 2px; }
        .vd-term-tip {
          position: absolute; bottom: calc(100% + 9px); left: 50%;
          transform: translateX(-50%);
          width: max-content; max-width: 260px; white-space: normal;
          background: var(--surface-tip, #101214); border: 1px solid var(--color-border-mid);
          border-radius: 10px; padding: 9px 12px;
          font-family: var(--font-sans), sans-serif;
          font-size: 11.5px; line-height: 1.55; letter-spacing: 0;
          color: var(--color-text-secondary); text-align: left;
          font-variant-numeric: normal;
          opacity: 0; pointer-events: none; z-index: 30;
          transition: opacity var(--duration-fast) var(--ease-signature);
        }
        .vd-term:hover .vd-term-tip, .vd-term:focus .vd-term-tip { opacity: 1; }

        /* ── the lane help strip — the "?" chip's how-to-read ── */
        .vd-lane-helpbtn {
          width: 22px; height: 22px; flex: none;
          display: inline-flex; align-items: center; justify-content: center;
          font-family: var(--font-mono), monospace; font-size: 11px;
          color: var(--color-text-faint);
          background: none; border: 1px solid var(--color-border); border-radius: 100px;
          cursor: pointer; padding: 0;
          transition: color var(--duration-fast) var(--ease-signature), border-color var(--duration-fast) var(--ease-signature);
        }
        .vd-lane-helpbtn:hover, .vd-lane-helpbtn[aria-expanded="true"] { color: var(--color-fg); border-color: var(--color-border-mid); }
        /* explanatory copy rides the cream well (ns-well supplies the
           plate); this only trims the well to the lane's measure */
        .vd-lane-help {
          margin: -4px 0 14px;
          font-size: 12.5px; line-height: 1.65; color: var(--color-text-muted);
          max-width: 640px;
        }

        /* ── ROOM 1e · how the desk reads — split head over the figure
           cells. All cell chrome lives in globals ("THE CELL SYSTEM");
           this is layout breathing room only. ── */
        .vd-reads .ns-split { margin-bottom: 26px; }
        @media (max-width: 768px) { .vd-reads .ns-split { margin-bottom: 18px; } }

        /* ── THE CALL AS COLOR — the ns-cell-color grammar wraps the plate.
           The wrapper supplies ground (gradient + grain, globals-owned);
           in here the certificate's ink ramp re-resolves to the white-on-
           signal ramp, so every figure the plate prints goes paper while
           the ground carries the signal. DOM, data and CTAs untouched. ── */
        .ns-cell.vd-call-cell { display: block; padding: 0; min-height: 0; }
        /* doubled selector: the second arm out-ranks the porcelain flatten
           rule (html[data-lectr-light] .terminal-shell .glass !important) —
           without it the plate paints opaque white over the signal ground */
        .vd-call-cell .glass.lectr-cp,
        html[data-lectr-light] .terminal-shell .vd-call-cell .glass.lectr-cp {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          border-radius: inherit;
          --color-fg: #FDFCFC;
          --color-bg: #1C1917;
          --color-text-secondary: rgba(253, 252, 252, 0.82);
          --color-text-muted: rgba(253, 252, 252, 0.72);
          --color-text-faint: rgba(253, 252, 252, 0.58);
          --color-beige-text: rgba(253, 252, 252, 0.72);
          --color-beige: rgba(253, 252, 252, 0.6);
          /* the ground states the direction — text goes paper (the ColorCell
             law from cells.tsx; the lamp lives in the gradient, not the type) */
          --color-up: #FDFCFC;
          --hairline: rgba(253, 252, 252, 0.32);
          --cream-hair: rgba(253, 252, 252, 0.32);
          --color-border: rgba(253, 252, 252, 0.32);
          --color-border-mid: rgba(253, 252, 252, 0.4);
          --color-bg-elevated: rgba(253, 252, 252, 0.1);
          --color-hover-item: rgba(253, 252, 252, 0.08);
        }
        /* the gold marquee halo yields — the signal ground IS the marquee */
        .vd-call-cell .lit { border: none !important; box-shadow: none !important; }
        /* the multiple gets the big mono voice inside its leader row (the
           only .up value on the compact plate is "The gap") */
        .vd-call-cell .lectr-cp-v.up {
          font-family: var(--font-mono), monospace;
          font-size: 20px; font-weight: 600; letter-spacing: -0.01em;
        }
        /* CTAs on the white-on-signal ramp: primary = paper pill / ink text;
           quiet = translucent paper (the light-mode white-ring override
           would print white-on-white here, hence the !important) */
        .vd-call-cell .ray-call-btn-primary { background: #FDFCFC; color: #1C1917; }
        .vd-call-cell .ray-call-btn-primary:hover { opacity: 0.92; }
        .vd-call-cell .ray-call-btn-quiet {
          background: rgba(253, 252, 252, 0.14) !important;
          color: #FDFCFC !important;
          box-shadow: none !important;
        }
        .vd-call-cell .ray-call-btn-quiet:hover { background: rgba(253, 252, 252, 0.22) !important; }

        /* ── north star, the closer: no serif — the engine card's head
           speaks the same light grotesk as every room title (.ray-engine-*
           is value-only; the paper tokens stay) ── */
        .ray-engine-head {
          font-family: var(--font-sans), sans-serif;
          font-weight: 340;
          letter-spacing: -0.02em;
        }

        /* ── pill press — the house scale(0.98) on the local pill family ── */
        .vd-sort button, .vd-detail-save, .vd-lane-helpbtn { transition-property: color, border-color, background, transform; transition-duration: var(--duration-fast); transition-timing-function: var(--ease-signature); }
        .vd-sort button:active, .vd-detail-save:active, .vd-lane-helpbtn:active { transform: scale(0.98); }

        /* ── MOTION WITH INTENT (armed only when motion is welcome) ── */
        @media (prefers-reduced-motion: no-preference) {
          .vd-lane-mark svg :is(path, circle, rect),
          .vd-sect-mark svg :is(path, circle, rect) {
            stroke-dasharray: 1; stroke-dashoffset: 1;
            animation: vdDraw 900ms var(--ease-signature) forwards;
          }
          .vd-lane-mark svg :is(path, circle, rect):nth-child(2),
          .vd-sect-mark svg :is(path, circle, rect):nth-child(2) { animation-delay: 90ms; }
          .vd-lane-mark svg :is(path, circle, rect):nth-child(3),
          .vd-sect-mark svg :is(path, circle, rect):nth-child(3) { animation-delay: 180ms; }
          .vd-lane-mark svg :is(path, circle, rect):nth-child(4),
          .vd-sect-mark svg :is(path, circle, rect):nth-child(4) { animation-delay: 270ms; }
          .vd-lane-mark svg :is(path, circle, rect):nth-child(5),
          .vd-sect-mark svg :is(path, circle, rect):nth-child(5) { animation-delay: 360ms; }
          .vd-breathe { animation: vdBreathe 2.6s ease-in-out infinite; }
        }
        @keyframes vdDraw { to { stroke-dashoffset: 0; } }
        @keyframes vdBreathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.68; } }
      ` }} />

      <ArtistNav activeSlug="value" savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {/* Paint from PHASE 1 — every cockpit and board figure rides the eager
          upcoming.json signal stamps + backtest/market. Corpus-dependent
          extras (call-plate band, settled tape, modal comp rows) hydrate in
          behind without ever swapping a printed figure. */}
      {loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate={!fromCache}>
          <div className="rail ray-enter" style={{ paddingTop: 'var(--space-4)' }}><MarketSwitch compact /></div>


          {/* ════ ROOM 1 · THE COCKPIT ════ */}
          <section id="desk" className="rail ray-enter vd-room" style={{ paddingTop: 'calc(var(--space-4) + var(--space-2))' }}>
            <div className="vd-cockpit">
              <div className="vd-cockpit-main">
                <Masthead
                  kicker=""
                  title={hasFlags
                    ? <>Priced <Accent>under</Accent> where the {activeLabel === 'collectible' ? 'market' : `${activeLabel} market`} clears.</>
                    : <>The {activeLabel === 'collectible' ? 'whole' : activeLabel} book is read. <Accent>No lot</Accent> clears the bar tonight.</>}
                  sub={hasFlags
                    ? <>
                        <b style={{ color: 'var(--color-fg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{deals.length}</b> flags live ·{' '}
                        <span style={{ color: 'var(--color-up)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          median gap {signalMagnitude('Below Market', Math.round(summary.medianGap))}
                        </span>{' '}
                        · {formatPrice(summary.totalEst)} at estimate · {summary.artists} makers
                        {summary.soonest && <> · <span style={{ whiteSpace: 'nowrap' }}>first hammer {formatDate(trueSaleDay(summary.soonest.lot))}</span></>}
                      </>
                    : <>The engine abstains rather than force a thin call · {appraisedCount.toLocaleString()} live lots read in scope{nextHammer && <> · next hammer {formatDate(trueSaleDay(nextHammer))}</>}</>}
                />
              </div>
              <div className="vd-cockpit-pulse">
                <MarketPulse ray={ray} activeKey={activeKey} activeLabel={activeLabel} play={!fromCache} />
              </div>
              <div className="vd-dials-wrap">
                <DialStrip dials={dials} />
              </div>
            </div>
          </section>

          {/* ════ ROOM 1e · HOW THE DESK READS — the cell grammar: split
              head (quiet kicker, light headline) over three patent-figure
              cells, one per lane. Copy states each lane's real gates
              (pickCall/comps ladder, lanes.ts) in the lanes' own words; the
              bid-history count reads live from the served closeCurve. No
              thresholds invented, no new signal labels. ════ */}
          <section id="reads" className="rail ray-enter vd-room ns-plate vd-reads" style={{ '--enter-delay': '20ms', paddingTop: 'calc(var(--space-4) + var(--space-2))' } as React.CSSProperties}>
            <div className="ns-split">
              <div>
                <span className="ns-kicker">Three lanes, one question each</span>
                <h2 className="ray-h2" style={{ margin: 0 }}>How the desk reads</h2>
              </div>
              <p>
                Every claim on this desk belongs to one lane. Each lane asks one question,
                prints one statistic, and keeps its own record — the Flags on the certified
                replay, the Gap and the Sleepers accruing theirs on the forward tape. When
                the data runs thin, a lane abstains out loud.
              </p>
            </div>
            <CellGrid min={250} className="vd-reads-grid">
              <FigureCell
                figure={<FigGate />}
                label="The Flags"
                body={<>Live lots whose comps median clears the estimate by at least 1.3&times; —
                  ranked by calibrated odds, confidence-gated, and the engine abstains rather
                  than print a thin call.</>}
              />
              <FigureCell
                figure={<FigReplay />}
                label="The Gap"
                body={<>No-estimate lots where the projected close sits at least 25% under the
                  value floor — the close-day growth curve fitted
                  from {curveSnaps != null ? `${compactCount(curveSnaps)} ` : ''}Goldin bid histories.</>}
              />
              <FigureCell
                figure={<FigPools />}
                label="The Sleepers"
                body={<>Verified-fair lots with no printed bid yet, closing inside seven days —
                  fairness measured against the engine&rsquo;s own appraisal, never inferred
                  from a missing signal.</>}
              />
            </CellGrid>
          </section>

          {/* ════ ROOM 2 · THE BOARD ════ */}
          {/* phase-2 failed: the ledger stands on the precomputed stamps —
              say what's missing instead of blanking the page */}
          {fullError && (
            <div className="rail ray-enter" style={{ paddingTop: 12, textAlign: 'center' }}>
              <button className="ray-call-btn ray-call-btn-quiet" style={{ cursor: 'pointer' }} onClick={() => retryFullLoad()}>
                Part of the book didn&rsquo;t load — comps depth is missing · try again
              </button>
            </div>
          )}

          {call && (
            <section id="call" className="rail ray-enter vd-room ns-plate" style={{ '--enter-delay': '40ms', paddingTop: 'calc(var(--space-4) + var(--space-2))' } as React.CSSProperties}>
              {/* THE CALL AS COLOR — the ONE forced-color cell on the desk:
                  the plate's face rides the ns-cell-color grammar (grained
                  signal gradient, text goes paper) while its DOM, data and
                  CTAs stay byte-identical inside. dir is the call's actual
                  direction — pickCall admits only Below-Market flags (comps
                  over ask), the same 'up' the plate already stamps on its
                  gap row — so the ground is lamp-lawful by construction;
                  any non-directional call falls to ink. The gold .lit halo
                  yields to the color ground: still one lit element, the
                  signal itself is now the marquee. */}
              <div
                className="ns-cell ns-cell-color vd-call-cell"
                data-dir={call.signal?.label === 'Below Market' ? 'up' : 'ink'}
              >
              <CallPlate
                lots={marketLots}
                allLots={marketLots}
                market={activeKey}
                density="compact"
                isSaved={isSaved}
                onToggleSave={toggle}
                onSeeComps={l => setModalLot(l)}
                band={callBand ? (
                  <PriceBand
                    prices={callBand.prices}
                    median={callBand.median}
                    estLow={call.lot.estimateLow}
                    estHigh={call.lot.estimateHigh}
                    below={true}
                  />
                ) : (callStamp && !fullLoaded && !fullError ? <div style={{ height: 102 }} aria-hidden /> : null)}
              />
              </div>
            </section>
          )}

          <section id="flags" className="ray-value-section rail vd-room ns-plate">
            <div className="ray-enter">
              <LaneHead
                mark={<FlagsMark />}
                name="The Flags"
                count={deals.length}
                play={!fromCache}
                tag={sortMode === 'odds' ? 'comps vs estimate · calibrated odds first, the deepest gap breaks ties' : 'comps vs estimate · soonest hammer first'}
                help={
                  <>Each row is a live lot whose <Term k="comps">comps median</Term> clears its
                  estimate by at least 1.3×. <Term k="odds">Odds</Term> rank the board — the share of
                  historical calls at that ratio which beat the high estimate — and the deepest gap
                  breaks ties. Click a row for the full comps case; j/k walk the rows, s saves.</>
                }
                right={
                  <span className="vd-sort" role="tablist" aria-label="Board order">
                    <button type="button" role="tab" aria-selected={sortMode === 'odds'} data-on={sortMode === 'odds' || undefined} onClick={() => setSortMode('odds')}>Odds</button>
                    <button type="button" role="tab" aria-selected={sortMode === 'closing'} data-on={sortMode === 'closing' || undefined} onClick={() => setSortMode('closing')}>Closing next</button>
                  </span>
                }
              />
            </div>
            <div ref={boardRef} className="glass glass-quiet ray-enter" style={{ overflow: 'clip' }}>
              <div className="ray-value-head" aria-hidden="true">
                <span />
                <span className="kicker">Lot</span>
                <span className="kicker">House</span>
                <span className="kicker">Hammers</span>
                <span className="kicker" style={{ textAlign: 'right' }}>Estimate</span>
                <span className="kicker" style={{ textAlign: 'right' }}>Comps med</span>
                <span className="kicker" style={{ textAlign: 'right' }}>Odds</span>
                <span className="kicker" style={{ textAlign: 'right' }}>Gap</span>
              </div>
              {!hasFlags ? (
                /* zero flags: the instrument keeps its frame — abstention is
                   stated, the doors stay open, no apology, no coral */
                <div className="vd-empty ray-enter">
                  <p>
                    The engine abstains in the {activeLabel} market tonight — {appraisedCount.toLocaleString()} live
                    lots read, none clears the 1.3× flag bar. A blank beats a wrong number.
                  </p>
                  <div className="vd-empty-links">
                    {activeKey !== 'all' && (
                      /* /value bare resolves to the STORED market, so a plain
                         href is a no-op here — the switch must go through
                         setMarket (pushStates the bare path, flips storage) */
                      <Link href="/value" className="link-action" style={{ color: 'var(--color-fg)' }}
                        onClick={e => { e.preventDefault(); setMarket('all'); }}>
                        Watch all markets · {allFlagCount} flags live <span className="arrow"><Flick size={10} style={{ marginLeft: 5 }} /></span>
                      </Link>
                    )}
                    <Link href={activeKey === 'all' ? '/' : `/analytics/${activeKey}`} className="link-action" style={{ color: 'var(--color-fg)' }}>
                      {activeKey === 'all' ? 'Browse everything live' : `The ${activeLabel} research desk`} <span className="arrow"><Flick size={10} style={{ marginLeft: 5 }} /></span>
                    </Link>
                  </div>
                </div>
              ) : (
                gridDeals.slice(0, shown).map((d, i) => {
                  const conf = d.lot.value?.signal ? null : (d.lot.signal?.confidence ?? d.signal?.confidence);
                  const rowMed = (d.signal as { med?: number } | null)?.med ?? (() => {
                    const lo = d.lot.estimateLow || d.lot.estimateHigh || 0;
                    const hi = d.lot.estimateHigh || d.lot.estimateLow || 0;
                    const mid = (lo + hi) / 2;
                    return mid > 0 ? mid * (1 + d.signal!.pct / 100) : null;
                  })();
                  return (
                  <div key={d.lot.id} className="ray-value-rowwrap ray-enter-card" data-flip-id={d.lot.id}
                    style={{ '--enter-delay': `${Math.min(i, 8) * 40}ms` } as React.CSSProperties}>
                  <button
                    type="button"
                    className="ray-value-row"
                    data-nav-row
                    onClick={() => setModalLot(d.lot)}
                    aria-label={`${ARTIST_LABEL[d.lot.artist] || d.lot.artist} — see the comps`}
                  >
                    {/* Thumbnail — monogram plate always behind, photo overlays;
                        on a hotlink-block the plate shows through, never a gap */}
                    <span className="ray-value-row-thumb" aria-hidden="true" style={{ position: 'relative' }}>
                      <span className="vd-thumb-letter">
                        {(ARTIST_LABEL[d.lot.artist] || d.lot.artist).charAt(0)}
                      </span>
                      {d.lot.imageUrl && (
                        <img src={httpsImg(d.lot.imageUrl)} alt="" referrerPolicy="no-referrer" loading="lazy"
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={e => e.currentTarget.remove()} />
                      )}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="ray-value-row-maker" style={{ display: 'block' }}>
                        {ARTIST_LABEL[d.lot.artist] || d.lot.artist}
                      </span>
                      <span className="ray-value-row-title" style={{ display: 'block' }}>
                        {craftTitle(d.lot.title)}
                      </span>
                      {/* its own line: inside the nowrap/ellipsis title the date was the first thing cut */}
                      <span className="ray-value-mobdate">
                        <span className="ray-value-mobdate-in">
                          {(() => {
                            const day = trueSaleDay(d.lot) || d.lot.saleDate;
                            const past = trueSaleDay(d.lot) && trueSaleDay(d.lot) < localToday();
                            const dU = daysUntil(day);
                            if (!past && dU != null && dU <= 0) {
                              const tonight = !!d.lot.saleDateTime && new Date(d.lot.saleDateTime).getHours() >= 17;
                              return <><span style={{ color: 'var(--color-fg)', fontWeight: 600 }}>
                                {tonight ? 'closes tonight' : 'closes today'}
                                {d.lot.saleDateTime && <> · <CloseClock iso={d.lot.saleDateTime} windowHours={24} /></>}
                              </span></>;
                            }
                            return <>{past ? 'hammered' : 'hammers'} {formatDate(day)}</>;
                          })()}
                        </span>
                      </span>
                    </span>
                    <span className="ray-value-cell">{d.lot.auctionHouse}</span>
                    <span className="ray-value-cell">
                      {(() => {
                        const iso = d.lot.saleDateTime;
                        const ms = iso ? Date.parse(iso) - Date.now() : null;
                        return ms != null && ms > 0 && ms < 24 * 3600e3
                          ? <span className="vd-breathe" style={{ color: 'var(--color-fg)', fontWeight: 600 }}><CloseClock iso={iso!} windowHours={24} /></span>
                          : formatDate(trueSaleDay(d.lot) || d.lot.saleDate);
                      })()}
                    </span>
                    <span className="ray-value-cell ray-value-cell-num ray-value-cell-est">{formatEstimate(d.lot).replace(/ est\.$/, '').replace(/ · \d+ bids?$/, '')}</span>
                    <span className="ray-value-cell ray-value-cell-num">
                      {rowMed ? formatPrice(rowMed) : '—'}
                    </span>
                    <span className="ray-value-cell ray-value-cell-num ray-value-cell-odds">
                      {d.lot.value?.signal?.beatRatePct != null
                        ? `${Math.round(d.lot.value.signal.beatRatePct)}%`
                        : conf
                          ? <span className="ray-value-conf" aria-label={`${confidenceMeter(conf).word} confidence`}>{confidenceMeter(conf).dots}</span>
                          : '—'}
                    </span>
                    <span className="ray-value-cell ray-value-cell-num ray-value-cell-gap">
                      {signalMagnitude('Below Market', Math.round(d.signal!.pct))}
                      <CellTrack pct={d.signal!.pct / 4} tone="up" />
                    </span>
                    {/* MOBILE stack — the audited-good phone composition */}
                    <span className="ray-value-mob" style={{ textAlign: 'right' }}>
                      <span className="ray-value-row-sig" style={{ display: 'block' }}>
                        {signalMagnitude('Below Market', Math.round(d.signal!.pct))}
                      </span>
                      {d.lot.value?.signal?.beatRatePct != null && (
                        <span className="ray-value-row-est" style={{ display: 'block', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                          {Math.round(d.lot.value.signal.beatRatePct)}% odds
                        </span>
                      )}
                      <span className="ray-value-row-est" style={{ display: 'block' }}>
                        {formatEstimate(d.lot)}
                      </span>
                    </span>
                    {/* row-hover leader — the certificate sentence, the same
                        statistic the modal shows; mono only on the figure */}
                    <span className="ray-value-leader" aria-hidden="true">
                      {rowMed
                        ? <>comps median <b>{formatPrice(rowMed)}</b> vs {formatEstimate(d.lot).replace(/ est\.$/, '')} ask · <span className="up">{signalMagnitude('Below Market', Math.round(d.signal!.pct))}</span> over{d.signal!.basis ? <> · {d.signal!.basis} sales</> : null}</>
                        : <>{signalMagnitude('Below Market', Math.round(d.signal!.pct))} over ask{d.signal!.basis ? <> · {d.signal!.basis} sales</> : null}</>}
                    </span>
                  </button>
                  {/* save — sibling of the row button (both interactive) */}
                  <button
                    type="button"
                    className="ray-value-save"
                    data-save-btn
                    data-saved={isSaved(d.lot.id)}
                    onClick={() => toggle(d.lot.id, d.lot)}
                    aria-label={isSaved(d.lot.id) ? 'Remove from saved' : 'Save lot'}
                    aria-pressed={isSaved(d.lot.id)}
                  >
                    <span className="ray-value-save-glyph">
                      <svg width="10" height="12" viewBox="0 0 12 14" fill="none" aria-hidden="true">
                        <path d="M1 1.5C1 1.22386 1.22386 1 1.5 1H10.5C10.7761 1 11 1.22386 11 1.5V12.5C11 12.6894 10.8862 12.8625 10.7096 12.9472C10.533 13.0319 10.3239 13.0136 10.1646 12.8994L6 9.91421L1.83541 12.8994C1.67614 13.0136 1.46698 13.0319 1.29037 12.9472C1.11377 12.8625 1 12.6894 1 12.5V1.5Z"
                          fill={isSaved(d.lot.id) ? 'var(--color-bg)' : 'var(--color-text-faint)'} />
                      </svg>
                    </span>
                  </button>
                  </div>
                  );
                })
              )}
            </div>
            {hasFlags && gridDeals.length > shown && (
              <div className="ray-enter" style={{ textAlign: 'center', marginTop: 20 }}>
                <button
                  className="ray-call-btn ray-call-btn-quiet"
                  onClick={() => setShown(s => s + ROWS_PAGE)}
                >
                  Show {Math.min(ROWS_PAGE, gridDeals.length - shown)} more · {gridDeals.length - shown} below
                </button>
              </div>
            )}
          </section>

          {/* ── ROOM 2c · THE GAP ── */}
          <GapAnnex rows={gapRows} receipts={receipts} activeKey={activeKey} play={!fromCache} isSaved={isSaved} onToggleSave={toggle} />

          {/* ── ROOM 2d · THE SLEEPERS ── */}
          <SleepersAnnex rows={sleeperRows} queued={sleeperQueue} receipts={receipts} activeLabel={activeLabel} play={!fromCache} isSaved={isSaved} onToggleSave={toggle} />

          {/* ════ ROOM 3 · THE RECORD (paper certificate) ════ */}
          {backtest && backtest.flagged.n >= 100 && (
            <div id="record" className="ray-band vd-room" style={{ marginTop: 34, paddingBlock: '28px 30px' }}>
              <section className="rail ray-enter" style={{ '--enter-delay': '60ms', paddingTop: 0 } as React.CSSProperties}>
                {/* DUAL BASIS, premium-led: headline medians are all-in with
                    the hammer read as sub — EXCEPT beat-the-estimate, where
                    estimates are hammer-basis so the hammer figure is the
                    only honest lead. Every cell names its basis. */}
                <RecordBand
                  title="The record"
                  context="every call replayed against history"
                  serial={(lastCrawl || '').slice(0, 10).replace(/-/g, '') || undefined}
                  footer="each figure names its basis · refit nightly from the full replay"
                  cells={[
                    {
                      k: 'Flagged calls',
                      v: fmtSignedPct(backtest.flagged.medianPerfPct),
                      signed: backtest.flagged.medianPerfPct,
                      sub: `realized vs estimate, all-in${backtest.flagged.hammerMedianPct != null ? ` · hammer ${fmtSignedPct(backtest.flagged.hammerMedianPct)}` : ''} · n ${backtest.flagged.n.toLocaleString()}`,
                    },
                    {
                      k: 'The edge',
                      v: `${backtest.flagged.medianPerfPct - backtest.unflagged.medianPerfPct >= 0 ? '+' : '−'}${Math.abs(backtest.flagged.medianPerfPct - backtest.unflagged.medianPerfPct)} pts`,
                      signed: backtest.flagged.medianPerfPct - backtest.unflagged.medianPerfPct,
                      sub: <>over {backtest.unflagged.n.toLocaleString()} unflagged ({fmtSignedPct(backtest.unflagged.medianPerfPct)} all-in)</>,
                    },
                    {
                      k: 'Beat the high',
                      v: `${Math.round(backtest.flagged.hammerBeatPct ?? backtest.flagged.beatHighPct)}%`,
                      // the label names whichever basis the figure actually is
                      sub: backtest.flagged.hammerBeatPct != null
                        ? `at the hammer · vs ${backtest.unflagged.hammerBeatPct ?? backtest.unflagged.beatHighPct}% unflagged`
                        : `all-in · vs ${backtest.unflagged.beatHighPct}% unflagged`,
                    },
                    backtest.flagged.failToSellPct != null && backtest.above.failToSellPct != null
                      ? {
                          k: 'Failed to sell',
                          v: `${backtest.flagged.failToSellPct.toFixed(1)}%`,
                          sub: <>of flagged lots · vs {backtest.above.failToSellPct}% of &ldquo;above market&rdquo;</>,
                        }
                      : {
                          k: '“Above market” calls',
                          v: fmtSignedPct(backtest.above.medianPerfPct),
                          signed: backtest.above.medianPerfPct,
                          sub: 'underperformed both — the ordering holds',
                        },
                  ]}
                />
              </section>

              <RecordByYear backtest={backtest} />

              <OutcomeDistribution backtest={backtest} />

              {/* the honesty ledger — the record's fine print, led by the low */}
              <section className="rail ray-enter vd-honesty" style={{ paddingTop: 0 }}>
                {worstYear && (
                  <div className="vd-honesty-row">
                    <span>Worst flagged year since 2000</span>
                    <span className="vd-honesty-fill" aria-hidden />
                    <span><b>{worstYear.year}</b> <span className={toneOf(worstYear.flaggedMedianPct!) === 'up' ? 'vd-honesty-up' : 'vd-honesty-down'}>{fmtSignedPct(worstYear.flaggedMedianPct!)}</span> · {worstYear.nFlagged.toLocaleString()} calls</span>
                  </div>
                )}
                {ytd && (
                  <div className="vd-honesty-row">
                    <span>{ytd.year} to date</span>
                    <span className="vd-honesty-fill" aria-hidden />
                    <span>flagged <span className={toneOf(ytd.flaggedMedianPct!) === 'up' ? 'vd-honesty-up' : 'vd-honesty-down'}>{fmtSignedPct(ytd.flaggedMedianPct!)}</span> vs unflagged {fmtSignedPct(ytd.unflaggedMedianPct!)} · n {ytd.nFlagged.toLocaleString()}</span>
                  </div>
                )}
                {tiers?.main && tiers?.fallback && (
                  <div className="vd-honesty-row">
                    <span>Both arms carry edge</span>
                    <span className="vd-honesty-fill" aria-hidden />
                    <span>main {fmtSignedPct(tiers.main.medianPerfPct)} (n {tiers.main.n.toLocaleString()}) · fallback {fmtSignedPct(tiers.fallback.medianPerfPct)} (n {tiers.fallback.n.toLocaleString()})</span>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ════ ROOM 4 · THE SETTLED TAPE ════
              (REDUCE AUDIT Aug 25 2026, Collin's call: /value is ONLY the
              value engine's metrics and data. The odds-ladder room and the
              conditions room were cut here — the calibration curve renders
              on /analytics under "The engine's record", and house
              calibration + the calendar are /analytics rooms outright.) */}

          {/* the corpus loads as the reader approaches the tape */}
          <Phase2Sentinel />

          {/* settled tape — flags stamped before the hammer, then graded */}
          <section id="tape" className="rail ray-enter vd-room ns-plate" style={{ paddingTop: 'calc(var(--space-4) + var(--space-2))', paddingBottom: 'var(--space-4)' }}>
              <div className="vd-sect-head">
                <span className="vd-sect-mark" aria-hidden><TapeMark size={16} /></span>
                <span className="ns-kicker">Settled calls</span>
                <span className="vd-pulse-rule" aria-hidden />
                <span className="vd-sect-cap">flag stamped before the hammer — honest by construction</span>
              </div>
              {settled.length > 0 ? (
                settled.map(s => {
                  // all-in vs all-in: realized priceUsd against the comps
                  // median (itself a median of premium-inclusive sold prices).
                  // Dividing a derived hammer by the all-in median biased
                  // every honest hit ~20% toward "below" — same basis or none.
                  const vsComps = s.med != null && s.med > 0 && (s.lot.priceUsd || 0) > 0
                    ? Math.round((s.lot.priceUsd! / s.med - 1) * 100) : null;
                  return (
                    <Link key={s.lot.id} href={`/lot/${s.lot.id}`} className="vd-tape-row">
                      <span style={{ minWidth: 0 }}>
                        <span className="vd-tape-maker">{ARTIST_LABEL[s.lot.artist] || s.lot.artist}</span>
                        <span className="vd-tape-title" style={{ display: 'block' }}>{craftTitle(s.lot.title)}</span>
                      </span>
                      <span className="vd-tape-cells">
                        <span className="vd-tape-real">realized {formatPrice(s.lot.priceUsd!)} all-in · {formatDate(trueSaleDay(s.lot))}</span>
                        <span className="vd-tape-vs">
                          {s.oe != null && <span data-tone={toneOf(s.oe)}>{fmtSignedPct(s.oe)}</span>}
                          {s.oe != null && <> vs estimate, all-in</>}
                          {vsComps != null && <> · {vsComps > 5 ? 'above' : vsComps < -5 ? 'below' : 'at'} comps med</>}
                        </span>
                      </span>
                    </Link>
                  );
                })
              ) : !fullLoaded && !fullError ? (
                /* phase-2 pending: hold the tape's frame with ghost rows —
                   an empty settled result collapses to the sentence once loaded */
                <div aria-hidden>
                  {Array.from({ length: 3 }, (_, i) => <div key={i} className="vd-tape-ghost" />)}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
                  No {activeLabel} flags have hammered yet this cycle — the tape fills as the board settles.
                </p>
              )}
            </section>

          {/* ════ ROOM 5 · THE ENGINE CARD (paper #2, the closer) ════ */}
          <section id="engine" className="rail ray-enter vd-room ns-plate" style={{ paddingBlock: '18px 8px' }}>
            <div className="ray-engine-card">
              <h2 className="ray-engine-head">
                <span className="vd-sect-mark" style={{ verticalAlign: -3, marginRight: 10 }} aria-hidden><EngineMark size={19} /></span>
                Every flag here earned its ink.
              </h2>
              <p className="ray-engine-body">
                A read is comps, not opinion: same maker, same form, size-banded —
                medians, never means. Each vertical carries its own gate (a jersey
                only comps that player&rsquo;s jerseys; a Daytona only same-reference,
                same-metal Daytonas), and where the data can&rsquo;t carry a call, the
                engine abstains rather than guesses.
              </p>
              {backtest && backtest.flagged.n > 500 && (
                <div className="ray-engine-stats">
                  <span><b>{backtest.flagged.n.toLocaleString()}</b> calls replayed</span>
                  <span className="ray-engine-dot" aria-hidden />
                  <span>flagged realized <b className="up">{fmtSignedPct(backtest.flagged.medianPerfPct)}</b> all-in vs estimate</span>
                  <span className="ray-engine-dot" aria-hidden />
                  <span>the edge: <b>{backtest.flagged.medianPerfPct - backtest.unflagged.medianPerfPct} pts</b></span>
                </div>
              )}
              <Link href="/blog/how-we-built-the-pricing-engine" className="ray-engine-cta">
                Read how it&rsquo;s built &rarr;
              </Link>
            </div>
          </section>

          {modalLot && (
            <ComparableModal
              lot={modalLot}
              allLots={marketLots}
              onClose={() => setModalLot(null)}
              saved={isSaved(modalLot.id)}
              onToggleSave={id => toggle(id, modalLot)}
            />
          )}
        </RayEntrance>
      )}
      <Colophon record={null} />
    </div>
  );
}
