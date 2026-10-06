// Sotheby's / Wright history backfill — the glue around the nightly's own crawl.
// .github/workflows/backfill-history.yml runs, for house = sothebys | wright:
//   1. npx tsx scripts/backfill-history.ts makers <house> <art|watches|all|slug,slug>
//        → prints the RAY_ONLY list (validated against the roster)
//   2. cp the pulled segment → a pre-crawl snapshot
//   3. RAY_HOUSE=<house> RAY_ONLY=<list> + SOTHEBYS_HISTORY=1 (sothebys) or
//        WRIGHT_DEEP=1 (wright) npx tsx scripts/ray-crawl.ts   (the nightly path)
//   4. npx tsx scripts/backfill-history.ts union --house <house> --pre <snapshot> --makers <list> [--write]
//        → pre ∪ crawl (fresh id wins, nothing evicted) + the count report
//   5. (not on a dry run) data-store.sh push-segment <house>
//
// Local dry run of the Sotheby's pass against any segment snapshot, no write:
//   npx tsx scripts/backfill-history.ts dry-sothebys --makers jean-michel-basquiat --pre <seg.ndjson.gz> [--since 2015] [--out rows.ndjson]
import * as fs from 'fs';
import { ARTISTS } from './lib/houses/artists';
import { readGzRows, readSegment, writeSegment } from './corpus-io';
import { unionPreserving } from './lib/phillips-backfill';
import { historyCounts, resolveHistoryMakers, type HouseCounts } from './lib/history-backfill';
import { buildSothebysKnown, crawlSothebysMakerHistory } from './lib/houses/sothebys-history';

const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };

function summary(lines: string[]): void {
  for (const l of lines) console.log(l);
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) fs.appendFileSync(f, lines.map(l => `- ${l}`).join('\n') + '\n');
}

const fmtHouses = (c: HouseCounts) => Object.entries(c.byHouse).sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} ${n}`).join(' · ') || '—';
const fmtYears = (c: HouseCounts) => Object.entries(c.soldByYear).sort().map(([y, n]) => `${y}:${n}`).join(' ');

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === 'makers') {
    console.log(resolveHistoryMakers(process.argv[3] || '', process.argv[4] || '', ARTISTS).join(','));
    return;
  }
  if (cmd === 'union') {
    const house = arg('house') || '';
    resolveHistoryMakers(house, 'all', ARTISTS); // validates the house
    const preFile = arg('pre');
    if (!preFile) throw new Error('--pre <snapshot.ndjson.gz> is required');
    const makers = new Set((arg('makers') || '').split(',').filter(Boolean));
    // a missing snapshot = bootstrap (no segment in R2 yet); an UNREADABLE one throws
    const pre = fs.existsSync(preFile) && fs.statSync(preFile).size > 0 ? readGzRows(preFile) : [];
    const post = readSegment(house);
    const u = unionPreserving(pre, post);
    const cPre = historyCounts(pre), cOut = historyCounts(u.rows);
    const lines = [
      `${house} segment: ${cPre.rows} → ${cOut.rows} rows (+${u.added} new ids, ${u.refreshed} carried/refreshed, ${u.restored} restored from the pre-crawl snapshot)`,
      `sold: ${cPre.sold} → ${cOut.sold} · houses: ${fmtHouses(cOut)}`,
    ];
    if (makers.size) {
      const sPre = historyCounts(pre, makers), sOut = historyCounts(u.rows, makers);
      lines.push(`selected makers (${makers.size}): ${sPre.rows} → ${sOut.rows} rows, sold ${sPre.sold} → ${sOut.sold} · houses before: ${fmtHouses(sPre)} · after: ${fmtHouses(sOut)}`);
      lines.push(`selected makers sold by year (after): ${fmtYears(sOut)}`);
    }
    summary(lines);
    if (cOut.rows < cPre.rows) throw new Error(`union shrank ${cPre.rows} → ${cOut.rows} — impossible, refusing to write`);
    if (process.argv.includes('--write')) {
      writeSegment(house, u.rows);
      console.log(`[history-bf] wrote the union: ${u.rows.length} rows → data/corpus/segments/${house}.ndjson.gz`);
    } else {
      console.log('[history-bf] (no --write — segment file left as the crawl wrote it)');
    }
    return;
  }
  if (cmd === 'dry-sothebys') {
    const only = resolveHistoryMakers('sothebys', arg('makers') || '', ARTISTS);
    const preFile = arg('pre');
    const pre = preFile ? readGzRows(preFile) : readSegment('sothebys');
    const known = buildSothebysKnown(pre);
    const since = Number(arg('since')) || 0;
    const roster = ARTISTS.filter(a => only.includes(a.slug));
    const { lots, reports, blocked } = await crawlSothebysMakerHistory(roster, known, { sinceYear: since });
    const existing = historyCounts(pre, new Set(only));
    summary([
      `sothebys history DRY RUN · makers ${only.join(',')} · since ${since || 'all'} · snapshot ${pre.length} rows (${existing.sold} sold for these makers)`,
      ...reports.map(r => `${r.maker}: ${r.hits} sold hits → ${r.routed} this maker → ${r.rows} new rows · dedupe new ${r.dedupe.new} / supersedes-seed ${r.dedupe['supersedes-seed']} / dup-id ${r.dedupe['dup-id']} / dup-path ${r.dedupe['dup-path']} · skips ${JSON.stringify(r.skips)}`),
      `new rows: ${lots.length}${blocked ? ` · STOPPED: ${blocked}` : ''}`,
    ]);
    const out = arg('out');
    if (out) { fs.writeFileSync(out, lots.map(l => JSON.stringify(l)).join('\n') + '\n'); console.log(`[history-bf] rows → ${out} (nothing written to any segment)`); }
    return;
  }
  throw new Error('usage: backfill-history.ts makers <sothebys|wright> <art|watches|all|slug,…> | union --house <h> --pre <file> [--makers a,b] [--write] | dry-sothebys --makers <sel> [--pre <file>] [--since Y] [--out f]');
}

main().catch(e => { console.error(`[history-bf] ${(e as Error).message}`); process.exit(1); });
