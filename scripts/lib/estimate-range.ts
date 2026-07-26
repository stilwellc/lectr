/**
 * parseEstimateRange — robust low/high extraction from a house's ESTIMATE
 * display string. Fixes the class of bug where a range string was parsed with
 * a single/naïve regex and lost its high bound (or the whole band).
 *
 * Handles (documented examples double as the test fixtures — see the
 * assertions used at validation time):
 *   "£5,000"                        → { low: 5000,   high: 5000 }   (single value → flat band)
 *   "GBP 200,000 – GBP 300,000"     → { low: 200000, high: 300000 } (currency code repeats before high)
 *   "£200,000–300,000"              → { low: 200000, high: 300000 } (en dash, no space)
 *   "$1,000-1,500"                  → { low: 1000,   high: 1500 }   (plain hyphen)
 *   "USD 12,000 - USD 18,000"       → { low: 12000,  high: 18000 }
 *   "€8,000 — €12,000"              → { low: 8000,   high: 12000 }  (em dash)
 *   "HK$1,000,000 - HK$1,500,000"   → { low: 1e6,    high: 1.5e6 }
 *   "Estimate on request"           → { low: null,   high: null }
 *   "" / undefined                  → { low: null,   high: null }
 *
 * NOT for realized-price strings: a price realised is a single number and a
 * first-number parse is correct there — never sum/average it.
 */

// low  [dash|to]  optional-currency  high — currency tokens between the dash
// and the high bound ("GBP 300,000", "HK$1,500,000") are what broke the old
// `([\d,]+)\s*[-–]\s*([\d,]+)` pattern (letters between the numbers → no match
// → the WHOLE band silently dropped).
const RANGE_RE = /([\d][\d,]*(?:\.\d+)?)\s*(?:[-–—]|\bto\b)\s*(?:[A-Z]{2,3}\s*\$?\s*|(?:HK|US|AU|CN)?[$£€¥]\s*|CHF\s*)?([\d][\d,]*(?:\.\d+)?)/i;
const SINGLE_RE = /([\d][\d,]*(?:\.\d+)?)/;
const NO_ESTIMATE_RE = /on request|upon request|estimate unavailable|refer department|no estimate/i;

const num = (s: string): number => parseFloat(s.replace(/,/g, ''));

export function parseEstimateRange(txt: string | null | undefined): { low: number | null; high: number | null } {
  if (!txt) return { low: null, high: null };
  if (NO_ESTIMATE_RE.test(txt)) return { low: null, high: null };
  const range = txt.match(RANGE_RE);
  if (range) {
    const low = num(range[1]);
    const high = num(range[2]);
    // a degenerate "range" (high < low, e.g. a stray number in trailing text)
    // is distrusted — fall back to the low as a flat band
    if (isFinite(low) && isFinite(high) && high >= low) return { low, high };
    if (isFinite(low)) return { low, high: low };
  }
  const single = txt.match(SINGLE_RE);
  if (single) {
    const v = num(single[1]);
    if (isFinite(v) && v > 0) return { low: v, high: v };
  }
  return { low: null, high: null };
}
