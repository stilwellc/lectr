/**
 * store.ts — the read side of the R2 layout (format.ts). Per-isolate memos
 * (pointer 60s; manifest + dir.bin + small decoded objects per version) keep
 * the per-request CPU to a few small parses.
 */
import { ID_BUCKETS, LOC_SHARDS, idBucketOf, locShardOf, type Current, type IdEntry, type Loc, type Manifest, type PagedLoc } from './format';

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
  constructor(readonly bucket: R2BucketLike, readonly cur: Current) {}

  static async open(env: Env): Promise<Store> {
    if (!env.CORPUS) throw new StoreUnavailable('no CORPUS binding');
    return new Store(env.CORPUS, await currentVersion(env.CORPUS));
  }

  get version() { return this.cur.version; }
  private get memo() { return memoOf(this.cur); }

  private async getObj(key: string): Promise<R2ObjectBodyLike> {
    const obj = await this.bucket.get(`${this.cur.prefix}${key}`);
    if (!obj) throw new StoreUnavailable(`${key} missing`);
    return obj;
  }

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
      m.dir = this.getObj('dir.bin').then(async o => {
        const d = new Uint32Array(await o.arrayBuffer());
        if (d.length !== (ID_BUCKETS + LOC_SHARDS) * 3) throw new StoreUnavailable('bad dir.bin');
        return d;
      });
      m.dir.catch(() => { m.dir = undefined; });
    }
    return m.dir;
  }

  /** one ranged GET of a located object */
  async range(loc: Loc): Promise<R2ObjectBodyLike> {
    const man = await this.manifest();
    const blob = man.blobs[loc[0]];
    if (!blob) throw new StoreUnavailable('bad blob index');
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
  /** plain (uncompressed) JSON — the id buckets and loc shards */
  async plain<T>(loc: Loc): Promise<T> {
    return JSON.parse(await (await this.range(loc)).text()) as T;
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

