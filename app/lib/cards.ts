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
  /** (Sep 27) grade qualifier — PSA 9 (OC) trades far below a clean 9 */
  gradeQual?: string | null;
  /** (Sep 27) 'A' = slabbed Authentic/Altered (no numeric card grade) */
  gradeTag?: string | null;
  /** (Sep 27) a grading company is named but no card grade parsed — the
   *  identity is too partial to key (never fall back to 'raw') */
  gradeUnparsed?: boolean;
  /** (Sep 27) sorted parallel/variant signature ('auto+gold+refractor') read
   *  from the whole title outside the set name — a Silver Prizm is not the
   *  base card; null when none */
  variant?: string | null;
  /** (Sep 27) the AUTOGRAPH grade on a signed slab ("PSA/DNA GEM MT 10",
   *  "Auto 10", "PSA/DNA Authentic" → 'A') — a 10 auto and an Authentic auto
   *  are different cards; null when none */
  autoGrade?: string | null;
  /** (Oct 6) premium label tier on a 10 slab ('bl' BGS Black Label, 'pristine'
   *  BGS/CGC Pristine, 'gold' SGC/CGC Gold Label) — a Black Label 10 is not a
   *  Gem Mint 10; null when none */
  gradeTier?: string | null;
  /** (Oct 6) a multi-card lot (sets, pairs, "Collection (25)", two #numbers) —
   *  never one card's identity: cardKey/cardLadderKey abstain */
  multi?: boolean;
}
// (Oct 6) the gap never crosses a '#' (an insert code "Autograph #DA-32" is
// not an autograph grade 32) — and a gap naming a card grader is the CARD
// grade ("Auto--BGS 9/Auto 10" reads 10, not 9); grades are 1–10 only
const AUTO_GRADE_RE = /\b(?:PSA\s*\/\s*DNA|auto(?:graph)?(?:\s+grade)?)\b([^0-9,;()#]{0,20}?)(\d{1,2}(?:\.5)?)(?![\d.])/gi;
// the comma-separated SECOND grade on a dual-graded signed slab: "BGS 9.5,
// Beckett 10", "BGS Authentic, Beckett 10", "SGC 9, SGC Auto 10"
const SECOND_GRADE_RE = /,\s*(?:Beckett|BGS|SGC|CGC|PSA(?!\s*\/\s*DNA))\s*(?:auto(?:graph)?\s*)?(?:(?:GEM|MINT|MT|NM|EX|VG|PRISTINE)[\s+/-]*){0,3}(\d{1,2}(?:\.5)?)(?![\d.])/i;
// "BGS NM-MT 8 with GEM 10 Signature"
const WITH_SIG_GRADE_RE = /\bwith\s+(?:(?:GEM|MINT|MT|NM)[\s+/-]*){0,2}(\d{1,2}(?:\.5)?)\s+(?:signature|auto(?:graph)?)\b/i;
const GRADER_WORD_IN_GAP = /\b(?:PSA|BGS|SGC|CGC|BVG|Beckett)\b(?!\s*\/\s*DNA)/i;
const AUTO_AUTH_RE = /\b(?:PSA\s*\/\s*DNA|auto(?:graph)?)\s*[-:]?\s*(?:authentic|auth)\b/i;

// the trailing "- PSA 10" Goldin form (the gap may not carry an autograph
// grade: "- PSA Authentic, Auto 10" is NOT a card graded 10)
const GRADE_RE = /[-–—]\s*(PSA|BGS|SGC|CGC)\b([^0-9]*?)(\d{1,2}(?:\.5)?)\s*(?:[-–—].*)?$/i;
// (Oct 6) + TAG / GAI / BCCG / KSA / GMA — the smaller graders keyed RAW
// before ("TAG GEM MT 10" comped raw sales). These five are matched
// UPPERCASE ONLY (see isGrader): "Toe Tag" / "name tag" are not a slab.
const GRADERS = 'PSA|BGS|SGC|CGC|BVG|CSG|HGA|TAG|GAI|BCCG|KSA|GMA';
const CASED_GRADER = /^(?:TAG|GAI|BCCG|KSA|GMA)$/i;
const isGrader = (w: string) => !CASED_GRADER.test(w) || /^[A-Z]+$/.test(w);
// premium label tiers, read beside the grade
const TIER_RES: [RegExp, string][] = [[/\bblack\s*label\b/i, 'bl'], [/\bgold\s*label\b/i, 'gold'], [/\bpristine\b/i, 'pristine']];
// a grader ANYWHERE (REA / Memory Lane / H&S: "…Sandy Koufax Rookie PSA 9 MINT"),
// never the autograph-authentication form PSA/DNA
const GRADER_ANY_RE = new RegExp(`\\b(${GRADERS})\\b(?!\\s*\\/\\s*DNA)`, 'gi');
const GRADE_ANY_RE = new RegExp(`\\b(${GRADERS})\\b(?!\\s*\\/\\s*DNA)([^0-9()]{0,24}?)(\\d{1,2}(?:\\.5)?)(?![\\d.])`, 'gi');
const GRADE_TAG_RE = new RegExp(`\\b(${GRADERS})\\b(?!\\s*\\/\\s*DNA)\\s*[-:]?\\s*(authentic|auth\\b|altered|a\\b)`, 'gi');
const GRADE_QUAL_RE = /^\s*\(?\s*(OC|MK|ST|PD|MC|OF)\s*\)?(?![a-z])/i;
// a gap between the grader and the number that reads as an AUTOGRAPH grade
const AUTO_GAP_RE = /auth|auto|dna|sig/i;
// parallel / variant tokens (whole title, outside the set name). Team names
// that carry a colour word are masked first ("Red Sox" is not a Red parallel).
const TEAM_MASK_RE = /\b(red sox|white sox|blue jays|red wings|green bay|golden state|golden knights|blue devils|crimson tide|orange bowl|black knights|silver bullets|gold rush|browns|reds|blues|golden bears|redskins|green wave|royals)\b/gi;
const VARIANT_TOKENS: [RegExp, string][] = [
  [/\b(?:autograph(?:ed)?|signed|auto)\b/i, 'auto'],
  [/\b(?:patch|jersey|relic|swatch|memorabilia)\b/i, 'relic'],
  [/\b(?:super)fractor\b/i, 'superfractor'],
  [/\b(?:x-?fractor|refractor)\b/i, 'refractor'],
  [/\bprinting plate\b/i, 'plate'],
  [/\b(?:1\/1|one of one)\b/i, '1of1'],
  [/\b(?:variation|var\.|image variation|photo variation)\b/i, 'var'],
  [/\berror\b/i, 'error'],
  [/\bs?sp\b|\bshort print\b/i, 'sp'],
  [/\bdie[- ]?cut\b/i, 'diecut'],
  [/\bholo(?:foil|gram)?\b/i, 'holo'],
  [/\b(?:shimmer|mojo|wave|cracked ice|atomic|camo|tie[- ]dye|neon|disco|hyper|pulsar|la[sz]er|snakeskin|zebra|tiger|scope|velocity|lucky envelopes?|fast break|choice|no huddle|sparkle|glitter)\b/i, 'pattern'],
  [/\b(?:silver|gold|red|blue|green|orange|purple|pink|black|bronze|platinum|yellow|teal|aqua|emerald|ruby|sapphire)\b/i, 'color'],
];
/** a leading lot number immediately followed by a 4-digit year */
// several cards in one lot (the count in parens follows a set/lot word or ends
// the title: "Complete Set (576)", "Rookie Card Collection (25)")
// ("Complete Set" / "Team Set" alone can be a PRODUCT name — "Topps Complete
// Set Chrome … #5 (#05/25)" — so a set word counts only with a count or an
// "Including / Featuring / with" listing)
const MULTI_CARD_RE = /\b(?:lots? of|set of|run of|group of|(?:complete|near[- ]complete|near|team|master|partial|starter)[- ]sets?\s*(?:\(\d|[:,-]?\s*(?:including|featuring|with)\b)|(?:collection|lot|group|set|stack|trio|quartet)\s*\(\d+\)|pair\b|\(\d+\)\s*$|\(\d+\)\s*[-–—])/i;
const LOT_NO_BEFORE_YEAR = /^\d{1,5}\s+(?=(?:19|20)\d{2}(?:-\d{2})?\b)/;
const SERIAL_RE = /\(#?\s*\d*\s*\/\s*(\d+)\)/;
// the player: capitalized-word run right after #CARDNO (cards) — allows
// lowercase particles (de, van), diacritics, O'/Mc names, Jr/Sr/II suffixes
const NAME_TOKEN = String.raw`[A-Z][A-Za-z.'’À-ɏ-]*`;
const AFTER_NO_PLAYER = new RegExp(
  String.raw`#[A-Za-z0-9/.-]+\s+((?:${NAME_TOKEN}|de|van|von|der|jr\.?|sr\.?|II|III)(?:\s+(?:${NAME_TOKEN}|de|van|von|der|Jr\.?|Sr\.?|II|III)){1,3})`
);
const LEADING_PLAYER = new RegExp(String.raw`^((?:${NAME_TOKEN}\s+){1,2}${NAME_TOKEN})`);
// words that end a player-name run (descriptors, never surnames)
// (Oct 6) a name run also ends at a GRADER or GRADE word ("Willie Mays PSA
// EX-MT 6" minted the player willie-mays-psa-ex-mt: 40k lots) and at card
// descriptors houses append after the name ("All-Star", "High Number",
// "Gray Back", "Short Print", "Silver Buyback", "Secret Rare")
const GRADE_NAME_STOP = /^(PSA|BGS|SGC|CGC|BVG|CSG|HGA|TAG|GAI|BCCG|KSA|GMA|Beckett|GEM|MINT|MT|NM|EX|VG|GOOD|FAIR|POOR|PR|Authentic|Graded|All|Buyback|Holographic|Holo|Rare|Checklist|Gem|Mint)$/;
// two-word descriptors whose first word is also a surname (Reggie White,
// Danny Gray): stop only when the pair reads as the descriptor
const PAIR_NAME_STOP = /^(?:(?:White|Gray|Grey|Blue|Yellow|Cream)\s+(?:Back|Border)|High\s+(?:Number|#)|Short\s+Print|(?:Secret|Ultimate|Ultra|Super)\s+Rare)/;
// a colour word ends a run only once a 2+ word name is kept ("Patrick Mahomes
// II Orange #42/49"), never before ("Vida Blue", "Red Grange")
const COLOR_NAME_STOP = /^(Silver|Gold|Red|Blue|Green|Orange|Purple|Pink|Black|Bronze|Platinum|Yellow|Teal|Aqua|Emerald|Ruby|Sapphire)$/;
const NAME_STOP = /^(Rookie|Signed|Card|Patch|Autograph(?:ed)?|Auto|Jersey|Relic|Logo|Game|Match|Photo|Player|Team|Tour|Practice|Fight|Warm|Dual|Triple|On|RC|And|With|Refractor|Prizm|Insert|Parallel|Case|Hit|Exchange|Redemption|SP|SSP|Worn|Used|Issued|Debut|Career|Final|Championship|World|Series|Super|Season|Professional|Model|Style|Era|Circa|HR|RBI|Mini|Decal|Single|Full|Store|Salesman|Advertising|Presentational?)$/i;

export function playerSlugOf(name: string | null): string | null {
  if (!name) return null;
  const s = name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[.'’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || null;
}

function trimNameRun(run: string): string | null {
  // a grader glued on by dashes ("Hank Aaron--PSA Gem Mint 10", "Babe Ruth-SGC")
  const words = run.trim().replace(/-+(?=(?:PSA|BGS|SGC|CGC|BVG)\b)/g, ' ').split(/\s+/);
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // stop on descriptors, INCLUDING hyphenated ones ("Game-Used", "Photo-Matched")
    if (NAME_STOP.test(w) || NAME_STOP.test(w.split('-')[0])) break;
    const w0 = w.split(/[-/]/)[0];
    if (GRADE_NAME_STOP.test(w0) || (kept.length >= 2 && COLOR_NAME_STOP.test(w0))) break;
    if (PAIR_NAME_STOP.test(words.slice(i, i + 2).join(' '))) break;
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
    gradeQual: null, gradeTag: null, gradeUnparsed: false, variant: null, autoGrade: null,
    gradeTier: null, multi: false,
  };
  const t = (title || '').trim();
  if (!t) return out;

  // GRADE (Sep 27 2026 — the Koufax class): the trailing "- PSA 10" form
  // first, else a grader ANYWHERE ("…Koufax Rookie PSA 9 MINT" — REA/ML/H&S
  // titles carry no dash, parsed as RAW, and a PSA 9 comped the raw sales:
  // $2,730 → sold $604,736). An autograph grade never reads as the card's
  // ("PSA Authentic, Auto 10"); a named grader with no parseable card grade
  // leaves the identity unkeyable instead of silently 'raw'.
  const setGrade = (co: string, num: string, rest: string, gap: string) => {
    out.gradeCo = co.toUpperCase(); out.gradeNum = parseFloat(num);
    const q = rest.match(GRADE_QUAL_RE);
    if (q) out.gradeQual = q[1].toUpperCase();
    // the label tier sits in the gap ("BGS BLACK LABEL 10") or right after
    // ("CGC 10 Pristine") — never further out ("Topps Gold Label" is a set)
    const near = gap + ' ' + rest.slice(0, 24);
    for (const [re, tier] of TIER_RES) if (re.test(near)) { out.gradeTier = tier; break; }
  };
  const g = t.match(GRADE_RE);
  if (g && !AUTO_GAP_RE.test(g[2])) {
    const headLen = g[0].indexOf(g[1]) + g[1].length + g[2].length + g[3].length;
    setGrade(g[1], g[3], t.slice((g.index || 0) + headLen), g[2]);
  }
  if (out.gradeNum == null) {
    GRADE_ANY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = GRADE_ANY_RE.exec(t))) {
      const n = parseFloat(m[3]);
      if (!isGrader(m[1]) || AUTO_GAP_RE.test(m[2]) || !(n >= 1 && n <= 10)) continue;
      setGrade(m[1], m[3], t.slice(m.index + m[0].length), m[2]);
      break;
    }
  }
  if (out.gradeNum == null) {
    let tag: RegExpExecArray | null = null;
    GRADE_TAG_RE.lastIndex = 0;
    for (let m = GRADE_TAG_RE.exec(t); m; m = GRADE_TAG_RE.exec(t)) if (isGrader(m[1])) { tag = m; break; }
    if (tag) { out.gradeCo = tag[1].toUpperCase(); out.gradeTag = 'A'; }
    else {
      GRADER_ANY_RE.lastIndex = 0;
      for (let m = GRADER_ANY_RE.exec(t); m; m = GRADER_ANY_RE.exec(t)) if (isGrader(m[1])) { out.gradeUnparsed = true; break; }
    }
  }
  // the AUTOGRAPH grade (dual-graded signed slabs): PSA/DNA or "Auto N"
  // (1–10, no grader named in the gap, never across '#'), else the
  // comma-separated second grade of a signed card ("BGS 9.5, Beckett 10")
  {
    AUTO_GRADE_RE.lastIndex = 0;
    for (let m = AUTO_GRADE_RE.exec(t); m; m = AUTO_GRADE_RE.exec(t)) {
      const n = parseFloat(m[2]);
      if (GRADER_WORD_IN_GAP.test(m[1]) || !(n >= 1 && n <= 10)) continue;
      out.autoGrade = m[2]; break;
    }
    if (out.autoGrade == null && /\b(autograph\w*|signed|signature|auto)\b/i.test(t)) {
      const sg = t.match(SECOND_GRADE_RE) || t.match(WITH_SIG_GRADE_RE);
      if (sg) { const n = parseFloat(sg[1]); if (n >= 1 && n <= 10) out.autoGrade = sg[1]; }
    }
    if (out.autoGrade == null && AUTO_AUTH_RE.test(t)) out.autoGrade = 'A';
  }

  const ser = t.match(SERIAL_RE);
  if (ser) out.serialOf = parseInt(ser[1], 10);

  out.rookie = /\brookie\b|\bRC\b/i.test(t);
  out.auto = /\b(autograph|signed|auto)\b/i.test(t);

  // year: leading 4-digit (with optional -yy) or bare 2-digit ('96, 21, 00).
  // A LOT NUMBER may lead ("77 1962 Topps …" — Memory Lane / Lelands / LOTG):
  // a short number directly before a 4-digit year is skipped, never read as a
  // '77 two-digit year (Sep 28 2026: it minted 1977 for a 1962 card).
  const lotPre = (t.match(LOT_NO_BEFORE_YEAR) || [''])[0];
  const ty = t.slice(lotPre.length);
  // (Oct 6) a 4-digit range end ("1986-1987 Fleer" — REA/Lelands) and a
  // 2-digit range ("34-36 Diamond Stars") are the YEAR, not the set's first
  // word: both read as "1986-87" / "1934-36"
  const y4 = ty.match(/^(19\d{2}|20\d{2})(?:-((?:19|20)\d{2}|\d{2}))?\b/);
  const y2 = !y4 && ty.match(/^'?(\d{2})(?:-(\d{2}))?\b/);
  if (y4) out.year = y4[2] ? `${y4[1]}-${y4[2].slice(-2)}` : y4[1];
  else if (y2) {
    const n = parseInt(y2[1], 10);
    out.year = (n > 40 ? `19${y2[1]}` : `20${y2[1]}`) + (y2[2] ? `-${y2[2]}` : '');
  }

  // card number: the first # group NOT inside parens (serials live in parens)
  const noParens = t.replace(/\([^)]*\)/g, ' ');
  const no = noParens.match(/#([A-Za-z0-9/.-]+)/);
  if (no) out.cardNo = no[1].toUpperCase();

  // set: the words between the year and the #cardNo (insert/parallel included —
  // deliberately: "Topps Finest Mystery Borderless" IS the market identity)
  if (out.year && no) {
    // slice off the ^-anchored matched year prefix by LENGTH — indexOf on the
    // year's last two digits landed inside the year itself whenever they
    // repeat its start ("2020 Panini Prizm" → setName "20 Panini Prizm",
    // "2000 Bowman" → "0 Bowman"), corrupting every 2020-set identity.
    const yrRaw = lotPre + (y4 ? y4[0] : y2 ? y2[0] : '');
    const afterYear = noParens.slice(yrRaw.length);
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

  // VARIANT signature (Sep 27): parallel / auto / relic / serial-class tokens
  // anywhere in the title, with the player's own name and colour-word team
  // names masked ("Vida Blue", "Red Sox" are not parallels)
  // (Oct 6) an MBA "Silver/Gold Diamond Certified" sticker is not a parallel
  let vt = t.replace(TEAM_MASK_RE, ' ').replace(/\bMBA\s+(?:silver|gold|platinum|black|red|blue)\s+diamond(?:\s+certified)?\b/gi, ' ');
  if (out.player) vt = vt.split(out.player).join(' ');
  const toks: string[] = [];
  for (const [re, tok] of VARIANT_TOKENS) if (re.test(vt) && !toks.includes(tok)) toks.push(tok);
  out.variant = toks.length ? toks.sort().join('+') : null;

  // MULTI-CARD lots (Oct 6): a set / pair / "Collection (25)" / two card
  // numbers is several cards — its price is never one card's
  out.multi = isMultiCardTitle(t);
  return out;
}

/* ── KNOWN PLAYERS (Oct 6 2026 categorization audit) — an OBJECT title's
   leading capitalized run is a player only about half the time ("Baseball
   Hall", "New York Giants", "BEST OF THE", "The Beatles", "Claire Ruth Cut"
   were stamped as players on ≥17.9k lots). Card titles name the player in a
   fixed slot, so the set of players the CARD parser has read ≥ minCount
   times is the roster an object name must belong to. Team / set / checklist
   runs that card titles also produce are excluded by word. */
const NOT_A_PLAYER_WORD = /\b(team|teams|checklist|leaders?|league|leagues|rookies|stars|all|world|series|highlights?|cards?|set|sets|collection|lot|hall|fame|champions?|championship|giants|yankees|dodgers|cubs|sox|cardinals|tigers|pirates|athletics|senators|browns|braves|reds|phillies|orioles|indians|colts|packers|bears|celtics|lakers|bulls|knicks|canadiens|bruins|rangers|mets|jets|patriots|cowboys|steelers|49ers|raiders|eagles|lions|rams|chiefs|broncos|giants|warriors|heat|nets|spurs|beatles|stones|best|the|of|and|edition|special|in|action|record|breaker|boyhood|photo|future|prospects?|draft|picks?|batting|pitching|home|run|kings?|super|bowl|unopened|box|pack|wax|sports|illustrated|press|pass|panini|topps|upper|deck)\b/i;
export function knownPlayerSet(cardPlayers: Iterable<string | null | undefined>, minCount = 3): Set<string> {
  const n = new Map<string, number>();
  for (const name of Array.from(cardPlayers)) {
    if (!name) continue;
    const words = name.trim().split(/\s+/);
    if (words.length < 2 || words.length > 4 || NOT_A_PLAYER_WORD.test(name)) continue;
    const slug = playerSlugOf(name);
    if (slug) n.set(slug, (n.get(slug) || 0) + 1);
  }
  const out = new Set<string>();
  n.forEach((c, k) => { if (c >= minCount) out.add(k); });
  return out;
}
/** an object-title name accepted only if it (or its first two words) is a known player */
function gateKnown(name: string | null, known?: ReadonlySet<string>): { player: string | null; playerSlug: string | null } {
  const slug = playerSlugOf(name);
  if (!known) return { player: name, playerSlug: slug };
  if (!name || !slug) return { player: null, playerSlug: null };
  if (known.has(slug)) return { player: name, playerSlug: slug };
  const two = name.trim().split(/\s+/).slice(0, 2).join(' ');
  const twoSlug = playerSlugOf(two);
  if (two !== name && twoSlug && known.has(twoSlug)) return { player: two, playerSlug: twoSlug };
  return { player: null, playerSlug: null };
}

/** (Oct 6) Several cards in one lot: a set / pair / "Collection (25)" / two
 *  card numbers outside parens (a "#42/49" serial is not a second card). */
export function isMultiCardTitle(title: string): boolean {
  const t = title || '';
  if (MULTI_CARD_RE.test(t)) return true;
  const noParens = t.replace(/\([^)]*\)/g, ' ').replace(/#?\d+\s*\/\s*\d+/g, ' ');
  return (noParens.match(/#\s?[A-Za-z]{0,4}\d/g) || []).length >= 2;
}

/** The player behind ANY sports lot: cards parse mid-title; objects (game-used
 *  jerseys, tickets, trophies) lead with the athlete's name. With `known`
 *  (knownPlayerSet over the corpus's card parses), an object-title name is
 *  kept only when it is a known player. */
export function playerOf(title: string, slug: string, known?: ReadonlySet<string>): { player: string | null; playerSlug: string | null } {
  if (slug === 'sports-cards') {
    const c = parseCard(title);
    return { player: c.player, playerSlug: c.playerSlug };
  }
  // object titles lead with the athlete — often after a year ("1986 Michael
  // Jordan Game-Worn…") or a year-range; strip that prefix first
  const YEAR_PREFIX = /^['’]?\d{2,4}(?:-\d{2,4})?\s+/;
  const stripped = (title || '').replace(YEAR_PREFIX, '');
  // a leading lot number ("13 1959 Topps …") hides the brand one token deeper;
  // only the brand test looks past it — the object-title reads below keep
  // their old input (past the lot number they would mint team/set names
  // like "Chicago Bulls Eastern" as players)
  const branded = (title || '').replace(LOT_NO_BEFORE_YEAR, '').replace(YEAR_PREFIX, '');
  // card-style object titles (game-used PATCH/relic cards: "2005 Upper Deck
  // Exquisite #… Jordan Patch") lead with a BRAND, not the athlete — the card
  // parser reads those correctly (player after the #number)
  if (/^(Upper Deck|Panini|Topps|Fleer|Donruss|Bowman|Leaf|Skybox|Score|Pro Set|Pinnacle|Stadium Club|O-Pee-Chee|Hoops|Select|Mosaic|Prizm|Optic|National Treasures|Immaculate|Flawless|Exquisite)\b/i.test(branded)) {
    const c = parseCard(title);
    return { player: c.player, playerSlug: c.playerSlug };
  }
  // STRUCTURED HOUSE TITLES (NFL/MLB Auction): "{Sale prefix} - {Team} {Player}
  // Game (Worn|Used|Issued) …". The leading run before the dash is sale
  // BRANDING ("London Games", "Crucial Catch"), not a person — it minted a
  // pseudo-player that pooled the whole vertical together (Aug 30 2026).
  // Parse the segment between the dash and the use-class token, dropping a
  // leading team name.
  const structured = stripped.match(
    /-\s+((?:[A-Z][\w'’.-]*[\w.]\s+){1,5}?)Game[- ](?:Worn|Used|Issued)/
  );
  if (structured) {
    const words = structured[1].trim().split(/\s+/);
    // drop leading team token(s) — NFL/MLB franchise names are single words
    // here ("Jets", "Dolphins", "49ers", "Yankees"); two-word city forms don't
    // appear in these feeds. Anything left is the athlete.
    const TEAMS = /^(Cardinals|Falcons|Ravens|Bills|Panthers|Bears|Bengals|Browns|Cowboys|Broncos|Lions|Packers|Texans|Colts|Jaguars|Chiefs|Raiders|Chargers|Rams|Dolphins|Vikings|Patriots|Saints|Giants|Jets|Eagles|Steelers|49ers|Seahawks|Buccaneers|Titans|Commanders|Redskins|Football|Yankees|Mets|Dodgers|Cubs|Sox|Astros|Braves|Padres|Phillies|Mariners|Angels|Athletics|Orioles|Royals|Tigers|Twins|Guardians|Indians|Rangers|Blue|Jays|Marlins|Nationals|Pirates|Reds|Rockies|Brewers|Diamondbacks)$/i;
    while (words.length > 1 && TEAMS.test(words[0])) words.shift();
    const cand = words.join(' ');
    if (words.length >= 2 && !NAME_STOP.test(words[0])) {
      // the structured NFL/MLB-Auction slot is reliable on its own — no gate
      return { player: cand, playerSlug: playerSlugOf(cand) };
    }
    return { player: null, playerSlug: null };
  }
  const m = stripped.match(LEADING_PLAYER);
  const name = m ? trimNameRun(m[1]) : null;
  // reject non-person leads ("World Series", "Super Bowl", team-ish runs,
  // sale branding — "London Games", "Crucial Catch", "Salute to Service")
  if (name && /\b(World|Series|Super|Bowl|Olympic|Stanley|Final|Champion|League|Team|City|United|Yankees|Lakers|Cowboys|Collection|Games|Catch|Salute|Auction|Lot\b)/i.test(name)) {
    return { player: null, playerSlug: null };
  }
  const g = gateKnown(name, known);
  // an unknown name directly followed by USE language ("Andy Barkett Game
  // Used …") is still the athlete — game-used lots exist for players no card
  // set carries
  if (!g.player && name && known && !NOT_A_PLAYER_WORD.test(name)
    && stripped.startsWith(name) && /^\s+(?:Game|Match|Player|Team)[- ](?:Used|Worn|Issued)/i.test(stripped.slice(name.length))) {
    return { player: name, playerSlug: playerSlugOf(name) };
  }
  return g;
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

/** The exact-identity key a card COMPS on (Sep 27 2026, tightened): same
 *  player + year + set + card number + GRADE COMPANY + GRADE (+ qualifier
 *  (OC/MK…) / Authentic tag) + the parallel/variant signature + the serial
 *  print run when present = the same tradable thing. Null when the identity is
 *  too partial to trust — including a title that NAMES a grader whose grade
 *  didn't parse (it is never silently 'raw': that merged a PSA 9 Koufax
 *  rookie with raw copies, $2,730 vs $604,736). */
export function cardKey(id: CardId): string | null {
  const base = cardLadderKey(id);
  if (!base) return null;
  if (id.gradeUnparsed) return null;
  const grade = id.gradeCo
    ? `${id.gradeCo}${id.gradeNum ?? id.gradeTag ?? ''}${id.gradeQual ? `-${id.gradeQual.toLowerCase()}` : ''}${id.gradeTier ? `-${id.gradeTier}` : ''}`
    : 'raw';
  return `${base}|${grade}`;
}

/** (Oct 6) The YEAR as keyed: a one-season range ("1986-87", Goldin's '87,
 *  H&S "1986-87", REA "1986-1987") is the season's END year — Goldin's
 *  two-digit form, the deepest card pool; a wider span ("1934-36", "1909-11"
 *  — the card's own year unknown) stays the span. */
export function cardYearKey(year: string | null | undefined): string | null {
  if (!year) return null;
  const m = year.match(/^(\d{4})-(\d{2})$/);
  if (!m) return year;
  const start = parseInt(m[1], 10);
  const end = Math.floor(start / 100) * 100 + parseInt(m[2], 10) + (parseInt(m[2], 10) < start % 100 ? 100 : 0);
  return end === start + 1 ? String(end) : year;
}

// sport words houses add or omit ("1955 Topps Baseball" = Goldin "55 Topps")
const SET_SPORT_RE = /\b(?:baseball|basketball|football|hockey|soccer)\b/gi;
// a leading American Card Catalog code before the set's name ("R319 Goudey",
// "M101-4 Sporting News", "V353 World Wide Gum") — dropped only when a name
// follows, so a bare "T206" stays the set
const SET_CATALOG_RE = /^(?:[A-Z]{1,2}\d{2,3}(?:-\d{1,2})?)\s+(?=\S)/;
/** (Oct 6) The SET as keyed: no sport word, no leading catalog code, no
 *  year-range tail ("-36 Diamond Stars", "1987 Fleer" — older parses) — so
 *  REA / H&S / Memory Lane join Goldin's card keys. */
export function cardSetKey(setName: string | null | undefined): string {
  let s = (setName || '').trim().replace(/^-?(?:\d{4}|\d{2})\b\s*/, '');
  s = s.replace(SET_CATALOG_RE, '').replace(SET_SPORT_RE, ' ');
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Same card, any grade — the ladder key: player + year + set + number +
 *  variant signature + serial run (a /99 Gold parallel is a different card
 *  from the base, at every grade). */
export function cardLadderKey(id: CardId): string | null {
  if (!id.playerSlug || !id.year || !id.cardNo || id.multi) return null;
  const set = cardSetKey(id.setName);
  const v = id.variant ? `|v:${id.variant}` : '';
  const s = id.serialOf ? `|/${id.serialOf}` : '';
  const ag = id.autoGrade ? `|ag:${id.autoGrade}` : '';
  return `${id.playerSlug}|${cardYearKey(id.year)}|${set}|${id.cardNo.toLowerCase()}${v}${s}${ag}`;
}
