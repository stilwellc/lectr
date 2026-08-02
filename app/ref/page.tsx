'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import RefPage from '../components/RefPage';

/**
 * The reference dossier permalink — /ref?id=<maker:refKey> (e.g.
 * /ref?id=rolex:6263). Pure client page over refs.json, same pattern as
 * /lot?id=: no static file per reference, everything in the book is linkable.
 * useSearchParams under output:'export' must sit inside <Suspense>.
 */
function RefFromQuery() {
  const params = useSearchParams();
  const id = (params.get('id') || '').trim().toLowerCase();
  return <RefPage key={id} refKey={id} />;
}

export default function RefQueryPage() {
  return (
    // A minimal rail-padded placeholder (not LotPageSkeleton — its image-plate/
    // leader grid is lot-shaped and would jank against the dossier layout) so
    // the pre-mount instant paints structure, never a blank flash.
    <Suspense fallback={<div className="rail" aria-busy="true" style={{ paddingTop: 28, paddingBottom: 40, minHeight: '60vh' }} />}>
      <RefFromQuery />
    </Suspense>
  );
}
