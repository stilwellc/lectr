/** design-dims.ts — how dead is the 2.2x furniture length gate, and how much
 *  coverage would title-embedded dims recover? */
import * as fs from 'fs';
import { parseDims } from '../../app/lib/comps';

const all: any[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const design = all.filter(l => l.category === 'design');

let dimsField = 0, dimsParse = 0, titleDims = 0, eitherCovered = 0;
const titleRe = /(height|width|depth|diam(?:eter)?|\bh\.)\s*[\d½¼¾]/i;
const titleRe2 = /\d+\s*(?:\d+\/\d+)?\s*in\b|\d+(?:\.\d+)?\s*cm\b/i;
for (const l of design) {
  const has = !!l.dimensions;
  if (has) dimsField++;
  const p = parseDims(l.dimensions);
  if (p) dimsParse++;
  const t = l.title || '';
  const th = titleRe.test(t) || titleRe2.test(t);
  if (th) titleDims++;
  if (p || th) eitherCovered++;
}
console.log('design lots:', design.length);
console.log('dimensions field present:', dimsField, (100*dimsField/design.length).toFixed(1)+'%');
console.log('parseDims succeeds:', dimsParse, (100*dimsParse/design.length).toFixed(1)+'%');
console.log('title carries dim text:', titleDims, (100*titleDims/design.length).toFixed(1)+'%');
console.log('either:', eitherCovered, (100*eitherCovered/design.length).toFixed(1)+'%');

// how often does the 2.2x gate actually FIRE today? count candidate rejections
// within same artist+form+model pairs where both sides parse
import { classifyForm, modelKey, Form } from '../../app/lib/comps';
const formOf = (l:any):Form => (l.formKey as Form) ?? classifyForm(l);
const mkOf = (l:any) => l.modelKey !== undefined ? l.modelKey : modelKey(l);
const sold = design.filter(l=>l.status==='sold' && l.priceUsd);
const cells: Record<string, any[]> = {};
for (const l of sold) (cells[`${l.artist}|${formOf(l)}|${mkOf(l)??'∅'}`] ??= []).push(l);
let pairs=0, bothDims=0, fired=0;
for (const lots of Object.values(cells)) {
  const withD = lots.map(l=>({l, d: parseDims(l.dimensions)}));
  for (let i=0;i<withD.length;i++) for (let j=i+1;j<withD.length;j++) {
    pairs++;
    if (withD[i].d && withD[j].d) {
      bothDims++;
      const la=Math.max(...withD[i].d!), lb=Math.max(...withD[j].d!);
      if (la>0&&lb>0&&(la/lb>2.2||lb/la>2.2)) fired++;
    }
  }
}
console.log('\nsame-cell sold pairs:', pairs, '| both parse dims:', bothDims, (100*bothDims/pairs).toFixed(2)+'%', '| 2.2x gate fires:', fired, '('+(100*fired/Math.max(1,bothDims)).toFixed(1)+'% of measurable pairs)');
