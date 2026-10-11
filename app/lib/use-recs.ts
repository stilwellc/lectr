'use client';
/**
 * use-recs.ts — the reader's taste, assembled from everything the app
 * already knows about them (app/lib/recs is the pure recommender):
 *
 *   saved + owned lots   the account layer (Supabase saved_lots signed in,
 *                        localStorage 'ray-saved-lots' without auth) — each
 *                        save resolved against the loaded book through its
 *                        id aliases, else read from the snapshot it took
 *   follows              'lectr-follows' signed out, saved_searches signed in
 *   saved searches       the plain (non-follow) saved_searches rows
 *   stated price range   the quick start's (app/lib/interests) — a strong
 *                        band in scoring, never a filter that hides lots
 *
 * The profile's "Lots you may like" room and the home feed's For-you tab
 * both read this one hook, so the two lists agree.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuctionLot } from '../types';
import { useAccount } from './account';
import { useFollows } from './follows';
import { buildTaste, idAliases, type Taste, type SavedInput } from './recs';
import { usePricePref } from './interests';
import { readSignals, signalsToTaste, SIGNALS_EVENT, SIGNALS_KEY, type SignalStore } from './recs-signals';

/** the on-device signal store (app/lib/recs-signals). Read once on mount
 *  (null until then — the server and the first client render know nothing,
 *  so no hydration mismatch), then again whenever the reader ACTS on the
 *  picks here (a mark, an undo, a clear) or another tab writes. A plain
 *  visit is learned quietly and read on the next page. */
export function useSignals(): SignalStore | null {
  const [store, setStore] = useState<SignalStore | null>(null);
  const reread = useCallback(() => setStore(readSignals()), []);
  useEffect(() => {
    reread();
    const onChange = (e: Event) => { if ((e as CustomEvent<{ live?: boolean }>).detail?.live) reread(); };
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === SIGNALS_KEY) reread(); };
    window.addEventListener(SIGNALS_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(SIGNALS_EVENT, onChange); window.removeEventListener('storage', onStorage); };
  }, [reread]);
  return store;
}

export interface TasteState {
  taste: Taste;
  /** every input has loaded (saves, follows, searches, this device's
   *  signals) — before this, an empty taste is "not yet", never "cold start" */
  ready: boolean;
  /** any signal at all */
  hasSignals: boolean;
}

/** `book` = the lots the page has loaded (the live book; the full corpus
 *  once phase 2 lands) — saves resolve against it, else their snapshot */
export function useTaste(book: readonly AuctionLot[]): TasteState {
  const { savedIds, savedMeta, savedReady } = useAccount();
  const { follows, searches, ready: followsReady } = useFollows();
  const signals = useSignals();
  // the quick start's stated price range — a strong band inside recs, not a pre-filter
  const price = usePricePref();
  const anySignal = !!signals && signals.ev.length + signals.marks.length > 0;
  const byId = useMemo(() => {
    const m = new Map<string, AuctionLot>();
    if (savedIds.length || anySignal) for (const l of book) m.set(l.id, l);
    return m;
  }, [book, savedIds.length, anySignal]);
  // stable per day: recency weights move daily, not per render
  const day = new Date().toISOString().slice(0, 10);
  const taste = useMemo(() => {
    const saved: SavedInput[] = savedIds.map(id => {
      const meta = savedMeta[id];
      let lot: AuctionLot | undefined;
      for (const a of idAliases(id)) { lot = byId.get(a); if (lot) break; }
      return {
        id, lot: lot ?? null, savedAt: meta?.savedAt ?? null, owned: meta?.owned === true,
        title: meta?.title ?? null, artist: meta?.artist ?? null, estMid: meta?.estMid ?? null,
      };
    });
    // on-device signals (app/lib/recs-signals) — below every save
    const { extra, negative } = signals ? signalsToTaste(signals, Date.now(), id => byId.get(id)) : { extra: [], negative: {} };
    return buildTaste({
      saved, follows,
      searches: searches.map(s => ({ id: s.id, name: s.name, query: s.query, createdAt: s.created_at })),
      extra, negative, price,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedIds, savedMeta, byId, follows, searches, day, signals, price]);
  return {
    taste,
    ready: savedReady && followsReady && signals !== null,
    hasSignals: taste.seeds.length > 0,
  };
}
