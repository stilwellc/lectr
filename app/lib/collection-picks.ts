/**
 * collection-picks.ts — "For your collection" (N3, Oct 11 2026).
 *
 * The For-you room reads TASTE (what is like what you hold); this reads the
 * COLLECTION itself — what a live lot would DO to the things you own:
 *
 *   upgrade   the same card identity live in a higher grade
 *             (cards.cardLadderKey; a Pokémon / TCG card by year · set ·
 *             number · variant — recs.cardIdentityKey), and for watches the
 *             same numeric reference
 *   set       a card / TCG set you hold two or more singles of: a live card
 *             from the same year + set (+ sport) whose number you don't hold —
 *             "N of M" only for a set whose size is on the vetted list below,
 *             otherwise just "same set"
 *   series    a print from the same portfolio / series as one you hold
 *             (Warhol's F&S numbers through the vetted portfolio ranges below,
 *             else "from <series>" / "de la série <series>" in the title)
 *   maker     more by a maker / player / subject you hold (a named entity —
 *             never a cs: collection bucket)
 *
 * Owned lots ("I won it") are the evidence; saved lots count as weaker
 * evidence (they rank after owned, and every reason says "saved"). Every
 * pick carries the reason in words. A figure printed in a reason is read
 * off lotFace (one lot, one number) or the entity's matched grade ladder
 * (n-labelled) — never computed here.
 *
 * HONESTY: an identity that does not parse is no identity (no pick); a
 * multi-card lot is never one card; a raw card is not "upgraded" by a slab
 * (raw is not a grade); a qualified grade (PSA 9 OC) or an Authentic slab is
 * never the upgrade; a set size is printed only when it is known.
 *
 * Pure: no React, no storage. app/profile/collection.tsx renders it.
 */
import type { AuctionLot } from '../types';
import { parseCard, cardYearKey, cardSetKey, type CardId } from './cards';
import { cardIdentityKey, idAliases } from './recs';
import { taxonOf, type CatKey } from './taxonomy';
import { entityKeyOf } from './entity/key';
import { readWatchReference } from './watch-ref';
import { editionIdentityKey } from './identity';
import { lotFace } from './lot-face';
import { cardRecordOf, spanText } from './card-record';
import { priorityOf } from './priority';
import { makerLineOf } from './lot-labels';
import { craftTitle } from '../utils';
import { ARTIST_LABEL } from '../constants';

/* ── inputs / outputs ───────────────────────────────────────────────────── */

/** one lot the reader holds — the resolved row when the corpus carries it,
 *  else the snapshot the save took (title + maker slug) */
export interface HeldInput {
  id: string;
  owned: boolean;
  lot?: AuctionLot | null;
  title?: string | null;
  artist?: string | null;
}

export type PickKind = 'upgrade' | 'set' | 'series' | 'maker';

export interface CollectionPick {
  lot: AuctionLot;
  kind: PickKind;
  /** the honest reason line ("Upgrade: you own PSA 4 · this is PSA 6 · …") */
  reason: string;
  /** the held lot(s) behind it */
  fromIds: string[];
  /** the evidence is something the reader OWNS (else: saved only) */
  owned: boolean;
  /** the identity the tie was read on (card ladder key, set key, series key, entity id) */
  tie: string;
  /** a card upgrade's entity (for the matched grade ladder) */
  ek?: string | null;
}

export interface CollectionResult {
  picks: CollectionPick[];
  /** how many held lots carried a usable identity, by kind of identity */
  read: { cards: number; watches: number; prints: number; makers: number; held: number; owned: number; saved: number };
  /** the entity ids whose matched grade ladder would add a premium to an upgrade */
  ladderIds: string[];
}

/** (r8) an entity's matched grade ladder (EntityDetail.facets, key 'grade', basis 'matched') */
export interface MatchedLadder {
  basis?: 'matched';
  cards?: number;
  rows: { key: string; label: string; n12: number; med12m: number | null }[];
}

export interface CollectionOpts {
  /** entity id → its matched grade ladder (loaded by the caller) */
  ladders?: ReadonlyMap<string, MatchedLadder | null>;
  /** max picks (default 30) */
  n?: number;
  nowMs?: number;
}

/* ── vetted reference tables ────────────────────────────────────────────── */

/** SET SIZES the "N of M" line may print — only sets whose checklist count is
 *  settled hobby fact. Key: `<sport|tcg>|<year>|<set key>` (see setKeyOf). A
 *  set not here prints "same set", never a guessed size. */
export const SET_SIZE: Readonly<Record<string, number>> = {
  'baseball|1933|goudey': 240,
  'baseball|1951|bowman': 324,
  'baseball|1952|bowman': 252,
  'baseball|1952|topps': 407,
  'baseball|1953|topps': 274,
  'baseball|1954|topps': 250,
  'baseball|1955|topps': 206,
  'baseball|1956|topps': 340,
  'baseball|1957|topps': 407,
  'baseball|1958|topps': 494,
  'baseball|1959|topps': 572,
  'baseball|1960|topps': 572,
  'baseball|1962|topps': 598,
  'tcg|1999|pokemon base set': 102,
  'tcg|1999|pokemon base set 1st edition': 102,
  'tcg|1999|pokemon base set shadowless': 102,
  'tcg|1999|pokemon base set 1st edition shadowless': 102,
  'tcg|1999|pokemon base set unlimited': 102,
  'tcg|1999|pokemon jungle': 64,
  'tcg|1999|pokemon jungle 1st edition': 64,
  'tcg|1999|pokemon fossil': 62,
  'tcg|1999|pokemon fossil 1st edition': 62,
};

/** Warhol portfolios by Feldman & Schellmann section-II range — only the
 *  portfolios whose ranges are settled, each checked against the corpus
 *  (every titled "from <portfolio> (F. & S. n)" row falls inside its range;
 *  Cowboys and Indians is II.377–386, not the often-quoted 376–385). A
 *  number outside these is no series. */
export const WARHOL_FS: readonly { lo: number; hi: number; label: string }[] = [
  { lo: 22, hi: 31, label: 'Marilyn Monroe (Marilyn)' },
  { lo: 44, hi: 53, label: "Campbell's Soup I" },
  { lo: 54, hi: 63, label: "Campbell's Soup II" },
  { lo: 64, hi: 73, label: 'Flowers' },
  { lo: 74, hi: 83, label: 'Electric Chair' },
  { lo: 90, hi: 99, label: 'Mao' },
  { lo: 138, hi: 147, label: 'Mick Jagger' },
  { lo: 179, hi: 182, label: 'Muhammad Ali' },
  { lo: 226, hi: 235, label: 'Ten Portraits of Jews of the Twentieth Century' },
  { lo: 258, hi: 267, label: 'Myths' },
  { lo: 293, hi: 302, label: 'Endangered Species' },
  { lo: 110, hi: 119, label: 'Flowers (Hand-Colored)' },
  { lo: 307, hi: 309, label: 'Kiku' },
  { lo: 313, hi: 315, label: 'Ingrid Bergman' },
  { lo: 334, hi: 349, label: 'Reigning Queens' },
  { lo: 350, hi: 359, label: 'Ads' },
  { lo: 377, hi: 386, label: 'Cowboys and Indians' },
  { lo: 387, hi: 389, label: 'Martha Graham' },
  { lo: 406, hi: 413, label: 'Camouflage' },
];

/* ── identity readers ───────────────────────────────────────────────────── */

const CARD_CATS: ReadonlySet<CatKey> = new Set<CatKey>(['sports-cards', 'tcg']);
const SPORT_WORD = /\b(baseball|basketball|football|hockey|soccer)\b/i;

/** rarity words a TCG set name carries per card (the card's rarity, not the
 *  set): "Base Set Holo", "EX Dragon Frontiers Gold Star Holo" */
const TCG_RARITY = /\b(?:non[- ]?holo|holo(?:foil)?|foil|rare|ultra|secret|hyper|double|special|illustration|art|full|gold star|shining|prime|legend)\b/g;

/** the TCG set key: year + set words without the per-card rarity
 *  ("Reverse Holo" and "Reverse Foil" are one parallel: both → "reverse") */
export function tcgSetName(setName: string): string {
  return setName.toLowerCase().replace(/pok[eé]mon/g, 'pokemon').replace(/[’']/g, '')
    .replace(TCG_RARITY, ' ').replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** the set's DISPLAY name as the held title wrote it, minus rarity words */
function setDisplay(id: CardId, cat: CatKey, season: string | null = null): string {
  const y = season ? `${season} ` : id.year ? `${id.year} ` : '';
  const s = String(id.setName || '').trim().replace(/^(?:basketball|hockey)\s+/i, '');
  const clean = cat === 'tcg' ? s.replace(/\bpokemon\b/gi, 'Pokémon').replace(/\s*\b(?:Reverse\s+)?(?:Holo|Foil)\b\s*/gi, m => (/reverse/i.test(m) ? ' Reverse ' : ' ')).replace(/\s+/g, ' ').trim() : s;
  return `${y}${clean}`.trim();
}

/** back-colour variants are the same card number in the same set (1956
 *  Topps gray / white backs) — never a different set */
const SET_NEUTRAL_VARIANT = /^(?:grayback|whiteback|greyback|color)$/;
function baseVariant(v: string | null | undefined): boolean {
  if (!v) return true;
  return v.split('+').every(t => SET_NEUTRAL_VARIANT.test(t) || t === 'holo');
}

interface HeldCard {
  id: CardId;
  /** same card, any grade */
  key: string | null;
  /** the set (sport|year|set) — null when not a single of a keyable set */
  set: string | null;
  setLabel: string;
  no: string | null;
  cat: CatKey;
  gradeLabel: string;
}

function gradeLabelOf(id: CardId): string {
  if (id.gradeCo && id.gradeNum != null) return `${id.gradeCo} ${id.gradeNum}${id.gradeQual ? ` (${id.gradeQual})` : ''}`;
  if (id.gradeCo && id.gradeTag === 'A') return `${id.gradeCo} Authentic`;
  return 'raw';
}

function cardSportOf(l: { title?: string | null; drill?: string | null; sport?: string | null } | null, title: string, cat: CatKey, bySlug: ReadonlyMap<string, string>, slug: string | null): string | null {
  if (cat === 'tcg') return 'tcg';
  const s = (l && (l.sport || (l.drill && SPORT_WORD.test(l.drill) ? l.drill : null))) || (title.match(SPORT_WORD)?.[1] ?? null);
  if (s) return s.toLowerCase();
  return slug ? bySlug.get(slug) ?? null : null;
}

function readCard(title: string, cat: CatKey, l: AuctionLot | null, bySlug: ReadonlyMap<string, string>): HeldCard | null {
  if (!CARD_CATS.has(cat) || !title) return null;
  const id = parseCard(title);
  if (id.multi || id.notCard) return null;
  const key = cardIdentityKey(id, cat);
  let set: string | null = null;
  let season: string | null = null;
  let y = cardYearKey(id.year);
  if (y && id.cardNo && id.setName && !id.serialOf && (cat === 'tcg' || baseVariant(id.variant))) {
    const sport = cardSportOf(l as never, title, cat, bySlug, id.playerSlug);
    // a SEASON sport's bare four-digit year is the season's START ("1970 Topps
    // #123 Pete Maravich" is 1970-71) while Goldin's "70 Topps" and a written
    // range key on the END (1969-70) — read both as the season's end, so a
    // 1969-70 card is never "the same set" as a 1970-71 one
    if ((sport === 'basketball' || sport === 'hockey') && id.year && /^\d{4}$/.test(id.year) && new RegExp(`(?:^|\\D)${id.year}(?!-)\\b`).test(title)) y = String(parseInt(id.year, 10) + 1);
    if ((sport === 'basketball' || sport === 'hockey') && y && /^\d{4}$/.test(y)) season = `${parseInt(y, 10) - 1}-${y.slice(2)}`;
    const sk = cat === 'tcg' ? tcgSetName(id.setName) : cardSetKey(id.setName);
    if (sport && sk) set = `${sport}|${y}|${sk}`;
  }
  if (!key && !set) return null;
  return { id, key, set, setLabel: setDisplay(id, cat, season), no: id.cardNo ? id.cardNo.toLowerCase() : null, cat, gradeLabel: gradeLabelOf(id) };
}

/** a watch's numeric reference key (`maker|ref`), else null — a model NAME
 *  ("submariner") is a line, not a reference */
export function watchRefKey(l: { artist?: string | null; title?: string | null; reference?: string | null }): { key: string; ref: string } | null {
  const maker = String(l.artist || '');
  const raw = (l.reference && /\d/.test(l.reference) ? String(l.reference) : null) ?? readWatchReference(l.title, maker);
  if (!raw || !/\d/.test(raw)) return null;
  const ref = raw.toLowerCase().replace(/\s+/g, '');
  return { key: `${maker}|${ref}`, ref: raw.toUpperCase().replace(/\s+/g, '') };
}

const ROMAN_OR_NO = /^(?:[ivx]{1,4}|\d{1,2})$/;
/** a series name → its comparable key: lower, no apostrophes, no "the" /
 *  "portfolio" / "series" / "suite", plural s dropped per word */
export function seriesNorm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(w => w && !['the', 'portfolio', 'series', 'suite', 'serie', 'la', 'le', 'de', 'from'].includes(w))
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ').trim();
}

/** the F&S section-II number a title cites as ITS OWN catalogue entry
 *  ("(F. & S. II.46)", "(F&S 359)") — never a "see F. & S." cross-reference */
export function fsNumberOf(title: string): number | null {
  const m = title.match(/(see\s+|cf\.?\s+)?\b(?:F\.?\s*(?:&|and)\s*S\.?|Feldman\s*(?:&|and)\s*Schellmann)\s*(II\.?\s*)?(\d{1,3})[A-Z]?\b/i);
  if (!m || m[1]) return null;
  return parseInt(m[3], 10);
}

interface HeldSeries { key: string; label: string; size: number | null; member: string }

/** the portfolio / series a print belongs to — F&S range (Warhol), else the
 *  title's "from <series>" / "de la série <series>" */
export function seriesOf(l: { artist?: string | null; title?: string | null }): HeldSeries | null {
  const artist = String(l.artist || '');
  const title = String(l.title || '');
  if (!artist || !title) return null;
  const member = memberOf(title, artist);
  const fs = artist === 'andy-warhol' ? fsNumberOf(title) : null;
  if (fs != null) {
    // a cited F&S number decides: inside a vetted portfolio, that one;
    // outside every range, no series (the title's "from …" never overrides it)
    const hit = WARHOL_FS.find(p => fs >= p.lo && fs <= p.hi);
    return hit ? { key: `${artist}|${seriesNorm(hit.label)}`, label: hit.label, size: hit.hi - hit.lo + 1, member } : null;
  }
  const m = title.match(/\b(?:from\s+(?:the\s+)?(?:portfolio\s+|series\s+|suite\s+)?|de la (?:s[ée]rie|suite)\s+)([^,()[\]]{3,60})(\s*\((?!\s*(?:see\b|cf\b|f\.|f\s*&|feldman|b\.|bloch|ba\.|baer|m\.|mourlot|cramer|c\.|gilmour|\d))[^()]{2,30}\))?/i);
  if (!m) return null;
  // a parenthetical that names a different portfolio stays with the name
  // ("from Flowers (Hand-Colored)" is not "Flowers"); a catalogue cite does not
  let label = (m[1] + (m[2] || '')).replace(/\s+(?:portfolio|series|suite)\s*$/i, '').replace(/[\s.;:-]+$/, '').trim();
  // "La Série 347" / "Séries 347" print as "Série 347"; "the Vollard suite" as "Vollard"
  label = label.replace(/^(?:the|la|le)\s+/i, '');
  if (/^s[ée]ries?\s+\d/i.test(label)) label = label.replace(/^s[ée]ries?/i, 'Série');
  const key = seriesNorm(label);
  if (!key || key.length < 3) return null;
  // the vetted portfolio label wins its own name (sizes ride along)
  if (artist === 'andy-warhol') {
    const hit = WARHOL_FS.find(p => seriesKeyEq(seriesNorm(p.label), key));
    if (hit) return { key: `${artist}|${seriesNorm(hit.label)}`, label: hit.label, size: hit.hi - hit.lo + 1, member };
  }
  return { key: `${artist}|${key}`, label, size: SERIES_SIZE[`${artist}|${key}`] ?? null, member };
}

/** series sizes outside Warhol's F&S table — settled counts only */
export const SERIES_SIZE: Readonly<Record<string, number>> = {
  'pablo-picasso|vollard': 100,
  'pablo-picasso|347': 347,
};

/** the print's own name — the title before "from …" / a catalogue cite, the
 *  maker's name a house leads with dropped ("ANDY WARHOL (1928-1987) Mammy") —
 *  with its own F&S number when it cites one ("Flowers, F&S II.67") */
function memberOf(title: string, artist = ''): string {
  let t = craftTitle(title).replace(/\s*\((?:see\s+)?(?:F\.?\s*(?:&|and)\s*S|Feldman)[^)]*\)\s*/gi, ' ');
  const name = artist.replace(/-/g, ' ');
  if (name) t = t.replace(new RegExp(`^\\s*${name.replace(/[^a-z ]/gi, '.').replace(/ /g, '\\s+')}\\s*(?:\\([^)]*\\))?\\s*[|:,-]?\\s*`, 'i'), '');
  const cut = t.split(/[\s,(]+(?:from|de la s[ée]rie|de la suite)\s+/i)[0];
  const own = cut.replace(/[\s(,:;]+$/, '').replace(/\s+/g, ' ').trim();
  const fs = artist === 'andy-warhol' ? fsNumberOf(title) : null;
  return fs != null ? `${own}, F&S II.${fs}` : own;
}

/** two members of one series are the same print: the same F&S number, or
 *  the same name when either side cites none ("Marilyn" alone could be any
 *  of the ten — never offered back as a sibling) */
export function sameMember(a: string, b: string): boolean {
  const split = (m: string) => { const i = m.lastIndexOf(', F&S II.'); return i >= 0 ? { n: seriesNorm(m.slice(0, i)), fs: m.slice(i + 9) } : { n: seriesNorm(m), fs: null as string | null }; };
  const x = split(a), y = split(b);
  if (x.fs && y.fs) return x.fs === y.fs;
  return x.n === y.n;
}

/** two series keys name the same series — exact, or one typo apart with the
 *  same trailing volume ("campell soup ii" = "campbell soup ii"; never
 *  "campbell soup i" = "campbell soup ii") */
export function seriesKeyEq(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = a.split(' '), tb = b.split(' ');
  const va = ROMAN_OR_NO.test(ta[ta.length - 1]) ? ta.pop()! : '';
  const vb = ROMAN_OR_NO.test(tb[tb.length - 1]) ? tb.pop()! : '';
  if (va !== vb) return false;
  const x = ta.join(''), y = tb.join('');
  if (Math.min(x.length, y.length) < 8) return x === y;
  return editDistanceLe1(x, y);
}

function editDistanceLe1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}

/** an art print / multiple (series siblings are prints, never originals) */
function isPrintish(l: { subCat?: string | null; formKey?: string | null; medium?: string | null; title?: string | null }, cat: CatKey): boolean {
  if (cat !== 'fine-art') return false;
  const s = String(l.subCat || '');
  if (s === 'originals' || s === 'sculpture' || s === 'ceramics') return false;
  return true;
}

/* ── the held collection ───────────────────────────────────────────────── */

interface Held {
  id: string;
  aliases: string[];
  owned: boolean;
  title: string;
  artist: string;
  cat: CatKey;
  lot: AuctionLot | null;
  card: HeldCard | null;
  watch: { key: string; ref: string } | null;
  series: HeldSeries | null;
  edition: string | null;
  ek: string | null;
  who: string | null;
}

function readHeld(h: HeldInput, bySlug: ReadonlyMap<string, string>): Held | null {
  const lot = h.lot ?? null;
  const title = String(lot?.title || h.title || '');
  const artist = String(lot?.artist || h.artist || '');
  if (!title) return null;
  const shape = lot ?? ({ id: h.id, title, artist } as unknown as AuctionLot);
  const t = taxonOf(shape);
  const card = readCard(title, t.cat, lot, bySlug);
  const watch = t.cat === 'watches' ? watchRefKey({ artist, title, reference: lot?.reference ?? null }) : null;
  const series = isPrintish(shape, t.cat) ? seriesOf({ artist, title }) : null;
  let edition: string | null = null;
  if (t.cat === 'fine-art') { try { edition = editionIdentityKey({ ...shape, artist, title }); } catch { edition = null; } }
  const ek = entityKeyOf(shape);
  const named = !!ek && !ek.startsWith('cs:');
  let who: string | null = null;
  if (named) { try { who = makerLineOf(shape).name || null; } catch { who = null; } }
  return {
    id: h.id, aliases: idAliases(h.id), owned: h.owned, title, artist, cat: t.cat, lot,
    card, watch, series, edition, ek: named ? ek : null, who,
  };
}

/* ── the candidates ─────────────────────────────────────────────────────── */

interface Cand {
  lot: AuctionLot;
  cat: CatKey;
  card: HeldCard | null;
  watch: { key: string; ref: string } | null;
  series: HeldSeries | null;
  edition: string | null;
  ek: string | null;
  score: number;
  titleKey: string;
}

const KIND_RANK: Record<PickKind, number> = { upgrade: 0, set: 1, series: 2, maker: 3 };
/** per tie caps: one set / series / maker never fills the room */
const CAP: Record<PickKind, number> = { upgrade: 3, set: 4, series: 4, maker: 3 };

const fmtN = (n: number) => n.toLocaleString('en-US');

/** the candidate's own card record (lotFace.card: same card & grade), named
 *  by its window the way the lot page names it (card-record, W17) — never
 *  a bare median:
 *    "same-card PSA 6 $1.2K median (4 sales in the last year)"
 *    "same-card PSA 6 $1.2K (1 sale in the last year)"
 *    "same-card PSA 6 $10K all-time median (since 2021 · 11 sales, most 2021–23)"
 *  An all-time record under 3 sales prints no figure (the lot page's head
 *  prints none either), so the line says nothing. */
function sameCardLine(c: Cand): string | null {
  const f = lotFace(c.lot).card;
  if (!f || f.med == null || !(f.n > 0) || !f.text) return null;
  const g = c.card!.gradeLabel;
  const sales = (k: number) => `${fmtN(k)} ${k === 1 ? 'sale' : 'sales'}`;
  if (f.window === 'year') return `same-card ${g} ${f.text}${f.n === 1 ? '' : ' median'} (${sales(f.n)} in the last year)`;
  if (f.n < 3) return null;
  const rec = cardRecordOf(c.lot);
  return `same-card ${g} ${f.text} all-time median (${spanText(f.n, rec?.all.span)}${rec?.recent && rec.recent.n === 0 ? ', none in the last year' : ''})`;
}

/** "PSA 9 ≈ 3.2× PSA 8 on Mickey Mantle's matched ladder (28 cards)" —
 *  only between PSA rungs (raw · 8 · 9 · 10) the ladder prints */
function ladderLine(lad: MatchedLadder | null | undefined, from: CardId, to: CardId, who: string | null): string | null {
  if (!lad || lad.basis !== 'matched' || !lad.cards) return null;
  const rung = (id: CardId) => (id.gradeCo === 'PSA' && !id.gradeQual && !id.gradeTier && (id.gradeNum === 8 || id.gradeNum === 9 || id.gradeNum === 10) ? `psa-${id.gradeNum}` : null);
  const a = rung(from), b = rung(to);
  if (!a || !b || a === b) return null;
  const ra = lad.rows.find(r => r.key === a), rb = lad.rows.find(r => r.key === b);
  if (!ra?.med12m || !rb?.med12m) return null;
  const x = rb.med12m / ra.med12m;
  if (!(x > 1)) return null;
  const mult = x >= 10 ? Math.round(x).toString() : x.toFixed(1);
  return `${rb.label} ≈ ${mult}× ${ra.label} on ${who ? `${who}’s` : 'the'} matched ladder (${fmtN(lad.cards)} cards)`;
}

function valueLine(c: Cand): string | null {
  const f = lotFace(c.lot);
  if (f.comps && f.comps.n > 0) return `comps median ${f.comps.text} (${fmtN(f.comps.n)})`;
  return null;
}

/** the name a named entity prints under: a maker's label, a player's name
 *  (the live row's own), a subject's maker line — never a category word */
function nameOfEntity(ek: string, lot: AuctionLot, heldWho: string | null): string | null {
  if (ek.startsWith('mk:')) return ARTIST_LABEL[ek.slice(3)] || null;
  if (ek.startsWith('pl:')) {
    if (lot.playerSlug === ek.slice(3) && lot.playerName) return lot.playerName;
    return ek.slice(3).split('-').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  }
  let line: string | null = null;
  try { line = makerLineOf(lot).name || null; } catch { line = null; }
  // the held lot names it as the reader knows it ("Charizard", not the live row's "Crystal Charizard")
  const n = heldWho && !CATEGORY_WORD.test(heldWho) ? heldWho : line;
  // a category word is no name ("Memorabilia", "Autographs")
  if (!n || CATEGORY_WORD.test(n)) return null;
  return n;
}
const CATEGORY_WORD = /^(?:memorabilia|autographs?|graded cards|sports cards|pok[eé]mon|game[- ]used|tickets?|programs?|photos?|wax|other|cards?|space|documents?|props?)$/i;
const roleOf = (ek: string) => (ek.startsWith('mk:') ? 'by this maker' : ek.startsWith('pl:') ? 'of this player' : '');

/** the block read once per pool per UTC day (the profile re-renders often;
 *  the eval runs thousands of desks over one book) */
const poolMemo = new WeakMap<object, { day: number; bySlug: Map<string, string>; cands: Cand[] }>();
function readPool(pool: readonly AuctionLot[], nowMs: number): { bySlug: Map<string, string>; cands: Cand[] } {
  const day = Math.floor(nowMs / 864e5);
  const hit = poolMemo.get(pool);
  if (hit && hit.day === day) return hit;
  // a player's sport, read off the book (a snapshot title rarely names it)
  const bySlug = new Map<string, string>();
  for (const l of pool) {
    const slug = l.playerSlug;
    const sp = (l as { sport?: string | null }).sport ?? (l.drill && SPORT_WORD.test(l.drill) ? l.drill : null);
    if (slug && sp && !bySlug.has(slug)) bySlug.set(slug, sp.toLowerCase());
  }
  const cands: Cand[] = [];
  for (const l of pool) {
    if (l.status !== 'upcoming' || !l.title) continue;
    const t = taxonOf(l);
    const card = readCard(l.title, t.cat, l, bySlug);
    const ekRaw = entityKeyOf(l);
    const p = priorityOf(l, nowMs);
    cands.push({
      lot: l, cat: t.cat, card,
      watch: t.cat === 'watches' ? watchRefKey(l) : null,
      series: isPrintish(l, t.cat) ? seriesOf(l) : null,
      edition: t.cat === 'fine-art' ? (() => { try { return editionIdentityKey(l); } catch { return null; } })() : null,
      ek: ekRaw && !ekRaw.startsWith('cs:') ? ekRaw : null,
      score: p ? p.score : 0,
      titleKey: `${l.artist}|${craftTitle(l.title).toLowerCase()}`,
    });
  }
  const v = { day, bySlug, cands };
  poolMemo.set(pool, v);
  return v;
}

/* ── THE PICKS ──────────────────────────────────────────────────────────── */

export function collectionPicks(heldIn: readonly HeldInput[], pool: readonly AuctionLot[], opts: CollectionOpts = {}): CollectionResult {
  const nowMs = opts.nowMs ?? Date.now();
  const limit = opts.n ?? 30;
  // a player's sport, read off the book (a snapshot title rarely names it)
  const { bySlug, cands: all } = readPool(pool, nowMs);
  const held: Held[] = [];
  for (const h of heldIn) { const x = readHeld(h, bySlug); if (x) held.push(x); }
  const read = {
    cards: held.filter(h => h.card).length, watches: held.filter(h => h.watch).length,
    prints: held.filter(h => h.series).length, makers: new Set(held.map(h => h.ek).filter(Boolean)).size,
    held: held.length, owned: held.filter(h => h.owned).length, saved: held.filter(h => !h.owned).length,
  };
  if (!held.length) return { picks: [], read, ladderIds: [] };

  const heldIds = new Set<string>();
  for (const h of held) for (const a of h.aliases) heldIds.add(a);
  // exact objects already held: a card in the SAME grade, a print of the same edition
  const heldCardKeys = new Set(held.map(h => h.card?.key).filter((k): k is string => !!k));
  const heldEditions = new Set(held.map(h => h.edition).filter((k): k is string => !!k));
  const heldTitles = new Set(held.map(h => `${h.artist}|${craftTitle(h.title).toLowerCase()}`));

  const cands = all.filter(c => !heldIds.has(c.lot.id) && !heldTitles.has(c.titleKey));

  const out: CollectionPick[] = [];
  const taken = new Set<string>();
  const per = new Map<string, number>();
  const ladderIds = new Set<string>();
  const verb = (owned: boolean) => (owned ? 'own' : 'saved');
  const push = (c: Cand, p: Omit<CollectionPick, 'lot'>) => {
    if (taken.has(c.lot.id)) return;
    const k = `${p.kind}|${p.tie}`;
    if ((per.get(k) || 0) >= CAP[p.kind]) return;
    per.set(k, (per.get(k) || 0) + 1);
    taken.add(c.lot.id);
    out.push({ lot: c.lot, ...p });
  };
  const order = <T extends { owned: boolean; c: Cand }>(xs: T[]) => xs.sort((a, b) => Number(b.owned) - Number(a.owned) || b.c.score - a.c.score);

  /* (a) UPGRADE — the same card, a higher grade; the same watch reference */
  const ups: { owned: boolean; c: Cand; h: Held }[] = [];
  for (const h of held) {
    const hc = h.card;
    if (hc?.key) {
      const from = hc.id;
      // raw is not a grade; an Authentic slab upgrades to any numeric grade
      const fromNum = from.gradeNum != null && !from.gradeUnparsed ? from.gradeNum : from.gradeTag === 'A' ? 0 : null;
      if (fromNum == null) continue;
      for (const c of cands) {
        const cc = c.card;
        if (!cc || cc.key !== hc.key) continue;
        const to = cc.id;
        if (to.gradeNum == null || to.gradeQual || to.gradeUnparsed || to.gradeTag) continue;
        if (!(to.gradeNum > fromNum)) continue;
        ups.push({ owned: h.owned, c, h });
      }
    } else if (h.watch) {
      for (const c of cands) if (c.watch && c.watch.key === h.watch.key) ups.push({ owned: h.owned, c, h });
    }
  }
  for (const u of order(ups)) {
    const { c, h } = u;
    if (h.card && c.card) {
      if (c.ek) ladderIds.add(c.ek);
      const lad = c.ek ? opts.ladders?.get(c.ek) : null;
      const parts = [
        `Upgrade: you ${verb(h.owned)} ${h.card.gradeLabel} · this is ${c.card.gradeLabel}`,
        sameCardLine(c),
        ladderLine(lad, h.card.id, c.card.id, h.who),
      ].filter(Boolean);
      push(c, { kind: 'upgrade', reason: parts.join(' · '), fromIds: [h.id], owned: h.owned, tie: h.card.key!, ek: c.ek });
    } else if (h.watch && c.watch) {
      const parts = [`Same reference: you ${verb(h.owned)} ref. ${h.watch.ref} · this is ref. ${c.watch.ref}`, valueLine(c)].filter(Boolean);
      push(c, { kind: 'upgrade', reason: parts.join(' · '), fromIds: [h.id], owned: h.owned, tie: h.watch.key });
    }
  }

  /* (b) COMPLETE THE SET — 2+ held singles of one set: live numbers not held */
  const sets = new Map<string, { owned: Set<string>; saved: Set<string>; label: string; ids: string[]; anyOwned: boolean }>();
  for (const h of held) {
    const hc = h.card;
    if (!hc?.set || !hc.no) continue;
    let s = sets.get(hc.set);
    if (!s) sets.set(hc.set, s = { owned: new Set(), saved: new Set(), label: hc.setLabel, ids: [], anyOwned: false });
    (h.owned ? s.owned : s.saved).add(hc.no);
    s.ids.push(h.id);
    if (h.owned) { s.anyOwned = true; s.label = hc.setLabel; }
  }
  const setRows: { owned: boolean; c: Cand; key: string }[] = [];
  sets.forEach((s, key) => {
    const heldNos = new Set([...Array.from(s.owned), ...Array.from(s.saved)]);
    if (heldNos.size < 2) return;
    for (const c of cands) {
      if (!c.card?.set || c.card.set !== key || !c.card.no || heldNos.has(c.card.no)) continue;
      if (c.card.key && heldCardKeys.has(c.card.key)) continue;
      setRows.push({ owned: s.anyOwned, c, key });
    }
  });
  const setNoSeen = new Set<string>();
  for (const r of order(setRows)) {
    // one copy per missing number (the best-placed one)
    const nk = `${r.key}|${r.c.card!.no}`;
    if (setNoSeen.has(nk) || taken.has(r.c.lot.id)) continue;
    setNoSeen.add(nk);
    const s = sets.get(r.key)!;
    const size = SET_SIZE[r.key] ?? null;
    const o = s.owned.size, v = s.saved.size;
    const holds = o && v ? `you own ${o} and saved ${v}` : o ? `you own ${o}` : `you saved ${v}`;
    const head = size
      ? `Complete the set: ${holds} of ${fmtN(size)} in ${s.label}`
      : `Same set: ${holds} from ${s.label}`;
    const no = r.c.card!.id.cardNo;
    push(r.c, { kind: 'set', reason: `${head} · this is #${no}, one you don’t have`, fromIds: s.ids, owned: s.anyOwned, tie: r.key });
  }

  /* (c) SERIES / PORTFOLIO siblings for prints */
  const series = new Map<string, { label: string; size: number | null; members: Map<string, boolean>; ids: string[]; anyOwned: boolean }>();
  const memberOwned = (s: { members: Map<string, boolean> }, m: string) => Array.from(s.members.keys()).some(k => sameMember(k, m));
  for (const h of held) {
    if (!h.series) continue;
    let s: { label: string; size: number | null; members: Map<string, boolean>; ids: string[]; anyOwned: boolean } | undefined;
    s = series.get(h.series.key);
    if (!s) { const hit = Array.from(series.entries()).find(([k]) => k.split('|')[0] === h.series!.key.split('|')[0] && seriesKeyEq(k.split('|')[1], h.series!.key.split('|')[1])); s = hit?.[1]; }
    if (!s) series.set(h.series.key, s = { label: h.series.label, size: h.series.size, members: new Map(), ids: [], anyOwned: false });
    const mk = Array.from(s.members.keys()).find(k => sameMember(k, h.series!.member)) ?? h.series.member;
    s.members.set(mk, h.owned || !!s.members.get(mk));
    s.ids.push(h.id);
    if (h.owned) s.anyOwned = true;
  }
  const serRows: { owned: boolean; c: Cand; key: string }[] = [];
  series.forEach((s, key) => {
    const [art, sk] = [key.split('|')[0], key.split('|').slice(1).join('|')];
    for (const c of cands) {
      if (!c.series || c.lot.artist !== art) continue;
      const ck = c.series.key.split('|').slice(1).join('|');
      if (!seriesKeyEq(sk, ck)) continue;
      if (memberOwned(s, c.series.member)) continue;
      if (c.edition && heldEditions.has(c.edition)) continue;
      serRows.push({ owned: s.anyOwned, c, key });
    }
  });
  for (const r of order(serRows)) {
    const s = series.get(r.key)!;
    const ownedN = Array.from(s.members.values()).filter(Boolean).length;
    const savedN = s.members.size - ownedN;
    const holds = ownedN && savedN ? `you own ${ownedN} and saved ${savedN}` : ownedN ? `you own ${ownedN}` : `you saved ${savedN}`;
    const names = s.members.size === 1 ? Array.from(s.members.keys())[0] : null;
    const head = s.size
      ? `Complete the series: ${holds} of ${s.size} in ${s.label}`
      : `Same series: ${holds}${names ? ` (${names})` : ''} from ${s.label}`;
    push(r.c, { kind: 'series', reason: `${head} · this is ${r.c.series!.member}`, fromIds: s.ids, owned: s.anyOwned, tie: r.key });
  }

  /* (d) MORE BY a maker / player / subject you hold */
  const makers = new Map<string, { who: string | null; owned: number; saved: number; ids: string[]; cat: CatKey }>();
  for (const h of held) {
    if (!h.ek) continue;
    let m = makers.get(h.ek);
    if (!m) makers.set(h.ek, m = { who: h.who, owned: 0, saved: 0, ids: [], cat: h.cat });
    if (h.owned) m.owned++; else m.saved++;
    m.ids.push(h.id);
    if (!m.who) m.who = h.who;
  }
  const mkRows: { owned: boolean; c: Cand; key: string }[] = [];
  makers.forEach((m, ek) => {
    for (const c of cands) {
      if (c.ek !== ek) continue;
      if (c.card?.key && heldCardKeys.has(c.card.key)) continue;
      if (c.edition && heldEditions.has(c.edition)) continue;
      mkRows.push({ owned: m.owned > 0, c, key: ek });
    }
  });
  for (const r of order(mkRows)) {
    const m = makers.get(r.key)!;
    const name = nameOfEntity(r.key, r.c.lot, m.who);
    if (!name) continue;
    const k = m.owned + m.saved;
    const noun = m.cat === 'sports-cards' || m.cat === 'tcg' ? (k === 1 ? 'card' : 'cards') : (k === 1 ? 'piece' : 'pieces');
    const holds = m.owned && m.saved ? `you own ${m.owned} and saved ${m.saved}` : m.owned ? `you own ${m.owned}` : `you saved ${m.saved}`;
    const role = roleOf(r.key);
    push(r.c, { kind: 'maker', reason: `More ${name} · ${holds} ${noun}${role ? ` ${role}` : ''}`, fromIds: m.ids, owned: m.owned > 0, tie: r.key });
  }

  out.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || Number(b.owned) - Number(a.owned));
  return { picks: out.slice(0, limit), read, ladderIds: Array.from(ladderIds) };
}
