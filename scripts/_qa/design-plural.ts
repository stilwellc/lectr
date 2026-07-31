/** design-plural.ts — quantify the plural-noun classification miss:
 *  how many design lots have a PLURAL furniture noun in the title and what
 *  form they land in. */
import * as fs from 'fs';
import { classifyForm, modelKey, Form } from '../../app/lib/comps';

const all: any[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const design = all.filter(l => l.category === 'design');
const formOf = (l:any):Form => (l.formKey as Form) ?? classifyForm(l);

const PLURALS: [RegExp, string][] = [
  [/\bchairs\b/, 'chairs'], [/\bstools\b/, 'stools'], [/\bbenches\b/, 'benches'],
  [/\bsofas\b/, 'sofas'], [/\btables\b/, 'tables'], [/\bcabinets\b/, 'cabinets'],
  [/\bdesks\b/, 'desks'], [/\blamps\b/, 'lamps'], [/\bmirrors\b/, 'mirrors'],
  [/\bottomans\b/, 'ottomans'], [/\brockers\b/, 'rockers'], [/\bdaybeds\b/, 'daybeds'],
  [/\bsettees\b/, 'settees'], [/\bnightstands\b/, 'nightstands'], [/\bsconces\b/, 'sconces'],
  [/\bchests\b/, 'chests'], [/\bdressers\b/, 'dressers'], [/\bcredenzas\b/, 'credenzas'],
];
let totalPlural = 0;
const landing: Record<string, Record<string, number>> = {};
for (const l of design) {
  const t = (l.title||'').toLowerCase();
  for (const [re, name] of PLURALS) {
    if (re.test(t)) {
      totalPlural++;
      const f = formOf(l);
      (landing[name] ??= {})[f] = (landing[name][f]||0)+1;
      break;
    }
  }
}
console.log('design lots with a plural furniture noun in title:', totalPlural, '/', design.length);
for (const [noun, forms] of Object.entries(landing).sort((a,b)=>Object.values(b[1]).reduce((x,y)=>x+y,0)-Object.values(a[1]).reduce((x,y)=>x+y,0))) {
  console.log(noun, JSON.stringify(forms));
}

// what is design-other actually made of?
console.log('\n=== design-other composition (sold, by dominant plural noun) ===');
const dOther = design.filter(l=>formOf(l)==='design-other');
let pluralInOther = 0;
for (const l of dOther) {
  const t = (l.title||'').toLowerCase();
  if (PLURALS.some(([re])=>re.test(t))) pluralInOther++;
}
console.log('design-other:', dOther.length, '| with plural furniture noun:', pluralInOther, (100*pluralInOther/dOther.length).toFixed(1)+'%');
// sample of remaining design-other titles
const rest = dOther.filter(l=>!PLURALS.some(([re])=>re.test((l.title||'').toLowerCase())));
const seen = new Set<string>();
let shown=0;
for (const l of rest) { const t=l.title?.slice(0,70); if (t && !seen.has(t)) { seen.add(t); if (shown++<25) console.log('  ·', t); } }
