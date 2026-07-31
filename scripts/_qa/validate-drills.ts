import fs from 'fs'; import path from 'path'; import zlib from 'zlib';
import { stampSubCats } from '../lib/corpus-normalize';
import { buildDrillRows } from '../sub-markets';
const CORPUS = path.join(process.cwd(), 'data', 'corpus');
function load(file: string): any[] {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  const out: any[] = []; let s = 0;
  while (s < buf.length) { let e = buf.indexOf(10, s); if (e === -1) e = buf.length;
    if (e > s + 1) { try { out.push(JSON.parse(buf.toString('utf8', s, e))); } catch {} } s = e + 1; }
  return out;
}
const lots = [...load(path.join(CORPUS, 'lots.json.gz')), ...load(path.join(CORPUS, 'sold-archive.json.gz'))];
stampSubCats(lots as any);
const t0 = Date.now();
const drills = buildDrillRows(lots as any);
console.log(`built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const [v, rows] of Object.entries(drills)) {
  console.log(`\n=== ${v} · ${rows.length} rows ===`);
  for (const r of rows.slice(0, 14)) {
    const read = r.readType === 'index'
      ? `INDEX ${r.index!.horizon} ${r.index!.changePct > 0 ? '+' : ''}${r.index!.changePct.toFixed(0)}% [${r.index!.ciLoPct.toFixed(0)},${r.index!.ciHiPct.toFixed(0)}]`
      : r.readType === 'demand' ? `DEMAND ${r.demandNow! > 0 ? '+' : ''}${r.demandNow!.toFixed(0)}%`
      : 'descriptive';
    console.log(`  ${r.slug.padEnd(30)} ${String(r.lots).padStart(7)} lots · ${read} · typ $${r.typicalUsd ?? '—'} · ST ${r.sellThroughPct ?? '—'}%`);
  }
}
