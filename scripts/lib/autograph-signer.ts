/**
 * autograph-signer.ts — extract a SIGNER slug from an auction lot whose signer
 * isn't in a structured field (94% of the autograph corpus). RR Auction /
 * Christie's title & medium fields carry the name in a few consistent shapes;
 * we parse those HIGH-PRECISION and ABSTAIN otherwise — a wrong signer is worse
 * than no row. The output slug matches Starling's eBay autograph matcher so the
 * value book and the buy-side board join on the same key.
 *
 * Reliable shapes:
 *   1. medium field = "NAME, <date>"           (Christie's)  → NAME
 *   2. title  = "SURNAME, Firstname (dates)."   (catalog)     → Firstname Surname
 *   3. title  = "NAME: <format …>"              (themed)      → NAME
 */

const FORMAT_OR_MATERIAL =
  /\b(signed|autograph(?:ed)?|letter|document|photograph|photo|portrait|note|manuscript|quotation|quote|check|cheque|inscribed|inscription|typed|album|card|cut|endorsement|collection|print|edition|first|page|book|archive|group|lot|set|pair|framed|matted|display|memorabilia|relic|cane|knife|lock|hair|flag|ball|bat|jersey)\b/i;

const PARTICLES = new Set([
  'de', 'van', 'von', 'der', 'den', 'del', 'della', 'di', 'da', 'du', 'la', 'le',
  'el', 'bin', 'al', 'st', 'st.', 'mac', 'mc', "d'", 'y', 'ter', 'ten',
]);
const HONORIFICS = new Set([
  'sir', 'dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'lord', 'lady', 'gen', 'gen.',
  'col', 'col.', 'capt', 'capt.', 'maj', 'maj.', 'sgt', 'rev', 'rev.', 'hon', 'hon.',
  'pres', 'pres.', 'king', 'queen', 'saint', 'st', 'st.', 'prof', 'prof.', 'lt', 'lt.',
]);

export function signerSlug(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isCap(tok: string): boolean {
  return /^[A-ZÀ-Þ]/.test(tok);
}

// Words that never appear in a personal name but riddle auction lot NICKNAMES
// (Christie's thematic space sales: "OLD GLORY ON THE MOON", "MISSION REPORT").
// One hit → the candidate is a theme, not a signer.
const NON_NAME = new Set([
  'highly', 'important', 'mission', 'report', 'launch', 'moon', 'glory', 'stars',
  'stripes', 'rendezvous', 'experiment', 'photography', 'photograph', 'apollo',
  'mercury', 'gemini', 'orbital', 'spacewalk', 'moonwalk', 'step', 'seen', 'view',
  'earth', 'landing', 'crew', 'aviators', 'seven', 'one', 'long', 'old', 'first',
  'second', 'third', 'official', 'lunar', 'saturn', 'surveyor', 'red', 'white',
  'blue', 'flag', 'archive', 'collection', 'group', 'lot', 'set', 'important',
  'historic', 'rare', 'fine', 'the', 'and', 'of', 'on', 'for', 'from', 'space',
  'star', 'wars', 'trek', 'wagon', 'train', 'show', 'team', 'club', 'company',
]);

/** True when a cleaned string reads like a 2–3 token personal name. */
function looksLikePerson(name: string): boolean {
  const toks = name.trim().split(/\s+/).filter(Boolean);
  if (toks.length < 2 || toks.length > 3) return false; // First [Middle] Last
  if (FORMAT_OR_MATERIAL.test(name)) return false;
  let caps = 0;
  for (const t of toks) {
    const low = t.toLowerCase().replace(/[.'’-]/g, '');
    if (NON_NAME.has(low)) return false; // a theme word → not a name
    if (isCap(t)) caps++;
    else if (!PARTICLES.has(low)) return false; // lowercase non-particle → not a clean name
  }
  return caps >= 2; // at least a first + last
}

/** Strip dates, parentheticals, quoted signatures, honorifics, trailing punct. */
function cleanName(raw: string): string {
  let s = raw
    .replace(/\([^)]*\)/g, ' ') // (1879-1955)
    .replace(/["“”][^"“”]*["“”]/g, ' ') // ("A Einstein")
    .replace(/\b(?:c\.?|circa)\s*\d{3,4}.*$/i, ' ') // c. 1864 …
    .replace(/,?\s*\b(1[0-9]{3}|20[0-2]\d)\b.*$/, ' ') // , 1913 …
    .replace(/\b(?:jr|sr|ii|iii|iv)\.?\b/gi, ' ')
    .replace(/[.,;:]+\s*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let toks = s.split(/\s+/).filter(Boolean);
  while (toks.length && HONORIFICS.has(toks[0].toLowerCase())) toks.shift();
  // drop a trailing dangling particle
  while (toks.length && PARTICLES.has(toks[toks.length - 1].toLowerCase())) toks.pop();
  return toks.join(' ');
}

// A date tail, e.g. "C. 1864", "1913", "11 MAY 1917", "1930s", "n.d." — used to
// confirm that what precedes a comma is a NAME, not a description.
const DATE_TAIL = /^[\s,]*(?:c\.?\s*|circa\s*)?(?:\d{1,2}\s+)?(?:[A-Za-z]+\.?\s+)?(?:1[0-9]{3}|20[0-2]\d)s?\.?[\s,.]*$/i;

/** Catalog form "SURNAME, Firstname (dates)…" → "Firstname Surname". The comma
 *  separates surname from a CAPITALIZED first name (not a date), and a paren/
 *  period/dash follows — the RR/Christie's manuscript cataloguing shape. */
function fromCatalog(text: string): string | null {
  const m = text.match(
    /^\s*([A-ZÀ-Þ][A-Za-zÀ-ÿ'’.\- ]+?),\s+([A-ZÀ-Þ][A-Za-zÀ-ÿ'’.\- ]+?)\s*(?:\((?:[^)]*\d{3,4}[^)]*)?\)|\.\s|[-–—])/,
  );
  if (!m) return null;
  const name = cleanName(`${cleanName(m[2])} ${cleanName(m[1])}`);
  return looksLikePerson(name) ? name : null;
}

/** Natural-order "Firstname Lastname (dates)…" at the head → "Firstname Lastname". */
function fromNaturalWithDates(text: string): string | null {
  const m = text.match(/^\s*([A-ZÀ-Þ][A-Za-zÀ-ÿ'’.\- ]{2,50}?)\s*\((?:[^)]*\d{3,4}[^)]*)\)/);
  if (!m) return null;
  const name = cleanName(m[1]);
  return looksLikePerson(name) ? name : null;
}

/** "NAME, <date>" — the whole tail after the first comma is a date (Christie's
 *  `medium` = "GEORGE ARMSTRONG CUSTER, C. 1864"). Precise: a descriptive tail
 *  (", Photograph signed by…") fails the DATE_TAIL check. */
function fromNameComma(text: string): string | null {
  const i = text.indexOf(',');
  if (i < 0) return null;
  const name = cleanName(text.slice(0, i));
  const tail = text.slice(i);
  if (!DATE_TAIL.test(tail)) return null;
  return looksLikePerson(name) ? name : null;
}

/** Parse an INDIVIDUAL signer NAME from a lot's descriptive title/medium, or
 *  null to abstain. Only the high-precision shapes — groups/themes/events
 *  (STAR WARS:, MERCURY SEVEN –) abstain, because eBay's autograph listings are
 *  single-signer and those wouldn't join anyway. This is the piece stamped into
 *  `l.entity` at corpus-normalize time (like recoverPlayerSlug stamps playerSlug),
 *  so lectr's own comps/similarity and the value book both read one field. */
export function parseSignerName(l: { title?: string | null; medium?: string | null }): string | null {
  const title = l.title || '';
  const medium =
    l.medium && !/^(unknown|photograph|print|document|letter|paper|ink)$/i.test(l.medium.trim())
      ? l.medium
      : '';
  for (const text of [title, medium]) {
    if (!text) continue;
    const hit = fromCatalog(text) || fromNaturalWithDates(text) || fromNameComma(text);
    if (hit) return hit;
  }
  return null;
}

/** Signer slug for a lot: structured field first (playerSlug/entity — both now
 *  stamped at normalize time), then a parse fallback. The value-book emitter
 *  uses this; after normalize stamps `entity`, the field branch answers. */
export function extractSignerSlug(l: {
  playerSlug?: string | null;
  entity?: string | null;
  title?: string | null;
  medium?: string | null;
}): string | null {
  if (l.playerSlug) return l.playerSlug; // already a slug
  if (l.entity) {
    const e = cleanName(l.entity);
    if (looksLikePerson(e)) return signerSlug(e);
  }
  const name = parseSignerName(l);
  return name ? signerSlug(name) : null;
}
