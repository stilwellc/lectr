/**
 * Pure helpers for the Phillips full-history backfill
 * (.github/workflows/backfill-phillips.yml → scripts/backfill-phillips.ts).
 *
 * The crawl itself is the nightly's own path — ray-crawl.ts with
 * RAY_HOUSE=phillips, scoped by RAY_ONLY and deepened by PHILLIPS_DEEP=1 — so
 * every row is classified/normalized exactly like a nightly row. These helpers
 * only (a) turn the workflow's maker selector into a RAY_ONLY list and (b)
 * union the crawl's segment back over the pre-crawl snapshot so a backfill can
 * never evict a row (fresh id wins; a pre id the crawl dropped is restored).
 */
import type { ArtistConfig } from './houses/artists';

/** The Phillips watch makers (ray-crawl.ts WATCH_SLUGS ∩ roster with a Phillips id). */
export const PHILLIPS_WATCH_SLUGS = ['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier'] as const;

/**
 * Maker selector → roster slugs that carry a Phillips maker id.
 *   'watches' · 'art' (every non-watch Phillips maker) · 'all'
 *   · or a comma list of roster slugs ('patek-philippe,rolex').
 * Throws on an unknown slug or a slug with no Phillips id — a typo must fail
 * the dispatch, not silently crawl nothing.
 */
export function resolvePhillipsMakers(spec: string, artists: readonly ArtistConfig[]): string[] {
  const withId = artists.filter(a => !!a.phillips?.id);
  const isWatch = (slug: string) => (PHILLIPS_WATCH_SLUGS as readonly string[]).includes(slug);
  const s = spec.trim().toLowerCase();
  if (!s) throw new Error('empty maker selector');
  if (s === 'all') return withId.map(a => a.slug);
  if (s === 'watches') return withId.filter(a => isWatch(a.slug)).map(a => a.slug);
  if (s === 'art') return withId.filter(a => !isWatch(a.slug)).map(a => a.slug);
  const want = s.split(',').map(x => x.trim()).filter(Boolean);
  if (!want.length) throw new Error(`bad maker selector '${spec}'`);
  const bad: string[] = [];
  for (const slug of want) {
    if (!/^[a-z0-9-]+$/.test(slug)) bad.push(`${slug} (not a slug)`);
    else if (!artists.some(a => a.slug === slug)) bad.push(`${slug} (not in the roster)`);
    else if (!withId.some(a => a.slug === slug)) bad.push(`${slug} (no Phillips maker id)`);
  }
  if (bad.length) throw new Error(`bad maker(s): ${bad.join(', ')}`);
  return Array.from(new Set(want));
}

type Row = Record<string, unknown>;

export interface UnionResult {
  rows: Row[];
  /** ids in post but not pre — the history the deep crawl added */
  added: number;
  /** pre ids the crawl's segment no longer carried, put back untouched */
  restored: number;
  /** pre rows whose id the crawl re-wrote (fresh copy wins) */
  refreshed: number;
}

/**
 * pre ∪ post, keyed by id: the post (crawl) copy wins, and every pre id the
 * crawl dropped is restored as-is — the backfill contract is "nothing evicted".
 * Rows without an id are passed through from post only (the crawl never writes
 * one; a pre row without one could not be matched anyway and is kept).
 */
export function unionPreserving(pre: readonly Row[], post: readonly Row[]): UnionResult {
  const out = new Map<string, Row>();
  const loose: Row[] = [];
  for (const r of post) {
    const id = typeof r?.id === 'string' ? r.id : '';
    if (id) out.set(id, r); else if (r) loose.push(r);
  }
  const preIds = new Set<string>();
  let restored = 0, refreshed = 0;
  for (const r of pre) {
    const id = typeof r?.id === 'string' ? r.id : '';
    if (!id) { if (r) loose.push(r); continue; }
    if (preIds.has(id)) continue;
    preIds.add(id);
    if (out.has(id)) refreshed++;
    else { out.set(id, r); restored++; }
  }
  let added = 0;
  for (const id of Array.from(out.keys())) if (!preIds.has(id)) added++;
  return { rows: Array.from(out.values()).concat(loose), added, restored, refreshed };
}

export interface RefCounts { rows: number; sold: number; watches: number; withHouseReference: number }

/** Counts for the run report: rows, sold rows, watch-maker rows, and rows
 *  carrying the structured Phillips `houseReference` (wReferenceNo). */
export function phillipsCounts(rows: readonly Row[], slugs?: ReadonlySet<string>): RefCounts {
  const c: RefCounts = { rows: 0, sold: 0, watches: 0, withHouseReference: 0 };
  for (const r of rows) {
    if (slugs && !slugs.has(String(r.artist ?? ''))) continue;
    c.rows++;
    if (r.status === 'sold') c.sold++;
    if ((PHILLIPS_WATCH_SLUGS as readonly string[]).includes(String(r.artist ?? ''))) c.watches++;
    if (typeof r.houseReference === 'string' && r.houseReference.trim()) c.withHouseReference++;
  }
  return c;
}
