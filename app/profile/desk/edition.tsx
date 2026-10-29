'use client';
/**
 * TODAY'S EDITION (Oct 29 2026) — the Daily Desk paper, on the desk. A button
 * in the Account strip's Daily Desk row opens a full-screen sheet with the
 * rendered paper in a sandboxed iframe (srcdoc; links open the page itself).
 * Built here on the client with the morning send's own planDesk + renderDesk
 * (edition-model.ts) over what the desk already holds; the names' entity
 * buckets, receipts.json and backtest.json are fetched on the first open.
 * Phone: the sheet is the viewport with a close bar. Esc closes.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDesk, useDeskInternals } from './provider';
import { loadEntityDetail } from '../../hooks/useEntities';
import { lastSaleOf, recentOf, type LastSale, type ReceiptsIn, type BacktestIn } from '../../../scripts/lib/daily-desk';
import { editionInputOf, entityIdsOf, dateLabelOf, planDesk, renderEdition, type EditionSource } from './edition-model';

async function getJson<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

/** the served files the paper reads, fetched once per page */
let served: Promise<{ receipts: ReceiptsIn | null; backtest: BacktestIn | null }> | null = null;
function loadServed() {
  if (!served) served = Promise.all([getJson<ReceiptsIn>('/data/ray/receipts.json'), getJson<BacktestIn>('/data/ray/backtest.json')]).then(([receipts, backtest]) => ({ receipts, backtest }));
  return served;
}

export function EditionButton() {
  const { desk } = useDesk();
  const i = useDeskInternals();
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'building' | 'empty' | 'error'>('idle');
  const build = useCallback(async () => {
    setState('building');
    setOpen(true);
    try {
      const src: EditionSource = {
        now: desk.now, savedIds: i.savedIds, savedMeta: i.savedMeta, book: desk.book, sold: i.sold, soldOrphans: i.soldOrphans,
        recs: desk.recs, closingPicks: desk.closingPicks, follows: i.myFollows, pendingResults: i.unclaimedWins, lastSentOn: i.daily.lastSentOn,
      };
      const ids = entityIdsOf(src);
      const nameSold = new Map<string, LastSale | null>();
      const nameRecent = new Map<string, readonly LastSale[]>();
      // one bucket fetch per distinct bucket (useEntities caches them); a miss is "none on file"
      const ver = desk.lastCrawl || undefined;
      const details = await Promise.all(ids.map(id => loadEntityDetail(id, ver).catch(() => null)));
      ids.forEach((id, k) => { nameSold.set(id, lastSaleOf(details[k])); nameRecent.set(id, recentOf(details[k])); });
      const { receipts, backtest } = await loadServed();
      const model = planDesk(editionInputOf(src, { nameSold, nameRecent, receipts, backtest }));
      if (!model) { setState('empty'); setHtml(null); return; }
      setHtml(renderEdition(model, window.location.origin, dateLabelOf(desk.now)));
      setState('idle');
    } catch (e) {
      console.error('[edition]', e);
      setState('error');
    }
  }, [desk, i]);
  return (
    <>
      <button type="button" className="ray-toolbar-pill ck-edition-btn" onClick={() => void build()} aria-haspopup="dialog" aria-expanded={open}>
        Today’s edition
      </button>
      {open && <EditionSheet html={html} state={state} dateLabel={dateLabelOf(desk.now)} onClose={() => setOpen(false)} />}
    </>
  );
}

function EditionSheet({ html, state, dateLabel, onClose }: { html: string | null; state: 'idle' | 'building' | 'empty' | 'error'; dateLabel: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="ck-edition" role="dialog" aria-modal="true" aria-label="Today’s edition of the Daily Desk">
      <div className="ck-edition-bar">
        <span className="ck-edition-title"><b>Today’s edition</b> · {dateLabel}</span>
        <span className="ck-edition-sub">the paper as the morning email prints it, built from your desk right now</span>
        <button ref={closeRef} type="button" className="ray-toolbar-pill ck-edition-close" onClick={onClose} aria-label="Close today’s edition">Close</button>
      </div>
      <div className="ck-edition-body">
        {html ? (
          <iframe className="ck-edition-frame" title="Today’s edition" srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" referrerPolicy="no-referrer" />
        ) : (
          <p className="ck-edition-note" role="status">
            {state === 'building' ? 'Setting today’s paper…' : state === 'empty' ? 'Nothing on your desk yet — save a lot or follow a name and the paper has something to print.' : state === 'error' ? 'The paper didn’t set. Try again in a moment.' : ''}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
