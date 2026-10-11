/**
 * THE CARD'S OWN RECORD, DATED (W17, Oct 11 2026).
 *
 * A card's lectr value is read from the exact card + grade's RECENT sales —
 * the card tier pricer (scripts/build-market.ts priceCard) keeps sales at most
 * CARD_WINDOW_Y old (a lone sale only when at most CARD_SINGLE_Y old), plain
 * median at n ≤ CARD_THIN.n (value.ts), newest-weighted median above, hammer basis. The
 * page used to print the card's ALL-TIME median beside it: 1951 Bowman Mantle
 * SGC 3 read "$10K median · 11 sales" (mostly 2021–23) next to a $19K value
 * read from two 2026 sales.
 *
 * This module is the one place both sides read the window from:
 *   build  — cardRecordStamp(): the trailing-year median + n and the year span
 *            stamped on lot.cardComps (and per grade-ladder rung)
 *   client — cardRecordOf() / rungRecordOf() / cardValueBasis(): what the lot
 *            page, the modal and the entity ladders print. Every count and
 *            window is the engine's stamp (value.n, value.cardTier, poolIds,
 *            cardComps.r) — never re-derived from a guess. Data stamped before
 *            W17 falls back to what the stamp still proves (the exact tier's
 *            pool IS the newest value.n sales), else to the all-time figure
 *            labelled all-time.
 */
import type { AuctionLot } from '../types';
import { median as statsMedian } from './stats';

/** card tier recency (Sep 27 2026): pools keep sales ≤ CARD_WINDOW_Y old; a
 *  lone exact sale counts only when ≤ CARD_SINGLE_Y; weights halve every
 *  CARD_HL_Y. scripts/build-market.ts imports these — one source. */
export const CARD_WINDOW_Y = 1;
export const CARD_SINGLE_Y = 0.5;
export const CARD_HL_Y = 0.25;
/** the engine's year (ms) — ages are measured in it */
export const CARD_YEAR_MS = 31_557_600_000;

/** the year span of a card's sales on file: first, last, and the shortest run
 *  of years holding more than half of them ("most 2021–23") */
export interface CardSpan { y0: number; y1: number; m0: number; m1: number }
/** the trailing-window record: median (null at n = 0) and its n */
export interface CardRecent { med: number | null; n: number }

export interface CardStamp { r: CardRecent; s: CardSpan | null }

function yearOf(d: string | null | undefined): number | null {
  if (!d) return null;
  const y = parseInt(d.slice(0, 4), 10);
  return Number.isFinite(y) && y > 1800 ? y : null;
}

/** the year span of dated sales (null when none is dated) */
export function spanOf(dates: readonly (string | null | undefined)[]): CardSpan | null {
  const ys = dates.map(yearOf).filter((y): y is number => y != null).sort((a, b) => a - b);
  if (!ys.length) return null;
  const y0 = ys[0], y1 = ys[ys.length - 1];
  // the shortest year run holding a strict majority of the dated sales
  const need = Math.floor(ys.length / 2) + 1;
  let m0 = y0, m1 = y1;
  for (let i = 0; i + need - 1 < ys.length; i++) {
    const a = ys[i], b = ys[i + need - 1];
    if (b - a < m1 - m0) { m0 = a; m1 = b; }
  }
  return { y0, y1, m0, m1 };
}

/** age in engine years of a sale dated `d` as of `asOfMs` (NaN undated) */
function ageY(d: string | null | undefined, asOfMs: number): number {
  const ms = d ? Date.parse(d.length === 10 ? `${d}T00:00:00Z` : d) : NaN;
  return (asOfMs - ms) / CARD_YEAR_MS;
}

/** in the pricer's window: strictly before asOf, at most CARD_WINDOW_Y old */
export function inCardWindow(d: string | null | undefined, asOfMs: number): boolean {
  const a = ageY(d, asOfMs);
  return a > 0 && a <= CARD_WINDOW_Y;
}

/** BUILD: the stamp for one pool of sales (an exact card+grade pool, or one
 *  grade rung) — the trailing-window median + n, and the span on file */
export function cardRecordStamp(sales: readonly { d: string | null | undefined; p: number }[], asOfMs: number): CardStamp {
  const recent = sales.filter(s => s.p > 0 && inCardWindow(s.d, asOfMs)).map(s => s.p);
  return {
    r: { med: recent.length ? Math.round(statsMedian(recent)) : null, n: recent.length },
    s: spanOf(sales.map(s => s.d)),
  };
}

/* ── CLIENT ─────────────────────────────────────────────────────────────── */

type CardComps = NonNullable<AuctionLot['cardComps']>;
type LastSale = CardComps['lastSales'][number];
type Rung = CardComps['gradeLadder'][number];
type CardValue = { n?: number; poolIds?: string[]; basis?: string; cardTier?: string; abstain?: string | null } | null | undefined;

/** "2021–23", "2021", "2019–2024" across a century */
export function yearsText(a: number, b: number): string {
  if (a === b) return String(a);
  return Math.floor(a / 100) === Math.floor(b / 100) ? `${a}–${String(b).slice(2)}` : `${a}–${b}`;
}

/** "since 2021 · 11 sales, most 2021–23" — the all-time figure, dated */
export function spanText(n: number, s: CardSpan | null | undefined): string {
  const sales = `${n.toLocaleString()} ${n === 1 ? 'sale' : 'sales'}`;
  if (!s) return `${sales} on file`;
  if (n === 1 || s.y0 === s.y1) return `${sales}, ${s.y0}`;
  const most = n >= 3 && (s.m0 !== s.y0 || s.m1 !== s.y1) ? `, most ${yearsText(s.m0, s.m1)}` : '';
  return `since ${s.y0} · ${sales}${most}`;
}

/** which of the lot's dated same-card rows the value was read from: the
 *  stamped ids against value.poolIds, else (pre-W17 data) the exact tier's
 *  pool — every exact sale in the window, i.e. the newest value.n rows */
export function valueRowFlags(lot: Pick<AuctionLot, 'cardComps' | 'value'>, rows: readonly LastSale[]): boolean[] {
  const v = lot.value as CardValue;
  const usable = !!v && v.basis === 'card-comp' && v.cardTier === 'exact' && !(typeof v.abstain === 'string' && v.abstain.startsWith('card:'));
  if (!usable) return rows.map(() => false);
  const ids = new Set(v!.poolIds || []);
  if (rows.some(r => (r as LastSale & { id?: string }).id)) {
    return rows.map(r => { const id = (r as LastSale & { id?: string }).id; return !!id && ids.has(id); });
  }
  const k = v!.n || 0;
  return rows.map((_, i) => i < k);
}

export interface CardRecord {
  /** the trailing-window record — null when it cannot be proven */
  recent: CardRecent | null;
  /** where `recent` was read from */
  recentFrom: 'stamp' | 'value-pool' | 'rows' | null;
  /** the all-time record: median, n, span (span null when not on file) */
  all: { med: number | null; n: number; span: CardSpan | null };
}

/** THE CARD'S RECORD — trailing year and all-time, each with its n */
export function cardRecordOf(lot: Pick<AuctionLot, 'cardComps' | 'value'>, nowMs: number = Date.now()): CardRecord | null {
  const cc = lot.cardComps as (CardComps & Partial<CardStamp>) | null | undefined;
  if (!cc) return null;
  const rows = (cc.lastSales || []).filter(s => s.p > 0);
  const complete = rows.length > 0 && rows.length >= cc.n;
  const all = {
    med: cc.med != null && cc.med > 0 ? cc.med : null,
    n: cc.n || 0,
    span: cc.s ?? (complete ? spanOf(rows.map(r => r.d)) : null),
  };
  // 1. the build stamp
  if (cc.r && typeof cc.r.n === 'number') return { recent: { med: cc.r.n ? cc.r.med : null, n: cc.r.n }, recentFrom: 'stamp', all };
  // 2. the exact tier's pool IS this card's every sale in the window: the
  //    newest value.n rows, when the rows on the lot cover them
  const v = lot.value as CardValue;
  const flags = valueRowFlags(lot, rows);
  const k = v?.n || 0;
  if (k > 0 && flags.filter(Boolean).length === k && k <= rows.length) {
    const ps = rows.filter((_, i) => flags[i]).map(r => r.p);
    return { recent: { med: Math.round(statsMedian(ps)), n: k }, recentFrom: 'value-pool', all };
  }
  // 3. the dated rows reach past the window (or are every sale): count them
  const oldest = rows[rows.length - 1];
  if (rows.length && (complete || (oldest && !inCardWindow(oldest.d, nowMs) && ageY(oldest.d, nowMs) > 0))) {
    const ps = rows.filter(r => inCardWindow(r.d, nowMs)).map(r => r.p);
    return { recent: { med: ps.length ? Math.round(statsMedian(ps)) : null, n: ps.length }, recentFrom: 'rows', all };
  }
  return { recent: null, recentFrom: null, all };
}

/** one rung of the grade ladder, as printed: the trailing-year median when
 *  the grade sold in it, else the all-time median, dated */
export interface RungView {
  price: number;
  /** 'year' = the trailing-year median; 'all' = the all-time median */
  basis: 'year' | 'all';
  /** "3 sales in the last year · $15.5K all-time, since 2008 · 25 sales" */
  meta: string;
}

export function rungView(r: Rung & { rn?: number; rmed?: number | null; y0?: number; y1?: number; m0?: number; m1?: number }, fmt: (n: number) => string): RungView {
  const span: CardSpan | null = r.y0 != null && r.y1 != null ? { y0: r.y0, y1: r.y1, m0: r.m0 ?? r.y0, m1: r.m1 ?? r.y1 } : null;
  if (typeof r.rn === 'number' && r.rn > 0 && r.rmed != null && r.rmed > 0) {
    return {
      price: r.rmed, basis: 'year',
      meta: `${r.rn === 1 ? '1 sale' : `${r.rn} sales`} in the last year · all-time ${fmt(r.med)}, ${r.n}${span ? ` since ${span.y0}` : ''}`,
    };
  }
  if (typeof r.rn === 'number') {
    return { price: r.med, basis: 'all', meta: `all-time, ${r.n} ${r.n === 1 ? 'sale' : 'sales'}${span ? ` ${yearsText(span.y0, span.y1)}` : ''} · none in the last year` };
  }
  return { price: r.med, basis: 'all', meta: `all-time median · ${r.n.toLocaleString()} ${r.n === 1 ? 'sale' : 'sales'}` };
}

/** what a ladder's rungs are, in one line (the section's context) */
export function ladderBasisText(rungs: readonly (Rung & { rn?: number })[]): string {
  return rungs.some(r => typeof r.rn === 'number')
    ? 'last-year medians where a grade sold, else all-time, dated'
    : 'all-time medians, never means';
}

/** "from 2 sales of this card & grade in the last year" — what the card
 *  value was read from, in the engine's own counts and window (value.n,
 *  value.cardTier). null when the value is not a card-comp value. */
export function cardValueBasis(v: CardValue): string | null {
  if (!v || v.basis !== 'card-comp') return null;
  const n = v.n || 0;
  if (!(n > 0)) return null;
  const sales = `${n} ${n === 1 ? 'sale' : 'sales'}`;
  switch (v.cardTier) {
    case 'exact':
      // a lone exact sale prices only when it is at most CARD_SINGLE_Y old
      return n === 1
        ? `from 1 sale of this card & grade in the last ${Math.round(CARD_SINGLE_Y * 12)} months`
        : `from ${sales} of this card & grade in the last ${CARD_WINDOW_Y === 1 ? 'year' : `${CARD_WINDOW_Y} years`}`;
    case 'grade-adj':
      return `from ${sales} of this card at other grades in the last ${CARD_WINDOW_Y === 1 ? 'year' : `${CARD_WINDOW_Y} years`}, grade-adjusted`;
    case 'tcg-exact':
      return `from ${sales} of this card & grade, newest weighted most`;
    case 'tcg-grade-adj':
      return `from ${sales} of this card at other grades, grade-adjusted`;
    default:
      return `from ${sales} of this card`;
  }
}

/** the premium the card's realized sales carry over the value's hammer, as a
 *  sentence: "lectr value $19K is hammer, before premium — $23K all-in at
 *  22%". Realized card sales are all-in (hammer + buyer's premium). */
export function allInNote(hammerText: string, allInText: string, premiumPct: number | null): string {
  return `Realized prices — winning bid plus buyer’s premium. The lectr value ${hammerText} is the expected hammer, before premium: ${allInText} all-in${premiumPct != null && premiumPct > 0 ? ` at ${premiumPct}%` : ''}.`;
}
