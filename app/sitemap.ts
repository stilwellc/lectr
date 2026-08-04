import fs from 'fs';
import path from 'path';
import type { MetadataRoute } from 'next';
import { ARTISTS, MARKETS } from './constants';
import { flaggedLots } from './lot/flagged';
import { encodeRefPath } from './ref/ref-path';

/** dossier slugs from the served build data (same fs pattern as flagged.ts) */
function drillPaths(): string[] {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'ray', 'market.json'), 'utf8'));
    const out: string[] = [];
    for (const rows of Object.values(m.drills || {}) as { slug: string }[][]) {
      for (const r of rows) {
        const i = r.slug.indexOf(':');
        if (i > 0) out.push(`/sub/${r.slug.slice(0, i)}/${encodeURIComponent(r.slug.slice(i + 1))}`);
      }
    }
    return out;
  } catch { return []; }
}
function refPaths(): string[] {
  try {
    const refs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'ray', 'refs.json'), 'utf8'));
    // refs.json is {refs:[{key,...}]} — an array, not a keyed object. Object.keys
    // on it yields numeric indices, none containing ':', which silently emitted
    // ZERO of the 613 /ref pages until the GA audit caught it.
    const list: { key: string }[] = Array.isArray(refs) ? refs : Array.isArray(refs.refs) ? refs.refs : [];
    const keys: string[] = list.map(r => r.key);
    return keys
      .filter(k => typeof k === 'string' && k.includes(':'))
      // encodeRefPath, NOT encodeURIComponent — the route decodes the `~`
      // codec, so percent-encoded slash refs 404 (42 refs + panthère).
      .map(k => { const i = k.indexOf(':'); return `/ref/${k.slice(0, i)}/${encodeRefPath(k.slice(i + 1))}`; });
  } catch { return []; }
}

const BASE = 'https://lectr.bid';

/** Static sitemap (works under output: 'export') — gives Googlebot a discovery
 *  path to all 40 routes, since the client-rendered nav exposes none in the
 *  first HTML pass. The static flagged-lot permalinks (/lot/<id>, the same
 *  build-time set app/lot/[id] prerenders) are appended so each night's
 *  below-market calls are crawlable the day they're flagged. */
export default function sitemap(): MetadataRoute.Sitemap {
  const liveMarkets = MARKETS.filter(m => m.live && m.key !== 'all').map(m => m.key);
  const staticRoutes = ['', '/art', '/design', '/watches', '/science', '/sports', '/culture', '/value', '/analytics', '/makers', '/about', '/blog',
    '/blog/how-we-built-the-pricing-engine', '/blog/q2-2026-art', '/blog/q2-2026-watches', '/blog/q2-2026-design', '/blog/q2-2026-sports', '/blog/q2-2026-science', '/blog/corrections',
    ...liveMarkets.map(k => `/analytics/${k}`),
    ...liveMarkets.map(k => `/value/${k}`),
    ...liveMarkets.map(k => `/makers/m/${k}`)];
  const now = new Date().toISOString().slice(0, 10);
  return [
    ...staticRoutes.map(r => ({ url: `${BASE}${r}`, lastModified: now, changeFrequency: 'daily' as const, priority: r === '' ? 1 : 0.7 })),
    ...ARTISTS.map(a => ({ url: `${BASE}/makers/${a.slug}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.6 })),
    ...drillPaths().map(u => ({ url: `${BASE}${u}`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.5 })),
    ...refPaths().map(u => ({ url: `${BASE}${u}`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.4 })),
    ...flaggedLots().map(l => ({ url: `${BASE}/lot/${encodeURIComponent(l.id)}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.5 })),
  ];
}
