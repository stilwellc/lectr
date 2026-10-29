'use client';
/**
 * YOUR COLLECTION — the certificate for what you own (lifted from page.tsx
 * unchanged): byline, the appraisal-vs-bought chart, where it trades, the
 * piece ledger with its cost-basis/note editor.
 *
 * (THE DESK v4, Oct 29 2026) a piece is the desk's one row (../row
 * DeskRow): the engine's mark is the figure, its measured delta vs bought
 * beside it in the lamp's ink, the mark's basis under; what you paid (your
 * basis or the realized price), the drill chip, your note and the editor's
 * tap ride the meta line; the editor opens under the row.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import HeroChart from '../../../preview/terminal/HeroChart';
import Flick from '../../../components/Flick';
import { CollectionMark } from '../../../components/marks';
import { closeDayOf, formatDate, craftTitle, fmtSignedPct } from '../../../utils';
import { fmtFace } from '../../../lib/lot-face';
import { closeDays, hammerWord } from '../derive';
import { makerLineOf, labelLineOf, drillLabelOf } from '../../../lib/lot-labels';
import { RoomHead } from '../../head';
import { useDeskInternals, type DeskInternals } from '../provider';
import type { SectionProps, SectionMeta, DeskData } from '../types';
import { Term } from './shared';
import { DeskRow } from '../row';

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

/** the room mounts with a piece held — or a save marked owned that is still
 *  on the block (the note says why it isn't a piece yet) */
export function when(_desk: DeskData, i: DeskInternals): boolean { return i.deskView && (i.collection.rows.length > 0 || i.collection.pendingOwned.length > 0); }
/** THE ONE COLLECTION FIGURE (R4#4, R1#4; Portfolio's wording agrees — "marked"):
 *  the rail and the Record cell print BOUGHT or MARKED, never cost carried
 *  forward under the word "appraisal": every piece appraised → the engine's
 *  mark; else the bought total when any piece has a price; else the count */
export function collectionFigure(c: DeskInternals['collection']): { text: string; kind: 'marked' | 'bought' | 'pieces' } {
  if (c.rows.length > 0 && c.appraisedN === c.rows.length) return { text: fmtFace(c.totalAppraised), kind: 'marked' };
  if (c.totalPaid > 0) return { text: fmtFace(c.totalPaid), kind: 'bought' };
  return { text: String(c.rows.length), kind: 'pieces' };
}
export function meta(_desk: DeskData, i: DeskInternals): SectionMeta | null {
  if (!when(_desk, i)) return null;
  const c = i.collection;
  return { id: 'collection', label: 'Collection', count: c.rows.length ? collectionFigure(c).text : c.pendingOwned.length };
}

export default function CollectionRoom(_p: SectionProps) {
  const i = useDeskInternals();
  const { collection, collectionChart, exposure, fullLoaded, fullError, fullSlow, setSavedFields } = i;
  // which collection piece has its cost-basis/note editor open
  const [editPiece, setEditPiece] = useState<string | null>(null);
  const [piecesOpen, setPiecesOpen] = useState(false);
  return (
    <div id="collection" className="ray-band ray-enter" style={{ marginTop: 30, paddingBlock: '28px 30px' }}>
      <section className="rail" aria-label="Your collection">
        <RoomHead mark={<CollectionMark size={17} />} title="Your collection"
          sub={<>{collection.rows.length} {collection.rows.length === 1 ? 'piece' : 'pieces'} held · {collection.appraisedN > 0 ? `${collection.appraisedN} of ${collection.rows.length} marked by the engine from comps` : 'none marked by the engine yet'}{collection.pendingOwned.length > 0 && <> · {collection.pendingOwned.length} marked owned, still on the block</>}</>} />
        {/* OWNED ∩ LIVE (R1#9): a lot marked owned before it hammers is not a
            piece yet — it stays in Watching and joins here when it sells; the
            mark is kept, nothing is deleted */}
        {collection.pendingOwned.length > 0 && (
          <ul className="ck-pending-owned" aria-label="Marked owned, still on the block">
            {collection.pendingOwned.map(l => (
              <li key={l.id}>
                <Link href={`/lot?id=${encodeURIComponent(l.id)}`} className="ck-away-link">{craftTitle(l.title, l.auctionHouse)}</Link>
                {' '}— marked owned, but it hasn&rsquo;t sold yet ({hammerWord(closeDays(l))}); it joins the collection when it hammers. Until then it stays under <a href="#watching" className="ck-away-link">Watching</a>.
              </li>
            ))}
          </ul>
        )}
        {/* the certificate's provenance ledger — gray label over black
            value, dotted closing rule; the signed delta keeps its ink */}
        {/* (Oct 20 round 6) Pieces and Bought print once, in Portfolio's head
            above (same caveat: "at the realized price"); this ledger keeps
            what only it says — the engine's mark and its coverage */}
        <div className="ns-byline" style={{ margin: '14px 0 2px' }}>
          <div>
            {/* (R4#4) the ENGINE's mark over the pieces it appraised — never the
                bought prices summed back under the word "appraisal"; the count
                says how many of the pieces it covers */}
            <div className="k">Marked by the engine{collection.appraisedN > 0 ? ` · ${collection.appraisedN} of ${collection.rows.length} ${collection.rows.length === 1 ? 'piece' : 'pieces'}` : ''}</div>
            <div className="v">{collection.appraisedN > 0 ? fmtFace(collection.totalAppraised) : <span title="none of your pieces has a comp pool yet">—</span>}</div>
          </div>
          {collection.deltaPct != null && collection.deltaPct !== 0 && collection.appraisedPaidN > 0 && (
            <div>
              <div className="k">Marked vs bought · {collection.appraisedPaidN} {collection.appraisedPaidN === 1 ? 'piece' : 'pieces'} with both</div>
              <div className="v" style={{ fontWeight: 600, color: collection.deltaPct > 0 ? 'var(--color-up)' : 'var(--color-down-text)' }}>
                {fmtSignedPct(collection.deltaPct)} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--paper-muted, var(--color-text-muted))' }}>{fmtFace(collection.appraisedPaid)} bought</span>
              </div>
            </div>
          )}
        </div>

        {collectionChart && (
          <div style={{ margin: '18px 0 8px' }}>
            <div className="kicker" style={{ marginBottom: 4, color: 'var(--paper-muted, var(--color-text-muted))' }}>
              Your collection over time · the engine&rsquo;s mark vs bought · daily snapshots
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
                    {n} {n === 1 ? 'piece' : 'pieces'} · {fmtFace(held)} held
                  </span>
                  <span style={{ width: 150, textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontFamily: read ? 'var(--font-mono), monospace' : undefined, color: read ? (read.dir === 'up' ? 'var(--color-up)' : read.dir === 'down' ? 'var(--color-down-text)' : 'var(--color-fg)') : 'var(--color-text-faint)' }}>
                    {read ? read.txt : `${row.lots.toLocaleString()} lots tracked`}
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        {/* (Oct 20) Portfolio, above, lists every piece; here the list folds to one
            line — one tap opens it with the edit tools (what you paid, your note) */}
        {!piecesOpen && collection.rows.length === 0 ? null : !piecesOpen ? (
          <p className="ck-head-sub" style={{ margin: '14px 0 0' }}>
            {collection.rows.length} {collection.rows.length === 1 ? 'piece is' : 'pieces are'} listed under Portfolio ·{' '}
            <button type="button" className="ck-deskdetails-btn" aria-expanded={false} onClick={() => setPiecesOpen(true)}>
              Show them here to edit what you paid and your notes
            </button>
          </p>
        ) : (
          <>
        {/* the one column head left: the figure's name, with its glossary term */}
        <div className="kicker ck-piece-head" style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '14px 2px 4px', color: 'var(--paper-muted, var(--color-text-muted))' }}>
          <div style={{ flex: 1 }}>Piece · bought</div>
          <div style={{ textAlign: 'right' }}><Term k="appraisal">Engine mark</Term> · vs bought</div>
        </div>
        <div className="dk-list ck-pieces">
          {collection.rows.map(({ lot, paid, paidIsOverride, note, savedId, appraised, basis, deltaPct, drill, drillSlug }) => (
            <DeskRow key={lot.id} lot={lot}
              sub={[makerLineOf(lot).name, labelLineOf(lot), lot.auctionHouse, closeDayOf(lot) ? formatDate(closeDayOf(lot)) : ''].filter(Boolean).join(' · ')}
              meta={<>
                <span className="dk-meta-fact" title={paidIsOverride ? 'Your recorded cost basis' : 'Realized price — set what you paid to override'}>
                  bought <b>{paid != null ? fmtFace(paid) : '—'}</b>{paidIsOverride ? ' · your basis' : ''}
                </span>
                {drill && drillSlug && (
                  <Link href={`/sub/${drillSlug.replace(':', '/')}`} className="ray-coll-chip">{drillLabelOf(drillSlug, drill.label)}</Link>
                )}
                <button type="button" className="ck-piece-editbtn"
                  aria-expanded={editPiece === lot.id}
                  aria-label={`Edit cost basis and note for ${craftTitle(lot.title, lot.auctionHouse)}`}
                  onClick={() => setEditPiece(p => (p === lot.id ? null : lot.id))}>
                  {paidIsOverride || note ? 'edit' : 'set what you paid'}
                </button>
                {note && <span className="ck-piece-note dk-note">{note}</span>}
              </>}
              figureKind="mark"
              figure={appraised != null
                ? <>{fmtFace(appraised)}{deltaPct != null && deltaPct !== 0 && <span className="dk-delta" data-dir={deltaPct > 0 ? 'up' : 'down'}>{deltaPct > 0 ? '+' : '−'}{Math.abs(deltaPct)}%</span>}</>
                : <span data-quiet>—</span>}
              figureSub={basis ?? (fullLoaded ? 'no comps yet' : fullError ? 'couldn’t load comps' : fullSlow ? 'comps slow to load' : 'appraising…')}
              below={editPiece === lot.id ? (
                <PieceEditor paid={paidIsOverride ? paid : null} note={note}
                  onSave={patch => setSavedFields(savedId, patch)}
                  onClose={() => setEditPiece(null)} />
              ) : null} />
          ))}
        </div>
          </>
        )}
        <p style={{ fontSize: 11.5, color: 'var(--color-text-muted)', margin: '14px 0 0' }}>
          The engine&rsquo;s mark is the median its comparable sales currently trade at — our read from the data,
          not a formal appraisal. The marked total covers only the pieces with a usable comp pool (the count says
          how many); a piece without one is never carried at cost under that figure, and a reference range is
          context only. The &plusmn;% compares the marked pieces that also carry a bought price, n stated.
        </p>
      </section>
    </div>
  );
}
