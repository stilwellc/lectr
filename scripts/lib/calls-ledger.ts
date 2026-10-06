/**
 * calls-ledger.ts — the settled-tape receipt for the engine's UNRECEIPTED
 * products (Aug 13 value audit): the card-comp value ('card') and the
 * bid-projection read ('vsbid'). The estimate-house flag already has the
 * +41/+16 backtest; these two covered most of the live book with no record.
 *
 * Mechanics: build-upcoming APPENDS a call the first night a lot carries the
 * read (one row per lot×kind, first call wins — the honest "what we said
 * before the hammer"). build-market GRADES calls whose lots have since sold
 * and publishes the summary in analytics.callsRecord. Rows live in
 * data/corpus/calls-ledger.json.gz (NDJSON, rides the corpus tar to R2).
 */
import * as fs from 'fs';
import * as path from 'path';
import { CORPUS_DIR, gzipNdjson, readGzRows } from '../corpus-io';

export type Call = {
  id: string;
  d: string;            // call date (YYYY-MM-DD)
  /** which product made the claim: card-comp value · bid projection ·
      THE GAP (shelf call, multi-lane engine Aug 25) · THE SLEEPERS */
  k: 'card' | 'vsbid' | 'gap' | 'quiet';
  p: number;            // predicted all-in USD (card med / projected close / appraisal)
  f?: number;           // the floor ('gap'/'vsbid') or opening ask ('quiet')
  m?: string;           // market at call time
  /** lane marker: gap shelf 'w'|'f' (wire/forming) · quiet anchor 'e'|'v'
      (fair-est/appraised) · card TIER 'x'|'g'|'p'|'t'|'m' (exact / grade-adj /
      player / tcg / raw cardComps median — P0-2 per-tier grading). First call
      wins, so a lot first seen forming grades on its forming-day projection —
      earlier claims are harder. */
  s?: string;
  // grading (filled once the lot sells)
  r?: number;           // realized USD
  sd?: string;          // sale date (or, for a miss, the close it was graded against)
  /** last-known close date of the lot (stamped every night it is in the
      corpus) — the clock an unsold / vanished lot is graded against */
  cd?: string;
  /** outcome when the lot did NOT sell: 'u' = unsold (bought in / no result /
      vanished from the corpus) — graded a MISS once the close is 7 days past;
      'w' = withdrawn (the claim was never tested: void, neither graded nor
      pending). A later sale overwrites either (self-healing for a lot that
      only vanished for a crawl hiccup). */
  o?: 'u' | 'w';
};

/** grace after the close before a non-sale is final (results post late) */
export const MISS_GRACE_DAYS = 7;

const LEDGER = path.join(CORPUS_DIR, 'calls-ledger.json.gz');

export function readCalls(): Call[] {
  try { return readGzRows(LEDGER) as unknown as Call[]; } catch { return []; }
}

/** Append new calls — one row per lot×kind, FIRST call wins. */
export function appendCalls(fresh: Call[]): { total: number; added: number } {
  const rows = readCalls();
  const have = new Set(rows.map(c => `${c.id}|${c.k}`));
  let added = 0;
  for (const c of fresh) {
    const key = `${c.id}|${c.k}`;
    if (have.has(key)) continue;
    have.add(key); rows.push(c); added++;
  }
  fs.mkdirSync(CORPUS_DIR, { recursive: true });
  fs.writeFileSync(LEDGER, gzipNdjson(rows as unknown as Record<string, unknown>[]));
  return { total: rows.length, added };
}

/** The served receipts tape — graded calls, newest hammer first, with the
 *  lot identity joined at emit time so the page never needs the corpus.
 *  Every row is a claim made BEFORE the hammer, printed with its outcome. */
export function emitReceipts(
  outPath: string,
  lotById: Map<string, { title?: string; artist?: string; auctionHouse?: string; url?: string }>,
  record: CallsRecord,
  cap = 500,
): number {
  const rows = readCalls()
    .filter(c => typeof c.r === 'number' && c.r! > 0 && c.p > 0)
    .sort((a, b) => String(b.sd || '').localeCompare(String(a.sd || '')))
    .slice(0, cap)
    .map(c => {
      const l = lotById.get(c.id) || {};
      return {
        id: c.id, k: c.k, d: c.d, sd: c.sd,
        p: Math.round(c.p), r: Math.round(c.r!),
        f: typeof c.f === 'number' ? Math.round(c.f) : undefined,
        m: c.m,
        t: l.title || null, a: l.artist || null, h: l.auctionHouse || null,
      };
    });
  fs.writeFileSync(outPath, JSON.stringify({ record, rows, generatedAt: new Date().toISOString().slice(0, 10) }));
  return rows.length;
}

export type TierCell = { n: number; graded: number; medRatio: number | null; within30Pct: number | null };
export const CARD_TIER_CODE: Record<string, string> = { exact: 'x', 'grade-adj': 'g', player: 'p', 'tcg-exact': 't', 'tcg-grade-adj': 't', median: 'm' };
export type CallsRecord = {
  card: TierCell & {
    /** per-tier split (P0-2): exact 'x' · grade-adj 'g' · player 'p' · tcg 't'
        · raw cardComps median 'm' (legacy rows without a marker) */
    byTier: Record<string, TierCell>;
  };
  vsbid: { n: number; graded: number; medRatio: number | null; belowHit: number | null };
  /** THE GAP: medRatio = realized/projected close · floorHit = % of graded
      floor-carrying rows where realized ≥ floor (the claimed floor held).
      Per-shelf splits publish only at ≥20 graded PER SHELF. */
  gap: { n: number; graded: number; medRatio: number | null; floorHit: number | null };
  /** THE SLEEPERS: medRatio = realized/appraisal (both all-in) — was "fair"
      fair · underPct = % graded realizing at/below the appraisal. */
  quiet: { n: number; graded: number; medRatio: number | null; underPct: number | null };
  asOf: string;
};

export type LotOutcome = { status?: string; saleDate?: string | null };
const UNSOLD = new Set(['bought_in', 'unknown-result', 'unsold', 'passed']);
const addDays = (d: string, n: number) => new Date(Date.parse(d.slice(0, 10) + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/** Grade the ledger rows in place; true if any row changed. A SOLD lot
 *  grades with its realized price (always — it also overwrites an earlier
 *  miss). A lot that did NOT sell is graded a MISS 7 days after its close:
 *  bought in / no result on the house's page, or VANISHED from the corpus
 *  (houses that drop pass-ins — RR, Huggins & Scott, NFL/MLB — leave no other
 *  trace). Before Oct 2026 these sat "pending" forever (1,100+ rows, 11 of the
 *  17 Sleepers), so every hit rate was computed over survivors only.
 *  `statusById` must be the FULL corpus (id → status/saleDate); without it
 *  only sales grade (vanished cannot be told from not-loaded). */
export function gradeRows(
  rows: Call[],
  soldById: Map<string, { realizedUsd: number; saleDate: string }>,
  statusById?: Map<string, LotOutcome>,
  today: string = new Date().toISOString().slice(0, 10),
): boolean {
  let changed = false;
  for (const c of rows) {
    if (typeof c.r === 'number' && c.r > 0) continue;
    const s = soldById.get(c.id);
    if (s && s.realizedUsd > 0) { c.r = s.realizedUsd; c.sd = s.saleDate; delete c.o; changed = true; continue; }
    if (!statusById) continue;
    const l = statusById.get(c.id);
    const lsd = l?.saleDate ? l.saleDate.slice(0, 10) : null;
    if (lsd && lsd !== c.cd) { c.cd = lsd; changed = true; }
    // the clock: the lot's close date, else (a vanished legacy row that never
    // had one stamped) the call date — a lot GONE from the corpus is no
    // longer for sale either way, the grace only absorbs a crawl hiccup
    const close = c.cd || c.d;
    const due = addDays(close, MISS_GRACE_DAYS) <= today;
    let o: Call['o'] | undefined;
    if (!l) o = due ? 'u' : undefined;
    else if (l.status === 'withdrawn') o = 'w';
    else if (UNSOLD.has(String(l.status)) && due) o = 'u';
    if (o !== c.o) {
      if (o) { c.o = o; c.sd = close; } else { delete c.o; delete c.sd; }
      changed = true;
    }
  }
  return changed;
}

const isSold = (c: Call) => typeof c.r === 'number' && c.r > 0 && c.p > 0;
const isMiss = (c: Call) => c.o === 'u' && c.p > 0;
const pct = (num: number, den: number) => Math.round(100 * num / den);
const round3 = (x: number | null) => x !== null ? Math.round(x * 1000) / 1000 : null;

/** The published summary. `graded` = sold + misses. medRatio (realized ÷
 *  predicted) needs a hammer, so it runs over SOLD rows only; every HIT RATE
 *  carries the misses in its denominator (an unsold lot did not land within
 *  ±30%, did not hold its floor, did not clear). Thresholds (20) are on the
 *  hit-rate denominator. */
export function summarizeCalls(rows: Call[], asOf: string = new Date().toISOString().slice(0, 10)): CallsRecord {
  const summarize = (k: Call['k'], s?: string) => {
    const all = rows.filter(c => c.k === k && (s === undefined || (c.s || 'm') === s));
    const g = all.filter(isSold);
    const miss = all.filter(isMiss);
    const ratios = g.map(c => c.r! / c.p).sort((a, b) => a - b);
    const med = ratios.length >= 20 ? ratios[Math.floor(ratios.length / 2)] : null;
    return { all, g, miss, ratios, med, graded: g.length + miss.length };
  };
  const within30 = (t: ReturnType<typeof summarize>) => t.graded >= 20 && t.ratios.length >= 20
    ? pct(t.ratios.filter(x => x >= 0.7 && x <= 1.3).length, t.graded) : null;
  /** floor-held rate: sold at/above the floor ÷ (sold + missed) floor rows */
  const floorHeld = (sold: Call[], miss: Call[]) => sold.length + miss.length >= 20
    ? pct(sold.filter(c => c.r! >= c.f!).length, sold.length + miss.length) : null;
  const card = summarize('card');
  const vsbid = summarize('vsbid');
  const gap = summarize('gap');
  const quiet = summarize('quiet');
  const hasF = (c: Call) => typeof c.f === 'number';
  return {
    card: {
      n: card.all.length, graded: card.graded,
      medRatio: round3(card.med),
      within30Pct: within30(card),
      byTier: Object.fromEntries(['x', 'g', 'p', 't', 'm'].map(code => {
        const t = summarize('card', code);
        return [code, { n: t.all.length, graded: t.graded, medRatio: round3(t.med), within30Pct: within30(t) }];
      })),
    },
    vsbid: {
      n: vsbid.all.length, graded: vsbid.graded,
      medRatio: round3(vsbid.med),
      // the 'below' claim graded: did the lot really land at/above the floor
      // (i.e. the flagged price was genuinely under the market)?
      belowHit: floorHeld(vsbid.g.filter(hasF), vsbid.miss.filter(hasF)),
    },
    gap: {
      n: gap.all.length, graded: gap.graded,
      medRatio: round3(gap.med),
      floorHit: floorHeld(gap.g.filter(hasF), gap.miss.filter(hasF)),
    },
    quiet: {
      n: quiet.all.length, graded: quiet.graded,
      medRatio: round3(quiet.med),
      underPct: quiet.graded >= 20 && quiet.ratios.length >= 20
        ? pct(quiet.ratios.filter(x => x <= 1).length, quiet.graded) : null,
    },
    asOf,
  };
}

/** Grade calls against outcomes; persist grades; return the summary. */
export function gradeCalls(
  soldById: Map<string, { realizedUsd: number; saleDate: string }>,
  statusById?: Map<string, LotOutcome>,
  today: string = new Date().toISOString().slice(0, 10),
): CallsRecord {
  const rows = readCalls();
  if (gradeRows(rows, soldById, statusById, today)) fs.writeFileSync(LEDGER, gzipNdjson(rows as unknown as Record<string, unknown>[]));
  return summarizeCalls(rows, today);
}
