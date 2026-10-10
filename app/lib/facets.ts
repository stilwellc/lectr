/**
 * facets.ts — the cuts collectors shop by INSIDE one category (Oct 9): a card
 * buyer narrows by Graded / Raw / Rookie / Signed / Relic / Numbered, then by
 * grader and grade, and by era; a space buyer by Flown / Signed; an
 * entertainment buyer by Film & TV vs Music, then by franchise or act. Read
 * from the title at view time with the one card parser (app/lib/cards.parseCard
 * — ~13µs a lot), memoized per lot object; nothing is stamped on the payload.
 *
 * Keys are flat strings so the filter is one URL list (`fx=graded,psa,g10`).
 * Keys in an exclusive set (`xor`) replace each other (Graded / Raw, one
 * grader, Film & TV / Music); keys in an any-of set (`any` — era, grade,
 * language, franchise, complication, medium) OR together ("Chronograph or
 * Perpetual calendar", "Gem 10 or 9.5"); the sets AND across each other.
 *
 * THE STRIP STAYS SHORT (labels wave, Oct 9): a deeper cut only appears once
 * its parent is picked — the grader after 'Graded', the grade after a grader
 * (a BGS 9.5 is not a PSA 9.5; once PSA is picked the other graders step
 * aside), the franchise / act
 * chips after 'Film & TV' / 'Music' — and un-picking (or picking a rival of)
 * the parent drops its children. A chip that cuts nothing stays hidden.
 *
 * CHIPS AUDIT (Oct 9): "cuts nothing" now means keeps ≥95% of its pool
 * (taxonomy NEAR_TOTAL — "Signed 474" inside Autographs 477, "Graded 166"
 * inside Classic 167). When such a hidden chip is a PARENT (Graded, Film &
 * TV, Music; a grader only when it is every slab) its children open as if it
 * were picked, and tapping a child picks the parent with it (`via`) — so a
 * player page whose cards are all slabbed still offers PSA / SGC. The
 * franchise and complication chips run by count, biggest first. Fine Art
 * offers no medium chips: the stamped form splits only 54 of 75 'Paintings &
 * Works on Paper' lots, so "Paintings 22 · Works on paper 32" under that sub
 * never added up (the keys stay for the lot-card badge).
 *
 * Measured on the Oct 9 live book (10,871 lots) — see the labels-facets
 * commit for coverage / precision per facet.
 */
import { parseCard, type CardId } from './cards';
import { taxonOf, NEAR_TOTAL, type CatKey, type Taxon } from './taxonomy';

export type FacetGroup =
  | 'kind' | 'era' | 'domain' | 'grader' | 'grade' | 'lang' | 'qty' | 'franchise' | 'complication' | 'medium';
export interface FacetDef {
  key: string;
  label: string;
  /** the chip row's visual group (a divider sits between groups) */
  group: FacetGroup;
  /** exclusive set: picking one replaces any other key with the same xor */
  xor?: string;
  /** any-of set: several may be picked, a lot needs only one of them */
  any?: string;
  /** shown only once one of these keys is picked; dropped when none is */
  parent?: string[];
  /** once a sibling in its exclusive set is picked, the others hide (the
   *  picked one stays, tap it again to choose another) */
  solo?: boolean;
}

/* ── definitions ─────────────────────────────────────────────────────────── */

const GRADED: FacetDef = { key: 'graded', label: 'Graded', group: 'kind', xor: 'slab' };
const RAW: FacetDef = { key: 'raw', label: 'Raw', group: 'kind', xor: 'slab' };
/** ONE signed key across every category: cards' parser `auto`, elsewhere the
 *  title's signed / autographed / inscribed words (key kept as 'auto' so the
 *  shared card links keep working) */
const SIGNED: FacetDef = { key: 'auto', label: 'Signed', group: 'kind' };
const CARD_KIND: FacetDef[] = [
  GRADED, RAW,
  { key: 'rookie', label: 'Rookie', group: 'kind' },
  SIGNED,
  { key: 'relic', label: 'Relic', group: 'kind' },
  { key: 'numbered', label: 'Numbered', group: 'kind' },
];
const CARD_ERA: FacetDef[] = [
  { key: 'era-prewar', label: 'Pre-war', group: 'era', any: 'era' },
  { key: 'era-vintage', label: '1946–79', group: 'era', any: 'era' },
  { key: 'era-80s90s', label: '1980–99', group: 'era', any: 'era' },
  { key: 'era-modern', label: '2000+', group: 'era', any: 'era' },
];
/** the five graders with a real share of the book (88.8% of single cards);
 *  HGA / GAI / CSG / KSA / GMA slabs stay 'Graded' with no grader chip */
const GRADER_KEYS: [string, string, RegExp][] = [
  ['psa', 'PSA', /^PSA$/], ['sgc', 'SGC', /^SGC$/], ['bgs', 'BGS', /^(?:BGS|BVG)$/],
  ['cgc', 'CGC', /^CGC$/], ['tag', 'TAG', /^TAG$/],
];
const GRADER: FacetDef[] = GRADER_KEYS.map(([key, label]) => ({ key, label, group: 'grader', xor: 'grader', parent: ['graded'], solo: true }));
const GRADE: FacetDef[] = [
  { key: 'g10', label: 'Gem 10' }, { key: 'g95', label: '9.5' }, { key: 'g9', label: '9' },
  { key: 'g7', label: '7–8.5' }, { key: 'g6', label: '≤6' }, { key: 'gauth', label: 'Authentic' },
].map(d => ({ ...d, group: 'grade' as const, any: 'grade', parent: GRADER_KEYS.map(g => g[0]) }));
/** TCG language: Japanese 30%, Chinese 8.4%; every other named language is
 *  ≤3 lots on the book (no chip). English = no language named. */
const TCG_LANG: FacetDef[] = [
  { key: 'lang-en', label: 'English', group: 'lang', any: 'lang' },
  { key: 'lang-ja', label: 'Japanese', group: 'lang', any: 'lang' },
  { key: 'lang-zh', label: 'Chinese', group: 'lang', any: 'lang' },
];
const ENT_DOMAIN: FacetDef[] = [
  { key: 'film-tv', label: 'Film & TV', group: 'domain', xor: 'domain' },
  { key: 'music', label: 'Music', group: 'domain', xor: 'domain' },
];
/** the top 8 franchises / acts on the book (Oct 9: Star Wars 79, Michael
 *  Jackson 57, Beatles 51, Disney 38, Elvis 29, Harry Potter 27, Rolling
 *  Stones 20, Marvel 16) — four per domain, shown under their domain */
const FRANCHISES: [string, string, 'film-tv' | 'music', RegExp][] = [
  ['fr-starwars', 'Star Wars', 'film-tv', /star wars|mandalorian|\bandor\b|\bjedi\b|skywalker|darth vader|boba fett|lucasfilm|obi-wan|clone wars|stormtrooper|chewbacca/i],
  ['fr-disney', 'Disney', 'film-tv', /disney|pixar|toy story|mickey mouse|\bdumbo\b|fantasia|snow white|little mermaid|lion king|roger rabbit|pinocchio|cinderella|peter pan|\bbambi\b|donald duck/i],
  ['fr-potter', 'Harry Potter', 'film-tv', /harry potter|hogwarts|fantastic beasts/i],
  ['fr-marvel', 'Marvel', 'film-tv', /\bmarvel\b|avengers|iron man|spider-?man|x-men|guardians of the galaxy|captain america|black panther|deadpool|wolverine|\bhulk\b/i],
  ['fr-mj', 'Michael Jackson', 'music', /michael jackson/i],
  ['fr-beatles', 'The Beatles', 'music', /beatles|john lennon|\blennon\b|mccartney|ringo starr|george harrison/i],
  ['fr-elvis', 'Elvis', 'music', /\belvis\b|presley/i],
  ['fr-stones', 'Rolling Stones', 'music', /rolling stones|mick jagger|keith richards/i],
];
const FRANCHISE: FacetDef[] = FRANCHISES.map(([key, label, parent]) => ({ key, label, group: 'franchise', any: 'franchise', parent: [parent] }));
const FLOWN: FacetDef = { key: 'flown', label: 'Flown', group: 'kind' };
/** single objects vs multi-item lots ("Lot of 12", "Pair", "(25) Photos").
 *  ONLY 'Single items' is offered as a chip (measured Oct 9): multi-item lots
 *  are 7–14% of memorabilia / historical / entertainment / space and spread
 *  evenly through the book (2–8 of the first 50 rows), so the useful cut is
 *  the one that clears them; the lots-only niche (39–157 lots) is served by
 *  the 'Lot of N' badge on the card. 'multi' stays a key (badges, tests). */
const QTY: FacetDef[] = [
  { key: 'single', label: 'Single items', group: 'qty', xor: 'qty' },
  { key: 'multi', label: 'Multi-item lots', group: 'qty', xor: 'qty' },
];
const SINGLE = QTY[0];
const COMPLICATIONS: [string, string, RegExp][] = [
  ['cx-chrono', 'Chronograph', /chronograph|chronographe|daytona|speedmaster/i],
  ['cx-perpetual', 'Perpetual calendar', /perpetual calendar|quanti[eè]me perp[eé]tuel/i],
  ['cx-moon', 'Moon phase', /moon ?phase|phases? de (?:la )?lune/i],
  ['cx-gmt', 'GMT', /\bgmt\b|dual[- ]time|world ?time|second time zone|heure universelle/i],
  ['cx-diver', 'Diver', /\bdiver'?s?\b|submariner|sea-dweller|plong[eé]e|fathoms|aquanaut/i],
  ['cx-tourbillon', 'Tourbillon', /tourbillon/i],
  ['cx-repeater', 'Minute repeater', /minute[- ]repeat|r[eé]p[eé]tition minutes/i],
];
const COMPLICATION: FacetDef[] = COMPLICATIONS.map(([key, label]) => ({ key, label, group: 'complication', any: 'complication' }));
/** Fine Art's 'Unique works' sub split by the stamped form (formKey). NOT a
 *  chip (chips audit, Oct 9): 21 of the sub's 75 live lots carry only
 *  'original-2d' and a truncated medium, so the split never sums to the sub.
 *  The keys stay — the lot card's 'Painting' / 'Work on paper' badge, and an
 *  old shared link's pick (shown so it can be un-picked). */
const ART_MEDIUM: FacetDef[] = [
  { key: 'painting', label: 'Paintings', group: 'medium', any: 'medium' },
  { key: 'on-paper', label: 'Works on paper', group: 'medium', any: 'medium' },
];

const ALL: FacetDef[] = [
  ...CARD_KIND, ...CARD_ERA, ...GRADER, ...GRADE, ...TCG_LANG, ...ENT_DOMAIN, ...FRANCHISE,
  FLOWN, ...QTY, ...COMPLICATION, ...ART_MEDIUM,
];
const DEF: Record<string, FacetDef> = Object.fromEntries(ALL.map(f => [f.key, f]));

/** every facet's display label by key — the chip text, and the vocabulary the
 *  lot-card badges speak (cardBadgesOf) */
export const FACET_LABEL: Record<string, string> = Object.fromEntries(ALL.map(f => [f.key, f.label]));
export const isEraFacet = (k: string) => DEF[k]?.any === 'era';

/** the facets a category offers (empty = none). With `fx`, the children of a
 *  picked parent are included (graders under 'Graded', grades under a grader, franchises under
 *  their domain); without, only the top level. */
export function facetsFor(cat: CatKey | null, fx: readonly string[] = [], implied: readonly string[] = []): FacetDef[] {
  // a picked key always shows (a shared link may carry a child without its
  // parent); an implied parent (facetChips: it held every lot) opens its
  // children but never steps a picked grader's siblings aside
  const on = implied.length ? [...fx, ...implied] : fx;
  const open = (defs: FacetDef[]) => defs.filter(d => fx.includes(d.key)
    || (opened(d, on) && !(d.solo && fx.some(k => rivals(k, d.key)))));
  // a picked parent's children sit right after it: Graded Raw | PSA … | Gem 10 … | Rookie …
  // (cards / TCG carry no 'Single items' chip — their 'Lots' sub already
  // separates multi-card lots, and Raw excludes them)
  if (cat === 'sports-cards') return open([GRADED, RAW, ...GRADER, ...GRADE, ...CARD_KIND.slice(2), ...CARD_ERA]);
  if (cat === 'tcg') return open([GRADED, RAW, ...GRADER, ...GRADE, ...TCG_LANG]);
  if (cat === 'entertainment') return open([...ENT_DOMAIN, ...FRANCHISE, SIGNED, SINGLE]);
  if (cat === 'space-science') return [FLOWN, SIGNED, SINGLE];
  if (cat === 'historical' || cat === 'sports-memorabilia') return [SIGNED, SINGLE];
  if (cat === 'watches') return COMPLICATION;
  if (cat === 'fine-art') return ART_MEDIUM.filter(d => fx.includes(d.key));
  return [];
}
/** every key some other facet opens under (Graded, the graders, the domains) */
const PARENTS = new Set(ALL.flatMap(d => d.parent ?? []));
/** is `a` above `key` in the parent chain (Graded above PSA above Gem 10)? */
const isAncestor = (a: string, key: string): boolean =>
  !!DEF[key]?.parent?.some(p => p === a || isAncestor(a, p));

const opened = (d: FacetDef | undefined, fx: readonly string[]) => !d?.parent || d.parent.some(p => fx.includes(p));
/** picking one replaces a rival (same exclusive set) */
const rivals = (a: string, b: string) => a !== b && DEF[a]?.xor != null && DEF[a].xor === DEF[b]?.xor;
/** two keys of one any-of set (they OR, so neither narrows the other's count) */
const anySibs = (a: string, b: string) => a !== b && DEF[a]?.any != null && DEF[a].any === DEF[b]?.any;

/* ── readers ─────────────────────────────────────────────────────────────── */

const RELIC_RE = /\b(relic|patch|swatch|jersey (?:card|relic)|game[- ](?:used|worn) (?:card|relic|patch)|memorabilia card|bat (?:card|relic)|logoman)\b/i;
/** a sealed box's "Possible … Rookie Cards" is the box's pitch, not the lot */
const SEALED_SUBS = new Set(['sealed-wax', 'sealed']);

/** signed / autographed / inscribed — not a facsimile, a printed or plate
 *  signature, a "Signature Series" product or an unsigned piece */
const SIGNED_RE = /\b(?:(?:hand|dual|multi|team|cast|crew|band|single|triple)[- ])?signed\b|\bautograph(?:s|ed)?\b|\bsignatures?\b|\binscribed\b|\bALS\b|\bTLS\b/i;
/** product names that only borrow the word — cut before the test */
const SIGNATURE_PRODUCT_RE = /\bsignature (?:series|edition|model|collection|bowcaster|guitar|line)\b|\bsigned in (?:the )?(?:plate|print|negative)\b/gi;
/** the signature is not by hand — the lot is not signed */
const NOT_SIGNED_RE = /\bun-?signed\b|\bfacsimile|pre-?printed (?:signature|autograph)|(?:stamped|printed) (?:signature|autograph)|\bautopen\b/i;

/** "(12)", "(25 Photos)", "Lot of 8", "Pair", "Trio", "Complete Set" — a lot of
 *  several objects; "(5 signatures)" on one object is not */
const COUNT_RE = /\((\d{1,3})\+?(?: (?:different|cards|items|pieces|photos|photographs|letters|tickets|programs|books|cels|stubs|tins|boxes|patches|pins|coins|covers|documents|records|albums|posters|figures))?\)/i;
const LOT_WORD_RE = /\blots? of (\d+)\b|\b(?:near[- ])?complete set\b|\bmaster set\b|\bteam set\b|\b(?:pair|trio)\b(?=\s*(?:\(|-|–|:|$))/i;
const NOT_LOT_RE = /\(\d+\+? (?:total )?signatures\)|\(\d+\)\s*-?\s*(?:signatures|autographs|games|seasons)\b|matched to \(\d|signed,? \(\d|\(\d+\) (?:multi-)?signed (?:cover|baseball|ball|football|basketball|photo|photograph|jersey|bat|helmet|program|book|poster|guitar|album)\b(?!s)|uncut sheet/i;

/** Space: flown in space (the stamped `flown` flag, else the title) */
const FLOWN_RE = /\b(?:space[- ])?flown\b|\battested (?:as )?flown\b|\blunar[- ]surface\b|\bcarried (?:aboard|on board|to the moon|into space)\b/i;
const NOT_FLOWN_RE = /\b(?:un|non)-?flown\b|\bflown (?:on|aboard) (?:the )?(?:air force one|concorde|hindenburg|zeppelin)\b/i;

const LANG_RE = /\b(Japanese|Chinese|Korean|German|French|Italian|Spanish|Portuguese|Dutch|Thai|Indonesian)\b/i;

export type FacetLot = {
  title?: string | null; artist?: string | null; subCat?: string | null; drill?: string | null;
  flown?: boolean | null; formKey?: string | null;
};

interface Read { keys: ReadonlySet<string>; t: Taxon; id: CardId | null; n: number | null }
const memo = new WeakMap<object, Read>();

function eraOf(year: string | null | undefined): string | null {
  const y = parseInt(String(year || ''), 10);
  if (!Number.isFinite(y) || y < 1850 || y > 2100) return null;
  return y < 1946 ? 'era-prewar' : y < 1980 ? 'era-vintage' : y < 2000 ? 'era-80s90s' : 'era-modern';
}
function gradeBucket(id: CardId): string | null {
  if (id.gradeNum != null) {
    const g = id.gradeNum;
    return g >= 10 ? 'g10' : g >= 9.5 ? 'g95' : g >= 9 ? 'g9' : g >= 7 ? 'g7' : 'g6';
  }
  return id.gradeTag === 'A' ? 'gauth' : null;
}
/** the number of objects in a multi-item lot: N, or 0 when it is a lot of an
 *  unstated count ("Pair" → 2, "Trio" → 3, "Complete Set" → 0); null = single */
export function multiCountOf(title: string): number | null {
  const t = title || '';
  if (NOT_LOT_RE.test(t)) return null;
  const c = t.match(COUNT_RE);
  if (c && +c[1] >= 2) return +c[1];
  const w = t.match(LOT_WORD_RE);
  if (!w) return null;
  if (w[1]) return +w[1] >= 2 ? +w[1] : null;
  return /\bpair\b/i.test(w[0]) ? 2 : /\btrio\b/i.test(w[0]) ? 3 : 0;
}
export const isSignedTitle = (title: string) =>
  !NOT_SIGNED_RE.test(title || '') && SIGNED_RE.test((title || '').replace(SIGNATURE_PRODUCT_RE, ' '));

function read(l: FacetLot): Read {
  const hit = memo.get(l as object);
  if (hit) return hit;
  const out = new Set<string>();
  const t = taxonOf(l);
  const title = String(l.title || '');
  let id: CardId | null = null;
  let n: number | null = null;
  if (t.cat === 'sports-cards' || t.cat === 'tcg') {
    id = parseCard(title);
    const sealed = SEALED_SUBS.has(t.sub);
    if (!sealed && !id.notCard) {
      if (id.gradeCo || id.gradeTag) {
        out.add('graded');
        const co = id.gradeCo || '';
        for (const [key, , re] of GRADER_KEYS) if (re.test(co)) out.add(key);
        const b = gradeBucket(id); if (b) out.add(b);
      } else if (!id.multi && t.sub !== 'lots') out.add('raw');
      if (t.cat === 'sports-cards') {
        if (id.rookie) out.add('rookie');
        if (id.auto) out.add('auto');
        if (id.serialOf) out.add('numbered');
        if (RELIC_RE.test(title)) out.add('relic');
      }
    }
    // the house's Lots sub, or the parser's multi-card read WITH a count —
    // its bare multi read ("Pikachu & Casey") is an identity abstention,
    // not a lot to badge
    const c = multiCountOf(title);
    if (t.sub === 'lots' || (id.multi && c != null)) { n = c ?? 0; out.add('multi'); }
    if (t.cat === 'sports-cards') { const e = eraOf(id.year); if (e) out.add(e); }
    if (t.cat === 'tcg' && t.sub !== 'memorabilia') {
      const lang = (title.match(LANG_RE) || [])[1]?.toLowerCase();
      out.add(!lang ? 'lang-en' : lang === 'japanese' ? 'lang-ja' : lang === 'chinese' ? 'lang-zh' : 'lang-other');
    }
  } else if (t.cat === 'watches') {
    const h = `${title} ${l.drill || ''}`;
    for (const [key, , re] of COMPLICATIONS) if (re.test(h)) out.add(key);
  } else if (t.cat === 'fine-art') {
    if (t.sub === 'unique' && l.formKey === 'painting') out.add('painting');
    if (t.sub === 'unique' && l.formKey === 'work-on-paper') out.add('on-paper');
  } else {
    if (t.domain) out.add(t.domain);
    if (t.cat === 'entertainment') {
      for (const [key, , dom, re] of FRANCHISES) if (re.test(title)) {
        out.add(key);
        // a franchise names its domain when the taxonomy could not
        if (!t.domain) out.add(dom);
        break;
      }
    }
    if (t.cat === 'space-science' && (l.flown === true || (FLOWN_RE.test(title) && !NOT_FLOWN_RE.test(title)))) out.add('flown');
    if (t.cat !== 'design' && isSignedTitle(title)) out.add('auto');
    if (t.cat !== 'design') {
      n = multiCountOf(title);
      out.add(n != null ? 'multi' : 'single');
    }
  }
  const r: Read = { keys: out, t, id, n };
  memo.set(l as object, r);
  return r;
}

/** every facet key one lot carries */
export function lotFacets(l: FacetLot): ReadonlySet<string> {
  return read(l).keys;
}

/** (r7) a graded card's exact numeric grade (the chips bucket 7–8.5 as one;
 *  the entity grade ladder needs PSA 8 apart) — null off a numbered slab */
export function lotGradeNum(l: FacetLot): number | null {
  const r = read(l);
  return r.keys.has('graded') ? r.id?.gradeNum ?? null : null;
}

/** AND across the selected facets — except keys of one any-of set, which OR
 *  (the lot needs one of them) */
export function passesFacets(l: FacetLot, fx: readonly string[]): boolean {
  if (!fx.length) return true;
  const s = lotFacets(l);
  let anyOf: Map<string, boolean> | null = null;
  for (const k of fx) {
    const a = DEF[k]?.any;
    if (!a) { if (!s.has(k)) return false; continue; }
    if (!anyOf) anyOf = new Map();
    anyOf.set(a, (anyOf.get(a) ?? false) || s.has(k));
  }
  if (anyOf) { let all = true; anyOf.forEach(ok => { if (!ok) all = false; }); return all; }
  return true;
}

/** toggle one facet: a rival in its exclusive set is replaced, and children
 *  whose parent is no longer picked are dropped (Raw clears PSA / Gem 10) */
export function toggleFacet(fx: readonly string[], key: string, via: readonly string[] = []): string[] {
  // picking a child whose parent was only implied (facetChips `via`) picks
  // the parent with it: PSA ⇒ Graded
  const add = [...via.filter(k => !fx.includes(k)), key];
  let next = fx.includes(key) ? fx.filter(k => k !== key)
    : [...fx.filter(k => !add.some(a => rivals(k, a))), ...add];
  // children of children (Gem 10 under PSA under Graded): drop until stable
  for (let n = -1; n !== next.length;) { n = next.length; next = next.filter(k => opened(DEF[k], next)); }
  return next;
}

/** the category a facet row belongs to: the picked one, else the pool's only one */
export function facetCatOf(cat: CatKey | null, lots: FacetLot[], opts: { cats?: readonly CatKey[] | null; fx?: readonly string[] } = {}): CatKey | null {
  const fx = opts.fx ?? [];
  if (cat) return facetsFor(cat, fx).length ? cat : null;
  // a market's stray lots (opts.cats: its own categories) don't make the pool
  // two-category — Science keeps Flown / Signed over 4 stray records
  let only: CatKey | null = null;
  for (const l of lots) {
    const c = taxonOf(l).cat;
    if (opts.cats && !opts.cats.includes(c)) continue;
    if (only && c !== only) return null;
    only = c;
  }
  return only && facetsFor(only, fx).length ? only : null;
}

export type FacetChip = FacetDef & {
  n: number;
  /** implied parents a tap on this chip picks with it (toggleFacet's `via`) */
  via?: string[];
};
/** groups whose chips run biggest first (era, grade and language keep their
 *  natural order: chronology, the grade ladder, English first) */
const BY_COUNT = new Set<FacetGroup>(['franchise', 'complication']);

/** chip counts over `pool` with the OTHER selected facets applied; a chip that
 *  matches nothing or keeps ≥95% of its pool is dropped (it cuts nothing) —
 *  and a dropped PARENT opens its children as if picked (see the header) */
export function facetChips(cat: CatKey, pool: FacetLot[], fx: readonly string[]): FacetChip[] {
  const implied: string[] = [];
  const count = () => facetsFor(cat, fx, implied).map(d => {
    const others = [...fx, ...implied].filter(k => k !== d.key && !rivals(k, d.key) && !anySibs(k, d.key));
    let n = 0, base = 0;
    for (const l of pool) {
      if (!passesFacets(l, others)) continue;
      base++;
      if (lotFacets(l).has(d.key)) n++;
    }
    return { ...d, n, base };
  });
  let chips = count();
  // Graded → a sole grader: at most two implied levels
  for (let pass = 0; pass < 2; pass++) {
    const add = chips.filter(c => PARENTS.has(c.key) && !fx.includes(c.key) && !implied.includes(c.key)
      && !fx.some(k => rivals(k, c.key)) && c.n > 0
      // a grader is implied only when it is EVERY slab (a BGS 9.5 is not a PSA 9.5)
      && (c.group === 'grader' ? c.n === c.base : c.n >= NEAR_TOTAL * c.base));
    if (!add.length) break;
    implied.push(...add.map(c => c.key));
    chips = count();
  }
  const kept: FacetChip[] = chips
    .filter(c => fx.includes(c.key) || (c.n > 0 && c.n < NEAR_TOTAL * c.base))
    .map(({ base: _b, ...c }) => {
      const via = implied.filter(k => isAncestor(k, c.key) && !fx.includes(k));
      return via.length ? { ...c, via } : c;
    });
  // biggest first inside the by-count groups, each group keeping its slot
  for (const g of Array.from(BY_COUNT)) {
    const at = kept.map((c, i) => (c.group === g ? i : -1)).filter(i => i >= 0);
    const sorted = at.map(i => kept[i]).sort((a, b) => b.n - a.n);
    at.forEach((i, j) => { kept[i] = sorted[j]; });
  }
  return kept;
}

/* ── lot-card badges ─────────────────────────────────────────────────────── */

/**
 * Up to two short labels for a lot card, most informative first — the facet
 * vocabulary, so a badge always matches a chip the reader can filter by:
 *   card   → ['PSA 10', 'Rookie'], ['BGS 9.5', 'Signed'], ['Japanese', 'CGC 10']
 *   space  → ['Signed', 'Flown'] … a multi-item lot leads with 'Lot of 12'
 *   ent    → ['Signed', 'Star Wars'];  watches → ['Chronograph', 'Moon phase']
 * Sealed product, design and a lot with nothing to say → [].
 */
export function cardBadgesOf(lot: FacetLot): string[] {
  const { keys: k, t, id, n } = read(lot);
  const out: string[] = [];
  const lotOf = n != null && k.has('multi') ? (n >= 2 ? `Lot of ${n}` : 'Multi-item lot') : null;
  if (lotOf) out.push(lotOf);
  if (id && k.has('graded') && id.gradeCo) {
    const g = id.gradeNum != null ? String(id.gradeNum) : id.gradeTag === 'A' ? 'Authentic' : '';
    out.push(g ? `${id.gradeCo} ${g}` : id.gradeCo);
  }
  if (t.cat === 'tcg' && (k.has('lang-ja') || k.has('lang-zh'))) out.push(FACET_LABEL[k.has('lang-ja') ? 'lang-ja' : 'lang-zh']);
  if (t.cat === 'space-science') {
    if (k.has('auto')) out.push(FACET_LABEL.auto);
    if (k.has('flown')) out.push(FACET_LABEL.flown);
  } else {
    for (const key of ['rookie', 'auto', 'numbered', 'relic']) if (k.has(key)) out.push(FACET_LABEL[key]);
  }
  for (const [key, label] of FRANCHISES) if (k.has(key)) out.push(label);
  for (const [key, label] of COMPLICATIONS) if (k.has(key)) out.push(label);
  if (k.has('painting')) out.push('Painting');
  if (k.has('on-paper')) out.push('Work on paper');
  return out.slice(0, 2);
}
