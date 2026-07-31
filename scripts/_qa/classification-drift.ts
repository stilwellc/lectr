/** classification-drift — quantify formKey (build truth, stamped from full
 *  title+medium+category) vs what the CLIENT recomputes from the served
 *  shards (which carry NO formKey and slimmer text). Join by id. */
import fs from 'fs';
import { readGzRows } from '../corpus-io';
import { classifyForm } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

const corpus = readGzRows('data/corpus/lots.json.gz') as unknown as (AuctionLot & { formKey?: string })[];
const fkById = new Map<string, string>();
const artistById = new Map<string, string>();
for (const l of corpus) { if (l.formKey) fkById.set(l.id, l.formKey); artistById.set(l.id, l.artist); }

const client: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) if (/^lots-\d+\.json$/.test(f)) client.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
console.log('client rows:', client.length, ' corpus formKeys:', fkById.size);

const WATCH_SLUGS = new Set(['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier']);
const SCIENCE_SLUGS = new Set(['meteorites', 'fossils', 'space-exploration', 'scientific-instruments']);
const SPORTS_SLUGS = new Set(['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia']);
const vertical = (l: AuctionLot): string =>
  WATCH_SLUGS.has(l.artist) ? 'watches'
  : SCIENCE_SLUGS.has(l.artist) ? 'science'
  : SPORTS_SLUGS.has(l.artist) ? 'sports'
  : l.category === 'design' ? 'design'
  : ['print', 'original', 'photograph', 'sculpture'].includes(l.category) ? 'art'
  : 'other';

const stats: Record<string, { n: number; joined: 0 | number; drift: number; pairs: Record<string, number>; hasFkClient: number }> = {};
let unjoined = 0;
for (const l of client) {
  const v = vertical(l);
  const s = (stats[v] ||= { n: 0, joined: 0, drift: 0, pairs: {}, hasFkClient: 0 });
  s.n++;
  if ((l as { formKey?: string }).formKey) s.hasFkClient++;
  const fk = fkById.get(l.id);
  if (!fk) { unjoined++; continue; }
  s.joined++;
  const clientForm = classifyForm(l); // exactly what formOf() falls back to client-side
  if (clientForm !== fk) {
    s.drift++;
    const key = `${fk}→${clientForm}`;
    s.pairs[key] = (s.pairs[key] || 0) + 1;
  }
}
console.log('client rows not found in corpus by id:', unjoined);
for (const [v, s] of Object.entries(stats).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`\n${v}: n=${s.n} joined=${s.joined} clientFormKey=${s.hasFkClient} DRIFT=${s.drift} (${(100 * s.drift / Math.max(1, s.joined)).toFixed(2)}%)`);
  const top = Object.entries(s.pairs).sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [pair, n] of top) console.log(`   ${pair}: ${n}`);
}

// drift that BITES: sold+priced rows (pool side) and estimated live rows (anchor side)
let soldDrift = 0, liveDrift = 0, soldDriftWatch = 0, unknownDrift = 0;
for (const l of client) {
  const fk = fkById.get(l.id);
  if (!fk) continue;
  const cf = classifyForm(l);
  if (cf === fk) continue;
  if (l.status === 'sold' && l.priceUsd) { soldDrift++; if (vertical(l) === 'watches') soldDriftWatch++; }
  else if (l.status === 'upcoming') liveDrift++;
  if (cf === 'unknown' || fk === 'unknown') unknownDrift++;
}
console.log(`\ndrift on sold+priced (pool side): ${soldDrift} (watches: ${soldDriftWatch}); on upcoming (anchor side): ${liveDrift}; involving 'unknown': ${unknownDrift}`);
