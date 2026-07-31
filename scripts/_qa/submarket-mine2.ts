/** round 2 — drill-depth measurement for the sub-category proposal */
import fs from 'fs'; import path from 'path'; import zlib from 'zlib';
import { ARTIST_MARKET } from '../../app/constants';
const CORPUS = path.join(process.cwd(), 'data', 'corpus');
type C = Map<string, number>;
const bump = (c: C, k: string, n = 1) => c.set(k, (c.get(k) || 0) + n);
const top = (c: C, n: number) => Array.from(c.entries()).sort((a,b)=>b[1]-a[1]).slice(0,n);

const sportVals: C = new Map(); let cardsNoSport = 0, cardsTotal = 0, pidNoSport = 0;
const subjCount: C = new Map(); let cultureOtherN = 0; const cultureOtherHit: C = new Map(); let cultureOtherMiss = 0;
const otherSamples: string[] = [];
let printN = 0; const printProc: C = new Map(); let printMiss = 0;
let o2dN = 0; const o2dMed: C = new Map();
const sciSpace: C = new Map(); let sciSpaceN = 0;
const sciTech: C = new Map(); let sciTechN = 0;
const instr: C = new Map(); let instrN = 0;
const watchFam: C = new Map();

const PROC = [
  ['screenprint', /screen ?print|silkscreen|serigraph/i], ['lithograph', /lithograph/i],
  ['etching', /etch|aquatint|drypoint|engraving/i], ['woodcut', /woodcut|linocut|wood engraving/i],
  ['poster', /poster/i], ['offset', /offset/i], ['digital', /digital|inkjet|giclee/i],
] as const;
const O2D = [
  ['oil', /\boil\b/i], ['acrylic', /acrylic/i], ['watercolor', /watercolou?r|gouache/i],
  ['drawing', /\b(ink|pencil|charcoal|crayon|graphite|pastel|drawing|felt-tip|marker)\b/i], ['collage', /collage/i],
] as const;
const SPACE = [
  ['flown', /\bflown\b|carried aboard/i], ['apollo', /apollo/i], ['gemini-mercury', /gemini|mercury/i],
  ['shuttle-iss', /shuttle|sts-|iss\b|skylab/i], ['cosmonaut-soviet', /soyuz|sputnik|cosmonaut|vostok|mir\b/i],
  ['signed-astro', /signed|autograph|sp\b|dsi/i], ['photograph', /photograph|photo\b/i], ['model-hardware', /model|hardware|component|panel|antenna|heat shield/i],
] as const;
const TECH = [
  ['apple-jobs', /apple|steve jobs|macintosh|wozniak/i], ['computing-other', /computer|ibm|commodore|altair|enigma|calculator|microsoft|gates/i],
  ['einstein-physics', /einstein|newton|curie|tesla|edison|darwin|hawking/i], ['docs-books', /letter|document|signed|manuscript|book|first edition/i],
] as const;
const INSTR = [
  ['globe', /globe/i], ['telescope', /telescope/i], ['microscope', /microscope/i],
  ['clock-chrono', /clock|chronometer|regulator/i], ['nav', /sextant|octant|compass|astrolabe|orrery/i],
  ['medical', /medical|surgical|apothecary|anatomical/i], ['typewriter-office', /typewriter|calculat/i],
] as const;
const CULT_NEW = [
  ['poster', /poster/i], ['worn-clothing', /worn|jacket|dress|shirt|costume|jersey|hat\b|boots|shoes/i],
  ['prop', /prop\b|screen-used|screen used/i], ['instrument', /guitar|piano|drum|saxophone|violin/i],
  ['contract-check', /contract|check|cheque|agreement/i], ['lyrics-manuscript', /lyric|handwritten|manuscript/i],
  ['award', /award|gold record|platinum|grammy|oscar|emmy/i], ['coin-currency', /coin|currency|banknote|dollar bill/i],
  ['book-signed', /\bbook\b|first edition|signed copy/i], ['toy-model', /toy|action figure|model kit/i],
] as const;
const FAM = ['daytona','submariner','gmt','datejust','day-date','explorer','oyster','nautilus','aquanaut','calatrava','perpetual calendar','chronograph','royal oak','speedmaster','seamaster','constellation','tank','santos','panthère','crash','reverso','navitimer','carrera','monaco'];

function eat(l: any) {
  const vert = ARTIST_MARKET[l.artist] || 'unknown';
  const t = (l.title || '') as string;
  if (vert === 'sports') {
    if (l.sport) bump(sportVals, String(l.sport));
    if (l._card) { cardsTotal++; if (!l.sport) { cardsNoSport++; if (l._pid) pidNoSport++; } }
  } else if (vert === 'culture') {
    if (Array.isArray(l.subjectKeys)) for (const s of l.subjectKeys) bump(subjCount, s);
    if (l.itemClass === 'other') {
      cultureOtherN++;
      let hit = false;
      for (const [k, re] of CULT_NEW) if (re.test(t)) { bump(cultureOtherHit, k); hit = true; break; }
      if (!hit) { cultureOtherMiss++; if (otherSamples.length < 12 && Math.abs(hashCode(t)) % 97 < 3) otherSamples.push(t.slice(0, 80)); }
    }
  } else if (vert === 'art') {
    if (l.formKey === 'print') { printN++; let hit = false; for (const [k, re] of PROC) if (re.test(t)) { bump(printProc, k); hit = true; break; } if (!hit) printMiss++; }
    if (l.formKey === 'original-2d') { o2dN++; for (const [k, re] of O2D) if (re.test(t)) { bump(o2dMed, k); break; } }
  } else if (vert === 'science') {
    if (l.artist === 'space-exploration') { sciSpaceN++; for (const [k, re] of SPACE) if (re.test(t)) { bump(sciSpace, k); break; } }
    if (l.artist === 'science-tech') { sciTechN++; for (const [k, re] of TECH) if (re.test(t)) { bump(sciTech, k); break; } }
    if (l.artist === 'scientific-instruments') { instrN++; for (const [k, re] of INSTR) if (re.test(t)) { bump(instr, k); break; } }
  } else if (vert === 'watches' && l.formKey === 'wristwatch') {
    const hay = (t + ' ' + (l.reference || '')).toLowerCase();
    for (const f of FAM) if (hay.includes(f)) { bump(watchFam, `${l.artist}·${f}`); break; }
  }
}
function hashCode(s: string) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h; }
function stream(file: string) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  let start = 0;
  while (start < buf.length) {
    let end = buf.indexOf(10, start); if (end === -1) end = buf.length;
    if (end > start + 1) { const line = buf.toString('utf8', start, end).trim(); if (line) { try { eat(JSON.parse(line)); } catch {} } }
    start = end + 1;
  }
}
stream(path.join(CORPUS, 'lots.json.gz'));
stream(path.join(CORPUS, 'sold-archive.json.gz'));

console.log('SPORT stamped:', top(sportVals, 15));
console.log(`cards total ${cardsTotal} · no sport ${cardsNoSport} (of those, ${pidNoSport} have _pid → player-map recoverable)`);
const subj = top(subjCount, 100000); const tot = subj.reduce((s, [,n]) => s + n, 0);
let cum = 0, k300 = 0, k1000 = 0;
subj.forEach(([, n], i) => { cum += n; if (i === 299) k300 = cum; if (i === 999) k1000 = cum; });
console.log(`culture subjects: ${subj.length} distinct · top300 covers ${k300} (${(100*k300/tot).toFixed(0)}%) · top1000 ${k1000} (${(100*k1000/tot).toFixed(0)}%) of ${tot} stamps`);
console.log('culture other→new classes:', top(cultureOtherHit, 12), 'still-other:', cultureOtherMiss, 'of', cultureOtherN);
console.log('  still-other samples:', otherSamples);
console.log(`art prints ${printN}: proc`, top(printProc, 8), 'miss', printMiss);
console.log(`art o2d ${o2dN}: med`, top(o2dMed, 6));
console.log(`space ${sciSpaceN}:`, top(sciSpace, 8));
console.log(`tech ${sciTechN}:`, top(sciTech, 5));
console.log(`instruments ${instrN}:`, top(instr, 8));
console.log('watch families:', top(watchFam, 20), 'coverage', Array.from(watchFam.values()).reduce((a,b)=>a+b,0));
