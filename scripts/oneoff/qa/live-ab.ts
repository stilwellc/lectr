/**
 * live-ab.ts — the LIVE-BOOK forward test (Oct 3 2026 engine pass). Re-serves
 * a past snapshot's upcoming book through the engine in `--code` (this
 * worktree, or an exported copy of an older commit) with the clock frozen at
 * the snapshot day, then joins every lot that has SINCE SOLD in the outcome
 * corpus (`--outcomes`, default data/corpus). The calibration is what the
 * production nightly would have loaded: the snapshot's own backtest state
 * refit before the snapshot day, legacy keys only (--full-cal adds the
 * published-value layer). Writes one row per valued-or-abstained lot.
 *
 *   npx tsx scripts/oneoff/qa/live-ab.ts --code <dir> --corpus <snapdir> --asof 2026-09-14 --out rows.json [--candidate]
 *
 * Never writes to data/ or public/ (evalOnly). tsconfig-excluded (_qa).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };

type Row = Record<string, unknown>;
async function main() {
  const code = path.resolve(arg('code') || process.cwd());
  const dir = arg('corpus')!;
  const asOf = arg('asof')!;
  const outcomesDir = arg('outcomes') || path.join(process.cwd(), 'data/corpus');
  const { readGzRows } = require(path.join(code, 'scripts/corpus-io'));
  const core = require(path.join(code, 'scripts/backtest-core'));
  const value = require(path.join(code, 'app/lib/value'));
  const { lotAllInFactor } = require(path.join(code, 'app/lib/premiums'));
  if (process.argv.includes('--candidate') && value.setEngineFlags) value.setEngineFlags(value.ENGINE_FLAGS_CANDIDATE);
  // outcomes first (only the id → sold map is kept)
  const outcome = new Map<string, { r: number; sd: string; h: number | null }>();
  for (const f of ['lots.json.gz', 'sold-archive.json.gz']) {
    for (const l of readGzRows(path.join(outcomesDir, f)) as Row[]) {
      if (l.status === 'sold' && (l.realizedUsd as number) > 0 && l.saleDate && (l.saleDate as string).slice(0, 10) >= asOf) {
        outcome.set(String(l.id), { r: l.realizedUsd as number, sd: (l.saleDate as string).slice(0, 10), h: (l.hammerUsd as number) || null });
      }
    }
  }
  console.log(`[live-ab] ${outcome.size} sold outcomes on/after ${asOf}`);
  const lots = (readGzRows(path.join(dir, 'lots.json.gz')) as Row[]).concat(readGzRows(path.join(dir, 'sold-archive.json.gz')) as Row[]);
  const want = new Set<string>();
  const book = process.argv.includes('--book'); // the whole upcoming book (outcome may be absent)
  for (const l of lots) if (l.status === 'upcoming' && (book || outcome.has(String(l.id)))) want.add(String(l.id));
  console.log(`[live-ab] corpus ${lots.length} · ${want.size} snapshot-upcoming lots have since sold`);
  const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'backtest-state.json.gz'))).toString('utf8'));
  // the house habit / adjusted beat on legacy rows (engines that have it)
  let hbIdx: unknown = null;
  try {
    const { makeHouseBiasIndexer } = require(path.join(code, 'app/lib/indices'));
    const { ARTISTS } = require(path.join(code, 'app/constants'));
    const mbs: Record<string, string> = {};
    for (const a of ARTISTS as { slug: string; market: string }[]) mbs[a.slug] = a.market;
    const EXC = new Set(['sports-cards', 'graded-cards', 'pokemon']);
    if (makeHouseBiasIndexer) hbIdx = makeHouseBiasIndexer(lots.filter(l => !EXC.has(l.artist as string) && l.source !== 'sothebys-algolia'), mbs);
  } catch { hbIdx = null; }
  if (core.rehydrateState) core.rehydrateState(st, null, () => {}, hbIdx);
  const rows = st.calObs.filter((o: { sd?: string }) => (o.sd || '') < asOf);
  const c = core.calibrationOf(rows, (st.noEst || []).filter((o: { sd: string }) => o.sd < asOf), asOf);
  const full = process.argv.includes('--full-cal');
  const calibration = {
    edges: c.edges, beatRate: c.beatRate, band: c.band, bandByMarket: c.bandByMarket, mdape: c.mdape, n: c.n, noEstGate: c.noEstGate,
    ...(full ? { blend: c.blend, bias: c.bias, valueBand: c.valueBand, valueBandByMarket: c.valueBandByMarket } : {}),
  };
  const { runMarketBuild } = require(path.join(code, 'scripts/build-market'));
  const out = await runMarketBuild({ lots, nowMs: Date.parse(`${asOf}T13:00:00Z`), evalOnly: true, calibration, onlyIds: want });
  const res: Row[] = [];
  for (const l of out as Row[]) {
    const id = String(l.id);
    if (!want.has(id)) continue;
    const v = (l.value || null) as Row | null;
    if (!v && !l.abstain) continue;
    const o = outcome.get(id) || { r: null, sd: null, h: null };
    const lo = (l.estLowUsd as number) || 0, hi = (l.estHighUsd as number) || 0;
    res.push({
      id, artist: l.artist, h: l.auctionHouse, r: o.r, rsd: o.sd, hammer: o.h,
      mid: lo && hi ? (lo + hi) / 2 : (lo || hi) || null, eh: hi || lo || null, et: lo && hi ? 'b' : (lo || hi) ? 'p' : null,
      bid: l.currentBid ?? null,
      pfm: lo || hi ? lotAllInFactor(l, lo && hi ? (lo + hi) / 2 : (lo || hi)) : null,
      pfv: v?.compValueUsd ? lotAllInFactor(l, (v.compValueUsd as number) / 1.25) : null,
      cv: v?.compValueUsd ?? null, vlo: v?.low ?? null, vhi: v?.high ?? null, conf: v?.confidence ?? null,
      basis: v?.basis ?? null, ct: v?.cardTier ?? null,
      sig: (v?.signal as { label?: string; beatRatePct?: number } | null)?.label ?? null,
      br: (v?.signal as { beatRatePct?: number } | null)?.beatRatePct ?? null,
      cr: v?.compRatio ?? null, fr: v?.flagRatio ?? null, hf: v?.houseFactor ?? null,
      xh: v?.expectedHammerUsd ?? null, blo: v?.bandLowUsd ?? null, bhi: v?.bandHighUsd ?? null, mb: v?.maxBidUsd ?? null,
      ev: v?.engineVersion ?? null, vab: v?.abstain ?? null,
      abst: l.abstain ?? null,
    });
  }
  fs.writeFileSync(arg('out')!, JSON.stringify(res));
  console.log(`[live-ab] wrote ${res.length} rows → ${arg('out')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
