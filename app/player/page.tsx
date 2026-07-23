'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import PlayerPage from '../components/PlayerPage';

/**
 * The player-dossier permalink — /player?id=<slug> (e.g. /player?id=
 * michael-jordan). Pure client page over players.json, same pattern as /ref.
 */
function PlayerFromQuery() {
  const params = useSearchParams();
  const id = (params.get('id') || '').trim().toLowerCase();
  return <PlayerPage playerSlug={id} />;
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
