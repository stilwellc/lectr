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
 *
 * (THE DESK v4, Oct 29 2026) the ledger's row is the desk's one row
 * (../desk/row DeskRow): Marked now is the figure with the row's one growth
 * figure beside it in the lamp's ink (the mark against what you paid), its
 * basis under; bought, the engine read (with if-sold-now) and the maker's
 * reads (record · YoY · timing) ride the meta lines. The shelf stays.
 */
import { SigPill } from '../desk/thumb';
import PlateImg from '../../components/PlateImg';
import { DeskRow } from '../desk/row';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { DeskData, SectionMeta, SectionProps } from '../desk/types';
import { RoomHead } from '../head';
import { READ_DEADLINE_MS, withTimeout } from '../stall';
import { loadEntityDetail, loadEntitySummary } from '../../hooks/useEntities';
import { CollectionMark } from '../../components/marks';
import { craftTitle, formatDate, httpsImg, sizedImg } from '../../utils';
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

const VIEW_KEY = 'lectr-portfolio-view';
export default function Portfolio({ desk, narrow }: SectionProps) {
  const nowYear = yearOfNow(desk.now);
  // the shelf leads (your pieces as photos); the ledger is one tap — remembered on the device
  // the shelf leads only when most pieces carry a photo — a grid of monograms reads worse than the ledger
  const photoShare = desk.collection.length ? desk.collection.filter(l => !!l.imageUrl).length / desk.collection.length : 0;
  const [chosen, setChosen] = useState<'shelf' | 'ledger' | null>(() => {
    try { const v = typeof window !== 'undefined' ? window.localStorage.getItem(VIEW_KEY) : null; return v === 'ledger' || v === 'shelf' ? v : null; } catch { return null; }
  });
  const view: 'shelf' | 'ledger' = chosen ?? (photoShare >= 0.5 ? 'shelf' : 'ledger');
  const setView = setChosen;
  const pickView = (v: 'shelf' | 'ledger') => { setView(v); try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };
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
          // the figure cells below print pieces / bought / marked — the sub-line
          // keeps only what they don't say: the basis caveat and the reading state
          sub={<>
            {totals.paidN < totals.boughtN ? (totals.paidN ? `${totals.paidN} of ${totals.boughtN} at your figure, the rest at the realized price` : 'bought at the realized price') : 'bought at your figures'}
            {latest && <> · marked across {index.included.length} indexed</>}
            {resolving ? <> · resolving your pieces against the archive…</> : pending ? <> · reading the makers&rsquo; record…</> : null}
          </>}
          actions={<div className="pf-actions">
            <span className="pf-viewpick" role="group" aria-label="Portfolio view">
              <button type="button" className="ray-toolbar-pill" aria-pressed={view === 'shelf'} data-active={view === 'shelf'} onClick={() => pickView('shelf')}>Shelf</button>
              <button type="button" className="ray-toolbar-pill" aria-pressed={view === 'ledger'} data-active={view === 'ledger'} onClick={() => pickView('ledger')}>Ledger</button>
            </span>
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

        {/* THE SHELF (Oct 20 audit) — your pieces as a photo grid, an
            Instagram profile's grid; the corner pill is the piece's move (the
            same growth figure the ledger prints). Tap → the lot. */}
        {view === 'shelf' && (
          <div className="pf-shelf" role="group" aria-label="Your pieces">
            {rows.map(r => {
              const g = growthOf(r);
              const lot = r.piece.lot;
              const src = lot.imageUrl ? sizedImg(httpsImg(lot.imageUrl), 480) : undefined;
              const who = makerLineOf(lot).name || lot.title;
              return (
                <Link key={r.piece.id} href={`/lot?id=${encodeURIComponent(lot.id)}`} className="pf-tile" aria-label={`${craftTitle(lot.title, lot.auctionHouse)}${g && g.pct !== 0 ? `, ${g.text} ${g.basis}` : ''}`}>
                  <span className="pf-tile-ph" aria-hidden="true">
                    <span className="pf-tile-l">{(who.match(/[A-Za-zÀ-ÿ]/)?.[0] ?? '·').toUpperCase()}</span>
                    <PlateImg src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                  </span>
                  {g && g.pct !== 0 && <span className="pf-tile-pill"><SigPill dir={g.dir === 'up' ? 'up' : 'down'}>{g.text}</SigPill></span>}
                  <span className="pf-tile-t">{craftTitle(lot.title, lot.auctionHouse)}</span>
                  <span className="pf-tile-s">{r.piece.bought ? fmtFace(r.piece.bought.usd) : '—'}{who !== lot.title ? ` · ${who}` : ''}</span>
                </Link>
              );
            })}
          </div>
        )}

        {/* the ledger */}
        {view === 'ledger' && (
          <div className="dk-list pf-rows">
            {visible.map(r => <Row key={r.piece.id} r={r} nowYear={nowYear} />)}
          </div>
        )}
        {view === 'ledger' && narrow && rows.length > FOLD_N && (
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
  const indexable = indexableEntity(piece.entityId);
  // the figure: Marked now — "= bought" the year it was bought (the index
  // starts at the price paid; printing "$40K / $40K" read as a circular claim)
  const bought = piece.bought;
  const sameAsBought = !!(r.mark && bought && r.mark.year === bought.year && Math.round(r.mark.value) === Math.round(bought.usd));
  const figure = sameAsBought ? <span data-quiet>= bought</span>
    : r.mark ? <span title={growth?.source === 'mark' ? growth.title : undefined}>{fmtFace(r.mark.value)}{growth?.source === 'mark' && growth.pct !== 0 && <span className="dk-delta" data-dir={growth.dir}>{growth.text}</span>}</span>
    : <span data-quiet>—</span>;
  const figureSub = sameAsBought && bought?.year != null
    ? <span title={`${maker}’s yearly index starts at your ${bought.year} price; it re-marks from ${bought.year + 1}`}>re-marks from {bought.year + 1}</span>
    : r.mark
      ? <span title={`${maker}’s yearly median ${r.mark.year}${r.mark.partial ? ' so far' : ''}, relative to ${piece.bought?.year} · n ${r.mark.n.toLocaleString()}${level === 'mix' ? ' · a mix of whatever sold under the name that year, not this object' : ''}`}>
          {growth?.source === 'mark' && growth.pct !== 0 ? `${growth.basis} · ` : ''}{r.mark.year === nowYear ? `${r.mark.year} so far` : r.mark.year} · n {r.mark.n.toLocaleString()}{level === 'mix' ? ' · the name’s market' : ''}
        </span>
      : reading ? 'reading…' : `no index · ${r.noIndex ?? ''}`;
  return (
    <DeskRow lot={lot} who={maker || lot.title}
      sub={[maker, (lot.auctionHouse as string) === 'archive' ? 'archive record' : lot.auctionHouse, day ? formatDate(day) : ''].filter(Boolean).join(' · ')}
      figure={figure} figureSub={figureSub}
      meta={<>
        {/* bought · the engine read (its if-sold-now) · the maker's reads */}
        <span className="dk-meta-fact" title={piece.bought ? (piece.bought.basis === 'paid' ? 'Your recorded cost basis' : 'Realized price — set what you paid in the Collection room to override') : 'No price on file'}>
          bought <b>{piece.bought ? fmtFace(piece.bought.usd) : '—'}</b>{piece.bought ? ` · ${piece.bought.basis === 'paid' ? 'your figure' : 'realized'}` : ' · no price'}{piece.bought?.year ? ` · ${piece.bought.year}` : ''}
        </span>
        {e.kind === 'value' ? (
          <span className="dk-meta-fact" title={`The engine’s expected all-in on this lot${e.asOfText ? `, ${e.asOfText}` : ', read nightly while it is on the block'} · ${e.appraisal.compN} comps · ${e.appraisal.confidence} confidence`}>
            engine <b>{fmtFace(e.appraisal.allIn)}</b> · {e.asOfText ?? 'live · read nightly'} · {e.appraisal.compN} comps · {e.appraisal.confidence}
            {e.soldNow && <span title={`${fmtFace(e.appraisal.hammer)} expected hammer less ${Math.round(e.soldNow.rate * 100)}% assumed seller’s commission (${TIER_LABEL[e.soldNow.tier]})`}> · <b>{fmtFace(e.soldNow.net)}</b> if sold now, after {Math.round(e.soldNow.rate * 100)}% at {e.soldNow.house}</span>}
          </span>
        ) : e.kind === 'abstain' ? (
          <span className="dk-meta-fact" title={`The engine read this row and declined: ${e.code}`}>engine declined · {e.why}</span>
        ) : (
          <span className="dk-meta-fact" title={e.live ? e.why : `${e.why ? `${e.why} · ` : ''}fills when the nightly values it (sold within ${SETTLED_MONTHS} months)`}>{e.live ? 'engine · on the block, no value tonight' : 'engine · not read yet'}</span>
        )}
        {reading ? <span className="dk-meta-fact">reading {maker || 'the maker'}&rsquo;s record…</span> : (
          <>
            {r.record ? (
              <span className="dk-meta-fact" title={`${maker}’s top sale on file${r.record.title ? `: ${r.record.title}` : ''}`}>
                record <b>{fmtFace(r.record.usd)}</b>{r.record.house ? ` · ${r.record.house}` : ''}{r.record.day ? ` · ${r.record.day.slice(0, 4)}` : ''}
                {r.record.yours && <> <span className="ray-coll-chip">your piece</span></>}
              </span>
            ) : indexable ? <span className="dk-meta-fact" title="no sale on file for this maker">record —</span> : <span className="dk-meta-fact" title="no reader names a maker or a player for this piece — the row carries no index">no named maker</span>}
            {growth?.source === 'yoy'
              ? <span className="dk-meta-fact" title={growth.title}>YoY <b data-dir={growth.dir} className="dk-dir">{growth.text}</b> · {r.trend!.basis}</span>
              : !growth && indexable ? <span className="dk-meta-fact" title="No year-over-year read: too few of the same items sold in both years, or the read is too uncertain to call">YoY —</span> : null}
            {r.timing
              ? <span className="dk-meta-fact" title={r.timing.title}>{r.timing.text}</span>
              : indexable && r.ent ? <span className="dk-meta-fact" title={`Timing needs a 12-month median with five or more sales and at least three of the last ${TIMING_YEARS} complete years with five or more`}>timing —</span> : null}
          </>
        )}
      </>} />
  );
}
