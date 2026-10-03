import fs from 'fs';
const all:any[]=[];
for (const f of fs.readdirSync('public/data/ray')) if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/'+f,'utf8')));
const SLUGS=['movie-tv','music-memorabilia','entertainment-memorabilia'];
const cult=all.filter(l=>SLUGS.includes(l.artist));
console.log('total corpus:',all.length,'culture lots:',cult.length);
const by:(k:(l:any)=>string,rows:any[])=>Record<string,number>=(k,rows)=>{const m:Record<string,number>={};for(const l of rows)m[k(l)]=(m[k(l)]||0)+1;return m;};
for(const s of SLUGS){
  const rows=cult.filter(l=>l.artist===s);
  const sold=rows.filter(l=>l.status==='sold'&&l.priceUsd);
  console.log('\n===',s,'total',rows.length,'sold-with-price',sold.length);
  console.log(' category:',by(l=>l.category,rows));
  console.log(' status:',by(l=>l.status,rows));
  // field coverage on sold
  const cov=(f:string)=>sold.filter(l=>l[f]!=null&&l[f]!=='').length;
  console.log(' sold field coverage: entity',cov('entity'),'estimateLow',cov('estimateLow'),'estLowUsd',cov('estLowUsd'),'medium',cov('medium'),'dimensions',cov('dimensions'),'formKey',cov('formKey'),'objectType',cov('objectType'),'eventKey',cov('eventKey'),'playerSlug',cov('playerSlug'),'sportYear',cov('sportYear'),'source',by(l=>l.source||'?',sold));
  console.log(' formKey dist:',by(l=>l.formKey||'(none)',sold));
  // price dist
  const p=sold.map(l=>l.priceUsd).sort((a:number,b:number)=>a-b);
  const q=(x:number)=>p[Math.floor(p.length*x)];
  if(p.length)console.log(' price: min',p[0],'p25',q(.25),'med',q(.5),'p75',q(.75),'p95',q(.95),'max',p[p.length-1]);
  // sample titles
  console.log(' sample titles:');
  for(const l of sold.slice(0,8))console.log('  -',JSON.stringify(l.title).slice(0,130),'| ent:',l.entity||'-','| $'+l.priceUsd);
}
