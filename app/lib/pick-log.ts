/**
 * pick-log.ts — HOW YOUR PICKS DID (N4, Oct 11 2026).
 *
 * An on-device log of the picks lectr SHOWED this reader ("Lots you may like"
 * on /profile, home's For-you tab), each with what lectr said about it at the
 * time — so that, once the lot closes, the profile can answer "what happened":
 * sold for $X against the lectr value printed then, and against the house
 * estimate then; split by the picks the reader saved and the ones they passed.
 *
 *   logged per pick   id · first / last shown · best rank · how many days it
 *                     was shown · where (profile / home) · the reason's kind
 *                     (owned · saved · follow · search · signal, kin = a
 *                     fallback rung) · whether the engine flagged it below
 *                     market · the lot's snapshot (title, maker, house, sale
 *                     date — enough to name it and find its close) · and,
 *                     read through lotFace (the ONLY read of a lot's value):
 *                     the lectr value (expected hammer, all-in, likely range,
 *                     confidence), the engine's max bid, the house estimate
 *                     (USD) and the live bid — as of the LAST time it was shown
 *                     before its close (what the reader last saw)
 *   reader's actions  opened (a lot page / comps modal), More like this, Not
 *                     for me — stamped by recs-signals as they happen. Saved /
 *                     won are read from the saves at outcome time (a pick never
 *                     shows a lot already on the desk, so a saved pick was
 *                     saved after lectr showed it)
 *
 * OUTCOMES (resolvePick): the loaded book's row when it has the result, else
 * the sold-outcomes ledger (id → [priceUsd, saleDate, provisional?]) through
 * the same id aliases the desk walks. A provisional (last tracked bid) price
 * is "settling", never a result; a bought-in / withdrawn row is "didn't sell";
 * a closed lot with neither is "no result yet" — none of those enter a median.
 *
 * THE MATH (all-in vs all-in, the engine's own basis): sold priceUsd ÷ the
 * lectr value's all-in (value.compValueUsd) − 1; vs the estimate is the
 * site's one "vs est" (utils.overEstimatePct: the published sold price over
 * the estimate midpoint). "Inside the likely range" reads the sold price as
 * a hammer through the engine's own inverse (premiums.lotHammerFromAllIn)
 * against the hammer-basis range. A median prints only at n ≥ OUTCOME_MIN_N.
 *
 * FEEDBACK TO THE RECOMMENDER: none new, on purpose. A pick the reader saved
 * and won already enters the taste as OWNED (the heaviest seed) through the
 * desk's "I won it"; a saved pick that settled already reads as a settled
 * lot seed. A pick they passed on that then sold cheap — or dear — says
 * nothing about what they like, only about the market, so it moves nothing.
 * Outcomes are a record for the reader, not a ranking input.
 *
 * NEVER SENT ANYWHERE: localStorage (`lectr-picks`, versioned) through
 * safe-storage; validated field by field on read; capped at MAX_PICKS (the
 * oldest-shown fall off first); a pick ages out PICK_MAX_AGE_DAYS after it
 * was last shown. "Clear what lectr learned on this device" empties it.
 */
import { useEffect, useRef } from 'react';
import type { AuctionLot } from '../types';
import { lotFace } from './lot-face';
import { closeMsOf } from './priority';
import { lotHammerFromAllIn } from './premiums';
import { storageGet, storageSet, storageRemove } from './safe-storage';
import { idAliases, type Rec } from './recs';

export const PICKS_KEY = 'lectr-picks';
export const PICKS_VERSION = 1;
export const MAX_PICKS = 300;
/** a pick last shown longer ago than this is dropped (its outcome too) */
export const PICK_MAX_AGE_DAYS = 120;
/** the summary's window */
export const OUTCOME_WINDOW_DAYS = 30;
/** a median publishes at this many settled picks with a lectr value */
export const OUTCOME_MIN_N = 5;
/** a log pass shows at most this many of a list (the visible slice) */
export const LOG_MAX_PER_PASS = 24;

export type PickSurface = 'p' | 'h';
export type PickReason = 'owned' | 'saved' | 'follow' | 'search' | 'signal' | 'kin' | 'discover';

export interface PickSnap {
  title: string;
  artist: string;
  auctionHouse?: string;
  saleName?: string;
  saleDate?: string;
  saleDateTime?: string;
  currency?: string;
  buyerPremiumPct?: number;
}
/** lotFace's value as shown (null = the engine abstained) */
export interface PickValue {
  /** expected hammer */
  h: number;
  /** the same prediction all-in */
  a: number;
  lo: number;
  hi: number;
  c: 'high' | 'medium' | 'low';
}
export interface PickEntry {
  id: string;
  /** first / last shown (ms) */
  t0: number;
  t: number;
  /** distinct days shown */
  d: number;
  /** best (lowest) 1-based rank */
  r: number;
  s: PickSurface;
  k: PickReason;
  /** the engine flagged it below market when shown */
  f?: 1;
  lot: PickSnap;
  v: PickValue | null;
  /** the engine's max bid (hammer) */
  mb?: number;
  /** the house estimate, USD [lo, hi] */
  est?: [number, number];
  /** the live bid, USD */
  bid?: number;
  /** opened · More like this · Not for me (1 = yes) */
  o?: 1;
  m?: 1;
  x?: 1;
}
export interface PickStore { v: number; picks: PickEntry[] }

/** a localStorage-shaped handle (tests pass a Map-backed one) */
export interface PickKV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

const deviceKV: PickKV = {
  getItem: k => storageGet(k),
  setItem: (k, v) => { storageSet(k, v); },
  removeItem: k => storageRemove(k),
};
const defaultKV = (): PickKV | null => (typeof window !== 'undefined' ? deviceKV : null);

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const pos = (x: unknown): x is number => isNum(x) && x > 0;
const REASONS = new Set<string>(['owned', 'saved', 'follow', 'search', 'signal', 'kin', 'discover']);
const CONF = new Set<string>(['high', 'medium', 'low']);
const SNAP_STR = ['auctionHouse', 'saleName', 'saleDate', 'saleDateTime', 'currency'] as const;

function cleanSnap(x: unknown): PickSnap | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.title !== 'string' || !o.title) return null;
  const s: PickSnap = { title: o.title.slice(0, 300), artist: typeof o.artist === 'string' ? o.artist.slice(0, 80) : '' };
  for (const k of SNAP_STR) if (typeof o[k] === 'string' && o[k]) (s as unknown as Record<string, unknown>)[k] = (o[k] as string).slice(0, 80);
  if (pos(o.buyerPremiumPct) && (o.buyerPremiumPct as number) < 60) s.buyerPremiumPct = o.buyerPremiumPct as number;
  return s;
}

function cleanValue(x: unknown): PickValue | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!pos(o.h) || !pos(o.a) || !pos(o.lo) || !pos(o.hi) || typeof o.c !== 'string' || !CONF.has(o.c)) return null;
  if ((o.lo as number) > (o.hi as number)) return null;
  return { h: o.h as number, a: o.a as number, lo: o.lo as number, hi: o.hi as number, c: o.c as PickValue['c'] };
}

/** read + validate; a malformed entry is dropped (never the log), a foreign
 *  version starts over, an aged-out pick falls off */
export function readPicks(kv: PickKV | null = defaultKV(), nowMs = Date.now()): PickStore {
  const empty: PickStore = { v: PICKS_VERSION, picks: [] };
  if (!kv) return empty;
  let raw: string | null = null;
  try { raw = kv.getItem(PICKS_KEY); } catch { return empty; }
  if (!raw) return empty;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return empty; }
  if (!j || typeof j !== 'object' || (j as PickStore).v !== PICKS_VERSION || !Array.isArray((j as PickStore).picks)) return empty;
  const cutoff = nowMs - PICK_MAX_AGE_DAYS * 864e5;
  const seen = new Set<string>();
  const out: PickEntry[] = [];
  for (const x of (j as PickStore).picks) {
    if (!x || typeof x !== 'object') continue;
    const e = x as unknown as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id || seen.has(e.id) || !isNum(e.t) || e.t < cutoff || e.t > nowMs + 864e5) continue;
    const lot = cleanSnap(e.lot);
    if (!lot) continue;
    const p: PickEntry = {
      id: e.id.slice(0, 200), t: e.t, t0: isNum(e.t0) && e.t0 <= e.t ? e.t0 : e.t,
      d: isNum(e.d) && e.d >= 1 ? Math.min(Math.round(e.d), 999) : 1,
      r: isNum(e.r) && e.r >= 1 ? Math.min(Math.round(e.r), 999) : 1,
      s: e.s === 'h' ? 'h' : 'p',
      k: typeof e.k === 'string' && REASONS.has(e.k) ? e.k as PickReason : 'follow',
      lot, v: cleanValue(e.v),
    };
    if (e.f === 1) p.f = 1;
    if (pos(e.mb)) p.mb = e.mb;
    if (Array.isArray(e.est) && pos(e.est[0]) && pos(e.est[1]) && e.est[0] <= e.est[1]) p.est = [e.est[0], e.est[1]];
    if (pos(e.bid)) p.bid = e.bid;
    if (e.o === 1) p.o = 1;
    if (e.m === 1) p.m = 1;
    if (e.x === 1) p.x = 1;
    seen.add(p.id);
    out.push(p);
  }
  return { v: PICKS_VERSION, picks: capPicks(out) };
}

/** newest-shown first wins a seat; the log is kept in shown order */
function capPicks(picks: PickEntry[]): PickEntry[] {
  if (picks.length <= MAX_PICKS) return picks;
  const keep = new Set(picks.slice().sort((a, b) => b.t - a.t).slice(0, MAX_PICKS).map(p => p.id));
  return picks.filter(p => keep.has(p.id));
}

function writePicks(st: PickStore, kv: PickKV | null): void {
  if (!kv) return;
  const out: PickStore = { v: PICKS_VERSION, picks: capPicks(st.picks) };
  try { kv.setItem(PICKS_KEY, JSON.stringify(out)); } catch {
    // full quota: keep the newer half once, else give up quietly (a record,
    // never a control the reader pressed)
    try { out.picks = out.picks.slice(-Math.floor(MAX_PICKS / 2)); kv.setItem(PICKS_KEY, JSON.stringify(out)); } catch { /* quiet */ }
  }
}

/** the reason's kind, from the rec's seed (a fallback rung reads 'kin', the
 *  discover lane 'discover' — its seed only names the cut) */
export function reasonKindOf(r: Pick<Rec, 'seed' | 'tier' | 'lane'>): PickReason {
  if (r.lane === 'discover') return 'discover';
  if (r.tier && r.tier > 1) return 'kin';
  const k = r.seed?.kind;
  return k === 'owned' || k === 'saved' || k === 'follow' || k === 'search' || k === 'signal' ? k : 'follow';
}

const usd = (l: AuctionLot, x: number | null | undefined): number | null =>
  x != null && x > 0 && (!l.currency || l.currency === 'USD') ? x : null;

/** what lectr said about a lot, as the log keeps it — every figure via lotFace */
export function pickFieldsOf(lot: AuctionLot): Pick<PickEntry, 'lot' | 'v' | 'mb' | 'est' | 'bid'> {
  const face = lotFace(lot);
  const lot0: PickSnap = { title: (lot.title || '').slice(0, 300), artist: lot.artist || '' };
  if (lot.auctionHouse) lot0.auctionHouse = lot.auctionHouse;
  if (lot.saleName) lot0.saleName = String(lot.saleName).slice(0, 80);
  if (lot.saleDate) lot0.saleDate = lot.saleDate;
  if (lot.saleDateTime) lot0.saleDateTime = lot.saleDateTime;
  if (lot.currency) lot0.currency = lot.currency;
  if (pos(lot.buyerPremiumPct) && lot.buyerPremiumPct! < 60) lot0.buyerPremiumPct = lot.buyerPremiumPct!;
  const out: Pick<PickEntry, 'lot' | 'v' | 'mb' | 'est' | 'bid'> = {
    lot: lot0,
    v: face.value ? { h: face.value.hammer, a: face.value.allIn, lo: face.value.lo, hi: face.value.hi, c: face.value.confidence } : null,
  };
  if (face.maxBid && face.maxBid.hammer > 0) out.mb = face.maxBid.hammer;
  const lo = lot.estLowUsd ?? usd(lot, lot.estimateLow) ?? lot.estHighUsd ?? usd(lot, lot.estimateHigh);
  const hi = lot.estHighUsd ?? usd(lot, lot.estimateHigh) ?? lo;
  if (pos(lo) && pos(hi) && lo! <= hi!) out.est = [lo!, hi!];
  const bid = usd(lot, lot.currentBid);
  if (bid) out.bid = bid;
  return out;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** log one pass of a shown list (`rank` is 0-based). A lot already logged
 *  keeps its first-shown time and best rank; what lectr said is refreshed
 *  while the lot is still open (the last read the reader saw before close). */
export function logPicks(
  shown: { lot: AuctionLot; rec?: Pick<Rec, 'seed' | 'tier' | 'flagged'> }[], surface: PickSurface,
  kv: PickKV | null = defaultKV(), nowMs = Date.now(),
): number {
  if (!kv || !shown.length) return 0;
  const st = readPicks(kv, nowMs);
  const byId = new Map(st.picks.map(p => [p.id, p]));
  let n = 0;
  shown.slice(0, LOG_MAX_PER_PASS).forEach(({ lot, rec }, i) => {
    if (!lot?.id || !lot.title || lot.status !== 'upcoming') return;
    const close = closeMsOf(lot);
    if (close != null && close <= nowMs) return;
    const fields = pickFieldsOf(lot);
    const prev = byId.get(lot.id);
    const k = rec ? reasonKindOf(rec) : prev?.k ?? 'follow';
    if (prev) {
      if (dayOf(prev.t) !== dayOf(nowMs)) prev.d = Math.min(prev.d + 1, 999);
      prev.t = nowMs;
      prev.r = Math.min(prev.r, i + 1);
      Object.assign(prev, fields);
      if (!fields.mb) delete prev.mb;
      if (!fields.est) delete prev.est;
      if (!fields.bid) delete prev.bid;
      if (rec?.flagged) prev.f = 1;
      // move to the newest end (the cap drops the oldest-shown)
      st.picks.splice(st.picks.indexOf(prev), 1);
      st.picks.push(prev);
    } else {
      const p: PickEntry = { id: lot.id, t0: nowMs, t: nowMs, d: 1, r: i + 1, s: surface, k, ...fields };
      if (rec?.flagged) p.f = 1;
      st.picks.push(p);
      byId.set(p.id, p);
    }
    n++;
  });
  if (n) writePicks(st, kv);
  return n;
}

export type PickAction = 'o' | 'm' | 'x';
/** stamp (or clear) a reader's action on a logged pick — a lot never
 *  shown as a pick is not logged here */
export function notePickAction(id: string, a: PickAction, on = true, kv: PickKV | null = defaultKV(), nowMs = Date.now()): void {
  if (!kv || !id) return;
  const st = readPicks(kv, nowMs);
  const p = st.picks.find(x => x.id === id);
  if (!p || (on ? p[a] === 1 : p[a] !== 1)) return;
  if (on) p[a] = 1; else delete p[a];
  writePicks(st, kv);
}

export function clearPicks(kv: PickKV | null = defaultKV()): void {
  try { kv?.removeItem(PICKS_KEY); } catch { /* nothing to clear */ }
}

/* ── outcomes ─────────────────────────────────────────────────────────── */

/** the sold ledger's entry: [priceUsd, saleDate, provisional?] */
export type LedgerHit = [number, string] | [number, string, 1];
export type OutcomeState = 'open' | 'sold' | 'settling' | 'unsold' | 'pending';

export interface PickOutcome {
  pick: PickEntry;
  state: OutcomeState;
  /** the close (ms), from the snapshot */
  closeMs: number | null;
  /** sold: the published price (USD, all-in where the house's is) and its day */
  price?: number;
  date?: string;
  /** 'bought_in' / 'withdrawn' */
  why?: string;
  /** sold price ÷ the lectr value's all-in − 1, in % (null = no value then) */
  vsValue: number | null;
  /** sold price ÷ the estimate midpoint − 1, in % (null = no estimate) */
  vsEst: number | null;
  /** the sold price, read as a hammer, landed inside the likely range */
  inRange: boolean | null;
  saved: boolean;
  won: boolean;
}

type RowLike = { id: string; status?: string | null; priceUsd?: number | null; saleDate?: string | null; priceBasis?: string | null };

/** one pick's outcome. `row` = the book's row (any alias), `hit` = the
 *  ledger's entry (any alias), `ledgerLoaded` = a miss means "no result". */
export function resolvePick(
  pick: PickEntry, src: { row?: RowLike | null; hit?: LedgerHit | null; saved?: boolean; won?: boolean },
  nowMs = Date.now(),
): PickOutcome {
  const closeMs = closeMsOf(pick.lot);
  const base = { pick, closeMs, vsValue: null, vsEst: null, inRange: null, saved: !!src.saved || !!src.won, won: !!src.won };
  const row = src.row;
  let price: number | null = null, date: string | undefined, provisional = false;
  if (row && row.status === 'sold' && pos(row.priceUsd)) {
    price = row.priceUsd!; date = (row.saleDate || '').slice(0, 10) || undefined; provisional = row.priceBasis === 'last-tracked-bid';
  } else if (src.hit && pos(src.hit[0])) {
    price = src.hit[0]; date = src.hit[1]; provisional = src.hit.length > 2;
  }
  if (price != null) {
    if (provisional) return { ...base, state: 'settling', price, date };
    const vsValue = pick.v ? (price / pick.v.a - 1) * 100 : null;
    const mid = pick.est ? (pick.est[0] + pick.est[1]) / 2 : null;
    const vsEst = mid ? (price / mid - 1) * 100 : null;
    let inRange: boolean | null = null;
    if (pick.v) {
      const ham = lotHammerFromAllIn({ auctionHouse: pick.lot.auctionHouse, buyerPremiumPct: pick.lot.buyerPremiumPct, saleDate: date ?? pick.lot.saleDate }, price);
      inRange = ham >= pick.v.lo && ham <= pick.v.hi;
    }
    return { ...base, state: 'sold', price, date, vsValue, vsEst, inRange };
  }
  if (row && (row.status === 'bought_in' || row.status === 'withdrawn')) return { ...base, state: 'unsold', why: row.status };
  return { ...base, state: closeMs != null && closeMs <= nowMs ? 'pending' : 'open' };
}

export interface OutcomeSources {
  /** the loaded book (rows by id) */
  rowOf?: (id: string) => RowLike | null | undefined;
  /** the sold ledger by id */
  hitOf?: (id: string) => LedgerHit | null | undefined;
  isSaved?: (id: string) => boolean;
  isOwned?: (id: string) => boolean;
}

/** every logged pick's outcome, ids walked through their aliases */
export function resolvePicks(picks: readonly PickEntry[], src: OutcomeSources, nowMs = Date.now()): PickOutcome[] {
  return picks.map(p => {
    let row: RowLike | null | undefined = null, hit: LedgerHit | null | undefined = null, saved = false, won = false;
    for (const a of idAliases(p.id)) {
      row = row || src.rowOf?.(a);
      hit = hit || src.hitOf?.(a);
      saved = saved || !!src.isSaved?.(a);
      won = won || !!src.isOwned?.(a);
    }
    return resolvePick(p, { row, hit, saved, won }, nowMs);
  });
}

/** the lots whose close has passed but whose result the book cannot answer
 *  — the ledger is fetched only for these */
export function needsLedger(picks: readonly PickEntry[], rowOf: OutcomeSources['rowOf'], nowMs = Date.now()): boolean {
  return picks.some(p => {
    const c = closeMsOf(p.lot);
    if (c == null || c > nowMs) return false;
    const row = idAliases(p.id).map(a => rowOf?.(a)).find(Boolean);
    return !row || row.status === 'upcoming';
  });
}

function medianOf(a: number[]): number | null {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface OutcomeSummary {
  /** settled (sold, final price) inside the window */
  n: number;
  /** of those, with a lectr value when shown (the median's n) */
  nValue: number;
  /** median sold vs lectr value, % — null under OUTCOME_MIN_N */
  medVsValue: number | null;
  /** of nValue, landed inside the likely range — null under OUTCOME_MIN_N */
  inRange: number | null;
  nEst: number;
  medVsEst: number | null;
  /** settled picks the reader saved / won */
  saved: number;
  won: number;
  /** closed in the window without a final result yet / didn't sell */
  pending: number;
  unsold: number;
}

/** the summary line's figures over picks that closed in the last
 *  OUTCOME_WINDOW_DAYS — every median n-gated */
export function summarizeOutcomes(outs: readonly PickOutcome[], nowMs = Date.now(), windowDays = OUTCOME_WINDOW_DAYS): OutcomeSummary {
  const from = nowMs - windowDays * 864e5;
  const inWin = (o: PickOutcome) => {
    const t = o.date ? Date.parse(`${o.date}T12:00:00Z`) : o.closeMs;
    return t != null && t >= from && t <= nowMs + 864e5;
  };
  const sold = outs.filter(o => o.state === 'sold' && inWin(o));
  const withV = sold.filter(o => o.vsValue != null);
  const withE = sold.filter(o => o.vsEst != null);
  const gate = (xs: PickOutcome[], f: (o: PickOutcome) => number) => (xs.length >= OUTCOME_MIN_N ? medianOf(xs.map(f)) : null);
  return {
    n: sold.length,
    nValue: withV.length,
    medVsValue: gate(withV, o => o.vsValue!),
    inRange: withV.length >= OUTCOME_MIN_N ? withV.filter(o => o.inRange).length : null,
    nEst: withE.length,
    medVsEst: gate(withE, o => o.vsEst!),
    saved: sold.filter(o => o.saved).length,
    won: sold.filter(o => o.won).length,
    pending: outs.filter(o => (o.state === 'pending' || o.state === 'settling') && inWin(o)).length,
    unsold: outs.filter(o => o.state === 'unsold' && inWin(o)).length,
  };
}

/* ── the hook the pick lists call ─────────────────────────────────────── */

/**
 * Log the visible picks once they have held still for a moment (a list that
 * re-ranks under a mark never logs its in-between state) and only while the
 * page is visible. `key` = the list's identity (ids in order).
 */
export function useLogPicks(
  shown: readonly { lot: AuctionLot; rec?: Pick<Rec, 'seed' | 'tier' | 'flagged'> }[] | null, surface: PickSurface,
): void {
  const ref = useRef(shown);
  ref.current = shown;
  const key = shown ? shown.slice(0, LOG_MAX_PER_PASS).map(s => s.lot.id).join('|') : '';
  useEffect(() => {
    if (!key) return;
    const t = window.setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try { logPicks(ref.current ? ref.current.slice() : [], surface); } catch { /* a record, never a crash */ }
    }, 1500);
    return () => window.clearTimeout(t);
  }, [key, surface]);
}
