/**
 * comps.ts — the comparables engine. One source of truth for "what counts as
 * a comp", shared by the buy signal, the comparables modal, and the crawler's
 * precompute.
 *
 * The old signal had one coarse gate (category) and a hole (unknown matched
 * everything), so a Haring exhibition poster comped against screenprints, a
 * catalogue against drawings, a Nakashima stool against a ten-foot bench.
 *
 * This engine:
 *  1. classifies every lot into a fine-grained FORM (title + medium keywords,
 *     tuned against the actual crawl data) — posters, books and ephemera are
 *     pulled out of 'print'; furniture splits into stool/bench/chair/table/…;
 *     originals split painting / work-on-paper / generic
 *  2. hard-gates comps on form equality — unknown never matches everything;
 *     generic originals only comp generic originals
 *  3. gates on size when both sides have parseable dimensions (opportunistic —
 *     coverage is 8–40% — but decisive when present)
 *  4. prefers the SAME EDITION: >= 3 sales of the same normalized title are
 *     the whole pool ("what did this exact work last hammer for")
 *  5. suppresses the signal when the comp pool is too dispersed to mean
 *     anything (IQR/median guard) or too thin (< 3)
 */
import { AuctionLot } from '../types';

export type Form =
  | 'book' | 'ephemera' | 'poster' | 'photograph' | 'textile'
  | 'object-edition' | 'print'
  | 'painting' | 'work-on-paper' | 'original-2d'
  | 'sculpture'
  | 'seating-chair' | 'seating-stool' | 'seating-bench' | 'seating-sofa'
  | 'table-dining' | 'table-low' | 'table-side' | 'table'
  | 'case' | 'desk' | 'bed' | 'lighting' | 'mirror' | 'design-other'
  | 'unknown';

export const FORM_LABEL: Record<Form, string> = {
  book: 'books & catalogues', ephemera: 'ephemera', poster: 'posters',
  photograph: 'photographs', textile: 'textiles',
  'object-edition': 'editioned objects', print: 'prints',
  painting: 'paintings', 'work-on-paper': 'works on paper', 'original-2d': 'unique works',
  sculpture: 'sculptures',
  'seating-chair': 'chairs', 'seating-stool': 'stools', 'seating-bench': 'benches',
  'seating-sofa': 'sofas', 'table-dining': 'dining tables', 'table-low': 'coffee tables',
  'table-side': 'side tables', table: 'tables', case: 'case pieces', desk: 'desks',
  bed: 'beds', lighting: 'lighting', mirror: 'mirrors', 'design-other': 'design objects',
  unknown: 'lots',
};

/** Classify a lot into its form. Order matters: the most specific cues win. */
export function classifyForm(lot: Pick<AuctionLot, 'title' | 'medium' | 'category'>): Form {
  const t = ` ${(lot.title || '').toLowerCase()} `;
  const m = ` ${(lot.medium || '').toLowerCase()} `;
  const tm = t + m;

  // paper/publishing forms hiding across categories
  if (/\b(book|catalogue|catalog|magazine|monograph)\b/.test(tm)) return 'book';
  if (/\b(invitation|announcement|flyer|ticket|postcard|greeting card|record sleeve|album cover|vinyl record|mailer)\b/.test(tm)) return 'ephemera';
  if (/\b(poster|affiche)\b/.test(tm)) return 'poster';

  // photographs (their own category, plus photographic mediums elsewhere)
  if (lot.category === 'photograph' || /\b(gelatin silver|c-print|chromogenic|polaroid|cibachrome|photograph)\b/.test(m)) return 'photograph';

  if (/\b(rug|tapestry|carpet|textile|blanket|scarf)\b/.test(tm)) return 'textile';

  // editioned objects & multiples (KAWS companions, decks, plates, plush…)
  if (/\b(skateboard|skate deck|deck set|companion|be@rbrick|bearbrick|vinyl figure|plush|figure set|ceramic (container|set|plate)|perfume|snow ?globe|keychain|ornament|chess set|cushion|pillow|dish set)\b/.test(tm)) return 'object-edition';

  // furniture / design forms (title carries the truth in this data)
  const isDesign = lot.category === 'design';
  if (isDesign || /\b(walnut|teak|oak|rosewood)\b/.test(m)) {
    if (/\b(bench|settee|daybed)\b/.test(t)) return 'seating-bench';
    if (/\b(stool|ottoman|pouf)\b/.test(t)) return 'seating-stool';
    if (/\b(sofa|couch|sectional)\b/.test(t)) return 'seating-sofa';
    if (/\b(chair|rocker|recliner)\b/.test(t)) return 'seating-chair';
    if (/\b(dining table|conference table|trestle table)\b/.test(t)) return 'table-dining';
    if (/\b(coffee table|low table|cocktail table)\b/.test(t)) return 'table-low';
    if (/\b(side table|end table|occasional table|nesting table|nightstand|night stand)\b/.test(t)) return 'table-side';
    if (/\btable\b/.test(t)) return 'table';
    if (/\b(cabinet|chest|dresser|sideboard|credenza|wardrobe|bookcase|bookshelf|shelves|shelf|case piece|etagere|étagère|highboard|commode)\b/.test(t)) return 'case';
    if (/\b(desk|workbench|vanity)\b/.test(t)) return 'desk';
    if (/\b(bed|headboard)\b/.test(t)) return 'bed';
    if (/\b(lamp|sconce|chandelier|lighting|light fixture|lantern)\b/.test(t)) return 'lighting';
    if (/\bmirror\b/.test(t)) return 'mirror';
    if (isDesign) return 'design-other';
  }

  if (lot.category === 'sculpture') return 'sculpture';
  if (lot.category === 'print') return 'print';

  if (lot.category === 'original') {
    if (/\b(oil|acrylic|enamel|alkyd)\b/.test(m) && /\b(canvas|linen|panel|board|masonite)\b/.test(m)) return 'painting';
    if (/\boil on canvas|acrylic on canvas\b/.test(t)) return 'painting';
    if (/\b(pencil|graphite|charcoal|ink|watercolor|watercolour|gouache|pastel|crayon|marker|pen|drawing|study|sketch)\b/.test(tm)) return 'work-on-paper';
    return 'original-2d';
  }

  return 'unknown';
}

/* ── size parsing (ported from the modal — opportunistic gate) ── */
function parseFrac(s: string): number {
  const fracs: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.333, '⅔': 0.667, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
  const cleaned = s.replace(/^[A-Za-z.]+\s*/, '').trim();
  const mixed = cleaned.match(/^(\d+)\s+(\d+)\/(\d+)/);
  if (mixed) return parseFloat(mixed[1]) + parseFloat(mixed[2]) / parseFloat(mixed[3]);
  const slash = cleaned.match(/^(\d+)\/(\d+)/);
  if (slash) return parseFloat(slash[1]) / parseFloat(slash[2]);
  let val = 0;
  const int = cleaned.match(/^(\d+\.?\d*)/);
  if (int) val += parseFloat(int[1]);
  for (const [ch, n] of Object.entries(fracs)) if (cleaned.includes(ch)) { val += n; break; }
  if (val === 0) val = parseFloat(cleaned) || 0;
  return val;
}

export function parseDims(dims: string | null | undefined): [number, number] | null {
  if (!dims) return null;
  let str = dims;
  const sheet = dims.match(/[IS]\.\s*(.+?)(?:\(|[IS]\.|$)/);
  if (sheet) str = sheet[1].trim();
  const useIn = str.toLowerCase().includes('in');
  const tokens = str.split(/\s*(?:[x×]|\bby\b)\s*/i).map(s => s.trim());
  if (tokens.length < 2) return null;
  const h = parseFrac(tokens[0]);
  const w = parseFrac(tokens[1]);
  if (!h || !w) return null;
  if (!useIn && str.toLowerCase().includes('cm')) return [h / 2.54, w / 2.54];
  return [h, w];
}

/**
 * Furniture bifurcates by MODEL, not just form: an LC2 sofa is a licensed
 * Cassina production line trading at $1–4K while an unmarked Jeanneret
 * Chandigarh sofa hammers at $15–30K — same artist, same form, different
 * markets. The model key is extracted from the title: alphanumeric codes
 * (LC2, PK22, CH24, PJ-010100) or a named series word directly before the
 * form noun (Conoid bench, Standard chair, Diamond chair). Comps must share
 * the model key — including both having none.
 */
const MODEL_STOPWORDS = new Set([
  'a', 'an', 'the', 'pair', 'set', 'two', 'three', 'four', 'six', 'his', 'her',
  'walnut', 'teak', 'oak', 'rosewood', 'pine', 'maple', 'cherry', 'burl', 'laurel',
  'custom', 'rare', 'early', 'important', 'fine', 'exceptional', 'monumental',
  'large', 'small', 'long', 'low', 'high', 'tall', 'double', 'single', 'grand',
  'occasional', 'freeform', 'free-form', 'upholstered', 'illuminated', 'unique',
  'special', 'signed', 'vintage', 'original',
]);
const CODE_BLACKLIST = new Set(['no', 'ca', 'vol', 'lot', 'est', 'circa']);
const FORM_NOUNS = /(sofa|couch|settee|bench|daybed|stool|ottoman|chair|rocker|table|cabinet|chest|dresser|sideboard|credenza|desk|bed|headboard|lamp|sconce|chandelier|mirror|shelf|shelves|bookcase)/;

export function modelKey(lot: Pick<AuctionLot, 'title'>): string | null {
  const t = (lot.title || '').toLowerCase();
  // 1 · alphanumeric model codes: lc2, lc-2, pk22, ch 24, pj-010100
  const code = t.match(/\b([a-z]{1,3})[-. ]?(\d{1,4})[a-z]?\b/);
  if (code && !CODE_BLACKLIST.has(code[1]) && !/^(19|20)\d\d$/.test(code[2])) {
    return `${code[1]}${code[2]}`;
  }
  // 2 · "model 123" / "model no. 45"
  const modelNo = t.match(/\bmodel\s+(?:no\.?\s*)?([a-z0-9-]{1,10})\b/);
  if (modelNo) return modelNo[1].replace(/-/g, '');
  // 3 · named series word immediately before the form noun
  const named = t.match(new RegExp('\\b([a-z][a-z-]{2,})\\s+' + FORM_NOUNS.source + 's?\\b'));
  if (named && !MODEL_STOPWORDS.has(named[1])) return named[1];
  return null;
}

const FURNITURE = new Set<Form>([
  'seating-chair', 'seating-stool', 'seating-bench', 'seating-sofa',
  'table-dining', 'table-low', 'table-side', 'table', 'case', 'desk', 'bed',
  'lighting', 'mirror', 'design-other',
]);

/** The hard gate: is `candidate` a legitimate comp for `lot`? */
export function areComparable(lot: AuctionLot, candidate: AuctionLot): boolean {
  const a = classifyForm(lot);
  const b = classifyForm(candidate);
  if (a === 'unknown' || b === 'unknown') return false; // never guess
  if (a !== b) return false;

  // furniture bifurcates by model: LC2 comps LC2, Conoid comps Conoid, and a
  // generic piece never comps a model-coded production line (or vice versa)
  if (FURNITURE.has(a) && modelKey(lot) !== modelKey(candidate)) return false;

  // opportunistic size gate when both sides are measurable
  const da = parseDims(lot.dimensions);
  const db = parseDims(candidate.dimensions);
  if (da && db) {
    if (FURNITURE.has(a)) {
      // a 40-inch bench is not a comp for a ten-footer
      const la = Math.max(...da), lb = Math.max(...db);
      if (la > 0 && lb > 0 && (la / lb > 2.2 || lb / la > 2.2)) return false;
    } else {
      const areaA = da[0] * da[1], areaB = db[0] * db[1];
      if (areaA > 0 && areaB > 0 && (areaA / areaB > 4 || areaB / areaA > 4)) return false;
    }
  }
  return true;
}

export function normalizeTitle(t: string | null | undefined): string {
  return (t || '')
    .toLowerCase()
    .replace(/["“”'’]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DeepSignal {
  label: 'Below Market' | 'Above Market';
  pct: number;
  /** how many comps the median is drawn from */
  basis: number;
  /** 'edition' = same-title sales of this exact work; 'form' = same-form comps */
  kind: 'edition' | 'form';
  form: Form;
}

function median(sorted: number[]): number {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

/**
 * The deep buy signal. Same thresholds as ever (comps median >= +20% over the
 * estimate midpoint = Below Market; <= -25% = Above Market) — but the pool is
 * now honest.
 */
export function computeDeepSignal(lot: AuctionLot, allLots: AuctionLot[]): DeepSignal | null {
  if (!lot.estimateLow || !lot.estimateHigh) return null;
  const form = classifyForm(lot);
  if (form === 'unknown') return null;
  const estMid = (lot.estimateLow + lot.estimateHigh) / 2;

  const sold = allLots.filter(l =>
    l.artist === lot.artist && l.status === 'sold' && l.priceUsd && l.id !== lot.id
  );

  // 1 · the same edition — the strongest comp there is
  const nt = normalizeTitle(lot.title);
  let pool: AuctionLot[] = [];
  let kind: 'edition' | 'form' = 'form';
  if (nt.length >= 6) {
    const sameTitle = sold.filter(l => normalizeTitle(l.title) === nt && classifyForm(l) === form);
    if (sameTitle.length >= 3) { pool = sameTitle; kind = 'edition'; }
  }

  // 2 · same-form comps through the hard gates
  if (pool.length === 0) {
    pool = sold.filter(l => areComparable(lot, l));
    if (pool.length > 24) {
      // prefer recent sales and titles that share words with this lot
      const words = new Set(nt.split(' ').filter(w => w.length > 3));
      const overlap = (l: AuctionLot) => {
        const w = normalizeTitle(l.title).split(' ');
        let n = 0;
        for (const x of w) if (words.has(x)) n++;
        return n;
      };
      pool = [...pool]
        .sort((a, b) => (overlap(b) - overlap(a)) || (new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime()))
        .slice(0, 24);
    }
  }

  if (pool.length < 3) return null;

  const prices = pool.map(l => l.priceUsd!).sort((a, b) => a - b);
  const med = median(prices);

  // dispersion guard: if the pool disagrees with itself, say nothing
  const q1 = prices[Math.floor(prices.length * 0.25)];
  const q3 = prices[Math.floor(prices.length * 0.75)];
  if (med > 0 && (q3 - q1) / med > 2.5) return null;

  const ratio = med / estMid;
  if (ratio >= 1.2) return { label: 'Below Market', pct: Math.round((ratio - 1) * 100), basis: pool.length, kind, form };
  if (ratio <= 0.75) return { label: 'Above Market', pct: Math.round((1 - ratio) * 100), basis: pool.length, kind, form };
  return null;
}
