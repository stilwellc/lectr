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

export function useDailyEmail(user: User | null): { state: DailyState; busy: boolean; set: (on: boolean) => void } {
  const [state, setState] = useState<DailyState>('loading');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    if (!supabase || !user) { setState('unavailable'); return; }
    setState('loading');
    supabase.from('email_prefs').select('daily').eq('user_id', user.id).maybeSingle()
      .then(({ data, error }) => {
        if (!live) return;
        if (error) { setState('unavailable'); return; }
        setState(data?.daily ? 'on' : 'off');
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
  return { state, busy, set };
}
