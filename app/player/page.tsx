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
    <Suspense fallback={null}>
      <PlayerFromQuery />
    </Suspense>
  );
}
