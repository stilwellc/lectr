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
  return <RefPage refKey={id} />;
}

export default function RefQueryPage() {
  return (
    <Suspense fallback={null}>
      <RefFromQuery />
    </Suspense>
  );
}
