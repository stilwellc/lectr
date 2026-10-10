'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import EntityPage from '../components/entity/EntityPage';
import { entityPageOf, parseEntityId } from '../lib/entity/key';

/**
 * /entity?id=<entity id> — the page of every entity without a page of its own
 * (makers overhaul P2, Oct 10 2026): a Pokémon (`sj:tcg|k:charizard`), a film
 * or franchise, a mission, a person, a sealed set, a science collection
 * (`cs:space-science:meteorites`). A query page like /player and /ref, so the
 * static export ships ONE shell, never a page per id. A maker or player id is
 * sent on to its canonical page (/makers/<slug>, /player?id=).
 */
function EntityFromQuery() {
  const params = useSearchParams();
  const router = useRouter();
  const id = (params.get('id') || '').trim();
  const p = id ? parseEntityId(id) : null;
  const canonical = p && (p.kind === 'maker' || p.kind === 'player') ? entityPageOf(id) : null;
  useEffect(() => { if (canonical) router.replace(canonical); }, [canonical, router]);
  if (canonical) return <div className="rail" aria-busy="true" style={{ paddingTop: 28, paddingBottom: 40, minHeight: '60vh' }} />;
  return <EntityPage key={id} id={id} />;
}

export default function EntityQueryPage() {
  return (
    <Suspense fallback={<div className="rail" aria-busy="true" style={{ paddingTop: 28, paddingBottom: 40, minHeight: '60vh' }} />}>
      <EntityFromQuery />
    </Suspense>
  );
}
