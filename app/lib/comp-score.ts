/**
 * comp-score.ts — the comps modal's CONTEXT ranking (similarity of a sold lot
 * to the anchor: medium class, dimensions, estimate proximity, year), lifted
 * verbatim from app/components/ComparableModal.tsx so the server-side comps
 * API (functions/_lib/comps-api.ts) ranks context rows exactly as the modal
 * did over the client corpus. Pure; no React.
 */
import type { AuctionLot } from '../types';

/** Convert fraction characters (½, ¼, etc.), slash fractions (3/8), and mixed numbers to decimals */
function parseFrac(s: string): number {
  const fracs: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.333, '⅔': 0.667, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
  // Strip non-numeric prefixes like "I." or "S." (image/sheet size labels)
  const cleaned = s.replace(/^[A-Za-z.]+\s*/, '').trim();
  let val = 0;
  // Try: "10 3/8" or "23 1/4" (integer + slash fraction)
  const mixedSlash = cleaned.match(/^(\d+)\s+(\d+)\/(\d+)/);
  if (mixedSlash) {
    return parseFloat(mixedSlash[1]) + parseFloat(mixedSlash[2]) / parseFloat(mixedSlash[3]);
  }
  // Try standalone slash fraction "3/8"
  const slashFrac = cleaned.match(/^(\d+)\/(\d+)/);
  if (slashFrac) {
    return parseFloat(slashFrac[1]) / parseFloat(slashFrac[2]);
  }
  // Match leading integer/decimal
  const intMatch = cleaned.match(/^(\d+\.?\d*)/);
  if (intMatch) val += parseFloat(intMatch[1]);
  // Match trailing unicode fraction character
  for (const [ch, n] of Object.entries(fracs)) {
    if (cleaned.includes(ch)) { val += n; break; }
  }
  // If nothing matched, try decimal parse
  if (val === 0) val = parseFloat(cleaned) || 0;
  return val;
}

/** Parse a dimension string into [height, width] or null.
 *  Handles: "24 x 18 in", "25¼ h × 20¾ w in", "63 × 52 cm",
 *  "99.8 by 73 cm.", "I. 23 1/4 x 39 3/4 in. (59.1 x 101 cm)S. ..." */
function parseDims(dims: string | null): [number, number] | null {
  if (!dims) return null;
  // For Image/Sheet format, extract just the first measurement block
  // e.g., "I. 23 1/4 x 39 3/4 in. (59.1 x 101 cm)S. 30 3/8 x 45 3/4 in."
  let str = dims;
  const sheetMatch = dims.match(/[IS]\.\s*(.+?)(?:\(|[IS]\.|$)/);
  if (sheetMatch) str = sheetMatch[1].trim();
  // Prefer inches; fall back to cm
  const useIn = str.toLowerCase().includes('in');
  // Split on "x", "×", or "by"
  const tokens = str.split(/\s*(?:[x×]|\bby\b)\s*/i).map(t => t.trim());
  if (tokens.length < 2) return null;
  const h = parseFrac(tokens[0]);
  const w = parseFrac(tokens[1]);
  if (!h || !w) return null;
  // Normalize cm to inches for consistent comparison
  if (!useIn && str.toLowerCase().includes('cm')) {
    return [h / 2.54, w / 2.54];
  }
  return [h, w];
}

function parseArea(dims: string | null): number | null {
  const hw = parseDims(dims);
  return hw ? hw[0] * hw[1] : null;
}

/** Parse a year string like "2000" or "circa 2000" into a number */
function parseYear(y: string | null): number | null {
  if (!y) return null;
  const m = y.match(/(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

/** Simple word overlap score between two medium strings (0-1) */
function mediumSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  Array.from(wordsA).forEach(w => { if (wordsB.has(w)) overlap++; });
  return overlap / Math.max(wordsA.size, wordsB.size);
}

/** Classify medium into sub-type for finer matching within "original" category */
function mediumClass(medium: string | null): string | null {
  if (!medium) return null;
  const m = medium.toLowerCase();
  if (/oil|acrylic|enamel/.test(m) && /canvas|linen|panel|board/.test(m)) return 'painting';
  if (/pencil|charcoal|graphite|crayon|ink|pastel|watercolor|gouache|marker/.test(m)) return 'work-on-paper';
  if (/screen\s*print|lithograph|etching|woodcut|gicl[eé]e|print|engraving|aquatint|monoprint/.test(m)) return 'print';
  if (/bronze|ceramic|resin|marble|plaster/.test(m)) return 'sculpture';
  if (/canvas|linen|panel/.test(m)) return 'painting';
  if (/paper/.test(m)) return 'work-on-paper';
  return null;
}

export function scoreComparable(upcoming: AuctionLot, sold: AuctionLot): number {
  let score = 0;

  // Medium sub-class match (weight: 25) — distinguishes sketches from paintings
  const classA = mediumClass(upcoming.medium);
  const classB = mediumClass(sold.medium);
  if (classA && classB) {
    if (classA === classB) score += 25;
    else score += 3;
  }
  // Word-level medium similarity as tiebreaker (weight: 5)
  score += mediumSimilarity(upcoming.medium, sold.medium) * 5;

  // Dimensions similarity (weight: 35) — critical for matching scale
  const areaA = parseArea(upcoming.dimensions);
  const areaB = parseArea(sold.dimensions);
  if (areaA && areaB) {
    const ratio = Math.min(areaA, areaB) / Math.max(areaA, areaB);
    score += ratio * 35;
  }

  // Estimate proximity (weight: 25) — good proxy for importance/scale
  const estMid = upcoming.estimateLow && upcoming.estimateHigh
    ? (upcoming.estimateLow + upcoming.estimateHigh) / 2
    : null;
  if (estMid && sold.priceUsd) {
    const ratio = Math.min(estMid, sold.priceUsd) / Math.max(estMid, sold.priceUsd);
    score += ratio * 25;
  }

  // Year proximity (weight: 10)
  const yearA = parseYear(upcoming.year);
  const yearB = parseYear(sold.year);
  if (yearA && yearB) {
    const diff = Math.abs(yearA - yearB);
    score += Math.max(0, 1 - diff / 50) * 10;
  }

  return score;
}
