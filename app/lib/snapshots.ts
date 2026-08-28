'use client';

/* ── collection snapshots — the daily {paid, appraised, pieces} trail the
   profile's collection chart reads back. One snapshot per LOCAL day (the
   page's whole clock runs local); the write is guarded by a per-user
   localStorage key so an unchanged desk never re-upserts. Extracted from
   the profile page body — DB access lives in lib, pages consume hooks. ── */

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './account';
import { localToday } from '../utils';

export interface CollectionSnapshot { d: string; paid: number; appraised: number; pieces: number }

export function useCollectionSnapshots(
  collection: { rows: unknown[]; totalPaid: number; totalAppraised: number },
  fullLoaded: boolean,
): CollectionSnapshot[] {
  const { user } = useAuth();

  useEffect(() => {
    if (!supabase || !user || !fullLoaded || collection.rows.length === 0) return;
    const day = localToday();
    const guardKey = `lectr-snap-${user.id.slice(0, 8)}`;
    const guardVal = `${day}:${Math.round(collection.totalPaid)}:${Math.round(collection.totalAppraised)}:${collection.rows.length}`;
    try { if (localStorage.getItem(guardKey) === guardVal) return; } catch { /* private mode */ }
    supabase.from('collection_snapshots').upsert({
      user_id: user.id, snap_date: day,
      total_paid: Math.round(collection.totalPaid),
      total_appraised: Math.round(collection.totalAppraised),
      pieces: collection.rows.length,
    }, { onConflict: 'user_id,snap_date' }).then(({ error }) => {
      if (!error) { try { localStorage.setItem(guardKey, guardVal); } catch { /* ignore */ } }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, fullLoaded, collection]);

  const [snaps, setSnaps] = useState<CollectionSnapshot[]>([]);
  useEffect(() => {
    if (!supabase || !user) { setSnaps([]); return; }
    let dead = false;
    // MOST RECENT 180 days — ascending+limit returned the OLDEST 180, which
    // would freeze the chart in the past once a user out-lives the window
    supabase.from('collection_snapshots')
      .select('snap_date,total_paid,total_appraised,pieces')
      .eq('user_id', user.id)
      .order('snap_date', { ascending: false })
      .limit(180)
      .then(({ data, error }) => {
        if (dead || error || !data) return;
        const rows = data.map(r => ({ d: r.snap_date as string, paid: r.total_paid as number, appraised: r.total_appraised as number, pieces: r.pieces as number }));
        rows.reverse(); // chart reads oldest → newest
        setSnaps(rows);
      });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return snaps;
}
