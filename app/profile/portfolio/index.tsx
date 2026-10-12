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
 * with its n or its basis, and gaps stay gaps (./portfolio.ts has the law —
 * including THE COLLECTION HEADLINE LAW the byline and the Collection room
 * share).
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
import { CollectionMark } from '../../components/marks';
import { craftTitle, formatDate } from '../../utils';
import { makerLineOf } from '../../lib/lot-labels';
import { fmtFace } from '../../lib/lot-face';
import { COMMISSION_NOTE, TIER_LABEL } from './commission';
import {
  collectionIndex, growthOf, headlineOf, indexableEntity, levelKindOf, noIndexNote, pieceOf, pieceRow, totalsOf, yearOfNow,
  FOLD_N, SETTLED_MONTHS, TIMING_YEARS, type EntityRead, type PieceRow,
} from './portfolio';
import PortfolioChart from './PortfolioChart';
import { csvFilename, downloadCsv, portfolioCsv } from './csv';
import './portfolio.css';

export function meta(desk: DeskData): SectionMeta {
  const n = desk.collection.length;
  return { id: 'portfolio', label: 'Portfolio', count: n || null, quiet: n === 0 };
}

const dirOf = (delta: number | null): 'up' | 'down' | undefined => (delta == null || delta === 0 ? undefined : delta > 0 ? 'up' : 'down');

export default function Portfolio({ desk, narrow }: SectionProps) {
  const nowYear = yearOfNow(desk.now);
  const pieces = useMemo(
    () => desk.collection.map(l => pieceOf(l, desk.metaFor(l.id), desk.ledger.get(l.id), desk.follows)),
    [desk.collection, desk.metaFor, desk.ledger, desk.follows],
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
    .map(p => pieceRow(p, indexableEntity(p.entityId) ? ents.get(p.entityId) : null, nowYear))
    .sort((a, b) => (b.mark?.value ?? b.piece.appraisal?.allIn ?? b.piece.bought?.usd ?? 0) - (a.mark?.value ?? a.piece.appraisal?.allIn ?? a.piece.bought?.usd ?? 0)),
  [pieces, ents, nowYear]);
  const index = useMemo(() => collectionIndex(pieces, ents, nowYear), [pieces, ents, nowYear]);
  const totals = useMemo(() => totalsOf(pieces), [pieces]);
  const head = useMemo(() => headlineOf(totals, index, nowYear, pending), [totals, index, nowYear, pending]);

  const drawn = index.points.filter(p => p.value != null);
  const chart = drawn.length >= 2;
  const gaps = index.points.length - drawn.length;
  const latest = index.latest;
  const excludedNote = noIndexNote(index.excluded, pending);

  // a phone opens on FOLD_N pieces; the totals and the line stay whole (R2)
  const [all, setAll] = useState(false);
  const folded = narrow && !all && rows.length > FOLD_N;
  const visible = folded ? rows.slice(0, FOLD_N) : rows;

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
                : <>Mark a settled win <b style={{ color: 'var(--color-fg)' }}>I won it</b> and it joins here — re-marked year by year at its maker&rsquo;s own medians, beside the engine&rsquo;s read and what a sale would leave you.</>}
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
            year without them is a gap, never a bridge). It is a market level, not an appraisal of your piece; under a player
            or a subject (a card, a Pokémon) that level is <b>mix-driven</b> — whatever sold under the name that year — and
            the row says so. The line draws it against the grey <b>paid</b> step (what the pieces cost, summed): pieces join at
            cost, so only where the two part has anything moved.
            <b> Engine read</b> is the engine&rsquo;s one call on the lot (its expected all-in, n comps and the day it was read beside it).
            The engine prices lots on the block nightly and, since October 2026, your settled pieces sold within {SETTLED_MONTHS} months —
            each stamped <i>as of</i> the night it was read; a row the engine read and declined says why; nothing is
            re-appraised on this page. <b>If sold now</b> is the engine&rsquo;s expected hammer less the house tier&rsquo;s assumed
            seller&rsquo;s commission (the note under the ledger). <b>Record</b> is the maker&rsquo;s top sale on file. Each row carries
            one growth figure: the mark against what you paid, or — with no mark — the maker&rsquo;s year-over-year read as /makers prints it
            (the other sits in the hover and the CSV). <b>Timing</b> sets the maker&rsquo;s 12-month median against its last {TIMING_YEARS} complete years, each with
            five or more sales. The CSV holds every column with its basis; it is built on this device.
          </> }}
          sub={<>
            {totals.pieces} {totals.pieces === 1 ? 'piece' : 'pieces'}
            {head.bought && <> · bought {head.bought.v}{totals.paidN < totals.boughtN ? (totals.paidN ? ` (${totals.paidN} at your figure)` : ' at the realized price') : ''}</>}
            {latest && <> · marked {fmtFace(latest.value!)} {latest.partial ? `${latest.year} so far` : `in ${latest.year}`} across {index.included.length} indexed</>}
            {resolving ? <> · resolving your pieces against the archive…</> : pending ? <> · reading the makers&rsquo; record…</> : null}
          </>}
          actions={<div className="pf-actions">
            <button type="button" className="ray-toolbar-pill" onClick={onCsv} disabled={resolving || pending}
              title={resolving ? 'Waits for the archive to resolve every piece' : pending ? 'Waits for the makers’ record' : 'Every column with its basis — built on this device'}
              aria-label="Export your portfolio as CSV">Export CSV</button>
          </div>} />

        {/* the provenance ledger — gray label over black value, dotted closing rule (THE HEADLINE LAW, portfolio.ts) */}
        <div className="ns-byline pf-byline">
          <div><div className="k">Pieces</div><div className="v">{head.pieces}</div></div>
          {head.bought && <div><div className="k">{head.bought.k}</div><div className="v">{head.bought.v}</div></div>}
          <div>
            <div className="k">{head.marked.k}</div>
            <div className="v">
              {head.marked.v
                ? <>{head.marked.v}{head.marked.deltaPct != null && head.marked.deltaPct !== 0 && <span className="pf-delta" data-dir={dirOf(head.marked.deltaPct)}>{head.marked.delta!.split(' vs ')[0]}</span>}
                    {head.marked.delta && <span className="pf-sub">vs {head.marked.delta.split(' vs ')[1]}</span>}</>
                : <><span className="pf-cell-empty">—</span><span className="pf-sub">{head.marked.empty}</span></>}
            </div>
          </div>
          <div>
            <div className="k">{head.engine.k}</div>
            <div className="v">
              {head.engine.v
                ? <>{head.engine.v}{head.engine.deltaPct != null && head.engine.deltaPct !== 0 && <span className="pf-delta" data-dir={dirOf(head.engine.deltaPct)} title={head.engine.delta ?? undefined}>{head.engine.delta!.split(' vs ')[0]}</span>}
                    {head.engine.sub && <span className="pf-sub">{head.engine.sub}</span>}</>
                : <><span className="pf-cell-empty">—</span><span className="pf-sub">{head.engine.empty}</span></>}
            </div>
          </div>
        </div>

        {chart ? (
          <div className="pf-chart">
            <div className="kicker">
              <span className="pf-leg" data-k="marked"><i aria-hidden /> Marked</span>
              <span className="pf-leg" data-k="paid"><i aria-hidden /> Paid</span>
              <span>{index.included.length} of {totals.pieces} indexed · yearly, {index.points[0]?.year}–{nowYear}</span>
            </div>
            <PortfolioChart points={index.points} height={narrow ? 150 : 180} compact={narrow} />
          </div>
        ) : null}
        <p className="pf-note">
          {chart
            ? <>Two lines, {drawn.length} marked {drawn.length === 1 ? 'year' : 'years'}: <b>paid</b> steps up as each indexed piece joins at what you paid; <b>marked</b> moves it by its maker&rsquo;s yearly median against that year (a year needs five or more sales). Where they part is the movement — the rest is pieces joining.{gaps > 0 ? ` ${gaps} ${gaps === 1 ? 'year is' : 'years are'} left as a gap — a maker under five sales that year.` : ''}{index.points.some(p => p.partial && p.value != null) ? ` ${nowYear} is the year so far.` : ''} A level that moves with what came up for sale — not an appraisal of your pieces.</>
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
          <div className="pf-cell pf-cell-wide">Engine read</div>
        </div>
        <div className="pf-rows">
          {visible.map(r => <Row key={r.piece.id} r={r} nowYear={nowYear} />)}
        </div>
        {narrow && rows.length > FOLD_N && (
          <div className="pf-more">
            <button type="button" className="ray-show-more" onClick={() => setAll(a => !a)} aria-expanded={!folded}>
              {folded ? `Show all ${rows.length}` : 'Show fewer'}
            </button>
          </div>
        )}

        <p className="pf-note">
          <b>Engine read</b> is the engine&rsquo;s expected all-in on the lot (its comps median blended, n beside it) — our read from the data, not a formal appraisal; a settled piece carries the night it was read (<i>as of</i>), a live one is read nightly. <b>If sold now:</b> {COMMISSION_NOTE}
        </p>
      </div>
    </section>
  );
}

function Row({ r, nowYear }: { r: PieceRow; nowYear: number }) {
  const { piece } = r;
  const lot = piece.lot;
  const maker = makerLineOf(lot).name || (piece.entityDerived ? (lot as { playerName?: string | null }).playerName ?? '' : '');
  const day = lot.saleDate || piece.bought?.day || '';
  const growth = growthOf(r);
  const level = levelKindOf(piece.entityId);
  const reading = r.ent === undefined && indexableEntity(piece.entityId);
  const e = r.engine;
  return (
    <div className="ns-ledger-row pf-row" data-nav-row>
      <div className="pf-main">
        <div className="pf-title">
          <Link href={`/lot?id=${encodeURIComponent(lot.id)}`}>{craftTitle(lot.title, lot.auctionHouse)}</Link>
        </div>
        <div className="pf-meta">
          <span>{[maker, (lot.auctionHouse as string) === 'archive' ? 'archive record' : lot.auctionHouse, day ? formatDate(day) : ''].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="pf-reads">
          {reading ? <span>reading {maker || 'the maker'}&rsquo;s record…</span> : (
            <>
              {r.record ? (
                <span title={`${maker}’s top sale on file${r.record.title ? `: ${r.record.title}` : ''}`}>
                  Record <span className="num">{fmtFace(r.record.usd)}</span>{r.record.house ? ` · ${r.record.house}` : ''}{r.record.day ? ` · ${r.record.day.slice(0, 4)}` : ''}
                  {r.record.yours && <> <span className="ray-coll-chip">your piece</span></>}
                </span>
              ) : indexableEntity(piece.entityId) ? <span title="no sale on file for this maker">Record —</span> : <span title="no reader names a maker or a player for this piece — the row carries no index">No named maker</span>}
              {growth?.source === 'yoy'
                ? <span title={growth.title}>YoY <span className="num" data-dir={growth.dir}>{growth.text}</span> · {r.trend!.basis}</span>
                : !growth && indexableEntity(piece.entityId) ? <span title="No year-over-year read: too few of the same items sold in both years, or the read is too uncertain to call">YoY —</span> : null}
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
            <div className="pf-cell-v" title={growth?.source === 'mark' ? growth.title : undefined}>
              {fmtFace(r.mark.value)}
              {growth?.source === 'mark' && growth.pct !== 0 && <span className="pf-delta" data-dir={growth.dir}>{growth.text}</span>}
            </div>
            <div className="pf-cell-s" title={`${maker}’s yearly median ${r.mark.year}${r.mark.partial ? ' so far' : ''}, relative to ${piece.bought?.year} · n ${r.mark.n.toLocaleString()}${level === 'mix' ? ' · a mix of whatever sold under the name that year, not this object' : ''}`}>
              {growth?.source === 'mark' && growth.pct !== 0 ? `${growth.basis} · ` : ''}{r.mark.year === nowYear ? `${r.mark.year} so far` : r.mark.year} · n {r.mark.n.toLocaleString()}{level === 'mix' ? ' · mix-driven' : ''}
            </div>
          </>
        ) : (
          <>
            <div className="pf-cell-v"><span className="pf-cell-empty">—</span></div>
            <div className="pf-cell-s">{reading ? 'reading…' : `no index · ${r.noIndex ?? ''}`}</div>
          </>
        )}
      </div>

      <div className="pf-cell pf-cell-wide">
        <span className="pf-cell-k kicker">Engine read</span>
        {e.kind === 'value' ? (
          <>
            <div className="pf-cell-v" title={`The engine’s expected all-in on this lot${e.asOfText ? `, ${e.asOfText}` : ', read nightly while it is on the block'} · ${e.appraisal.compN} comps · ${e.appraisal.confidence} confidence`}>{fmtFace(e.appraisal.allIn)}</div>
            <div className="pf-cell-s">{e.asOfText ?? 'live · read nightly'} · {e.appraisal.compN} comps · {e.appraisal.confidence}</div>
            {e.soldNow && (
              <div className="pf-cell-s" title={`${fmtFace(e.appraisal.hammer)} expected hammer less ${Math.round(e.soldNow.rate * 100)}% assumed seller’s commission (${TIER_LABEL[e.soldNow.tier]})`}>
                {fmtFace(e.soldNow.net)} if sold now · after {Math.round(e.soldNow.rate * 100)}% at {e.soldNow.house}
              </div>
            )}
          </>
        ) : e.kind === 'abstain' ? (
          <>
            <div className="pf-cell-v"><span className="pf-cell-empty">—</span></div>
            <div className="pf-cell-s" title={`The engine read this row and declined: ${e.code}`}>engine declined · {e.why}</div>
          </>
        ) : (
          <>
            <div className="pf-cell-v"><span className="pf-cell-empty">—</span></div>
            <div className="pf-cell-s" title={e.why}>{e.live ? 'on the block · no value tonight' : `not read yet · fills when the nightly values it (sold within ${SETTLED_MONTHS} months)`}</div>
          </>
        )}
      </div>
    </div>
  );
}
