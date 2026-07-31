import fs from 'fs';
import { classifyForm } from '../../app/lib/comps';
const all:any[]=[];
for (const f of fs.readdirSync('public/data/ray')) if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/'+f,'utf8')));
const SLUGS=['movie-tv','music-memorabilia','entertainment-memorabilia'];
const sold=all.filter(l=>SLUGS.includes(l.artist)&&l.status==='sold'&&l.priceUsd&&l.source!=='sothebys-algolia');
console.log('sold anchors (non-algolia):',sold.length);

// house distribution
const house=(l:any)=>String(l.id).split('-')[0];
const hd:Record<string,number>={};for(const l of sold)hd[house(l)]=(hd[house(l)]||0)+1;
console.log('house:',hd);

// classifyForm distribution (engine's current view)
const fd:Record<string,number>={};for(const l of sold)fd[classifyForm(l)]=(fd[classifyForm(l)]||0)+1;
console.log('classifyForm dist:',Object.fromEntries(Object.entries(fd).sort((a,b)=>b[1]-a[1])));

// TITLE STRUCTURE probes
let colonPrefix=0, leadCapsRun=0, fromFilm=0, yearInTitle=0;
const colonNames:Record<string,number>={};
for(const l of sold){
  const t=l.title||'';
  const m=t.match(/^([A-Z][A-Za-z0-9.&'’\- ]{2,40}?):\s/);
  if(m){colonPrefix++;const n=m[1].trim().toLowerCase();colonNames[n]=(colonNames[n]||0)+1;}
  if(/^((?:[A-Z][A-Za-z.'’-]+\s+){1,3}[A-Z][A-Za-z.'’-]+)/.test(t))leadCapsRun++;
  if(/\bfrom\s+["“]/i.test(t)||/\bFROM\b/.test(t))fromFilm++;
  if(/\b(1[6-9]\d\d|20\d\d)\b/.test(t))yearInTitle++;
}
console.log('colon-prefix "NAME:":',colonPrefix,'leadCapsRun:',leadCapsRun,'from-film:',fromFilm,'year-in-title:',yearInTitle);
console.log('top colon names:',Object.entries(colonNames).sort((a,b)=>b[1]-a[1]).slice(0,25));
