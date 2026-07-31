/** design-price-splits.ts — raw price separation by material and set size
 *  WITHIN same artist+form(+modelKey) cells, to see how much signal the
 *  engine currently averages away. */
import * as fs from 'fs';
import { classifyForm, modelKey, Form } from '../../app/lib/comps';

const all: any[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const sold = all.filter(l => l.category === 'design' && l.status === 'sold' && l.priceUsd);

const WOODS = ['walnut','rosewood','teak','oak','maple','cherry','birch','elm','mahogany','ebony','pine','laurel','cedar'];
const woodOf = (l: any): string | null => {
  const tm = ' ' + ((l.title||'')+' '+(l.medium||'')).toLowerCase() + ' ';
  for (const w of WOODS) if (new RegExp('\\b'+w+'\\b').test(tm)) return w;
  return null;
};
const NUMWORD: Record<string, number> = { two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, ten:10, twelve:12 };
const setSize = (l: any): number => {
  const t = (l.title||'').toLowerCase();
  if (/\bpair of\b/.test(t)) return 2;
  const m = t.match(/\bset of (\w+)\b/);
  if (m) return NUMWORD[m[1]] ?? (parseInt(m[1],10) || 1);
  const m2 = t.match(/^(two|three|four|five|six|seven|eight|ten|twelve)\b/);
  if (m2) return NUMWORD[m2[1]];
  return 1;
};
const med = (xs: number[]) => { const s=[...xs].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
const formOf = (l:any):Form => (l.formKey as Form) ?? classifyForm(l);
const mkOf = (l:any) => l.modelKey !== undefined ? l.modelKey : modelKey(l);

/* 1 · wood price splits within artist+form+modelKey cells */
console.log('=== WOOD price splits (artist|form|model cells with >=4 of each wood) ===');
const cells: Record<string, any[]> = {};
for (const l of sold) {
  const k = `${l.artist}|${formOf(l)}|${mkOf(l) ?? '∅'}`;
  (cells[k] ??= []).push(l);
}
const ratios: number[] = [];
for (const [k, lots] of Object.entries(cells)) {
  const byWood: Record<string, number[]> = {};
  for (const l of lots) { const w = woodOf(l); if (w && setSize(l)===1) (byWood[w] ??= []).push(l.priceUsd); }
  const woods = Object.entries(byWood).filter(([,v])=>v.length>=4);
  if (woods.length >= 2) {
    const meds = woods.map(([w,v])=>[w, med(v), v.length] as const).sort((a,b)=>b[1]-a[1]);
    const ratio = meds[0][1]/meds[meds.length-1][1];
    ratios.push(ratio);
    if (ratio >= 1.5) console.log(k, meds.map(m=>`${m[0]}:$${Math.round(m[1])}(n${m[2]})`).join(' '), 'ratio', ratio.toFixed(2));
  }
}
console.log('cells with >=2 woods measurable:', ratios.length, '| median top/bottom wood ratio:', med(ratios).toFixed(2), '| cells >=1.5x:', ratios.filter(r=>r>=1.5).length, '| >=2x:', ratios.filter(r=>r>=2).length);

/* 2 · Nakashima headline: walnut vs rosewood same form, singles only */
console.log('\n=== Nakashima walnut vs rosewood by form (singles) ===');
const nak = sold.filter(l=>l.artist==='george-nakashima' && setSize(l)===1);
const forms = [...new Set(nak.map(formOf))];
for (const f of forms) {
  const w = nak.filter(l=>formOf(l)===f && woodOf(l)==='walnut').map(l=>l.priceUsd);
  const r = nak.filter(l=>formOf(l)===f && woodOf(l)==='rosewood').map(l=>l.priceUsd);
  if (w.length>=4 && r.length>=4)
    console.log(f, 'walnut n', w.length, '$'+Math.round(med(w)), '| rosewood n', r.length, '$'+Math.round(med(r)), '| ratio', (med(r)/med(w)).toFixed(2));
}

/* 3 · pair/set vs single price ratio within artist+form+modelKey cells */
console.log('\n=== SET-SIZE price splits (cells with >=4 singles and >=4 of a set size) ===');
const setRatios: {size:number, ratio:number, perUnit:number}[] = [];
for (const [k, lots] of Object.entries(cells)) {
  const singles = lots.filter(l=>setSize(l)===1).map(l=>l.priceUsd);
  if (singles.length < 4) continue;
  const bySize: Record<number, number[]> = {};
  for (const l of lots) { const s=setSize(l); if (s>1) (bySize[s] ??= []).push(l.priceUsd); }
  for (const [s, v] of Object.entries(bySize)) {
    if (v.length >= 4) {
      const ratio = med(v)/med(singles);
      setRatios.push({ size:+s, ratio, perUnit: ratio/+s });
      if (v.length>=6) console.log(k, `size ${s}: n${v.length} $${Math.round(med(v))} vs single $${Math.round(med(singles))} ratio ${ratio.toFixed(2)} perUnit ${(ratio/+s).toFixed(2)}`);
    }
  }
}
for (const s of [2,4,6,8]) {
  const rs = setRatios.filter(x=>x.size===s);
  if (rs.length) console.log(`size ${s}: cells ${rs.length} | median set/single price ratio ${med(rs.map(x=>x.ratio)).toFixed(2)} | median per-unit ${med(rs.map(x=>x.perUnit)).toFixed(2)}`);
}
