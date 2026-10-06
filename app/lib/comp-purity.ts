/**
 * comp-purity.ts — WHICH COMPS MAY CARRY A CALL (pricing wave 2, Oct 6 2026).
 *
 * A hand-judged sample of the comps the live engine selected (1,493 comps
 * across 200 live lots, Oct 5 book) read 43% good, 39% weak, 18% wrong. The
 * wrong ones fall into a handful of generic shapes, each a text fact about
 * the comp and the target — never a per-lot patch:
 *
 *   identity-less title  "Sonny and Cher", "J. Edgar Hoover", "[Apollo 11]",
 *                        Picasso "Nature morte" for "Nature morte au gruyère"
 *                        — the comp's title names a person, a series or a
 *                        genre, not an object (212 of the judged comps)
 *   medium / edition     a painting pricing a print, a drawing pricing an
 *                        etching (59 medium + the edition-class collisions)
 *   designator           "Apollo 13" priced by "Apollo 10", "Femme torero. II"
 *                        by "III", "Nicholas I" by "Nicholas II" — the same
 *                        word followed by a different number is a different
 *                        object or subject
 *   signed vs unsigned   unsigned vintage photographs priced by signed ones
 *   subject              "Pope Clement XI" priced by "Pope Pius XI" — a comp
 *                        whose own title never names the target's person
 *   object class         a Type 6 Olympic torch priced by participation medals
 *
 * Two layers use these readers (app/lib/value.ts):
 *   compBoundaryFault — HARD boundaries (EngineFlags.compBoundary): a comp
 *     that fails one never enters the pool (signed/unsigned, subject,
 *     designator, object class).
 *   compPurityFault   — the PURITY GATE (EngineFlags.purityGate): a flag
 *     needs ≥ 3 pure comps (object-naming title, same medium family and
 *     edition class; recency and the 5× geomedian band are pool facts the
 *     engine checks itself).
 * Every reader abstains (no fault) when a side carries no evidence.
 */
import type { AuctionLot } from '../types';
import { ARTISTS } from '../constants';
import { ART_SLUGS, WATCH_SLUGS, AUTOGRAPH_SLUGS, editionIdentityKey, editionClassOf } from './identity';
import { canonMedium } from './normalize';

export type PurityLot = Pick<AuctionLot, 'artist' | 'title'> & Partial<Pick<AuctionLot,
  'medium' | 'mediumCanon' | 'formKey' | 'description' | 'saleName' | 'category' | 'entity' | 'entityClass'>> & {
  playerSlug?: string | null;
};

const MARKET_OF = new Map<string, string>(ARTISTS.map(a => [a.slug, a.market]));
const LABEL_OF = new Map<string, string>(ARTISTS.map(a => [a.slug, a.label]));
const CARD_SLUGS = new Set(['sports-cards', 'graded-cards', 'pokemon']);

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Memorabilia scope: the autograph verticals + non-maker category-'object'
 *  lots (game-used, space, tickets, …). Cards price on their own key. */
export function isMemorabiliaLot(l: PurityLot): boolean {
  if (CARD_SLUGS.has(l.artist)) return false;
  if (AUTOGRAPH_SLUGS.has(l.artist)) return true;
  return l.category === 'object' && l.entityClass !== 'maker' && !WATCH_SLUGS.has(l.artist);
}

/* ── identity-less titles ─────────────────────────────────────────────── */
/** Words that name an OBJECT or a FORMAT in a memorabilia title — a title
 *  with one of them names a thing, not only a person. */
const OBJECT_WORD = /\b(?:signed|signature|signatures|autograph(?:ed|s)?|inscribed|letters?|documents?|notes?|manuscripts?|photo(?:graph)?s?|portraits?|prints?|checks?|cheques?|books?|booklets?|albums?|records?|programs?|programmes?|tickets?|covers?|cards?|postcards?|envelopes?|menus?|scripts?|posters?|flags?|patch(?:es)?|medals?|medallions?|pins?|badges?|coins?|tokens?|torch(?:es)?|trophy|trophies|rings?|watch(?:es)?|jerseys?|uniforms?|helmets?|bats?|balls?|gloves?|shoes?|caps?|hats?|sticks?|canes?|knife|knives|guitars?|drum(?:s|head)?|models?|plaques?|contracts?|agreements?|invitations?|telegrams?|diploma|certificates?|archive|collection|lot|set|pair|group|relic|swatch|hair|piece|fragment|slice|dress|gown|costume|jacket|shirt|sketch|drawing|painting|sculpture|bust|statue|figure|map|engraving|lithograph|etching|newspaper|magazine|report|manual|checklist|plan|flown|worn|used|issued|original|vintage)\b/i;
const NAME_TOK = /^(?:[A-ZÀ-Þ][A-Za-zÀ-ÿ.'’-]*|[A-Z]\.|and|&|de|van|von|der|den|del|della|di|da|du|la|le|of|the|jr\.?|sr\.?)$/;
function bareNameSeg(seg: string): boolean {
  const s = seg.replace(/\([^)]*\)/g, ' ').replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || /\d/.test(s)) return false;
  const toks = s.split(' ');
  if (toks.length > 6) return false;
  if (OBJECT_WORD.test(s)) return false;
  return toks.every(t => NAME_TOK.test(t)) && toks.some(t => /^[A-ZÀ-Þ][a-zà-ÿ]/.test(t));
}
/** "J. Edgar Hoover", "Sonny and Cher", "Pope Pius XI", "Supreme Court:
 *  Rehnquist, William", "Grateful Dead: Jerry Garcia" — a memorabilia title
 *  that is only a person / act name (whole, or after a topic colon). */
export function isBareNameTitle(title: string | null | undefined): boolean {
  const t = (title || '').trim();
  if (!t) return false;
  if (bareNameSeg(t)) return true;
  const i = t.indexOf(':');
  return i > 0 && bareNameSeg(t.slice(i + 1));
}
/** The title is ONLY the maker's name (+ dates / punctuation). */
function makerOnlyTitle(l: PurityLot): boolean {
  const label = LABEL_OF.get(l.artist);
  if (!label) return false;
  const lab = new Set(fold(label.toLowerCase()).split(/[^a-z0-9]+/).filter(Boolean));
  const rest = fold((l.title || '').toLowerCase())
    .replace(/\([^)]*\)/g, ' ').replace(/\b\d{4}\b/g, ' ')
    .split(/[^a-z0-9]+/).filter(w => w.length >= 2 && !lab.has(w) && w !== 'after' && w !== 'attributed');
  return rest.length === 0;
}
/** A title that does not name an object: empty, bracketed only ("[Apollo
 *  11]"), the maker's name only, an art title made only of genre words with
 *  no catalogue citation ("Nature morte", "Untitled", "Tête" — the
 *  edition-identity reader's own generic rule), or a memorabilia title that
 *  is only a person's name. */
export function isIdentityLessTitle(l: PurityLot): boolean {
  const t = (l.title || '').trim();
  if (!t || /^\[[^\]]*\]\.?$/.test(t)) return true;
  if (makerOnlyTitle(l)) return true;
  if (ART_SLUGS.has(l.artist)) return editionIdentityKey(l) === null;
  if (isMemorabiliaLot(l)) return isBareNameTitle(t);
  return false;
}

/* ── medium family + edition class ────────────────────────────────────── */
const MEDIUM_FAMILY: Record<string, string> = {
  'gelatin-silver-print': 'photo', 'c-print': 'photo', cibachrome: 'photo', polaroid: 'photo', inkjet: 'photo', photograph: 'photo',
  photogravure: 'intaglio', etching: 'intaglio', aquatint: 'intaglio', drypoint: 'intaglio', engraving: 'intaglio',
  linocut: 'relief', woodcut: 'relief', lithograph: 'litho', screenprint: 'screen', offset: 'offset', monotype: 'monotype',
  oil: 'paint', acrylic: 'paint', tempera: 'paint', enamel: 'paint', watercolor: 'water', gouache: 'water',
  pastel: 'drawing', charcoal: 'drawing', graphite: 'drawing', ink: 'drawing', 'mixed-media': 'mixed', collage: 'mixed',
  bronze: 'sculpture', marble: 'sculpture', ceramic: 'ceramic', glass: 'glass', wood: 'wood',
};
/** The medium FAMILY (the technique families a house describes one edition
 *  in interchangeably — "etching and aquatint" vs "etching" — stay one) from
 *  the stamped mediumCanon, else the medium field, else the head of the
 *  description (Christie's prints the medium there and the title in the
 *  medium field). null = no evidence. */
export function mediumFamilyOf(l: PurityLot): string | null {
  let c = l.mediumCanon || null;
  if (!c && l.medium && l.medium.trim() !== (l.title || '').trim()) c = canonMedium(l.medium).mediumCanon;
  if (!c && l.description) c = canonMedium(l.description.slice(0, 160)).mediumCanon;
  return c ? MEDIUM_FAMILY[c] || c : null;
}
const MAKER_MARKETS = new Set(['art', 'design']);
/** Different medium family or different edition class (unique vs multiple),
 *  art and design only (memorabilia "medium" is the autograph format, gated
 *  by the similarity format gate). */
export function mediumConflict(a: PurityLot, b: PurityLot): 'medium' | 'edition' | null {
  if (!MAKER_MARKETS.has(MARKET_OF.get(a.artist) || '')) return null;
  const fa = mediumFamilyOf(a), fb = mediumFamilyOf(b);
  if (fa && fb && fa !== fb) return 'medium';
  const ea = editionClassOf(a as never), eb = editionClassOf(b as never);
  if (ea && eb && ea !== eb) return 'edition';
  return null;
}

/** (EngineFlags.mediumKnownPool, wave 4) Whether comp `c` carries the
 *  target's own medium family as EVIDENCE (art / design targets with a
 *  medium only; null = the rule does not apply to this target). A comp with
 *  no medium evidence reads false — "Mao" with medium "Mao" may be the
 *  painting or the screenprint. */
export function mediumFamilyMatch(t: PurityLot, c: PurityLot): boolean | null {
  if (!MAKER_MARKETS.has(MARKET_OF.get(t.artist) || '')) return null;
  const ft = mediumFamilyOf(t);
  if (!ft) return null;
  return mediumFamilyOf(c) === ft;
}

/** The static PURITY fault of comp `c` for target `t` (EngineFlags.purityGate),
 *  or null when the comp may carry a call. Recency and the geomedian band
 *  are pool-level and checked by the engine. */
export function compPurityFault(t: PurityLot, c: PurityLot): 'identity-less' | 'medium' | 'edition' | null {
  if (isIdentityLessTitle(c)) return 'identity-less';
  return mediumConflict(t, c);
}

/* ── hard comp boundaries ─────────────────────────────────────────────── */
const ROMAN = /^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xvi{0,3}|xix|xxi{0,3}|xxiv|xxv|xxx)$/;
const DESIG_STOP = new Set(['of', 'the', 'and', 'size', 'lot', 'set', 'circa', 'c', 'ca', 'no', 'nos', 'number', 'vol', 'x', 'by', 'in', 'on', 'at', 'for', 'from', 'to', 'with', 'edition', 'ed', 'pp', 'ap', 'hc', 'est', 'cm', 'in', 'mm', 'inch', 'inches', 'top', 'pop', 'psa', 'bgs', 'sgc', 'cgc', 'jsa', 'grade', 'page', 'pages', 'p', 'pl']);
/** word → numeral designators in a title: "apollo 13", "femme torero ii",
 *  "nicholas i", "soup i", "plate 12", "no. 101" (keyed on the word before
 *  "no."). Years (4 digits), counts in parentheses, sizes and grades are
 *  never designators. */
const ROMAN_VAL: Record<string, number> = { i: 1, v: 5, x: 10 };
function romanToInt(r: string): number {
  let n = 0;
  for (let i = 0; i < r.length; i++) {
    const a = ROMAN_VAL[r[i]], b = ROMAN_VAL[r[i + 1]] || 0;
    n += a < b ? -a : a;
  }
  return n;
}
/** `ext` (EngineFlags.boundary2, wave 3): a lone "I" closing a designator
 *  ("Fillette, I, from …", "Pop Shop I portfolio") counts; "pl." is "plate";
 *  romans and digits compare as numbers ("II" = "2"). */
export function designatorsOf(title: string | null | undefined, ext = false): Map<string, string> {
  const out = new Map<string, string>();
  let t = fold((title || '').toLowerCase())
    .replace(/\(\s*\d+\s*\)/g, ' ')                  // "(2)" counts
    .replace(/\d+(?:\.\d+)?\s*(?:x|×)\s*\d+(?:\.\d+)?/g, ' ') // sizes
    .replace(/#\s*\d+\s*\/\s*\d+/g, ' ')             // serials "#04/10"
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ');             // fractions / editions
  if (ext) {
    t = t.replace(/\b([a-z]{3,})\s*,?\s+i(?=\s*(?:[,.;:)]|$)|\s+(?:from|pl|plate|portfolio|suite)\b)/g, '$1 1')
      .replace(/\bpl\.?\s*(?=\d)/g, 'plate ');
  }
  const toks = t.split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 1; i < toks.length; i++) {
    const v = toks[i];
    const isNum = /^\d{1,3}$/.test(v);
    const isRom = ROMAN.test(v);
    if (!isNum && !isRom) continue;
    let j = i - 1;
    if (toks[j] === 'no' || toks[j] === 'nos' || toks[j] === 'number' || toks[j] === 'vol') j--;
    if (j < 0) continue;
    const w = toks[j];
    if (w.length < 3 || /\d/.test(w) || DESIG_STOP.has(w)) continue;
    // a lone roman "i" / "v" / "x" after a word is a pronoun / letter often
    // enough ("Booklet - I Am Prepared") — only digits and ≥2-letter romans
    // count, and "i" only when the title ENDS there or a format word follows
    if (isRom && v.length === 1 && i + 1 < toks.length && !/^(?:handwritten|autograph|letter|document|signed|signature|ls|als|ds)$/.test(toks[i + 1])) continue;
    if (!out.has(w)) out.set(w, isNum ? String(+v) : ext ? String(romanToInt(v)) : v);
  }
  return out;
}
/** The same designator word followed by different numerals in both titles. */
export function designatorConflict(a: string | null | undefined, b: string | null | undefined, ext = false): boolean {
  const da = designatorsOf(a, ext);
  if (!da.size) return false;
  const db = designatorsOf(b, ext);
  let hit = false;
  da.forEach((v, w) => { const u = db.get(w); if (u != null && u !== v) hit = true; });
  return hit;
}

/** Autograph material: the title says signed / autograph / inscribed /
 *  handwritten / manuscript (or a classic format abbreviation). An unsigned
 *  photograph and a signed one are different markets; a handwritten letter
 *  and a signed one price together. */
const AUTOGRAPH_MATERIAL = /\b(?:signed|signature|signatures|autograph(?:ed)?|inscribed|inscription|handwritten|manuscript|holograph)\b/i;
const AUTOGRAPH_ABBR = /\b(?:ALS|TLS|ANS|ADS|AQS|AMQS|DS|LS|SP|ISP)\b/;
export function autographMaterialOf(title: string | null | undefined): boolean | null {
  const t = title || '';
  if (!t.trim()) return null;
  if (/\bunsigned\b/i.test(t)) return false;
  return AUTOGRAPH_MATERIAL.test(t) || AUTOGRAPH_ABBR.test(t);
}

const nameToks = (s: string) => fold(s.toLowerCase()).replace(/\b(?:jr|sr)\.?/g, ' ').split(/[^a-z0-9]+/).filter(w => w.length >= 1);
/** SUBJECT: the target names one person (its stamped entity / playerSlug);
 *  the comp names a different one (its own entity), or names none and its
 *  title does not carry every word of the target's person ("Pope Pius XI"
 *  for "Pope Clement XI", "Nicholas II" for "Nicholas I", a "Pink Floyd"
 *  album for "William Floyd"). Prefix-compatible names ("Michael Jordan" /
 *  "Michael Jordan Chicago") are the same person. */
export function subjectConflict(t: PurityLot, c: PurityLot): boolean {
  const pa = t.playerSlug ? t.playerSlug.replace(/-/g, ' ') : t.entity ? nameToks(t.entity).join(' ') : null;
  if (!pa) return false;
  const pt = pa.split(' ').filter(Boolean);
  if (pt.length < 2) return false;
  const pb = c.playerSlug ? c.playerSlug.replace(/-/g, ' ') : c.entity ? nameToks(c.entity).join(' ') : null;
  if (pb) {
    if (pb === pa || pb.startsWith(pa + ' ') || pa.startsWith(pb + ' ')) return false;
    // the comp's entity may be a group the target's person belongs to — fall
    // through to the title check
  }
  const ct = new Set(nameToks(c.title || ''));
  return !pt.every(w => ct.has(w));
}

/** Object classes in a memorabilia title — a title naming objects of one
 *  class never comps one naming only another ("torch" vs "medal"). */
const OBJECT_CLASSES: [string, RegExp][] = [
  ['torch', /\btorch(?:es)?\b/],
  ['medal', /\b(?:medals?|medallions?|pins?|badges?|coins?|tokens?)\b/],
  ['photo', /\b(?:photo(?:graph)?s?|portraits?|polaroids?|negatives?|transparenc(?:y|ies))\b/],
  ['paper', /\b(?:letters?|documents?|notes?|manuscripts?|checks?|cheques?|contracts?|agreements?|invitations?|telegrams?|diplomas?|certificates?|signatures?|cuts?|cards?|postcards?|envelopes?|covers?|menus?)\b/],
  ['print', /\b(?:books?|booklets?|programs?|programmes?|magazines?|newspapers?|scripts?|posters?|reports?|manuals?)\b/],
  ['record', /\b(?:albums?|records?|lps?|discs?|cds?)\b/],
  ['flag', /\b(?:flags?|banners?|pennants?)\b/],
  ['textile', /\b(?:patch(?:es)?|jerseys?|uniforms?|shirts?|jackets?|dress(?:es)?|gowns?|costumes?|caps?|hats?|shoes?|cleats?|gloves?|swatch(?:es)?|robes?|trunks?)\b/],
  ['equipment', /\b(?:bats?|balls?|helmets?|sticks?|guitars?|drums?|drumheads?|clubs?|rackets?|pucks?)\b/],
  ['ticket', /\b(?:tickets?|stubs?|passes?)\b/],
  ['trophy', /\b(?:trophy|trophies|rings?|plaques?|awards?|cups?)\b/],
  ['model', /\b(?:models?|replicas?|maquettes?)\b/],
];
export function objectClassesOf(title: string | null | undefined): Set<string> {
  const t = (title || '').toLowerCase();
  const out = new Set<string>();
  for (const [k, re] of OBJECT_CLASSES) if (re.test(t)) out.add(k);
  return out;
}

/* ── wave 3 boundaries (EngineFlags.boundary2 / watchVariant) ─────────── */

/** The catalogue-raisonné citation of an art lot ('b200', 'fs179',
 *  'fs179-182' — a leading volume roman dropped: F&S "II.179" is "179"),
 *  from the edition-identity reader. null = none cited. */
export function catalogueNumberOf(l: PurityLot): { sys: string; no: string } | null {
  if (!ART_SLUGS.has(l.artist)) return null;
  const k = editionIdentityKey(l as never);
  const m = k ? k.match(/\|cr:([a-z]+?)((?:[ivx]+\.)?\d[^|]*)/) : null;
  if (!m) return null;
  return { sys: m[1], no: m[2].replace(/^[ivx]+\./, '') };
}
const normSeries = (s: string) => fold(s.toLowerCase())
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/^(?:the|la|le|les) /, '')
  .replace(/ (?:portfolio|suite|series|set)$/, '')
  .trim();
/** The series a single plate is FROM: "Landscape 2, from Ten Landscapes",
 *  "Untitled (from the Pop Shop I portfolio)", "Three Lithographs: one
 *  plate". null = the title names no parent series. */
export function seriesOf(title: string | null | undefined): string | null {
  const t = fold((title || '').toLowerCase());
  const m = t.match(/\bfrom:?\s+(?:the\s+)?(?:portfolio\s+|suite\s+|series\s+)?['"‘“]?([^,;()'"’”]+?)['"’”]?\s*(?:portfolio|suite|series)?\s*(?:[,;()]|$)/);
  if (m) return normSeries(m[1]) || null;
  const o = t.match(/^(.*?)\s*:\s*one (?:plate|print|sheet)\b/);
  return o ? normSeries(o[1].replace(/^.*\(\d{4}\s*[-–]\s*\d{4}\)\s*/, '')) || null : null;
}
/** The work's own title core (maker name and catalogue citation stripped,
 *  the edition-identity reader's body) — for comparing a set's name. */
function titleCoreOf(l: PurityLot): string | null {
  if (!ART_SLUGS.has(l.artist) && MARKET_OF.get(l.artist) !== 'design') return null;
  const k = editionIdentityKey(l as never);
  if (!k) return null;
  const core = k.split('|')[1];
  return core && !core.startsWith('cr:') ? normSeries(core) : null;
}
const SET_WORDS = /\b(?:complete (?:set|portfolio|suite)|the complete\b|(?:portfolio|set|suite) of (?:\d+|two|three|four|five|six|seven|eight|nine|ten|twelve)|(?:\d+|two|three|four|five|six|seven|eight|nine|ten|twelve) (?:prints|plates|screenprints|lithographs|etchings|sheets|works) (?:in|with|from)\b)/;
const SINGLE_WORDS = /\bfrom\b|\bone (?:plate|print|sheet)\b|\bsingle (?:plate|print|sheet)\b|\bplate \d+|\bpl\.?\s*\d+/;
/** 'set' / 'single' / null — what a title says about its own unit. A
 *  catalogue RANGE (F&S II.179-182) is the set. */
export function unitOf(l: PurityLot): 'set' | 'single' | null {
  const t = fold((l.title || '').toLowerCase());
  const cr = catalogueNumberOf(l);
  if (SET_WORDS.test(t) || (cr && /\d\s*-\s*\d/.test(cr.no))) return 'set';
  if (SINGLE_WORDS.test(t) || (cr && /^\d+[a-z]?$/.test(cr.no))) return 'single';
  return null;
}
/** A single plate against the whole portfolio / set: one title is the
 *  other's parent series, or one says set and the other single. */
export function unitConflict(t: PurityLot, c: PurityLot): boolean {
  if (!MAKER_MARKETS.has(MARKET_OF.get(t.artist) || '')) return false;
  const st = seriesOf(t.title), sc = seriesOf(c.title);
  const ct = titleCoreOf(t), cc = titleCoreOf(c);
  if (sc && ct && sc === ct && !st) return true;   // target IS the comp's series
  if (st && cc && st === cc && !sc) return true;   // comp IS the target's series
  const ut = unitOf(t), uc = unitOf(c);
  return !!ut && !!uc && ut !== uc;
}
/** Different catalogue-raisonné numbers in the same system: different works. */
export function catalogueConflict(t: PurityLot, c: PurityLot): boolean {
  const a = catalogueNumberOf(t), b = catalogueNumberOf(c);
  return !!a && !!b && a.sys === b.sys && a.no !== b.no;
}
/** How many items a memorabilia title sells: "(19) Documents", "pair of",
 *  "group of" → many; a plural format noun → many; else 1. */
const COUNT_PAREN = /\((\d{1,3})\)/;
const MANY_WORDS = /\b(?:pair|two|three|four|five|six|group|lot|collection|archive|set) of\b/;
const PLURAL_FORMAT = /\b(?:signatures|documents|letters|photographs|photos|checks|cheques|cards)\b/;
const SINGULAR_FORMAT = /\b(?:signature|document|letter|photograph|photo|check|cheque|card)\b/;
const MULTI_SIGNED = /\b(?:crew|team|cast|band)[- ]signed\b|\bsigned by (?:the )?(?:\w+ )?(?:crew|team|cast|band)\b/;
export function itemCountOf(title: string | null | undefined): 'many' | 'one' | null {
  const t = (title || '').toLowerCase();
  if (!t.trim()) return null;
  const p = t.match(COUNT_PAREN);
  if ((p && +p[1] >= 2) || MANY_WORDS.test(t) || MULTI_SIGNED.test(t)) return 'many';
  if (PLURAL_FORMAT.test(t)) return 'many';
  if (SINGULAR_FORMAT.test(t)) return 'one';
  return null;
}
/** Watch dial / nickname variants — each its own market at the same reference. */
const WATCH_VARIANTS: [string, RegExp][] = [
  ['stella', /\bstella\b/], ['agate', /\bagate\b/], ['aquatic', /\baquatic\b/], ['dual-time', /\bdual[- ]time\b/],
  ['tiffany', /\btiffany\b/], ['paul-newman', /\bpaul newman\b/], ['tropical', /\btropical\b/], ['meteorite', /\bmeteorite\b/],
  ['mop', /\bmother[- ]of[- ]pearl\b|\bmop\b/], ['onyx', /\bonyx\b/], ['lapis', /\blapis\b/], ['malachite', /\bmalachite\b/],
  ['turquoise', /\bturquoise\b/], ['coral', /\bcoral\b/], ['opal', /\bopal\b/], ['jade', /\bjade\b/], ['tigers-eye', /\btiger'?s?[- ]eye\b/],
  ['aventurine', /\baventurine\b/], ['sodalite', /\bsodalite\b/], ['pave', /\bpav[eé]\b/], ['sigma', /\bsigma\b/],
];
export function watchVariantsOf(title: string | null | undefined): Set<string> {
  const t = fold((title || '').toLowerCase());
  const out = new Set<string>();
  for (const [k, re] of WATCH_VARIANTS) if (re.test(t)) out.add(k);
  return out;
}
/** Different dial / nickname variants on two watch titles (either side). */
export function watchVariantConflict(a: string | null | undefined, b: string | null | undefined): boolean {
  const va = watchVariantsOf(a), vb = watchVariantsOf(b);
  if (!va.size && !vb.size) return false;
  if (va.size !== vb.size) return true;
  let diff = false;
  va.forEach(k => { if (!vb.has(k)) diff = true; });
  return diff;
}
/** (EngineFlags.idLessAbstain) An art target that names no object: no
 *  catalogue citation, a title core of ≤ 4 words, and no medium family /
 *  edition class evidence — the title alone cannot tell a drawing from the
 *  $8M painting of the same name. */
export function isIdentityLessArtTarget(l: PurityLot): boolean {
  if (!ART_SLUGS.has(l.artist)) return false;
  if (catalogueNumberOf(l)) return false;
  if (mediumFamilyOf(l) || editionClassOf(l as never)) return false;
  const core = titleCoreOf(l);
  return !core || core.split(' ').length <= 4;
}

export type BoundaryFault = 'signed' | 'subject' | 'designator' | 'object' | 'unit' | 'quantity' | 'variant';
/** The HARD boundary fault of comp `c` for target `t`
 *  (EngineFlags.compBoundary), or null. Memorabilia only for the
 *  autograph / subject / object-class rules; the designator rule everywhere
 *  but watches (a reference is a watch's designator and already its own
 *  identity tier). `opts.ext` (EngineFlags.boundary2) adds the wave-3 rules:
 *  lone-"I" / plate designators and catalogue numbers (art), single plate vs
 *  set (art / design), item counts (memorabilia); `opts.watchVariant` the
 *  dial / nickname variants (watches). */
export function compBoundaryFault(
  t: PurityLot, c: PurityLot,
  opts: { ext?: boolean; watchVariant?: boolean; rules?: { designator?: number; catalogue?: number; unit?: number; quantity?: number } } = {},
): BoundaryFault | null {
  const ext = !!opts.ext;
  const on = (k: 'designator' | 'catalogue' | 'unit' | 'quantity') => ext && (opts.rules?.[k] ?? 1) !== 0;
  if (opts.watchVariant && WATCH_SLUGS.has(t.artist) && watchVariantConflict(t.title, c.title)) return 'variant';
  if (!WATCH_SLUGS.has(t.artist) && !CARD_SLUGS.has(t.artist) && designatorConflict(t.title, c.title, on('designator'))) return 'designator';
  if (on('catalogue') && catalogueConflict(t, c)) return 'designator';
  if (on('unit') && unitConflict(t, c)) return 'unit';
  if (!isMemorabiliaLot(t)) return null;
  if (on('quantity')) {
    const qa = itemCountOf(t.title), qb = itemCountOf(c.title);
    if (qa && qb && qa !== qb) return 'quantity';
  }
  const sa = autographMaterialOf(t.title), sb = autographMaterialOf(c.title);
  if (sa != null && sb != null && sa !== sb) return 'signed';
  if (subjectConflict(t, c)) return 'subject';
  const oa = objectClassesOf(t.title), ob = objectClassesOf(c.title);
  if (oa.size && ob.size) {
    let shared = false;
    oa.forEach(k => { if (ob.has(k)) shared = true; });
    if (!shared) return 'object';
  }
  return null;
}

/* ── wave 4 (Oct 6 2026): THE SAME WORK, strictly ─────────────────────── */
/** House families that sell one inventory under several names (the Wright
 *  family mirrors its lots across Wright / Rago / LAMA / Toomey). */
const HOUSE_FAMILY: Record<string, string> = { Wright: 'wright', Rago: 'wright', LAMA: 'wright', 'Toomey & Co.': 'wright', Toomey: 'wright' };
const houseFamilyOf = (h: string | null | undefined) => (h ? HOUSE_FAMILY[h] || h : null);
/** The title as one comparable string: maker's name, 4-digit years and
 *  punctuation dropped ("Puppy (vase)" = "Puppy Vase"). */
function workTitleKey(l: PurityLot): string {
  const label = LABEL_OF.get(l.artist);
  const lab = new Set(label ? fold(label.toLowerCase()).split(/[^a-z0-9]+/).filter(Boolean) : []);
  return fold((l.title || '').toLowerCase()).replace(/\b\d{4}\b/g, ' ')
    .split(/[^a-z0-9]+/).filter(w => w && !lab.has(w)).join(' ');
}
type WorkLot = PurityLot & { auctionHouse?: string | null; heightCm?: number | null; widthCm?: number | null };
/** Height × width (cm) from the stamped fields, else null. */
function hwOf(l: WorkLot): [number, number] | null {
  return (l.heightCm || 0) > 0 && (l.widthCm || 0) > 0 ? [l.heightCm!, l.widthCm!] : null;
}
/** (EngineFlags.sameWork) Comp `c` is the SAME WORK as target `t` by the
 *  strict test: the same title (maker / years / punctuation aside), the same
 *  house family, and height and width both inside ±`dimTol` — dimensions on
 *  both sides are required (no evidence = not the same work). Recency is the
 *  caller's. */
export function sameWorkComp(t: WorkLot, c: WorkLot, dimTol = 0.1): boolean {
  const ht = houseFamilyOf(t.auctionHouse), hc = houseFamilyOf(c.auctionHouse);
  if (!ht || ht !== hc) return false;
  const kt = workTitleKey(t);
  if (!kt || kt !== workTitleKey(c)) return false;
  const a = hwOf(t), b = hwOf(c);
  if (!a || !b) return false;
  const near = (x: number, y: number) => Math.abs(x - y) <= dimTol * Math.max(x, y);
  return near(a[0], b[0]) && near(a[1], b[1]);
}
