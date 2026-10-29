'use client';
/**
 * HISTORY — settled receipts, concluded & other, no longer on the block
 * (lifted from page.tsx unchanged). The outcomes ledger is fetched by the
 * page (LedgerGate) only when there are orphans to resolve; a fetch in
 * flight or failed is never printed as "withdrawn".
 */
import { SigPill } from '../thumb';
import { DeskRow } from '../row';
import React, { useState } from 'react';
import { retrySoldLedger, useSoldLedger } from '../../../hooks/useRayData';
import { signalCallOf, type SavedMeta } from '../../../lib/account';
import LotCard, { formatEstimate } from '../../../components/LotCard';
import { TapeMark, ArchiveMark, HorizonMark } from '../../../components/marks';
import DecisionLine from '../../../components/DecisionLine';
import { formatDate, craftTitle, fmtSignedPct, overEstimatePct } from '../../../utils';
import { fmtFace } from '../../../lib/lot-face';
import { makerLineOf } from '../../../lib/lot-labels';
import { RoomHead } from '../../head';
import { useDeskInternals, useDesk, type DeskInternals, type LedgerState, type SettledRowData } from '../provider';
import type { SectionProps, SectionMeta, DeskData } from '../types';
import { GLOSSARY, callText } from './shared';
import { PHONE_ROWS } from './watching';

/** Mount-triggered sold-ledger fetch — lifts data AND load/error state, so a
    network failure is never rendered as a fact about a lot. */
export function LedgerGate({ onState }: { onState: (s: LedgerState) => void }) {
  const { ledger, ledgerLoaded, ledgerError } = useSoldLedger();
  React.useEffect(() => { onState({ ledger, loaded: ledgerLoaded, error: ledgerError }); }, [ledger, ledgerLoaded, ledgerError, onState]);
  return null;
}

/* ── SETTLED — one row at every width (THE DESK v4: ../row DeskRow): the
   hammer is the figure, vs estimate under it as the lamp pill; the maker,
   the house, the estimate (an archived save: as it stood at save) and your
   call at save ride the lines; I won it and Remove are the actions ── */
const callInk = (call: ReturnType<typeof signalCallOf>) =>
  !call ? undefined : call.dir === 'unknown' ? 'var(--color-text-muted)' : call.dir === 'below' ? 'var(--color-up)' : 'var(--color-down-text)';

const SettledRowView = React.memo(function SettledRowView({ row, meta, owned, savedId, onOwn, onRemove }: {
  row: SettledRowData;
  meta: SavedMeta | undefined;
  owned: boolean;
  /** the id the save is keyed under — handlers are STABLE and take it back */
  savedId: string;
  onOwn: (savedId: string) => void;
  onRemove: (savedId: string) => void;
}) {
  const call = signalCallOf(meta);
  const callFact = call ? (
    <span className="dk-meta-fact" style={{ color: callInk(call) }}
      title={call.dir === 'unknown' ? 'Saved before signals recorded their direction — magnitude only.' : 'The engine’s signal as it stood when you saved the lot'}>
      called {callText(call)}
    </span>
  ) : null;
  const actions = (name: string, canOwn: boolean, why: string) => (
    <>
      {canOwn
        ? <button className="ray-own-btn" data-on={owned} aria-pressed={owned} onClick={() => onOwn(savedId)}>{owned ? 'Owned' : 'I won it'}</button>
        : <span style={{ fontSize: 11.5, color: 'var(--color-text-faint)' }}>{why}</span>}
      <button className="ray-own-x" title="Remove this watch from your desk" aria-label={`Remove watch: ${name}`} onClick={() => onRemove(savedId)}>×</button>
    </>
  );
  if (row.kind === 'ledger') {
    const o = row.o;
    // the save's own estimate (frozen at save time) can still judge an
    // archive outcome — labeled as such, never dressed as a house estimate
    const vsSaveEst = meta?.estMid && o.priceUsd && !o.provisional
      ? Math.round((o.priceUsd / meta.estMid - 1) * 100) : null;
    const name = meta?.title || 'Archived lot';
    const maker = (meta?.artist ? makerLineOf({ artist: meta.artist, title: meta.title }).name : '') || '';
    return (
      // an archived save carries no photo: its maker's initial keeps the row's edge
      <DeskRow lot={{ id: o.id, title: name }} title={name} who={maker || name}
        sub={[maker || 'archive', meta?.estMid != null ? `est. ${fmtFace(meta.estMid)} at save` : null].filter(Boolean).join(' · ')}
        meta={callFact ?? undefined}
        figureKind="hammer" figureText={o.provisional ? 'price settling' : fmtFace(o.priceUsd)}
        figure={o.provisional
          ? <span data-quiet title="Sold — final price settling; the house posts results shortly after the close.">settling…</span>
          : fmtFace(o.priceUsd)}
        figureSubText={vsSaveEst != null ? `${fmtSignedPct(vsSaveEst)} vs estimate at save` : 'no estimate on file'}
        figureSub={vsSaveEst != null
          ? <><SigPill dir={vsSaveEst > 0 ? 'up' : vsSaveEst < 0 ? 'down' : 'flat'} label={`${fmtSignedPct(vsSaveEst)} vs estimate at save`}>{fmtSignedPct(vsSaveEst)}</SigPill> <span title={GLOSSARY['vs estimate']}>vs est at save</span></>
          : <span title="No estimate on file — outside the vs-est median">archive</span>}
        action={actions(name, !o.provisional, 'price settling')} />
    );
  }
  const lot = row.lot;
  const pct = overEstimatePct(lot);
  const pending = !lot.priceUsd;
  const name = craftTitle(lot.title, lot.auctionHouse);
  return (
    <DeskRow lot={lot} who={makerLineOf(lot).name || lot.title}
      sub={[makerLineOf(lot).name, lot.auctionHouse, formatEstimate(lot)].filter(Boolean).join(' · ')}
      meta={callFact ?? undefined}
      figureKind="hammer" figure={pending ? <span data-quiet>pending</span> : fmtFace(lot.priceUsd!)} figureText={pending ? 'result pending' : fmtFace(lot.priceUsd!)}
      figureSubText={pct != null ? `${fmtSignedPct(Math.round(pct))} vs estimate` : pending ? null : 'no estimate on file'}
      figureSub={pct != null
        ? <><SigPill dir={pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'} label={`${fmtSignedPct(Math.round(pct))} vs estimate`}>{fmtSignedPct(Math.round(pct))}</SigPill> <span title={GLOSSARY['vs estimate']}>vs est</span></>
        : pending ? null : <span title="No estimate on file — outside the vs-est median">no estimate</span>}
      // no price yet — claiming it now would enter a $null piece into the
      // collection; the button arrives with the result
      action={actions(name, !pending, 'result pending')} />
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
  const { narrow } = useDesk();
  const { sold, soldOrphans, goneOrphans, orphanIds, other, settledRows, settledCount, record, unclaimedWins,
    metaFor, savedMeta, ownedLotIds, ownedIdSet, savedIdOf, onSettledOwn, onSettledRemove, ledgerState, allLots, isSaved, onCardToggle, toggle, isDesktop } = i;
  // a phone opens on the most recent rows; the rest are one tap
  const [allSettled, setAllSettled] = useState(false);
  return (
    <div id="history" className="ck-history">
    {/* ══ SETTLED — the line-item receipts ══ */}
    {(sold.length > 0 || soldOrphans.length > 0) && (
      <section id="settled" className="ray-saved-section rail ray-enter" style={{ '--enter-delay': '90ms' } as React.CSSProperties}>
        <div className="ns-plate" style={{ paddingTop: 18 }}>
        {/* the rail's "History" lands here — one name for one room */}
        <RoomHead mark={<TapeMark size={17} />} title="History" style={{ marginBottom: 4 }}
          sub={<>{settledCount - i.pendingResultsN} settled {settledCount - i.pendingResultsN === 1 ? 'watch' : 'watches'}{i.pendingResultsN > 0 && <> · {i.pendingResultsN} awaiting results</>}{record && <> · {record.n} judged vs estimate</>}</>} />
        {unclaimedWins > 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '0 0 14px' }}>
            Won any of these? Mark it <b style={{ color: 'var(--color-fg)' }}>I won it</b> and the piece joins your collection, appraised against the live market.
          </p>
        )}

        <div className="dk-list" style={{ marginTop: 10 }}>
          {(narrow && !allSettled ? settledRows.slice(0, PHONE_ROWS) : settledRows).map(row => {
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
              />
            );
          })}
        </div>
        {narrow && settledRows.length > PHONE_ROWS && (
          <button type="button" className="ck-today-more" aria-expanded={allSettled} onClick={() => setAllSettled(v => !v)}>
            {allSettled ? 'Show fewer' : `Show all ${settledRows.length} settled`}
          </button>
        )}
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
