/**
 * store.ts — the read side of the R2 layout (format.ts). Everything here is
 * per-isolate memoized and keyed by the corpus version, so a new nightly
 * version is picked up within POINTER_TTL_MS and never mixes with the old.
 */
import { CHUNK_ROWS, idBucketOf, locShardOf, locShardName, type Current, type Loc, type Manifest } from './format';

/** The slice of the R2 binding this API uses (R2Bucket in workers-types). */
export interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}
export interface R2BucketLike {
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<R2ObjectBodyLike | null>;
}
export interface Env { CORPUS?: R2BucketLike }

export class NotFound extends Error {}
export class StoreUnavailable extends Error {}

const POINTER_TTL_MS = 60_000;
let pointer: { at: number; cur: Current } | null = null;

/** Test hook: forget every memo (the fake bucket changes between tests). */
export function resetStoreMemo() {
  pointer = null;
  versions.clear();
}

export async function currentVersion(bucket: R2BucketLike): Promise<Current> {
  if (pointer && Date.now() - pointer.at < POINTER_TTL_MS) return pointer.cur;
  const obj = await bucket.get('api/current.json');
  if (!obj) throw new StoreUnavailable('api/current.json missing');
  const cur = JSON.parse(await obj.text()) as Current;
  if (!cur?.version || !cur?.prefix || !/^api\/v\/[A-Za-z0-9._-]+\/$/.test(cur.prefix)) throw new StoreUnavailable('bad pointer');
  pointer = { at: Date.now(), cur };
  return cur;
}

interface VersionMemo {
  manifest?: Promise<Manifest>;
  shards: Map<number, Promise<Record<string, Loc>>>;
  /** decoded objects reused across requests: 'small' = id buckets + row
      chunks (tens of KB each), 'big' = scope indexes (up to a few MB) */
  lru: { small: Map<string, Promise<unknown>>; big: Map<string, Promise<unknown>> };
}
const versions = new Map<string, VersionMemo>();
const LRU_MAX = { small: 256, big: 3 } as const;

function memoOf(cur: Current): VersionMemo {
  let m = versions.get(cur.version);
  if (!m) {
    // one live version per isolate (plus the one being replaced)
    if (versions.size > 1) versions.clear();
    m = { shards: new Map(), lru: { small: new Map(), big: new Map() } };
    versions.set(cur.version, m);
  }
  return m;
}

async function getJson<T>(bucket: R2BucketLike, key: string): Promise<T> {
  const obj = await bucket.get(key);
  if (!obj) throw new StoreUnavailable(`${key} missing`);
  return JSON.parse(await obj.text()) as T;
}

export class Store {
  constructor(readonly bucket: R2BucketLike, readonly cur: Current) {}

  static async open(env: Env): Promise<Store> {
    if (!env.CORPUS) throw new StoreUnavailable('no CORPUS binding');
    return new Store(env.CORPUS, await currentVersion(env.CORPUS));
  }

  get version() { return this.cur.version; }
  private get memo() { return memoOf(this.cur); }

  manifest(): Promise<Manifest> {
    const m = this.memo;
    if (!m.manifest) {
      m.manifest = getJson<Manifest>(this.bucket, `${this.cur.prefix}manifest.json`);
      m.manifest.catch(() => { m.manifest = undefined; });
    }
    return m.manifest;
  }

  private shard(n: number): Promise<Record<string, Loc>> {
    const m = this.memo;
    let p = m.shards.get(n);
    if (!p) {
      p = getJson<Record<string, Loc>>(this.bucket, `${this.cur.prefix}${locShardName(n)}`);
      m.shards.set(n, p);
      p.catch(() => m.shards.delete(n));
    }
    return p;
  }

  async loc(key: string): Promise<Loc | null> {
    const t = await this.shard(locShardOf(key));
    return t[key] || null;
  }

  /** raw bytes of one located object (a single ranged GET) */
  async bytes(loc: Loc): Promise<Uint8Array> {
    const man = await this.manifest();
    const blob = man.blobs[loc[0]];
    if (!blob) throw new StoreUnavailable('bad blob index');
    const obj = await this.bucket.get(`${this.cur.prefix}${blob}`, { range: { offset: loc[1], length: loc[2] } });
    if (!obj) throw new StoreUnavailable(`${blob} missing`);
    return new Uint8Array(await obj.arrayBuffer());
  }

  /** raw (still gzip) bytes for a key, or null when the key has no object */
  async raw(key: string): Promise<Uint8Array | null> {
    const l = await this.loc(key);
    return l ? this.bytes(l) : null;
  }

  async json<T>(key: string): Promise<T | null> {
    const b = await this.raw(key);
    return b ? JSON.parse(await gunzipText(b)) as T : null;
  }

  /** memoized decode (per isolate, per version). Comp partitions are NOT
      memoized — they can be MBs; the edge cache holds the finished answer. */
  cached<T>(key: string, load: () => Promise<T>, lane: 'small' | 'big' = 'small'): Promise<T> {
    const lru = this.memo.lru[lane];
    const hit = lru.get(key);
    if (hit) { lru.delete(key); lru.set(key, hit); return hit as Promise<T>; }
    const p = load();
    lru.set(key, p);
    p.catch(() => lru.delete(key));
    while (lru.size > LRU_MAX[lane]) lru.delete(lru.keys().next().value as string);
    return p;
  }

  // ── rows ────────────────────────────────────────────────────────────────
  private chunk(n: number): Promise<Record<string, unknown>[]> {
    return this.cached(`c:${n}`, async () => (await this.json<Record<string, unknown>[]>(`c:${n}`)) || []);
  }

  /** rows by row-store position, in the order given */
  async rowsAt(positions: number[]): Promise<Record<string, unknown>[]> {
    const chunks = Array.from(new Set(positions.map(p => Math.floor(p / CHUNK_ROWS))));
    const got = new Map<number, Record<string, unknown>[]>();
    await Promise.all(chunks.map(async c => { got.set(c, await this.chunk(c)); }));
    return positions.map(p => got.get(Math.floor(p / CHUNK_ROWS))![p % CHUNK_ROWS]).filter(Boolean);
  }

  private idBucket(b: number): Promise<Record<string, number>> {
    return this.cached(`b:${b}`, async () => (await this.json<Record<string, number>>(`b:${b}`)) || {});
  }

  async positionOf(id: string): Promise<number | null> {
    const m = await this.idBucket(idBucketOf(id));
    return typeof m[id] === 'number' ? m[id] : null;
  }

  async rowById(id: string): Promise<Record<string, unknown> | null> {
    const p = await this.positionOf(id);
    if (p == null) return null;
    const [row] = await this.rowsAt([p]);
    return row || null;
  }

  async rowsById(ids: string[]): Promise<Map<string, Record<string, unknown>>> {
    const pos = await Promise.all(ids.map(id => this.positionOf(id)));
    const found: { id: string; p: number }[] = [];
    ids.forEach((id, i) => { if (pos[i] != null) found.push({ id, p: pos[i]! }); });
    const rows = await this.rowsAt(found.map(f => f.p));
    const out = new Map<string, Record<string, unknown>>();
    for (const r of rows) out.set(String(r.id), r);
    return out;
  }

  /** a comp partition's rows ([] when the partition has no candidates) */
  async partition(key: string): Promise<Record<string, unknown>[]> {
    return (await this.json<Record<string, unknown>[]>(`p:${key}`)) || [];
  }
}

/** gunzip via the platform's DecompressionStream (Workers + Node ≥18). */
export async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
