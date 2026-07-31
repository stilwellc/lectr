import fs from 'fs';
import { cultureAxes } from './culture-lib';
import { normalizeTitle } from '../../app/lib/comps';
const all:any[]=[];
for (const f of fs.readdirSync('public/data/ray')) if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/'+f,'utf8')));
const SLUGS=['movie-tv','music-memorabilia','entertainment-memorabilia'];
const sold=all.filter((l:any)=>SLUGS.includes(l.artist)&&l.status==='sold'&&l.priceUsd&&l.source!=='sothebys-algolia');
const house=(l:any)=>String(l.id).split('-')[0];
const median=(s:number[])=>{const m=Math.floor(s.length/2);return s.length%2===0?(s[m-1]+s[m])/2:s[m];};

// precompute axes + subject buckets
const AX=new Map<any,any>(); const buckets=new Map<string,any[]>();
const NTC:Record<string,any[]>={};
for(const l of sold){
  const ax=cultureAxes(l.title); AX.set(l,ax);
  for(const s of ax.subjects){let b=buckets.get(s); if(!b){b=[];buckets.set(s,b);} b.push(l);}
  const nt=normalizeTitle(l.title); (NTC[nt]??=[]).push(l);
}

type BandRes={med:number,q1:number,q3:number,lo:number,hi:number,n:number,tier:string};
function band(lot:any, variant:'strict'|'loose'):BandRes|null{
  const ax=AX.get(lot);
  const nt=normalizeTitle(lot.title);
  // Tier E: edition-like — same long distinctive title >=3 others
  const distinct=nt.split(' ').filter((w:string)=>w.length>=3).length;
  if(distinct>=5){
    const same=(NTC[nt]||[]).filter(l=>l!==lot);
    if(same.length>=3){
      const p=same.map(l=>l.priceUsd).sort((a:number,b:number)=>a-b);
      const med=median(p),q1=p[Math.floor(p.length*.25)],q3=p[Math.floor(p.length*.75)];
      if(med>0&&(q3-q1)/med<=2.5) return{med,q1,q3,lo:p[0],hi:p[p.length-1],n:p.length,tier:'E'};
    }
  }
  if(!ax.subjects.length) return null;
  const seen=new Set<any>(); const cands:any[]=[];
  for(const s of ax.subjects) for(const l of (buckets.get(s)||[])) if(l!==lot&&!seen.has(l)){seen.add(l);cands.push(l);}
  let pool=variant==='strict'? cands.filter(l=>AX.get(l).itemClass===ax.itemClass) : cands;
  if(pool.length<3) return null;
  if(pool.length>24){
    const words=new Set(nt.split(' ').filter((w:string)=>w.length>3));
    pool=pool.map(l=>{
      let s=0; for(const x of normalizeTitle(l.title).split(' ')) if(words.has(x))s++;
      if(AX.get(l).itemClass===ax.itemClass)s+=2;
      return [s,new Date(l.saleDate).getTime(),l] as const;
    }).sort((a,b)=>(b[0]-a[0])||(b[1]-a[1])).slice(0,24).map(x=>x[2]);
  }
  const p=pool.map(l=>l.priceUsd).sort((a:number,b:number)=>a-b);
  const med=median(p),q1=p[Math.floor(p.length*.25)],q3=p[Math.floor(p.length*.75)];
  if(!(med>0)||(q3-q1)/med>2.5) return null;
  return{med,q1,q3,lo:p[0],hi:p[p.length-1],n:p.length,tier:'R'};
}

for(const variant of ['strict','loose'] as const){
  console.log('\n════ VARIANT',variant);
  for(const h of ['goldin','christies','ALL']){
    const rows=h==='ALL'?sold:sold.filter(l=>house(l)===h);
    let cov=0,tierE=0; const errs:number[]=[]; const inIqr:number[]=[]; const within2x:number[]=[];
    const estErrs:number[]=[]; const estBase:number[]=[];
    for(const l of rows){
      const b=band(l,variant);
      if(!b) continue;
      cov++; if(b.tier==='E')tierE++;
      const e=Math.abs(l.priceUsd-b.med)/b.med; errs.push(e);
      inIqr.push(l.priceUsd>=b.q1&&l.priceUsd<=b.q3?1:0);
      within2x.push(l.priceUsd<=b.med*2&&l.priceUsd>=b.med/2?1:0);
      if(l.estimateLow&&l.estimateHigh){
        const estMid=(l.estimateLow+l.estimateHigh)/2;
        estErrs.push(Math.abs(l.priceUsd-b.med)/b.med);
        estBase.push(Math.abs(l.priceUsd-estMid)/estMid);
      }
    }
    errs.sort((a,b)=>a-b);
    const pct=(a:number[])=>a.length?(100*a.reduce((x,y)=>x+y,0)/a.length).toFixed(1)+'%':'-';
    console.log(h,'anchors',rows.length,'| band coverage',cov,'('+(100*cov/rows.length).toFixed(1)+'%) tierE',tierE);
    if(errs.length)console.log('   medAbsErr',errs[Math.floor(errs.length/2)].toFixed(2),'| in-IQR',pct(inIqr),'| within2x-of-med',pct(within2x));
    if(estErrs.length){estErrs.sort((a,b)=>a-b);estBase.sort((a,b)=>a-b);
      console.log('   est-carrying subset n='+estErrs.length,' band medAbsErr',estErrs[Math.floor(estErrs.length/2)].toFixed(2),'vs ESTIMATE medAbsErr',estBase[Math.floor(estBase.length/2)].toFixed(2));}
  }
}
