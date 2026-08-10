// LAMA deep backfill — walks the FULL paginator per tracked maker (pages 2..30,
// beyond the nightly's page-1 window) and merges the deep history INTO the
// shared `wright` segment (LAMA rides wright, alongside Wright/Rago). Preserves
// Wright/Rago untouched — pure union by id, only adds LAMA lots. Run:
//   1. wrangler r2 object get …/wright.ndjson.gz → data/corpus/segments/wright.ndjson.gz
//   2. RAY_SKIP_MAIN=1 RAY_DEEP=1 npx tsx scripts/backfill-lama.ts
//   3. wrangler r2 object put the merged segment back
import { crawlLama, ARTISTS } from './ray-crawl';
import { readSegment, writeSegment } from './corpus-io';
import { assertInvariants } from '../app/lib/validate';
import type { AuctionLot } from '../app/types';

async function main() {
  if (process.env.RAY_DEEP !== '1') console.warn('[bf-lama] RAY_DEEP != 1 — only page 1 per maker (set RAY_DEEP=1 for the deep walk)');
  const makers = ARTISTS.filter((a) => a.wright || a.lama);
  console.log(`[bf-lama] deep-crawling LAMA for ${makers.length} makers`);

  const lamaLots: AuctionLot[] = [];
  for (const a of makers) {
    try {
      const lots = await crawlLama(a);
      console.log(`  [bf-lama] ${a.slug}: ${lots.length}`);
      lamaLots.push(...lots);
    } catch (e) { console.error(`  [bf-lama] ${a.slug} failed:`, (e as Error).message); }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`[bf-lama] crawled ${lamaLots.length} LAMA lots total`);

  // merge into the pulled wright segment — union by id, LAMA wins its own ids,
  // Wright/Rago preserved verbatim.
  const existing = readSegment('wright') as unknown as AuctionLot[];
  const before: Record<string, number> = {};
  for (const l of existing) before[l.auctionHouse] = (before[l.auctionHouse] || 0) + 1;
  console.log('[bf-lama] existing wright segment:', existing.length, before);
  if (!existing.length) { console.error('[bf-lama] ABORT: wright segment empty — pull it from R2 first (never publish a segment that drops Wright/Rago)'); process.exit(1); }

  const byId = new Map<string, AuctionLot>();
  for (const l of existing) if (l && l.id) byId.set(l.id, l);
  const lamaBefore = existing.filter((l) => l.auctionHouse === 'LAMA').length;
  for (const l of lamaLots) if (l && l.id) byId.set(l.id, l);
  const union = Array.from(byId.values());

  const after: Record<string, number> = {};
  for (const l of union) after[l.auctionHouse] = (after[l.auctionHouse] || 0) + 1;
  console.log('[bf-lama] merged wright segment:', union.length, after);

  // SAFETY: Wright + Rago counts must NOT drop; LAMA must grow.
  if ((after['Wright'] || 0) < (before['Wright'] || 0) || (after['Rago'] || 0) < (before['Rago'] || 0)) {
    console.error('[bf-lama] ABORT: Wright/Rago count dropped — refusing to publish'); process.exit(1);
  }
  console.log(`[bf-lama] LAMA ${lamaBefore} → ${after['LAMA']} (+${(after['LAMA'] || 0) - lamaBefore})`);

  const report = assertInvariants(union);
  console.log(`[bf-lama] invariant FATALs: ${report.fatal.length} | warns: ${report.warn.length}`);
  report.fatal.slice(0, 8).forEach((f) => console.error('  FATAL', f));
  if (report.fatal.length) { console.error('[bf-lama] ABORT: FATALs'); process.exit(1); }

  if (process.argv.includes('--write')) {
    writeSegment('wright', union as unknown as Record<string, unknown>[]);
    console.log(`[bf-lama] wrote merged wright segment (${union.length} lots) — now: wrangler r2 object put`);
  } else {
    console.log('[bf-lama] dry run (pass --write to persist the merged segment)');
  }
}
main().catch((e) => { console.error('[bf-lama] fatal', e); process.exit(1); });
