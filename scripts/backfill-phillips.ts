// Phillips full-history backfill — the glue around the nightly's own crawl.
// .github/workflows/backfill-phillips.yml runs:
//   1. npx tsx scripts/backfill-phillips.ts makers <watches|art|all|slug,slug>
//        → prints the RAY_ONLY list (validated against the roster)
//   2. cp the pulled segment → a pre-crawl snapshot
//   3. RAY_HOUSE=phillips RAY_ONLY=<list> PHILLIPS_DEEP=1 [PHILLIPS_MAX_PAGES=N]
//        npx tsx scripts/ray-crawl.ts      (the nightly path, full history)
//   4. npx tsx scripts/backfill-phillips.ts union --pre <snapshot> --makers <list> [--write]
//        → pre ∪ crawl (fresh id wins, nothing evicted) + the count report;
//          --write rewrites data/corpus/segments/phillips.ndjson.gz with the union
//   5. (not on a dry run) data-store.sh push-segment phillips
import * as fs from 'fs';
import { ARTISTS } from './lib/houses/artists';
import { readGzRows, readSegment, writeSegment } from './corpus-io';
import { phillipsCounts, resolvePhillipsMakers, unionPreserving } from './lib/phillips-backfill';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };

function summary(lines: string[]): void {
  for (const l of lines) console.log(l);
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) fs.appendFileSync(f, lines.map(l => `- ${l}`).join('\n') + '\n');
}

function main(): void {
  const cmd = process.argv[2];
  if (cmd === 'makers') {
    const spec = process.argv[3] || '';
    console.log(resolvePhillipsMakers(spec, ARTISTS).join(','));
    return;
  }
  if (cmd === 'union') {
    const preFile = arg('pre');
    if (!preFile) throw new Error('--pre <snapshot.ndjson.gz> is required');
    const makers = new Set((arg('makers') || '').split(',').filter(Boolean));
    // a missing snapshot = bootstrap (no segment in R2 yet); an UNREADABLE one throws
    const pre = fs.existsSync(preFile) && fs.statSync(preFile).size > 0 ? readGzRows(preFile) : [];
    const post = readSegment('phillips');
    const u = unionPreserving(pre, post);
    const cPre = phillipsCounts(pre), cOut = phillipsCounts(u.rows);
    const sPre = makers.size ? phillipsCounts(pre, makers) : null;
    const sOut = makers.size ? phillipsCounts(u.rows, makers) : null;
    const lines = [
      `phillips segment: ${cPre.rows} → ${cOut.rows} rows (+${u.added} new ids, ${u.refreshed} carried/refreshed, ${u.restored} restored from the pre-crawl snapshot)`,
      `sold: ${cPre.sold} → ${cOut.sold} · watch-maker rows: ${cPre.watches} → ${cOut.watches}`,
      `houseReference rows: ${cPre.withHouseReference} → ${cOut.withHouseReference}`,
    ];
    if (sPre && sOut) lines.push(`selected makers (${makers.size}): ${sPre.rows} → ${sOut.rows} rows, sold ${sPre.sold} → ${sOut.sold}, houseReference ${sPre.withHouseReference} → ${sOut.withHouseReference}`);
    summary(lines);
    if (cOut.rows < cPre.rows) throw new Error(`union shrank ${cPre.rows} → ${cOut.rows} — impossible, refusing to write`);
    if (process.argv.includes('--write')) {
      writeSegment('phillips', u.rows);
      console.log(`[phillips-bf] wrote the union: ${u.rows.length} rows → data/corpus/segments/phillips.ndjson.gz`);
    } else {
      console.log('[phillips-bf] (no --write — segment file left as the crawl wrote it)');
    }
    return;
  }
  throw new Error(`usage: backfill-phillips.ts makers <watches|art|all|slug,…> | union --pre <file> [--makers a,b] [--write]`);
}

try { main(); } catch (e) { console.error(`[phillips-bf] ${(e as Error).message}`); process.exit(1); }
