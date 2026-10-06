/**
 * sub-cats.ts — the sub-category taxonomy stamps (Collin-approved tree,
 * Jul 31 2026). Two levels below the vertical:
 *
 *   subCat — the KIND within a vertical (sports: cards/game-used/tickets…;
 *            watches: wristwatches/pocket-watches/clocks; art: prints/originals…)
 *   drill  — the performance split within a kind (sport for sports kinds,
 *            model family for wristwatches, subject domain for culture,
 *            program for space, material for design)
 *   flown  — space-only boolean (flown vs not-flown is its own A-vs-B)
 *
 * Everything here is ADDITIVE metadata: no engine (comps/value/backtest)
 * reads these fields. Stamped corpus-wide by corpus-normalize (idempotent,
 * deterministic — derived purely from existing fields, so re-runs converge).
 */
import { ARTIST_MARKET } from '../../app/constants';
import { SUBJECT_DOMAINS } from './subject-domains';

type Lot = Record<string, unknown>;

// ── sports ──────────────────────────────────────────────────────────────────
const SPORTS_KIND: Record<string, string> = {
  'sports-cards': 'cards',
  'game-used': 'game-used',
  'sports-memorabilia': 'memorabilia',
  'tickets-passes': 'tickets',
  'trophies-awards': 'trophies',
  // Aug-2026 expansion pseudo-artists (REA/H&S/SCP/Lelands/ML/LOTG) — absent
  // from this map, stampSubCats was WIPING their crawler-stamped subCats
  // (~280k rows, Aug 13 audit)
  'graded-cards': 'cards',
  'memorabilia': 'memorabilia',
  'autographs': 'autographs',
  'unopened-wax': 'wax',
  'type-1-photos': 'photos',
  'programs-publications': 'programs',
  'equipment-artifacts': 'equipment',
};
// Goldin's stamped sport values → our drill slugs
const SPORT_SLUG: Record<string, string> = {
  'Basketball': 'basketball', 'Baseball': 'baseball', 'Football': 'football',
  'Soccer': 'soccer', 'Hockey': 'hockey', 'Boxing / MMA': 'boxing-mma',
  'Golf': 'golf', 'Racing': 'racing', 'Tennis': 'tennis', 'Olympics': 'olympics',
  'Wrestling': 'wrestling',
};
export const sportSlugOf = (raw: unknown): string | null =>
  typeof raw === 'string' ? SPORT_SLUG[raw] ?? null : null;

// (wave 2) the sport a sports lot's OWN words name, when no house stamp or
// learned player says so — the expansion houses (REA / H&S / Lelands / LOTG /
// ML / SCP) stamp no sport, so ~385 audited vintage baseball cards, tickets
// and signed balls carried no drill. Ordered: explicit sport words, then
// leagues / events, then franchise names unique to one sport, then the
// pre-war set codes and vintage issues (all baseball once the non-sport
// issues are out of the vertical — classify.ts sportsHouseCardLotKind).
const SPORT_WORDS: [string, RegExp][] = [
  ['boxing-mma', /\b(?:boxing|boxers?|heavyweight|middleweight|welterweight|lightweight|ufc|mma|prize ?fight|fight[- ]worn|title fight|bout|abe attell|jack dempsey|gene tunney|joe louis|rocky marciano|jack johnson|john l\.? sullivan|jim corbett|bob fitzsimmons|jim jeffries|stanley ketchel|sam langford|joe gans|max schmeling|max baer|jersey joe walcott|ezzard charles|sugar ray robinson|muhammad ali|cassius clay|joe frazier|george foreman|sonny liston|floyd patterson|sugar ray leonard|marvin hagler|mike tyson|jack sharkey|primo carnera|battling nelson|terry mcgovern)\b/i],
  ['golf', /\b(?:golf|golfer|pga|masters tournament|ryder cup|british open)\b/i],
  ['tennis', /\b(?:tennis|wimbledon|us open tennis)\b/i],
  ['racing', /\b(?:nascar|formula (?:1|one)|f1|indy ?500|racing|daytona 500)\b/i],
  ['wrestling', /\b(?:wrestling|wrestler|wwe|wwf|wcw)\b/i],
  ['olympics', /\b(?:olympics?|olympic games)\b/i],
  ['hockey', /\b(?:hockey|nhl|stanley cup|puck|maple leafs|canadiens|red wings|blackhawks|bruins)\b/i],
  ['basketball', /\b(?:basketballs?|nba|aba|final four|lakers|celtics|knicks|76ers|pistons|warriors|harlem globetrotters)\b/i],
  ['football', /\b(?:footballs?|nfl|afl|super bowl|heisman|rose bowl|packers|steelers|cowboys|49ers|redskins|buccaneers|seahawks|bengals)\b/i],
  ['soccer', /\b(?:soccer|fifa|world cup|premier league|la liga|champions league|fc barcelona|real madrid|manchester united|boca juniors)\b/i],
  ['baseball', /\b(?:baseballs?|base ball|b\.b\.c\.|mlb|world series|home runs?|perfect game|no-hitter|lineup cards?|line-up cards?|louisville slugger|national league|american league|federal league|negro leagues?|pcl|yankees|red sox|white sox|dodgers|cubs|mets|phillies|orioles|pirates|tigers|indians|athletics|brewers|astros|padres|mariners|expos|twins|royals|braves|reds|senators|browns|doves|red stockings|highlanders|superbas|beaneaters|naps)\b/i],
];
/** pre-war set codes and vintage issues that are baseball (T206, E90, N172, D304, M116, W551, R319, Goudey, Old Judge …) */
const BASEBALL_ISSUE_RE = /^\s*(?:\d{1,3}\s+)?(?:(?:19|18)\d\d(?:-\d{2,4})?\s+)?(?:[TEDMNRW]-?\d{1,3}(?:-\d)?|N-?Unc)\b|\b(?:goudey|play ball|cracker jack|zeenut|old judge|delong|diamond stars|turkey red|sporting life|bazooka|double play|red man|kahn'?s|exhibits?|leaf|callahan|perez-steele)\b/i;
export function sportFromText(title: string): string | null {
  for (const [sport, re] of SPORT_WORDS) if (re.test(title)) return sport;
  return BASEBALL_ISSUE_RE.test(title) ? 'baseball' : null;
}

// ── watches ─────────────────────────────────────────────────────────────────
// model families per maker, matched over `${reference} ${title}` lowercase.
// ORDER MATTERS: specific families before generic complications (a Daytona is
// a chronograph — daytona must win).
const WATCH_FAMILIES: Record<string, [string, RegExp][]> = {
  'rolex': [
    ['daytona', /daytona/], ['submariner', /submariner/], ['gmt-master', /gmt/],
    ['day-date', /day-?date/], ['datejust', /datejust/], ['explorer', /explorer/],
    ['sea-dweller', /sea-?dweller/], ['yacht-master', /yacht-?master/],
    ['milgauss', /milgauss/], ['air-king', /air-?king/], ['cellini', /cellini/],
    ['oyster-perpetual', /oyster ?perpetual|oysterperpetual/],
  ],
  'patek-philippe': [
    ['nautilus', /nautilus/], ['aquanaut', /aquanaut/], ['calatrava', /calatrava/],
    ['world-time', /world ?time|heures universelles/], ['ellipse', /ellipse/],
    ['gondolo', /gondolo/], ['twenty-4', /twenty.?4/],
    ['perpetual-calendar', /perpetual calendar|quantieme perpetuel|quantième perpétuel/],
    ['chronograph', /chronograph|chronographe/],
  ],
  'audemars-piguet': [
    ['royal-oak', /royal ?oak/], ['millenary', /millenary/],
    ['jules-audemars', /jules audemars/], ['perpetual-calendar', /perpetual calendar/],
    ['chronograph', /chronograph/],
  ],
  'cartier': [
    ['tank', /\btank\b/], ['santos', /santos/], ['panthere', /panth[eè]re/],
    ['crash', /crash/], ['ballon-bleu', /ballon bleu/], ['pasha', /pasha/],
    ['tortue', /tortue/], ['baignoire', /baignoire/],
  ],
  'omega': [
    ['speedmaster', /speedmaster/], ['seamaster', /seamaster/],
    ['constellation', /constellation/], ['de-ville', /de ?ville/],
  ],
};

// ── culture ─────────────────────────────────────────────────────────────────
// itemClass (stamped by stampCultureAxes) → kind rollup
const CULT_KIND: Record<string, string> = {
  'signed-photo': 'photos', 'photo': 'photos',
  'document': 'documents', 'signed-cut': 'documents', 'check': 'documents', 'script': 'documents',
  'autograph-other': 'autographs',
  'costume': 'worn-personal',
  'instrument': 'instruments', 'award': 'awards', 'prop': 'props',
  'poster': 'posters', 'record': 'records', 'ticket': 'tickets',
};
// sale-name fallback when no subject maps to a domain
const CULT_SALE_DOMAIN: [RegExp, string][] = [
  [/marvels of modern music|rock n'? ?roll|music/i, 'music'],
  [/hollywood|movie|film|entertainment/i, 'hollywood'],
  [/president|political|white house/i, 'political'],
  [/space|aviation/i, 'space-science'],
];

// ── science ─────────────────────────────────────────────────────────────────
const SCI_KIND: Record<string, string> = {
  'space-exploration': 'space', 'scientific-instruments': 'instruments',
  'science-tech': 'tech', 'meteorites': 'meteorites', 'fossils': 'fossils',
};
const SPACE_PROGRAM: [string, RegExp][] = [
  // (wave 2) Skylab flew Apollo hardware (the Apollo Applications Program)
  ['apollo', /apollo|skylab/i],
  ['mercury-gemini', /\bgemini\b|\bmercury\b/i],
  ['shuttle-iss', /shuttle|sts-\d|\biss\b/i],
  ['soviet', /soyuz|sputnik|cosmonaut|vostok|voskhod|\bmir\b|lunokhod|\bsoviet\b|\bussr\b|\bn1-l3\b|gagarin|korolev/i],
  // (wave 2) RR's space catalogue titles a lot by the astronaut alone ("Neil
  // Armstrong Signed Photograph", "Gus Grissom Check"): the program of the
  // astronaut's era — Apollo crews and moon words first, then the Mercury /
  // Gemini-only names (a Schirra + Cunningham photo is Apollo 7)
  ['apollo', /\b(?:neil armstrong|buzz aldrin|michael collins|alan bean|edgar mitchell|(?:jim|james) irwin|(?:charlie|charles) duke|(?:gene|eugene) cernan|harrison schmitt|(?:al|alfred) worden|fred haise|jack swigert|stuart roosa|(?:ron|ronald) evans|walt(?:er)? cunningham|donn eisele|(?:bill|william) anders|(?:dave|david) scott|(?:pete|charles) conrad|rusty schweickart|moonwalkers?|moon ?walk|first man on the moon|lunar|saturn v|command module)\b/i],
  ['mercury-gemini', /\b(?:john glenn|gus grissom|virgil grissom|scott carpenter|wally schirra|walter schirra|deke slayton|gordon cooper|liberty bell 7|friendship 7|freedom 7|ham the chimp|mercury (?:7|seven)|original seven)\b/i],
];
const FLOWN_RE = /\bflown\b|carried aboard|lunar surface|surface[- ]carried/i;
const TECH_DRILL: [string, RegExp][] = [
  ['computing', /apple|steve jobs|macintosh|wozniak|computer|ibm\b|commodore|altair|enigma|microsoft|\bnext\b|calculator/i],
  ['physics-figures', /einstein|newton|curie|tesla|edison|darwin|hawking|galileo|faraday|bohr|oppenheimer|feynman|freud|pasteur/i],
];
const INSTR_DRILL: [string, RegExp][] = [
  ['globes', /globe/i], ['telescopes', /telescope/i], ['microscopes', /microscope/i],
  ['navigation', /sextant|octant|compass|astrolabe|orrery|planetari/i],
  ['medical', /medical|surgical|apothecary|anatomical|dental/i],
  ['precision-clocks', /clock|chronometer|regulator/i],
];

// ── art / design ────────────────────────────────────────────────────────────
const ART_KIND: Record<string, string> = {
  'print': 'prints', 'poster': 'prints',
  'original-2d': 'originals', 'work-on-paper': 'originals', 'painting': 'originals',
  'sculpture': 'sculpture', 'photograph': 'photographs', 'book': 'books',
};
const DESIGN_MATERIALS = ['walnut', 'teak', 'oak', 'rosewood', 'plywood', 'steel', 'aluminum', 'fiberglass', 'bronze', 'glass', 'upholstery'];

// Design MODEL vocabulary (Oct 6 2026 audit): the title of a design lot is
// often only a model code or a series name ("LCW", "DSR", "RKR-1", "ESU 400",
// "Guéridon, model no. 401", "PJ-SI-30-A", "Frenchman's Cove II", "Sundra
// dining suite") — the form ladder in comps.classifyForm reads none of them,
// and 2.6k lots sat in 'objects'. Read title + the head of the description
// (Bonhams prints the form there). Nouns carry no trailing \b: Bonhams glues
// the next field on ("Committee' Chairscirca 1953").
const DESIGN_KIND_WORDS: [string, RegExp][] = [
  ['lighting', /\b(?:lamps?|lampe|lighting|light fixture|wall light|ceiling light|floor light|potence|sconces?|applique|lanterns?|chandeliers?)/i],
  ['case-storage', /\besus?\b|\b(?:eames storage unit|storage units?|cabinets?|chests?|bookcases?|biblioth[eè]que|room divider|wall case|credenza|sideboards?|dressers?|rangement|kornblut|pj-r-|wardrobes?|armoire|shelv(?:es|ing)|bookshel)/i],
  ['seating', /\b(?:lcw|lcm|dcw|dcm|dsr|dsw|dsx|dss|dar|dax|rar|raw|rkr|pkw|pkc|lar|lax|dkr|dkx|es ?\d{3}|670|671)(?:s|-?\d)?\b|\b(?:pj-si|chairs?|armchairs?|fauteuils?|chaises?|chaise longue|lounge|stools?|tabourets?|bench(?:es)?|settees?|sofas?|canap[ée]|daybeds?|rockers?|rocking|ottomans?|seating|kangaroo|committee)/i],
  ['tables', /\b(?:etr|ltr|ctw|otw|dtw|etw)(?:s|-?\d)?\b|\b(?:pj-ta|pj-bu|tables?|gu[ée]ridon|compas|desks?|bureau|frenchman'?s cove|minguren|dining suite|sundra|conoid dining)/i],
];
function designKind(formKey: string, title = '', desc = ''): string {
  if (formKey.startsWith('seating')) return 'seating';
  if (formKey.startsWith('table') || formKey === 'desk') return 'tables';
  if (formKey === 'case') return 'case-storage';
  if (formKey === 'lighting' || formKey === 'lamp') return 'lighting';
  // the title decides first; the description only when the title names nothing
  if (/\b(?:mirrors?|miroir|vases?|bowls?|trays?|screens?|clocks?|sculptures?|rugs?|textiles?|beds?|headboards?)\b/i.test(title)) return 'objects';
  // the EARLIEST-named form wins ("Dining table and five chairs" is a table lot)
  for (const src of [title, desc]) {
    let best: string | null = null, at = Infinity;
    for (const [kind, re] of DESIGN_KIND_WORDS) { const m = re.exec(src); if (m && m.index < at) { at = m.index; best = kind; } }
    if (best) return best;
  }
  return 'objects';
}

// ── the stamps ──────────────────────────────────────────────────────────────
export interface SubCatStamp { subCat: string | null; drill: string | null; flown: boolean | null }

/**
 * Derive the (subCat, drill, flown) stamp for one lot. `sportMaps` supplies the
 * learned player→sport maps (built by corpus-normalize from lots whose sport
 * Goldin stamped directly) so unstamped cards/memorabilia inherit their
 * player's sport.
 */
export function subCatOf(l: Lot, sportMaps?: { byPid: Map<string, string>; byPlayer: Map<string, string>; cardPlayer?: (l: Lot) => string | null }): SubCatStamp {
  const vert = ARTIST_MARKET[l.artist as keyof typeof ARTIST_MARKET];
  const title = (l.title as string) || '';
  const formKey = (l.formKey as string) || 'unknown';

  if (vert === 'sports') {
    const subCat = SPORTS_KIND[l.artist as string] ?? null;
    let drill = sportSlugOf(l.sport);
    if (!drill && sportMaps) {
      const pid = l._pid != null ? String(l._pid) : null;
      const card = l._card as { playerSlug?: string } | undefined;
      const player = (l.playerSlug as string) || card?.playerSlug || (sportMaps.cardPlayer ? sportMaps.cardPlayer(l) : null) || null;
      drill = (pid && sportMaps.byPid.get(pid)) || (player && sportMaps.byPlayer.get(player)) || null;
    }
    if (!drill) drill = sportFromText(title);
    return { subCat, drill, flown: null };
  }

  if (vert === 'watches') {
    const subCat = formKey === 'wristwatch' ? 'wristwatches'
      : formKey === 'pocket-watch' ? 'pocket-watches'
      : formKey === 'clock' ? 'clocks'
      : formKey === 'jewelry' ? 'jewelry' : null;
    let drill: string | null = null;
    if (subCat === 'wristwatches') {
      const fams = WATCH_FAMILIES[l.artist as string];
      if (fams) {
        const hay = `${(l.reference as string) || ''} ${title}`.toLowerCase();
        for (const [fam, re] of fams) if (re.test(hay)) { drill = fam; break; }
      }
    }
    return { subCat, drill, flown: null };
  }

  if (vert === 'tcg') {
    // Pokémon's own axis: product form (sealed wax vs singles), era drill by
    // the leading year Goldin titles always carry ("1998 Pokemon Japanese …").
    // a card NUMBER makes it a single, whatever product it was pulled from
    // ("Stamp Box Full Art #227 Pikachu", "Card Pack 25th Anniversary #006",
    // "Collector Chest Holo #SM226") — 1.2k singles were filed sealed
    const subCat = !/#\s?[A-Za-z0-9]/.test(title) && /\b(booster|sealed|unopened|box(es)?|packs?|case|display|tins?|blister|bundle|elite trainer)\b/i.test(title) ? 'pokemon-sealed' : 'pokemon-cards';
    const y = (title.match(/\b(19|20)\d{2}\b/) || [])[0];
    const yr = y ? parseInt(y, 10) : null;
    const drill = yr ? (yr <= 2002 ? 'vintage' : yr <= 2016 ? 'classic' : 'modern') : null;
    return { subCat, drill, flown: null };
  }

  if (vert === 'culture') {
    const subCat = CULT_KIND[(l.itemClass as string) || ''] ?? 'other';
    let drill: string | null = null;
    const subjects = l.subjectKeys as string[] | undefined;
    if (Array.isArray(subjects)) {
      for (const s of subjects) {
        const d = SUBJECT_DOMAINS[s];
        if (d && d !== 'other') { drill = d; break; }
      }
    }
    if (!drill) {
      const sale = (l.saleName as string) || '';
      for (const [re, d] of CULT_SALE_DOMAIN) if (re.test(sale)) { drill = d; break; }
    }
    return { subCat, drill, flown: null };
  }

  if (vert === 'science') {
    const subCat = SCI_KIND[l.artist as string] ?? null;
    let drill: string | null = null;
    let flown: boolean | null = null;
    if (subCat === 'space') {
      for (const [k, re] of SPACE_PROGRAM) if (re.test(title)) { drill = k; break; }
      flown = FLOWN_RE.test(title);
    } else if (subCat === 'tech') {
      for (const [k, re] of TECH_DRILL) if (re.test(title)) { drill = k; break; }
    } else if (subCat === 'instruments') {
      for (const [k, re] of INSTR_DRILL) if (re.test(title)) { drill = k; break; }
    }
    return { subCat, drill, flown };
  }

  if (vert === 'art') {
    return { subCat: ART_KIND[formKey] ?? 'other', drill: null, flown: null };
  }

  if (vert === 'design') {
    let drill: string | null = null;
    const mats = l.materialTokens as string[] | undefined;
    if (Array.isArray(mats)) for (const m of DESIGN_MATERIALS) if (mats.includes(m)) { drill = m; break; }
    return { subCat: designKind(formKey, title, String(l.description || '').slice(0, 300)), drill, flown: null };
  }

  return { subCat: null, drill: null, flown: null };
}

export { SUBCAT_LABELS, subCatLabel } from '../../app/lib/subcat-labels';
