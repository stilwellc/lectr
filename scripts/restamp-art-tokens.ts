/**
 * restamp-art-tokens.ts — one-shot: recompute titleTokens (bio-parenthetical
 * strip + maker-name-word drop) and title-derived yearNum for ART lots across
 * the corpus, atomically with the crawler/tokenizer change in normalize.ts —
 * an asymmetric tokenization would break cosine between old and new rows.
 * Then rebuilds the served payloads. Run: npx tsx scripts/restamp-art-tokens.ts
 */
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import { ARTISTS } from '../app/constants';
import { titleTokens, extractYear } from '../app/lib/normalize';
import { runMarketBuild } from './build-market';

const CORPUS = path.join(process.cwd(), 'data', 'corpus');
const readGz = (f: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, f + '.gz'))).toString('utf8'));
const writeGz = (f: string, d: unknown) => fs.writeFileSync(path.join(CORPUS, f + '.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(d))));

const ART = new Set<string>(ARTISTS.filter(a => a.market === 'art').map(a => a.slug));

type Lot = { id: string; artist: string; title?: string; titleTokens?: string[]; yearNum?: number | null; yearSource?: string | null; yearIsCirca?: boolean; [k: string]: unknown };

const lots: Lot[] = readGz('lots.json');
const arch: Lot[] = readGz('sold-archive.json');
let retok = 0, reyear = 0;
for (const l of lots.concat(arch)) {
  if (!ART.has(l.artist) || !l.title) continue;
  const next = titleTokens(l.title, l.artist.split('-'));
  if (JSON.stringify(next) !== JSON.stringify(l.titleTokens || [])) { l.titleTokens = next; retok++; }
  // re-derive title-sourced years through the bio-strip (field-sourced stay)
  if (l.yearSource === 'title') {
    const y = extractYear(null, l.title);
    if ((y.yearNum ?? null) !== (l.yearNum ?? null)) {
      l.yearNum = y.yearNum; l.yearSource = y.yearSource; l.yearIsCirca = y.yearIsCirca; reyear++;
    }
  }
}
console.log(`[restamp] retokenized ${retok} art lots, re-derived ${reyear} title-sourced years`);
writeGz('lots.json', lots);
writeGz('sold-archive.json', arch);
console.log('[restamp] corpus written · rebuilding served payloads…');
runMarketBuild();
