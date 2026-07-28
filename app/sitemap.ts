import type { MetadataRoute } from 'next';
import { ARTISTS } from './constants';
import { flaggedLots } from './lot/flagged';

const BASE = 'https://lectr.bid';

/** Static sitemap (works under output: 'export') — gives Googlebot a discovery
 *  path to all 40 routes, since the client-rendered nav exposes none in the
 *  first HTML pass. The static flagged-lot permalinks (/lot/<id>, the same
 *  build-time set app/lot/[id] prerenders) are appended so each night's
 *  below-market calls are crawlable the day they're flagged. */
export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ['', '/art', '/design', '/watches', '/science', '/sports', '/culture', '/value', '/record', '/method', '/analytics', '/artists', '/about', '/blog',
    '/blog/how-we-built-the-pricing-engine', '/blog/q2-2026-art', '/blog/q2-2026-watches', '/blog/q2-2026-design', '/blog/q2-2026-sports', '/blog/q2-2026-science'];
  const now = new Date().toISOString().slice(0, 10);
  return [
    ...staticRoutes.map(r => ({ url: `${BASE}${r}`, lastModified: now, changeFrequency: 'daily' as const, priority: r === '' ? 1 : 0.7 })),
    ...ARTISTS.map(a => ({ url: `${BASE}/${a.slug}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.6 })),
    ...flaggedLots().map(l => ({ url: `${BASE}/lot/${encodeURIComponent(l.id)}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.5 })),
  ];
}
