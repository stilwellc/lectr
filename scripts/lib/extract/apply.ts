/**
 * extract/apply.ts — the SYNC side of the extraction layer: attach cached,
 * validated extractions to corpus lots (normalize) and the advisory merges the
 * key derivations call (build-market). No network, ever.
 *
 * ADVISORY DOCTRINE (every function here):
 *   · the regex parsers stay PRIMARY — an extracted field is used only where
 *     the regex found nothing, or where both agree;
 *   · a model output never overrides a hard regex match of grade / cert;
 *   · everything filled carries provenance (`src:'llm'`, `referenceSrc:'llm'`,
 *     CardId.llmFilled) so a served value can always be traced to its source.
 *
 * Inert without the APPLY gate (config.ts): every entry point returns its input
 * unchanged — same object, same array — and the cache is never read.
 */
import type { AuctionLot } from '../../../app/types';
import { playerSlugOf, type CardId } from '../../../app/lib/cards';
import { ExtractCache, hashText, pairKey, type QRec } from './cache';
import { cachePath, extractApplyEnabled, logExtractionOff, EXTRACT_PROMPT_VERSION, SAME_PROMPT_VERSION } from './config';
import type { Extraction } from './schema';
import { vetReference } from '../../../app/lib/watch-ref';
import { composePokemonKey } from '../../sub-markets';

/** The compact extraction a lot carries in the corpus (stripped from served). */
export type LotExtract = Partial<Extraction> & { h: string; v: string; src: 'llm' };
type XLot = AuctionLot & { llm?: LotExtract; reference?: string | null; referenceSrc?: string; description?: string | null };

export const CARD_SLUGS_X = new Set(['sports-cards', 'graded-cards']);
export const WATCH_SLUGS_X = new Set(['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier']);
export const POKEMON_SLUG_X = 'pokemon';

let cache: ExtractCache | null = null;
let cacheFile = '';
/** the one cache instance per process (normalize + build-market share it) */
export function extractCache(): ExtractCache {
  const f = cachePath();
  if (!cache || cacheFile !== f) { cache = ExtractCache.load(f); cacheFile = f; }
  return cache;
}
/** tests: drop the memoized cache */
export function resetExtractCache(): void { cache = null; cacheFile = ''; }

export function toLotExtract(f: Extraction, h: string): LotExtract {
  const o: LotExtract = { h, v: EXTRACT_PROMPT_VERSION, src: 'llm' };
  for (const [k, val] of Object.entries(f)) {
    if (val === null || val === false || (Array.isArray(val) && val.length === 0)) continue;
    (o as Record<string, unknown>)[k] = val;
  }
  return o;
}

/** NORMALIZE PASS 0 — stamp `llm` on every lot whose CURRENT text has a
 *  validated cache entry. Must run before any pass that rewrites titles (the
 *  hash is of the crawled text the runner sent). Never removes an existing
 *  stamp (build-market's re-normalize reads healed titles whose hash moved). */
export function attachExtractions(lots: AuctionLot[]): number {
  if (!extractApplyEnabled()) { logExtractionOff('normalize'); return 0; }
  const c = extractCache();
  if (!c.x.size) { console.log('[extract] apply on, cache empty — nothing to attach'); return 0; }
  let n = 0;
  for (const l of lots as XLot[]) {
    const r = c.x.get(String(l.id));
    if (!r || !r.f || r.v !== EXTRACT_PROMPT_VERSION) continue;
    if (l.llm && l.llm.h === r.h) continue;
    const h = hashText(String(l.title ?? ''), String(l.description ?? ''));
    if (h !== r.h) continue;
    l.llm = toLotExtract(r.f, h); n++;
  }
  console.log(`[extract] attached ${n} cached extractions (cache ${c.x.size} lots, prompt ${EXTRACT_PROMPT_VERSION})`);
  return n;
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** NORMALIZE — after enrichWatchReferences: fill a still-empty watch
 *  `reference` from the (grounded) extraction. The brand, when the model read
 *  one, must be the lot's own maker slug. Never overwrites. */
export function fillWatchReferencesFromExtract(lots: AuctionLot[]): number {
  if (!extractApplyEnabled()) return 0;
  let n = 0;
  for (const l of lots as XLot[]) {
    const x = l.llm;
    if (!x?.reference || !WATCH_SLUGS_X.has(l.artist) || (l.reference && String(l.reference).length)) continue;
    if (x.vertical && x.vertical !== 'watch') continue;
    if (x.brand && slug(x.brand) !== l.artist) continue;
    // a movement / case serial the model quoted is not a reference (Sep 28)
    if (!vetReference(l.artist, String(x.reference), l.title)) continue;
    l.reference = x.reference; l.referenceSrc = 'llm'; n++;
  }
  if (n) console.log(`[extract] watch references filled from extraction: ${n}`);
  return n;
}

// ── condition flags ──────────────────────────────────────────────────────────
const SEVERE = new Set(['altered', 'trimmed', 'restored', 'recolored', 'reprint', 'replica', 'damaged', 'missing_parts', 'aftermarket', 'service_parts']);
/** The extraction read a defect the title regex may have missed. */
export function llmConditionFlag(l: AuctionLot): boolean {
  const x = (l as XLot).llm;
  return !!x?.condition_flags?.some(f => SEVERE.has(f));
}

// ── cards ────────────────────────────────────────────────────────────────────
export type MergedCardId = CardId & { llmFilled?: string[] };
// cards.ts GRADER_ANY_RE's grader set (never the PSA/DNA autograph form)
const REGEX_GRADER_RE = /\b(PSA|BGS|SGC|CGC|BVG|CSG|HGA)\b(?!\s*\/\s*DNA)/i;

/** Year as the regex writes it: leading 4-digit (+ optional -yy). */
function normYear(y: string): string | null {
  const m = y.match(/^(\d{4})(?:-(\d{2}))?$/);
  if (m) return m[2] ? `${m[1]}-${m[2]}` : m[1];
  const r = y.match(/^(\d{4})-\d{4}$/);
  return r ? r[1] : null;
}

/** The set name the REGEX convention would have read (title words between the
 *  year and the card number) when the number sits in the title without '#' —
 *  so an extracted key lands in the SAME pool as regex-keyed copies. */
function setBetween(title: string, year: string, cardNo: string): string | null {
  const t = title.replace(/\([^)]*\)/g, ' ');
  const yi = t.indexOf(year.slice(0, 4));
  if (yi < 0) return null;
  let rest = t.slice(yi + year.slice(0, 4).length).replace(/^-\d{2,4}\b/, '');
  const re = new RegExp(`(?:^|\\s)#?${cardNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|[,;])`, 'i');
  const m = rest.match(re);
  if (!m || m.index == null) return null;
  rest = rest.slice(0, m.index).replace(/\s+/g, ' ').trim();
  return rest && rest.length <= 70 ? rest : null;
}

/** Merge a lot's extraction into its regex CardId. Returns the SAME object
 *  when there is nothing to merge (or apply is off). */
export function mergeCardExtract(c: CardId, l: AuctionLot): CardId {
  const x = (l as XLot).llm;
  if (!x || !extractApplyEnabled()) return c;
  if (x.vertical !== 'sports_card' || x.single_item === false) return c;
  const out: MergedCardId = { ...c };
  const filled: string[] = [];
  const title = String(l.title ?? '');
  if (!out.year && x.year) { const y = normYear(x.year); if (y) { out.year = y; filled.push('year'); } }
  if (!out.cardNo && x.card_number) { out.cardNo = x.card_number.replace(/^#/, '').toUpperCase(); filled.push('cardNo'); }
  if (!out.player && x.subject) {
    out.player = x.subject; out.playerSlug = playerSlugOf(x.subject); filled.push('player');
  }
  if (!out.setName && out.year && out.cardNo && filled.includes('cardNo')) {
    const s = setBetween(title, out.year, out.cardNo) ?? x.set ?? null;
    if (s) { out.setName = s; filled.push('setName'); }
  }
  if (out.serialOf == null && x.serial_run) { out.serialOf = x.serial_run; filled.push('serialOf'); }
  // GRADE — never over a hard regex match. Fill only when the regex found no
  // card grade at all: nothing named (raw), or a grader named whose grade did
  // not parse (gradeUnparsed — the model must name that same grader).
  const regexHasGrade = out.gradeNum != null || out.gradeTag != null;
  if (!regexHasGrade && x.grading_company && x.grade) {
    // gradeUnparsed leaves gradeCo null, so "same grader" is checked against
    // the title's own grader words (grounding already proved the model's
    // grader is named in the text)
    const namedCo = (title.match(REGEX_GRADER_RE) || [])[1]?.toUpperCase() ?? null;
    if (!namedCo || namedCo === x.grading_company || (namedCo === 'BVG' && x.grading_company === 'BGS')) {
      out.gradeCo = x.grading_company;
      if (x.grade === 'A') out.gradeTag = 'A'; else out.gradeNum = parseFloat(x.grade);
      out.gradeUnparsed = false;
      if (x.grade_qualifier && !out.gradeQual) out.gradeQual = x.grade_qualifier;
      filled.push('grade');
    }
  } else if (regexHasGrade && !out.gradeQual && x.grade_qualifier
      && x.grading_company === out.gradeCo && x.grade != null && parseFloat(x.grade) === out.gradeNum) {
    // both agree on company + grade → the model may add the qualifier the
    // regex's "(OC)"-adjacent pattern missed ("PSA 8 Off-Center")
    out.gradeQual = x.grade_qualifier; filled.push('gradeQual');
  }
  if (!out.autoGrade && x.autograph_grade && (out.auto || x.autograph)) { out.autoGrade = x.autograph_grade; filled.push('autoGrade'); }
  if (!filled.length) return c;
  out.llmFilled = filled;
  return out;
}

// ── pokémon ──────────────────────────────────────────────────────────────────
const PKMN_GRADERS = new Set(['PSA', 'BGS', 'CGC', 'SGC']);

/** The pokemonKey (sub-markets.ts format, composePokemonKey) built from the
 *  extraction — called ONLY where the regex pokemonKey returned null. */
export function pokemonKeyFromExtract(l: AuctionLot): string | null {
  const x = (l as XLot).llm;
  if (!x || l.artist !== POKEMON_SLUG_X || !extractApplyEnabled()) return null;
  if (x.vertical !== 'pokemon_card' || x.single_item === false) return null;
  if (!x.year || !x.card_number || !x.grading_company || !x.grade || x.grade === 'A') return null;
  if (!PKMN_GRADERS.has(x.grading_company)) return null;
  const t = String(l.title ?? '');
  const yr = x.year.slice(0, 4);
  const no = x.card_number.replace(/^#/, '');
  if (!/^[A-Za-z0-9]+$/.test(no)) return null;
  const between = t.indexOf(yr) >= 0 ? setBetween(t, yr, no) : null;
  // the character: the title after the number token, else the extraction's subject
  const nm = t.match(new RegExp(`(?:^|\\s)#?${no}(?=\\s|$|[,;])`, 'i'));
  const afterNo = nm && nm.index != null ? t.slice(nm.index + nm[0].length) : (x.subject ?? '');
  return composePokemonKey({ year: yr, setText: between ?? x.set ?? '', cardNo: no, afterNo, title: t, edition: x.edition, grade: `${x.grading_company}${x.grade}` });
}

// ── same-object veto ─────────────────────────────────────────────────────────
const PAIRS_PER_TARGET = 3;
/** Drop pool members the same-object check judged a DIFFERENT item; queue the
 *  target's most recent unjudged comps for the next nightly run. Returns the
 *  SAME array when apply is off or nothing is vetoed. */
export function sameObjectFilter<T extends AuctionLot>(target: AuctionLot, pool: T[], opts: { queue?: boolean } = {}): T[] {
  if (!extractApplyEnabled() || !pool.length) return pool;
  const c = extractCache();
  const tt = { title: String(target.title ?? ''), description: String((target as XLot).description ?? '').slice(0, 1800) };
  const ht = hashText(String(target.title ?? ''), String((target as XLot).description ?? ''));
  let queued = 0;
  const keep: T[] = [];
  let vetoed = 0;
  // most recent first — the comps that carry the most weight get judged first
  const byRecency = pool.slice().sort((a, b) => (a.saleDate < b.saleDate ? 1 : a.saleDate > b.saleDate ? -1 : 0));
  const verdict = new Map<T, boolean | null>();
  for (const s of byRecency) {
    const hs = hashText(String(s.title ?? ''), String((s as XLot).description ?? ''));
    if (hs === ht) { verdict.set(s, true); continue; }
    const p = c.getPair(ht, hs, SAME_PROMPT_VERSION);
    if (p) { verdict.set(s, p.same); continue; }
    if (opts.queue !== false && queued < PAIRS_PER_TARGET && !c.p.has(pairKey(ht, hs))) {
      const q: QRec = { k: 'q', a: String(target.id), ha: ht, ta: tt, b: String(s.id), hb: hs,
        tb: { title: String(s.title ?? ''), description: String((s as XLot).description ?? '').slice(0, 1800) } };
      if (c.queuePair(q)) queued++;
    }
  }
  for (const s of pool) { if (verdict.get(s) === false) vetoed++; else keep.push(s); }
  return vetoed ? keep : pool;
}

/** build-market end: persist queued pairs (never in evalOnly). */
export function flushExtractQueue(): void {
  if (!extractApplyEnabled() || !cache || !cache.dirty) return;
  cache.save(cacheFile);
  console.log(`[extract] queued same-object pairs for the next run: ${cache.q.size}`);
}
