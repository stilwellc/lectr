// culture axes prototype v2: subject (person OR franchise) + item class
export type CultureAxes = { person: string|null; franchise: string|null; itemClass: string; subjects: string[] };

const ITEM_RULES: [RegExp,string][] = [
  [/\b(gem mint|psa \d|bgs \d|sgc \d|cgc \d|tag \d|graded|rookie card|trading card|hobby box|#\d+)/i,'card'],
  [/\bsigned (cut|index card)\b/i,'signed-cut'],
  [/\b(check|cheque)\b/i,'check'],
  [/\bsigned.{0,30}\b(photo|photograph)\b|\b(photo|photograph)\b.{0,30}\bsigned\b/i,'signed-photo'],
  [/\b(photograph|photo)\b/i,'photo'],
  [/\b(letter|correspondence|telegram|manuscript|typescript|document|deed|land grant|commission|proclamation|broadside|autograph note|handwritten lyrics|lyrics|diary|notebook|als|tls)\b/i,'document'],
  [/\b(script|screenplay|shooting script|storyboard)\b/i,'script'],
  [/\b(poster|lobby card|one[- ]sheet|handbill)\b/i,'poster'],
  [/\b(guitar|bass|telecaster|stratocaster|les paul|drum|drumhead|piano|saxophone|violin|microphone|amplifier)\b/i,'instrument'],
  [/\b(gold record|platinum record|riaa|grammy|oscar|academy award|emmy|disc award|sales award|award|medal|trophy)\b/i,'award'],
  [/\b(prop|props)\b/i,'prop'],
  [/\b(worn|costume|jacket|coat|dress|gown|shirt|boots?|robe|tunic|uniform|suit|cape|helmet|mask|shoes?|sneakers?|hat|jumpsuit|vest|jersey)\b/i,'costume'],
  [/\b(ticket|stub|pass|credential|program|programme)\b/i,'ticket'],
  [/\b(animation cel|cel\b|celluloid|drawing|sketch)\b/i,'cel-art'],
  [/\b(record|vinyl|album|lp|45rpm|acetate|test pressing)\b/i,'record'],
  [/\b(signed|autographed|autograph|signature|inscribed)\b/i,'autograph-other'],
];
export function itemClassOf(title:string):string{
  const t=(title||'').replace(/["“”]/g,' ');
  for(const [re,c] of ITEM_RULES) if(re.test(t)) return c;
  return 'other';
}

const STOP=new Set(['signed','autographed','original','type','photo','photograph','prop','stage','stage-played','stage-worn','screen','screen-worn','worn','owned','played','personal','personally','from','and','with','the','a','an','his','her','framed','vintage','rare','important','exceptional','collection','of','in','on','by','for','at','to','cut','index','card','check','display','custom','acoustic','electric','handwritten','authentic','dual','triple']);
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();

/** person: leading Cap-word run stopped at the first stopword/item token. */
export function personOf(title:string):string|null{
  let t=(title||'').trim();
  t=t.replace(/^(c\.?\s*)?(1[6-9]\d\d|20\d\d)(-\d{2,4})?\s+/i,'');   // leading year
  t=t.replace(/^(aug|jan|feb|mar|apr|may|jun|jul|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(-\d{1,2})?,?\s+\d{4}\s*-?\s*/i,''); // leading date
  const toks=t.split(/\s+/);
  const name:string[]=[];
  for(const w of toks){
    const bare=w.replace(/[^A-Za-z.'’-]/g,'');
    if(!bare||!/^[A-Z]/.test(bare)||STOP.has(bare.toLowerCase())||/\d/.test(w)) break;
    name.push(bare);
    if(name.length===4) break;
    if(/[,:–-]$/.test(w)) break;
  }
  if(name.length>=2&&name.length<=4) return norm(name.join(' '));
  // trailing "… SIGNED BY JOHN HANCOCK, 1765"
  const by=(title||'').match(/\bSIGNED BY ([A-Z][A-Z.'’-]+(?:\s+[A-Z][A-Z.'’-]+){1,3})/);
  if(by) return norm(by[1]);
  // trailing "NAME, 10 JUNE 1862" (all-caps docs)
  const tr=(title||'').match(/([A-Z][A-Z.'’-]+(?:\s+[A-Z][A-Z.'’-]+){1,3}),\s*(?:C\.?\s*)?(?:\d{1,2}\s+)?(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)?\s*(1[6-9]\d\d|20\d\d)\]?$/);
  if(tr&&!STOP.has(tr[1].split(/\s+/)[0].toLowerCase())) return norm(tr[1]);
  return null;
}

export function franchiseOf(title:string):string|null{
  const t=title||'';
  const q=t.match(/["“]([^"”]{3,45})["”]/);
  if(q) return norm(q[1]);
  const colon=t.match(/^([A-Z][A-Za-z0-9.&'’\- ]{2,40}?):\s/);
  if(colon) return norm(colon[1]);
  const from=t.match(/\bFROM\s+([A-Z][A-Z0-9.&'’\- ]{2,40}?)(?:,?\s+(?:19|20)\d\d|\s*$)/);
  if(from) return norm(from[1]);
  const pre=t.match(/^([A-Z][A-Z0-9.&'’!:\- ]{2,45}?),\s*(19|20)\d\d\s*[-:]/);
  if(pre) return norm(pre[1]);
  return null;
}

/** subject-only short title: "Star Trek", "The Beatles" — the whole title is the subject */
export function shortSubjectOf(title:string):string|null{
  const t=(title||'').trim();
  const words=t.split(/\s+/);
  if(words.length>=1&&words.length<=4&&itemClassOf(t)==='other'&&!/\d{3,}/.test(t)) return norm(t)||null;
  return null;
}

export function cultureAxes(title:string):CultureAxes{
  const shortS=shortSubjectOf(title);
  const person=shortS??personOf(title);
  const franchise=franchiseOf(title);
  const subjects=[...new Set([person,franchise].filter(Boolean))] as string[];
  return { person, franchise, itemClass:itemClassOf(title), subjects };
}
