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
  k: 'card' | 'vsbid';  // which product made the claim
  p: number;            // predicted all-in USD (card med / projected close)
  f?: number;           // the floor the 'below' claim was made against
  m?: string;           // market at call time
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

export type CallsRecord = {
  card: { n: number; graded: number; medRatio: number | null; within30Pct: number | null };
  vsbid: { n: number; graded: number; medRatio: number | null; belowHit: number | null };
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

  const summarize = (k: Call['k']) => {
    const all = rows.filter(c => c.k === k);
    const g = all.filter(c => typeof c.r === 'number' && c.r! > 0 && c.p > 0);
    const ratios = g.map(c => c.r! / c.p).sort((a, b) => a - b);
    const med = ratios.length >= 20 ? ratios[Math.floor(ratios.length / 2)] : null;
    return { all, g, ratios, med };
  };
  const card = summarize('card');
  const vsbid = summarize('vsbid');
  const belowG = vsbid.g.filter(c => typeof c.f === 'number');
  return {
    card: {
      n: card.all.length, graded: card.g.length,
      medRatio: card.med !== null ? Math.round(card.med * 1000) / 1000 : null,
      within30Pct: card.ratios.length >= 20
        ? Math.round(100 * card.ratios.filter(x => x >= 0.7 && x <= 1.3).length / card.ratios.length) : null,
    },
    vsbid: {
      n: vsbid.all.length, graded: vsbid.g.length,
      medRatio: vsbid.med !== null ? Math.round(vsbid.med * 1000) / 1000 : null,
      // the 'below' claim graded: did the lot really land at/above the floor
      // (i.e. the flagged price was genuinely under the market)?
      belowHit: belowG.length >= 20
        ? Math.round(100 * belowG.filter(c => c.r! >= c.f!).length / belowG.length) : null,
    },
    asOf: new Date().toISOString().slice(0, 10),
  };
}
