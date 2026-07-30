/**
 * culture.ts — routing for the POP CULTURE vertical: high-end 1/1 cultural
 * artifacts, never the mass market. Collin's scope: screen-used film/TV props
 * & costumes, stage-worn/played music pieces, handwritten original lyrics, and
 * iconic entertainment/historic memorabilia — NOT comics, cards, video games,
 * VHS, vinyl, toys, posters (all mass-produced/graded). Broad-but-curated: no
 * price floor, the signal is the curation.
 *
 * Two entry points, mirroring sports-sale.ts:
 *  - routeCulture(title): for Goldin's curated Pop-Culture/Entertainment/
 *    Rock-N-Roll/History sub-categories — drops any mass signal, routes the rest.
 *  - isCultureSale(slug) + the same router: for Sotheby's/Christie's popular-
 *    culture SALES (the sale is the signal).
 */

// mass / graded / reproduced — never in this vertical, even inside a pop-culture
// sale. NOTE the deliberate `s?` on comic/card nouns: `\bcomic\b` never matches
// "Comics", so the plural must be spelled out or the whole class leaks.
const MASS = /\b(comics?|single cards?|trading cards?|rookie cards?|art cards?|pok[eé]mon|yu-?gi-?oh|magic the gathering|\btcg\b|\bcgc\b|\bcbcs\b|\bwata\b|\bvga\b|graded (comics?|cards?|game)|video ?game|nintendo|playstation|\bxbox\b|sega|atari|\bvhs\b|betamax|\bfunko\b|bobblehead|\blego\b|action figure|trading pins?|sealed\s*(cds?|cassette|vinyl|record|dvd|blu-?ray|box|case|pack)|booster (box|pack)|wax pack|vinyl records?|\blp\b record|\b45 rpm\b|\b45 sleeve|cassette|\bcds?\b|reprint|reproduction|replica|movie poster|one[- ]sheet|lobby cards?|\bposters?\b(?!.* signed)|first edition|\bmint\b set|jigsaw|puzzles?\b|coloring book|sheet music|\bmagazine\b|picture puzzle|milk caps?|\bpogs?\b|\bdecals?\b|pennants?|coins? and currency|sticker album)\b/i;
// trading-card sets & graded slabs — the biggest mass leak inside Goldin's
// Non-Sport curated sub-cats. Card/comic brands, graded-slab grades (incl.
// Beckett's numeric scale), and the anime/TCG flood (Weiss Schwarz, Dragon
// Ball Super, Glu3Trap "encased" custom cards, etc.) identify a card
// regardless of price.
const CARD = /\b(leaf|topps|panini|donruss|fleer|bowman|upper deck|score board|press pass|decision 20\d\d|allen & ginter|goodwin|inkworks|skybox|rittenhouse|classics illustrated|o-pee-chee|pacific trading|weiss schwarz|lycee|yuzusoft|azur lane|hololive|arifureta|grisaia|\bnikke\b|dragon ball super|bushiroad|cardfight|vanguard|precious memories|chaos tcg|glu3trap|kaijuu)\b|\b(psa|bgs|sgc|cgc|cbcs|beckett)\s*\d(\.\d)?\b|\b(gold|blue|silver|secret|holo)?\s*signature\s*#|\bencased\b|\b(ssp|scr|spr|ssr)\b/i;
// a numbered-collectible LOT — 2+ "#" tokens, or a comma-run of issue numbers
// after one ("#57, 94, 99, 102"): the signature of card/comic bulk lots.
function isNumberedLot(t: string): boolean {
  if ((t.match(/#/g) || []).length >= 2) return true;
  return /#\s?\d{1,4}(\s*,\s*\d{1,4}){1,}/.test(t);
}
// film & TV: something USED in a production, not merch about it
const MOVIE_TV = /\b(screen[- ](used|matched|worn)|hero prop|production[- ]used|prop from|\bprop\b|costume worn in|worn (in|on)[- ]?(screen|the film|the show)|film[- ]used|movie[- ]used|screen[- ]worn|animatronic|maquette|matte painting|storyboard|shooting script|call sheet|continuity|studio prop|filming (miniature|model)|worn by .* in (the )?(film|movie|series|show))\b/i;
// music: worn/played on stage, or the words themselves
const MUSIC = /\b(stage[- ](worn|played|used)|performance[- ]worn|concert[- ]worn|tour[- ](worn|used)|played on stage|worn on stage|handwritten lyrics?|original lyrics?|autograph(ed)? lyrics?|lyric sheet|working lyrics?|manuscript.*(song|lyric)|played (guitar|bass|drums?|piano)|smashed guitar|owned and played|road[- ]used|riaa|gold record award|platinum record award|signed (guitar|drumhead|drum head|bass))\b/i;

/** Route a lot KNOWN to be pop-culture (Goldin curated sub-cat, or a pop-
 *  culture sale) → a culture slug, or null to drop it as mass/graded. */
// natural-history / fine-art-photography lots that ride into a culture sale but
// belong to science/art — a fossil skeleton or a Helmut Newton print is not
// pop-culture memorabilia.
const NOT_CULTURE_LOT = /\b(fossil|skeleton|oviraptor\w*|dinosaur|tyrannosaur\w*|[a-z]+saurus|triceratops|mammoth|mastodon|meteorite|mineral specimen|ammonite|trilobite|gelatin silver print|chromogenic print|c-print|helmut newton|irving penn|richard avedon)\b/i;
/** Route a lot KNOWN to be pop-culture (Goldin curated sub-cat, or a pop-
 *  culture sale) → a culture slug, or null to drop it as mass/graded. */
export function routeCulture(title: string, description = ''): string | null {
  const t = `${title} ${description}`.toLowerCase();
  if (MASS.test(t) || CARD.test(t) || isNumberedLot(t) || NOT_CULTURE_LOT.test(t)) return null;
  if (MOVIE_TV.test(t)) return 'movie-tv';
  if (MUSIC.test(t)) return 'music-memorabilia';
  return 'entertainment-memorabilia'; // the iconic/historic catch-all
}

// A Sotheby's/Christie's sale slug that IS a pop-culture sale. Their "popular
// culture" / music / entertainment sales. EXCLUDES handbags, wine, watches,
// and the sports sales (those route via sports-sale.ts).
// NOTE two false friends learned the hard way (Christie's backlog): bare
// "music" caught antique MECHANICAL MUSIC / music boxes / automata, and
// "icons" caught ORTHODOX/RUSSIAN religious icons & Objects of Vertu — both
// nuked below. "music" here must carry a pop/rock context.
const CULTURE_SALE = /(^|[-/ ])(popular[- ]culture|pop[- ]culture|entertainment|hollywood|pop[- ]?music|rock[- ](and|&)[- ]pop|music[- ]memorabilia|rock[- ]?n[-' ]?roll|hip[- ]hop|the[- ]beatles|freddie[- ]mercury|memorabilia|icons?|glamour[- ](and|&)[- ]style|an[- ]american[- ]icon|monsters[- ]of|the[- ]one[- ]that|stage[- ]worn|screen[- ]worn|film[- ](and|&)[- ]entertainment)([-/ ]|$)/i;
const NOT_CULTURE_SALE = /handbags?|wine|whisk|jewel|watch|sport|baseball|basketball|football|hockey|soccer|olympic|golf|tennis|firearms?|arms[- ]|comics?|trading[- ]cards?|mechanical[- ]music|automat(a|on|ons)|music[- ]box|musical[- ]instrument|barrel[- ]organ|technical[- ]apparatus|\bradios?\b|orthodox|russian|byzantine|portrait[- ]miniature|objects?[- ]of[- ]vertu|\bvertu\b|ecclesiastic|religious|tapestr|country[- ]furniture|works[- ]of[- ]art|\bdolls?\b|doll[- ']?s[- ]hous|photographs?|old[- ]masters?|impressionist|natural[- ]history|fossils?|dinosaur|meteorite|mineral/i;

export function isCultureSale(slug: string): boolean {
  const s = slug.toLowerCase();
  return CULTURE_SALE.test(s) && !NOT_CULTURE_SALE.test(s);
}
