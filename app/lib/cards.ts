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
  /** (Oct 6 identity re-audit) a comic book / magazine issue filed with the
   *  cards (CGC-graded comics at H&S, SLAM newsstand covers) — never a card
   *  identity: cardKey/cardLadderKey abstain */
  notCard?: boolean;
  /** (Oct 6, categorization wave 3) the American Card Catalog code of a
   *  pre-war card that prints NO card number ("T206", "E90-1", "N172") — with
   *  the player and `pose` it is the card's identity; null otherwise */
  catalog?: string | null;
  /** (wave 3) a catalog card's pose / team / background / back words
   *  ("portrait-green-background", "bat-on-shoulder", "boston") — T206 Cobb
   *  has four poses, Dahlen a Boston and a Brooklyn card */
  pose?: string | null;
}

/* ── PRE-WAR CATALOG CARDS (Oct 6 2026, categorization wave 3) — 85k single
   cards (T206, T205, E90, N172 …) print no card number, so the parser read no
   player and no key. Their identity is catalog code + player + pose / team /
   background / back: "1909-1911 T206 White Border Ty Cobb Portrait Green
   Background", "1912 T207 Brown Background Mike Mitchell Cincinnati PSA GOOD
   2". The player is the 2-word capitalised run (3 with a middle initial)
   right before the first pose / team / grade word; the issue's brand words
   before it ("White Border", "George Close Candy") are skipped. */
const CATALOG_RE = /\b((?:[TEDMNRWH]|PC|WG)-?\d{1,3}(?:-\d{1,2})?)\b/;
const CATALOG_MULTI_RE = /\(\d[\d,+]*\)|\b(?:collection|lots?|pair|trio|quartet|group|sets?|run|folders?|team card|uncut|panel|sheet|album|box|pack|wrapper|display|banner|poster|proof|lithograph|premium|cabinets?|and|with)\b|&|\//i;
const CATALOG_GRADE_CUT_RE = /\s(?:-|–|—)\s|\b(?:PSA|SGC|BVG|BGS|GAI|CGC|KSA|GMA|Beckett|Graded|Authentic)\b|\(|!|,/;
const POSE_WORDS = new Set(('portrait batting bat bats fielding throwing pitching catching hands hand glove arms arm cap front follow-through follow leaning horizontal sliding kneeling bare closed open mouth finger dark light white red green blue brown orange yellow gold pink pastel background no name error variation southern leaguer back shows near ground over head up down on off shoulder chest waist knees ready to hit left right looking facing ball sleeves sweater').split(' '));
const TEAM_WORDS = new Set(('boston brooklyn chicago cincinnati cleveland detroit new york philadelphia pittsburgh st. st louis washington baltimore buffalo providence newark jersey toronto montreal kansas city minneapolis milwaukee indianapolis louisville columbus rochester atlanta nashville memphis birmingham mobile montgomery chattanooga little rock orleans shreveport portsmouth nationals americans national american league nl al sox cubs giants phillies').split(' '));
const BACK_WORDS = /^(?:polar|bear|sovereign|piedmont|sweet|caporal|old|mill|hindu|tolstoi|drum|uzit|lenox|broad|leaf|broadleaf|cycle|carolina|brights|beauty|hassan|ty|cobb|el|principe|gales|\d{3})$/;
const ISSUE_WORDS = new Set(('border borders background tobacco cigarettes cigarette candy caramel caramels bakery bread gum baking co. co bros. bros company anonymous series type cards card old judge mill sweet caporal hassan mecca fatima piedmont polar bear ramly obak coupon turkey cabinets postcards postcard sepia strip champions prize fighters cracker sporting news supplements supplement exhibits exhibit tango eggs brand standard general clement fleischmann close creole hess california goodwin duke kimball allen ginter honest long cut plug dixie lids pins pin silks silk blankets felts life zeenut world wide goudey chicle diamond stars portraits action big chewing helmar stamps stamp swamp garter chips contentnea photo cycle sovereign beauty broad hindu tolstoi uzit drum lenox carolina brights mono rochester dockman sons publications kashin pastel').split(' '));
function catalogIdentity(t: string): { player: string; code: string; pose: string | null } | null {
  const s = t.replace(/&quot;|["“”]/g, '"').replace(/&amp;/g, '&');
  if (s.includes('#')) return null;
  const cm = s.match(CATALOG_RE);
  if (!cm) return null;
  if (CATALOG_MULTI_RE.test(s.replace(/\b(?:white|gold) borders?\b/gi, ' ').replace(/"[^"]*"/g, ' '))) return null;
  const code = cm[1].toLowerCase().replace(/^([a-z]+)-/, '$1');
  // quoted sub-brands ("Set of 30", "Series 6") separate the issue from the name
  const rest = s.slice((cm.index || 0) + cm[0].length).replace(/"[^"]*"/g, ' | ');
  const cut = rest.search(CATALOG_GRADE_CUT_RE);
  const head = (cut >= 0 ? rest.slice(0, cut) : rest).trim();
  const tail = cut >= 0 ? rest.slice(cut) : '';
  const words = head.split(/\s+/).filter(Boolean);
  // the issue's own words lead ("White Border", "Brown Background", "Old Judge")
  const lw = (w: string) => w.toLowerCase().replace(/[^a-z.'-]/g, '');
  let start = 0;
  while (start < words.length && (ISSUE_WORDS.has(lw(words[start])) || POSE_WORDS.has(lw(words[start])))) start++;
  let end = words.length;
  for (let i = start + 1; i < words.length; i++) {
    const w = words[i].toLowerCase().replace(/[^a-z.'-]/g, '');
    if (POSE_WORDS.has(w) || POSE_WORDS.has(w.split('-')[0]) || TEAM_WORDS.has(w)) { end = i; break; }
  }
  const bar = words.slice(0, end).lastIndexOf('|');
  const nameWords = words.slice(bar + 1, end);
  if (nameWords.length < 2) return null;
  const n = nameWords.length >= 3 && /^[A-Z]\.$/.test(nameWords[nameWords.length - 2]) ? 3 : 2;
  const name = nameWords.slice(-n);
  if (name.some(w => !/^[A-Z][A-Za-z.'’-]*$/.test(w) || (ISSUE_WORDS.has(w.toLowerCase()) && !/^(?:Cobb|Ty|Jack|George|Red|Bill|Duke|Long|Old)$/.test(w)))) return null;
  const poseToks = words.slice(end).concat(tail.split(/\s+/))
    .map(w => w.toLowerCase().replace(/[^a-z0-9-]/g, ''))
    .flatMap(w => (POSE_WORDS.has(w) ? [w] : w.split('-')))
    .filter(w => POSE_WORDS.has(w) || TEAM_WORDS.has(w) || BACK_WORDS.test(w));
  const pose = Array.from(new Set(poseToks)).join('-') || null;
  return { player: name.join(' '), code, pose };
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
// (Oct 6 identity re-audit) set and person names that carry a colour /
// pattern word are masked the same way: 'Turkey Red' (T3) and 'Red Man'
// (tobacco) are sets, not Red parallels (1,897 keys); 'Tiger Woods' in a
// multi-player title is not a Tiger-stripe pattern
const TEAM_MASK_RE = /\b(turkey red|red man|tiger woods|red sox|white sox|blue jays|red wings|green bay|golden state|golden knights|blue devils|crimson tide|orange bowl|black knights|silver bullets|gold rush|browns|reds|blues|golden bears|redskins|green wave|royals)\b/gi;
const VARIANT_TOKENS: [RegExp, string][] = [
  [/\b(?:autograph(?:ed)?|signed|auto)\b/i, 'auto'],
  [/\b(?:patch|jersey|relic|swatch|memorabilia)\b/i, 'relic'],
  [/\b(?:super)fractor\b/i, 'superfractor'],
  [/\b(?:x-?fractor|refractor)\b/i, 'refractor'],
  [/\bprinting plate\b/i, 'plate'],
  [/\b(?:1\/1|one of one)\b/i, '1of1'],
  [/\b(?:variation|var\.|image variation|photo variation)\b/i, 'var'],
  [/\berror\b/i, 'error'],
  // (read outside the set name and card number, modern cards only — SP_TOKEN)
  [/\bs?sp\b|\bshort print\b/i, 'sp'],
  [/\bdie[- ]?cut\b/i, 'diecut'],
  [/\bholo(?:foil|gram)?\b/i, 'holo'],
  [/\b(?:shimmer|mojo|wave|cracked ice|atomic|camo|tie[- ]dye|neon|disco|hyper|pulsar|la[sz]er|snakeskin|zebra|tiger|scope|velocity|lucky envelopes?|fast break|choice|no huddle|sparkle|glitter)\b/i, 'pattern'],
  [/\b(?:silver|gold|red|blue|green|orange|purple|pink|black|bronze|platinum|yellow|teal|aqua|emerald|ruby|sapphire)\b/i, 'color'],
  // (Oct 6, pricing wave 2) named print variations the hand-judged live
  // sample caught pooled with the base card: the 2018 Bowman Chrome #1 Ohtani
  // "Carrying Bag" SP ($23.5k) with the "Batting" base ($6–7k); the 1969 Topps
  // Mantle "Last Name in Yellow" vs white letters; the 1956 Topps Gray vs
  // White Back
  [/\bcarrying bag\b/i, 'bag'],
  [/\b(?:(?:last |first )?name in yellow|yellow (?:letters?|lettering|name))\b/i, 'yellowletter'],
  [/\b(?:(?:last |first )?name in white|white (?:letters?|lettering|name))\b/i, 'whiteletter'],
  [/\bgr[ae]y back\b/i, 'grayback'],
  [/\bwhite back\b/i, 'whiteback'],
];
/** (Oct 6 identity re-audit) 'SP' is a variant only when the house names a
 *  short print OUTSIDE the set name and card number ("SP Authentic", "SP Game
 *  Used", "#SP-JAZ" are the product / the number — 3.1k keys), and only on a
 *  modern card: a pre-1980 "SP" / "Short Print" is a scarcity note on the
 *  base card (1948-49 Leaf, 1953 Topps) some houses print and others don't —
 *  it split one card's sales across two keys (737). */
const SP_TOKEN = 'sp';
/** (Oct 6 identity re-audit) a comic book or magazine issue keyed as a card:
 *  H&S files CGC-graded Marvel/Timely/DC comics with its cards, Goldin SLAM
 *  newsstand covers. Card products named for a magazine or comic (Bazooka
 *  Comics, Sports Illustrated for Kids, Life Magazine hand-cuts, magazine
 *  promo cards) carry a card word or brand and stay cards. */
const MONTH_ISSUE = '(?:jan|feb|mar|apr|may|june?|july?|aug|sept?|oct|nov|dec)[a-z]*';
const NOT_A_CARD_RE = new RegExp(String.raw`\bcomic books?\b|\b(?:marvel|dc|timely|quality|leading|atlas|fawcett|classic|gold key|dell|harvey|archie|ec) comics\b|\bnewsstand\b|\b(?:first|1st|last) issue\b|\bvol(?:ume)?\.? \d+,? #\d|#\d+[a-z]? ${MONTH_ISSUE} (?:19|20)\d\d\b`, 'i');
const COMIC_APPEARANCE_RE = /\b(?:first|1st|early|second) (?:[a-z]+ )?appearance\b/i;
const CARD_PRODUCT_WORD_RE = /\b(?:cards?|topps|fleer|bowman|bazooka|upper deck|panini|donruss|leaf|promo|stickers?|insert)\b/i;
/** a comic book / magazine issue title (never a card identity) */
export function isComicOrMagazineTitle(title: string): boolean {
  const t = title || '';
  return (NOT_A_CARD_RE.test(t) || (COMIC_APPEARANCE_RE.test(t) && /\bCGC\b/.test(t))) && !CARD_PRODUCT_WORD_RE.test(t);
}
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

// (Oct 6 identity re-audit) a LEADING name run (object titles, lot-style card
// titles) also ends at a sport word or postseason descriptor: "Wayne Gretzky
// Hockey Card", "Mickey Mantle Baseball", "Matt Moore Playoff Debut". Not
// after a card number, where "#197 NL Playoffs Game 3" is the subset card's
// own identity.
const LEAD_NAME_STOP = /^(?:Baseball|Football|Basketball|Hockey|Soccer|Playoffs?|Postseason)$/i;

function trimNameRun(run: string, lead = false): string | null {
  // a grader glued on by dashes ("Hank Aaron--PSA Gem Mint 10", "Babe Ruth-SGC")
  const words = run.trim().replace(/-+(?=(?:PSA|BGS|SGC|CGC|BVG)\b)/g, ' ').split(/\s+/);
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // stop on descriptors, INCLUDING hyphenated ones ("Game-Used", "Photo-Matched")
    if (NAME_STOP.test(w) || NAME_STOP.test(w.split('-')[0])) break;
    if (lead && LEAD_NAME_STOP.test(w)) break;
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
    gradeTier: null, multi: false, notCard: false,
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
  const lead = !run ? (() => { const m = t.match(LEADING_PLAYER); return m ? trimNameRun(m[1], true) : null; })() : null;
  out.player = run || lead;
  out.playerSlug = playerSlugOf(out.player);

  // VARIANT signature (Sep 27): parallel / auto / relic / serial-class tokens
  // anywhere in the title, with the player's own name and colour-word team
  // names masked ("Vida Blue", "Red Sox" are not parallels)
  // (Oct 6) an MBA "Silver/Gold Diamond Certified" sticker is not a parallel
  let vt = t.replace(TEAM_MASK_RE, ' ').replace(/\bMBA\s+(?:silver|gold|platinum|black|red|blue)\s+diamond(?:\s+certified)?\b/gi, ' ');
  if (out.player) vt = vt.split(out.player).join(' ');
  let spScope = vt;
  if (out.setName) spScope = spScope.split(out.setName).join(' ');
  spScope = spScope.replace(/#[A-Za-z0-9/.-]+/g, ' ');
  const vintage = !!out.year && parseInt(out.year, 10) < 1980;
  const toks: string[] = [];
  for (const [re, tok] of VARIANT_TOKENS) {
    const src = tok === SP_TOKEN ? (vintage ? '' : spScope) : vt;
    if (re.test(src) && !toks.includes(tok)) toks.push(tok);
  }
  out.variant = toks.length ? toks.sort().join('+') : null;

  // MULTI-CARD lots (Oct 6): a set / pair / "Collection (25)" / two card
  // numbers is several cards — its price is never one card's
  out.multi = isMultiCardTitle(t);
  out.notCard = isComicOrMagazineTitle(t);
  // (wave 3) a numberless pre-war catalog card: player + code + pose
  if (!out.cardNo && !out.multi && !out.notCard) {
    const cat = catalogIdentity(t);
    if (cat) {
      out.player = cat.player; out.playerSlug = playerSlugOf(cat.player);
      out.catalog = cat.code; out.pose = cat.pose;
      if (!out.setName) out.setName = cat.code.toUpperCase();
    }
  }
  return out;
}

/* ── KNOWN PLAYERS (Oct 6 2026 categorization audit) — an OBJECT title's
   leading capitalized run is a player only about half the time ("Baseball
   Hall", "New York Giants", "BEST OF THE", "The Beatles", "Claire Ruth Cut"
   were stamped as players on ≥17.9k lots). Card titles name the player in a
   fixed slot, so the set of players the CARD parser has read ≥ minCount
   times is the roster an object name must belong to. Team / set / checklist
   runs that card titles also produce are excluded by word. */
// (Oct 6) + lot-description leads that a card parse now stops at the sport
// word on ("Assorted Brands Baseball …", "Nineteenth Century Baseball …")
const NOT_A_PLAYER_WORD = /\b(type|original|signed|kanji-signed|kanji|assorted|brands|vintage|modern|century|nineteenth|various|greats|hofers?|hof|team|teams|checklist|leaders?|league|leagues|rookies|stars|all|world|series|highlights?|cards?|set|sets|collection|lot|hall|fame|champions?|championship|giants|yankees|dodgers|cubs|sox|cardinals|tigers|pirates|athletics|senators|browns|braves|reds|phillies|orioles|indians|colts|packers|bears|celtics|lakers|bulls|knicks|canadiens|bruins|rangers|mets|jets|patriots|cowboys|steelers|49ers|raiders|eagles|lions|rams|chiefs|broncos|giants|warriors|heat|nets|spurs|beatles|stones|best|the|of|and|edition|special|in|action|record|breaker|boyhood|photo|future|prospects?|draft|picks?|batting|pitching|home|run|kings?|super|bowl|unopened|box|pack|wax|sports|illustrated|press|pass|panini|topps|upper|deck)\b/i;
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

/** (Oct 6 identity re-audit) a structured NFL/MLB-Auction slot that names a
 *  national or minor-league TEAM (World Baseball Classic, MiLB at Dyersville) */
const STRUCTURED_TEAM_SLOT = /^(?:Great Britain|Dominican Republic|Puerto Rico|Chinese Taipei|Czech Republic|Czechia|South Africa|Kingdom of the Netherlands|(?:Team )?(?:USA|Japan|Mexico|Korea|Italy|Israel|Canada|Netherlands|Venezuela|Cuba|Australia|Colombia|Panama|Nicaragua|China|Germany|Spain|France|Brazil)|(?:[A-Z][a-z.]+ ){1,2}(?:Saints|Cubs|Bulls|Barons|Indians|Stars|Dragons|Bees|Kernels|Sounds|Isotopes|Aces|Bats|Chihuahuas|Express|Storm Chasers|RiverDogs|Hot Rods))$/;

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
    const pre = structured[1].trim();
    // (Oct 6 identity re-audit) the MLB-Auctions WBC / MiLB form names the
    // TEAM before the use-class and the athlete after the object: "… - Great
    // Britain Game-Used Jersey - Tristan Beck (3/7/26)", "St. Paul Saints
    // Game-Used Jersey: Ben Ross #48" — 'Great Britain', 'Dominican Republic',
    // 'St. Paul Saints' were stamped as players. Only when the leading slot
    // is such a team is the trailing slot read (Goldin's "… - David Ortiz
    // Game-Used OWS Baseball - Foul Tip" keeps its leading athlete).
    if (STRUCTURED_TEAM_SLOT.test(pre)) {
      const tail = stripped.slice((structured.index || 0) + structured[0].length).replace(/&#0?39;|&apos;/g, "'")
        .match(/^\s+[A-Za-z]+(?:\s+[A-Za-z]+){0,3}\s*[:–—-]\s+([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){1,3})/);
      const tailName = tail ? trimNameRun(tail[1]) : null;
      return tailName ? { player: tailName, playerSlug: playerSlugOf(tailName) } : { player: null, playerSlug: null };
    }
    const words = pre.split(/\s+/);
    // drop leading team token(s) — NFL/MLB franchise names are single words
    // here ("Jets", "Dolphins", "49ers", "Yankees"); two-word city forms don't
    // appear in these feeds. Anything left is the athlete.
    const TEAMS = /^(Cardinals|Falcons|Ravens|Bills|Panthers|Bears|Bengals|Browns|Cowboys|Broncos|Lions|Packers|Texans|Colts|Jaguars|Chiefs|Raiders|Chargers|Rams|Dolphins|Vikings|Patriots|Saints|Giants|Jets|Eagles|Steelers|49ers|Seahawks|Buccaneers|Titans|Commanders|Redskins|Football|Yankees|Mets|Dodgers|Cubs|Sox|Astros|Braves|Padres|Phillies|Mariners|Angels|Athletics|Orioles|Royals|Tigers|Twins|Guardians|Indians|Rangers|Blue|Jays|Marlins|Nationals|Pirates|Reds|Rockies|Brewers|Diamondbacks)$/i;
    while (words.length > 1 && TEAMS.test(words[0])) words.shift();
    // a qualifier the house puts before "Game Worn" ends the name ("Quentin
    // Johnston Signed Game Worn", "Teair Tart Signed Yellow Game Worn") —
    // '<Name> Signed' was minted as a player on ~140 NFL Auction lots
    const stop = words.findIndex((w, i) => i > 0 && (NAME_STOP.test(w) || LEAD_NAME_STOP.test(w)));
    if (stop > 0) words.splice(stop);
    const cand = words.join(' ');
    if (words.length >= 2 && !NAME_STOP.test(words[0])) {
      // the structured NFL/MLB-Auction slot is reliable on its own — no gate
      return { player: cand, playerSlug: playerSlugOf(cand) };
    }
    return { player: null, playerSlug: null };
  }
  const m = stripped.match(LEADING_PLAYER);
  const name = m ? trimNameRun(m[1], true) : null;
  // reject non-person leads ("World Series", "Super Bowl", team-ish runs,
  // sale branding — "London Games", "Crucial Catch", "Salute to Service")
  if (name && /\b(World|Series|Super|Bowl|Olympic|Stanley|Final|Champion|League|Team|City|United|Yankees|Lakers|Cowboys|Collection|Games|Catch|Salute|Auction|Lot\b)/i.test(name)) {
    return knownPlayerIn(title, known);
  }
  const g = gateKnown(name, known);
  // an unknown name directly followed by USE language ("Andy Barkett Game
  // Used …") is still the athlete — game-used lots exist for players no card
  // set carries
  if (!g.player && name && known && !NOT_A_PLAYER_WORD.test(name)
    && stripped.startsWith(name) && /^\s+(?:Game|Match|Player|Team)[- ](?:Used|Worn|Issued)/i.test(stripped.slice(name.length))) {
    return { player: name, playerSlug: playerSlugOf(name) };
  }
  return g.player ? g : knownPlayerIn(title, known);
}

/** (Oct 6 2026, categorization wave 3) The ONE known player an object title
 *  names anywhere in its head — the leading-run reader misses a date or lot
 *  number prefix ("9/1/1957 Jim Brown Signed …", "Jan. 1996 - Kobe Bryant
 *  Signed …", "146 1918 Christy Mathewson …"), a descriptor lead ("Scarce
 *  Connie Mack Signed …", "HIGH-GRADE JACKIE ROBINSON SIGNED …") and
 *  Sotheby's lower-case NBA titles ("grayson allen … game worn jersey").
 *  2–3 word windows over the first 10 words, matched against the known-player
 *  set; a title naming two different known players is a multi-player piece
 *  (no player). Only with `known`. */
/** two-word places card parses mint as "players" ("San Francisco Giants") */
const PLACE_SLUGS = new Set(['san-francisco', 'new-york', 'los-angeles', 'st-louis', 'kansas-city', 'new-jersey', 'tampa-bay', 'green-bay', 'san-diego', 'new-england', 'new-orleans', 'golden-state', 'oklahoma-city', 'san-antonio', 'las-vegas', 'salt-lake', 'el-paso', 'santa-clara', 'notre-dame', 'ohio-state', 'penn-state', 'north-carolina', 'south-carolina', 'west-virginia', 'hall-fame', 'all-star']);
function knownPlayerIn(title: string, known?: ReadonlySet<string>): { player: string | null; playerSlug: string | null } {
  const none = { player: null, playerSlug: null };
  if (!known || !title) return none;
  // a sealed box's "Possible …" chase list, a lot or a collection is no one player's
  if (/\b(?:possible|featuring|including|includes|lots?|collection|group|unopened|sealed|wax|hobby|team[- ]signed|multi[- ]signed)\b|\(\d+\)/i.test(title)) return none;
  const words = title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z.'’ -]+/g, ' ').split(/\s+/).filter(w => /[A-Za-z]/.test(w));
  const head = words.slice(0, 12);
  const found = new Map<string, string>();
  for (let i = 0; i < head.length - 1; i++) {
    for (const n of [3, 2]) {
      if (i + n > head.length) continue;
      const run = head.slice(i, i + n).join(' ');
      const slug = playerSlugOf(run);
      if (slug && known.has(slug) && !PLACE_SLUGS.has(slug) && !/^(?:fc|ac|as|sc|cf|real)-|-(?:fc|cf|united|city)$/.test(slug)) {
        if (i < 10 || found.size) found.set(slug, run);
        i += n - 1;
        break;
      }
    }
  }
  if (found.size !== 1) return none;
  const [[slug, run]] = Array.from(found.entries());
  const name = run.split(' ').map(w => (w === w.toUpperCase() || w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');
  return { player: name, playerSlug: slug };
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
  // (wave 3) a numberless pre-war catalog card: the code is the issue (its
  // year span is printed three ways — "1909-1911", "1909-11", Goldin's "11"),
  // the pose / team / back its card
  if (id.catalog && !id.cardNo && id.playerSlug && !id.multi && !id.notCard) {
    return `${id.playerSlug}|${id.catalog}|${id.catalog}|-${id.pose ? `|p:${id.pose}` : ''}${id.serialOf ? `|/${id.serialOf}` : ''}${id.autoGrade ? `|ag:${id.autoGrade}` : ''}`;
  }
  if (!id.playerSlug || !id.year || !id.cardNo || id.multi || id.notCard) return null;
  const set = cardSetKey(id.setName);
  const v = id.variant ? `|v:${id.variant}` : '';
  const s = id.serialOf ? `|/${id.serialOf}` : '';
  const ag = id.autoGrade ? `|ag:${id.autoGrade}` : '';
  return `${id.playerSlug}|${cardYearKey(id.year)}|${set}|${id.cardNo.toLowerCase()}${v}${s}${ag}`;
}
