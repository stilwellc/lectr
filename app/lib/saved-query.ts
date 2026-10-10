/**
 * saved-query.ts — the ONE definition of what a saved search means (Oct 9).
 * The toolbar's "Save this search" builds its query here (savedQueryOf) and
 * the nightly matcher (scripts/match-alerts.ts) reads it here
 * (matchesSavedQuery), so a field the reader can dial in is a field the alert
 * honors — the triage row (closing window, clean category / sub, house, value
 * floor, facets) used to be dropped on save, and a saved "Cards · $5K+ ·
 * Goldin" alerted on every new card.
 *
 * SAFETY: the matcher refuses a query carrying any key it does not know (or a
 * query with no criterion at all) — an unknown field used to be silently
 * ignored, which made a narrow search match EVERY fresh lot.
 *
 * Pure: no React, no storage — imported by a client component and by a node
 * script alike.
 */
import type { SavedQuery } from './alerts';
import { marketOf } from '../constants';
import { passesTriage, TRIAGE_DEFAULTS, type CloseWindow, type TriageFilters } from './feed-filters';
import type { CatKey } from './taxonomy';

/** the toolbar state a saved search is cut from (FeedFilters' relevant slice) */
export interface SaveableFilters extends TriageFilters {
  query: string;
  maker: string | null;
  sport: string | null;
  category: string | null;
  belowOnly: boolean;
}

/** Build the stored query. Legacy fields keep their exact shape and order
 *  (the client's duplicate check compares JSON), and triage fields are added
 *  ONLY when set — a search saved before Oct 9 still dedupes against the same
 *  search saved today. "New since last visit" is not stored: every alert is
 *  already a new lot. */
export function savedQueryOf(f: SaveableFilters, market: string): SavedQuery {
  const q: SavedQuery = {
    market: market !== 'all' ? market : null,
    maker: f.maker,
    sport: f.sport,
    category: f.category,
    text: f.query.trim() || null,
    belowOnly: f.belowOnly || undefined,
  };
  if (f.win) q.win = f.win;
  if (f.cat) q.cat = f.cat;
  if (f.sub) q.sub = f.sub;
  if (f.house) q.house = f.house;
  if (f.minUsd) q.minUsd = f.minUsd;
  if (f.maxUsd) q.maxUsd = f.maxUsd;
  if (f.fx.length) q.fx = [...f.fx];
  return q;
}

/** does the query narrow anything? (saving "everything" is not a search) */
export function hasCriteria(q: SavedQuery): boolean {
  return !!(q.market || q.maker || q.sport || q.category || q.text || q.belowOnly || q.player
    || q.win || q.cat || q.sub || q.house || q.minUsd || q.maxUsd || (q.fx && q.fx.length));
}

/** every key a plain (non-follow, non-signal) saved search may carry */
export const KNOWN_QUERY_KEYS = new Set([
  'market', 'maker', 'sport', 'category', 'text', 'belowOnly', 'player', 'playerName',
  'win', 'cat', 'sub', 'house', 'minUsd', 'maxUsd', 'fx',
]);

/** null when the matcher can honor the query, else why it must be skipped */
export function unmatchableReason(q: Record<string, unknown>): string | null {
  const unknown = Object.keys(q).filter(k => !KNOWN_QUERY_KEYS.has(k));
  if (unknown.length) return `unknown field(s): ${unknown.join(', ')}`;
  if (q.win != null && q.win !== 'today' && q.win !== '48h' && q.win !== 'week') return `bad win: ${String(q.win)}`;
  if (q.fx != null && !(Array.isArray(q.fx) && q.fx.every(x => typeof x === 'string'))) return 'bad fx';
  if (q.minUsd != null && !(typeof q.minUsd === 'number' && Number.isFinite(q.minUsd))) return 'bad minUsd';
  if (q.maxUsd != null && !(typeof q.maxUsd === 'number' && Number.isFinite(q.maxUsd))) return 'bad maxUsd';
  if (!hasCriteria(q as SavedQuery)) return 'no criterion';
  return null;
}

/** the triage slice of a stored query */
export function triageOfQuery(q: SavedQuery): TriageFilters {
  return {
    ...TRIAGE_DEFAULTS,
    win: (q.win as CloseWindow | null | undefined) ?? null,
    cat: (q.cat as CatKey | null | undefined) ?? null,
    sub: q.sub ?? null,
    house: q.house ?? null,
    minUsd: q.minUsd ?? null,
    maxUsd: q.maxUsd ?? null,
    fx: q.fx ?? [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MatchLot = any;

/** Does one fresh lot match a plain saved search? `today` anchors the
 *  closing window (the matcher's run day). Callers must have checked
 *  unmatchableReason first. */
export function matchesSavedQuery(q: SavedQuery, lot: MatchLot, today?: string): boolean {
  // a FOLLOW: sports lots carry a build-stamped playerSlug; art/watch makers
  // are the artist slug itself — a follow matches either, so "follow Jordan"
  // and "follow KAWS" both work off the one field.
  if (q.player && lot.playerSlug !== q.player && lot.artist !== q.player) return false;
  if (q.maker && lot.artist !== q.maker) return false;
  if (q.market && q.market !== 'all' && marketOf(String(lot.artist || '')) !== q.market) return false;
  if (q.sport && (lot.sport || '') !== q.sport) return false;
  if (q.category && lot.category !== q.category) return false;
  if (q.belowOnly && !String(lot.value?.signal?.label || '').startsWith('below')) return false;
  if (q.text) {
    const hay = String(lot.title || '').toLowerCase();
    for (const w of String(q.text).toLowerCase().split(/\s+/)) {
      if (w && !hay.includes(w)) return false;
    }
  }
  if (!passesTriage(lot, triageOfQuery(q), { today })) return false;
  return true;
}
