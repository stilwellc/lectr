import type { MetadataRoute } from 'next';
import { ARTISTS } from './constants';

const BASE = 'https://lectr.bid';

/** Static sitemap (works under output: 'export') — gives Googlebot a discovery
 *  path to all 40 routes, since the client-rendered nav exposes none in the
 *  first HTML pass. */
export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ['', '/art', '/design', '/watches', '/science', '/sports', '/value', '/analytics', '/artists', '/about', '/blog',
    '/blog/how-we-built-the-pricing-engine', '/blog/q2-2026-art', '/blog/q2-2026-watches', '/blog/q2-2026-design', '/blog/q2-2026-sports', '/blog/q2-2026-science'];
  const now = new Date().toISOString().slice(0, 10);
  return [
    ...staticRoutes.map(r => ({ url: `${BASE}${r}`, lastModified: now, changeFrequency: 'daily' as const, priority: r === '' ? 1 : 0.7 })),
    ...ARTISTS.map(a => ({ url: `${BASE}/${a.slug}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.6 })),
  ];
}
