/**
 * bootstrap-segments.ts — one-time: split the current full corpus into per-
 * vertical segment files (data/corpus/segments/<name>.json.gz). After this the
 * nightly maintains each segment independently; assemble.ts reunions them.
 * Run: npx tsx scripts/bootstrap-segments.ts
 */
import { readCorpus, writeSegment, splitIntoSegments, SEGMENT_NAMES } from './corpus-io';

const all = readCorpus();
console.log(`[bootstrap] full corpus: ${all.length} lots`);
const byName = splitIntoSegments(all);
let total = 0;
for (const name of SEGMENT_NAMES) {
  const rows = byName[name] || [];
  writeSegment(name, rows);
  total += rows.length;
  console.log(`  segment ${name.padEnd(8)}: ${rows.length}`);
}
console.log(`[bootstrap] wrote ${total} lots across ${SEGMENT_NAMES.length} segments (in ${all.length})`);
if (total !== all.length) console.error(`[bootstrap] MISMATCH: ${total} != ${all.length}`);
