import { medianOr } from './lib/stats';
import { isDayStamp, dayOfDayStamp, liveUntilMs } from './lib/house-tz';
import { leadYearOf } from './lib/lead-year';

// Neutral ivory ramp: houses are distinguished by LIGHTNESS, not hue — hue is
// reserved for meaning (wine = emphasis, gold = site primary). Each step mixes
// the warm foreground into the background, so the ramp tracks both themes and
// 12px labels stay AA-readable (floor is 65% fg, above text-muted). Use with
// color-mix() when alpha is needed.
export const houseColors: Record<string, string> = {
  'Phillips': 'var(--color-fg)',
  "Sotheby's": 'color-mix(in srgb, var(--color-fg) 95%, var(--color-bg))',
  "Christie's": 'color-mix(in srgb, var(--color-fg) 90%, var(--color-bg))',
  'Rago': 'color-mix(in srgb, var(--color-fg) 85%, var(--color-bg))',
  'Wright': 'color-mix(in srgb, var(--color-fg) 80%, var(--color-bg))',
  'Heritage': 'color-mix(in srgb, var(--color-fg) 75%, var(--color-bg))',
  'Bonhams': 'color-mix(in srgb, var(--color-fg) 70%, var(--color-bg))',
  'Hindman': 'color-mix(in srgb, var(--color-fg) 65%, var(--color-bg))',
  'Goldin': 'color-mix(in srgb, var(--color-fg) 60%, var(--color-bg))',
};

// Concrete hexes per theme — ONLY for recharts/SVG fills, where var() is not
// reliable in presentation attributes. Swap via useTheme() at the call site.
// Same neutral fg-into-bg ramp as houseColors, precomputed per theme.
export const houseColorsHex: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    'Phillips': '#EDE6DA',
    "Sotheby's": '#E2DBD0',
    "Christie's": '#D7D0C5',
    'Rago': '#CBC5BB',
    'Wright': '#C0BAB0',
    'Heritage': '#B5AFA6',
    'Bonhams': '#AAA49B',
    'Hindman': '#9F9991',
    'Goldin': '#948E86',
  },
  light: {
    'Phillips': '#241E15',
    "Sotheby's": '#2E291F',
    "Christie's": '#39332A',
    'Rago': '#433E34',
    'Wright': '#4E483F',
    'Heritage': '#585349',
    'Bonhams': '#635D54',
    'Hindman': '#6D685E',
    'Goldin': '#787368',
  },
};

/**
 * craftTitle — the object made worthy. Auction feeds arrive raw: Bonhams
 * SHOUTS ("CARTIER: AN 18K GOLD WRISTWATCH, CIRCA 1950"), catalog styles
 * repeat the maker the card already names, titles trail orphan periods.
 * One pass: strip the redundant maker prefix, sentence-case the shouting,
 * trim the tail. The data stays untouched — this is presentation craft.
 */
const MAKER_PREFIX = /^(rolex|patek philippe|audemars piguet|omega|cartier|vacheron constantin|jaeger[- ]lecoultre)\s*[.,:|]\s*/i;
// design/maker name(s) that lead a catalogue title and duplicate the maker line
const DESIGN_MAKER_PREFIX = /^(charles (?:&|and) ray eames|charles eames|ray eames|george nakashima|pierre jeanneret|jean prouv[eé]|le corbusier)\s*[.,:]\s*/i;
// "Charles Eames, Ray Eames: <title>" — a comma-joined name duo ending in a
// colon, optionally "…, a.o.:" (and others). (W21) never a "Calatrava, Ref:
// 2452" — a model and its reference label are no duo of names.
const DUO_PREFIX = /^[A-ZÀ-Ý][\wÀ-ÿ.'-]+(?:\s+[A-ZÀ-Ý][\wÀ-ÿ.'-]+){0,3}(?:,\s*[A-ZÀ-Ý][\wÀ-ÿ.'-]+(?:\s+[A-ZÀ-Ý][\wÀ-ÿ.'-]+){0,3})+(?:,\s*a\.\s?o\.)?\s*:\s+/;
const DUO_NOT_A_NAME = /(?:^|[\s,])(?:ref|reference|no|model|lot|circa|cal|calibre|caliber)\.?\s*:/i;
// (W21) a SHOUTED maker with life dates leading the title ("JEAN PROUVÉ
// (1901-1984) Pair of 'Métropole' Chairs") — the maker line names them
const DATED_MAKER_PREFIX = /^[A-ZÀ-Ý][A-ZÀ-Ý'’.\- ]{2,40}\s*\((?:b\.\s*\d{4}|\d{4}\s*[-–]\s*\d{4})\)\s*[.,:;]?\s*(?=\S.{7})/;
// (W21) a house's boilerplate riding the title (NFL Auction appends its
// site tagline to every lot)
const HOUSE_TAGLINE = /\s*\|\s*the official auction site of the national football league\s*$/i;
// (W21) a Sotheby's Asia title carries its Chinese translation as pipe
// segments — the English one is the title
const CJK = /[぀-ヿ㐀-鿿가-힯]/;
const HTML_TAG = /<\/?[a-z][^>]*>/gi;
const ENTITY: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…' };

/** Strip HTML tags + decode common entities + collapse whitespace. Auction feeds
 *  leak raw markup ("</p><p>") and entities into title/medium fields. */
export function cleanText(raw?: string | null): string {
  let t = (raw || '').replace(HTML_TAG, ' ');
  t = t.replace(/&[a-z#0-9]+;/gi, m => ENTITY[m.toLowerCase()] ?? ' ');
  // a field cut mid-entity ("oil on&nbsp") — drop the half-entity at the end
  t = t.replace(/&#?[a-z0-9]{0,8}$/i, '');
  return t.replace(/\s+/g, ' ').trim();
}

/** cleanText, minus a house's star markers: Julien's leads its marquee
 *  titles with "**" ("**JOHN LENNON GIBSON J-160E", "** RINGO STARR #1 …"),
 *  which read as stray markup on a record line. A run of two or more stars
 *  at either end goes; a single in-title "*" (a wedge's 60*, *Notes*) stays. */
export function tidyTitle(raw?: string | null): string {
  return cleanText(raw).replace(/^\*{2,}\s*/, '').replace(/\s*\*{2,}$/, '').trim();
}
/**
 * expandLeadYear — Goldin leads a title with a 2-digit year ("94 Mario Lemieux
 * Game-Used…", "87 Fleer #57…", "08 Upper Deck…"); bare, it reads like a typo.
 * Widened to four digits only when the century is certain — by the ONE rule
 * the card parser keys on (lib/lead-year.ts leadCentury, so a card is shown
 * under the year it is keyed under): a pre-war catalog code ("11 T206" → 1911,
 * "16 M101-2" → 1916), a card brand (00–26 → 20xx, 27–99 → 19xx), and on
 * Goldin only, its year-led convention (27–99 before a capitalised word →
 * 19xx; a 19th-century format named — "92 John H. Ryder Studio Cabinet" →
 * 1892). 00–26 before anything else ("26 Babe Ruth Sliding…" is 1926; "14
 * Fernando Torres…" is 2014) and a lot number ("29 Topps 1981 Cello…") stay
 * as printed. Only the LEADING token is touched — "Cards (24)", "#57",
 * "09-11" mid-title never change; ranges keep their tail ("09-11 T206" →
 * "1909-11 T206").
 */
export function expandLeadYear(t: string, house?: string | null): string {
  const m = t.match(/^(\d{2})(?:-\d{2})? (?=\S)/);
  if (!m) return t;
  const ly = leadYearOf(t, { yearLed: house === 'Goldin' });
  if (!ly) return t;
  return `${ly.year} ${t.slice(m[0].length)}`;
}

/** (W21) names a shouting title must not lose to the lower-casing: the watch
 *  and design houses' own names and their model lines ("PATEK PHILIPPE |
 *  AQUANAUT" read "Patek philippe | aquanaut"; "…NAUTILUS MODEL" read
 *  "nautilus model"; "…JEWELRY BOX GEORGE NAKASHIMA" read "george nakashima") */
const PROPER_NAMES = [
  'Patek Philippe', 'Audemars Piguet', 'Vacheron Constantin', 'Jaeger-LeCoultre', 'Rolex', 'Omega', 'Cartier', 'Tudor', 'Breguet', 'Van Cleef & Arpels', 'Tiffany', 'Bulgari', 'Hermès',
  'Nautilus', 'Aquanaut', 'Calatrava', 'Gondolo', 'Ellipse', 'Royal Oak Offshore', 'Royal Oak', 'Jules Audemars', 'Daytona', 'Submariner', 'Datejust', 'Day-Date', 'GMT-Master',
  'Sea-Dweller', 'Explorer', 'Milgauss', 'Speedmaster', 'Seamaster', 'Constellation', 'Santos', 'Tank', 'Panthère', 'Pasha', 'Crash', 'Reverso', 'Overseas', 'Patrimony',
  'George Nakashima', 'Charles Eames', 'Ray Eames', 'Jean Prouvé', 'Pierre Jeanneret', 'Le Corbusier', 'Charlotte Perriand', 'Herman Miller', 'Knoll', 'Vitra',
];
const PROPER_RE = new RegExp(`\\b(?:${PROPER_NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\&]/g, m => (m === '&' ? '&' : `\\${m}`))).join('|')})(?![\\w-])`, 'gi');
const PROPER_BY_LOWER = new Map(PROPER_NAMES.map(n => [n.toLowerCase(), n]));
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'de', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'vs.', 'with', 'w/']);

/** one SHOUTED word, lower-cased with what must stay: a token carrying a digit
 *  (a reference "5712G-001", a grade "A7.5"), an initialism ("G.I.", "U.S.A."),
 *  a short all-consonant code ("PSA", "JSA", "CAS", "LC") */
const ACRONYMS = new Set('PVD DLC GMT UTC ETA PSA DNA JSA BGS SGC CGC COA LOA LOP OOA NFL NBA MLB NHL WNBA USA UK USSR NASA RIAA NCAA HOF MVP WWI WWII TV DVD VHS LP EP CD GU AFA CAS TMNT UFC WWE WWF FBI CIA JFK RFK MGM RKO BBC CBS NBC ABC HBO AMC UCLA USC LSU BYU TCU SMU NYPD LAPD PGA LPGA FIFA UEFA PMG CBCS'.split(' '));
function quietWord(w: string): string {
  if (w.includes('/') && !/\d/.test(w)) return w.split('/').map(quietWord).join('/');
  if (/^[A-Z]{2,5}-[A-Z]/.test(w) && ACRONYMS.has(w.split('-')[0])) return w.split('-').map((p, i) => (i ? quietWord(p) : p)).join('-');
  if (/^\d+(?:ST|ND|RD|TH)\b/.test(w)) return w.replace(/(ST|ND|RD|TH)/, x => x.toLowerCase());
  if (/\d/.test(w)) return w;
  const bare = w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
  if (ACRONYMS.has(bare) || /^[IVX]{2,5}$/.test(bare)) return w;
  if (/^(?:[A-Z]\.){2,}[A-Z]?\.?$/.test(w.replace(/[(),;:"'“”‘’]/g, ''))) return w;
  const core = w.replace(/[^A-Za-z]/g, '');
  if (core.length >= 2 && core.length <= 4 && !/[AEIOUY]/.test(core)) return w;
  return w.toLowerCase();
}

/** a SHOUTING title made readable: prose ("A SPORTY AND ATTRACTIVE …
 *  WRISTWATCH") reads in sentence case; a name-led headline ("FINE BABE RUTH
 *  PROFESSIONAL MODEL BASEBALL BAT", "G.I. JOE (1989) - SGT. SLAUGHTER")
 *  reads in title case, so the people it names keep their capitals. A new
 *  clause after " - ", " | " or a sentence stop opens with a capital. */
function unshout(t: string): string {
  const prose = /^an?\s/i.test(t);
  let out = t.split(/(\s+)/).map((w, i) => {
    if (/^\s+$/.test(w)) return w;
    const q = quietWord(w);
    if (prose || q === w || /\d/.test(q) || /^\(?b\.$/.test(q)) return q;
    if (i > 0 && SMALL_WORDS.has(q)) return q;
    // a French elision keeps its article ("d'Azur"); a hyphen opens a new word ("Multi-Signed")
    const elided = q.match(/^([^a-z]*)([dl])['’]([a-z])(.*)$/);
    if (elided) return `${elided[1]}${elided[2]}'${elided[3].toUpperCase()}${elided[4]}`;
    return q.replace(/^([^a-z]*)([a-z])/, (_, a, b) => a + b.toUpperCase()).replace(/-([a-z])/g, (_, b) => `-${b.toUpperCase()}`);
  }).join('');
  out = out.replace(/(^|[.!?]\s+|\s[-–—|]\s+|\(\s*(?=[a-z]{2}))([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return out.replace(PROPER_RE, m => PROPER_BY_LOWER.get(m.toLowerCase()) ?? m);
}

/** a title in capitals (more than 70% of 9+ letters) */
export function isShouting(t: string): boolean {
  const letters = t.replace(/[^a-zA-Z]/g, '');
  return letters.length > 8 && t.replace(/[^A-Z]/g, '').length / letters.length > 0.7;
}
/** a shouting title in the case craftTitle prints it in (names keep capitals) */
export function unshoutTitle(t: string): string {
  return unshout(t);
}

export function craftTitle(raw: string, house?: string | null): string {
  let t = tidyTitle(raw);
  t = t.replace(HOUSE_TAGLINE, '');
  if (CJK.test(t) && t.includes('|')) {
    const segs = t.split(/\s*\|\s*/);
    if (!CJK.test(segs[0])) t = segs.filter(s => !CJK.test(s)).join(' | ');
  }
  t = t.replace(/^[·•]\s*/, '');                  // a leading catalogue bullet  '· Femme nue'
  t = t.replace(/^\[(.+?)\]$/, '$1').trim();          // unwrap a fully-bracketed title  [Apollo 14] → Apollo 14
  t = t.replace(/^\[[^\]]{1,40}\]\s*/, '').trim();     // drop a leading [collection tag]
  t = t.replace(/\s*\(\d{1,3}\)\s*$/, '');             // drop trailing catalogue quantity  "…chairs (7)"
  t = t.replace(MAKER_PREFIX, '');
  // the duo first: "Charles Eames, Ray Eames: …" must not lose only its first name
  const duo = t.match(DUO_PREFIX);
  if (duo && !DUO_NOT_A_NAME.test(duo[0])) t = t.slice(duo[0].length);
  t = t.replace(DESIGN_MAKER_PREFIX, '');              // "George Nakashima: Conoid" → "Conoid"
  t = t.replace(DATED_MAKER_PREFIX, '');               // "JEAN PROUVÉ (1901-1984) Pair of …" → "Pair of …"
  if (isShouting(t)) t = unshout(t);
  t = deglue(t.replace(/\s*[.,;|]+\s*$/, ''));
  t = expandLeadYear(t, house);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/** A title the BUILD truncated at a fixed length (refs/players rows ship
 *  title.slice(0, 80)) ends mid-word with no mark. Close it at the last
 *  whole word with an ellipsis — never a silent mid-word cut. */
export function closeCut(t: string, cap = 80): string {
  if (!t || t.length < cap) return t;
  const sp = t.lastIndexOf(' ');
  return `${(sp > cap * 0.5 ? t.slice(0, sp) : t).replace(/[\s,;:.—–-]+$/, '')}…`;
}

/** Re-space words a crawler glued together when it stripped a <br> with ''
 *  ("Conoid Chair 1966American black walnut", "aquatint1937on Montval"). Only
 *  the unambiguous shapes: a 4-digit year fused to a capitalised word, and a
 *  year fused between two lowercase words. References like "126720vtnr" or
 *  "5059R" never match (no 3+-letter lowercase word on the left).
 *  (W21) + Bonhams' Wright-family rows, where every field is glued: a word
 *  fused to the year ("Q Bench1966American"), the "designed" field ("Ottoman
 *  designed 1956for Herman Miller"), the dimensions ("hickoryheight 29in"). */
export function deglue(raw: string): string {
  return raw
    .replace(/([a-z]{2,})((?:1[5-9]|20)\d{2})(?=[A-Z][a-z]{2,}|\s|,|$)/g, '$1 $2')
    .replace(/\b((?:1[5-9]|20)\d{2})([A-Z][a-z]{2,})/g, '$1 $2')
    .replace(/([a-z]{3,})((?:1[5-9]|20)\d{2})([a-z]{2,})/g, '$1 $2 $3')
    .replace(/([a-z]{3,})((?:1[5-9]|20)\d{2})\b/g, '$1 $2')
    .replace(/\b((?:1[5-9]|20)\d{2})(for|by|in)\b/g, '$1 $2')
    .replace(/([a-z]{3,})(designed|produced|executed|manufactured)(?= (?:\d|circa|c\.))/g, '$1 $2')
    .replace(/([a-z]{3,})(circa)(?= \d)/g, '$1 $2')
    .replace(/([a-z]{3,})(height|width|depth|diameter|length)(?= (?:of [a-z ]+)?\d)/g, '$1 $2');
}

/** a word that ends in "." without ending a sentence: a catalogue's labels
 *  ("ref.", "No.", "cal.", "Bl.", "approx.", "a.o.") and initials ("John F.") */
const ABBREV_BEFORE = /(?:\b(?:ref|réf|refs|no|nos|nr|lv|cal|bl|ba|approx|ca|circa|c|cf|fig|figs|pl|pls|vol|vols|op|ed|eds|inc|co|corp|ltd|jr|sr|dr|mr|mrs|ms|st|mt|ft|sgt|lt|col|capt|gen|gov|pres|rev|vs|est|illus|pp|p|nb|a\.o|i\.e|e\.g|u\.s|s|t|d|f)|\b[A-Z]|\.[a-z])\.$/i;
/** the depth of open brackets / quotes before index i (a break inside "(after,
 *  Studies of the Human Body …)" is no break) */
function openAt(t: string, i: number): boolean {
  let p = 0, sq = 0, dq = 0;
  for (let k = 0; k < i; k++) {
    const c = t[k];
    if (c === '(' || c === '[') p++;
    else if ((c === ')' || c === ']') && p > 0) p--;
    else if (c === '“') dq++;
    else if (c === '”' && dq > 0) dq--;
    else if (c === '"') dq = dq ? 0 : 1;
  }
  return p > 0 || dq > 0 || sq > 0;
}

/** A lot title for DISPLAY: the short title the h1 carries, and the catalogue
 *  description some houses (Bonhams) pour into the same field. Split rules, in
 *  order, applied only to titles past 64 chars:
 *   0. (W21) a " | " field break (Sotheby's "Daytona, Reference 6265 | A yellow
 *      gold … wristwatch | Circa 1987") — the first field is the title;
 *   1. a year inside the first 60 chars followed by more prose → the title
 *      ends at the year ("Conoid Chair, 1966" | "American black walnut, …") —
 *      never a reference / model / catalogue number ("Ref. 1567", "No. 1675");
 *   2. the first "; " / " — " / ". " break after 16 chars — never after an
 *      abbreviation ("ref. 2486", "Model No. 150", "(Bl. 1330", "Approx.");
 *   3. the first ", " break after 30 chars;
 *   (2–3 never break inside an open bracket or quote)
 *   4. past 140 chars, a word-boundary cut at 120 WITH an ellipsis (never mid-word,
 *      never silent) — the full text rides in `rest`.
 *  Short titles pass through untouched. */
export function splitTitle(raw: string, house?: string | null): { short: string; rest: string | null } {
  const t = deglue(craftTitle(raw, house));
  if (t.length <= 64) return { short: t, rest: null };
  const tidy = (s: string) => s.replace(/^[\s,;:.|—–-]+/, '').trim();
  const pipe = t.indexOf(' | ');
  if (pipe >= 6 && pipe <= 90) {
    const rest = tidy(t.slice(pipe + 3));
    if (rest.length > 12) return { short: t.slice(0, pipe).trim(), rest };
  }
  const y = t.slice(0, 60).match(/^(.{6,}?)[\s,]+((?:1[5-9]|20)\d{2}(?:[–-]\d{2,4})?)(?=[\s,.;]+\S)/);
  // the year closes the title only where the catalogue's next field starts:
  // a comma / stop after it, or the materials line ("1966 American black
  // walnut", "1956 for Herman Miller") — never mid-phrase ("Limited Edition
  // 2004 UMG iPod", "Hall of Fame 2001 Inductees Multi-Signed Poster")
  const yNext = y ? t.slice(y[0].length).replace(/^\s+/, '') : '';
  const yField = !!y && (/^[,.;]/.test(t.slice(y[1].length + y[0].slice(y[1].length).indexOf(y[2]) + y[2].length)) || /^(?:[a-z]|(?:American|French|Italian|Danish|Swedish|Norwegian|Finnish|English|British|German|Dutch|Brazilian|Japanese|Indian|Swiss|East Indian) [a-z])/.test(yNext));
  if (y && yField && !/\b(?:ref(?:erence)?|réf|no|nos|nr|model|cal(?:ibre)?|op|vol|lot|edition|number|#)\.?:?$/i.test(y[1].trim()) && !openAt(t, y[1].length)) {
    const rest = tidy(t.slice(y[0].length));
    if (rest.length > 12) {
      const lead = y[1].replace(/[\s,]+$/, '').replace(/\s+(?:designed|produced|executed|manufactured|made)(?=(?:\s+(?:circa|c\.|ca\.))?$)/i, '');
      // "…ca. 1940" keeps its circa with the year ("…, ca. 1940", never "…ca., 1940")
      const circa = lead.match(/^(.*?)[\s,]+(circa|ca\.|c\.)$/i);
      return { short: circa ? `${circa[1]}, ${circa[2]} ${y[2]}` : `${lead}, ${y[2]}`, rest };
    }
  }
  for (const [re, min] of [[/;\s|\s—\s|\.\s/g, 16], [/,\s/g, 30]] as const) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      if (m.index < min) continue;
      if (m.index > 90) break;
      if (m[0].startsWith('.') && ABBREV_BEFORE.test(t.slice(Math.max(0, m.index - 12), m.index + 1))) continue;
      if (openAt(t, m.index)) continue;
      // a list of names ("John Glenn, Charles Conrad, and Gordon Cooper (3)
      // Signed Photographs", "Robert Plant, Jimmy Page, Led Zeppelin Type I…")
      // runs on to the object it names; a "SURNAME, Forename (1900–1949)."
      // heading is no title on its own
      if (m[0] === ', ' && /[A-Z][\w.'’-]+$/.test(t.slice(0, m.index)) && /^(?:and |& )?[A-Z][a-z]/.test(t.slice(m.index + 2))) continue;
      if (/\(\d{4}\s*[–-]\s*\d{4}\)$/.test(t.slice(0, m.index))) continue;
      const rest = tidy(t.slice(m.index + m[0].length));
      if (rest.length > 12) return { short: t.slice(0, m.index).trim(), rest };
      break;
    }
  }
  // identity-dense titles (a graded card: set · number · player · grade) are
  // the object itself — they wrap, and only a runaway past 140 is cut
  if (t.length <= 140) return { short: t, rest: null };
  const cut = t.slice(0, 120);
  const sp = cut.lastIndexOf(' ');
  return { short: `${(sp > 60 ? cut.slice(0, sp) : cut).replace(/[\s,;:.—–-]+$/, '')}…`, rest: t };
}

/**
 * sportOf — which sport a sports lot belongs to, read from its title (league,
 * team, athlete, or venue). Soccer dominates the current data so its cues are
 * broad; American sports lead with league + marquee names. Rules run
 * first-match-wins, so crossover surnames (Henry, Terry, Moore, Rodman,
 * Aaron, Luka) are cued by FULL NAME only — a bare surname would file a
 * Dennis Rodman Bulls jersey or an Aaron Rodgers Packers jersey under the
 * wrong pill before the team/league cue ever ran. Returns null when nothing
 * identifies the sport (kept as "Other" in the filter).
 */
const SPORT_RULES: [string, RegExp][] = [
  ['Soccer', /\b(soccer|fifa|world cup|uefa|premier league|la liga|serie a|bundesliga|ligue 1|champions league|barcelona|real madrid|manchester|arsenal|chelsea|liverpool|psg|paris saint|juventus|benfica|honved|la galaxy|messi|ronaldo|ronaldinho|mbappe|haaland|neymar|pele|maradona|salah|yamal|pedri|busquets|fabregas|thierry henry|edouard mendy|benjamin mendy|john terry|bobby moore|beckham|bobby charlton|jack charlton|eusebio|puskas|puskás|tostão|tostao|trinity rodman|luka modric|meazza|figc|santos fc)\b/i],
  ['Basketball', /\b(nba|basketball|lakers|celtics|bulls|warriors|miami heat|nuggets|knicks|76ers|clippers|brooklyn nets|new jersey nets|ncaa|final four|lebron|michael jordan|air jordan|jordan brand|kobe|jokic|stephen curry|steph curry|kevin durant|anthony edwards|luka doncic|shai gilgeous)\b/i],
  // (r9) a bare "Jordan" is Michael only beside his own world: paired with an
  // NBA name ("Magic vs. Jordan", "Jordan/Bird Cover", "J.Starks/M.Jordan",
  // "Jordan, Ewing, Olajuwon") or a product of his (Space Jam, The Jordan
  // Experience). Never alone: Jordan Love, Walker, Lawlar, Addison, Spieth
  ['Basketball', /\b(?:space jam|jordan'?s? (?:experience|viewpoints)|m\.\s?jordan|(?:magic|bird|lebron|james|bryant|kobe|pippen|rodman|erving|ewing|olajuwon|malone|barkley|garnett|o'neal|shaq|starks|drexler|stockton|iverson|carter|johnson|wilkins|isiah)\s*(?:\/|,|&|and|vs\.?)\s*jordan|jordan\s*(?:\/|,|&|and|vs\.?)\s*(?:magic|bird|lebron|james|bryant|kobe|pippen|rodman|erving|ewing|olajuwon|malone|barkley|garnett|o'neal|shaq|starks|drexler|stockton|iverson|carter|johnson|wilkins|isiah))\b/i],
  ['Baseball', /\b(mlb|baseball|yankees|dodgers|red sox|cubs|world series|ohtani|jeter|mariano rivera|mickey mantle|babe ruth|hank aaron|home run|no-hitter|cy young)\b/i],
  ['Football', /\b(nfl|super bowl|quarterback|touchdown|heisman|patriots|chiefs|cowboys|packers|49ers|tom brady|mahomes|amendola|lombardi)\b/i],
  ['Hockey', /\b(nhl|hockey|stanley cup|gretzky|ovechkin|crosby|maple leafs|canadiens|bruins|goal no\.)\b/i],
  ['Racing', /\b(formula 1|f1\b|grand prix|nascar|leclerc|lewis hamilton|verstappen|senna|ferrari|mclaren|race-worn|racing)\b/i],
  ['Boxing / MMA', /\b(boxing|ufc\b|mma\b|title belt|heavyweight|muhammad ali|mike tyson|mayweather|fight-worn)\b/i],
  ['Golf', /\b(golf|pga\b|masters(?! of the universe)|green jacket|tiger woods|the open|ryder cup)\b/i],
  ['Tennis', /\b(tennis|wimbledon|us open tennis|roland garros|federer|nadal|djokovic|serena)\b/i],
  ['Olympics', /\b(olympic|olympics|torch|gold medal.*(games|olympic))\b/i],
];
export function sportOf(title: string): string | null {
  const t = title || '';
  for (const [sport, re] of SPORT_RULES) if (re.test(t)) return sport;
  // "match-used / match-worn" is soccer/international grammar — Americans say
  // "game-used". A boot/shirt/jersey in that grammar is soccer.
  if (/\bmatch[- ](used|worn)\b/i.test(t) && /\b(jersey|shirt|boots|kit|strip|cleats)\b/i.test(t)) return 'Soccer';
  return null;
}

// Shared date formatter for the Ray suite. saleDate/lastCrawl are date-only
// strings (YYYY-MM-DD) that JS parses as UTC midnight — formatting them in
// the viewer's local timezone can shift the displayed day AND makes the
// server-rendered text differ from the client's (hydration mismatch).
// Always format in UTC so the output is identical everywhere.
export function formatDate(
  dateStr: string,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}

/** The user's LOCAL calendar day as YYYY-MM-DD — the ONE "today" for every
 *  client-render comparison against date-only saleDate strings. A UTC "today"
 *  (toISOString().slice(0, 10)) runs a day ahead of every US evening, so lots
 *  hammering "today" read as past and day-counts go off by one. Build-time
 *  scripts stay UTC on purpose — this is for what the READER's calendar says. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Median of a numeric list, null when empty — the app's ONE median.
 *  (Hand-rolled copies of this litter the rooms; new code imports this.) */
export function median(a: number[]): number | null {
  return medianOr(a, null);
}

/** Upgrade http:// image URLs to https:// so they don't trip mixed-content on
 *  our HTTPS pages (all our image hosts serve https). Undefined-safe. */
export function httpsImg(u?: string | null): string | undefined {
  return u ? u.replace(/^http:\/\//i, 'https://') : undefined;
}

/** Bonhams hotlinks are 2880×2880 originals (~672 KB each) but their image
 *  service resizes on request (verified live: `&width=160` → 3.3 KB). Ask for
 *  the size the slot actually renders (2× the CSS box, for retina) instead of
 *  shipping the master into a 40 px avatar.
 *
 *  Deliberately narrow: rewrites ONLY the Bonhams resizer endpoint, and never
 *  when the URL already carries a width. Every other CDN — and any already
 *  sized URL — comes back untouched.
 *
 *  images1/2/3 are the same resizer behind three shard hostnames (the corpus
 *  carries all three; each was curl-verified to 200 with a smaller body for
 *  `&width=`), so the host class covers 1–3 and nothing else. */
export function sizedImg(u: string, width: number): string;
export function sizedImg(u: string | null | undefined, width: number): string | undefined;
export function sizedImg(u: string | null | undefined, width: number): string | undefined {
  if (!u) return undefined;
  // Bonhams: a query-string resizer behind three shard hosts.
  if (/^https?:\/\/images[1-3]\.bonhams\.com\/image\?/i.test(u) && !/[?&]width=\d/i.test(u)) {
    return `${u}&width=${width}`;
  }
  // Wright / LAMA: the pixel width is a PATH segment (/items/index/<w>/...).
  // The corpus stores the 220px thumbnail, so every Wright lot was being
  // upscaled — measured 4.6x on a card and 5.3x on the full-bleed hero, which
  // is a 220px image stretched across a phone. /1200/ curl-verified 200 at
  // 70,848 bytes vs 20,192. Snap to the nearest offered rung, never up.
  const wright = u.match(/^(https?:\/\/(?:www\.)?wright20\.com\/items\/index\/)(\d+)(\/.+)$/i);
  if (wright) {
    const rung = width >= 900 ? 1200 : width >= 480 ? 640 : 220;
    return Number(wright[2]) >= rung ? u : `${wright[1]}${rung}${wright[3]}`;
  }
  // Goldin's CDN serves density variants (@1x/@2x/@3x, curl-verified 200 at
  // 145KB/269KB/510KB). @1x is 640px, which a 3x phone upscales 1.6x.
  if (/cloudfront\.net\/public\/Lots\//i.test(u) && /@1x(?:$|[?#])/i.test(u)) {
    return width >= 900 ? u.replace(/@1x/i, '@2x') : u;
  }
  // ── THE MASTERS (perf wave W1, Oct 11 2026). Measured on prod in real
  // Chrome: the home book shipped 12 MB of images and /makers 40 MB, almost
  // all of it masters drawn into 28–120 px wells — a Christie's 3200 px JPEG
  // is 0.7–4.3 MB, an REA Cloudinary original 4.5 MB. Each of these hosts
  // resizes on request (curl-verified 200, same picture, real Chrome UA):
  //   christies.com  ?mode=max&w=240   669 KB → 9 KB   (never upscales)
  //   res.cloudinary w_240,c_limit     4.5 MB → 10 KB  (c_limit never upscales)
  //   dist.phillips  width/height=240  50 KB → 14 KB   (fit=bounds box)
  // A width at or above the stored size leaves the URL alone.
  const christies = u.match(/^(https?:\/\/(?:www\.)?christies\.com\/img\/lotimages\/[^?#]+)(\?[^#]*)?$/i);
  if (christies) {
    const q = christies[2] || '';
    if (/[?&]w=\d/i.test(q)) return u;
    return q ? `${u}&w=${width}` : `${u}?mode=max&w=${width}`;
  }
  // Cloudinary: a transform segment goes straight after /image/upload/. Only
  // a URL whose next segment is the version (v123…/) or the public id — never
  // one that already carries a (possibly named or signed) transform.
  const cld = u.match(/^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/i);
  if (cld) {
    const next = cld[2].split('/')[0];
    if (cld[2].includes('/') && !/^v\d+$/.test(next)) return u; // a transform (or folder) is already there
    return `${cld[1]}w_${width},c_limit,q_auto/${cld[2]}`;
  }
  const phillips = u.match(/^https?:\/\/dist\.phillips\.com\/[^?#]+\?(?:[^#]*&)?width=(\d+)/i);
  if (phillips) {
    if (Number(phillips[1]) <= width) return u;
    return u.replace(/([?&])width=\d+/i, `$1width=${width}`).replace(/([?&])height=\d+/i, `$1height=${width}`);
  }
  // Sotheby's brightspot URLs carry a SIGNED transform chain (/dims4/default/
  // <hash>/): rewriting the resize segment invalidates the signature and the
  // CDN 500s (verified). They ship at 421px and must be left alone.
  return u;
}

/** ONE signed-percent formatter: '+' for gains, a TRUE MINUS (U+2212) for
 *  losses, no sign at zero — replaces ~10 inline `>= 0 ? '+' : ''` sites that
 *  printed hyphen-minus and green zeros. */
export function fmtSignedPct(n: number, digits = 0): string {
  const r = +n.toFixed(digits);
  if (r === 0) return `${(0).toFixed(digits)}%`;
  return `${r > 0 ? '+' : '\u2212'}${Math.abs(r).toFixed(digits)}%`;
}

/** Direction tone for a signed reading: zero is FLAT (muted), not a gain.
 *  Use for classNames/colors so a 0% never paints signal-green. */
export function toneOf(n: number): 'up' | 'down' | 'flat' {
  return Math.round(n) === 0 ? 'flat' : n > 0 ? 'up' : 'down';
}

/** % over estimate for a SOLD lot, on the RAW published price. For most houses
 *  that price already includes their buyer's premium while the estimate is a
 *  hammer-basis prediction, so this figure carries the fee inside it — it is
 *  "what it sold for vs what they thought", not a like-for-like hammer read.
 *  Kept deliberately identical to the demand index's basis (app/lib/demand.ts)
 *  so the hero and the per-row figures can never contradict each other. */
export function overEstimatePct(l: { priceUsd?: number | null; hammerUsd?: number | null; hammerPrice?: number | null; estimateLow?: number | null; estimateHigh?: number | null }): number | null {
  const lo = l.estimateLow || l.estimateHigh || 0;
  const hi = l.estimateHigh || l.estimateLow || 0;
  const mid = (lo + hi) / 2;
  if (!(mid > 0) || !l.priceUsd) return null;
  // RAW published sold price vs estimate — same basis as the demand index
  // (app/lib/demand.ts), deliberately. These two must never disagree: the
  // hero read and the per-row "vs est" answer the same question, and when one
  // divided the premium out and the other didn't, the same lot could read
  // +27% in one place and −5% in another. Nothing is inferred here; where the
  // house's price includes its buyer's premium, so does this figure.
  return (l.priceUsd / mid - 1) * 100;
}

/** ONE money-axis formatter for every chart — rolls to B, trims trailing .0,
 *  so "$1700.0M" and "$4.97B" can never coexist on adjacent panels. */
export function formatMoneyAxis(n: number): string {
  const v = Math.abs(n); const sign = n < 0 ? '−' : '';
  const trim = (s: string) => s.replace(/\.0$/, '');
  if (v >= 1_000_000_000) return `${sign}$${trim((v / 1_000_000_000).toFixed(v >= 10_000_000_000 ? 0 : 1))}B`;
  if (v >= 1_000_000) return `${sign}$${trim((v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1))}M`;
  if (v >= 1_000) return `${sign}$${Math.round(v / 1000)}K`;
  return `${sign}$${Math.round(v)}`;
}

export function formatPrice(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export const categoryLabels: Record<string, string> = {
  original: 'Unique Work',
  print: 'Edition',
  photograph: 'Photograph',
  sculpture: 'Sculpture',
  design: 'Design Object',
  object: 'Object',
  unknown: 'Unknown',
};

// Neutral ivory ramp — same doctrine as houseColors: categories are coded by
// lightness, hue stays reserved for meaning.
export const categoryColors: Record<string, string> = {
  original: 'var(--color-fg)',
  print: 'color-mix(in srgb, var(--color-fg) 93%, var(--color-bg))',
  photograph: 'color-mix(in srgb, var(--color-fg) 86%, var(--color-bg))',
  sculpture: 'color-mix(in srgb, var(--color-fg) 79%, var(--color-bg))',
  design: 'color-mix(in srgb, var(--color-fg) 72%, var(--color-bg))',
  object: 'color-mix(in srgb, var(--color-fg) 68%, var(--color-bg))',
  unknown: 'color-mix(in srgb, var(--color-fg) 65%, var(--color-bg))',
};

// Concrete hexes per theme — ONLY for recharts/SVG fills. See houseColorsHex.
export const categoryColorsHex: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    original: '#EDE6DA',
    print: '#DDD7CB',
    photograph: '#CEC7BD',
    sculpture: '#BEB8AE',
    design: '#AEA99F',
    object: '#A6A198',
    unknown: '#9F9991',
  },
  light: {
    original: '#241E15',
    print: '#332D24',
    photograph: '#413B32',
    sculpture: '#504A41',
    design: '#5F5950',
    object: '#666157',
    unknown: '#6D685E',
  },
};

export function makeAuctionIcs(lot: {
  id: string;
  title: string;
  auctionHouse: string;
  saleDate: string;
  /** when the house publishes a close TIME, the event is timed (1h window
      ending at the close) instead of an all-day block */
  saleDateTime?: string | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  currency: string;
  url: string;
  artist: string;
}): string | null {
  // A malformed/absent saleDate must return null (caller no-ops) — never
  // throw inside the click handler that builds the calendar file.
  const d = new Date((lot.saleDate || '') + 'T12:00:00');
  if (!lot.saleDate || !/^\d{4}-\d{2}-\d{2}/.test(lot.saleDate) || isNaN(d.getTime())) return null;
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
  const fmtDate = (iso: string) => iso.replace(/-/g, '').slice(0, 8);
  const nextDay = new Date(d.getTime() + 86_400_000);

  const fmtPrice = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n}`;

  // NOT lot.currency: the served money aliases (estimateLow/High, priceUsd) all
  // carry USD by contract, while `currency` still names the sale's NATIVE
  // currency — so this printed "Est. $650–$910 GBP", a dollar figure wearing a
  // pound label. The figures are dollars; say dollars.
  const estLine = lot.estimateLow && lot.estimateHigh
    ? `Est. ${fmtPrice(lot.estimateLow)}–${fmtPrice(lot.estimateHigh)} USD\\n`
    : '';

  const desc = esc(`${estLine}${lot.url}`);
  const summary = esc(`${lot.title} · ${lot.auctionHouse}`);

  // timed close when the house publishes one — the event lands at the
  // hammer, not as an all-day block (and the alarm tightens to 1h out)
  const closeMs = lot.saleDateTime ? Date.parse(lot.saleDateTime) : NaN;
  const timed = Number.isFinite(closeMs);
  const utcStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dtLines = timed
    ? [`DTSTART:${utcStamp(closeMs - 3_600_000)}`, `DTEND:${utcStamp(closeMs)}`]
    : [`DTSTART;VALUE=DATE:${fmtDate(lot.saleDate)}`, `DTEND;VALUE=DATE:${fmtDate(nextDay.toISOString())}`];

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//co.stil lectr//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:ray-${lot.id}@costil`,
    ...dtLines,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}`,
    `URL:${lot.url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${timed ? 'Auction closes within the hour' : 'Auction today'}`,
    `TRIGGER:${timed ? '-PT1H' : '-PT8H'}`,
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Auction tomorrow',
    'TRIGGER:-P1D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/** A lot's TRUE sale day (YYYY-MM-DD). The crawler stamps `saleDate` with the
 *  CRAWL DAY as a fallback when it can't read a real date off a search/artist
 *  page — so an old sold lot re-seen there would otherwise show as "on the
 *  block today". `saleDateTime`, when set, is the genuinely-parsed timestamp
 *  and always wins. Every liveness comparison runs on this, never on the raw
 *  (possibly crawl-day) saleDate. */
/** (pass 6) per-lot memo, guarded on the three fields the read uses */
const saleDayCache = new WeakMap<object, { dt: string | null | undefined; sd: string | null | undefined; h: string | null | undefined; v: string }>();
export function trueSaleDay(l: { saleDate?: string | null; saleDateTime?: string | null; auctionHouse?: string | null }): string {
  const hit = saleDayCache.get(l);
  if (hit && hit.dt === l.saleDateTime && hit.sd === l.saleDate && hit.h === l.auctionHouse) return hit.v;
  const v = trueSaleDayRead(l);
  saleDayCache.set(l, { dt: l.saleDateTime, sd: l.saleDate, h: l.auctionHouse, v });
  return v;
}
function trueSaleDayRead(l: { saleDate?: string | null; saleDateTime?: string | null; auctionHouse?: string | null }): string {
  const dt = l.saleDateTime;
  // a Christie's local-midnight DAY stamp marks the sale-local day, not a moment
  if (dt && isDayStamp(l)) return dayOfDayStamp(dt);
  // A zoned instant (Z / ±hh:mm) is a moment, not a calendar day: read it on
  // the reader's calendar. Slicing the ISO took the UTC date, so every Goldin
  // close (10pm ET = 02:00Z) landed on the NEXT day and "48 hours" showed 1
  // lot out of 1,180 closing tomorrow night. Naive stamps stay as written.
  if (dt && dt.length > 10 && /(?:Z|[+-]\d\d:?\d\d)$/.test(dt)) {
    const d = new Date(dt);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
  return dt ? dt.slice(0, 10) : (l.saleDate || '').slice(0, 10);
}

/** THE printed close day — what every "hammers <day>" / "closes <day>" /
 *  "hammered <day>" print reads (Oct 11 2026). The reader's TRUE day
 *  (trueSaleDay), falling back to the crawl's saleDate only when the lot
 *  carries no usable stamp. Raw saleDate is the crawl/house day: a Goldin
 *  close at 1:56 AM ET Oct 10 printed "Oct 9" on the lot page while the feed,
 *  the "In" column and the closing windows all said Oct 10. */
export function closeDayOf(l: { saleDate?: string | null; saleDateTime?: string | null; auctionHouse?: string | null }): string {
  return trueSaleDay(l) || (l.saleDate || '');
}

/** THE upcoming-visibility predicate — ONE definition of "live" for every
 *  surface (feed, /value, /[artist], nav counts), mirroring build-upcoming's
 *  semantics.
 *
 *  Un-resulted lots (Oct 9): live until the sale is over WHERE IT IS HELD
 *  (app/lib/house-tz liveUntilMs) — a timed close plus the extended-bidding /
 *  live-session slack, or, for a date-only sale, the end of the sale day in
 *  the house's zone. The reader's calendar used to decide: a Phillips online
 *  sale that closed at 10 AM ET stayed "live" all evening, and a Hong Kong
 *  reader lost a New York sale on its own afternoon.
 *
 *  Results-pending lots (it closed; the house hasn't posted) keep the short
 *  grace window (default 1 day) on the reader's calendar, as before, and wear
 *  the existing results-pending state. Pass the reader's localToday()
 *  client-side; `nowMs` defaults to the reader's clock. */
export function isLiveUpcoming(
  l: { status: string; saleDate?: string | null; saleDateTime?: string | null; resultsPending?: boolean; auctionHouse?: string | null; saleName?: string | null; currency?: string | null; id?: string | null; closeKind?: 'online' | 'session' | null },
  todayIso: string = localToday(),
  graceDays = 1,
  nowMs: number = Date.now(),
): boolean {
  if (l.status !== 'upcoming') return false;
  const day = trueSaleDay(l);
  if (!day) return false;
  if (l.resultsPending) {
    if (day >= todayIso) return true;
    const graceCut = new Date(Date.parse(`${todayIso}T00:00:00Z`) - graceDays * 864e5).toISOString().slice(0, 10);
    return day >= graceCut;
  }
  const until = liveUntilMs(l);
  if (until != null) return nowMs <= until;
  return day >= todayIso;
}

/** Has a results-pending lot's sale already closed? The house-zone close
 *  (liveUntilMs: timed close + slack, or the end of the sale day where it is
 *  held) is behind `nowMs`. Pending lots stay VISIBLE for isLiveUpcoming's
 *  grace day (they wear the results-pending state), but they are no longer on
 *  the block: Oct 10, 49 Phillips NY080426 lots that closed Oct 9 10 AM ET
 *  were counted in /makers' "live" and "Closing tonight". */
export function isClosedPending(
  l: { status?: string; resultsPending?: boolean; saleDate?: string | null; saleDateTime?: string | null; auctionHouse?: string | null; saleName?: string | null; currency?: string | null; id?: string | null; closeKind?: 'online' | 'session' | null },
  nowMs: number = Date.now(),
): boolean {
  if (!l.resultsPending || (l.status != null && l.status !== 'upcoming')) return false;
  const until = liveUntilMs(l);
  return until != null && nowMs > until;
}

/** ON THE BLOCK — what every live COUNT reads (/makers rows + masthead, the
 *  lenses, entity pages): isLiveUpcoming minus the results-pending lots whose
 *  sale has closed (isClosedPending). */
export function isOnBlock(
  l: Parameters<typeof isLiveUpcoming>[0],
  todayIso: string = localToday(),
  nowMs: number = Date.now(),
): boolean {
  return isLiveUpcoming(l, todayIso, 1, nowMs) && !isClosedPending(l, nowMs);
}

/** live lots per maker slug — the nav, the market rail, ⌘K. (r7, QA2 Q4) on
 *  the block only (isOnBlock): a results-pending lot whose sale has closed
 *  still shows (it wears its results-pending state) but counts nowhere. */
export function getUpcomingCounts(lots: Array<{ status: string; saleDate: string | null; saleDateTime?: string | null; artist: string; resultsPending?: boolean }>): Record<string, number> {
  const today = localToday();
  const now = Date.now();
  const counts: Record<string, number> = {};
  for (const lot of lots) {
    if (isOnBlock(lot, today, now)) {
      counts[lot.artist] = (counts[lot.artist] || 0) + 1;
    }
  }
  return counts;
}

// ── watch reference labels (the /ref dossier grammar) ────────────────────────
// Known model lines read as words; bare numerics read as references.
const REF_LINE_LABELS: Record<string, string> = {
  oysterperpetual: 'Oyster Perpetual', royaloak: 'Royal Oak', seamaster: 'Seamaster',
  calatrava: 'Calatrava', santos: 'Santos', constellation: 'Constellation',
  speedmaster: 'Speedmaster', pasha: 'Pasha', gondolo: 'Gondolo', cellini: 'Cellini',
  nautilus: 'Nautilus', aquanaut: 'Aquanaut', datejust: 'Datejust', daytona: 'Daytona',
  submariner: 'Submariner', cosmograph: 'Cosmograph', tank: 'Tank', panthère: 'Panthère',
  panthere: 'Panthère', ballon: 'Ballon Bleu', deville: 'De Ville', reverso: 'Reverso',
  explorer: 'Explorer', gmtmaster: 'GMT-Master', milgauss: 'Milgauss', yachtmaster: 'Yacht-Master',
  seadweller: 'Sea-Dweller', airking: 'Air-King', tortue: 'Tortue', baignoire: 'Baignoire',
  ronde: 'Ronde', roadster: 'Roadster', cloche: 'Cloche', must: 'Must de Cartier',
  // the run-together model keys refs.json carries (audit Oct 3: 'Royaloakoffshore')
  royaloakoffshore: 'Royal Oak Offshore', julesaudemars: 'Jules Audemars', millenary: 'Millenary',
  mustdecartier: 'Must de Cartier', ballonbleu: 'Ballon Bleu', worldtime: 'World Time',
  daydate: 'Day-Date', oyster: 'Oyster', oysterdate: 'Oysterdate', crash: 'Crash', ellipse: 'Ellipse',
  railmaster: 'Railmaster', twenty4: 'Twenty~4', e1200: 'Ref. E1200', radiomir: 'Radiomir', ck987: 'Ref. CK987',
};
export function refLabel(ref: string): string {
  if (REF_LINE_LABELS[ref]) return REF_LINE_LABELS[ref];
  if (/^\d[\dA-Za-z/.-]*$/.test(ref)) return `Ref. ${ref.toUpperCase()}`;
  return ref.charAt(0).toUpperCase() + ref.slice(1);
}
