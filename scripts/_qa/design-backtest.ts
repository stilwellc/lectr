/** design-backtest.ts — hindsight backtest of the value engine on sold design
 *  lots, with pool diagnostics (material mixing, set-size mixing, modelKey,
 *  dims coverage) and A/B-able extra gates.
 *  Replicates compPoolRead from app/lib/comps.ts (not exported) exactly,
 *  with an optional extraGate injected into both edition and form paths. */
import * as fs from 'fs';
import { classifyForm, modelKey, parseDims, normalizeTitle, comparableTo, Form } from '../../app/lib/comps';

const all: any[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}

const design = all.filter(l => l.category === 'design');
const soldByArtist: Record<string, any[]> = {};
for (const l of design) if (l.status === 'sold' && l.priceUsd) (soldByArtist[l.artist] ??= []).push(l);

const formOf = (l: any): Form => (l.formKey as Form) ?? classifyForm(l);
const mkOf = (l: any): string | null => l.modelKey !== undefined ? l.modelKey : modelKey(l);

/* ── diagnostics ── */
const WOODS = ['walnut','rosewood','teak','oak','maple','cherry','birch','elm','mahogany','ebony','pine','laurel','cedar','hickory','sycamore','chestnut','redwood','zebrawood','padauk','bubinga'];
export function woodOf(l: any): string | null {
  const tm = ' ' + ((l.title||'')+' '+(l.medium||'')).toLowerCase() + ' ';
  for (const w of WOODS) if (new RegExp('\\b'+w+'\\b').test(tm)) return w;
  return null;
}
const NUMWORD: Record<string, number> = { two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, twelve:12 };
export function setSize(l: any): number {
  const t = (l.title||'').toLowerCase();
  if (/\bpair of\b/.test(t)) return 2;
  const m = t.match(/\bset of (\w+)\b/);
  if (m) return NUMWORD[m[1]] ?? (parseInt(m[1],10) || 1);
  const m2 = t.match(/^(two|three|four|five|six|seven|eight|ten|twelve)\b/);
  if (m2) return NUMWORD[m2[1]];
  return 1;
}

function median(sorted: number[]): number {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m-1]+sorted[m])/2 : sorted[m];
}

/* ── replicated compPoolRead with injectable extra gate ── */
type Gate = (anchor: any, cand: any) => boolean;
export function readLot(lot: any, artistSold: any[], extraGate?: Gate) {
  const estLow = lot.estLowUsd ?? lot.estimateLow, estHigh = lot.estHighUsd ?? lot.estimateHigh;
  if (!estLow || !estHigh) return null;
  const form = formOf(lot);
  if (form === 'unknown') return null;
  const estMid = (estLow + estHigh) / 2;

  const sold = artistSold.filter(l =>
    l.status === 'sold' && l.priceUsd && l.id !== lot.id && l.source !== 'sothebys-algolia'
    && (!extraGate || extraGate(lot, l))
  );

  const nt = normalizeTitle(lot.title);
  let pool: any[] = [];
  let kind: 'edition'|'form' = 'form';
  const distinctiveTokens = nt.split(' ').filter(w => w.length >= 3).length;
  if (nt.length >= 8 && distinctiveTokens >= 2) {
    const sameTitle = sold.filter(l => normalizeTitle(l.title) === nt && formOf(l) === form);
    if (sameTitle.length >= 3) {
      const em = lot.estimateLow && lot.estimateHigh ? (lot.estimateLow + lot.estimateHigh) / 2 : 0;
      const m = median(sameTitle.map(l => l.priceUsd).slice().sort((a:number,b:number)=>a-b));
      if (!em || (m <= em*5 && m >= em/5)) { pool = sameTitle; kind = 'edition'; }
    }
  }
  if (pool.length === 0) {
    pool = sold.filter(comparableTo(lot));
    if (pool.length > 24) {
      const words = new Set(nt.split(' ').filter(w => w.length > 3));
      const overlap = (l:any) => { let n=0; for (const x of normalizeTitle(l.title).split(' ')) if (words.has(x)) n++; return n; };
      pool = pool.map(l => [overlap(l), new Date(l.saleDate).getTime(), l] as const)
        .sort((a,b)=>(b[0]-a[0])||(b[1]-a[1])).slice(0,24).map(s=>s[2]);
    }
  }
  if (pool.length < 3) return null;
  const prices = pool.map(l=>l.priceUsd).sort((a:number,b:number)=>a-b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length*0.25)], q3 = prices[Math.floor(prices.length*0.75)];
  if (med > 0 && (q3-q1)/med > 2.5) return null;
  if (kind === 'form' && med > 0 && (med > estMid*5 || med < estMid/5)) return null;
  const spread = med > 0 ? (q3-q1)/med : 99;
  const words = new Set(nt.split(' ').filter(w=>w.length>3));
  const titleKin = words.size===0 ? 0 : pool.filter(l => {
    let hits=0; for (const w of normalizeTitle(l.title).split(' ')) if (words.has(w)) hits++;
    return hits>=2;
  }).length;
  const confidence = kind==='edition' ? 'very-high'
    : (pool.length>=12 && spread<=1.0) || (titleKin>=6 && spread<=1.5) ? 'high'
    : pool.length>=6 && spread<=1.8 ? 'medium' : 'low';
  const ratio = med/estMid;
  const label = ratio>=1.3 ? 'Below Market' : ratio<=0.75 ? 'Above Market' : null;
  return { pool, med, kind, form, confidence, estMid, ratio, label };
}

/* ── run backtest ── */
function stats(rows: any[], name: string) {
  const errs = rows.map(r => Math.abs(r.err)).sort((a,b)=>a-b);
  const flags = rows.filter(r => r.label);
  const below = flags.filter(r => r.label==='Below Market');
  // flag "win": Below Market flag where realized actually beat the estimate mid
  const belowWin = below.filter(r => r.realized > r.estMid);
  console.log(`${name}: reads=${rows.length} medAbsErr=${errs.length?median(errs).toFixed(3):'-'} flags=${flags.length} below=${below.length} belowWin=${below.length?(100*belowWin.length/below.length).toFixed(0)+'%':'-'}`);
  return { reads: rows.length, medAbsErr: errs.length?median(errs):null, flags: flags.length };
}

function runAll(extraGate?: Gate) {
  const rows: any[] = [];
  for (const [artist, lots] of Object.entries(soldByArtist)) {
    for (const lot of lots) {
      const r = readLot(lot, lots, extraGate);
      if (!r) continue;
      const err = (lot.priceUsd - r.med) / r.med;
      // pool diagnostics
      const aw = woodOf(lot), as_ = setSize(lot), amk = mkOf(lot);
      const knownW = r.pool.filter((p:any)=>woodOf(p));
      const wMix = aw && knownW.length ? knownW.filter((p:any)=>woodOf(p)!==aw).length/knownW.length : null;
      const setMix = r.pool.filter((p:any)=>setSize(p)!==as_).length / r.pool.length;
      const dimsBoth = parseDims(lot.dimensions) ? r.pool.filter((p:any)=>parseDims(p.dimensions)).length/r.pool.length : 0;
      rows.push({ id: lot.id, artist, form: r.form, kind: r.kind, conf: r.confidence,
        label: r.label, med: r.med, estMid: r.estMid, realized: lot.priceUsd, err,
        n: r.pool.length, amk, aw, aset: as_, wMix, setMix, dimsBoth });
    }
  }
  return rows;
}

const mode = process.argv[2] || 'base';
if (mode === 'base') {
  const rows = runAll();
  fs.writeFileSync('scripts/_qa/design-backtest-base.json', JSON.stringify(rows));
  stats(rows, 'BASE all');
  stats(rows.filter(r=>r.kind==='form'), '  form-kind');
  stats(rows.filter(r=>r.kind==='edition'), '  edition-kind');
  console.log('\n— by anchor modelKey —');
  stats(rows.filter(r=>r.kind==='form' && r.amk), '  form w/ modelKey');
  stats(rows.filter(r=>r.kind==='form' && !r.amk), '  form NULL modelKey');
  console.log('\n— material mixing (form-kind, anchor wood known) —');
  const wk = rows.filter(r=>r.kind==='form' && r.aw && r.wMix!==null);
  stats(wk.filter(r=>r.wMix===0), '  pool wood-pure');
  stats(wk.filter(r=>r.wMix>0 && r.wMix<=0.34), '  pool mixed <=34%');
  stats(wk.filter(r=>r.wMix>0.34), '  pool mixed >34%');
  console.log('\n— set-size mixing —');
  stats(rows.filter(r=>r.setMix===0), '  pool set-pure');
  stats(rows.filter(r=>r.setMix>0 && r.setMix<=0.34), '  set-mixed <=34%');
  stats(rows.filter(r=>r.setMix>0.34), '  set-mixed >34%');
  stats(rows.filter(r=>r.aset>1), '  anchor IS pair/set');
  console.log('\n— dims coverage in pools (anchors that parse) —');
  const dp = rows.filter(r=>parseDims(design.find(d=>d.id===r.id)?.dimensions));
  console.log('  anchors with parseable dims:', dp.length, '/', rows.length);
  const cov = dp.map(r=>r.dimsBoth).sort((a,b)=>a-b);
  if (cov.length) console.log('  median fraction of pool with dims when anchor has dims:', median(cov).toFixed(2));
} else if (mode === 'gates') {
  const base = runAll();
  // GATE A: wood-family equality when BOTH sides carry a wood token
  const gateWood: Gate = (a,c) => { const wa=woodOf(a), wc=woodOf(c); return !wa || !wc || wa===wc; };
  // GATE B: set-size bucket equality when detectable (1 vs 2 vs 3+); default 1
  const bucket = (n:number)=> n>=3?3:n;
  const gateSet: Gate = (a,c) => bucket(setSize(a))===bucket(setSize(c));
  // GATE A+B
  const gateBoth: Gate = (a,c) => gateWood(a,c) && gateSet(a,c);
  console.log('== BASE =='); stats(base,'all');
  const gw = runAll(gateWood);
  console.log('== +WOOD gate =='); stats(gw,'all');
  const gs = runAll(gateSet);
  console.log('== +SET gate =='); stats(gs,'all');
  const gb = runAll(gateBoth);
  console.log('== +WOOD+SET =='); stats(gb,'all');
  fs.writeFileSync('scripts/_qa/design-backtest-gates.json', JSON.stringify({
    base: base.map(r=>({id:r.id,err:r.err,label:r.label,conf:r.conf})),
    wood: gw.map(r=>({id:r.id,err:r.err,label:r.label,conf:r.conf})),
    set: gs.map(r=>({id:r.id,err:r.err,label:r.label,conf:r.conf})),
    both: gb.map(r=>({id:r.id,err:r.err,label:r.label,conf:r.conf})),
  }));
}
