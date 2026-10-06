// Union step for the per-house history backfills (backfill-goldin.yml,
// backfill-hugginsscott.yml). The crawl runs the house's own nightly path and
// writes data/corpus/segments/<house>.ndjson.gz; this then unions that over
// the pre-crawl snapshot (fresh id wins, a pre id the crawl dropped is
// restored — nothing is evicted), optionally leaving out NEW rows of the
// --skip-artists slugs, and prints the new rows by category and year:
//   npx tsx scripts/backfill-segment.ts union --house goldin --pre <snapshot.ndjson.gz> \
//     [--skip-artists sports-cards,pokemon] [--write]
// --write rewrites the segment file with the union (the workflow then gates +
// pushes it); without it the file is left as the crawl wrote it.
import * as fs from 'fs';
import { readGzRows, readSegment, writeSegment } from './corpus-io';
import { fmtCounts, parseSkipArtists, unionSlice } from './lib/segment-backfill';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };

function summary(lines: string[]): void {
  for (const l of lines) console.log(l);
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) fs.appendFileSync(f, lines.map(l => `- ${l}`).join('\n') + '\n');
}

function main(): void {
  if (process.argv[2] !== 'union') throw new Error('usage: backfill-segment.ts union --house <segment> --pre <file> [--skip-artists a,b] [--write]');
  const house = arg('house') || '';
  if (!/^[a-z0-9-]+$/.test(house)) throw new Error('--house <segment> is required');
  const preFile = arg('pre');
  if (!preFile) throw new Error('--pre <snapshot.ndjson.gz> is required');
  const skip = parseSkipArtists(arg('skip-artists'));
  // a missing snapshot = bootstrap (no segment in R2 yet); an UNREADABLE one throws
  const pre = fs.existsSync(preFile) && fs.statSync(preFile).size > 0 ? readGzRows(preFile) : [];
  const post = readSegment(house);
  const u = unionSlice(pre, post, skip);
  const preSold = pre.filter(r => r.status === 'sold').length;
  const outSold = u.rows.filter(r => r.status === 'sold').length;
  const lines = [
    `${house} segment: ${pre.length} → ${u.rows.length} rows (+${u.added} new ids, ${u.refreshed} carried/refreshed, ${u.restored} restored from the pre-crawl snapshot)`,
    `sold: ${preSold} → ${outSold} (+${u.newSold} new sold)`,
    `new rows by category: ${fmtCounts(u.newByArtist)}`,
    `new rows by sale year: ${fmtCounts(u.newByYear, true)}`,
  ];
  if (skip.size) lines.push(`left out (new rows of ${Array.from(skip).join(',')}): ${fmtCounts(u.skipped)}`);
  summary(lines);
  if (u.rows.length < pre.length) throw new Error(`union shrank ${pre.length} → ${u.rows.length} — impossible, refusing to write`);
  if (process.argv.includes('--write')) {
    writeSegment(house, u.rows);
    console.log(`[segment-bf] wrote the union: ${u.rows.length} rows → data/corpus/segments/${house}.ndjson.gz`);
  } else {
    console.log('[segment-bf] (no --write — segment file left as the crawl wrote it)');
  }
}

try { main(); } catch (e) { console.error(`[segment-bf] ${(e as Error).message}`); process.exit(1); }
