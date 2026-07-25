/**
 * Data-quality audit + scorecard for lectr — the classification-hygiene and
 * DS-discipline foundation. READ-ONLY: it loads the SERVED corpus shards
 * (public/data/ray/lots-*.json + sold-archive-*.json — arrays of AuctionLot),
 * runs three families of checks, and prints a report. It writes NOTHING, edits
 * nothing, touches no git.
 *
 *   1. MISROUTED LOTS — lots whose title/medium strongly indicate a different
 *      vertical than their assigned artist slug (the known ART→SCIENCE leak:
 *      Hockney/Houseago/Basquiat/Turcato under space-exploration /
 *      scientific-instruments; "Gemini G.E.L." prints mistaken for the Gemini
 *      space program; "lunar/celestial" art titles). Also the inverse.
 *   2. FIELD-COMPLETENESS SCORECARD per vertical — the % present of the fields
 *      the pricing/demand/hedonic/card engines depend on. Fields the served
 *      projection deliberately STRIPS (objectFingerprint, modelKey, gradeLabel)
 *      are reported as "stripped (corpus-only)" rather than a false 0%, and the
 *      served analogue (grade via _card) is scored instead where one exists.
 *   3. INTEGRITY — duplicate ids, sold lots missing price/basis, future sale
 *      dates on sold lots, USD↔native price mismatches, impossible values.
 *
 * NOTE ON SCOPE: the served shards are a slim projection (corpus-io.ts STRIP),
 * so engine-only fields (fxRate, nativeCurrency, objectFingerprint, modelKey,
 * gradeLabel …) are absent here. This audit scores what SHIPS to the client and
 * flags where a stripped field caps a client-side check. The full-corpus twin
 * (data/corpus/*.json.gz) would extend integrity check #4 to the exact
 * |realizedUsd − realizedNative×fxRate| reconciliation.
 *
 * Run:  npx tsx scripts/audit-data-quality.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { ARTIST_MARKET, type Market } from '../app/constants';

const SERVED_DIR = path.join(process.cwd(), 'public', 'data', 'ray');

// The audit reads a superset of AuctionLot's served fields; the served shards
// also carry compacted twins (_card, _pid/_pname, _v) that the strict type
// doesn't declare. Read as a permissive record so the projection quirks don't
// fight the compiler, and pull typed fields through narrow helpers.
type Lot = Record<string, unknown> & {
  id?: string;
  artist?: string;
  title?: string;
  medium?: string | null;
  category?: string;
  status?: string;
  currency?: string;
  saleDate?: string;
  priceUsd?: number | null;
  priceBasis?: string;
  premiumPrice?: number | null;
  hammerPrice?: number | null;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  reference?: string | null;
  yearNum?: number | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// LOAD — every lots-*.json + sold-archive-*.json shard, tagged by tier so the
// integrity checks can reason about "sold archive" vs "main feed" separately.
// ─────────────────────────────────────────────────────────────────────────────
function loadShards(): { lot: Lot; tier: 'main' | 'archive' }[] {
  if (!fs.existsSync(SERVED_DIR)) {
    throw new Error(`[audit] served dir not found: ${SERVED_DIR}`);
  }
  const files = fs.readdirSync(SERVED_DIR)
    .filter(f => /^(lots|sold-archive)-\d+\.json$/.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error(`[audit] no lots-*.json / sold-archive-*.json shards in ${SERVED_DIR}`);
  }
  const out: { lot: Lot; tier: 'main' | 'archive' }[] = [];
  for (const f of files) {
    const tier: 'main' | 'archive' = f.startsWith('sold-archive') ? 'archive' : 'main';
    const arr = JSON.parse(fs.readFileSync(path.join(SERVED_DIR, f), 'utf8')) as Lot[];
    for (const lot of arr) out.push({ lot, tier });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKET / SLUG helpers.
// ─────────────────────────────────────────────────────────────────────────────
const marketOfSlug = (slug: string | undefined): Market =>
  (slug && ARTIST_MARKET[slug]) || 'art';

const text = (l: Lot): string =>
  `${l.title ?? ''}  ${l.medium ?? ''}`.toLowerCase();

// ─────────────────────────────────────────────────────────────────────────────
// 1. MISROUTE DETECTION
//
// Each detector reads a lot and, if it fires, returns the market the lot most
// likely belongs to. A misroute = a detector fires for a market ≠ the assigned
// slug's market with HIGH confidence (a positive art/culture/etc. signal), not
// merely the absence of the assigned market's signal. Ordered by strength.
// ─────────────────────────────────────────────────────────────────────────────

// Blue-chip / tracked fine-artist surnames that appear as the LEADING maker in a
// title ("DAVID HOCKNEY (b. 1937) …"). Presence of one of these as the maker is a
// near-certain ART signal regardless of a "lunar/space" subject word.
const ART_MAKERS =
  /\b(hockney|houseago|basquiat|turcato|picasso|warhol|matisse|condo|haring|ruscha|richter|hirst|koons|kusama|banksy|rauschenberg|twombly|calder|lichtenstein|clemente|pettibon|scharf|martinez|saul|mcgee|kaws|futura|condo|prouv[eé]|jeanneret|nakashima)\b/i;

// Gemini G.E.L. is the LA print publisher; its catalogue refs ("Gemini 445",
// "M.C.A.T. 131", "S.A.C. 140") were mistaken for the Gemini SPACE program and
// swept into space-exploration. A Gemini-with-a-print-ref pattern is pure ART.
const GEMINI_PRINT = /\bgemini\s+\d{2,4}\b|\bm\.?c\.?a\.?t\.?\b|\bs\.?a\.?c\.?\b/i;

// Unambiguous fine-art medium phrasing — requires a paint/print technique, not a
// bare "oil-gilt table". Paired with category to avoid furniture false-positives.
const ART_MEDIUM =
  /\b(oil on canvas|acrylic on canvas|oil on panel|oil on linen|gouache|watercolou?r on|screenprint|silkscreen|lithograph|etching and aquatint|works on paper|mixed media on canvas)\b/i;

// Watch signals (a skeletonized dial is not a fossil).
const WATCH_SIGNAL =
  /\b(wristwatch|montre|automatic chronograph|tourbillon|perpetual calendar|ref\.\s*\d{3,}|caliber|calibre|self-winding)\b/i;
const WATCH_MAKER =
  /\b(rolex|patek philippe|audemars piguet|omega|cartier|richard mille|jaeger-lecoultre|vacheron|a\. lange|breguet|panerai)\b/i;

// Card signals (a graded trading card is not memorabilia / not an "object").
const CARD_SIGNAL =
  /\b(psa\s?\d|bgs\s?\d|sgc\s?\d|rookie card|\brc\b|topps|panini|bowman|fleer|upper deck|refractor|\/\d{1,3}\b)\b/i;

// Genuine science subject words — used ONLY to CONFIRM a science lot is correctly
// placed (suppress a false misroute), never on its own to route INTO science.
const SCIENCE_SUBJECT =
  /\b(meteorite|meteoritic|fossil|dinosaur|trilobite|ammonite|nasa|apollo\s*\d|astronaut(?:'s)?\s+(?:flown|worn|suit|glove)|flown to the moon|marine chronometer|sextant|telescope|microscope|orrery|enigma machine|slide rule|planetarium)\b/i;

interface Misroute {
  id: string;
  title: string;
  assignedSlug: string;
  assignedMarket: Market;
  likelyMarket: Market;
  reason: string;
}

function detectMisroute(l: Lot): Misroute | null {
  const slug = l.artist ?? '';
  const assignedMarket = marketOfSlug(slug);
  const t = text(l);
  const cat = l.category ?? '';

  const flag = (likelyMarket: Market, reason: string): Misroute | null =>
    likelyMarket === assignedMarket ? null : {
      id: String(l.id ?? '?'),
      title: (l.title ?? '').slice(0, 90),
      assignedSlug: slug,
      assignedMarket,
      likelyMarket,
      reason,
    };

  // ── ART leaking into SCIENCE (the known issue) ──────────────────────────────
  if (assignedMarket === 'science') {
    // A leading blue-chip maker + no genuine science subject = misrouted art.
    if (ART_MAKERS.test(t) && !SCIENCE_SUBJECT.test(t)) {
      return flag('art', `named art maker "${(t.match(ART_MAKERS) || [''])[0]}" under a science slug, no science subject`);
    }
    // Gemini G.E.L. print ref masquerading as the Gemini space program.
    if (GEMINI_PRINT.test(t) && !SCIENCE_SUBJECT.test(t)) {
      return flag('art', `Gemini G.E.L. / print-catalogue ref ("${(t.match(GEMINI_PRINT) || [''])[0]}") read as the Gemini space program`);
    }
    // Explicit painting/print medium with no science subject.
    if (ART_MEDIUM.test(t) && !SCIENCE_SUBJECT.test(t)) {
      return flag('art', `fine-art medium "${(t.match(ART_MEDIUM) || [''])[0]}" under a science slug, no science subject`);
    }
  }

  // ── WATCH leaking into SCIENCE ──────────────────────────────────────────────
  if (assignedMarket === 'science' && (WATCH_MAKER.test(t) || WATCH_SIGNAL.test(t)) && !SCIENCE_SUBJECT.test(t)) {
    return flag('watches', `watch signal "${(t.match(WATCH_MAKER) || t.match(WATCH_SIGNAL) || [''])[0]}" under a science slug`);
  }

  // ── INVERSE: SCIENCE/WATCH/CARD content under an ART/DESIGN slug ─────────────
  if ((assignedMarket === 'art' || assignedMarket === 'design') && ART_MAKERS.test(t) === false) {
    if (WATCH_MAKER.test(t) && WATCH_SIGNAL.test(t)) {
      return flag('watches', `watch maker + watch signal under an ${assignedMarket} slug`);
    }
  }

  // ── CARDS mis-slugged into another SPORTS bucket or elsewhere ────────────────
  if (assignedMarket === 'sports' && slug !== 'sports-cards' && slug !== 'sports-memorabilia') {
    // A clearly-graded trading card sitting in game-used/trophies/tickets.
    if (CARD_SIGNAL.test(t) && cat !== 'object') {
      return flag('sports' as Market, `graded-card signal "${(t.match(CARD_SIGNAL) || [''])[0]}" outside the cards slug (assigned ${slug})`);
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. FIELD-COMPLETENESS SCORECARD
//
// A field spec = a name, a per-lot presence test, an optional scope filter
// (only count lots the field is meant to apply to), and whether the field is
// STRIPPED from the served projection (so we label it honestly instead of 0%).
// ─────────────────────────────────────────────────────────────────────────────
interface FieldSpec {
  name: string;
  present: (l: Lot) => boolean;
  scope?: (l: Lot, tier: 'main' | 'archive') => boolean;
  strippedFromServed?: boolean;
  note?: string;
}

const isSold = (l: Lot) => l.status === 'sold';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const FIELD_SPECS: FieldSpec[] = [
  { name: 'priceUsd', present: l => num(l.priceUsd), scope: isSold, note: 'sold lots only' },
  { name: 'priceBasis', present: l => typeof l.priceBasis === 'string' && l.priceBasis.length > 0, scope: isSold, note: 'sold lots only' },
  { name: 'saleDate', present: l => typeof l.saleDate === 'string' && l.saleDate.length >= 8 },
  { name: 'estimate (low+high)', present: l => num(l.estimateLow) && num(l.estimateHigh), note: 'demand engine denominator' },
  { name: 'reference (hedonic ctrl)', present: l => typeof l.reference === 'string' && (l.reference as string).length > 0, note: 'watch ref / model line' },
  { name: 'yearNum', present: l => num(l.yearNum), note: 'hedonic vintage control' },
  { name: 'grade (cards: _card grade)', present: l => {
      const c = (l as { _card?: { gradeCo?: unknown; gradeNum?: unknown } })._card;
      return !!c && (typeof c.gradeCo === 'string' || num(c.gradeNum));
    }, scope: (l) => marketOfSlug(l.artist) === 'sports', note: 'sports only; served via _card' },
  { name: 'modelKey (hedonic ctrl)', present: () => false, strippedFromServed: true, note: 'STRIPPED by corpus-io — score on data/corpus' },
  { name: 'objectFingerprint', present: () => false, strippedFromServed: true, note: 'STRIPPED by corpus-io — score on data/corpus' },
];

// ─────────────────────────────────────────────────────────────────────────────
// REPORT PRINTING HELPERS.
// ─────────────────────────────────────────────────────────────────────────────
const pct = (n: number, d: number) => (d === 0 ? '  n/a' : `${((100 * n) / d).toFixed(1)}%`.padStart(6));
const pad = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
const hr = (c = '─') => c.repeat(78);
const h1 = (s: string) => `\n${hr('═')}\n${s}\n${hr('═')}`;

const MARKETS_ORDER: Market[] = ['art', 'design', 'watches', 'sports', 'science', 'culture'];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN.
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const t0 = Date.now();
  const rows = loadShards();
  const total = rows.length;

  console.log(h1('lectr — DATA-QUALITY AUDIT'));
  console.log(`corpus: ${total.toLocaleString()} served lots  ·  ${SERVED_DIR}`);
  console.log(`(slim projection — engine-only fields stripped per corpus-io.ts)`);

  // Bucket by market + by slug for later sections.
  const byMarket = new Map<Market, { lot: Lot; tier: 'main' | 'archive' }[]>();
  for (const r of rows) {
    const m = marketOfSlug(r.lot.artist);
    (byMarket.get(m) ?? byMarket.set(m, []).get(m)!).push(r);
  }

  // ── SECTION 1: MISROUTES ────────────────────────────────────────────────────
  console.log(h1('1 · MISROUTED LOTS  (title/medium ≠ assigned vertical)'));
  const misroutes: Misroute[] = [];
  for (const r of rows) {
    const m = detectMisroute(r.lot);
    if (m) misroutes.push(m);
  }
  // Per-assigned-market counts.
  const perMarket = new Map<Market, number>();
  const perDirection = new Map<string, number>();
  for (const m of misroutes) {
    perMarket.set(m.assignedMarket, (perMarket.get(m.assignedMarket) ?? 0) + 1);
    const key = `${m.assignedMarket} → ${m.likelyMarket}`;
    perDirection.set(key, (perDirection.get(key) ?? 0) + 1);
  }
  console.log(`total flagged misroutes: ${misroutes.length}  (${pct(misroutes.length, total).trim()} of corpus)\n`);
  console.log(`by assigned vertical (where the lot WRONGLY sits):`);
  for (const m of MARKETS_ORDER) {
    const c = perMarket.get(m) ?? 0;
    if (c) console.log(`  ${pad(m, 12)} ${String(c).padStart(6)}`);
  }
  console.log(`\nby direction (assigned → likely-correct):`);
  for (const [k, c] of Array.from(perDirection.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(k, 24)} ${String(c).padStart(6)}`);
  }

  // Worst offenders, grouped by direction, most-informative first.
  console.log(`\nworst offenders  (title  →  assigned-slug  →  likely-market):`);
  const shown = misroutes.slice(0, 20);
  for (const m of shown) {
    console.log(`  • "${pad(m.title, 60)}"`);
    console.log(`      ${m.assignedSlug} (${m.assignedMarket})  →  ${m.likelyMarket}   [${m.reason}]`);
  }
  if (misroutes.length > shown.length) {
    console.log(`  … and ${misroutes.length - shown.length} more`);
  }

  // ── SECTION 2: COMPLETENESS SCORECARD ───────────────────────────────────────
  console.log(h1('2 · FIELD-COMPLETENESS SCORECARD  (% present, by vertical)'));
  console.log(`the DS baseline — where coverage gaps cap the engines.\n`);

  // Header row.
  const colW = 9;
  const nameW = 26;
  const header = pad('field', nameW) + MARKETS_ORDER.map(m => pad(m, colW)).join('') + pad('ALL', colW);
  console.log(header);
  console.log(hr());

  for (const spec of FIELD_SPECS) {
    let line = pad(spec.name, nameW);
    let allPresent = 0, allScope = 0;
    for (const m of MARKETS_ORDER) {
      const bucket = byMarket.get(m) ?? [];
      let present = 0, scope = 0;
      for (const { lot, tier } of bucket) {
        if (spec.scope && !spec.scope(lot, tier)) continue;
        scope++;
        if (spec.present(lot)) present++;
      }
      allPresent += present; allScope += scope;
      line += pad(spec.strippedFromServed ? 'strip' : (scope ? pct(present, scope).trim() : '·'), colW);
    }
    line += pad(spec.strippedFromServed ? 'strip' : pct(allPresent, allScope).trim(), colW);
    console.log(line);
  }
  console.log(hr());
  console.log(`legend: "strip" = field removed from the served projection (corpus-io STRIP);`);
  console.log(`        score it on the full corpus (data/corpus/*.json.gz).  "·" = no in-scope lots.`);
  for (const spec of FIELD_SPECS) {
    if (spec.note) console.log(`  – ${pad(spec.name, 26)} ${spec.note}`);
  }

  // Per-vertical lot counts (context for the %s above).
  console.log(`\nvertical sizes (served):`);
  for (const m of MARKETS_ORDER) {
    const bucket = byMarket.get(m) ?? [];
    const sold = bucket.filter(b => isSold(b.lot)).length;
    console.log(`  ${pad(m, 12)} ${String(bucket.length).padStart(8).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}  (${sold.toLocaleString()} sold)`);
  }

  // ── SECTION 3: INTEGRITY ────────────────────────────────────────────────────
  console.log(h1('3 · INTEGRITY CHECKS'));

  // 3a. duplicate ids
  const idCount = new Map<string, number>();
  for (const { lot } of rows) {
    const id = String(lot.id ?? '');
    idCount.set(id, (idCount.get(id) ?? 0) + 1);
  }
  const dupes = Array.from(idCount.entries()).filter(([, c]) => c > 1);
  const dupeLots = dupes.reduce((s, [, c]) => s + c - 1, 0);
  console.log(`\n3a  duplicate ids ............. ${dupes.length} ids appear >1×  (${dupeLots} redundant rows)`);
  for (const [id, c] of dupes.slice(0, 5)) console.log(`      ${pad(id, 48)} ×${c}`);
  const emptyIds = rows.filter(r => !r.lot.id).length;
  if (emptyIds) console.log(`      + ${emptyIds} rows with NO id`);

  // 3b. sold lots missing price / basis
  const soldRows = rows.filter(r => isSold(r.lot));
  const missingPrice = soldRows.filter(r => !num(r.lot.priceUsd)).length;
  const missingBasis = soldRows.filter(r => !r.lot.priceBasis).length;
  console.log(`\n3b  sold lots (n=${soldRows.length.toLocaleString()}):`);
  console.log(`      missing priceUsd ......... ${missingPrice}  (${pct(missingPrice, soldRows.length).trim()})`);
  console.log(`      missing priceBasis ....... ${missingBasis}  (${pct(missingBasis, soldRows.length).trim()})`);

  // 3c. future saleDates on sold lots
  const today = new Date().toISOString().slice(0, 10);
  const futureSold = soldRows.filter(r => typeof r.lot.saleDate === 'string' && r.lot.saleDate > today);
  console.log(`\n3c  future saleDate on SOLD lots (> ${today}) ... ${futureSold.length}`);
  for (const r of futureSold.slice(0, 5)) {
    console.log(`      ${pad(String(r.lot.id), 34)} ${r.lot.saleDate}  "${pad(r.lot.title ?? '', 30)}"`);
  }

  // 3d. USD ↔ native price consistency
  //     Native fx fields are stripped from served, so the exact
  //     |realizedUsd − realizedNative×fxRate| reconciliation runs only on the
  //     full corpus. On the SERVED tier we check the invariants that survive:
  //       · USD lots: priceUsd MUST equal premiumPrice (both are the same
  //         number in USD) — a divergence means a broken fx alias.
  //       · non-USD lots: priceUsd should differ from the native premiumPrice,
  //         and the implied fx ratio must fall in a sane band for the currency.
  // Generous historical bands: the corpus spans years, so a fx ratio only
  // signals a BROKEN conversion when it's outside the currency's plausible
  // multi-year range (not merely off today's spot). Bands are deliberately wide
  // — the goal is to catch a USD number left in a native field, or a native
  // number never converted, NOT to re-price the tape.
  // Bands span each currency's FULL multi-year trading range (the corpus goes
  // back to the mid-2000s: GBP/USD hit ~2.1 in 2007, CHF/USD ~0.6). Widened so
  // a flag means a genuinely BROKEN conversion — a USD number left in a native
  // field (ratio ≈ 1 for a currency whose real rate is far from 1), or a
  // magnitude that's simply impossible — not a date-correct historical rate.
  const FX_BAND: Record<string, [number, number]> = {
    GBP: [1.1, 2.15], EUR: [0.8, 1.6], HKD: [0.08, 0.2], CHF: [0.55, 1.5],
    AUD: [0.45, 1.05], CNY: [0.08, 0.2],
  };
  let usdMismatch = 0, fxOutOfBand = 0, fxChecked = 0;
  const usdEx: string[] = [];
  for (const { lot } of rows) {
    const p = lot.priceUsd, native = lot.premiumPrice;
    if (!num(p) || !num(native) || native === 0) continue;
    if (lot.currency === 'USD') {
      if (Math.abs(p - native) > 1) {
        usdMismatch++;
        if (usdEx.length < 4) usdEx.push(`${String(lot.id)}  priceUsd=${p} premiumPrice=${native}`);
      }
    } else if (lot.currency && FX_BAND[lot.currency]) {
      fxChecked++;
      const ratio = p / native;
      const [lo, hi] = FX_BAND[lot.currency];
      if (ratio < lo || ratio > hi) fxOutOfBand++;
    }
  }
  console.log(`\n3d  USD ↔ native price consistency (served invariants):`);
  console.log(`      USD lots where priceUsd ≠ premiumPrice ... ${usdMismatch}  (broken fx alias)`);
  for (const e of usdEx) console.log(`        ${e}`);
  console.log(`      non-USD lots w/ implied fx OUT of band ... ${fxOutOfBand} of ${fxChecked} checked`);
  console.log(`      (exact realizedUsd = realizedNative×fxRate check needs data/corpus — fx stripped from served)`);

  // 3e. impossible values
  let negPrice = 0, negEst = 0, estInverted = 0, zeroSoldPrice = 0, badYear = 0;
  const yearNow = new Date().getFullYear();
  for (const { lot } of rows) {
    if (num(lot.priceUsd) && lot.priceUsd < 0) negPrice++;
    if (num(lot.priceUsd) && lot.priceUsd === 0 && isSold(lot)) zeroSoldPrice++;
    if ((num(lot.estimateLow) && (lot.estimateLow as number) < 0) || (num(lot.estimateHigh) && (lot.estimateHigh as number) < 0)) negEst++;
    if (num(lot.estimateLow) && num(lot.estimateHigh) && (lot.estimateLow as number) > (lot.estimateHigh as number)) estInverted++;
    if (num(lot.yearNum) && ((lot.yearNum as number) < 1400 || (lot.yearNum as number) > yearNow + 1)) badYear++;
  }
  console.log(`\n3e  impossible values:`);
  console.log(`      negative priceUsd ............ ${negPrice}`);
  console.log(`      sold lot with priceUsd == 0 .. ${zeroSoldPrice}`);
  console.log(`      negative estimate ............ ${negEst}`);
  console.log(`      estimateLow > estimateHigh ... ${estInverted}`);
  console.log(`      yearNum out of [1400, ${yearNow + 1}] . ${badYear}`);

  // ── SUMMARY ─────────────────────────────────────────────────────────────────
  console.log(h1('SUMMARY'));
  const integrityTotal = dupeLots + missingPrice + missingBasis + futureSold.length + usdMismatch + negPrice + zeroSoldPrice + negEst + estInverted + badYear;
  console.log(`  misroutes flagged ............ ${misroutes.length}`);
  console.log(`  integrity anomalies .......... ${integrityTotal}`);
  console.log(`  audited in ${((Date.now() - t0) / 1000).toFixed(1)}s over ${total.toLocaleString()} served lots`);
  console.log(hr('═') + '\n');
}

main();
