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
// THE order statistics (stats.ts): one lerp quantile + one median shared with
// the engine band/backtest. Imported from stats (not value) so value.ts can
// import the shape gate below without a module cycle.
import { quantileSorted as quantile, medianSorted } from './stats';
import { readWatchKey, refSuffixMaterial } from './watch-ref';
import { scoreComparable } from './comp-score';
import { marketOf } from '../constants';

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

/** (wave 5) a print or painting MEDIUM on the medium line (the book-word guard) */
const ART_MEDIUM_RE = /\b(lithograph|screenprint|screen print|silkscreen|serigraph|etching|aquatint|woodcut|linocut|engraving|drypoint|pochoir|oil|acrylic|magna|gouache|watercolou?r|pastel|charcoal|crayon|graphite|pencil|ink|marker|tempera|enamel)\b/;

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
  // (wave 5) …but "book" is also a subject and a support: a painting of a book
  // ("Still Life with Oysters, Fish in a Bowl and Book, oil and magna on
  // canvas"), a drawing on one ("oil pastel on the frontispiece of a book"), a
  // lithograph "from the Book Covers series" — a print / painting medium or a
  // "from … series" title is the lot's form, not the book
  const bookWordOnly = /\bbook\b/.test(tm) && !/\b(catalogue|catalog|magazine|monograph)\b/.test(tm);
  // (a medium line that IS a book — "book with 20 pochoir plates", "offset
  // lithograph in bound book" — stays one; a book as the support — "acrylic on
  // book cover", "drawing on the half title page of Warhol's book" — does not)
  const bookObjectMedium = /\bbook\b/.test(m) && !/\b(?:on|inside)\b[^.;,]{0,30}\bbook\b|\bof (?:a|the|his|her|warhol's)\b[^.;,]{0,20}\bbook\b/.test(m);
  const notABook = bookWordOnly && !bookObjectMedium && (ART_MEDIUM_RE.test(m) || /\bfrom\b[^.;]{0,60}\bseries\b/.test(t));
  if (!notABook && /\b(book|catalogue|catalog|magazine|monograph)\b/.test(tm)) return 'book';
  if (/\b(invitation|announcement|flyer|ticket|postcard|greeting card|record sleeve|album cover|vinyl record|mailer)\b/.test(tm)) return 'ephemera';
  if (/\b(poster|affiche)\b/.test(tm)) return 'poster';

  // photographs (their own category, plus photographic mediums elsewhere)
  // (wave 5) a Feldman & Schellmann number is a screenprint's citation, never a
  // photograph's (Sotheby's filed Warhol's "Shoes (F. & S. II.251)" there)
  const fsRef = /\bf\.?\s*&\s*s\.?\s*(?:[ivx]+|\d)|\bfeldman\s*(?:&|and)\s*schellmann\b/.test(tm);
  if ((lot.category === 'photograph' && !fsRef) || /\b(gelatin silver|c-print|chromogenic|polaroid|cibachrome|photograph)\b/.test(m)) return 'photograph';

  if (/\b(rug|tapestry|carpet|textile|blanket|scarf)\b/.test(tm)) return 'textile';

  // editioned objects & multiples (KAWS companions, decks, plates, plush…)
  // (never for watches/science 'object' lots or furniture: a "cushion-shaped
  // wristwatch" and a Nakashima "Conoid Cushion" chair are not editions)
  if (lot.category !== 'object' && lot.category !== 'design'
    && /\b(skateboard|skate deck|deck set|companion|be@rbrick|bearbrick|vinyl figure|plush|figure set|ceramic (container|set|plate)|perfume|snow ?globe|keychain|ornament|chess set|cushion|pillow|dish set)\b/.test(tm)) return 'object-edition';

  // The watches & science verticals: their lots arrive as category 'object'
  // (never art/design), so these checks can't hijack a Nakashima "fossilized
  // walnut" table or a KAWS "Companion" into science forms — and vice versa.
  if (lot.category === 'object') {
    // horology & jewelry
    // watch ACCESSORIES are not watches (stands, winders, boxes, ashtrays)
    if (/watch[- ]?(?:stands?|winders?|winding box|box(?:es)?|straps?|chains?)\b|\bashtray\b/.test(tm) && !/wrist ?watch/.test(tm)) return 'unknown';
    // pocket watches: the explicit noun, or the case/movement words only a
    // pocket watch carries (open face, keyless, hunter, verge, fusee …) when
    // nothing says wrist. No trailing \b — Sotheby's glues the next field on
    // ("openface keyless watchref 866").
    // (wave 5) + the lapel / purse / fob / pendant watches and a watch "with
    // chain" (Cartier's "lapel-watch", "pendant-watch" sat in wristwatches)
    if (/\bpocket ?watch/.test(tm) || (!/wrist/.test(tm) && /\b(?:open[- ]?face|keyless|hunt(?:er|ing)[- ]?cased?|half[- ]hunter|demi[- ]hunter|savonnette|l[ée]pine|key[- ]wound|verge|fus[ée]e|pair[- ]cased|(?:pendant|lapel|purse|fob)[- ]watch|watch(?:es)?,? with (?:its |a |an |the |original |associated )?(?:\w+ )?(?:gold |silver |platinum )?chain)/.test(tm))) return 'pocket-watch';
    // Explicit jewelry nouns first (a Panthère brooch is jewelry even though
    // Panthère is also a watch line). SINGULAR forms — unchanged from before.
    // …unless the lot is a watch set in it ("bangle watch", "ring clip watch",
    // "wristwatch … and 'Nautilus' cufflinks")
    if (/\b(ring|necklace|brooch|earrings?|pendant|bangle|choker|cufflinks)\b/.test(t) && !/watch|\bmontre\b/.test(tm)) return 'jewelry';
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
    if (/wrist ?watch|\bmontre\b/.test(tm)
      || (/watch/.test(tm) && /\b(chronograph|chronometer|automatic|quartz|manual wind|movement|dial|bezel|calibre|caliber|tourbillon|perpetual calendar|bracelet|gold|steel|lady'?s|gentleman)\b/.test(tm))
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
    // (wave 5) a "table lamp" / "desk lamp" is lighting: the light test runs
    // before the table / desk ones (no trailing \b — Bonhams glues the date
    // on: "Table Lamp1966walnut"); a "lamp table" stays a table
    if (/\b(lamps?|sconces?|chandeliers?|lighting|light fixture|lanterns?)(?![a-z])(?!\s*tables?\b)/.test(t)) return 'lighting';
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

const DIMS_CACHE = new Map<string, [number, number] | null>();
/** cached per dimensions string (the comparableTo size gate re-parses every
    candidate per anchor). Callers must not mutate the returned pair. */
export function parseDims(dims: string | null | undefined): [number, number] | null {
  if (!dims) return null;
  const hit = DIMS_CACHE.get(dims);
  if (hit !== undefined) return hit;
  const out = parseDimsUncached(dims);
  if (DIMS_CACHE.size > 200_000) DIMS_CACHE.clear();
  DIMS_CACHE.set(dims, out);
  return out;
}
function parseDimsUncached(dims: string): [number, number] | null {
  let str = dims;
  const sheet = dims.match(/[IS]\.\s*(.+?)(?:\(|[IS]\.|$)/);
  if (sheet) str = sheet[1].trim();
  // word-boundary: bare includes('in') fired on 'included'/'in.' suffixes of
  // cm-first strings and mis-scaled dims 2.54× (area gates then reject true comps)
  // The LEADING measurement's unit wins (Oct 10 2026): the unit token may sit
  // flush on the number ("48 x 41in. (122 x 104cm.)" — `\bin` never matched
  // after a digit, so the cm parenthetical rescaled a 122cm Bacon to 48cm
  // and 35cm heads cleared the 2.5× area gate), and a cm-first string with
  // an inch parenthetical ("122 x 104 cm (48 x 41 in.)") is centimetres.
  const low = str.toLowerCase();
  const inAt = low.search(/(?<=[\d\s.)])(?:in|inch|inches)\b|"/);
  const cmAt = low.search(/(?<=[\d\s.])cm\b/);
  const isCm = cmAt >= 0 && (inAt < 0 || cmAt < inAt);
  const tokens = str.split(/\s*(?:[x×]|\bby\b)\s*/i).map(s => s.trim());
  if (tokens.length < 2) return null;
  const h = parseFrac(tokens[0]);
  const w = parseFrac(tokens[1]);
  if (!h || !w) return null;
  if (isCm) return [h / 2.54, w / 2.54];
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
// model-line vocabulary for classifyForm's wristwatch test (the KEY reader
// lives in watch-ref.ts, word-bounded + brand-scoped)
const WATCH_MODELS = /(submariner|daytona|datejust|day[- ]date|gmt[- ]master(?:\s*ii)?|explorer(?:\s*ii)?|sea[- ]dweller|yacht[- ]master|milgauss|air[- ]king|oyster perpetual|cellini|nautilus|aquanaut|calatrava|ellipse|gondolo|twenty[~-]?4|world time|royal oak(?: offshore)?|millenary|jules audemars|speedmaster|seamaster|constellation|de ville|railmaster|tank|santos|panth[eè]re|ballon bleu|pasha|crash|baignoire|tortue|reverso|memovox|polaris|navitimer|superocean|chronomat|monaco|carrera|autavia|el primero|defy|portugieser|portofino|ingenieur|aquatimer|luminor|radiomir|overseas|patrimony|fifty ?fathoms|villeret)/;

export function watchKey(lot: Pick<AuctionLot, 'title'> & { artist?: string }): string | null {
  // (Sep 28 2026) one reader, app/lib/watch-ref.ts: a labelled ref in any
  // printed form ("Ref.", "Ref:", "Réf.", "Reference No."), else the model
  // line — word-bounded, accent-folded, brand-scoped for the tracked makers.
  return readWatchKey(lot.title, lot.artist)?.key ?? null;
}

/** How the watch key was derived — an explicit REFERENCE number is a tight
    cohort; a bare model-line NAME ("daytona") pools decades and materials.
    Measured: ref-keyed pools IQR/med 0.53 vs model-name 1.27 (2.4× looser),
    so model-name keys cap confidence at 'medium' (H1) and cannot flag without
    a material-pure pool (§1.3). */
export function watchKeyKind(lot: Pick<AuctionLot, 'title'> & { artist?: string }): 'ref' | 'model-name' | null {
  return readWatchKey(lot.title, lot.artist)?.kind ?? null;
}

/** Coarse watch CASE material from title+medium — the ONE material reader
    (identity.watchMaterialCoarse delegates here; Oct 6 2026). Gold shades
    deliberately collapse (fine split measured no better: 0.305 vs 0.303).
    Dial/hand descriptions are not the case: "yellow gold wristwatch with
    two-tone dial" is gold, "gold … blued steel hands" is gold (427 lots read
    two-tone off the dial). When the text names no metal, a Patek/AP
    reference suffix does (5970J, 15202ST — watch-ref.refSuffixMaterial). */
const WATCH_DIAL_PHRASE = /\btwo[- ]?(?:tone|colou?r(?:ed)?)\s+(?:[a-z'-]+\s+){0,2}?dial\b|\b(?:gold(?:en)?|gilt)(?:[- ]plated)?\s+(?:dial|hands|numerals|markers|indexes|indices|batons|hour markers)\b|\b(?:blued? )?steel (?:[a-z'-]+ )?hands\b/g;
export function coarseWatchMaterial(lot: Pick<AuctionLot, 'title' | 'medium'> & { artist?: string }): string | null {
  const t = `${(lot.title || '')} ${(lot.medium || '')}`.toLowerCase().replace(WATCH_DIAL_PHRASE, ' ');
  const gold = /\b(gold|or jaune|or gris|or rose|or blanc)\b|\b18k\b|\b14k\b|\b18ct\b|\b9ct\b/.test(t);
  const steel = /\b(steel|stainless|acier)\b/.test(t);
  if ((gold && steel) || /two[- ]tone/.test(t)) return 'two-tone';
  if (/platinum|platine/.test(t)) return 'platinum';
  if (gold) return 'gold';
  if (steel) return 'steel';
  if (/titanium/.test(t)) return 'titanium';
  return refSuffixMaterial(lot.title, lot.artist);
}

/* ── WATCH VARIANT CLASSES (Oct 6 2026) — ONE source (moved from
   scripts/emit-value-book.ts) for any pool that must not mix variants. A
   numeric reference pools steel with gold, gem-set with plain, a Tiffany-signed
   or Paul Newman dial with the catalogue one — Rolex 124300, 126610LN and
   Omega 3590 read 1.5–3× market in the value book off such pools.
   MEASURED for the engine's watch comp pools (Oct 6, engine-ab holdout, test
   year from Oct 1 2025, 891 watch estimate lots): every target-aware port —
   variant + material split with abstention, without abstention, plain-lot
   only, no material split — made the engine WORSE (watches medErr 22.1% →
   22.4–22.5%, ±30% 62.7% → 62.0–62.1%, Flags edge 31.1 → 29.4–30.4pt; on the
   ~280 changed lots edge 29.5 → 19.5–23.0pt). The estimate-lot value is
   anchored on the house estimate, which already prices the variant; the comp
   pool's job there is the reference's market level, which the variant sales
   carry too. Not wired into the engine. */

/** A slash-joined PAIR of full references ("5513/5517", "5512/5513") is a
 *  dual-stamped case (British military Submariners, transitional cases) — not
 *  one tradable reference. eBay text uses the same pair for homages, parts
 *  and "fits 5513/5517" straps, so a pair key prices the wrong thing at
 *  $100K+. A slash SUFFIX ("5711/1a", "3700/031", "5723/112r") is part of the
 *  reference and stays. Accepts a `maker|ref` key or a bare ref. */
export function isDualWatchRef(key: string): boolean {
  const ref = key.slice(key.indexOf('|') + 1);
  return /^\d{4,6}[a-z]{0,3}\/\d{4,6}[a-z]{0,3}$/.test(ref);
}
// gem-set cases/dials/bezels — "sapphire crystal" and "21 rubies/jewels"
// (movement jewels) are standard spec, not gems
const WATCH_NOT_GEM_RE = /\bsapphire[\s-]+(?:crystal|glass|case\s*-?\s*back|caseback|back)\b|\b\d{1,2}\s*(?:rubies|jewels)\b/gi;
const WATCH_GEM_RE = /\b(?:diamonds?|diamond[- ]set|brilliants?|brilliant[- ]cut|gem[- ]?set|gem-?stones?|pav[eé]|baguettes?|sapphires?|rubies|ruby[- ]set|emeralds?|tsavorites?|rainbow|bejewell?ed|jewell?ed\s+(?:bezel|dial|case)|set with)\b/gi;
// rare/special dials, special series and provenance that price far off the
// plain reference (Milsub, Comex, Tiffany-signed, engraved presentation…)
const WATCH_SPECIAL_RE = /\b(?:lacquer(?:ed)?(?: \w+)? dial|(?:green|yellow|pink|candy pink|red) dial|turquoise|tiffany|coral|celebration|bubbles? dial|stella|enamel(?:led)?|cloisonn[eé]|meteorite|mother[- ]of[- ]pearl|lapis|malachite|onyx|aventurine|opal|jade|tiger'?s?[- ]eye|tropical|paul newman|explorer dial|gilt dial|underline|exclamation|double red|red submariner|comex|military|milsub|royal navy|secret service|engraved|engraving|presentation|unique|prototype|one[- ]off|pi[eè]ce unique|retailed by|limited edition|limited series|anniversary|special edition|khanjar|crest dial|logo dial)\b/gi;
const markerToken = (m: string, kind: 'gem' | 'sp') =>
  `${kind}:${m.toLowerCase().replace(/[^a-z]+/g, '-').replace(/s$/, '')}`;

export interface WatchSaleClass {
  /** variant markers the sale's text carries ('gem:diamond', 'sp:tiffany',
   *  'sp:paul-newman' …) — empty for a plain example of the reference */
  markers: string[];
  /** coarse case material (null = not stated) */
  mat: string | null;
}
export function watchSaleClass(l: Pick<AuctionLot, 'title' | 'medium'>): WatchSaleClass {
  const text = `${l.title || ''} ${l.medium || ''}`;
  const gems = text.replace(WATCH_NOT_GEM_RE, ' ').match(WATCH_GEM_RE) || [];
  const sps = text.match(WATCH_SPECIAL_RE) || [];
  const markers = Array.from(new Set([...gems.map(m => markerToken(m, 'gem')), ...sps.map(m => markerToken(m, 'sp'))])).sort();
  return { markers, mat: coarseWatchMaterial(l) };
}

/** A watch reference row/pool needs n ≥ 5 single-variant sales. */
export const WATCH_MIN_N = 5;
/** Material purity for a watch pool, over sales whose material is stated. */
export const WATCH_MATERIAL_DOMINANCE = 0.8;

/** Markers most of a pool carries ARE the reference (every 3960 is the
 *  'Anniversary Edition', every 5976/1G the 40th-anniversary Nautilus); a
 *  marker only a minority carries is a variant of it. */
export function intrinsicWatchMarkers(classes: readonly (WatchSaleClass | undefined)[]): Set<string> {
  const freq = new Map<string, number>();
  for (const c of classes) for (const m of c?.markers || []) freq.set(m, (freq.get(m) || 0) + 1);
  return new Set(Array.from(freq.entries()).filter(([, n]) => n / classes.length >= 0.5).map(([m]) => m));
}

/** Narrow a watch pool to one plain material variant — the value book's rule
 *  (and the engine's for a lot whose own material is unstated):
 *   · variant sales (a non-intrinsic marker) leave;
 *   · materials (stated ones) ≥ WATCH_MATERIAL_DOMINANCE one material → keep
 *     it (+ the unstated sales);
 *   · MIXED (a 6265 in steel and in gold) → the CHEAPEST documented material
 *     (median of ≥ 2 stated sales), so a listing in a pricier material can
 *     never read as under it; the cheapest subset must carry `minN` sales on
 *     its own, else the pool abstains 'watch-material-mixed'. */
export function purifyWatchSales<T>(
  sales: readonly T[], cls: (s: T) => WatchSaleClass | undefined, price: (s: T) => number, minN: number = WATCH_MIN_N,
): { sales: T[]; abstain: 'watch-material-mixed' | null; split: boolean; mat?: string } {
  const intrinsic = intrinsicWatchMarkers(sales.map(cls));
  const plain = sales.filter(s => !(cls(s)?.markers || []).some(m => !intrinsic.has(m)));
  const mats = new Map<string, number>();
  let known = 0;
  for (const s of plain) { const m = cls(s)?.mat; if (m) { known++; mats.set(m, (mats.get(m) || 0) + 1); } }
  let top: string | undefined, topN = 0;
  mats.forEach((n, k) => { if (n > topN || (n === topN && top !== undefined && k < top)) { top = k; topN = n; } });
  if (known && topN / known < WATCH_MATERIAL_DOMINANCE) {
    // only stated-material sales count (an unstated one could be either), and
    // no thinner material may sit under the cheapest (steel is not always the
    // cheap case on vintage Patek)
    const byMat = new Map<string, T[]>();
    for (const s of plain) { const m = cls(s)?.mat; if (m) (byMat.get(m) || byMat.set(m, []).get(m)!).push(s); }
    const med = (xs: T[]) => quantile(xs.map(price).sort((a, b) => a - b), 0.5);
    const subs = Array.from(byMat.entries()).filter(([, xs]) => xs.length >= 2).map(([m, xs]) => ({ m, xs, med: med(xs) })).sort((a, b) => a.med - b.med);
    const cheapest = subs[0];
    if (!cheapest || cheapest.xs.length < minN) return { sales: [], abstain: 'watch-material-mixed', split: false };
    return { sales: cheapest.xs, abstain: null, split: true, mat: cheapest.m };
  }
  const kept = plain.filter(s => !cls(s)?.mat || cls(s)!.mat === top);
  return { sales: kept, abstain: null, split: kept.length < sales.length, mat: top };
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

/* ── LOT SHAPE: the form/part gate (Sep 27 2026 engine pass) ──────────────
   Title cosine cannot see WHAT KIND OF LOT a title describes: "Royal Oak
   länkbit" (a bracelet link) shares every identity token with a Royal Oak
   watch; "set of six Conoid chairs" shares them with one chair; an original
   comic-art page shares them with a box of printed comic books. Each of
   those comp pairs was a live miss (länkbit 2.4×, comic page 3.8× at 'high',
   Nakashima set of six). The shape is three orthogonal axes, parsed once per
   title, and a comp must agree on all three:
     count    — 1 (a single object), N (a stated set/pair/lot of N), or
                0 (an unstated multiple: collection/archive/box/bundle/lot)
     part     — a part/fragment/accessory, never the whole object
     original — hand-made original art vs a printed/mass-produced object,
                only when the title SAYS so (art markets keep their own
                print/painting forms; this axis is for comics/animation/pop)
   Conservative by construction: every axis defaults to "single, whole,
   unstated", so an unparsed title keeps comping exactly as before. */

export interface LotShape {
  /** 1 = single object · N>1 = a stated set/pair/lot of N · 0 = an unstated multiple */
  count: number;
  /** a part / fragment / accessory lot — never comps (or is comped by) a whole object */
  part: boolean;
  /** 'original' = hand-made original art · 'printed' = explicitly mass-produced · null = unstated */
  original: 'original' | 'printed' | null;
}

const SHAPE_NUM: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, dozen: 12,
  deux: 2, trois: 3, quatre: 4, cinq: 5, huit: 8, dix: 10, douze: 12,
  zwei: 2, drei: 3, vier: 4, 'fünf': 5, sechs: 6, acht: 8,
  'två': 2, tre: 3, fyra: 4, fem: 5, sex_sv: 6, 'åtta': 8,
};
const numOf = (w: string): number | null => {
  if (/^\d{1,3}$/.test(w)) { const n = parseInt(w, 10); return n >= 2 && n <= 500 ? n : null; }
  return SHAPE_NUM[w.toLowerCase()] ?? null;
};
const NUM_WORD = '(\\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|dozen|deux|trois|quatre|cinq|huit|dix|douze|zwei|drei|vier|fünf|sechs|acht|två|tre|fyra|fem|åtta)';
// a stated set/pair/lot of N
const SHAPE_PAIR = /\b(?:a |the )?pair of\b|\bpaire de\b|\bpar av\b|\bein paar\b/i;
const SHAPE_SET_N = new RegExp(`\\b(?:set|suite|ensemble|lot|group|grouping|collection|archive|run|box|case|lot|bundle|stack|pile|series)\\s+(?:de|of|av|von)\\s+${NUM_WORD}\\b`, 'i');
const SHAPE_NOUNS = '(?:pieces|pcs|items|objects|cards|photos|photographs|tickets|stubs|chairs|armchairs|stools|benches|tables|lamps|sconces|plates|bowls|vases|cups|glasses|prints|lithographs|etchings|posters|books|volumes|comics|comic books|issues|coins|stamps|pins|buttons|figures|figurines|toys|watches|pens|letters|documents|autographs|balls|bats|jerseys|helmets|bracelets|rings|earrings|cufflinks|brooches|necklaces)';
const SHAPE_N_ITEMS = new RegExp(`\\b${NUM_WORD}\\s+(?:assorted\\s+|various\\s+|different\\s+|signed\\s+|vintage\\s+|original\\s+|matching\\s+)?${SHAPE_NOUNS}\\b`, 'i');
// a LEADING spelled count ("Six Conoid Chairs", "Two Early LCW Chairs") — only
// when a plural object noun follows within four words ("Three Musketeers" is
// a title, not a count); a leading DIGIT is a year/lot number, never a count
const SHAPE_LEAD_N = new RegExp(`^(?:an?\\s+)?(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|deux|trois|quatre|cinq|huit|dix|douze|zwei|drei|vier|sechs|acht|två|tre|fyra|fem)\\s+(?:[\\w'’.-]+\\s+){0,4}?${SHAPE_NOUNS}\\b`, 'i');
// an unstated multiple
const SHAPE_MULTI = /\b(?:collection of|archive of|group of|grouping of|assortment of|assemblage of|bundle of|lot of|box of|case of|carton of|stack of|run of|complete run|large lot|mixed lot|job lot|comic (?:book )?lot|card lot|(?:complete|partial|near[- ]complete|master|team|factory|starter) sets?\b|(?:wax|hobby|blaster|retail|jumbo|sealed|unopened|factory[- ]sealed) (?:box|case|pack)s?|(?:lot|group|collection|archive|assortment)\s+\(\d+\))/i;
// "(a|large|important|…) collection" as the LOT noun — never provenance ("from the collection of")
const SHAPE_COLLECTION_LOT = /^(?:an?\s+|the\s+)?(?:(?:large|small|extensive|important|fine|rare|complete|comprehensive|significant|substantial|huge|vintage|family|personal)\s+){0,3}(?:collection|archive|group|grouping|assortment)\b/i;
// parts, fragments and accessories — never the whole object
const SHAPE_PART = new RegExp([
  // Scandinavian/German link-piece nouns (the Royal Oak "länkbit" class)
  '\\bl[äa]nk(?:bit|ar|en)?\\b', '\\bglieder?\\b',
  // links as the lot noun, never "with a link bracelet"
  `\\b(?:extra|spare|additional|replacement|loose|${NUM_WORD})\\s+(?:bracelet\\s+)?links?\\b`, '\\bbracelet links?\\b', '\\blinks? (?:for|from|to fit)\\b',
  // an accessory named FOR / ONLY
  '\\b(?:bracelet|strap|band|buckle|clasp|deployant|folding clasp|dial|movement|case|caseback|case back|bezel|crown|hands|crystal|box|boxes|papers|certificate|warranty card|winder|pouch|tool)\\s+(?:only|for|to fit|from a)\\b',
  '\\bonly (?:the )?(?:strap|bracelet|dial|movement|case|box|papers)\\b',
  '\\bempty (?:watch |presentation |fitted )?box(?:es)?\\b',
  '\\b(?:box|boxes|papers|certificate)(?: (?:and|&) (?:papers|box|certificate))? only\\b',
  // fragments and pieces of a thing
  '\\bfragments?\\b', '\\b(?:a )?piece of (?:the |an? )?(?!art\\b|jewel|history\\b)', '\\bswatch(?:es)? (?:of|from|cut)\\b', '\\b(?:uniform|jersey|seat|floor|court|turf|net) (?:swatch|piece|section|remnant)\\b',
  '\\bspare parts?\\b', '\\bparts? (?:for|from|of a)\\b', '\\bcomponents? (?:for|from|of a)\\b',
].join('|'), 'i');
// original hand-made art vs mass-produced — only when stated
const SHAPE_ORIGINAL = /\boriginal (?:comic |cover |splash |interior |strip |sunday |daily |production |animation |concept |pin[- ]up |illustration |poster |pencil |ink |published )?(?:art(?:work)?|page|cover|drawing|painting|illustration|sketch|cel|splash|strip)\b|\b(?:production|animation) cel\b|\bhand[- ]drawn\b|\bhand[- ]painted cel\b|\bcomic art\b|\bsplash page\b|\bcover art\b|\bpencils? and inks?\b|\binked page\b/i;
const SHAPE_PRINTED = /\b(?:comic books?|comics? (?:#|no\.?|issue)|issue #\d|cgc \d|cbcs \d|cgc graded|pgx \d|newsstand|variant cover|first printing|reprint|facsimile|lithograph|offset|giclee|gicl[ée]e|poster|print(?:ed)?\b|trading cards?|magazine|paperback|hardcover)\b/i;

const SHAPE_QTY_SUFFIX = /\((\d{1,2})\)\s*\.?\s*$/;
const SHAPE_CACHE = new Map<string, LotShape>();
/** Parse the lot's shape from its title (cached per title string). */
export function lotShapeOf(title: string | null | undefined): LotShape {
  const t = (title || '').trim();
  const hit = SHAPE_CACHE.get(t);
  if (hit) return hit;
  let count = 1;
  // the catalogue quantity suffix: Bonhams/Christie's close a multi-piece lot
  // with "(6)" / "(2)" ("American black walnut, sea-grass … (6)")
  const qty = t.match(SHAPE_QTY_SUFFIX);
  const qn = qty ? parseInt(qty[1], 10) : 0;
  if (qn >= 2 && qn <= 48) count = qn;
  else if (SHAPE_PAIR.test(t)) count = 2;
  else {
    const m = t.match(SHAPE_SET_N) || t.match(SHAPE_N_ITEMS);
    const n = m ? numOf(m[1]) : null;
    if (n) count = n;
    else if (SHAPE_MULTI.test(t) || SHAPE_COLLECTION_LOT.test(t)) count = 0;
    else {
      const lead = t.match(SHAPE_LEAD_N);
      const ln = lead ? numOf(lead[1]) : null;
      if (ln) count = ln;
    }
  }
  const part = SHAPE_PART.test(t);
  const original = SHAPE_ORIGINAL.test(t) ? 'original' : SHAPE_PRINTED.test(t) ? 'printed' : null;
  const out: LotShape = { count, part, original };
  if (SHAPE_CACHE.size > 200_000) SHAPE_CACHE.clear();
  SHAPE_CACHE.set(t, out);
  return out;
}

/** THE form/part gate: may `b` comp `a`? A part never comps a whole (and vice
 *  versa); a single never comps a multiple (and vice versa); stated multiples
 *  comp only the same stated count; stated original art never comps a stated
 *  printed/mass-produced lot. `ignoreCount` is for pools that NORMALIZE set
 *  size themselves (the client design path's measured per-unit scale). */
export function shapesCompatible(a: LotShape, b: LotShape, opts: { ignoreCount?: boolean } = {}): boolean {
  if (a.part !== b.part) return false;
  if (!opts.ignoreCount) {
    if ((a.count === 1) !== (b.count === 1)) return false;
    if (a.count > 1 && b.count > 1 && a.count !== b.count) return false;
  }
  if (a.original && b.original && a.original !== b.original) return false;
  return true;
}

/** A PLATE "…, from <Series>" is a part of the portfolio/book <Series>: the
 *  single sheet "Sam, from 25 Cats Name(d) Sam and One Blue Pussy" was comped
 *  by the whole book (a $40,000 exact). True when one title names a series and
 *  the other title IS that series (and names none itself) — either direction. */
export function plateOfWhole(aTitle: string | null | undefined, bTitle: string | null | undefined): boolean {
  const check = (plate: string | null | undefined, whole: string | null | undefined) => {
    const s = seriesOf(plate);
    if (!s || s.length < 6 || seriesOf(whole)) return false;
    const w = normalizeTitle(whole);
    return w.length >= 6 && (w === s || w.startsWith(`${s} `) || s.startsWith(`${w} `));
  };
  return check(aTitle, bTitle) || check(bTitle, aTitle);
}

/** Convenience: the full shape gate on two lots' titles (shape axes + the
 *  plate-vs-whole-portfolio rule). */
export function sameShape(a: Pick<AuctionLot, 'title'>, b: Pick<AuctionLot, 'title'>): boolean {
  return shapesCompatible(lotShapeOf(a.title), lotShapeOf(b.title)) && !plateOfWhole(a.title, b.title);
}

/** The data agent's comp-exclusion stamp (normalize): a lot carrying
 *  `compExclude` (junk price, duplicate listing, …) is never a comp. */
export function isCompExcluded(l: object): boolean {
  return !!(l as { compExclude?: string | null }).compExclude;
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
export function estUsdBand(lot: AuctionLot): { low: number | null; high: number | null } {
  // Single-point fallback (the SIXTH sighting of the both-bounds bug — RR
  // publishes estimateLow only; demand.ts:43 learned this first): a house
  // that posts one bound still posted an estimate. low||high mirrors it.
  const low = lot.estLowUsd ?? lot.estimateLow;
  const high = lot.estHighUsd ?? lot.estimateHigh;
  return { low: low ?? high, high: high ?? low };
}

/** the named series of a print title ("…, from Jazz (…)") — normalized, ≥3 chars */
function seriesOf(t: string | null | undefined): string | null {
  const m = (t || '').match(/(?:,|\s)from\s+(?:the\s+)?(.{3,50}?)(?:\s*\(|,|\s*\d*\s*$)/i);
  if (!m) return null;
  const s = normalizeTitle(m[1]);
  return s.length >= 3 ? s : null;
}

const NORM_CACHE = new Map<string, string>();
/** cached per title string (the pool scans re-normalize every candidate per
    anchor — the nightly comps precompute runs millions of these) */
export function normalizeTitle(t: string | null | undefined): string {
  const k = t || '';
  const hit = NORM_CACHE.get(k);
  if (hit !== undefined) return hit;
  const out = k
    .toLowerCase()
    .replace(/["“”'’]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (NORM_CACHE.size > 200_000) NORM_CACHE.clear();
  NORM_CACHE.set(k, out);
  return out;
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

/** median of an ascending-sorted array (stats.medianSorted; 0 when empty so
 *  the pool guards below keep their historical `med > 0` semantics) */
function median(sorted: number[]): number {
  const m = medianSorted(sorted);
  return Number.isNaN(m) ? 0 : m;
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

  // FORM/PART gate (lotShapeOf): a part never comps a whole, a single never a
  // multiple, original art never a printed object. Furniture pools normalize
  // set size per unit below (measured), so the COUNT axis is waived there.
  const shapeA = lotShapeOf(lot.title);
  const shapeOpts = { ignoreCount: FURNITURE.has(form) };
  const sold = allLots.filter(l =>
    l.artist === lot.artist && l.status === 'sold' && l.priceUsd && l.id !== lot.id
    && !isCompExcluded(l)
    && shapesCompatible(shapeA, lotShapeOf(l.title), shapeOpts)
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
    // ESTIMATE-TIER BAND (art/design form path, Oct 10 2026): a unique work
    // comps works the market priced at its tier, never the maker's whole
    // same-form record — "5 Deaths Twice II" ($9.3M est) read a $135K median
    // off 1980s commission portraits and small undated canvases. The band is
    // on each comp's own PRE-SALE estimate (the house's tier judgment), never
    // on its realized price, so the read never selects its own outcome.
    // Measured (temporal holdout, art/design form reads with an estimate):
    //   ≥$500K  err ×2.15 → ×1.26 · >3× wrong 32.2% → 2.0% · cov 858 → 796
    //   $100–500K ×2.07 → ×1.32 · 30.4% → 3.3% · <$50K ×1.58 → ×1.34 · 14.0% → 3.5%
    // An anchor with too few tier comps falls to the pool floor and abstains.
    if (tierBanded(lot)) pool = pool.filter(c => inEstimateTier(c, estMid));
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
  const q1 = quantile(prices, 0.25);
  const q3 = quantile(prices, 0.75);
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

/** THE ESTIMATE-TIER BAND — a comp's own pre-sale estimate midpoint must sit
 *  within ×/÷ COMP_TIER.ratio of the anchor's. ×2 measured better than ×3 at
 *  every tier (≥$500K: ×1.26 vs ×1.35 error, 2.0% vs 3.6% wild). */
export const COMP_TIER = { ratio: 2 };
const TIER_MARKETS = new Set(['art', 'design']);
/** the art / design form path is the measured population; watches gate on
 *  reference + material, sports/science objects on identity */
function tierBanded(lot: AuctionLot): boolean {
  return TIER_MARKETS.has(marketOf(lot.artist)) && !isSportsScienceObject(lot);
}
function inEstimateTier(c: AuctionLot, estMid: number): boolean {
  const e = estUsdBand(c);
  if (!e.low || !e.high) return false; // no pre-sale tier evidence → not a tier comp
  const m = (e.low + e.high) / 2;
  return m <= estMid * COMP_TIER.ratio && m >= estMid / COMP_TIER.ratio;
}

/** THE POOL GUARDS every printed comp median answers to (compPoolRead's
 *  frozen invariants, ENGINE SPEC v2 §1.1): pool floor ≥ 3, IQR/median ≤ 2.5,
 *  and — when the lot carries an estimate — the median inside ×/÷ 5 of it
 *  (value.ts POOL_SCALE: a pool off the estimate's scale prices another
 *  object). Returns the median, or null = abstain. */
export function guardedMedian(prices: readonly number[], estMid: number | null): number | null {
  if (prices.length < 3) return null;
  const sorted = prices.slice().sort((a, b) => a - b);
  const med = median(sorted);
  if (!(med > 0)) return null;
  if ((quantile(sorted, 0.75) - quantile(sorted, 0.25)) / med > 2.5) return null;
  if (estMid && (med > estMid * 5 || med < estMid / 5)) return null;
  return med;
}

/** THE CONTEXT READ — the comps modal's rows for a lot with neither an
 *  engine call nor a realized band (and scripts/r2/comps.ts's ctx rows):
 *  gated comps ranked by similarity (comp-score), top CONTEXT_MAX. Before
 *  Oct 10 2026 these rows printed a "Median" stat with none of the engine's
 *  guards — the $9.3M Warhol "5 Deaths Twice II" read $135K, and 11 of 31
 *  live ≥$500K art/design lots printed a context median outside ×/÷ 5 of
 *  their estimate. Now (a) art / design rows read through the estimate-tier
 *  band (COMP_TIER, the appraisal's own law) and (b) the pool answers to
 *  guardedMedian: a pool that fails it is NO pool (rows empty → the modal's
 *  "no comparable sales clear the gates" state). Measured (temporal holdout,
 *  art/design sold lots since 2015, read = the context median):
 *    ≥$500K     err ×1.32 → ×1.22 · >3× wrong 14.9% → 2.4% · cov 95.2% → 87.6%
 *    $100–500K  ×1.38 → ×1.30 · 10.4% → 2.9% · cov 94.0% → 89.7%
 *    <$100K     ×1.44 → ×1.40 · 10.5% → 7.0% · cov 91.1% → 87.6%
 *  (guards alone, no tier band: ≥$500K 6.7% wild at 85.8% cov — the band
 *  both purifies and RESCUES pools the ×5 guard would kill). */
export const CONTEXT_MAX = 15;
export function contextComps(lot: AuctionLot, allLots: AuctionLot[]): { rows: AuctionLot[]; median: number | null } {
  const gate = comparableTo(lot);
  const est = estUsdBand(lot);
  const estMid = est.low && est.high ? (est.low + est.high) / 2 : null;
  // the same estimate-tier band the appraisal reads through (art / design)
  const tier = estMid && tierBanded(lot) ? estMid : null;
  const rows = allLots
    .filter(l => l.artist === lot.artist && l.status === 'sold' && l.priceUsd && l.id !== lot.id && gate(l)
      && (tier == null || inEstimateTier(l, tier)))
    .map(s => ({ s, sc: scoreComparable(lot, s), t: new Date(s.saleDate).getTime() }))
    .sort((a, b) => (Math.abs(a.sc - b.sc) > 0.01 ? b.sc - a.sc : b.t - a.t))
    .slice(0, CONTEXT_MAX)
    .map(x => x.s);
  const med = guardedMedian(rows.map(l => l.priceUsd!), estMid);
  return med == null ? { rows: [], median: null } : { rows, median: med };
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

/** THE FLAG A LOT WEARS (Oct 6 2026) — the ENGINE's call, never a client
 *  synthesis. The build used to fall back to signalWithPool for lots the
 *  engine declined to value: 119 of the 374 'Below Market' flags on the Oct 5
 *  book (+46 'Above') came from that never-backtested read (e.g. 62 Hake's
 *  comic pages "+259%" off Babe Ruth book pages). Now: no engine value, or an
 *  engine value with no directional call → no flag. The printed % is the FLAG
 *  ratio the signal was called on (value.flagRatio, fallback compRatio — on
 *  the hammer basis from the Oct 6 engine); a ratio outside [1/5, 5] is a data
 *  fault and carries no flag (the ×5 estimate-band sanity). 'at comparable
 *  market' → null. One source for scripts/build-upcoming and the client. */
export function engineFlagOf(lot: AuctionLot): DeepSignal | null {
  const ev = lot.value;
  if (!ev || !ev.signal) return null;
  if (ev.compRatio != null && !(ev.compRatio <= 5 && ev.compRatio >= 1 / 5)) return null;
  const fr = ev.flagRatio ?? ev.compRatio;
  if (fr == null) return null;
  const below = ev.signal.label.startsWith('below');
  if (!below && !ev.signal.label.startsWith('above')) return null;
  return {
    label: below ? 'Below Market' : 'Above Market',
    pct: Math.round((below ? fr - 1 : 1 - fr) * 100),
    basis: ev.n || 0, med: ev.compMedianUsd ?? ev.compValueUsd, kind: 'form',
    form: ((lot as { formKey?: string }).formKey || 'unknown') as Form,
    confidence: ev.confidence === 'high' ? 'high' : ev.confidence === 'medium' ? 'medium' : 'low',
  };
}

/** The client-side signal read: the engine's flag (engineFlagOf). `allLots`
 *  is kept for the call signature; no flag is synthesized from it. */
export function computeDeepSignal(lot: AuctionLot, _allLots?: AuctionLot[]): DeepSignal | null {
  return engineFlagOf(lot);
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
/** a leading capitalized run that is a person's NAME, not a descriptor run
 *  ("FLOWN ON APOLLO", "Official Game Used", "Original Type I", "World Series
 *  Champions", "Apollo Command Module"): no word may be a descriptor / object /
 *  event / grader / month word, and no word may be a lone article or preposition */
const NOT_A_NAME_WORD = /^(?:flown|apollo|gemini|mercury|skylab|shuttle|nasa|mission|missions|space|lunar|moon|capsule|module|command|flag|patch|emblem|robbins|medallion|signed|autographed|autograph|game|games|used|worn|issued|official|original|vintage|rare|important|exceptional|collection|lot|group|set|pair|team|teams|world|series|super|bowl|the|a|an|of|on|in|and|for|from|with|to|by|at|card|cards|photo|photograph|photos|type|ticket|tickets|full|large|small|early|late|new|old|american|national|league|club|stadium|university|college|high|school|press|pass|program|magazine|sports|illustrated|baseball|football|basketball|hockey|boxing|golf|olympic|olympics|gold|silver|bronze|medal|trophy|award|ring|championship|champion|champions|hall|fame|jersey|bat|ball|helmet|glove|cap|hat|shirt|uniform|display|framed|lithograph|print|poster|letter|document|check|contract|book|cut|index|day|night|era|circa|mint|gem|graded|psa|bgs|sgc|jsa|beckett|rookie|season|career|final|finals|playoff|playoffs|opening|home|road|away|vs|versus|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|astronaut|astronauts|cosmonaut|crew|launch|rocket|flight|flown-in|presidential|president|white|house|limited|edition|replica|authentic|certified|item|items|memorabilia|conference|eastern|western|division|round|cup|open|international|tournament|championships|match|debut|win|hit|goal|our|two|three|four|five|nhl|nfl|nba|mlb|ncaa|bcs|wbc|fifa|uefa|global|historic|phantom)$/i;
export function isPersonNameRun(name: string): boolean {
  return personNameOf(name) === name.trim();
}
/** the leading NAME words of a capitalized run, cut at the first descriptor
 *  ("Tom Brady Signed" → "Tom Brady"); null when fewer than two words remain
 *  ("FIFA World Cup", "New York Yankees", "FLOWN ON APOLLO") */
export function personNameOf(run: string): string | null {
  const kept: string[] = [];
  for (const w of run.trim().split(/\s+/)) {
    const bare = w.replace(/[.'’:,-]+$/g, '').replace(/^['’]+/, '');
    if (NOT_A_NAME_WORD.test(bare) || NOT_A_NAME_WORD.test(bare.split('-')[0])) break;
    kept.push(w);
  }
  return kept.length >= 2 ? kept.join(' ') : null;
}

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
    // reject a leading year/all-caps token run that isn't a person — and
    // (Oct 6 2026 categorization re-audit: 10.2k junk entities like 'FLOWN ON
    // APOLLO', 'Official Game Ball', 'NASA Mission Control') any run holding a
    // descriptor word: the entity is the run's leading NAME words, if any
    const person = /^\d/.test(name) ? null : personNameOf(name);
    if (person) out.entity = person;
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
  const shapeA = lotShapeOf(lot.title);
  const same = allLots.filter(l =>
    l.artist === lot.artist && l.status === 'sold' && l.priceUsd && l.id !== lot.id &&
    !isCompExcluded(l) && shapesCompatible(shapeA, lotShapeOf(l.title)) &&
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
  const q1 = quantile(prices, 0.25);
  const q3 = quantile(prices, 0.75);
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
  /** what the pool covers, for the label — e.g. 'originals', 'sculptures' */
  scope?: string;
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
  const shapeA = lotShapeOf(lot.title);
  for (const l of allLots) {
    if (l.id === lot.id || l.artist !== lot.artist || l.status !== 'sold' || !l.priceUsd) continue;
    if (isCompExcluded(l) || !shapesCompatible(shapeA, lotShapeOf(l.title))) continue;
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
  const q1 = quantile(prices, 0.25);
  const q3 = quantile(prices, 0.75);
  if (med > 0 && (q3 - q1) / med > 2.5) return null;
  const est = estUsdBand(lot);
  const em = est.low && est.high ? (est.low + est.high) / 2 : null;
  if (em && (med > em * 5 || med < em / 5)) return null;
  return { kind: 'reference', confidence: 'low', med, q1, q3, n: pool.length };
}

/** MAKER REFERENCE BAND — unique works (paintings, works on paper,
 *  sculpture) have no edition pool, so the point appraiser abstains and an
 *  owned piece reads dead flat. The maker's own sold record for the same
 *  form class is honest CONTEXT: "his originals trade $q1–$q3 at auction".
 *  A labeled RANGE at low confidence — never a value, never enters a total.
 *  Prefers the trailing 5 years; falls back to all-time when thin. Wide
 *  dispersion is tolerated (unique works vary by size and importance) but
 *  a near-information-free band (IQR > 6× median) abstains. */
const MAKER_BAND_FORMS: Record<string, string> = {
  painting: 'paintings',
  'work-on-paper': 'works on paper',
  'original-2d': 'originals',
  sculpture: 'sculptures',
};
export function makerReferenceBand(lot: AuctionLot, allLots: AuctionLot[]): ReferenceBand | null {
  if (!lot.artist) return null;
  // science/culture domains have their own measured reference tiers
  if (SPORTS_SCIENCE_SLUGS.has(lot.artist) || CULTURE_SLUGS_ENGINE.has(lot.artist)) return null;
  const form = formOf(lot);
  const scope = MAKER_BAND_FORMS[form];
  if (!scope) return null;
  const shapeA = lotShapeOf(lot.title);
  const all = allLots.filter(l =>
    l.id !== lot.id && l.artist === lot.artist && l.status === 'sold'
    && (l.priceUsd || 0) > 0 && formOf(l) === form
    && !isCompExcluded(l) && shapesCompatible(shapeA, lotShapeOf(l.title)));
  if (all.length < 5) return null;
  const cutoff = new Date(Date.now() - 5 * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const recent = all.filter(l => (l.saleDate || '') >= cutoff);
  const pool = (recent.length >= 5 ? recent : all)
    .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''))
    .slice(0, 60);
  const prices = pool.map(l => l.priceUsd!).sort((a, b) => a - b);
  const med = median(prices);
  const q1 = quantile(prices, 0.25);
  const q3 = quantile(prices, 0.75);
  if (!(med > 0) || (q3 - q1) / med > 6) return null;
  return { kind: 'reference', confidence: 'low', med, q1, q3, n: pool.length, scope };
}

/** Culture reference band — Goldin edition-like tier (same normalized title,
 *  ≥5 distinctive tokens) else the subject×itemClass reference tier from the
 *  crawl-stamped axes. Measured: Goldin edition-like 0.25 med|err| / 85.2%
 *  within 2×; strict itemClass gate (loose degrades within-2× 72.3→66.5%). */
export function cultureReferenceBand(lot: AuctionLot, allLots: AuctionLot[]): ReferenceBand | null {
  if (!CULTURE_SLUGS_ENGINE.has(lot.artist)) return null;
  const shapeA = lotShapeOf(lot.title);
  const sold = allLots.filter(l =>
    l.id !== lot.id && CULTURE_SLUGS_ENGINE.has(l.artist) && l.status === 'sold' && l.priceUsd
    && (l as AuctionLot & { source?: string }).source !== 'sothebys-algolia'
    && !isCompExcluded(l) && shapesCompatible(shapeA, lotShapeOf(l.title)));
  const nt = normalizeTitle(cleanGoldinTitle(lot.title || ''));
  const bandOf = (pool: AuctionLot[], kind: ReferenceBand['kind']): ReferenceBand | null => {
    if (pool.length < 3) return null;
    const prices = pool.map(l => l.priceUsd!).sort((a, b) => a - b);
    const med = median(prices);
    const q1 = quantile(prices, 0.25);
    const q3 = quantile(prices, 0.75);
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
