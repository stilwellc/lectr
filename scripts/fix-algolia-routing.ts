/**
 * fix-algolia-routing.ts — P0 corrective re-route for the Sotheby's Algolia
 * backfill.
 *
 * THE BUG: backfill-sothebys-algolia.ts (pre-fix) routed each lot by its SALE
 * (routeCulture if isCultureSale / routeSportsLot if isSportsSale) BEFORE
 * item-level routing. This violates the repo's doctrine — "item text decides,
 * never the sale". Consequence: fine-art / watches / jewelry by a TRACKED maker
 * that happened to sell in a culture- or sports-named Sotheby's sale got
 * mis-bucketed onto the sale's catch-all. PROVEN: an $18M Picasso ("buste de
 * matador", sothebys-alg-d68dd4e1…) sold in the "Icons — Masterpieces From
 * Across Time And Space" sale is currently artist:'entertainment-memorabilia' —
 * the CULTURE RECORD. The backfill's ORDER is now fixed (item-first) for the
 * reference / next run; THIS one-time script repairs the ALREADY-WRITTEN rows.
 *
 * ── why this isn't a blind routeItem re-run ──
 * The written lot has NO creators/artistName/brands field — those live only on
 * the raw Algolia hit and were dropped at write time. The maker signal that
 * SURVIVES is the `title` (e.g. "pablo picasso … buste de matador", "…the patek
 * philippe nautilus…"). Re-running routeItem on title-ONLY is unsafe for the
 * weak keyword branches: `prototype` catches NBA prototype jerseys → science,
 * `satellite` catches a guitar → space, and `\bmatisse\b` catches the NBA player
 * "Matisse Thybulle" → matisse. So the re-slug is deliberately CONSERVATIVE:
 *   1. Source must be a SALE-BUCKET slug (the catch-alls the sale-first bug could
 *      have assigned: entertainment/movie-tv/music-memorabilia + the sports
 *      buckets). A lot already on a maker/object slug was item-routed correctly
 *      and is NEVER touched — re-running title-only would only corrupt it.
 *   2. Re-slug ONLY onto a NAMED maker / brand (the art-maker regexes + the
 *      Rolex/Patek/AP/Omega/Cartier brand words) — the unambiguous signals that
 *      the stripped `creators` field would have carried. The weak object/science
 *      keyword branches (meteorite/fossil/space/science/game-used/…) are NOT used
 *      to re-slug, because title-only they misfire.
 *   3. A sports/sneaker signal in the title VETOES the re-slug (Matisse Thybulle,
 *      a "Nike Dunk … KAWS sample | size 7") — a coincidental maker NAME must not
 *      steal a genuine sports item off its sale bucket.
 * If nothing re-slugs, the lot keeps its current slug. A lot is NEVER removed.
 * (Non-tracked makers that ride a culture sale — a Giacometti, a Birkin — have no
 * tracked slug to move to, so they correctly REMAIN culture: that's a coverage
 * gap, not this bug.)
 *
 * DRY-RUN by default (full re-route report). `--write` rewrites the sothebys
 * segment (local only; the nightly owns the R2 push).
 * Run: NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/fix-algolia-routing.ts [--write]
 */
import { readSegment, writeSegment } from './corpus-io';

const WRITE = process.argv.includes('--write');

/* ── named maker/brand routes (the maker half of routeItem, VERBATIM from
 *    backfill-sothebys-algolia.ts) — the unambiguous named entities only ────── */
const ART_MAKER_ROUTES: [RegExp, string][] = [
  [/\bgeorge condo\b/, 'george-condo'],
  [/\bkaws\b/, 'kaws'],
  [/\bandy warhol\b|\bwarhol\b/, 'andy-warhol'],
  [/\bkeith haring\b|\bharing\b/, 'keith-haring'],
  [/\bed(ward)? ruscha\b|\bruscha\b/, 'ed-ruscha'],
  [/\bpablo picasso\b|\bpicasso\b/, 'pablo-picasso'],
  [/\bhenri matisse\b|\bmatisse\b/, 'henri-matisse'],
  [/\btom sachs\b/, 'tom-sachs'],
  [/\bpeter saul\b/, 'peter-saul'],
  [/\braymond pettibon\b|\bpettibon\b/, 'raymond-pettibon'],
  [/\bbarry mcgee\b/, 'barry-mcgee'],
  [/\bfutura\s?2000\b|\bfutura\b/, 'futura-2000'],
  [/\brobert crumb\b|\br\.?\s?crumb\b/, 'r-crumb'],
  [/\bfab(ulous)?\s5\sfreddy\b|\bfred(erick)? brathwaite\b/, 'fab-5-freddy'],
  [/\bfrancesco clemente\b|\bclemente\b/, 'francesco-clemente'],
  [/\beddie martinez\b/, 'eddie-martinez'],
  [/\bkenny scharf\b|\bscharf\b/, 'kenny-scharf'],
  // design
  [/\bgeorge nakashima\b|\bnakashima\b/, 'george-nakashima'],
  [/\bcharles (and |& )?ray eames\b|\b(charles|ray) eames\b|\beames\b/, 'charles-eames'],
  [/\bprouv[eé]/, 'jean-prouve'],
  [/\bpierre jeanneret\b|\bjeanneret\b/, 'pierre-jeanneret'],
];

// The sale-bucket catch-alls the sale-first bug could have assigned. A lot on
// ANY OTHER slug was routed by the item and must not be re-decided title-only.
const SALE_BUCKETS = new Set<string>([
  'entertainment-memorabilia', 'movie-tv', 'music-memorabilia',
  'sports-memorabilia', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-cards',
]);

// A sports/sneaker signal in the title → this is a genuine sports-sale item; a
// COINCIDENTAL maker name (NBA player "Matisse Thybulle", a "Nike Dunk … KAWS
// sample | size 7", "Futura Laboratories" collab) must NOT steal it off its
// bucket. Vetoes the re-slug.
const SPORTS_VETO = /\b(nba|nfl|mlb|nhl|game[- ](used|worn|issued)|jersey|trail blazers|all[- ]?star|all[- ]rookie|playoffs?|tip-?off|nike (dunk|air force|air max|sb)|air jordan|yeezy|sneakers?)\b|sample \| size|\| size \d/i;
// card/tcg guard (verbatim head of routeItem) — never route a card to a maker.
const CARD_VETO = /\b(topps|bowman|panini|goudey|fleer|donruss|upper deck|rookie card|trading card|tobacco (card|silk)|pok[eé]mon|yu-?gi-?oh|\btcg\b)\b/;

/** Re-decide a sale-bucket lot's slug from its surviving title — NAMED makers /
 *  brands only, sports/sneaker/card items vetoed. Returns a tracked maker slug
 *  to re-slug onto, or null to LEAVE the lot on its current (sale) slug. */
function namedMakerFor(title: string): string | null {
  const t = title.toLowerCase();
  if (CARD_VETO.test(t)) return null;
  if (SPORTS_VETO.test(t)) return null;
  // watch/jewelry brand words (the head of routeItem)
  if (/\brolex\b/.test(t)) return 'rolex';
  if (/\bpatek\b/.test(t)) return 'patek-philippe';
  if (/\baudemars\b/.test(t)) return 'audemars-piguet';
  if (/\bomega\b/.test(t)) return 'omega';
  if (/\bcartier\b/.test(t)) return 'cartier';
  for (const [re, slug] of ART_MAKER_ROUTES) if (re.test(t)) return slug;
  return null; // no named tracked maker in the title — leave the sale slug
}

const usd = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
const CULTURE = new Set(['movie-tv', 'music-memorabilia', 'entertainment-memorabilia']);

(async () => {
  const seg = readSegment('sothebys');
  const algolia = seg.filter(l => (l as { source?: string }).source === 'sothebys-algolia');
  console.log(`[fix] sothebys segment: ${seg.length} lots · ${algolia.length} source:'sothebys-algolia'${WRITE ? '' : ' · DRY-RUN'}`);

  // top-5 culture lots by price BEFORE (proof of corruption)
  const cultureBefore = algolia
    .filter(l => CULTURE.has(String((l as Record<string, unknown>).artist)))
    .sort((a, b) => (Number((b as Record<string, unknown>).realizedUsd) || 0) - (Number((a as Record<string, unknown>).realizedUsd) || 0));
  console.log('\ntop-5 CULTURE lots by realizedUsd — BEFORE:');
  for (const l of cultureBefore.slice(0, 5)) {
    const r = l as Record<string, unknown>;
    console.log(`  ${usd(r.realizedUsd).padStart(13)}  [${r.artist}]  ${String(r.title).slice(0, 62)}`);
  }

  let reslugged = 0, bucketSources = 0;
  const fromTo: Record<string, number> = {};
  const reslugRows: Array<Record<string, unknown>> = [];

  for (const l of algolia) {
    const lot = l as Record<string, unknown>;
    const cur = String(lot.artist || '');
    if (!SALE_BUCKETS.has(cur)) continue;                // only sale-bucket sources are bug-eligible
    bucketSources++;
    const decided = namedMakerFor(String(lot.title || ''));
    if (!decided || decided === cur) continue;           // no named tracked maker (or already correct) → LEAVE
    fromTo[`${cur}→${decided}`] = (fromTo[`${cur}→${decided}`] || 0) + 1;
    lot.artist = decided;                                 // re-slug in place (object shared with `seg`)
    reslugged++;
    reslugRows.push(lot);
  }

  console.log('\n════════════════ RE-ROUTE REPORT ════════════════');
  console.log(`sale-bucket source lots examined: ${bucketSources}`);
  console.log(`re-slugged (named tracked maker won over sale bucket): ${reslugged}`);
  console.log(`left as-is: ${algolia.length - reslugged} (all non-bucket lots + bucket lots with no named tracked maker — genuine culture/sports)`);
  console.log(`\nfrom→to breakdown:`);
  for (const [k, n] of Object.entries(fromTo).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`);

  const picasso = reslugRows.find(r => String(r.id).includes('d68dd4e1'));
  console.log(`\nmarquee proof — the $18M Picasso (sothebys-alg-d68dd4e1…):`);
  console.log(picasso
    ? `  ${usd(picasso.realizedUsd)} artist NOW '${picasso.artist}' · ${String(picasso.title).slice(0, 55)}`
    : `  (NOT re-slugged — investigate!)`);

  console.log(`\n${Math.min(20, reslugRows.length)} re-slugged samples (highest realizedUsd first):`);
  const samples = [...reslugRows].sort((a, b) => (Number(b.realizedUsd) || 0) - (Number(a.realizedUsd) || 0)).slice(0, 20);
  for (const r of samples) console.log(`  ${usd(r.realizedUsd).padStart(13)}  →[${r.artist}]  ${String(r.title).slice(0, 58)}`);

  // top-5 culture AFTER
  const cultureAfter = algolia
    .filter(l => CULTURE.has(String((l as Record<string, unknown>).artist)))
    .sort((a, b) => (Number((b as Record<string, unknown>).realizedUsd) || 0) - (Number((a as Record<string, unknown>).realizedUsd) || 0));
  console.log('\ntop-5 CULTURE lots by realizedUsd — AFTER:');
  for (const l of cultureAfter.slice(0, 5)) {
    const r = l as Record<string, unknown>;
    console.log(`  ${usd(r.realizedUsd).padStart(13)}  [${r.artist}]  ${String(r.title).slice(0, 62)}`);
  }
  console.log('══════════════════════════════════════════════════');

  if (!WRITE) { console.log(`\n[fix] DRY-RUN — pass --write to rewrite the sothebys segment (${reslugged} re-slugs)`); return; }
  if (!reslugged) { console.log('[fix] nothing to re-slug — segment untouched'); return; }

  // The re-slug mutated the objects held by `seg` in place (algolia is a filtered
  // VIEW of the same references) — writing `seg` persists every change, no lot
  // added or removed. NDJSON codec (writeSegment) — never the legacy JSON codec.
  writeSegment('sothebys', seg);
  console.log(`\n[fix] wrote ${seg.length} lots to segments/sothebys.ndjson.gz (local only — nightly owns the R2 push)`);
})();
