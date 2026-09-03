'use client';

/**
 * Saved searches + alerts — the retention loop. A saved search is a stored
 * FeedFilters slice; the nightly crawl (scripts/match-alerts.ts) matches
 * fresh lots against every saved search and writes alert rows. The client
 * reads them here: RLS scopes everything to the signed-in user.
 *
 * ONE FETCH PER USER (Sep 2 2026): the inbox (useAlerts), the profile
 * header (useAlerts) and the nav badge (useUnseenAlertCount) used to each
 * run their own queries — three `count: 'exact'` HEAD calls per /profile
 * mount. They now share a module-level store keyed by user id: one rows
 * fetch + one exact unseen count, cached for the session (TTL-refreshed on
 * a later mount) and invalidated by every local mutation (markAllSeen,
 * deleting a search).
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './account';

export interface SavedQuery {
  market?: string | null;
  maker?: string | null;
  sport?: string | null;
  category?: string | null;
  text?: string | null;
  belowOnly?: boolean;
  /** a followed athlete (players.json slug) OR a followed maker/artist. When
   *  set the search is a "follow" — new lots for that person alert nightly. */
  player?: string | null;
  playerName?: string | null;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: SavedQuery;
  created_at: string;
}

export interface AlertRow {
  id: number;
  search_id: string;
  lot_id: string;
  created_at: string;
  seen: boolean;
}

/** One human line for a stored query — mirrors how the toolbar talks. */
export function describeQuery(q: SavedQuery, labels: { maker?: string; category?: string; market?: string }): string {
  // a follow reads as the person's name — "Following Michael Jordan"
  if (q.player) return `Following ${q.playerName || q.player}`;
  const parts: string[] = [];
  if (labels.maker) parts.push(labels.maker);
  else if (q.sport) parts.push(q.sport);
  else if (labels.category) parts.push(labels.category);
  if (q.text) parts.push(`“${q.text}”`);
  if (q.belowOnly) parts.push('below market');
  if (labels.market) parts.push(labels.market);
  return parts.join(' · ') || 'everything on the block';
}

// ── the shared alerts store ──────────────────────────────────────────────────
interface AlertsSnapshot {
  alerts: AlertRow[];
  /** the TRUE unseen total from an exact HEAD count — the row fetch is capped
   *  at 200, so counting inside that window let the cap masquerade as the
   *  number ("200 new" pinned forever). null until the count has landed. */
  unseen: number | null;
  ready: boolean;
}
const EMPTY: AlertsSnapshot = { alerts: [], unseen: null, ready: false };
const ROW_CAP = 200;
/** a later mount after this long re-fetches behind the cached snapshot */
const STORE_TTL_MS = 60_000;

let storeUser: string | null = null;
let storeSnap: AlertsSnapshot = EMPTY;
let storePromise: Promise<void> | null = null;
let storeLoadedAt = 0;
const storeListeners = new Set<(s: AlertsSnapshot) => void>();

function emitStore() { storeListeners.forEach(fn => fn(storeSnap)); }

function setStore(next: AlertsSnapshot) { storeSnap = next; emitStore(); }

/** Fetch (or reuse) the user's alerts. Dedupes concurrent callers behind one
 *  promise; `force` bypasses the cache after a local mutation. */
function loadAlerts(userId: string, force = false): Promise<void> {
  if (!supabase) return Promise.resolve();
  if (storeUser !== userId) {
    storeUser = userId;
    storeSnap = EMPTY;
    storePromise = null;
    storeLoadedAt = 0;
  }
  const stale = storeLoadedAt > 0 && Date.now() - storeLoadedAt > STORE_TTL_MS;
  if (storePromise && !force && !stale) return storePromise;
  if (storePromise && (force || stale) && !storeSnap.ready) return storePromise; // a fetch is already inflight
  const db = supabase;
  const p = (async () => {
    const [{ data }, { count }] = await Promise.all([
      db.from('alerts')
        .select('id,search_id,lot_id,created_at,seen')
        .eq('user_id', userId)   // defense in depth alongside RLS
        .order('created_at', { ascending: false })
        .limit(ROW_CAP),
      db.from('alerts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('seen', false),
    ]);
    if (storeUser !== userId) return; // the user changed mid-flight — drop it
    // on a fetch error keep the prior rows — never wipe the UI to empty
    // (same doctrine as useSavedSearches below)
    setStore({
      alerts: data ? (data as AlertRow[]) : storeSnap.alerts,
      unseen: count != null ? count : storeSnap.unseen,
      ready: true,
    });
    storeLoadedAt = Date.now();
  })().catch(() => {
    if (storeUser === userId) setStore({ ...storeSnap, ready: true });
  });
  storePromise = p;
  return p;
}

/** Drop the cached snapshot's authority: the next subscriber re-fetches. Used
 *  after any write that changes rows the store can't replay exactly. */
export function invalidateAlerts() {
  if (storeUser) loadAlerts(storeUser, true);
}

function useAlertsStore(): AlertsSnapshot {
  const { user } = useAuth();
  const [snap, setSnap] = useState<AlertsSnapshot>(() => (user && storeUser === user.id ? storeSnap : EMPTY));
  useEffect(() => {
    if (!supabase || !user) { setSnap({ alerts: [], unseen: 0, ready: true }); return; }
    let dead = false;
    const listener = (s: AlertsSnapshot) => { if (!dead) setSnap(s); };
    storeListeners.add(listener);
    if (storeUser === user.id) listener(storeSnap);
    loadAlerts(user.id);
    return () => { dead = true; storeListeners.delete(listener); };
    // user?.id, not the user object: Supabase mints a fresh user object on
    // every auth event, and an object dep re-fires the whole chain needlessly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  return snap;
}

export function useSavedSearches() {
  const { user } = useAuth();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase || !user) { setSearches([]); setReady(true); return; }
    const { data, error } = await supabase
      .from('saved_searches')
      .select('id,name,query,created_at')
      .eq('user_id', user.id)   // RLS already scopes; explicit filter is defense in depth
      .order('created_at', { ascending: false });
    // on a fetch error keep the prior list — never wipe the UI to empty
    if (!error && data) setSearches(data as SavedSearch[]);
    setReady(true);
    // user?.id, not the user object — see useAlertsStore
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async (name: string, query: SavedQuery): Promise<'saved' | 'exists' | 'error'> => {
    if (!supabase || !user) return 'error';
    // fast path off the list already in memory — no round trip for the
    // common "you already follow this" tap
    const key = JSON.stringify(query);
    if (searches.some(s => JSON.stringify(s.query) === key)) return 'exists';
    // the DATABASE owns uniqueness: saved_searches unique (user_id, query)
    // (migrations/0004). A duplicate insert comes back 23505 — that is
    // 'exists', not an error, and it closes the two-tabs / double-tap race the
    // old select-then-insert check left open.
    const { error } = await supabase.from('saved_searches').insert({ user_id: user.id, name, query });
    if (error) return error.code === '23505' ? 'exists' : 'error';
    refresh();
    return 'saved';
  }, [user, searches, refresh]);

  const remove = useCallback(async (id: string) => {
    if (!supabase) return;
    setSearches(s => s.filter(x => x.id !== id));
    // Orphan-alert guard: this search's alert rows would outlive it, keeping
    // the nav badge glowing with rows the inbox can no longer render — and
    // deleting the LAST search removed the only "mark all read" path. Flip
    // them seen first; the FK cascade (supabase/migrations/0003) also removes
    // them where applied, but this works regardless.
    await supabase.from('alerts').update({ seen: true }).eq('search_id', id);
    await supabase.from('saved_searches').delete().eq('id', id);
    invalidateAlerts();
  }, []);

  return { searches, ready, save, remove, refresh };
}

export function useAlerts() {
  const { user } = useAuth();
  const snap = useAlertsStore();

  const markAllSeen = useCallback(async () => {
    if (!supabase || !user) return;
    // optimistic: the shared store flips so the inbox, the profile header
    // and the nav badge all read 0 at once
    setStore({ ...storeSnap, alerts: storeSnap.alerts.map(x => ({ ...x, seen: true })), unseen: 0 });
    // explicit user filter: RLS scopes this, but an unscoped UPDATE must
    // never be one policy-config mistake away from flipping every user's rows
    const { error } = await supabase.from('alerts').update({ seen: true }).eq('user_id', user.id).eq('seen', false);
    if (error) invalidateAlerts(); // the write failed — re-read the truth
  }, [user]);

  return {
    alerts: snap.alerts,
    ready: snap.ready,
    markAllSeen,
    unseen: snap.unseen ?? snap.alerts.filter(a => !a.seen).length,
  };
}

/** Just the unseen count — for the nav. Shares the one store; no extra query. */
export function useUnseenAlertCount(): number {
  const snap = useAlertsStore();
  return snap.unseen ?? snap.alerts.filter(a => !a.seen).length;
}
