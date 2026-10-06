import type { AuctionLot } from '../../app/types';
import { subCatOf, sportSlugOf, sportOfSale, sportWordOf, cultureTextDomain, curatedDomainOf, watchRefKey, watchFamilyOf, type SubCatMaps } from './sub-cats';
import { SUBJECT_DOMAINS } from './subject-domains';
import { athleteIn, ATHLETES } from './athlete-roster';
import { extractReference } from './identity-enrich';
import { looksLikeCard, playerSlugOf, parseCard, cardYearKey, knownPlayerSet } from '../../app/lib/cards';
import { classifyForm, objectClassOf, cleanGoldinTitle, watchKey, isPersonNameRun, personNameOf } from '../../app/lib/comps';
import { vetReference, readDescriptionReference, readHouseReference, splitWatchRef, isWatchModelLine } from '../../app/lib/watch-ref';
import { titleTokens as titleTokensOf, extractEdition, extractSerials, toUsdDated, fxRateFor } from '../../app/lib/normalize';
import { isCurrency } from '../../app/types';
import { christiesLocationCurrency } from './houses/common';
import { ARTIST_MARKET } from '../../app/constants';
import { isMisattributed } from '../../app/lib/attribution';
import { AUTOGRAPH_SLUGS, autographFormatOf } from '../../app/lib/identity';
import { parseSignerName, SIGNER_PARSER_VERSION } from './autograph-signer';
import { leadsWithSetCode } from './set-codes';
import { attachExtractions, fillWatchReferencesFromExtract } from './extract/apply';
import { segmentOf } from '../corpus-io';
import { reclassifyLot } from './classify';
import { saleDayOf, SALE_DAY_HOUSES } from './sale-day';
import { seasonToDate } from './sports-crawl';
import { saleCloseFor, galleryStubClose, GALLERY_HOUSES } from './sale-close-dates';

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
   2b. rerouteRelicCards — move game-used lots that are actually trading CARDS
      (a game-used swatch on a manufactured card: "Topps Dynasty Autograph Patch
      #DAP-SO Ohtani") from artist='game-used' → 'sports-cards', so they earn
      their EXACT-card comp value instead of a broad player-median. Conservative:
      fires only on the shared looksLikeCard detector (a card PRODUCT or a card
      NUMBER in card context) — never on grading alone. Idempotent.
   3. enrichWatchReferences — re-derive `reference` for the five watch makers
      from the one reader (app/lib/watch-ref.ts: labelled refs in every printed
      form, brand-shaped bare refs, the maker's own model line), healing
      serials / model names an older reader stamped (Sep 28 2026).
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
    // (wave 2) a lot an RR / generalist SPACE sale catalogued is space: "Wristwatch
    // Group Lot (6) - From the Personal Collection of Alan Bean" is an
    // astronaut's effects — re-routed to a tracked maker if it names one (a
    // flown Omega), never evicted as an untracked watch maker
    const spacePinned = l.artist === 'space-exploration' && /\bspace\b/i.test(String((l as { saleName?: string | null }).saleName || ''));

    // ── WATCHES (a skeletonized dial is not a fossil) ──
    if (WATCH_MAKER.test(t) || WATCH_SIGNAL.test(t)) {
      const w = WATCH_MAKER_SLUG.find(([re]) => re.test(t));
      if (w) { l.artist = w[1]; l.makerSlug = w[1]; toWatch++; }
      else if (!spacePinned) { lots.splice(i, 1); evicted++; } // untracked watch maker → never kept
      continue;
    }

    // ── ART (blue-chip maker / Gemini G.E.L. print ref / fine-art medium) ──
    if (ART_MAKERS.test(t) || GEMINI_PRINT.test(t) || ART_MEDIUM.test(t)) {
      const a = ART_MAKER_SLUG.find(([re]) => re.test(t));
      if (a) { l.artist = a[1]; l.makerSlug = a[1]; toArt++; }
      else if (!spacePinned || /\bpatent\b/.test(t)) { lots.splice(i, 1); evicted++; } // untracked blue-chip / print-ref → never kept
    }
  }
  return { total: toArt + toWatch + evicted, toArt, toWatch, evicted };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2b · relic-card reroute (game-used → sports-cards). Heals the back-catalogue.
//
// ~43% of "game-used" lots are actually trading CARDS carrying a game-used
// swatch (a "Game-Used Relic CARD", a "Topps Dynasty Autograph Patch #DAP-SO
// Ohtani") mis-filed as game-used by the pre-fix goldinRoute. As game-used they
// get a broad player-median; as sports-cards they get their EXACT-card value
// (build-market §3 stamps value.basis='card-comp' on artist==='sports-cards').
//
// Idempotent (a lot already at 'sports-cards' is not in SPORTS_OBJECT_SLUGS so
// it never re-fires) and CONSERVATIVE — reroutes only on the shared looksLikeCard
// detector (card PRODUCT token, or a card NUMBER in card context). A false
// reroute of a real jersey is worse than a miss, so grading language alone is
// never enough (a raw jersey can be PSA/DNA authenticated). Mutates in place;
// artist/makerSlug are re-stamped so downstream markets read the new vertical.
// ─────────────────────────────────────────────────────────────────────────────
const SPORTS_OBJECT_SLUGS = new Set(['game-used', 'sports-memorabilia']);

export function rerouteRelicCards(lots: Lot[]): { total: number; examples: string[] } {
  let total = 0;
  const examples: string[] = [];
  for (const l of lots) {
    if (!SPORTS_OBJECT_SLUGS.has(l.artist)) continue;
    if (!looksLikeCard(l.title || '')) continue;
    l.artist = 'sports-cards';
    l.makerSlug = 'sports-cards';
    total++;
    if (examples.length < 8 && l.title) examples.push(l.title);
  }
  return { total, examples };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · watch reference fallback + heal.
//
// For the five tracked watch makers the reference is a PURE function of the
// title (app/lib/watch-ref.ts), so it is re-derived every pass: comps.watchKey
// (labelled ref, else the maker's model line) and, where that is empty,
// identity-enrich.extractReference (brand-shaped bare refs). This heals rows an
// older reader stamped — movement/case serials ("Case No. 68594"), model names
// where a "Ref:" was printed, truncated Omega refs — instead of freezing them
// (the old pass only filled empties). A model-extraction reference
// (referenceSrc 'llm') is kept unless it fails the serial/shape vet or a regex
// reference now reads the title. Other makers are never touched.
// ─────────────────────────────────────────────────────────────────────────────
const WATCH_MAKER_SLUGS = new Set(['rolex', 'patek-philippe', 'cartier', 'audemars-piguet', 'omega']);
const DESC_REF_FORMS = new Set(['wristwatch', 'pocket-watch']);
/** (Oct 6 2026, pricing wave 7) read the house's structured reference field
 *  (Phillips maker API `wReferenceNo`, captured raw as `houseReference`) into
 *  `reference` when the title prints none. OFF: on the test-year holdout
 *  (Oct 6 corpus with the Phillips field back-stamped) it added 74 Phillips
 *  values at 23.0% median error but moved the 351 already-valued Phillips
 *  lots 24.1 → 24.3% (±30% 60.4 → 59.0%, band 77.5 → 74.6%); live Sep 14
 *  Sotheby's watches 22.0 → 22.2%. docs/ENGINE_LANES.md §18. */
export const USE_HOUSE_REFERENCE = false;
// (Oct 6 2026 categorization re-audit) `reference` holds a printed reference
// NUMBER only. A model-line name ("submariner", "tank", "royaloak" — 6.8k
// rows) is not a reference (the audit marked every one wrong); it moves to
// `modelKey` (the hedonic control reads reference ‖ modelKey, so the control
// is unchanged) and the field is DELETED, not nulled — the comp readers
// (comps.watchKeyOf, r2/pools) fall back to watchKey(title) on an absent
// field, which re-reads the same model line, so model-keyed pools stay.
function setWatchRef(l: Lot, ref: string | null): void {
  if (ref && /\d/.test(ref)) { l.reference = ref; return; }
  if (ref) (l as Lot & { modelKey?: string | null }).modelKey = ref;
  delete l.reference;
}
export function enrichWatchReferences(lots: Lot[]): number {
  let filled = 0, healed = 0, cleared = 0;
  for (const l of lots) {
    if (!WATCH_MAKER_SLUGS.has(l.artist)) continue;
    const x = l as Lot & { referenceSrc?: string };
    const prev = l.reference ?? null;
    const fromTitle = watchKey(l) ?? extractReference(l);
    // (Oct 6) the title prints no reference number: a LABELLED one in the
    // description beats the model-line name (1,377 lots carried theirs only there)
    // — only for a WATCH lot: a Patek "lithograph depicting a ref. 5098p"
    // or an AP cufflink must not join the reference's pool
    const desc = (l as Lot & { description?: string | null }).description;
    const watchLot = !l.formKey || DESC_REF_FORMS.has(String(l.formKey));
    // (Oct 6, pricing wave 7) the house's structured reference field
    // (Phillips wReferenceNo) beats the free-text description — OFF until it
    // measures better (USE_HOUSE_REFERENCE)
    const houseRef = !USE_HOUSE_REFERENCE ? null : readHouseReference((l as Lot & { houseReference?: string | null }).houseReference, l.artist);
    const regex = fromTitle && /\d/.test(fromTitle) ? fromTitle
      : (houseRef ?? (watchLot ? readDescriptionReference(desc, l.artist) : null) ?? fromTitle);
    if (x.referenceSrc === 'llm' && prev) {
      const regexRef = regex && /\d/.test(regex) ? regex : null;
      if (regexRef) { l.reference = regexRef; delete x.referenceSrc; healed++; }
      else if (!vetReference(l.artist, String(prev), l.title)) { setWatchRef(l, regex); delete x.referenceSrc; cleared++; }
      else {
        // a kept extraction ref keys on its core too (5970J → 5970)
        const lc = String(prev).toLowerCase().replace(/\s+/g, '');
        const core = splitWatchRef(l.artist, lc).core;
        if (core !== lc) l.reference = core;
      }
      continue;
    }
    const num = regex && /\d/.test(regex) ? regex : null;
    if (!num && regex) (l as Lot & { modelKey?: string | null }).modelKey = regex;
    if ((prev || null) === num) continue;
    if (!prev) filled++;
    else if (num) healed++;
    else cleared++;
    setWatchRef(l, regex);
  }
  if (healed || cleared) console.log(`[normalize] watch references re-derived: healed=${healed} cleared=${cleared}`);
  return filled;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3b · clearJunkModelKeys (Oct 6 2026 categorization wave 3) — the crawler
// stamped comps.modelKey (a FURNITURE model-code reader) on every lot, so a
// card's grade ("PSA GEM MT 10" → mt10: 63k rows), a photo's size ("8 x 10" →
// x10), a watch's metal ("AN 18K GOLD" → an18) became a "model" — 229k rows,
// and similarity.ts paid a same-model bonus between any two PSA 10s. A model
// key is kept only where it is an identity: design (LCW, PJ-SI-30-A), art
// (catalogue numbers: F. & S. II.31) and a watch's own model LINE. Deleted,
// not nulled: the readers fall back the same way on an absent field.
// ─────────────────────────────────────────────────────────────────────────────
export function clearJunkModelKeys(lots: Lot[]): number {
  let cleared = 0;
  for (const l of lots) {
    const x = l as Lot & { modelKey?: string | null };
    if (x.modelKey == null) continue;
    const m = ARTIST_MARKET[l.artist as keyof typeof ARTIST_MARKET];
    if (m === 'design' || m === 'art') continue;
    if (m === 'watches' && isWatchModelLine(l.artist, x.modelKey)) continue;
    // a watch key that IS the printed reference ("REF. 3919" → 3919 / ref3919)
    const ref = String(l.reference || '').toLowerCase().replace(/\s+/g, '');
    const core = String(x.modelKey).toLowerCase().replace(/^ref/, '');
    if (m === 'watches' && ref && /\d{3}/.test(core) && ref.startsWith(core)) continue;
    delete x.modelKey;
    cleared++;
  }
  return cleared;
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
    // the timestamp's SALE-LOCAL day where lib/sale-day owns the house (a
    // London-midnight 23:00Z stamp must not drag the localized day back a day)
    const trueDay = saleDayOf(l.auctionHouse, dt, { saleName: l.saleName, currency: (l as { nativeCurrency?: string }).nativeCurrency }) || dt.slice(0, 10);
    if (trueDay.length === 10 && trueDay < l.saleDate.slice(0, 10)) {
      l.saleDate = trueDay;
      fixed++;
    }
  }
  return fixed;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4a · localizeSaleDates — saleDate in the SALE'S time zone (Oct 2026 identity
// audit). Goldin / Christie's / Sotheby's parsers took the UTC day of a local
// stamp (lib/sale-day has the evidence): 369,558 Goldin lots a day late (a
// 10 PM ET Thursday close is 02:00Z Friday), 20,831 Christie's a day early
// (London/Geneva/HK/Dubai local midnight written in UTC), 5,147 Sotheby's.
// The parsers now stamp the local day; this re-derives the rows already in the
// corpus. Only a saleDate that IS the old UTC day of its own saleDateTime is
// rewritten (any other saleDate came from elsewhere — reconcileSaleDates owns
// those), so the pass is idempotent and never touches a hand-set date.
// ─────────────────────────────────────────────────────────────────────────────
export function localizeSaleDates(lots: Lot[]): { total: number; byHouse: Record<string, number> } {
  const byHouse: Record<string, number> = {};
  let total = 0;
  for (const l of lots) {
    const house = l.auctionHouse as string;
    if (!SALE_DAY_HOUSES.has(house)) continue;
    const dt = l.saleDateTime;
    if (typeof dt !== 'string' || typeof l.saleDate !== 'string') continue;
    const cur = l.saleDate.slice(0, 10);
    if (cur !== dt.slice(0, 10)) continue;
    const day = saleDayOf(house, dt, { saleName: l.saleName, currency: (l as { nativeCurrency?: string }).nativeCurrency });
    if (!day || day === cur) continue;
    l.saleDate = l.saleDate.length > 10 ? day + l.saleDate.slice(10) : day;
    byHouse[house] = (byHouse[house] || 0) + 1;
    total++;
  }
  return { total, byHouse };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — run all passes, log a one-line summary. Idempotent.
// ─────────────────────────────────────────────────────────────────────────────
// ── ★6 · stampSubCats — the sub-category taxonomy (subCat/drill/flown),
//    every lot, every build. Runs AFTER restampIdentityKeys (it reads the
//    final formKey). Two-phase: learn player→sport from Goldin's own sport
//    stamps (majority vote, n≥3, ≥80% purity), then stamp deterministically —
//    pure function of existing fields, so re-runs converge (idempotent).
export function stampSubCats(lots: Lot[]): { subCats: number; drills: number; sportRecovered: number } {
  const pidVotes = new Map<string, Map<string, number>>();
  const playerVotes = new Map<string, Map<string, number>>();
  const vote = (m: Map<string, Map<string, number>>, k: string, sport: string) => {
    const inner = m.get(k) || m.set(k, new Map()).get(k)!;
    inner.set(sport, (inner.get(sport) || 0) + 1);
  };
  // (wave 2) a CARD row's player is parsed from its title here (normalize runs
  // before build-market stamps _card): Goldin's sport-stamped cards teach the
  // player → sport map, and the expansion houses' unstamped cards read it
  const CARD_SLUGS_SC = new Set(['sports-cards', 'graded-cards']);
  const cardCache = new Map<string, ReturnType<typeof parseCard>>();
  const cardOf = (r: Record<string, unknown>) => {
    const t = String(r.title || '');
    let c = cardCache.get(t);
    if (c === undefined) { c = parseCard(t); cardCache.set(t, c); }
    return c;
  };
  // (wave 3) a sports OBJECT row's player is the roster athlete its title
  // leads with ("Joe DiMaggio Signed Photograph") — 8.7k RR / 4.7k H&S
  // autographs carried no drill because only card rows were read
  const cardPlayer = (r: Record<string, unknown>): string | null => {
    if (CARD_SLUGS_SC.has(r.artist as string)) return cardOf(r).playerSlug;
    if (ARTIST_MARKET[r.artist as keyof typeof ARTIST_MARKET] !== 'sports') return null;
    const a = athleteIn(String(r.title || ''), 3);
    return a ? playerSlugOf(a) : null;
  };
  // (wave 3) a card's SET keys — the year as keyed + the set name as printed
  // (sport words kept: "1975 Topps Football" is not "1975 Topps"), and a
  // coarse year + brand-line key (its first two words: "2020|bowman chrome")
  const setOf = (r: Record<string, unknown>): string[] => {
    if (!CARD_SLUGS_SC.has(r.artist as string)) return [];
    const c = cardOf(r);
    const yr = cardYearKey(c.year);
    const words = String(c.setName || '').toLowerCase().replace(/^-?(?:\d{4}|\d{2})\b\s*/, '').replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!yr || !words.length) return [];
    const keys = [`${yr}|${words.join(' ')}`];
    if (words.length > 2) keys.push(`${yr}|~${words.slice(0, 2).join(' ')}`);
    return keys;
  };
  // player → sport from the rows whose sport is KNOWN by their own evidence:
  // Goldin's stamp, and (wave 3) a single-sport sale or the title's sport words
  const ownSport = (r: Record<string, unknown>): string | null =>
    sportSlugOf(r.sport) || sportOfSale(r.saleName as string, r.auctionHouse as string) || sportWordOf(String(r.title || ''));
  for (const l of lots) {
    const r = l as unknown as Record<string, unknown>;
    if (ARTIST_MARKET[r.artist as keyof typeof ARTIST_MARKET] !== 'sports') continue;
    const stamped = sportSlugOf(r.sport);
    const sport = ownSport(r);
    if (!sport) continue;
    if (stamped && r._pid != null) vote(pidVotes, String(r._pid), sport);
    const card = r._card as { playerSlug?: string } | undefined;
    const player = (r.playerSlug as string) || card?.playerSlug || cardPlayer(r);
    if (player) vote(playerVotes, player, sport);
  }
  const settle = (m: Map<string, Map<string, number>>, minN = 3, purity = 0.8): Map<string, string> => {
    const out = new Map<string, string>();
    m.forEach((inner, k) => {
      let tot = 0, best = '', bestN = 0;
      inner.forEach((n, sp) => { tot += n; if (n > bestN) { best = sp; bestN = n; } });
      if (tot >= minN && bestN / tot >= purity) out.set(k, best);
    });
    return out;
  };
  const byPid = settle(pidVotes), byPlayer = settle(playerVotes);
  // (wave 3) set → sport from every card whose sport is known (own evidence or
  // its player), 90% pure over ≥ 5 cards — "1952 Topps", "1933 Goudey",
  // "Bowman Chrome Prospects" are one sport; "1948 Bowman" is not and abstains
  const setVotes = new Map<string, Map<string, number>>();
  for (const l of lots) {
    const r = l as unknown as Record<string, unknown>;
    const ks = setOf(r);
    if (!ks.length) continue;
    const pid = r._pid != null ? String(r._pid) : null;
    const player = cardPlayer(r);
    const sport = ownSport(r) || (pid && byPid.get(pid)) || (player && byPlayer.get(player)) || null;
    if (sport) for (const k of ks) vote(setVotes, k, sport);
  }
  const bySet = settle(setVotes, 5, 0.9);
  // (wave 3) culture subject → domain from the rows whose domain their own
  // words (or the curated subject list) name; watch reference → family from
  // the rows whose title names the family
  const subjVotes = new Map<string, Map<string, number>>();
  const refVotes = new Map<string, Map<string, number>>();
  for (const l of lots) {
    const r = l as unknown as Record<string, unknown>;
    const m = ARTIST_MARKET[r.artist as keyof typeof ARTIST_MARKET];
    if (m === 'culture') {
      const subs = r.subjectKeys as string[] | undefined;
      if (!Array.isArray(subs) || !subs.length) continue;
      const d = curatedDomainOf(subs) || cultureTextDomain(String(r.title || ''));
      if (d) for (const s of subs) if (!SUBJECT_DOMAINS[s]) vote(subjVotes, s, d);
    } else if (m === 'watches' && r.formKey === 'wristwatch') {
      const k = watchRefKey(r);
      const fam = k ? watchFamilyOf(r.artist as string, String(r.title || '')) : null;
      if (k && fam) vote(refVotes, k, fam);
    }
  }
  const maps: SubCatMaps = {
    byPid, byPlayer, cardPlayer: (l: Record<string, unknown>) => cardPlayer(l),
    bySet, setOf: (l: Record<string, unknown>) => setOf(l),
    bySubject: settle(subjVotes, 2, 0.8), byRef: settle(refVotes, 3, 0.8),
  };

  let subCats = 0, drills = 0, sportRecovered = 0;
  for (const l of lots) {
    const r = l as unknown as Record<string, unknown>;
    const st = subCatOf(r, maps);
    const t = l as Lot & { subCat?: string; drill?: string; flown?: boolean };
    if (st.subCat) { t.subCat = st.subCat; subCats++; } else if ('subCat' in t) delete t.subCat;
    if (st.drill) {
      if (!sportSlugOf(r.sport) && st.subCat && ['cards', 'game-used', 'memorabilia', 'tickets', 'trophies'].includes(st.subCat)) sportRecovered++;
      t.drill = st.drill; drills++;
    } else if ('drill' in t) delete t.drill;
    if (st.flown === true) t.flown = true; else if ('flown' in t) delete t.flown;
  }
  return { subCats, drills, sportRecovered };
}

// ── ★0b · dedupeWrightFamilyMirrors — LAMA/Rago/Wright are ONE company on ONE
// platform: the same sale is served on wright20.com, lamodern.com and
// ragoarts.com with the SAME numeric lot id (wright-301456~ ≡ lama-301456~).
// With all three scanners running, every mirrored sale lands 2–3×. The platform
// id is globally unique, so id-equality within the family is an airtight dedup
// key (same-house lots with different ids — e.g. two identical Eames chairs in
// one sale — are genuinely distinct and untouched). Keeper preference:
// sold > live > upcoming (realized data wins), then Wright > Rago > LAMA.
const WRIGHT_FAMILY = new Set(['Wright', 'LAMA', 'Rago', 'Toomey & Co.', 'Toomey']);
const FAMILY_RANK: Record<string, number> = { Wright: 0, Rago: 1, LAMA: 2 };
const STATUS_RANK: Record<string, number> = { sold: 0, live: 1, upcoming: 2 };
export function dedupeWrightFamilyMirrors(lots: Lot[]): number {
  // Two mirror signatures (the platform runs TWO id schemes, so id-equality
  // alone misses ~2/3 of mirrors — e.g. rago-413558 ≡ lama-299487~):
  //   1. shared numeric platform id
  //   2. identical sale URL PATH (domain-stripped) — "the sale path inside the
  //      URL is the true session key" (ray-crawl doctrine). Same path on two
  //      domains = the same lot slot in the same mirrored sale. Distinct lots
  //      (even two identical chairs in one sale) sit at distinct slots, so
  //      legit multiples are never touched.
  const best = new Map<string, { idx: number; l: Lot }>();
  const drop = new Set<number>();
  const consider = (key: string, i: number, l: Lot) => {
    const prev = best.get(key);
    if (!prev) {
      best.set(key, { idx: i, l });
      return;
    }
    if (prev.idx === i || drop.has(prev.idx)) {
      best.set(key, { idx: i, l });
      return;
    }
    const a = prev.l;
    const sa = STATUS_RANK[a.status as string] ?? 3;
    const sb = STATUS_RANK[l.status as string] ?? 3;
    const ha = FAMILY_RANK[(a as { auctionHouse?: string }).auctionHouse || ''] ?? 9;
    const hb = FAMILY_RANK[(l as { auctionHouse?: string }).auctionHouse || ''] ?? 9;
    const keepNew = sb < sa || (sb === sa && hb < ha);
    if (keepNew) {
      drop.add(prev.idx);
      best.set(key, { idx: i, l });
    } else {
      drop.add(i);
    }
  };
  for (let i = 0; i < lots.length; i++) {
    const l = lots[i];
    const house = (l as { auctionHouse?: string }).auctionHouse || '';
    if (!WRIGHT_FAMILY.has(house)) continue;
    // the platform id: numeric (wright-301456) or the older alphanumeric lot
    // code (wright-RA4 ≡ lama-RA4, wright-ABMG2 ≡ lama-ABMG2 — 9 mirrored pairs,
    // Oct 2026 identity audit). A code is short, so it keys WITH the title.
    const idm = String((l as { id?: string }).id || '').match(/-([A-Za-z0-9]+)~?$/);
    if (idm) consider(/^\d+$/.test(idm[1]) ? `id:${idm[1]}` : `aid:${idm[1]}|${normTitle(l.title)}`, i, l);
    if (drop.has(i)) continue; // already dropped by the id key
    const tail = String((l as { url?: string }).url || '').replace(/^https?:\/\/[^/]+/, '');
    // the slot is numeric or lettered ("…/modern-design/2412a", "…/RA4")
    if (/^\/auctions\/.+\/[A-Za-z0-9]+\/?$/.test(tail)) consider(`path:${tail.replace(/\/$/, '')}`, i, l);
  }
  if (!drop.size) return 0;
  // O(n) in-place compaction — assemble persists this array, so the dedupe
  // bakes into the corpus gz and heals every downstream consumer.
  let w = 0;
  for (let i = 0; i < lots.length; i++) if (!drop.has(i)) lots[w++] = lots[i];
  lots.length = w;
  return drop.size;
}

/* MISATTRIBUTION DROP — the deep archive stamps a maker slug onto lots that
   plainly are not theirs: car-auction lots swept into an ART search (a
   "2.6-litre Alfa" under Peter Saul, a Ferrari under Clemente), and bare-
   surname routes matching a DIFFERENT named artist ("José Clemente OROZCO"
   → clemente, "Edward PRIESTLEY" → warhol). They inflate that maker's
   record/median/sold and steal the maker's photo. Drop them from the corpus
   entirely — they belong to no tracked maker — so every downstream figure
   (stats, market, value engine) is computed from a clean pool. Same in-place
   compaction as dedupeWrightFamilyMirrors so it bakes into the corpus gz. */
function dropMisattributed(lots: Lot[]): number {
  const drop = new Set<number>();
  for (let i = 0; i < lots.length; i++) {
    if (isMisattributed(String(lots[i].artist || ''), String(lots[i].title || ''))) drop.add(i);
  }
  if (!drop.size) return 0;
  let w = 0;
  for (let i = 0; i < lots.length; i++) if (!drop.has(i)) lots[w++] = lots[i];
  lots.length = w;
  return drop.size;
}

/* ── RR AUCTION URL BACKFILL (Sep 2 2026) — the 30-year archive crawl
   (resolve-rrauction.ts --archive, 251,825 lots) never carried a url, so
   every served RR archive row shipped without a source link (252,429 rows
   in the audit). The id encodes what the link needs: `rrauction-<sale>-<lotId>`
   (verified: every archive id matches /^rrauction-\d+-\d+$/), and the site
   resolves `https://www.rrauction.com/auctions/lot-detail/<lotId>` to the
   lot page (302 → the slugged canonical; verified in a real Chrome session
   against lot 351547607463093 = sale #746 lot #3093). Fill ONLY a null/empty
   url and only for RR-shaped ids — a house-set url always wins. */
const RR_ID = /^rrauction-\d+-(\d+)~?$/;
export function deriveRRAuctionUrls(lots: Lot[]): number {
  let n = 0;
  for (const l of lots) {
    const w = l as { id?: string; url?: string | null; auctionHouse?: string };
    if (w.url) continue;
    const m = RR_ID.exec(String(w.id || ''));
    if (!m) continue;
    w.url = `https://www.rrauction.com/auctions/lot-detail/${m[1]}`;
    n++;
  }
  return n;
}

/* ── CHRISTIE'S DEAD SSO LINKS (Oct 5 2026) — Christie's lot links come in two
   `sso` shapes, and only one of them works:
     · https://onlineonly.christies.com/sso?ObjectID=<sale>.<lot>&LotNumber=<lot>
       is a LIVE permalink: it 301s to the slugged lot page (verified Oct 5
       2026 on 7/7 sampled rows, 2018 → 2026 sales, e.g. 24969.26 →
       /s/breaking-ground-…/andy-warhol-1928-1987-26/324583). resolve-christies.ts
       relies on it. Kept.
     · https://www.christies.com/en/sso?ObjectID=…  (the www host, any /<lang>/sso
       or bare /sso path) is a DEAD link: a 404 on www (verified on all 4 corpus
       rows, the 2012 "50 Years of James Bond" online sale 4431). No real url is
       derivable: the onlineonly host bounces that ObjectID to "/" and the row's
       numeric id (christies-auc-5602497 → /en/lot/lot-5602497) 302s to the
       calendar. So the url is NULLED — a lot must never link to a dead sso page.
   Idempotent; never touches a Christie's url of any other shape. */
const CHRISTIES_DEAD_SSO = /^(?:https?:\/\/(?:www\.)?christies\.com)?\/(?:[a-z]{2}\/)?sso(?:[?#]|$)/i;
export function nullDeadChristiesSsoUrls(lots: Lot[]): number {
  let n = 0;
  for (const l of lots) {
    const w = l as { url?: string | null; auctionHouse?: string };
    if (!w.url || (w.auctionHouse !== "Christie's" && w.auctionHouse !== 'Christies')) continue;
    if (!CHRISTIES_DEAD_SSO.test(String(w.url).trim())) continue;
    w.url = null;
    n++;
  }
  return n;
}

/* ═══════════════════════════════════════════════════════════════════════════
   DATA-QUALITY PASSES (Sep 27 2026 audit, scratchpad audit-data/). Every rule
   below was measured on the served corpus (626k rows) before it was written;
   the counts in the comments are that night's numbers.

   CONTRACT with the engine (comps/value/lanes/backtest read these, never
   recompute them):
     · compExclude?: string — a short reason code; the lot must NEVER be used as
       a comp (it still renders — it is a real row with an untrustworthy price
       or date). First reason wins; normalize only ever SETS it (inputs are the
       raw segments, re-read fresh every night, so a stale code can't linger).
     · datePrecision?: 'day' | 'month' | 'year' — absent = 'day'. A crawler-
       stamped value is always respected; normalize only fills an absent one.
   ═══════════════════════════════════════════════════════════════════════════ */
type DQLot = Lot & {
  compExclude?: string;
  datePrecision?: 'day' | 'month' | 'year' | 'season' | 'unknown';
  resultsPending?: boolean;
  realizedUsd?: number | null;
  hammerUsd?: number | null;
  hammerNative?: number | null;
  estLowUsd?: number | null;
  estHighUsd?: number | null;
  nativeCurrency?: string;
  buyerPremiumPct?: number | null;
  lotNumber?: number | string | null;
};

export const COMP_EXCLUDE = {
  staleUpcoming: 'stale-upcoming',          // never resolved >3d past close
  staleHouse: 'stale-house',                // live lot of a house with no successful crawl in >48h
  priceUnder10: 'price-under-10',           // sold < $10 — fee rows, stubs, lot-of-magazines
  priceVsEstimate: 'price-vs-estimate',     // > 50× high est or < 2% low est
  fxUnconverted: 'fx-unconverted',          // native HKD/CNY figure stored as USD
  lastTrackedBid: 'last-tracked-bid',       // Goldin provisional price, not a hammer
  seedNonLotUrl: 'seed-nonlot-url',         // hand-entered seed pointing at a search/artist page
  estimateUponRequest: 'estimate-upon-request', // artist-page scrape, title carried the est. label
  relistedUnpaid: 'relisted-unpaid',        // NFL Auction: the same item relisted after this "sale"
} as const;

const markExclude = (l: DQLot, reason: string): boolean => {
  if (l.compExclude) return false;
  l.compExclude = reason;
  return true;
};
const compact = (lots: Lot[], drop: Set<number>): number => {
  if (!drop.size) return 0;
  let w = 0;
  for (let i = 0; i < lots.length; i++) if (!drop.has(i)) lots[w++] = lots[i];
  lots.length = w;
  return drop.size;
};
const priceOf = (l: DQLot): number | null => {
  const p = l.realizedUsd ?? l.priceUsd;
  return typeof p === 'number' && p > 0 ? p : null;
};
const normTitle = (t: unknown) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const STATUS_KEEP_RANK: Record<string, number> = { sold: 0, bought_in: 1, upcoming: 2, 'unknown-result': 3, withdrawn: 4 };

// ── RR sale-level STUB rows (84): the 2002-03 archive pages carry a sale-level
// row per consignor with no lot id — id `rrauction-<sale>-0`, url lot-detail/0,
// title "Lot #. Procul Harem", the missing.png image. Not a lot; drop entirely.
export function dropRRStubRows(lots: Lot[]): number {
  const drop = new Set<number>();
  for (let i = 0; i < lots.length; i++) {
    const l = lots[i] as DQLot;
    if (l.auctionHouse !== 'RR Auction') continue;
    if (/^rrauction-\d+-0~?$/.test(String(l.id || '')) || /\/lot-detail\/0\/?$/.test(String(l.url || '')) || /^Lot #\./.test(String(l.title || ''))) drop.add(i);
  }
  return compact(lots, drop);
}

// ── RR SAME-ITEM DUPES (788 groups / 821 extra rows): RR re-lists one consigned
// item under two lot numbers inside ONE sale (a catalogue cross-reference, or a
// relist after a pass). The id's lotId packing isn't a reliable item key (its
// width varies 12–16 digits), but the preview image is: cdn…/auction/<sale>/
// preview/<itemId>_1.jpg. Key = sale + itemId. Guards: every title in the group
// must be prefix-compatible ("Bette Davis" ⊂ "Bette Davis Signed Photograph") —
// 6 groups share an image across unrelated items and are left alone — and a
// group with 2+ SOLD rows at different prices (5) is two real sales, untouched.
// Keeper: sold > bought_in > …, then the longer (fuller) title, then lower lot#.
export function dedupeRRSameSaleItems(lots: Lot[]): number {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < lots.length; i++) {
    const l = lots[i] as DQLot;
    if (l.auctionHouse !== 'RR Auction') continue;
    const sm = /^rrauction-(\d+)-/.exec(String(l.id || ''));
    const im = /\/preview\/(\d+)(?:_\d+[a-z]?)?\.(?:jpe?g|png)/i.exec(String(l.imageUrl || ''));
    if (!sm || !im) continue;
    const k = `${sm[1]}|${im[1]}`;
    const g = groups.get(k); if (g) g.push(i); else groups.set(k, [i]);
  }
  const drop = new Set<number>();
  groups.forEach(idx => {
    if (idx.length < 2) return;
    const rows = idx.map(i => lots[i] as DQLot);
    const ts = rows.map(r => normTitle(r.title));
    if (!ts.every(t => t.startsWith(ts[0]) || ts[0].startsWith(t))) return;
    const soldPrices = new Set(rows.filter(r => r.status === 'sold').map(r => priceOf(r)));
    if (soldPrices.size > 1) return;
    const order = idx.slice().sort((a, b) => {
      const A = lots[a] as DQLot, B = lots[b] as DQLot;
      return (STATUS_KEEP_RANK[A.status] ?? 9) - (STATUS_KEEP_RANK[B.status] ?? 9)
        || String(B.title || '').length - String(A.title || '').length
        || (Number(A.lotNumber) || 0) - (Number(B.lotNumber) || 0)
        || (String(A.id) < String(B.id) ? -1 : 1);
    });
    for (const i of order.slice(1)) drop.add(i);
  });
  return compact(lots, drop);
}

// ── SOTHEBY'S / CHRISTIE'S ID-SCHEME COLLISIONS (74 URLs): Sotheby's rows arrive
// under three id schemes — `sothebys-alg-<uuid>` (Algolia archive), `sothebys-
// <uuid>` (live crawl), and `sothebys-<slug>` (artist-page scrape / hand seeds,
// June-1 placeholder dates). The same lot page under two schemes = one lot twice.
// Canonical key = the lot URL PATH (query/fragment stripped, lower-cased), lot-
// shaped paths only — a seed's shared /artists/<name> or results?query= page is
// NOT a lot key (5 distinct Condo seeds share one). Keeper: the CRAWLED row
// (alg/uuid; Christie's numeric) over a slug/seed row — for sold pairs whose
// dates disagree the crawled date is the real one — then status, then id.
// PHILLIPS runs two id schemes too (Oct 2026 identity audit, 7 pairs): the
// crawled `phillips-<SALE>-<lot>` (NY011125-370: sale code + lot, dated) and a
// bare `phillips-<detailId>` artist-page row (undated, no lot#) pointing at the
// same /detail/<maker>/<detailId> page. Keeper: the sale-code row.
const LOT_PATH: Record<string, RegExp> = {
  "Sotheby's": /^\/(?:[a-z]{2}\/)?buy\/auction\/\d{4}\/[^/]+\/[^/]+$/,
  "Christie's": /^\/(?:[a-z]{2}\/)?lot\/lot-\d+$/,
  Phillips: /^\/detail\/[^/]+\/\d+$/,
};
const isCrawledId = (house: string, id: string): boolean =>
  house === "Sotheby's" ? /^sothebys-(?:alg-|[0-9a-f]{8}-[0-9a-f]{4}-)/i.test(id)
    : house === "Christie's" ? /^christies-(?:auc-)?\d+~?$/.test(id)
    : house === 'Phillips' ? /^phillips-[A-Z]{2}\d{6}-/.test(id) : true;
export function dedupeUrlSchemeCollisions(lots: Lot[]): number {
  const best = new Map<string, number>();
  const drop = new Set<number>();
  const rank = (l: DQLot) => [isCrawledId(l.auctionHouse, String(l.id)) ? 0 : 1, STATUS_KEEP_RANK[l.status] ?? 9];
  for (let i = 0; i < lots.length; i++) {
    const l = lots[i] as DQLot;
    const re = LOT_PATH[l.auctionHouse];
    if (!re || !l.url) continue;
    const p = String(l.url).replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
    if (!re.test(p)) continue;
    const k = `${l.auctionHouse}|${p}`;
    const prev = best.get(k);
    if (prev === undefined) { best.set(k, i); continue; }
    const [ca, sa] = rank(lots[prev] as DQLot), [cb, sb] = rank(l);
    const keepNew = cb < ca || (cb === ca && (sb < sa || (sb === sa && String(l.id) < String(lots[prev].id))));
    if (keepNew) { drop.add(prev); best.set(k, i); } else drop.add(i);
  }
  return compact(lots, drop);
}

// ── NFL AUCTION RELISTS (Oct 2026 identity audit): NFL Auction sells only
// league/club/foundation-consigned items — a buyer cannot consign one back —
// so the SAME item (same iSynApp photo id + same title) closing "sold" and
// then listed again a few weeks later means the first sale did not complete
// (non-paying winner → relist). 78 such rows: every same-photo/same-title
// pair is ≤60 days apart (median 28d) with an empty 60–120d band, and the
// relist hammers at ~0.73× the unpaid high bid. Keep the later sale; the
// earlier row becomes 'unknown-result' (not a sale), comp-excluded, and
// carries `relistedAs` = the relist's id as its evidence. Pairs 5–12 months
// apart (67) are left alone — a reused photo for an identical game-issued
// jersey cannot be ruled out there. Idempotent (only 'sold' rows are marked).
export const NFL_RELIST_MAX_DAYS = 120;
export function markNflRelists(lots: Lot[]): { marked: number; usd: number } {
  const norm = (t: unknown) => normTitle(String(t || '').replace(/\s*\|\s*the official auction site.*$/i, ''));
  const groups = new Map<string, DQLot[]>();
  for (const l of lots as DQLot[]) {
    if (l.auctionHouse !== 'NFL Auction') continue;
    const im = /img-(\d+)/.exec(String(l.imageUrl || ''));
    const d = typeof l.saleDate === 'string' ? l.saleDate.slice(0, 10) : '';
    if (!im || !/^\d{4}-\d\d-\d\d$/.test(d)) continue;
    const k = `${im[1]}|${norm(l.title)}`;
    const g = groups.get(k); if (g) g.push(l); else groups.set(k, [l]);
  }
  let marked = 0, usd = 0;
  groups.forEach(g => {
    if (g.length < 2) return;
    g.sort((a, b) => String(a.saleDate).localeCompare(String(b.saleDate)) || String(a.id).localeCompare(String(b.id)));
    for (let i = 0; i + 1 < g.length; i++) {
      const a = g[i], b = g[i + 1];
      if (a.status !== 'sold' || a.id === b.id) continue;
      const gap = (Date.parse(String(b.saleDate).slice(0, 10)) - Date.parse(String(a.saleDate).slice(0, 10))) / 864e5;
      if (!(gap > 0 && gap <= NFL_RELIST_MAX_DAYS)) continue;
      (a as { status: string }).status = 'unknown-result';
      (a as { relistedAs?: string }).relistedAs = String(b.id);
      a.compExclude = COMP_EXCLUDE.relistedUnpaid;
      usd += priceOf(a) || 0;
      marked++;
    }
  });
  return { marked, usd };
}

// ── BRUUN RASMUSSEN filed as Bonhams (131 rows, `bonhams-brk_<sale>-<hex>`):
// Bonhams owns Bruun Rasmussen and cross-lists some BR sales on bonhams.com,
// so the Bonhams crawler picked BR lots up under the Bonhams house. Only BR sale
// 1008817 is ALSO in the corpus under its bonhams.com number (33077 — same date,
// same lot numbers, same estimates): those brk rows are duplicates → dropped.
// The rest are unique BR lots (Copenhagen) → relabelled to their real house so
// Bonhams' stats/calibration stop absorbing another house's sales.
export const BRUUN_HOUSE = 'Bruun Rasmussen';
export function dedupeBruunUnderBonhams(lots: Lot[]): { dropped: number; relabelled: number } {
  // several Bonhams sales can share a date, so a (date, lot#) slot holds a LIST
  // and the twin must also agree on content: the same estimate band, or ≥3
  // shared title words (the BR title prefixes the maker: "Pablo Picasso: …").
  const bonhamsSlot = new Map<string, DQLot[]>();
  for (const l of lots as DQLot[]) {
    if (l.auctionHouse !== 'Bonhams' || /^bonhams-brk_/.test(String(l.id))) continue;
    if (!l.saleDate || l.lotNumber == null) continue;
    const k = `${String(l.saleDate).slice(0, 10)}|${Number(l.lotNumber)}`;
    const arr = bonhamsSlot.get(k); if (arr) arr.push(l); else bonhamsSlot.set(k, [l]);
  }
  const words = (t: unknown) => normTitle(t).split(' ').filter(w => w.length > 3);
  const drop = new Set<number>();
  let relabelled = 0;
  for (let i = 0; i < lots.length; i++) {
    const l = lots[i] as DQLot;
    if (!/^bonhams-brk_/.test(String(l.id))) continue;
    const cands = l.saleDate && l.lotNumber != null ? bonhamsSlot.get(`${String(l.saleDate).slice(0, 10)}|${Number(l.lotNumber)}`) || [] : [];
    const mine = words(l.title);
    const twin = cands.find(t => {
      const sameEst = t.estimateLow != null && t.estimateLow === l.estimateLow && t.estimateHigh === l.estimateHigh;
      const tw = new Set(words(t.title));
      return sameEst || mine.filter(w => tw.has(w)).length >= 3;
    });
    if (twin) { drop.add(i); continue; }
    if (l.auctionHouse !== BRUUN_HOUSE) { l.auctionHouse = BRUUN_HOUSE; relabelled++; }
  }
  return { dropped: compact(lots, drop), relabelled };
}

// ── BRUUN RASMUSSEN CURRENCY (Oct 6 2026): the Bonhams search API reports
// BR's brk_ sales in DKK (`currency.iso_code: 'DKK'`, checked on live lots;
// bruun-rasmussen.dk prints the same figures in DKK), but the money layer had
// no DKK and the crawler's iso mapper defaulted unknown codes to 'USD' — so
// every BR row carried its DKK figures at fxRate 1 (~6.5× too high in USD).
// The crawler is fail-closed now; the rows already in the segments are
// re-stamped here: the native figures ARE DKK, re-derived to dated USD.
// Idempotent (only rows still stamped USD at rate 1 are touched).
export function restampBruunCurrency(lots: Lot[]): number {
  let n = 0;
  for (const l of lots as (DQLot & Record<string, unknown>)[]) {
    if (!/^bonhams-brk_/.test(String(l.id)) || l.nativeCurrency !== 'USD' || (l.fxRate as number | undefined) !== 1) continue;
    const sd = l.saleDate ? String(l.saleDate) : null;
    const conv = (x: unknown) => toUsdDated(typeof x === 'number' ? x : null, 'DKK', sd);
    const fx = conv(null);
    l.nativeCurrency = 'DKK'; l.currency = 'DKK';
    l.fxRate = fx.rate; l.fxAsOf = fx.asOf;
    l.estLowUsd = conv(l.estLowNative).usd; l.estHighUsd = conv(l.estHighNative).usd;
    l.estimateLow = l.estLowUsd; l.estimateHigh = l.estHighUsd;
    l.hammerUsd = conv(l.hammerNative).usd; l.premiumUsd = conv(l.premiumNative).usd;
    l.realizedUsd = conv(l.realizedNative).usd; l.priceUsd = l.realizedUsd;
    n++;
  }
  return n;
}

// ── CHRISTIE'S SALEROOM CURRENCY (Oct 6 2026): the artist-page crawler read
// the currency off the estimate string only and defaulted to USD, so a lot
// whose estimate was "on request" kept its LOCAL figure under a USD label —
// 19 sold rows (17 London, 1 Hong Kong, 1 Paris; e.g. christies-6377627 a
// HK$174.95M Picasso stored as $174.95M, true ≈ $22.4M). The saleroom prices
// the sale (saleName "<Location> Sale <n>"): a USD-stamped row from a
// non-USD saleroom is re-labelled to that saleroom's currency (restampFx then
// re-derives every USD field); a saleroom we cannot convert is quarantined.
export function restampChristiesSaleroomCurrency(lots: Lot[]): { restamped: number; quarantined: number } {
  let restamped = 0, quarantined = 0;
  for (const l of lots as (DQLot & Record<string, unknown>)[]) {
    if (l.auctionHouse !== "Christie's" || !/^christies-\d+~?$/.test(String(l.id)) || l.nativeCurrency !== 'USD') continue;
    const m = /^(.*) Sale \d+$/.exec(String(l.saleName || ''));
    if (!m || /^new york\b/i.test(m[1])) continue;
    const cur = christiesLocationCurrency(m[1]);
    if (cur === 'USD') continue;
    if (cur == null) {
      if (/^(?:mumbai|dubai)\b/i.test(m[1])) { markExclude(l, FX_UNKNOWN); quarantined++; }
      continue;
    }
    l.nativeCurrency = cur; l.currency = cur;
    restamped++;
  }
  return { restamped, quarantined };
}
const FX_UNKNOWN = 'fx-unknown-currency';

// ── FX RE-APPLIED NIGHTLY (Oct 6 2026): rates were stamped once at crawl time
// and never revisited, so a row crawled before a table correction kept the
// old rate (1,590 sold lots, $13.4M understated — the 2025 GBP/EUR
// placeholders, pre-2000 sales at the 2000 rate). Native is the fact: every
// non-USD row's USD fields are re-derived from its native amounts at the
// table rate for its sale date (toUsdDated — the crawler's own conversion).
// A USD field whose native twin is absent is left as it is. Returns the rows
// whose USD figures changed.
export function restampFx(lots: Lot[]): number {
  let changed = 0;
  for (const l of lots as (DQLot & Record<string, unknown>)[]) {
    const cur = l.nativeCurrency;
    if (!cur || cur === 'USD' || !isCurrency(cur)) continue;
    const sd = l.saleDate ? String(l.saleDate) : null;
    const { rate, asOf } = fxRateFor(cur, sd);
    const conv = (n: unknown) => (typeof n === 'number' ? toUsdDated(n, cur, sd).usd : undefined);
    const before = `${l.realizedUsd}|${l.hammerUsd}|${l.premiumUsd}|${l.estLowUsd}|${l.estHighUsd}`;
    const set = (usdKey: string, nativeKey: string) => { const v = conv(l[nativeKey]); if (v !== undefined) l[usdKey] = v; };
    set('hammerUsd', 'hammerNative'); set('premiumUsd', 'premiumNative'); set('realizedUsd', 'realizedNative');
    set('estLowUsd', 'estLowNative'); set('estHighUsd', 'estHighNative');
    if (typeof l.realizedNative === 'number') l.priceUsd = l.realizedUsd as number | null;
    if (typeof l.estLowNative === 'number') l.estimateLow = l.estLowUsd as number | null;
    if (typeof l.estHighNative === 'number') l.estimateHigh = l.estHighUsd as number | null;
    l.fxRate = rate; l.fxAsOf = asOf;
    if (`${l.realizedUsd}|${l.hammerUsd}|${l.premiumUsd}|${l.estLowUsd}|${l.estHighUsd}` !== before) changed++;
  }
  return changed;
}

// ── FOREIGN LEADING MAKER (Chagall under Picasso, Basquiat/Cocteau under Warhol,
// Miró under Matisse): a title that LEADS with a different artist's full name —
// "Jean-Michel Basquiat", "MIRÓ, Joan et René CHAR", "After Marc Chagall" — and
// never names the slug's own maker anywhere is that other artist's lot. Re-route
// to the named artist when it is a tracked slug, else drop (untracked makers are
// never kept — same doctrine as rerouteScienceMisroutes). Rule-based and
// anchored at the title START only; "…at the Basquiat Opening" is untouched.
const FOREIGN_MAKERS: [string, string, string | null][] = [
  // [first, last, tracked slug | null]
  ['Marc', 'Chagall', null], ['Joan', 'Mir[oó]', null], ['Salvador', 'Dal[ií]', null],
  ['Georges', 'Braque', null], ['Fernand', 'L[ée]ger', null], ['Jean', 'Cocteau', null],
  ['Jean-Michel', 'Basquiat', null], ['Roy', 'Lichtenstein', null], ['David', 'Hockney', null],
  ['Jean', 'Dubuffet', null], ['Paul', 'C[ée]zanne', null], ['Pierre-Auguste', 'Renoir', null],
  ['Amedeo', 'Modigliani', null], ['Wassily', 'Kandinsky', null], ['Paul', 'Klee', null],
  ['Ren[ée]', 'Magritte', null], ['Robert', 'Rauschenberg', null], ['Jasper', 'Johns', null],
  ['Damien', 'Hirst', null], ['Jeff', 'Koons', null], ['Yayoi', 'Kusama', null], ['Alexander', 'Calder', null],
  ['Henri', 'Matisse', 'henri-matisse'], ['Pablo', 'Picasso', 'pablo-picasso'], ['Andy', 'Warhol', 'andy-warhol'],
  ['Keith', 'Haring', 'keith-haring'], ['Ed', 'Ruscha', 'ed-ruscha'], ['George', 'Condo', 'george-condo'],
];
const FOREIGN_LEAD = FOREIGN_MAKERS.map(([first, last, slug]) => ({
  re: new RegExp(`^\\s*(?:after|attributed to|circle of|school of|follower of|manner of)?\\s*(?:${first}\\s+${last}|${last},\\s*${first})\\b`, 'i'),
  slug,
}));
const OWN_NAME = new Map(ART_MAKER_SLUG.map(([re, slug]) => [slug, re]));
export function rerouteForeignLeadMaker(lots: Lot[]): { rerouted: number; dropped: number } {
  const drop = new Set<number>();
  let rerouted = 0;
  for (let i = 0; i < lots.length; i++) {
    const l = lots[i];
    const own = OWN_NAME.get(l.artist);
    if (!own) continue;
    const title = String(l.title || '');
    const hit = FOREIGN_LEAD.find(f => f.re.test(title));
    if (!hit || hit.slug === l.artist) continue;
    if (own.test(`${title} ${l.medium ?? ''}`)) continue; // names its own maker too — leave it
    if (hit.slug) { l.artist = hit.slug; if (l.makerSlug) l.makerSlug = hit.slug; rerouted++; }
    else drop.add(i);
  }
  return { rerouted, dropped: compact(lots, drop) };
}

// ── PRE-WAR SET CODES → cards (≈13k rows): REA/H&S/Lelands/LOTG/Memory Lane
// filed "1909-11 T206 … with Bat", "1887 N172 Old Judge …", "1933 R319 Goudey"
// under memorabilia / game-used / autographs because classifySports only knew
// t20x/e9x (the crawler side is fixed in sports-crawl.ts; this heals the rows
// already in the segments). Same leading-anchored detector (set-codes.ts), the
// expansion houses only (their pseudo-artist taxonomy), never unopened wax.
const SET_CODE_HOUSES = new Set(['REA', 'Huggins & Scott', 'SCP', 'Lelands', 'Memory Lane', 'Love of the Game', "Hake's"]);
const SET_CODE_FROM = new Set(['memorabilia', 'game-used', 'autographs', 'pop-memorabilia', 'type-1-photos', 'equipment-artifacts', 'trophies-awards', 'programs-publications', 'tickets-passes']);
export function rerouteSetCodeCards(lots: Lot[]): number {
  let n = 0;
  for (const l of lots) {
    if (!SET_CODE_HOUSES.has(l.auctionHouse) || !SET_CODE_FROM.has(l.artist)) continue;
    const t = String(l.title || '');
    if (/\b(unopened|wax box|wax pack|sealed)\b/i.test(t) || !leadsWithSetCode(t)) continue;
    l.artist = 'graded-cards';
    if (l.makerSlug) l.makerSlug = 'graded-cards';
    n++;
  }
  return n;
}

// ── RECLASSIFY (Oct 6 2026 categorization audit) — the shared classification
// ladder (scripts/lib/classify.ts RECLASS_RULES) re-applied to EVERY row, every
// nightly, so a rule fixes the back-catalogue as well as tomorrow's crawl.
// A rule moves a lot to its correct artist slug or evicts it (no valid home);
// per-class counts are logged so a rule's blast radius is visible nightly.
/** (Oct 6, sports labeling wave) A CARD row's playerName is the card
 *  parser's player — the one build-market stamps on a live card. A sold card
 *  keeps the name stamped while it was live, by whatever parser ran then:
 *  5.2k carry set / brand runs ("Baseball Hall", "Red Man Tobacco", "Post
 *  Cereal Complete", "Playoff Contenders" on a Tom Brady card). Re-read it;
 *  with no parsed player keep only an athlete — the roster, or a player the
 *  card parser reads across the corpus (`known`: a "Darrelle Revis Patch Card
 *  Collection (11)" lot keeps Revis). */
export function restampCardPlayer(w: { title?: string | null; playerName?: string | null; playerSlug?: string | null }, known?: ReadonlySet<string>): string | null {
  const c = parseCard(String(w.title || ''));
  if (c.player && c.playerSlug) {
    if ((w.playerSlug || playerSlugOf(w.playerName || null)) === c.playerSlug) return null;
    w.playerName = c.player; w.playerSlug = c.playerSlug;
    return 'card-player-restamped';
  }
  const slug = w.playerSlug || playerSlugOf(w.playerName || null);
  if (slug && (ATHLETES.has(slug.replace(/-/g, ' ')) || known?.has(slug))) return null;
  delete w.playerName; delete w.playerSlug;
  return 'card-player-cleared';
}

export function reclassifyCorpus(lots: Lot[]): { byClass: Record<string, number>; dropped: number } {
  const byClass: Record<string, number> = {};
  const drop = new Set<number>();
  let stalePlayers = 0;
  let knownCardPlayers: Set<string> | null = null;
  for (let i = 0; i < lots.length; i++) {
    const r = reclassifyLot(lots[i] as Lot & { saleName?: string | null; description?: string | null });
    for (const c of r.fired) byClass[c] = (byClass[c] || 0) + 1;
    if (r.drop) { drop.add(i); continue; }
    // (wave 2) a player is a SPORTS identity: a row that is not (or no longer)
    // in the sports market sheds the crawl-time playerName/playerSlug it carried
    // in ("CHINESE A GRAY", "Walt Disney Studios", a moved Julien's lot's
    // "MARILYN MONROE") — 2,458 moved rows kept theirs; the signer pass and the
    // backtest identity read playerSlug first, so a stale one shadows them.
    const w = lots[i] as Lot & { playerName?: string | null; playerSlug?: string | null };
    if ((w.playerName || w.playerSlug) && ARTIST_MARKET[w.artist as keyof typeof ARTIST_MARKET] !== 'sports') {
      delete w.playerName; delete w.playerSlug; stalePlayers++;
    } else if ((w.playerName || w.playerSlug) && (w.artist === 'sports-cards' || w.artist === 'graded-cards')) {
      // the corpus's card-parsed players (knownPlayerSet), built once, lazily
      if (!knownCardPlayers) {
        const names: (string | null)[] = [];
        for (const l of lots) if (l.artist === 'sports-cards' || l.artist === 'graded-cards') names.push(parseCard(String(l.title || '')).player);
        knownCardPlayers = knownPlayerSet(names);
      }
      const r2 = restampCardPlayer(w, knownCardPlayers);
      if (r2) byClass[r2] = (byClass[r2] || 0) + 1;
    }
  }
  if (stalePlayers) byClass['stale-player-cleared'] = stalePlayers;
  return { byClass, dropped: compact(lots, drop) };
}

// ── STALE UPCOMING (3,732 on Sep 27: H&S 2,350 · REA 1,068 · MLB 193 · Phillips
// 74 · Bonhams 25 · Sotheby's 15 · Christie's 7): a lot still 'upcoming' more
// than 3 days past its close never had its result resolved (REA/H&S closed-sale
// markup the parser rejects, MLB's CI block, login-gated results). It is not on
// the block and has no known outcome: demote to the existing 'unknown-result'
// state (the LotCard no-sale state already renders it), drop resultsPending, and
// keep it out of comps. The crawler segment is untouched — if the house's
// results pass later resolves the lot, tomorrow's row arrives 'sold' and wins.
export function demoteStaleUpcoming(lots: Lot[], now: Date = new Date(), graceDays = 3): { total: number; byHouse: Record<string, number> } {
  const cut = new Date(now.getTime() - graceDays * 864e5).toISOString().slice(0, 10);
  const byHouse: Record<string, number> = {};
  let total = 0;
  for (const l of lots as DQLot[]) {
    if (l.status !== 'upcoming') continue;
    const d = typeof l.saleDate === 'string' ? l.saleDate.slice(0, 10) : '';
    const dt = typeof l.saleDateTime === 'string' ? l.saleDateTime.slice(0, 10) : '';
    const close = dt > d ? dt : d;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(close) || close >= cut) continue;
    (l as { status: string }).status = 'unknown-result';
    if ('resultsPending' in l) l.resultsPending = false;
    markExclude(l, COMP_EXCLUDE.staleUpcoming);
    byHouse[l.auctionHouse || '?'] = (byHouse[l.auctionHouse || '?'] || 0) + 1;
    total++;
  }
  return { total, byHouse };
}

// ── STALE HOUSE (Oct 3 2026, ops audit): 1,384 Hake's lots last seen Sep 23
// were still served as live a week after the house's crawl stopped landing.
// A house whose last SUCCESSFUL crawl is older than 48h (the per-house ledger,
// scripts/lib/house-status.ts → assemble passes the stale segment keys here)
// has its 'upcoming' lots demoted to 'unknown-result' + staleHidden:true, so
// no consumer (upcoming.json, the Supabase live sync, every lane that filters
// status==='upcoming') serves a bid/close we can no longer vouch for. The
// segment is untouched — NOTHING is deleted: the first night the house crawls
// OK again its rows arrive 'upcoming' and the hide lifts by itself.
export function hideStaleHouseLive(lots: Lot[], staleSegments: ReadonlySet<string>): { total: number; byHouse: Record<string, number> } {
  const byHouse: Record<string, number> = {};
  let total = 0;
  if (!staleSegments.size) return { total, byHouse };
  for (const l of lots as DQLot[]) {
    if (l.status !== 'upcoming') continue;
    const seg = segmentOf(String(l.auctionHouse || ''));
    if (!staleSegments.has(seg)) continue;
    (l as { status: string }).status = 'unknown-result';
    (l as { staleHidden?: boolean }).staleHidden = true;
    if ('resultsPending' in l) l.resultsPending = false;
    markExclude(l, COMP_EXCLUDE.staleHouse);
    byHouse[seg] = (byHouse[seg] || 0) + 1;
    total++;
  }
  return { total, byHouse };
}

// ── COMP-EXCLUDE PRICE / PROVENANCE RULES ──
// Genuine blow-out single-owner sales (celebrity provenance; charity) whose
// prices legitimately run 50–275× a nominal estimate — verified in the corpus:
// Freddie Mercury "A World of His Own" (Sotheby's 2023, ~45 rows), Elizabeth
// Taylor (Christie's 2011), Karl Lagerfeld estate, Bowie/Collector, Only Watch.
const OUTLIER_WHITELIST_SALE = /freddie mercury|elizabeth taylor|lagerfeld|bowie|only watch/i;
// currencies whose USD rate is far enough from 1 that an unconverted native
// figure is detectable (a GBP/EUR/CHF slip is within noise — not claimed)
const FX_DETECTABLE: Record<string, number> = { HKD: 7.8, CNY: 7.1, JPY: 150 };
export function stampCompExcludes(lots: Lot[]): Record<string, number> {
  const out: Record<string, number> = {};
  const bump = (l: DQLot, r: string) => { if (markExclude(l, r)) out[r] = (out[r] || 0) + 1; };
  for (const l of lots as DQLot[]) {
    const title = String(l.title || '');
    // artist-page scrape: "Arlequin (Buste) Estimate Upon Request" — clean the
    // title (the label is not the work) and keep it out of comps.
    if (/\s*\bEstimate Upon Request\b\s*$/i.test(title)) {
      l.title = title.replace(/\s*\bEstimate Upon Request\b\s*$/i, '').trim();
      bump(l, COMP_EXCLUDE.estimateUponRequest);
    }
    // hand-entered seed whose url is a search / artist page — no lot to verify
    if (l.url && /results\?query=|\/artists?\/|[?&](?:q|query)=|\/search\b/i.test(String(l.url))) bump(l, COMP_EXCLUDE.seedNonLotUrl);
    if ((l as { priceBasis?: string }).priceBasis === 'last-tracked-bid') bump(l, COMP_EXCLUDE.lastTrackedBid);
    if (l.status !== 'sold') continue;
    const p = priceOf(l);
    if (p === null) continue;
    if (p < 10) { bump(l, COMP_EXCLUDE.priceUnder10); continue; }
    const hi = l.estHighUsd ?? l.estimateHigh, lo = l.estLowUsd ?? l.estimateLow;
    const cur = String(l.nativeCurrency || l.currency || 'USD');
    const rate = FX_DETECTABLE[cur];
    if (rate && hi && hi > 0 && p > 20 * hi) {
      const conv = p / rate;
      if (conv >= 0.5 * (lo || hi) && conv <= 20 * hi) { bump(l, COMP_EXCLUDE.fxUnconverted); continue; }
    }
    if (OUTLIER_WHITELIST_SALE.test(String(l.saleName || ''))) continue;
    if ((hi && hi > 0 && p > 50 * hi) || (lo && lo > 0 && p < 0.02 * lo)) bump(l, COMP_EXCLUDE.priceVsEstimate);
  }
  return out;
}

// ── PLACEHOLDER IMAGES → null (the UI's no-image state, not a fake photo):
// Christie's NoImage alert (18,431) + generic wine-lot image, RR missing.png
// (2,183), Sotheby's one shared generic lot.jpg (3,862) + "under copyright"
// cards, and Lelands/LOTG thumbs truncated to a bare `thumb_` (61).
const PLACEHOLDER_IMG: [string, RegExp][] = [
  ['christies-noimage', /christies\.com\/img\/LotImages\/Alert\/(?:NoImage|WineLot)\//i],
  ['rr-missing', /rrauction\.com\/assets\/img\/missing\.png/i],
  ['sothebys-generic', /59fa5b71fac41f69087283fc636e351464ae6e590e9c1cb5f016306f9a%2Flot\.jpg|undercopyright\.jpg|image-under-copyright\.png/i],
  ['truncated-thumb', /\/thumbs\/thumb_(?:[?#].*)?$/i],
];
export function nullPlaceholderImages(lots: Lot[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lots) {
    const u = l.imageUrl;
    if (!u) continue;
    const hit = PLACEHOLDER_IMG.find(([, re]) => re.test(u));
    if (hit) { l.imageUrl = null; out[hit[0]] = (out[hit[0]] || 0) + 1; }
  }
  return out;
}

// ── DATE PRECISION: synthesized dates must not pose as a real sale day.
//  · 'month' — REA / H&S / Lelands / LOTG / Memory Lane dates built by
//    seasonToDate ("2018 Spring" → 2018-04-15; crawl-lelands-gallery.ts:120,167)
//    are always the 15th; a row on the 15th of those houses with no parsed
//    saleDateTime is that synthesized month stamp.
//  · 'year' — Sotheby's artist-page scrape (ray-crawl slug-scheme ids) dates
//    every lot June 1 of the URL's year (246 rows).
// A crawler-stamped datePrecision (e.g. crawler emits 'month') always wins.
const MONTH_DATE_HOUSES = new Set(['REA', 'Huggins & Scott', 'Lelands', 'Love of the Game', 'Memory Lane']);
export function stampDatePrecision(lots: Lot[]): { month: number; year: number } {
  let month = 0, year = 0;
  for (const l of lots as DQLot[]) {
    if (l.datePrecision) continue;
    const d = typeof l.saleDate === 'string' ? l.saleDate : '';
    if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
    if (MONTH_DATE_HOUSES.has(l.auctionHouse) && d.slice(8, 10) === '15' && !l.saleDateTime) { l.datePrecision = 'month'; month++; continue; }
    if (l.auctionHouse === "Sotheby's" && d.slice(5, 10) === '06-01' && !isCrawledId("Sotheby's", String(l.id)) && !l.saleDateTime) { l.datePrecision = 'year'; year++; }
  }
  return { month, year };
}

// ── SEASON CLOSE DATES (identity fix wave, Oct 2026): REA / H&S archive rows
// were dated by seasonToDate's mid-month stub ("2019 Summer" → 2019-07-15,
// 'month') while the sales close weeks later (REA Summer mid-Aug, REA Fall
// early Dec, H&S month labels up to two months before the close) — so the
// engine read their prices as known before the sale ended. Re-date every row
// still carrying the stub (datePrecision 'month', no saleDateTime, saleDate ==
// the stub its saleName produces) to the cited close day ('day') or the
// conservative season-end bound ('season') from sale-close-dates.ts; fxAsOf
// follows when it was the stub (USD rows: rate 1, the stamp is the date).
// Rows with a real close (live bid-page endTime → saleDateTime) are never
// touched; REA monthly sales (close inside their label month) keep the stub.
// Idempotent: a re-dated row no longer matches the stub.
export function redateSeasonSales(lots: Lot[], now: Date = new Date()): { total: number; bySale: Record<string, number> } {
  const asOf = now.toISOString().slice(0, 10);
  const bySale: Record<string, number> = {};
  let total = 0;
  for (const l of lots as DQLot[]) {
    if (l.auctionHouse !== 'REA' && l.auctionHouse !== 'Huggins & Scott') continue;
    if (l.datePrecision !== 'month' || l.saleDateTime) continue;
    const name = typeof l.saleName === 'string' ? l.saleName : '';
    const stub = name ? seasonToDate(name) : null;
    if (!stub || l.saleDate !== stub) continue;
    const close = saleCloseFor(l.auctionHouse, name, asOf);
    if (!close) continue;
    l.saleDate = close.date;
    l.datePrecision = close.precision;
    if ((l as { fxAsOf?: string | null }).fxAsOf === stub) (l as { fxAsOf?: string | null }).fxAsOf = close.date;
    const k = `${l.auctionHouse}|${name}`;
    bySale[k] = (bySale[k] || 0) + 1;
    total++;
  }
  return { total, bySale };
}

// ── GALLERY STUB DATES (date re-audit, Oct 2026): Lelands / Love of the Game /
// Memory Lane gallery rows carry seasonToDate's mid-month stub of the dropdown
// sale name but NO saleName (the crawler dropped it), and the stub is not a
// safe bound there (LOTG Fall → Oct 15 closed late Nov; Lelands Spring →
// Apr 15 closed Jun 7; ML "The Find Winter 2012" → Feb 15 closed Dec 15).
// sale-close-dates.ts inverts the stub over the house's own dropdown labels:
// a unique cited sale → its close ('day'); several cited → the latest close
// as a bound ('season'); any uncited candidate → untouched. A row whose 15th
// is itself a cited close (live-leg End: day) only loses the guessed 'month'.
// Only 'month' rows with no saleDateTime; a re-dated row is no longer 'month',
// so the pass is idempotent. fxAsOf follows when it was the stub.
export function redateGalleryStubs(lots: Lot[], now: Date = new Date()): { total: number; exact: number; byHouse: Record<string, number> } {
  const asOf = now.toISOString().slice(0, 10);
  const byHouse: Record<string, number> = {};
  let total = 0, exact = 0;
  for (const l of lots as DQLot[]) {
    if (!GALLERY_HOUSES.has(l.auctionHouse)) continue;
    if (l.datePrecision !== 'month' || l.saleDateTime || typeof l.saleDate !== 'string') continue;
    const stub = l.saleDate.slice(0, 10);
    const name = typeof l.saleName === 'string' && l.saleName ? l.saleName : null;
    const named = name ? saleCloseFor(l.auctionHouse, name, asOf) : null;
    const r = named && seasonToDate(name!) === stub ? named : galleryStubClose(l.auctionHouse, stub, asOf);
    if (!r) continue;
    if ('exact' in r) { l.datePrecision = 'day'; exact++; continue; }
    l.saleDate = r.date;
    l.datePrecision = r.precision;
    if ((l as { fxAsOf?: string | null }).fxAsOf === stub) (l as { fxAsOf?: string | null }).fxAsOf = r.date;
    byHouse[l.auctionHouse] = (byHouse[l.auctionHouse] || 0) + 1;
    total++;
  }
  return { total, exact, byHouse };
}

// ── HAMMER == ALL-IN (Wright 989 · LAMA 338): older Wright-platform rows copied
// the premium-inclusive price into the hammer field, so every hammer-basis read
// (inferHammerUsd, houseCal, max-bid guidance) took a realized price as the
// hammer. Recompute from the lot's OWN stamped buyer's premium when it has one;
// otherwise null the hammer (inferHammerUsd then derives it from the house
// schedule — an inference, labelled as such, instead of a wrong fact).
// priceBasis 'hammer-only' rows are genuinely hammer = price and are skipped.
export function fixFamilyHammerEqualsPrice(lots: Lot[]): { recomputed: number; nulled: number } {
  let recomputed = 0, nulled = 0;
  for (const l of lots as DQLot[]) {
    if (!(l.auctionHouse === 'Wright' || l.auctionHouse === 'LAMA' || l.auctionHouse === 'Rago')) continue;
    if (l.status !== 'sold' || (l as { priceBasis?: string }).priceBasis === 'hammer-only') continue;
    const p = priceOf(l);
    const h = l.hammerUsd ?? l.hammerPrice;
    if (p === null || !(typeof h === 'number' && h > 0) || Math.abs(h - p) >= 0.5) continue;
    const bp = l.buyerPremiumPct;
    if (typeof bp === 'number' && bp > 0 && bp < 60) {
      const ham = Math.round((p / (1 + bp / 100)) * 100) / 100;
      l.hammerUsd = ham; l.hammerPrice = ham;
      if (l.hammerNative != null) l.hammerNative = ham;
      recomputed++;
    } else {
      l.hammerUsd = null; l.hammerPrice = null; l.hammerNative = null;
      nulled++;
    }
  }
  return { recomputed, nulled };
}

export type HygieneReport = {
  rrStubs: number; rrDupes: number; urlDupes: number;
  bruun: { dropped: number; relabelled: number; restamped: number };
  fx: { saleroom: number; quarantined: number; restamped: number };
  foreignMaker: { rerouted: number; dropped: number };
  setCodeCards: number;
  staleUpcoming: { total: number; byHouse: Record<string, number> };
  staleHouse: { total: number; byHouse: Record<string, number> };
  compExclude: Record<string, number>;
  images: Record<string, number>;
  datePrecision: { month: number; year: number };
  seasonDates: { total: number; bySale: Record<string, number> };
  hammer: { recomputed: number; nulled: number };
};

export function normalizeCorpus(lots: AuctionLot[], opts: { now?: Date; staleHouses?: ReadonlySet<string> } = {}): HygieneReport {
  const ls = lots as Lot[];
  // LLM extraction (advisory, Sep 28 2026): attach cached, validated fields
  // keyed by id + hash of the CRAWLED text — before any pass rewrites a title.
  // Inert (one log line, zero mutation) without the extraction gate.
  attachExtractions(ls);
  // real REA / H&S close days before any pass reads saleDate
  const seasonDates = redateSeasonSales(ls, opts.now);
  console.log(`[normalize] season sales re-dated to their close: ${seasonDates.total} rows across ${Object.keys(seasonDates.bySale).length} sales`);
  const galleryDates = redateGalleryStubs(ls, opts.now);
  console.log(`[normalize] gallery stub dates → cited close: ${galleryDates.total} (${Object.entries(galleryDates.byHouse).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}) · exact 15th closes un-'month'ed=${galleryDates.exact}`);
  const rrUrls = deriveRRAuctionUrls(ls);
  if (rrUrls) console.log(`[normalize] rrauction url backfill: ${rrUrls} lots derived from id (lot-detail/<lotId>)`);
  const deadSso = nullDeadChristiesSsoUrls(ls);
  if (deadSso) console.log(`[normalize] christie's dead www /sso urls nulled: ${deadSso}`);
  const rrStubs = dropRRStubRows(ls);
  const mirrorDupes = dedupeWrightFamilyMirrors(ls);
  // the Sep 27 dedupe family (next to the Wright mirrors — same compaction):
  const rrDupes = dedupeRRSameSaleItems(ls);
  const urlDupes = dedupeUrlSchemeCollisions(ls);
  const bruun = { ...dedupeBruunUnderBonhams(ls), restamped: restampBruunCurrency(ls) };
  const nflRelists = markNflRelists(ls);
  // currency labels first, then every non-USD row's USD figures re-derived at
  // today's table (before any pass reads a USD price)
  const saleroom = restampChristiesSaleroomCurrency(ls);
  // sale-local day BEFORE the FX restamp (dated rates key on saleDate) and
  // after the saleroom currency labels (Sotheby's zone is read from currency)
  const localized = localizeSaleDates(ls);
  console.log(`[normalize] saleDate → sale-local day: ${localized.total} (${Object.entries(localized.byHouse).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'})`);
  const fx = { saleroom: saleroom.restamped, quarantined: saleroom.quarantined, restamped: restampFx(ls) };
  console.log(`[normalize] fx: christie's saleroom currency re-labelled=${fx.saleroom} quarantined=${fx.quarantined} · USD fields re-derived from native on ${fx.restamped} rows`);
  console.log(`[normalize] dedupe: rr stub rows=${rrStubs} · rr same-sale item dupes=${rrDupes} · sotheby's/christie's/phillips url-scheme dupes=${urlDupes} · bruun-under-bonhams dropped=${bruun.dropped} relabelled=${bruun.relabelled} DKK-restamped=${bruun.restamped} · nfl relists (earlier sale unpaid)=${nflRelists.marked} ($${Math.round(nflRelists.usd)})`);
  // drop misattributed lots AFTER healExpansionRows cleans titles below? No —
  // isMisattributed reads the raw title (car marques / life-dates survive any
  // title clean), and dropping early shrinks every pass that follows.
  const misattr = dropMisattributed(ls);
  if (misattr) console.log(`[normalize] dropped ${misattr} misattributed lots (cars in art pools, name collisions)`);
  const foreignMaker = rerouteForeignLeadMaker(ls);
  const setCodeCards = rerouteSetCodeCards(ls);
  console.log(`[normalize] category: foreign-lead-maker rerouted=${foreignMaker.rerouted} dropped=${foreignMaker.dropped} · pre-war set codes→graded-cards=${setCodeCards}`);
  const reclass = reclassifyCorpus(ls);
  console.log(`[normalize] reclassify (scripts/lib/classify.ts): ${Object.entries(reclass.byClass).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'} · evicted=${reclass.dropped}`);
  // ENGINE SPEC v2 order: category flips (2c) run BEFORE identity work;
  // restampIdentityKeys (5) runs LAST so every flip re-derives its formKey.
  // healExpansionRows runs FIRST: it cleans titles (every parser below reads
  // them) and stamps the missing identity tokens.
  const healed = healExpansionRows(ls);
  const edSer = rederiveEditionsSerials(ls);
  console.log(`[normalize] editions re-derived=${edSer.editions} · serials re-derived=${edSer.serials}`);
  const techMoved = rerouteCultureTech(ls);
  const yearsNulled = clampImpossibleYears(ls);
  const reroute = rerouteScienceMisroutes(ls);
  const relic = rerouteRelicCards(ls);
  const cat = normalizeArtCategory(ls);
  const refsFilled = enrichWatchReferences(ls);
  // regex first; the extraction fills only a reference still empty (src:'llm')
  fillWatchReferencesFromExtract(ls);
  const junkModelKeys = clearJunkModelKeys(ls);
  console.log(`[normalize] junk modelKeys cleared (grade / size / metal tokens outside design, art and watch model lines): ${junkModelKeys}`);
  const players = recoverPlayerSlugs(ls);
  const junkEntities = healCrawlEntities(ls);
  if (junkEntities) console.log(`[normalize] crawl entity tags trimmed to a person's name / cleared: ${junkEntities}`);
  const signers = recoverAutographSigners(ls);
  const cultureStamped = stampCultureAxes(ls);
  const datesFixed = reconcileSaleDates(ls);
  const restamped = restampIdentityKeys(ls);
  const sub = stampSubCats(ls);
  if (relic.total) {
    console.log(`[normalize] relic-card reroute: ${relic.total} game-used→sports-cards. e.g. ${relic.examples.slice(0, 3).map(s => JSON.stringify(s.slice(0, 70))).join(', ')}`);
  }
  console.log(
    `[normalize] yearNum>${new Date().getFullYear() + 1} nulled=${yearsNulled} · ` +
    `science misroutes fixed=${reroute.total} (→art ${reroute.toArt}, →watches ${reroute.toWatch}, evicted ${reroute.evicted}) · ` +
    `relic cards→sports-cards=${relic.total} · ` +
    `art category heal o2p=${cat.o2p} p2o=${cat.p2o} · ` +
    `watch references filled=${refsFilled} · ` +
    `wright-family mirror dupes dropped=${mirrorDupes} · ` +
    `playerSlug stamped=${players.stamped} (coverage ${(players.coverage * 100).toFixed(1)}%) · ` +
    `autograph signers stamped=${signers.stamped}/${signers.candidates} · ` +
    `culture axes stamped=${cultureStamped} · ` +
    `saleDate←saleDateTime reconciled=${datesFixed} · ` +
    `formKey restamped=${restamped} · ` +
    `subCats stamped=${sub.subCats} drills=${sub.drills} (sport recovered=${sub.sportRecovered}) · ` +
    `heal: tokens=${healed.tokens} titles=${healed.titles} images=${healed.images} dates=${healed.dates} pkmn-grades=${healed.grades} dims=${healed.dims} · culture→science=${techMoved}`
  );
  // BUILD CANARY (spec §3.4): game-used identity is a maintained-list parser —
  // a Sotheby's title-format change must fail the build, not silently starve
  // the sports comp layer. 85% floor vs the measured 93.9%.
  if (players.total >= 200 && players.coverage < 0.85) {
    throw new Error(`[normalize] game-used playerSlug coverage ${(players.coverage * 100).toFixed(1)}% < 85% floor — title parser drifted; refusing to publish`);
  }
  // Sep 27 data-quality stamps — AFTER reconcileSaleDates (stale-upcoming reads
  // the reconciled date) and healExpansionRows (images get their scheme first).
  const staleUpcoming = demoteStaleUpcoming(ls, opts.now);
  const staleHouse = hideStaleHouseLive(ls, opts.staleHouses ?? new Set());
  const compExclude = stampCompExcludes(ls);
  const images = nullPlaceholderImages(ls);
  const datePrecision = stampDatePrecision(ls);
  const hammer = fixFamilyHammerEqualsPrice(ls);
  const kv = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ') || 'none';
  console.log(
    `[normalize] data-quality: stale upcoming→unknown-result=${staleUpcoming.total} (${kv(staleUpcoming.byHouse)}) · ` +
    `stale-house live hidden=${staleHouse.total} (${kv(staleHouse.byHouse)}) · ` +
    `compExclude ${kv(compExclude)} · placeholder images nulled ${kv(images)} · ` +
    `datePrecision month=${datePrecision.month} year=${datePrecision.year} · ` +
    `wright-family hammer==all-in recomputed=${hammer.recomputed} nulled=${hammer.nulled}`
  );
  return { rrStubs, rrDupes, urlDupes, bruun, fx, foreignMaker, setCodeCards, staleUpcoming, staleHouse, compExclude, images, datePrecision, seasonDates, hammer };
}

/* ── CULTURE→SCIENCE REROUTE (Aug 14) — Apple/computing lots filed under the
   pop-culture slugs (RR's regex gaps: "Apple IIe"/"Apple III"/"Apple
   Computer"/"Altair 8800b"; Goldin's culture pass bypassing science routing).
   Tight signals only — computing hardware & founders, never a bare surname
   ("Tandy" matches Jessica Tandy; require computer context). Hardware/
   apparatus → scientific-instruments; documents/figures → science-tech. */
const CULT_SLUGS_TECH = new Set(['movie-tv', 'music-memorabilia', 'entertainment-memorabilia', 'pop-memorabilia']);
// (wave 2) a bare "Commodore" is the naval rank (Commodore Stephen Decatur's
// letter book went to scientific-instruments); the computer names its model
const TECH_HW = /\b(apple[- ]?(1|one|iii?\w{0,2})\b|apple (computer|lisa)|macintosh|iphone|ipod|ipad|imac|powerbook|next ?(computer|cube)|commodore (?:64|pet|amiga|vic|128|computer)|amiga|altair \d{3,4}\w?|ibm (pc|5150)|trs-80|osborne 1|circuit board|motherboard|logic board|microprocessor|enigma machine|difference engine|oscilloscope|prototype (board|computer|phone|device))\b/i;
const TECH_DOC = /\b(steve jobs|steve wozniak|\bwoz\b|bill gates|alan turing|ada lovelace|charles babbage|xerox parc)\b/i;
export function rerouteCultureTech(lots: Lot[]): number {
  let moved = 0;
  for (const l of lots) {
    if (!CULT_SLUGS_TECH.has(l.artist)) continue;
    const t = `${l.title ?? ''}`;
    if (TECH_HW.test(t)) { l.artist = 'scientific-instruments'; moved++; }
    else if (TECH_DOC.test(t)) { l.artist = 'science-tech'; moved++; }
  }
  return moved;
}

/* ── EXPANSION-ROW HEAL (Aug 13 audit) — the isolated-segment crawlers never
   pass through ray-crawl's per-lot v2 identity stamp, so their rows reached
   the corpus with no titleTokens (the value engine literally cannot see them:
   97% of the live book), Memory Lane titles carrying windows-era bid
   boilerplate ("… Bids: 19 Opening Bid: $50,000 Status: …"), REA imageUrls
   without a scheme (98.7% of 181k), and a few empty-string saleDates.
   Idempotent: every check is a no-op once healed. */
function healExpansionRows(lots: Lot[]): { tokens: number; titles: number; images: number; dates: number; grades: number; dims: number } {
  let tokens = 0, titles = 0, images = 0, dates = 0, grades = 0, dims = 0;
  for (const l of lots) {
    const t = l.title as string | undefined;
    if (t) {
      const cut = t.search(/\s+(?:Bids:\s*\d|Opening Bid:|Status:\s)/);
      if (cut > 4) { l.title = t.slice(0, cut).trim(); titles++; }
    }
    const img = l.imageUrl as string | undefined;
    if (img && !/^https?:\/\//.test(img) && !img.startsWith('data:')) {
      l.imageUrl = 'https://' + img.replace(/^\/+/, '');
      images++;
    }
    if (l.saleDate === '') { (l as unknown as { saleDate: string | null }).saleDate = null; dates++; }
    // winter-label re-date: seasonToDate stamped hobby Winter auctions Dec 15
    // of the label year; they close ~February. Only the SYNTHETIC mid-month
    // stamp is touched (REA/H&S id or saleName carries the winter label).
    if (typeof l.saleDate === 'string' && /-(12)-15$/.test(l.saleDate as string)) {
      const idStr = String(l.id || '');
      const saleName = String((l as { saleName?: string | null }).saleName || '');
      if (/-winter-/i.test(idStr) || /\bwinter\b/i.test(saleName)) {
        (l as unknown as { saleDate: string }).saleDate = (l.saleDate as string).replace(/-12-15$/, '-02-15');
        dates++;
      }
    }
    const tt = l.titleTokens as unknown[] | undefined;
    if ((!Array.isArray(tt) || !tt.length) && typeof l.title === 'string' && l.title) {
      l.titleTokens = titleTokensOf(l.title as string);
      tokens++;
    }
    // DIMS extraction (Aug 14) — the size gate fires on 0.28% of pairs vs
    // 29.8% possible; where the dimensions FIELD is empty but the description
    // (or title) prints a measured size, lift it. Conservative: needs an
    // explicit unit; inches → cm.
    if (!l.dimensions && (l.description || l.title)) {
      const src = `${l.title ?? ''} ${l.description ?? ''}`;
      const dm = src.match(/(\d+(?:[.,]\d+)?)\s*(?:x|×)\s*(\d+(?:[.,]\d+)?)(?:\s*(?:x|×)\s*(\d+(?:[.,]\d+)?))?\s*(in(?:ches)?\b|\"|cm\b)/i);
      if (dm) {
        const unit = /cm/i.test(dm[4]) ? 1 : 2.54;
        const num = (x?: string) => x ? Math.round(parseFloat(x.replace(',', '.')) * unit * 10) / 10 : null;
        const w = num(dm[1]), h = num(dm[2]), dpt = num(dm[3] || undefined);
        if (w && h && w < 1000 && h < 1000) {
          (l as Lot & { dimensions?: string | null }).dimensions = dm[0];
          (l as Lot & { widthCm?: number | null }).widthCm = w;
          (l as Lot & { heightCm?: number | null }).heightCm = h;
          if (dpt && dpt < 1000) (l as Lot & { depthCm?: number | null }).depthCm = dpt;
          dims++;
        }
      }
    }
    // Pokémon grade parse — grades sit in 40k titles ("PSA GEM MT 10",
    // "BGS NM-MT+ 8.5", "CGC 9.5") but only 3 rows carried gradeLabel
    if (l.artist === 'pokemon' && !l.gradeLabel && typeof l.title === 'string') {
      const g = (l.title as string).match(/\b(PSA|BGS|CGC|SGC)\s*(?:GEM\s*MT|GEM\s*MINT|MINT|NM-?MT\+?|NM|EX-?MT|EX|VG)?\s*(10|[1-9](?:\.5)?)\b/i);
      if (g) {
        (l as unknown as { gradeLabel: string | null }).gradeLabel = g[0].replace(/\s+/g, ' ').trim().toUpperCase();
        if (!l.authCert) (l as unknown as { authCert: string | null }).authCert = g[1].toUpperCase();
        grades++;
      }
    }
  }
  return { tokens, titles, images, dates, grades, dims };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENGINE SPEC v2 HEALING PASSES (★2c, ★3b, ★3c, ★5) — every regex/threshold
   below is the measured winner from the 7-vertical engine investigation
   (98.8→99.4% adjudicated precision on the category rules; 93.9% sold
   identity coverage on the player extractor; see ENGINE_SPEC_V2).
   ═══════════════════════════════════════════════════════════════════════════ */

// ── ★2c · normalizeArtCategory — print↔original re-derivation, art makers only.
const PRINT_PROCESS = /\b(lithograph(?:s|e|ie)?|silkscreen|screen\s?print(?:s|ing)?|s[ée]rigraph(?:s|y|ie)?|etching(?:s)?|aquatint|engraving(?:s)?|woodcut(?:s)?|wood engraving|linocut(?:s)?|drypoint|mezzotint|pochoirs?|photogravure|h[ée]liogravure|gicl[ée]e|offset (?:lithograph|print)|monotype|monoprint|intaglio|chine coll[ée]|linoleum cut)\b/i;
const PLATE_FROM = /\b(?:pl\.?|plates?)\s*(?:[IVXLCDM]+\b|\d{1,3}\b)?[,]?\s*from\b|\b(?:one|two|three|four|five|six|seven|eight|\d{1,2})\s+plates?\b|\bplate\s+(?:[IVXLCDM]+|\d{1,3})\b/i;
const FROM_SERIES = /,\s*from\s+(?!the\s+(?:collection|estate|property)|a\s+private|an?\s+important)(?:the\s+)?[A-Z'"«“]/;
const EDITION_STRONG = /\bedition of \d+\b|\bfrom (?:an|the) edition\b|\bnumbered\b[^.;]{0,16}\d{1,3}\s*\/\s*\d{1,4}|\bartist'?s proof\b|\bprinter'?s proof\b|\btrial proof\b|\bbon [aà] tirer\b|\bhors commerce\b/i;
// (wave 3) Warhol's medium line runs long ("Synthetic polymer paint,
// screenprint ink, and diamond dust on canvas") and silkscreen INK on canvas
// is his painting medium — neither may be flipped back to a print
const ORIGINAL_STRONG = /\b(?:oil|acrylic|tempera|alkyd|enamel|synthetic polymer)\b[^.;]{0,60}\bon\s+(?:canvas|linen|panel|board|masonite|cardboard|paper)\b|\b(?:silkscreen|screen ?print) inks?\b[^.;]{0,60}\bon (?:canvas|linen)\b|\bmixed media on (?:canvas|panel|board)\b|\bhand[- ]painted\b|\bunique\b/i;
const OIL_CANVAS = /\b(?:oil|acrylic|tempera|synthetic polymer)\b[^.;]{0,30}\bon\s+(?:canvas|panel|board|linen|masonite)\b/i;
const EDITION_ANY = /\bedition of \d+|\bnumbered edition\b|\blimited edition\b/i;

/** bare "37/150" edition fraction — mixed-number sizes ("31 1/2") excluded */
function bareEditionFraction(s: string): boolean {
  const re = /(^|[^\d\s]|\s)(\d{1,3})\s*\/\s*(\d{1,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 4), m.index + m[1].length);
    if (/\d\s?$/.test(before)) continue;
    const num = parseInt(m[2], 10), den = parseInt(m[3], 10);
    if (den >= 8 && num <= den && den <= 3000) return true;
  }
  return false;
}

/* ── EDITION / SERIAL RE-DERIVATION (Oct 2026) — editionOf/editionTotal/
   editionMarker and serialNo are stamped ONCE by the crawl-time normalize
   (ray-crawl.ts, schemaVersion 2) and never re-read, so a parser fix would
   only reach freshly crawled lots. Re-derive them here from the stored title
   + description with the current extractEdition/extractSerials: the old
   readers took dimension fractions as editions ("10 7/8 in" → 7/8: 8,059
   rows) and any word after "case"/"movement" as a serial ("with": 6,646).
   On the Oct 5 corpus the old readers re-run on the stored text reproduce
   every stored value, so the only movement is the parser fix itself.
   Writes only on change (unaffected rows stay byte-identical); caseNo/
   movementNo are set only when present. Idempotent. */
export function rederiveEditionsSerials(lots: Lot[]): { editions: number; serials: number } {
  let editions = 0, serials = 0;
  for (const l of lots) {
    if ((l as { schemaVersion?: number }).schemaVersion !== 2) continue;
    const desc = (l as { description?: string | null }).description || undefined;
    const ed = extractEdition(l.title, desc);
    if ((l.editionOf ?? null) !== ed.editionOf || (l.editionTotal ?? null) !== ed.editionTotal || (l.editionMarker ?? null) !== ed.editionMarker) {
      l.editionOf = ed.editionOf; l.editionTotal = ed.editionTotal; l.editionMarker = ed.editionMarker;
      editions++;
    }
    const s = extractSerials(l.title, desc);
    let moved = false;
    if ((l.serialNo ?? null) !== s.serialNo) { l.serialNo = s.serialNo; moved = true; }
    if ((l.caseNo ?? null) !== s.caseNo) { if (s.caseNo) l.caseNo = s.caseNo; else delete l.caseNo; moved = true; }
    if ((l.movementNo ?? null) !== s.movementNo) { if (s.movementNo) l.movementNo = s.movementNo; else delete l.movementNo; moved = true; }
    if (moved) serials++;
  }
  return { editions, serials };
}

const ART_CAT_MAKERS = new Set(Object.entries(ARTIST_MARKET).filter(([, m]) => m === 'art').map(([k]) => k));

export function normalizeArtCategory(lots: Lot[]): { o2p: number; p2o: number } {
  let o2p = 0, p2o = 0;
  for (const l of lots) {
    if (!ART_CAT_MAKERS.has(l.artist)) continue; // scope guard: art makers ONLY
    const s = `${l.title || ''}  ${l.medium || ''}`;
    if (l.category === 'original') {
      if (ORIGINAL_STRONG.test(s)) continue; // never touch explicit unique mediums
      if (PRINT_PROCESS.test(s) || PLATE_FROM.test(s) || FROM_SERIES.test(l.title || '')
        || EDITION_STRONG.test(s) || bareEditionFraction(s)) {
        l.category = 'print';
        (l as Lot & { catReclass?: string }).catReclass = 'o2p';
        o2p++;
      }
    } else if (l.category === 'print') {
      if (PRINT_PROCESS.test(s) || PLATE_FROM.test(s) || EDITION_ANY.test(s)) continue;
      if (OIL_CANVAS.test(s)) {
        l.category = 'original';
        (l as Lot & { catReclass?: string }).catReclass = 'p2o';
        p2o++;
      }
    }
  }
  return { o2p, p2o };
}

// ── ★3b · recoverPlayerSlugs — game-used identity from the title.
const GU_TEAM_WORDS = new Set(('atlanta boston brooklyn charlotte chicago cleveland dallas denver detroit golden state houston indiana los angeles memphis miami milwaukee minnesota new orleans york oklahoma city orlando philadelphia phoenix portland sacramento san antonio toronto utah washington ' +
  'hawks celtics nets hornets bulls cavaliers mavericks nuggets pistons warriors rockets pacers clippers lakers grizzlies heat bucks timberwolves pelicans knicks thunder magic 76ers suns blazers trail kings spurs raptors jazz wizards ' +
  'buffalo cincinnati baltimore pittsburgh tennessee jacksonville kansas las vegas chargers broncos raiders chiefs colts texans titans jaguars browns bengals steelers ravens patriots jets bills dolphins cowboys giants eagles commanders redskins bears lions packers vikings falcons panthers saints buccaneers cardinals rams seahawks 49ers niners ' +
  'yankees mets red sox white cubs dodgers padres athletics mariners angels astros rangers royals twins tigers guardians indians orioles rays blue jays braves marlins nationals expos phillies pirates reds brewers diamondbacks rockies ' +
  'bruins canadiens maple leafs senators sabres wings blackhawks blues wild avalanche stars predators flames oilers canucks kraken sharks ducks knights coyotes lightning hurricanes capitals flyers penguins devils islanders ' +
  'seattle supersonics sonics new jersey st louis tampa bay green anaheim colorado columbus carolina nashville edmonton calgary vancouver winnipeg montreal ottawa quebec florida arizona texas california oakland usa team ' +
  'real madrid barcelona manchester united city liverpool chelsea arsenal tottenham juventus milan inter bayern munich paris saint-germain psg ajax').split(/\s+/));
const GU_STOP_WORDS = new Set('game match team worn used issued signed autographed auto inscribed rookie debut career final finals championship world series super bowl season professional model style era circa nba nfl mlb nhl wnba mls kia emirates cup playoffs playoff conference photo practice warm warmup training jersey shorts pants sneakers shoes cleats cleat boot jacket helmet cap hat glove mitt bat ball puck ring belt trophy award medal home road away alternate icon association statement classic edition hof mvp the a an and with vs at of for from includes long short sleeve sleeved left right hr rbi mini decal store salesman single full advertising presentation presentational all star'.split(/\s+/));
const GU_MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?$|^(january|february|march|april|june|july|august|september|october|november|december)$/i;

/** Extract the athlete from a game-used title (measured 93.9% sold coverage,
    97.8% prefix-agreement with existing stamps). Never run on card-brand
    titles — parseCard owns those. */
export function recoverPlayerSlug(title: string): string | null {
  let s = cleanGoldinTitle(title || '');
  s = s.replace(/\|[^]*$/, ' ');
  s = s.replace(/[‘“][^‘’“”]*[’”]/g, ' ');
  s = s.replace(/(^|\s)['"][^'"]*['"](?=\s|$|[,.])/g, ' ');
  // expansion-house noise (Lelands / Memory Lane / Love of the Game): the
  // catalogue tag that leads a title and the auction-listing tail that trails
  // it, neither of which appears in a Goldin/Sotheby's title.
  s = s.replace(/^\s*(?:highlight|featured)\s+/i, ' ');
  s = s.replace(/\s+(?:bids:\s*\d|opening bid:|status:\s*sold).*$/i, ' ');
  s = s.trim();
  const segs = s.split(/\s+[-–—]\s+/);
  let si = 0;
  while (si < segs.length - 1) {
    const seg = segs[si];
    const nTok = seg.split(/\s+/).length;
    if (nTok <= 5 && (/\d/.test(seg) || /\b(finals?|game|round|series|conference)\b/i.test(seg))) si++;
    else break;
  }
  s = segs.slice(si).join(' ');
  const toks = s.split(/\s+/).filter(Boolean);
  let i = 0;
  // Leading skip: months, year/date tokens, the "circa"/"c." date qualifier
  // (and "c.1995"), and a leading tobacco/card SET-CODE (T206, N172, E90…).
  // A name token is pure alpha, so skipping any leading token that carries a
  // digit — or is the circa qualifier — never eats a player name.
  while (i < toks.length && (
    GU_MONTHS.test(toks[i]) ||
    /^['’]?\d/.test(toks[i]) ||
    /^(?:circa|c\.?)$/i.test(toks[i]) ||
    /^c\.?\d/i.test(toks[i]) ||
    /^[A-Za-z]{1,3}\d{2,4}[a-z]?$/.test(toks[i])
  )) i++;
  const kept: string[] = [];
  for (; i < toks.length; i++) {
    const lw = toks[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9'’.\-]/g, '').replace(/[.,]+$/, '')
      .replace(/['’]s$/, '');
    if (!lw || /\d/.test(lw)) break;
    const head = lw.split('-')[0].replace(/[.'’]/g, '');
    const whole = lw.replace(/[.'’]/g, '');
    const isStop = GU_STOP_WORDS.has(head) || GU_STOP_WORDS.has(whole);
    const isTeam = GU_TEAM_WORDS.has(whole) || GU_TEAM_WORDS.has(head);
    if (isTeam) {
      const nx = (toks[i + 1] || '').toLowerCase().replace(/[^a-z]/g, '');
      const nxPlain = !!nx && !GU_TEAM_WORDS.has(nx) && !GU_STOP_WORDS.has(nx) && !/\d/.test(toks[i + 1] || '');
      if (!(kept.length === 0 && nxPlain)) break;
    } else if (isStop) break;
    kept.push(lw);
    if (kept.length === 3) break;
  }
  if (kept.length < 2) return null;
  return playerSlugOf(kept.join(' '));
}

const CARD_BRAND_LEAD = /^\s*(upper deck|panini|topps|bowman|donruss|fleer|leaf)\b/i;

// Houses added in the Aug 2026 sports/pop expansion. The player extractor was
// built + measured (93.9%) on Goldin / Sotheby's / Christie's title formats and
// was NEVER tuned for these houses' conventions, so their ~15k game-used titles
// are STAMPED best-effort but EXCLUDED from the drift CANARY (§3.4) — otherwise
// they dilute the signal and block publish for a parser that hasn't actually
// drifted. Raising these houses' own identity coverage is a separate, tracked
// improvement (extend recoverPlayerSlug to their formats), not a publish gate.
const CANARY_EXCLUDE_HOUSES = new Set(['REA', 'Huggins & Scott', 'SCP', "Hake's", 'Lelands', 'Memory Lane', 'Love of the Game', 'NFL Auction', 'MLB Auctions']);

export function recoverPlayerSlugs(lots: Lot[]): { stamped: number; total: number; coverage: number } {
  let stamped = 0, total = 0, covered = 0;
  for (const l of lots) {
    if (l.artist !== 'game-used' || l.category !== 'object') continue;
    // stamp every game-used object best-effort (all houses)
    let cover: boolean;
    if (CARD_BRAND_LEAD.test(l.title || '')) {
      cover = !!(l as Lot & { playerSlug?: string | null }).playerSlug;
    } else {
      const slug = recoverPlayerSlug(l.title || '');
      const cur = (l as Lot & { playerSlug?: string | null }).playerSlug ?? null;
      // overwrite policy: existing stamps are the measured garbage class
      if (slug && slug !== cur) { (l as Lot & { playerSlug?: string | null }).playerSlug = slug; stamped++; }
      cover = !!(slug || cur);
    }
    // DRIFT CANARY denominator: only the sources the parser was measured on —
    // the expansion houses are stamped above but never counted here.
    if (CANARY_EXCLUDE_HOUSES.has((l as { auctionHouse?: string }).auctionHouse || '')) continue;
    total++;
    if (cover) covered++;
  }
  return { stamped, total, coverage: total ? covered / total : 1 };
}

// ── ★3c · recoverAutographSigners — signer identity from the title/medium.
// 94% of the 300k autograph lots carry the signer only in a descriptive title
// ("EINSTEIN, Albert (1879-1955). Typed letter signed") or medium ("HARRY
// HOUDINI, 1913"), never in a field — so lectr's own comps/similarity/indexes
// (which read `entity`) can't use them, and neither could the value book. Parse
// it here and stamp `entity`, exactly as recoverPlayerSlug stamps playerSlug.
// HIGH-PRECISION only (parseSignerName abstains on themes/groups); we never
// overwrite an existing entity, and we require a canonical autograph format so
// relics ("a fence rail cane") are skipped.
/** (wave 2) class 14 · the crawl-time sports/science `entity` tag
 *  (comps.extractSportsTags) took any leading capitalized run — 'FLOWN ON
 *  APOLLO', 'Official Game Used', 'NASA Mission Control' (10.2k rows). It is
 *  now gated on a person-name parse; this clears the stored ones (a crawler
 *  entity = no entitySrc, equal to its title's leading run) so the signer
 *  pass below and every entity reader see no identity rather than a phrase. */
export function healCrawlEntities(lots: Lot[]): number {
  let cleared = 0;
  for (const l of lots) {
    const w = l as Lot & { entity?: string | null; entitySrc?: string | null };
    if (!w.entity || w.entitySrc) continue;
    const lead = String(l.title || '').match(/^((?:[A-Z][A-Za-z.'’-]+\s+){1,2}[A-Z][A-Za-z.'’-]+)/);
    if (!lead || lead[1].trim() !== w.entity) continue;
    if (isPersonNameRun(w.entity)) continue;
    const person = personNameOf(w.entity);
    if (person) w.entity = person; else delete w.entity;
    cleared++;
  }
  return cleared;
}

export function recoverAutographSigners(lots: Lot[]): { stamped: number; candidates: number } {
  const src = `sig-p${SIGNER_PARSER_VERSION}`;
  let stamped = 0, candidates = 0;
  for (const l of lots) {
    const w = l as Lot & { entity?: string | null; entitySrc?: string | null; playerSlug?: string | null; medium?: string | null };
    if (!AUTOGRAPH_SLUGS.has(l.artist)) continue;
    if (w.playerSlug) continue; // structured identity — never touch
    // Versioned stamps: crawler-supplied entities (no sig-p source) are never
    // touched, but a PARSER-derived stamp from an older grammar is re-derived —
    // a v1 mis-stamp must not be frozen into the corpus forever. If the current
    // parser abstains where the old one stamped, the stamp is cleared (the
    // honest read beats a stale guess).
    if (w.entity) {
      const parsed = typeof w.entitySrc === 'string' && w.entitySrc.startsWith('sig-p');
      if (!parsed || w.entitySrc === src) continue;
      const name = parseSignerName({ title: l.title, medium: w.medium });
      if (name) { w.entity = name; w.entitySrc = src; stamped++; }
      else { delete (w as { entity?: unknown }).entity; w.entitySrc = null; }
      continue;
    }
    if (!autographFormatOf(l.title)) continue; // must be an actual signed item
    candidates++;
    const name = parseSignerName({ title: l.title, medium: w.medium });
    if (name) { w.entity = name; w.entitySrc = src; stamped++; }
  }
  return { stamped, candidates };
}

/* ── GAME-USED COMP KEYS — the three axes a game-used lot must match a comp on
   (doctrine, Aug 2026): (1) team, (2) the specific game when a title names one,
   and (3) the USE CLASS — game-USED/worn is a different market than game-ISSUED
   (never worn), so the two are never comped against each other. All three are
   title-derived and consistent (the same string maps to the same key on the lot
   and on every candidate), so they act as clean equality filters on the pool. */

// team MASCOTS — the mascot is the near-unique team key; the same-player prefilter
// already disambiguates the few city-shared ones (Cardinals, Giants, Rangers,
// Kings). "magic" is deliberately omitted (collides with Magic Johnson).
const GU_MASCOTS = new Set(('hawks celtics nets hornets bulls cavaliers mavericks nuggets pistons warriors rockets pacers clippers lakers grizzlies heat bucks timberwolves pelicans knicks thunder suns spurs raptors jazz wizards supersonics sonics ' +
  'bengals steelers ravens patriots jets bills dolphins cowboys eagles commanders redskins bears lions packers vikings falcons panthers saints buccaneers seahawks 49ers niners chargers broncos raiders chiefs colts texans titans jaguars browns ' +
  'yankees mets cubs dodgers padres athletics mariners angels astros royals twins tigers guardians indians orioles rays braves marlins nationals expos phillies pirates reds brewers diamondbacks rockies ' +
  'bruins canadiens senators sabres blackhawks blues avalanche stars predators flames oilers canucks kraken sharks ducks lightning hurricanes capitals flyers penguins devils islanders ' +
  'cardinals rangers giants kings').split(/\s+/));

/** the team a game-used title names (mascot key), or null. Takes the LAST mascot
    in the title — team follows the player, so this avoids a player name that
    happens to be a mascot word. */
export function guTeamOf(title: string): string | null {
  const t = ' ' + (title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  if (/\bred sox\b/.test(t)) return 'red-sox';
  if (/\bwhite sox\b/.test(t)) return 'white-sox';
  if (/\bmaple leafs\b/.test(t)) return 'maple-leafs';
  if (/\bblue jays\b/.test(t)) return 'blue-jays';
  if (/\bgolden knights\b|\bvegas\b/.test(t)) return 'golden-knights';
  if (/\btrail blazers\b|\bblazers\b/.test(t)) return 'blazers';
  const toks = t.trim().split(' ');
  for (let i = toks.length - 1; i >= 0; i--) if (GU_MASCOTS.has(toks[i])) return toks[i];
  return null;
}

/** game-USED/worn vs game-ISSUED. Only an explicit "issued" with no worn/used
    marker reads as 'issued'; everything else (incl. unmarked) is 'used'. */
export function guUseClass(title: string): 'issued' | 'used' {
  const t = (title || '').toLowerCase();
  const worn = /\b(game[- ]?used|game[- ]?worn|match[- ]?worn|player[- ]?worn|worn|used)\b/.test(t);
  const issued = /\b(game[- ]?issued|team[- ]?issued|issued)\b/.test(t);
  return (issued && !worn) ? 'issued' : 'used';
}

/** the specific game a title names (year + game descriptor), or null when it is
    only attributed to a season. Used to tighten comps to same-game items. */
export function guGameKey(title: string, sportYear?: number | null): string | null {
  const t = title || '';
  const md = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (md) return `${md[3]}-${md[1].slice(0, 3).toLowerCase()}-${md[2].padStart(2, '0')}`;
  const mdy = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  const yr = (t.match(/\b(?:19|20)\d{2}\b/) || [])[0] || (sportYear ? String(sportYear) : '');
  if (!yr) return null;
  const g = t.match(/\b(world series|nba finals|stanley cup(?: final)?|world cup|super bowl|alcs|nlcs|alds|nlds|finals)\b[^.]{0,24}?\bgame\s+(\d+|[ivx]+)\b/i);
  if (g) return `${yr}:${g[1].toLowerCase().replace(/\s+/g, '-')}-g${g[2].toLowerCase()}`;
  if (/\bopening day\b/i.test(t)) return `${yr}:opening-day`;
  if (/\bworld series\b/i.test(t)) return `${yr}:world-series`;
  if (/\bnba finals\b/i.test(t)) return `${yr}:nba-finals`;
  if (/\bsuper bowl\b/i.test(t)) return `${yr}:super-bowl`;
  return null;
}

// ── ★3c · stampCultureAxes — subjectKeys[] + itemClass for culture slugs.
const CULTURE_SLUGS_NORM = new Set(['movie-tv', 'music-memorabilia', 'entertainment-memorabilia', 'pokemon', 'pop-memorabilia']);
const CULT_ITEM_RULES: [RegExp, string][] = [
  [/\b(gem mint|psa \d|bgs \d|sgc \d|cgc \d|tag \d|graded|rookie card|trading card|hobby box|#\d+)/i, 'card'],
  [/\bsigned (cut|index card)\b/i, 'signed-cut'],
  [/\b(check|cheque)\b/i, 'check'],
  [/\bsigned.{0,30}\b(photo|photograph)\b|\b(photo|photograph)\b.{0,30}\bsigned\b/i, 'signed-photo'],
  [/\b(photograph|photo)\b/i, 'photo'],
  [/\b(letter|correspondence|telegram|manuscript|typescript|document|deed|land grant|commission|proclamation|broadside|autograph note|handwritten lyrics|lyrics|diary|notebook|als|tls)\b/i, 'document'],
  [/\b(script|screenplay|shooting script|storyboard)\b/i, 'script'],
  [/\b(poster|lobby card|one[- ]sheet|handbill)\b/i, 'poster'],
  [/\b(guitar|bass|telecaster|stratocaster|les paul|drum|drumhead|piano|saxophone|violin|microphone|amplifier)\b/i, 'instrument'],
  [/\b(gold record|platinum record|riaa|grammy|oscar|academy award|emmy|disc award|sales award|award|medal|trophy)\b/i, 'award'],
  [/\b(prop|props)\b/i, 'prop'],
  [/\b(worn|costume|jacket|coat|dress|gown|shirt|boots?|robe|tunic|uniform|suit|cape|helmet|mask|shoes?|sneakers?|hat|jumpsuit|vest|jersey)\b/i, 'costume'],
  [/\b(ticket|stub|pass|credential|program|programme)\b/i, 'ticket'],
  [/\b(animation cel|cel\b|celluloid|drawing|sketch)\b/i, 'cel-art'],
  [/\b(record|vinyl|album|lp|45rpm|acetate|test pressing)\b/i, 'record'],
  [/\b(signed|autographed|autograph|signature|inscribed)\b/i, 'autograph-other'],
];
const CULT_STOP = new Set(['signed', 'autographed', 'original', 'type', 'photo', 'photograph', 'prop', 'stage', 'stage-played', 'stage-worn', 'screen', 'screen-worn', 'worn', 'owned', 'played', 'personal', 'personally', 'from', 'and', 'with', 'the', 'a', 'an', 'his', 'her', 'framed', 'vintage', 'rare', 'important', 'exceptional', 'collection', 'of', 'in', 'on', 'by', 'for', 'at', 'to', 'cut', 'index', 'card', 'check', 'display', 'custom', 'acoustic', 'electric', 'handwritten', 'authentic', 'dual', 'triple']);
// house-header pseudo-subjects — sale categories, never identities
const CULT_SUBJECT_STOPLIST = new Set(['film stars and entertainers', 'walt disney studios', 'various artists', 'entertainment', 'rock and pop', 'hollywood']);
const cultNorm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function cultItemClassOf(title: string): string {
  const t = (title || '').replace(/["“”]/g, ' ');
  for (const [re, c] of CULT_ITEM_RULES) if (re.test(t)) return c;
  return 'other';
}

/* ── CULTURE KIND (wave 2, Oct 6 2026 re-audit: ~49k culture lots 'other' or
   wrong) — cultItemClassOf read the TITLE only, first rule wins. Christie's /
   Sotheby's culture titles are often a bare name ("Marilyn Monroe", "Eric
   Clapton", "CASABLANCA") with the object in the description; plural nouns
   ("PHOTOGRAPHS BY DEZO HOFFMANN") missed; a signed programme read as a ticket
   and a signed retail hat as a costume. Now: the object named EARLIEST wins
   (ties by rule order), a SIGNED piece is an autograph unless it was worn /
   used / played, and a title that names no object falls back to the head of
   the description, then the sale (an RR "Photography Auction", RR's
   "<Name> Book / Program" signed-piece shorthand). */
const CULT_CARD_RE = CULT_ITEM_RULES[0][0];
const CULT_KIND_RULES: [RegExp, string][] = [
  // a CUT signature is a document (rubric); a bare "<Name> Signature" lot is an
  // autograph — the original labels (Audubon, Stalin, Veronica Lake, Woodrow
  // Wilson) outvote the re-audit's historic ones (Crook, Rutledge) on DEV
  [/\bsigned (?:cut|index card)s?\b|\bcut signatures?\b/i, 'signed-cut'],
  [/\b(?:checks?|cheques?)\b/i, 'check'],
  [/\b(?:signed|autographed|inscribed)\b.{0,30}\b(?:photo|photos|photograph|photographs|stills?|portraits?|cdvs?|snapshots?)\b|\b(?:photo|photos|photograph|photographs|stills?|portraits?)\b.{0,30}\b(?:signed|inscribed)\b/i, 'signed-photo'],
  // a signed FLAT / retail piece is an autograph (a signed programme, book,
  // menu, card, standee, retail hat or ball); a signed guitar, album, shoe or
  // document is still that object (the noun rules below)
  [/\b(?:signed|autographed)\b.{0,30}\b(?:programs?|programmes?|books?|menus?|cards?|pages?|standees?|drawings?|sketch(?:es)?|artwork|drum ?sticks?|hats?|caps?|baseballs?|footballs?|basketballs?|balls?|posters?|banners?|plaques?|bats?|helmets?|jerseys?|mini[- ]helmets?)\b|\b(?:programs?|programmes?|books?|menus?|cards?|pages?)\b.{0,25}\bsigned\b/i, 'autograph-other'],
  [/\b(?:photo|photos|photograph|photographs|snapshots?|negatives?|carte[- ]de[- ]visites?|cdvs?|tintypes?|daguerreotypes?|polaroids?|(?:film|press|publicity|production|black and white|colou?r) stills?|a still of|contact sheets?|transparenc(?:y|ies)|image of)\b/i, 'photo'],
  [/\b(?:letters?|correspondence|telegrams?|manuscripts?|typescripts?|documents?|deeds?|land grants?|commissions?|proclamations?|broadsides?|autograph notes?|handwritten|lyrics?|diar(?:y|ies)|notebooks?|als|tls|endorsements?|(?:confederate|war|treasury|savings|railroad) bonds?|bond certificates?|certificates?|stock|treaty|bulletins?|memo(?:randum|randa|s)?|ledgers?|registers?|guest ?books?|journals?|financial statements?|contracts?|telephone messages?|itinerar(?:y|ies)|writes (?:to|his|her|a|an|of|about|from))\b/i, 'document'],
  [/\b(?:script|scripts|screenplay|shooting script|storyboards?|teleplay)\b/i, 'script'],
  [/\b(?:posters?|lobby cards?|one[- ]sheets?|handbills?|locandina|affiche|window cards?|half[- ]sheets?|three[- ]sheets?)\b/i, 'poster'],
  [/\b(?:guitars?|bass|telecaster|stratocaster|les paul|drums?|drumhead|piano|saxophone|violin|microphone|amplifier|keyboard|ukulele|banjo|trumpet|cymbals?)\b/i, 'instrument'],
  [/\b(?:gold record|platinum record|gold disc|platinum disc|riaa|grammy|oscar|academy award|emmy|golden globe|disc award|sales award|presentation award|awards?|medals?|trophy|trophies|key to the city)\b/i, 'award'],
  [/\b(?:prop|props|hero prop|production[- ]made|screen[- ]used|maquette)\b/i, 'prop'],
  [/\b(?:worn|costume|costumes|(?<!dust )jacket|coat|dress|gown|shirt|boots?|robe|tunic|uniform|suit|cape|cowl|helmet|mask|shoes?|sneakers?|hat|jumpsuit|vest|jersey|ensemble|coveralls|overalls|wardrobe)\b/i, 'costume'],
  [/\b(?:tickets?|stubs?|pass|credentials?|programs?|programmes?)\b/i, 'ticket'],
  [/\b(?:animation cel|cels?|celluloid|drawings?|sketch(?:es)?|costume design)\b/i, 'cel-art'],
  [/\b(?:record|records|vinyl|albums?(?!\s+pages?)|lp|45rpm|acetate|test pressing)\b/i, 'record'],
];
/** no object noun named: a bare signature mark is still an autograph */
const CULT_AUTOGRAPH_FALLBACK_RE = /\b(?:signed|autographed|autographs?|signatures?|inscribed)\b/i;
/** the rule whose noun is named earliest in `s` (ties → rule order), or null */
function earliestCultKind(s: string): string | null {
  let best: string | null = null, at = Infinity;
  for (const [re, c] of CULT_KIND_RULES) {
    const m = re.exec(s);
    if (m && m.index < at) { at = m.index; best = c; }
  }
  return best;
}
/** the description's own object line: the title echo and the trailing
 *  authenticity / provenance boilerplate ("accompanied by a letter of
 *  authenticity", "with a photograph of …") removed */
function descHead(title: string, desc: string): string {
  let d = String(desc || '').replace(/<[^>]+>|class="[^"]*"/g, ' ');
  const t = String(title || '').trim();
  if (t && d.toLowerCase().startsWith(t.toLowerCase())) d = d.slice(t.length);
  d = d.split(/\b(?:accompanied by|together with|with (?:a|an|the) (?:letter|certificate|coa|loa)|letter of authenticity|certificate of authenticity|provenance|literature|exhibited|lot closed|estimate)\b/i)[0];
  return d.slice(0, 260);
}
export function cultureItemClass(l: { title?: string | null; description?: string | null; saleName?: string | null; auctionHouse?: string | null }): string {
  // (wave 3) a portrait DRAWING / painting is not a photograph ("Kurt Cobain
  // Signed Original DJ Portrait Drawing")
  let title = String(l.title || '').replace(/["“”]/g, ' ');
  if (/\b(?:drawings?|sketch(?:es)?|paintings?|illustrations?|caricatures?)\b/i.test(title)) title = title.replace(/\bportraits?\b/gi, ' ');
  if (CULT_CARD_RE.test(title)) return 'card';
  // the word "prop" names the kind wherever it sits ("Stormtrooper Helmet Prop")
  if (/\bprops?\b/i.test(title)) return 'prop';
  const fromTitle = earliestCultKind(title) ?? (CULT_AUTOGRAPH_FALLBACK_RE.test(title) ? 'autograph-other' : null);
  if (fromTitle) return fromTitle;
  const head = descHead(title, String(l.description || ''));
  const fromDesc = earliestCultKind(head) ?? (CULT_AUTOGRAPH_FALLBACK_RE.test(head) ? 'autograph-other' : null);
  // "Approximately seventy signatures collected by …" is an autograph lot, not a cut
  if (fromDesc) return fromDesc === 'signed-cut' ? 'autograph-other' : fromDesc;
  const sale = String(l.saleName || '');
  if (/\bphotograph/i.test(sale)) return 'photo';
  // RR's signed-piece shorthand: "<Signer> Book", "<Signer> Program", "<Signer> Menu"
  if (l.auctionHouse === 'RR Auction' && /\b(?:books?|programs?|programmes?|menus?|cards?|bibles?|baseballs?|footballs?|basketballs?|bats?|balls?|scores?|pages?|first day covers?|covers?)\s*$/i.test(title.trim())) return 'autograph-other';
  // (wave 3) RR's narrative letter headline: "Edwin M. Stanton: Stanton
  // consoles a doctor …", "Judy Garland: Judy refuses to share her money …"
  if (/^[^:]{3,60}:\s+(?:[A-Z][\w.'’-]*\s+){1,3}(?:writes|wrote|consoles|refuses|thanks|asks|discusses|explains|recalls|reflects|praises|requests|orders|informs|tells|declines|accepts|invites|congratulates|heralds|defends|describes|urges|offers|sends|seeks|laments|confirms|responds|replies|reports|promises|agrees|complains|announces|instructs|advises|apologizes|insists|warns|vows|pledges|recommends|appoints|authorizes|grants|demands)\b/.test(title)) return 'document';
  return 'other';
}
function cultPersonOf(title: string): string | null {
  let t = (title || '').trim();
  t = t.replace(/^(c\.?\s*)?(1[6-9]\d\d|20\d\d)(-\d{2,4})?\s+/i, '');
  t = t.replace(/^(aug|jan|feb|mar|apr|may|jun|jul|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(-\d{1,2})?,?\s+\d{4}\s*-?\s*/i, '');
  const toks = t.split(/\s+/);
  const name: string[] = [];
  for (const w of toks) {
    const bare = w.replace(/[^A-Za-z.'’-]/g, '');
    if (!bare || !/^[A-Z]/.test(bare) || CULT_STOP.has(bare.toLowerCase()) || /\d/.test(w)) break;
    name.push(bare);
    if (name.length === 4) break;
    if (/[,:–-]$/.test(w)) break;
  }
  if (name.length >= 2 && name.length <= 4) return cultNorm(name.join(' '));
  const by = (title || '').match(/\bSIGNED BY ([A-Z][A-Z.'’-]+(?:\s+[A-Z][A-Z.'’-]+){1,3})/);
  if (by) return cultNorm(by[1]);
  const tr = (title || '').match(/([A-Z][A-Z.'’-]+(?:\s+[A-Z][A-Z.'’-]+){1,3}),\s*(?:C\.?\s*)?(?:\d{1,2}\s+)?(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)?\s*(1[6-9]\d\d|20\d\d)\]?$/);
  if (tr && !CULT_STOP.has(tr[1].split(/\s+/)[0].toLowerCase())) return cultNorm(tr[1]);
  return null;
}
function cultFranchiseOf(title: string): string | null {
  const t = title || '';
  const q = t.match(/["“]([^"”]{3,45})["”]/);
  if (q) return cultNorm(q[1]);
  const colon = t.match(/^([A-Z][A-Za-z0-9.&'’\- ]{2,40}?):\s/);
  if (colon) return cultNorm(colon[1]);
  const from = t.match(/\bFROM\s+([A-Z][A-Z0-9.&'’\- ]{2,40}?)(?:,?\s+(?:19|20)\d\d|\s*$)/);
  if (from) return cultNorm(from[1]);
  const pre = t.match(/^([A-Z][A-Z0-9.&'’!:\- ]{2,45}?),\s*(19|20)\d\d\s*[-:]/);
  if (pre) return cultNorm(pre[1]);
  return null;
}
function cultShortSubjectOf(title: string): string | null {
  const t = (title || '').trim();
  const words = t.split(/\s+/);
  if (words.length >= 1 && words.length <= 4 && cultItemClassOf(t) === 'other' && !/\d{3,}/.test(t)) return cultNorm(t) || null;
  return null;
}

export function stampCultureAxes(lots: Lot[]): number {
  let stamped = 0;
  for (const l of lots) {
    if (!CULTURE_SLUGS_NORM.has(l.artist)) continue;
    const person = cultShortSubjectOf(l.title || '') ?? cultPersonOf(l.title || '');
    const franchise = cultFranchiseOf(l.title || '');
    const subjects = Array.from(new Set([person, franchise].filter((x): x is string => !!x && !CULT_SUBJECT_STOPLIST.has(x))));
    const cls = cultureItemClass(l as Lot & { description?: string | null; saleName?: string | null });
    const t = l as Lot & { subjectKeys?: string[]; itemClass?: string };
    t.itemClass = cls;
    if (subjects.length) { t.subjectKeys = subjects; stamped++; }
  }
  return stamped;
}

// ── ★5 · restampIdentityKeys — formKey re-derivation, every lot, every build.
//    MUST run LAST (after every category flip, with the current classifyForm).
const SPORTS_SLUGS_NORM = new Set(['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia', 'graded-cards', 'memorabilia', 'autographs', 'unopened-wax', 'type-1-photos', 'programs-publications', 'equipment-artifacts']);
const SPORTS_FORMKEY_BLOCK = new Set(['jewelry', 'wristwatch', 'pocket-watch', 'clock', 'mineral', 'fossil', 'space', 'instrument', 'tech']);

export function restampIdentityKeys(lots: Lot[]): number {
  let restamped = 0;
  for (const l of lots) {
    const fresh = classifyForm({ title: l.title, medium: l.medium, category: l.category });
    const cur = (l as Lot & { formKey?: string }).formKey;
    if (cur !== fresh) {
      // sports-slug shield: never stamp cross-vertical classes on sports lots —
      // 'jewelry' from the set-of gate ("complete set of chicago bulls
      // championship rings"), 'wristwatch'/'mineral' etc. from watch-brand or
      // material words in memorabilia titles (measured garbage in served rows)
      if (SPORTS_SLUGS_NORM.has(l.artist) && SPORTS_FORMKEY_BLOCK.has(fresh)) {
        (l as Lot & { formKey?: string }).formKey = undefined;
        continue;
      }
      (l as Lot & { formKey?: string }).formKey = fresh;
      if (l.category === 'object') {
        (l as Lot & { objectClass?: string }).objectClass = objectClassOf({ title: l.title, medium: l.medium, category: l.category });
      }
      restamped++;
    }
  }
  return restamped;
}
