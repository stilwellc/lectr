/* science-reference2.ts — v2 loose-reference tier with pollution guards:
   (a) art-lot guard: title carries artist life-dates "(1471-1528)" / "(B. 1952)"
   (b) photograph guard for fossils (panoramic sports photos titled "MAMMOTH")
   (c) IDENTITY REQUIRED: entity match OR title-derived identity match; word
       overlap only scores/sorts, never admits alone.
   Also reports a v2b variant where overlap>=3 can admit when anchor has no identity. */
import * as fs from 'fs';
import { classifyForm, soldCompBand, appraiseLot, normalizeTitle } from '../../app/lib/comps';

const DIR = 'public/data/ray';
const all: any[] = [];
for (const f of fs.readdirSync(DIR)) if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync(DIR + '/' + f, 'utf8')));

const SCI_SLUGS = ['meteorites', 'fossils', 'scientific-instruments', 'space-exploration'];
const SLUG_FORMS: Record<string, Set<string>> = {
  meteorites: new Set(['meteorite']),
  fossils: new Set(['fossil']),
  'scientific-instruments': new Set(['instrument', 'tech']),
  'space-exploration': new Set(['space']),
};
const formOf = (l: any) => l.formKey ?? classifyForm(l);
const sciRows = all.filter(l => l.category === 'object' && SCI_SLUGS.includes(l.artist));
const soldSci = sciRows.filter(l => l.status === 'sold' && l.priceUsd && SLUG_FORMS[l.artist].has(formOf(l)));

/* guards */
const ART_DATES = /\((?:b\.\s*|born\s*)?\d{4}(?:\s*[–—-]\s*\d{4})?\)/i; // (1471-1528), (B. 1952)
function isLeakedArtLot(l: any): boolean {
  const t = l.title || '';
  if (ART_DATES.test(t)) return true;
  if (l.artist === 'fossils' && /\b(photograph|panoramic|panorama)\b/i.test(t)) return true;
  return false;
}

/* identity extraction (same as v1) */
const METEORITE_NAMES = /\b(nwa ?\d+|sikhote[- ]alin|seymchan|campo del cielo|gujba|willamette|admire|dronino|muonionalusta|canyon diablo|gibeon|esquel|imilac|fukang|allende|murchison|chelyabinsk|aletai|tamentit|brenham|odessa|nantan|toluca|henbury|chinga|zagami|tissint|erg chech|aguas zarcas|tisserlitine)\b/;
const METEORITE_TYPES = /\b(pallasite|mesosiderite|octahedrite|ataxite|hexahedrite|chondrite|achondrite|shergottite|lunar|moon rock|slice of the moon|martian|mars rock)\b/;
const FOSSIL_GENERA = /\b(ammonite|trilobite|megalodon|mammoth|mosasaur|tyrannosaurus|t[.\- ]rex|triceratops|ichthyosaur|plesiosaur|pterosaur|pteranodon|sabre[- ]tooth|saber[- ]tooth|allosaurus|diplodocus|stegosaurus|velociraptor|raptor|edmontosaurus|spinosaurus|cave bear|woolly rhino|crinoid|sea lily|stromatolite|coprolite|orthoceras|keichousaurus|shark tooth|dinosaur egg|amber)\b/;
const INSTRUMENT_TYPES = /\b(telescope|microscope|astrolabe|sextant|octant|orrery|armillary|barometer|theodolite|sundial|globe|slide rule|chronometer|compass|calculator|typewriter|enigma|computer|camera)\b/;
const SPACE_MISSIONS = /\b(apollo[- ]?(?:\d{1,2}|[ivx]{1,4})|apollo|gemini[- ]?\d{0,2}|mercury|soyuz|skylab|sputnik|vostok|space shuttle|shuttle|sts-\d+|iss|mir)\b/;
const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16', xvii: '17' };
function titleIdentity(l: any): string | null {
  const t = ` ${(l.title || '').toLowerCase()} `;
  let m: RegExpMatchArray | null;
  switch (l.artist) {
    case 'meteorites':
      if ((m = t.match(METEORITE_NAMES))) return 'name:' + m[1].replace(/[- ]/g, '');
      if ((m = t.match(METEORITE_TYPES))) {
        const ty = /lunar|moon/.test(m[1]) ? 'lunar' : /martian|mars/.test(m[1]) ? 'martian' : m[1];
        return 'type:' + ty;
      }
      return null;
    case 'fossils':
      if ((m = t.match(FOSSIL_GENERA))) return 'genus:' + m[1].replace(/[.\- ]/g, '');
      return null;
    case 'scientific-instruments':
      if ((m = t.match(INSTRUMENT_TYPES))) return 'inst:' + m[1];
      return null;
    case 'space-exploration':
      if ((m = t.match(SPACE_MISSIONS))) {
        let id = m[1].replace(/[- ]/g, '');
        const r = id.match(/^apollo([ivx]+)$/);
        if (r && ROMAN[r[1]]) id = 'apollo' + ROMAN[r[1]];
        return 'mission:' + id;
      }
      return null;
  }
  return null;
}

function median(xs: number[]): number { const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function referenceBand(lot: any, rows: any[], allowOverlapAdmit: boolean) {
  if (isLeakedArtLot(lot)) return null;
  const ent = lot.entity ? lot.entity.toLowerCase().trim() : null;
  const tid = titleIdentity(lot);
  const words = new Set<string>(normalizeTitle(lot.title).split(' ').filter((w: string) => w.length > 3));
  const cands = rows.filter(l => l.id !== lot.id && l.artist === lot.artist && l.status === 'sold' && l.priceUsd
    && SLUG_FORMS[l.artist].has(formOf(l)) && !isLeakedArtLot(l));
  const scored: [number, any][] = [];
  for (const l of cands) {
    let idHit = false, s = 0;
    if (ent && l.entity && l.entity.toLowerCase().trim() === ent) { idHit = true; s += 3; }
    const lid = titleIdentity(l);
    if (tid && lid && lid === tid) { idHit = true; s += 3; }
    let ov = 0; for (const w of normalizeTitle(l.title).split(' ')) if (words.has(w)) ov++;
    s += ov;
    const admit = idHit || (allowOverlapAdmit && !tid && !ent && ov >= 3);
    if (admit) scored.push([s, l]);
  }
  if (scored.length < 3) return null;
  const pool = scored.sort((a, b) => (b[0] - a[0]) || (new Date(b[1].saleDate).getTime() - new Date(a[1].saleDate).getTime())).slice(0, 24).map(x => x[1]);
  const prices = pool.map(l => l.priceUsd).sort((a: number, b: number) => a - b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length * 0.25)], q3 = prices[Math.floor(prices.length * 0.75)];
  if (med > 0 && (q3 - q1) / med > 2.5) return null;
  return { med, n: pool.length, spread: (q3 - q1) / med };
}

function pct(n: number, d: number) { return d ? (100 * n / d).toFixed(1) + '%' : '—'; }
function errStats(errs: number[]) {
  if (!errs.length) return 'n=0';
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  return `n=${errs.length} med|err|=${(median(abs) * 100).toFixed(0)}% within±50%=${pct(errs.filter(e => Math.abs(e) <= 0.5).length, errs.length)} within±100%=${pct(errs.filter(e => Math.abs(e) <= 1.0).length, errs.length)} worst=${(Math.max(...abs) * 100).toFixed(0)}%`;
}

for (const variant of [false, true]) {
  console.log(`\n########## v2${variant ? 'b (identity OR overlap>=3 when no identity)' : 'a (identity REQUIRED)'} ##########`);
  for (const slug of SCI_SLUGS) {
    const anchors = soldSci.filter(l => l.artist === slug);
    let refHits = 0, refOnly = 0, base = 0;
    const refErrs: number[] = [], refOnlyErrs: number[] = [];
    const bad: string[] = [];
    for (const lot of anchors) {
      const sb = soldCompBand(lot, sciRows as any);
      const ap = appraiseLot(lot, sciRows as any);
      if (sb || ap) base++;
      const rb = referenceBand(lot, sciRows, variant);
      if (rb) {
        refHits++;
        const e = (lot.priceUsd - rb.med) / rb.med;
        refErrs.push(e);
        if (!sb && !ap) { refOnly++; refOnlyErrs.push(e); }
        if (Math.abs(e) > 2 && bad.length < 4) bad.push(`"${(lot.title || '').slice(0, 65)}" realized=$${Math.round(lot.priceUsd)} med=$${Math.round(rb.med)} err=${(e * 100).toFixed(0)}%`);
      }
    }
    console.log(`\n=== ${slug} (anchors=${anchors.length}, baseline reads=${base}) ===`);
    console.log(`REFERENCE: ${refHits} (${pct(refHits, anchors.length)})  ${errStats(refErrs)}`);
    console.log(`REFERENCE-only gain: +${refOnly} (${pct(refOnly, anchors.length)})  ${errStats(refOnlyErrs)}`);
    for (const s of bad) console.log('  worst-tail: ' + s);
  }
}
