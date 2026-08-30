/**
 * Leave-one-out validation for THE ROSTER TIER (cross-player game-used comps).
 * For every healed NFL sold jersey, predict its price under:
 *   A — status quo (same player + use/team/game axes, ≥3 pool)
 *   B — roster tier (A, then tier-compatible factor-adjusted cross-player fill)
 * Reports coverage + median absolute % error. Pool median approximates the
 * engine's weighted median (policy comparison, not calibration).
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
const { playerOf } = require('../../app/lib/cards');
const { guTeamOf, guUseClass, guGameKey } = require('../lib/corpus-normalize');

type Row = { id: string; title: string; realizedUsd?: number; priceUsd?: number; status?: string; saleDate?: string; sportYear?: number | null };
const buf = zlib.gunzipSync(fs.readFileSync('data/corpus/segments/nflauction.ndjson.gz'));
const rows: Row[] = buf.toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const sold = rows.filter(r => r.status === 'sold' && ((r.realizedUsd ?? r.priceUsd) || 0) > 0);
const px = (r: Row) => (r.realizedUsd ?? r.priceUsd)!;

const P = new Map<string, string | null>(), T = new Map<string, string | null>(), U = new Map<string, string>(), G = new Map<string, string | null>();
for (const r of sold) {
  P.set(r.id, playerOf(r.title || '', 'game-used').playerSlug);
  T.set(r.id, guTeamOf(r.title || ''));
  U.set(r.id, guUseClass(r.title || ''));
  G.set(r.id, guGameKey(r.title || '', r.sportYear ?? null));
}
const med = (a: number[]) => { const x = [...a].sort((q, w) => q - w); return x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2; };

function factors(excludeId: string): { f: Map<string, number>; commodity: number | null } {
  const byP = new Map<string, number[]>();
  for (const r of sold) { if (r.id === excludeId) continue; const p = P.get(r.id); if (!p) continue; const arr = byP.get(p) || []; arr.push(px(r)); byP.set(p, arr); }
  const pm = new Map<string, number>(); const meds: number[] = [];
  byP.forEach((v, p) => { if (v.length >= 2) { const m = med(v); pm.set(p, m); meds.push(m); } });
  const commodity = meds.length >= 8 ? med(meds) : null;
  const f = new Map<string, number>();
  if (commodity) pm.forEach((m, p) => f.set(p, m / commodity));
  return { f, commodity };
}

let covA = 0, covB = 0; const errA: number[] = [], errB: number[] = [];
const parsed = sold.filter(r => P.get(r.id));
for (const s of parsed) {
  const pid = P.get(s.id)!, use = U.get(s.id)!, team = T.get(s.id), game = G.get(s.id);
  const axes = (r: Row) => U.get(r.id) === use && (!team || T.get(r.id) === team) && G.get(r.id) === game;
  const same = sold.filter(r => r.id !== s.id && P.get(r.id) === pid && axes(r));
  if (same.length >= 3) { covA++; covB++; const p = med(same.map(px)); const e = Math.abs(p - px(s)) / px(s); errA.push(e); errB.push(e); continue; }
  // B: tier fill
  if (!game && !team) continue;
  const { f } = factors(s.id);
  const subjF = f.get(pid) ?? null;
  const cross: number[] = same.map(px);
  for (const r of sold) {
    const cp = P.get(r.id);
    if (r.id === s.id || !cp || cp === pid) continue;
    if (U.get(r.id) !== use) continue;
    if (game ? G.get(r.id) !== game : T.get(r.id) !== team) continue;
    const cf = f.get(cp) ?? null;
    if (subjF != null) { if (cf == null || Math.abs(Math.log2(cf / subjF)) > 1) continue; cross.push(px(r) * (subjF / cf)); }
    else { if (cf != null && cf > 2) continue; cross.push(px(r)); }
  }
  if (cross.length >= 3) { covB++; errB.push(Math.abs(med(cross) - px(s)) / px(s)); }
}
console.log(`sold rows ${sold.length} · parsed players ${parsed.length} (${Math.round(parsed.length / sold.length * 100)}%)`);
console.log(`A same-player-only : coverage ${covA}/${parsed.length} (${(covA / parsed.length * 100).toFixed(1)}%) · med |err| ${errA.length ? (med(errA) * 100).toFixed(1) + '%' : 'n/a'}`);
console.log(`B roster tier      : coverage ${covB}/${parsed.length} (${(covB / parsed.length * 100).toFixed(1)}%) · med |err| ${errB.length ? (med(errB) * 100).toFixed(1) + '%' : 'n/a'}`);
