/**
 * restamp-sport.ts — one-shot: stamp `sport` (sportOf(title) — the title-read
 * sport tag behind the sports vertical's SPORT filter) on every existing
 * corpus lot whose slug is one of the three sports slugs, atomically with the
 * crawler change that stamps it on fresh rows. Non-sports lots get any stray
 * tag cleared. Then rebuilds the served payloads.
 * Run: npx tsx scripts/restamp-sport.ts
 */
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import { sportOf } from '../app/utils';
import { runMarketBuild } from './build-market';

const CORPUS = path.join(process.cwd(), 'data', 'corpus');
const readGz = (f: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, f + '.gz'))).toString('utf8'));
const writeGz = (f: string, d: unknown) => fs.writeFileSync(path.join(CORPUS, f + '.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(d))));

const SPORT_SLUGS = new Set(['game-used', 'trophies-awards', 'tickets-passes']);

type Lot = { id: string; artist: string; title?: string; sport?: string | null; [k: string]: unknown };

const lots: Lot[] = readGz('lots.json');
const arch: Lot[] = readGz('sold-archive.json');
let stamped = 0, cleared = 0;
const dist: Record<string, number> = {};
for (const l of lots.concat(arch)) {
  if (SPORT_SLUGS.has(l.artist)) {
    l.sport = sportOf(l.title || '');
    stamped++;
    dist[l.sport ?? 'Other'] = (dist[l.sport ?? 'Other'] || 0) + 1;
  } else if (l.sport !== undefined) {
    delete l.sport;
    cleared++;
  }
}
console.log(`[restamp] stamped sport on ${stamped} sports lots (cleared ${cleared} strays)`);
console.log('[restamp] distribution:', Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(' · '));
writeGz('lots.json', lots);
writeGz('sold-archive.json', arch);
console.log('[restamp] corpus written · rebuilding served payloads…');
runMarketBuild();
