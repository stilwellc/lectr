/**
 * format.ts — the on-R2 layout shared by the nightly writer
 * (scripts/emit-r2-index.ts) and the read-only API (functions/api).
 * Both sides MUST agree on every constant and codec in this file.
 *
 * R2 layout (bucket lectr-data, binding CORPUS):
 *
 *   api/current.json                  { version, prefix } — the ONE overwritten
 *                                     object; everything else is write-once
 *   api/v/<version>/manifest.json     counts, makers, markets, blob names
 *   api/v/<version>/blob-<n>.bin      concatenated objects (gzip members or raw
 *                                     binary), ≤ BLOB_CAP bytes each
 *   api/v/<version>/loc-<ss>.json     location table shard: key → [blob, off, len]
 *                                     (key → shard by fnv1a(key) % LOC_SHARDS)
 *
 * Keys in the location table:
 *   c:<n>          row chunk n (CHUNK_ROWS rows, gzip JSON array) of the row store
 *   b:<bucket>     id bucket (gzip JSON { id: position }), bucket = fnv1a(id) % ID_BUCKETS
 *   p:<partition>  comp candidate pool (gzip JSON array of rows) — see pools.ts
 *   s:<scope>      summary (gzip JSON, served as-is with Content-Encoding: gzip)
 *   x:<scope>      table index (raw binary, decodeScopeIndex)
 *   z:settled      settled-flags rows (gzip JSON)
 *   scope = m:<maker slug> | k:<market key>
 */

export const FORMAT_VERSION = 1;
export const CHUNK_ROWS = 64;
export const ID_BUCKETS = 4096;
export const LOC_SHARDS = 64;
/** a single blob object stays well under R2's single-PUT ceiling */
export const BLOB_CAP = 64 * 1024 * 1024;

/** FNV-1a 32 — the hash both sides key with. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
export const idBucketOf = (id: string) => fnv1a(id) % ID_BUCKETS;
export const locShardOf = (key: string) => fnv1a(key) % LOC_SHARDS;
export const locShardName = (n: number) => `loc-${n.toString().padStart(2, '0')}.json`;

/** [blob index, byte offset, byte length] */
export type Loc = [number, number, number];

export interface Manifest {
  format: number;
  version: string;
  lastCrawl: string;
  generatedAt: string;
  blobs: string[];
  rows: number;
  chunks: number;
  /** per maker slug: market, sold rows in its table, forms that have a comp pool */
  makers: Record<string, { market: string; n: number; sold: number; forms: string[] }>;
  /** per market key: sold rows in its archive table */
  markets: Record<string, { sold: number }>;
}

export interface Current { version: string; prefix: string }

// ── table index (x:<scope>) — the sort/filter columns of a scope's SOLD rows,
// raw little-endian typed arrays so the Function filters with no parse cost.
// Rows are stored in BASE order: saleDate descending (stable on the writer's
// input order), the order PastResults' date sort starts from.
export interface ScopeHeader {
  n: number;
  houses: string[];
  cats: string[];
  /** sport labels; '' = no sport (PastResults files it under "Other") */
  sports: string[];
  /** PastResults' chips over the UNFILTERED scope: categories present (sorted,
      'unknown' dropped) and — only when every row is a sports-vertical row and
      ≥2 sports exist — [sport, count] biggest first, "Other" last */
  facetCats: string[];
  facetSports: [string, number][] | null;
}
export interface ScopeIndex {
  head: ScopeHeader;
  pos: Int32Array;      // row-store position
  price: Float64Array;  // priceUsd (0 = none)
  house: Uint16Array;
  cat: Uint8Array;
  sport: Uint16Array;
  byPrice: Int32Array;  // permutation of base indices, priceUsd desc (stable)
}

const MAGIC = 0x5852494c; // 'LIRX'
const align8 = (n: number) => (n + 7) & ~7;

export function encodeScopeIndex(ix: ScopeIndex): Uint8Array {
  const headBytes = new TextEncoder().encode(JSON.stringify(ix.head));
  const n = ix.head.n;
  let off = align8(8 + headBytes.length);
  const offPos = off; off = align8(off + 4 * n);
  const offPrice = off; off = align8(off + 8 * n);
  const offBy = off; off = align8(off + 4 * n);
  const offHouse = off; off = align8(off + 2 * n);
  const offSport = off; off = align8(off + 2 * n);
  const offCat = off; off = align8(off + n);
  const buf = new ArrayBuffer(off);
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, headBytes.length, true);
  new Uint8Array(buf, 8, headBytes.length).set(headBytes);
  // typed arrays are little-endian on every platform the writer and the
  // Workers runtime run on; the magic check guards a foreign blob
  new Int32Array(buf, offPos, n).set(ix.pos);
  new Float64Array(buf, offPrice, n).set(ix.price);
  new Int32Array(buf, offBy, n).set(ix.byPrice);
  new Uint16Array(buf, offHouse, n).set(ix.house);
  new Uint16Array(buf, offSport, n).set(ix.sport);
  new Uint8Array(buf, offCat, n).set(ix.cat);
  return new Uint8Array(buf);
}

export function decodeScopeIndex(bytes: Uint8Array): ScopeIndex {
  // copy into an 8-aligned buffer of our own (a range read may hand back a view)
  const buf = bytes.byteOffset % 8 === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.slice().buffer as ArrayBuffer;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('scope index: bad magic');
  const hl = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl))) as ScopeHeader;
  const n = head.n;
  let off = align8(8 + hl);
  const pos = new Int32Array(buf, off, n); off = align8(off + 4 * n);
  const price = new Float64Array(buf, off, n); off = align8(off + 8 * n);
  const byPrice = new Int32Array(buf, off, n); off = align8(off + 4 * n);
  const house = new Uint16Array(buf, off, n); off = align8(off + 2 * n);
  const sport = new Uint16Array(buf, off, n); off = align8(off + 2 * n);
  const cat = new Uint8Array(buf, off, n);
  return { head, pos, price, house, cat, sport, byPrice };
}

// ── summary (s:<scope>) — every non-upcoming row of a scope in columns, for
// the aggregate surfaces (maker hero/charts, /analytics pools). Decoded on
// the client by app/lib/api.ts decodeSummary.
export interface SummaryJson {
  v: 1;
  scope: string;
  n: number;
  dict: {
    a: string[];  // artist slugs
    s: string[];  // status
    c: string[];  // category
    h: string[];  // auction house
    sp: string[]; // sport
    pl: string[]; // playerSlug
    pn: string[]; // playerName, parallel to pl
    d: string[];  // saleDate strings
  };
  /** columns, one entry per row; dictionary columns use -1 for absent */
  cols: {
    a: number[]; s: number[]; c: number[]; h: number[]; sp: number[]; pl: number[]; d: number[];
    p: number[];  // priceUsd (0 = none)
    el: number[]; // estimateLow (0 = none)
    eh: number[]; // estimateHigh (0 = none)
  };
  /** full display rows for the highest-priced sold rows: [row index, row] */
  top: [number, Record<string, unknown>][];
}

/** Lot ids are crawl-minted: house prefix + digits/uuid-ish tails. */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:~+-]{0,199}$/;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
