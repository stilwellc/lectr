/**
 * api.ts — the read-only lot API (Cloudflare Pages Functions, mounted by
 * functions/api/[[path]].ts). No framework: one tiny router, strict input
 * validation, edge-cached under the corpus version.
 *
 * FREE PLAN (10ms CPU/request): every answer is precomputed nightly
 * (scripts/emit-r2-index.ts). A request is a key lookup and, for most routes,
 * a pass-through of stored gzip bytes — the edge never computes a comp,
 * sorts a table or scans a pool.
 *
 *   GET /api/version                          { version, lastCrawl, … }
 *   GET /api/lot/:id                          one lot (the served row)
 *   GET /api/lots?ids=a,b,…                   ≤12 lots by id (missing ids omitted)
 *   GET /api/comps?lot=:id                    the lot's precomputed comp reads
 *                                             ({ np: true } outside the coverage window)
 *   GET /api/maker/:slug?view=summary         the maker's book in columns
 *   GET /api/maker/:slug?sort=&cat=&sport=&page=   the maker's sold table (20/page)
 *   GET /api/archive?market=&sort=&cat=&sport=&page=   the market's sold table
 *   GET /api/market/:key?view=summary         a market's book in columns
 *   GET /api/ref/:maker/:ref?page=            a watch reference's sold rows (50/page)
 *   GET /api/settled-flags?market=            settled Below Market flags
 */
import { ARTISTS, MARKETS } from '../../app/constants';
import {
  ID_RE, MAX_IDS, REF_PAGE, SLUG_RE, TABLE_PAGE, pageRange, refKey, tableKey,
  type Loc, type PagedLoc, type TablePageBody,
} from './format';
import { Store, NotFound, StoreUnavailable, type Env, type R2ObjectBodyLike } from './store';

const MAX_PAGE = 5000;
const MAKER_SLUGS = new Set<string>(ARTISTS.map(a => a.slug));
const MARKET_KEYS = new Set<string>(MARKETS.map(m => m.key));

class BadRequest extends Error {}

/** Cache API surface (caches.default in Workers) — optional so Node tests run. */
interface EdgeCache { match(req: Request): Promise<Response | undefined>; put(req: Request, res: Response): Promise<void> }
export interface Ctx { waitUntil?(p: Promise<unknown>): void }

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
// browsers revalidate after 5 min (a 304 is a few bytes); the edge copy is
// keyed by version, so it can live a day — a new nightly is a new key
const CLIENT_CC = 'public, max-age=300, stale-while-revalidate=3600';
const EDGE_CC = 'public, max-age=86400';
// Workers: hand our gzip bytes through as-is instead of re-encoding the body
const MANUAL = { encodeBody: 'manual' } as ResponseInit;

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });
}
function errorResponse(status: number, error: string): Response {
  return json({ error }, status, { 'Cache-Control': 'no-store', ...(status === 503 ? { 'Retry-After': '30' } : {}) });
}
/** stored gzip JSON → the response, untouched (no parse, no CPU) */
async function gzipThrough(obj: R2ObjectBodyLike): Promise<Response> {
  const body = obj.body ?? new Uint8Array(await obj.arrayBuffer());
  return new Response(body as BodyInit, { status: 200, headers: { ...BASE_HEADERS, 'Content-Encoding': 'gzip' }, ...MANUAL });
}

// ── input validation ───────────────────────────────────────────────────────
function intParam(sp: URLSearchParams, k: string, def: number, min: number, max: number): number {
  const v = sp.get(k);
  if (v == null || v === '') return def;
  if (!/^\d{1,6}$/.test(v)) throw new BadRequest(`${k} must be an integer`);
  const n = Number(v);
  if (n < min || n > max) throw new BadRequest(`${k} out of range ${min}..${max}`);
  return n;
}
function enumParam<T extends string>(sp: URLSearchParams, k: string, allowed: readonly T[], def: T): T {
  const v = sp.get(k);
  if (v == null || v === '') return def;
  if (!(allowed as readonly string[]).includes(v)) throw new BadRequest(`${k} must be one of ${allowed.join('|')}`);
  return v as T;
}
function labelParam(sp: URLSearchParams, k: string): string | null {
  const v = sp.get(k);
  if (v == null || v === '' || v === 'all') return null;
  if (v.length > 60 || /[\u0000-\u001f<>|*]/.test(v)) throw new BadRequest(`bad ${k}`);
  return v;
}
function lotId(v: string | null): string {
  if (!v || !ID_RE.test(v)) throw new BadRequest('bad lot id');
  return v;
}

// ── paged objects ──────────────────────────────────────────────────────────
type Facets = TablePageBody['facets'];
async function pagedResponse(store: Store, key: string, page: number, size: number, facets: Facets | null): Promise<Response> {
  const p = (await store.loc(key)) as PagedLoc | null;
  if (!p) return json({ total: 0, page, size, rows: [], facets: facets || { cats: [], sports: null }, capped: false });
  const r = pageRange(p, page);
  if (r) return gzipThrough(await store.range(r as Loc));
  // past the last stored page: honest end (capped = the table goes deeper
  // than the materialized pages; narrow the filter or flip the sort)
  const total = p[2];
  return json({ total, page, size, rows: [], facets: facets || { cats: [], sports: null }, capped: page * size < total });
}

async function table(store: Store, scope: string, sp: URLSearchParams): Promise<Response> {
  enumParam(sp, 'status', ['sold'] as const, 'sold');
  const sort = enumParam(sp, 'sort', ['date', 'price'] as const, 'date');
  const cat = labelParam(sp, 'cat');
  const sport = labelParam(sp, 'sport');
  const page = intParam(sp, 'page', 0, 0, MAX_PAGE);
  intParam(sp, 'size', TABLE_PAGE, TABLE_PAGE, TABLE_PAGE); // fixed page size
  const facets = (await store.loc(`f:${scope}`)) as unknown as Facets | null;
  return pagedResponse(store, tableKey(scope, sort, cat, sport), page, TABLE_PAGE, facets);
}

async function located(store: Store, key: string): Promise<Response | null> {
  const l = (await store.loc(key)) as Loc | null;
  return l ? gzipThrough(await store.range(l)) : null;
}

// ── routes ─────────────────────────────────────────────────────────────────
async function route(store: Store, path: string[], sp: URLSearchParams): Promise<Response> {
  const [head, a, b] = path;
  switch (head) {
    case 'version': {
      if (path.length !== 1) break;
      const m = await store.manifest();
      return json({ version: store.version, lastCrawl: m.lastCrawl, generatedAt: m.generatedAt, compsWindow: m.compsWindow });
    }
    case 'lot': {
      if (path.length !== 2) break;
      const e = await store.entry(lotId(a));
      if (!e) throw new NotFound();
      // the stored row is plain JSON — spliced in, never parsed
      return new Response(`{"lot":${await store.rowText(e)}}`, { headers: BASE_HEADERS });
    }
    case 'lots': {
      if (path.length !== 1) break;
      const raw = (sp.get('ids') || '').split(',').filter(Boolean);
      if (!raw.length || raw.length > MAX_IDS) throw new BadRequest(`ids: 1..${MAX_IDS} lot ids`);
      const got = await store.rowTextsById(Array.from(new Set(raw.map(lotId))));
      const parts: string[] = [];
      got.forEach((t, id) => { parts.push(`${JSON.stringify(id)}:${t}`); });
      return new Response(`{"lots":{${parts.join(',')}}}`, { headers: BASE_HEADERS });
    }
    case 'comps': {
      if (path.length !== 1) break;
      const id = lotId(sp.get('lot'));
      const e = await store.entry(id);
      if (!e) throw new NotFound();
      // outside the precompute window: say so (the surface prints it)
      if (e.length < 4) return json({ id, np: true, pack: {}, ctx: [], exact: null });
      // computed, nothing a surface would print
      if (e[3] === -1) return json({ id, pack: {}, ctx: [], exact: null });
      return gzipThrough(await store.range([e[3], e[4], e[5]]));
    }
    case 'maker': {
      if (path.length !== 2 || !SLUG_RE.test(a) || !MAKER_SLUGS.has(a)) break;
      if (sp.get('view') === 'summary') return (await located(store, `s:m:${a}`)) ?? (() => { throw new NotFound(); })();
      return table(store, `m:${a}`, sp);
    }
    case 'archive': {
      if (path.length !== 1) break;
      const market = sp.get('market') || 'all';
      if (!MARKET_KEYS.has(market)) throw new BadRequest('unknown market');
      return table(store, `k:${market}`, sp);
    }
    case 'market': {
      if (path.length !== 2 || !MARKET_KEYS.has(a)) break;
      if (sp.get('view') !== 'summary') throw new BadRequest('view=summary');
      return (await located(store, `s:k:${a}`)) ?? (() => { throw new NotFound(); })();
    }
    case 'ref': {
      if (path.length !== 3 || !SLUG_RE.test(a) || !MAKER_SLUGS.has(a)) break;
      const ref = b || '';
      if (!ref || ref.length > 80 || /[\u0000-\u001f|]/.test(ref)) throw new BadRequest('bad reference');
      const page = intParam(sp, 'page', 0, 0, MAX_PAGE);
      return pagedResponse(store, refKey(a, ref), page, REF_PAGE, null);
    }
    case 'settled-flags': {
      if (path.length !== 1) break;
      const market = sp.get('market') || 'all';
      if (!MARKET_KEYS.has(market)) throw new BadRequest('unknown market');
      return (await located(store, `z:${market}`)) ?? json({ rows: [] });
    }
  }
  throw new NotFound();
}

/** Canonical cache key: sorted params + the corpus version. */
function cacheKeyOf(url: URL, version: string): Request {
  const sp = new URLSearchParams(Array.from(url.searchParams.entries()).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  sp.set('__v', version);
  return new Request(`${url.origin}${url.pathname}?${sp.toString()}`, { method: 'GET' });
}

export async function handleApi(request: Request, env: Env, ctx: Ctx = {}, cache?: EdgeCache | null): Promise<Response> {
  // instrumentation: wall time of everything after the request arrives
  // (Server-Timing). On Workers the clock only advances across I/O, so this
  // reads as R2 latency there; scripts/r2/bench-api.ts measures the CPU.
  const t0 = performance.now();
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method not allowed' }, 405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
  }
  // same-origin only: no CORS headers are ever sent, and cross-site fetch
  // metadata is refused outright
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return errorResponse(403, 'cross-site');
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(s => {
    try { return decodeURIComponent(s); } catch { return '\u0000'; }
  });
  if (path.length === 0 || path.length > 3 || url.search.length > 2000) return errorResponse(400, 'bad path');

  let store: Store;
  try { store = await Store.open(env); } catch {
    // the rollout probe: clients check /api/version once and hide or explain
    // API-backed sections — answer it plainly (200) so a not-yet-published
    // index never shows up as a failed request in the console
    if (path.length === 1 && path[0] === 'version') return json({ version: null, available: false }, 200, { 'Cache-Control': 'no-store' });
    return errorResponse(503, 'corpus unavailable');
  }
  const etag = `"${store.version}"`;
  const inm = request.headers.get('If-None-Match');
  if (inm && inm.split(',').map(s => s.trim().replace(/^W\//, '')).includes(etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': CLIENT_CC } });
  }
  const key = cacheKeyOf(url, store.version);
  const finish = (res: Response, hit: boolean) => {
    const h = new Headers(res.headers);
    h.set('ETag', etag);
    h.set('Cache-Control', CLIENT_CC);
    h.set('X-Corpus-Version', store.version);
    h.set('X-Api-Cache', hit ? 'hit' : 'miss');
    h.set('Server-Timing', `api;dur=${(performance.now() - t0).toFixed(2)}`);
    return new Response(request.method === 'HEAD' ? null : res.body, { status: res.status, headers: h, ...MANUAL });
  };
  if (cache) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return finish(hit, true);
  }
  let res: Response;
  try {
    res = await route(store, path, url.searchParams);
  } catch (e) {
    if (e instanceof BadRequest) return errorResponse(400, e.message);
    if (e instanceof NotFound) return json({ error: 'not found' }, 404, { 'Cache-Control': 'public, max-age=300', ETag: etag });
    if (e instanceof StoreUnavailable) return errorResponse(503, 'corpus unavailable');
    console.error('[api]', path.join('/'), e);
    return errorResponse(500, 'internal error');
  }
  if (cache && res.status === 200) {
    const [a, b] = res.body ? res.body.tee() : [null, null];
    const h = new Headers(res.headers);
    h.set('Cache-Control', EDGE_CC);
    const p = cache.put(key, new Response(b, { status: 200, headers: h, ...MANUAL })).catch(() => { /* best effort */ });
    if (ctx.waitUntil) ctx.waitUntil(p); else await p;
    res = new Response(a, { status: res.status, headers: res.headers, ...MANUAL });
  }
  return finish(res, false);
}
