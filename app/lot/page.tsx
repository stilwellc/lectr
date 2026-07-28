'use client';

import { Suspense } from 'react';
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
  const id = (params.get('id') || '').trim();
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
