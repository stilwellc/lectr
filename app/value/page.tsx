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
import { lotSignal, formatEstimate, confidenceMeter } from '../components/LotCard';
import ComparableModal, { PriceBand } from '../components/ComparableModal';
// The paper room's two recharts consumers stay OUT of the initial bundle
// (dynamic, ssr:false, fixed-height fallbacks so the swap can never shift).
const RecordByYear = dynamic(() => import('../components/RecordByYear'), {
  ssr: false,
  // 380px = the settled component's real flow height (section pad 30 + head
  // ~48 + glass panel ~302) — a 300px reserve shifted the paper room ~75px
  loading: () => <div style={{ height: 380, borderRadius: 12, opacity: 0.4 }} aria-hidden />,
});
const CalibrationCurve = dynamic(() => import('../components/analytics/CalibrationCurve'), {
  ssr: false,
  loading: () => <div style={{ height: 295, borderRadius: 12, background: 'var(--color-bg-elevated)', opacity: 0.5 }} aria-hidden />,
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
import RecordBand from '../components/RecordBand';
import Masthead, { Accent } from '../components/Masthead';
import Flick from '../components/Flick';
import CloseClock from '../components/CloseClock';
import CountUp from '../components/CountUp';
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
    color: 'rgba(255,255,255,0.45)',
    unit: 'count' as const,
    points: series,
  } : null, [series, activeLabel]);

  if (!anchor && !read) return null;
  return (
    <div className="vd-pulse">
      <div className="vd-pulse-head">
        <span className="kicker">Market pulse</span>
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

/* ── ROOM 2c · THE GAP — "the bidding is behind the value" on no-estimate
   lots: the growth-projected close vs the value floor. Two shelves — AT THE
   WIRE (≤3.5d, depth ≥25%) and FORMING (3.5–8d, depth ≥40%, a harder bar
   against unmodeled earliness; 8d is the curve's last fitted edge). A
   PROJECTION product: depth prints in NEUTRAL ink, every shelf entry logs to
   the forward tape the night it appears, nothing publishes before 20 graded. ── */
function GapAnnex({ rows, receipts, activeKey }: {
  rows: { lot: AuctionLot; g: GapRead }[];
  receipts: { record: { gap?: { n: number; graded: number } } } | null;
  activeKey: string;
}) {
  const [showForming, setShowForming] = useState(false);
  const wire = rows.filter(r => r.g.shelf === 'wire').sort((a, b) => b.g.depth - a.g.depth).slice(0, 6);
  const forming = rows.filter(r => r.g.shelf === 'forming').sort((a, b) => b.g.depth - a.g.depth).slice(0, 6);
  if (!wire.length && !forming.length) return null;
  const gapRec = receipts?.record?.gap;
  const row = ({ lot, g }: { lot: AuctionLot; g: GapRead }) => (
    <Link key={lot.id} href={`/lot/${lot.id}`} className="vd-annex-row">
      <span className="ray-value-row-thumb vd-annex-thumb" aria-hidden>
        <span className="vd-thumb-letter">{(ARTIST_LABEL[lot.artist] || lot.artist).charAt(0)}</span>
        {lot.imageUrl && (
          <img src={httpsImg(lot.imageUrl)} alt="" referrerPolicy="no-referrer" loading="lazy"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => e.currentTarget.remove()} />
        )}
      </span>
      <span className="vd-annex-main">
        <span className="vd-annex-maker">{ARTIST_LABEL[lot.artist] || lot.artist}{g.shelf === 'forming' && <span className="vd-lane-tag">early</span>}</span>
        <span className="vd-annex-title">{craftTitle(lot.title)}</span>
      </span>
      <span className="vd-annex-cells">
        <span className="vd-annex-depth">−{Math.round(g.depth * 100)}% under floor</span>
        <span className="vd-annex-proj" title={`floor from ${g.floorSrc === 'value.low' ? 'the appraisal band' : 'card comps ×0.85'}`}>
          proj {formatPrice(g.allIn)} vs floor {formatPrice(g.floor)}
        </span>
        {lot.value?.vsBid?.pct != null && lot.value.vsBid.pct < 0 && (
          <span className="vd-annex-proj">bid now {Math.round(lot.value.vsBid.pct)}% vs comps</span>
        )}
        <span className="vd-annex-close">
          closes {formatDate(lot.saleDate)}
          {lot.saleDateTime && (Date.parse(lot.saleDateTime) - Date.now()) < 24 * 3600e3 && (Date.parse(lot.saleDateTime) > Date.now())
            ? <> · <CloseClock iso={lot.saleDateTime} windowHours={24} /></>
            : null}
        </span>
      </span>
    </Link>
  );
  return (
    <section className="rail ray-enter vd-annex" style={{ '--enter-delay': '80ms' } as React.CSSProperties}>
      <div className="vd-sect-head">
        <span className="kicker">The Gap · projected close vs floor</span>
        <span className="vd-pulse-rule" aria-hidden />
        <span className="vd-sect-cap">projected closes, not comps · board refreshes ~4h · record accruing</span>
      </div>
      <div>{wire.map(row)}</div>
      {forming.length > 0 && (
        <>
          <button type="button" className="vd-forming-toggle" onClick={() => setShowForming(v => !v)} aria-expanded={showForming}>
            {showForming ? 'hide' : 'show'} {forming.length} forming · 3.5–8d out · early — the projection tightens as the close nears
          </button>
          {showForming && <div>{forming.map(row)}</div>}
        </>
      )}
      <div className="vd-annex-meter">
        {gapRec
          ? <>forward tape: {gapRec.n.toLocaleString()} logged · {gapRec.graded} graded · publishes at 20 graded</>
          : <>forward tape: — · publishes at 20 graded</>}
      </div>
      <div className="vd-annex-meter" style={{ borderTop: 'none', paddingTop: 2 }}>
        curve fitted from goldin bid histories · estimate-house books abstain{activeKey === 'tcg' || activeKey === 'all' ? <> · tcg: projection only — no comp basis yet</> : null}
      </div>
    </section>
  );
}

/* ── ROOM 2d · THE SLEEPERS — "the price is right and nobody's looking":
   verified-fair lots (the engine's own appraisal inside the at-market band —
   never inferred from a null signal) with a DEAD room (0 bids on an exposed
   book), closing ≤7 days. Neutral ink; both bases named; receipts accrue as
   'quiet' calls. The lane is BURSTY (RR's final week) — when empty it prints
   its calendar instead of vanishing. ── */
function SleepersAnnex({ rows, queued, receipts, activeLabel }: {
  rows: { lot: AuctionLot; q: SleeperRead }[];
  queued: number;
  receipts: { record: { quiet?: { n: number; graded: number } } } | null;
  activeLabel: string;
}) {
  if (!rows.length && !queued) return null;
  const rec = receipts?.record?.quiet;
  return (
    <section className="rail ray-enter vd-annex" style={{ '--enter-delay': '100ms' } as React.CSSProperties}>
      <div className="vd-sect-head">
        <span className="kicker">The Sleepers · fair-priced, no bids, closing</span>
        <span className="vd-pulse-rule" aria-hidden />
        <span className="vd-sect-cap">verified-fair lots with a dead room · record accruing</span>
      </div>
      {rows.length ? (
        <div>
          {rows.slice(0, 6).map(({ lot, q }) => (
            <Link key={lot.id} href={`/lot/${lot.id}`} className="vd-annex-row">
              <span className="ray-value-row-thumb vd-annex-thumb" aria-hidden>
                <span className="vd-thumb-letter">{(ARTIST_LABEL[lot.artist] || lot.artist).charAt(0)}</span>
                {lot.imageUrl && (
                  <img src={httpsImg(lot.imageUrl)} alt="" referrerPolicy="no-referrer" loading="lazy"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={e => e.currentTarget.remove()} />
                )}
              </span>
              <span className="vd-annex-main">
                <span className="vd-annex-maker">{ARTIST_LABEL[lot.artist] || lot.artist}</span>
                <span className="vd-annex-title">{craftTitle(lot.title)}</span>
              </span>
              <span className="vd-annex-cells">
                <span className="vd-annex-depth">
                  {q.estMid ? <>est {formatPrice(q.estMid)} (hammer)</> : <>appraised {formatPrice(q.cvu)} (all-in)</>}
                </span>
                <span className="vd-annex-proj">
                  {q.estMid ? <>appraised {formatPrice(q.cvu)} (all-in) · </> : null}0 bids{q.entry != null ? <> · opens {formatPrice(q.entry)}</> : null}
                </span>
                <span className="vd-annex-close">
                  closes {formatDate(q.closes)}
                  {lot.saleDateTime && (Date.parse(lot.saleDateTime) - Date.now()) < 24 * 3600e3 && (Date.parse(lot.saleDateTime) > Date.now())
                    ? <> · <CloseClock iso={lot.saleDateTime} windowHours={24} /></>
                    : null}
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '2px 0 0' }}>
          0 in the 7-day window · {queued.toLocaleString()} dead-room {activeLabel} lots queued further out — the lane fills as their final week opens.
        </p>
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
    </section>
  );
}

/* ── ROOM 4½ · THE CONDITIONS — where and when value appears. Left: per-
   house estimate calibration (median realized vs estimate AT THE HAMMER —
   positive = estimates run cold = where flags come from). Right: the
   closing-month calendar. Both n-gated, both measured outcomes. ── */
function ConditionsRoom({ market, activeKey, activeLabel }: {
  market: NonNullable<ReturnType<typeof useRayData>['market']>;
  activeKey: string;
  activeLabel: string;
}) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const houses = useMemo(() => {
    const hc = market.houseCal || {};
    return Object.entries(hc)
      .map(([house, cells]) => ({ house, cell: cells[activeKey] }))
      .filter((x): x is { house: string; cell: { n: number; hammerMedPct: number; allInMedPct: number } } => !!x.cell && x.cell.n >= 40)
      .sort((a, b) => b.cell.hammerMedPct - a.cell.hammerMedPct);
  }, [market.houseCal, activeKey]);
  const season = market.seasonality?.[activeKey];
  const nowMonth = new Date().getMonth();
  if (!houses.length && !season?.length) return null;
  const hMax = Math.max(8, ...houses.map(h => Math.abs(h.cell.hammerMedPct)));
  const sMax = season?.length ? Math.max(8, ...season.map(m => (m.n >= 30 ? Math.abs(m.allInMedPct) : 0))) : 0;
  return (
    <section className="rail ray-enter" style={{ paddingTop: 'calc(var(--space-4) + var(--space-2))' }}>
      <div className="vd-sect-head">
        <span className="kicker">The conditions</span>
        <span className="vd-pulse-rule" aria-hidden />
        <span className="vd-sect-cap">where and when {activeLabel === 'collectible' ? 'the' : `the ${activeLabel}`} market misprices</span>
      </div>
      <div className="vd-cond">
        {houses.length > 0 && (
          <div>
            <div className="vd-cond-head kicker">Estimates vs the hammer</div>
            <p className="vd-cond-cap">median realized vs estimate at the hammer, by house — positive means the room beats the catalogue; negative means the catalogue runs hot</p>
            {houses.map(h => {
              const v = h.cell.hammerMedPct;
              const w = Math.round((Math.abs(v) / hMax) * 50);
              return (
                <div key={h.house} className="vd-house-row">
                  <span className="vd-house-name">{h.house}</span>
                  <span className="vd-house-track" aria-hidden>
                    <span className="vd-house-zero" />
                    <span className={`vd-house-bar ${v >= 0 ? 'up' : 'down'}`} style={v >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} />
                  </span>
                  <span className="vd-house-fig" data-tone={toneOf(v)}>{fmtSignedPct(v)}</span>
                  <span className="vd-house-n">n {h.cell.n.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}
        {season && season.length === 12 && (
          <div>
            <div className="vd-cond-head kicker">The calendar</div>
            <p className="vd-cond-cap">median realized vs estimate, all-in, by closing month · months under n 30 abstain</p>
            <div className="vd-season" aria-label="Seasonality by closing month">
              {season.map((m, i) => {
                const gated = m.n < 30;
                const v = m.allInMedPct;
                const h = gated ? 0 : Math.round((Math.abs(v) / sMax) * 34);
                return (
                  <div key={i} className="vd-season-col" data-now={i === nowMonth || undefined}>
                    <span className="vd-season-fig" data-tone={gated ? undefined : toneOf(v)}>{gated ? '—' : fmtSignedPct(v)}</span>
                    <span className="vd-season-stage" aria-hidden>
                      <span className={`vd-season-bar ${v >= 0 ? 'up' : 'down'}`} style={{ height: h, [v >= 0 ? 'bottom' : 'top']: '50%' } as React.CSSProperties} />
                      <span className="vd-season-zero" />
                    </span>
                    <span className="vd-season-m">{MONTHS[i]}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── ROOM 4a right column · the bucket ledger + what a confidence tier
   promises. Beams hand-rolled on ONE shared log-x scale (a shared witness
   at 1.0× is only honest if every row shares the domain). ── */
const BUCKET_ROWS: { label: string; idx: number }[] = [
  { label: '<0.6×', idx: 0 }, { label: '0.6–0.9×', idx: 1 }, { label: '0.9–1.3×', idx: 2 },
  { label: '1.3–2×', idx: 3 }, { label: '2–10×', idx: 4 }, { label: '>10×', idx: 5 },
];
function OddsLadderSide({ backtest }: { backtest: Backtest }) {
  const beat = backtest.calibration?.beatRate?.global;
  const band = backtest.calibration?.band as Record<string, { lo: number; hi: number }> | undefined;
  const n = (backtest.calibration as { n?: number } | undefined)?.n;
  if (!beat || beat.length !== 6) return null;
  // shared log domain across the three tier bands, padded
  const tiers = (['high', 'medium', 'low'] as const).filter(t => band?.[t]?.lo && band?.[t]?.hi);
  const lows = tiers.map(t => band![t].lo), his = tiers.map(t => band![t].hi);
  const dLo = Math.min(0.9, ...lows) * 0.92, dHi = Math.max(1.1, ...his) * 1.08;
  const lx = (v: number) => ((Math.log(v) - Math.log(dLo)) / (Math.log(dHi) - Math.log(dLo))) * 100;
  return (
    <div className="vd-odds-side">
      <div className="vd-bucket-head">
        <span className="kicker">Ratio</span>
        <span className="kicker" style={{ textAlign: 'right' }}>Beat rate</span>
      </div>
      {BUCKET_ROWS.map(b => (
        <div key={b.label} className="vd-bucket-row" data-subject={b.label === '1.3–2×' || undefined}>
          <span className="vd-bucket-l">{b.label}</span>
          <span className="vd-bucket-v">{beat[b.idx]}%</span>
        </div>
      ))}
      <div className="vd-bucket-foot">n = {n ? n.toLocaleString() : '—'} · recency-weighted, 3y half-life</div>
      <p className="vd-odds-cap">0.9–1.3× is mostly buyer&rsquo;s premium, not edge — that band never flags.</p>

      {tiers.length > 0 && (
        <div className="vd-bands">
          <div className="vd-bands-head kicker">What a confidence tier promises</div>
          {tiers.map(t => (
            <div key={t} className="vd-band-row">
              <span className="vd-band-l">{t}</span>
              <span className="vd-band-beam" aria-hidden>
                <svg viewBox="0 0 100 20" preserveAspectRatio="none">
                  {/* shared 1.0× witness behind every row */}
                  <line x1={lx(1)} y1="0" x2={lx(1)} y2="20" className="vd-band-witness" vectorEffect="non-scaling-stroke" />
                  <line x1={lx(band![t].lo)} y1="10" x2={lx(band![t].hi)} y2="10" className="vd-band-rule" vectorEffect="non-scaling-stroke" />
                  <line x1={lx(band![t].lo)} y1="5" x2={lx(band![t].lo)} y2="15" className="vd-band-rule" vectorEffect="non-scaling-stroke" />
                  <line x1={lx(band![t].hi)} y1="5" x2={lx(band![t].hi)} y2="15" className="vd-band-rule" vectorEffect="non-scaling-stroke" />
                  <rect x={lx(1) - 1.1} y="8" width="2.2" height="4" className="vd-band-diamond" transform={`rotate(45 ${lx(1)} 10)`} />
                </svg>
              </span>
              <span className="vd-band-ends">{band![t].lo.toFixed(2)}× – {band![t].hi.toFixed(2)}×</span>
            </div>
          ))}
          <div className="vd-bands-sub">realized ÷ appraisal, 15th–85th percentile · the witness stands at 1.0×</div>
        </div>
      )}
    </div>
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
  const { market } = useMarket();
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
          background: #0d0f11;
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

        /* ── the dial strip — one fused band, hairline splits, no boxes ── */
        .vd-dials {
          display: flex;
          margin-top: 18px;
          border-top: 1px solid var(--color-border);
          border-bottom: 1px solid var(--color-border);
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
            border-bottom: 1px solid var(--color-hair, rgba(255,255,255,0.06));
            min-height: 44px;
          }
          .vd-dial-k { grid-area: k; }
          .vd-dial-s { grid-area: s; font-size: 11px; }
          .vd-dial-v { grid-area: v; font-size: 20px; justify-content: flex-end; min-height: 0; min-width: 76px; }
          .vd-pulse { margin-top: 14px; }
        }

        /* ── section heads (kicker beside a rule) ── */
        .vd-sect-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .vd-sect-head .kicker { white-space: nowrap; }
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
          .ray-value-head .kicker { font-size: 10px; letter-spacing: 0.14em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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

        /* ── ROOM 4½ the conditions ── */
        .vd-cond { display: grid; grid-template-columns: minmax(0, 1fr); gap: 26px 40px; }
        @media (min-width: 900px) { .vd-cond { grid-template-columns: minmax(0, 6fr) minmax(0, 6fr); align-items: start; } }
        .vd-cond-head { font-size: 10px; letter-spacing: 0.14em; padding-bottom: 7px; border-bottom: 1px solid var(--color-border); }
        .vd-cond-cap { font-size: 12px; color: var(--color-text-faint); margin: 8px 0 10px; }
        .vd-house-row {
          display: grid; grid-template-columns: 92px minmax(0, 1fr) 56px 64px; gap: 12px;
          align-items: center; padding: 7px 0; min-height: 34px;
          border-bottom: 1px solid var(--color-hair, rgba(255,255,255,0.06));
        }
        .vd-house-name { font-size: 12.5px; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .vd-house-track { position: relative; height: 8px; }
        .vd-house-zero { position: absolute; left: 50%; top: -3px; bottom: -3px; width: 1px; background: rgba(255, 255, 255, 0.18); }
        .vd-house-bar { position: absolute; top: 0; bottom: 0; }
        .vd-house-bar.up { background: var(--color-up); opacity: 0.75; }
        .vd-house-bar.down { background: var(--color-down); opacity: 0.75; }
        .vd-house-fig { font-family: var(--font-mono), monospace; font-size: 12.5px; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; color: var(--color-fg); }
        .vd-house-fig[data-tone="up"] { color: var(--color-up); }
        .vd-house-fig[data-tone="down"] { color: var(--color-down-text); }
        .vd-house-n { font-family: var(--font-mono), monospace; font-size: 10.5px; color: var(--color-text-faint); text-align: right; font-variant-numeric: tabular-nums; }
        .vd-season { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; }
        .vd-season-col { display: grid; gap: 5px; justify-items: center; padding: 6px 0 4px; border-radius: 6px; }
        .vd-season-col[data-now] { background: rgba(232, 218, 182, 0.07); }
        .vd-season-fig { font-family: var(--font-mono), monospace; font-size: 10px; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
        .vd-season-fig[data-tone="up"] { color: var(--color-up); }
        .vd-season-fig[data-tone="down"] { color: var(--color-down-text); }
        .vd-season-stage { position: relative; width: 100%; height: 72px; }
        .vd-season-zero { position: absolute; left: 15%; right: 15%; top: 50%; height: 1px; background: rgba(255, 255, 255, 0.14); }
        .vd-season-bar { position: absolute; left: 50%; transform: translateX(-50%); width: min(14px, 60%); }
        .vd-season-bar.up { background: var(--color-up); opacity: 0.8; }
        .vd-season-bar.down { background: var(--color-down); opacity: 0.8; }
        .vd-season-m { font-size: 10px; color: var(--color-text-faint); }
        @media (max-width: 700px) {
          .vd-season { grid-template-columns: repeat(6, 1fr); gap: 8px 4px; }
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
        .vd-lane-tag {
          display: inline-block; margin-left: 8px; padding: 1px 7px;
          font-family: var(--font-mono), monospace; font-size: 10px;
          letter-spacing: 0.06em; color: var(--color-text-muted);
          border: 1px solid var(--color-border); border-radius: 100px;
          vertical-align: 1px;
        }
        .vd-forming-toggle {
          display: block; width: 100%; text-align: left;
          background: none; border: none; cursor: pointer;
          padding: 10px 2px; min-height: 40px;
          border-bottom: 1px solid var(--color-hair, rgba(255,255,255,0.06));
          font-family: var(--font-mono), monospace; font-size: 11.5px;
          letter-spacing: 0.02em; color: var(--color-text-muted);
          transition: color var(--duration-fast) var(--ease-signature);
        }
        .vd-forming-toggle:hover { color: var(--color-fg); }
        .vd-annex-meter {
          margin-top: 10px;
          padding-top: 9px;
          border-top: 1px solid var(--color-border);
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

        /* ── ROOM 4 odds ladder ── */
        .vd-odds { display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px 32px; }
        @media (min-width: 900px) {
          .vd-odds { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); align-items: start; }
        }
        .vd-odds-side { padding-top: 2px; }
        .vd-bucket-head, .vd-bucket-row {
          display: grid; grid-template-columns: minmax(0, 1fr) 72px; gap: 12px;
          align-items: baseline;
        }
        .vd-bucket-head { padding: 0 2px 7px; border-bottom: 1px solid var(--color-border); }
        .vd-bucket-head .kicker { font-size: 10px; letter-spacing: 0.14em; }
        .vd-bucket-row { padding: 7px 2px; border-bottom: 1px solid var(--color-hair, rgba(255,255,255,0.06)); }
        .vd-bucket-l { font-family: var(--font-mono), monospace; font-size: 12.5px; color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
        .vd-bucket-v { font-family: var(--font-mono), monospace; font-size: 13px; font-weight: 600; color: var(--color-fg); text-align: right; font-variant-numeric: tabular-nums; }
        .vd-bucket-row[data-subject] { border-left: 2px solid var(--color-butter-deep, #b9a26b); padding-left: 8px; }
        .vd-bucket-row[data-subject] .vd-bucket-l { color: var(--color-fg); font-weight: 600; }
        .vd-bucket-foot { padding: 7px 2px 0; font-family: var(--font-mono), monospace; font-size: 10.5px; color: var(--color-text-faint); }
        .vd-odds-cap { font-size: 12.5px; color: var(--color-text-muted); margin: 12px 0 0; max-width: 420px; }
        .vd-bands { margin-top: 22px; }
        .vd-bands-head { font-size: 10px; letter-spacing: 0.14em; padding-bottom: 7px; border-bottom: 1px solid var(--color-border); }
        .vd-band-row {
          display: grid; grid-template-columns: 64px minmax(0, 1fr) 110px; gap: 12px;
          align-items: center; padding: 8px 2px;
          border-bottom: 1px solid var(--color-hair, rgba(255,255,255,0.06));
        }
        .vd-band-l { font-size: 12px; color: var(--color-text-secondary); }
        .vd-band-beam svg { display: block; width: 100%; height: 20px; overflow: visible; }
        .vd-band-rule { stroke: rgba(255, 255, 255, 0.55); stroke-width: 1; }
        .vd-band-witness { stroke: rgba(255, 255, 255, 0.18); stroke-width: 1; stroke-dasharray: 2 4; }
        .vd-band-diamond { fill: var(--color-fg); }
        .vd-band-ends { font-family: var(--font-mono), monospace; font-size: 11px; color: var(--color-text-muted); text-align: right; font-variant-numeric: tabular-nums; }
        .vd-bands-sub { padding-top: 8px; font-size: 11px; color: var(--color-text-faint); }
        .vd-odds-law {
          margin-top: 18px; padding-top: 12px;
          border-top: 1px solid var(--color-border);
          font-size: 13px; color: var(--color-text-secondary);
        }

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
        .vd-tape-ghost { height: 44px; border-bottom: 1px solid var(--color-hair, rgba(255,255,255,0.06)); background: rgba(255,255,255,0.02); }
        @media (max-width: 640px) {
          .vd-tape-row { grid-template-columns: minmax(0, 1fr); }
          .vd-tape-cells { text-align: left; }
        }
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
          <section className="rail ray-enter" style={{ paddingTop: 'calc(var(--space-4) + var(--space-2))' }}>
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
            <section className="rail ray-enter" style={{ '--enter-delay': '40ms', paddingTop: 'calc(var(--space-4) + var(--space-2))' } as React.CSSProperties}>
              {/* ONE CALLPLATE — the page's single lit element. PriceBand
                  hydrates at fullLoaded; a fixed slot holds the room. */}
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
            </section>
          )}

          <section className="ray-value-section rail">
            <div className="vd-sect-head ray-enter">
              <h2 className="ray-h2" style={{ marginBottom: 0 }}>The Flags · every one, ranked.</h2>
              <span className="vd-pulse-rule" aria-hidden />
              <span className="vd-sect-cap">{sortMode === 'odds' ? 'comps vs estimate · calibrated odds first, the deepest gap breaks ties' : 'comps vs estimate · soonest hammer first'}</span>
              <span className="vd-sort" role="tablist" aria-label="Board order">
                <button type="button" role="tab" aria-selected={sortMode === 'odds'} data-on={sortMode === 'odds' || undefined} onClick={() => setSortMode('odds')}>Odds</button>
                <button type="button" role="tab" aria-selected={sortMode === 'closing'} data-on={sortMode === 'closing' || undefined} onClick={() => setSortMode('closing')}>Closing next</button>
              </span>
            </div>
            <div className="glass glass-quiet ray-enter" style={{ overflow: 'hidden' }}>
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
                      <Link href="/value" className="link-action" style={{ color: 'var(--color-fg)' }}>
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
                  <div key={d.lot.id} className="ray-value-rowwrap ray-enter-card"
                    style={{ '--enter-delay': `${Math.min(i, 8) * 40}ms` } as React.CSSProperties}>
                  <button
                    type="button"
                    className="ray-value-row"
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
                        <span className="ray-value-mobdate">
                          {(() => {
                            const day = trueSaleDay(d.lot) || d.lot.saleDate;
                            const past = trueSaleDay(d.lot) && trueSaleDay(d.lot) < localToday();
                            const dU = daysUntil(day);
                            if (!past && dU != null && dU <= 0) {
                              const tonight = !!d.lot.saleDateTime && new Date(d.lot.saleDateTime).getHours() >= 17;
                              return <> · <span style={{ color: 'var(--color-up)', fontWeight: 600 }}>
                                {tonight ? 'closes tonight' : 'closes today'}
                                {d.lot.saleDateTime && <> · <CloseClock iso={d.lot.saleDateTime} windowHours={24} /></>}
                              </span></>;
                            }
                            return <>{' '}· {past ? 'hammered' : 'hammers'} {formatDate(day)}</>;
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
                          ? <span style={{ color: 'var(--color-up)', fontWeight: 600 }}><CloseClock iso={iso!} windowHours={24} /></span>
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
          <GapAnnex rows={gapRows} receipts={receipts} activeKey={activeKey} />

          {/* ── ROOM 2d · THE SLEEPERS ── */}
          <SleepersAnnex rows={sleeperRows} queued={sleeperQueue} receipts={receipts} activeLabel={activeLabel} />

          {/* ════ ROOM 3 · THE RECORD (paper certificate) ════ */}
          {backtest && backtest.flagged.n >= 100 && (
            <div className="ray-band" style={{ marginTop: 34, paddingBlock: '28px 30px' }}>
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

          {/* ════ ROOM 4 · THE ODDS LADDER & THE SETTLED TAPE ════ */}
          {backtest?.calibration?.beatRate?.global && (
            <section className="rail ray-enter" style={{ paddingTop: 'calc(var(--sect-t) - 6px)' }}>
              <div className="vd-sect-head">
                <span className="kicker">The odds ladder</span>
                <span className="vd-pulse-rule" aria-hidden />
              </div>
              <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', margin: '0 0 18px', maxWidth: 620 }}>
                Comp-ratio in, beat-rate out — the calibrated odds that rank everything on this board.
              </p>
              <div className="vd-odds">
                <div>
                  <CalibrationCurve backtest={backtest} bare flagThreshold />
                  <p className="vd-odds-law">
                    Every ranked surface uses these odds first; the raw gap only breaks ties, capped at 400%.
                  </p>
                </div>
                <OddsLadderSide backtest={backtest} />
              </div>
            </section>
          )}

          {ray.market && <ConditionsRoom market={ray.market} activeKey={activeKey} activeLabel={activeLabel} />}

          {/* the corpus loads as the reader approaches the tape */}
          <Phase2Sentinel />

          {/* settled tape — flags stamped before the hammer, then graded */}
          <section className="rail ray-enter" style={{ paddingTop: 'calc(var(--space-4) + var(--space-2))', paddingBottom: 'var(--space-4)' }}>
              <div className="vd-sect-head">
                <span className="kicker">Settled calls</span>
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
          <section className="rail ray-enter" style={{ paddingBlock: '18px 8px' }}>
            <div className="ray-engine-card">
              <h2 className="ray-engine-head">Every flag here earned its ink.</h2>
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
