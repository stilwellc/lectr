/**
 * read-ladder-study.ts — can each market climb the read ladder?
 *
 * The ladder, best to worst (Collin's priority, Aug 6 2026):
 *   1. repeat-sale   — the same object/model priced twice; no quality-mix assumption
 *   2. hedonic       — CI-gated quality-controlled index (incl. bottom-up composite)
 *   3. demand        — %-over-estimate; measured but relative to house guesses (LOW)
 *   4. typical price — descriptive average; not a movement claim at all (LOWEST)
 *
 * This study RUNS the candidate upgrades rather than speculating:
 *   E1  watches vertical + per-family repeat-sale, key = artist|reference
 *   E2  design vertical + per-maker repeat-sale, key = artist|modelKey
 *   E3  art editions repeat-sale, key = artist|normalized title (prints/multiples only)
 *   E4  culture/science pair feasibility, key = artist|normalized title
 *   E5  watch-family drill hedonic (maker-mode on the family pool)
 *
 * Every result prints: pairs/objects, per-horizon publishable, changePct, CI,
 * and the abstention reason — the same gates production uses. No gate is
 * loosened anywhere in this study: an upgrade only counts if it clears the
 * existing bars.
 *
 *   NODE_OPTIONS=--max-old-space-size=10240 npx tsx scripts/_qa/read-ladder-study.ts
 */
import { readCorpus } from '../corpus-io';
import { buildRepeatSaleIndex, type RepeatSaleResult } from '../repeat-sales';
import { buildMakerIndex } from '../hedonic-index';
import { ARTISTS } from '../../app/constants';
import type { AuctionLot } from '../../app/types';

const MARKET_OF: Record<string, string> = Object.fromEntries(ARTISTS.map((a) => [a.slug, a.market]));

const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const all = readCorpus() as unknown as AuctionLot[];
const sold = all.filter((l) => l.status === 'sold' && (l.realizedUsd || l.priceUsd) && l.saleDate);
console.log(`[study] corpus ${all.length.toLocaleString()} · sold ${sold.length.toLocaleString()} (${el()})`);

const byMarket = new Map<string, AuctionLot[]>();
for (const l of sold) {
  const m = MARKET_OF[l.artist] || l.category || 'other';
  (byMarket.get(m) ?? byMarket.set(m, []).get(m)!).push(l);
}

function reportRS(tag: string, r: RepeatSaleResult | null) {
  if (!r) { console.log(`  ${tag}: engine returned null`); return; }
  const head = `pairs ${r.nPairs ?? '?'} · objects ${r.nObjects ?? '?'}`;
  if (!r.horizons) { console.log(`  ${tag}: ${head} — no horizons (${(r as { reason?: string }).reason ?? 'below index floor'})`); return; }
  const parts: string[] = [];
  for (const [k, h] of Object.entries(r.horizons)) {
    if (!h) continue;
    parts.push(h.publishable
      ? `${k}: ✓ ${h.changePct!.toFixed(1)}% [${h.ciLoPct!.toFixed(1)},${h.ciHiPct!.toFixed(1)}]`
      : `${k}: ✗ ${(h.reason || '').slice(0, 64)}`);
  }
  console.log(`  ${tag}: ${head}\n     ${parts.join('\n     ')}`);
}

/** normalized title for edition-level identity: lowercase, strip numbering,
 *  punctuation, sizes — so "Untitled (Fright Wig), 1986, 22/50" pairs with
 *  its edition siblings. Model-level identity, like a watch reference. */
function editionTitle(l: AuctionLot): string | null {
  const t = (l.title || '').toLowerCase()
    .replace(/\b\d+\s*\/\s*\d+\b/g, '')          // 22/50 edition numbers
    .replace(/\b(ap|pp|hc|tp|ed\.?|edition|numbered|signed)\b/g, '')
    .replace(/\([^)]*\d{4}[^)]*\)/g, '')          // parenthetical dates
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length >= 8 ? t : null;                // too-short titles over-merge
}

// ── E1 · WATCHES: reference-level repeat-sale ────────────────────────────────
console.log(`\n══ E1 · watches repeat-sale (artist|reference) (${el()})`);
const watches = byMarket.get('watches') ?? [];
const wKey = (l: AuctionLot) => (l.reference ? `${l.artist}|${String(l.reference).toLowerCase()}` : null);
reportRS('watches vertical', buildRepeatSaleIndex(watches, wKey));

// per-family drills — the 29 rows currently stuck at demand
const famOf = (l: AuctionLot) => (l as { drill?: string }).drill || null;
const fams = new Map<string, AuctionLot[]>();
for (const l of watches) { const f = famOf(l); if (f) (fams.get(f) ?? fams.set(f, []).get(f)!).push(l); }
const topFams = [...fams.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
for (const [f, pool] of topFams) reportRS(`family ${f} (${pool.length} lots)`, buildRepeatSaleIndex(pool, wKey));

// ── E2 · DESIGN: model-level repeat-sale ─────────────────────────────────────
console.log(`\n══ E2 · design repeat-sale (artist|modelKey) (${el()})`);
const design = byMarket.get('design') ?? [];
const dKey = (l: AuctionLot) => (l.modelKey ? `${l.artist}|${String(l.modelKey).toLowerCase()}` : null);
reportRS('design vertical', buildRepeatSaleIndex(design, dKey));
const dMakers = new Map<string, AuctionLot[]>();
for (const l of design) (dMakers.get(l.artist) ?? dMakers.set(l.artist, []).get(l.artist)!).push(l);
for (const [mk, pool] of [...dMakers.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5))
  reportRS(`maker ${mk} (${pool.length} lots)`, buildRepeatSaleIndex(pool, dKey));

// ── E3 · ART: edition-level repeat-sale (prints/multiples only) ──────────────
console.log(`\n══ E3 · art editions repeat-sale (artist|title, prints only) (${el()})`);
const art = byMarket.get('art') ?? [];
const isEdition = (l: AuctionLot) => {
  const f = (l.formKey || '').toLowerCase(); const m = (l.medium || '').toLowerCase();
  return /print|multiple|edition|poster|lithograph|screenprint|etching/.test(f + ' ' + m);
};
const artEd = art.filter(isEdition);
const aKey = (l: AuctionLot) => { const t = editionTitle(l); return t ? `${l.artist}|${t}` : null; };
console.log(`  edition-lot pool: ${artEd.length.toLocaleString()} of ${art.length.toLocaleString()} art lots`);
reportRS('art editions vertical', buildRepeatSaleIndex(artEd, aKey));
const aMakers = new Map<string, AuctionLot[]>();
for (const l of artEd) (aMakers.get(l.artist) ?? aMakers.set(l.artist, []).get(l.artist)!).push(l);
for (const [mk, pool] of [...aMakers.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5))
  reportRS(`maker ${mk} (${pool.length} ed. lots)`, buildRepeatSaleIndex(pool, aKey));

// ── E4 · CULTURE + SCIENCE: pair feasibility probe ───────────────────────────
console.log(`\n══ E4 · culture/science repeat-sale feasibility (${el()})`);
for (const v of ['culture', 'science']) {
  const pool = byMarket.get(v) ?? [];
  reportRS(`${v} vertical (artist|title)`, buildRepeatSaleIndex(pool, aKey));
}

// ── E5 · WATCH-FAMILY DRILL HEDONIC (maker-mode on the family pool) ─────────
console.log(`\n══ E5 · watch-family hedonic (maker-mode, refs as control) (${el()})`);
for (const [f, pool] of topFams.slice(0, 4)) {
  const r = buildMakerIndex(pool);
  const parts: string[] = [];
  for (const [k, h] of Object.entries(r.horizons || {})) {
    if (!h) continue;
    parts.push(h.publishable
      ? `${k}: ✓ ${h.changePct!.toFixed(1)}% [${h.ciLoPct!.toFixed(1)},${h.ciHiPct!.toFixed(1)}]`
      : `${k}: ✗ ${(h.reason || '').slice(0, 64)}`);
  }
  console.log(`  ${f} (${pool.length}):\n     ${parts.join('\n     ') || r.note || 'no horizons'}`);
}

console.log(`\n[study] done (${el()})`);
