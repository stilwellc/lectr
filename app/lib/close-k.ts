/**
 * close-k.ts — THE BID ROOMS' CLOSE MULTIPLES (Oct 9 2026; refit nightly).
 *
 * A live bid days out is a floor, not a price. CLOSE_K[room][days][bid] is
 * the room's median hammer ÷ live bid, by days to close [<1, 1–3, 3–7, 7–14,
 * 14+] × live bid [<$100, $100–1K, $1–10K, $10–100K, $100K+]. priority.ts
 * projects a bid-room lot's anchor as bid × this multiple.
 *
 * Two sources, one reader:
 *  - CLOSE_K_DEFAULT, compiled in: the Oct 9 anchor study (8,003 lots that
 *    sold after sitting in 16 served books, Sep 20–Oct 8, plus 75K Goldin
 *    bidHistory snapshots on sold corpus lots), ≥25 sales per measured cell.
 *    Empty cells borrowed Goldin Elite's shape (the one room measured at every
 *    bid size and horizon): REA was measured only on close night, RR only
 *    inside 7 days, $100K+ bids almost only at Elite.
 *  - public/data/ray/close-k.json, REFIT EVERY NIGHT by the pipeline
 *    (scripts/lib/close-k-fit.ts, called from build-upcoming): the same cells
 *    measured on the sold rows + bid snapshots the nightly holds, each cell
 *    shrunk toward its parent (this compiled table × the room's measured
 *    drift) and falling back to the parent under CLOSE_K_MIN_N lots. The
 *    client loads it with the eager book (useRayData) and calls setCloseK;
 *    a missing or malformed file leaves the compiled table in force.
 *
 * Never below 1, never shrinking with time to close (both enforced by the
 * fitter; setCloseK re-checks the floor).
 */

export const CLOSE_K_ROOMS = [
  'goldin-weekly', 'goldin-weekly-tcg', 'goldin-elite', 'goldin-thematic',
  'hakes', 'memory-lane', 'nfl', 'rea', 'rr',
] as const;
export type CloseKRoom = typeof CLOSE_K_ROOMS[number];

/** days-to-close bucket edges: [<1, 1–3, 3–7, 7–14, 14+] */
export const CLOSE_K_DAY_EDGES = [1, 3, 7, 14];
/** live-bid band edges (USD): [<$100, $100–1K, $1–10K, $10–100K, $100K+] */
export const CLOSE_K_BID_EDGES = [100, 1_000, 10_000, 100_000];
/** a fitted cell needs this many distinct sold lots; under it, the parent */
export const CLOSE_K_MIN_N = 25;

export type CloseKGrid = number[][]; // [dayBucket][bidBand]

export const CLOSE_K_DEFAULT: Record<CloseKRoom, CloseKGrid> = {
  'goldin-weekly': [[3.1, 2.05, 1.78, 1.29, 1.04], [5.2, 2.68, 2.02, 1.53, 1.24], [12.2, 4.17, 2.85, 2.02, 1.62], [37.5, 10.5, 4, 2.54, 1.88], [37.5, 10.5, 4, 2.54, 1.88]],
  'goldin-weekly-tcg': [[2.4, 1.54, 1.61, 1.78, 1.43], [3.2, 1.91, 2.07, 1.92, 1.55], [8.12, 3.34, 3.45, 2.46, 1.98], [23.84, 10.43, 6.39, 4.05, 3], [23.84, 10.43, 7.7, 4.54, 3]],
  'goldin-elite': [[1.89, 1.89, 2, 1.62, 1.3], [2.3, 2.3, 2.27, 1.73, 1.41], [2.57, 2.57, 2.61, 1.75, 1.41], [3.77, 3.77, 3.73, 2.36, 1.75], [3.77, 5.23, 5.09, 3, 1.75]],
  'goldin-thematic': [[2.33, 2.33, 2.24, 1.85, 1.49], [3.1, 2.86, 2.62, 1.96, 1.59], [4.11, 3, 2.62, 1.96, 1.59], [4.11, 3.13, 2.73, 1.96, 1.59], [4.11, 4.34, 3.73, 2.2, 1.59]],
  hakes: [[1.57, 1.62, 1.71, 1.38, 1.11], [1.83, 1.62, 1.71, 1.38, 1.11], [1.92, 1.69, 1.71, 1.38, 1.11], [3.25, 1.98, 1.96, 1.38, 1.11], [4, 1.98, 1.96, 1.38, 1.11]],
  'memory-lane': [[1.21, 1.21, 1.33, 1.28, 1.02], [1.33, 1.33, 1.46, 1.34, 1.08], [1.61, 1.61, 1.77, 1.47, 1.18], [2.36, 2.36, 2.53, 1.98, 1.47], [2.36, 3.28, 3.46, 2.52, 1.47]],
  nfl: [[1.08, 1.08, 1.14, 1, 1], [1.49, 1.19, 1.14, 1, 1], [2.13, 1.45, 1.14, 1, 1], [3.73, 1.64, 1.62, 1.03, 1], [3.73, 2.27, 2.21, 1.31, 1]],
  rea: [[1.39, 1.32, 1.26, 1.02, 1], [1.68, 1.61, 1.43, 1.09, 1], [1.88, 1.8, 1.64, 1.1, 1], [2.75, 2.63, 2.35, 1.49, 1.1], [2.75, 3.66, 3.21, 1.89, 1.1]],
  rr: [[1.27, 1.27, 1.34, 1.21, 1], [1.8, 1.8, 1.77, 1.21, 1], [2.21, 2.21, 2.25, 1.33, 1.07], [3.24, 3.24, 3.21, 1.8, 1.33], [3.24, 4.51, 4.38, 2.28, 1.33]],
};

/** the served file (public/data/ray/close-k.json) */
export interface CloseKCell { k: number; n: number; src: 'fit' | 'parent' }
export interface CloseKRoomFit {
  /** the multiples, [dayBucket][bidBand] */
  k: CloseKGrid;
  /** distinct sold lots measured in the cell */
  n: number[][];
  /** 'fit' = measured (shrunk toward the parent) · 'parent' = n < minN */
  src: ('fit' | 'parent')[][];
  /** the room's measured log drift vs the compiled table (shrunk), and its n */
  drift: number;
  nRoom: number;
}
export interface CloseKTable {
  v: 1;
  generatedAt: string;
  /** the crawl the fit was made on (meta.json lastCrawl) */
  lastCrawl?: string;
  minN: number;
  n0: number;
  dayEdges: number[];
  bidEdges: number[];
  rooms: Record<string, CloseKRoomFit>;
  /** observation counts by source */
  basis?: Record<string, number>;
}

export function dayBucketOf(days: number): number {
  return days < 1 ? 0 : days < 3 ? 1 : days < 7 ? 2 : days < 14 ? 3 : 4;
}
export function bidBandOf(bid: number): number {
  return bid < 100 ? 0 : bid < 1_000 ? 1 : bid < 10_000 ? 2 : bid < 100_000 ? 3 : 4;
}

/** The bid room a lot trades in (null outside the measured rooms). `cat` is
 *  taxonOf(lot).cat — Goldin Weekly TCG closes on its own curve. */
export function closeKRoomOf(house: string | null | undefined, saleName: string | null | undefined, cat: string): CloseKRoom | null {
  switch (house) {
    case 'Goldin': {
      const s = saleName || '';
      if (/weekly/i.test(s)) return cat === 'tcg' ? 'goldin-weekly-tcg' : 'goldin-weekly';
      return /thematic/i.test(s) ? 'goldin-thematic' : 'goldin-elite';
    }
    case "Hake's": return 'hakes';
    case 'Memory Lane': return 'memory-lane';
    case 'NFL Auction': return 'nfl';
    case 'REA': return 'rea';
    case 'RR Auction': return 'rr';
    default: return null;
  }
}

const validGrid = (g: unknown): g is CloseKGrid =>
  Array.isArray(g) && g.length === 5 && g.every(r => Array.isArray(r) && r.length === 5 && r.every(x => typeof x === 'number' && Number.isFinite(x) && x >= 1 && x <= 100));

let active: Record<string, CloseKGrid> = CLOSE_K_DEFAULT;
let activeSource: 'compiled' | 'fitted' = 'compiled';

/** Install a fitted table (the served close-k.json). Fail soft: anything
 *  malformed is ignored, and a room the file lacks (or carries a bad grid
 *  for) keeps its compiled row. Returns true when at least one room took. */
export function setCloseK(t: unknown): boolean {
  const rooms = (t as CloseKTable | null)?.rooms;
  if (!rooms || typeof rooms !== 'object' || (t as CloseKTable).v !== 1) return false;
  const next: Record<string, CloseKGrid> = { ...CLOSE_K_DEFAULT };
  let took = 0;
  for (const r of CLOSE_K_ROOMS) {
    const g = (rooms as Record<string, CloseKRoomFit>)[r]?.k;
    if (validGrid(g)) { next[r] = g.map(row => row.slice()); took++; }
  }
  if (!took) return false;
  active = next;
  activeSource = 'fitted';
  return true;
}
/** back to the compiled table (tests) */
export function resetCloseK(): void { active = CLOSE_K_DEFAULT; activeSource = 'compiled'; }
export function closeKSource(): 'compiled' | 'fitted' { return activeSource; }

/** THE multiple for a live bid in `room`, `days` from close (≥ 1). */
export function closeKOf(room: string, days: number, bid: number): number {
  const g = active[room] ?? (CLOSE_K_DEFAULT as Record<string, CloseKGrid>)[room];
  if (!g) return 1;
  return Math.max(1, g[dayBucketOf(days)][bidBandOf(bid)]);
}
