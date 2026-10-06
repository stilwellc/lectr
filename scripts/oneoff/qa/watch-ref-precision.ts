/**
 * watch-ref-precision.ts — automated comp precision for watch lots by REFERENCE
 * identity (Oct 6 2026, pricing wave 9 measurement).
 *
 * Every watch lot of the five tracked makers sold since --from whose true
 * reference is known — the title reference, else (Phillips) the house field
 * `houseReference` read by watch-ref.readHouseReference, computed whether or
 * not normalize copies it (corpus-normalize.USE_HOUSE_REFERENCE) — is valued
 * point-in-time (backtest-core.compsOne → value.estimateValueEx, the current
 * engine). For each served pool it counts the comps whose true reference is
 * known and DIFFERENT from the target's (a cross-reference comp: wrong by
 * identity), split Phillips vs other-house targets, and the error against the
 * hammer. Run it from two code roots (flag off / on) on the same corpus.
 *
 *   npx tsx scripts/oneoff/qa/watch-ref-precision.ts --code . --corpus data/corpus [--from 2025-10-01] [--out rows.json]
 *
 * Never writes to data/ or public/. tsconfig-excluded (_qa).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : null; };
const R = path.resolve(arg('code') || '.');
const dir = arg('corpus') || 'data/corpus';
const from = arg('from') || '2025-10-01';
/* eslint-disable @typescript-eslint/no-require-imports */
const { readGzRows } = require(path.join(R, 'scripts/corpus-io'));
const { normalizeCorpus, USE_HOUSE_REFERENCE } = require(path.join(R, 'scripts/lib/corpus-normalize'));
const core = require(path.join(R, 'scripts/backtest-core'));
const V = require(path.join(R, 'app/lib/value'));
const wr = require(path.join(R, 'app/lib/watch-ref'));
/* eslint-enable @typescript-eslint/no-require-imports */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const MAKERS = new Set(['rolex', 'patek-philippe', 'cartier', 'audemars-piguet', 'omega']);
const CARD = new Set(['sports-cards', 'graded-cards', 'pokemon']);
const isPh = (l: Row) => /phillips/i.test(String(l.auctionHouse || ''));

const lots: Row[] = [...readGzRows(path.join(dir, 'lots.json.gz')), ...readGzRows(path.join(dir, 'sold-archive.json.gz'))];
normalizeCorpus(lots);
const truth = new Map<string, string>();
for (const l of lots) {
  if (!MAKERS.has(l.artist)) continue;
  const h = l.houseReference ? wr.readHouseReference(l.houseReference, l.artist) : null;
  const t = l.reference && /\d/.test(String(l.reference)) ? String(l.reference).toLowerCase() : null;
  const k = isPh(l) ? (h ?? t) : t;
  if (k) truth.set(l.id, k);
}
const eng = lots.filter(l => !CARD.has(l.artist) && l.source !== 'sothebys-algolia');
const st = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'backtest-state.json.gz'))).toString('utf8'));
const prep = core.prepare(eng, () => {}, () => '');
core.rehydrateState(st, prep, () => {});
const today = arg('asof') || new Date().toISOString().slice(0, 10);
V.setTimeIndex(prep.timeIndexer(today)); V.setHouseBias(prep.houseBiasIndexer(today));
V.setEngineFlags(V.ENGINE_FLAGS_CURRENT); V.setCalibration(core.calibrationFor(st, today, prep.marketBySlug));
const byId = new Map<string, Row>(); for (const l of prep.lots) byId.set(l.id, l);
const targets: Row[] = prep.lots.filter((l: Row) => MAKERS.has(l.artist) && l.status === 'sold' && (l.priceUsd || 0) > 0 && l.saleDate >= from && truth.has(l.id));
const rows: Row[] = [];
for (const lot of targets) {
  const comps = core.compsOne(prep, lot);
  const r = comps ? V.estimateValueEx(lot, comps, prep.tbl) : { value: null };
  const v = r.value; const ids: string[] = v?.poolIds || [];
  const tk = truth.get(lot.id)!;
  let same = 0, diff = 0, unk = 0;
  for (const id of ids) { const k = truth.get(id); if (!k) unk++; else if (k === tk) same++; else diff++; }
  rows.push({ id: lot.id, a: lot.artist, h: lot.auctionHouse, ph: isPh(lot), tk, n: ids.length, same, diff, unk, v: v ? v.expectedHammerUsd : null, hm: lot.hammerUsd || null, r: lot.priceUsd });
}
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
console.log(`[wrp] USE_HOUSE_REFERENCE=${USE_HOUSE_REFERENCE} · ${targets.length} targets since ${from}`);
for (const [lab, f] of [['Phillips', (r: Row) => r.ph], ['other houses', (r: Row) => !r.ph]] as [string, (r: Row) => boolean][]) {
  const rs = rows.filter(f); const val = rs.filter(r => r.v);
  const d = val.reduce((a, r) => a + r.diff, 0), s = val.reduce((a, r) => a + r.same, 0), n = val.reduce((a, r) => a + r.n, 0);
  const e = val.map(r => Math.abs(Math.log((r.hm || r.r / 1.25) / r.v)));
  console.log(`[wrp] ${lab.padEnd(12)} valued ${val.length}/${rs.length} · pool comps ${n} · cross-reference ${pct(d / Math.max(1, d + s))} of reference-known · medErr vs hammer ${pct(Math.exp(med(e)) - 1)}`);
}
if (arg('out')) fs.writeFileSync(arg('out')!, JSON.stringify(rows));
