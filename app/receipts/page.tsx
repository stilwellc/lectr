'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useFullLots } from '../hooks/useRayData';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import Masthead, { Accent } from '../components/Masthead';
import Flick from '../components/Flick';
import { lotSignal } from '../components/LotCard';
import { getUpcomingCounts, formatPrice, formatDate, craftTitle, fmtSignedPct, localToday, overEstimatePct } from '../utils';
import { ARTIST_LABEL } from '../constants';
import type { AuctionLot } from '../types';

/* ============================================================
   /receipts — THE RECORD. Two populations, never blended:

   1. THE FORWARD TAPE — calls the engine logged the night it
      made them (card-comp reads, bid projections), then graded
      against the real hammer. Written BEFORE the outcome was
      knowable; the ledger is append-only, first call wins.
   2. THE REPLAYED RECORD — the historical backtest (every
      estimate-house flag replayed over 26 years). Different
      population, clearly labeled, links to /value for depth.

   Below them, THE SETTLED FLAGS tape: lots that carried a
   Below Market signal while live and have since hammered —
   the flag was stamped in the nightly data before the sale.

   Honesty rules: a metric prints only past its n-gate (the
   gate is stated, not hidden); green/red only on measured
   outcomes; the two records never sum together.
   ============================================================ */

interface ReceiptRow {
  id: string; k: 'card' | 'vsbid'; d: string; sd?: string;
  p: number; r: number; f?: number; m?: string;
  t: string | null; a: string | null; h: string | null;
}
interface CallsRecord {
  card: { n: number; graded: number; medRatio: number | null; within30Pct: number | null };
  vsbid: { n: number; graded: number; medRatio: number | null; belowHit: number | null };
  asOf: string;
}
interface ReceiptsFile { record: CallsRecord; rows: ReceiptRow[]; generatedAt: string }

export default function ReceiptsPage() {
  const { allLots, lastCrawl, loading, fullLoaded, backtest, market } = useFullLots();

  const [tape, setTape] = useState<ReceiptsFile | null | 'missing'>(null);
  useEffect(() => {
    let dead = false;
    fetch('/data/ray/receipts.json')
      .then(r => (r.ok ? r.json() : 'missing'))
      .then(j => { if (!dead) setTape(j as ReceiptsFile | 'missing'); })
      .catch(() => { if (!dead) setTape('missing'); });
    return () => { dead = true; };
  }, []);

  // the summary also rides market.json — the freshest of the two wins
  const record: CallsRecord | null = useMemo(() => {
    const fromMarket = (market?.markets?.all?.analytics as { callsRecord?: CallsRecord } | undefined)?.callsRecord ?? null;
    const fromTape = tape && tape !== 'missing' ? tape.record : null;
    if (fromMarket && fromTape) return fromMarket.asOf >= fromTape.asOf ? fromMarket : fromTape;
    return fromMarket ?? fromTape;
  }, [market, tape]);

  const rows: ReceiptRow[] = tape && tape !== 'missing' ? tape.rows : [];

  /* ── settled flags — signals stamped while live, now hammered ── */
  const settledFlags = useMemo(() => {
    if (!fullLoaded) return [];
    const today = localToday();
    return (allLots as AuctionLot[])
      .filter(l => (l.priceUsd || 0) > 0 && (l.saleDate || '').slice(0, 10) < today)
      .map(l => ({ l, sig: l.signal ?? null }))
      .filter((x): x is { l: AuctionLot; sig: NonNullable<AuctionLot['signal']> } =>
        !!x.sig && x.sig.label === 'Below Market')
      .sort((a, b) => (b.l.saleDate || '').localeCompare(a.l.saleDate || ''))
      .slice(0, 20)
      .map(({ l, sig }) => ({ l, sig, vsEst: overEstimatePct(l) }));
  }, [allLots, fullLoaded]);

  const F = backtest?.flagged;
  const U = backtest?.unflagged;

  const pending = record && record.card.graded + record.vsbid.graded === 0;

  return (
    <div className="terminal-shell" style={{ minHeight: '100vh', fontFamily: 'var(--font-sans), sans-serif' }}>
      <ArtistNav activeSlug="receipts" upcomingCounts={getUpcomingCounts(allLots)} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {loading ? (
        <RayLoading />
      ) : (
        <RayEntrance animate>
          <section className="rail ray-enter" style={{ paddingTop: 24 }}>
            <Masthead
              kicker="The record"
              serial={lastCrawl || undefined}
              title={<>Every call, <Accent>graded</Accent> against the hammer.</>}
              sub={
                <>
                  A call is logged the night the engine makes it — append-only, first call wins —
                  then judged when the lot actually sells. What we said before, against what happened.
                </>
              }
            />

            {/* ── 1 · THE FORWARD TAPE ── */}
            <div className="rcp-block ray-enter">
              <div className="rcp-head">
                <span className="kicker">The forward tape · calls logged live, graded at the hammer</span>
                <i className="rcp-rule" />
                {record && <span className="kicker" style={{ fontVariantNumeric: 'tabular-nums' }}>as of {record.asOf}</span>}
              </div>

              {record ? (
                <div className="rcp-tiles">
                  <div className="rcp-tile">
                    <span className="kicker">Card-comp reads</span>
                    <span className="rcp-fig">
                      {record.card.medRatio != null
                        ? <>{fmtSignedPct(Math.round((record.card.medRatio - 1) * 100))}</>
                        : <span className="rcp-dim">{record.card.graded}/{record.card.n}</span>}
                    </span>
                    <span className="rcp-sub">
                      {record.card.medRatio != null
                        ? <>hammer vs our read, median · {record.card.within30Pct}% within ±30% · {record.card.graded} graded</>
                        : <>{record.card.n} calls on the tape · {record.card.graded} settled · the median publishes at 20 graded</>}
                    </span>
                  </div>
                  <div className="rcp-tile">
                    <span className="kicker">Below-market projections</span>
                    <span className="rcp-fig">
                      {record.vsbid.belowHit != null
                        ? <>{record.vsbid.belowHit}%</>
                        : <span className="rcp-dim">{record.vsbid.graded}/{record.vsbid.n}</span>}
                    </span>
                    <span className="rcp-sub">
                      {record.vsbid.belowHit != null
                        ? <>of &ldquo;below the floor&rdquo; claims held at the hammer · {record.vsbid.graded} graded</>
                        : <>{record.vsbid.n} calls on the tape · {record.vsbid.graded} settled · the hit-rate publishes at 20 graded</>}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="rcp-note">The forward ledger opened Aug&nbsp;2026 — its first graded summary lands with the next nightly build.</p>
              )}

              {pending && record && (
                <p className="rcp-note">
                  The tape is accruing: {record.card.n + record.vsbid.n} calls logged, none settled yet.
                  Every row below appears the night its lot hammers — nothing is recomputed after the fact.
                </p>
              )}

              {rows.length > 0 && (
                <div className="rcp-tape">
                  <div className="rcp-cols kicker" aria-hidden>
                    <span>Hammered</span>
                    <span>Work</span>
                    <span style={{ textAlign: 'right' }}>The call</span>
                    <span style={{ textAlign: 'right' }}>The hammer</span>
                    <span style={{ textAlign: 'right' }}>vs call</span>
                  </div>
                  {rows.slice(0, 60).map(r => {
                    const delta = Math.round((r.r / r.p - 1) * 100);
                    return (
                      <Link key={`${r.id}|${r.k}`} href={`/lot?id=${encodeURIComponent(r.id)}`} className="rcp-cols rcp-row">
                        <span className="rcp-date">{r.sd ? formatDate(r.sd) : '—'}</span>
                        <span className="rcp-work">
                          <b>{r.a ? (ARTIST_LABEL[r.a] || r.a) : '—'}</b> {r.t ? craftTitle(r.t) : r.id}
                        </span>
                        <span className="rcp-num" title={r.k === 'card' ? `Card-comp read, logged ${r.d}` : `Bid projection, logged ${r.d}${r.f ? ` · floor ${formatPrice(r.f)}` : ''}`}>
                          {formatPrice(r.p)}<span className="rcp-kind">{r.k === 'card' ? 'comps' : 'proj'}</span>
                        </span>
                        <span className="rcp-num" style={{ fontWeight: 600 }}>{formatPrice(r.r)}</span>
                        <span className="rcp-num" style={{ color: delta > 0 ? 'var(--color-up)' : delta < 0 ? 'var(--color-down-text)' : 'var(--color-text-muted)', fontWeight: 600 }}>
                          {fmtSignedPct(delta)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── 2 · THE REPLAYED RECORD ── */}
            {F && U && (
              <div className="rcp-block ray-enter">
                <div className="rcp-head">
                  <span className="kicker">The replayed record · every estimate-house flag, 26 years of hammers</span>
                  <i className="rcp-rule" />
                </div>
                <div className="rcp-tiles">
                  <div className="rcp-tile">
                    <span className="kicker">Flagged below market</span>
                    <span className="rcp-fig" style={{ color: 'var(--color-up)' }}>{fmtSignedPct(F.medianPerfPct)}</span>
                    <span className="rcp-sub">realized vs estimate, median · {F.n.toLocaleString()} settled flags · hammer-only {fmtSignedPct(F.hammerMedianPct ?? 0)}</span>
                  </div>
                  <div className="rcp-tile">
                    <span className="kicker">Everything unflagged</span>
                    <span className="rcp-fig">{fmtSignedPct(U.medianPerfPct)}</span>
                    <span className="rcp-sub">same basis · the edge: {F.medianPerfPct - U.medianPerfPct} points ·{' '}
                      <Link href="/value" className="rcp-link">the full analysis <Flick size={9} /></Link>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── 3 · SETTLED FLAGS — stamped live, judged at the hammer ── */}
            {settledFlags.length > 0 && (
              <div className="rcp-block ray-enter" style={{ paddingBottom: 48 }}>
                <div className="rcp-head">
                  <span className="kicker">Recently settled flags · the signal was in the nightly data before the sale</span>
                  <i className="rcp-rule" />
                </div>
                <div className="rcp-tape">
                  <div className="rcp-cols kicker" aria-hidden>
                    <span>Hammered</span>
                    <span>Work</span>
                    <span style={{ textAlign: 'right' }}>Flagged</span>
                    <span style={{ textAlign: 'right' }}>Realized</span>
                    <span style={{ textAlign: 'right' }}>vs est</span>
                  </div>
                  {settledFlags.map(({ l, sig, vsEst }) => (
                    <Link key={l.id} href={`/lot?id=${encodeURIComponent(l.id)}`} className="rcp-cols rcp-row">
                      <span className="rcp-date">{formatDate(l.saleDate)}</span>
                      <span className="rcp-work"><b>{ARTIST_LABEL[l.artist] || l.artist}</b> {craftTitle(l.title)}</span>
                      <span className="rcp-num" style={{ color: 'var(--color-up)' }}>+{Math.abs(Math.round(sig.pct))}%<span className="rcp-kind">vs comps</span></span>
                      <span className="rcp-num" style={{ fontWeight: 600 }}>{formatPrice(l.priceUsd!)}</span>
                      <span className="rcp-num" style={vsEst != null ? { color: vsEst > 0 ? 'var(--color-up)' : vsEst < 0 ? 'var(--color-down-text)' : 'var(--color-text-muted)', fontWeight: 600 } : { color: 'var(--color-text-faint)' }}>
                        {vsEst != null ? fmtSignedPct(Math.round(vsEst)) : '—'}
                      </span>
                    </Link>
                  ))}
                </div>
                <p className="rcp-note" style={{ marginTop: 14 }}>
                  Two different records, never blended: the forward tape grades calls logged before each hammer;
                  the replayed record re-runs the whole history. Both print their n and abstain below it.
                </p>
              </div>
            )}
          </section>
        </RayEntrance>
      )}
      <Colophon record={F ? { n: F.n, medianPerfPct: F.medianPerfPct } : null} />
    </div>
  );
}
