'use client';
/**
 * EveryResult — a maker's whole sold book, mounted only when the reader asks
 * for it ("Every result" under the entity page's results). The rows are the
 * maker's own shard (useMakerRows — the attribution-guarded book), listed by
 * the shared PastResults (date / price sort, the live chips' taxonomy pills).
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { useMakerRows } from '../../hooks/useMakerRows';
import { useSavedLots } from '../../hooks/useSavedLots';
import PastResults from '../PastResults';
import { RayLoading } from '../RayEntrance';

export default function EveryResult({ slug }: { slug: string }) {
  const mk = useMakerRows(slug);
  const { savedIds, toggle, ownedIds, toggleOwned } = useSavedLots();
  const sold = useMemo(() => (mk.rows || []).filter(l => l.status === 'sold'), [mk.rows]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);
  return (
    <div ref={ref} id="every-result">
      {mk.rows ? (
        <PastResults lots={sold} savedIds={savedIds} onToggleSave={id => toggle(id, sold.find(l => l.id === id))} ownedIds={ownedIds} onToggleOwned={toggleOwned} />
      ) : mk.error ? (
        <p className="rail nsp-note">The sale history didn&rsquo;t load — try again shortly.</p>
      ) : <RayLoading />}
    </div>
  );
}
