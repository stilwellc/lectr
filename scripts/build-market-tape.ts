/**
 * build-market-tape.ts — THE VALUE TAPE (Sep 27 2026): the live forward
 * record of the number every upcoming lot was SERVED.
 *
 * The backtest replays estimate lots point-in-time; the calls ledger grades
 * the card/projection/lane calls. Neither recorded the one number most lots
 * wear — value.compValueUsd and its band — so the audit had to reconstruct
 * the live record from R2 snapshots by hand (lectr 0.60 median abs error vs
 * the house's 0.32, bands at 48% on 'high'). build-market now appends, for
 * every valued upcoming lot, the FIRST value it was served (first call wins —
 * "what we said before the hammer"), tagged with the engine version, and
 * validate-engine grades the tape against the lots that have since sold (the
 * live forward check). Corpus-only: data/corpus/value-tape.json.gz (NDJSON),
 * riding the corpus tar to R2 like the calls ledger; never served.
 */
import * as fs from 'fs';
import * as path from 'path';
import { CORPUS_DIR, gzipNdjson, readGzRows } from './corpus-io';
import type { AuctionLot } from '../app/types';

export type TapeRow = {
  id: string;
  /** day the value was first served */
  d: string;
  /** market at call time */
  m?: string;
  /** the served value (all-in USD) and its band */
  p: number; lo: number; hi: number;
  /** confidence tier */
  c: string;
  /** path: 'e' estimate lot (blend) · 'n' no-estimate hedonic · 'c' card tier */
  k: 'e' | 'n' | 'c';
  /** estimate midpoint (hammer USD) on estimate lots — the flag's base */
  e?: number;
  /** directional signal at call time: 'b' below · 'a' above · 't' at */
  s?: 'b' | 'a' | 't';
  /** engine version that served it */
  v: string;
};

export const TAPE_FILE = path.join(CORPUS_DIR, 'value-tape.json.gz');
/** unsold rows older than this are pruned (the lot never resolved) */
const TAPE_KEEP_DAYS = 400;

export function readValueTape(file = TAPE_FILE): TapeRow[] {
  try { return readGzRows(file) as unknown as TapeRow[]; } catch { return []; }
}

/** Append today's first-served values (first call wins per lot). Returns counts. */
export function appendValueTape(
  lots: AuctionLot[], today: string, marketBySlug: Record<string, string>, version: string,
  soldIds: Set<string>, file = TAPE_FILE,
): { total: number; added: number; pruned: number } {
  const rows = readValueTape(file);
  const have = new Set(rows.map(r => r.id));
  let added = 0;
  for (const l of lots) {
    if (l.status !== 'upcoming') continue;
    const v = (l as AuctionLot & { value?: { compValueUsd?: number; low?: number; high?: number; confidence?: string; basis?: string; signal?: { label?: string } | null } | null }).value;
    if (!v || !(v.compValueUsd! > 0)) continue;
    const id = String(l.id);
    if (have.has(id)) continue;
    const lo = l.estLowUsd ?? l.estHighUsd, hi = l.estHighUsd ?? l.estLowUsd;
    const e = lo && hi ? (lo + hi) / 2 : undefined;
    const lab = v.signal?.label || '';
    rows.push({
      id, d: today, m: marketBySlug[l.artist], p: Math.round(v.compValueUsd!), lo: Math.round(v.low || 0), hi: Math.round(v.high || 0),
      c: v.confidence || 'low', k: v.basis === 'card-comp' ? 'c' : e ? 'e' : 'n',
      ...(e ? { e: Math.round(e) } : {}),
      ...(lab ? { s: lab.startsWith('below') ? 'b' as const : lab.startsWith('above') ? 'a' as const : 't' as const } : {}),
      v: version,
    });
    have.add(id); added++;
  }
  const cut = new Date(Date.parse(today) - TAPE_KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const kept = rows.filter(r => r.d >= cut || soldIds.has(r.id));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, gzipNdjson(kept as unknown as Record<string, unknown>[]));
  return { total: kept.length, added, pruned: rows.length - kept.length };
}

export type TapeCell = { n: number; medAbsErrPct: number | null; within30Pct: number | null; bias: number | null; bandCoveragePct: number | null };
/** Grade tape rows against realized prices: per scope key → accuracy cell.
 *  Only rows whose lot sold ON/AFTER the call day count (a pre-sale claim). */
export function gradeValueTape(
  rows: TapeRow[], sold: Map<string, { r: number; sd: string }>, keyOf: (r: TapeRow) => string[],
): Record<string, TapeCell & { flagged?: number; unflagged?: number }> {
  const acc = new Map<string, { lr: number[]; cov: number; fl: number[]; un: number[] }>();
  for (const t of rows) {
    const s = sold.get(t.id);
    if (!s || !(s.r > 0) || !(t.p > 0) || s.sd.slice(0, 10) < t.d) continue;
    for (const k of keyOf(t)) {
      const a = acc.get(k) || acc.set(k, { lr: [], cov: 0, fl: [], un: [] }).get(k)!;
      a.lr.push(Math.log(s.r / t.p));
      if (t.lo > 0 && t.hi > 0 && s.r >= t.lo && s.r <= t.hi) a.cov++;
      if (t.k === 'e' && t.e) (t.s === 'b' ? a.fl : a.un).push(s.r / t.e);
    }
  }
  const med = (x: number[]) => { const s = x.slice().sort((p, q) => p - q); const n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const out: Record<string, TapeCell & { flagged?: number; unflagged?: number }> = {};
  acc.forEach((a, k) => {
    const n = a.lr.length;
    out[k] = n < 20 ? { n, medAbsErrPct: null, within30Pct: null, bias: null, bandCoveragePct: null } : {
      n,
      medAbsErrPct: Math.round((Math.exp(med(a.lr.map(Math.abs))) - 1) * 1000) / 10,
      within30Pct: Math.round(1000 * a.lr.filter(x => Math.abs(x) <= Math.log(1.3)).length / n) / 10,
      bias: Math.round(Math.exp(med(a.lr)) * 1000) / 1000,
      bandCoveragePct: Math.round(1000 * a.cov / n) / 10,
      ...(a.fl.length >= 20 && a.un.length >= 20 ? { flagged: Math.round(med(a.fl) * 1000) / 1000, unflagged: Math.round(med(a.un) * 1000) / 1000 } : {}),
    };
  });
  return out;
}
