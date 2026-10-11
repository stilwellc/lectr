/**
 * local-searches.ts — "Save this search" for a reader with no account
 * (Oct 11 2026). Same pattern as follows (app/lib/follows): kept in this
 * browser signed out, carried into saved_searches once on sign-in — from
 * then on the nightly matcher (scripts/match-alerts.ts) checks it.
 *
 * Honest about the difference: the nightly matcher only reads the account's
 * rows, so a search kept on the device is a remembered filter until the
 * reader signs in. The toolbar says exactly that.
 *
 * Pure helpers (tested) + two tiny storage wrappers. No React.
 */
import type { SavedQuery } from './alerts';

export interface LocalSearch { name: string; query: SavedQuery; savedAt: string }

export const LOCAL_SEARCHES_KEY = 'lectr-saved-searches';
/** a device list is a few remembered filters, not an archive */
export const LOCAL_SEARCHES_CAP = 25;

/** canonical identity of a query: keys sorted, empty values dropped — the
 *  same filter saved twice (or read back in another key order) is one */
export function queryKey(q: SavedQuery): string {
  const o = q as Record<string, unknown>;
  const keys = Object.keys(o).filter(k => {
    const v = o[k];
    return v != null && v !== false && v !== '' && !(Array.isArray(v) && v.length === 0);
  }).sort();
  return JSON.stringify(keys.map(k => [k, o[k]]));
}

export function parseLocalSearches(raw: string | null): LocalSearch[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((s): s is LocalSearch =>
      !!s && typeof s === 'object' && typeof s.name === 'string' && !!s.query && typeof s.query === 'object' && !Array.isArray(s.query) && typeof s.savedAt === 'string');
  } catch { return []; }
}

/** add the search, or take it back when the same query is already kept */
export function toggleLocalSearch(list: readonly LocalSearch[], name: string, query: SavedQuery, at: string): LocalSearch[] {
  const k = queryKey(query);
  if (list.some(s => queryKey(s.query) === k)) return list.filter(s => queryKey(s.query) !== k);
  return [...list, { name, query, savedAt: at }].slice(-LOCAL_SEARCHES_CAP);
}

/** the device searches still to carry into the account: each one whose
 *  query the account lacks, once */
export function localSearchPlan(local: readonly LocalSearch[], cloud: readonly SavedQuery[]): LocalSearch[] {
  const have = new Set(cloud.map(queryKey));
  const out: LocalSearch[] = [];
  for (const s of local) {
    const k = queryKey(s.query);
    if (have.has(k)) continue;
    have.add(k);
    out.push(s);
  }
  return out;
}

export function readLocalSearches(): LocalSearch[] {
  if (typeof window === 'undefined') return [];
  try { return parseLocalSearches(window.localStorage.getItem(LOCAL_SEARCHES_KEY)); } catch { return []; }
}
export function writeLocalSearches(list: LocalSearch[]): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LOCAL_SEARCHES_KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(LOCAL_SEARCHES_KEY));
}
