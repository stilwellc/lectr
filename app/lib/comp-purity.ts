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
export function designatorsOf(title: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const t = fold((title || '').toLowerCase())
    .replace(/\(\s*\d+\s*\)/g, ' ')                  // "(2)" counts
    .replace(/\d+(?:\.\d+)?\s*(?:x|×)\s*\d+(?:\.\d+)?/g, ' ') // sizes
    .replace(/#\s*\d+\s*\/\s*\d+/g, ' ')             // serials "#04/10"
    .replace(/\b\d+\s*\/\s*\d+\b/g, ' ');             // fractions / editions
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
    if (!out.has(w)) out.set(w, isNum ? String(+v) : v);
  }
  return out;
}
/** The same designator word followed by different numerals in both titles. */
export function designatorConflict(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = designatorsOf(a);
  if (!da.size) return false;
  const db = designatorsOf(b);
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

/** The HARD boundary fault of comp `c` for target `t`
 *  (EngineFlags.compBoundary), or null. Memorabilia only for the
 *  autograph / subject / object-class rules; the designator rule everywhere
 *  but watches (a reference is a watch's designator and already its own
 *  identity tier). */
export function compBoundaryFault(t: PurityLot, c: PurityLot): 'signed' | 'subject' | 'designator' | 'object' | null {
  if (!WATCH_SLUGS.has(t.artist) && !CARD_SLUGS.has(t.artist) && designatorConflict(t.title, c.title)) return 'designator';
  if (!isMemorabiliaLot(t)) return null;
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
