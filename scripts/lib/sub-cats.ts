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
  ['apollo', /apollo/i],
  ['mercury-gemini', /\bgemini\b|\bmercury\b/i],
  ['shuttle-iss', /shuttle|sts-\d|\biss\b|skylab/i],
  ['soviet', /soyuz|sputnik|cosmonaut|vostok|voskhod|\bmir\b|lunokhod/i],
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

function designKind(formKey: string): string {
  if (formKey.startsWith('seating')) return 'seating';
  if (formKey === 'table' || formKey === 'desk') return 'tables';
  if (formKey === 'case') return 'case-storage';
  if (formKey === 'lighting' || formKey === 'lamp') return 'lighting';
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
export function subCatOf(l: Lot, sportMaps?: { byPid: Map<string, string>; byPlayer: Map<string, string> }): SubCatStamp {
  const vert = ARTIST_MARKET[l.artist as keyof typeof ARTIST_MARKET];
  const title = (l.title as string) || '';
  const formKey = (l.formKey as string) || 'unknown';

  if (vert === 'sports') {
    const subCat = SPORTS_KIND[l.artist as string] ?? null;
    let drill = sportSlugOf(l.sport);
    if (!drill && sportMaps) {
      const pid = l._pid != null ? String(l._pid) : null;
      const card = l._card as { playerSlug?: string } | undefined;
      const player = (l.playerSlug as string) || card?.playerSlug || null;
      drill = (pid && sportMaps.byPid.get(pid)) || (player && sportMaps.byPlayer.get(player)) || null;
    }
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
    return { subCat: designKind(formKey), drill, flown: null };
  }

  return { subCat: null, drill: null, flown: null };
}

/** Human labels for drill/subCat slugs (UI + board rows). */
export const SUBCAT_LABELS: Record<string, string> = {
  // sports kinds
  'cards': 'Cards', 'game-used': 'Game-used', 'memorabilia': 'Memorabilia',
  'tickets': 'Tickets', 'trophies': 'Trophies & awards',
  // sports
  'basketball': 'Basketball', 'baseball': 'Baseball', 'football': 'Football',
  'soccer': 'Soccer', 'hockey': 'Hockey', 'boxing-mma': 'Boxing & MMA',
  'golf': 'Golf', 'racing': 'Racing', 'tennis': 'Tennis', 'olympics': 'Olympics',
  'wrestling': 'Wrestling',
  // watches
  'wristwatches': 'Wristwatches', 'pocket-watches': 'Pocket watches', 'clocks': 'Clocks',
  'daytona': 'Daytona', 'submariner': 'Submariner', 'gmt-master': 'GMT-Master',
  'day-date': 'Day-Date', 'datejust': 'Datejust', 'explorer': 'Explorer',
  'sea-dweller': 'Sea-Dweller', 'yacht-master': 'Yacht-Master', 'milgauss': 'Milgauss',
  'air-king': 'Air-King', 'cellini': 'Cellini', 'oyster-perpetual': 'Oyster Perpetual',
  'nautilus': 'Nautilus', 'aquanaut': 'Aquanaut', 'calatrava': 'Calatrava',
  'world-time': 'World Time', 'ellipse': 'Ellipse', 'gondolo': 'Gondolo',
  'twenty-4': 'Twenty~4', 'perpetual-calendar': 'Perpetual Calendar',
  'chronograph': 'Chronograph', 'royal-oak': 'Royal Oak', 'millenary': 'Millenary',
  'jules-audemars': 'Jules Audemars', 'tank': 'Tank', 'santos': 'Santos',
  'panthere': 'Panthère', 'crash': 'Crash', 'ballon-bleu': 'Ballon Bleu',
  'pasha': 'Pasha', 'tortue': 'Tortue', 'baignoire': 'Baignoire',
  'speedmaster': 'Speedmaster', 'seamaster': 'Seamaster', 'constellation': 'Constellation',
  'de-ville': 'De Ville',
  // culture kinds + domains
  'photos': 'Signed photos', 'documents': 'Documents & letters', 'autographs': 'Autographs',
  'worn-personal': 'Worn & personal', 'instruments': 'Instruments', 'awards': 'Awards',
  'props': 'Props', 'posters': 'Posters', 'records': 'Records', 'other': 'Other',
  'music': 'Music', 'hollywood': 'Hollywood & film', 'political': 'Presidents & political',
  'historic': 'Historic figures', 'military': 'Military & aviation', 'royalty': 'Royalty & society',
  'literary': 'Arts & letters', 'space-science': 'Space & science figures', 'sports': 'Sports icons',
  // science
  'space': 'Space', 'tech': 'Tech & scientists', 'meteorites': 'Meteorites', 'fossils': 'Fossils',
  'apollo': 'Apollo', 'mercury-gemini': 'Mercury & Gemini', 'shuttle-iss': 'Shuttle & ISS',
  'soviet': 'Soviet program', 'computing': 'Apple & computing', 'physics-figures': 'Scientists & physicists',
  'globes': 'Globes', 'telescopes': 'Telescopes', 'microscopes': 'Microscopes',
  'navigation': 'Navigation', 'medical': 'Medical', 'precision-clocks': 'Precision clocks',
  // art
  'prints': 'Prints & multiples', 'originals': 'Original works', 'sculpture': 'Sculpture & ceramics',
  'photographs': 'Photographs', 'books': 'Books',
  // design
  'seating': 'Seating', 'tables': 'Tables & desks', 'case-storage': 'Case & storage',
  'lighting': 'Lighting', 'objects': 'Objects',
  'walnut': 'Walnut', 'teak': 'Teak', 'oak': 'Oak', 'rosewood': 'Rosewood',
  'plywood': 'Plywood', 'steel': 'Steel', 'aluminum': 'Aluminum',
  'fiberglass': 'Fiberglass', 'bronze': 'Bronze', 'glass': 'Glass', 'upholstery': 'Upholstered',
};
export const subCatLabel = (slug: string): string => SUBCAT_LABELS[slug] ?? slug;
