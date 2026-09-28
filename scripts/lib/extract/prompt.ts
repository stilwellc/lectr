/**
 * extract/prompt.ts — the frozen system prompts (field extraction + same-object
 * check). FROZEN means byte-stable: they are the cached prefix of every batch
 * request, so nothing volatile (dates, counts, ids) may appear here. Any edit
 * must bump EXTRACT_PROMPT_VERSION / SAME_PROMPT_VERSION (config.ts), which
 * invalidates the result cache for re-extraction.
 *
 * The 15 worked examples are REAL corpus lots (Goldin, REA, Memory Lane,
 * Christie's, Bonhams, Sotheby's), chosen from the regex parsers' measured miss
 * classes: card numbers without '#', a house lot number leading the title,
 * SGC's legacy 100-point scale, dual-graded autograph slabs, sealed product,
 * non-card memorabilia, Pokémon sets whose names contain numbers, and watch
 * descriptions where movement / case numbers sit next to (or instead of) the
 * reference.
 */
import type { Extraction } from './schema';

const BLANK: Extraction = {
  vertical: 'other', single_item: true, year: null, set: null, card_number: null, subject: null,
  parallel: null, serial_run: null, autograph: false, relic: false, rookie: false,
  grading_company: null, grade: null, grade_qualifier: null, autograph_grade: null,
  language: null, edition: null, brand: null, reference: null, material: null,
  complications: [], condition_flags: [],
};

interface Example { title: string; description?: string; out: Partial<Extraction>; note?: string }

export const EXAMPLES: Example[] = [
  {
    title: '2023 Topps Chrome SP 62 Aaron Judge – PSA GEM MT 10',
    out: { vertical: 'sports_card', year: '2023', set: 'Topps Chrome', card_number: '62', subject: 'Aaron Judge', parallel: 'SP', grading_company: 'PSA', grade: '10', brand: 'Topps' },
    note: 'the card number has no "#": a bare number between the set and the player is the card number',
  },
  {
    title: '77 1962 Topps #300 Willie Mays PSA 8 NM-MT',
    out: { vertical: 'sports_card', year: '1962', set: 'Topps', card_number: '300', subject: 'Willie Mays', grading_company: 'PSA', grade: '8', brand: 'Topps' },
    note: 'the leading "77" is the auction house\'s lot number, not a year',
  },
  {
    title: '1909-1911 T206 White Border Rube Marquard Portrait SGC VG/EX 50',
    out: { vertical: 'sports_card', year: '1909-1911', set: 'T206 White Border', subject: 'Rube Marquard', parallel: 'Portrait', grading_company: 'SGC', grade: '4' },
    note: 'SGC legacy 100-point grade 50 = 4 on the 1-10 scale; T206 cards carry no printed number, so card_number stays null',
  },
  {
    title: '2024 Panini National Treasures Rookie Patch Autographs (RPA) Black #156 J.J. McCarthy Signed Patch Rookie Card (#5/5) - PSA NM-MT 8, PSA/DNA GEM MT 10',
    out: { vertical: 'sports_card', year: '2024', set: 'Panini National Treasures Rookie Patch Autographs', card_number: '156', subject: 'J.J. McCarthy', parallel: 'Black', serial_run: 5, autograph: true, relic: true, rookie: true, grading_company: 'PSA', grade: '8', autograph_grade: '10', brand: 'Panini' },
    note: 'dual-graded: the card grade is 8; "PSA/DNA GEM MT 10" is the AUTOGRAPH grade. (#5/5) is serial 5 of a run of 5',
  },
  {
    title: '2023 Panini Select Dragon Scale Prizm #189 Cameron Johnson (#2/8) - PSA MINT 9',
    out: { vertical: 'sports_card', year: '2023', set: 'Panini Select', card_number: '189', subject: 'Cameron Johnson', parallel: 'Dragon Scale Prizm', serial_run: 8, grading_company: 'PSA', grade: '9', brand: 'Panini' },
  },
  {
    title: '1956 Topps #130 Willie Mays, Gray Back - PSA NM-MT 8 (OC)',
    out: { vertical: 'sports_card', year: '1956', set: 'Topps', card_number: '130', subject: 'Willie Mays', parallel: 'Gray Back', grading_company: 'PSA', grade: '8', grade_qualifier: 'OC', brand: 'Topps' },
    note: '(OC) qualifies the grade: a PSA 8 (OC) is a different item from a clean PSA 8',
  },
  {
    title: '1995 Bowman Baseball Factory-Sealed Hobby Box (20 Packs) - Possible Vladimir Guerrero, Andruw Jones, Scott Rolen Rookie Cards',
    out: { vertical: 'sports_card', single_item: false, year: '1995', set: 'Bowman Baseball', brand: 'Bowman' },
    note: 'sealed product: not a single card; "possible" players are NOT the subject; never report a card number or grade for a box',
  },
  {
    title: 'Joe Montana Signed San Francisco 49ers Full-Size Football Helmet - Beckett',
    out: { vertical: 'other', subject: 'Joe Montana', autograph: true },
    note: 'memorabilia, not a card: Beckett here authenticates a signature, it is not a card grade',
  },
  {
    title: '1999 Pokemon Jungle 49 Bellsprout – PSA MINT 9',
    out: { vertical: 'pokemon_card', year: '1999', set: 'Jungle', card_number: '49', subject: 'Bellsprout', grading_company: 'PSA', grade: '9', language: 'english', edition: 'unlimited' },
    note: 'an English WOTC-era card with no "1st Edition" or "Shadowless" wording is unlimited',
  },
  {
    title: '2023 Pokemon Japanese Sv2A-Pokemon 151 Super Rare 190 Alakazam Ex – PSA GEM MT 10',
    out: { vertical: 'pokemon_card', year: '2023', set: 'Pokemon 151', card_number: '190', subject: 'Alakazam ex', parallel: 'Super Rare', grading_company: 'PSA', grade: '10', language: 'japanese' },
    note: '"151" is part of the set name (SV2a Pokemon 151); the card number is 190',
  },
  {
    title: '1999 Pokemon Base Set Blastoise Shadowless Short Crimp - PSA NM-MT 8',
    out: { vertical: 'pokemon_card', year: '1999', set: 'Base Set', subject: 'Blastoise', parallel: 'Short Crimp', grading_company: 'PSA', grade: '8', language: 'english', edition: 'shadowless' },
    note: 'no number is printed in the text, so card_number is null — never supply one from memory',
  },
  {
    title: '2006 Pokemon EX Legend Maker #83 Arcanine EX-Holo - PSA Authentic Altered',
    out: { vertical: 'pokemon_card', year: '2006', set: 'EX Legend Maker', card_number: '83', subject: 'Arcanine ex', parallel: 'Holo', grading_company: 'PSA', grade: 'A', language: 'english', edition: 'unlimited', condition_flags: ['altered'] },
  },
  {
    title: 'Rolex. A fine stainless steel automatic twin time zone wristwatch with stainless steel bracelet together with Rolex box and papers',
    description: 'GMT-Master, Ref:1675, Made in 1966, Sold 11th November 1967',
    out: { vertical: 'watch', year: '1966', brand: 'Rolex', subject: 'GMT-Master', reference: '1675', material: 'stainless steel', complications: ['gmt'] },
  },
  {
    title: 'PATEK PHILIPPE. A VERY RARE 18K YELLOW GOLD KEYLESS LEVER MONOPUSHER CHRONOGRAPH WATCH WITH ENAMEL PULSATIONS DIAL SIGNED PATEK, PHILIPPE & CIE, GENEVE, MONOPUSHER CHRONOGRAPH, MOVEMENT NO. 157\'016, CASE NO. 271\'325, MANUFACTURED IN 1910',
    out: { vertical: 'watch', year: '1910', brand: 'Patek Philippe', material: '18k yellow gold', complications: ['chronograph'] },
    note: 'movement and case numbers are serials, NEVER the reference; this lot states no reference, so reference is null',
  },
  {
    title: 'a yellow gold wristwatchref 1509 mvt 926763 case 637418 made in 1945',
    out: { vertical: 'watch', year: '1945', reference: '1509', material: 'yellow gold' },
    note: 'the maker is not named in the text, so brand is null; "mvt"/"case" numbers are serials',
  },
];

function render(ex: Example): string {
  const out: Extraction = { ...BLANK, ...ex.out };
  const input = ex.description ? `TITLE: ${ex.title}\nDESCRIPTION: ${ex.description}` : `TITLE: ${ex.title}`;
  return `<example>\n${input}\n${ex.note ? `WHY: ${ex.note}\n` : ''}OUTPUT: ${JSON.stringify(out)}\n</example>`;
}

export const EXTRACT_SYSTEM = `You extract structured identity fields from ONE auction lot listing for a price-comparison engine. Your output decides which past sales count as "the same item", so a wrong value is worse than a null.

The lot is described only by its TITLE and (optional) DESCRIPTION. Use ONLY what that text states. Do not use outside knowledge to fill in a card number, set, year, reference, grade, or maker that the text does not state — if it is not written, return null. Never guess a reference number from a model name, a card number from a player, or a year from a set.

Fields:
- vertical: "sports_card" (a trading card of an athlete/sport/entertainment set), "pokemon_card" (Pokémon TCG cards and Pokémon sealed product), "watch" (wristwatches, pocket watches), or "other" (memorabilia, jerseys, balls, photos, jewelry, art, anything else).
- single_item: false for a lot of multiple items, a set, a collection, a sealed box/pack/case/tin, or a "lot of N"; true for one card or one watch.
- year: the year or season as written ("1996-97", "1909-1911"). A number at the very start of a title that is followed by a four-digit year is the house's lot number, not a year.
- set: the product/set name without the year, brand-level noise words like "Pokemon" or "Baseball" may be kept if written. For cards: "Topps Chrome", "Panini Prizm", "T206 White Border", "Jungle", "Pokemon 151".
- card_number: the printed card number as written, without "#" ("62", "SP1", "TG06", "CAAU-CK"). It may appear with or without "#". Never the serial numbering ("5/5"), never a population count ("Pop 2"), never a lot number.
- subject: the athlete, person, or Pokémon the card depicts (for watches: the model name such as "Submariner", "Nautilus", "Tank"). Null when there are several.
- parallel: the insert / parallel / variant / rarity words as written ("Silver Prizm", "Refractor", "Black", "Reverse Holo", "Full Art", "SP"). Null if none.
- serial_run: the print run N from serial numbering "x/N" or "#/N" (integer). 1 for a 1/1. Null if not serial-numbered.
- autograph / relic / rookie: true only when the text says signed/autograph/auto, patch/jersey/relic/memorabilia card, rookie/RC.
- grading_company: the CARD grader: PSA, BGS (Beckett Grading), SGC, CGC, BVG, CSG, HGA, TAG, ISA, GMA, KSA, ACE. "PSA/DNA" or "JSA" or "Beckett" authenticating an autograph on a non-card object is NOT a card grade. Null for raw/ungraded.
- grade: the CARD grade on the 1–10 scale as a string ("10", "9.5", "8"), or "A" for Authentic/Altered slabs with no number. Convert SGC's legacy 100-point scale: 100/98→10, 96→9, 92→8.5, 88→8, 86→7.5, 84→7, 80→6, 70→5.5, 60→5, 55→4.5, 50→4, 45→3.5, 40→3, 35→2.5, 30→2, 20→1.5, 10→1.
- grade_qualifier: OC (off-center), MK (marks), ST (stain), PD (print defect), MC (miscut), OF (out of focus) when written next to the grade. Null otherwise.
- autograph_grade: the separate grade of the AUTOGRAPH on a dual-graded slab ("PSA/DNA 10", "Auto 10", "Beckett 10" after a card grade); "A" for "PSA/DNA Authentic". Null otherwise.
- language: for Pokémon cards: "japanese", "korean", "chinese" when stated, "english" when the set is an English release and no other language is stated; null for non-Pokémon lots.
- edition: Pokémon only: "1st" for 1st Edition, "shadowless" for Shadowless, "unlimited" for other English WOTC-era (1999-2003) cards; null otherwise.
- brand: the card manufacturer (Topps, Panini, Upper Deck, Bowman, Fleer…) or the watch maker (Rolex, Patek Philippe, Audemars Piguet, Omega, Cartier…) as named in the text.
- reference: WATCHES ONLY — the model reference number as stated ("Ref. 5512", "reference 3968", "Ref:1675" → "5512", "3968", "1675"). Movement numbers, case numbers, serial numbers, calibre numbers and "No." numbers are NOT references. Null if none stated.
- material: watches only — case material as written ("stainless steel", "18k yellow gold", "platinum", "two-tone").
- complications: watches only — from the allowed list, only those the text states.
- condition_flags: from the allowed list, only defects the text states (altered, trimmed, restored, recolored, crease, stain, writing, damaged, missing_parts, reprint, replica, polished, service_parts, aftermarket, not_running). A grade alone is not a defect.

Fields that do not apply to the lot's vertical are null (or false / empty list). Answer with the JSON object only.

Reference notes (how these listings are written — use them to READ the text, never to add facts it does not state):

Card titles by house.
- Goldin: "YEAR SET [insert/parallel] #NUMBER PLAYER [Rookie Card] [Signed] [(#serial/run)] - GRADER GRADE-WORDS GRADE". Example shapes: "2018 Panini Prizm Silver #280 Luka Doncic Rookie Card - PSA GEM MT 10", "2003 Upper Deck Exquisite Collection Rookie Patch Autographs #78 LeBron James Signed Patch Rookie Card (#/99) - BGS NM-MT+ 8.5, Beckett 10". Older Goldin titles use an en dash and omit "#": "1983 Topps 482 Tony Gwynn Rookie Card – PSA MINT 9".
- REA, Huggins & Scott, Lelands, Love of the Game: set-first with no dash before the grade: "1952 Topps #311 Mickey Mantle PSA VG-EX 4", "1909-1911 T206 White Border Honus Wagner SGC 30". Pre-war American Card Catalog sets (T206, T205, E90-1, R319 Goudey, N172 Old Judge, M101-4 Sporting News, W514 strip cards) often print no number; back advertisers ("Piedmont 350 Back", "Sweet Caporal", "Hindu", "American Beauty") are variants of the same card, report them as parallel.
- Memory Lane: the auction lot number leads the title ("234 1963 Topps #250 Stan Musial PSA 9 MINT") and grade words may FOLLOW the number ("PSA 8 NM-MT").
- Grade words and their numbers: GEM MT / GEM MINT / PRISTINE = 10 (BGS "Black Label" and "PRISTINE 10" are still grade 10), MINT = 9, NM-MT+ = 8.5, NM-MT = 8, NM+ = 7.5, NM = 7, EX-MT = 6, EX = 5, VG-EX = 4, VG = 3, GOOD = 2, FR / FAIR = 1.5, PR / POOR = 1. The printed number wins when words and number disagree; if only words are written, return the number the words stand for only when the grader is named.
- "PSA/DNA", "JSA", "Beckett (BAS)" LOAs certify autographs, not card condition. "PSA Authentic" / "SGC Authentic" / "Altered" slabs carry no numeric card grade (grade "A"). "Reholdered", "Crossover", "Pop 1", "Highest Graded", "None Higher" are population/holder notes, not grades or defects.
- Parallel and rarity vocabulary to copy as written: Refractor, X-Fractor, Superfractor, Prizm, Silver, Gold, Black, Red, Orange, Blue Wave, Mojo, Shimmer, Cracked Ice, Atomic, Printing Plate, Gold Vinyl, SP, SSP, Image Variation, Error, Die-Cut, Holo, Reverse Holo, Full Art, Alt Art, Secret Rare, Illustration Rare, Special Illustration Rare, Art Rare, Super Rare, Character Rare. Team or player names that contain colour words (Red Sox, Blue Jays, Vida Blue) are not parallels.
- Serial numbering appears as "(#04/15)", "(#/841)", "/99", "1/1", "One of One". The run is the number after the slash.

Pokémon listings.
- Goldin writes "YEAR Pokemon [Japanese] SET [rarity] [#]NUMBER NAME[-Holo] - GRADER GRADE". Japanese set codes appear before the set name: "SV2a" = Pokemon 151, "S12a" = VSTAR Universe, "S8b" = VMAX Climax, "SV4a" = Shiny Treasure ex, "S4a" = Shiny Star V; report the set NAME as written in the text (keep the code only if no name is written).
- WOTC-era English sets (1999–2003): Base Set, Jungle, Fossil, Base Set 2, Team Rocket, Gym Heroes, Gym Challenge, Neo Genesis, Neo Discovery, Neo Revelation, Neo Destiny, Legendary Collection, Expedition, Aquapolis, Skyridge. "1st Edition" and "Shadowless" are editions; everything else in those sets is unlimited. Modern sets have no edition (null).
- Numbers like "4/102" are card number 4 of a 102-card set: card_number "4" (never 102). "TG06", "SWSH050", "SV-P 001", "SM210" are promo / subset numbers: copy them as written without spaces.
- Sealed product (booster box, booster pack, Elite Trainer Box, tin, collection box, theme deck, "(36 Packs)") is never a single card: single_item false, no card_number, no grade.

Watch listings.
- Christie's: "MAKER. A [adjectives] MATERIAL [type] WRISTWATCH WITH [features] SIGNED MAKER, MODEL, REF. 5512, CASE NO. 818'687, CIRCA 1962". Phillips often omits the maker and model from the title and states "Ref. 1675" or "Reference 5711/1A-010" in the description. Sotheby's writes "model, reference 16238 | a yellow gold wristwatch | circa 1995". Bonhams writes "Ref:1675" or "Reference: 15202ST.OO.1240ST.01".
- Reference shapes by maker (to recognise, not to invent): Rolex 4–6 digits, sometimes with a letter suffix ("16610LV", "126710BLRO"); Patek Philippe 3–4 digits with an optional slash suffix ("2499", "5711/1A-010", "3970E"); Audemars Piguet alphanumeric ("15202ST", "25860ST", "5402ST"); Omega dotted codes or older "CK2998" / "ST 145.022"; Cartier "WSSA0018", "W1556233", "CRWJTA0024" or 4-digit catalogue numbers ("3968", "2301").
- NEVER a reference: "case no.", "movement no.", "mvt", "serial", "No. 1282855", calibre / "cal." numbers, jewel counts, diameters ("36 mm"), and dates.
- Material words: stainless steel, yellow gold, white gold, pink / rose gold (Rolex "Everose"), platinum, titanium, two-tone / steel and gold, ceramic, tantalum. Report the case material, not the bracelet or dial.
- Complications: chronograph (includes "monopusher", "flyback"), split_seconds ("rattrapante"), perpetual_calendar, annual_calendar, moon_phase ("moon phases"), minute_repeater, tourbillon, gmt ("dual time", "twin time zone", "GMT-Master"), world_time, date, day_date ("day, date"), alarm ("Memovox", "Cricket"), skeleton.
- Condition words to flag: "polished case" → polished, "service dial" / "replacement parts" / "later hands" → service_parts, "aftermarket" bezel or diamonds → aftermarket, "not running" / "requires service" → not_running.

${EXAMPLES.map(render).join('\n\n')}`;

/** The per-lot user turn. Description is capped (the essay tail of a
 *  Christie's watch lot never carries the reference the head does not). */
export const DESC_CAP = 1800;
export function extractUserTurn(title: string, description: string): string {
  const d = description && description.trim() && description.trim() !== title.trim()
    ? `\nDESCRIPTION: ${description.trim().slice(0, DESC_CAP)}` : '';
  return `TITLE: ${title.trim()}${d}`;
}

export const SAME_SYSTEM = `You decide whether two auction lots are the SAME tradable item for price comparison — the same identity, not the same physical object. Two sales are the same item when a collector would treat one as a valid price comparable for the other:
- Trading cards: same year, same set, same card number, same player/Pokémon, same parallel/variant and serial run, same grading company and same card grade (and same autograph grade when either is dual-graded), same language and edition for Pokémon. A different grade, a raw vs graded copy, a different parallel, a reprint, an altered/trimmed copy, or a lot of several cards is NOT the same item.
- Watches: same maker and same model reference; a different reference, a different case material, a replaced dial or aftermarket parts is NOT the same item.
Use ONLY the two lot texts given. If either text is too vague to decide, answer null. Answer with the JSON object only: {"same": true|false|null, "reason": "<one short sentence>"}.`;

export function sameUserTurn(a: { title: string; description: string }, b: { title: string; description: string }): string {
  return `LOT A:\n${extractUserTurn(a.title, a.description)}\n\nLOT B:\n${extractUserTurn(b.title, b.description)}`;
}
