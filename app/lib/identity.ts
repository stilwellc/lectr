/**
 * identity.ts — exact-identity keys for NON-CARD verticals (Aug 14 audit).
 *
 * Cards got a tiered exact-identity ladder (cardKey) and it carries the
 * engine's best record. The corpus audit showed every other vertical has one
 * structured signal with the same shape, unused by comps:
 *   watches   — 32k sold lots carry a numeric reference; 2,124 refs have ≥3
 *               sales covering 40.9% of all sold watches (median 6 sales/ref)
 *   art       — 70% of art sold is heavily-editioned (Picasso/Warhol);
 *               editionKey already certifies the repeat-sale index
 *   autograph — RR spells out the format on 24% of science+culture titles
 *               ("typed letter signed", "document signed"); signer + format
 *               is how that market actually prices
 * These helpers feed similarity.ts (idExact match + format gate) and
 * sub-markets.ts (the art edition index key lives here now, one source).
 */
import type { AuctionLot } from '../types';
import { ARTISTS } from '../constants';
import { coarseWatchMaterial } from './comps';

export const WATCH_SLUGS = new Set<string>(ARTISTS.filter(a => a.market === 'watches').map(a => a.slug));

/** Art-market maker slugs — scope key for the art-only AREA-RATIO comp gate in
 *  similarity.ts (Engine Spec v2 item 7, adopted Aug 30 2026; receipt there). */
export const ART_SLUGS = new Set<string>(ARTISTS.filter(a => a.market === 'art').map(a => a.slug));

/** Autograph-format verticals: science + culture + the sports autographs
 *  slug. (Pokémon moved to its own 'tcg' market Aug 21 2026, so the old
 *  not-pokémon carve-out is structural now.) An ALS and a signed photo of the
 *  same person are different markets; format mismatch is a comp gate here. */
export const AUTOGRAPH_SLUGS = new Set<string>([
  ...ARTISTS.filter(a => a.market === 'science' || a.market === 'culture').map(a => a.slug),
  'autographs',
]);

/** Numeric watch reference key — a true catalog ref (has a digit), not one of
 *  the 43 model-name tokens ("tank", "royaloak") the reference field also
 *  carries. Model names span materials/sizes/eras; numeric refs are the
 *  comp unit. */
export function numericWatchRef(l: Pick<AuctionLot, 'artist' | 'reference'>): string | null {
  if (!WATCH_SLUGS.has(l.artist) || !l.reference) return null;
  const r = String(l.reference).toLowerCase().replace(/\s+/g, '');
  return /\d/.test(r) ? `${l.artist}|${r}` : null;
}

/** Coarse case material — the price axis WITHIN a reference (a 3940 exists in
 *  three golds and platinum at very different money). null = unknown; an
 *  idExact ref match requires the materials not to conflict. ONE reader
 *  (Oct 6 2026): this used to be a second regex that missed "steel and
 *  yellow gold" (1,502 lots) and read a "two-tone dial" as a two-tone case
 *  (427); it is comps.coarseWatchMaterial now. */
export const watchMaterialCoarse = (l: Pick<AuctionLot, 'title' | 'medium'> & { artist?: string }): string | null => coarseWatchMaterial(l);

/* ── EDITION IDENTITY (Oct 6 2026 identity fix wave) ────────────────────────
   Edition pools are the art repeat-sale/comp unit, so the key must name ONE
   edition and nothing else. Measured on the Oct 5 corpus, the old key:
     · let unique works into edition pools — the pool test read only formKey/
       medium, so a Warhol "synthetic polymer and silkscreen ink on canvas"
       or a Matisse "pencil on paper" with a print-ish formKey pooled with
       the prints;
     · carried the maker's name when the house printed it in the title
       ("PABLO PICASSO Buste de jeune Fille" ≠ "Buste de jeune Fille"), and
       dropped accented letters instead of folding them ("étreinte" →
       "treinte", "tête" → "t te");
     · deleted every word "ed" (so "Ed Ruscha" lost his first name);
     · ignored the catalogue raisonné number the houses print — the one
       identity that survives French/English title variants ("(B. 1147;
       Ba. 1321)", "(A.R. 344)", "(F. & S. II.351)");
     · pooled hand-signed with unsigned impressions and "After Warhol"
       posters / posthumous restrikes with the artist's own edition;
     · keyed generic titles ("untitled 1984", "composition", "self-portrait")
       that name dozens of different works.
   Rules: a recognised catalogue-raisonné citation → `cr:<system><number>`;
   else the cleaned title (maker name, dates, numbering, citation groups
   stripped; accents folded); a generic title with no citation abstains
   (null). Then '|signed' when the text says hand-signed and '|after' for
   after / posthumous / estate impressions. */

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/ł/g, 'l');

const LABEL_OF = new Map<string, string>(ARTISTS.map(a => [a.slug, a.label]));

/** Catalogue-raisonné systems the houses cite, folded to one token each (the
 *  abbreviation and the spelled-out author join). Keys are the citation's
 *  system text with every non-letter removed. Per-artist context
 *  disambiguates the single letters (D. = Duthuit for Matisse). */
const CR_SYSTEM: Record<string, string> = {
  b: 'b', bl: 'b', bloch: 'b', ba: 'ba', baer: 'ba', g: 'g', geiser: 'g', czwiklitzer: 'cz',
  m: 'm', mourlot: 'm', ar: 'ar', r: 'ar', ramie: 'ar', alainramie: 'ar',
  fs: 'fs', fands: 'fs', feldmanschellmann: 'fs', feldmanandschellmann: 'fs', d: 'd', dm: 'd', duthuit: 'd', duthuitmatisse: 'd',
  e: 'e', engberg: 'e', corlett: 'corlett', lp: 'lp', littmannp: 'lp',
  cramerbooks: 'cramerbooks', duthuitbooks: 'duthuitbooks', cramer: 'cramer',
};
// the system a multi-citation keys on (most-cited system first)
const CR_PRIORITY = ['fs', 'b', 'ar', 'd', 'e', 'corlett', 'lp', 'ba', 'g', 'm', 'cz', 'cramerbooks', 'duthuitbooks', 'cramer'];
// one citation: "b. 1147", "ba. 1321", "f. & s. ii.351", "f. & s. iib 302",
// "a.r. 344", "littmann p. 65", "d.-m. 492", "cramer books 24", "ramie 82"
const CR_ONE = /^([a-z][a-z .&'-]{0,24}?)\s*\.?\s*((?:[ivx]{1,4}[ab]?[ .]\s*)?\d{1,4}[a-z]?(?:\s*-\s*\d{1,4})?)$/;

function crPart(p: string): { sys: string; no: string } | null {
  const m = p.trim().replace(/^(?:see|cf\.?|and)\s+/, '').match(CR_ONE);
  if (!m) return null;
  const sys = CR_SYSTEM[m[1].replace(/[^a-z]/g, '')];
  if (!sys) return null;
  return { sys, no: m[2].replace(/\s+/g, '').replace(/\.$/, '') };
}

/** The catalogue-raisonné citation of a folded, lower-cased title: a
 *  parenthesised group of citations ("(b. 421; m. 67)" — a short unparsed
 *  part such as a state "ba. 1529 bb1" is tolerated beside a parsed one), or
 *  a trailing ", Ramie 82". Returns the key token and the title with the
 *  citation removed. */
function readCatalogue(t: string): { cr: string | null; rest: string } {
  const found: { sys: string; no: string }[] = [];
  let rest = t.replace(/\(([^()]*)\)/g, (whole, inner: string) => {
    const raw = inner.split(/[;,]/);
    const parts = raw.map(crPart);
    if (!parts.some(Boolean) || raw.some((r, i) => !parts[i] && r.trim().length > 16)) return whole;
    // "(b. 1937)" / "(d. 1990)" alone is a birth/death year, not Bloch/Duthuit
    if (raw.length === 1 && /^(?:b|d)\.?\s*(?:18[5-9]\d|19\d\d|200\d)$/.test(raw[0].trim())) return whole;
    for (const x of parts) if (x) found.push(x);
    return ' ';
  });
  const tail = rest.match(/[,;]\s*((?:alain\s+)?ramie|bloch|baer|mourlot|engberg|corlett)\s+(\d{1,4}[a-z]?)\.?\s*$/);
  if (tail) { const x = crPart(`${tail[1]} ${tail[2]}`); if (x) { found.push(x); rest = rest.slice(0, tail.index); } }
  for (const sys of CR_PRIORITY) {
    const x = found.find(f => f.sys === sys);
    if (x) return { cr: `cr:${x.sys}${x.no}`, rest };
  }
  return { cr: null, rest };
}

/** Words that name a TYPE of work, not a work: a title made only of these
 *  (plus years) names dozens of different works. A number or roman numeral
 *  ("Visage no. 202", "Composition IV") makes it specific. */
const GENERIC_WORDS = new Set(['untitled', 'sans', 'titre', 'ohne', 'titel', 'senza', 'titolo', 'sin', 'titulo',
  'composition', 'komposition', 'abstract', 'abstraction', 'figure', 'figures', 'portrait', 'self', 'selfportrait',
  'autoportrait', 'head', 'tete', 'face', 'visage', 'nude', 'nu', 'woman', 'femme', 'landscape', 'paysage', 'still', 'life', 'nature',
  'morte', 'flowers', 'fleurs', 'study', 'etude', 'sketch', 'drawing', 'print', 'poster', 'lithograph', 'screenprint',
  'etching', 'work', 'works', 'one', 'two', 'three', 'four', 'five', 'plate', 'from', 'the', 'a', 'of', 'and', 'with', 'no']);

// Medium text only a UNIQUE work carries. STRONG vetoes on its own; WEAK
// (drawing media on a support, "executed in 1986") only when neither a print
// process nor an edition size is named — "lithograph with hand-colouring in
// watercolour on paper" and a Madoura plate "executed in 1948 in an edition
// of 100" are still editions. ("tirage unique à 36 exemplaires" is a single
// PRINTING of 36, not a unique work.)
const UNIQUE_STRONG = /(?<!tirage )\bunique\b|\bmonotypes?\b|\bpiece unique\b|\bone[- ]of[- ]a[- ]kind\b|\b(?:oil|acrylic|tempera|encaustic|alkyd|synthetic polymer)(?: paint)?(?:,? (?:and|&) [a-z ,]{1,48}?)? on (?:canvas|linen|panel|board|masonite|wood|plywood|burlap|jute|metal|alumini?um|paper|card)\b|\bon canvas\b|\bpainted in (?:\d{4}|circa|c\.)|\bpeint en\b|\bpeinture\b/;
const UNIQUE_WEAK = /\b(?:gouache|watercolou?r|pastel|charcoal|crayon|graphite|pencil|pen|ink|chalk|marker|spray ?paint|spray enamel|enamel|collage|mixed media)(?:,? (?:and|&) [a-z ,]{1,40}?)? on (?:canvas|linen|panel|board|masonite|wood|plywood|paper|card|vellum|newsprint)\b|\bexecuted (?:in|circa|c\.) ?\d{4}|\bdrawn in\b/;
const PRINT_PROCESS = /\b(?:lithograph|screenprint|screen print|serigraph|silkscreen print|etching|aquatint|drypoint|linocut|linoleum cut|woodcut|wood engraving|engraving|offset|pochoir|giclee|pigment print|photogravure|heliogravure|intaglio|mezzotint|print(?:ed)? in colou?rs)/;
const EDITION_SIZE = /\bedition (?:of|was)\b|\bexemplaires\b|\bnumbered\b[^.;]{0,25}?\b\d{1,3} ?\/ ?\d{1,3}\b/;

const BARE_SALE_EVIDENCE = /print|multiple|edition|lithograph|graphic|works on paper/i;
const BARE_TITLE_EVIDENCE = /lithograph|screenprint|etching|linocut|woodcut|aquatint|serigraph|poster|edition/;
type EditionText = { title?: string | null; medium?: string | null; description?: string | null; saleName?: string | null };
const editionText = (l: EditionText) => fold(`${l.title || ''} ${l.medium || ''} ${l.description || ''}`.toLowerCase());

const SIGNED = /\b(?:hand[- ])?sign(?:ed|e)\b(?! in the (?:plate|stone|block|screen|negative|matrix))/;
const NOT_SIGNED = /\bunsigned\b|\bnot signed\b|\bplate[- ]signed\b|\b(?:printed|stamped|facsimile) signature\b/;
// "a proof apart from the signed and numbered edition of 50" describes the
// EDITION, not this impression
const EDITION_DESCRIPTION = /\b(?:apart|aside) from (?:the )?[^.;()]{0,40}?edition\b|\bthe signed (?:and numbered )?edition\b/g;
const POSTHUMOUS = /\bposthumous(?:ly)?\b|\bestate (?:edition|impression|print|restrike)\b|\brestrike\b|\bsunday b\.? morning\b|\bsigned [^.;]{0,40}\bby the executor\b|\bestate of [a-z .]{3,30}? stamp/;

const nameRe = (last: string) => last.replace(/[^a-z0-9]/g, '.');

/** Edition-level art identity: same maker + the same edition (catalogue
 *  number, else normalized title) + hand-signed + after/posthumous —
 *  model-level identity, like a watch reference. Callers must restrict to
 *  edition-structured lots (isEditionLot); unique originals never enter
 *  this key. null = no identity (no usable or only a generic title). */
export function editionIdentityKey(l: Pick<AuctionLot, 'artist' | 'title'> & EditionText): string | null {
  const label = fold((LABEL_OF.get(l.artist) || l.artist.replace(/-/g, ' ')).toLowerCase());
  const last = label.split(/\s+/).pop() || '';
  const title = fold((l.title || '').toLowerCase()).replace(/\s+/g, ' ').trim();
  let t = title;
  let after = false;
  // "PABLO PICASSO …" / "Andy Warhol (1928-1987) …" / "edward ruscha | grapes"
  // / "After Roy Lichtenstein …": the maker, in any first-name form, leads
  if (last.length >= 3) {
    // (twice: "Keith Haring (1958-1990) Keith Haring (1958-1990)"; dates
    // bracketed or Sotheby's bare "andy warhol 1928-1987, torso")
    const lead = new RegExp(`^(after\\s+)?(?:[a-z.'-]+\\s+){0,2}?${nameRe(last)}\\b\\s*,?\\s*(?:\\([^)]*\\)|\\d{4}\\s*[-–]\\s*\\d{4})?\\s*[|;:,.–-]*\\s*`);
    for (let i = 0; i < 2; i++) {
      const m = t.match(lead);
      if (!m) break;
      if (m[0].length >= t.length) return null;      // the title is only the maker's name
      if (m[1]) after = true;
      t = t.slice(m[0].length);
    }
  }
  const { cr: titleCr, rest } = readCatalogue(t);
  // a truncated title ("… from La Suite Vollard (B") leaves the citation to
  // the description, which the houses open with the full title
  const cr = titleCr ?? (l.description ? readCatalogue(fold(l.description.slice(0, 300).toLowerCase())).cr : null);
  const body = rest
    // a catalogue entry glued onto the title ("Cubist Cello Screenprint in
    // colours, 1997, on Somerset…"): the title ends where the medium starts
    .replace(/(\S)\s+(?:offset )?(?:lithograph|screenprint|serigraph|aquatint|etching|drypoint|linocut|woodcut|pochoir)s?(?:,| in colou?rs| printed| on ).*$/, '$1')
    .replace(/\b\d+\s*\/\s*\d+\b/g, '')
    .replace(/\b(ap|pp|hc|tp|edition|numbered|signed)\b/g, '')
    .replace(/\bed\.(?=\s|$)|\bed\s+(?=\d)/g, '')                 // "ed. 50" — never "Ed" Ruscha
    // dates "(1881-1973)", "(american, b. 1937)" — not a dated subtitle
    // "(Flash - November 22, 1963)"
    .replace(/\([^)]*\d{4}[^)]*\)/g, (g: string) => ((g.match(/[a-z]{3,}/g) || []).length > 1 ? g : ''))
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let core = cr;
  if (!core) {
    // (the old ≥8-char floor counted the maker's name the title often
    // carried; with it stripped "Mao", "Corrida", "Têtes" are real titles)
    if (body.length < 3) return null;
    const words = body.replace(/\b(?:1[5-9]|20)\d\d\b/g, ' ').split(' ').filter(Boolean);
    if (words.every(w => GENERIC_WORDS.has(w))) return null;
    core = body;
  }
  const text = editionText(l);
  if (POSTHUMOUS.test(text)) after = true;
  if (!after && last.length >= 3) {
    // "After Andy Warhol" leading the description (Bonhams prints it there)
    const desc = fold((l.description || '').toLowerCase()).trimStart().slice(0, 80);
    if (new RegExp(`^(?:after|d'?apres)\\s+(?:[a-z.]+\\s+){0,2}?${nameRe(last)}\\b`).test(desc)) after = true;
  }
  const own = text.replace(EDITION_DESCRIPTION, ' ');
  const signed = SIGNED.test(own) && !NOT_SIGNED.test(own) && !/\bby the executor\b/.test(own);
  return `${l.artist}|${core}${signed ? '|signed' : ''}${after ? '|after' : ''}`;
}

/** Edition-structured lot: a print/multiple/poster form or medium, and no
 *  medium text only a unique work carries (UNIQUE_STRONG / UNIQUE_WEAK). */
export function isEditionLot(l: Pick<AuctionLot, 'formKey' | 'medium'> & EditionText): boolean {
  const f = `${l.formKey || ''} ${l.medium || ''}`.toLowerCase();
  if (!/print|multiple|edition|poster|lithograph|screenprint|etching/.test(f)) return false;
  const text = editionText(l);
  // a BARE row (no medium, no description — Sotheby's Algolia, older Bonhams)
  // has only its category to call it a print; that alone put $17.6M paintings
  // in print pools. Bare rows need print evidence in the sale or the title
  // (Oct 6 2026: bare pairs without it were >5x apart 14.6% of the time,
  // bare-with-evidence 3.4%, described rows 4.6%).
  if (!l.medium && !l.description
    && !BARE_SALE_EVIDENCE.test(l.saleName || '') && !BARE_TITLE_EVIDENCE.test(text)) return false;
  if (UNIQUE_STRONG.test(text)) return false;
  if (UNIQUE_WEAK.test(text) && !PRINT_PROCESS.test(text) && !EDITION_SIZE.test(text)) return false;
  return true;
}

/** Canonical autograph format from the title. RR mostly spells formats out
 *  (66k sold lots); the classic abbreviations are matched case-sensitively so
 *  "als"/"ds" inside ordinary words never fire. Order matters: ALS/TLS before
 *  the generic "letter signed". */
export function autographFormatOf(title: string | null | undefined): string | null {
  if (!title) return null;
  const t = title;
  if (/autograph(?:ed)? letter,? signed/i.test(t) || /\bALS\b/.test(t)) return 'als';
  if (/typed letter,? signed/i.test(t) || /\bTLS\b/.test(t)) return 'tls';
  if (/autograph(?:ed)? note,? signed/i.test(t) || /\bANS\b/.test(t)) return 'ans';
  if (/autograph(?:ed)? (?:quotation|quote|manuscript),? signed/i.test(t) || /\b(?:AQS|AMS|AMQS)\b/.test(t)) return 'aqs';
  if (/document,? signed|signed document/i.test(t) || /\bDS\b/.test(t)) return 'ds';
  if (/letter,? signed|signed letter/i.test(t) || /\bLS\b/.test(t)) return 'ls';
  if (/signed (?:check|bank check)|check,? signed/i.test(t)) return 'check';
  if (/signed (?:photo(?:graph)?|portrait)|photo(?:graph)?,? signed/i.test(t) || /\bSP\b/.test(t)) return 'sp';
  if (/signed book|book,? signed|signed (?:first|1st) edition/i.test(t)) return 'book';
  return null;
}
