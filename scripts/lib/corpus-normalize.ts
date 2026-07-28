import type { AuctionLot } from '../../app/types';
import { extractReference } from './identity-enrich';

/* ═══════════════════════════════════════════════════════════════════════════
   corpus-normalize.ts — build-time corpus-hygiene passes.

   Three deterministic, idempotent normalizations applied to the FULL in-memory
   corpus BEFORE the markets/subMarkets/hedonic are built (and before the corpus
   gz is persisted). They fix defects that are already baked into the corpus and
   so cannot be corrected by a parse-site guard alone — they need a pass over the
   existing rows. Each pass is a pure mutation of the lot array; re-running is a
   no-op (nulling an already-good year does nothing, a correctly-routed lot never
   re-fires a detector, a lot that already carries a reference is skipped).

   1. clampImpossibleYears — null yearNum > currentYear+1 (mis-parsed future
      years, e.g. a ref/edition number read as a year).
   2. rerouteScienceMisroutes — correct blue-chip ART makers and WATCH makers
      that were swept into the science slugs. Uses the SAME high-confidence
      signals as scripts/audit-data-quality.ts (§1). Two outcomes, matching the
      established corpus doctrine (ray-crawl.ts §SCI_GUARD evicts wristwatch-form
      lots from science; the completed one-time misroute fix re-routed tracked
      makers and evicted untracked ones — "untracked makers are never kept"):
        · a lot whose maker names a TRACKED roster slug is re-routed to it;
        · a lot that is confidently NON-science but names no tracked slug
          (untracked blue-chips like Hockney/Basquiat/Rauschenberg, Gemini G.E.L.
          print refs, untracked watch makers like Richard Mille/Vacheron) is
          EVICTED from the corpus — it has no valid home and must not pollute the
          science index. Eviction introduces ZERO new misroutes elsewhere.
      This mutates `lots` IN PLACE (splice) so the caller's array — used for
      stats and the corpus write — reflects the removals.
   3. enrichWatchReferences — fill `reference` for watch lots the live watchKey
      missed, via identity-enrich.extractReference (recovers "Ref:" colon forms,
      hyphen-suffixed refs, bare model codes). Only fills empties; never
      overwrites an existing reference.
   ═══════════════════════════════════════════════════════════════════════════ */

type Lot = AuctionLot & {
  reference?: string | null;
  yearNum?: number | null;
  makerSlug?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Detection signals — kept byte-identical to scripts/audit-data-quality.ts §1 so
// the reroute corrects EXACTLY what the audit reports (the audit is the spec).
// ─────────────────────────────────────────────────────────────────────────────

// Blue-chip / tracked fine-artist surnames appearing as the LEADING maker.
const ART_MAKERS =
  /\b(hockney|houseago|basquiat|turcato|picasso|warhol|matisse|condo|haring|ruscha|richter|hirst|koons|kusama|banksy|rauschenberg|twombly|calder|lichtenstein|clemente|pettibon|scharf|martinez|saul|mcgee|kaws|futura|condo|prouv[eé]|jeanneret|nakashima)\b/i;

// Gemini G.E.L. print-catalogue ref masquerading as the Gemini space program.
const GEMINI_PRINT = /\bgemini\s+\d{2,4}\b|\bm\.?c\.?a\.?t\.?\b|\bs\.?a\.?c\.?\b/i;

// Unambiguous fine-art medium phrasing.
const ART_MEDIUM =
  /\b(oil on canvas|acrylic on canvas|oil on panel|oil on linen|gouache|watercolou?r on|screenprint|silkscreen|lithograph|etching and aquatint|works on paper|mixed media on canvas)\b/i;

const WATCH_SIGNAL =
  /\b(wristwatch|montre|automatic chronograph|tourbillon|perpetual calendar|ref\.\s*\d{3,}|caliber|calibre|self-winding)\b/i;
const WATCH_MAKER =
  /\b(rolex|patek philippe|audemars piguet|omega|cartier|richard mille|jaeger-lecoultre|vacheron|a\. lange|breguet|panerai)\b/i;

// Genuine science subject words — used ONLY to SUPPRESS a reroute (confirm the
// science lot is correctly placed), never to route INTO science.
const SCIENCE_SUBJECT =
  /\b(meteorite|meteoritic|fossil|dinosaur|trilobite|ammonite|nasa|apollo\s*\d|astronaut(?:'s)?\s+(?:flown|worn|suit|glove)|flown to the moon|marine chronometer|sextant|telescope|microscope|orrery|enigma machine|slide rule|planetarium)\b/i;

const SCIENCE_SLUGS = new Set([
  'meteorites', 'fossils', 'space-exploration', 'scientific-instruments',
]);

// The tracked ART/DESIGN maker slugs we can reroute TO. A blue-chip surname
// only reroutes when it maps to one of these; an untracked blue-chip name
// (Hockney, Basquiat, Houseago, Turcato, Rauschenberg, Lichtenstein, Richter,
// Koons …) has no home slug in the roster and is EVICTED instead — the doctrine
// is that untracked makers are never kept.
const ART_MAKER_SLUG: [RegExp, string][] = [
  [/\bpicasso\b/i, 'pablo-picasso'],
  [/\bwarhol\b/i, 'andy-warhol'],
  [/\bmatisse\b/i, 'henri-matisse'],
  [/\bcondo\b/i, 'george-condo'],
  [/\bharing\b/i, 'keith-haring'],
  [/\bruscha\b/i, 'ed-ruscha'],
  [/\bclemente\b/i, 'francesco-clemente'],
  [/\bpettibon\b/i, 'raymond-pettibon'],
  [/\bscharf\b/i, 'kenny-scharf'],
  [/\bmartinez\b/i, 'eddie-martinez'],
  [/\bmcgee\b/i, 'barry-mcgee'],
  [/\bkaws\b/i, 'kaws'],
  [/\bfutura\b/i, 'futura-2000'],
  [/\bsaul\b/i, 'peter-saul'],
  [/\bprouv[eé]\b/i, 'jean-prouve'],
  [/\bjeanneret\b/i, 'pierre-jeanneret'],
  [/\bnakashima\b/i, 'george-nakashima'],
];

const WATCH_MAKER_SLUG: [RegExp, string][] = [
  [/\brolex\b/i, 'rolex'],
  [/\bpatek philippe\b/i, 'patek-philippe'],
  [/\baudemars piguet\b/i, 'audemars-piguet'],
  [/\bomega\b/i, 'omega'],
  [/\bcartier\b/i, 'cartier'],
];

const lotText = (l: Lot): string =>
  `${l.title ?? ''}  ${l.medium ?? ''}`.toLowerCase();

// ─────────────────────────────────────────────────────────────────────────────
// 1 · impossible future years.
// ─────────────────────────────────────────────────────────────────────────────
export function clampImpossibleYears(lots: Lot[]): number {
  const maxYear = new Date().getFullYear() + 1;
  let nulled = 0;
  for (const l of lots) {
    if (typeof l.yearNum === 'number' && Number.isFinite(l.yearNum) && l.yearNum > maxYear) {
      l.yearNum = null;
      (l as Lot & { yearSource?: string | null }).yearSource = null;
      (l as Lot & { yearIsCirca?: boolean }).yearIsCirca = false;
      nulled++;
    }
  }
  return nulled;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · science → art / watches reroute (+ evict-if-unnameable). Splices IN PLACE.
//
// Only high-confidence matches are touched — the same detectors the audit fires
// on, always gated by "no genuine science subject". A match either RE-ROUTES to a
// nameable tracked slug, or is EVICTED (no valid home). A lot with no matching
// detector is never touched.
// ─────────────────────────────────────────────────────────────────────────────
export function rerouteScienceMisroutes(lots: Lot[]): {
  total: number; toArt: number; toWatch: number; evicted: number;
} {
  let toArt = 0, toWatch = 0, evicted = 0;
  // iterate backwards so splice() doesn't skip elements
  for (let i = lots.length - 1; i >= 0; i--) {
    const l = lots[i];
    if (!SCIENCE_SLUGS.has(l.artist)) continue;
    const t = lotText(l);
    if (SCIENCE_SUBJECT.test(t)) continue; // a genuine science subject pins it in place

    // ── WATCHES (a skeletonized dial is not a fossil) ──
    if (WATCH_MAKER.test(t) || WATCH_SIGNAL.test(t)) {
      const w = WATCH_MAKER_SLUG.find(([re]) => re.test(t));
      if (w) { l.artist = w[1]; l.makerSlug = w[1]; toWatch++; }
      else { lots.splice(i, 1); evicted++; } // untracked watch maker → never kept
      continue;
    }

    // ── ART (blue-chip maker / Gemini G.E.L. print ref / fine-art medium) ──
    if (ART_MAKERS.test(t) || GEMINI_PRINT.test(t) || ART_MEDIUM.test(t)) {
      const a = ART_MAKER_SLUG.find(([re]) => re.test(t));
      if (a) { l.artist = a[1]; l.makerSlug = a[1]; toArt++; }
      else { lots.splice(i, 1); evicted++; } // untracked blue-chip / print-ref → never kept
    }
  }
  return { total: toArt + toWatch + evicted, toArt, toWatch, evicted };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · watch reference fallback.
//
// For a watch-maker lot missing `reference`, apply identity-enrich.extractReference
// and stamp its result. extractReference itself only fires on the five tracked
// watch makers and never fabricates — it returns null when there is no ref/model
// to recover. Only empties are filled.
// ─────────────────────────────────────────────────────────────────────────────
export function enrichWatchReferences(lots: Lot[]): number {
  let filled = 0;
  for (const l of lots) {
    const ref = l.reference;
    if (ref && String(ref).length > 0) continue;
    const rec = extractReference(l);
    if (rec) { l.reference = rec; filled++; }
  }
  return filled;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · saleDate ← saleDateTime reconciliation.
//
// The crawler stamps `saleDate` with the CRAWL DAY as a fallback when it can't
// read a real date off a search/artist page. `saleDateTime`, when present, is the
// genuinely-parsed timestamp — so a lot re-seen on a listing page (a 2014 Prouvé,
// a 2025 Ruth bat) ends up with saleDateTime=<real past date> but saleDate=<crawl
// day>, and the "on the block" feed (which filters saleDate >= today) shows it as
// live today. Reconcile saleDate DOWN to saleDateTime's day when the timestamp is
// EARLIER — never push a sale later, so a genuine future lot is never touched.
// ─────────────────────────────────────────────────────────────────────────────
export function reconcileSaleDates(lots: Lot[]): number {
  let fixed = 0;
  for (const l of lots) {
    const dt = l.saleDateTime;
    if (!dt || !l.saleDate) continue;
    const trueDay = dt.slice(0, 10);
    if (trueDay.length === 10 && trueDay < l.saleDate.slice(0, 10)) {
      l.saleDate = trueDay;
      fixed++;
    }
  }
  return fixed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — run all passes, log a one-line summary. Idempotent.
// ─────────────────────────────────────────────────────────────────────────────
export function normalizeCorpus(lots: AuctionLot[]): void {
  const ls = lots as Lot[];
  const yearsNulled = clampImpossibleYears(ls);
  const reroute = rerouteScienceMisroutes(ls);
  const refsFilled = enrichWatchReferences(ls);
  const datesFixed = reconcileSaleDates(ls);
  console.log(
    `[normalize] yearNum>${new Date().getFullYear() + 1} nulled=${yearsNulled} · ` +
    `science misroutes fixed=${reroute.total} (→art ${reroute.toArt}, →watches ${reroute.toWatch}, evicted ${reroute.evicted}) · ` +
    `watch references filled=${refsFilled} · ` +
    `saleDate←saleDateTime reconciled=${datesFixed}`
  );
}
