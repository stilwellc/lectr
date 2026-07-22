/**
 * assemble.ts — stage 2 of the segmented nightly. Reunions every per-vertical
 * segment (written independently by the crawl-<segment> jobs) into the full
 * corpus, then runs the engine + writes the served payloads. This is the ONLY
 * job that loads the whole corpus, so it carries the big heap; the crawl jobs
 * stay bounded to their own vertical.
 *
 * SANITY GATE: refuses to publish if the reunioned corpus is dramatically
 * smaller than the last published one (a crawl bug or an empty segment must
 * never wipe the book) — the last-good served payload stays live instead.
 *
 * Run: NODE_OPTIONS=--max-old-space-size=10240 npx tsx scripts/assemble.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { readAllSegments, writeCorpusAndServed, CORPUS_DIR, SERVED_DIR } from './corpus-io';
import { computeStats } from './compute-stats';
import { ARTISTS } from '../app/constants';
import type { AuctionLot, MarketStats } from '../app/types';

const isGoldinSold = (l: Record<string, unknown>) => l.auctionHouse === 'Goldin' && l.status === 'sold';

async function main() {
  const DATA_DIR = SERVED_DIR;
  const allLots = readAllSegments() as unknown as AuctionLot[];
  if (!allLots.length) throw new Error('[assemble] no segments found — refusing to publish an empty corpus');
  console.log(`[assemble] reunioned ${allLots.length} lots from segments`);

  // ── SANITY GATE ─────────────────────────────────────────────────────────
  // Compare to the last published totals (meta.json). A big shrink = a broken
  // or empty segment; keep the last-good payload rather than wiping the book.
  const metaPath = path.join(DATA_DIR, 'meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const prevTotal = prev.totalLots || 0;
      if (prevTotal > 1000 && allLots.length < prevTotal * 0.9) {
        throw new Error(`[assemble] corpus shrank ${prevTotal} → ${allLots.length} (>10%) — refusing to publish (last-good stays live)`);
      }
      const prevSold = prev.totalSold || 0;
      const newSold = allLots.filter(l => l.status === 'sold').length;
      if (prevSold > 1000 && newSold < prevSold * 0.9) {
        throw new Error(`[assemble] sold book shrank ${prevSold} → ${newSold} (>10%) — refusing to publish`);
      }
      console.log(`[assemble] sanity gate OK: lots ${prevTotal}→${allLots.length}, sold ${prevSold}→${newSold}`);
    } catch (e) {
      if (String(e).includes('refusing to publish')) throw e;
      console.warn('[assemble] sanity gate skipped:', (e as Error).message);
    }
  }

  // ── per-artist stats over the FULL corpus (build-market §3f adds the
  //    corpus-only slugs: sports-cards + culture + sports-memorabilia) ──
  const existing: Record<string, MarketStats> = {};
  const statsPath = path.join(SERVED_DIR, 'stats.json');
  if (fs.existsSync(statsPath)) { try { Object.assign(existing, JSON.parse(fs.readFileSync(statsPath, 'utf8'))); } catch { /* fresh */ } }
  const statsByArtist: Record<string, MarketStats> = {};
  for (const a of ARTISTS) {
    const lots = allLots.filter(l => l.artist === a.slug);
    if (lots.length) statsByArtist[a.slug] = computeStats(lots, existing[a.slug] || null);
    else if (existing[a.slug]) statsByArtist[a.slug] = existing[a.slug]; // carry a slug with no lots this run
  }

  // corpus gz + served (build-market re-writes served with the card sample)
  const io = writeCorpusAndServed(allLots as unknown as Record<string, unknown>[], isGoldinSold);
  console.log(`[assemble] wrote corpus ${io.corpusMb}+${io.archiveMb}MB gz | served ${io.servedMb}MB`);
  fs.mkdirSync(SERVED_DIR, { recursive: true });
  fs.writeFileSync(statsPath, JSON.stringify(statsByArtist, null, 2));
  fs.writeFileSync(metaPath, JSON.stringify({
    lastCrawl: new Date().toISOString(),
    artists: ARTISTS.map(a => ({ slug: a.slug, displayName: a.label })),
    sources: Array.from(new Set(allLots.map(l => l.auctionHouse))).sort(),
    totalLots: allLots.length,
    totalSold: allLots.filter(l => l.status === 'sold').length,
    version: 2,
  }, null, 2));

  const { runMarketBuild } = await import('./build-market');
  await runMarketBuild();
  console.log(`[assemble] done — corpus in ${CORPUS_DIR}, served in ${SERVED_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
