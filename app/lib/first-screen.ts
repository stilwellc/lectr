/**
 * first-screen.ts — the client side of the first-screen payloads (perf wave
 * W13, Oct 11 2026; the build side is scripts/emit-first-screen.ts, the
 * selection rules app/lib/first-screen-select.ts).
 *
 * On a phone over Slow 4G every live route waited ~14s for the whole eager
 * book (upcoming.json ~1.2MB + market.json ~0.3MB brotli, all eight phase-1
 * files settled) before it painted a row. A first-screen payload is a SLICE
 * of the same served files — the book's own lot rows (never recomputed,
 * never rounded), the market reads the first screen prints, the house
 * baselines and the meta totals — built with every deploy from the exact
 * data it ships beside. The page paints from it, then the whole book loads
 * behind the paint and REPLACES it (useRayData useRayDataFirst).
 *
 * Versioning: the emitter stamps every payload with one content hash, the
 * build bakes the same hash into the HTML (next.config NEXT_PUBLIC_FS_VERSION)
 * and the URL carries it, so a payload is only ever read beside the HTML of
 * the deploy that built it — a stale CDN copy or a missing file means no
 * first screen (the page waits for the book exactly as before), never an
 * old number.
 */
import type { AuctionLot } from '../types';
import type { BaselineStats } from './feed-filters';
import type { CloseBoardJson } from './eager-book';
import { bucketOf } from './page-data';

/** the deploy's first-screen hash ('' = this build ships none) */
export const FS_VERSION: string = process.env.NEXT_PUBLIC_FS_VERSION || '';

/** /makers markets whose first screen is maker rows (the slice counts them
 *  exactly); the collection markets' rows are names over the whole book */
const MAKERS_FS = new Set(['all', 'art', 'design', 'watches']);
const VALUE_MARKETS = new Set(['art', 'design', 'watches', 'science', 'sports', 'tcg', 'culture']);

/** the entity bucket a first-screen payload carries an entity's live lots in */
export const entityFsKey = (entityId: string) => `ent-${bucketOf(entityId)}`;

/**
 * The first-screen payload a route paints from, or null (the route waits for
 * the whole book, as before). `search` is the query string (the player and
 * entity routes name their entity there).
 */
export function fsKeyOf(pathname: string | null | undefined, search = ''): string | null {
  if (!FS_VERSION) return null;
  const p = (pathname || '/').replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  if (p === '/') return 'home';
  if (p === '/value') return 'value';
  const vm = p.match(/^\/value\/([a-z]+)$/);
  if (vm) return VALUE_MARKETS.has(vm[1]) ? 'value' : null;
  if (p === '/makers') return 'makers';
  const mm = p.match(/^\/makers\/m\/([a-z]+)$/);
  if (mm) return MAKERS_FS.has(mm[1]) ? 'makers' : null;
  const ms = p.match(/^\/makers\/([a-z0-9-]+)$/);
  if (ms && ms[1] !== 'm') return entityFsKey(`mk:${ms[1]}`);
  if (p === '/player' || p === '/entity') {
    const id = new URLSearchParams(search).get('id');
    if (!id) return null;
    return entityFsKey(p === '/player' ? (id.includes(':') ? id : `pl:${id}`) : id);
  }
  return null;
}

export const fsUrl = (key: string) => `/data/ray/first/${key}.json?v=${encodeURIComponent(FS_VERSION)}`;

/** market.json, trimmed to the reads a first screen prints (the tape, the
 *  pulse): per market its index + n, the vertical repeat-sale, the hedonic
 *  horizons + composite. Never read by a below-the-fold surface — those wait
 *  for the whole file. */
export interface FsMarket {
  generatedAt?: string;
  lastCrawl?: string;
  markets?: Record<string, { method?: string; label?: string; index?: unknown; n?: number }>;
  repeatSale?: Record<string, unknown>;
  hedonic?: Record<string, { horizons?: unknown; lastCompleteQuarter?: unknown; note?: unknown; composite?: unknown }>;
}

export interface FirstScreenPayload {
  v: 1;
  key: string;
  /** the deploy's content hash — must equal FS_VERSION */
  ver: string;
  meta: { lastCrawl: string; sources: string[]; totalLots?: number; totalSold?: number };
  /** upcoming.json's generatedAt (the close-board accept rule reads it) */
  upGen?: string;
  /** upcoming.json's small top-level series the first screen reads */
  up?: { demand?: unknown; realized?: unknown; bidComp?: unknown };
  market?: FsMarket | null;
  backtest?: unknown;
  /** receipts.json's graded lane record only (the Gap / Sleepers footers) */
  receipts?: { record: unknown } | null;
  closeBoard: CloseBoardJson | null;
  closeK: unknown;
  /** the WHOLE book's house baselines (feed-filters houseBaselineStats) */
  baselines: BaselineStats;
  /** the slice — upcoming.json rows verbatim, in the book's order */
  lots: AuctionLot[];
}

const cache = new Map<string, Promise<FirstScreenPayload | null>>();
/** one fetch per key per session; null on any miss (no file, a stale or
 *  foreign version, a malformed body) */
export function fetchFirstScreen(key: string): Promise<FirstScreenPayload | null> {
  let p = cache.get(key);
  if (!p) {
    p = fetch(fsUrl(key))
      .then(r => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : null))
      .then((j: FirstScreenPayload | null) => (j && j.v === 1 && j.ver === FS_VERSION && Array.isArray(j.lots) ? j : null))
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}
