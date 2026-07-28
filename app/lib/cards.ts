/**
 * cards.ts — the sports-card identity parser. Goldin card titles are nearly
 * structured data: `YEAR SET [insert/parallel] #CARDNO PLAYER [Rookie|Signed|
 * Patch…] [(#serial/of)] - GRADECO GRADE`. This parses that shape into the
 * identity every card feature stands on (player dossiers, last-sales matching,
 * grade ladders). Pure functions, shared by build scripts and the client.
 *
 * Honesty rule: a field that doesn't parse is null — never guessed.
 */

export interface CardId {
  player: string | null;      // "LeBron James"
  playerSlug: string | null;  // "lebron-james"
  year: string | null;        // "2017" or "1996-97" (as written, 2-digit years normalized)
  setName: string | null;     // "Panini Obsidian" … the words between year and #
  cardNo: string | null;      // "CAAU-CK", "3", "105"
  gradeCo: string | null;     // PSA | BGS | SGC | CGC
  gradeNum: number | null;    // 10, 9.5, 8 …
  serialOf: number | null;    // print run from "(#04/15)" or "(#/841)" → 15, 841
  rookie: boolean;
  auto: boolean;              // autographed
}

const GRADE_RE = /[-–—]\s*(PSA|BGS|SGC|CGC)\b[^0-9]*?(\d{1,2}(?:\.5)?)\s*(?:[-–—].*)?$/i;
const SERIAL_RE = /\(#?\s*\d*\s*\/\s*(\d+)\)/;
// the player: capitalized-word run right after #CARDNO (cards) — allows
// lowercase particles (de, van), diacritics, O'/Mc names, Jr/Sr/II suffixes
const NAME_TOKEN = String.raw`[A-Z][A-Za-z.'’À-ɏ-]*`;
const AFTER_NO_PLAYER = new RegExp(
  String.raw`#[A-Za-z0-9/.-]+\s+((?:${NAME_TOKEN}|de|van|von|der|jr\.?|sr\.?|II|III)(?:\s+(?:${NAME_TOKEN}|de|van|von|der|Jr\.?|Sr\.?|II|III)){1,3})`
);
const LEADING_PLAYER = new RegExp(String.raw`^((?:${NAME_TOKEN}\s+){1,2}${NAME_TOKEN})`);
// words that end a player-name run (descriptors, never surnames)
const NAME_STOP = /^(Rookie|Signed|Card|Patch|Autograph(?:ed)?|Auto|Jersey|Relic|Logo|Game|Match|Photo|Player|Team|Tour|Practice|Fight|Warm|Dual|Triple|On|RC|And|With|Refractor|Prizm|Insert|Parallel|Case|Hit|Exchange|Redemption|SP|SSP|Worn|Used|Issued|Debut|Career|Final|Championship|World|Series|Super|Season|Professional|Model|Style|Era|Circa)$/i;

export function playerSlugOf(name: string | null): string | null {
  if (!name) return null;
  const s = name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[.'’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || null;
}

function trimNameRun(run: string): string | null {
  const words = run.trim().split(/\s+/);
  const kept: string[] = [];
  for (const w of words) {
    // stop on descriptors, INCLUDING hyphenated ones ("Game-Used", "Photo-Matched")
    if (NAME_STOP.test(w) || NAME_STOP.test(w.split('-')[0])) break;
    kept.push(w);
  }
  // a real name is 2+ words (single word = a set word we misgrabbed)
  return kept.length >= 2 ? kept.join(' ') : null;
}

/** Parse a CARD title. For object titles (jerseys etc.) use playerOf(). */
export function parseCard(title: string): CardId {
  const out: CardId = {
    player: null, playerSlug: null, year: null, setName: null, cardNo: null,
    gradeCo: null, gradeNum: null, serialOf: null, rookie: false, auto: false,
  };
  const t = (title || '').trim();
  if (!t) return out;

  const g = t.match(GRADE_RE);
  if (g) { out.gradeCo = g[1].toUpperCase(); out.gradeNum = parseFloat(g[2]); }

  const ser = t.match(SERIAL_RE);
  if (ser) out.serialOf = parseInt(ser[1], 10);

  out.rookie = /\brookie\b|\bRC\b/i.test(t);
  out.auto = /\b(autograph|signed|auto)\b/i.test(t);

  // year: leading 4-digit (with optional -yy) or bare 2-digit ('96, 21, 00)
  const y4 = t.match(/^(19\d{2}|20\d{2})(?:-\d{2})?\b/);
  const y2 = !y4 && t.match(/^'?(\d{2})\b/);
  if (y4) out.year = y4[0].replace(/^'/, '');
  else if (y2) { const n = parseInt(y2[1], 10); out.year = n > 40 ? `19${y2[1]}` : `20${y2[1]}`; }

  // card number: the first # group NOT inside parens (serials live in parens)
  const noParens = t.replace(/\([^)]*\)/g, ' ');
  const no = noParens.match(/#([A-Za-z0-9/.-]+)/);
  if (no) out.cardNo = no[1].toUpperCase();

  // set: the words between the year and the #cardNo (insert/parallel included —
  // deliberately: "Topps Finest Mystery Borderless" IS the market identity)
  if (out.year && no) {
    const afterYear = noParens.slice(noParens.indexOf(out.year.slice(-2)) + 2);
    const uptoNo = afterYear.slice(0, afterYear.indexOf('#'));
    const set = uptoNo.replace(/\s+/g, ' ').trim();
    if (set && set.length <= 70) out.setName = set;
  }

  // player: capitalized run after the card number; fallback to a leading name
  // (some card titles lead with the player, lot-style)
  const after = noParens.match(AFTER_NO_PLAYER);
  const run = after ? trimNameRun(after[1]) : null;
  const lead = !run ? (() => { const m = t.match(LEADING_PLAYER); return m ? trimNameRun(m[1]) : null; })() : null;
  out.player = run || lead;
  out.playerSlug = playerSlugOf(out.player);
  return out;
}

/** The player behind ANY sports lot: cards parse mid-title; objects (game-used
 *  jerseys, tickets, trophies) lead with the athlete's name. */
export function playerOf(title: string, slug: string): { player: string | null; playerSlug: string | null } {
  if (slug === 'sports-cards') {
    const c = parseCard(title);
    return { player: c.player, playerSlug: c.playerSlug };
  }
  // object titles lead with the athlete — often after a year ("1986 Michael
  // Jordan Game-Worn…") or a year-range; strip that prefix first
  const stripped = (title || '').replace(/^['’]?\d{2,4}(?:-\d{2,4})?\s+/, '');
  // card-style object titles (game-used PATCH/relic cards: "2005 Upper Deck
  // Exquisite #… Jordan Patch") lead with a BRAND, not the athlete — the card
  // parser reads those correctly (player after the #number)
  if (/^(Upper Deck|Panini|Topps|Fleer|Donruss|Bowman|Leaf|Skybox|Score|Pro Set|Pinnacle|Stadium Club|O-Pee-Chee|Hoops|Select|Mosaic|Prizm|Optic|National Treasures|Immaculate|Flawless|Exquisite)\b/i.test(stripped)) {
    const c = parseCard(title);
    return { player: c.player, playerSlug: c.playerSlug };
  }
  const m = stripped.match(LEADING_PLAYER);
  const name = m ? trimNameRun(m[1]) : null;
  // reject non-person leads ("World Series", "Super Bowl", team-ish runs)
  if (name && /\b(World|Series|Super|Bowl|Olympic|Stanley|Final|Champion|League|Team|City|United|Yankees|Lakers|Cowboys|Collection|Lot\b)/i.test(name)) {
    return { player: null, playerSlug: null };
  }
  return { player: name, playerSlug: playerSlugOf(name) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Relic-card detector — "is this title a trading CARD?" (shared by the crawler's
// goldinRoute and the build-time corpus reroute).
//
// The problem it solves: a "Game-Used Relic CARD" (a manufactured trading card
// carrying a swatch of game-used cloth) is a CARD — it has a card product and a
// card number, and comps on its EXACT-card value — not raw memorabilia. But a
// game-used object signal ("relic"/"patch"/"game-used") alone would route it to
// the game-used vertical and price it as a generic player-median.
//
// A CARD = a card-PRODUCT token (Topps/Panini/… — the manufacturer set) OR a
// card-NUMBER token (a #-prefixed alphanumeric like #DAP-SO, #SS-MJ, #111) that
// sits in CARD CONTEXT (Autograph/Relic/Patch/Rookie/Refractor/serial-numbered/
// graded). Grading alone (PSA/DNA on a raw jersey) is NOT sufficient — a raw
// jersey can be PSA/DNA authenticated without being a card. We require a PRODUCT
// or a NUMBER, never grading alone.
// ─────────────────────────────────────────────────────────────────────────────

// UNAMBIGUOUS card brands: proper nouns / multi-word set names that never appear
// as plain English (or as provenance) in a memorabilia title. Any one IS a card
// product. Deliberately EXCLUDES bare "Museum Collection" / "Exquisite" — those
// ride in as provenance ("EX-HELMS MUSEUM COLLECTION") or as prose ("Exquisite
// music box"); the branded forms "Topps Museum" / "Upper Deck Exquisite" are
// caught by their leading brand (Topps/Upper Deck) instead.
const CARD_PRODUCT_STRONG_RE =
  /\b(topps|upper deck|panini|bowman|donruss|fleer|sp authentic|sp game(?:[- ]used)?|prizm|immaculate|national treasures|stadium club|goudey|play ball|cracker jack|allen (?:&|and) ginter|o-pee-chee|skybox|pinnacle)\b/i;

// AMBIGUOUS card-set words that are ALSO common English (Finest/Select/Score/
// Chrome/Flawless/Dynasty/Sapphire/Leaf/Exquisite/Mosaic). Alone they mean
// nothing — a "FINEST CONDITION" signed baseball, an "Exquisite music box", or a
// "CERAMIC MOSAIC" club crest is not a card. They only count as a card product
// when CORROBORATED by a card number or clear card context (so "Topps Finest #…
// Refractor" and "Panini Mosaic #… Auto" read, but "FINEST KNOWN" does not).
const CARD_PRODUCT_WEAK_RE =
  /\b(finest|select|score|chrome|flawless|dynasty|sapphire|leaf|exquisite|mosaic|obsidian)\b/i;

// A card NUMBER: #-prefixed alphanumeric (allows the hyphenated insert codes:
// #DAP-SO, #SS-MJ, #111, #RA-LJ). Requires at least one alphanumeric char.
const CARD_NUMBER_RE = /#[A-Za-z0-9][A-Za-z0-9/-]*/;

// CARD CONTEXT: card-collateral words that, alongside a card number or a weak
// brand, confirm a trading card. Deliberately NARROW — the phrases that describe
// a CARD, not memorabilia. Bare "autograph"/"auto" is EXCLUDED: a signed baseball
// or jersey is "autographed" but is not a card (that's what mis-fired the raw
// Babe Ruth ball). The real relic cards carry a brand (Topps/Panini) or a serial,
// which seat them via the strong-brand or serial paths instead.
const CARD_CONTEXT_RE =
  /\b(refractor|rookie card|patch card|relic card|patch rookie|die[- ]?cut short print|\bssp\b|strip card|tobacco card|trading card|autograph patch|autographed patch)\b/i;
const SERIAL_NUMBERED_RE = /\(#?\s*\d+\s*\/\s*\d{1,4}\)|\s\/\d{1,4}\b/; // "(#06/10)", " /99"
// A card GRADE NUMBER — PSA/BGS/SGC/CGC followed by a numeric grade. Excludes the
// autograph-auth form "PSA/DNA" (which authenticates raw signed memorabilia, not
// cards) by requiring the grader NOT be immediately followed by "/DNA".
const CARD_GRADE_RE = /\b(psa|bgs|sgc|cgc)(?!\/dna)\s*\d/i;

// RAW MEMORABILIA object nouns. When one of these physical objects is named, the
// lot is (probably) actual memorabilia — a jersey/bat/ball — and a bare brand
// token is NOT enough to call it a card: those brand tokens ride in as an
// AUTHENTICATOR ("Upper Deck LOA", "Panini COA", "Topps LOA"), a SPONSOR ("Panini
// Rising Stars Challenge … Game-Used Jersey"), or a PLAYER SURNAME ("Ky Bowman …
// Game-Used Jersey", "Aubrey Huff … Pinnacle … Bat"). So when a raw-object noun is
// present we demand an EXPLICIT card signal (a card number, the word "card(s)", a
// serial print-run, or relic-card phrasing) before rerouting. The genuine relic
// CARDS always carry one — "Patch Card", "Relic Card", "#DAP-SO", "(#06/10)".
const RAW_OBJECT_RE =
  /\b(jersey|jerseys|uniform|bat|bats|baseball|basketball|football|glove|gloves|cleats|boots|helmet|trunks|shorts|cap\b|caps\b|jacket|shoe|shoes|sneakers?|shirt|shirts|ball|pennant|banner|trophy|ring\b|belt)\b/i;
// The explicit card signals that survive a raw-object noun.
const CARD_WORD_RE = /\bcards?\b/i;

/**
 * Is this title a trading CARD (including a game-used RELIC card)? Conservative.
 *
 * A card signal = a card NUMBER, an explicit "card(s)" word, a serial print-run
 * "(#/N)" / "/NN", a numeric grade (never PSA/DNA), or relic-card phrasing.
 *
 *  · strong brand (Topps/Panini/…): a card, UNLESS a raw-object noun (jersey/bat/
 *    ball…) is present — then a card signal is REQUIRED (the brand is an
 *    authenticator/sponsor/surname, not the set).
 *  · a card NUMBER in card context: a card.
 *  · a weak/ambiguous brand word (Finest/Mosaic/…): a card only WHEN corroborated.
 *
 * Grading language alone is never enough (a raw jersey can be PSA/DNA'd).
 */
export function looksLikeCard(title: string): boolean {
  const t = (title || '').trim();
  if (!t) return false;

  const hasNumber = CARD_NUMBER_RE.test(t);
  // an EXPLICIT card signal — enough to override a raw-object noun.
  const cardSignal =
    (hasNumber && (CARD_CONTEXT_RE.test(t) || SERIAL_NUMBERED_RE.test(t) || CARD_GRADE_RE.test(t)))
    || CARD_WORD_RE.test(t)
    || SERIAL_NUMBERED_RE.test(t)
    || CARD_CONTEXT_RE.test(t);
  const rawObject = RAW_OBJECT_RE.test(t);

  // 1) unambiguous card brand → a card. But if a raw-object noun is present, the
  //    brand is likely an authenticator/sponsor/surname → require a card signal.
  if (CARD_PRODUCT_STRONG_RE.test(t)) {
    if (!rawObject) return true;
    if (cardSignal) return true;
  }
  // 2) a card number seated in card context → a card (even with an object noun:
  //    "#DAP-SO … Patch Card" IS the relic card).
  if (hasNumber && (CARD_CONTEXT_RE.test(t) || SERIAL_NUMBERED_RE.test(t) || CARD_GRADE_RE.test(t))) {
    return true;
  }
  // 3) an ambiguous brand word (Finest/Mosaic/…) only counts WHEN corroborated by
  //    a card signal (which also covers the raw-object case).
  if (CARD_PRODUCT_WEAK_RE.test(t) && cardSignal) return true;
  return false;
}

/** The exact-identity key a card COMPS on: same player+year+set+number+grade =
 *  the same tradable thing. Null when the identity is too partial to trust. */
export function cardKey(id: CardId): string | null {
  if (!id.playerSlug || !id.year || !id.cardNo) return null;
  const set = (id.setName || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${id.playerSlug}|${id.year}|${set}|${id.cardNo.toLowerCase()}|${id.gradeCo || 'raw'}${id.gradeNum ?? ''}`;
}

/** Same card, any grade — the ladder key. */
export function cardLadderKey(id: CardId): string | null {
  if (!id.playerSlug || !id.year || !id.cardNo) return null;
  const set = (id.setName || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${id.playerSlug}|${id.year}|${set}|${id.cardNo.toLowerCase()}`;
}
