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

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const modelKeyOf = (m: string) => fold(m).replace(/[-~ ]/g, '');

// "ref" / "réf" / "reference" / "référence", then . : , or whitespace, then an
// optional "no." — then the ref token in the pre-Sep-28 shape (so every key the
// old reader produced is produced unchanged; only forms it MISSED are added).
// No leading \b: concatenated catalogue fields glue the label to the previous
// word ("…wristwatchRef. 3215", "…dateRef: 77113") and the old reader then
// fell through to the CASE number. The separator + digit requirement keeps
// words that merely contain "ref" (refined, reflector) out.
const LABEL = String.raw`r[eé]f(?:[eé]rence)?(?:\s*[.:,]\s*|\s*)(?:(?:no|nr|n°)\.?\s*)?`;
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
function dottedKey(core: string, dots: string): string {
  if (core.length !== 3) return core;
  const g = dots.split('.').filter(Boolean);
  return [core, ...g.slice(0, g.length >= 4 ? 3 : 1)].join('.');
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

/** The comp key: a labelled reference, else the model line. `maker` (the lot's
 *  artist slug) enables brand scoping of model lines; without it the generic
 *  list applies. */
export function readWatchKey(title: string | null | undefined, maker?: string): { key: string; kind: WatchKeyKind } | null {
  const t = (title || '').toLowerCase();
  const r = labelled(t);
  if (r) return { key: r, kind: 'ref' };
  const m = modelLine(t, maker);
  if (m) return { key: m, kind: 'model-name' };
  return null;
}

/** Enrichment fallback for the five tracked makers: labelled ref, else a bare
 *  ref in the brand's distinctive shape, else the maker's own model line. */
export function readWatchReference(title: string | null | undefined, maker: string): string | null {
  if (!WATCH_MAKERS.has(maker)) return null;
  const t = (title || '').toLowerCase().replace(/\s+/g, ' ');
  return labelled(t) ?? labelledLoose(t) ?? bare(t, maker) ?? modelLine(t, maker)
    ?? (maker === 'cartier' && /\bmust de cartier\b/.test(t) ? 'mustdecartier' : null)
    ?? (maker === 'rolex' && /\boysterdate\b/.test(t) ? 'oysterdate' : null);
}

// The enrichment's historical labelled reader (identity-enrich, pre-Sep-28):
// any "Ref" label, 2–6 digits with letter prefixes and hyphen/slash/dot suffix
// chains ("Ref: 55229B10", "Ref: OT 2364", "Ref: 96", "PK2990-1"). Only
// consulted when the strict comp-key shape reads nothing, so its keys are the
// ones those rows already carried.
const LOOSE = /r[eé]f(?:erence)?\.?\s*[:.,-]?\s*([a-z]{0,3}\s?\d{2,6}(?:[\/.\-][a-z0-9]{1,10})*(?:\s?[a-z]{1,3})?)/;
function labelledLoose(t: string): string | null {
  const m = t.match(LOOSE);
  if (!m) return null;
  const k = m[1].trim().replace(/\s+/g, '').replace(/[.,;:]+$/, '');
  return /\d{2,}/.test(k) ? k : null;
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
