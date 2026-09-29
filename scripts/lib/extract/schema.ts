/**
 * extract/schema.ts — the structured-output contract for field extraction and
 * the STRICT validator every model result passes before it is cached.
 *
 * Two layers of rejection:
 *   1. SHAPE (reject the whole record → null): wrong type, unknown key, missing
 *      key, out-of-enum value, malformed grade/year. The API's structured
 *      output should already guarantee shape; this is the belt to its braces
 *      (and the only guard on a replayed / hand-edited cache).
 *   2. GROUNDING (null the one field): every identity-bearing value must be
 *      READ from the lot's own text — a card number, reference, serial run,
 *      year, grade or player name that does not occur in title+description is
 *      a guess, and a guess never keys a comp. This is the no-leakage rule
 *      made mechanical: the model cannot contribute knowledge the lot's own
 *      text does not carry.
 */

export const VERTICALS = ['sports_card', 'pokemon_card', 'watch', 'other'] as const;
export const GRADERS = ['PSA', 'BGS', 'SGC', 'CGC', 'BVG', 'CSG', 'HGA', 'TAG', 'ISA', 'GMA', 'KSA', 'ACE'] as const;
export const QUALIFIERS = ['OC', 'MK', 'ST', 'PD', 'MC', 'OF'] as const;
export const LANGUAGES = ['english', 'japanese', 'korean', 'chinese', 'other'] as const;
export const EDITIONS = ['1st', 'shadowless', 'unlimited'] as const;
export const COMPLICATIONS = [
  'chronograph', 'split_seconds', 'perpetual_calendar', 'annual_calendar', 'moon_phase',
  'minute_repeater', 'tourbillon', 'gmt', 'world_time', 'date', 'day_date', 'alarm', 'skeleton',
] as const;
export const CONDITION_FLAGS = [
  'altered', 'trimmed', 'restored', 'recolored', 'crease', 'stain', 'writing', 'damaged',
  'missing_parts', 'reprint', 'replica', 'polished', 'service_parts', 'aftermarket', 'not_running',
] as const;

export interface Extraction {
  vertical: (typeof VERTICALS)[number];
  single_item: boolean;
  year: string | null;
  set: string | null;
  card_number: string | null;
  subject: string | null;
  parallel: string | null;
  serial_run: number | null;
  autograph: boolean;
  relic: boolean;
  rookie: boolean;
  grading_company: (typeof GRADERS)[number] | null;
  grade: string | null;
  grade_qualifier: (typeof QUALIFIERS)[number] | null;
  autograph_grade: string | null;
  language: (typeof LANGUAGES)[number] | null;
  edition: (typeof EDITIONS)[number] | null;
  brand: string | null;
  reference: string | null;
  material: string | null;
  complications: (typeof COMPLICATIONS)[number][];
  condition_flags: (typeof CONDITION_FLAGS)[number][];
}

const nstr = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const nenum = (vals: readonly string[]) => ({ anyOf: [{ type: 'string', enum: [...vals] }, { type: 'null' }] });

/** JSON Schema sent as output_config.format (structured outputs subset: no
 *  numeric/string constraints — those are enforced by validateExtraction). */
export const EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'vertical', 'single_item', 'year', 'set', 'card_number', 'subject', 'parallel', 'serial_run',
    'autograph', 'relic', 'rookie', 'grading_company', 'grade', 'grade_qualifier', 'autograph_grade',
    'language', 'edition', 'brand', 'reference', 'material', 'complications', 'condition_flags',
  ],
  properties: {
    vertical: { type: 'string', enum: [...VERTICALS] },
    single_item: { type: 'boolean' },
    year: nstr,
    set: nstr,
    card_number: nstr,
    subject: nstr,
    parallel: nstr,
    serial_run: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    autograph: { type: 'boolean' },
    relic: { type: 'boolean' },
    rookie: { type: 'boolean' },
    grading_company: nenum(GRADERS),
    grade: nstr,
    grade_qualifier: nenum(QUALIFIERS),
    autograph_grade: nstr,
    language: nenum(LANGUAGES),
    edition: nenum(EDITIONS),
    brand: nstr,
    reference: nstr,
    material: nstr,
    complications: { type: 'array', items: { type: 'string', enum: [...COMPLICATIONS] } },
    condition_flags: { type: 'array', items: { type: 'string', enum: [...CONDITION_FLAGS] } },
  },
};

const REQUIRED = EXTRACTION_SCHEMA.required as string[];
const GRADE_RE = /^(?:10|[1-9](?:\.5)?|A)$/;
const YEAR_RE = /^(?:1[89]\d{2}|20\d{2})(?:-(?:\d{2}|\d{4}))?$/;
const isStrOrNull = (v: unknown) => v === null || typeof v === 'string';
const inEnumOrNull = (v: unknown, vals: readonly string[]) => v === null || (typeof v === 'string' && vals.includes(v));

export type Rejection = { ok: false; reason: string };
export type Accepted = { ok: true; value: Extraction; grounded: string[] };

/** SHAPE check — any failure rejects the whole record. */
export function checkShape(raw: unknown): Rejection | { ok: true; value: Extraction } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not-object' };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!REQUIRED.includes(k)) return { ok: false, reason: `unknown-key:${k}` };
  for (const k of REQUIRED) if (!(k in o)) return { ok: false, reason: `missing-key:${k}` };
  if (!(VERTICALS as readonly string[]).includes(o.vertical as string)) return { ok: false, reason: 'vertical' };
  for (const k of ['single_item', 'autograph', 'relic', 'rookie']) if (typeof o[k] !== 'boolean') return { ok: false, reason: `bool:${k}` };
  for (const k of ['year', 'set', 'card_number', 'subject', 'parallel', 'grade', 'autograph_grade', 'brand', 'reference', 'material'])
    if (!isStrOrNull(o[k])) return { ok: false, reason: `str:${k}` };
  if (o.serial_run !== null && !(Number.isInteger(o.serial_run) && (o.serial_run as number) >= 1 && (o.serial_run as number) <= 100000))
    return { ok: false, reason: 'serial_run' };
  if (!inEnumOrNull(o.grading_company, GRADERS)) return { ok: false, reason: 'grading_company' };
  if (!inEnumOrNull(o.grade_qualifier, QUALIFIERS)) return { ok: false, reason: 'grade_qualifier' };
  if (!inEnumOrNull(o.language, LANGUAGES)) return { ok: false, reason: 'language' };
  if (!inEnumOrNull(o.edition, EDITIONS)) return { ok: false, reason: 'edition' };
  for (const [k, vals] of [['complications', COMPLICATIONS], ['condition_flags', CONDITION_FLAGS]] as const) {
    const a = o[k];
    if (!Array.isArray(a) || a.length > vals.length || a.some(x => typeof x !== 'string' || !(vals as readonly string[]).includes(x)))
      return { ok: false, reason: k };
  }
  if (o.grade !== null && !GRADE_RE.test(o.grade as string)) return { ok: false, reason: 'grade-format' };
  if (o.autograph_grade !== null && !GRADE_RE.test(o.autograph_grade as string)) return { ok: false, reason: 'autograph_grade-format' };
  if (o.year !== null && !YEAR_RE.test(o.year as string)) return { ok: false, reason: 'year-format' };
  for (const k of ['set', 'card_number', 'subject', 'parallel', 'brand', 'reference', 'material'])
    if (typeof o[k] === 'string' && ((o[k] as string).length > 120 || !(o[k] as string).trim())) return { ok: false, reason: `len:${k}` };
  // a grade without a company (or vice versa for a numeric grade) is incoherent
  if (o.grade !== null && o.grading_company === null) return { ok: false, reason: 'grade-without-company' };
  return { ok: true, value: { ...(o as unknown as Extraction), complications: [...(o.complications as never[])], condition_flags: [...(o.condition_flags as never[])] } };
}

// ── grounding ────────────────────────────────────────────────────────────────
const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const alnum = (s: string): string => fold(s).replace(/[^a-z0-9]+/g, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** SGC's legacy 100-point scale, as printed on pre-2020 slabs. */
const SGC_LEGACY: Record<string, string> = {
  '100': '10', '98': '10', '96': '9', '92': '8.5', '88': '8', '86': '7.5', '84': '7', '80': '6',
  '70': '5.5', '60': '5', '55': '4.5', '50': '4', '45': '3.5', '40': '3', '35': '2.5', '30': '2', '20': '1.5', '10': '1',
};
const GRADER_ALIASES: Record<string, RegExp> = {
  PSA: /\bpsa\b/i, BGS: /\b(?:bgs|beckett)\b/i, BVG: /\b(?:bvg|beckett)\b/i, SGC: /\bsgc\b/i, CGC: /\bcgc\b/i,
  CSG: /\bcsg\b/i, HGA: /\bhga\b/i, TAG: /\btag\b/i, ISA: /\bisa\b/i, GMA: /\bgma\b/i, KSA: /\bksa\b/i, ACE: /\bace\b/i,
};

/** A token-bounded occurrence of `needle` in `hay` (both folded). */
function hasToken(hay: string, needle: string): boolean {
  const n = fold(needle).trim();
  if (!n) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRe(n)}(?![a-z0-9])`).test(hay);
}

/** GROUNDING — null every identity field the lot's own text does not carry.
 *  Returns the grounded record plus the list of fields it nulled. */
export function ground(x: Extraction, text: string): { value: Extraction; nulled: string[] } {
  const hay = fold(text);
  const flat = alnum(text);
  const v: Extraction = { ...x };
  const nulled: string[] = [];
  const kill = (k: keyof Extraction) => { if (v[k] !== null) { (v as unknown as Record<string, unknown>)[k] = null; nulled.push(k); } };

  if (v.year) {
    const y4 = v.year.slice(0, 4);
    // "1996-97", "'96" and "96 Topps" all attest 1996
    if (!hasToken(hay, y4) && !hasToken(hay, v.year) && !new RegExp(`(?:^|[^0-9])'?${y4.slice(2)}(?![0-9])`).test(hay)) kill('year');
  }
  if (v.card_number) {
    const cn = v.card_number.replace(/^#/, '');
    if (!hasToken(hay, cn) && !hasToken(hay, `#${cn}`) && !hasToken(hay, cn.replace(/^0+(?=\d)/, ''))) kill('card_number');
  }
  if (v.reference) {
    const r = alnum(v.reference);
    if (r.length < 3 || !flat.includes(r) || !/\d/.test(r)) kill('reference');
  }
  if (v.serial_run !== null && !new RegExp(`/\\s*0*${v.serial_run}(?![0-9])`).test(hay)
      && !(v.serial_run === 1 && /\b(?:1\/1|one of one)\b/.test(hay))) {
    v.serial_run = null; nulled.push('serial_run');
  }
  if (v.subject) {
    const words = fold(v.subject).split(/[^a-z0-9']+/).filter(w => w.length >= 2);
    if (!words.length || words.some(w => !hay.includes(w))) kill('subject');
  }
  if (v.grading_company && !GRADER_ALIASES[v.grading_company].test(text)) {
    v.grading_company = null; nulled.push('grading_company');
    if (v.grade !== null) { v.grade = null; nulled.push('grade'); }
    if (v.grade_qualifier !== null) { v.grade_qualifier = null; nulled.push('grade_qualifier'); }
  }
  if (v.grade && v.grade !== 'A') {
    const legacy = v.grading_company === 'SGC'
      ? Object.entries(SGC_LEGACY).filter(([, g]) => g === v.grade).map(([n]) => n) : [];
    if (!hasToken(hay, v.grade) && !legacy.some(n => hasToken(hay, n))) {
      v.grade = null; nulled.push('grade');
    }
  }
  if (v.grade === 'A' && !/\b(?:authentic|auth|altered)\b/i.test(text)) { v.grade = null; nulled.push('grade'); }
  if (v.grade === null && v.grade_qualifier !== null) { v.grade_qualifier = null; nulled.push('grade_qualifier'); }
  if (v.autograph_grade && v.autograph_grade !== 'A' && !hasToken(hay, v.autograph_grade)) kill('autograph_grade');
  if (v.brand && !fold(v.brand).split(/[^a-z0-9]+/).filter(Boolean).every(w => hay.includes(w))) kill('brand');
  return { value: v, nulled };
}

/** SHAPE + GROUNDING. A shape failure rejects (null); grounding nulls fields. */
export function validateExtraction(raw: unknown, text: string): Accepted | Rejection {
  const s = checkShape(raw);
  if (!s.ok) return s;
  const g = ground(s.value, text);
  return { ok: true, value: g.value, grounded: g.nulled };
}

/** The lot text the model sees AND the hash covers — title + description. */
export function lotText(l: { title?: unknown; description?: unknown }): { title: string; description: string } {
  return { title: String(l.title ?? ''), description: String(l.description ?? '') };
}

// ── same-object pair check ───────────────────────────────────────────────────
export interface SameVerdict { same: boolean | null; reason: string }
export const SAME_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['same', 'reason'],
  properties: {
    same: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
    reason: { type: 'string' },
  },
};
export function validateSame(raw: unknown): SameVerdict | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 2 || !('same' in o) || !('reason' in o)) return null;
  if (!(o.same === null || typeof o.same === 'boolean')) return null;
  if (typeof o.reason !== 'string' || o.reason.length > 400) return null;
  return { same: o.same as boolean | null, reason: o.reason };
}
