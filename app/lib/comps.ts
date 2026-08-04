/**
 * comps.ts — the comparables engine. One source of truth for "what counts as
 * a comp", shared by the buy signal, the comparables modal, and the crawler's
 * precompute.
 *
 * The old signal had one coarse gate (category) and a hole (unknown matched
 * everything), so a Haring exhibition poster comped against screenprints, a
 * catalogue against drawings, a Nakashima stool against a ten-foot bench.
 *
 * This engine:
 *  1. classifies every lot into a fine-grained FORM (title + medium keywords,
 *     tuned against the actual crawl data) — posters, books and ephemera are
 *     pulled out of 'print'; furniture splits into stool/bench/chair/table/…;
 *     originals split painting / work-on-paper / generic
 *  2. hard-gates comps on form equality — unknown never matches everything;
 *     generic originals only comp generic originals
 *  3. gates on size when both sides have parseable dimensions (opportunistic —
 *     coverage is 8–40% — but decisive when present)
 *  4. prefers the SAME EDITION: >= 3 sales of the same normalized title are
 *     the whole pool ("what did this exact work last hammer for")
 *  5. suppresses the signal when the comp pool is too dispersed to mean
 *     anything (IQR/median guard) or too thin (< 3)
 */
import { AuctionLot, ObjectType, SoldComp } from '../types';

export type Form =
  | 'book' | 'ephemera' | 'poster' | 'photograph' | 'textile'
  | 'object-edition' | 'print'
  | 'painting' | 'work-on-paper' | 'original-2d'
  | 'sculpture'
  | 'seating-chair' | 'seating-stool' | 'seating-bench' | 'seating-sofa'
  | 'table-dining' | 'table-low' | 'table-side' | 'table'
  | 'case' | 'desk' | 'bed' | 'lighting' | 'mirror' | 'design-other'
  | 'wristwatch' | 'pocket-watch' | 'clock' | 'jewelry'
  | 'meteorite' | 'fossil' | 'mineral' | 'space' | 'instrument' | 'tech'
  | 'sports-jersey' | 'sports-bat' | 'sports-ball' | 'sports-glove'
  | 'sports-worn' | 'sports-ticket' | 'sports-trophy'
  | 'unknown';

export const FORM_LABEL: Record<Form, string> = {
  book: 'books & catalogues', ephemera: 'ephemera', poster: 'posters',
  photograph: 'photographs', textile: 'textiles',
  'object-edition': 'editioned objects', print: 'prints',
  painting: 'paintings', 'work-on-paper': 'works on paper', 'original-2d': 'unique works',
  sculpture: 'sculptures',
  'seating-chair': 'chairs', 'seating-stool': 'stools', 'seating-bench': 'benches',
  'seating-sofa': 'sofas', 'table-dining': 'dining tables', 'table-low': 'coffee tables',
  'table-side': 'side tables', table: 'tables', case: 'case pieces', desk: 'desks',
  bed: 'beds', lighting: 'lighting', mirror: 'mirrors', 'design-other': 'design objects',
  wristwatch: 'wristwatches', 'pocket-watch': 'pocket watches', clock: 'clocks',
  jewelry: 'jewelry',
  meteorite: 'meteorites', fossil: 'fossils', mineral: 'minerals',
  space: 'space artifacts', instrument: 'scientific instruments', tech: 'technology',
  'sports-jersey': 'game-worn jerseys', 'sports-bat': 'bats', 'sports-ball': 'balls',
  'sports-glove': 'gloves', 'sports-worn': 'game-used gear',
  'sports-ticket': 'tickets & passes', 'sports-trophy': 'trophies & awards',
  unknown: 'lots',
};

/** Classify a lot into its form. Order matters: the most specific cues win.
    Cached per lot object (WeakMap) — the ~40 regex tests run once per lot per
    session, not once per comp-gate evaluation; lots are immutable after JSON
    load in both the client and the build script, so identity caching is safe. */
const FORM_CACHE = new WeakMap<object, Form>();
export function classifyForm(lot: Pick<AuctionLot, 'title' | 'medium' | 'category'>): Form {
  const hit = FORM_CACHE.get(lot);
  if (hit !== undefined) return hit;
  const form = classifyFormUncached(lot);
  FORM_CACHE.set(lot, form);
  return form;
}

function classifyFormUncached(lot: Pick<AuctionLot, 'title' | 'medium' | 'category'>): Form {
  const t = ` ${(lot.title || '').toLowerCase()} `;
  const m = ` ${(lot.medium || '').toLowerCase()} `;
  const tm = t + m;

  // paper/publishing forms hiding across categories
  if (/\b(book|catalogue|catalog|magazine|monograph)\b/.test(tm)) return 'book';
  if (/\b(invitation|announcement|flyer|ticket|postcard|greeting card|record sleeve|album cover|vinyl record|mailer)\b/.test(tm)) return 'ephemera';
  if (/\b(poster|affiche)\b/.test(tm)) return 'poster';

  // photographs (their own category, plus photographic mediums elsewhere)
  if (lot.category === 'photograph' || /\b(gelatin silver|c-print|chromogenic|polaroid|cibachrome|photograph)\b/.test(m)) return 'photograph';

  if (/\b(rug|tapestry|carpet|textile|blanket|scarf)\b/.test(tm)) return 'textile';

  // editioned objects & multiples (KAWS companions, decks, plates, plush…)
  if (/\b(skateboard|skate deck|deck set|companion|be@rbrick|bearbrick|vinyl figure|plush|figure set|ceramic (container|set|plate)|perfume|snow ?globe|keychain|ornament|chess set|cushion|pillow|dish set)\b/.test(tm)) return 'object-edition';

  // The watches & science verticals: their lots arrive as category 'object'
  // (never art/design), so these checks can't hijack a Nakashima "fossilized
  // walnut" table or a KAWS "Companion" into science forms — and vice versa.
  if (lot.category === 'object') {
    // horology & jewelry
    if (/\bpocket ?watch\b/.test(tm)) return 'pocket-watch';
    // Explicit jewelry nouns first (a Panthère brooch is jewelry even though
    // Panthère is also a watch line). SINGULAR forms — unchanged from before.
    if (/\b(ring|necklace|brooch|earrings?|pendant|bangle|choker|cufflinks)\b/.test(t)) return 'jewelry';
    // Plural / set jewelry forms the singular gate missed. A watch-MODEL word
    // (Ellipse, Tank, Santos, Panthère) is ALSO a jewelry line, so a lot whose
    // OBJECT noun is jewelry (a ring SET, a pair of bangles) must resolve to
    // jewelry BEFORE the watch-model cues below fire. Concrete leak:
    //   "…GEM-SET 'ELLIPSE' RINGS"  →  jewelry, not a wristwatch.
    // But an actual WATCH lot can also say "set of … wristwatches" (a boxed set
    // of watches) or "wristwatch with … bracelet and set of golf clubs" — so the
    // plural/set jewelry gate must NOT fire when the title describes a watch.
    // The substring "watch" (wristwatch/watches/"bracelet watch"/…) — plus
    // montre / chronograph, which never contain it — marks watch context and
    // keeps the lot a wristwatch. A genuine jewelry set never says "watch".
    const watchWord = /watch/.test(tm) || /\b(montre|chronograph|chronometer|chronometre)\b/.test(tm);
    if (!watchWord) {
      // (a) a "SET OF … <jewelry noun>" construction — the lot IS the jewelry
      //     set. 'rings'/'clips' are safe here: "chapter rings"/"tie clip" never
      //     appear inside a bare "set of …" jewelry phrase.
      if (/\bset of\b/.test(t)
        && /\b(rings?|brooch(?:es)?|earrings?|necklaces?|bracelets?|pendants?|bangles?|cufflinks|studs?|clips?)\b/.test(t)) return 'jewelry';
      // (b) an unambiguously-plural jewelry noun that is never a watch/dial/
      //     hardware feature word. 'rings'/'clips' are DELIBERATELY excluded here
      //     ("chapter rings" a dial, "wrist rings" a spacesuit, "tie/paper clip").
      if (/\b(necklaces|brooches|bangles|pendants|earrings|tiaras?|anklets)\b/.test(t)) return 'jewelry';
    }
    // watch titles are catalog-style ("Cosmograph Daytona, Ref: 16518",
    // "Montre bracelet en or…") — the word "watch" is often absent
    if (/\b(wristwatch|wrist ?watch|montre)\b/.test(tm)
      || (/\bwatch\b/.test(tm) && /\b(chronograph|chronometer|automatic|quartz|manual wind|movement|dial|bezel|calibre|caliber|tourbillon|perpetual calendar|bracelet|gold|steel|lady'?s|gentleman)\b/.test(tm))
      || /\bref[:.]?\s*[a-z]?\d{3,6}/.test(t)
      || /\b(chronograph|chronometer|chronometre|oyster|cosmograph|cellini)\b/.test(t)
      || WATCH_MODELS.test(t)) return 'wristwatch';
    if (/\b(clock|regulator)\b/.test(tm)) return 'clock';

    // natural history, space & technology
    if (/\b(meteorite|pallasite|tektite|moldavite)\b/.test(tm)) return 'meteorite';
    if (/\b(fossil|fossilis|fossiliz|dinosaur|trilobite|ammonite|megalodon|mammoth|mosasaur|tyrannosaurus|triceratops|pterosaur|ichthyosaur|plesiosaur|sabre[- ]tooth|saber[- ]tooth)\b/.test(tm)) return 'fossil';
    if (/\b(mineral|crystal|geode|amethyst|tourmaline|malachite|azurite|pyrite)\b/.test(tm)) return 'mineral';
    if (/\b(space[- ]flown|apollo|nasa|astronaut|cosmonaut|lunar|spacecraft|space suit|spacesuit|sputnik|gemini|soyuz|vostok|skylab|space shuttle|rocket)\b/.test(tm)) return 'space';
    if (/\b(telescope|microscope|astrolabe|sextant|octant|orrery|armillary|barometer|theodolite|slide rule|surveying|navigational|scientific instrument|globe)\b/.test(tm)) return 'instrument';
    if (/\b(computer|macintosh|apple|altair|commodore|enigma|calculator|typewriter|prototype|microprocessor|arcade|camera)\b/.test(tm)) return 'tech';
    return 'unknown'; // an object lot that matched nothing — never guess
  }

  // furniture / design forms (title carries the truth in this data)
  const isDesign = lot.category === 'design';
  if (isDesign || /\b(walnut|teak|oak|rosewood)\b/.test(m)) {
    if (/\b(bench|settee|daybed)\b/.test(t)) return 'seating-bench';
    if (/\b(stool|ottoman|pouf)\b/.test(t)) return 'seating-stool';
    if (/\b(sofa|couch|sectional)\b/.test(t)) return 'seating-sofa';
    if (/\b(chair|rocker|recliner)\b/.test(t)) return 'seating-chair';
    if (/\b(dining table|conference table|trestle table)\b/.test(t)) return 'table-dining';
    if (/\b(coffee table|low table|cocktail table)\b/.test(t)) return 'table-low';
    if (/\b(side table|end table|occasional table|nesting table|nightstand|night stand)\b/.test(t)) return 'table-side';
    if (/\btable\b/.test(t)) return 'table';
    if (/\b(cabinet|chest|dresser|sideboard|credenza|wardrobe|bookcase|bookshelf|shelves|shelf|case piece|etagere|étagère|highboard|commode)\b/.test(t)) return 'case';
    if (/\b(desk|workbench|vanity)\b/.test(t)) return 'desk';
    if (/\b(bed|headboard)\b/.test(t)) return 'bed';
    if (/\b(lamp|sconce|chandelier|lighting|light fixture|lantern)\b/.test(t)) return 'lighting';
    if (/\bmirror\b/.test(t)) return 'mirror';
    if (isDesign) {
      // plural / compound / French rescue (ENGINE SPEC v2 §2.4 Gate 2):
      // 'design-other' held 48.6% of the vertical; ~1.4k of its 5.3k rows are
      // plainly-nameable seating/tables the singular ladder missed. Ordered
      // AFTER the bench/stool/sofa checks above.
      if (/\b(chairs|armchairs?|fauteuils?|chaises?)\b/.test(t) || /\w+chairs?\b/.test(t)) return 'seating-chair';
      if (/\b(stools|tabourets?)\b/.test(t)) return 'seating-stool';
      if (/\bbenches\b/.test(t)) return 'seating-bench';
      if (/\btables\b/.test(t)) return 'table';
      if (/\bbureau\b/.test(t)) return 'desk';
      if (/\blit\b/.test(t)) return 'bed';
      if (/\bmiroir\b/.test(t)) return 'mirror';
      return 'design-other';
    }
  }

  if (lot.category === 'sculpture') return 'sculpture';
  if (lot.category === 'print') return 'print';

  if (lot.category === 'original') {
    if (/\b(oil|acrylic|enamel|alkyd)\b/.test(m) && /\b(canvas|linen|panel|board|masonite)\b/.test(m)) return 'painting';
    if (/\boil on canvas|acrylic on canvas\b/.test(t)) return 'painting';
    if (/\b(pencil|graphite|charcoal|ink|watercolor|watercolour|gouache|pastel|crayon|marker|pen|drawing|study|sketch)\b/.test(tm)) return 'work-on-paper';
    return 'original-2d';
  }

  return 'unknown';
}

/* ── size parsing (ported from the modal — opportunistic gate) ── */
function parseFrac(s: string): number {
  const fracs: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.333, '⅔': 0.667, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
  const cleaned = s.replace(/^[A-Za-z.]+\s*/, '').trim();
  const mixed = cleaned.match(/^(\d+)\s+(\d+)\/(\d+)/);
  if (mixed) return parseFloat(mixed[1]) + parseFloat(mixed[2]) / parseFloat(mixed[3]);
  const slash = cleaned.match(/^(\d+)\/(\d+)/);
  if (slash) return parseFloat(slash[1]) / parseFloat(slash[2]);
  let val = 0;
  const int = cleaned.match(/^(\d+\.?\d*)/);
  if (int) val += parseFloat(int[1]);
  for (const [ch, n] of Object.entries(fracs)) if (cleaned.includes(ch)) { val += n; break; }
  if (val === 0) val = parseFloat(cleaned) || 0;
  return val;
}

export function parseDims(dims: string | null | undefined): [number, number] | null {
  if (!dims) return null;
  let str = dims;
  const sheet = dims.match(/[IS]\.\s*(.+?)(?:\(|[IS]\.|$)/);
  if (sheet) str = sheet[1].trim();
  const useIn = str.toLowerCase().includes('in');
  const tokens = str.split(/\s*(?:[x×]|\bby\b)\s*/i).map(s => s.trim());
  if (tokens.length < 2) return null;
  const h = parseFrac(tokens[0]);
  const w = parseFrac(tokens[1]);
  if (!h || !w) return null;
  if (!useIn && str.toLowerCase().includes('cm')) return [h / 2.54, w / 2.54];
  return [h, w];
}

/**
 * Furniture bifurcates by MODEL, not just form: an LC2 sofa is a licensed
 * Cassina production line trading at $1–4K while an unmarked Jeanneret
 * Chandigarh sofa hammers at $15–30K — same artist, same form, different
 * markets. The model key is extracted from the title: alphanumeric codes
 * (LC2, PK22, CH24, PJ-010100) or a named series word directly before the
 * form noun (Conoid bench, Standard chair, Diamond chair). Comps must share
 * the model key — including both having none.
 */
const MODEL_STOPWORDS = new Set([
  'a', 'an', 'the', 'pair', 'set', 'two', 'three', 'four', 'six', 'his', 'her',
  'walnut', 'teak', 'oak', 'rosewood', 'pine', 'maple', 'cherry', 'burl', 'laurel',
  'custom', 'rare', 'early', 'important', 'fine', 'exceptional', 'monumental',
  'large', 'small', 'long', 'low', 'high', 'tall', 'double', 'single', 'grand',
  'occasional', 'freeform', 'free-form', 'upholstered', 'illuminated', 'unique',
  'special', 'signed', 'vintage', 'original',
]);
// prepositions/articles that precede a number in prose ("in 2 parts", "of 3",
// "circa 1960") — never a real model prefix, and minting a key from them
// silently fragments an otherwise-matching comp pool.
const CODE_BLACKLIST = new Set(['no', 'ca', 'vol', 'lot', 'est', 'circa', 'in', 'of', 'at', 'to', 'by', 'as', 'for', 'and', 'the']);
const FORM_NOUNS = /(sofa|couch|settee|bench|daybed|stool|ottoman|chair|rocker|table|cabinet|chest|dresser|sideboard|credenza|desk|bed|headboard|lamp|sconce|chandelier|mirror|shelf|shelves|bookcase)/;

export function modelKey(lot: Pick<AuctionLot, 'title'>): string | null {
  const t = (lot.title || '').toLowerCase();
  // 1 · alphanumeric model codes: lc2, lc-2, pk22, ch 24, pj-010100
  const code = t.match(/\b([a-z]{1,3})[-. ]?(\d{1,4})[a-z]?\b/);
  if (code && !CODE_BLACKLIST.has(code[1]) && !/^(19|20)\d\d$/.test(code[2])) {
    return `${code[1]}${code[2]}`;
  }
  // 2 · "model 123" / "model no. 45"
  const modelNo = t.match(/\bmodel\s+(?:no\.?\s*)?([a-z0-9-]{1,10})\b/);
  if (modelNo) return modelNo[1].replace(/-/g, '');
  // 3 · named series word immediately before the form noun
  const named = t.match(new RegExp('\\b([a-z][a-z-]{2,})\\s+' + FORM_NOUNS.source + 's?\\b'));
  if (named && !MODEL_STOPWORDS.has(named[1])) return named[1];
  return null;
}

const FURNITURE = new Set<Form>([
  'seating-chair', 'seating-stool', 'seating-bench', 'seating-sofa',
  'table-dining', 'table-low', 'table-side', 'table', 'case', 'desk', 'bed',
  'lighting', 'mirror', 'design-other',
]);

/**
 * Watches bifurcate by REFERENCE the way furniture bifurcates by model: a
 * Daytona never comps a Datejust, a Nautilus never comps a Calatrava — same
 * maker, same form, different markets. The key is the reference number when
 * the title carries one, else the model line name. Comps must share the key —
 * including both having none.
 */
const WATCH_MODELS = /(submariner|daytona|datejust|day[- ]date|gmt[- ]master(?:\s*ii)?|explorer(?:\s*ii)?|sea[- ]dweller|yacht[- ]master|milgauss|air[- ]king|oyster perpetual|cellini|nautilus|aquanaut|calatrava|ellipse|gondolo|twenty[~-]?4|world time|royal oak(?: offshore)?|millenary|jules audemars|speedmaster|seamaster|constellation|de ville|railmaster|tank|santos|panth[eè]re|ballon bleu|pasha|crash|baignoire|tortue|reverso|memovox|polaris|navitimer|superocean|chronomat|monaco|carrera|autavia|el primero|defy|portugieser|portofino|ingenieur|aquatimer|luminor|radiomir|overseas|patrimony|fifty ?fathoms|villeret)/;

export function watchKey(lot: Pick<AuctionLot, 'title'>): string | null {
  const t = (lot.title || '').toLowerCase();
  // 1 · explicit reference: "Ref. 116500LN", "reference 5711/1A"
  const ref = t.match(/\bref(?:erence)?\.?,?\s*([a-z]?\d{3,6}[a-z]{0,4}(?:\/\d+[a-z]?)?)\b/);
  if (ref) return ref[1];
  // 2 · the model line name
  const model = t.match(WATCH_MODELS);
  if (model) return model[1].replace(/[-~ ]/g, '');
  return null;
}

/** How the watch key was derived — an explicit REFERENCE number is a tight
    cohort; a bare model-line NAME ("daytona") pools decades and materials.
    Measured: ref-keyed pools IQR/med 0.53 vs model-name 1.27 (2.4× looser),
    so model-name keys cap confidence at 'medium' (H1) and cannot flag without
    a material-pure pool (§1.3). */
export function watchKeyKind(lot: Pick<AuctionLot, 'title'>): 'ref' | 'model-name' | null {
  const t = (lot.title || '').toLowerCase();
  if (/\bref(?:erence)?\.?,?\s*([a-z]?\d{3,6}[a-z]{0,4}(?:\/\d+[a-z]?)?)\b/.test(t)) return 'ref';
  if (WATCH_MODELS.test(t)) return 'model-name';
  return null;
}

/** Coarse watch material from title+medium. Gold shades deliberately collapse
    (fine split measured no better: 0.305 vs 0.303). */
export function coarseWatchMaterial(lot: Pick<AuctionLot, 'title' | 'medium'>): string | null {
  const t = `${(lot.title || '')} ${(lot.medium || '')}`.toLowerCase();
  const gold = /\b(gold|or jaune|or gris|or rose|or blanc)\b|\b18k\b|\b14k\b|\b18ct\b|\b9ct\b/.test(t);
  const steel = /\b(steel|stainless|acier)\b/.test(t);
  if ((gold && steel) || /two[- ]tone/.test(t)) return 'two-tone';
  if (/platinum|platine/.test(t)) return 'platinum';
  if (gold) return 'gold';
  if (steel) return 'steel';
  if (/titanium/.test(t)) return 'titanium';
  return null;
}

const WATCHES = new Set<Form>(['wristwatch', 'pocket-watch']);

/* ── object class & market form gates (W17) ─────────────────────────────
   The watch-maker ambiguity: Cartier is a jeweler as much as a watchmaker,
   so a maker crawl carries Panthère RINGS alongside Panthère watches. The
   verticals gate on form class so a ring never headlines /watches — on the
   call plate, in the feed pool, anywhere. */

/** The coarse object class stamped on category 'object' lots at crawl time
    (lot.objectClass). Derived from classifyForm — compute it here for
    anything unstamped (older archive records). */
export function objectClassOf(lot: Pick<AuctionLot, 'title' | 'medium' | 'category'>): 'watch' | 'jewelry' | 'object' {
  const f = classifyForm(lot);
  if (f === 'wristwatch' || f === 'pocket-watch' || f === 'clock') return 'watch';
  if (f === 'jewelry') return 'jewelry';
  return 'object';
}

// Per-market form sets. 'unknown' is deliberately INCLUDED in every set:
// the gate exists to exclude known mismatches (jewelry inside watches), never
// to punish a lot the classifier couldn't read — coverage honesty.
const WATCH_FORMS = new Set<Form>(['wristwatch', 'pocket-watch', 'clock', 'unknown']);
const SCIENCE_FORMS = new Set<Form>(['meteorite', 'fossil', 'mineral', 'space', 'instrument', 'tech', 'unknown']);
const DESIGN_FORMS = new Set<Form>([...Array.from(FURNITURE), 'textile', 'object-edition', 'unknown']);
const ART_FORMS = new Set<Form>([
  'book', 'ephemera', 'poster', 'photograph', 'textile', 'object-edition',
  'print', 'painting', 'work-on-paper', 'original-2d', 'sculpture', 'unknown',
]);

const MARKET_FORMS: Record<string, ReadonlySet<Form> | null> = {
  all: null,     // the total market gates nothing
  art: ART_FORMS,
  design: DESIGN_FORMS,
  watches: WATCH_FORMS,
  science: SCIENCE_FORMS,
  sports: null,  // sports objects classify by exclusion (no dedicated Forms) — no gate
};

/** The form-class set a market admits, or null when the market carries no
    form doctrine ('all', 'sports', anything unrecognized). Consumed by
    pickCall and the vertical feed pools:
      const forms = formsForMarket(market);
      const pool = forms ? lots.filter(l => forms.has(classifyForm(l))) : lots;
    (or use lotFitsMarket below as the one-line predicate). */
export function formsForMarket(market: string): ReadonlySet<Form> | null {
  return MARKET_FORMS[market] ?? null;
}

/** Pool-side gate, page-friendly: does this lot belong in this vertical's
    pool? A Cartier ring returns false for 'watches' and true for 'all'.
    Reads the lot's text (classifyForm — cached per lot object), so it works
    on archive records that predate crawl-time objectClass stamping. */
export function lotFitsMarket(lot: Pick<AuctionLot, 'title' | 'medium' | 'category'>, market: string): boolean {
  const forms = formsForMarket(market);
  return !forms || forms.has(classifyForm(lot));
}

/* ── persisted-key reads (additive) ──────────────────────────────────────
   A migrated lot carries its classifyForm/modelKey/watchKey outputs stamped as
   lot.formKey / lot.modelKey / lot.reference (identical values, computed once
   at crawl time). Prefer the persisted key when present — same pools, cheaper —
   else compute exactly as before. A pre-migration lot has these undefined and
   falls through to the live functions, so pools are byte-identical either way. */
function formOf(lot: AuctionLot): Form {
  return (lot.formKey as Form | undefined) ?? classifyForm(lot);
}
function modelKeyOf(lot: AuctionLot): string | null {
  return lot.modelKey !== undefined ? lot.modelKey : modelKey(lot);
}
function watchKeyOf(lot: AuctionLot): string | null {
  return lot.reference !== undefined ? lot.reference : watchKey(lot);
}

const ART_2D_TIGHT = new Set<Form>(['print', 'poster', 'painting', 'work-on-paper', 'original-2d', 'photograph']);

/** The hard gate, curried: classify/key/measure the ANCHOR once, then test
    many candidates — `sold.filter(comparableTo(lot))` instead of re-deriving
    the anchor's form, model/watch key and dims per candidate. */
export function comparableTo(lot: AuctionLot): (candidate: AuctionLot) => boolean {
  const a = formOf(lot);
  if (a === 'unknown') return () => false; // never guess
  const isFurniture = FURNITURE.has(a);
  const isWatch = WATCHES.has(a);
  const keyA = isFurniture ? modelKeyOf(lot) : null;
  const refA = isWatch ? watchKeyOf(lot) : null;
  const matA = isWatch ? coarseWatchMaterial(lot) : null;
  const da = parseDims(lot.dimensions);

  return (candidate: AuctionLot) => {
    // form equality — a is known, so an unknown candidate never matches
    if (formOf(candidate) !== a) return false;

    // furniture bifurcates by model: LC2 comps LC2, Conoid comps Conoid, and a
    // generic piece never comps a model-coded production line (or vice versa)
    if (isFurniture && keyA !== modelKeyOf(candidate)) return false;

    // watches bifurcate by reference: Daytona comps Daytona, never Datejust
    if (isWatch && refA !== watchKeyOf(candidate)) return false;

    // STRICT material gate (measured: −3.4% reads for medAbsErr 0.311→0.300;
    // steel Daytona $47.5K vs two-tone $11.2K sat in one pool). Strict per
    // doctrine: an unparsed-material candidate is a loose comp — excluded.
    if (isWatch && matA && coarseWatchMaterial(candidate) !== matA) return false;

    // opportunistic size gate when both sides are measurable
    if (da) {
      const db = parseDims(candidate.dimensions);
      if (db) {
        if (isFurniture) {
          // a 40-inch bench is not a comp for a ten-footer
          const la = Math.max(...da), lb = Math.max(...db);
          if (la > 0 && lb > 0 && (la / lb > 2.2 || lb / la > 2.2)) return false;
        } else {
          // art 2D forms take the measured tighter band (4→2.5×: retained-pool
          // err 0.535→0.476 on the affected reads, aggregate unchanged) —
          // still opportunistic (dims-required measured WORSE, 0.427→0.433)
          const areaMax = ART_2D_TIGHT.has(a) ? 2.5 : 4;
          const areaA = da[0] * da[1], areaB = db[0] * db[1];
          if (areaA > 0 && areaB > 0 && (areaA / areaB > areaMax || areaB / areaA > areaMax)) return false;
        }
      }
    }
    return true;
  };
}

/** The hard gate: is `candidate` a legitimate comp for `lot`? One-shot form
    of comparableTo — inside a filter, prefer the curried gate. */
export function areComparable(lot: AuctionLot, candidate: AuctionLot): boolean {
  return comparableTo(lot)(candidate);
}

/* ── v2 money read (additive, alias-safe) ────────────────────────────────
   The estimate band the signal divides against. Post-migration the canonical
   USD estimate lives in estLowUsd/estHighUsd (native × dated FX); pre-migration
   only estimateLow/estimateHigh exist. Read the USD fields when present, fall
   back to the old ones — so the ratio is correct BEFORE and AFTER migration and
   a Bonhams GBP lot stops dividing a USD price by a native-GBP estimate. The
   old fields become aliases of the *Usd fields at migration, so both agree. */
function estUsdBand(lot: AuctionLot): { low: number | null; high: number | null } {
  return {
    low: lot.estLowUsd ?? lot.estimateLow,
    high: lot.estHighUsd ?? lot.estimateHigh,
  };
}

/** the named series of a print title ("…, from Jazz (…)") — normalized, ≥3 chars */
function seriesOf(t: string | null | undefined): string | null {
  const m = (t || '').match(/(?:,|\s)from\s+(?:the\s+)?(.{3,50}?)(?:\s*\(|,|\s*\d*\s*$)/i);
  if (!m) return null;
  const s = normalizeTitle(m[1]);
  return s.length >= 3 ? s : null;
}

export function normalizeTitle(t: string | null | undefined): string {
  return (t || '')
    .toLowerCase()
    .replace(/["“”'’]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DeepSignal {
  label: 'Below Market' | 'Above Market';
  pct: number;
  /** how many comps the median is drawn from */
  basis: number;
  /** the pool's median price — THE number; every surface must display this */
  med?: number;
  /** 'edition' = same-title sales of this exact work; 'form' = same-form comps */
  kind: 'edition' | 'form';
  form: Form;
  /** how much to trust the call — from the pool itself:
      very-high = this exact work (same normalized title) has sold 3+ times
      high      = a large tight pool, or many comps from the same series
      medium    = a decent pool that mostly agrees
      low       = passes the guards, but thin or spread out */
  confidence: 'very-high' | 'high' | 'medium' | 'low';
}

function median(sorted: number[]): number {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

/**
 * The deep buy signal. Same thresholds as ever (comps median >= +20% over the
 * estimate midpoint = Below Market; <= -25% = Above Market) — but the pool is
 * now honest.
 */
/**
 * The signal WITH the exact pool that produced it. Every surface that shows
 * the number (card sentence, Today's Call band, comps modal) must render this
 * same pool and this same median — one lot, one statistic, no second math.
 */
interface CompRead {
  pool: AuctionLot[];
  med: number;
  kind: 'edition' | 'form';
  form: Form;
  confidence: DeepSignal['confidence'];
  estMid: number;
  /** measured dishonest-flag classes may still be APPRAISED but never FLAG */
  flagEligible: boolean;
}

/** The shared comp-pool read: same pools, same guards, same confidence as the
 *  card signal — but it returns the MEDIAN unconditionally, so an appraisal
 *  exists even when the lot sits between the signal thresholds. */
const CULTURE_SLUGS_ENGINE = new Set(['movie-tv', 'music-memorabilia', 'entertainment-memorabilia']);

function compPoolRead(lot: AuctionLot, allLots: AuctionLot[]): CompRead | null {
  // Culture never enters the frozen engine: repeated subject-header titles
  // ('walt disney studios' ×368) mint false very-high editions, simulated
  // flags ran 61.7% beat at 1.20 median ratio (< the 1.25 premium break-even
  // — negative edge), and the band is 2× worse than the specialist estimate.
  // Culture reads live in cultureReferenceBand (descriptive, never a flag).
  if (CULTURE_SLUGS_ENGINE.has(lot.artist)) return null;
  const est = estUsdBand(lot);
  if (!est.low || !est.high) return null;
  const form = formOf(lot);
  if (form === 'unknown') return null;
  const estMid = (est.low + est.high) / 2;

  // Watches with NO reference/model identity → abstain. watchKey is null when
  // the title carries neither a reference number nor a model line ("Omega,
  // wristwatch, 32,5 mm."). Its pool would be EVERY no-reference wristwatch of
  // the maker ($37–$6.25M for Rolex, $90–$10.3M for Patek) — the comparableTo
  // gate matches all watchKey===null siblings, and the dispersion guard lets
  // Patek slip through at IQR/med 2.30. A blank beats a wrong number: without a
  // reference there is no legitimate comp cohort, so produce no signal. This
  // MATCHES the server engine, which abstains on the same lots — its title
  // cosine across catalog-style watch titles falls under the 0.45 gate with no
  // reference bonus to lift it, so resolveComps/estimateValue seat no pool.
  if (WATCHES.has(form) && watchKeyOf(lot) === null) return null;

  // Sports/science OBJECT lots (game-used jerseys, trophies, tickets) share
  // one artist-slug per CATEGORY ('game-used'), not per maker — so an
  // artist-only pool mixes every athlete/specimen. The realized read means
  // nothing unless it's the SAME identity — the athlete for sports objects
  // (playerSlug), the subject/specimen tag for science objects (entity; a
  // meteorite has no player, and gating science on playerSlug killed its whole
  // comp layer). No identity on the anchor → abstain (the surface shows
  // nothing, never a stranger's comps). Never touches art/watch/design lots.
  const identityObject = isSportsScienceObject(lot);
  const idKey = identityObject ? objectIdentityKey(lot) : null;
  if (identityObject && !idKey) return null;

  const sold = allLots.filter(l =>
    l.artist === lot.artist && l.status === 'sold' && l.priceUsd && l.id !== lot.id
    // Algolia-sourced Sotheby's lots are thin (title-only, no dimensions/medium/
    // reference/titleTokens) and are engine-EXCLUDED at build time; the client
    // re-derives comps here, so guard them out too or a title-only lot pollutes
    // the comp pool for art/watch makers (picasso, patek, rolex, …).
    // NOTE (spec §2.2): soldCompBand deliberately does NOT share this
    // exclusion — game-used titles carry their identity and priceUsd is real;
    // re-adding it there re-zeroes the sports vertical.
    && (l as AuctionLot & { source?: string }).source !== 'sothebys-algolia'
    // sports/science objects: same identity only (never a cross-athlete jersey
    // or a cross-specimen meteorite).
    && (!identityObject || objectIdentityKey(l) === idKey)
  );

  // 1 · the same edition — the strongest comp there is
  const nt = normalizeTitle(lot.title);
  let pool: AuctionLot[] = [];
  let kind: 'edition' | 'form' = 'form';
  // Require ≥2 distinctive tokens so a short/generic normalized title (e.g. a
  // truncated "apollo 14" collection tag) can't collide unrelated lots into a
  // false "very-high" edition.
  const distinctiveTokens = nt.split(' ').filter(w => w.length >= 3).length;
  if (nt.length >= 8 && distinctiveTokens >= 2) {
    const sameTitle = sold.filter(l => normalizeTitle(l.title) === nt && formOf(l) === form);
    if (sameTitle.length >= 3) {
      // Estimate-band sanity: a real edition clears near the lot's own estimate;
      // a collision pool of different objects will sit wildly outside it.
      // Uses the OUTER USD estMid (:533) — a local recompute from raw
      // estimateLow/High mixed native units against the USD median, and on
      // USD-alias-only rows evaluated to 0, skipping the guard entirely
      // (the 'walt disney studios' ×368 false-edition class).
      const m = median(sameTitle.map(l => l.priceUsd!).slice().sort((a, b) => a - b));
      if (!estMid || (m <= estMid * 5 && m >= estMid / 5)) { pool = sameTitle; kind = 'edition'; }
    }
  }

  // 2 · same-form comps through the hard gates (curried: anchor derived once)
  if (pool.length === 0) {
    pool = sold.filter(comparableTo(lot));
    if (pool.length > 24) {
      // prefer recent sales and titles that share words with this lot —
      // overlap/date are scored ONCE per lot, not once per sort comparison
      // (normalizeTitle inside the comparator was the modal's other stall)
      const words = new Set(nt.split(' ').filter(w => w.length > 3));
      const overlap = (l: AuctionLot) => {
        const w = normalizeTitle(l.title).split(' ');
        let n = 0;
        for (const x of w) if (words.has(x)) n++;
        return n;
      };
      pool = pool
        .map(l => [overlap(l), new Date(l.saleDate).getTime(), l] as const)
        .sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]))
        .slice(0, 24)
        .map(s => s[2]);
    }
  }

  if (pool.length < 3) return null;

  // PRINT series availability (form path only): an anchor naming its series
  // ("…, from Jazz") whose pool holds <3 same-series sales abstains — the
  // measured abstained cohort read at err 0.587 vs 0.427 overall. The pool is
  // NOT hard-filtered to the series (measured worse: 0.345→0.388) — the
  // overlap scorer above already series-sorts.
  if (form === 'print' && kind === 'form') {
    const sa = seriesOf(lot.title);
    if (sa && pool.filter((c) => seriesOf(c.title) === sa).length < 3) return null;
  }

  // DESIGN set normalization (form path only — the edition path is same-title,
  // same set size by construction): a 'pair of' anchor read against singles
  // carried a +17% directional bias; per-unit normalize with the measured
  // sub-linear scale table, then re-scale to the anchor's own set size.
  const setNorm = kind === 'form' && FURNITURE.has(form);
  const anchorSet = setNorm ? setSizeOf(lot.title) : 1;
  const prices = pool
    .map(l => setNorm ? (l.priceUsd! / setScale(setSizeOf(l.title))) * setScale(anchorSet) : l.priceUsd!)
    .sort((a, b) => a - b);
  const med = median(prices);

  // dispersion guard: if the pool disagrees with itself, say nothing
  const q1 = prices[Math.floor(prices.length * 0.25)];
  const q3 = prices[Math.floor(prices.length * 0.75)];
  if (med > 0 && (q3 - q1) / med > 2.5) return null;

  // FORM-pool sanity (same ×5 band the edition path enforces): a same-form
  // pool whose median sits 5× outside the lot's own estimate band is nearly
  // always a collision of unrelated objects (a $145 lot "flagged" 60× below
  // market was the class); the edition path already carries this guard.
  if (kind === 'form' && med > 0 && (med > estMid * 5 || med < estMid / 5)) return null;

  // Confidence from the pool itself: what kind of comps, how many, how
  // tightly they agree (IQR/median), and how much the titles match — the
  // same exact work having sold repeatedly is the strongest evidence there is,
  // and a pool full of same-series titles (shared significant words) beats an
  // anonymous same-form pool.
  const spread = med > 0 ? (q3 - q1) / med : 99;
  const words = new Set(nt.split(' ').filter(w => w.length > 3));
  const titleKin = words.size === 0 ? 0 : pool.filter(l => {
    let hits = 0;
    for (const w of normalizeTitle(l.title).split(' ')) if (words.has(w)) hits++;
    return hits >= 2;
  }).length;
  let confidence: DeepSignal['confidence'] =
    kind === 'edition' ? 'very-high'
    : (pool.length >= 12 && spread <= 1.0) || (titleKin >= 6 && spread <= 1.5) ? 'high'
    : pool.length >= 6 && spread <= 1.8 ? 'medium'
    : 'low';

  // ── demotion hooks (ENGINE SPEC v2 §1.2) — measured, applied after the ladder ──
  const CONF_ORDER: DeepSignal['confidence'][] = ['low', 'medium', 'high', 'very-high'];
  const capConf = (cap: DeepSignal['confidence']) => {
    if (CONF_ORDER.indexOf(confidence) > CONF_ORDER.indexOf(cap)) confidence = cap;
  };
  const isWatchForm = WATCHES.has(form);
  const wkk = isWatchForm ? watchKeyKind(lot) : null;
  // H1 · model-name watch keys pool 2.4× looser than references → cap medium
  if (wkk === 'model-name') capConf('medium');
  // H2 · design: wood-mixed form pool → demote one notch (belowWin 67% vs 74%)
  if (kind === 'form' && FURNITURE.has(form)) {
    const anchorWood = woodOf(lot);
    if (anchorWood) {
      const diff = pool.filter((c) => { const w = woodOf(c); return w && w !== anchorWood; }).length / pool.length;
      if (diff > 0.34) {
        const i = CONF_ORDER.indexOf(confidence);
        if (i > 0) confidence = CONF_ORDER[i - 1];
      }
    }
  }
  // H3 · a category-reclassified anchor reads through healed but young data
  if ((lot as AuctionLot & { catReclass?: string }).catReclass === 'o2p') capConf('low');

  // ── flag eligibility (§1.3) — appraisal survives, flags don't ──
  let flagEligible = true;
  if ((lot as AuctionLot & { catReclass?: string }).catReclass === 'o2p') flagEligible = false;
  if (wkk === 'model-name') {
    const matA = coarseWatchMaterial(lot);
    const pure = matA ? pool.filter((c) => coarseWatchMaterial(c) === matA).length / pool.length : 0;
    if (pure < 0.8) flagEligible = false; // 39% Below-Market hold on this class
  }

  return { pool, med, kind, form, confidence, estMid, flagEligible };
}

/** set size named in a design title ("pair of", "set of six", "Two Early LCW
    Chairs") — 1 when unstated. */
const NUM_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, deux: 2, trois: 3, quatre: 4, six_fr: 6, huit: 8 };
function setSizeOf(title: string | null | undefined): number {
  const t = (title || '').toLowerCase();
  if (/\bpair of\b|\bpaire de\b/.test(t)) return 2;
  const m = t.match(/\b(?:set of|suite de|ensemble de)\s+(\w+)\b/);
  if (m) {
    const w = m[1];
    if (/^\d+$/.test(w)) return Math.min(24, parseInt(w, 10));
    if (NUM_WORDS[w]) return NUM_WORDS[w];
  }
  const lead = t.match(/^(two|three|four|five|six|seven|eight|ten|twelve)\b/);
  if (lead) return NUM_WORDS[lead[1]] || 1;
  return 1;
}
/** measured sub-linear set→price scale (linear /N over-corrects: +0.416) */
const SET_SCALE: Record<number, number> = { 1: 1, 2: 1.25, 4: 1.3, 6: 2.27, 8: 2.75 };
function setScale(n: number): number {
  if (SET_SCALE[n] != null) return SET_SCALE[n];
  return n > 1 ? Math.sqrt(n) : 1;
}

/** coarse wood token for design pools (Nakashima walnut ≠ rosewood pricing) */
function woodOf(l: Pick<AuctionLot, 'title' | 'medium'>): string | null {
  const m = `${l.title || ''} ${l.medium || ''}`.toLowerCase()
    .match(/\b(walnut|rosewood|teak|oak|maple|cherry|mahogany|pine|elm|ash|birch|cedar|ebony|laurel|redwood|hickory|persimmon|myrtle|buckeye|chestnut|sycamore)\b/);
  return m ? m[1] : null;
}

export function signalWithPool(lot: AuctionLot, allLots: AuctionLot[]): { signal: DeepSignal; pool: AuctionLot[] } | null {
  const read = compPoolRead(lot, allLots);
  if (!read) return null;
  if (!read.flagEligible) return null; // appraiseLot still values these; they never flag
  const { pool, med, kind, form, confidence, estMid } = read;
  const ratio = med / estMid;
  // 1.3 threshold (raised from 1.2): sold prices are premium-inclusive (~1.25×
  // hammer) while estimates are hammer-basis, so a pool trading exactly AT its
  // estimates reads ~1.25 — flags in the 1.2–1.3 band were pure buyer's premium,
  // not edge. Matches the validated engine threshold.
  if (ratio >= 1.3) return { signal: { label: 'Below Market', pct: Math.round((ratio - 1) * 100), basis: pool.length, med, kind, form, confidence }, pool };
  if (ratio <= 0.75) return { signal: { label: 'Above Market', pct: Math.round((1 - ratio) * 100), basis: pool.length, med, kind, form, confidence }, pool };
  return null;
}

/** lectr's APPRAISAL of a lot — the median its comparable pool currently
 *  trades at, through the exact same pools/guards as the card signal, but
 *  returned unconditionally (a lot trading in line with its comps still has a
 *  value). Estimate-less sports/science lots should go through soldCompBand
 *  instead; callers fall back accordingly. */
export function appraiseLot(lot: AuctionLot, allLots: AuctionLot[]): { value: number; n: number; kind: 'edition' | 'form'; confidence: DeepSignal['confidence'] } | null {
  const read = compPoolRead(lot, allLots);
  return read ? { value: read.med, n: read.pool.length, kind: read.kind, confidence: read.confidence } : null;
}

/** The magnitude token shown on a signal. A below-market gap of, say, +888%
 *  reads as broken; past 2× we reframe it as a clean multiple ("9.9× ask") so
 *  the flagship number stays coherent and authoritative. Above-market is
 *  bounded to <100% (comps can't be more than 100% under the ask). */
export function signalMagnitude(label: string, pct: number): string {
  // past 5× the ask the precise multiple stops being credible (extreme ratios
  // are where data faults live, and the measured beat-rate DROPS out there) —
  // print the honest floor instead of a broken-looking "60.8×"
  if (label === 'Below Market') {
    if (pct > 400) return '5×+';
    return pct > 100 ? `${(pct / 100 + 1).toFixed(1)}×` : `+${pct}%`;
  }
  return `−${Math.min(pct, 99)}%`;
}

/** THE ONE FLAGGED RANKING — calibrated odds first (the engine's measured
 *  beat-rate, which drops on extreme ratios where they under-deliver), then
 *  the gap capped at 400% so a data-fault +5976% can never outrank a clean
 *  2x flag with 70% measured odds. Every surface that ranks flagged lots
 *  (the /value list, the lander's gap lens) MUST use this. */
export function dealScore(lot: AuctionLot, signalPct: number): number {
  const br = (lot as { value?: { signal?: { beatRatePct?: number } | null } | null }).value?.signal?.beatRatePct ?? 50;
  return br * 1000 + Math.min(signalPct, 400);
}

export function computeDeepSignal(lot: AuctionLot, allLots: AuctionLot[]): DeepSignal | null {
  return signalWithPool(lot, allLots)?.signal ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════
   SPORTS / SCIENCE OBJECTS — the gated realized-comp layer (W2/W7)

   Goldin sold lots publish no estimates: the frozen estimate engine
   (classifyForm / signalWithPool / computeDeepSignal) never touches them and
   never will. This block is ADDITIVE and every entry point is gated on a
   SINGLE choke point — isSportsScienceObject — so it is unreachable for any
   art / design / watch / jewelry lot. It produces a DESCRIPTIVE realized band
   only: no directional label, no percent, never a call, never red/green.
   ══════════════════════════════════════════════════════════════════════════ */

/** The Goldin sports + science object slugs (carried as lot.artist). A lot is
    in this layer only when it is a category 'object' lot whose slug is here —
    watches (rolex/patek/…) and every art/design maker are provably excluded. */
export const SPORTS_SCIENCE_SLUGS = new Set<string>([
  'game-used', 'trophies-awards', 'tickets-passes',
  'space-exploration', 'meteorites', 'fossils', 'scientific-instruments',
]);

/** The sports subset of SPORTS_SCIENCE_SLUGS — these carry sportsForm Forms;
    the science slugs classify through the frozen classifyForm science forms. */
const SPORTS_SLUGS = new Set<string>(['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia']);

/** THE choke point. Every function below returns early / null unless this is
    true, so none of them can ever run on a non-sports/science-object lot. */
export function isSportsScienceObject(lot: Pick<AuctionLot, 'category' | 'artist'>): boolean {
  return lot.category === 'object' && SPORTS_SCIENCE_SLUGS.has(lot.artist);
}

/** The identity a sports/science OBJECT comps on — the axis where "same kind
    of object" becomes "same subject". Sports → the ATHLETE (playerSlug, build-
    stamped both sides). Science → the SUBJECT/SPECIMEN tag (entity: a named
    meteorite, a mission, an instrument line — science has no player, and
    gating it on playerSlug silenced the whole vertical's comp layer). Free-
    text entity compares case-insensitively. Null = no identity → the caller
    abstains rather than pool strangers. */
function objectIdentityKey(l: Pick<AuctionLot, 'artist' | 'entity'> & { playerSlug?: string | null }): string | null {
  if (SPORTS_SLUGS.has(l.artist)) return l.playerSlug || null;
  return l.entity ? l.entity.toLowerCase().trim() : null;
}

/** Strip crawl-leaked prefixes from a Goldin title: a leading internal
    "do not list…" note up to its first dash, and a leading date prefix
    ("Month DD, YYYY - " or "YYYY-YY - "). Pure; safe on any string. */
export function cleanGoldinTitle(raw: string): string {
  let s = (raw || '').trim();
  // leading internal note: "DO NOT LIST IN AUCTION - PER Wagner ... - <title>"
  if (/^do not list\b/i.test(s)) {
    const dash = s.indexOf('-');
    if (dash !== -1) s = s.slice(dash + 1).trim();
  }
  // leading date prefix: "January 5, 2024 - Title" (allow abbreviated months too)
  s = s.replace(/^[A-Za-z]{3,9}\.?\s+\d{1,2},\s+\d{4}\s*-\s*/, '');
  // leading season prefix: "2023-24 - Title" or "2023 - Title"
  s = s.replace(/^\d{4}(?:-\d{2,4})?\s*-\s*/, '');
  return s.trim();
}

/** The sports Form for a sports-slug object, else null. Returns null for every
    non-sports/science-object lot AND for the science slugs (which use the
    frozen classifyForm science forms). Keyword families mirror goldinRoute. */
export function sportsForm(lot: Pick<AuctionLot, 'category' | 'artist' | 'title'>): Form | null {
  if (lot.category !== 'object' || !SPORTS_SLUGS.has(lot.artist)) return null;
  const t = ` ${(lot.title || '').toLowerCase()} `;
  if (lot.artist === 'tickets-passes' || /\b(ticket|stub|full ticket|season pass|press pass|credential|all[- ]access)\b/.test(t)) return 'sports-ticket';
  if (lot.artist === 'trophies-awards' || /\b(trophy|championship ring|title belt|winners? medal|olympic medal|\bmedal\b|\bring\b|plaque|heisman|award)\b/.test(t)) return 'sports-trophy';
  // game-used gear, split by object noun
  if (/\bjersey|uniform|shirt|sweater|kit\b/.test(t)) return 'sports-jersey';
  if (/\bbat\b/.test(t)) return 'sports-bat';
  if (/\bball|puck\b/.test(t)) return 'sports-ball';
  if (/\bglove|mitt\b/.test(t)) return 'sports-glove';
  if (/\b(cleats?|boots?|helmet|cap\b|hat\b|pants|shorts|jacket|warm[- ]?up|worn)\b/.test(t)) return 'sports-worn';
  return 'sports-worn'; // a sports-slug object that matched no noun is still gear
}

/** Extract the short crawl tags used to tighten the comp pool. entity = the
    athlete/subject the title names; objectType = a coarse noun; eventKey +
    sportYear anchor a dated event (a World Series ticket). All optional. */
const OBJECT_TYPE_RULES: [RegExp, ObjectType][] = [
  [/\bjersey|uniform|shirt|sweater|kit\b/, 'jersey'],
  [/\b(sneakers?|shoes?|cleats?|boots?)\b/, 'sneakers'],
  [/\bbat\b/, 'bat'],
  [/\bpuck\b/, 'puck'],
  // helmet/cap/pants MUST outrank ball ('football helmet' is a helmet), and
  // the ball rule must catch the compounds — 183/707 sold 'other' rows were
  // baseballs/basketballs/footballs the bare \bball\b boundary missed.
  [/\b(glove|mitt)\b/, 'glove'],
  [/\bhelmet\b/, 'helmet'],
  [/\b(cap\b|hat\b)/, 'cap'],
  [/\b(baseball|basketball|football|volleyball|soccer ball|ball)s?\b/, 'ball'],
  [/\b(pants|shorts|trousers)\b/, 'pants'],
  [/\b(belt|championship belt)\b/, 'belt'],
  [/\b(ring|pendant)\b/, 'ring'],
  [/\b(ticket|stub|pass|credential)\b/, 'ticket'],
  [/\b(trophy|award|medal|plaque)\b/, 'trophy'],
];
const EVENT_RULES: [RegExp, string][] = [
  [/\bworld series\b/, 'world-series'],
  [/\bsuper ?bowl\b/, 'super-bowl'],
  [/\bworld cup\b/, 'world-cup'],
  [/\bolympics?|olympic\b/, 'olympics'],
  [/\bnba finals?\b/, 'nba-finals'],
  [/\bstanley cup\b/, 'stanley-cup'],
  [/\ball[- ]star\b/, 'all-star'],
  [/\bmasters\b/, 'masters'],
];
export function extractSportsTags(title: string, slug: string): {
  entity?: string; objectType?: ObjectType; eventKey?: string; sportYear?: number;
} {
  const out: { entity?: string; objectType?: ObjectType; eventKey?: string; sportYear?: number } = {};
  const raw = title || '';
  const t = raw.toLowerCase();

  // entity: the leading proper-noun run of the title (an athlete/subject name),
  // 2–3 capitalized words before the first descriptor/comma/paren.
  const nameMatch = raw.match(/^((?:[A-Z][A-Za-z.'’-]+\s+){1,2}[A-Z][A-Za-z.'’-]+)/);
  if (nameMatch) {
    const name = nameMatch[1].trim();
    // reject a leading year/all-caps token run that isn't a person
    if (!/^\d/.test(name) && name.split(/\s+/).length >= 2) out.entity = name;
  }

  for (const [re, ty] of OBJECT_TYPE_RULES) if (re.test(t)) { out.objectType = ty; break; }
  if (!out.objectType) {
    out.objectType = slug === 'tickets-passes' ? 'ticket'
      : slug === 'trophies-awards' ? 'trophy' : 'other';
  }

  for (const [re, key] of EVENT_RULES) if (re.test(t)) { out.eventKey = key; break; }

  const yr = t.match(/\b(19\d{2}|20\d{2})\b/);
  if (yr) out.sportYear = parseInt(yr[1], 10);

  return out;
}

/** The form key a sports/science object comps ON: its sportsForm when it's a
    sports slug, else the frozen classifyForm (science slugs). */
/** the stamped objectType, else derived from the title via OBJECT_TYPE_RULES */
function objTypeOf(l: AuctionLot): ObjectType | null {
  if (l.objectType) return l.objectType;
  const t = ` ${cleanGoldinTitle(l.title || '').toLowerCase()} `;
  for (const [re, ty] of OBJECT_TYPE_RULES) if (re.test(t)) return ty;
  return null;
}

function compFormKey(lot: AuctionLot): Form {
  return sportsForm(lot) ?? classifyForm(lot);
}

/** W7 — the gated realized-comp band. Returns null for EVERY non-sports/
    science-object lot (single choke point). Pool = same-slug sold lots that
    share the comp form key, tightened by entity / eventKey+sportYear overlap
    using the SAME overlap scorer signalWithPool uses. Same >=3 floor and same
    (q3-q1)/median>2.5 dispersion guard as the frozen engine. Descriptive only:
    { form, pool, median, low, high, n, confidence } — no label, no pct. */
export function soldCompBand(lot: AuctionLot, allLots: AuctionLot[]): SoldComp | null {
  if (!isSportsScienceObject(lot)) return null;
  const form = compFormKey(lot);
  if (form === 'unknown') return null;

  // Hard same-IDENTITY gate. These lots share one artist-slug per CATEGORY
  // ('game-used', 'meteorites'), so a same-artist/same-form pool is every
  // athlete's jersey / every specimen's rock. The band is honest ONLY for the
  // same identity — the athlete (playerSlug) for sports objects, the subject/
  // specimen tag (entity) for science objects (a meteorite has no player).
  // No identity on the anchor → abstain (the UI shows no band — never a
  // stranger's). The entity/word tightening below stays a SECONDARY sort.
  const bandIdKey = objectIdentityKey(lot);
  if (!bandIdKey) return null;

  // GAME-USED item gate: objectType EQUALITY replaces the coarse form key —
  // sportsForm's 'sports-worn' lumps pants/sneakers/helmet/cap into one
  // bucket; objectType coverage is 100% on sold rows. Measured trade: −3pp
  // band coverage for err.med 0.395→0.359 (take the accuracy).
  const anchorObjType = lot.artist === 'game-used' ? objTypeOf(lot) : null;
  if (lot.artist === 'game-used' && !anchorObjType) return null;

  // same-slug sold, same comp form key (game-used: same OBJECT TYPE), SAME IDENTITY
  const same = allLots.filter(l =>
    l.artist === lot.artist && l.status === 'sold' && l.priceUsd && l.id !== lot.id &&
    isSportsScienceObject(l) &&
    (anchorObjType ? objTypeOf(l) === anchorObjType : compFormKey(l) === form) &&
    objectIdentityKey(l) === bandIdKey
  );
  if (same.length < 3) return null;

  // tighten by entity / event overlap — reuse the exact scorer shape from
  // signalWithPool (significant title words + tag matches), scored ONCE per lot.
  const nt = normalizeTitle(cleanGoldinTitle(lot.title));
  const words = new Set(nt.split(' ').filter(w => w.length > 3));
  const anchorEntity = lot.entity ? lot.entity.toLowerCase() : null;
  const anchorEvent = lot.eventKey ?? null;
  const anchorYear = lot.sportYear ?? null;
  const score = (l: AuctionLot) => {
    let s = 0;
    const w = normalizeTitle(cleanGoldinTitle(l.title)).split(' ');
    for (const x of w) if (words.has(x)) s++;
    if (anchorEntity && l.entity && l.entity.toLowerCase() === anchorEntity) s += 3;
    if (anchorEvent && l.eventKey === anchorEvent) s += 2;
    if (anchorYear && l.sportYear === anchorYear) s += 1;
    return s;
  };

  // if a tight sub-pool (any tag/word overlap) clears the floor, prefer it;
  // else fall back to the whole same-form pool (still honest, wider band).
  let pool = same;
  const overlapping = same.filter(l => score(l) > 0);
  if (overlapping.length >= 3) {
    pool = overlapping
      .map(l => [score(l), new Date(l.saleDate).getTime(), l] as const)
      .sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]))
      .slice(0, 24)
      .map(s => s[2]);
  } else if (pool.length > 24) {
    pool = pool
      .map(l => [new Date(l.saleDate).getTime(), l] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 24)
      .map(s => s[1]);
  }
  if (pool.length < 3) return null;

  const prices = pool.map(l => l.priceUsd!).sort((a, b) => a - b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length * 0.25)];
  const q3 = prices[Math.floor(prices.length * 0.75)];
  // dispersion guard — same shape as the frozen engine
  if (med > 0 && (q3 - q1) / med > 2.5) return null;

  const iqrRatio = med > 0 ? (q3 - q1) / med : 99;
  const confidence: SoldComp['confidence'] =
    pool.length >= 8 && iqrRatio <= 1.0 ? 'high'
    : pool.length >= 4 ? 'medium'
    : 'low';

  return { form, pool, median: med, low: prices[0], high: prices[prices.length - 1], n: pool.length, confidence };
}

/* ══════════════════════════════════════════════════════════════════════════
   REFERENCE BANDS (ENGINE SPEC v2 §2.5/§2.6) — the looser tiers for the
   verticals whose objects rarely repeat. Both are ADDITIVE and STRUCTURALLY
   unable to flag: neither is called from compPoolRead / signalWithPool /
   dealScore / any value list; they return a descriptive RANGE labeled
   'reference', confidence pinned 'low'. Abstain > wrong still governs —
   no identity, no band.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ReferenceBand {
  kind: 'reference' | 'edition-like';
  confidence: 'low';
  med: number;
  q1: number;
  q3: number;
  n: number;
}

// ── science identities (curated, from the measured reference tier) ──
const SCI_METEORITE_NAMES = /\b(nwa ?\d+|sikhote[- ]alin|seymchan|campo del cielo|gujba|willamette|admire|dronino|muonionalusta|canyon diablo|gibeon|esquel|imilac|fukang|allende|murchison|chelyabinsk|aletai|tamentit|brenham|odessa|nantan|toluca|henbury|chinga|zagami|tissint|erg chech|aguas zarcas|tisserlitine)\b/;
const SCI_METEORITE_TYPES = /\b(pallasite|mesosiderite|octahedrite|ataxite|hexahedrite|chondrite|achondrite|shergottite|lunar|moon rock|slice of the moon|martian|mars rock)\b/;
const SCI_FOSSIL_GENERA = /\b(ammonite|trilobite|megalodon|mammoth|mosasaur|tyrannosaurus|t[.\- ]rex|triceratops|ichthyosaur|plesiosaur|pterosaur|pteranodon|sabre[- ]tooth|saber[- ]tooth|allosaurus|diplodocus|stegosaurus|velociraptor|raptor|edmontosaurus|spinosaurus|cave bear|woolly rhino|crinoid|sea lily|stromatolite|coprolite|orthoceras|keichousaurus|shark tooth|dinosaur egg|amber)\b/;
const SCI_INSTRUMENT_TYPES = /\b(telescope|microscope|astrolabe|sextant|octant|orrery|armillary|barometer|theodolite|sundial|globe|slide rule|chronometer|compass|calculator|typewriter|enigma|computer|camera)\b/;
const SCI_SPACE_MISSIONS = /\b(apollo[- ]?(?:\d{1,2}|[ivx]{1,4})|apollo|gemini[- ]?\d{0,2}|mercury|soyuz|skylab|sputnik|vostok|space shuttle|shuttle|sts-\d+|iss|mir)\b/;
const SCI_ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16', xvii: '17' };
const SCI_SLUG_FORMS: Record<string, Set<Form>> = {
  meteorites: new Set<Form>(['meteorite']),
  fossils: new Set<Form>(['fossil']),
  'scientific-instruments': new Set<Form>(['instrument', 'tech']),
  'space-exploration': new Set<Form>(['space']),
};
// artist-dated parenthetical = a leaked art lot riding a science slug
const SCI_ART_PARENS = /\([^)]*\b(1[4-9]\d{2}|20[0-2]\d)\b[^)]*\)/;
const SCI_SPACE_NOUN = /\b(nasa|flown|lunar|astronaut|cosmonaut|spacecraft|space[- ]?flight|mission|module|orbit|capsule|rocket|launch|crew|emblem|patch|beta cloth|kapton|checklist|flight plan)\b/i;
const SCI_MISSION_NUM = /\b(apollo|gemini|soyuz|sts)[- ]?(\d{1,2}|[ivx]{1,4})\b/i;

function sciLeakedArt(l: Pick<AuctionLot, 'title' | 'artist'>): boolean {
  const t = l.title || '';
  if (SCI_ART_PARENS.test(t)) return true;
  if (l.artist === 'fossils' && /\b(photograph|panoramic|panorama)\b/i.test(t)) return true;
  return false;
}
function sciTitleIdentity(l: Pick<AuctionLot, 'title' | 'artist'>): string | null {
  const t = ` ${(l.title || '').toLowerCase()} `;
  let m: RegExpMatchArray | null;
  switch (l.artist) {
    case 'meteorites':
      if ((m = t.match(SCI_METEORITE_NAMES))) return 'name:' + m[1].replace(/[- ]/g, '');
      if ((m = t.match(SCI_METEORITE_TYPES))) return 'type:' + (/lunar|moon/.test(m[1]) ? 'lunar' : /martian|mars/.test(m[1]) ? 'martian' : m[1]);
      return null;
    case 'fossils':
      if ((m = t.match(SCI_FOSSIL_GENERA))) return 'genus:' + m[1].replace(/[.\- ]/g, '');
      return null;
    case 'scientific-instruments':
      if ((m = t.match(SCI_INSTRUMENT_TYPES))) return 'inst:' + m[1];
      return null;
    case 'space-exploration': {
      if ((m = t.match(SCI_SPACE_MISSIONS))) {
        let id = m[1].replace(/[- ]/g, '');
        const r = id.match(/^apollo([ivx]+)$/);
        if (r && SCI_ROMAN[r[1]]) id = 'apollo' + SCI_ROMAN[r[1]];
        return 'mission:' + id;
      }
      return null;
    }
  }
  return null;
}

/** Science reference band — same slug + canonical form + (entity OR curated
 *  title identity), fossils get a ≥3-word-overlap fallback when the anchor
 *  has no identity. Measured: coverage 5.0%→38.5% (7.6×), med|err| 50–55%,
 *  worst residual capped ~1,234% (from 227,281% naive). */
export function scienceReferenceBand(lot: AuctionLot, allLots: AuctionLot[]): ReferenceBand | null {
  if (!isSportsScienceObject(lot)) return null;
  const forms = SCI_SLUG_FORMS[lot.artist];
  if (!forms) return null;
  const form = formOf(lot);
  if (!forms.has(form)) return null;
  if (sciLeakedArt(lot)) return null;
  const title = lot.title || '';
  if (lot.artist === 'space-exploration') {
    if (!(SCI_MISSION_NUM.test(title) || SCI_SPACE_NOUN.test(title))) return null; // bare 'apollo' is an old master
    const sig = new Set(normalizeTitle(title).split(' ').filter(w => w.length > 3));
    if (sig.size < 3 && !lot.entity) return null; // '[Apollo 11]' carries no information
  }
  const ent = lot.entity ? lot.entity.toLowerCase().trim() : null;
  const tid = sciTitleIdentity(lot);
  const words = new Set(normalizeTitle(title).split(' ').filter(w => w.length > 3));
  const scored: [number, AuctionLot][] = [];
  for (const l of allLots) {
    if (l.id === lot.id || l.artist !== lot.artist || l.status !== 'sold' || !l.priceUsd) continue;
    if (!forms.has(formOf(l)) || sciLeakedArt(l)) continue;
    let idHit = false, sc = 0;
    if (ent && l.entity && l.entity.toLowerCase().trim() === ent) { idHit = true; sc += 3; }
    const lid = sciTitleIdentity(l);
    if (tid && lid && lid === tid) { idHit = true; sc += 3; }
    let ov = 0;
    for (const w of normalizeTitle(l.title).split(' ')) if (words.has(w)) ov++;
    sc += ov;
    // fossils ONLY: word-overlap admission when the anchor carries no identity
    const fossilFallback = lot.artist === 'fossils' && !tid && !ent && ov >= 3;
    if (idHit || fossilFallback) scored.push([sc, l]);
  }
  if (scored.length < 3) return null;
  const pool = scored
    .sort((a, b) => (b[0] - a[0]) || (new Date(b[1].saleDate).getTime() - new Date(a[1].saleDate).getTime()))
    .slice(0, 24)
    .map(x => x[1]);
  const prices = pool.map(l => l.priceUsd!).sort((a, b) => a - b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length * 0.25)];
  const q3 = prices[Math.floor(prices.length * 0.75)];
  if (med > 0 && (q3 - q1) / med > 2.5) return null;
  const est = estUsdBand(lot);
  const em = est.low && est.high ? (est.low + est.high) / 2 : null;
  if (em && (med > em * 5 || med < em / 5)) return null;
  return { kind: 'reference', confidence: 'low', med, q1, q3, n: pool.length };
}

/** Culture reference band — Goldin edition-like tier (same normalized title,
 *  ≥5 distinctive tokens) else the subject×itemClass reference tier from the
 *  crawl-stamped axes. Measured: Goldin edition-like 0.25 med|err| / 85.2%
 *  within 2×; strict itemClass gate (loose degrades within-2× 72.3→66.5%). */
export function cultureReferenceBand(lot: AuctionLot, allLots: AuctionLot[]): ReferenceBand | null {
  if (!CULTURE_SLUGS_ENGINE.has(lot.artist)) return null;
  const sold = allLots.filter(l =>
    l.id !== lot.id && CULTURE_SLUGS_ENGINE.has(l.artist) && l.status === 'sold' && l.priceUsd
    && (l as AuctionLot & { source?: string }).source !== 'sothebys-algolia');
  const nt = normalizeTitle(cleanGoldinTitle(lot.title || ''));
  const bandOf = (pool: AuctionLot[], kind: ReferenceBand['kind']): ReferenceBand | null => {
    if (pool.length < 3) return null;
    const prices = pool.map(l => l.priceUsd!).sort((a, b) => a - b);
    const med = median(prices);
    const q1 = prices[Math.floor(prices.length * 0.25)];
    const q3 = prices[Math.floor(prices.length * 0.75)];
    if (med > 0 && (q3 - q1) / med > 2.5) return null;
    const est = estUsdBand(lot);
    const em = est.low && est.high ? (est.low + est.high) / 2 : null;
    if (em && (med > em * 5 || med < em / 5)) return null;
    return { kind, confidence: 'low', med, q1, q3, n: pool.length };
  };
  // TIER E — GOLDIN ONLY (measured to FAIL at Christie's: 0.60/47.3%)
  const house = (lot.auctionHouse || '').toLowerCase();
  const distinctive = nt.split(' ').filter(w => w.length >= 3).length;
  if (house === 'goldin' && distinctive >= 5) {
    const same = sold.filter(l => normalizeTitle(cleanGoldinTitle(l.title || '')) === nt);
    const b = bandOf(same, 'edition-like');
    if (b) return b;
  }
  // TIER R — subjects × STRICT itemClass from the crawl-stamped axes
  const subjects = (lot as AuctionLot & { subjectKeys?: string[] }).subjectKeys || [];
  const cls = (lot as AuctionLot & { itemClass?: string }).itemClass || null;
  if (!subjects.length || !cls) return null; // no identity → abstain, never stranger pools
  const subjSet = new Set(subjects);
  let pool = sold.filter(l => {
    const ls = (l as AuctionLot & { subjectKeys?: string[] }).subjectKeys || [];
    const lc = (l as AuctionLot & { itemClass?: string }).itemClass || null;
    return lc === cls && ls.some(x => subjSet.has(x));
  });
  if (cls === 'other' && pool.length < 6) return null; // weakest cohort needs more
  if (pool.length > 24) {
    const words = new Set(nt.split(' ').filter(w => w.length > 3));
    pool = pool
      .map(l => {
        let ov = 0;
        for (const w of normalizeTitle(cleanGoldinTitle(l.title || '')).split(' ')) if (words.has(w)) ov++;
        return [ov, new Date(l.saleDate).getTime(), l] as const;
      })
      .sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]))
      .slice(0, 24)
      .map(x => x[2]);
  }
  return bandOf(pool, 'reference');
}
