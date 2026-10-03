/**
 * api.ts — the read-only lot API (Cloudflare Pages Functions, mounted by
 * functions/api/[[path]].ts). No framework: one tiny router, strict input
 * validation, every answer edge-cached under the corpus version.
 *
 *   GET /api/version                         { version, lastCrawl }
 *   GET /api/lot/:id                         one lot (the served row)
 *   GET /api/lots?ids=a,b,…                  ≤60 lots by id (missing ids omitted)
 *   GET /api/comps?lot=:id                   the lot's comp reads (LotPack superset)
 *   GET /api/maker/:slug?view=summary        the maker's book in columns (charts/hero)
 *   GET /api/maker/:slug?sort=&cat=&sport=&page=&size=   the maker's sold table, paged
 *   GET /api/archive?market=&sort=&cat=&sport=&page=&size=   the home archive table, paged
 *   GET /api/market/:key?view=summary        a market's book in columns (/analytics pools)
 *   GET /api/ref/:maker/:ref?page=&size=     one watch reference's sold rows, paged
 *   GET /api/settled-flags?market=           the settled below-market flags (/receipts)
 *
 * Paged tables: sort=date (newest first, round-robined across houses — the
 * PastResults order) | price (highest first); size ≤ MAX_SIZE.
 */
import type { AuctionLot } from '../../app/types';
import { ARTISTS, MARKETS } from '../../app/constants';
import { decodeScopeIndex, ID_RE, SLUG_RE, type ScopeIndex } from './format';
import { Store, NotFound, StoreUnavailable, type Env } from './store';
import { compsFor, slimRow } from './comps-api';

export const MAX_SIZE = 200;
const MAX_PAGE = 5000;
const MAX_IDS = 60;
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

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });
}
function errorResponse(status: number, error: string): Response {
  return json({ error }, status, { 'Cache-Control': 'no-store', ...(status === 503 ? { 'Retry-After': '30' } : {}) });
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
  if (v.length > 60 || /[\u0000-\u001f<>]/.test(v)) throw new BadRequest(`bad ${k}`);
  return v;
}
function lotId(v: string | null): string {
  if (!v || !ID_RE.test(v)) throw new BadRequest('bad lot id');
  return v;
}

// ── paged tables over a scope index ────────────────────────────────────────
export interface TableQuery { sort: 'date' | 'price'; cat: string | null; sport: string | null; page: number; size: number }

/** PastResults' filter + order, over the index columns. Returns base indices. */
export function orderScope(ix: ScopeIndex, q: Pick<TableQuery, 'sort' | 'cat' | 'sport'>): Int32Array {
  const { head } = ix;
  const n = head.n;
  const catId = q.cat == null ? -1 : head.cats.indexOf(q.cat);
  // the sport filter applies only where PastResults shows sport chips
  const sportOn = !!head.facetSports && q.sport != null;
  const sportId = sportOn ? head.sports.indexOf(q.sport === 'Other' ? '' : q.sport!) : -1;
  if ((q.cat != null && catId < 0) || (sportOn && sportId < 0)) return new Int32Array(0);
  const keep = (i: number) => (catId < 0 || ix.cat[i] === catId) && (!sportOn || ix.sport[i] === sportId);
  const out = new Int32Array(n);
  let k = 0;
  if (q.sort === 'price') {
    for (let j = 0; j < n; j++) { const i = ix.byPrice[j]; if (keep(i)) out[k++] = i; }
    return out.subarray(0, k);
  }
  // date: newest first, then woven round-robin across houses in order of
  // each house's first appearance — so one high-volume house never buries
  // the rest (PastResults' exact weave)
  const queues = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (!keep(i)) continue;
    let qh = queues.get(ix.house[i]);
    if (!qh) { qh = []; queues.set(ix.house[i], qh); }
    qh.push(i);
  }
  const qs = Array.from(queues.values());
  if (qs.length < 2) {
    for (const qh of qs) for (const i of qh) out[k++] = i;
    return out.subarray(0, k);
  }
  const longest = qs.reduce((m, qh) => Math.max(m, qh.length), 0);
  for (let r = 0; r < longest; r++) for (const qh of qs) if (r < qh.length) out[k++] = qh[r];
  return out.subarray(0, k);
}

async function scopeIndex(store: Store, scope: string): Promise<ScopeIndex | null> {
  return store.cached(`x:${scope}`, async () => {
    const b = await store.raw(`x:${scope}`);
    return b ? decodeScopeIndex(b) : null;
  }, 'big');
}

async function table(store: Store, scope: string, sp: URLSearchParams) {
  // the tables list SOLD rows only (status kept explicit for future tiers)
  enumParam(sp, 'status', ['sold'] as const, 'sold');
  const q: TableQuery = {
    sort: enumParam(sp, 'sort', ['date', 'price'] as const, 'date'),
    cat: labelParam(sp, 'cat'),
    sport: labelParam(sp, 'sport'),
    page: intParam(sp, 'page', 0, 0, MAX_PAGE),
    size: intParam(sp, 'size', 20, 1, MAX_SIZE),
  };
  const ix = await scopeIndex(store, scope);
  if (!ix) {
    // a known maker/market with no sold rows: an honest empty table
    return { total: 0, page: q.page, size: q.size, rows: [], facets: { cats: [], sports: null } };
  }
  const order = orderScope(ix, q);
  const slice = order.subarray(q.page * q.size, q.page * q.size + q.size);
  const rows = await store.rowsAt(Array.from(slice, i => ix.pos[i]));
  return {
    total: order.length, page: q.page, size: q.size,
    rows: rows.map(slimRow),
    facets: { cats: ix.head.facetCats, sports: ix.head.facetSports },
  };
}

async function summary(store: Store, scope: string): Promise<Response> {
  const gz = await store.raw(`s:${scope}`);
  if (!gz) return json({ v: 1, scope, n: 0, dict: { a: [], s: [], c: [], h: [], sp: [], pl: [], pn: [], d: [] }, cols: { a: [], s: [], c: [], h: [], sp: [], pl: [], d: [], p: [], el: [], eh: [] }, top: [] });
  // already gzip JSON — hand the bytes through untouched (no parse, no CPU)
  return new Response(gz as BodyInit, {
    headers: { ...BASE_HEADERS, 'Content-Encoding': 'gzip' },
    // Workers: keep our gzip as-is instead of re-encoding the body
    ...({ encodeBody: 'manual' } as ResponseInit),
  });
}

// ── routes ─────────────────────────────────────────────────────────────────
async function route(store: Store, path: string[], sp: URLSearchParams): Promise<Response> {
  const [head, a, b] = path;
  switch (head) {
    case 'version': {
      if (path.length !== 1) break;
      const m = await store.manifest();
      return json({ version: store.version, lastCrawl: m.lastCrawl, generatedAt: m.generatedAt });
    }
    case 'lot': {
      if (path.length !== 2) break;
      const row = await store.rowById(lotId(a));
      if (!row) throw new NotFound();
      return json({ lot: slimRow(row) });
    }
    case 'lots': {
      if (path.length !== 1) break;
      const raw = (sp.get('ids') || '').split(',').filter(Boolean);
      if (!raw.length || raw.length > MAX_IDS) throw new BadRequest(`ids: 1..${MAX_IDS} lot ids`);
      const ids = Array.from(new Set(raw.map(lotId)));
      const got = await store.rowsById(ids);
      const lots: Record<string, unknown> = {};
      got.forEach((r, id) => { lots[id] = slimRow(r); });
      return json({ lots });
    }
    case 'comps': {
      if (path.length !== 1) break;
      const id = lotId(sp.get('lot'));
      const row = await store.rowById(id);
      if (!row) throw new NotFound();
      return json(await compsFor(store, row as unknown as AuctionLot));
    }
    case 'maker': {
      if (path.length !== 2 || !SLUG_RE.test(a) || !MAKER_SLUGS.has(a)) break;
      if (sp.get('view') === 'summary') return summary(store, `m:${a}`);
      return json(await table(store, `m:${a}`, sp));
    }
    case 'archive': {
      if (path.length !== 1) break;
      const market = sp.get('market') || 'all';
      if (!MARKET_KEYS.has(market)) throw new BadRequest('unknown market');
      return json(await table(store, `k:${market}`, sp));
    }
    case 'market': {
      if (path.length !== 2 || !MARKET_KEYS.has(a)) break;
      if (sp.get('view') !== 'summary') throw new BadRequest('view=summary');
      return summary(store, `k:${a}`);
    }
    case 'ref': {
      if (path.length !== 3 || !SLUG_RE.test(a) || !MAKER_SLUGS.has(a)) break;
      const ref = b || '';  // already decoded per path segment
      if (!ref || ref.length > 80 || /[\u0000-\u001f]/.test(ref)) throw new BadRequest('bad reference');
      const page = intParam(sp, 'page', 0, 0, MAX_PAGE);
      const size = intParam(sp, 'size', 50, 1, MAX_SIZE);
      const rows = await store.partition(`r|${a}|${ref.toLowerCase().replace(/\|/g, '/')}`);
      return json({ total: rows.length, page, size, rows: rows.slice(page * size, page * size + size).map(slimRow) });
    }
    case 'settled-flags': {
      if (path.length !== 1) break;
      const market = sp.get('market') || 'all';
      if (!MARKET_KEYS.has(market)) throw new BadRequest('unknown market');
      const all = (await store.json<{ m: string; row: Record<string, unknown> }[]>('z:settled')) || [];
      const rows = all.filter(x => market === 'all' || x.m === market).slice(0, 50).map(x => x.row);
      return json({ rows });
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
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method not allowed' }, 405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
  }
  // same-origin only: a browser on another site gets nothing (no CORS headers
  // are ever sent, and cross-site fetch metadata is refused outright)
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') return errorResponse(403, 'cross-site');
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(s => {
    try { return decodeURIComponent(s); } catch { return '\u0000'; }
  });
  if (path.length === 0 || path.length > 3 || url.search.length > 2000) return errorResponse(400, 'bad path');

  let store: Store;
  try { store = await Store.open(env); } catch { return errorResponse(503, 'corpus unavailable'); }
  const etag = `"${store.version}"`;
  const inm = request.headers.get('If-None-Match');
  if (inm && inm.split(',').map(s => s.trim().replace(/^W\//, '')).includes(etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': CLIENT_CC } });
  }
  const key = cacheKeyOf(url, store.version);
  const finish = (res: Response) => {
    const h = new Headers(res.headers);
    h.set('ETag', etag);
    h.set('Cache-Control', CLIENT_CC);
    h.set('X-Corpus-Version', store.version);
    return new Response(request.method === 'HEAD' ? null : res.body, { status: res.status, headers: h, ...({ encodeBody: 'manual' } as ResponseInit) });
  };
  if (cache) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return finish(hit);
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
    const stored = res.clone();
    const h = new Headers(stored.headers);
    h.set('Cache-Control', EDGE_CC);
    const p = cache.put(key, new Response(stored.body, { status: 200, headers: h, ...({ encodeBody: 'manual' } as ResponseInit) })).catch(() => { /* best effort */ });
    if (ctx.waitUntil) ctx.waitUntil(p); else await p;
  }
  return finish(res);
}
