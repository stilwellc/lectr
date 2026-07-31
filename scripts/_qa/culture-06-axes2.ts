import fs from 'fs';
import { cultureAxes } from './culture-lib';
import { normalizeTitle, signalWithPool, appraiseLot } from '../../app/lib/comps';
const all:any[]=[];
for (const f of fs.readdirSync('public/data/ray')) if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/'+f,'utf8')));
const SLUGS=['movie-tv','music-memorabilia','entertainment-memorabilia'];
const cult=all.filter(l=>SLUGS.includes(l.artist));
const sold=cult.filter(l=>l.status==='sold'&&l.priceUsd&&l.source!=='sothebys-algolia');
const house=(l:any)=>String(l.id).split('-')[0];

// A. extraction coverage v2
for(const h of ['goldin','christies','sothebys']){
  const rows=sold.filter(l=>house(l)===h);
  let subj=0; const sc:Record<string,number>={};
  for(const l of rows){const ax=cultureAxes(l.title); if(ax.subjects.length){subj++; for(const s of ax.subjects)sc[s]=(sc[s]||0)+1;}}
  const in3=rows.filter(l=>cultureAxes(l.title).subjects.some(s=>sc[s]>=3)).length;
  console.log(h,rows.length,'subject-cov:',(100*subj/rows.length).toFixed(1)+'%','subject-pool>=3:',in3,(100*in3/rows.length).toFixed(1)+'%');
  console.log('  top:',Object.entries(sc).sort((a,b)=>b[1]-a[1]).slice(0,12).map(e=>e[0]+':'+e[1]).join(', '));
}

// B. exact normalized-title repeats (edition-like tier)
const tc:Record<string,number>={};
for(const l of sold){const nt=normalizeTitle(l.title); if(nt.length>=8)tc[nt]=(tc[nt]||0)+1;}
const rep3=sold.filter(l=>tc[normalizeTitle(l.title)]>=3).length;
const rep2=sold.filter(l=>tc[normalizeTitle(l.title)]>=2).length;
console.log('\nanchors with same-normalized-title count >=3:',rep3,' >=2:',rep2,'of',sold.length);
console.log('top repeat titles:',Object.entries(tc).sort((a,b)=>b[1]-a[1]).slice(0,8));

// C. engine baseline on estimate-carrying anchors (sample 2000)
const withEst=sold.filter(l=>l.estimateLow&&l.estimateHigh);
console.log('\nanchors with estimates:',withEst.length);
const samp=withEst.filter((_,i)=>i%4===0); // ~2200
let reads=0,flags=0; const errs:number[]=[];
for(const l of samp){
  const r=appraiseLot(l,cult);
  if(r){reads++; errs.push((l.priceUsd-r.value)/r.value);}
  const s=signalWithPool(l,cult); if(s)flags++;
}
console.log('BASELINE engine: sample',samp.length,'appraisal reads',reads,'('+(100*reads/samp.length).toFixed(2)+'%) flags',flags);
if(errs.length){errs.sort((a,b)=>a-b);const mae=errs.map(Math.abs).sort((a,b)=>a-b);console.log(' hindsight err med:',errs[Math.floor(errs.length/2)].toFixed(2),'medAbsErr:',mae[Math.floor(mae.length/2)].toFixed(2));}
