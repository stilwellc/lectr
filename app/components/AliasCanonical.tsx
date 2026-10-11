'use client';

import { useEffect, useState } from 'react';

/**
 * The query dossiers (/player?id=, /entity?id=) ship ONE static shell, so the
 * HTML can't name a per-id canonical. When the id has a static alias
 * (/p/<slug>, /e/<slug> — app/lib/seo-entities), this declares it once the
 * build's alias manifest lands, consolidating the query URL onto the page
 * that carries the real title, share card and structured data. React 19
 * hoists the <link> into <head>. Renders nothing for an id without an alias.
 */
let manifest: Promise<Record<string, string>> | null = null;
function aliases(): Promise<Record<string, string>> {
  if (!manifest) {
    manifest = fetch('/entity-paths.json')
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return manifest;
}

export default function AliasCanonical({ id }: { id: string }) {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setPath(null);
    if (id) aliases().then(m => { if (live) setPath(typeof m[id] === 'string' ? m[id] : null); });
    return () => { live = false; };
  }, [id]);
  return path ? <link rel="canonical" href={`https://lectr.bid${path}`} /> : null;
}
