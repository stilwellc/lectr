import * as fs from 'fs';
import { computeDeepSignal } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

const dir = 'public/data/ray';
const lots: AuctionLot[] = [];
for (const f of fs.readdirSync(dir)) {
  if (!/^lots-\d+\.json$/.test(f)) continue;
  const chunk = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  lots.push(...(Array.isArray(chunk) ? chunk : (chunk as any).lots || []));
}
const t = lots.find(l => l.id === 'bonhams-32662-178')!;
console.log('TARGET:', JSON.stringify({ id: t.id, artist: t.artist, title: t.title.slice(0, 80), category: t.category, medium: t.medium?.slice(0, 60), dims: t.dimensions, year: t.year, est: [t.estimateLow, t.estimateHigh] }, null, 1));
const res: any = computeDeepSignal(t, lots);
console.log('SIGNAL:', JSON.stringify(res && { label: res.label, pct: res.pct, basis: res.basis, kind: res.kind, form: res.form, confidence: res.confidence, med: res.med }));
// pool: computeDeepSignal internals — re-derive by calling the pool builder if exported
import * as comps from '../../app/lib/comps';
const anyc = comps as any;
console.log('exported fns:', Object.keys(anyc).filter(k => typeof anyc[k] === 'function').join(', '));
