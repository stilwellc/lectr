/**
 * recs-signals.ts — what lectr learns ON THIS DEVICE (Oct 11 2026).
 *
 * A private, local-only memory of what the reader did, feeding "Lots you
 * may like" (app/lib/recs) below anything they said out loud:
 *
 *   lot      a lot page opened                          .25
 *   comps    a comps modal opened (the feed's open)     .25
 *   entity   a maker / player / subject page visited    .20
 *   search   a term typed in the feed or ⌘K (terms only) .15
 *   more     "More like this" on a pick                 .70
 *   less     "Not for me" on a pick — that lot never comes back, its
 *            entity and card identity are quieted
 *
 * × decay (halves every 21 days; anything older than 90 days is dropped)
 * × repeat (a lot opened again reads a little louder, capped) × dwell (a
 * page read for 20s+ reads a little louder). A save (.75) always outweighs
 * every implicit signal.
 *
 * NEVER SENT ANYWHERE: localStorage only (`lectr-signals`, versioned), every
 * access wrapped (private mode / full quota / corrupted JSON = an empty
 * memory, never a crash). Capped at 200 events + 100 marks. The profile's
 * "Clear what lectr learned on this device" empties it.
 *
 * Pure apart from the storage handle: the tests pass their own.
 */
import { useEffect, useRef } from 'react';
import { cardIdentityKey, type RecLot, type ExtraInput, type NegativeInput } from './recs';
import type { Follow } from './follows';
import { entityKeyOf } from './entity/key';
import { parseCard } from './cards';
import { taxonOf } from './taxonomy';
import { storageFailed, deviceKV } from './safe-storage';
import { notePickAction, clearPicks } from './pick-log';

export const SIGNALS_KEY = 'lectr-signals';
export const SIGNALS_VERSION = 1;
export const MAX_EVENTS = 200;
export const MAX_MARKS = 100;
export const HALF_LIFE_DAYS = 21;
export const MAX_AGE_DAYS = 90;
/** the same lot / page / term inside this window is one visit, not two */
const REPEAT_GAP_MS = 30 * 60_000;

export type SignalKind = 'lot' | 'comps' | 'entity' | 'search';
export type MarkKind = 'more' | 'less';

export const SIGNAL_WEIGHT: Record<SignalKind | 'more', number> = {
  lot: 0.25, comps: 0.25, entity: 0.2, search: 0.15, more: 0.7,
};

/** the slice of a lot the recommender reads, kept so a signal still says
 *  what it was after the lot leaves the loaded book */
export type LotSnap = Pick<RecLot,
  'id' | 'artist' | 'title' | 'status' | 'subCat' | 'drill' | 'auctionHouse' | 'saleDate' | 'saleDateTime'
  | 'estimateLow' | 'estimateHigh' | 'currentBid' | 'currency' | 'priceUsd' | 'playerSlug' | 'playerName' | 'formKey' | 'ek'>;

export interface SignalEvent {
  k: SignalKind;
  /** lot id · entity id · search term (lower-cased) */
  id: string;
  /** first and last time (ms) */
  t0: number;
  t: number;
  /** visits (a repeat inside REPEAT_GAP_MS is the same visit) */
  n: number;
  /** longest dwell seen, ms (lot / entity pages) */
  dwell?: number;
  label?: string;
  lot?: LotSnap;
}
export interface SignalMark {
  k: MarkKind;
  id: string;
  t: number;
  /** the entity id / card identity a "less" quiets */
  keys?: string[];
  lot?: LotSnap;
}
export interface SignalStore { v: number; ev: SignalEvent[]; marks: SignalMark[] }

/** a localStorage-shaped handle (tests pass a Map-backed one) */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const empty = (): SignalStore => ({ v: SIGNALS_VERSION, ev: [], marks: [] });

/** the browser's storage through safe-storage: blocked or full storage
 *  reads empty and keeps this page's writes in memory (never a throw on read) */
function defaultKV(): KV | null {
  return typeof window !== 'undefined' ? deviceKV : null;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const KINDS = new Set<string>(['lot', 'comps', 'entity', 'search']);

const SNAP_STR = ['status', 'subCat', 'drill', 'auctionHouse', 'saleDate', 'saleDateTime', 'currency', 'playerSlug', 'playerName', 'formKey'] as const;
const SNAP_NUM = ['estimateLow', 'estimateHigh', 'currentBid', 'priceUsd'] as const;

/** a stored lot snapshot, checked field by field: an object whose id and
 *  title are strings (else no snapshot); every other field kept only when it
 *  has its own type — a snapshot is fed to the recommender and printed */
export function cleanSnap(x: unknown): LotSnap | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id || typeof o.title !== 'string') return undefined;
  const s: LotSnap = { id: o.id, title: o.title.slice(0, 400), artist: typeof o.artist === 'string' ? o.artist : '' };
  const w = s as Record<string, unknown>;
  for (const k of SNAP_STR) if (typeof o[k] === 'string') w[k] = o[k];
  for (const k of SNAP_NUM) if (isNum(o[k])) w[k] = o[k];
  if (typeof o.ek === 'string' || o.ek === null) w.ek = o.ek;
  return s;
}

const str = (x: unknown, max: number): string | undefined => (typeof x === 'string' && x ? x.slice(0, max) : undefined);

/** read + validate; anything malformed is dropped (field by field, entry by
 *  entry — never the page), a foreign version starts over */
export function readSignals(kv: KV | null = defaultKV(), nowMs = Date.now()): SignalStore {
  if (!kv) return empty();
  let raw: string | null = null;
  try { raw = kv.getItem(SIGNALS_KEY); } catch { return empty(); }
  if (!raw) return empty();
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return empty(); }
  if (!j || typeof j !== 'object' || (j as SignalStore).v !== SIGNALS_VERSION) return empty();
  const o = j as Partial<SignalStore>;
  const cutoff = nowMs - MAX_AGE_DAYS * 864e5;
  const ev: SignalEvent[] = [];
  for (const x of Array.isArray(o.ev) ? o.ev : []) {
    if (!x || typeof x !== 'object') continue;
    const e = x as unknown as Record<string, unknown>;
    if (typeof e.k !== 'string' || !KINDS.has(e.k) || typeof e.id !== 'string' || !e.id || !isNum(e.t) || e.t < cutoff) continue;
    const out: SignalEvent = { k: e.k as SignalKind, id: e.id.slice(0, 200), t: e.t, t0: isNum(e.t0) ? e.t0 : e.t, n: isNum(e.n) && e.n > 0 ? Math.min(Math.round(e.n), 99) : 1 };
    if (isNum(e.dwell) && e.dwell > 0) out.dwell = e.dwell;
    const label = str(e.label, 80);
    if (label) out.label = label;
    const lot = cleanSnap(e.lot);
    if (lot) out.lot = lot;
    ev.push(out);
  }
  const marks: SignalMark[] = [];
  for (const x of Array.isArray(o.marks) ? o.marks : []) {
    if (!x || typeof x !== 'object') continue;
    const m = x as unknown as Record<string, unknown>;
    if ((m.k !== 'more' && m.k !== 'less') || typeof m.id !== 'string' || !m.id || !isNum(m.t)) continue;
    const out: SignalMark = { k: m.k, id: m.id, t: m.t };
    if (Array.isArray(m.keys)) out.keys = m.keys.filter((k): k is string => typeof k === 'string' && !!k).slice(0, 8);
    const lot = cleanSnap(m.lot);
    if (lot) out.lot = lot;
    marks.push(out);
  }
  return { v: SIGNALS_VERSION, ev: ev.slice(-MAX_EVENTS), marks: marks.slice(-MAX_MARKS) };
}

function write(store: SignalStore, kv: KV | null, live = false): boolean {
  if (!kv) { if (live) storageFailed(); return false; }
  const out: SignalStore = { v: SIGNALS_VERSION, ev: store.ev.slice(-MAX_EVENTS), marks: store.marks.slice(-MAX_MARKS) };
  try {
    kv.setItem(SIGNALS_KEY, JSON.stringify(out));
  } catch {
    // full quota: halve the memory once and try again, else give up quietly
    try { out.ev = out.ev.slice(-Math.floor(MAX_EVENTS / 2)); kv.setItem(SIGNALS_KEY, JSON.stringify(out)); } catch {
      // a mark / undo the reader pressed did not stick: say so (a quiet
      // visit that could not be learned is not worth a word). The default
      // handle (safe-storage) still holds it for this page, so the list
      // re-reads and the pressed state shows — it just won't survive a reload.
      if (live) storageFailed();
      notify(live);
      return false;
    }
  }
  notify(live);
  return true;
}

/* ── change notification (the hook in use-recs listens) ── */
export const SIGNALS_EVENT = 'lectr-signals-change';
/** `live` = the reader acted on the picks (a mark, an undo, a clear): the
 *  list re-ranks now. A plain visit is learned quietly and read on the next
 *  page — a pick you just opened never reshuffles the list under you. */
function notify(live: boolean) {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SIGNALS_EVENT, { detail: { live } })); } catch { /* no window */ }
}

export function snapOf(l: RecLot): LotSnap {
  const s: LotSnap = { id: l.id, artist: l.artist, title: l.title };
  const keys = ['status', 'subCat', 'drill', 'auctionHouse', 'saleDate', 'saleDateTime', 'estimateLow', 'estimateHigh',
    'currentBid', 'currency', 'priceUsd', 'playerSlug', 'playerName', 'formKey', 'ek'] as const;
  for (const k of keys) {
    const v = l[k];
    if (v != null) (s as Record<string, unknown>)[k] = v;
  }
  return s;
}

/** record a visit (lot / comps / entity / search). Repeats inside 30 min
 *  are one visit; the event moves to the newest end. */
export function recordSignal(
  k: SignalKind, id: string, extra: { label?: string; lot?: RecLot; dwell?: number } = {},
  kv: KV | null = defaultKV(), nowMs = Date.now(),
): void {
  const key = k === 'search' ? id.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60) : id;
  if (!key || (k === 'search' && key.length < 3)) return;
  const st = readSignals(kv, nowMs);
  const i = st.ev.findIndex(e => e.k === k && e.id === key);
  const prev = i >= 0 ? st.ev.splice(i, 1)[0] : null;
  const e: SignalEvent = prev
    ? { ...prev, t: nowMs, n: nowMs - prev.t > REPEAT_GAP_MS ? Math.min(prev.n + 1, 99) : prev.n }
    : { k, id: key, t0: nowMs, t: nowMs, n: 1 };
  if (extra.label) e.label = extra.label.slice(0, 80);
  if (extra.lot) e.lot = snapOf(extra.lot);
  if (extra.dwell != null) e.dwell = Math.max(e.dwell ?? 0, Math.round(extra.dwell));
  st.ev.push(e);
  write(st, kv);
  // a pick lectr showed, opened (app/lib/pick-log) — the live store only
  if ((k === 'lot' || k === 'comps') && kv === defaultKV()) notePickAction(key, 'o');
}

/** a page's dwell, reported when the reader leaves it (no new visit) */
export function recordDwell(k: SignalKind, id: string, ms: number, kv: KV | null = defaultKV(), nowMs = Date.now()): void {
  if (!(ms > 0)) return;
  const st = readSignals(kv, nowMs);
  const e = st.ev.find(x => x.k === k && x.id === id);
  if (!e || (e.dwell ?? 0) >= ms) return;
  e.dwell = Math.round(ms);
  write(st, kv);
}

/** the identities a "Not for me" quiets: the lot's entity, its card in any grade */
export function quietKeysOf(l: RecLot): string[] {
  const out: string[] = [];
  try {
    const ek = l.ek !== undefined ? l.ek : entityKeyOf(l);
    if (ek && !ek.startsWith('cs:')) out.push(ek);
    const t = taxonOf(l);
    if ((t.cat === 'sports-cards' || t.cat === 'tcg') && l.title) {
      const c = cardIdentityKey(parseCard(l.title), t.cat);
      if (c) out.push(`card:${c}`);
    }
  } catch { /* a lot the taxonomy cannot read quiets only itself */ }
  return out;
}

/** "More like this" / "Not for me" on one lot (the other mark is replaced).
 *  Returns the previous mark (or null) so the caller can undo. */
export function markLot(k: MarkKind, lot: RecLot, kv: KV | null = defaultKV(), nowMs = Date.now()): SignalMark | null {
  const st = readSignals(kv, nowMs);
  const i = st.marks.findIndex(m => m.id === lot.id);
  const prev = i >= 0 ? st.marks.splice(i, 1)[0] : null;
  const m: SignalMark = { k, id: lot.id, t: nowMs, lot: snapOf(lot) };
  if (k === 'less') m.keys = quietKeysOf(lot);
  st.marks.push(m);
  write(st, kv, true);
  if (kv === defaultKV()) { notePickAction(lot.id, k === 'more' ? 'm' : 'x'); notePickAction(lot.id, k === 'more' ? 'x' : 'm', false); }
  return prev;
}

/** undo: drop the lot's mark, restoring the one it replaced (if any) */
export function unmarkLot(id: string, restore: SignalMark | null = null, kv: KV | null = defaultKV(), nowMs = Date.now()): void {
  const st = readSignals(kv, nowMs);
  st.marks = st.marks.filter(m => m.id !== id);
  if (restore) st.marks.push(restore);
  write(st, kv, true);
  if (kv === defaultKV()) {
    notePickAction(id, 'm', restore?.k === 'more');
    notePickAction(id, 'x', restore?.k === 'less');
  }
}

export function markOf(id: string, store: SignalStore): MarkKind | null {
  return store.marks.find(m => m.id === id)?.k ?? null;
}

/** "Clear what lectr learned on this device" */
export function clearSignals(kv: KV | null = defaultKV()): void {
  try { kv?.removeItem(SIGNALS_KEY); } catch { /* nothing to clear */ }
  // the picks lectr showed (and how they did) are part of what it kept here
  if (kv === defaultKV()) clearPicks();
  notify(true);
}

export function signalCount(store: SignalStore): number { return store.ev.length + store.marks.length; }

const decay = (t: number, nowMs: number) => Math.pow(0.5, Math.max(0, nowMs - t) / 864e5 / HALF_LIFE_DAYS);

/** an entity page id as a follow-shaped seed (maker / player by slug) */
export function entityFollowOf(id: string, label: string): Follow {
  const m = id.match(/^(mk|pl):(.+)$/);
  return m ? { kind: 'maker', key: m[2], label } : { kind: 'entity', key: id, label };
}

/**
 * The store as the recommender's optional inputs: weighted extra seeds and
 * the "Not for me" list. `resolve` swaps a snapshot for the loaded book's
 * live row when it has one.
 */
export function signalsToTaste(
  store: SignalStore, nowMs = Date.now(), resolve?: (id: string) => RecLot | null | undefined,
): { extra: ExtraInput[]; negative: NegativeInput } {
  const lessIds = new Set(store.marks.filter(m => m.k === 'less').map(m => m.id));
  // one entry per mark: two passes on one maker quiet it twice
  const keys: string[] = [];
  for (const m of store.marks) if (m.k === 'less') for (const k of m.keys ?? []) keys.push(k);
  const extra: ExtraInput[] = [];
  const lotOf = (id: string, snap?: LotSnap): RecLot | null => resolve?.(id) ?? (snap && snap.title ? snap : null);

  // one seed per lot: the strongest of its views; "more" replaces a view
  const lotW = new Map<string, { w: number; lot: RecLot; reason: string }>();
  for (const m of store.marks) {
    if (m.k !== 'more') continue;
    const lot = lotOf(m.id, m.lot);
    if (lot) lotW.set(m.id, { w: SIGNAL_WEIGHT.more * decay(m.t, nowMs), lot, reason: 'asked for more like' });
  }
  for (const e of store.ev) {
    const repeat = Math.min(1.6, 1 + 0.2 * (e.n - 1));
    const dwell = (e.dwell ?? 0) >= 20_000 ? 1.25 : 1;
    const w = SIGNAL_WEIGHT[e.k] * decay(e.t, nowMs) * repeat * dwell;
    if (e.k === 'lot' || e.k === 'comps') {
      if (lessIds.has(e.id)) continue;
      const cur = lotW.get(e.id);
      if (cur && (cur.reason !== 'looked at' || cur.w >= w)) continue;
      const lot = lotOf(e.id, e.lot);
      if (lot) lotW.set(e.id, { w, lot, reason: 'looked at' });
    } else if (e.k === 'entity') {
      if (keys.includes(e.id)) continue;
      extra.push({ follow: entityFollowOf(e.id, e.label || e.id), weight: w, reason: 'looked at' });
    } else if (e.k === 'search') {
      extra.push({ text: e.id, weight: w, reason: 'searched' });
    }
  }
  for (const v of Array.from(lotW.values())) extra.push({ lot: v.lot, weight: v.w, reason: v.reason });
  return { extra, negative: { ids: lessIds, keys } };
}

/**
 * Learn one visit (a lot page, a comps modal, an entity page) when `id`
 * settles, and its dwell when the reader leaves (unmount, id change, tab
 * hidden). `extra` is read at record time (the lot snapshot, the label).
 */
export function useLearnVisit(k: SignalKind, id: string | null | undefined, extra?: () => { label?: string; lot?: RecLot } | null): void {
  const extraRef = useRef(extra);
  extraRef.current = extra;
  useEffect(() => {
    if (!id) return;
    const x = extraRef.current?.() ?? {};
    // a lot visit needs its snapshot (else it could never be read back)
    if ((k === 'lot' || k === 'comps') && !x.lot) return;
    recordSignal(k, id, x);
    const start = Date.now();
    let done = false;
    const leave = () => { if (done) return; done = true; recordDwell(k, id, Date.now() - start); };
    const onHide = () => { if (document.visibilityState === 'hidden') leave(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [k, id]);
}
