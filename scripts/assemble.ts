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
import { PRICE_BASIS } from './price-basis';
import { soldByYear, houseCoverage } from './coverage';
import * as fs from 'fs';
import * as path from 'path';
import { readAllSegments, writeCorpusAndServed, CORPUS_DIR, SERVED_DIR } from './corpus-io';
import { normalizeCorpus } from './lib/corpus-normalize';
import { computeStats } from './compute-stats';
import { ARTISTS } from '../app/constants';
import type { AuctionLot, MarketStats } from '../app/types';

const isGoldinSold = (l: Record<string, unknown>) => l.auctionHouse === 'Goldin' && l.status === 'sold';
// archive tier: Goldin's sold history plus any backfilled lot stamped archived:true
// (the RR sold-archive) — engine-visible via the full corpus, kept out of the
// client shards so served payload stays lean.
const isArchiveTier = (l: Record<string, unknown>) => isGoldinSold(l) || l.archived === true;

async function main() {
  const DATA_DIR = SERVED_DIR;
  const allLots = readAllSegments() as unknown as AuctionLot[];
  if (!allLots.length) throw new Error('[assemble] no segments found — refusing to publish an empty corpus');
  console.log(`[assemble] reunioned ${allLots.length} lots from segments`);

  // ── SANITY GATE ─────────────────────────────────────────────────────────
  // Compare to the last published totals (meta.json). A big shrink = a broken
  // or empty segment (e.g. a correlated R2 outage returning empty pulls); keep
  // the last-good payload rather than wiping the book. A corrupt/missing
  // baseline must NOT silently disable the gate — that's the exact failure that
  // lets an empty corpus ship. So: parse errors on a PRESENT baseline are fatal,
  // and even with NO baseline an absolute floor guards a catastrophic reunion.
  const CORPUS_FLOOR = 100_000; // the corpus is ~455k; anything near-empty is a bug
  const metaPath = path.join(DATA_DIR, 'meta.json');
  let prev: { totalLots?: number; totalSold?: number } | null = null;
  if (fs.existsSync(metaPath)) {
    try {
      prev = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (e) {
      throw new Error(`[assemble] baseline meta.json is PRESENT but unparseable — refusing to publish without a sanity baseline: ${(e as Error).message}`);
    }
  }
  if (prev && (prev.totalLots || 0) > 1000) {
    const prevTotal = prev.totalLots || 0;
    if (allLots.length < prevTotal * 0.9) {
      throw new Error(`[assemble] corpus shrank ${prevTotal} → ${allLots.length} (>10%) — refusing to publish (last-good stays live)`);
    }
    const prevSold = prev.totalSold || 0;
    const newSold = allLots.filter(l => l.status === 'sold').length;
    if (prevSold > 1000 && newSold < prevSold * 0.9) {
      throw new Error(`[assemble] sold book shrank ${prevSold} → ${newSold} (>10%) — refusing to publish`);
    }
    console.log(`[assemble] sanity gate OK: lots ${prevTotal}→${allLots.length}, sold ${prevSold}→${newSold}`);
  } else {
    // no usable baseline (first run) — fall back to the absolute floor
    if (allLots.length < CORPUS_FLOOR) {
      throw new Error(`[assemble] no baseline and only ${allLots.length} lots (< floor ${CORPUS_FLOOR}) — refusing to publish a near-empty corpus`);
    }
    console.log(`[assemble] no baseline meta; ${allLots.length} lots clears the ${CORPUS_FLOOR} floor`);
  }

  // ── corpus-hygiene normalization (idempotent) ──
  // Runs AFTER the sanity gate (so we never normalize a corpus we're about to
  // reject) and BEFORE the per-slug stats + corpus/served write, so the reroute,
  // year clamp, and reference back-fill are baked into the persisted corpus gz
  // and flow through stats/market/hedonic. build-market re-runs the same pass
  // idempotently on the corpus it reads.
  normalizeCorpus(allLots);

  // ── per-artist stats over the FULL corpus (build-market §3f adds the
  //    corpus-only slugs: sports-cards + culture + sports-memorabilia) ──
  const existing: Record<string, MarketStats> = {};
  const statsPath = path.join(SERVED_DIR, 'stats.json');
  if (fs.existsSync(statsPath)) { try { Object.assign(existing, JSON.parse(fs.readFileSync(statsPath, 'utf8'))); } catch { /* fresh */ } }
  // ONE group-by pass instead of a full-corpus filter per ARTISTS slug (~40
  // scans of 455k). Map push preserves allLots order, so each group is identical
  // to the old filter → computeStats output is byte-for-byte the same.
  const bySlug = new Map<string, AuctionLot[]>();
  for (const l of allLots) {
    const arr = bySlug.get(l.artist);
    if (arr) arr.push(l); else bySlug.set(l.artist, [l]);
  }
  const statsByArtist: Record<string, MarketStats> = {};
  for (const a of ARTISTS) {
    const lots = bySlug.get(a.slug);
    if (lots && lots.length) statsByArtist[a.slug] = computeStats(lots, existing[a.slug] || null);
    else if (existing[a.slug]) statsByArtist[a.slug] = existing[a.slug]; // carry a slug with no lots this run
  }

  // corpus gz + served (build-market re-writes served with the card sample)
  const io = writeCorpusAndServed(allLots as unknown as Record<string, unknown>[], isArchiveTier);
  console.log(`[assemble] wrote corpus ${io.corpusMb}+${io.archiveMb}MB gz | served ${io.servedMb}MB`);
  fs.mkdirSync(SERVED_DIR, { recursive: true });
  fs.writeFileSync(statsPath, JSON.stringify(statsByArtist, null, 2));
  fs.writeFileSync(metaPath, JSON.stringify({
    lastCrawl: new Date().toISOString(),
    artists: ARTISTS.map(a => ({ slug: a.slug, displayName: a.label })),
    sources: Array.from(new Set(allLots.map(l => l.auctionHouse))).sort(),
    totalLots: allLots.length,
    totalSold: allLots.filter(l => l.status === 'sold').length,
    // Both of these were missing here while ray-crawl.ts wrote them, and
    // assemble runs LAST in the segmented nightly — so the segmented path
    // silently shipped a meta.json without the price-basis declaration.
    priceBasis: PRICE_BASIS,
    soldByYear: soldByYear(allLots),
    coverage: houseCoverage(allLots),
    version: 2,
  }, null, 2));

  const { runMarketBuild } = await import('./build-market');
  await runMarketBuild();
  console.log(`[assemble] done — corpus in ${CORPUS_DIR}, served in ${SERVED_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
