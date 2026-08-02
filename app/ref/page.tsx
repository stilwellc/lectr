'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import RefPage from '../components/RefPage';
import { encodeRefPath } from './ref-path';

/**
 * LEGACY query shell — /ref?id=<maker>:<ref> now lives at /ref/<maker>/<key>
 * (static, per-dossier metadata; audit-urls §3–4; <key> is the ref half
 * through the ref-path codec — '/' and 'è' occur in real keys). Cloudflare
 * `_redirects` cannot match query strings, so this client redirector IS the
 * migration path: a well-formed ?id= is router.replace()'d to the path form;
 * keep for at least one crawl cycle. No/malformed id keeps the old inline
 * not-found rendering (RefPage's own empty state).
 */
function RefFromQuery() {
  const router = useRouter();
  const params = useSearchParams();
  const id = (params.get('id') || '').trim().toLowerCase();
  // split on the FIRST ':' — the maker half is always [a-z0-9-]; the ref
  // half may carry '/' or accents, which the codec makes path-safe
  const i = id.indexOf(':');
  const maker = i > 0 ? id.slice(0, i) : '';
  const ref = i > 0 ? id.slice(i + 1) : '';
  const target = /^[a-z0-9-]+$/.test(maker) && ref
    ? `/ref/${maker}/${encodeRefPath(ref)}`
    : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (target) {
    // redirect in flight — hold the rail-padded placeholder, never a flash
    // of the dossier that is about to be replaced
    return <div className="rail" aria-busy="true" style={{ paddingTop: 28, paddingBottom: 40, minHeight: '60vh' }} />;
  }
  return <RefPage key={id} refKey={id} />;
}

export default function RefQueryPage() {
  return (
    // useSearchParams under output:'export' must sit inside <Suspense>; the
    // minimal rail-padded placeholder paints structure, never a blank flash.
    <Suspense fallback={<div className="rail" aria-busy="true" style={{ paddingTop: 28, paddingBottom: 40, minHeight: '60vh' }} />}>
      <RefFromQuery />
    </Suspense>
  );
}
