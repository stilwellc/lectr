import type { AuctionLot } from '../../app/types';
import { subCatOf, sportSlugOf } from './sub-cats';
import { extractReference } from './identity-enrich';
import { looksLikeCard, playerSlugOf } from '../../app/lib/cards';
import { classifyForm, objectClassOf, cleanGoldinTitle } from '../../app/lib/comps';
import { titleTokens as titleTokensOf } from '../../app/lib/normalize';
import { ARTIST_MARKET } from '../../app/constants';
import { AUTOGRAPH_SLUGS, autographFormatOf } from '../../app/lib/identity';
import { parseSignerName } from './autograph-signer';

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
  for (const l of lots) {
    const r = l as unknown as Record<string, unknown>;
    const sport = sportSlugOf(r.sport);
    if (!sport) continue;
    if (r._pid != null) vote(pidVotes, String(r._pid), sport);
    const card = r._card as { playerSlug?: string } | undefined;
    const player = (r.playerSlug as string) || card?.playerSlug;
    if (player) vote(playerVotes, player, sport);
  }
  const settle = (m: Map<string, Map<string, number>>): Map<string, string> => {
    const out = new Map<string, string>();
    m.forEach((inner, k) => {
      let tot = 0, best = '', bestN = 0;
      inner.forEach((n, sp) => { tot += n; if (n > bestN) { best = sp; bestN = n; } });
      if (tot >= 3 && bestN / tot >= 0.8) out.set(k, best);
    });
    return out;
  };
  const maps = { byPid: settle(pidVotes), byPlayer: settle(playerVotes) };

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

export function normalizeCorpus(lots: AuctionLot[]): void {
  const ls = lots as Lot[];
  // ENGINE SPEC v2 order: category flips (2c) run BEFORE identity work;
  // restampIdentityKeys (5) runs LAST so every flip re-derives its formKey.
  // healExpansionRows runs FIRST: it cleans titles (every parser below reads
  // them) and stamps the missing identity tokens.
  const healed = healExpansionRows(ls);
  const techMoved = rerouteCultureTech(ls);
  const yearsNulled = clampImpossibleYears(ls);
  const reroute = rerouteScienceMisroutes(ls);
  const relic = rerouteRelicCards(ls);
  const cat = normalizeArtCategory(ls);
  const refsFilled = enrichWatchReferences(ls);
  const players = recoverPlayerSlugs(ls);
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
}

/* ── CULTURE→SCIENCE REROUTE (Aug 14) — Apple/computing lots filed under the
   pop-culture slugs (RR's regex gaps: "Apple IIe"/"Apple III"/"Apple
   Computer"/"Altair 8800b"; Goldin's culture pass bypassing science routing).
   Tight signals only — computing hardware & founders, never a bare surname
   ("Tandy" matches Jessica Tandy; require computer context). Hardware/
   apparatus → scientific-instruments; documents/figures → science-tech. */
const CULT_SLUGS_TECH = new Set(['movie-tv', 'music-memorabilia', 'entertainment-memorabilia', 'pop-memorabilia']);
const TECH_HW = /\b(apple[- ]?(1|one|iii?\w{0,2})\b|apple (computer|lisa)|macintosh|iphone|ipod|ipad|imac|powerbook|next ?(computer|cube)|commodore|amiga|altair \d{3,4}\w?|ibm (pc|5150)|trs-80|osborne 1|circuit board|motherboard|logic board|microprocessor|enigma machine|difference engine|oscilloscope|prototype (board|computer|phone|device))\b/i;
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
const ORIGINAL_STRONG = /\b(?:oil|acrylic|tempera|alkyd|enamel|synthetic polymer)\b[^.;]{0,40}\bon\s+(?:canvas|linen|panel|board|masonite|cardboard|paper)\b|\bmixed media on (?:canvas|panel|board)\b|\bhand[- ]painted\b|\bunique\b/i;
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
const CANARY_EXCLUDE_HOUSES = new Set(['REA', 'Huggins & Scott', 'SCP', 'Lelands', 'Memory Lane', 'Love of the Game']);

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
export function recoverAutographSigners(lots: Lot[]): { stamped: number; candidates: number } {
  let stamped = 0, candidates = 0;
  for (const l of lots) {
    const w = l as Lot & { entity?: string | null; playerSlug?: string | null; medium?: string | null };
    if (!AUTOGRAPH_SLUGS.has(l.artist)) continue;
    if (w.entity || w.playerSlug) continue; // already identified — never overwrite
    if (!autographFormatOf(l.title)) continue; // must be an actual signed item
    candidates++;
    const name = parseSignerName({ title: l.title, medium: w.medium });
    if (name) { w.entity = name; stamped++; }
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
    const cls = cultItemClassOf(l.title || '');
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
