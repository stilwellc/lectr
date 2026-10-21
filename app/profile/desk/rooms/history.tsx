'use client';
/**
 * HISTORY — settled receipts, concluded & other, no longer on the block
 * (lifted from page.tsx unchanged). The outcomes ledger is fetched by the
 * page (LedgerGate) only when there are orphans to resolve; a fetch in
 * flight or failed is never printed as "withdrawn".
 */
import { Thumb, SigPill } from '../thumb';
import React, { useState } from 'react';
import Link from 'next/link';
import { retrySoldLedger, useSoldLedger } from '../../../hooks/useRayData';
import type { SavedMeta } from '../../../lib/account';
import LotCard, { formatEstimate } from '../../../components/LotCard';
import { TapeMark, ArchiveMark, HorizonMark } from '../../../components/marks';
import DecisionLine from '../../../components/DecisionLine';
import { formatDate, craftTitle, fmtSignedPct, overEstimatePct } from '../../../utils';
import { fmtFace } from '../../../lib/lot-face';
import { makerLineOf } from '../../../lib/lot-labels';
import { RoomHead } from '../../head';
import { useDeskInternals, type DeskInternals, type LedgerState, type SettledRowData } from '../provider';
import type { SectionProps, SectionMeta, DeskData } from '../types';
import { Term, CallCell } from './shared';
import { PHONE_ROWS } from './watching';

/** Mount-triggered sold-ledger fetch — lifts data AND load/error state, so a
    network failure is never rendered as a fact about a lot. */
export function LedgerGate({ onState }: { onState: (s: LedgerState) => void }) {
  const { ledger, ledgerLoaded, ledgerError } = useSoldLedger();
  React.useEffect(() => { onState({ ledger, loaded: ledgerLoaded, error: ledgerError }); }, [ledger, ledgerLoaded, ledgerError, onState]);
  return null;
}

/* ── SETTLED — one row implementation for both shells ── */
const SettledRowView = React.memo(function SettledRowView({ row, meta, owned, savedId, onOwn, onRemove, mobile }: {
  row: SettledRowData;
  meta: SavedMeta | undefined;
  owned: boolean;
  /** the id the save is keyed under — handlers are STABLE and take it back */
  savedId: string;
  onOwn: (savedId: string) => void;
  onRemove: (savedId: string) => void;
  mobile: boolean;
}) {
  if (row.kind === 'ledger') {
    const o = row.o;
    // the save's own estimate (frozen at save time) can still judge an
    // archive outcome — labeled as such, never dressed as a house estimate
    const vsSaveEst = meta?.estMid && o.priceUsd && !o.provisional
      ? Math.round((o.priceUsd / meta.estMid - 1) * 100) : null;
    const name = meta?.title || 'Archived lot';
    const price = o.provisional
      ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }} title="Sold — final price settling; the house posts results shortly after the close.">settling…</span>
      : fmtFace(o.priceUsd);
    if (mobile) {
      return (
        <div className="ray-settled-mrow">
          <div className="ck-mtitle">{name}</div>
          <div className="ck-mline">
            <span className="ck-msub">
              {(meta?.artist ? makerLineOf({ artist: meta.artist, title: meta.title }).name : '') || 'archive'}
              {meta?.estMid != null && <> · est. {fmtFace(meta.estMid)} at save</>}
            </span>
            <span className="ck-mnum">
              {price}
              {vsSaveEst != null && (
                <b style={{ marginLeft: 6, color: vsSaveEst > 0 ? 'var(--color-up)' : vsSaveEst < 0 ? 'var(--color-down-text)' : 'var(--color-text-muted)' }}>
                  {fmtSignedPct(vsSaveEst)}
                </b>
              )}
            </span>
          </div>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
            {o.provisional ? (
              <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>price settling</span>
            ) : (
              <button className="ray-own-btn" data-on={owned} aria-pressed={owned} onClick={() => onOwn(savedId)}>
                {owned ? 'Owned' : 'I won it'}
              </button>
            )}
            <button className="ray-own-x" title="Remove this watch from your desk" aria-label={`Remove watch: ${name}`} onClick={() => onRemove(savedId)}>×</button>
          </div>
        </div>
      );
    }
    return (
      <div className="ray-settled-cols ray-savedrow" style={{ display: 'grid' }}>
        <span className="maker">{(meta?.artist ? makerLineOf({ artist: meta.artist, title: meta.title }).name : '') || '—'}</span>
        <span className="work">{name}<span style={{ color: 'var(--color-text-faint)' }}> · archive</span></span>
        <span className="num" style={{ color: meta?.estMid != null ? undefined : 'var(--color-text-faint)' }}
          title={meta?.estMid != null ? 'The estimate as it stood when you saved the lot' : 'No estimate published'}>
          {meta?.estMid != null ? <>{fmtFace(meta.estMid)}<span className="sub">at save</span></> : '—'}
        </span>
        <CallCell meta={meta} />
        <span className="num" style={{ fontWeight: 600 }}>{price}</span>
        <span className="num" style={vsSaveEst != null ? { color: vsSaveEst > 0 ? 'var(--color-up)' : vsSaveEst < 0 ? 'var(--color-down-text)' : 'var(--color-text-muted)', fontWeight: 700 } : { color: 'var(--color-text-faint)' }}
          title={vsSaveEst != null ? 'vs the estimate at save — all-in price against the estimate midpoint' : 'No estimate on file — outside the vs-est median'}>
          {vsSaveEst != null ? <>{fmtSignedPct(vsSaveEst)}<span className="sub">vs est at save</span></> : '—'}
        </span>
        <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          {o.provisional ? (
            <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>—</span>
          ) : (
            <button className="ray-own-btn" data-on={owned} aria-pressed={owned} onClick={() => onOwn(savedId)}>
              {owned ? 'Owned' : 'I won it'}
            </button>
          )}
          <button className="ray-own-x" title="Remove this watch from your desk" aria-label={`Remove watch: ${name}`} onClick={() => onRemove(savedId)}>×</button>
        </span>
      </div>
    );
  }

  const lot = row.lot;
  const pct = overEstimatePct(lot);
  const pending = !lot.priceUsd;
  if (mobile) {
    return (
      <div className="ray-settled-mrow ck-ph" style={{ '--ph': '56px' } as React.CSSProperties}>
        <Thumb src={lot.imageUrl} label={lot.title} size={56} />
        <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="ck-mtitle">{craftTitle(lot.title, lot.auctionHouse)}</div>
        </Link>
        <div className="ck-mline">
          <span className="ck-msub">{makerLineOf(lot).name}</span>
          <span className="ck-mnum">
            {pending ? <span style={{ color: 'var(--color-text-faint)' }}>pending</span> : (
              <>
                <b>{fmtFace(lot.priceUsd!)}</b>
                {pct != null && (
                  <span style={{ marginLeft: 6 }}><SigPill dir={pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'} title="the hammer vs the estimate">{fmtSignedPct(Math.round(pct))}</SigPill></span>
                )}
              </>
            )}
          </span>
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          {pending ? (
            // no price yet — claiming it now would enter a $null piece into
            // the collection; the button arrives with the result
            <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>result pending</span>
          ) : (
            <button className="ray-own-btn" data-on={owned} aria-pressed={owned} onClick={() => onOwn(savedId)}>
              {owned ? 'Owned' : 'I won it'}
            </button>
          )}
          <button className="ray-own-x" title="Remove this watch from your desk" aria-label={`Remove watch: ${craftTitle(lot.title, lot.auctionHouse)}`} onClick={() => onRemove(savedId)}>×</button>
        </div>
      </div>
    );
  }
  return (
    <div className="ray-settled-cols ray-savedrow" style={{ display: 'grid' }}>
      <span className="maker">
        <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} style={{ color: 'inherit', textDecoration: 'none' }}>
          {makerLineOf(lot).name || '—'}
        </Link>
      </span>
      <span className="work ck-ph" style={{ '--ph': '40px', alignItems: 'center' } as React.CSSProperties}>
        <Thumb src={lot.imageUrl} label={lot.title} size={40} />
        <Link href={`/lot?id=${encodeURIComponent(lot.id)}`} style={{ color: 'inherit', textDecoration: 'none', alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {craftTitle(lot.title, lot.auctionHouse)}
        </Link>
      </span>
      <span className="num">{formatEstimate(lot) || '—'}</span>
      <CallCell meta={meta} />
      <span className="num" style={{ fontWeight: 600 }}>
        {pending ? <span style={{ color: 'var(--color-text-faint)', fontWeight: 500 }}>pending</span> : fmtFace(lot.priceUsd!)}
      </span>
      <span className="num" style={pct != null ? undefined : { color: 'var(--color-text-faint)' }}>
        {pct != null ? <SigPill dir={pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'}>{fmtSignedPct(Math.round(pct))}</SigPill> : '—'}
      </span>
      <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {pending ? (
          <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>—</span>
        ) : (
          <button className="ray-own-btn" data-on={owned} aria-pressed={owned} onClick={() => onOwn(savedId)}>
            {owned ? 'Owned' : 'I won it'}
          </button>
        )}
        <button className="ray-own-x" title="Remove this watch from your desk" aria-label={`Remove watch: ${craftTitle(lot.title, lot.auctionHouse)}`} onClick={() => onRemove(savedId)}>×</button>
      </span>
    </div>
  );
});

export function when(_desk: DeskData, i: DeskInternals): boolean {
  return i.deskView && (i.settledCount > 0 || i.other.length > 0 || i.orphanIds.length > 0);
}
export function meta(_desk: DeskData, i: DeskInternals): SectionMeta | null {
  if (!i.deskView || !(i.historyCount > 0 || i.orphanIds.length > 0)) return null;
  return { id: 'history', label: 'History', count: i.historyCount || undefined };
}

export default function HistoryRoom(_p: SectionProps) {
  const i = useDeskInternals();
  const { sold, soldOrphans, goneOrphans, orphanIds, other, settledRows, settledCount, settledHasCall, record, unclaimedWins,
    metaFor, savedMeta, ownedLotIds, ownedIdSet, savedIdOf, onSettledOwn, onSettledRemove, ledgerState, allLots, isSaved, onCardToggle, toggle, isDesktop } = i;
  const [allSettled, setAllSettled] = useState(false);
  return (
    <div id="history" className="ck-history">
    {/* ══ SETTLED — the line-item receipts ══ */}
    {(sold.length > 0 || soldOrphans.length > 0) && (
      <section id="settled" className="ray-saved-section rail ray-enter" style={{ '--enter-delay': '90ms' } as React.CSSProperties}>
        <div className="ns-plate" style={{ paddingTop: 18 }}>
        {/* the rail's "History" lands here — one name for one room */}
        <RoomHead mark={<TapeMark size={17} />} title="History" style={{ marginBottom: 4 }}
          sub={<>{settledCount} settled {settledCount === 1 ? 'watch' : 'watches'}{record && <> · {record.n} judged vs estimate</>}</>} />
        {unclaimedWins > 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '0 0 14px' }}>
            Won any of these? Mark it <b style={{ color: 'var(--color-fg)' }}>I won it</b> and the piece joins your collection, appraised against the live market.
          </p>
        )}

        {/* "Your call" folds when no settled save recorded one */}
        <div className="ray-settled-desk" style={{ marginTop: 12 }} data-nocall={settledHasCall ? undefined : ''}>
          <div className="ray-settled-cols ray-settled-head kicker" style={{ padding: '0 2px 8px' }}>
            <span>Maker</span>
            <span>Work</span>
            <span style={{ textAlign: 'right' }}>Est</span>
            <span style={{ textAlign: 'right' }}>Your call</span>
            <span style={{ textAlign: 'right' }}>Realized</span>
            <span style={{ textAlign: 'right' }}><Term k="vs estimate">vs est</Term></span>
            <span style={{ textAlign: 'right' }}>Own it</span>
          </div>
          {settledRows.map(row => {
            const key = row.kind === 'lot' ? row.lot.id : row.o.id;
            const meta = row.kind === 'lot' ? metaFor(row.lot.id) : savedMeta[row.o.id];
            return (
              <SettledRowView
                key={key}
                row={row}
                meta={meta}
                owned={row.kind === 'lot' ? ownedLotIds.has(row.lot.id) : ownedIdSet.has(row.o.id)}
                savedId={row.kind === 'lot' ? savedIdOf(row.lot.id) : row.o.id}
                onOwn={onSettledOwn}
                onRemove={onSettledRemove}
                mobile={false}
              />
            );
          })}
        </div>
        <div className="ray-settled-mobile">
          {(allSettled ? settledRows : settledRows.slice(0, PHONE_ROWS)).map(row => {
            const key = row.kind === 'lot' ? row.lot.id : row.o.id;
            const meta = row.kind === 'lot' ? metaFor(row.lot.id) : savedMeta[row.o.id];
            return (
              <SettledRowView
                key={key}
                row={row}
                meta={meta}
                owned={row.kind === 'lot' ? ownedLotIds.has(row.lot.id) : ownedIdSet.has(row.o.id)}
                savedId={row.kind === 'lot' ? savedIdOf(row.lot.id) : row.o.id}
                onOwn={onSettledOwn}
                onRemove={onSettledRemove}
                mobile
              />
            );
          })}
          {settledRows.length > PHONE_ROWS && (
            <button type="button" className="ck-today-more" aria-expanded={allSettled} onClick={() => setAllSettled(v => !v)}>
              {allSettled ? 'Show fewer' : `Show all ${settledRows.length} settled`}
            </button>
          )}
        </div>
        </div>
      </section>
    )}

    {other.length > 0 && (
      <section className="ray-saved-section rail ck-fold-section">
        <details className="ns-plate ck-fold" open={isDesktop !== false}>
          <summary className="ck-fold-sum">
            <RoomHead level={3} mark={<ArchiveMark size={15} />} title="Concluded & other" />
            <span className="ck-fold-n">{other.length}</span>
          </summary>
          <p className="ck-fold-dek">
            Saved lots that closed without a published hammer, were bought in, or are awaiting results.
          </p>
          <div className="ray-saved-grid" style={{ display: 'grid' }}>
            {other.map((lot, idx) => (
              <div key={lot.id} className="ray-enter-card" style={{ '--enter-delay': `${Math.min(idx, 8) * 60}ms` } as React.CSSProperties}>
                <LotCard lot={lot} showArtist allLots={allLots} saved={isSaved(savedIdOf(lot.id)) || isSaved(lot.id)} onToggleSave={onCardToggle} decision={<DecisionLine lot={lot} estimate={false} />} />
              </div>
            ))}
          </div>
        </details>
      </section>
    )}

    {/* orphans render ONLY once the outcomes ledger has loaded — a fetch
        in flight (or failed) is never printed as "withdrawn" */}
    {orphanIds.length > 0 && !ledgerState.loaded && !ledgerState.error && (
      <section className="rail ray-enter" style={{ paddingBlock: '20px 8px' }}>
        <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: 0 }}>
          Resolving results for {orphanIds.length} settled {orphanIds.length === 1 ? 'watch' : 'watches'}&hellip;
        </p>
      </section>
    )}
    {orphanIds.length > 0 && ledgerState.error && !ledgerState.loaded && (
      <section className="rail ray-enter" style={{ paddingBlock: '30px 40px' }}>
        <div className="ck-warn" role="status">
          Couldn&apos;t check outcomes for {orphanIds.length} saved {orphanIds.length === 1 ? 'lot' : 'lots'} — the results ledger didn&apos;t load.{' '}
          <button className="ck-warn-btn" onClick={() => retrySoldLedger()}>Try again</button>
        </div>
      </section>
    )}
    {goneOrphans.length > 0 && (
      <section className="ray-saved-section rail ray-enter ck-fold-section">
        <details className="ns-plate ck-fold" open={isDesktop !== false}>
          <summary className="ck-fold-sum">
            <RoomHead level={3} mark={<HorizonMark size={15} />} title="No longer on the block" />
            <span className="ck-fold-n">{goneOrphans.length}</span>
          </summary>
          <p className="ck-fold-dek">
            Saved lots the crawl no longer carries — withdrawn, relisted or purged by the house.
          </p>
        <div className="glass glass-quiet">
          {goneOrphans.map(id => {
            const m = savedMeta[id];
            return (
              <div key={id} className="ray-saved-orphan">
                <span>
                  {m?.title ? (
                    <>
                      <span style={{ color: 'var(--color-fg)', fontWeight: 600 }}>
                        was: {m.title}
                        {m.artist && makerLineOf({ artist: m.artist, title: m.title }).name ? <>, {makerLineOf({ artist: m.artist, title: m.title }).name}</> : null}
                      </span>
                      <span style={{ color: 'var(--color-text-faint)' }}>
                        {m.estMid != null && <> · est. {fmtFace(m.estMid)}</>}
                        {' '}· saved {formatDate(m.savedAt)}
                      </span>
                    </>
                  ) : (
                    <>
                      No longer listed — removed from the block
                      {m && (
                        <span style={{ color: 'var(--color-text-faint)' }}>
                          {' '}· saved {formatDate(m.savedAt)}
                          {m.estMid != null && <> · was est. {fmtFace(m.estMid)}</>}
                        </span>
                      )}
                    </>
                  )}
                </span>
                <button className="ray-call-btn ray-call-btn-quiet" style={{ flexShrink: 0 }} onClick={() => toggle(id)}>
                  Remove
                </button>
              </div>
            );
          })}
        </div>
        </details>
      </section>
    )}
    </div>
  );
}
