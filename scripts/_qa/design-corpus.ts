/** design-corpus.ts — coverage stats for the design vertical:
 *  modelKey coverage, material tokens, set-size tokens, dims coverage. */
import * as fs from 'fs';
import { classifyForm, modelKey, parseDims, Form } from '../../app/lib/comps';

const all: any[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
console.log('corpus:', all.length);

const design = all.filter(l => l.category === 'design');
const sold = design.filter(l => l.status === 'sold' && l.priceUsd);
console.log('design lots:', design.length, 'sold w/ price:', sold.length);

const FURNITURE = new Set(['seating-chair','seating-stool','seating-bench','seating-sofa','table-dining','table-low','table-side','table','case','desk','bed','lighting','mirror','design-other']);

// form distribution + modelKey coverage per form
const byForm: Record<string, { n: number; mk: number; dims: number }> = {};
for (const l of design) {
  const f = (l.formKey as Form) ?? classifyForm(l);
  byForm[f] ??= { n: 0, mk: 0, dims: 0 };
  byForm[f].n++;
  const k = l.modelKey !== undefined ? l.modelKey : modelKey(l);
  if (k) byForm[f].mk++;
  if (parseDims(l.dimensions)) byForm[f].dims++;
}
console.log('\nform | n | modelKey% | dims%');
for (const [f, s] of Object.entries(byForm).sort((a,b)=>b[1].n-a[1].n)) {
  console.log(f, s.n, (100*s.mk/s.n).toFixed(1)+'%', (100*s.dims/s.n).toFixed(1)+'%');
}

// overall modelKey coverage
let mk=0; for (const l of design) { const k = l.modelKey !== undefined ? l.modelKey : modelKey(l); if (k) mk++; }
console.log('\noverall modelKey coverage:', mk, '/', design.length, (100*mk/design.length).toFixed(1)+'%');

// stamped vs computed
const stamped = design.filter(l => l.modelKey !== undefined).length;
console.log('crawl-stamped modelKey field present:', stamped, '/', design.length);

// material tokens in title+medium
const MATS = ['walnut','rosewood','teak','oak','maple','cherry','pine','burl','laurel','ebony','mahogany','birch','ash','elm','bamboo','steel','aluminum','bronze','brass','copper','chrome','fiberglass','plastic','glass','marble','ceramic','leather','fabric','upholster'];
const matCount: Record<string, number> = {};
let anyMat = 0;
for (const l of design) {
  const tm = ((l.title||'')+' '+(l.medium||'')).toLowerCase();
  let hit = false;
  for (const m of MATS) if (tm.includes(m)) { matCount[m]=(matCount[m]||0)+1; hit=true; }
  if (hit) anyMat++;
}
console.log('\ndesign lots with >=1 material token:', anyMat, (100*anyMat/design.length).toFixed(1)+'%');
console.log(Object.entries(matCount).sort((a,b)=>b[1]-a[1]).slice(0,15));

// set-size tokens
const setRe = /\b(pair of|set of (\w+|\d+)|two|three|four|six|eight|twelve)\b/;
let pair=0, setOf=0, single=0;
const setSizes: Record<string, number> = {};
for (const l of design) {
  const t = (l.title||'').toLowerCase();
  if (/\bpair of\b/.test(t)) { pair++; setSizes['pair']=(setSizes['pair']||0)+1; }
  else {
    const m = t.match(/\bset of (\w+)\b/);
    if (m) { setOf++; setSizes[m[1]]=(setSizes[m[1]]||0)+1; }
    else single++;
  }
}
console.log('\npair-of:', pair, 'set-of:', setOf, 'neither:', single);
console.log('set sizes:', Object.entries(setSizes).sort((a,b)=>b[1]-a[1]).slice(0,12));

// top design artists by sold volume
const byArtist: Record<string, number> = {};
for (const l of sold) byArtist[l.artist]=(byArtist[l.artist]||0)+1;
console.log('\ntop design artists (sold):', Object.entries(byArtist).sort((a,b)=>b[1]-a[1]).slice(0,15));
