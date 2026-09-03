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
  sd?: string;          // sale date
};

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

/** Grade calls against sold outcomes; persist grades; return the summary. */
export function gradeCalls(soldById: Map<string, { realizedUsd: number; saleDate: string }>): CallsRecord {
  const rows = readCalls();
  let changed = false;
  for (const c of rows) {
    if (c.r !== undefined) continue;
    const s = soldById.get(c.id);
    if (s && s.realizedUsd > 0) { c.r = s.realizedUsd; c.sd = s.saleDate; changed = true; }
  }
  if (changed) fs.writeFileSync(LEDGER, gzipNdjson(rows as unknown as Record<string, unknown>[]));

  const summarize = (k: Call['k'], s?: string) => {
    const all = rows.filter(c => c.k === k && (s === undefined || (c.s || 'm') === s));
    const g = all.filter(c => typeof c.r === 'number' && c.r! > 0 && c.p > 0);
    const ratios = g.map(c => c.r! / c.p).sort((a, b) => a - b);
    const med = ratios.length >= 20 ? ratios[Math.floor(ratios.length / 2)] : null;
    return { all, g, ratios, med };
  };
  const card = summarize('card');
  const vsbid = summarize('vsbid');
  const gap = summarize('gap');
  const quiet = summarize('quiet');
  const belowG = vsbid.g.filter(c => typeof c.f === 'number');
  const gapFloorG = gap.g.filter(c => typeof c.f === 'number');
  return {
    card: {
      n: card.all.length, graded: card.g.length,
      medRatio: card.med !== null ? Math.round(card.med * 1000) / 1000 : null,
      within30Pct: card.ratios.length >= 20
        ? Math.round(100 * card.ratios.filter(x => x >= 0.7 && x <= 1.3).length / card.ratios.length) : null,
      byTier: Object.fromEntries(['x', 'g', 'p', 't', 'm'].map(code => {
        const t = summarize('card', code);
        return [code, {
          n: t.all.length, graded: t.g.length,
          medRatio: t.med !== null ? Math.round(t.med * 1000) / 1000 : null,
          within30Pct: t.ratios.length >= 20
            ? Math.round(100 * t.ratios.filter(x => x >= 0.7 && x <= 1.3).length / t.ratios.length) : null,
        }];
      })),
    },
    vsbid: {
      n: vsbid.all.length, graded: vsbid.g.length,
      medRatio: vsbid.med !== null ? Math.round(vsbid.med * 1000) / 1000 : null,
      // the 'below' claim graded: did the lot really land at/above the floor
      // (i.e. the flagged price was genuinely under the market)?
      belowHit: belowG.length >= 20
        ? Math.round(100 * belowG.filter(c => c.r! >= c.f!).length / belowG.length) : null,
    },
    gap: {
      n: gap.all.length, graded: gap.g.length,
      medRatio: gap.med !== null ? Math.round(gap.med * 1000) / 1000 : null,
      floorHit: gapFloorG.length >= 20
        ? Math.round(100 * gapFloorG.filter(c => c.r! >= c.f!).length / gapFloorG.length) : null,
    },
    quiet: {
      n: quiet.all.length, graded: quiet.g.length,
      medRatio: quiet.med !== null ? Math.round(quiet.med * 1000) / 1000 : null,
      underPct: quiet.ratios.length >= 20
        ? Math.round(100 * quiet.ratios.filter(x => x <= 1).length / quiet.ratios.length) : null,
    },
    asOf: new Date().toISOString().slice(0, 10),
  };
}
