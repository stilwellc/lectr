import fs from 'fs';
import { cultureAxes } from './culture-lib';
import { normalizeTitle } from '../../app/lib/comps';
const all:any[]=[];
for (const f of fs.readdirSync('public/data/ray')) if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/'+f,'utf8')));
const SLUGS=['movie-tv','music-memorabilia','entertainment-memorabilia'];
const sold=all.filter((l:any)=>SLUGS.includes(l.artist)&&l.status==='sold'&&l.priceUsd&&l.source!=='sothebys-algolia');
const house=(l:any)=>String(l.id).split('-')[0];
const median=(s:number[])=>{const m=Math.floor(s.length/2);return s.length%2===0?(s[m-1]+s[m])/2:s[m];};
const AX=new Map<any,any>(); const buckets=new Map<string,any[]>(); const NTC:Record<string,any[]>={};
for(const l of sold){const ax=cultureAxes(l.title);AX.set(l,ax);
  for(const s of ax.subjects){let b=buckets.get(s);if(!b){b=[];buckets.set(s,b);}b.push(l);}
  const nt=normalizeTitle(l.title);(NTC[nt]??=[]).push(l);}
function band(lot:any){
  const ax=AX.get(lot); const nt=normalizeTitle(lot.title);
  const distinct=nt.split(' ').filter((w:string)=>w.length>=3).length;
  if(distinct>=5){const same=(NTC[nt]||[]).filter(l=>l!==lot);
    if(same.length>=3){const p=same.map(l=>l.priceUsd).sort((a:number,b:number)=>a-b);
      const med=median(p),q1=p[Math.floor(p.length*.25)],q3=p[Math.floor(p.length*.75)];
      if(med>0&&(q3-q1)/med<=2.5)return{med,q1,q3,n:p.length,tier:'E',cls:ax.itemClass};}}
  if(!ax.subjects.length)return null;
  const seen=new Set<any>();const cands:any[]=[];
  for(const s of ax.subjects)for(const l of (buckets.get(s)||[]))if(l!==lot&&!seen.has(l)){seen.add(l);cands.push(l);}
  let pool=cands.filter(l=>AX.get(l).itemClass===ax.itemClass);
  if(pool.length<3)return null;
  if(pool.length>24){const words=new Set(nt.split(' ').filter((w:string)=>w.length>3));
    pool=pool.map(l=>{let s=0;for(const x of normalizeTitle(l.title).split(' '))if(words.has(x))s++;return[s,new Date(l.saleDate).getTime(),l] as const;})
      .sort((a,b)=>(b[0]-a[0])||(b[1]-a[1])).slice(0,24).map(x=>x[2]);}
  const p=pool.map(l=>l.priceUsd).sort((a:number,b:number)=>a-b);
  const med=median(p),q1=p[Math.floor(p.length*.25)],q3=p[Math.floor(p.length*.75)];
  if(!(med>0)||(q3-q1)/med>2.5)return null;
  return{med,q1,q3,n:p.length,tier:'R',cls:ax.itemClass};
}
// tier + class breakdown
type Agg={n:number,errs:number[],w2:number};
const agg:Record<string,Agg>={};
const add=(k:string,e:number)=>{const a=agg[k]??={n:0,errs:[],w2:0};a.n++;a.errs.push(e);if(e<=1&&e>=0)a.w2+= (e<=1?1:0);};
// flag simulation on christies est lots
let flagN=0,flagBeat=0; const flagRatios:number[]=[];
let tierEbyHouse:Record<string,number>={};
for(const l of sold){
  const b=band(l); if(!b)continue;
  const e=Math.abs(l.priceUsd-b.med)/b.med;
  const w2=(l.priceUsd<=b.med*2&&l.priceUsd>=b.med/2)?1:0;
  const kT=`tier-${b.tier}-${house(l)}`; const a=agg[kT]??={n:0,errs:[],w2:0};a.n++;a.errs.push(e);a.w2+=w2;
  const kC=`class-${b.cls}`; const c=agg[kC]??={n:0,errs:[],w2:0};c.n++;c.errs.push(e);c.w2+=w2;
  if(b.tier==='E')tierEbyHouse[house(l)]=(tierEbyHouse[house(l)]||0)+1;
  if(l.estimateLow&&l.estimateHigh){
    const estMid=(l.estimateLow+l.estimateHigh)/2;
    if(b.med/estMid>=1.3){flagN++; if(l.priceUsd>estMid)flagBeat++; flagRatios.push(l.priceUsd/estMid);}
  }
}
console.log('tierE by house:',tierEbyHouse);
for(const [k,a] of Object.entries(agg).sort()){
  a.errs.sort((x,y)=>x-y);
  console.log(k,'n='+a.n,'medAbsErr',a.errs[Math.floor(a.errs.length/2)].toFixed(2),'within2x',(100*a.w2/a.n).toFixed(1)+'%');
}
flagRatios.sort((a,b)=>a-b);
console.log('\nWOULD-BE FLAGS (est lots, med/estMid>=1.3): n='+flagN,'beat estMid:',flagBeat,'('+(100*flagBeat/Math.max(1,flagN)).toFixed(1)+'%) med realized/estMid:',flagRatios.length?flagRatios[Math.floor(flagRatios.length/2)].toFixed(2):'-');
// sanity eyeball of a few bands
let shown=0;
for(const l of sold){ if(shown>=8)break; const b=band(l); if(b&&b.tier==='R'&&house(l)==='goldin'){shown++; console.log('EX',JSON.stringify(l.title).slice(0,90),'$'+l.priceUsd,'-> med',b.med,'n',b.n,'cls',b.cls);}}
