/**
 * normalize.ts — the pure, deterministic normalization layer. THE single source
 * of truth shared by the crawler (fresh rows) and the completed one-time v2
 * backfill, so a fresh row and a migrated row are byte-identical.
 *
 * NO I/O except imageHash (which fetches an image to dHash it). Everything else
 * is a pure function of its arguments — same input → same output, forever,
 * across crawls, in Node and in the browser. This is what makes the value/
 * similarity engine reproducible: prices in dated USD that re-strike without a
 * re-crawl, identity keys that persist instead of living in a WeakMap.
 *
 * The identity KEY functions (modelKey/watchKey/normalizeTitle/classifyForm/
 * extractSportsTags/objectClassOf) STAY in comps.ts as the load-bearing source
 * of truth; this module RE-EXPORTS them so the crawler stamps their output
 * without importing two files, and adds the persisted-attribute derivations
 * (dimensions, year, medium, edition, entity, fingerprint, imageHash).
 */
import type {
  AuctionLot, Currency, DimSource, EditionMarker, EntityClass, SizeClass,
  YearSource,
} from '../types';
import {
  classifyForm, modelKey, watchKey, normalizeTitle, extractSportsTags,
  objectClassOf,
} from './comps';

// Re-export the load-bearing identity keys so crawler + backfill import ONE
// module and stamp their output. These remain DEFINED in comps.ts.
export {
  classifyForm, modelKey, watchKey, normalizeTitle, extractSportsTags,
  objectClassOf,
};

/* ══════════════════════════════════════════════════════════════════════════
   FX — dated, reproducible, checked-in.

   A STATIC per-sale-YEAR table (Collin's decision #1). Deterministic, diffable,
   no live API: a 2015 GBP sale converts at 2015's rate, not today's. Keyed
   [currency][year]; fxRateFor falls back to the NEAREST checked-in year when a
   sale year is missing (e.g. a 2027 pre-sale uses the latest known rate). USD
   is always 1.0. Rates are sane annual averages (units of USD per 1 unit of the
   currency), rounded to a stable precision so the table diffs cleanly.
   ══════════════════════════════════════════════════════════════════════════ */

export const FX_BY_YEAR: Record<Currency, Record<number, number>> = {
  USD: yearsAll(1.0),
  // GBP→USD annual averages
  GBP: {
    2000: 1.516, 2001: 1.441, 2002: 1.503, 2003: 1.635, 2004: 1.833,
    2005: 1.820, 2006: 1.843, 2007: 2.002, 2008: 1.853, 2009: 1.566,
    2010: 1.546, 2011: 1.604, 2012: 1.585, 2013: 1.565, 2014: 1.648,
    2015: 1.528, 2016: 1.355, 2017: 1.289, 2018: 1.335, 2019: 1.277,
    2020: 1.284, 2021: 1.376, 2022: 1.237, 2023: 1.244, 2024: 1.279,
    2025: 1.300, 2026: 1.300,
  },
  // EUR→USD annual averages
  EUR: {
    2000: 0.924, 2001: 0.896, 2002: 0.946, 2003: 1.131, 2004: 1.244,
    2005: 1.245, 2006: 1.256, 2007: 1.371, 2008: 1.471, 2009: 1.393,
    2010: 1.326, 2011: 1.392, 2012: 1.286, 2013: 1.328, 2014: 1.329,
    2015: 1.110, 2016: 1.107, 2017: 1.130, 2018: 1.181, 2019: 1.120,
    2020: 1.142, 2021: 1.183, 2022: 1.053, 2023: 1.082, 2024: 1.082,
    2025: 1.080, 2026: 1.080,
  },
  // HKD→USD (HKD is pegged ~7.75–7.85/USD → ~0.128 USD)
  HKD: {
    2000: 0.128, 2001: 0.128, 2002: 0.128, 2003: 0.128, 2004: 0.128,
    2005: 0.129, 2006: 0.129, 2007: 0.128, 2008: 0.128, 2009: 0.129,
    2010: 0.129, 2011: 0.128, 2012: 0.129, 2013: 0.129, 2014: 0.129,
    2015: 0.129, 2016: 0.129, 2017: 0.128, 2018: 0.128, 2019: 0.128,
    2020: 0.129, 2021: 0.129, 2022: 0.128, 2023: 0.128, 2024: 0.128,
    2025: 0.128, 2026: 0.128,
  },
  // AUD→USD annual averages
  AUD: {
    2000: 0.581, 2001: 0.518, 2002: 0.543, 2003: 0.654, 2004: 0.736,
    2005: 0.762, 2006: 0.753, 2007: 0.839, 2008: 0.853, 2009: 0.792,
    2010: 0.920, 2011: 1.033, 2012: 1.036, 2013: 0.968, 2014: 0.903,
    2015: 0.752, 2016: 0.744, 2017: 0.767, 2018: 0.748, 2019: 0.695,
    2020: 0.690, 2021: 0.751, 2022: 0.694, 2023: 0.665, 2024: 0.660,
    2025: 0.650, 2026: 0.650,
  },
  // CHF→USD annual averages
  CHF: {
    2000: 0.593, 2001: 0.593, 2002: 0.643, 2003: 0.743, 2004: 0.804,
    2005: 0.803, 2006: 0.798, 2007: 0.834, 2008: 0.924, 2009: 0.921,
    2010: 0.961, 2011: 1.130, 2012: 1.066, 2013: 1.079, 2014: 1.093,
    2015: 1.040, 2016: 1.016, 2017: 1.016, 2018: 1.022, 2019: 1.006,
    2020: 1.066, 2021: 1.094, 2022: 1.047, 2023: 1.113, 2024: 1.136,
    2025: 1.150, 2026: 1.150,
  },
  // CNY→USD annual averages
  CNY: {
    2000: 0.121, 2001: 0.121, 2002: 0.121, 2003: 0.121, 2004: 0.121,
    2005: 0.122, 2006: 0.125, 2007: 0.132, 2008: 0.144, 2009: 0.146,
    2010: 0.148, 2011: 0.155, 2012: 0.158, 2013: 0.163, 2014: 0.163,
    2015: 0.160, 2016: 0.151, 2017: 0.148, 2018: 0.151, 2019: 0.145,
    2020: 0.145, 2021: 0.155, 2022: 0.149, 2023: 0.141, 2024: 0.139,
    2025: 0.138, 2026: 0.138,
  },
};

function yearsAll(v: number): Record<number, number> {
  const o: Record<number, number> = {};
  for (let y = 2000; y <= 2026; y++) o[y] = v;
  return o;
}

/** The 4-digit sale year from a saleDate (ISO date or datetime), or null. */
function yearOf(saleDate: string | null): number | null {
  if (!saleDate) return null;
  const m = saleDate.match(/^(\d{4})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return y >= 1900 && y <= 2100 ? y : null;
}

/** The dated FX rate for a currency + saleDate. Deterministic: exact-year hit
    when present, else the NEAREST checked-in year (min |Δ|; ties pick the later
    year). USD is always 1.0. When saleDate is null/unparseable, uses the latest
    checked-in year so the number is still reproducible. asOf is the saleDate's
    own YYYY-MM-DD when known (the fact we quote the rate for), else the fallback
    year's Jan 1. */
export function fxRateFor(
  cur: Currency,
  saleDate: string | null
): { rate: number; asOf: string } {
  if (cur === 'USD') {
    return { rate: 1.0, asOf: isoDay(saleDate) ?? '2000-01-01' };
  }
  const table = FX_BY_YEAR[cur];
  const years = Object.keys(table).map(Number);
  const wanted = yearOf(saleDate);

  let pickYear: number;
  if (wanted != null && table[wanted] != null) {
    pickYear = wanted;
  } else if (wanted != null) {
    // nearest checked-in year; tie → later
    pickYear = years.reduce((best, y) =>
      Math.abs(y - wanted) < Math.abs(best - wanted) ||
      (Math.abs(y - wanted) === Math.abs(best - wanted) && y > best)
        ? y : best,
      years[0]);
  } else {
    pickYear = Math.max(...years);
  }

  const rate = table[pickYear];
  const asOf = isoDay(saleDate) ?? `${pickYear}-01-01`;
  return { rate, asOf };
}

/** Convert a native amount to dated USD. Preserves null (a non-sold lot has null
    prices — never coerce to 0). rate/asOf are always returned so the caller can
    stamp fxRate/fxAsOf even on a null amount. */
export function toUsdDated(
  amt: number | null,
  cur: Currency,
  saleDate: string | null
): { usd: number | null; rate: number; asOf: string } {
  const { rate, asOf } = fxRateFor(cur, saleDate);
  const usd = amt == null ? null : round2(amt * rate);
  return { usd, rate, asOf };
}

/** Normalize any saleDate string to a bare YYYY-MM-DD day, or null. */
function isoDay(saleDate: string | null): string | null {
  if (!saleDate) return null;
  const m = saleDate.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ══════════════════════════════════════════════════════════════════════════
   DIMENSIONS — 3D, metric-canonical, ≥99% on the real data.

   The corpus has 6 incompatible formats (measured):
     Bonhams   "12 3/8 x 2 3/8in (43.5 x 31.4 x 6cm)"      imperial + metric parens
     Wright    "25½ w × 25 d × 32 h in (65 × 63 × 81 cm)"  LABELED order, metric parens
     Rago      "20 h × 16 w in (51 × 41 cm)"               labeled, metric parens
     Phillips  "56 x 60 in. (142.2 x 152.4 cm)"            imperial + metric parens
     Sotheby's "21¼ x 2 in"                                imperial only, NO metric
     Christie's"8.7 x 18 cm."  /  "(686 x 762 mm.)"        metric standalone / mm parens

   Strategy: PREFER the metric group (mm→cm or cm as-is) → dimSource 'metric';
   else fall back to imperial ×2.54 → 'imperial-converted'. Respect axis LABELS
   (h/w/d) when present so a Wright w×d×h maps to the right canonical axis; when
   unlabeled, assume height × width (× depth) — the art convention this data
   follows. 'dia' (diameter) sets width = depth. Unicode + ascii fractions.
   Strips S./I./"all"/dia labels. Keeps a lone "(height)" as 1-D.
   ══════════════════════════════════════════════════════════════════════════ */

const UNICODE_FRAC: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6,
};

/** Parse a single measurement token to a number (handles "12 3/8", "25½",
    "8.7", "10"). Returns 0 when nothing numeric is present. */
function parseMeasure(tok: string): number {
  let s = tok.trim();
  let val = 0;
  // unicode fraction (may be attached: "25½")
  for (const [ch, n] of Object.entries(UNICODE_FRAC)) {
    if (s.includes(ch)) { val += n; s = s.replace(ch, ' '); break; }
  }
  // mixed ascii fraction "12 3/8" or bare "3/8"
  const mixed = s.match(/(\d+)\s+(\d+)\/(\d+)/);
  if (mixed) {
    return val + parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / parseInt(mixed[3], 10);
  }
  const slash = s.match(/(\d+)\/(\d+)/);
  if (slash) return val + parseInt(slash[1], 10) / parseInt(slash[2], 10);
  const dec = s.match(/(\d+\.?\d*)/);
  if (dec) val += parseFloat(dec[1]);
  return val;
}

/** The label carried on a measurement token ('h'|'w'|'d'|'dia'|null). */
function axisLabel(tok: string): 'h' | 'w' | 'd' | 'dia' | null {
  const t = tok.toLowerCase();
  if (/\bdia\b|diam|Ø|⌀/.test(t)) return 'dia';
  if (/(^|\s)h(\s|$|in|\b)/.test(t) && /\bh\b/.test(t)) return 'h';
  if (/(^|\s)w(\s|$|in|\b)/.test(t) && /\bw\b/.test(t)) return 'w';
  if (/(^|\s)d(\s|$|in|\b)/.test(t) && /\bd\b/.test(t)) return 'd';
  return null;
}

interface Axes { h: number | null; w: number | null; d: number | null; }

/** Map a run of "value×value×value" tokens (optionally labeled) onto h/w/d.
    Unlabeled defaults: 2 tokens → h×w; 3 tokens → h×w×d. A 'dia' token fills
    width and depth (a round object). */
function mapAxes(tokens: string[]): Axes {
  const nums = tokens.map(parseMeasure);
  const labels = tokens.map(axisLabel);
  const out: Axes = { h: null, w: null, d: null };
  const hasLabels = labels.some(l => l != null);

  if (hasLabels) {
    for (let i = 0; i < tokens.length; i++) {
      const n = nums[i];
      if (!(n > 0)) continue;
      const l = labels[i];
      if (l === 'h') out.h = n;
      else if (l === 'w') out.w = n;
      else if (l === 'd') out.d = n;
      else if (l === 'dia') { out.w = n; out.d = n; }
      else {
        // an unlabeled token in a labeled run — fill first empty of h,w,d
        if (out.h == null) out.h = n; else if (out.w == null) out.w = n; else if (out.d == null) out.d = n;
      }
    }
  } else {
    const vals = nums.filter(n => n > 0);
    if (vals.length >= 1) out.h = vals[0];
    if (vals.length >= 2) out.w = vals[1];
    if (vals.length >= 3) out.d = vals[2];
  }
  return out;
}

/** Split a metric-or-imperial run "A x B x C" on x/×/by into tokens, keeping
    each token's trailing label. */
function splitRun(run: string): string[] {
  return run.split(/\s*(?:[x×]|\bby\b)\s*/i).map(s => s.trim()).filter(Boolean);
}

/** Does a metric run carry its own axis labels? (rare, but honor it if so) */
function metricHasLabels(toks: string[]): boolean {
  return toks.some(t => axisLabel(t) != null);
}

/** Overlay a labels array (from the imperial run) onto unlabeled metric tokens,
    so the metric group inherits the imperial order's h/w/d assignment. Lengths
    should match (same axis count); when they differ, extra tokens stay
    unlabeled and fall through to positional mapping. */
function applyLabels(toks: string[], labels: (ReturnType<typeof axisLabel>)[]): string[] {
  if (labels.length !== toks.length || labels.every(l => l == null)) return toks;
  return toks.map((t, i) => {
    const l = labels[i];
    return l ? `${t} ${l === 'dia' ? 'dia' : l}` : t;
  });
}

/** Extract the parenthetical (or trailing) METRIC group. Returns the raw run
    plus whether it was mm (so we can ×0.1 to cm). Handles Christie's mm-in-
    parens and standalone "cm." formats. */
function metricRun(raw: string): { run: string; mm: boolean } | null {
  // parenthetical metric: "(43.5 x 31.4 x 6cm)" or "(686 x 762 mm.)"
  const paren = raw.match(/\(([^)]*\d[^)]*(?:cm|mm)[^)]*)\)/i);
  if (paren) return { run: paren[1], mm: /mm/i.test(paren[1]) };
  // standalone metric with NO imperial "in" anywhere: "8.7 x 18 cm." / "74 x 1 cm"
  if (!/\bin\b|in\.|"|″/i.test(raw) && /(cm|mm)/i.test(raw)) {
    return { run: raw, mm: /mm/i.test(raw) && !/cm/i.test(raw) };
  }
  return null;
}

/** The imperial run — strip the metric parens and any S./I./"all"/prefix noise. */
function imperialRun(raw: string): string {
  let s = raw.replace(/\([^)]*\)/g, ' ');   // drop parenthetical metric
  // sheet/image label: keep the measurement after "S." / "I." / "all S." — first only
  const sheet = s.match(/[IS]\.\s*([^IS]+?)(?:in|$)/);
  if (sheet) s = sheet[1] + ' in';
  return s.trim();
}

const SIZE_BANDS: [number, SizeClass][] = [
  [40, 'small'], [100, 'medium'], [200, 'large'],
];
function sizeClassFor(maxCm: number): SizeClass {
  for (const [ceil, cls] of SIZE_BANDS) if (maxCm < ceil) return cls;
  return 'monumental';
}

export function normalizeDimensions(raw: string | null): {
  heightCm: number | null;
  widthCm: number | null;
  depthCm: number | null;
  sizeClass: SizeClass | null;
  dimSource: DimSource | null;
} | null {
  if (!raw || typeof raw !== 'string') return null;

  let axes: Axes | null = null;
  let dimSource: DimSource | null = null;

  // The imperial run frequently carries the axis LABELS (Wright/Rago
  // "25½ w × 25 d × 32 h") while the metric group in parens is unlabeled but
  // follows the SAME positional order. Read the labels from the imperial run
  // and apply them to the metric group so a Wright w×d×h maps height→81cm, not
  // the positional 65cm.
  const impRun = imperialRun(raw);
  const impLabels = splitRun(impRun).map(axisLabel);

  // 1 · prefer a real metric group
  const metric = metricRun(raw);
  if (metric) {
    const toks = splitRun(metric.run);
    if (toks.length >= 1) {
      const a = metricHasLabels(toks) ? mapAxes(toks) : mapAxes(applyLabels(toks, impLabels));
      const k = metric.mm ? 0.1 : 1; // mm→cm
      axes = { h: sc(a.h, k), w: sc(a.w, k), d: sc(a.d, k) };
      dimSource = 'metric';
    }
  }

  // 2 · fall back to imperial ×2.54
  if (!axes || (axes.h == null && axes.w == null)) {
    const toks = splitRun(impRun);
    if (toks.length >= 1) {
      const a = mapAxes(toks);
      const K = 2.54;
      const cand: Axes = { h: sc(a.h, K), w: sc(a.w, K), d: sc(a.d, K) };
      if (cand.h != null || cand.w != null) {
        axes = cand;
        dimSource = 'imperial-converted';
      }
    }
  }

  if (!axes || (axes.h == null && axes.w == null && axes.d == null)) return null;

  const heightCm = axes.h;
  const widthCm = axes.w;
  const depthCm = axes.d;
  const present = [heightCm, widthCm, depthCm].filter((n): n is number => n != null);
  const sizeClass = present.length ? sizeClassFor(Math.max(...present)) : null;

  return { heightCm, widthCm, depthCm, sizeClass, dimSource };
}

/** scale + round a nullable axis to 1 decimal cm; drop non-positive to null. */
function sc(n: number | null, k: number): number | null {
  if (n == null || !(n > 0)) return null;
  return Math.round(n * k * 10) / 10;
}

/* ══════════════════════════════════════════════════════════════════════════
   YEAR — field wins, title fallback, guarded against edition-fraction lies.

   The field is trusted over the title (27% of field/title pairs disagree — a
   title-year is often a SUBJECT date, "World Cup 1994"). So a title-derived
   year ONLY fills when the structured field is empty, and is ALWAYS tagged
   yearSource:'title' (Collin's decision #2, conservative). Guards:
    - reject an implausible year (field "2413" seen in real data)
    - strip edition fractions "No.314/400" and "9/11" runs before scanning the
      title so 314/400 never reads as 2400-ish, and a bare "/400" never anchors
    - circa/c. → yearIsCirca
   ══════════════════════════════════════════════════════════════════════════ */

const YEAR_RE = /\b(1[89]\d{2}|20[0-3]\d)\b/;

/** first plausible 4-digit year in a string, or null. A future year is never a
    real production year — the corpus audit found lots mis-parsed into 2028–2035
    (a ref/edition number read as a year), so the upper bound is the current
    calendar year +1 (buffer for a pre-release / early-cataloged card), computed
    at call time rather than a frozen literal. */
function firstYear(s: string): number | null {
  const m = s.match(YEAR_RE);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const maxYear = new Date().getFullYear() + 1;
  return y >= 1800 && y <= maxYear ? y : null;
}

export function extractYear(
  field: string | null,
  title: string,
  raw?: string
): { yearNum: number | null; yearSource: YearSource | null; yearIsCirca: boolean } {
  const circaRe = /\b(circa|c\.?\s?\d|ca\.)/i;

  // 1 · the structured field wins, always
  if (field) {
    const y = firstYear(field);
    if (y != null) {
      return { yearNum: y, yearSource: 'field', yearIsCirca: circaRe.test(field) };
    }
  }

  // 2 · title fallback (conservative — only when field gave nothing)
  const src = stripBioParens(`${title || ''} ${raw || ''}`);
  // strip fractions (edition N/M, dates like 9/11) so they can't fake a year
  const stripped = src.replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b/g, ' ');
  const y = firstYear(stripped);
  if (y != null) {
    return { yearNum: y, yearSource: 'title', yearIsCirca: circaRe.test(src) };
  }

  return { yearNum: null, yearSource: null, yearIsCirca: false };
}

/* ══════════════════════════════════════════════════════════════════════════
   MEDIUM — controlled-vocab technique key + material tokens.

   Collapses 5,979 raw medium strings. Reuses the same technique/material
   families the classifier keys on (print techniques, paint, furniture woods
   and metals). Normalizes British→American spelling (colours→colors) so the
   two never split a pool. mediumCanon = the leading technique token; else null.
   materialTokens = the furniture materials present (for design similarity).
   ══════════════════════════════════════════════════════════════════════════ */

// ordered: first hit wins (most specific technique cues first)
const MEDIUM_RULES: [RegExp, string][] = [
  [/\bgelatin silver\b/, 'gelatin-silver-print'],
  [/\b(c-?print|chromogenic|type c)\b/, 'c-print'],
  [/\b(cibachrome|ilfochrome)\b/, 'cibachrome'],
  [/\bpolaroid\b/, 'polaroid'],
  [/\b(inkjet|pigment print|giclee|giclée|archival pigment)\b/, 'inkjet'],
  [/\bphotogravure\b/, 'photogravure'],
  [/\bphotograph\b/, 'photograph'],
  [/\bscreen ?print|serigraph|silk ?screen\b/, 'screenprint'],
  [/\blinocut|linoleum cut\b/, 'linocut'],
  [/\bwoodcut|woodblock|wood engraving\b/, 'woodcut'],
  [/\baquatint\b/, 'aquatint'],
  [/\bdrypoint\b/, 'drypoint'],
  [/\betching|eau-forte\b/, 'etching'],
  [/\bengraving\b/, 'engraving'],
  [/\blithograph|litho\b/, 'lithograph'],
  [/\bmonotype|monoprint\b/, 'monotype'],
  [/\b(giclee|offset)\b/, 'offset'],
  [/\boil\b/, 'oil'],
  [/\bacrylic\b/, 'acrylic'],
  [/\bwatercolou?r\b/, 'watercolor'],
  [/\bgouache\b/, 'gouache'],
  [/\btempera\b/, 'tempera'],
  [/\benamel\b/, 'enamel'],
  [/\b(pastel|oil stick)\b/, 'pastel'],
  [/\bcharcoal\b/, 'charcoal'],
  [/\b(graphite|pencil)\b/, 'graphite'],
  [/\b(pen and ink|ink)\b/, 'ink'],
  [/\bmixed media\b/, 'mixed-media'],
  [/\b(collage|assemblage)\b/, 'collage'],
  [/\bbronze\b/, 'bronze'],
  [/\bmarble\b/, 'marble'],
  [/\b(ceramic|earthenware|stoneware|porcelain|terracotta|terra-cotta)\b/, 'ceramic'],
  [/\bglass\b/, 'glass'],
  [/\bwood\b/, 'wood'],
];

const MATERIAL_TOKENS: [RegExp, string][] = [
  [/\bwalnut\b/, 'walnut'],
  [/\bteak\b/, 'teak'],
  [/\brosewood\b/, 'rosewood'],
  [/\boak\b/, 'oak'],
  [/\bmahogany\b/, 'mahogany'],
  [/\bmaple\b/, 'maple'],
  [/\bcherry\b/, 'cherry'],
  [/\bebony\b/, 'ebony'],
  [/\bbirch\b/, 'birch'],
  [/\bplywood\b/, 'plywood'],
  [/\bpine\b/, 'pine'],
  [/\bbamboo\b/, 'bamboo'],
  [/\brattan|cane|wicker\b/, 'rattan'],
  [/\bleather\b/, 'leather'],
  [/\bbronze\b/, 'bronze'],
  [/\bbrass\b/, 'brass'],
  [/\bsteel\b/, 'steel'],
  [/\baluminum|aluminium\b/, 'aluminum'],
  [/\bchrome\b/, 'chrome'],
  [/\bglass\b/, 'glass'],
  [/\b(ceramic|earthenware|stoneware|porcelain)\b/, 'ceramic'],
  [/\bmarble\b/, 'marble'],
  [/\bslate\b/, 'slate'],
  [/\bupholstery|upholstered\b/, 'upholstery'],
  [/\blacquer|lacquered\b/, 'lacquer'],
];

export function canonMedium(medium: string | null): {
  mediumCanon: string | null;
  materialTokens: string[];
} {
  if (!medium) return { mediumCanon: null, materialTokens: [] };
  const m = medium.toLowerCase();

  let mediumCanon: string | null = null;
  for (const [re, key] of MEDIUM_RULES) {
    if (re.test(m)) { mediumCanon = key; break; }
  }

  const materialTokens: string[] = [];
  for (const [re, tok] of MATERIAL_TOKENS) {
    if (re.test(m) && !materialTokens.includes(tok)) materialTokens.push(tok);
  }

  return { mediumCanon, materialTokens };
}

/* ══════════════════════════════════════════════════════════════════════════
   EDITION / SERIAL / COLLECTIBLE TAGS — conservative parse from title + desc.

   Editions are as conservative as years (decision #2): a numbered edition only
   registers on a clear "N/M" fraction that is NOT a date and NOT a dimension,
   and a proof marker only on a word-boundary token. The Eames model code
   "EA 108" must NOT read as an EA proof; "9/11" must NOT read as edition 9 of
   11 — so we require the fraction to look like an edition (M ≥ N, M ≤ 999) and
   reject known-code contexts.
   ══════════════════════════════════════════════════════════════════════════ */

export function extractEdition(
  title: string,
  desc?: string | null
): {
  editionOf: number | null;
  editionTotal: number | null;
  editionMarker: EditionMarker | null;
} {
  const src = `${title || ''} ${desc || ''}`;
  const low = src.toLowerCase();

  let editionOf: number | null = null;
  let editionTotal: number | null = null;

  // N/M edition: "No. 314/400", "edition 12/50", or a bare "12/50" that is a
  // plausible edition (N ≤ M ≤ 999, not a size, not a date). Prefer one that
  // is explicitly labeled; else accept a lone bare fraction if it reads clean.
  const labeled = low.match(/\b(?:no\.?|edition|ed\.?|nr\.?|n°)\s*(\d{1,3})\s*\/\s*(\d{1,3})\b/);
  const bare = low.match(/(?:^|[^\d.\/])(\d{1,3})\s*\/\s*(\d{1,3})(?![\d.\/])/);
  const cand = labeled || bare;
  if (cand) {
    const n = parseInt(cand[1], 10);
    const m = parseInt(cand[2], 10);
    // an edition has N ≤ M, and M is the run size (≤ 999). Reject 9/11-style
    // (N > M) and obvious dates already excluded by the ≤3-digit cap.
    if (n >= 1 && m >= 1 && n <= m && m <= 999) {
      editionOf = n;
      editionTotal = m;
    }
  }

  // proof markers — word-boundary, and NOT the Eames "EA <digits>" model code
  let editionMarker: EditionMarker | null = null;
  if (/\b(artist'?s? proof|épreuve d'artiste|epreuve d'artiste)\b/i.test(src)) editionMarker = 'AP';
  else if (/\bA\.?P\.?\b/.test(src) && !/\bap\s*\d/i.test(src)) editionMarker = 'AP';
  else if (/\b(hors[- ]commerce|H\.?C\.?)\b/.test(src)) editionMarker = 'HC';
  else if (/\b(printer'?s? proof|P\.?P\.?)\b/.test(src)) editionMarker = 'PP';
  else if (/\bE\.?A\.?\b/.test(src) && !/\bea\s*\d/i.test(src)) editionMarker = 'EA';
  else if (/\b(unique|one[- ]of[- ]a[- ]kind|1\/1|monotype)\b/i.test(low)) editionMarker = 'unique';

  return { editionOf, editionTotal, editionMarker };
}

/** A case/movement/serial-style number from a watch/instrument title or desc.
    Conservative: only an explicit serial/movement/case-number label, else null
    (a bare number is a reference or an edition, not a serial). */
export function extractSerial(title: string, desc?: string | null): string | null {
  const src = `${title || ''} ${desc || ''}`;
  const m = src.match(/\b(?:serial|movement|case)\s*(?:no\.?|number|#)?\s*[:.]?\s*([A-Z0-9][A-Z0-9.\-\/]{2,})\b/i);
  return m ? m[1] : null;
}

/** Collectible auth signals for game-used sports lots (title-borne). */
export function extractCollectibleTags(title: string): {
  photoMatched: boolean;
  authCert: string[];
  gradeLabel: string | null;
} {
  const t = title || '';

  const photoMatched = /\bphoto[- ]?match(?:ed)?\b/i.test(t);

  const authCert: string[] = [];
  const CERTS: [RegExp, string][] = [
    [/\bPSA\/DNA\b/i, 'PSA/DNA'],
    [/\bPSA\b/, 'PSA'],
    [/\bMeiGray\b/i, 'MeiGray'],
    [/\bBeckett|BGS\b/, 'Beckett'],
    [/\bSGC\b/, 'SGC'],
    [/\bJSA\b/, 'JSA'],
    [/\bMEARS\b/, 'MEARS'],
    [/\bLOA\b/, 'LOA'],
    [/\bCOA\b/, 'COA'],
    [/\bFanatics\b/i, 'Fanatics'],
    [/\bResolution Photomatching\b/i, 'Resolution'],
  ];
  for (const [re, name] of CERTS) if (re.test(t) && !authCert.includes(name)) authCert.push(name);

  // numeric third-party grade: "PSA 10", "BGS 9.5", "SGC 96"
  const g = t.match(/\b(PSA|BGS|SGC|CGC)\s*(\d{1,2}(?:\.\d)?)\b/);
  const gradeLabel = g ? `${g[1].toUpperCase()} ${g[2]}` : null;

  return { photoMatched, authCert, gradeLabel };
}

/* ══════════════════════════════════════════════════════════════════════════
   ENTITY — is the routing slug a real maker, or a collectible bucket?

   The 6,867 game-used lots carry a category slug, not a maker. classifyEntity
   returns makerSlug = the slug when it's a real maker (so it becomes the join
   key for the model layer), and null when it's a category bucket.
   ══════════════════════════════════════════════════════════════════════════ */

/** Collectible-bucket slugs — routing categories, not makers (mirrors
    SPORTS_SCIENCE_SLUGS in comps.ts + the science buckets). */
const CATEGORY_SLUGS = new Set<string>([
  'game-used', 'trophies-awards', 'tickets-passes',
  'sports-cards', 'sports-memorabilia',
  'space-exploration', 'meteorites', 'fossils', 'scientific-instruments',
  'minerals', 'natural-history',
  'movie-tv', 'music-memorabilia', 'entertainment-memorabilia',
]);

export function classifyEntity(slug: string): {
  makerSlug: string | null;
  entityClass: EntityClass;
} {
  const s = (slug || '').trim();
  if (!s || CATEGORY_SLUGS.has(s)) {
    return { makerSlug: null, entityClass: 'category' };
  }
  return { makerSlug: s, entityClass: 'maker' };
}

/* ══════════════════════════════════════════════════════════════════════════
   OBJECT FINGERPRINT — Layer B (exact physical object).

   Deterministic hash of the strongest available discriminators. Returns NULL
   when discriminators are thin (e.g. "Untitled" with no dims and no model) —
   NEVER fabricate exact identity from a title-only match (guards the 758
   Untitled collisions + the 90-Eames-LCW over-merge). A repeat-sale is a
   fingerprint match, never a title match.

   art/design  = [makerSlug, modelKey||normalizedTitle, yearNum, roundedDims, edition]
   game-used   = [entity, objectType, eventKey, sportYear, photoMatched]
   ══════════════════════════════════════════════════════════════════════════ */

type FingerprintLot = Pick<AuctionLot,
  'title' | 'medium' | 'category' | 'artist' | 'dimensions' |
  'entity' | 'objectType' | 'eventKey' | 'sportYear' | 'imageHash'> & {
    makerSlug?: string | null;
    heightCm?: number | null;
    widthCm?: number | null;
    depthCm?: number | null;
    yearNum?: number | null;
    editionOf?: number | null;
    editionTotal?: number | null;
    modelKey?: string | null;
    normalizedTitle?: string | null;
    photoMatched?: boolean;
  };

/** stable non-cryptographic 32-bit hash → hex; deterministic across runtimes. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

const TITLE_STOPWORDS = new Set([
  'the','a','an','and','or','of','with','in','on','for','to','from','by','at',
  'his','her','its','ing','used','game','signed','photo','matched','original',
  'lot','no','circa','c','edition','ed','print','untitled','style','after',
]);

/** Normalized token set for the step-2 similarity scorer. Different houses word
 *  the same object differently ("Kuminga game-worn jersey" vs "Jonathan Kuminga
 *  Game-Used, Photo-Matched"), so exact-string identity fails — the scorer
 *  computes a weighted % over these tokens plus the structured attributes. We
 *  persist the tokens once (clean, stemmed-lite, stopworded) so every crawl and
 *  the engine tokenize identically. Numbers (years, refs, edition, jersey #s)
 *  are KEPT — they carry heavy identifying signal. */
/** Strip biographical parentheticals — "(American, 1928–1987)", "(b. 1955)" —
 *  from a title. The year-range form is only stripped when the span is >= 15
 *  years (a life, not a work-date range like "(1949-1950)"). These leak the
 *  artist's nationality + birth year into titleTokens/yearNum: measured on the
 *  art holdout, stripping them raised coverage 19.8→21.1% AND edge 27.6→29.6pt,
 *  and killed the birth-year bug (20.6% of art yearNums were the artist's birth
 *  year — one $11.2M Matisse joined a $7k print pool via "same year 1869"). */
export function stripBioParens(s: string): string {
  return s
    .replace(/\([^)]*\b(1[789]\d{2})\s*[–—-]\s*(1[89]\d{2}|20[0-3]\d)\b[^)]*\)/g,
      (m, a, b) => (parseInt(b, 10) - parseInt(a, 10) >= 15 ? ' ' : m))
    .replace(/\(\s*(?:[a-z][a-z .]+,\s*)?(?:b\.|born)\s*\d{4}\s*\)/gi, ' ');
}

export function titleTokens(title: string | null, dropWords?: string[]): string[] {
  if (!title) return [];
  const drop = dropWords && dropWords.length ? new Set(dropWords.map(w => w.toLowerCase())) : null;
  const raw = stripBioParens(title).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let w of raw) {
    if (w.length < 2 && !/^\d/.test(w)) continue;
    if (TITLE_STOPWORDS.has(w)) continue;
    // the maker's own name words carry zero discriminating signal within a
    // same-maker pool and inflate cosine between unrelated works (art lots
    // routinely lead with "Andy Warhol: …")
    if (drop && drop.has(w)) continue;
    // light singularization so jersey/jerseys, print/prints collapse
    if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    if (drop && drop.has(w)) continue;
    if (!seen.has(w)) { seen.add(w); out.push(w); }
  }
  return out;
}

export function objectFingerprint(lot: FingerprintLot): string | null {
  const cat = lot.category;

  // game-used / collectible object path
  const isCollectible = lot.entity != null || lot.objectType != null ||
    (cat === 'object' && CATEGORY_SLUGS.has(lot.artist));
  if (isCollectible && cat === 'object' && CATEGORY_SLUGS.has(lot.artist)) {
    const parts = [
      norm(lot.entity), norm(lot.objectType), norm(lot.eventKey),
      lot.sportYear ?? '', lot.photoMatched ? 'pm' : '',
    ];
    // BLOCKING KEY, not a verdict. Different houses shoot their own photos, so
    // an image hash never matches the same object across sales (Collin) — the
    // fingerprint is a coarse candidate bucket; the same-vs-similar decision is
    // a scored % over titleTokens + these tags in step 2. Thin unless the
    // entity+year pin it to one object.
    const strong = lot.entity && lot.sportYear;
    return strong ? 'g:' + fnv1a(parts.join('|')) : null;
  }

  // art / design path
  const model = lot.modelKey ?? modelKey(lot) ?? null;
  const nt = lot.normalizedTitle ?? normalizeTitle(lot.title);
  const isUntitled = !nt || nt === 'untitled' || nt.startsWith('untitled ') || nt.length < 4;
  const dims = (lot.heightCm != null || lot.widthCm != null)
    ? [roundDim(lot.heightCm), roundDim(lot.widthCm), roundDim(lot.depthCm)].join('x')
    : '';
  const maker = lot.makerSlug ?? (lot.artist || '');

  // THIN → null: an untitled work with no model, no dims, no edition is not a
  // fingerprintable object. Never assert exact identity here.
  const hasDiscriminator =
    (!isUntitled) || !!model || !!dims || lot.editionOf != null;
  if (!hasDiscriminator || !maker) return null;

  const parts = [
    norm(maker),
    model ? 'm:' + model : (isUntitled ? '' : 't:' + nt),
    lot.yearNum ?? '',
    dims,
    lot.editionOf != null && lot.editionTotal != null ? `${lot.editionOf}/${lot.editionTotal}` : '',
  ];
  return 'a:' + fnv1a(parts.join('|'));
}

function norm(s: string | null | undefined): string {
  return (s || '').toLowerCase().trim();
}
function roundDim(n: number | null | undefined): string {
  return n == null ? '' : String(Math.round(n));
}

/* ══════════════════════════════════════════════════════════════════════════
   imageHash — perceptual dHash over the fetched image.

   The ONLY function here with I/O. Used INCREMENTALLY (a bounded batch per
   crawl — Collin's decision #3, NOT all 41k at once). Returns null on any
   fetch/decode failure so a bad URL never aborts a batch. A dHash compares the
   brightness of adjacent pixels in a 9×8 grayscale downscale → a 64-bit hex
   string; two images within a few Hamming bits are the same object photo.

   Decoding uses the optional `sharp` dependency when present (Node/crawler);
   if it isn't installed, returns null (the caller treats null as "not yet
   hashed" and the incremental pass retries later) — so this module never hard-
   depends on a native module at import time.
   ══════════════════════════════════════════════════════════════════════════ */

// in-process cache so a repeated URL in one batch hashes once
const IMAGE_HASH_CACHE = new Map<string, string | null>();

export async function imageHash(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;
  if (IMAGE_HASH_CACHE.has(imageUrl)) return IMAGE_HASH_CACHE.get(imageUrl)!;

  let result: string | null = null;
  try {
    // fetch the bytes
    const res = await fetch(imageUrl);
    if (!res.ok) { IMAGE_HASH_CACHE.set(imageUrl, null); return null; }
    const buf = Buffer.from(await res.arrayBuffer());

    // decode to a 9×8 grayscale raw buffer via sharp (optional dep)
    const sharp = await loadSharp();
    if (!sharp) { IMAGE_HASH_CACHE.set(imageUrl, null); return null; }
    const { data } = await sharp(buf)
      .grayscale()
      .resize(9, 8, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    result = dHashFromGray(data, 9, 8);
  } catch {
    result = null;
  }
  IMAGE_HASH_CACHE.set(imageUrl, result);
  return result;
}

/** dHash: for each of 8 rows, compare 8 adjacent-pixel pairs (9 cols → 8 bits),
    64 bits total → 16-hex. Pure given the grayscale buffer. */
function dHashFromGray(gray: Uint8Array | Buffer, cols: number, rows: number): string {
  let bits = '';
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const l = gray[y * cols + x];
      const r = gray[y * cols + x + 1];
      bits += l < r ? '1' : '0';
    }
  }
  // pack 64 bits → 16 hex chars
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/** Load `sharp` lazily and tolerantly — returns null when it isn't installed so
    imageHash degrades to null instead of throwing at import. */
type SharpFactory = (input: Buffer) => {
  grayscale: () => ReturnType<SharpFactory>;
  resize: (w: number, h: number, opts: { fit: string }) => ReturnType<SharpFactory>;
  raw: () => ReturnType<SharpFactory>;
  toBuffer: (opts: { resolveWithObject: true }) => Promise<{ data: Uint8Array }>;
};
let _sharp: SharpFactory | null | undefined;
async function loadSharp(): Promise<SharpFactory | null> {
  if (_sharp !== undefined) return _sharp;
  try {
    // dynamic, string-built specifier so bundlers don't try to resolve it
    const mod = await import(/* webpackIgnore: true */ 'sharp' as string);
    _sharp = (mod.default ?? mod) as SharpFactory;
  } catch {
    _sharp = null;
  }
  return _sharp;
}
