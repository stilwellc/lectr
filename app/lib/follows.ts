'use client';
/**
 * follows.ts — what a reader follows (Oct 8): makers/players (the existing
 * FollowButton rows), and now clean categories/sub-categories and auction
 * houses. One hook for both audiences:
 *   - signed out → kept in localStorage (no account needed to personalize)
 *   - signed in  → saved_searches rows (the same table + RLS the maker follows
 *     use); follows made while signed out are carried into the account once.
 * Category/house follows are stored as { follow: 'cat'|'house', … } queries;
 * the nightly matcher (scripts/match-alerts) alerts on them only for lots that
 * clear the shortlist bar, capped — never the raw firehose.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './account';
import { useSavedSearches, type SavedQuery } from './alerts';
import { taxonOf, subMatches, CAT_LABEL, subLabel, type CatKey } from './taxonomy';

export type FollowKind = 'maker' | 'cat' | 'house' | 'entity';
export interface Follow {
  kind: FollowKind;
  /** maker/player slug · "cat" or "cat:sub" · house name · entity id (sj:/st:) */
  key: string;
  label: string;
}

export function catFollow(cat: CatKey, sub: string | null): Follow {
  return { kind: 'cat', key: sub ? `${cat}:${sub}` : cat, label: sub ? `${CAT_LABEL[cat]} · ${subLabel(cat, sub)}` : CAT_LABEL[cat] };
}
export function houseFollow(house: string): Follow {
  return { kind: 'house', key: house, label: house };
}
/** a subject / set (a Pokémon, a film, a mission, a sealed set …) by its
 *  entity id — matched on the lot's build-stamped entity key (`ek`) */
export function entityFollow(id: string, label: string): Follow {
  return { kind: 'entity', key: id, label };
}

function queryOf(f: Follow): SavedQuery {
  if (f.kind === 'maker') return { player: f.key, playerName: f.label };
  if (f.kind === 'house') return { follow: 'house', house: f.key, label: f.label };
  if (f.kind === 'entity') return { follow: 'entity', id: f.key, label: f.label };
  const [cat, sub] = f.key.split(':');
  return { follow: 'cat', cat, sub: sub || null, label: f.label };
}
function followOf(q: SavedQuery): Follow | null {
  if (q.player) return { kind: 'maker', key: q.player, label: q.playerName || q.player };
  if (q.follow === 'house' && q.house) return { kind: 'house', key: q.house, label: q.label || q.house };
  if (q.follow === 'entity' && q.id) return { kind: 'entity', key: q.id, label: q.label || q.id };
  if (q.follow === 'cat' && q.cat) return { kind: 'cat', key: q.sub ? `${q.cat}:${q.sub}` : q.cat, label: q.label || q.cat };
  return null;
}

const LS_KEY = 'lectr-follows';
function readLocal(): Follow[] {
  try { const v = JSON.parse(window.localStorage.getItem(LS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeLocal(f: Follow[]) {
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(f)); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(LS_KEY));
}

const same = (a: Follow, b: Follow) => a.kind === b.kind && a.key === b.key;

export function useFollows() {
  const { user } = useAuth();
  const { searches, save, remove, ready } = useSavedSearches();
  const [local, setLocal] = useState<Follow[]>([]);

  useEffect(() => {
    const sync = () => setLocal(readLocal());
    sync();
    window.addEventListener(LS_KEY, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(LS_KEY, sync); window.removeEventListener('storage', sync); };
  }, []);

  const cloud = useMemo(
    () => searches.map(s => ({ id: s.id, f: followOf(s.query || {}) })).filter((x): x is { id: string; f: Follow } => !!x.f),
    [searches]
  );

  // signed in: carry the signed-out follows into the account, once
  useEffect(() => {
    if (!user || !ready || !local.length) return;
    (async () => {
      for (const f of local) {
        if (!cloud.some(c => same(c.f, f))) await save(`Following ${f.label}`, queryOf(f));
      }
      writeLocal([]);
    })();
  }, [user, ready, local, cloud, save]);

  const follows: Follow[] = user ? cloud.map(c => c.f) : local;

  const isFollowing = useCallback((f: Follow) => follows.some(x => same(x, f)), [follows]);

  const toggle = useCallback(async (f: Follow) => {
    if (user) {
      const hit = cloud.find(c => same(c.f, f));
      if (hit) await remove(hit.id);
      else await save(`Following ${f.label}`, queryOf(f));
      return;
    }
    const cur = readLocal();
    writeLocal(cur.some(x => same(x, f)) ? cur.filter(x => !same(x, f)) : [...cur, f]);
  }, [user, cloud, save, remove]);

  // the plain saved searches (not follows) ride the same fetch — the
  // recommender reads them as the weakest taste signal (app/lib/recs)
  const searchesPlain = useMemo(
    () => (user ? searches.filter(s => !followOf(s.query || {})) : []),
    [user, searches]
  );

  return { follows, isFollowing, toggle, signedIn: !!user, searches: searchesPlain, ready: !user || ready };
}

/**
 * How strongly one lot matches the reader's follows (0–1): a followed maker or
 * player (or subject / set) 1, a followed sub-category 0.8, a whole category 0.6, a house 0.4.
 */
export function affinityOf(
  l: { artist?: string | null; playerSlug?: string | null; auctionHouse?: string | null; subCat?: string | null; drill?: string | null; ek?: string | null },
  follows: Follow[],
): number {
  if (!follows.length) return 0;
  const t = taxonOf(l);
  let a = 0;
  for (const f of follows) {
    if (f.kind === 'maker' && (l.artist === f.key || l.playerSlug === f.key)) a = Math.max(a, 1);
    else if (f.kind === 'cat') {
      const [cat, sub] = f.key.split(':');
      if (t.cat === cat && (!sub || subMatches(cat, sub, t.sub))) a = Math.max(a, sub ? 0.8 : 0.6);
    } else if (f.kind === 'house' && l.auctionHouse === f.key) a = Math.max(a, 0.4);
    else if (f.kind === 'entity' && l.ek === f.key) a = Math.max(a, 1);
  }
  return a;
}
