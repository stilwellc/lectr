/**
 * One-off: legacy watch lots misrouted into the science slugs before the
 * router's "a skeletonized watch dial is not a fossil" guard existed — the
 * merge never re-derives artist for existing rows, so they persisted. Tracked
 * watch makers are re-routed to their own slug; untracked watch brands are
 * evicted (doctrine: untracked makers are never kept). Rebuilds served data.
 * Run: npx tsx scripts/fix-science-misroutes.ts
 */
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import { runMarketBuild } from './build-market';

const CORPUS = path.join(process.cwd(), 'data', 'corpus');
const readGz = (f: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(CORPUS, f + '.gz'))).toString('utf8'));
const writeGz = (f: string, d: unknown) => fs.writeFileSync(path.join(CORPUS, f + '.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(d))));

const SCI = new Set(['meteorites', 'fossils', 'space-exploration', 'scientific-instruments']);
const WATCHY = /\b(wristwatch|montre|richard mille|hublot|jaeger|vacheron|piaget|breguet|blancpain|girard|panerai|skeletoni[sz]ed|squelette|big bang|tourbillon)\b/i;
const SCICTX = /\b(meteorite|fossil|dinosaur|trilobite|ammonite|apollo|nasa|lunar|astronaut|space|telescope|microscope|enigma|marine chronometer|sextant|slide rule)\b/i;
const TRACKED: [RegExp, string][] = [[/\brolex\b/i, 'rolex'], [/\bpatek\b/i, 'patek-philippe'], [/\baudemars\b/i, 'audemars-piguet'], [/\bomega\b/i, 'omega'], [/\bcartier\b/i, 'cartier']];

type Lot = { id: string; artist: string; title?: string; medium?: string | null };
const lots: Lot[] = readGz('lots.json');
const arch: Lot[] = readGz('sold-archive.json');
let rerouted = 0, evicted = 0;
const keep = (arr: Lot[]) => arr.filter(l => {
  if (!SCI.has(l.artist)) return true;
  const t = `${l.title || ''} ${l.medium || ''}`;
  if (!WATCHY.test(t) || SCICTX.test(t)) return true;
  const tracked = TRACKED.find(([re]) => re.test(t));
  if (tracked) { l.artist = tracked[1]; rerouted++; return true; }
  evicted++; return false;
});
const l2 = keep(lots), a2 = keep(arch);
console.log(`[fix] re-routed ${rerouted} tracked-maker watches, evicted ${evicted} untracked watch lots from science slugs`);
writeGz('lots.json', l2);
writeGz('sold-archive.json', a2);
runMarketBuild();
