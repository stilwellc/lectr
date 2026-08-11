// Targeted Bonhams backfill for newly-added art makers — Typesense returns all
// of an artist's lots directly, so this pulls their full Bonhams history and
// MERGES into the bonhams segment (union by id; aborts if any existing artist's
// count drops). Safe, fast — no full re-crawl. Run:
//   1. wrangler r2 object get …/bonhams.ndjson.gz → data/corpus/segments/bonhams.ndjson.gz
//   2. RAY_SKIP_MAIN=1 npx tsx scripts/backfill-bonhams-artists.ts --write
//   3. wrangler r2 object put the merged segment back
import { crawlBonhams, ARTISTS } from './ray-crawl';
import { readSegment, writeSegment } from './corpus-io';
import { assertInvariants } from '../app/lib/validate';
import type { AuctionLot } from '../app/types';

// the six added Aug 2026
const NEW = new Set(['jean-michel-basquiat', 'roy-lichtenstein', 'francis-bacon', 'alexander-calder', 'rashid-johnson', 'jeff-koons']);

async function main() {
  const makers = ARTISTS.filter((a) => NEW.has(a.slug) && a.bonhams);
  console.log(`[bf-bonhams] crawling ${makers.length} new makers: ${makers.map(m => m.slug).join(', ')}`);

  const fresh: AuctionLot[] = [];
  for (const a of makers) {
    try { const lots = await crawlBonhams(a); console.log(`  [bf-bonhams] ${a.slug}: ${lots.length}`); fresh.push(...lots); }
    catch (e) { console.error(`  [bf-bonhams] ${a.slug} failed:`, (e as Error).message); }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`[bf-bonhams] crawled ${fresh.length} lots for the new makers`);

  const existing = readSegment('bonhams') as unknown as AuctionLot[];
  if (!existing.length) { console.error('[bf-bonhams] ABORT: bonhams segment empty — pull it from R2 first'); process.exit(1); }
  const before: Record<string, number> = {};
  for (const l of existing) before[l.artist] = (before[l.artist] || 0) + 1;

  const byId = new Map<string, AuctionLot>();
  for (const l of existing) if (l && l.id) byId.set(l.id, l);
  // ONLY ADD new ids — a Bonhams lot can match several artist searches (same id),
  // so overwriting would re-attribute an existing lot and drop it from its
  // current maker. Keep existing attributions; add only genuinely-new lots.
  let added = 0;
  for (const l of fresh) if (l && l.id && !byId.has(l.id)) { byId.set(l.id, l); added++; }
  console.log(`[bf-bonhams] ${fresh.length} crawled → ${added} genuinely new (rest already in segment)`);
  const union = Array.from(byId.values());

  const after: Record<string, number> = {};
  for (const l of union) after[l.artist] = (after[l.artist] || 0) + 1;
  // SAFETY: no existing artist may lose lots
  for (const k of Object.keys(before)) if ((after[k] || 0) < before[k]) { console.error(`[bf-bonhams] ABORT: ${k} dropped ${before[k]}→${after[k]||0}`); process.exit(1); }
  console.log(`[bf-bonhams] segment ${existing.length} → ${union.length} (+${union.length - existing.length})`);
  for (const a of makers) console.log(`  ${a.slug}: ${after[a.slug] || 0}`);

  const rep = assertInvariants(union);
  console.log(`[bf-bonhams] invariant FATALs: ${rep.fatal.length}`);
  rep.fatal.slice(0, 8).forEach((f) => console.error('  FATAL', f));
  if (rep.fatal.length) { console.error('[bf-bonhams] ABORT: FATALs'); process.exit(1); }

  if (process.argv.includes('--write')) {
    writeSegment('bonhams', union as unknown as Record<string, unknown>[]);
    console.log(`[bf-bonhams] wrote merged bonhams segment (${union.length}) — now: wrangler r2 object put`);
  } else console.log('[bf-bonhams] dry run (pass --write to persist)');
}
main().catch((e) => { console.error('[bf-bonhams] fatal', e); process.exit(1); });
