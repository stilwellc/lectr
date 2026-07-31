/** design-gates.ts — A/B the plural-aware form fix + set gate + wood-as-scorer
 *  with a LOCAL replica of comparableTo (form equality, furniture modelKey
 *  equality, 2.2x length gate) so the form function itself can be swapped. */
import * as fs from 'fs';
import { classifyForm, modelKey, parseDims, normalizeTitle, Form } from '../../app/lib/comps';

const all: any[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const design = all.filter(l => l.category === 'design');
const soldByArtist: Record<string, any[]> = {};
for (const l of design) if (l.status === 'sold' && l.priceUsd) (soldByArtist[l.artist] ??= []).push(l);

const stockForm = (l:any):Form => (l.formKey as Form) ?? classifyForm(l);
const mkOf = (l:any) => l.modelKey !== undefined ? l.modelKey : modelKey(l);

/* plural/compound/French-aware rescue for design-other lots */
const FIX_CACHE = new Map<string, Form>();
function fixForm(l: any): Form {
  const base = stockForm(l);
  if (base !== 'design-other') return base;
  const hit = FIX_CACHE.get(l.id); if (hit) return hit;
  const t = ' ' + (l.title||'').toLowerCase() + ' ';
  let f: Form = 'design-other';
  if (/bench|settee|daybed/.test(t)) f = 'seating-bench';
  else if (/stool|ottoman|pouf|tabouret/.test(t)) f = 'seating-stool';
  else if (/sofa|couch|sectional|canap/.test(t)) f = 'seating-sofa';
  else if (/chair|rocker|recliner|fauteuil|chaise/.test(t)) f = 'seating-chair';
  else if (/dining table|conference table|trestle table/.test(t)) f = 'table-dining';
  else if (/coffee table|low table|cocktail table/.test(t)) f = 'table-low';
  else if (/side table|end table|occasional table|nesting table|nightstand/.test(t)) f = 'table-side';
  else if (/table/.test(t)) f = 'table';
  else if (/cabinet|chest|dresser|sideboard|credenza|wardrobe|bookcase|bookshel|shelv|shelf|etagere|étagère|highboard|commode/.test(t)) f = 'case';
  else if (/desk|bureau|vanity/.test(t)) f = 'desk';
  else if (/\bbed\b|headboard|\blit\b/.test(t)) f = 'bed';
  else if (/lamp|sconce|chandelier|lantern|applique|lampadaire/.test(t)) f = 'lighting';
  else if (/mirror|miroir/.test(t)) f = 'mirror';
  FIX_CACHE.set(l.id, f);
  return f;
}

const WOODS = ['walnut','rosewood','teak','oak','maple','cherry','birch','elm','mahogany','ebony','pine','laurel','cedar'];
const WOOD_CACHE = new Map<string, string|null>();
function woodOf(l: any): string | null {
  const hit = WOOD_CACHE.get(l.id); if (hit !== undefined) return hit;
  const tm = ' ' + ((l.title||'')+' '+(l.medium||'')).toLowerCase() + ' ';
  let out: string|null = null;
  for (const w of WOODS) if (new RegExp('\\b'+w+'\\b').test(tm)) { out = w; break; }
  WOOD_CACHE.set(l.id, out);
  return out;
}
const NUMWORD: Record<string, number> = { two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, ten:10, twelve:12 };
function setSize(l: any): number {
  const t = (l.title||'').toLowerCase();
  if (/\bpair of\b/.test(t) || /\bett par\b/.test(t)) return 2;
  const m = t.match(/\bset of (\w+)\b/);
  if (m) return NUMWORD[m[1]] ?? (parseInt(m[1],10) || 1);
  const m2 = t.match(/^(two|three|four|five|six|seven|eight|ten|twelve)\b/);
  if (m2) return NUMWORD[m2[1]];
  return 1;
}
const bucket = (n:number)=> n>=3?3:n;
const median = (s:number[]) => { const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };

interface Opts { formFn: (l:any)=>Form; setGate: boolean; woodScore: boolean; woodGate?: boolean }

function readLot(lot: any, artistSold: any[], o: Opts) {
  const estLow = lot.estLowUsd ?? lot.estimateLow, estHigh = lot.estHighUsd ?? lot.estimateHigh;
  if (!estLow || !estHigh) return null;
  const form = o.formFn(lot);
  if (form === 'unknown') return null;
  const estMid = (estLow + estHigh) / 2;
  const keyA = mkOf(lot);
  const da = parseDims(lot.dimensions);
  const sA = bucket(setSize(lot));
  const wA = woodOf(lot);

  const sold = artistSold.filter(l =>
    l.priceUsd && l.id !== lot.id && l.source !== 'sothebys-algolia'
    && (!o.setGate || bucket(setSize(l)) === sA)
    && (!o.woodGate || !wA || !woodOf(l) || woodOf(l) === wA)
  );

  const nt = normalizeTitle(lot.title);
  let pool: any[] = [];
  let kind: 'edition'|'form' = 'form';
  const distinctive = nt.split(' ').filter(w=>w.length>=3).length;
  if (nt.length >= 8 && distinctive >= 2) {
    const sameTitle = sold.filter(l => normalizeTitle(l.title) === nt && o.formFn(l) === form);
    if (sameTitle.length >= 3) {
      const em = lot.estimateLow && lot.estimateHigh ? (lot.estimateLow+lot.estimateHigh)/2 : 0;
      const m = median(sameTitle.map(l=>l.priceUsd).slice().sort((a:number,b:number)=>a-b));
      if (!em || (m <= em*5 && m >= em/5)) { pool = sameTitle; kind = 'edition'; }
    }
  }
  if (pool.length === 0) {
    pool = sold.filter(c => {
      if (o.formFn(c) !== form) return false;
      if (keyA !== mkOf(c)) return false;          // all design forms are furniture-gated
      if (da) {
        const db = parseDims(c.dimensions);
        if (db) { const la=Math.max(...da), lb=Math.max(...db);
          if (la>0 && lb>0 && (la/lb>2.2 || lb/la>2.2)) return false; }
      }
      return true;
    });
    if (pool.length > 24) {
      const words = new Set(nt.split(' ').filter(w=>w.length>3));
      const overlap = (l:any) => { let n=0; for (const x of normalizeTitle(l.title).split(' ')) if (words.has(x)) n++;
        if (o.woodScore && wA && woodOf(l)===wA) n += 2;
        return n; };
      pool = pool.map(l=>[overlap(l), new Date(l.saleDate).getTime(), l] as const)
        .sort((a,b)=>(b[0]-a[0])||(b[1]-a[1])).slice(0,24).map(s=>s[2]);
    }
  }
  if (pool.length < 3) return null;
  const prices = pool.map(l=>l.priceUsd).sort((a:number,b:number)=>a-b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length*0.25)], q3 = prices[Math.floor(prices.length*0.75)];
  if (med > 0 && (q3-q1)/med > 2.5) return null;
  if (kind==='form' && med>0 && (med > estMid*5 || med < estMid/5)) return null;
  const ratio = med/estMid;
  const label = ratio>=1.3 ? 'Below Market' : ratio<=0.75 ? 'Above Market' : null;
  return { med, kind, estMid, ratio, label, n: pool.length };
}

function run(o: Opts) {
  const rows: any[] = [];
  for (const [artist, lots] of Object.entries(soldByArtist))
    for (const lot of lots) {
      const r = readLot(lot, lots, o);
      if (r) rows.push({ id: lot.id, err: (lot.priceUsd - r.med)/r.med, label: r.label, kind: r.kind, estMid: r.estMid, realized: lot.priceUsd });
    }
  return rows;
}
function report(rows: any[], base: Map<string, any>, name: string) {
  const errs = rows.map(r=>Math.abs(r.err)).sort((a,b)=>a-b);
  const below = rows.filter(r=>r.label==='Below Market');
  const win = below.filter(r=>r.realized > r.estMid);
  console.log(`${name}: reads=${rows.length} medAbsErr=${median(errs).toFixed(3)} below=${below.length} belowWin=${(100*win.length/below.length).toFixed(0)}%`);
  if (base.size) {
    const cur = new Map(rows.map(r=>[r.id, r]));
    const lost=[...base.keys()].filter(i=>!cur.has(i));
    const gained=rows.filter(r=>!base.has(r.id));
    const changed=[...base.keys()].filter(i=>cur.has(i) && Math.abs(base.get(i).err-cur.get(i)!.err)>1e-9);
    const be=changed.map(i=>Math.abs(base.get(i).err)).sort((a,b)=>a-b);
    const ae=changed.map(i=>Math.abs(cur.get(i)!.err)).sort((a,b)=>a-b);
    const lostErr = lost.map(i=>Math.abs(base.get(i).err)).sort((a,b)=>a-b);
    const gainErr = gained.map(r=>Math.abs(r.err)).sort((a,b)=>a-b);
    console.log(`   vs base: lost=${lost.length}${lostErr.length?` (their medAbsErr ${median(lostErr).toFixed(3)})`:''} gained=${gained.length}${gainErr.length?` (medAbsErr ${median(gainErr).toFixed(3)})`:''} changed=${changed.length}${be.length?` before ${median(be).toFixed(3)} after ${median(ae).toFixed(3)}`:''}`);
    if (changed.length) {
      const imp = changed.filter(i=>Math.abs(cur.get(i)!.err) < Math.abs(base.get(i).err)-1e-9).length;
      const wor = changed.filter(i=>Math.abs(cur.get(i)!.err) > Math.abs(base.get(i).err)+1e-9).length;
      console.log(`   improved=${imp} worsened=${wor}`);
    }
  }
  return rows;
}

const baseRows = run({ formFn: stockForm, setGate: false, woodScore: false });
const base = new Map(baseRows.map(r=>[r.id, r]));
report(baseRows, new Map(), 'BASE (local replica)');
report(run({ formFn: fixForm, setGate: false, woodScore: false }), base, 'FORMFIX');
report(run({ formFn: stockForm, setGate: true, woodScore: false }), base, 'SET-GATE');
report(run({ formFn: stockForm, setGate: false, woodScore: true }), base, 'WOOD-SCORER');
report(run({ formFn: fixForm, setGate: true, woodScore: true }), base, 'FORMFIX+SET+WOODSCORE');
report(run({ formFn: fixForm, setGate: true, woodScore: false, woodGate: true }), base, 'FORMFIX+SET+WOODGATE');
