/**
 * window-replay.ts — a LOCAL point-in-time backtest of the current engine on a
 * trailing window (Sep 27 2026 engine pass). Takes a snapshot's corpus + its
 * backtest state, drops the state's rows dated inside the window (the old
 * engine scored those), and replays every estimate / bought-in / no-estimate
 * target in the window through backtest-core.replayTargets — the production
 * replay: calibration AND the market time index refit at every quarter from
 * rows strictly before it, so rows scored late in the window run on the
 * house × market blend intercepts the early window taught. Prints the
 * published-value record (valueRecordOf) and the Flags split for the TEST
 * part of the window.
 *
 *   npx tsx scripts/_qa/window-replay.ts --corpus <dir> --from 2023-10-01 --test 2025-10-01 [--out state.json.gz]
 *
 * Never writes to data/ or public/. tsconfig-excluded (_qa).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { readGzRows } from '../corpus-io';
import { normalizeCorpus } from '../lib/corpus-normalize';
import {
  prepare, targetsOf, replayTargets, rehydrateState, valueRecordOf, summarizeState, obsDate, ENGINE_VERSION,
  type BacktestState, type L,
} from '../backtest-core';
import type { AuctionLot } from '../../app/types';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };

function main() {
  const dir = arg('corpus')!;
  const from = arg('from') || '2023-10-01';
  const test = arg('test') || '2025-10-01';
  const t0 = Date.now();
  const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const lots = (readGzRows(path.join(dir, 'lots.json.gz')) as unknown as AuctionLot[])
    .concat(readGzRows(path.join(dir, 'sold-archive.json.gz')) as unknown as AuctionLot[]);
  normalizeCorpus(lots as never);
  const EXC = new Set(['sports-cards', 'graded-cards', 'pokemon']);
  const eng = lots.filter(l => !EXC.has(l.artist) && (l as AuctionLot & { source?: string }).source !== 'sothebys-algolia');
  const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'backtest-state.json.gz'))).toString('utf8')) as BacktestState;
  rehydrateState(st, null, () => {});
  const before = st.calObs.length;
  st.calObs = st.calObs.filter(o => obsDate(o, st.nowMs) < from);
  st.noEst = [];
  console.log(`[window] state rows ${before} → ${st.calObs.length} kept before ${from}`);
  const prep = prepare(eng, console.log, el);
  const tg = targetsOf(prep);
  const inW = (l: L) => l.saleDate >= from;
  const sold = tg.soldTargets.filter(inW), bi = tg.biTargets.filter(inW), ne = tg.noEstTargets.filter(inW);
  console.log(`[window] replaying ${sold.length} sold + ${bi.length} bought-in + ${ne.length} no-estimate targets since ${from} (${el()})`);
  const res = replayTargets(prep, st, sold, bi, console.log, 10000, ne);
  console.log(`[window] scored ${res.scored}, abstained ${res.tried} (${el()})`);
  const testRows = st.calObs.filter(o => o.ev === ENGINE_VERSION && (o.sd || '') >= test);
  const testNe = (st.noEst || []).filter(o => o.sd >= test);
  console.log(`[window] TEST (${test} →) published-value record:`);
  console.log(JSON.stringify(valueRecordOf(testRows, testNe), null, 1));
  // the Flags on the test rows (band estimates): realized/estMid flagged vs not
  const med = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
  const flags: Record<string, unknown> = {};
  for (const m of Array.from(new Set(testRows.map(o => o.m))).concat('ALL')) {
    const rs = testRows.filter(o => (m === 'ALL' || o.m === m) && o.et === 'b' && typeof o.pf === 'number');
    const f = rs.filter(o => o.fl).map(o => o.pf! + 1), u = rs.filter(o => !o.fl).map(o => o.pf! + 1);
    flags[m] = { flagged: f.length ? Math.round(med(f) * 1000) / 1000 : null, nF: f.length, unflagged: u.length ? Math.round(med(u) * 1000) / 1000 : null, nU: u.length };
  }
  console.log('[window] TEST flags (median realized/estMid):', JSON.stringify(flags));
  const out = summarizeState(st, new Date().toISOString().slice(0, 10));
  console.log('[window] bandCoverageOOS:', JSON.stringify(out.calibration.bandCoverageOOS));
  console.log('[window] blend:', JSON.stringify(out.calibration.blend));
  if (arg('out')) fs.writeFileSync(arg('out')!, zlib.gzipSync(Buffer.from(JSON.stringify(st))));
}
main();
