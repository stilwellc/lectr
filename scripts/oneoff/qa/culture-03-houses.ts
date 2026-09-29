import fs from 'fs';
const all:any[]=[];
for (const f of fs.readdirSync('public/data/ray')) if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/'+f,'utf8')));
const SLUGS=['movie-tv','music-memorabilia','entertainment-memorabilia'];
const sold=all.filter(l=>SLUGS.includes(l.artist)&&l.status==='sold'&&l.priceUsd&&l.source!=='sothebys-algolia');
const house=(l:any)=>String(l.id).split('-')[0];
for(const h of ['goldin','christies','sothebys']){
  const rows=sold.filter(l=>house(l)===h);
  const est=rows.filter(l=>l.estimateLow&&l.estimateHigh).length;
  const med=rows.filter(l=>l.medium).length;
  console.log('\n===',h,rows.length,'with-est:',est,'with-medium:',med);
  const p=rows.map(l=>l.priceUsd).sort((a:number,b:number)=>a-b);
  console.log(' price med:',p[Math.floor(p.length/2)],'p95:',p[Math.floor(p.length*.95)]);
  for(const l of rows.slice(0,12))console.log('  -',JSON.stringify(l.title).slice(0,140),'| $'+l.priceUsd,'| est',l.estimateLow,'| slug',l.artist);
}
