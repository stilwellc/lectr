/**
 * gen-coverage.ts — regenerate app/about/coverage.json from the corpus.
 *
 * /about prefers meta.json's `coverage` block (written fresh by every crawl and
 * assemble). This committed snapshot is the fallback for the case that would
 * otherwise break the build: public/data/ray/ is gitignored and pulled from R2
 * at build time, so a CI build that runs before the first nightly carrying the
 * new field would find no `coverage` at all.
 *
 * Coverage moves slowly — a house's first year never changes — so the snapshot
 * only needs regenerating when a house is added or a backfill lands.
 *
 *   npx tsx scripts/_qa/gen-coverage.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCorpus } from '../corpus-io';
import { houseCoverage } from '../coverage';
import type { AuctionLot } from '../../app/types';

const lots = readCorpus() as unknown as AuctionLot[];
const coverage = houseCoverage(lots);

const out = path.join(process.cwd(), 'app', 'about', 'coverage.json');
fs.writeFileSync(out, JSON.stringify({
  _what: 'Per-house archive coverage for /about §01. Regenerate with: npx tsx scripts/_qa/gen-coverage.ts',
  _note: '`first` is the earliest settled record; `dense` is the first year with >=25 — drawn faint between them so one stray lot cannot claim a decade.',
  generatedAt: new Date().toISOString(),
  coverage,
}, null, 2) + '\n');

console.log(`[gen-coverage] ${coverage.length} houses -> ${path.relative(process.cwd(), out)}`);
for (const c of coverage) {
  console.log(`  ${c.house.padEnd(12)} ${c.first}${c.dense !== c.first ? ` (dense ${c.dense})` : ''} -> ${c.last}  n=${c.n.toLocaleString()}`);
}
