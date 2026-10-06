/**
 * Pure helpers for the per-house history backfills that union a crawl back
 * over the pre-crawl segment snapshot (backfill-goldin.yml,
 * backfill-hugginsscott.yml → scripts/backfill-segment.ts). The union itself
 * is the Phillips backfill's (unionPreserving: fresh id wins, a pre id the
 * crawl dropped is restored — nothing is evicted); these add the two things a
 * history slice needs on top:
 *   - an optional SKIP set: NEW ids (absent from the snapshot) whose `artist`
 *     slug is in it are left out — e.g. Goldin 2019–22 sports-cards / pokemon,
 *     which the card pricer never reads (CARD_WINDOW_Y = 1) but which would
 *     triple the slice's rows. Rows already in the snapshot are never touched.
 *   - the report: new rows by category (artist slug) and by sale year.
 */
import { unionPreserving, type UnionResult } from './phillips-backfill';

type Row = Record<string, unknown>;

const idOf = (r: Row): string => (typeof r?.id === 'string' ? r.id : '');

/** comma list of artist slugs → Set; '' → empty. Throws on a non-slug. */
export function parseSkipArtists(spec: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of (spec || '').split(',')) {
    const s = raw.trim().toLowerCase();
    if (!s) continue;
    if (!/^[a-z0-9-]+$/.test(s)) throw new Error(`bad skip slug '${raw.trim()}'`);
    out.add(s);
  }
  return out;
}

export interface SliceUnion extends UnionResult {
  /** new rows left out by the skip set, by artist slug */
  skipped: Record<string, number>;
  /** kept new rows (ids absent from the snapshot), by artist slug */
  newByArtist: Record<string, number>;
  /** kept new rows by sale year (saleDate YYYY, '?' when undated) */
  newByYear: Record<string, number>;
  /** kept new rows that are sold */
  newSold: number;
}

/** pre ∪ (post minus skipped NEW rows), with the per-category report. */
export function unionSlice(pre: readonly Row[], post: readonly Row[], skip: ReadonlySet<string> = new Set()): SliceUnion {
  const preIds = new Set<string>();
  for (const r of pre) { const id = idOf(r); if (id) preIds.add(id); }
  const skipped: Record<string, number> = {};
  const kept = skip.size
    ? post.filter(r => {
      const id = idOf(r);
      if (!id || preIds.has(id)) return true;
      const a = String(r.artist ?? '');
      if (!skip.has(a)) return true;
      skipped[a] = (skipped[a] || 0) + 1;
      return false;
    })
    : post;
  const u = unionPreserving(pre, kept);
  const newByArtist: Record<string, number> = {};
  const newByYear: Record<string, number> = {};
  let newSold = 0;
  for (const r of u.rows) {
    const id = idOf(r);
    if (!id || preIds.has(id)) continue;
    const a = String(r.artist ?? '?');
    newByArtist[a] = (newByArtist[a] || 0) + 1;
    const y = /^\d{4}/.test(String(r.saleDate ?? '')) ? String(r.saleDate).slice(0, 4) : '?';
    newByYear[y] = (newByYear[y] || 0) + 1;
    if (r.status === 'sold') newSold++;
  }
  return { ...u, skipped, newByArtist, newByYear, newSold };
}

/** `{a: 3, b: 10}` → "b 10 · a 3" (largest first) */
export function fmtCounts(c: Record<string, number>, byKey = false): string {
  const e = Object.entries(c);
  if (!e.length) return '—';
  e.sort(byKey ? (x, y) => x[0].localeCompare(y[0]) : (x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  return e.map(([k, v]) => `${k} ${v}`).join(' · ');
}
