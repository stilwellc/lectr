/**
 * w24-pair-dump.ts — W24 comp-object rules on the LIVE book: for every
 * upcoming art / design lot, the comps each rule (estScale, uniqueSupport,
 * uniqueSize, workYear) drops from today's candidate pool, with both rows'
 * title, medium head, year, dims, estimate and price — the sample a person
 * judges (is the dropped comp really another object?). Also prints the
 * served value under CURRENT and CANDIDATE for each touched lot.
 *   npx tsx scripts/oneoff/qa/w24-pair-dump.ts [--out pairs.ndjson] [--ids a,b]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readGzRows } from '../../corpus-io';
import { normalizeCorpus } from '../../lib/corpus-normalize';
import { prepare, compsOne, calibrationFor, rehydrateState, type BacktestState, type L } from '../../backtest-core';
import {
  estimateValueEx, setCalibration, setTimeIndex, setHouseBias, setEngineFlags, timeFactor,
  ENGINE_FLAGS_CURRENT, ENGINE_FLAGS_CANDIDATE, EST_SCALE, UNIQUE_SIZE, WORK_YEAR, getTimeIndex,
} from '../../../app/lib/value';
import { uniqueSupportConflict, uniqueSizeConflict, workYearConflict, estMidUsdOf, supportOf } from '../../../app/lib/comp-purity';
import { ARTISTS } from '../../../app/constants';
import type { AuctionLot } from '../../../app/types';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };
const dir = 'data/corpus';
const lots = (readGzRows(path.join(dir, 'lots.json.gz')) as unknown as AuctionLot[])
  .concat(readGzRows(path.join(dir, 'sold-archive.json.gz')) as unknown as AuctionLot[]);
normalizeCorpus(lots as never);
const EXC = new Set(['sports-cards', 'graded-cards', 'pokemon']);
const eng = lots.filter(l => !EXC.has(l.artist) && (l as AuctionLot & { source?: string }).source !== 'sothebys-algolia');
const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'backtest-state.json.gz'))).toString('utf8')) as BacktestState;
const prep = prepare(eng, () => {}, () => '');
rehydrateState(st, prep, () => {});
const today = new Date().toISOString().slice(0, 10);
setCalibration(calibrationFor(st, today, prep.marketBySlug));
setTimeIndex(prep.timeIndexer!(today));
setHouseBias(prep.houseBiasIndexer!(today));
const MK: Record<string, string> = {}; for (const a of ARTISTS) MK[a.slug] = a.market;
const only = arg('ids') ? new Set(arg('ids')!.split(',')) : null;
const out = arg('out') ? fs.createWriteStream(arg('out')!) : null;
const desc = (l: L) => {
  const d = ((l as AuctionLot).description || '').replace(/\s+/g, ' ');
  return d.slice(0, 160);
};
const row = (l: L, price?: number) => ({ id: l.id, t: (l.title || '').slice(0, 90), y: l.yearNum ?? null, fk: (l as AuctionLot & { formKey?: string }).formKey, sup: supportOf(l as never), hw: l.heightCm && l.widthCm ? `${Math.round(l.heightCm)}x${Math.round(l.widthCm)}` : null, est: Math.round(estMidUsdOf(l as never)), p: price ? Math.round(price) : undefined, sd: l.saleDate, h: l.auctionHouse, d: desc(l) });
const counts: Record<string, number> = {};
let touched = 0, lotsN = 0;
const live = prep.lots.filter(l => (l.status === 'upcoming' || l.status === 'live') && (MK[l.artist] === 'art' || MK[l.artist] === 'design') && (!only || only.has(l.id)));
for (const t0 of live) {
  const lot = { ...t0, saleDate: t0.saleDate > today ? t0.saleDate : today } as L;
  const comps = compsOne(prep, lot);
  if (!comps) continue;
  lotsN++;
  const tMid = estMidUsdOf(lot as never);
  const mk = MK[lot.artist];
  const drops: { rule: string; c: ReturnType<typeof row> }[] = [];
  for (const c of comps) {
    const cl = c.lot as L | undefined; if (!cl) continue;
    if (!(c.match.cosine >= 0.45 || c.match.idExact)) continue;
    const rules: string[] = [];
    if (uniqueSupportConflict(lot as never, cl as never)) rules.push('support');
    if (uniqueSizeConflict(lot as never, cl as never, UNIQUE_SIZE.ratio)) rules.push('size');
    if (workYearConflict(lot as never, cl as never, WORK_YEAR.d)) rules.push('year');
    if (tMid > 0 && (EST_SCALE as Record<string, number>)[mk === 'art' || mk === 'design' ? mk : 'other']) {
      const cMid = estMidUsdOf(cl as never) * timeFactor(getTimeIndex()?.marketBySlug?.[lot.artist] ?? mk, c.saleDate);
      if (cMid > 0 && Math.max(tMid, cMid) / Math.min(tMid, cMid) > EST_SCALE.ratio) rules.push(`est×${(Math.max(tMid, cMid) / Math.min(tMid, cMid)).toFixed(1)}`);
    }
    if (rules.length) { drops.push({ rule: rules.join('+'), c: { ...row(cl, c.realizedUsd), cos: +c.match.cosine.toFixed(2) } as ReturnType<typeof row> }); for (const r of rules) { const k = r.startsWith('est') ? 'est' : r; counts[k] = (counts[k] || 0) + 1; } }
  }
  if (!drops.length) continue;
  touched++;
  setEngineFlags(ENGINE_FLAGS_CURRENT);
  const a = estimateValueEx(lot, comps, prep.tbl);
  setEngineFlags(ENGINE_FLAGS_CANDIDATE);
  const b = estimateValueEx(lot, comps, prep.tbl);
  setEngineFlags(null);
  const pick = (r: typeof a) => r.value ? { xh: r.value.expectedHammerUsd, n: r.value.n, med: r.value.compMedianUsd, conf: r.value.confidence, pool: r.value.poolIds.length } : { abstain: r.abstain };
  const rec = { target: row(lot), A: pick(a), B: pick(b), drops };
  if (out) out.write(JSON.stringify(rec) + '\n');
  if (only) console.log(JSON.stringify(rec, null, 1));
}
console.log(`[w24] ${lotsN} live art/design lots with comps · ${touched} touched · drops by rule ${JSON.stringify(counts)}`);
out?.end();
