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
const SPORTS_SALE = /(^|[-/ ])(sports?|memorabilia|baseball|basketball|football|soccer|hockey|olympic|cricket|tennis|golf|boxing|wrestling|wimbledon|maradona|pele|\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b|super[- ]?bowl|world[- ]series|world[- ]cup|stanley[- ]cup|ryder[- ]cup|masters|grand[- ]slam|extra[- ]innings|vintage[- ]sports|american[- ]greats|game[- ](used|worn)|game[- ]worn[- ]icons|sneakers?|the[- ]one)([- /]|$)/i;
const NOT_SPORTS_SALE = /sporting[- ](guns?|rifles?|firearms?|art|pictures?)|decorative[- ]sporting|topographi|antique[- ](arms|firearms)|arms[- ](and[- ])?armou?r|shotguns?|\bwine\b|whisk|handbags?/i;

export function isSportsSale(slug: string): boolean {
  const s = slug.toLowerCase();
  return SPORTS_SALE.test(s) && !NOT_SPORTS_SALE.test(s);
}

const CARD_MAKERS = /\b(topps|panini|bowman|upper deck|fleer|donruss|goudey|leaf|o-pee-chee|rookie card|trading card|tobacco (card|silk))\b/i;
const NON_SPORT_TCG = /\bpok[eé]mon\b|yu-?gi-?oh|magic the gathering|\bmtg\b/i;
const GAME_USED = /\b(game[- ](used|worn|issued)|match[- ](used|worn)|player[- ]worn|team[- ]issued|tour[- ](used|worn)|worn (jersey|uniform|cleats|boots|gloves|jacket|cap|shirt|kit)|game (bat|ball|jersey|uniform|glove|worn)|match[- ]worn (shirt|jersey|boots)|bat used|ball used)\b/i;
const TROPHY = /\b(trophy|championship (ring|trophy|belt|pennant)|title belt|winners? medal|olympic (medal|torch)|world series (ring|trophy)|super bowl ring|mvp award|heisman|vince lombardi|stanley cup|green jacket|lombardi trophy|\bmedal\b|championship pennant)\b/i;
const TICKET = /\b(ticket|stub|full ticket|season pass|press pass|all[- ]access (pass|credential)|programme?|scorecard|score card|score book)\b/i;

/** Route a lot KNOWN to be from a sports sale → a sports vertical slug, or null
 *  to drop (non-sport TCG). Everything sport that isn't a specific object type
 *  falls to sports-memorabilia (autographs, photos, equipment, ephemera). */
export function routeSportsLot(title: string, description = ''): string | null {
  const t = `${title} ${description}`.toLowerCase();
  if (NON_SPORT_TCG.test(t)) return null;      // a Pokémon lot in a mixed sale
  if (GAME_USED.test(t)) return 'game-used';
  if (TROPHY.test(t)) return 'trophies-awards';
  if (TICKET.test(t)) return 'tickets-passes';
  if (CARD_MAKERS.test(t)) return 'sports-cards';
  return 'sports-memorabilia';                 // the catch-all — still a sport item
}
