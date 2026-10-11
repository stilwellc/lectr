import fs from 'fs';
import path from 'path';
import type { MetadataRoute } from 'next';
import { MARKETS } from './constants';
import { flaggedLots } from './lot/flagged';
import { encodeRefPath } from './ref/ref-path';
import { PAGE_MAKERS } from './lib/entity/retired';
import { decodeEntities, isEntitiesWire } from './lib/entity/wire';
import type { EntitySummary } from './lib/entity/model';

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

/** (r8, QA3 P3) the player and entity pages (/player?id=, /entity?id=) —
 *  the deepest names lectr tracks, from the served entities files (main +
 *  tail; same fs pattern as above). Each summary's own `page` is its
 *  canonical href. Only pages backed by real history (the page's own bar:
 *  ten sales) and only the top `n` per kind by sales tracked, so the map
 *  stays the deep end of the roster, not every one-sale name. */
function entityPaths(n = 300): { players: string[]; entities: string[] } {
  const out = { players: [] as string[], entities: [] as string[] };
  try {
    const dir = path.join(process.cwd(), 'public', 'data', 'ray', 'pages');
    const all: EntitySummary[] = [];
    for (const f of ['entities-all.json', 'entities-all-tail.json']) {
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) continue;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const file = isEntitiesWire(j) ? decodeEntities(j) : j;
      if (Array.isArray(file?.entities)) all.push(...file.entities);
    }
    const seen = new Set<string>();
    const top = (pick: (e: EntitySummary) => boolean, prefix: string) => all
      .filter(e => pick(e) && (e.sold ?? 0) >= 10 && typeof e.page === 'string' && e.page.startsWith(prefix))
      .sort((a, b) => (b.sold ?? 0) - (a.sold ?? 0) || a.id.localeCompare(b.id))
      .filter(e => (seen.has(e.page!) ? false : (seen.add(e.page!), true)))
      .slice(0, n)
      .map(e => e.page!);
    out.players = top(e => e.kind === 'player', '/player?id=');
    out.entities = top(e => e.kind === 'subject' || e.kind === 'set', '/entity?id=');
  } catch { /* a data-less checkout: no entity pages to list */ }
  return out;
}

const BASE = 'https://lectr.bid';

/** Static sitemap (works under output: 'export') — gives Googlebot a discovery
 *  path to all 40 routes, since the client-rendered nav exposes none in the
 *  first HTML pass. The static flagged-lot permalinks (/lot/<id>, the same
 *  build-time set app/lot/[id] prerenders) are appended so each night's
 *  below-market calls are crawlable the day they're flagged. */
// Next 15+ requires route handlers (sitemap/OG) to opt into static under output:'export'.
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const liveMarkets = MARKETS.filter(m => m.live && m.key !== 'all').map(m => m.key);
  const staticRoutes = ['', '/art', '/design', '/watches', '/science', '/sports', '/culture', '/value', '/analytics', '/makers', '/about', '/blog',
    '/blog/how-we-built-the-pricing-engine', '/blog/q2-2026-art', '/blog/q2-2026-watches', '/blog/q2-2026-design', '/blog/q2-2026-sports', '/blog/q2-2026-science', '/blog/corrections',
    ...liveMarkets.map(k => `/analytics/${k}`),
    ...liveMarkets.map(k => `/value/${k}`),
    ...liveMarkets.map(k => `/makers/m/${k}`)];
  const now = new Date().toISOString().slice(0, 10);
  const ent = entityPaths();
  return [
    ...staticRoutes.map(r => ({ url: `${BASE}${r}`, lastModified: now, changeFrequency: 'daily' as const, priority: r === '' ? 1 : 0.7 })),
    ...PAGE_MAKERS.map(slug => ({ url: `${BASE}/makers/${slug}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.6 })),
    ...ent.players.map(u => ({ url: `${BASE}${u}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.6 })),
    ...ent.entities.map(u => ({ url: `${BASE}${u}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.5 })),
    ...drillPaths().map(u => ({ url: `${BASE}${u}`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.5 })),
    ...refPaths().map(u => ({ url: `${BASE}${u}`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.4 })),
    ...flaggedLots().map(l => ({ url: `${BASE}/lot/${encodeURIComponent(l.id)}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.5 })),
  ];
}
