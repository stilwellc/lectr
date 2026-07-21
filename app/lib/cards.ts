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
