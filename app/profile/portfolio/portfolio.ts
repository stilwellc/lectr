/**
 * portfolio.ts — PORTFOLIO (THE DESK v3 §6, Oct 11 2026): the collection
 * re-marked over time. Pure: no React, no fetch, no storage. index.tsx
 * loads the entity buckets and renders what this file reads.
 *
 * Every figure here is READ, never re-derived:
 *
 *   bought        what the reader recorded they paid (SavedMeta.paidUsd),
 *                 else the lot's realized price (the row's priceUsd, else the
 *                 sold ledger) — each labelled with its basis
 *   appraisal     the ENGINE's call and nothing else: lotVerdict(lot)
 *                 .expectedAllIn (app/lib/verdict). The engine prices lots
 *                 on the block; a settled piece whose row carries no value
 *                 stamp has NO appraisal here — never a client re-appraisal
 *   if sold now   the engine's expected HAMMER less the assumed seller's
 *                 commission for the piece's house tier (./commission)
 *   record        the entity's top sale (EntitySummary.record matched to
 *                 the detail's top rows by recordOf; else detail.top[0])
 *   trend         the entity's year-over-year read exactly as /makers
 *                 prints it (EntitySummary.yoy through entity/ledger
 *                 yoyDir / yoyTitle / fmtPct — no new signal label)
 *   timing        the entity's 12-month median (med12m, n ≥ MIN_MED_N)
 *                 against its complete-year medians over the last
 *                 TIMING_YEARS years (each gated n ≥ MIN_MED_N): at a high,
 *                 at a low, or inside the range — printed with the years
 *                 that qualified and the n
 *   index         each piece joins the collection line in the year it was
 *                 bought, at what was paid, and is re-marked every year
 *                 after by its entity's yearly median relative to that year
 *                 (EntityDetail.yearly, n ≥ MIN_MED_N). A year any joined
 *                 piece cannot be marked is a GAP, never a bridge. A piece
 *                 with no bought price, no bought year, no named entity or
 *                 an ungated bought year has NO index and is listed as such.
 *
 * One clock: callers pass the desk's `now`; nothing here reads Date.now().
 */
import type { AuctionLot } from '../../types';
import type { LedgerEntry } from '../../hooks/useRayData';
import type { EntityDetail, EntityRecord, EntitySummary, EntityYoy } from '../../lib/entity/model';
import { recordOf } from '../../lib/entity/model';
import { entityKeyOf } from '../../lib/entity/key';
import { MIN_MED_N } from '../../lib/entity/stats';
import { fmtPct, yoyBasisText, yoyDir, yoyTitle } from '../../lib/entity/ledger';
import { lotVerdict } from '../../lib/verdict';
import { fmtFace } from '../../lib/lot-face';
import { soldNowOf, type SoldNow } from './commission';

/** the years a timing read looks back over (complete years) */
export const TIMING_YEARS = 5;
/** a timing read needs this many gated years inside the window */
export const TIMING_MIN_YEARS = 3;

export interface Bought {
  usd: number;
  /** 'paid' = the reader's recorded cost basis; 'realized' = the sale price */
  basis: 'paid' | 'realized';
  /** the sale day (ISO) — the day the piece joined the collection */
  day: string | null;
  year: number | null;
}

export interface Appraisal {
  /** the engine's expected all-in (lotVerdict.expectedAllIn) */
  allIn: number;
  /** the engine's expected hammer (premium stripped) */
  hammer: number;
  compN: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface Piece {
  id: string;
  lot: AuctionLot;
  /** the entity the piece belongs to (the build's ek stamp, else entityKeyOf) — null when no reader names it */
  entityId: string | null;
  bought: Bought | null;
  appraisal: Appraisal | null;
  soldNow: SoldNow | null;
}

/** the entity's buckets, as loaded (null = fetched and absent / past the deadline) */
export interface EntityRead { detail: EntityDetail | null; summary: EntitySummary | null }

type MetaLike = { paidUsd?: number | null } | null | undefined;

function yearOf(day: string | null | undefined): number | null {
  if (!day) return null;
  const y = parseInt(day.slice(0, 4), 10);
  return Number.isFinite(y) && y > 1800 ? y : null;
}

/** a named entity only — a cs: collection bucket is no one's index */
export function indexableEntity(id: string | null): boolean {
  return !!id && !id.startsWith('cs:');
}

/** a piece's entity id: the build's `ek` stamp when present, else the same function the build stamps with */
export function pieceEntityOf(lot: AuctionLot): string | null {
  const ek = (lot as AuctionLot & { ek?: string | null }).ek;
  return ek !== undefined ? ek : entityKeyOf(lot);
}

/** one collection piece, read off the row, the save's meta and the sold ledger */
export function pieceOf(lot: AuctionLot, meta: MetaLike, ledger?: LedgerEntry | null): Piece {
  const paid = meta?.paidUsd != null && meta.paidUsd > 0 ? meta.paidUsd : null;
  const realized = lot.priceUsd && lot.priceUsd > 0 ? lot.priceUsd : ledger && ledger[0] > 0 ? ledger[0] : null;
  const day = lot.saleDate || (ledger ? ledger[1] : null) || null;
  const usd = paid ?? realized;
  const bought: Bought | null = usd != null ? { usd, basis: paid != null ? 'paid' : 'realized', day, year: yearOf(day) } : null;
  const v = lotVerdict(lot);
  const appraisal: Appraisal | null = v ? { allIn: v.expectedAllIn, hammer: v.expected, compN: v.compN, confidence: v.confidence } : null;
  return {
    id: lot.id, lot,
    entityId: pieceEntityOf(lot),
    bought,
    appraisal,
    soldNow: appraisal ? soldNowOf(appraisal.hammer, lot.auctionHouse) : null,
  };
}

/* ── the entity reads ─────────────────────────────────────────────────── */

export interface RecordRead {
  usd: number;
  day: string;
  title: string | null;
  house: string | null;
  id: string | null;
  /** the record IS this piece */
  yours: boolean;
}

/** the entity's top sale, titled when the detail names it */
export function recordRead(piece: Pick<Piece, 'id'>, ent: EntityRead | null | undefined): RecordRead | null {
  if (!ent) return null;
  let rec: EntityRecord | null = recordOf(ent.summary?.record ?? null, ent.detail);
  if (!rec && ent.detail?.top?.length) {
    const t = ent.detail.top[0];
    rec = { p: t.p, d: t.d, t: t.t, h: t.h, id: t.id, img: t.img };
  }
  if (!rec || !(rec.p > 0)) return null;
  return { usd: rec.p, day: rec.d, title: rec.t ?? null, house: rec.h ?? null, id: rec.id ?? null, yours: !!rec.id && rec.id === piece.id };
}

export interface TrendRead {
  pct: number;
  n: number;
  /** the read's basis in words, with its n (entity/ledger yoyBasisText) */
  basis: string;
  dir: 'up' | 'down' | undefined;
  /** the cell text: '+12%' */
  text: string;
  /** the full sentence (entity/ledger yoyTitle) */
  title: string;
  yoy: EntityYoy;
}

/** the entity's year-over-year read, said the way /makers says it */
export function trendRead(ent: EntityRead | null | undefined): TrendRead | null {
  const y = ent?.summary?.yoy ?? null;
  if (!y) return null;
  return { pct: y.pct, n: y.n, basis: yoyBasisText(y), dir: yoyDir(y), text: fmtPct(y.pct), title: yoyTitle(y), yoy: y };
}

export interface TimingRead {
  kind: 'high' | 'low' | 'within';
  med12m: number;
  n: number;
  /** the complete years inside the window that carried a gated median */
  years: number;
  lo: number;
  hi: number;
  /** 'at a 5-yr high · n 41' */
  text: string;
  title: string;
}

/** the 12-month median against the entity's complete-year medians over the
 *  last TIMING_YEARS years — only when both sides are n-gated */
export function timingRead(ent: EntityRead | null | undefined, nowYear: number): TimingRead | null {
  const s = ent?.summary;
  const yearly = ent?.detail?.yearly;
  if (!s || !yearly || s.med12m == null || !(s.med12m > 0) || (s.med12mN ?? 0) < MIN_MED_N) return null;
  const meds: number[] = [];
  for (const y of yearly) {
    if (y.partial || y.y >= nowYear || y.y < nowYear - TIMING_YEARS) continue;
    if (y.med != null && y.med > 0 && y.n >= MIN_MED_N) meds.push(y.med);
  }
  if (meds.length < TIMING_MIN_YEARS) return null;
  const lo = Math.min(...meds), hi = Math.max(...meds);
  const kind: TimingRead['kind'] = s.med12m > hi ? 'high' : s.med12m < lo ? 'low' : 'within';
  const n = s.med12mN ?? 0;
  const span = `${meds.length}-yr`;
  const text = kind === 'within'
    ? `12-mo median ${fmtFace(s.med12m)} inside its ${span} range ${fmtFace(lo)}–${fmtFace(hi)} · n ${n.toLocaleString()}`
    : `12-mo median at a ${span} ${kind} · n ${n.toLocaleString()}`;
  const title = `The median sale over the trailing 12 months (${fmtFace(s.med12m)}, n ${n.toLocaleString()}${s.medScope ? `, ${s.medScope}` : ''}) against the ${meds.length} complete ${meds.length === 1 ? 'year' : 'years'} of the last ${TIMING_YEARS} with five or more sales (yearly medians ${fmtFace(lo)}–${fmtFace(hi)}). A level, not an appreciation rate — it moves with what came up for sale.`;
  return { kind, med12m: s.med12m, n, years: meds.length, lo, hi, text, title };
}

/* ── the index ────────────────────────────────────────────────────────── */

export type NoIndexReason = 'no bought price' | 'no bought year' | 'no named maker' | 'maker not read yet' | 'no maker history' | 'bought year under 5 sales';

export interface PieceMark { year: number; value: number; n: number; partial: boolean }

/** a piece's yearly marks from its bought year on (null with the reason it has none) */
export function pieceMarks(piece: Piece, ent: EntityRead | null | undefined, nowYear: number): { marks: PieceMark[] } | { marks: null; reason: NoIndexReason } {
  if (!piece.bought) return { marks: null, reason: 'no bought price' };
  if (piece.bought.year == null) return { marks: null, reason: 'no bought year' };
  if (!indexableEntity(piece.entityId)) return { marks: null, reason: 'no named maker' };
  if (ent === undefined) return { marks: null, reason: 'maker not read yet' };
  const yearly = ent?.detail?.yearly;
  if (!yearly || !yearly.length) return { marks: null, reason: 'no maker history' };
  const by = new Map<number, { med: number; n: number; partial: boolean }>();
  for (const y of yearly) if (y.med != null && y.med > 0 && y.n >= MIN_MED_N) by.set(y.y, { med: y.med, n: y.n, partial: !!y.partial });
  const base = by.get(piece.bought.year);
  if (!base) return { marks: null, reason: 'bought year under 5 sales' };
  const marks: PieceMark[] = [];
  for (let y = piece.bought.year; y <= nowYear; y++) {
    const m = by.get(y);
    if (!m) continue; // a gap, left open
    marks.push({ year: y, value: piece.bought.usd * (m.med / base.med), n: m.n, partial: m.partial || y === nowYear });
  }
  return { marks };
}

export interface IndexPoint { year: number; label: string; value: number | null; n: number; partial: boolean; pieces: number }

export interface IndexResult {
  /** every axis year from the first purchase to now; value null = gap */
  points: IndexPoint[];
  included: string[];
  excluded: { id: string; reason: NoIndexReason }[];
  /** the newest year every joined piece could be marked */
  latest: IndexPoint | null;
  /** what the included pieces were bought for, summed */
  bought: number;
}

/** the collection line: pieces join in their bought year and are re-marked
 *  together; a year any joined piece cannot be marked is a gap */
export function collectionIndex(pieces: readonly Piece[], ents: ReadonlyMap<string, EntityRead | null>, nowYear: number): IndexResult {
  const included: string[] = [];
  const excluded: IndexResult['excluded'] = [];
  const joined: { piece: Piece; marks: Map<number, PieceMark> }[] = [];
  for (const p of pieces) {
    const ent = p.entityId ? ents.get(p.entityId) : null;
    const r = pieceMarks(p, ent, nowYear);
    if (!r.marks) { excluded.push({ id: p.id, reason: r.reason }); continue; }
    included.push(p.id);
    joined.push({ piece: p, marks: new Map(r.marks.map(m => [m.year, m])) });
  }
  const points: IndexPoint[] = [];
  if (joined.length) {
    const first = Math.min(...joined.map(j => j.piece.bought!.year!));
    for (let y = first; y <= nowYear; y++) {
      const in_ = joined.filter(j => j.piece.bought!.year! <= y);
      let sum = 0, n = 0, partial = false, gap = false;
      for (const j of in_) {
        const m = j.marks.get(y);
        if (!m) { gap = true; break; }
        sum += m.value; n += m.n; partial = partial || m.partial;
      }
      points.push({ year: y, label: y === nowYear ? `${y} so far` : String(y), value: gap ? null : Math.round(sum), n, partial: partial || y === nowYear, pieces: in_.length });
    }
  }
  let latest: IndexPoint | null = null;
  for (let i = points.length - 1; i >= 0; i--) if (points[i].value != null) { latest = points[i]; break; }
  const bought = joined.reduce((s, j) => s + j.piece.bought!.usd, 0);
  return { points, included, excluded, latest, bought };
}

/* ── the rows and the totals ──────────────────────────────────────────── */

export interface PieceRow {
  piece: Piece;
  /** undefined = the entity is still being read */
  ent: EntityRead | null | undefined;
  record: RecordRead | null;
  trend: TrendRead | null;
  timing: TimingRead | null;
  /** the piece's newest index mark (null with the reason) */
  mark: PieceMark | null;
  noIndex: NoIndexReason | null;
}

export function pieceRow(piece: Piece, ent: EntityRead | null | undefined, nowYear: number): PieceRow {
  const m = pieceMarks(piece, ent, nowYear);
  const marks = m.marks;
  return {
    piece, ent,
    record: recordRead(piece, ent),
    trend: trendRead(ent),
    timing: timingRead(ent, nowYear),
    mark: marks && marks.length ? marks[marks.length - 1] : null,
    noIndex: marks ? null : m.reason,
  };
}

export interface Totals {
  pieces: number;
  /** every piece with a bought price, summed; `paidN` of them are the reader's own figure */
  bought: number; boughtN: number; paidN: number;
  appraised: number; appraisedN: number;
  soldNow: number; soldNowN: number;
}

export function totalsOf(pieces: readonly Piece[]): Totals {
  const t: Totals = { pieces: pieces.length, bought: 0, boughtN: 0, paidN: 0, appraised: 0, appraisedN: 0, soldNow: 0, soldNowN: 0 };
  for (const p of pieces) {
    if (p.bought) { t.bought += p.bought.usd; t.boughtN++; if (p.bought.basis === 'paid') t.paidN++; }
    if (p.appraisal) { t.appraised += p.appraisal.allIn; t.appraisedN++; }
    if (p.soldNow) { t.soldNow += p.soldNow.net; t.soldNowN++; }
  }
  return t;
}

/** the calendar year of the desk's clock, in the reader's local time */
export function yearOfNow(now: number): number { return new Date(now).getFullYear(); }

/** 'N pieces without an index' with the reasons folded ('2 bought before the maker had five sales a year') */
export function noIndexNote(excluded: IndexResult['excluded'], pending: boolean): string | null {
  if (!excluded.length) return null;
  const n = excluded.length;
  const by = new Map<NoIndexReason, number>();
  for (const e of excluded) by.set(e.reason, (by.get(e.reason) || 0) + 1);
  const why = Array.from(by.entries()).map(([r, k]) => `${k} ${r}`).join(', ');
  return `${n} ${n === 1 ? 'piece' : 'pieces'} without an index (${why})${pending ? ' — still reading' : ''}`;
}
