/* science-coverage.ts — per-slug diagnosis for the science vertical:
   sold-row counts, entity coverage, form distribution, estimate coverage,
   and what a title-derived identity could look like where entity is missing. */
import * as fs from 'fs';
import { classifyForm } from '../../app/lib/comps';

const DIR = 'public/data/ray';
const all: any[] = [];
for (const f of fs.readdirSync(DIR)) if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync(DIR + '/' + f, 'utf8')));
const upcoming: any[] = JSON.parse(fs.readFileSync(DIR + '/upcoming.json', 'utf8')).lots;

const SCI_SLUGS = ['meteorites', 'fossils', 'scientific-instruments', 'space-exploration'];

function report(name: string, lots: any[]) {
  console.log(`\n=== ${name} ===`);
  for (const slug of SCI_SLUGS) {
    const rows = lots.filter(l => l.artist === slug && l.category === 'object');
    const sold = rows.filter(l => l.status === 'sold' && l.priceUsd);
    const withEntity = sold.filter(l => l.entity);
    const withEst = sold.filter(l => l.estimateLow && l.estimateHigh);
    const forms: Record<string, number> = {};
    for (const l of sold) { const f = l.formKey ?? classifyForm(l); forms[f] = (forms[f] || 0) + 1; }
    console.log(`${slug}: rows=${rows.length} sold=${sold.length} entity=${withEntity.length} (${sold.length ? (100 * withEntity.length / sold.length).toFixed(0) : 0}%) est=${withEst.length} forms=${JSON.stringify(forms)}`);
    // entity value distribution
    const ents: Record<string, number> = {};
    for (const l of withEntity) { const e = l.entity.toLowerCase().trim(); ents[e] = (ents[e] || 0) + 1; }
    const top = Object.entries(ents).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (top.length) console.log(`  top entities: ${top.map(([k, v]) => `${k}(${v})`).join(', ')}`);
    // sample titles without entity
    const noEnt = sold.filter(l => !l.entity).slice(0, 6);
    for (const l of noEnt) console.log(`  no-entity: "${(l.title || '').slice(0, 90)}"`);
  }
}

report('CORPUS (196k client)', all);
report('UPCOMING', upcoming);

// estimate-path science: science-form lots (any artist) with estimates — the 2/150 finding
const sciForms = new Set(['meteorite', 'fossil', 'mineral', 'space', 'instrument', 'tech']);
const estPath = all.filter(l => l.category === 'object' && l.status === 'sold' && l.priceUsd && (l.estimateLow || l.estLowUsd) && sciForms.has(l.formKey ?? classifyForm(l)));
console.log(`\nestimate-path science sold lots (science form + estimate): ${estPath.length}`);
const byArtist: Record<string, number> = {};
for (const l of estPath) byArtist[l.artist] = (byArtist[l.artist] || 0) + 1;
console.log('by artist:', JSON.stringify(Object.entries(byArtist).sort((a, b) => b[1] - a[1]).slice(0, 15)));
