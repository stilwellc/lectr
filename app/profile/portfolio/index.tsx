'use client';
/**
 * PORTFOLIO (#portfolio) — THE DESK v3 §6 (Oct 11 2026): the collection
 * re-marked over time.
 *
 * The desk's Collection room says what each piece is worth NOW (the engine's
 * appraisal against what was paid). This room answers the next question —
 * how has what I hold moved, and what would it leave me — with the makers'
 * own yearly record (pages/entity-<bb>.json, loadEntityDetail) and the
 * engine's one call per lot (lotVerdict). Every figure is read, labelled
 * with its n or its basis, and gaps stay gaps (./portfolio.ts has the law).
 *
 * Contract: default export (SectionProps) + meta(desk). Reads only the desk
 * it is handed and the entity buckets; one clock (desk.now).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { DeskData, SectionMeta, SectionProps } from '../desk/types';
import { RoomHead } from '../head';
import { READ_DEADLINE_MS, withTimeout } from '../stall';
import { loadEntityDetail, loadEntitySummary } from '../../hooks/useEntities';
import HeroChart, { type HeroLine } from '../../preview/terminal/HeroChart';
import { CollectionMark } from '../../components/marks';
import { craftTitle, formatDate } from '../../utils';
import { makerLineOf } from '../../lib/lot-labels';
import { fmtFace } from '../../lib/lot-face';
import { COMMISSION_NOTE, TIER_LABEL } from './commission';
import {
  collectionIndex, indexableEntity, noIndexNote, pieceOf, pieceRow, totalsOf, yearOfNow,
  TIMING_YEARS, type EntityRead, type PieceRow,
} from './portfolio';
import { csvFilename, downloadCsv, portfolioCsv } from './csv';
import './portfolio.css';

export function meta(desk: DeskData): SectionMeta {
  const n = desk.collection.length;
  return { id: 'portfolio', label: 'Portfolio', count: n || null, quiet: n === 0 };
}

const dirOf = (delta: number | null): 'up' | 'down' | undefined => (delta == null || delta === 0 ? undefined : delta > 0 ? 'up' : 'down');
const pctOf = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a != null && b != null && b > 0 ? Math.round((a / b - 1) * 100) : null;
const signed = (p: number) => `${p > 0 ? '+' : '−'}${Math.abs(p)}%`;

export default function Portfolio({ desk, narrow }: SectionProps) {
  const nowYear = yearOfNow(desk.now);
  const pieces = useMemo(
    () => desk.collection.map(l => pieceOf(l, desk.metaFor(l.id), desk.ledger.get(l.id))),
    [desk.collection, desk.metaFor, desk.ledger],
  );
  const wantIds = useMemo(
    () => Array.from(new Set(pieces.map(p => p.entityId).filter((id): id is string => indexableEntity(id)))),
    [pieces],
  );

  // the entity buckets, one read each (deadline: a bucket that never answers reads as absent, never a wait)
  const [ents, setEnts] = useState<Map<string, EntityRead | null>>(() => new Map());
  const missing = wantIds.filter(id => !ents.has(id)).join(',');
  useEffect(() => {
    if (!missing) return;
    let live = true;
    const ids = missing.split(',');
    Promise.all(ids.map(async id => {
      const [detail, summary] = await Promise.all([
        withTimeout(loadEntityDetail(id, desk.lastCrawl ?? undefined), READ_DEADLINE_MS, null).catch(() => null),
        withTimeout(loadEntitySummary(id), READ_DEADLINE_MS, null).catch(() => null),
      ]);
      return [id, detail || summary ? { detail, summary } : null] as const;
    })).then(rows => {
      if (!live) return;
      setEnts(prev => { const m = new Map(prev); for (const [id, e] of rows) m.set(id, e); return m; });
    });
    return () => { live = false; };
  }, [missing, desk.lastCrawl]);
  const pending = wantIds.some(id => !ents.has(id));

  const rows = useMemo<PieceRow[]>(() => pieces
    .map(p => pieceRow(p, indexableEntity(p.entityId) ? ents.get(p.entityId!) : null, nowYear))
    .sort((a, b) => (b.mark?.value ?? b.piece.appraisal?.allIn ?? b.piece.bought?.usd ?? 0) - (a.mark?.value ?? a.piece.appraisal?.allIn ?? a.piece.bought?.usd ?? 0)),
  [pieces, ents, nowYear]);
  const index = useMemo(() => collectionIndex(pieces, ents, nowYear), [pieces, ents, nowYear]);
  const totals = useMemo(() => totalsOf(pieces), [pieces]);

  const drawn = index.points.filter(p => p.value != null);
  const chart: { anchor: HeroLine; periods: string[] } | null = drawn.length >= 2 ? {
    anchor: {
      key: 'index', label: 'Your pieces, index-marked', color: 'var(--color-fg)', unit: 'money',
      points: drawn.map(p => ({ period: p.label, value: p.value!, n: p.n })),
    },
    periods: index.points.map(p => p.label),
  } : null;
  const gaps = index.points.length - drawn.length;
  const latest = index.latest;
  const latestVsBought = latest ? pctOf(latest.value, index.bought) : null;
  const excludedNote = noIndexNote(index.excluded, pending);

  const onCsv = useCallback(() => downloadCsv(portfolioCsv(rows), csvFilename(desk.now)), [rows, desk.now]);
  // the archive is still resolving the settled saves: a CSV now would miss pieces, so the button waits
  const resolving = !desk.fullLoaded && !desk.fullError;

  /* ── nothing held yet: one quiet line (the page folds the room) ── */
  if (!pieces.length) {
    const owned = desk.ownedIds.size;
    return (
      <section id="portfolio" className="pf ray-saved-section rail ray-enter" aria-label="Portfolio">
        <div className="ns-plate pf-plate">
          <RoomHead mark={<CollectionMark size={17} />} title="Portfolio" />
          <p className="pf-ghost">
            {owned > 0 && !desk.fullLoaded && !desk.fullError
              ? <>Resolving your {owned} {owned === 1 ? 'piece' : 'pieces'} against the archive…</>
              : owned > 0
                ? <>Your {owned} {owned === 1 ? 'piece is' : 'pieces are'} not in the archive this desk could load — nothing to re-mark yet.</>
                : <>Mark a settled win <b style={{ color: 'var(--color-fg)' }}>I won it</b> and it joins here — re-marked year by year at its maker&rsquo;s own medians, beside the engine&rsquo;s appraisal and what a sale would leave you.</>}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="portfolio" className="pf ray-saved-section rail ray-enter" aria-label="Portfolio">
      <div className="ns-plate pf-plate">
        <RoomHead mark={<CollectionMark size={17} />} title="Portfolio"
          help={{ name: 'Portfolio', body: <>
            Your collection re-marked over time. <b>Bought</b> is what you recorded you paid, else the realized price (labelled).
            <b> Marked now</b> moves each piece from what you paid by its maker&rsquo;s <i>yearly median</i> — the median of what sold
            that year, relative to the year you bought — read from the maker&rsquo;s record (a year needs five or more sales; a
            year without them is a gap, never a bridge). It is a market level, not an appraisal of your piece.
            <b> Appraisal</b> is the engine&rsquo;s one call on the lot (its expected all-in, n comps beside it) and exists only
            while the engine priced it; a settled piece whose row carries no engine value has none here — nothing is
            re-appraised on this page. <b>If sold now</b> is the engine&rsquo;s expected hammer less the house tier&rsquo;s assumed
            seller&rsquo;s commission (the note under the ledger). <b>Record</b> is the maker&rsquo;s top sale on file. <b>YoY</b> is the
            maker&rsquo;s year-over-year read exactly as /makers prints it (same items both years when it can, its n and 90% interval
            on hover). <b>Timing</b> sets the maker&rsquo;s 12-month median against its last {TIMING_YEARS} complete years, each with
            five or more sales. The CSV holds every column with its basis; it is built on this device.
          </> }}
          sub={<>
            {totals.pieces} {totals.pieces === 1 ? 'piece' : 'pieces'}
            {totals.boughtN > 0 && <> · bought {fmtFace(totals.bought)}{totals.paidN < totals.boughtN ? (totals.paidN ? ` (${totals.paidN} at your figure)` : ' at the realized price') : ''}</>}
            {latest && <> · marked {fmtFace(latest.value!)} {latest.partial ? `${latest.year} so far` : `in ${latest.year}`} across {index.included.length} indexed</>}
            {resolving ? <> · resolving your pieces against the archive…</> : pending ? <> · reading the makers&rsquo; record…</> : null}
          </>}
          actions={<div className="pf-actions">
            <button type="button" className="ray-toolbar-pill" onClick={onCsv} disabled={resolving || pending}
              title={resolving ? 'Waits for the archive to resolve every piece' : pending ? 'Waits for the makers’ record' : 'Every column with its basis — built on this device'}
              aria-label="Export your portfolio as CSV">Export CSV</button>
          </div>} />

        {/* the provenance ledger — gray label over black value, dotted closing rule */}
        <div className="ns-byline pf-byline">
          <div><div className="k">Pieces</div><div className="v">{totals.pieces}</div></div>
          {totals.boughtN > 0 && (
            <div>
              <div className="k">Bought{totals.paidN === 0 ? ' · at the realized price' : totals.paidN < totals.boughtN ? ` · ${totals.paidN} of ${totals.boughtN} your figure` : ''}</div>
              <div className="v">{fmtFace(totals.bought)}</div>
            </div>
          )}
          <div>
            <div className="k">Marked now{latest ? ` · ${index.included.length} of ${totals.pieces} indexed` : ''}</div>
            <div className="v">
              {latest ? <>{fmtFace(latest.value!)}{latestVsBought != null && latestVsBought !== 0 && <span className="pf-delta" data-dir={dirOf(latestVsBought)} style={{ marginLeft: 6, fontSize: 12, fontWeight: 600 }}>{signed(latestVsBought)}</span>}</>
                : <span className="pf-cell-empty" title={pending ? 'reading the makers’ record' : 'no piece carries an index'}>—</span>}
            </div>
          </div>
          <div>
            <div className="k">Engine appraisal{totals.appraisedN > 0 && totals.appraisedN < totals.pieces ? ` · ${totals.appraisedN} of ${totals.pieces}` : ''}</div>
            <div className="v">{totals.appraisedN > 0 ? fmtFace(totals.appraised) : <span className="pf-cell-empty" title="the engine prices lots on the block; none of your pieces carries its value stamp">—</span>}</div>
          </div>
          <div>
            <div className="k">If sold now{totals.soldNowN > 0 && totals.soldNowN < totals.pieces ? ` · ${totals.soldNowN} of ${totals.pieces}` : ''}</div>
            <div className="v">{totals.soldNowN > 0 ? fmtFace(totals.soldNow) : <span className="pf-cell-empty" title="needs an engine appraisal">—</span>}</div>
          </div>
        </div>

        {chart ? (
          <div className="pf-chart">
            <div className="kicker">
              Your pieces over time · joined at what you paid, re-marked at the makers&rsquo; yearly medians · {index.included.length} of {totals.pieces} indexed
            </div>
            <HeroChart anchor={chart.anchor} periods={chart.periods} height={narrow ? 130 : 160} compact play={false} />
          </div>
        ) : null}
        <p className="pf-note">
          {chart
            ? <>One line, {drawn.length} {drawn.length === 1 ? 'year' : 'years'}: each indexed piece joins in the year you bought it at what you paid, then moves as its maker&rsquo;s yearly median moved against that year (a year needs five or more sales).{gaps > 0 ? ` ${gaps} ${gaps === 1 ? 'year is' : 'years are'} left as a gap — a maker under five sales that year.` : ''}{index.points.some(p => p.partial && p.value != null) ? ` ${nowYear} is the year so far.` : ''} A level that moves with what came up for sale — not an appraisal of your pieces.</>
            : index.included.length
              ? <>Too few years to draw: your indexed {index.included.length === 1 ? 'piece joins' : 'pieces join'} in {index.points[0]?.year}; the line needs two marked years.</>
              : pending ? <>Reading the makers&rsquo; yearly record…</> : <>No piece carries an index yet.</>}
          {excludedNote && <> <b>{excludedNote}.</b></>}
        </p>

        {/* the ledger */}
        <div className="kicker pf-head">
          <div>Piece</div>
          <div className="pf-cell">Bought</div>
          <div className="pf-cell">Marked now</div>
          <div className="pf-cell">Appraisal</div>
          <div className="pf-cell">If sold now</div>
        </div>
        <div className="pf-rows">
          {rows.map(r => <Row key={r.piece.id} r={r} nowYear={nowYear} />)}
        </div>

        <p className="pf-note">
          <b>If sold now:</b> {COMMISSION_NOTE} <b>Appraisal</b> is the engine&rsquo;s expected all-in on the lot (its comps median blended, n beside it) — our read from the data, not a formal appraisal; it exists only for lots the engine priced.
        </p>
      </div>
    </section>
  );
}

function Row({ r, nowYear }: { r: PieceRow; nowYear: number }) {
  const { piece } = r;
  const lot = piece.lot;
  const maker = makerLineOf(lot).name;
  const day = lot.saleDate || piece.bought?.day || '';
  const markVsBought = r.mark && piece.bought ? pctOf(r.mark.value, piece.bought.usd) : null;
  const apprVsBought = piece.appraisal && piece.bought ? pctOf(piece.appraisal.allIn, piece.bought.usd) : null;
  const reading = r.ent === undefined && indexableEntity(piece.entityId);
  return (
    <div className="ns-ledger-row pf-row" data-nav-row>
      <div className="pf-main">
        <div className="pf-title">
          <Link href={`/lot?id=${encodeURIComponent(lot.id)}`}>{craftTitle(lot.title, lot.auctionHouse)}</Link>
        </div>
        <div className="pf-meta">
          <span>{[maker, lot.auctionHouse, day ? formatDate(day) : ''].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="pf-reads">
          {reading ? <span>reading {maker}&rsquo;s record…</span> : (
            <>
              {r.record ? (
                <span title={`${maker}’s top sale on file${r.record.title ? `: ${r.record.title}` : ''}`}>
                  Record <span className="num">{fmtFace(r.record.usd)}</span>{r.record.house ? ` · ${r.record.house}` : ''}{r.record.day ? ` · ${r.record.day.slice(0, 4)}` : ''}
                  {r.record.yours && <> <span className="ray-coll-chip">your piece</span></>}
                </span>
              ) : indexableEntity(piece.entityId) ? <span title="no sale on file for this maker">Record —</span> : <span title="no reader names a maker for this piece">No named maker</span>}
              {r.trend
                ? <span title={r.trend.title}>YoY <span className="num" data-dir={r.trend.dir}>{r.trend.text}</span> · {r.trend.basis}</span>
                : indexableEntity(piece.entityId) ? <span title="No year-over-year read: too few of the same items sold in both years, or the read is too uncertain to call">YoY —</span> : null}
              {r.timing
                ? <span title={r.timing.title}>{r.timing.text}</span>
                : indexableEntity(piece.entityId) && r.ent ? <span title={`Timing needs a 12-month median with five or more sales and at least three of the last ${TIMING_YEARS} complete years with five or more`}>Timing —</span> : null}
            </>
          )}
        </div>
      </div>

      <div className="pf-cell" title={piece.bought ? (piece.bought.basis === 'paid' ? 'Your recorded cost basis' : 'Realized price — set what you paid in the Collection room to override') : 'No price on file'}>
        <span className="pf-cell-k kicker">Bought</span>
        <div className="pf-cell-v">{piece.bought ? fmtFace(piece.bought.usd) : <span className="pf-cell-empty">—</span>}</div>
        <div className="pf-cell-s">{piece.bought ? (piece.bought.basis === 'paid' ? 'your figure' : 'realized') : 'no price'}{piece.bought?.year ? ` · ${piece.bought.year}` : ''}</div>
      </div>

      <div className="pf-cell">
        <span className="pf-cell-k kicker">Marked now</span>
        {r.mark ? (
          <>
            <div className="pf-cell-v">{fmtFace(r.mark.value)}{markVsBought != null && markVsBought !== 0 && <span className="pf-delta" data-dir={dirOf(markVsBought)}>{signed(markVsBought)}</span>}</div>
            <div className="pf-cell-s" title={`${maker}’s yearly median ${r.mark.year}${r.mark.partial ? ' so far' : ''}, relative to ${piece.bought?.year} · n ${r.mark.n.toLocaleString()}`}>
              {r.mark.year === nowYear ? `${r.mark.year} so far` : r.mark.year} · n {r.mark.n.toLocaleString()}
            </div>
          </>
        ) : (
          <>
            <div className="pf-cell-v"><span className="pf-cell-empty">—</span></div>
            <div className="pf-cell-s">{reading ? 'reading…' : `no index · ${r.noIndex ?? ''}`}</div>
          </>
        )}
      </div>

      <div className="pf-cell">
        <span className="pf-cell-k kicker">Appraisal</span>
        {piece.appraisal ? (
          <>
            <div className="pf-cell-v">{fmtFace(piece.appraisal.allIn)}{apprVsBought != null && apprVsBought !== 0 && <span className="pf-delta" data-dir={dirOf(apprVsBought)}>{signed(apprVsBought)}</span>}</div>
            <div className="pf-cell-s">{piece.appraisal.compN} comps · {piece.appraisal.confidence}</div>
          </>
        ) : (
          <>
            <div className="pf-cell-v"><span className="pf-cell-empty">—</span></div>
            <div className="pf-cell-s" title="The engine prices lots on the block; this row carries no engine value, and nothing is re-appraised here">not on the block</div>
          </>
        )}
      </div>

      <div className="pf-cell">
        <span className="pf-cell-k kicker">If sold now</span>
        {piece.soldNow ? (
          <>
            <div className="pf-cell-v">{fmtFace(piece.soldNow.net)}</div>
            <div className="pf-cell-s" title={`${fmtFace(piece.appraisal!.hammer)} expected hammer less ${Math.round(piece.soldNow.rate * 100)}% assumed seller’s commission (${TIER_LABEL[piece.soldNow.tier]})`}>
              after {Math.round(piece.soldNow.rate * 100)}% at {piece.soldNow.house}
            </div>
          </>
        ) : (
          <>
            <div className="pf-cell-v"><span className="pf-cell-empty">—</span></div>
            <div className="pf-cell-s">needs an appraisal</div>
          </>
        )}
      </div>
    </div>
  );
}
