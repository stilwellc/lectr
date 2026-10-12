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
 *                 on the block nightly and — since W31 (docs/ENGINE_LANES.md
 *                 §23) — the served SOLD rows sold inside SETTLED_MONTHS,
 *                 each stamped with the day it was read (`lot.valueAsOf`).
 *                 A settled piece whose row carries no value stamp has NO
 *                 appraisal here — never a client re-appraisal. A row the
 *                 engine read and declined carries `lot.abstain` (the
 *                 engine's own code) and the row prints why (engineReadOf).
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
 *                 Beside the marked line runs the PAID baseline — what the
 *                 joined pieces cost, summed, as a step (IndexPoint.paid) —
 *                 so the line shows movement against cost, never
 *                 accumulation dressed as growth (R1#11).
 *
 * ═══ THE COLLECTION HEADLINE LAW (Oct 11 2026, /profile review R4#4 / #9,
 * R1#4) — Portfolio and the Collection room print the same three words for
 * the same three numbers, and never a fourth:
 *
 *   BOUGHT      Σ of what the reader recorded they paid, else the realized
 *               price — labelled "N at your figure" / "at the realized
 *               price". Cost. Never called a value, never summed into one.
 *   MARKED      Σ of the newest index mark over the INDEXED pieces only —
 *               each piece's bought price moved by its maker's yearly
 *               median: a market LEVEL, not an appraisal of the piece —
 *               printed with "N of M indexed", and its delta ONLY against
 *               what those N pieces cost ("+30% vs $197K paid for these 10").
 *   APPRAISAL   the engine's value stamp (lotVerdict expectedAllIn) and
 *               nothing else — never a piece carried at cost, never a
 *               client re-appraisal — printed with "N of M" and "as of
 *               <valueAsOf>"; its delta only over the pieces the engine
 *               actually appraised that also have a bought price, with n.
 *
 * A piece with neither a mark nor a stamp contributes to BOUGHT only. No
 * headline sums cost into a value and calls the sum "appraisal"; a "+N%"
 * never compares cost with cost. `headlineOf()` is the one function that
 * turns the totals into those strings — a room reads the strings, not the
 * rule (the Collection room is X1's; this is the definition it mirrors).
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
import { marketOf } from '../../constants';
import { athleteName } from '../../lib/player-name';
import { playerSlugOf } from '../../lib/cards';
import { soldNowOf, type SoldNow } from './commission';

/** the years a timing read looks back over (complete years) */
export const TIMING_YEARS = 5;
/** a timing read needs this many gated years inside the window */
export const TIMING_MIN_YEARS = 3;
/** the nightly's settled-appraisal scope (scripts/lib/settled-appraisal
 *  SETTLED_DEFAULTS.months, W31): sold rows inside this many months of the
 *  build day are valued; the app bundle does not import scripts/, so the
 *  figure is restated here with its source */
export const SETTLED_MONTHS = 24;
/** a phone shows this many pieces open; the rest fold behind "Show all" */
export const FOLD_N = 4;

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
  /** (W31) the day the engine read a SETTLED row ('YYYY-MM-DD'); null on a live lot (read nightly) */
  asOf: string | null;
}

export interface Piece {
  id: string;
  lot: AuctionLot;
  /** the entity the piece belongs to (the build's ek stamp, else entityKeyOf) — null when no reader names it */
  entityId: string | null;
  /** the entity came off the pipeline's athlete stamp, not the key reader (R1#16) */
  entityDerived: boolean;
  bought: Bought | null;
  appraisal: Appraisal | null;
  soldNow: SoldNow | null;
  /** the engine read the row and declined — its own code (app/lib/value AbstainReason) */
  abstain: string | null;
  /** the row is on the block (the engine prices it nightly) */
  live: boolean;
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
export function indexableEntity(id: string | null | undefined): id is string {
  return !!id && !id.startsWith('cs:');
}

type StampedLot = AuctionLot & { ek?: string | null; playerSlug?: string | null; playerName?: string | null };

/** (R1#16) a sports row the key reader filed under no one, named by the
 *  pipeline's own athlete stamp: `playerSlug` first, else `playerName`
 *  through the one athlete test (app/lib/player-name athleteName). Never a
 *  name guessed off a free title — a row with neither stamp stays unnamed. */
export function ghostEntityOf(l: Pick<StampedLot, 'artist' | 'title' | 'playerSlug' | 'playerName'>): string | null {
  if (marketOf(String(l.artist || '')) !== 'sports') return null;
  if (l.playerSlug) return `pl:${l.playerSlug}`;
  if (l.playerName) {
    const a = athleteName(l.playerName, String(l.title || ''));
    const s = a ? playerSlugOf(a) : null;
    if (s) return `pl:${s}`;
  }
  return null;
}

/** a name the READER follows (app/lib/follows): a maker / player follow or an
 *  entity follow — a house or a category is not a name */
export type FollowedName = { kind: string; key: string; label: string };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** (R1#16) the archive ghost — a settled win the desk's book no longer
 *  carries, rebuilt from the save's own title and collection — names no one
 *  by itself. When the reader FOLLOWS a name and the title spells it whole
 *  ("1953 Stahl-Meyer Mickey Mantle" · follows Mickey Mantle), the piece
 *  files under that follow's entity: the reader named it, nothing is
 *  guessed. A maker follow keys mk: on a maker-market lot and pl: on a
 *  sports lot (a player follow is stored as kind 'maker' with the player's
 *  slug); an entity follow carries its id. */
export function followEntityOf(l: Pick<AuctionLot, 'artist' | 'title'>, follows: readonly FollowedName[] | null | undefined): string | null {
  if (!follows || !follows.length) return null;
  const title = String(l.title || '');
  if (!title) return null;
  const market = marketOf(String(l.artist || ''));
  for (const f of follows) {
    if ((f.kind !== 'maker' && f.kind !== 'entity') || !f.label || !f.key) continue;
    if (!new RegExp(`(^|[^A-Za-z])${escapeRe(f.label)}(?=$|[^A-Za-z])`, 'i').test(title)) continue;
    if (f.kind === 'entity') return indexableEntity(f.key) ? f.key : null;
    if (market === 'sports') return `pl:${f.key}`;
    if (market === 'art' || market === 'design' || market === 'watches') return `mk:${f.key}`;
  }
  return null;
}

/** a piece's entity id: the build's `ek` stamp when it names someone, else
 *  the same function the build stamps with, else (sports) the pipeline's
 *  athlete stamp — the archive serves a 1953 Mantle with `ek: null` and
 *  `playerSlug: 'mickey-mantle'` — else a name the reader follows that the
 *  title spells. The archive ghost printed "No named maker" on every path. */
export function pieceEntityOf(lot: AuctionLot, follows?: readonly FollowedName[] | null): { id: string | null; derived: boolean } {
  const l = lot as StampedLot;
  const stamped = l.ek;
  const ek = indexableEntity(stamped) ? stamped : stamped === undefined || stamped === null ? entityKeyOf(lot) : stamped;
  if (indexableEntity(ek)) return { id: ek, derived: false };
  const g = ghostEntityOf(l) ?? followEntityOf(l, follows);
  return g ? { id: g, derived: true } : { id: ek ?? null, derived: false };
}

/** one collection piece, read off the row, the save's meta, the sold ledger
 *  and (for a ghost) the names the reader follows */
export function pieceOf(lot: AuctionLot, meta: MetaLike, ledger?: LedgerEntry | null, follows?: readonly FollowedName[] | null): Piece {
  const paid = meta?.paidUsd != null && meta.paidUsd > 0 ? meta.paidUsd : null;
  const realized = lot.priceUsd && lot.priceUsd > 0 ? lot.priceUsd : ledger && ledger[0] > 0 ? ledger[0] : null;
  const day = lot.saleDate || (ledger ? ledger[1] : null) || null;
  const usd = paid ?? realized;
  const bought: Bought | null = usd != null ? { usd, basis: paid != null ? 'paid' : 'realized', day, year: yearOf(day) } : null;
  const v = lotVerdict(lot);
  const asOf = typeof lot.valueAsOf === 'string' && lot.valueAsOf ? lot.valueAsOf.slice(0, 10) : null;
  const appraisal: Appraisal | null = v ? { allIn: v.expectedAllIn, hammer: v.expected, compN: v.compN, confidence: v.confidence, asOf } : null;
  const ab = (lot as AuctionLot & { abstain?: string | null }).abstain;
  const ent = pieceEntityOf(lot, follows);
  return {
    id: lot.id, lot,
    entityId: ent.id,
    entityDerived: ent.derived,
    bought,
    appraisal,
    soldNow: appraisal ? soldNowOf(appraisal.hammer, lot.auctionHouse) : null,
    abstain: !appraisal && typeof ab === 'string' && ab ? ab : null,
    live: lot.status === 'upcoming',
  };
}

/* ── the engine read (one column: appraisal · as of · if sold now · or why not) ── */

export type EngineRead =
  | { kind: 'value'; appraisal: Appraisal; soldNow: SoldNow | null; /** 'as of Oct 12' on a settled row; null = read nightly (live) */ asOfText: string | null }
  | { kind: 'abstain'; code: string; why: string }
  | { kind: 'none'; why: string; live: boolean };

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'as of Oct 12' (the year only when it is not the desk's) */
export function asOfText(iso: string | null | undefined, nowYear: number): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const y = parseInt(iso.slice(0, 4), 10), m = parseInt(iso.slice(5, 7), 10), d = parseInt(iso.slice(8, 10), 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 12) return null;
  return `as of ${MONTH_SHORT[m - 1]} ${d}${y !== nowYear ? `, ${y}` : ''}`;
}

/** the engine's abstain codes (app/lib/value AbstainReason) in the reader's
 *  words — the engine's reason, never a softer one */
export function abstainWhy(code: string): string {
  const c = code.toLowerCase();
  if (c === 'pool<3' || c === 'card:pool<2' || c === 'tcg:pool<2' || c === 'no-candidates') return 'too few comparable sales to read it';
  if (c === 'no-identity' || c === 'identity-less') return 'the title names no object the engine can match';
  if (c === 'dispersion') return 'its comparable sales disagree too widely';
  if (c === 'no-value') return 'the comps gave no usable figure';
  if (c === 'stale' || c === 'card:stale') return 'every comparable sale is too old';
  if (c === 'pool-scale') return 'the comps price another scale of object';
  if (c === 'pool-mixed') return 'the comps are mostly other works';
  if (c === 'no-index') return 'its market has no index to carry the estimate with';
  if (c === 'card:player-tier' || c === 'card:player<5') return 'only a player-level median exists — no read on this card';
  if (c === 'card:new-release') return 'too new a release to read';
  if (c.startsWith('card:') || c.startsWith('noest:')) return 'its market cell is below the engine’s publish bar';
  return `the engine declined (${code})`;
}

/** the one engine column: the stamp with its clock, or why the row has none */
export function engineReadOf(piece: Pick<Piece, 'appraisal' | 'soldNow' | 'abstain' | 'live'>, nowYear: number): EngineRead {
  if (piece.appraisal) return { kind: 'value', appraisal: piece.appraisal, soldNow: piece.soldNow, asOfText: asOfText(piece.appraisal.asOf, nowYear) };
  if (piece.abstain) return { kind: 'abstain', code: piece.abstain, why: abstainWhy(piece.abstain) };
  return {
    kind: 'none', live: piece.live,
    why: piece.live
      ? 'on the block — the engine priced no value for it tonight'
      : `fills when the nightly reads it — settled pieces sold within ${SETTLED_MONTHS} months are valued; older ones are out of its scope`,
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

export interface IndexPoint {
  year: number;
  label: string;
  /** the joined pieces re-marked and summed; null = gap (a joined piece could not be marked) */
  value: number | null;
  n: number;
  partial: boolean;
  pieces: number;
  /** THE PAID BASELINE: what the pieces joined by this year cost, summed —
   *  a step the marked line is read against (never null: joining needs a price) */
  paid: number;
}

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
      let sum = 0, n = 0, partial = false, gap = false, paid = 0;
      for (const j of in_) {
        paid += j.piece.bought!.usd;
        const m = j.marks.get(y);
        if (!m) { gap = true; continue; }
        sum += m.value; n += m.n; partial = partial || m.partial;
      }
      points.push({ year: y, label: y === nowYear ? `${y} so far` : String(y), value: gap ? null : Math.round(sum), n, partial: partial || y === nowYear, pieces: in_.length, paid: Math.round(paid) });
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
  engine: EngineRead;
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
    engine: engineReadOf(piece, nowYear),
  };
}

/** what kind of level a mark is — a maker's own medians, or a mix of
 *  whatever of a player's / subject's objects came up that year (the (?)'s
 *  caveat, printed on the row that needs it: R1 "mix-driven card index") */
export function levelKindOf(entityId: string | null): 'maker' | 'mix' | null {
  if (!indexableEntity(entityId)) return null;
  return entityId.startsWith('mk:') ? 'maker' : 'mix';
}

export interface GrowthLabel {
  pct: number;
  /** '+159%' */
  text: string;
  /** 'vs $7.5K paid' | 'maker YoY · same items, both years · 320 matched' */
  basis: string;
  title: string;
  dir: 'up' | 'down' | undefined;
  source: 'mark' | 'yoy';
}

const signedPct = (p: number) => `${p > 0 ? '+' : '−'}${Math.abs(Math.round(p))}%`;

/** ONE growth label per row (R1 "YoY vs mark +159%"): the mark's move
 *  against what was paid when the piece carries a mark, else the maker's
 *  year-over-year read; the other stays in the hover title and the CSV */
export function growthOf(row: Pick<PieceRow, 'piece' | 'mark' | 'trend'>): GrowthLabel | null {
  const { piece, mark, trend } = row;
  if (mark && piece.bought && piece.bought.usd > 0) {
    const pct = Math.round((mark.value / piece.bought.usd - 1) * 100);
    const kind = levelKindOf(piece.entityId);
    return {
      pct, text: signedPct(pct), source: 'mark',
      basis: `vs ${fmtFace(piece.bought.usd)} paid`,
      dir: pct === 0 ? undefined : pct > 0 ? 'up' : 'down',
      title: `${fmtFace(mark.value)} marked ${mark.year}${mark.partial ? ' so far' : ''} against ${fmtFace(piece.bought.usd)} ${piece.bought.basis === 'paid' ? 'you paid' : 'realized'} in ${piece.bought.year} — the ${kind === 'maker' ? 'maker’s' : 'name’s'} yearly median moved, not an appraisal of this piece${kind === 'mix' ? ' (a mix of whatever sold under the name that year)' : ''}${trend ? `. Maker YoY ${trend.text} · ${trend.basis}` : ''}`,
    };
  }
  if (trend) return { pct: trend.pct, text: trend.text, basis: `maker YoY · ${trend.basis}`, title: trend.title, dir: trend.dir, source: 'yoy' };
  return null;
}

export interface Totals {
  pieces: number;
  /** every piece with a bought price, summed; `paidN` of them are the reader's own figure */
  bought: number; boughtN: number; paidN: number;
  appraised: number; appraisedN: number;
  /** of the appraised, those with a bought price — the only pieces a delta may compare */
  appraisedPaid: number; appraisedPaidBought: number; appraisedPaidN: number;
  soldNow: number; soldNowN: number;
  abstainedN: number;
  /** the newest `valueAsOf` across the appraised settled rows */
  asOf: string | null;
}

export function totalsOf(pieces: readonly Piece[]): Totals {
  const t: Totals = { pieces: pieces.length, bought: 0, boughtN: 0, paidN: 0, appraised: 0, appraisedN: 0, appraisedPaid: 0, appraisedPaidBought: 0, appraisedPaidN: 0, soldNow: 0, soldNowN: 0, abstainedN: 0, asOf: null };
  for (const p of pieces) {
    if (p.bought) { t.bought += p.bought.usd; t.boughtN++; if (p.bought.basis === 'paid') t.paidN++; }
    if (p.appraisal) {
      t.appraised += p.appraisal.allIn; t.appraisedN++;
      if (p.bought) { t.appraisedPaid += p.appraisal.allIn; t.appraisedPaidBought += p.bought.usd; t.appraisedPaidN++; }
      if (p.appraisal.asOf && (!t.asOf || p.appraisal.asOf > t.asOf)) t.asOf = p.appraisal.asOf;
    }
    if (p.soldNow) { t.soldNow += p.soldNow.net; t.soldNowN++; }
    if (p.abstain) t.abstainedN++;
  }
  return t;
}

/** the calendar year of the desk's clock, in the reader's local time */
export function yearOfNow(now: number): number { return new Date(now).getFullYear(); }

export interface Headline {
  pieces: string;
  bought: { k: string; v: string } | null;
  marked: { k: string; v: string | null; /** '+30% vs $197K paid for these 10' */ delta: string | null; deltaPct: number | null; empty: string };
  engine: { k: string; v: string | null; /** 'as of Oct 12 · $X if sold now' */ sub: string | null; delta: string | null; deltaPct: number | null; empty: string };
}

/** THE HEADLINE LAW applied: the strings a room prints, nothing else */
export function headlineOf(totals: Totals, index: IndexResult, nowYear: number, pending: boolean): Headline {
  const t = totals;
  const latest = index.latest;
  const markedPct = latest && index.bought > 0 ? Math.round((latest.value! / index.bought - 1) * 100) : null;
  const n = index.included.length;
  const apprPct = t.appraisedPaidN > 0 && t.appraisedPaidBought > 0 ? Math.round((t.appraisedPaid / t.appraisedPaidBought - 1) * 100) : null;
  const asOf = asOfText(t.asOf, nowYear);
  return {
    pieces: String(t.pieces),
    bought: t.boughtN > 0 ? {
      k: `Bought${t.paidN === 0 ? ' · at the realized price' : t.paidN < t.boughtN ? ` · ${t.paidN} of ${t.boughtN} your figure` : ''}`,
      v: fmtFace(t.bought),
    } : null,
    marked: {
      k: `Marked now${latest ? ` · ${n} of ${t.pieces} indexed` : ''}`,
      v: latest ? fmtFace(latest.value!) : null,
      delta: markedPct != null && markedPct !== 0 ? `${signedPct(markedPct)} vs ${fmtFace(index.bought)} paid for ${n === 1 ? 'this piece' : `these ${n}`}` : null,
      deltaPct: markedPct,
      empty: pending ? 'reading the makers’ record…' : 'no piece carries an index',
    },
    engine: {
      k: `Engine read${t.appraisedN > 0 ? ` · ${t.appraisedN} of ${t.pieces}` : ''}`,
      v: t.appraisedN > 0 ? fmtFace(t.appraised) : null,
      sub: t.appraisedN > 0 ? [asOf, t.soldNowN > 0 ? `${fmtFace(t.soldNow)} if sold now` : null].filter(Boolean).join(' · ') || null : null,
      delta: apprPct != null && apprPct !== 0 ? `${signedPct(apprPct)} vs paid on ${t.appraisedPaidN === 1 ? 'that piece' : `those ${t.appraisedPaidN}`}` : null,
      deltaPct: apprPct,
      empty: t.abstainedN > 0 && t.abstainedN === t.pieces
        ? 'the engine read every piece and declined — each row says why'
        : `fills when the nightly reads your pieces — settled ones sold within ${SETTLED_MONTHS} months are valued, stamped with the day`,
    },
  };
}

/** 'N pieces without an index' with the reasons folded ('2 bought before the maker had five sales a year') */
export function noIndexNote(excluded: IndexResult['excluded'], pending: boolean): string | null {
  if (!excluded.length) return null;
  const n = excluded.length;
  const by = new Map<NoIndexReason, number>();
  for (const e of excluded) by.set(e.reason, (by.get(e.reason) || 0) + 1);
  const why = Array.from(by.entries()).map(([r, k]) => `${k} ${r}`).join(', ');
  return `${n} ${n === 1 ? 'piece' : 'pieces'} without an index (${why})${pending ? ' — still reading' : ''}`;
}
