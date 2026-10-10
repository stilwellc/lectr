'use client';
/**
 * entity/view-state.ts — ONE URL CODEC for every /makers key (makers
 * overhaul P1).
 *
 * Before: a hand-rolled effect owned q,on,vi,fl,fw,sort,cols,open,spk,by and
 * ran in the same commit as the restore (briefly stripping the URL), while
 * useUrlState owned the triage keys; compare, Display and the dossier's live
 * order were not in the URL at all, and row hrefs read window.location
 * during render.
 *
 * Now: one MakersView, decoded once on mount, written SYNCHRONOUSLY in the
 * setter (history.replaceState, the useUrlState pattern), re-written under a
 * market switch (the switch pushState's a bare path), re-read on popstate
 * (Back restores). Hrefs are built from the state (viewSearch), never from
 * window.location at render.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ARTISTS } from '../../constants';
import { TRIAGE_DEFAULTS, triageFromParams, triageToParams, type TriageFilters } from '../feed-filters';
import { SPORTS } from '../taxonomy';
import { kindOfId, makerId, subjectId, setId, playerId, subId } from './model';
import { isRestId, restId } from './kinds';
import type { Market } from '../../constants';

export type SortKey = 'matters' | 'sold' | 'live' | 'flags' | 'median' | 'delta' | 'name';
export const SORT_KEYS: SortKey[] = ['matters', 'sold', 'live', 'flags', 'median', 'delta', 'name'];
export const DEFAULT_SORT: SortKey = 'matters';

export type ColKey = 'curve' | 'median' | 'delta' | 'flags' | 'live' | 'sold' | 'record' | 'settled' | 'velocity';
export const COL_KEYS: ColKey[] = ['curve', 'median', 'delta', 'flags', 'live', 'sold', 'record', 'settled', 'velocity'];
// (Oct 9 r4) Verified Δ is opt-in: it prints a dash on all but a handful of rows
export const DEFAULT_COLS: ColKey[] = ['curve', 'median', 'flags', 'live', 'sold'];

export type LiveSort = 'matters' | 'closing' | 'est';
export const LIVE_SORT_KEYS: LiveSort[] = ['matters', 'closing', 'est'];

export type RowsBy = 'name' | 'cat';

/** the compare tray holds at most four picks */
export const COMPARE_MAX = 4;

export interface MakersView {
  /** the roster filter text */
  q: string;
  /** chips: on the block · verified index · flagged · following */
  on: boolean; vi: boolean; fl: boolean; fw: boolean;
  sort: SortKey;
  /** the Display menu's visible columns */
  cols: ColKey[];
  /** the open dossier (an entity id, or a market's remainder row) */
  open: string | null;
  /** the open dossier's live-book order */
  ls: LiveSort;
  /** the sports sport pick */
  spk: string | null;
  /** collection markets: By name (subjects) or By category (clean subs) */
  by: RowsBy;
  /** the compare tray's picks (entity ids) */
  cmp: string[];
  /** the triage row (window, category, house, value, new, facets) */
  triage: TriageFilters;
}

export const VIEW_DEFAULTS: MakersView = {
  q: '', on: false, vi: false, fl: false, fw: false,
  sort: DEFAULT_SORT, cols: DEFAULT_COLS, open: null, ls: 'matters', spk: null, by: 'name', cmp: [],
  triage: TRIAGE_DEFAULTS,
};

/** every key the codec owns (the triage keys are feed-filters') */
export const VIEW_KEYS = ['q', 'on', 'vi', 'fl', 'fw', 'sort', 'cols', 'open', 'ls', 'spk', 'by', 'cmp'] as const;

const ROSTER: ReadonlySet<string> = new Set<string>(ARTISTS.map(a => a.slug));

/**
 * A URL row id → an entity id. Accepts the current grammar (mk: / pl: / sj: /
 * st: / cs: / ~:<market>), a bare maker slug (the pretty form makers are
 * written in), and the pre-overhaul row slugs so shared links keep working:
 * `s:<market>|<subjectKey>` (subject rows) and `c:<cat>:<sub>` (sub rows).
 */
export function idFromParam(v: string | null | undefined): string | null {
  if (!v) return null;
  if (kindOfId(v) || isRestId(v)) return v;
  if (v.startsWith('s:')) {
    const body = v.slice(2);
    const i = body.indexOf('|');
    if (i < 0) return null;
    const market = body.slice(0, i) as Market;
    const key = body.slice(i + 1);
    if (key === '~') return restId(market);
    if (market === 'sports' && key.startsWith('p:')) return playerId(key.slice(2));
    if (key.startsWith('s:')) return setId(market, key);
    return subjectId(market, key);
  }
  if (v.startsWith('c:')) {
    const [cat, sub] = v.slice(2).split(':');
    return cat && sub ? subId(cat, sub) : null;
  }
  return ROSTER.has(v) ? makerId(v) : null;
}

/** an entity id → its URL form (a maker as its bare slug) */
export function idToParam(id: string): string {
  return id.startsWith('mk:') ? id.slice(3) : id;
}

export function decodeView(p: URLSearchParams): MakersView {
  const sort = p.get('sort') as SortKey | null;
  const spk = p.get('spk');
  const cols = (p.get('cols') || '').split('.').filter((k): k is ColKey => (COL_KEYS as string[]).includes(k));
  const ls = p.get('ls') as LiveSort | null;
  const cmp: string[] = [];
  for (const raw of (p.get('cmp') || '').split(',')) {
    const id = idFromParam(raw);
    if (id && !cmp.includes(id) && cmp.length < COMPARE_MAX) cmp.push(id);
  }
  return {
    q: p.get('q') || '',
    on: p.get('on') === '1',
    vi: p.get('vi') === '1',
    fl: p.get('fl') === '1',
    fw: p.get('fw') === '1',
    sort: sort && SORT_KEYS.includes(sort) ? sort : DEFAULT_SORT,
    cols: cols.length ? cols : DEFAULT_COLS,
    open: idFromParam(p.get('open')),
    ls: ls && LIVE_SORT_KEYS.includes(ls) ? ls : 'matters',
    spk: spk && SPORTS.some(x => x.key === spk) ? spk : null,
    by: p.get('by') === 'cat' ? 'cat' : 'name',
    cmp,
    triage: triageFromParams(p),
  };
}

/** write the view into `p` (owned keys cleared first; defaults omitted) */
export function encodeView(v: MakersView, p: URLSearchParams): void {
  for (const k of VIEW_KEYS) p.delete(k);
  if (v.spk) p.set('spk', v.spk);
  if (v.by === 'cat') p.set('by', 'cat');
  if (v.q.trim()) p.set('q', v.q.trim());
  if (v.on) p.set('on', '1');
  if (v.vi) p.set('vi', '1');
  if (v.fl) p.set('fl', '1');
  if (v.fw) p.set('fw', '1');
  if (v.sort !== DEFAULT_SORT) p.set('sort', v.sort);
  if (v.cols.join('.') !== DEFAULT_COLS.join('.')) p.set('cols', v.cols.join('.'));
  if (v.open) {
    p.set('open', idToParam(v.open));
    if (v.ls !== 'matters') p.set('ls', v.ls);
  }
  if (v.cmp.length) p.set('cmp', v.cmp.map(idToParam).join(','));
  triageToParams(v.triage, p);
}

/** the view as a query string ('' or '?…') — what hrefs carry instead of
 *  reading window.location at render */
export function viewSearch(v: MakersView): string {
  const p = new URLSearchParams();
  encodeView(v, p);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export type ViewPatch = Partial<MakersView> | ((prev: MakersView) => Partial<MakersView> | MakersView);

/** apply a patch; the dossier's live order belongs to the dossier, so it
 *  resets when another opens */
export function patchView(prev: MakersView, patch: ViewPatch): MakersView {
  const d = typeof patch === 'function' ? patch(prev) : patch;
  let changed = false;
  for (const k of Object.keys(d) as (keyof MakersView)[]) if (d[k] !== prev[k]) { changed = true; break; }
  if (!changed) return prev;
  const next = { ...prev, ...d };
  if (next.open !== prev.open && !('ls' in d)) next.ls = 'matters';
  return next;
}

function writeUrl(v: MakersView) {
  try {
    const p = new URLSearchParams(window.location.search);
    encodeView(v, p);
    const qs = p.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', url);
    }
  } catch { /* ignore */ }
}

/**
 * useMakersView — the /makers view state, URL-backed.
 *   [view, set, hydrated]
 * `set` writes the URL synchronously (no effect, no strip-then-rewrite);
 * `rewriteKey` (the active market) re-asserts the view onto the URL after
 * a market switch moves the path; popstate re-reads the URL.
 */
export function useMakersView(rewriteKey?: string): [MakersView, (patch: ViewPatch) => void, boolean] {
  const [view, setView] = useState<MakersView>(VIEW_DEFAULTS);
  const cur = useRef<MakersView>(VIEW_DEFAULTS);
  const hydrated = useRef(false);
  const [isHydrated, setHydrated] = useState(false);
  useEffect(() => {
    const v = decodeView(new URLSearchParams(window.location.search));
    cur.current = v;
    hydrated.current = true;
    setView(v);
    setHydrated(true);
    // Back / Forward: the entry's URL is the view
    const onPop = () => {
      const nv = decodeView(new URLSearchParams(window.location.search));
      cur.current = nv;
      setView(nv);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // a market switch pushState's the bare sibling path — put the view back on it
  const lastKey = useRef(rewriteKey);
  useEffect(() => {
    if (lastKey.current === rewriteKey) return;
    lastKey.current = rewriteKey;
    if (hydrated.current) writeUrl(cur.current);
  }, [rewriteKey]);
  const set = useCallback((patch: ViewPatch) => {
    const next = patchView(cur.current, patch);
    if (next === cur.current) return;
    cur.current = next;
    setView(next);
    if (hydrated.current) writeUrl(next);
  }, []);
  return [view, set, isHydrated];
}
