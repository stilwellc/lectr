/**
 * w29-otherworks-book.ts — the W24 engine's comp-pool fields over a served
 * book, for verifying the lot page's "other works" group before the nightly
 * stamps value.otherWorkIds. Re-values every valued, non-card lot of the
 * given upcoming.json with today's calibration (w24-pool-debug's path) and
 * writes { id: { poolIds, n, compMedianUsd, otherWorkIds } } for the lots
 * whose pool carries other works.
 *   CORPUS=data/corpus npx tsx scripts/oneoff/qa/w29-otherworks-book.ts upcoming.json out.json
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readGzRows } from '../../corpus-io';
import { normalizeCorpus } from '../../lib/corpus-normalize';
import { prepare, compsOne, calibrationFor, rehydrateState, type BacktestState, type L } from '../../backtest-core';
import { estimateValueEx, setCalibration, setTimeIndex, setHouseBias } from '../../../app/lib/value';
import type { AuctionLot } from '../../../app/types';

const dir = process.env.CORPUS || 'data/corpus';
const [upPath, outPath] = process.argv.slice(2);
const up = JSON.parse(fs.readFileSync(upPath, 'utf8')) as { lots: AuctionLot[] };
const want = up.lots.filter(l => l.value && (l.value.poolIds || []).length && l.value.basis !== 'card-comp');
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
const byId = new Map(prep.lots.map(l => [l.id, l]));
const out: Record<string, unknown> = {};
let seen = 0, valued = 0;
for (const w of want) {
  const t = byId.get(w.id) as L | undefined;
  if (!t) continue;
  seen++;
  const lot = { ...t, saleDate: t.saleDate > today ? t.saleDate : today } as L;
  const comps = compsOne(prep, lot);
  if (!comps) continue;
  const v = estimateValueEx(lot, comps, prep.tbl).value;
  if (!v) continue;
  valued++;
  if (!v.otherWorkIds?.length) continue;
  const same = [...v.poolIds].sort().join() === [...(w.value!.poolIds || [])].map(String).sort().join();
  out[w.id] = { poolIds: v.poolIds, n: v.n, compMedianUsd: v.compMedianUsd, otherWorkIds: v.otherWorkIds, samePool: same, title: w.title, artist: w.artist };
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`${want.length} valued in book · ${seen} in corpus · ${valued} re-valued · ${Object.keys(out).length} with other works`);
