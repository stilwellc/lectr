'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SubPage from './SubPage';
import SubIndex from './SubIndex';

/**
 * LEGACY query shell — /sub?id=<group>:<part> now lives at /sub/<group>/<part>
 * (static, per-dossier metadata; audit-urls §3–4). Cloudflare `_redirects`
 * cannot match query strings, so this client redirector IS the migration
 * path: a well-formed ?id= is router.replace()'d to the path form; keep for
 * at least one crawl cycle. No/malformed id keeps the old inline not-found
 * rendering (SubPage's own empty state) — kinder than bouncing a junk id
 * onto the site 404. No id at all is the INDEX — every tracked sub-market,
 * grouped by category (SubIndex).
 */
function SubFromQuery() {
  const router = useRouter();
  const params = useSearchParams();
  const id = (params.get('id') || '').trim().toLowerCase();
  // every real drill slug is [a-z0-9-]+:[a-z0-9-]+ — only that shape maps to
  // an emitted static page, so only that shape redirects
  const m = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(id);
  const target = m ? `/sub/${m[1]}/${m[2]}` : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (target) {
    // redirect in flight — hold the rail-padded placeholder, never a flash
    // of the dossier that is about to be replaced
    return <div className="rail" aria-busy="true" style={{ paddingTop: 28, paddingBottom: 40, minHeight: '60vh' }} />;
  }
  if (!id) return <SubIndex />;
  return <SubPage key={id} slug={id} />;
}

export default function SubQueryPage() {
  return (
    // useSearchParams under output:'export' must sit inside <Suspense>; the
    // minimal rail-padded placeholder paints structure, never a blank flash.
    <Suspense fallback={<div className="rail" aria-busy="true" style={{ paddingTop: 28, paddingBottom: 40, minHeight: '60vh' }} />}>
      <SubFromQuery />
    </Suspense>
  );
}
