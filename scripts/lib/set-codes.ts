/**
 * set-codes.ts — the pre-war / vintage CARD SET CODE detector (the American
 * Card Catalog designations: T206, E224, D303, N172, R319, M101-4, W514, B18…).
 *
 * A title that LEADS with a year and one of these codes is a trading card (or a
 * card-format premium: cabinets, blankets, strip cards) regardless of the words
 * that follow — "1909-11 T206 White Border Ty Cobb with Bat" is a card, not a
 * game-used bat. Before this, classifySports only knew t20x/e9x, so ~13k REA /
 * H&S / Lelands / LOTG card lots (8k at REA alone) were filed as memorabilia or
 * game-used and priced against jerseys.
 *
 * ANCHORED ON PURPOSE: the code must sit right after the leading year (optionally
 * behind a lot number, "Signed", or a one-word maker) — Louisville Slugger bat
 * model codes (R43, W183, R226) and watch references appear later in a title and
 * never match. Year range 1860–1959 = the ACC's pre-modern era.
 */
export const LEADING_SET_CODE =
  /^\s*(?:\d{1,4}\s+)?(?:[Ss]igned\s+)?(?:[Cc]\.?\s*|[Cc]irca\s+)?(?:18[6-9]\d|19[0-5]\d)(?:[-/](?:\d{2}|\d{4}))?\s+(?:[A-Z][A-Za-z&.'’]+\s+)?(?:T\d{1,3}|E\d{2,3}|D\d{2,3}|N\d{2,3}|R\d{3}|M\d{3}|W\d{3}|H\d{3}|B\d{2}|F\d{2,3}|V\d{3}|U\d{2,3}|PC\d{3})(?:-\d{1,2})?\b/;

/** true when the title leads with a vintage card-set designation */
export function leadsWithSetCode(title: string | null | undefined): boolean {
  return LEADING_SET_CODE.test(String(title || ''));
}
