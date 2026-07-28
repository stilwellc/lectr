'use client';

/**
 * Saved searches + alerts — the retention loop. A saved search is a stored
 * FeedFilters slice; the nightly crawl (scripts/match-alerts.ts) matches
 * fresh lots against every saved search and writes alert rows. The client
 * reads them here: RLS scopes everything to the signed-in user.
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

export function useSavedSearches() {
  const { user } = useAuth();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase || !user) { setSearches([]); setReady(true); return; }
    const { data, error } = await supabase
      .from('saved_searches')
      .select('id,name,query,created_at')
      .order('created_at', { ascending: false });
    // on a fetch error keep the prior list — never wipe the UI to empty
    if (!error && data) setSearches(data as SavedSearch[]);
    setReady(true);
    // user?.id, not the user object: Supabase mints a fresh user object on
    // every auth event, and an object dep re-fires the whole chain needlessly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(async (name: string, query: SavedQuery): Promise<'saved' | 'exists' | 'error'> => {
    if (!supabase || !user) return 'error';
    const key = JSON.stringify(query);
    const { data: existing } = await supabase.from('saved_searches').select('id,query');
    if ((existing || []).some(s => JSON.stringify(s.query) === key)) return 'exists';
    const { error } = await supabase.from('saved_searches').insert({ user_id: user.id, name, query });
    if (error) return 'error';
    refresh();
    return 'saved';
  }, [user, refresh]);

  const remove = useCallback(async (id: string) => {
    if (!supabase) return;
    setSearches(s => s.filter(x => x.id !== id));
    await supabase.from('saved_searches').delete().eq('id', id);
  }, []);

  return { searches, ready, save, remove, refresh };
}

export function useAlerts() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      if (!supabase || !user) { setAlerts([]); setReady(true); return; }
      const { data } = await supabase
        .from('alerts')
        .select('id,search_id,lot_id,created_at,seen')
        .order('created_at', { ascending: false })
        .limit(200);
      if (!dead) { setAlerts((data as AlertRow[]) || []); setReady(true); }
    })();
    return () => { dead = true; };
    // user?.id, not the user object — see refresh above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const markAllSeen = useCallback(async () => {
    if (!supabase || !user) return;
    setAlerts(a => a.map(x => ({ ...x, seen: true })));
    await supabase.from('alerts').update({ seen: true }).eq('seen', false);
  }, [user]);

  return { alerts, ready, markAllSeen, unseen: alerts.filter(a => !a.seen).length };
}

/** Just the unseen count — for the nav, one cheap HEAD query per mount. */
export function useUnseenAlertCount(): number {
  const { user } = useAuth();
  const [n, setN] = useState(0);
  useEffect(() => {
    let dead = false;
    (async () => {
      if (!supabase || !user) { setN(0); return; }
      const { count } = await supabase
        .from('alerts')
        .select('id', { count: 'exact', head: true })
        .eq('seen', false);
      if (!dead) setN(count || 0);
    })();
    return () => { dead = true; };
    // user?.id, not the user object — see refresh above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  return n;
}
