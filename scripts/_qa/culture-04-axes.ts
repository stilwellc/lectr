import fs from 'fs';
import { cultureAxes } from './culture-lib';
const all:any[]=[];
for (const f of fs.readdirSync('public/data/ray')) if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/'+f,'utf8')));
const SLUGS=['movie-tv','music-memorabilia','entertainment-memorabilia'];
const sold=all.filter(l=>SLUGS.includes(l.artist)&&l.status==='sold'&&l.priceUsd&&l.source!=='sothebys-algolia');
const house=(l:any)=>String(l.id).split('-')[0];
for(const h of ['goldin','christies','sothebys']){
  const rows=sold.filter(l=>house(l)===h);
  let p=0,f=0,either=0; const ic:Record<string,number>={}; const subjCount:Record<string,number>={};
  for(const l of rows){
    const ax=cultureAxes(l.title);
    if(ax.person)p++; if(ax.franchise)f++; if(ax.person||ax.franchise)either++;
    ic[ax.itemClass]=(ic[ax.itemClass]||0)+1;
    const s=ax.person||ax.franchise; if(s)subjCount[s]=(subjCount[s]||0)+1;
  }
  console.log('\n===',h,rows.length);
  console.log(' person:',p,(100*p/rows.length).toFixed(1)+'%','franchise:',f,(100*f/rows.length).toFixed(1)+'%','either:',either,(100*either/rows.length).toFixed(1)+'%');
  console.log(' itemClass:',Object.fromEntries(Object.entries(ic).sort((a,b)=>b[1]-a[1])));
  console.log(' top subjects:',Object.entries(subjCount).sort((a,b)=>b[1]-a[1]).slice(0,15));
  // subject pool-size distribution
  const sizes=Object.values(subjCount).sort((a,b)=>b-a);
  const in3=rows.filter(l=>{const ax=cultureAxes(l.title);const s=ax.person||ax.franchise;return s&&subjCount[s]>=3;}).length;
  console.log(' lots whose subject has >=3 lots (same house set):',in3,(100*in3/rows.length).toFixed(1)+'%');
}
// mis-extraction eyeball: 20 random extractions
const samp=sold.filter((_,i)=>i%977===0);
for(const l of samp){const ax=cultureAxes(l.title);console.log('SAMPLE',house(l),'|',JSON.stringify(l.title).slice(0,100),'=> person:',ax.person,'| fr:',ax.franchise,'| ic:',ax.itemClass);}
