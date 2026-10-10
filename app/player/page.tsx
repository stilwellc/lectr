'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import EntityPage from '../components/entity/EntityPage';
import BookIndex from '../components/BookIndex';

/**
 * The player-dossier permalink — /player?id=<slug> (e.g. /player?id=
 * michael-jordan). Since the makers overhaul (P2, Oct 10 2026) it is the one
 * entity page (components/entity/EntityPage) for the athlete's id `pl:<slug>`.
 */
function PlayerFromQuery() {
  const params = useSearchParams();
  const id = (params.get('id') || '').trim().toLowerCase();
  if (!id) return <BookIndex kind="player" />;
  return <EntityPage key={id} id={`pl:${id}`} />;
}

export default function PlayerQueryPage() {
  return (
    // A minimal rail-padded placeholder (not LotPageSkeleton — its image-plate/
    // leader grid is lot-shaped and would jank against the dossier layout) so
    // the pre-mount instant paints structure, never a blank flash.
    <Suspense fallback={<div className="rail" aria-busy="true" style={{ paddingTop: 28, paddingBottom: 40, minHeight: '60vh' }} />}>
      <PlayerFromQuery />
    </Suspense>
  );
}
