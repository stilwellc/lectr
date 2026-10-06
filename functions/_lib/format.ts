/**
 * format.ts — the on-R2 layout shared by the nightly writer
 * (scripts/emit-r2-index.ts) and the read-only API (functions/api).
 * Both sides MUST agree on every constant and codec in this file.
 *
 * FREE-PLAN CONTRACT (10ms CPU per request): every answer is PRECOMPUTED at
 * build time. A request resolves a key to a byte range and hands the stored
 * gzip bytes straight back (Content-Encoding: gzip, no parse); the only JSON
 * the edge ever parses is one plain-JSON id bucket or location shard (≤6KB);
 * lot rows are plain JSON spliced into the response, never parsed.
 *
 * R2 layout (bucket lectr-data, binding CORPUS):
 *
 *   api/current.json               { version, prefix, locDir } — the ONE overwritten
 *                                  object; locDir = the LOC_SHARDS triples of dir.bin
 *                                  inline (~3KB), so a cold table/summary request
 *                                  never waits on dir.bin or the manifest
 *   api/v/<version>/manifest.json  small: version, crawl stamp, blob names, counts
 *                                  (read by /api/version only — blob n is always
 *                                  blobKey(n))
 *   api/v/<version>/dir.bin        Uint32 triples [blob, offset, length]:
 *                                  ID_BUCKETS id buckets, then LOC_SHARDS loc shards
 *   api/v/<version>/blob-<n>.bin   ≤ BLOB_CAP bytes of concatenated objects (an object
 *                                  larger than the cap gets a blob of its own)
 *
 * id bucket (plain JSON, ≤6KB): id → IdEntry
 *   [rowBlob, rowOff, rowLen]                    comps not precomputed
 *   [rowBlob, rowOff, rowLen, -1]                comps computed: nothing to print
 *   [rowBlob, rowOff, rowLen, cBlob, cOff, cLen] comps answer (gzip JSON)
 * where the row is one PLAIN JSON object (served by concatenation, no parse).
 *
 * loc shard (plain JSON, ≤6KB): key → Loc | PagedLoc | facets
 *   p:m:<slug> | p:k:<market>               column summary (SummaryJson), PLAIN JSON —
 *                                           streamed from R2 untouched (no gunzip CPU)
 *   s:m:<slug> | s:k:<market>               the same summary, gzip (pre-Oct-6 readers)
 *   t:<scope>|<sort>|<cat>|<sport>          a paged table ('*' = no filter)
 *   r:<maker>|<ref>                         a watch reference's sold rows, paged
 *   z:<market>                              settled flags response
 * Paged objects store each page as the COMPLETE response body, consecutively.
 */

export const FORMAT_VERSION = 2;
export const ID_BUCKETS = 8192;
export const LOC_SHARDS = 128;
/** blobs stay small (a few MB): the nightly uploads them in parallel, a
 *  failed PUT retries cheaply, and no request ranges into a 64MB object
 *  written minutes earlier. Was 64MB through Oct 5. */
export const BLOB_CAP = 8 * 1024 * 1024;
export const blobKey = (n: number) => `blob-${n}.bin`;
/** table pages: fixed size, materialized depth (deeper → `capped`) */
export const TABLE_PAGE = 20;
export const TABLE_MAX_PAGES = 25;
export const REF_PAGE = 50;
/** /api/lots batch ceiling (each id costs one id-bucket parse) */
export const MAX_IDS = 12;

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

/** [blob index, byte offset, byte length] */
export type Loc = [number, number, number];
/** [blob, start, total rows, len(page 0), len(page 1), …] — pages consecutive */
export type PagedLoc = number[];
export type IdEntry = number[];

export interface Manifest {
  format: number;
  version: string;
  lastCrawl: string;
  generatedAt: string;
  blobs: string[];
  rows: number;
  /** lots with a precomputed comps answer (the coverage window) */
  comps: number;
  compsWindow: string;
}
export interface Current {
  version: string;
  prefix: string;
  /** dir.bin's loc-shard triples, flat (LOC_SHARDS × 3). Optional: a
   *  pointer written before it existed still reads (via dir.bin). */
  locDir?: number[];
}

export const tableKey = (scope: string, sort: 'date' | 'price', cat: string | null, sport: string | null) =>
  `t:${scope}|${sort}|${cat ?? '*'}|${sport ?? '*'}`;
export const refKey = (maker: string, ref: string) => `r:${maker}|${ref.toLowerCase()}`;

/** byte range of page n inside a PagedLoc (null past the materialized pages) */
export function pageRange(p: PagedLoc, n: number): Loc | null {
  const pages = p.length - 3;
  if (n < 0 || n >= pages) return null;
  let off = p[1];
  for (let i = 0; i < n; i++) off += p[3 + i];
  return [p[0], off, p[3 + n]];
}

/** a table page response body (stored gzip, served as-is) */
export interface TablePageBody {
  total: number; page: number; size: number;
  rows: Record<string, unknown>[];
  facets: { cats: string[]; sports: [string, number][] | null };
  /** the table holds more rows than the materialized pages */
  capped: boolean;
}

// ── summary (s:<scope>) — every concluded/listed row of a scope in columns,
// for the aggregate surfaces (maker hero/charts, /analytics pools). Decoded on
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

/** The display-grade row every list surface prints (tables, comp rows,
 *  context rows): the fields PastResults, the certificate's comp rows, the
 *  comps modal and its similarity scorer read — nothing else rides along. */
const DISPLAY_KEYS = [
  'id', 'artist', 'title', 'category', 'imageUrl', 'auctionHouse', 'saleName', 'saleDate', 'lotNumber',
  'currency', 'estimateLow', 'estimateHigh', 'status', 'url', 'priceUsd', 'hammerPrice', 'priceBasis',
  'medium', 'dimensions', 'year', 'formKey', 'objectType', 'sport', 'playerSlug', 'playerName',
  'repeatSaleGroupId', 'reference', 'entity', 'subCat', 'currentBid', 'bidCount',
] as const;
const CLIP: Record<string, number> = { title: 240, saleName: 120, medium: 160, dimensions: 120 };
export function displayRow(l: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of DISPLAY_KEYS) {
    const v = l[k];
    if (v == null || v === '') continue;
    o[k] = typeof v === 'string' && CLIP[k] && v.length > CLIP[k] ? v.slice(0, CLIP[k]) : v;
  }
  return o;
}

/** the crawl bookkeeping no page reads — dropped from the stored lot rows */
export const ROW_DROP = new Set(['firstSeen', '_vn', 'entitySrc', 'heightCm', 'widthCm', 'depthCm', 'subjectKeys', 'itemClass', 'drill']);
