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

export type SentinelSignature = { house: string; price: number; n: number; top: number; topDate: string; hammer: number; honest: boolean };

/**
 * The price-bleed sentinel's DECISION, extracted pure so it is testable
 * (scripts/__tests__/sentinel-gate.test.ts). See the long note at the call site
 * for why this is a DELTA gate and not an absolute one.
 *
 * `prevSigs` is the last PUBLISHED signature set keyed `house|price`.
 */
export function sentinelVerdict(
  sentinel: SentinelSignature[],
  prevSigs: Map<string, number>,
  opts: { catastrophicN?: number; newPoisonAbort?: number } = {},
): { abort: boolean; reason: 'catastrophic' | 'new-poison' | null; poison: SentinelSignature[]; freshPoison: SentinelSignature[]; catastrophic: SentinelSignature[]; hasBaseline: boolean } {
  const CATASTROPHIC_N = opts.catastrophicN ?? 500;
  const NEW_POISON_ABORT = opts.newPoisonAbort ?? 2;
  const hasBaseline = prevSigs.size > 0;
  const poison = sentinel.filter(s => !s.honest);
  // A known cluster may legitimately grow as a house's sale is re-crawled and
  // more lots resolve at the same rung — only a MATERIAL jump reads as new.
  const freshPoison = poison.filter(s => {
    const prevN = prevSigs.get(`${s.house}|${s.price}`);
    return prevN === undefined || s.n > Math.max(prevN + 25, prevN * 1.5);
  });
  // Absolute backstop that survives ANY baseline: no honest bid ladder stamps
  // one price across 500+ lots. Aborts even if already in the baseline.
  const catastrophic = poison.filter(s => s.n >= CATASTROPHIC_N);
  if (catastrophic.length) return { abort: true, reason: 'catastrophic', poison, freshPoison, catastrophic, hasBaseline };
  if (hasBaseline && freshPoison.length >= NEW_POISON_ABORT) return { abort: true, reason: 'new-poison', poison, freshPoison, catastrophic, hasBaseline };
  return { abort: false, reason: null, poison, freshPoison, catastrophic, hasBaseline };
}

async function main() {
  const DATA_DIR = SERVED_DIR;
  const allLotsRaw = readAllSegments() as unknown as AuctionLot[];
  if (!allLotsRaw.length) throw new Error('[assemble] no segments found — refusing to publish an empty corpus');
  // JUNK GATE (Aug 13 audit): broken scrapes that carry CSS instead of a title
  // (435 rows, Lelands/LOTG windows-era) and the one "Lot Withdrawn … Status:
  // Sold" row — dead weight in token space, never a real lot.
  const JUNK_TITLE = /\.pagination\s*\{|\{\s*clear:\s*both|^\d*\s*Lot Withdrawn\b/i;
  const allLots = allLotsRaw.filter(l => !JUNK_TITLE.test(String(l.title || '')));
  if (allLotsRaw.length !== allLots.length) console.log(`[assemble] junk gate dropped ${allLotsRaw.length - allLots.length} rows`);
  // CONTENT DEDUPE (Aug 13 audit): ~9k sold rows duplicated under distinct ids
  // (double-crawls: same house + saleDate + price + title). Conservative key,
  // sold rows only, keep the lexically-first id (deterministic).
  {
    const seen = new Map<string, string>();
    const drop = new Set<string>();
    for (const l of allLots) {
      if (l.status !== 'sold' || !(l.priceUsd || (l as { realizedUsd?: number }).realizedUsd)) continue;
      const key = `${l.auctionHouse}|${l.saleDate}|${l.priceUsd ?? (l as { realizedUsd?: number }).realizedUsd}|${String(l.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      const prev = seen.get(key);
      if (prev === undefined) seen.set(key, String(l.id));
      else if (String(l.id) < prev) { drop.add(prev); seen.set(key, String(l.id)); }
      else drop.add(String(l.id));
    }
    if (drop.size) {
      const before = allLots.length;
      for (let i = allLots.length - 1; i >= 0; i--) if (drop.has(String(allLots[i].id))) allLots.splice(i, 1);
      console.log(`[assemble] content dedupe dropped ${before - allLots.length} duplicate sold rows`);
    }
  }
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
  let prev: {
    totalLots?: number; totalSold?: number;
    // the sentinel signature set from the LAST PUBLISHED corpus — the baseline
    // the price-bleed gate diffs against (see SENTINEL PRICE WATCH below)
    sentinel?: { checkedAt?: string; signatures?: SentinelSignature[] };
  } | null = null;
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

  // ── SENTINEL PRICE WATCH (Aug 30 2026, the NFL idwalk lesson; teeth added
  // Sep 2 2026, P1-8) — poisoned feeds stamp ONE price across a batch ($10,050
  // ×3,622 NFL idwalk; $3.1M ×27 Lelands gallery bleed). A POISON SIGNATURE =
  // one price ≥ $1,000 repeating ≥15× with ≥60% of the repeats on ONE saleDate,
  // EXCLUDING honest increment × premium ties: if price ÷ the house's premium
  // factor is a round bid increment ($1,000 × 1.22 = $1,220 ×40 inside one big
  // card sale), the repeat is a real clustering of bids, not a bleed. Every
  // signature is emitted as a GitHub `::warning::` annotation and written into
  // meta.json (`sentinel`); ≥2 DISTINCT poison signatures abort the publish
  // (exit non-zero — the last-good payload stays live). RAY_SENTINEL_WARN_ONLY=1
  // downgrades to warnings for a deliberate re-run after inspection.
  const sentinel: { house: string; price: number; n: number; top: number; topDate: string; hammer: number; honest: boolean }[] = [];
  {
    const { lotAllInFactor, isRoundIncrement } = await import('../app/lib/premiums');
    const byHouse = new Map<string, Map<number, Map<string, number>>>();
    for (const l of allLots) {
      if (l.status !== 'sold') continue;
      const p = (l as { realizedUsd?: number; priceUsd?: number }).realizedUsd
        ?? (l as { priceUsd?: number }).priceUsd;
      if (!(p! >= 1000)) continue;
      const h = l.auctionHouse || '?';
      const m = byHouse.get(h) || new Map<number, Map<string, number>>(); byHouse.set(h, m);
      const d = m.get(p!) || new Map<string, number>(); m.set(p!, d);
      d.set(l.saleDate || '?', (d.get(l.saleDate || '?') || 0) + 1);
    }
    byHouse.forEach((m, h) => m.forEach((d, p) => {
      let n = 0, top = 0, topDate = '';
      d.forEach((c, dt) => { n += c; if (c > top) { top = c; topDate = dt; } });
      if (n >= 15 && top / n >= 0.6) {
        const hammer = p / lotAllInFactor({ auctionHouse: h }, p);
        const honest = isRoundIncrement(hammer);
        sentinel.push({ house: h, price: p, n, top, topDate, hammer: Math.round(hammer * 100) / 100, honest });
      }
    }));
    sentinel.sort((a, b) => b.n - a.n);
    const poison = sentinel.filter(s => !s.honest);

    // ── DELTA GATE (Sep 9 2026) ────────────────────────────────────────────
    // The absolute form of this gate (`poison.length >= 2` → abort, added Sep 2
    // in fdd9791) wedged EVERY publish for a week: a 1.14M-lot corpus spanning
    // 25 years legitimately carries dozens of standing repeat-price clusters —
    // a 10% GEOMETRIC bid ladder at Lelands (1050/1155/1271/1398/1538/1692…)
    // that isRoundIncrement() can't see because it only knows FLAT round steps;
    // REA backfill rows stamped with a placeholder April-15 saleDate, which
    // piles lots onto one date and trips the ≥60%-one-date rule; 2002-2020
    // Christie's/Sotheby's whose implied hammer never looks round because the
    // honesty test divides an OLD price by TODAY's premium factor. None of that
    // is bleed, and none of it is actionable — it's the standing shape of the
    // book. Gating on the ABSOLUTE count just means never publishing again.
    //
    // What actually signals a broken crawler is a repeat cluster that WASN'T
    // THERE YESTERDAY ($10,050 ×3,622 appeared the night NFL's idwalk broke).
    // So diff against the last published signature set (meta.json `sentinel`,
    // pulled by the "Pull previous totals" step) and abort only on NEW ones.
    // Mirrors the corpus-shrink gate directly above, which is delta and works.
    const prevSigs = new Map<string, number>();
    for (const s of prev?.sentinel?.signatures ?? []) {
      if (s && typeof s.house === 'string' && typeof s.price === 'number') prevSigs.set(`${s.house}|${s.price}`, Number(s.n) || 0);
    }
    const verdict = sentinelVerdict(sentinel, prevSigs);
    const { hasBaseline, freshPoison, catastrophic } = verdict;

    for (const s of sentinel) {
      const known = prevSigs.has(`${s.house}|${s.price}`);
      const tag = s.honest ? 'honest tie' : (known ? 'POISON (known/standing)' : 'POISON (NEW)');
      const msg = `[assemble] SENTINEL ${tag}: ${s.house} $${s.price.toLocaleString()} ×${s.n} (${s.top} on ${s.topDate}; hammer ${s.hammer}${s.honest ? ' = round increment' : ''})`;
      if (s.honest || known) console.log(msg);
      else { console.warn(msg); console.log(`::warning title=sentinel price bleed::${s.house} $${s.price.toLocaleString()} x${s.n} (${s.top} on ${s.topDate}) — NEW repeat cluster; inspect before trusting comps`); }
    }

    const override = process.env.RAY_SENTINEL_WARN_ONLY === '1';
    if (verdict.abort && !override) {
      if (verdict.reason === 'catastrophic') {
        const d = catastrophic.map(s => `${s.house} $${s.price} ×${s.n}`).join('; ');
        console.log(`::error title=sentinel abort::catastrophic repeat cluster — refusing to publish (${d})`);
        throw new Error(`[assemble] SENTINEL ABORT (catastrophic): ${d} — one price on 500+ lots is a stamped feed, not bidding. Refusing to publish (RAY_SENTINEL_WARN_ONLY=1 to override after inspection).`);
      }
      const d = freshPoison.slice(0, 4).map(s => `${s.house} $${s.price} ×${s.n}`).join('; ');
      console.log(`::error title=sentinel abort::${freshPoison.length} NEW poison price signatures — refusing to publish`);
      throw new Error(`[assemble] SENTINEL ABORT: ${freshPoison.length} NEW poison signatures vs the last published baseline (${d}) — refusing to publish (RAY_SENTINEL_WARN_ONLY=1 to override after inspection).`);
    }
    if (verdict.abort && override) console.log(`[assemble] sentinel WOULD have aborted (${verdict.reason}) — RAY_SENTINEL_WARN_ONLY=1 override in effect`);
    if (!hasBaseline) {
      // First run after this change, or a baseline with no sentinel block. We
      // can't diff, so we DON'T gate on the standing set (that's the wedge we
      // just removed) — the catastrophic backstop above still applies, and this
      // run's signatures become tomorrow's baseline.
      console.log(`::warning title=sentinel bootstrap::no sentinel baseline in meta.json — recording ${sentinel.length} signatures as the baseline; only the catastrophic backstop applied this run`);
    }
    console.log(`[assemble] sentinel: ${sentinel.length} repeat signatures, ${poison.length} poison (${freshPoison.length} NEW vs baseline of ${prevSigs.size}), ${sentinel.length - poison.length} honest increment×premium ties${override ? ' — WARN_ONLY override active' : ''}`);
  }

  // ── corpus-hygiene normalization (idempotent) ──
  // Runs AFTER the sanity gate (so we never normalize a corpus we're about to
  // reject) and BEFORE the per-slug stats + corpus/served write, so the reroute,
  // year clamp, and reference back-fill are baked into the persisted corpus gz
  // and flow through stats/market/hedonic. build-market re-runs the same pass
  // idempotently on the corpus it reads.
  const preNormalize = allLots.length;
  normalizeCorpus(allLots);
  // The sanity gate above ran on the PRE-normalize array; normalize passes can
  // now compact it (mirror dedupe, science evictions). Re-assert so a runaway
  // pass can never ship an eviscerated corpus that becomes tomorrow's baseline.
  if (allLots.length < preNormalize * 0.9) {
    throw new Error(`[assemble] normalize dropped ${preNormalize} → ${allLots.length} (>10%) — refusing to publish`);
  }

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
    // the sentinel price watch's findings (P1-8): every ≥15× repeat signature
    // with its honesty verdict, so a poisoned night is inspectable after the fact
    sentinel: { checkedAt: new Date().toISOString(), signatures: sentinel },
    version: 2,
  }, null, 2));

  const { runMarketBuild } = await import('./build-market');
  await runMarketBuild();
  console.log(`[assemble] done — corpus in ${CORPUS_DIR}, served in ${SERVED_DIR}`);
}

// RAY_SKIP_MAIN=1 lets the module be IMPORTED without running the pipeline —
// the repo-wide convention (close-board, the crawlers, the backfills all use
// it). scripts/__tests__/sentinel-gate.test.ts imports sentinelVerdict this way.
if (process.env.RAY_SKIP_MAIN !== '1') main().catch(e => { console.error(e); process.exit(1); });
