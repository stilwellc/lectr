/**
 * noest-replay.ts — replay ONLY the no-estimate hedonic targets (trailing
 * window before --asof) into a copy of a snapshot's backtest state, so the
 * no-estimate bias correction and 'n' value bands exist point-in-time for a
 * re-score (the production state gains them on the next full leg/incremental).
 *
 *   npx tsx scripts/_qa/noest-replay.ts --corpus <dir> --asof 2026-09-14 --out <state.json.gz>
 *
 * Never writes to data/ or public/. tsconfig-excluded (_qa).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readGzRows } from '../corpus-io';
import { normalizeCorpus } from '../lib/corpus-normalize';
import { prepare, targetsOf, replayTargets, rehydrateState, valueRecordOf, type BacktestState, type L } from '../backtest-core';
import type { AuctionLot } from '../../app/types';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };

function main() {
  const dir = arg('corpus')!;
  const asOf = arg('asof')!;
  const t0 = Date.now();
  const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const lots = (readGzRows(path.join(dir, 'lots.json.gz')) as unknown as AuctionLot[])
    .concat(readGzRows(path.join(dir, 'sold-archive.json.gz')) as unknown as AuctionLot[]);
  normalizeCorpus(lots as never);
  const EXC = new Set(['sports-cards', 'graded-cards', 'pokemon']);
  const eng = lots.filter(l => !EXC.has(l.artist) && (l as AuctionLot & { source?: string }).source !== 'sothebys-algolia');
  const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'backtest-state.json.gz'))).toString('utf8')) as BacktestState;
  rehydrateState(st, null, () => {});
  st.noEst = [];
  const prep = prepare(eng, console.log, el);
  const { noEstTargets } = targetsOf(prep);
  const tg = noEstTargets.filter((l: L) => l.saleDate < asOf);
  console.log(`[noest] ${tg.length} no-estimate targets before ${asOf} (${el()})`);
  const res = replayTargets(prep, st, [], [], console.log, 5000, tg);
  console.log(`[noest] scored ${res.scored}, abstained ${res.tried} (${el()})`);
  console.log('[noest] record:', JSON.stringify(valueRecordOf([], st.noEst || []).noEstimate));
  fs.writeFileSync(arg('out')!, zlib.gzipSync(Buffer.from(JSON.stringify(st))));
}
main();
