import fs from 'fs';
import { cultureAxes } from './culture-lib';
import { normalizeTitle } from '../../app/lib/comps';
const all:any[]=[];
for (const f of fs.readdirSync('public/data/ray')) if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/'+f,'utf8')));
const SLUGS=['movie-tv','music-memorabilia','entertainment-memorabilia'];
const sold=all.filter((l:any)=>SLUGS.includes(l.artist)&&l.status==='sold'&&l.priceUsd&&l.source!=='sothebys-algolia');
const house=(l:any)=>String(l.id).split('-')[0];
const median=(s:number[])=>{const m=Math.floor(s.length/2);return s.length%2===0?(s[m-1]+s[m])/2:s[m];};
const AX=new Map<any,any>();const buckets=new Map<string,any[]>();const NTC:Record<string,any[]>={};
for(const l of sold){const ax=cultureAxes(l.title);AX.set(l,ax);
  for(const s of ax.subjects){let b=buckets.get(s);if(!b){b=[];buckets.set(s,b);}b.push(l);}
  const nt=normalizeTitle(l.title);(NTC[nt]??=[]).push(l);}
function band(lot:any,priorOnly:boolean){
  const t0=new Date(lot.saleDate).getTime();
  const ok=(l:any)=>l!==lot&&(!priorOnly||new Date(l.saleDate).getTime()<t0);
  const ax=AX.get(lot);const nt=normalizeTitle(lot.title);
  const distinct=nt.split(' ').filter((w:string)=>w.length>=3).length;
  if(house(lot)==='goldin'&&distinct>=5){const same=(NTC[nt]||[]).filter(ok);
    if(same.length>=3){const p=same.map(l=>l.priceUsd).sort((a:number,b:number)=>a-b);
      const med=median(p),q1=p[Math.floor(p.length*.25)],q3=p[Math.floor(p.length*.75)];
      if(med>0&&(q3-q1)/med<=2.5)return{med,tier:'E'};}}
  if(!ax.subjects.length)return null;
  const seen=new Set<any>();const cands:any[]=[];
  for(const s of ax.subjects)for(const l of (buckets.get(s)||[]))if(ok(l)&&!seen.has(l)){seen.add(l);cands.push(l);}
  let pool=cands.filter(l=>AX.get(l).itemClass===ax.itemClass);
  if(pool.length<3)return null;
  if(pool.length>24){const words=new Set(nt.split(' ').filter((w:string)=>w.length>3));
    pool=pool.map(l=>{let s=0;for(const x of normalizeTitle(l.title).split(' '))if(words.has(x))s++;return[s,new Date(l.saleDate).getTime(),l] as const;})
      .sort((a,b)=>(b[0]-a[0])||(b[1]-a[1])).slice(0,24).map(x=>x[2]);}
  const p=pool.map(l=>l.priceUsd).sort((a:number,b:number)=>a-b);
  const med=median(p),q1=p[Math.floor(p.length*.25)],q3=p[Math.floor(p.length*.75)];
  if(!(med>0)||(q3-q1)/med>2.5)return null;
  return{med,tier:'R'};
}
for(const prior of [false,true]){
  for(const h of ['goldin','christies']){
    const rows=sold.filter(l=>house(l)===h);
    let cov=0;const errs:number[]=[];let w2=0;
    for(const l of rows){const b=band(l,prior);if(!b)continue;cov++;
      const e=Math.abs(l.priceUsd-b.med)/b.med;errs.push(e);if(l.priceUsd<=b.med*2&&l.priceUsd>=b.med/2)w2++;}
    errs.sort((a,b)=>a-b);
    console.log((prior?'PRIOR-ONLY':'FULL-LOO '),h,'cov',cov,'('+(100*cov/rows.length).toFixed(1)+'%)','medAbsErr',errs.length?errs[Math.floor(errs.length/2)].toFixed(2):'-','within2x',(100*w2/Math.max(1,cov)).toFixed(1)+'%');
  }
}
// live book
const up=JSON.parse(fs.readFileSync('public/data/ray/upcoming.json','utf8'));
const upl=Array.isArray(up)?up:(up.lots||[]);
const cu=upl.filter((l:any)=>SLUGS.includes(l.artist));
console.log('\nupcoming.json total',upl.length,'culture upcoming:',cu.length);
let covU=0,subjU=0;
for(const l of cu){const ax=cultureAxes(l.title);AX.set(l,ax);if(ax.subjects.length)subjU++;
  const b=band(l,false);if(b)covU++;}
console.log('upcoming w/ subject:',subjU,'| would get reference band:',covU,'('+(100*covU/Math.max(1,cu.length)).toFixed(1)+'%)');
for(const l of cu.slice(0,6))console.log(' UP:',JSON.stringify(l.title).slice(0,100),'est',l.estimateLow);
