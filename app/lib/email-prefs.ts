'use client';
/**
 * The Daily Desk email opt-in (Oct 21 2026) — public.email_prefs (migration
 * 0011). Off by default; the reader turns it on in Account. Signed-in only (the
 * address is the account's). Before the migration runs, the read fails and
 * the toggle simply doesn't render ('unavailable').
 */
import { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type DailyState = 'loading' | 'on' | 'off' | 'unavailable';

export function useDailyEmail(user: User | null): { state: DailyState; busy: boolean; set: (on: boolean) => void; /** the day the last edition went out (YYYY-MM-DD), null before the first — Today's edition reads it */ lastSentOn: string | null } {
  const [state, setState] = useState<DailyState>('loading');
  const [busy, setBusy] = useState(false);
  const [lastSentOn, setLastSentOn] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!supabase || !user) { setState('unavailable'); return; }
    setState('loading');
    supabase.from('email_prefs').select('daily,last_sent_on').eq('user_id', user.id).maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        if (error) { setState('unavailable'); return; }
        setState(data?.daily ? 'on' : 'off');
        setLastSentOn(typeof data?.last_sent_on === 'string' ? data.last_sent_on.slice(0, 10) : null);
      });
    return () => { live = false; };
  }, [user]);
  const set = useCallback((on: boolean) => {
    if (!supabase || !user) return;
    const prev = state;
    setState(on ? 'on' : 'off');
    setBusy(true);
    supabase.from('email_prefs').upsert({ user_id: user.id, daily: on, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .then(({ error }) => {
        setBusy(false);
        if (error) { console.error('[email-prefs]', error.message); setState(prev); }
      });
  }, [user, state]);
  return { state, busy, set, lastSentOn };
}
