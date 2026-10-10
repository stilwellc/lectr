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
 *
 * The profile's "Lots you may like" room and the home feed's For-you tab
 * both read this one hook, so the two lists agree.
 */
import { useMemo } from 'react';
import type { AuctionLot } from '../types';
import { useAccount } from './account';
import { useFollows } from './follows';
import { buildTaste, idAliases, type Taste, type SavedInput } from './recs';

export interface TasteState {
  taste: Taste;
  /** every input has loaded (saves, follows, searches) — before this, an
   *  empty taste is "not yet", never "cold start" */
  ready: boolean;
  /** any signal at all */
  hasSignals: boolean;
}

/** `book` = the lots the page has loaded (the live book; the full corpus
 *  once phase 2 lands) — saves resolve against it, else their snapshot */
export function useTaste(book: readonly AuctionLot[]): TasteState {
  const { savedIds, savedMeta, savedReady } = useAccount();
  const { follows, searches, ready: followsReady } = useFollows();
  const byId = useMemo(() => {
    const m = new Map<string, AuctionLot>();
    if (savedIds.length) for (const l of book) m.set(l.id, l);
    return m;
  }, [book, savedIds.length]);
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
    return buildTaste({
      saved, follows,
      searches: searches.map(s => ({ id: s.id, name: s.name, query: s.query, createdAt: s.created_at })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedIds, savedMeta, byId, follows, searches, day]);
  return {
    taste,
    ready: savedReady && followsReady,
    hasSignals: taste.seeds.length > 0,
  };
}
