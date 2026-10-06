/**
 * classify.ts — ONE source for the lot-classification rules that the crawlers
 * apply at ingest AND corpus-normalize re-applies to the whole corpus every
 * nightly (reclassifyCorpus). A rule written here corrects both the rows a
 * house sends tomorrow and the ~1.1M rows already in the segments, so the two
 * paths can never drift apart.
 *
 * Measured against the Oct 6 2026 hand-labelled audit (1,648 lots, scratchpad
 * dd-cat): every rule below was tuned on the DEV half of the labels and scored
 * on the held-out TEST half; the corpus-wide blast radius of each rule was
 * sampled before it was kept.
 *
 * Conventions:
 *  · every detector is a pure function of the lot's own text fields (title,
 *    description, medium, sale name, house) — never of the crawl that found it;
 *  · a reclass rule returns the NEW artist slug, DROP (no valid home — evicted,
 *    the "untracked makers are never kept" doctrine), or null (no change);
 *  · rules are idempotent: a lot a rule moved never re-fires that rule.
 */
import { looksLikeCard } from '../../app/lib/cards';
import { leadsWithSetCode } from './set-codes';
import { ARTIST_MARKET } from '../../app/constants';

export const DROP = 'DROP' as const;

/** The fields a classification rule may read. */
export interface ClassifyLot {
  id?: string;
  artist: string;
  title?: string | null;
  description?: string | null;
  medium?: string | null;
  category?: string | null;
  auctionHouse?: string | null;
  saleName?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CARDS — the shared "is this a trading card" detector. looksLikeCard (cards.ts)
// is deliberately conservative (it gates the relic-card reroute); this one is
// the ROUTING detector: it also reads the plain graded-card title shape every
// card house prints ("1990 Leaf #125 Bo Jackson - PSA GEM MT 10", "11 T206
// White Border Joe Tinker - SGC VG-EX 4", "1985 Topps … – PSA EX-MT 6"),
// which looksLikeCard misses because its grade regex wants "PSA <digit>".
// ═══════════════════════════════════════════════════════════════════════════

/** a slab grade: grader + optional descriptor + number. Never PSA/DNA (that
 *  authenticates a raw signed object, not a card). */
export const SLAB_GRADE_RE = /\b(?:psa|bgs|sgc|cgc|bvg|gma|hga|csg)(?!\s*\/\s*dna)\s*(?:gem[- ]?(?:mt|mint)|mint|nm[- ]?mt\+?|nm\+?|ex[- ]?nm\+?|ex[- ]?mt\+?|ex\+?|vg[- ]?ex\+?|vg\+?|good|gd\+?|fair|fr|pr|poor|authentic|altered)?\s*\d/i;
/** title leads with a year (or a lot number + year): the card-title shape */
const YEAR_LEAD_RE = /^\s*(?:\d{1,4}\s+)?(?:['’]?\d{2}|1[89]\d{2}|20\d{2})(?:[-/]\d{2,4})?s?,?\s+\S/;
/** "11 T206 …", "11 E90-1 …" — Goldin's two-digit-year set-code titles */
const SHORT_YEAR_SET_CODE_RE = /^\s*\d{2}\s+(?:T\d{3}|E\d{2,3}|N\d{2,3}|R\d{3}|D\d{3}|M\d{3}|W\d{3})(?:-\d{1,2})?\b/;
const CARD_NO_RE = /#\s?[A-Za-z0-9][A-Za-z0-9/-]*/;
/** card product names (sets + manufacturers) */
const CARD_BRAND_RE = /\b(topps|bowman|panini|upper deck|fleer|donruss|goudey|play ball|o-pee-chee|score|pro set|hoops|skybox|prizm|optic|leaf|mosaic|stadium club|pinnacle|finest|metal universe|sp authentic|exquisite|national treasures|flawless|immaculate|kellogg'?s|bazooka|parkhurst|sportflics|playoff|contenders|spectra|obsidian|crown royale|zenith|flair|e-x2000|press pass|tobacco card)\b/i;
/** the physical OBJECT nouns that make a branded/graded title memorabilia, not a card */
const CARD_OBJECT_RE = /\b(jerseys?|uniform|bats?|gloves?|cleats|boots|helmet|trunks|shorts|jacket|shoes?|sneakers?|shirt|robe|photo|photograph|(?:signed|official|game|onl|oml|oal|obal|nfl|nba|wilson|spalding|rawlings) (?:base|basket|foot|soccer |golf )?ball|puck|pennant|banner|trophy|ring|belt|ticket|stub|pass|poster|painting|lithograph|display|plaque|bobblehead|statue|program|magazine|letter|check|contract|cut|envelope|cover)\b/i;
const CARD_WORD_RE = /\bcards?\b(?![- ]used)|\bhand[- ]cut\b|\b(?:psa|sgc|bgs|beckett)[- ](?:graded|encapsulated)\b|\bstickers?\b/i;
const CARD_SET_RE = /\b(?:complete|partial|near[- ]complete|master|team) (?:base )?set\b|\bset \(\d+/i;
/** paper publications (graded magazines read like slabs: "… Cover (Newsstand) - CGC 9.4") */
export const PUBLICATION_RE = /\b(sports illustrated|magazines?|newsstand|yearbooks?|media guides?|press guides?|programs?|programmes?|scorecards?|score cards?|newspapers?|publications?|annuals?|guides?)\b/i;
/** comics and mass toys — never a home anywhere (culture doctrine: no mass items) */
export const COMIC_RE = /\b(comic books?|(?<!bazooka )comics?|marvel comics|dc comics|amazing spider-man|action comics|detective comics|graphic novel)\b|\((?:19|20)\d\d (?:marvel|dc)\)|\bvol\.?\s*\d+\s*#\d+\b/i;
/** mass-produced toys — no home unless an athlete SIGNED it (then an autograph) */
export const MASS_TOY_RE = /\b(funko|action figures?|carded figure|beanie bab(?:y|ies)|kenner|hasbro|mattel|afa (?:[a-z+-]+ )?\d{2}|roleplay toy)\b/i;

/** Is this lot a trading CARD? (routing detector — see header) */
export function isCardTitle(title: string | null | undefined): boolean {
  const t = String(title || '');
  if (!t.trim()) return false;
  if (looksLikeCard(t) || leadsWithSetCode(t) || SHORT_YEAR_SET_CODE_RE.test(t)) return true;
  if (CARD_WORD_RE.test(t)) return true;
  const obj = CARD_OBJECT_RE.test(t);
  if (CARD_SET_RE.test(t) && !obj) return true;
  if (PUBLICATION_RE.test(t)) return false;
  const lead = YEAR_LEAD_RE.test(t);
  const grade = SLAB_GRADE_RE.test(t);
  if (lead && grade && !obj) return true;
  if (CARD_BRAND_RE.test(t) && lead && !obj) return true;
  const no = CARD_NO_RE.test(t);
  if (no && grade) return true;
  if (no && lead && !obj) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// SPORTS OBJECTS — the kind of a non-card sports lot. One ladder for every
// house (Goldin's Sport facet, the Christie's/Sotheby's sports-sale catch-all,
// the REA/H&S/Lelands/SCP/ML/LOTG expansion houses): the object's own words
// decide, most specific first.
// ═══════════════════════════════════════════════════════════════════════════
export const SEALED_RE = /\b(unopened|factory[- ]sealed|sealed (?:box|case|pack)|wax (?:pack|box|case)|hobby (?:box|case)|blaster(?: box)?|cello (?:pack|box)|rack (?:pack|box)|jumbo (?:pack|box)|vending (?:box|case)|fat pack|booster (?:box|pack))\b/i;
/** EXPLICIT use language — a jersey is not game-used because it is a jersey */
export const GAME_USED_RE = /\b(game[- ]?(?:used|worn|issued)|match[- ]?(?:used|worn|issued)|player[- ]?worn|team[- ]?issued|fight[- ]?worn|tour(?:nament)?[- ]?(?:used|worn)|race[- ]?(?:used|worn)|warm[- ]?up[- ]?worn|practice[- ]?(?:worn|used)|bench[- ]?worn|photo[- ]?match(?:ed)?|gamer|mears|meigray|worn by|used by)\b/i;
const TROPHY_RE = /\b(trophy|trophies|awards?|awarded|championship rings?|world series rings?|super bowl rings?|title belt|winners?'? medal|olympic (?:gold |silver |bronze )?medal|mvp award|heisman|plaque award|presentational ring|(?:final four|championship|title|world series|super bowl|pennant|all-star|league) rings?|presented to)\b/i;
const TICKET_RE = /\b(tickets?|stubs?|full ticket|season pass|press pass(?! (?:cards?|#))|credentials?|all[- ]access pass)\b/i;
const TYPE1_RE = /\b(type (?:1|i|one)\b|type-1|original (?:news service |wire |press )?photo(?:graph)?|wire photo|press photo|news service photo)\b/i;
export const SIGNED_RE = /\b(signed|autograph(?:ed|s)?|inscribed|signatures?|cut signature|auto\.)\b/i;

/** Kind of a NON-card sports object. `catchAll` is the house's memorabilia
 *  twin ('sports-memorabilia' at Goldin/Christie's/Sotheby's, 'memorabilia' at
 *  the expansion houses). */
export function sportsObjectKind(title: string | null | undefined, catchAll: 'sports-memorabilia' | 'memorabilia' = 'sports-memorabilia'): string {
  const t = String(title || '');
  if (SEALED_RE.test(t)) return 'unopened-wax';
  if (GAME_USED_RE.test(t)) return 'game-used';
  if (TYPE1_RE.test(t) && !SIGNED_RE.test(t)) return 'type-1-photos';
  if (TROPHY_RE.test(t)) return 'trophies-awards';
  if (TICKET_RE.test(t) && !PUBLICATION_RE.test(t)) return 'tickets-passes';
  if (PUBLICATION_RE.test(t) && !SIGNED_RE.test(t)) return 'programs-publications';
  if (TYPE1_RE.test(t) && !SIGNED_RE.test(t)) return 'type-1-photos';
  if (SIGNED_RE.test(t)) return 'autographs';
  if (PUBLICATION_RE.test(t)) return 'programs-publications';
  return catchAll;
}

// ── 1 · GOLDIN SPORT FACET — "a Sport lot with no object signal is a card" was
// wrong for 69k rows (jerseys, balls, photos, sealed boxes, magazines, comics):
// the card detector decides card; everything else gets its object kind.
// Non-sport TCG (Yu-Gi-Oh / One Piece / Union Arena …) and comics have no home.
export const NON_SPORT_TCG_RE = /\b(yu-?gi-?oh!?|one piece|union arena|dragon ball|digimon|magic:? the gathering|\bmtg\b|weiss schwarz|lorcana|flesh and blood|jujutsu kaisen|naruto|my hero academia|demon slayer|star wars unlimited)\b/i;

export function goldinSportKind(title: string | null | undefined): string {
  const t = String(title || '');
  if (NON_SPORT_TCG_RE.test(t) || COMIC_RE.test(t)) return DROP;
  if (MASS_TOY_RE.test(t) && !SIGNED_RE.test(t)) return DROP;
  if (SEALED_RE.test(t)) return 'unopened-wax';
  if (isCardTitle(t)) return 'sports-cards';
  return sportsObjectKind(t, 'sports-memorabilia');
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · ART CATEGORY — Madoura ceramics and unique works filed as prints. The
// crawler's print test ran before its ceramic test and five artists defaulted
// to 'print' with no evidence; normalize never moved print → sculpture and
// skipped print → original whenever 'silkscreen' appeared (Warhol's canvases
// are "synthetic polymer and silkscreen inks on canvas"). Reads title +
// medium + the first 600 chars of the description (Christie's/Bonhams/
// Phillips print the medium line there).
// ═══════════════════════════════════════════════════════════════════════════
const ART_MAKERS = new Set(Object.entries(ARTIST_MARKET).filter(([, m]) => m === 'art').map(([k]) => k));
const CERAMIC_RE = /madoura|earthenware|fa[iï]ence|ceramic|c[ée]ramique|empreinte originale|rami[ée]\b|terracotta|terre cuite|glazed|engobe|stoneware|porcelain|turned (?:vase|pitcher)/i;
/** Alain Ramié catalogue number — Picasso's CERAMIC catalogue ("(A.R. 408)", "a. r. 156", "ar no. 165") */
const RAMIE_NO_RE = /\ba\.?\s?r\.?\s*(?:no\.?\s*)?\d{1,3}\b/i;
const ART_PRINT_WORD_RE = /poster|affiche|lithograph|linocut|linogravure|etching|aquatint|screen ?print|silkscreen|s[ée]rigraph|woodcut|engraving|drypoint|offset|edition of|numbered|artist.s proof|\bprint(?:ed|s)?\b|gicl[ée]e|monotype|multiple|pochoir|photogravure|\bplates?\b/i;
/** a unique medium on a support: "oil on canvas", "pen and India ink on paper", "acrylic, oilstick and paper collage on canvas" */
const UNIQUE_MEDIUM_RE = /\b(?:oil|acrylic|tempera|gouache|watercolou?r|pastel|charcoal|crayon|graphite|pencil|ballpoint|pen|ink|felt[- ]tip|marker|oil ?stick|spray ?paint|enamel|synthetic polymer|gunpowder|collage|mixed media)s?\b[^.;]{0,60}?\bon\s+(?:canvas|linen|panel|board|paper|card|masonite|wood|metal|aluminum|cardboard)(?![a-z])/i;
/** Warhol's painting medium: silkscreen INK on canvas is a unique painting */
const SILKSCREEN_CANVAS_RE = /silkscreen inks?\b[^.;]{0,30}\bon (?:canvas|linen)/i;
const EDITION_MARK_RE = /edition of|numbered|\b\d{1,3}\s*\/\s*\d{1,4}\b/i;

const artText = (l: ClassifyLot) => `${l.title || ''} | ${l.medium || ''} | ${(l.description || '').slice(0, 600)}`;

/** The corrected art CATEGORY for a tracked art maker's lot, or null when the
 *  current one stands. Ceramic → sculpture; a unique medium → original. */
export function artCategoryFix(l: ClassifyLot): string | null {
  if (!ART_MAKERS.has(l.artist)) return null;
  const cat = l.category || 'unknown';
  if (cat === 'sculpture' || cat === 'photograph') return null;
  const s = artText(l);
  const printWord = ART_PRINT_WORD_RE.test(s);
  const ceramic = CERAMIC_RE.test(s) || (l.artist === 'pablo-picasso' && RAMIE_NO_RE.test(`${l.title || ''} ${l.medium || ''}`));
  if (ceramic && !/poster|affiche|lithograph|linocut|linogravure|etching|aquatint|screen ?print|serigraph|woodcut|engraving|drypoint|offset/i.test(s)) return 'sculpture';
  if (cat === 'original') return null;
  if (UNIQUE_MEDIUM_RE.test(s) && !printWord) return 'original';
  if (SILKSCREEN_CANVAS_RE.test(s) && !EDITION_MARK_RE.test(s)) return 'original';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE RECLASS LADDER — applied to every corpus row by corpus-normalize. Each
// entry is one audited error class; `apply` returns the new artist, DROP, or
// null. Order matters only where noted.
// ═══════════════════════════════════════════════════════════════════════════
export interface ReclassRule {
  cls: string;
  apply: (l: ClassifyLot) => string | null;
}

export const RECLASS_RULES: ReclassRule[] = [
  {
    cls: 'goldin-sport-noncard',
    apply: l => {
      if (l.auctionHouse !== 'Goldin' || l.artist !== 'sports-cards') return null;
      const k = goldinSportKind(l.title);
      return k === 'sports-cards' ? null : k;
    },
  },
];

/** Category rules: same contract, but they return the corrected CATEGORY. */
export const RECAT_RULES: ReclassRule[] = [
  { cls: 'art-ceramic-unique-vs-print', apply: artCategoryFix },
];

/** Run the ladder over one lot. Returns the classes that fired (in order) and
 *  whether the lot must be evicted; mutates artist (+ makerSlug when set). */
export function reclassifyLot(l: ClassifyLot & { makerSlug?: string | null }): { fired: string[]; drop: boolean } {
  const fired: string[] = [];
  for (const r of RECLASS_RULES) {
    const to = r.apply(l);
    if (to == null || to === l.artist) continue;
    fired.push(r.cls);
    if (to === DROP) return { fired, drop: true };
    l.artist = to;
    if (l.makerSlug) l.makerSlug = to;
  }
  for (const r of RECAT_RULES) {
    const to = r.apply(l);
    if (to == null || to === l.category) continue;
    fired.push(r.cls);
    l.category = to;
  }
  return { fired, drop: false };
}
