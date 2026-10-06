/**
 * store.ts — the read side of the R2 layout (format.ts).
 *
 * COLD START (Oct 3–5: the first request after a nightly took 32s). A cold
 * isolate used to walk pointer → dir.bin → manifest → loc shard → loc shard →
 * answer, every hop a serial R2 round trip (~100–200ms each at the edge, far
 * worse right after the night's upload). Now:
 *
 *   - the pointer carries the loc-shard directory inline (format.ts locDir)
 *     and blob n is always blobKey(n): a table/summary request is pointer →
 *     loc shard → answer, no dir.bin and no manifest on the path;
 *   - the small immutable index reads (dir.bin, id buckets, loc shards) go
 *     through the colo's Cache API, so one cold isolate pays R2 for them and
 *     every other isolate in that colo reads them in a few ms;
 *   - the pointer is a per-isolate memo, fresh for 60s, then served stale
 *     while one background refresh runs (never on a request's critical path
 *     unless the isolate sat idle > 10 min), and colo-cached for 30s.
 *
 * CPU stays a few small parses per request (Free plan, 10ms).
 */
import { ID_BUCKETS, LOC_SHARDS, blobKey, idBucketOf, locShardOf, type Current, type IdEntry, type Loc, type Manifest, type PagedLoc } from './format';

/** The slice of the R2 binding this API uses (R2Bucket in workers-types). */
export interface R2ObjectBodyLike {
  body?: ReadableStream | null;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}
export interface R2BucketLike {
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<R2ObjectBodyLike | null>;
}
export interface Env { CORPUS?: R2BucketLike }

/** Cache API surface (caches.default in Workers) — optional so Node tests run. */
export interface EdgeCache { match(req: Request): Promise<Response | undefined>; put(req: Request, res: Response): Promise<void> }
/** what a request lends the store: the colo cache, its origin (cache keys
 *  live under the site's own host) and waitUntil for background work */
export interface StoreIO { cache?: EdgeCache | null; origin?: string; waitUntil?(p: Promise<unknown>): void }

export class NotFound extends Error {}
export class StoreUnavailable extends Error {}

const POINTER_FRESH_MS = 60_000;
const POINTER_STALE_MS = 10 * 60_000;
const POINTER_EDGE_S = 30;
/** versioned objects are write-once: the colo copy can live as long as the version */
const IMMUTABLE_EDGE_S = 3 * 86400;
const STORE_PATH = '/__store/';
/** Cache API calls count against the Free plan's 50 subrequests a request
 *  (R2 binding calls have their own, far larger allowance): a 12-id
 *  /api/lots on a cold isolate stops using the colo cache past this many */
const CACHE_OPS_PER_REQUEST = 24;

let pointer: { at: number; cur: Current } | null = null;
let pointerLoad: Promise<Current> | null = null;

/** Test hook: forget every memo (the fake bucket changes between tests). */
export function resetStoreMemo() {
  pointer = null;
  pointerLoad = null;
  versions.clear();
}

function background(io: StoreIO, p: Promise<unknown>) {
  const q = p.catch(() => { /* best effort */ });
  if (io.waitUntil) io.waitUntil(q);
}
const edgeKey = (io: StoreIO, key: string): Request | null =>
  io.cache && io.origin ? new Request(`${io.origin}${STORE_PATH}${key}`, { method: 'GET' }) : null;

export function parsePointer(text: string): Current {
  let cur: Current;
  try { cur = JSON.parse(text) as Current; } catch { throw new StoreUnavailable('bad pointer'); }
  if (!cur?.version || !cur?.prefix || !/^api\/v\/[A-Za-z0-9._-]+\/$/.test(cur.prefix)) throw new StoreUnavailable('bad pointer');
  const ld = cur.locDir;
  // a malformed inline directory is ignored (dir.bin still answers), never trusted
  if (ld !== undefined && !(Array.isArray(ld) && ld.length === LOC_SHARDS * 3 && ld.every(n => Number.isInteger(n) && n >= 0))) delete cur.locDir;
  return cur;
}

async function loadPointer(bucket: R2BucketLike, io: StoreIO): Promise<Current> {
  const ck = edgeKey(io, 'api/current.json');
  if (ck) {
    const hit = await io.cache!.match(ck).catch(() => undefined);
    if (hit) {
      try { return parsePointer(await hit.text()); } catch { /* fall through to R2 */ }
    }
  }
  const obj = await bucket.get('api/current.json');
  if (!obj) throw new StoreUnavailable('api/current.json missing');
  const text = await obj.text();
  const cur = parsePointer(text);
  if (ck) background(io, io.cache!.put(ck, new Response(text, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${POINTER_EDGE_S}` } })));
  return cur;
}

export async function currentVersion(bucket: R2BucketLike, io: StoreIO = {}): Promise<Current> {
  const age = pointer ? Date.now() - pointer.at : Infinity;
  if (pointer && age < POINTER_FRESH_MS) return pointer.cur;
  if (!pointerLoad) {
    const p = loadPointer(bucket, io).then(cur => { pointer = { at: Date.now(), cur }; return cur; });
    pointerLoad = p;
    p.then(() => { pointerLoad = null; }, () => { pointerLoad = null; });
  }
  // stale but recent: answer from the memo, refresh behind the response
  if (pointer && age < POINTER_STALE_MS) { background(io, pointerLoad); return pointer.cur; }
  // long idle: wait for the fresh pointer, but an R2 hiccup still answers
  // from the last one we had (its version's objects are write-once)
  const last = pointer?.cur;
  return pointerLoad.catch(e => { if (last) return last; throw e; });
}

interface VersionMemo {
  manifest?: Promise<Manifest>;
  dir?: Promise<Uint32Array>;
  lru: Map<string, Promise<unknown>>;
}
const versions = new Map<string, VersionMemo>();
const LRU_MAX = 512;

function memoOf(cur: Current): VersionMemo {
  let m = versions.get(cur.version);
  if (!m) {
    if (versions.size > 1) versions.clear();
    m = { lru: new Map() };
    versions.set(cur.version, m);
  }
  return m;
}

/** gunzip via the platform's DecompressionStream (Workers + Node ≥18). */
export async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export class Store {
  private cacheOps = CACHE_OPS_PER_REQUEST;
  constructor(readonly bucket: R2BucketLike, readonly cur: Current, readonly io: StoreIO = {}) {}

  static async open(env: Env, io: StoreIO = {}): Promise<Store> {
    if (!env.CORPUS) throw new StoreUnavailable('no CORPUS binding');
    return new Store(env.CORPUS, await currentVersion(env.CORPUS, io), io);
  }

  get version() { return this.cur.version; }
  private get memo() { return memoOf(this.cur); }

  private async getObj(key: string): Promise<R2ObjectBodyLike> {
    const obj = await this.bucket.get(`${this.cur.prefix}${key}`);
    if (!obj) throw new StoreUnavailable(`${key} missing`);
    return obj;
  }

  /** a small write-once object (or range of one) under this version, through
   *  the colo cache: the index reads every cold isolate needs first */
  private async immutable(key: string, loc?: Loc): Promise<Uint8Array> {
    const full = `${this.cur.prefix}${key}`;
    // a match + a possible put
    const ck = this.cacheOps >= 2 ? edgeKey(this.io, loc ? `${full}?r=${loc[1]}-${loc[2]}` : full) : null;
    if (ck) this.cacheOps -= 2;
    if (ck) {
      const hit = await this.io.cache!.match(ck).catch(() => undefined);
      if (hit) return new Uint8Array(await hit.arrayBuffer());
    }
    const obj = await this.bucket.get(full, loc ? { range: { offset: loc[1], length: loc[2] } } : undefined);
    if (!obj) throw new StoreUnavailable(`${key} missing`);
    const bytes = new Uint8Array(await obj.arrayBuffer());
    if (ck) {
      background(this.io, this.io.cache!.put(ck, new Response(bytes.slice(), {
        headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': `public, max-age=${IMMUTABLE_EDGE_S}, immutable` },
      })));
    }
    return bytes;
  }

  /** /api/version only — no other read needs the manifest */
  manifest(): Promise<Manifest> {
    const m = this.memo;
    if (!m.manifest) {
      m.manifest = this.getObj('manifest.json').then(async o => JSON.parse(await o.text()) as Manifest);
      m.manifest.catch(() => { m.manifest = undefined; });
    }
    return m.manifest;
  }

  /** dir.bin: Uint32 triples — no parse, a typed view */
  private dir(): Promise<Uint32Array> {
    const m = this.memo;
    if (!m.dir) {
      m.dir = this.immutable('dir.bin').then(b => {
        if (b.byteLength !== (ID_BUCKETS + LOC_SHARDS) * 12 || b.byteOffset % 4) throw new StoreUnavailable('bad dir.bin');
        return new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4);
      });
      m.dir.catch(() => { m.dir = undefined; });
    }
    return m.dir;
  }

  /** one ranged GET of a located object (blob n is always blobKey(n)) */
  async range(loc: Loc): Promise<R2ObjectBodyLike> {
    if (!Number.isInteger(loc[0]) || loc[0] < 0) throw new StoreUnavailable('bad blob index');
    const blob = blobKey(loc[0]);
    const obj = await this.bucket.get(`${this.cur.prefix}${blob}`, { range: { offset: loc[1], length: loc[2] } });
    if (!obj) throw new StoreUnavailable(`${blob} missing`);
    return obj;
  }
  async bytes(loc: Loc): Promise<Uint8Array> {
    return new Uint8Array(await (await this.range(loc)).arrayBuffer());
  }
  async json<T>(loc: Loc): Promise<T> {
    return JSON.parse(await gunzipText(await this.bytes(loc))) as T;
  }
  /** plain (uncompressed) JSON index objects — the id buckets and loc shards */
  private async plain<T>(loc: Loc): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await this.immutable(blobKey(loc[0]), loc))) as T;
  }

  cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const lru = this.memo.lru;
    const hit = lru.get(key);
    if (hit) { lru.delete(key); lru.set(key, hit); return hit as Promise<T>; }
    const p = load();
    lru.set(key, p);
    p.catch(() => lru.delete(key));
    while (lru.size > LRU_MAX) lru.delete(lru.keys().next().value as string);
    return p;
  }

  private async dirLoc(i: number): Promise<Loc | null> {
    const ld = this.cur.locDir;
    if (ld && i >= ID_BUCKETS) {
      const j = (i - ID_BUCKETS) * 3;
      return ld[j + 2] ? [ld[j], ld[j + 1], ld[j + 2]] : null;
    }
    const d = await this.dir();
    const len = d[i * 3 + 2];
    return len ? [d[i * 3], d[i * 3 + 1], len] : null;
  }

  /** a location-table entry (summary, paged table, ref ledger, settled flags) */
  async loc(key: string): Promise<Loc | PagedLoc | null> {
    const shard = locShardOf(key);
    const t = await this.cached(`L:${shard}`, async () => {
      const l = await this.dirLoc(ID_BUCKETS + shard);
      return l ? await this.plain<Record<string, Loc | PagedLoc>>(l) : {};
    });
    return t[key] || null;
  }

  async entry(id: string): Promise<IdEntry | null> {
    const b = idBucketOf(id);
    const m = await this.cached(`B:${b}`, async () => {
      const l = await this.dirLoc(b);
      return l ? await this.plain<Record<string, IdEntry>>(l) : {};
    });
    return m[id] || null;
  }

  /** the stored lot row, as its JSON text (spliced into responses unparsed) */
  async rowText(e: IdEntry): Promise<string> {
    return (await this.range([e[0], e[1], e[2]])).text();
  }

  async rowTextsById(ids: string[]): Promise<Map<string, string>> {
    const entries = await Promise.all(ids.map(id => this.entry(id)));
    const out = new Map<string, string>();
    await Promise.all(entries.map(async (e, i) => { if (e) out.set(ids[i], await this.rowText(e)); }));
    return out;
  }
}
