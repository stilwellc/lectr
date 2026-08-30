/**
 * identity.ts — exact-identity keys for NON-CARD verticals (Aug 14 audit).
 *
 * Cards got a tiered exact-identity ladder (cardKey) and it carries the
 * engine's best record. The corpus audit showed every other vertical has one
 * structured signal with the same shape, unused by comps:
 *   watches   — 32k sold lots carry a numeric reference; 2,124 refs have ≥3
 *               sales covering 40.9% of all sold watches (median 6 sales/ref)
 *   art       — 70% of art sold is heavily-editioned (Picasso/Warhol);
 *               editionKey already certifies the repeat-sale index
 *   autograph — RR spells out the format on 24% of science+culture titles
 *               ("typed letter signed", "document signed"); signer + format
 *               is how that market actually prices
 * These helpers feed similarity.ts (idExact match + format gate) and
 * sub-markets.ts (the art edition index key lives here now, one source).
 */
import type { AuctionLot } from '../types';
import { ARTISTS } from '../constants';

export const WATCH_SLUGS = new Set<string>(ARTISTS.filter(a => a.market === 'watches').map(a => a.slug));

/** Art-market maker slugs — scope key for the art-only AREA-RATIO comp gate in
 *  similarity.ts (Engine Spec v2 item 7, adopted Aug 30 2026; receipt there). */
export const ART_SLUGS = new Set<string>(ARTISTS.filter(a => a.market === 'art').map(a => a.slug));

/** Autograph-format verticals: science + culture + the sports autographs
 *  slug. (Pokémon moved to its own 'tcg' market Aug 21 2026, so the old
 *  not-pokémon carve-out is structural now.) An ALS and a signed photo of the
 *  same person are different markets; format mismatch is a comp gate here. */
export const AUTOGRAPH_SLUGS = new Set<string>([
  ...ARTISTS.filter(a => a.market === 'science' || a.market === 'culture').map(a => a.slug),
  'autographs',
]);

/** Numeric watch reference key — a true catalog ref (has a digit), not one of
 *  the 43 model-name tokens ("tank", "royaloak") the reference field also
 *  carries. Model names span materials/sizes/eras; numeric refs are the
 *  comp unit. */
export function numericWatchRef(l: Pick<AuctionLot, 'artist' | 'reference'>): string | null {
  if (!WATCH_SLUGS.has(l.artist) || !l.reference) return null;
  const r = String(l.reference).toLowerCase().replace(/\s+/g, '');
  return /\d/.test(r) ? `${l.artist}|${r}` : null;
}

/** Coarse case material — the price axis WITHIN a reference (a 3940 exists in
 *  three golds and platinum at very different money). null = unknown; an
 *  idExact ref match requires the materials not to conflict. */
export function watchMaterialCoarse(l: Pick<AuctionLot, 'title' | 'medium'>): string | null {
  const t = `${l.title || ''} ${l.medium || ''}`.toLowerCase();
  if (/\bplatinum\b/.test(t)) return 'platinum';
  if (/two[- ]tone|steel\s*(?:and|&|\/)\s*gold|gold\s*(?:and|&|\/)\s*steel/.test(t)) return 'two-tone';
  if (/\b(?:yellow|rose|pink|white)\s+gold\b|\b18k\b|\b14k\b|\bgold\b/.test(t)) return 'gold';
  if (/stainless|\bsteel\b/.test(t)) return 'steel';
  if (/\btitanium\b/.test(t)) return 'titanium';
  return null;
}

/** Edition-level art identity: same maker + same normalized title on a
 *  print/multiple pool. Strips edition numbering (22/50), AP/PP marks and
 *  dates so siblings of one edition pair up — model-level identity, like a
 *  watch reference. Callers must restrict to edition-structured lots
 *  (isEditionLot); unique originals must never enter this key. */
export function editionIdentityKey(l: Pick<AuctionLot, 'artist' | 'title'>): string | null {
  const t = (l.title || '').toLowerCase()
    .replace(/\b\d+\s*\/\s*\d+\b/g, '')
    .replace(/\b(ap|pp|hc|tp|ed\.?|edition|numbered|signed)\b/g, '')
    .replace(/\([^)]*\d{4}[^)]*\)/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length >= 8 ? `${l.artist}|${t}` : null;
}

export function isEditionLot(l: Pick<AuctionLot, 'formKey' | 'medium'>): boolean {
  const f = `${l.formKey || ''} ${l.medium || ''}`.toLowerCase();
  return /print|multiple|edition|poster|lithograph|screenprint|etching/.test(f);
}

/** Canonical autograph format from the title. RR mostly spells formats out
 *  (66k sold lots); the classic abbreviations are matched case-sensitively so
 *  "als"/"ds" inside ordinary words never fire. Order matters: ALS/TLS before
 *  the generic "letter signed". */
export function autographFormatOf(title: string | null | undefined): string | null {
  if (!title) return null;
  const t = title;
  if (/autograph(?:ed)? letter,? signed/i.test(t) || /\bALS\b/.test(t)) return 'als';
  if (/typed letter,? signed/i.test(t) || /\bTLS\b/.test(t)) return 'tls';
  if (/autograph(?:ed)? note,? signed/i.test(t) || /\bANS\b/.test(t)) return 'ans';
  if (/autograph(?:ed)? (?:quotation|quote|manuscript),? signed/i.test(t) || /\b(?:AQS|AMS|AMQS)\b/.test(t)) return 'aqs';
  if (/document,? signed|signed document/i.test(t) || /\bDS\b/.test(t)) return 'ds';
  if (/letter,? signed|signed letter/i.test(t) || /\bLS\b/.test(t)) return 'ls';
  if (/signed (?:check|bank check)|check,? signed/i.test(t)) return 'check';
  if (/signed (?:photo(?:graph)?|portrait)|photo(?:graph)?,? signed/i.test(t) || /\bSP\b/.test(t)) return 'sp';
  if (/signed book|book,? signed|signed (?:first|1st) edition/i.test(t)) return 'book';
  return null;
}
