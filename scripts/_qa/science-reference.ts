/* science-reference.ts — baseline (appraiseLot + soldCompBand) vs a designed
   LOOSE-REFERENCE tier for the science vertical. Leave-one-out hindsight on
   sold rows: err = (realized − med)/med. */
import * as fs from 'fs';
import { classifyForm, soldCompBand, appraiseLot, normalizeTitle } from '../../app/lib/comps';

const DIR = 'public/data/ray';
const all: any[] = [];
for (const f of fs.readdirSync(DIR)) if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync(DIR + '/' + f, 'utf8')));

const SCI_SLUGS = ['meteorites', 'fossils', 'scientific-instruments', 'space-exploration'];
// canonical science forms a slug admits — keeps the manuscript/jewelry pollution out
const SLUG_FORMS: Record<string, Set<string>> = {
  meteorites: new Set(['meteorite']),
  fossils: new Set(['fossil']),
  'scientific-instruments': new Set(['instrument', 'tech']),
  'space-exploration': new Set(['space']),
};
const formOf = (l: any) => l.formKey ?? classifyForm(l);

// slug rows only (comp pools are same-artist anyway) — makes N×M tractable
const sciRows = all.filter(l => l.category === 'object' && SCI_SLUGS.includes(l.artist));
const soldSci = sciRows.filter(l => l.status === 'sold' && l.priceUsd && SLUG_FORMS[l.artist].has(formOf(l)));

/* ── title-derived identity (the loose tier's third leg) ────────────────── */
const METEORITE_NAMES = /\b(nwa ?\d+|sikhote[- ]alin|seymchan|campo del cielo|gujba|willamette|admire|dronino|muonionalusta|canyon diablo|gibeon|esquel|imilac|fukang|allende|murchison|chelyabinsk|aletai|tamentit|brenham|odessa|nantan|toluca|henbury|chinga|zagami|tissint|erg chech|aguas zarcas)\b/;
const METEORITE_TYPES = /\b(pallasite|mesosiderite|octahedrite|ataxite|hexahedrite|chondrite|achondrite|shergottite|lunar|moon rock|mars(?:tian)? rock|martian)\b/;
const FOSSIL_GENERA = /\b(ammonite|trilobite|megalodon|mammoth|mosasaur|tyrannosaurus|t[.\- ]rex|triceratops|ichthyosaur|plesiosaur|pterosaur|pteranodon|sabre[- ]tooth|saber[- ]tooth|allosaurus|diplodocus|stegosaurus|velociraptor|raptor|edmontosaurus|spinosaurus|cave bear|woolly rhino|crinoid|sea lily|stromatolite|coprolite|orthoceras|keichousaurus|shark tooth|dinosaur egg|amber)\b/;
const INSTRUMENT_TYPES = /\b(telescope|microscope|astrolabe|sextant|octant|orrery|armillary|barometer|theodolite|sundial|globe|slide rule|chronometer|compass|calculator|typewriter|enigma|computer|camera)\b/;
const SPACE_MISSIONS = /\b(apollo[- ]?(?:\d{1,2}|[ivx]{1,4})|apollo|gemini|mercury|soyuz|skylab|sputnik|vostok|space shuttle|shuttle|iss|mir)\b/;

function titleIdentity(l: any): string | null {
  const t = ` ${(l.title || '').toLowerCase()} `;
  switch (l.artist) {
    case 'meteorites': {
      const n = t.match(METEORITE_NAMES); if (n) return 'name:' + n[1].replace(/[- ]/g, '');
      const ty = t.match(METEORITE_TYPES); if (ty) return 'type:' + ty[1];
      return null;
    }
    case 'fossils': {
      const g = t.match(FOSSIL_GENERA); if (g) return 'genus:' + g[1].replace(/[.\- ]/g, '');
      return null;
    }
    case 'scientific-instruments': {
      const i = t.match(INSTRUMENT_TYPES); if (i) return 'inst:' + i[1];
      return null;
    }
    case 'space-exploration': {
      const m = t.match(SPACE_MISSIONS);
      if (m) return 'mission:' + m[1].replace(/[- ]/g, '').replace(/\bxiii\b/, '13'); // keep raw; roman handled below
      return null;
    }
  }
  return null;
}
// normalize roman numerals in apollo mission ids so "apollo xii" == "apollo 12"
const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16', xvii: '17' };
function normId(id: string | null): string | null {
  if (!id) return null;
  const m = id.match(/^mission:apollo([ivx]+)$/);
  if (m && ROMAN[m[1]]) return 'mission:apollo' + ROMAN[m[1]];
  return id;
}

function sigWords(l: any): Set<string> {
  return new Set(normalizeTitle(l.title).split(' ').filter(w => w.length > 3));
}

function median(xs: number[]): number { const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

/* ── the LOOSE-REFERENCE band ──────────────────────────────────────────────
   pool = same slug + same canonical form + (entity match OR title-identity
   match OR >=2 significant-word overlap). floor >=3, dispersion (q3-q1)/med
   <= 2.5, confidence ALWAYS 'low', label 'reference' — never a flag. */
function referenceBand(lot: any, rows: any[]) {
  const form = formOf(lot);
  if (!SLUG_FORMS[lot.artist].has(form)) return null;
  const ent = lot.entity ? lot.entity.toLowerCase().trim() : null;
  const tid = normId(titleIdentity(lot));
  const words = sigWords(lot);
  const cands = rows.filter(l => l.id !== lot.id && l.artist === lot.artist && l.status === 'sold' && l.priceUsd && SLUG_FORMS[l.artist].has(formOf(l)));
  const scored: [number, any][] = [];
  for (const l of cands) {
    let s = 0;
    if (ent && l.entity && l.entity.toLowerCase().trim() === ent) s += 3;
    const lid = normId(titleIdentity(l));
    if (tid && lid && lid === tid) s += 3;
    let ov = 0; for (const w of normalizeTitle(l.title).split(' ')) if (words.has(w)) ov++;
    if (ov >= 2) s += ov;
    if (s >= 2) scored.push([s, l]);
  }
  if (scored.length < 3) return null;
  const pool = scored.sort((a, b) => (b[0] - a[0]) || (new Date(b[1].saleDate).getTime() - new Date(a[1].saleDate).getTime())).slice(0, 24).map(x => x[1]);
  const prices = pool.map(l => l.priceUsd).sort((a: number, b: number) => a - b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length * 0.25)], q3 = prices[Math.floor(prices.length * 0.75)];
  if (med > 0 && (q3 - q1) / med > 2.5) return null;
  return { med, n: pool.length, lo: prices[0], hi: prices[prices.length - 1], spread: (q3 - q1) / med, topScore: scored[0][0] };
}

/* ── run ── */
function pct(n: number, d: number) { return d ? (100 * n / d).toFixed(1) + '%' : '—'; }
function errStats(errs: number[]) {
  if (!errs.length) return 'n=0';
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const within50 = errs.filter(e => Math.abs(e) <= 0.5).length;
  const within100 = errs.filter(e => Math.abs(e) <= 1.0).length;
  return `n=${errs.length} med|err|=${(median(abs) * 100).toFixed(0)}% within±50%=${pct(within50, errs.length)} within±100%=${pct(within100, errs.length)}`;
}

for (const slug of SCI_SLUGS) {
  const anchors = soldSci.filter(l => l.artist === slug);
  let baseBand = 0, baseAppr = 0, refHits = 0, refOnly = 0;
  const baseErrs: number[] = [], refErrs: number[] = [], refOnlyErrs: number[] = [];
  let idCov = 0, entCov = 0;
  const samples: string[] = [];
  for (const lot of anchors) {
    if (lot.entity) entCov++;
    if (titleIdentity(lot)) idCov++;
    const sb = soldCompBand(lot, sciRows as any);
    const ap = appraiseLot(lot, sciRows as any);
    if (sb) { baseBand++; baseErrs.push((lot.priceUsd - sb.median) / sb.median); }
    if (ap) baseAppr++;
    const rb = referenceBand(lot, sciRows);
    if (rb) {
      refHits++;
      const e = (lot.priceUsd - rb.med) / rb.med;
      refErrs.push(e);
      if (!sb && !ap) { refOnly++; refOnlyErrs.push(e); if (samples.length < 5) samples.push(`"${(lot.title || '').slice(0, 60)}" realized=$${Math.round(lot.priceUsd)} refMed=$${Math.round(rb.med)} n=${rb.n} err=${(e * 100).toFixed(0)}%`); }
    }
  }
  console.log(`\n=== ${slug} (sold anchors=${anchors.length}) ===`);
  console.log(`entity coverage: ${pct(entCov, anchors.length)}  title-identity coverage: ${pct(idCov, anchors.length)}`);
  console.log(`BASELINE soldCompBand: ${baseBand} (${pct(baseBand, anchors.length)})  ${errStats(baseErrs)}`);
  console.log(`BASELINE appraiseLot (estimate path): ${baseAppr} (${pct(baseAppr, anchors.length)})`);
  console.log(`REFERENCE tier: ${refHits} (${pct(refHits, anchors.length)})  ${errStats(refErrs)}`);
  console.log(`REFERENCE-only gain (no band, no appraisal today): +${refOnly} (${pct(refOnly, anchors.length)})  ${errStats(refOnlyErrs)}`);
  for (const s of samples) console.log('  e.g. ' + s);
}
