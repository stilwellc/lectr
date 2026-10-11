'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { aliasOf } from '../lib/entity/aliases';

/**
 * The query dossiers (/player?id=, /entity?id=) ship ONE static shell, so the
 * HTML can't name a per-id canonical. When the id has a static alias
 * (/p/<slug>, /e/<slug> — app/lib/seo-entities, carried in the bundle by
 * app/lib/entity/aliases) this declares it as the canonical (React 19 hoists
 * the <link> into <head>) and moves the reader onto it with a client-side
 * replace — the query URL leaves history, so Back skips it, and the address
 * bar holds the URL whose share preview is the name's own. Any other search
 * params and the hash ride along. Renders nothing for an id without one.
 */
export default function AliasCanonical({ id }: { id: string }) {
  const router = useRouter();
  const path = id ? aliasOf(id) : null;
  useEffect(() => {
    if (!path) return;
    const sp = new URLSearchParams(window.location.search);
    sp.delete('id');
    const q = sp.toString();
    router.replace(`${path}${q ? `?${q}` : ''}${window.location.hash}`, { scroll: false });
  }, [path, router]);
  return path ? <link rel="canonical" href={`https://lectr.bid${path}`} /> : null;
}
