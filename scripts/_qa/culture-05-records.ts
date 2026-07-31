import fs from 'fs';
const all:any[]=[];
for (const f of fs.readdirSync('public/data/ray')) if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/'+f,'utf8')));
const SLUGS=['movie-tv','music-memorabilia','entertainment-memorabilia'];
const sold=all.filter(l=>SLUGS.includes(l.artist)&&l.status==='sold'&&l.priceUsd&&l.source!=='sothebys-algolia');
const pick=(t:string)=>sold.find(l=>l.title===t);
for(const t of ['Star Trek','Louis Armstrong','The Empire Strikes Back']){
  const l=pick(t); if(l)console.log(JSON.stringify(l,null,1),'\n');
}
// how many short-title christies lots, and do short titles repeat?
const house=(l:any)=>String(l.id).split('-')[0];
const ch=sold.filter(l=>house(l)==='christies');
const short=ch.filter(l=>(l.title||'').split(/\s+/).length<=4);
console.log('christies short-title (<=4 words):',short.length,'of',ch.length);
const cnt:Record<string,number>={};for(const l of short)cnt[l.title.toLowerCase()]=(cnt[l.title.toLowerCase()]||0)+1;
console.log('top short titles:',Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,20));
// medium coverage among short
console.log('short with medium:',short.filter(l=>l.medium).length);
console.log('sample short with medium:',short.filter(l=>l.medium).slice(0,5).map(l=>({t:l.title,m:String(l.medium).slice(0,120)})));
