import fs from 'fs'; import path from 'path'; import zlib from 'zlib';
import { stampSubCats } from '../lib/corpus-normalize';
import { ARTIST_MARKET } from '../../app/constants';
const CORPUS = path.join(process.cwd(), 'data', 'corpus');
function load(file: string): any[] {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  const out: any[] = []; let s = 0;
  while (s < buf.length) { let e = buf.indexOf(10, s); if (e === -1) e = buf.length;
    if (e > s + 1) { try { out.push(JSON.parse(buf.toString('utf8', s, e))); } catch {} } s = e + 1; }
  return out;
}
const lots = [...load(path.join(CORPUS, 'lots.json.gz')), ...load(path.join(CORPUS, 'sold-archive.json.gz'))];
console.log('loaded', lots.length);
const t0 = Date.now();
const r1 = stampSubCats(lots as any);
console.log('pass1', r1, `${Date.now() - t0}ms`);
const r2 = stampSubCats(lots as any);
console.log('pass2 (idempotency)', r2);
// coverage per vertical
const agg = new Map<string, { n: number; sub: number; drill: number; subs: Map<string, number>; drills: Map<string, number> }>();
for (const l of lots) {
  const v = ARTIST_MARKET[l.artist] || '?';
  let a = agg.get(v); if (!a) { a = { n: 0, sub: 0, drill: 0, subs: new Map(), drills: new Map() }; agg.set(v, a); }
  a.n++;
  if (l.subCat) { a.sub++; a.subs.set(l.subCat, (a.subs.get(l.subCat) || 0) + 1); }
  if (l.drill) { a.drill++; a.drills.set(l.drill, (a.drills.get(l.drill) || 0) + 1); }
}
const top = (m: Map<string, number>, n: number) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join(' ');
Array.from(agg.entries()).sort((a, b) => b[1].n - a[1].n).forEach(([v, a]) => {
  console.log(`${v.padEnd(8)} n=${a.n} subCat ${(100 * a.sub / a.n).toFixed(0)}% drill ${(100 * a.drill / a.n).toFixed(0)}%`);
  console.log(`   subs: ${top(a.subs, 8)}`);
  console.log(`   drills: ${top(a.drills, 10)}`);
});
const flown = lots.filter(l => l.flown).length;
console.log('flown space lots:', flown);
