/**
 * watch-ref.ts — the ONE watch reference reader (Sep 28 2026).
 *
 * A watch lot's `reference` is its comp key (comps.watchKeyOf), its /ref page
 * id (refs.json), its repeat-sale block and its hedonic control. It used to be
 * read by two drifting regexes (comps.watchKey + identity-enrich), and both
 * stored things that are NOT references:
 *
 *  · movement / case / serial numbers — "Case No. 68594, Movement No. 341662"
 *    became reference "68594" (~2.5K rows across the five makers), each one a
 *    singleton pool and a bogus /ref page;
 *  · a model NAME when the title printed a real ref the regex could not read —
 *    "Constellation, Ref: 2782/2799" keyed as 'constellation' because the
 *    colon form was not accepted (~2.7K rows keyed 2.4× looser than needed);
 *  · truncated modern Omega refs — "REF.130.30.39.21.02.001" → "130";
 *  · cross-brand model words ("Monaco" on an AP lot, bare "oyster"/"must").
 *
 * Rules, in order (pure, title-only plus the maker slug when known):
 *  1. LABELLED ref ("Ref.", "Ref:", "Réf.", "Reference No.") — trusted: the
 *     house printed the word. Omega dotted refs keep their first four groups
 *     (collection.material.size.movement: 311.30.42.30); Omega/Cartier case
 *     prefixes (ST, BA, OT, CD, W…) are dropped from the key.
 *  2. BARE ref (no label) — only in the brand's distinctive SHAPE (116500LN,
 *     26240ST, 5711/1A, 311.30.42.30.01.005, W51002Q3) and never right after
 *     a movement / case / serial / "No." label. A bare 5–6-digit number is a
 *     serial far more often than a reference, so it is rejected.
 *  3. MODEL LINE — word-bounded, accent-folded (panthère = panthere), and for
 *     the five tracked makers only that maker's own lines.
 */

const WATCH_MAKERS = new Set(['rolex', 'patek-philippe', 'cartier', 'audemars-piguet', 'omega']);

/** Model lines (generic list; brand-scoped below for the five makers). */
const WATCH_MODELS = /\b(submariner|daytona|datejust|day[- ]date|gmt[- ]master(?:\s*ii)?|explorer(?:\s*ii)?|sea[- ]dweller|yacht[- ]master|milgauss|air[- ]king|oyster perpetual|cellini|nautilus|aquanaut|calatrava|ellipse|gondolo|twenty[~-]?4|world time|royal oak(?: offshore)?|millenary|jules audemars|speedmaster|seamaster|constellation|de ville|railmaster|tank|santos|panth[eè]re|ballon bleu|pasha|crash|baignoire|tortue|reverso|memovox|polaris|navitimer|superocean|chronomat|monaco|carrera|autavia|el primero|defy|portugieser|portofino|ingenieur|aquatimer|luminor|radiomir|overseas|patrimony|fifty ?fathoms|villeret)\b/;

/** The lines each tracked maker actually makes (normalized keys). */
const MAKER_LINES: Record<string, ReadonlySet<string>> = {
  rolex: new Set(['submariner', 'daytona', 'datejust', 'daydate', 'gmtmaster', 'gmtmasterii', 'explorer', 'explorerii', 'seadweller', 'yachtmaster', 'milgauss', 'airking', 'oysterperpetual', 'cellini']),
  'patek-philippe': new Set(['nautilus', 'aquanaut', 'calatrava', 'ellipse', 'gondolo', 'twenty4', 'worldtime']),
  'audemars-piguet': new Set(['royaloak', 'royaloakoffshore', 'millenary', 'julesaudemars']),
  omega: new Set(['speedmaster', 'seamaster', 'constellation', 'deville', 'railmaster']),
  cartier: new Set(['tank', 'santos', 'panthere', 'ballonbleu', 'pasha', 'crash', 'baignoire', 'tortue', 'ellipse']),
};

/** (Oct 6 2026 categorization wave 3) is `key` one of `maker`'s own model
 *  lines (the only watch modelKey that is an identity — not "an18" from
 *  "AN 18K GOLD", not "s18" from "LADY'S 18K") */
export function isWatchModelLine(maker: string, key: string | null | undefined): boolean {
  return !!key && !!MAKER_LINES[maker]?.has(key);
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const modelKeyOf = (m: string) => fold(m).replace(/[-~ ]/g, '');

// "ref" / "réf" / "reference" / "référence", then . : , or whitespace, then an
// optional "#" / "no." — then the ref token in the pre-Sep-28 shape (so every key the
// old reader produced is produced unchanged; only forms it MISSED are added).
// No leading \b: concatenated catalogue fields glue the label to the previous
// word ("…wristwatchRef. 3215", "…dateRef: 77113") and the old reader then
// fell through to the CASE number. The separator + digit requirement keeps
// words that merely contain "ref" (refined, reflector) out.
const LABEL = String.raw`r[eé]f(?:[eé]rence)?(?:\s*[.:,]\s*|\s*)(?:#\s*)?(?:(?:no|nr|n°)\.?\s*)?`;
const LABELLED = new RegExp(LABEL + String.raw`([a-z]?\d{3,6}[a-z]{0,4}(?:\/\d+[a-z]?)?)\b((?:\.\d{2,4})*)`);
// forms the old shape could not read: an Omega case-type prefix before a
// dotted ref ("Ref: ST 105.003-65", "Réf. BA 145.0041") and Cartier W-refs
// ("Ref. W51002Q3", "WSTA0029")
const LABELLED_PREFIXED = new RegExp(LABEL + String.raw`(?:st|ba|bj|bt|bd|cd|ot|ck|dd|md|sa|sy|sc|ta|dt|kd)\s?(\d{3}(?:\.\d{2,4})+)`);
const LABELLED_W = new RegExp(LABEL + String.raw`((?:cr)?w[a-z]{0,4}\d{4,6}[a-z0-9]{0,3})\b`);

// Omega dotted refs. A 3-digit core is only the collection/calibre family:
// vintage "145.022" keeps one group, a modern six-part ref
// "311.30.42.30.01.005" keeps four (collection.material.size.movement — the
// dial/strap tail is a variant). A 4-digit core (3570.50, 2531.80) already
// names the model and stays bare, as it always has.
// (Oct 6 2026 categorization re-audit) the WHOLE printed ref is kept: the
// four-group cut made "145.00.52" read "145.00" (every 145.00xx Speedmaster)
// and "310.20.42.50.01.001" a different reference than the one printed.
function dottedKey(core: string, dots: string): string {
  if (core.length !== 3) return core;
  const g = dots.split('.').filter(Boolean);
  return [core, ...g].join('.');
}

// Omega refs printed WITHOUT their dots after a label: "REF. ST 145022" is
// 145.022, "Ref. 1450022" 145.0022, "REF. 32158445251001" the modern
// six-group 321.58.44.52.51.001 (that one used to fall to the model name);
// an eight-digit "25195100" is the four-digit-core 2519.51.00, keyed 2519
// like every dotted four-digit core.
const OMEGA_UNDOTTED = new RegExp(LABEL + String.raw`(?:(?:st|ba|bj|bt|bd|cd|ot|ck|dd|md|sa|sy|sc|ta|dt|kd)\s?)?(\d{14}|\d{8}|\d{6,7})(?![\d.])`);
function omegaUndotted(t: string): string | null {
  const m = t.match(OMEGA_UNDOTTED);
  if (!m) return null;
  const d = m[1];
  if (d.length === 14) return [d.slice(0, 3), d.slice(3, 5), d.slice(5, 7), d.slice(7, 9), d.slice(9, 11), d.slice(11)].join('.');
  if (d.length === 8) return d.slice(0, 4);
  return d.slice(0, 3) + '.' + d.slice(3);
}

function labelled(t: string): string | null {
  const m = t.match(LABELLED);
  if (m) {
    // Omega dotted refs (145.022, 311.30.42.30.01.005): the leading group is
    // only the collection — keep four groups so a Speedmaster is not "311".
    if (m[2] && /^\d{3}$/.test(m[1])) return dottedKey(m[1], m[2]);
    return m[1];
  }
  const p = t.match(LABELLED_PREFIXED);
  if (p) { const [core, ...rest] = p[1].split('.'); return dottedKey(core, '.' + rest.join('.')); }
  const w = t.match(LABELLED_W);
  if (w) return w[1];
  return null;
}

// labels that introduce a NON-reference number (movement / case / serial /
// calibre / inventory "No."), in English, French, German and house shorthand
const NON_REF_LABEL = /(?:(?:movement|mouvement|mvt|werk|calibre|caliber|case|boîte|boitier|serial|numbered|marked|number)|\b(?:cal|nos?|n°|nr)|#)\.?\s*[:,]?\s*(?:no\.?\s*)?[a-z]?\s*$/;

/** Brand-distinctive bare shapes (no "Ref" label printed). */
function bareShapeOk(maker: string, tok: string): boolean {
  const yearish = /^(1[5-9]|20)\d\d/.test(tok) && /^\d{4}(?:s|\/\d{2,4})?$/.test(tok);
  if (yearish) return false;
  switch (maker) {
    case 'rolex': return /^\d{4,6}[a-z]{1,4}$/.test(tok);                       // 116500ln, 16610lv, 1016(no)
    case 'audemars-piguet': return /^\d{5}[a-z]{2}(?:\.[a-z0-9]+)*$/.test(tok);  // 26240st, 15202st.oo.1240st.01
    case 'patek-philippe': return /^\d{4}(?:\/\d{1,4}[a-z]{0,2}|[a-z]{1,2})(?:-\d{3})?$/.test(tok); // 5711/1a-010, 3970e
    case 'omega': return /^\d{3}\.\d{2,4}(?:\.\d{2,3}){0,4}$/.test(tok);         // 145.022, 311.30.42.30.01.005
    case 'cartier': return /^(?:cr)?w[a-z]{0,4}\d{4,6}[a-z0-9]{0,3}$/.test(tok);  // w51002q3, wsta0029
    default: return false;
  }
}

function bare(t: string, maker: string): string | null {
  const re = /(?:^|[\s,(;])((?:cr)?[a-z]{0,4}\d[\da-z]*(?:[./-][\da-z]+)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const tok = m[1].replace(/[.,;:]+$/, '');
    if (!bareShapeOk(maker, tok)) continue;
    const before = t.slice(Math.max(0, m.index - 24), m.index + (m[0].length - m[1].length));
    if (NON_REF_LABEL.test(before)) continue;
    if (maker === 'omega') { const [c, ...g] = tok.split('.'); return dottedKey(c, '.' + g.join('.')); }
    return tok;
  }
  return null;
}

function modelLine(t: string, maker: string | undefined): string | null {
  const m = fold(t).match(WATCH_MODELS);
  if (!m) return null;
  const k = modelKeyOf(m[1]);
  if (maker && WATCH_MAKERS.has(maker) && !MAKER_LINES[maker].has(k)) {
    // first hit belongs to another brand: look for one of this maker's own
    const all = fold(t).match(new RegExp(WATCH_MODELS.source, 'g')) || [];
    for (const a of all) { const ak = modelKeyOf(a); if (MAKER_LINES[maker].has(ak)) return ak; }
    return null;
  }
  return k;
}

export type WatchKeyKind = 'ref' | 'model-name';

/* ── CORE REFERENCE + SUFFIX MATERIAL (Oct 6 2026 identity fix wave) ───────
   Patek Philippe and Audemars Piguet print the CASE MATERIAL as a reference
   suffix: Patek 5970J / 5970G / 5970R / 5970P (yellow / white / rose gold,
   platinum), 5711/1A (acier), 3970E / 3970EJ (second series, gold); AP
   15202ST / 15202BA / 15202OR (steel / yellow / rose gold). Keyed whole, one
   reference became up to eight keys — 6,593 Patek lots ($582M) sat outside
   their reference's main key — while the material axis the suffix carries
   was invisible to the material gate. The key is now the CORE reference and
   the suffix feeds the case-material reader (refSuffixMaterial, used by
   comps.coarseWatchMaterial when the text names no metal).
   Text glued onto a ref by the catalogue export ("ref 2509pink gold",
   "ref. 21612gold plated", "ref 5711plimited edition") is cut off. */
const PATEK_SUFFIX: Record<string, string> = { a: 'steel', j: 'gold', g: 'gold', r: 'gold', p: 'platinum', t: 'titanium' };
const AP_CODE: Record<string, string> = { st: 'steel', or: 'gold', ba: 'gold', bc: 'gold', og: 'gold', pt: 'platinum', ti: 'titanium', sa: 'two-tone', sr: 'two-tone' };
// English words / word heads a catalogue glued onto the ref's letter suffix
const GLUE = /^(?:pink|gold|rose|red|yel|yell|whit|white|stee|stai|sta|pla|plat|with|very|made|and|circ|blac|blue|silv|lady|tita|wris|auto|cir|ca|fac|lim|mvt|cas|case|pos|no)$/;
const GLUE_AHEAD = String.raw`(?=pink|gold|yellow|white|rose|red\b|steel|stainless|platinum|titanium|limited|factory|very|wrist|lady|automatic|circa|made|with|and\b|two)`;

function unglue(tok: string): string {
  const m = tok.match(/^([a-z]{0,3}\d[\d./-]*)([a-z]{2,})$/);
  // no maker's reference suffix runs past four letters (Rolex BLNR): a
  // longer run is a word ("2499possibly")
  return m && (GLUE.test(m[2]) || m[2].length > 4) ? m[1] : tok;
}

/** The core reference and the case material its suffix encodes. Only Patek
 *  Philippe and Audemars Piguet suffixes are material; other makers' keys
 *  pass through (Rolex 116610LN/LV are distinct models, not metals). */
export function splitWatchRef(maker: string | undefined, ref: string): { core: string; material: string | null } {
  const r = unglue(ref);
  if (maker === 'patek-philippe') {
    const m = r.match(/^(\d{2,5}(?:\/\d{1,4})?)e?([ajgrpt]?)(?:-\d{3})?$/);
    if (m) return { core: m[1], material: PATEK_SUFFIX[m[2]] ?? null };
  } else if (maker === 'audemars-piguet') {
    const m = r.match(/^([a-z]{2})?(\d{4,5})([a-z]{2})?(?![\d])/);
    if (m) return { core: m[2], material: AP_CODE[m[3] ?? m[1] ?? ''] ?? null };
  }
  return { core: r, material: null };
}

/** Case material a printed reference suffix encodes (Patek J/G/R/P/A, AP
 *  ST/BA/OR/BC/PT…), or null. */
export function refSuffixMaterial(title: string | null | undefined, maker: string | undefined): string | null {
  if (maker !== 'patek-philippe' && maker !== 'audemars-piguet') return null;
  const t = prep(title);
  const raw = labelled(t) ?? labelledLoose(t) ?? bare(t, maker);
  return raw ? splitWatchRef(maker, raw).material : null;
}

// lower-case, whitespace-folded, the Swiss thousands mark inside a number
// removed ("REF. 66'714BC" is 66714bc, not 66), and the typographic
// fraction slash a catalogue export prints read as "/" ("5711⁄110P" was cut
// to 5711 at the U+2044)
const prep = (s: string | null | undefined, ws = true) => {
  const t = (s || '').toLowerCase().replace(/(\d)['’](\d)/g, '$1$2').replace(/[⁄∕]/g, '/');
  return ws ? t.replace(/\s+/g, ' ') : t;
};

const canon = (maker: string | undefined, raw: string) => splitWatchRef(maker, raw).core;

/** The comp key: a labelled reference (core, material suffix dropped), else
 *  the model line. `maker` (the lot's artist slug) enables brand scoping of
 *  model lines and the suffix split; without it the generic list applies. */
export function readWatchKey(title: string | null | undefined, maker?: string): { key: string; kind: WatchKeyKind } | null {
  const t = prep(title, false);
  // the strict label, else (tracked makers) the loose label — a printed
  // "Calatrava, Ref: 96" is a reference, not the model line
  const r = (maker === 'omega' ? omegaUndotted(t.replace(/\s+/g, ' ')) : null) ?? labelled(t) ?? (maker && WATCH_MAKERS.has(maker) ? labelledLoose(t.replace(/\s+/g, ' '), maker) : null);
  if (r) return { key: canon(maker, r), kind: 'ref' };
  const m = modelLine(t, maker);
  if (m) return { key: m, kind: 'model-name' };
  return null;
}

/** Enrichment fallback for the five tracked makers: labelled ref, else a bare
 *  ref in the brand's distinctive shape, else the maker's own model line. */
export function readWatchReference(title: string | null | undefined, maker: string): string | null {
  if (!WATCH_MAKERS.has(maker)) return null;
  const t = prep(title);
  const r = (maker === 'omega' ? omegaUndotted(t) : null) ?? labelled(t) ?? labelledLoose(t) ?? bare(t, maker);
  if (r) return canon(maker, r);
  return modelLine(t, maker)
    ?? (maker === 'cartier' && /\bmust de cartier\b/.test(t) ? 'mustdecartier' : null)
    ?? (maker === 'rolex' && /\boysterdate\b/.test(t) ? 'oysterdate' : null);
}

/** A LABELLED reference in free text (the lot description) — the fallback
 *  when the title prints none (1,377 lots carry their ref only there). Bare
 *  numbers and model lines are not read from descriptions. */
export function readDescriptionReference(text: string | null | undefined, maker: string): string | null {
  if (!WATCH_MAKERS.has(maker) || !text) return null;
  const t = prep(text);
  const r = (maker === 'omega' ? omegaUndotted(t) : null) ?? labelled(t) ?? labelledLoose(t);
  return r && vetReference(maker, r, t) ? canon(maker, r) : null;
}

/** (Oct 6 2026, pricing wave 7) A house's STRUCTURED reference field — the
 *  Phillips maker API's `wReferenceNo` ("1680, repeated inside caseback",
 *  "26300ST.OO.1110ST.08", "5711/1A-011") — read as a labelled reference
 *  and keyed on its core like a title reference. The first line / clause
 *  only: a multi-watch field ("The first: 5912.30.22 … The second: …")
 *  reads nothing. */
export function readHouseReference(raw: string | null | undefined, maker: string): string | null {
  if (!raw || !WATCH_MAKERS.has(maker)) return null;
  const first = String(raw).split(/[\r\n;]/)[0].trim();
  if (!first || /^the (first|second|third)\b/i.test(first)) return null;
  return readDescriptionReference(`ref. ${first}`, maker);
}

// The enrichment's historical labelled reader (identity-enrich, pre-Sep-28):
// any "Ref" label, 2–6 digits with letter prefixes and hyphen/slash/dot suffix
// chains ("Ref: 55229B10", "Ref: OT 2364", "Ref: 96", "PK2990-1"). Oct 6: the
// token is read WHOLE — the old optional "\s?[a-z]{1,3}" tail took the next
// word's head ("1675 a" → 1675a, "3940 yellow" → 3940yel) and the fixed-width
// tail truncated long codes ("55229B10" → 55229b). Where it now feeds the
// COMP key (readWatchKey) its core length is vetted per maker — a 2-digit
// "Ref: 96" is a Patek reference, not a Rolex one; the enrichment fallback
// keeps reading what it always read.
const LOOSE = /r[eé]f(?:erence)?\.?\s*[:.,-]?\s*([a-z]{0,3}\s?\d{2,6}[a-z0-9]{0,12}(?:[\/.\-][a-z0-9]{1,10})*)(?![a-z0-9])/;
const LOOSE_GLUED = new RegExp(String.raw`r[eé]f(?:erence)?\.?\s*[:.,-]?\s*(\d{3,6}[a-z]{0,2})` + GLUE_AHEAD);
function labelledLoose(t: string, maker?: string): string | null {
  // the glued form first: "ref 5711plimited" must read 5711p, not the run
  const m = t.match(LOOSE_GLUED) ?? t.match(LOOSE);
  if (!m) return null;
  const k = unglue(m[1].trim().replace(/\s+/g, '').replace(/[.,;:]+$/, ''));
  if (!/\d{2,}/.test(k)) return null;
  return !maker || vetReference(maker, k) ? k : null;
}

/** Is a STORED/extracted reference plausibly a reference for this maker — not
 *  a movement / case serial, not a bare word? Used to vet references from the
 *  model extraction, which may quote any number that appears in the text. */
export function vetReference(maker: string, ref: string, title?: string | null): boolean {
  const r = ref.toLowerCase().replace(/\s+/g, '');
  if (!/\d/.test(r)) return false;
  const core = (r.match(/\d+/) || [''])[0];
  let ok: boolean;
  switch (maker) {
    case 'rolex': ok = core.length >= 4 && core.length <= 6; break;
    case 'patek-philippe': ok = core.length >= 2 && core.length <= 4; break;
    case 'audemars-piguet': ok = core.length >= 4 && core.length <= 5; break;
    case 'omega': ok = core.length >= 3 && core.length <= 5; break;
    case 'cartier': ok = /^(?:cr)?w/.test(r) || (core.length >= 4 && core.length <= 6); break;
    default: ok = true;
  }
  if (!ok || !title) return ok;
  // the number is printed right after a movement / case / serial label
  const t = title.toLowerCase().replace(/\s+/g, ' ');
  const at = t.indexOf(core);
  if (at < 0) return true;
  // a labelled "Ref" occurrence anywhere wins
  const lab = labelled(t);
  if (lab && lab.replace(/\D.*$/, '') === core) return true;
  return !NON_REF_LABEL.test(t.slice(Math.max(0, at - 24), at));
}
