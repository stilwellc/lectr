'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import SubPage from './SubPage';

/**
 * The sub-market dossier permalink — /sub?id=<drill slug> (e.g.
 * /sub?id=cards:basketball, /sub?id=rolex:daytona, /sub?id=cards-era:classic).
 * Pure client page over market.json's drills, same pattern as /ref + /player:
 * no static file per sub-market, everything tracked is linkable. The drill
 * slug is read client-side; the layout supplies the metadata for the export.
 */
function SubFromQuery() {
  const params = useSearchParams();
  // drill slugs are 'vertical:part' — case matters only on the part in rare
  // maker slugs, but every emitted slug is already lower-case, so normalize.
  const id = (params.get('id') || '').trim().toLowerCase();
  return <SubPage key={id} slug={id} />;
}

export default function SubQueryPage() {
  return (
    // A minimal rail-padded placeholder (not LotPageSkeleton — its image-plate/
    // leader grid is lot-shaped and would jank against the dossier layout) so
    // the pre-mount instant paints structure, never a blank flash.
    <Suspense fallback={<div className="rail" aria-busy="true" style={{ paddingTop: 28, paddingBottom: 40, minHeight: '60vh' }} />}>
      <SubFromQuery />
    </Suspense>
  );
}
