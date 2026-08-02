'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import LotPage, { LotPageSkeleton } from '../components/LotPage';

/**
 * The UNIVERSAL permalink — /lot?id=<lotId>. A pure client page: any lot in
 * the already-served data resolves here (eager upcoming, the phase-2 history
 * shards, and — for Goldin sports/science sold lots — the phase-3 archive),
 * so every lot on the book is linkable without minting 20,000 static files.
 * The flagged set additionally gets real static pages at /lot/<id>.
 *
 * useSearchParams under output:'export' must sit inside <Suspense> — the
 * shell prerenders without query context and the reader's id arrives client-side.
 */
function LotFromQuery() {
  const params = useSearchParams();
  const queryId = (params.get('id') || '').trim();
  // PATH FORM: a direct load of /lot/<id> for a NON-flagged lot is rewritten
  // by Cloudflare to this shell (audit-urls §4D) — the app router still says
  // /lot, so the id must be read off the real location. Flagged ids never
  // reach here (their static pages are pinned above the rewrite).
  const pathId = typeof window !== 'undefined'
    ? decodeURIComponent((window.location.pathname.match(/^\/lot\/(.+?)\/?$/) || [])[1] || '')
    : '';
  const id = queryId || pathId;
  // CANONICAL ADDRESS: in-app links keep ?id= as the TRANSPORT (soft
  // navigation — path links to non-static routes would full-reload), but the
  // address bar should show the canonical path form for sharing.
  useEffect(() => {
    if (queryId && typeof window !== 'undefined') {
      try { window.history.replaceState(window.history.state, '', `/lot/${encodeURIComponent(queryId)}`); } catch { /* ignore */ }
    }
  }, [queryId]);
  // key={id}: client-side navigation between lots must REMOUNT the page —
  // otherwise dbLot/dbSettled/imgFailed state from the previous lot leaks
  // under the new URL (a stale certificate, a false "isn't on the book"
  // flash, a sticky monogram fallback).
  return <LotPage key={id} lotId={id} />;
}

export default function LotQueryPage() {
  return (
    <Suspense fallback={<LotPageSkeleton />}>
      <LotFromQuery />
    </Suspense>
  );
}
