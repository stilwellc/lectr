/**
 * live-rescore.ts — point-in-time re-score of a served snapshot through the
 * CURRENT engine (Sep 27 2026 engine pass). Reads a pulled R2 corpus version
 * (corpus.tar → lots.json.gz + sold-archive.json.gz + backtest-state.json.gz),
 * runs build-market's evaluation seam (runMarketBuild evalOnly, clock frozen at
 * the snapshot) with the calibration the snapshot's own backtest state implies
 * (calibrationOf over rows dated before the snapshot), and writes the value
 * each target lot WOULD have been served — in the audit's live_rows schema so
 * score.py scores before/after on identical inputs.
 *
 *   npx tsx scripts/_qa/live-rescore.ts --corpus <dir> --asof 2026-09-14 \
 *     --rows <live_rows.json> --out <new_rows.json> [--legacy-cal]
 *
 * Never writes to data/ or public/ (evalOnly). tsconfig-excluded (_qa).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readGzRows } from '../corpus-io';
import { runMarketBuild } from '../build-market';
import { calibrationOf, type BacktestState } from '../backtest-core';
import type { AuctionLot } from '../../app/types';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };

async function main() {
  const dir = arg('corpus')!;
  const asOf = arg('asof')!;
  const rowsIn = JSON.parse(fs.readFileSync(arg('rows')!, 'utf8')) as { id: string; snap: string }[];
  const want = new Set(rowsIn.filter(r => r.snap === asOf).map(r => r.id));
  console.log(`[rescore] ${want.size} target lots snapshotted ${asOf}`);
  const lots = (readGzRows(path.join(dir, 'lots.json.gz')) as unknown as AuctionLot[])
    .concat(readGzRows(path.join(dir, 'sold-archive.json.gz')) as unknown as AuctionLot[]);
  console.log(`[rescore] corpus ${lots.length} lots`);
  const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(arg('state') || path.join(dir, 'backtest-state.json.gz'))).toString('utf8')) as BacktestState;
  const rows = st.calObs.filter(o => (o.sd || '') < asOf);
  const ne = (st.noEst || []).filter(o => o.sd < asOf);
  let calibration: Record<string, unknown> | null = null;
  if (process.argv.includes('--no-cal')) calibration = null;
  else {
    const c = calibrationOf(rows, ne, asOf);
    const legacy = process.argv.includes('--legacy-cal');
    calibration = {
      edges: c.edges, beatRate: c.beatRate, band: c.band, bandByMarket: c.bandByMarket, mdape: c.mdape, n: c.n,
      ...(legacy ? {} : { blend: c.blend, bias: c.bias, valueBand: c.valueBand, valueBandByMarket: c.valueBandByMarket }),
    };
    console.log(`[rescore] calibration from ${rows.length} rows (+${ne.length} no-est) before ${asOf}: blend ${JSON.stringify(c.blend?.w)} a=${JSON.stringify(c.blend?.a)}`);
    console.log(`[rescore] valueBand ${JSON.stringify(c.valueBand)}`);
    console.log(`[rescore] bias ${JSON.stringify(c.bias)}`);
  }
  const out = await runMarketBuild({ lots, nowMs: Date.parse(`${asOf}T13:00:00Z`), evalOnly: true, calibration, onlyIds: want, noTimeAdjust: process.argv.includes('--no-tadj') });
  const res: Record<string, unknown>[] = [];
  for (const l of out) {
    if (!want.has(String(l.id))) continue;
    const v = (l as AuctionLot & { value?: Record<string, unknown> | null }).value || null;
    res.push({
      id: l.id,
      cv: v?.compValueUsd ?? null, vlo: v?.low ?? null, vhi: v?.high ?? null, conf: v?.confidence ?? null,
      tier: v?.tier ?? null, basis: v?.basis ?? null, ct: v?.cardTier ?? null,
      sig: (v?.signal as { label?: string } | null)?.label ?? null,
      cr: v?.compRatio ?? null, cm: v?.compAdjUsd ?? null, bw: v?.blendW ?? null,
      cc: ((l as AuctionLot & { cardComps?: { med?: number | null } }).cardComps || {}).med ?? null,
      abst: (l as AuctionLot & { abstain?: string }).abstain ?? null,
      pool: v?.poolIds ?? null,
    });
  }
  fs.writeFileSync(arg('out')!, JSON.stringify(res));
  console.log(`[rescore] wrote ${res.length} rows → ${arg('out')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
