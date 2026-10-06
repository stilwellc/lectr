/**
 * sports-sale.ts — sale-scoped sports routing for the Sotheby's/Christie's
 * historical backfills. Their auction-house lots don't carry Goldin's
 * category:['Sport'] flag, so the SALE is the signal: a lot from a sports sale
 * (cricket-tennis-golf, extra-innings-baseball, american-greats-vintage-sports,
 * game-worn-icons…) is a sports item — route ALL of them to the sports vertical
 * (specific slug by object signal, else the sports-memorabilia catch-all),
 * rather than dropping everything the narrow game-used/trophy/ticket regexes
 * miss (autographs, photos, programs, equipment, pennants).
 */

// A sale slug that IS a sports sale. Generous — a false positive costs the
// per-lot router, which still drops a non-sport lot. EXCLUDES the traps:
// "sporting guns/rifles/firearms" (weapons), "decorative sporting … prints"
// and "topographical" (sporting ART), and firearms/arms-&-armour sales.
// NOTE: bare "masters" was REMOVED — it was for golf's "The Masters" but
// matched "OLD MASTERS" / "Masters of Design" art sales and dumped ~$500M of
// Old Master paintings into sports-memorabilia (a classic false friend, like
// "music"/"icons" for culture). Golf sales already match "golf"; a Masters
// golf sale without the word "golf" is a rare miss, far better than the flood.
const SPORTS_SALE = /(^|[-/ ])(sports?|memorabilia|baseball|basketball|football|soccer|hockey|olympic|cricket|tennis|golf|boxing|wrestling|wimbledon|maradona|pele|\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b|super[- ]?bowl|world[- ]series|world[- ]cup|stanley[- ]cup|ryder[- ]cup|grand[- ]slam|extra[- ]innings|vintage[- ]sports|american[- ]greats|game[- ](used|worn)|game[- ]worn[- ]icons|sneakers?|the[- ]one)([- /]|$)/i;
// NOT_SPORTS_SALE also nukes art-sale slugs belt-and-suspenders (Old Masters,
// Impressionist/Modern, paintings & drawings, works on paper, 19th-century art).
// ...and culture-memorabilia sales that match via the bare "memorabilia"
// keyword (isSportsSale runs BEFORE isCultureSale, so "Entertainment
// Memorabilia" / "Rock & Pop" would wrongly land in sports without this).
// ...and mixed luxury sales: "sneakers?" pulled in a "Fine Watches AND Rare
// Sneakers" sale, routing the WATCHES (tourbillons, repeaters) into sports-
// memorabilia — so exclude watch/jewel sales here (they own the watch vertical).
const NOT_SPORTS_SALE = /sporting[- ](guns?|rifles?|firearms?|art|pictures?)|decorative[- ]sporting|topographi|antique[- ](arms|firearms)|arms[- ](and[- ])?armou?r|shotguns?|\bwine\b|whisk|handbags?|old[- ]masters?|masters[- ]of[- ]design|impressionist|modern[- ]art|paintings?[- ]drawings?|19th[- ]century|works[- ]on[- ]paper|entertainment[- ]memorabilia|film[- ](and|&)[- ]entertainment|rock[- ](and|&|n)[-' ]?pop|music[- ]memorabilia|pop[- ]culture|pop[- ]memorabilia|television|\bfilm\b|movie|posters|guitars?|rock[- ]roll|ocean[- ]?liner|transport|\bwatch(es)?\b|jewel|horolog/i;

export function isSportsSale(slug: string): boolean {
  const s = slug.toLowerCase();
  return SPORTS_SALE.test(s) && !NOT_SPORTS_SALE.test(s);
}

import { isCardTitle, sportsObjectKind } from './lib/classify';

const NON_SPORT_TCG = /\bpok[eé]mon\b|yu-?gi-?oh|magic the gathering|\bmtg\b/i;

/** Route a lot KNOWN to be from a sports sale → a sports vertical slug, or null
 *  to drop (non-sport TCG). Everything sport that isn't a specific object type
 *  falls to sports-memorabilia (autographs, photos, equipment, ephemera). */
export function routeSportsLot(title: string, description = ''): string | null {
  const t = `${title} ${description}`.toLowerCase();
  if (NON_SPORT_TCG.test(t)) return null;      // a Pokémon lot in a mixed sale
  // ONE ladder (Oct 6 2026 audit): the old order sent programmes/scorecards
  // to tickets and 65% of the catch-all was really autographs, programs,
  // photos or cards. Card detector first (title only — a description's
  // "Topps" provenance line is not the object), then the shared sports
  // object ladder over the title + the head of the description.
  if (isCardTitle(title)) return 'sports-cards';
  return sportsObjectKind(`${title} ${description.slice(0, 300)}`, 'sports-memorabilia');
}
