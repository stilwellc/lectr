/**
 * w24-pool-debug.ts — print the comp pool the engine prices a live lot from
 * (the prepare → compsOne → estimateValueEx path, today's calibration) with
 * each comp's title, medium, category, dims, price and match scores.
 *   npx tsx scripts/oneoff/qa/w24-pool-debug.ts id1 id2 …
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readGzRows } from '../../corpus-io';
import { normalizeCorpus } from '../../lib/corpus-normalize';
import { prepare, compsOne, calibrationFor, rehydrateState, type BacktestState, type L } from '../../backtest-core';
import { estimateValueEx, setCalibration, setTimeIndex, setHouseBias } from '../../../app/lib/value';
import type { AuctionLot } from '../../../app/types';

const dir = 'data/corpus';
const ids = process.argv.slice(2);
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
for (const id of ids) {
  const t = byId.get(id) as L | undefined;
  if (!t) { console.log('missing', id); continue; }
  const lot = { ...t, saleDate: t.status === 'sold' ? t.saleDate : (t.saleDate > today ? t.saleDate : today) } as L;
  console.log(`\n== ${id} | ${t.title} | medium=${t.medium} | cat=${t.category}/${(t as L & { formKey?: string }).formKey} | dims=${t.dimensions} | est ${t.estLowUsd}-${t.estHighUsd}`);
  const comps = compsOne(prep, lot);
  if (!comps) { console.log('no comps'); continue; }
  const r = estimateValueEx(lot, comps, prep.tbl);
  const pool = new Set(r.value?.poolIds || []);
  console.log('abstain', r.abstain, 'value', JSON.stringify(r.value && { n: r.value.n, cv: r.value.compValueUsd, med: r.value.compMedianUsd, xh: r.value.expectedHammerUsd, mb: r.value.maxBidUsd, conf: r.value.confidence, tier: r.value.tier, bw: r.value.blendW, ab: r.value.abstain }));
  for (const c of comps.sort((a, b) => b.match.score - a.match.score).slice(0, 25)) {
    const cl = c.lot as L | undefined;
    console.log(`${pool.has(c.id) ? '*' : ' '} ${c.id.padEnd(30)} $${Math.round(c.realizedUsd).toString().padStart(8)} ${c.saleDate} cos=${c.match.cosine.toFixed(2)} sc=${Math.round(c.match.score)} ${c.match.cls} | ${(cl?.title || '').slice(0, 60)} | med=${(cl?.medium || '').slice(0, 30)} | ${cl?.category}/${(cl as L & { formKey?: string })?.formKey} | ${cl?.dimensions || ''} h=${cl?.heightCm} w=${cl?.widthCm}`);
  }
}
