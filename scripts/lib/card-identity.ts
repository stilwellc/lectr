import type { AuctionLot } from '../../app/types';

/**
 * card-identity.ts — extract the grading identity of a sports-card lot.
 *
 * WHY: a graded card's (grader + cert number) is a globally-unique object ID —
 * the key that lets us stitch the same physical card across two sales (a
 * repeat-sale pair) and build a grade-controlled price ladder. This module
 * pulls the grader, the numeric grade, the raw grade label, and — when present
 * — the grading company's cert/serial number out of an AuctionLot.
 *
 * Parses from the title (Goldin/Christie's card titles carry the grade as a
 * trailing "… - PSA GEM MT 10" segment) plus, defensively, the retained raw
 * description and any pre-parsed grade fields. It is deliberately read-only and
 * side-effect free.
 *
 * HONEST LIMITATION (validated against public/data/ray/*.json): the current
 * corpus does NOT carry grading-company cert numbers anywhere — not in the
 * title, not in a cert field, not in the description (which is absent on card
 * lots). The `#12345` tokens in titles are the card's SET number, and the
 * `(#04/15)` tokens are the print serial ("04 of 15") — neither is a grader
 * cert. So `certNo` extraction is future-ready but will return null on today's
 * data. When a cert becomes available (a `cert`/`certNumber`/`certNo` field, or
 * an explicit "Cert #NNNNNNNN" in the title), it is picked up automatically.
 */

export type Grader = 'PSA' | 'SGC' | 'BGS' | 'CGC';

export interface CardIdentity {
  grader: Grader | null;
  grade: number | null;
  gradeLabel: string | null;
  certNo: string | null;
}

/**
 * Grader token → canonical grader. Beckett's family (BGS/BVG/Beckett) all
 * collapse to 'BGS'; PSA/DNA (the autograph-authentication arm) collapses to
 * 'PSA'; CSG (Certified Sports Guaranty) is the CGC sports brand → 'CGC'.
 * Tokens outside the four canonical graders (HGA/GMA/KSA/GAI/BCCG) are treated
 * as "not one of the four" and yield grader = null (but we still try the grade).
 */
const GRADER_ALIASES: Array<[RegExp, Grader]> = [
  [/\bPSA\/DNA\b/i, 'PSA'],
  [/\bPSA\b/i, 'PSA'],
  [/\bSGC\b/i, 'SGC'],
  [/\bBGS\b/i, 'BGS'],
  [/\bBVG\b/i, 'BGS'],
  [/\bBeckett\b/i, 'BGS'],
  [/\bCGC\b/i, 'CGC'],
  [/\bCSG\b/i, 'CGC'],
];

/**
 * Word-grade → numeric grade. Card grading uses a 1–10 scale with named tiers.
 * Longest / most-specific keys must be tried first (e.g. "GEM MT" before "MT",
 * "NM-MT" before "NM"), so this array is ordered by descending specificity and
 * matched in order. A trailing "+" in the label (NM-MT+, EX+) is a half-step up
 * but the printed NUMBER after it is authoritative, so we key on the number and
 * only use the word map when no number is present.
 */
const WORD_GRADE: Array<[RegExp, number]> = [
  [/\bGEM\s*[- ]?\s*MINT\b/i, 10],
  [/\bGEM\s*[- ]?\s*MT\b/i, 10],
  [/\bPRISTINE\b/i, 10],
  [/\bMINT\b/i, 9],
  [/\bNM\s*[- ]?\s*MT\b/i, 8],
  [/\bMT\b/i, 9],
  [/\bNM\b/i, 7],
  [/\bEX\s*[- ]?\s*MT\b/i, 6],
  [/\bEX\s*[- ]?\s*NM\b/i, 6],
  [/\bEX\b/i, 5],
  [/\bVG\s*[- ]?\s*EX\b/i, 4],
  [/\bVG\b/i, 3],
  [/\bGOOD\b/i, 2],
  [/\bGD\b/i, 2],
  [/\bFR\b/i, 1.5],
  [/\bPR\b/i, 1],
  [/\bPOOR\b/i, 1],
];

/**
 * Non-numeric grade designations that are legitimate labels but carry NO number
 * on the 1–10 scale (a slabbed-but-ungraded holder, or an authentication-only
 * pass). We return the label but grade = null.
 */
const NON_NUMERIC_LABEL = /\b(AUTHENTIC|AUTH|PRE-?CERT|STICKER|LOA|COA)\b/i;

const ALL_GRADER_TOKENS =
  /\b(PSA\/DNA|PSA|SGC|BGS|BVG|BCCG|CGC|CSG|Beckett|HGA|GMA|KSA|GAI)\b/i;

/** Map a matched grader token to a canonical grader, or null if unsupported. */
function canonicalGrader(token: string): Grader | null {
  for (const [re, g] of GRADER_ALIASES) if (re.test(token)) return g;
  return null;
}

/**
 * Pull the numeric grade from a label segment. Handles "10", "9.5", "8",
 * "NM-MT+ 8.5" (number wins), and bare word grades ("Authentic" → null number).
 * Guards against grabbing an unrelated number: only accepts a value in [0.5, 10]
 * printed at/after the grade words, and prefers a decimal (9.5) over an int.
 */
function extractGradeNumber(seg: string): number | null {
  // A grade number: 1–2 digits, optional ".5" or ".0", not part of a longer run.
  // Anchor to the END of the segment where the printed grade lives, so we don't
  // pick up a set number that leaked in.
  const re = /(?:^|[^\d.])(10|[0-9])(?:\.(?:0|5))?(?![\d.])/g;
  const nums: number[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(seg)) !== null) {
    const raw = mm[0].replace(/^[^\d]*/, '');
    const n = parseFloat(raw);
    if (n >= 0.5 && n <= 10) nums.push(n);
  }
  if (nums.length) {
    // The grade is the LAST plausible number in the label segment (labels read
    // "GEM MT 10"); population/qualifier numbers are stripped before this call.
    return nums[nums.length - 1];
  }
  return null;
}

/**
 * Isolate the grade-label segment: everything from the (first) grader token to
 * the end of that clause. Card titles put the grade last, e.g.
 *   "… Rookie Card (#04/15) - PSA GEM MT 10"
 *   "… Signed Card - BGS NM-MT+ 8.5, Beckett 10 - Pop 1"
 * We cut at the first grader, then trim at a comma (the second grade is the
 * AUTOGRAPH/relic grade, not the card grade) and drop a trailing " - Pop N" /
 * " - Only N …" census tail.
 */
function graderSegment(text: string): { grader: string; label: string } | null {
  const m = text.match(ALL_GRADER_TOKENS);
  if (!m || m.index === undefined) return null;
  let seg = text.slice(m.index);
  // Drop a trailing census / population / qualifier tail that starts a new
  // clause with " - " or " – " (em dash): "… 10 - Pop 1", "… 10 - Only 3 Higher".
  seg = seg.replace(/\s*[-–]\s*(Pop|Only|Population|True Gem|Census)\b.*$/i, '');
  // The card grade is the first clause; a comma introduces the auto/relic grade.
  const comma = seg.indexOf(',');
  const firstClause = comma >= 0 ? seg.slice(0, comma) : seg;
  const label = firstClause
    .replace(ALL_GRADER_TOKENS, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { grader: m[0], label };
}

/**
 * Try to find a grading-company cert number. Sources, in order of trust:
 *   1) a structured cert field on the lot (cert / certNumber / certNo /
 *      gradeCert / certificationNumber) — none exist in today's corpus, but
 *      picked up automatically if a future crawl adds one.
 *   2) an explicit "Cert #NNNNNNNN" / "Certification NNNNNNNN" in title/desc.
 * Deliberately does NOT treat a bare "#12345" (card set number) or "(#04/15)"
 * (print serial) as a cert — those are not unique object IDs.
 */
function extractCertNo(lot: AuctionLot, text: string): string | null {
  const rec = lot as unknown as Record<string, unknown>;
  for (const key of [
    'cert',
    'certNo',
    'certNumber',
    'certificateNumber',
    'certificationNumber',
    'gradeCert',
  ]) {
    const v = rec[key];
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'string' && /\d{5,}/.test(v)) {
      const d = v.match(/\d{5,}/);
      if (d) return d[0];
    }
  }
  // A pre-parsed _card object (present on this corpus) never carries a cert, but
  // check for one defensively in case a future field is added there.
  const card = rec['_card'];
  if (card && typeof card === 'object') {
    const c = card as Record<string, unknown>;
    for (const key of ['cert', 'certNo', 'certNumber']) {
      const v = c[key];
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
      if (typeof v === 'string' && /\d{5,}/.test(v)) {
        const d = v.match(/\d{5,}/);
        if (d) return d[0];
      }
    }
  }
  // Explicitly-labelled cert in free text: "Cert #12345678", "Cert No 12345678",
  // "Certification: 12345678". Requires the word "cert" so we never mistake a
  // card/set number for a cert.
  const m = text.match(/\bcert(?:ification|ificate)?\.?\s*(?:no\.?|number|#|:)?\s*(\d{5,})\b/i);
  if (m) return m[1];
  return null;
}

/**
 * Parse the grading identity of a card lot. Returns all-null for a lot with no
 * recognizable grader/grade (raw/ungraded cards, sealed wax, memorabilia).
 */
export function parseCardIdentity(lot: AuctionLot): CardIdentity {
  const empty: CardIdentity = { grader: null, grade: null, gradeLabel: null, certNo: null };
  if (!lot || typeof lot.title !== 'string') return empty;

  // Text pool to parse over: title first (that's where the grade lives), then
  // the retained raw description if present (absent on card lots today).
  const desc = (lot as unknown as Record<string, unknown>)['description'];
  const text = lot.title + (typeof desc === 'string' ? ' ' + desc : '');

  const certNo = extractCertNo(lot, text);

  const seg = graderSegment(text);
  if (!seg) {
    // No grader token at all — still surface a cert if one somehow exists.
    return { ...empty, certNo };
  }

  const grader = canonicalGrader(seg.grader);
  const rawLabel = (seg.grader.trim() + (seg.label ? ' ' + seg.label : '')).trim();

  // Numeric grade: prefer the printed number in the label segment; fall back to
  // the word-grade map (Gem Mint → 10) when no number is printed.
  let grade = extractGradeNumber(seg.label);
  if (grade === null && !NON_NUMERIC_LABEL.test(seg.label)) {
    for (const [re, val] of WORD_GRADE) {
      if (re.test(seg.label)) {
        grade = val;
        break;
      }
    }
  }

  // Authentication-only / holder-only labels carry a label but no 1–10 grade.
  if (grade === null && NON_NUMERIC_LABEL.test(seg.label)) {
    return { grader, grade: null, gradeLabel: rawLabel, certNo };
  }

  return {
    grader,
    grade,
    gradeLabel: rawLabel || null,
    certNo,
  };
}

export default parseCardIdentity;
