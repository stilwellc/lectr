/** design-setnorm.ts — A/B set-size normalization in the form path:
 *  candidate prices divided by scale(setSize), anchor value re-multiplied by
 *  scale(anchorSetSize). Variants: none / linear N / sqrt(N) / empirical table. */
import * as fs from 'fs';
import { classifyForm, modelKey, parseDims, normalizeTitle, Form } from '../../app/lib/comps';

const all: any[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const design = all.filter(l => l.category === 'design');
const soldByArtist: Record<string, any[]> = {};
for (const l of design) if (l.status === 'sold' && l.priceUsd) (soldByArtist[l.artist] ??= []).push(l);

const formOf = (l:any):Form => (l.formKey as Form) ?? classifyForm(l);
const mkOf = (l:any) => l.modelKey !== undefined ? l.modelKey : modelKey(l);
const NUMWORD: Record<string, number> = { two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, ten:10, twelve:12 };
const SS_CACHE = new Map<string, number>();
function setSize(l: any): number {
  const h = SS_CACHE.get(l.id); if (h !== undefined) return h;
  const t = (l.title||'').toLowerCase();
  let n = 1;
  if (/\bpair of\b/.test(t) || /\bett par\b/.test(t)) n = 2;
  else { const m = t.match(/\bset of (\w+)\b/);
    if (m) n = NUMWORD[m[1]] ?? (parseInt(m[1],10) || 1);
    else { const m2 = t.match(/^(two|three|four|five|six|seven|eight|ten|twelve)\b/); if (m2) n = NUMWORD[m2[1]]; } }
  SS_CACHE.set(l.id, n);
  return n;
}
const median = (s:number[]) => { const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };

type NormKind = 'none'|'linear'|'sqrt'|'table';
const TABLE: Record<number, number> = {1:1, 2:1.25, 3:1.3, 4:1.3, 5:1.6, 6:2.27, 7:2.5, 8:2.75, 10:3.1, 12:3.4};
function scale(n: number, kind: NormKind): number {
  if (kind==='none' || n<=1) return 1;
  if (kind==='linear') return n;
  if (kind==='sqrt') return Math.sqrt(n);
  return TABLE[n] ?? Math.sqrt(n);
}

function readLot(lot: any, artistSold: any[], norm: NormKind) {
  const estLow = lot.estLowUsd ?? lot.estimateLow, estHigh = lot.estHighUsd ?? lot.estimateHigh;
  if (!estLow || !estHigh) return null;
  const form = formOf(lot);
  if (form === 'unknown') return null;
  const estMid = (estLow + estHigh) / 2;
  const keyA = mkOf(lot);
  const da = parseDims(lot.dimensions);
  const sold = artistSold.filter(l => l.priceUsd && l.id !== lot.id && l.source !== 'sothebys-algolia');
  const nt = normalizeTitle(lot.title);
  let pool: any[] = [];
  let kind: 'edition'|'form' = 'form';
  const distinctive = nt.split(' ').filter(w=>w.length>=3).length;
  if (nt.length >= 8 && distinctive >= 2) {
    const sameTitle = sold.filter(l => normalizeTitle(l.title) === nt && formOf(l) === form);
    if (sameTitle.length >= 3) {
      const em = lot.estimateLow && lot.estimateHigh ? (lot.estimateLow+lot.estimateHigh)/2 : 0;
      const m = median(sameTitle.map(l=>l.priceUsd).slice().sort((a:number,b:number)=>a-b));
      if (!em || (m <= em*5 && m >= em/5)) { pool = sameTitle; kind = 'edition'; }
    }
  }
  let med: number;
  if (pool.length > 0) {
    const prices = pool.map(l=>l.priceUsd).sort((a:number,b:number)=>a-b);
    med = median(prices);
    const q1 = prices[Math.floor(prices.length*0.25)], q3 = prices[Math.floor(prices.length*0.75)];
    if (med > 0 && (q3-q1)/med > 2.5) return null;
  } else {
    pool = sold.filter(c => {
      if (formOf(c) !== form) return false;
      if (keyA !== mkOf(c)) return false;
      if (da) { const db = parseDims(c.dimensions);
        if (db) { const la=Math.max(...da), lb=Math.max(...db);
          if (la>0 && lb>0 && (la/lb>2.2 || lb/la>2.2)) return false; } }
      return true;
    });
    if (pool.length > 24) {
      const words = new Set(nt.split(' ').filter(w=>w.length>3));
      const overlap = (l:any) => { let n=0; for (const x of normalizeTitle(l.title).split(' ')) if (words.has(x)) n++; return n; };
      pool = pool.map(l=>[overlap(l), new Date(l.saleDate).getTime(), l] as const)
        .sort((a,b)=>(b[0]-a[0])||(b[1]-a[1])).slice(0,24).map(s=>s[2]);
    }
    if (pool.length < 3) return null;
    // per-unit normalization
    const unit = pool.map(l => l.priceUsd / scale(setSize(l), norm)).sort((a,b)=>a-b);
    const uMed = median(unit);
    const q1 = unit[Math.floor(unit.length*0.25)], q3 = unit[Math.floor(unit.length*0.75)];
    if (uMed > 0 && (q3-q1)/uMed > 2.5) return null;
    med = uMed * scale(setSize(lot), norm);
    if (med > 0 && (med > estMid*5 || med < estMid/5)) return null;
  }
  if (pool.length < 3) return null;
  const ratio = med/estMid;
  const label = ratio>=1.3 ? 'Below Market' : ratio<=0.75 ? 'Above Market' : null;
  return { med, kind, estMid, ratio, label, n: pool.length,
    setMix: pool.filter((p:any)=>setSize(p)!==setSize(lot)).length/pool.length, aset: setSize(lot) };
}

function run(norm: NormKind) {
  const rows: any[] = [];
  for (const [artist, lots] of Object.entries(soldByArtist))
    for (const lot of lots) {
      const r = readLot(lot, lots, norm);
      if (r) rows.push({ id: lot.id, err: (lot.priceUsd - r.med)/r.med, ...r, realized: lot.priceUsd });
    }
  return rows;
}
function rep(rows:any[], name:string) {
  const errs = rows.map(r=>Math.abs(r.err)).sort((a,b)=>a-b);
  const below = rows.filter(r=>r.label==='Below Market');
  const win = below.filter(r=>r.realized>r.estMid);
  const win25 = below.filter(r=>r.realized>=r.estMid*1.25);
  // affected segments
  const segs: [string,(r:any)=>boolean][] = [
    ['single+setpool', r=>r.kind==='form' && r.aset===1 && r.setMix>0.34],
    ['set-anchor mixed', r=>r.kind==='form' && r.aset>1 && r.setMix>0.34],
  ];
  let segTxt='';
  for (const [n,f] of segs) {
    const s=rows.filter(f); if (!s.length) continue;
    const se=s.map(r=>Math.abs(r.err)).sort((a,b)=>a-b);
    const sgn=s.map(r=>r.err).sort((a,b)=>a-b);
    segTxt += ` | ${n}: n=${s.length} medAbsErr=${median(se).toFixed(3)} signed=${median(sgn).toFixed(3)}`;
  }
  console.log(`${name}: reads=${rows.length} medAbsErr=${median(errs).toFixed(3)} below=${below.length} win=${(100*win.length/below.length).toFixed(0)}% win25=${(100*win25.length/below.length).toFixed(0)}%${segTxt}`);
}
for (const norm of ['none','linear','sqrt','table'] as NormKind[]) rep(run(norm), norm.toUpperCase());
