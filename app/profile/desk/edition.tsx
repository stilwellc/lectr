'use client';
/**
 * TODAY'S EDITION (Oct 29 2026) — the Daily Desk paper, on the desk. A button
 * in the Account strip's Daily Desk row opens a full-screen sheet with the
 * rendered paper in a sandboxed iframe (srcdoc; links open the page itself).
 * Built on the client with the morning send's own planDesk + renderDesk
 * (edition-model.ts) over what the desk already holds; the names' entity
 * buckets, receipts.json and backtest.json are fetched on the first open.
 * The model + renderer module (and scripts/lib under it) is imported on the
 * button's FIRST CLICK, never statically — /profile's first load stays
 * without it; the sheet says "Setting the type…" until it lands.
 * Phone: the sheet is the viewport with a close bar; the paper scrolls
 * inside the frame. "Open in a new tab" hands the same HTML to a blob: URL.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDesk, useDeskInternals } from './provider';
import { loadEntityDetail } from '../../hooks/useEntities';
import type { EditionSource } from './edition-model';

/** the paper's module, loaded once per page on the first click */
let modelModule: Promise<typeof import('./edition-model')> | null = null;
const loadModel = () => (modelModule ??= import('./edition-model'));

async function getJson<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}
/** the served files the paper reads, fetched once per page */
let served: Promise<{ receipts: import('../../../scripts/lib/daily-desk').ReceiptsIn | null; backtest: import('../../../scripts/lib/daily-desk').BacktestIn | null }> | null = null;
function loadServed() {
  if (!served) served = Promise.all([getJson<import('../../../scripts/lib/daily-desk').ReceiptsIn>('/data/ray/receipts.json'), getJson<import('../../../scripts/lib/daily-desk').BacktestIn>('/data/ray/backtest.json')]).then(([receipts, backtest]) => ({ receipts, backtest }));
  return served;
}

type SheetState = 'idle' | 'type' | 'building' | 'empty' | 'error';

export function EditionButton() {
  const { desk } = useDesk();
  const i = useDeskInternals();
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<SheetState>('idle');
  const dateLabel = new Date(desk.now).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' });
  const build = useCallback(async () => {
    setOpen(true);
    setState(modelModule ? 'building' : 'type');
    try {
      const m = await loadModel();
      setState('building');
      const src: EditionSource = {
        now: desk.now, savedIds: i.savedIds, savedMeta: i.savedMeta, book: desk.book, sold: i.sold, soldOrphans: i.soldOrphans,
        recs: desk.recs, closingPicks: desk.closingPicks, follows: i.myFollows, pendingResults: i.unclaimedWins, lastSentOn: i.daily.lastSentOn,
      };
      const ids = m.entityIdsOf(src);
      // one bucket fetch per distinct bucket (useEntities caches them); a miss is "none on file"
      const ver = desk.lastCrawl || undefined;
      const [details, { receipts, backtest }] = await Promise.all([Promise.all(ids.map(id => loadEntityDetail(id, ver).catch(() => null))), loadServed()]);
      const page = m.buildEdition(src, { ids, details, receipts, backtest }, window.location.origin);
      if (!page) { setState('empty'); setHtml(null); return; }
      setHtml(page);
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
      {open && <EditionSheet html={html} state={state} dateLabel={dateLabel} onClose={() => setOpen(false)} />}
    </>
  );
}

function EditionSheet({ html, state, dateLabel, onClose }: { html: string | null; state: SheetState; dateLabel: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const blobRef = useRef<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey); document.body.style.overflow = prev;
      if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
    };
  }, [onClose]);
  // the same HTML in a tab of its own (a blob: URL; revoked when the sheet closes)
  const openTab = useCallback(() => {
    if (!html) return;
    if (!blobRef.current) blobRef.current = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(blobRef.current, '_blank', 'noopener');
  }, [html]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="ck-edition" role="dialog" aria-modal="true" aria-label="Today’s edition of the Daily Desk">
      <div className="ck-edition-bar">
        <span className="ck-edition-title"><b>Today’s edition</b> · {dateLabel}</span>
        <span className="ck-edition-sub">the paper as the morning email prints it, built from your desk right now</span>
        {html && <button type="button" className="ray-toolbar-pill ck-edition-tab" onClick={openTab}>Open in a new tab</button>}
        <button ref={closeRef} type="button" className="ray-toolbar-pill ck-edition-close" onClick={onClose} aria-label="Close today’s edition">Close</button>
      </div>
      <div className="ck-edition-body">
        {html ? (
          <iframe className="ck-edition-frame" title="Today’s edition" srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" referrerPolicy="no-referrer" />
        ) : (
          <p className="ck-edition-note" role="status">
            {state === 'type' ? 'Setting the type…' : state === 'building' ? 'Setting today’s paper…' : state === 'empty' ? 'Nothing on your desk yet — save a lot or follow a name and the paper has something to print.' : state === 'error' ? 'The paper didn’t set. Try again in a moment.' : ''}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
