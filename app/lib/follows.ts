'use client';
/**
 * follows.ts — what a reader follows (Oct 8): makers/players (the existing
 * FollowButton rows), and now clean categories/sub-categories and auction
 * houses. One hook for both audiences:
 *   - signed out → kept in localStorage (no account needed to personalize)
 *   - signed in  → saved_searches rows (the same table + RLS the maker follows
 *     use); follows made while signed out are carried into the account once.
 * (Oct 11) makers and players too: a signed-out maker/player follow is kept
 * on the device like every other kind (it used to ask for sign-in) and rides
 * the same carry-over into saved_searches as { player, playerName } — the
 * exact row FollowButton always wrote — the moment the reader signs in.
 * Category/house follows are stored as { follow: 'cat'|'house', … } queries;
 * the nightly matcher (scripts/match-alerts) alerts on them only for lots that
 * clear the shortlist bar, capped — never the raw firehose.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './account';
import { useSavedSearches, type SavedQuery } from './alerts';
import { taxonOf, subMatches, CAT_LABEL, subLabel, type CatKey } from './taxonomy';
import { storageGet, storageSet } from './safe-storage';

export type FollowKind = 'maker' | 'cat' | 'house' | 'entity';
export interface Follow {
  kind: FollowKind;
  /** maker/player slug · "cat" or "cat:sub" · house name · entity id (sj:/st:) */
  key: string;
  label: string;
}

/** a maker (art/design/watches) or a player, by slug — the row FollowButton
 *  and the /makers + have always written ({ player, playerName }) */
export function makerFollow(slug: string, label: string): Follow {
  return { kind: 'maker', key: slug, label };
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

/** the saved_searches query a follow is stored as (signed in) */
export function queryOf(f: Follow): SavedQuery {
  if (f.kind === 'maker') return { player: f.key, playerName: f.label };
  if (f.kind === 'house') return { follow: 'house', house: f.key, label: f.label };
  if (f.kind === 'entity') return { follow: 'entity', id: f.key, label: f.label };
  const [cat, sub] = f.key.split(':');
  return { follow: 'cat', cat, sub: sub || null, label: f.label };
}
/** a saved_searches query read back as a follow (null: a plain search) */
export function followOf(q: SavedQuery): Follow | null {
  if (q.player) return { kind: 'maker', key: q.player, label: q.playerName || q.player };
  if (q.follow === 'house' && q.house) return { kind: 'house', key: q.house, label: q.label || q.house };
  if (q.follow === 'entity' && q.id) return { kind: 'entity', key: q.id, label: q.label || q.id };
  if (q.follow === 'cat' && q.cat) return { kind: 'cat', key: q.sub ? `${q.cat}:${q.sub}` : q.cat, label: q.label || q.cat };
  return null;
}

const LS_KEY = 'lectr-follows';
const FOLLOW_KINDS = new Set<string>(['maker', 'cat', 'house', 'entity']);

/** one stored follow, checked: an object with a known kind and a non-empty
 *  string key + label. Anything else (a null, a number label, a foreign
 *  kind) is dropped on read — bad device data must never crash a page. */
export function isFollow(x: unknown): x is Follow {
  if (!x || typeof x !== 'object') return false;
  const f = x as Record<string, unknown>;
  return typeof f.kind === 'string' && FOLLOW_KINDS.has(f.kind)
    && typeof f.key === 'string' && f.key.length > 0 && f.key.length <= 200
    && typeof f.label === 'string';
}

/** the device's follows from their stored text: valid entries only, once each */
export function parseFollows(raw: string | null | undefined): Follow[] {
  if (!raw) return [];
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out: Follow[] = [];
  for (const x of v) {
    if (!isFollow(x) || out.some(o => o.kind === x.kind && o.key === x.key)) continue;
    out.push({ kind: x.kind, key: x.key, label: x.label.slice(0, 120) || x.key });
  }
  return out;
}

function readLocal(): Follow[] {
  return parseFollows(storageGet(LS_KEY));
}
/** false when the browser refused the write (blocked / full) — the page's
 *  "Couldn't save that on this device" note is raised by safe-storage */
function writeLocal(f: Follow[]): boolean {
  const ok = storageSet(LS_KEY, JSON.stringify(f), { announce: true });
  try { window.dispatchEvent(new Event(LS_KEY)); } catch { /* no window */ }
  return ok;
}

export const sameFollow = (a: Follow, b: Follow) => a.kind === b.kind && a.key === b.key;
const same = sameFollow;

/** the account the device's follows were last carried into — module-wide, as
 *  every mounted useFollows runs the carry-over effect (one pass per sign-in;
 *  a failed save stays on the device for the next visit, never a retry loop) */
let migratedFor: string | null = null;

/** the signed-out follows still to carry into the account: each local follow
 *  the account lacks, once (a follow tapped twice on the device is one row) */
export function migrationPlan(local: readonly Follow[], cloud: readonly Follow[]): Follow[] {
  const out: Follow[] = [];
  for (const f of local) {
    if (!isFollow(f)) continue;
    if (cloud.some(c => same(c, f)) || out.some(o => same(o, f))) continue;
    out.push(f);
  }
  return out;
}

/** the follows to add and drop so `current` becomes `picked` — dropping only
 *  among `offered` (what the picker showed): a follow the reader never saw in
 *  this pass is never removed by it */
export function followsDiff(current: readonly Follow[], picked: readonly Follow[], offered: readonly Follow[]): { add: Follow[]; drop: Follow[] } {
  const add = migrationPlan(picked, current);
  const drop = current.filter(c => offered.some(o => same(o, c)) && !picked.some(p => same(p, c)));
  return { add, drop };
}

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

  // signed in: carry the signed-out follows (makers and players included)
  // into the account, once per sign-in (migratedFor: each save refreshes
  // `cloud`, which re-runs this effect mid-loop). A follow whose save failed
  // stays on the device for the next visit rather than being dropped.
  useEffect(() => { if (!user) migratedFor = null; }, [user]);
  useEffect(() => {
    if (!user || !ready || !local.length || migratedFor === user.id) return;
    migratedFor = user.id;
    (async () => {
      const kept: Follow[] = [];
      for (const f of migrationPlan(local, cloud.map(c => c.f))) {
        let r: string = 'error';
        try { r = await save(`Following ${f.label}`, queryOf(f)); } catch { /* kept below */ }
        if (r === 'error') kept.push(f);
      }
      writeLocal(kept);
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

  /** several follows at once (the quick start's finish): add `add`, drop
   *  `drop` — one device write signed out, one row each signed in */
  const applyMany = useCallback(async ({ add, drop }: { add: Follow[]; drop: Follow[] }) => {
    if (user) {
      for (const f of drop) { const hit = cloud.find(c => same(c.f, f)); if (hit) await remove(hit.id); }
      for (const f of add) if (!cloud.some(c => same(c.f, f))) await save(`Following ${f.label}`, queryOf(f));
      return;
    }
    const cur = readLocal().filter(x => !drop.some(d => same(d, x)));
    writeLocal([...cur, ...migrationPlan(add, cur)]);
  }, [user, cloud, save, remove]);

  // the plain saved searches (not follows) ride the same fetch — the
  // recommender reads them as the weakest taste signal (app/lib/recs)
  const searchesPlain = useMemo(
    () => (user ? searches.filter(s => !followOf(s.query || {})) : []),
    [user, searches]
  );

  return { follows, isFollowing, toggle, applyMany, signedIn: !!user, searches: searchesPlain, ready: !user || ready };
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
