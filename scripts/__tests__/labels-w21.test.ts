/**
 * W21 label audit (Oct 11 2026) — the rule causes behind the graded errors on
 * the live book, pinned to the real titles that exposed them:
 *   · display titles: headlines cut at an abbreviation ("ref. 2486" → "ref"),
 *     a model + its reference label read as a name duo ("Calatrava, Ref:
 *     2452" → "2452…"), "Charles Eames, Ray Eames:" losing only its first
 *     name, a reference read as a year ("Reference 1675" → "Reference, 1675"),
 *     shouting titles losing every name ("lou gehrig new york yankees"),
 *     Bonhams' glued fields, NFL Auction's tagline, Sotheby's Chinese pipes;
 *   · object kind: a Cartier COLLIER / earclips / demi-parure / Bague Trinity
 *     read wristwatch off the Panthère / Trinity model words; an "O-RING" and
 *     the "Poison Ring" gang read jewelry; a Shuttle "Crash and Rescue Manual"
 *     read wristwatch (Cartier Crash); artists' brooches read prints;
 *     Bonhams' glued furniture nouns and plural cases read design-other;
 *   · category / sub: jewelry under Watches · Wristwatches, Omega's Apollo
 *     dinner menus under Wristwatches, Venera / R-7 under Rocketry, Hubble
 *     under Rocketry, Frank Costello under Entertainment;
 *   · maker: REA Pokémon slabs and Hake's shouting titles printed no subject,
 *     "Olivia Full Art" printed the variant, RR's "Al Capone: …" topic lead
 *     printed nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { craftTitle, splitTitle } from '../../app/utils';
import { classifyForm } from '../../app/lib/comps';
import { taxonOf, subLabelOf, catLabelOf } from '../../app/lib/taxonomy';
import { kindFits } from '../../app/lib/object-kind';
import { makerLineOf } from '../../app/lib/lot-labels';
import { personOf } from '../../app/lib/subject';
import { subCatOf } from '../lib/sub-cats';
import { reclassifyLot } from '../lib/classify';
import { restampIdentityKeys } from '../lib/corpus-normalize';

const h1 = (t: string, house?: string) => splitTitle(t, house).short;
const form = (title: string, category = 'object', medium?: string) => classifyForm({ title, category, medium } as never);

test('headline: never cut at an abbreviation, a reference keeps its number', () => {
  assert.equal(h1('Patek Philippe: "Florentine" of 18k gold, ref. 2486. Mechanical movement with manual winding, cal. 10-200. 1957.', 'Bonhams'), '"Florentine" of 18k gold, ref. 2486');
  assert.equal(h1('Audemars Piguet: "Ultra-Thin" of 18k gold, ref. AP2003. Mechanical movement with manual winding, cal. 2003. 1950s.', 'Bonhams'), '"Ultra-Thin" of 18k gold, ref. AP2003');
  assert.equal(h1('Cartier: Santos Galbee of 18k gold and steel, ref. 1567. Quartz movement. 1990s.'), 'Santos Galbee of 18k gold and steel, ref. 1567');
  assert.equal(h1('Rare Sideboard, Model No. 150, variant for the Société Générale Douala, Brazzaville, Congo, circa 1951-1952'), 'Rare Sideboard, Model No. 150, variant for the Société Générale Douala, Brazzaville, Congo');
  assert.equal(h1('La grande corrida, avec femme torero (The Large Bullfight, with Female Bullfighter) (Bl. 1330, Ba. 433)'), 'La grande corrida, avec femme torero (The Large Bullfight, with Female Bullfighter) (Bl. 1330, Ba. 433)');
  assert.equal(h1('Elvis Presley Personally Owned Diamond and 14K Gold Ring - Approx. Ring Size 9, 10.9g - Patsy Presley LOP'), 'Elvis Presley Personally Owned Diamond and 14K Gold Ring - Approx. Ring Size 9');
  assert.equal(h1('#86 Oronde Gadsden Week 1 Game Used Gloves (LAC vs. AZ) | The official auction site of the National Football League', 'NFL Auction'), '#86 Oronde Gadsden Week 1 Game Used Gloves (LAC vs. AZ)');
  // never inside an open bracket
  assert.equal(h1('Studies of the Human Body (after, Studies of the Human Body: centre panel 1979) (S. 34, T. 10)'), 'Studies of the Human Body (after, Studies of the Human Body: centre panel 1979) (S. 34, T. 10)');
});

test('headline: a reference is no year, a model + its "Ref:" label is no name duo', () => {
  assert.equal(h1("Reference 1675 GMT-Master 'Pepsi' |  A stainless steel automatic dual time zone wristwatch with date and bracelet, Circa 1972"), "Reference 1675 GMT-Master 'Pepsi'");
  assert.equal(craftTitle('Trinity Vendome, Ref: 8743, c. 1990'), 'Trinity Vendome, Ref: 8743, c. 1990');
  assert.equal(craftTitle('Calatrava, Ref: 2452, Manufactured 1955, sold 4th June 1958'), 'Calatrava, Ref: 2452, Manufactured 1955, sold 4th June 1958');
  assert.equal(h1('Daytona, Reference 6265 | A yellow gold chronograph wristwatch with bracelet | Circa 1987'), 'Daytona, Reference 6265');
});

test('headline: a list of names and the year inside a phrase run on to the object', () => {
  assert.equal(h1('John Glenn, Charles Conrad, and Gordon Cooper (3) Signed Photographs'), 'John Glenn, Charles Conrad, and Gordon Cooper (3) Signed Photographs');
  assert.equal(h1('Kayne West Signed, Inscribed Limited Edition 2004 UMG iPod - Beckett LOA'), 'Kayne West Signed, Inscribed Limited Edition 2004 UMG iPod - Beckett LOA');
  assert.equal(h1('Signed 1990 Topps Big #296 Larry Walker Rookie Beckett GEM MINT 10'), 'Signed 1990 Topps Big #296 Larry Walker Rookie Beckett GEM MINT 10');
  assert.equal(h1('Shohei Ohtani Signed 2023 American League All-Star Game Jersey (#12/23) - Fanatics'), 'Shohei Ohtani Signed 2023 American League All-Star Game Jersey (#12/23) - Fanatics');
  assert.equal(h1('2009 Pokemon Platinum Supreme Victors Holo #143 Charizard Lv. X - BGS MINT 9'), '2009 Pokemon Platinum Supreme Victors Holo #143 Charizard Lv. X - BGS MINT 9');
  assert.equal(h1('MITCHELL, Margaret (1900–1949). Gone with the Wind. New York: Macmillan, 1936. First edition, first issue.'), 'MITCHELL, Margaret (1900–1949). Gone with the Wind');
  // the catalogue's own year field still closes a Bonhams / Wright title
  assert.equal(h1("Conoid Chair 1966American black walnut, signed 'Cohn' in black on underside height 35 1/2in (90.2cm); width 20in (58cm); depth 22 1/2in (57.1cm)"), 'Conoid Chair, 1966');
});

test('glued fields re-spaced: Bonhams Wright-family rows', () => {
  assert.equal(h1("Q Bench1966American black walnut, signed 'Cohn' on underside height 13 1/8in (33.3cm); length 96 1/2in (245cm); depth 19 1/2in (49.5cm)"), 'Q Bench, 1966');
  assert.equal(h1("'670' Lounge Chair and '671' Ottomandesigned 1956for Herman Miller, leather, rosewood, aluminumheight of chair 31 3/4in (80.7cm); width 33 1/2in (85.1cm)"), "'670' Lounge Chair and '671' Ottoman, 1956");
  assert.equal(craftTitle('Conoid Benchcirca 1965American black walnut, oak height 29 1/4in'), 'Conoid Bench circa 1965 American black walnut, oak height 29 1/4in');
  assert.match(craftTitle('Conoid Desk1966American black walnut, hickoryheight 29in (73.2cm); width 72in (182.8cm)'), /^Conoid Desk 1966 American black walnut, hickory height 29in/);
});

test('maker prefixes: a duo (and "a.o.") goes whole; a shouted dated maker goes', () => {
  assert.equal(h1('Charles Eames, Ray Eames: “Lounge chair”. Easy chair with moulded walnut shell, upholstered with black leather.'), '“Lounge chair”. Easy chair with moulded walnut shell');
  assert.equal(h1('Charles Eames, Ray Eames, a.o.: Table with black lacquered and chromed steel frame. White MDF top made on request.'), 'Table with black lacquered and chromed steel frame');
  assert.equal(h1("JEAN PROUVÉ (1901-1984) Pair of 'Métropole' Chairs, Model No. 305, variant with leatherette seat and backrest, designed circa 1953"), "Pair of 'Métropole' Chairs, Model No. 305");
  // a year in brackets is no life-date: G.I. Joe stays
  assert.match(craftTitle("G.I. JOE (1989) - SGT. SLAUGHTER (V4; SLAUGHTER'S MARAUDERS) SERIES 8/34 BACK CAS/JSA 65"), /^G\.I\. Joe \(1989\) - SGT\. Slaughter/);
});

test('shouting titles keep their names, references and acronyms', () => {
  assert.equal(craftTitle('LOU GEHRIG NEW YORK YANKEES ATTRIBUTED PROFESSIONAL QUALITY UNIFORM PANTS REMNANT WITH STITCHED NAME'), 'Lou Gehrig New York Yankees Attributed Professional Quality Uniform Pants Remnant with Stitched Name');
  assert.equal(craftTitle('FINE BABE RUTH PROFESSIONAL MODEL BASEBALL BAT (PSA/DNA GU 8) CIRCA 1919-1920'), 'Fine Babe Ruth Professional Model Baseball Bat (PSA/DNA GU 8) Circa 1919-1920');
  assert.equal(craftTitle('TEENAGE MUTANT NINJA TURTLES - TMNT 25TH BOOK SIGNED & SKETCHED BY KEVIN EASTMAN.'), 'Teenage Mutant Ninja Turtles - TMNT 25th Book Signed & Sketched by Kevin Eastman');
  // prose (a Christie's watch description) stays sentence case, its names and references kept
  assert.equal(craftTitle("PATEK PHILIPPE. AN 18K WHITE GOLD AUTOMATIC WRISTWATCH WITH DATE, POWER RESERVE AND MOON PHASES NAUTILUS MODEL, REF. 5712G-001"), 'An 18K white gold automatic wristwatch with date, power reserve and moon phases Nautilus model, ref. 5712G-001');
  assert.equal(craftTitle('A ROSEWOOD JEWELRY BOX GEORGE NAKASHIMA, 1961'), 'A rosewood jewelry box George Nakashima, 1961');
  assert.equal(craftTitle('PATEK PHILIPPE | AQUANAUT, REF.5067A-001, A STAINLESS STEEL AND DIAMOND-SET WRISTWATCH WITH DATE, CIRCA 2015').startsWith('Aquanaut, REF.5067A-001'), true);
});

test('a Sotheby\'s Asia title prints its English, not its Chinese pipes', () => {
  assert.equal(craftTitle("diamond demi-parure, 'maillon panthère' | 卡地亞 | 「maillon panthère」鑽石首飾套裝"), "Diamond demi-parure, 'maillon panthère'");
});

test('kind: the watch houses\' jewels are jewelry, multilingual', () => {
  assert.equal(form('CARTIER: COLLIER MAILLONS "PANTHÈRE"'), 'jewelry');
  assert.equal(form("Cartier. Bague Trinity 'Les must de Cartier' trois ors"), 'jewelry');
  assert.equal(form("pair of 18 karat gold, diamond and sapphire 'panthère' earclips, cartier, france"), 'jewelry');
  assert.equal(form('CARTIER: PAIRE DE BOUCLES D\'OREILLES EMERAUDES ET DIAMANTS, "PANTHERE"'), 'jewelry');
  assert.equal(form("sapphire, emerald, onyx and diamond 'panthère' demi-parure"), 'jewelry');
  assert.equal(form("diamond, emerald and onyx 'panthère' jabot pin, cartier"), 'jewelry');
  // …and the watches stay watches
  assert.equal(form('Cartier: Panthère of 18k gold and steel, ref. 187957. Quartz movement with date indication. 1980s.'), 'wristwatch');
  assert.equal(form('Tank, Circa 1975'), 'wristwatch');
  assert.equal(form('Santos 100, 2005'), 'wristwatch');
  assert.equal(form("Omega. A Lady's Fine and Unusual 18k Gold and Diamond-Set Cuff Bracelet with Malachite Dial SIGNED OMEGA, MOVEMENT NO. 28641926"), 'wristwatch');
  assert.equal(form('Audemars Piguet: "Ultra-Thin" of 18k gold, ref. AP2003. Mechanical movement with manual winding, cal. 2003. 1950s.'), 'wristwatch');
  assert.equal(form('Pendulette de voyage en argent vermeillé, décorée d’émail et sertie de diamants, mouvement huit jours, vers 1910'), 'clock');
  assert.equal(form("CARTIER. AN EXTREMELY RARE 18K WHITE GOLD LIMITED EDITION TABLE CLOCK WITH MOTHER-OF-PEARL DIAL 'DRAGON' DE CARTIER DECOR CLOCK MODEL, REF. CRW0100088"), 'clock');
});

test('kind: a ring word is no ring without a jeweler\'s word; a model word needs a watch', () => {
  assert.notEqual(form("G.I. JOE (1989) - SGT. SLAUGHTER (V4; SLAUGHTER'S MARAUDERS) SERIES 8/34 BACK CAS/JSA 65 (SIGNED BY SGT. SLAUGHTER - BROKEN O-RING)."), 'jewelry');
  assert.notEqual(form('Philadelphia Poison Ring Collection of (22) Original Philadelphia Police Mug Shots'), 'jewelry');
  assert.notEqual(form('The Bangles Band-Signed "Different Light" Open Vinyl Record (5 Signatures)'), 'jewelry');
  assert.equal(form('Elvis Presley Personally Owned Diamond and 14K Gold Ring - Approx. Ring Size 9, 10.9g - Patsy Presley LOP'), 'jewelry');
  assert.equal(form('Space Shuttle Orbiter Crash and Rescue Manual'), 'space');
  assert.equal(form('FLOWN Silver Snoopy from Apollo X. Approx. 1/2 in. tall sterling lapel pin'), 'space');
});

test('kind: an artist\'s jewel is jewelry in any category — never a picture of one', () => {
  assert.equal(form("'Modern Head' enamel pendant brooch", 'print'), 'jewelry');
  assert.equal(form('A pair of Tiffany earclips, by Paloma Piccaso,', 'print'), 'jewelry');
  assert.equal(form('bague de forme ovale. portrait de dora maar', 'original'), 'jewelry');
  assert.equal(form('Untitled (Brooch), galvanized iron, glass, steel and brass wire, 1 1/2 by 4 1/2 by 3 1/2 in.', 'sculpture'), 'jewelry');
  assert.equal(form('Femme au collier', 'print'), 'print');
  assert.equal(form('Odalisque au collier de chien (Odalisque with a Dog Collar), plate 39 from Séries 156', 'print'), 'print');
  assert.equal(form("Pablo Picasso (1881-1973) Buste de femme au corsage orné d'une broche", 'original'), 'original-2d');
  assert.equal(form('Figure voilée aux deux bracelets', 'sculpture'), 'sculpture');
  assert.equal(form('The Beatles Pin Up Poster - 17.5 x 22.75', 'print'), 'poster');
  // a print titled "…Carpet…" depicts one
  assert.equal(form('Statue, Carpet, Cooking Pans and Serial Objects (Four Works)', 'print', 'print'), 'print');
});

test('kind: design nouns read through glued fields and plurals', () => {
  assert.equal(form("Q Bench1966American black walnut, signed 'Cohn' on underside", 'design'), 'seating-bench');
  assert.equal(form('Conoid Desk1966American black walnut, hickoryheight 29in', 'design'), 'desk');
  assert.equal(form("Right Arm Lounge Chair1966American black walnut, hickory, upholstered cushion", 'design'), 'seating-chair');
  assert.equal(form("'670' Lounge Chair and '671' Ottomandesigned 1956for Herman Miller", 'design'), 'seating-chair');
  assert.equal(form('Pair of chests of drawers', 'design'), 'case');
  assert.equal(form('Kornblut cabinets, pair', 'design'), 'case');
  assert.equal(form('Nightstands from the M.L.A. Flats building, Chandigarh, pair', 'design'), 'case');
  assert.equal(form('ESU 400-C', 'design'), 'case');
  assert.equal(form('LTRs, pair', 'design'), 'table-low');
  assert.equal(form('Early desk, model no. D-20-C, from the ESU/EDU series, 1950s', 'design'), 'desk');
});

test('category: a design maker\'s furniture filed under an art category moves to design', () => {
  const lamp = { artist: 'george-nakashima', category: 'sculpture', title: 'Floor Lamp1966walnut, fiberglass height 60in (152.3cm)' };
  reclassifyLot(lamp);
  assert.equal(lamp.category, 'design');
  assert.equal(form(lamp.title, lamp.category), 'lighting');
  const sideboard = { artist: 'jean-prouve', category: 'original', medium: 'board', title: 'Rare Sideboard, Model No. 150, variant for the Société Générale Douala' };
  reclassifyLot(sideboard);
  assert.equal(sideboard.category, 'design');
  // a design maker's print stays a print
  const print = { artist: 'charles-eames', category: 'print', medium: 'lithograph', title: 'Chair studies' };
  reclassifyLot(print);
  assert.equal(print.category, 'print');
});

test('a watch house\'s jewel now reads jewelry, so the watches book drops it (watchMakerFix: "jewelry is NOT a watch")', () => {
  const l = { artist: 'cartier', category: 'object', title: 'CARTIER: COLLIER MAILLONS "PANTHÈRE"' };
  assert.equal(reclassifyLot(l).drop, true);
  const w = { artist: 'cartier', category: 'object', title: 'Cartier: Panthère of 18k gold and steel, ref. 187957. Quartz movement with date indication. 1980s.' };
  assert.equal(reclassifyLot(w).drop, false);
  assert.equal(form('Panthère jewelry suite, Cartier'), 'jewelry');
  // the kind gate still holds a jewel back from a Wristwatches follow
  assert.equal(kindFits({ artist: 'cartier', title: 'CARTIER: COLLIER MAILLONS "PANTHÈRE"', subCat: 'wristwatches', formKey: 'wristwatch' }), false);
});

test('category: a watch house\'s name on a space menu is a space piece', () => {
  const menu = { artist: 'omega', title: 'Omega Apollo Astronaut Appreciation Dinner Menu', subCat: null };
  assert.equal(catLabelOf(menu), 'Space & Science');
  assert.equal(subLabelOf(menu), 'Apollo');
  // an Omega Speedmaster "Apollo" watch stays a watch
  assert.equal(catLabelOf({ artist: 'omega', title: 'Omega Speedmaster Professional Apollo 11 Commemorative Watch', subCat: 'wristwatches' }), 'Watches');
  assert.equal(catLabelOf({ artist: 'omega', title: 'Omega Speedmaster Apollo XI', subCat: null }), 'Watches');
});

test('science subs: Soviet probes, shuttle crews, a scientist on the space book', () => {
  const sp = (title: string) => subCatOf({ artist: 'space-exploration', title }).drill;
  assert.equal(sp('Venera 4 Model'), 'soviet');
  assert.equal(sp('R7 Rocket Model'), 'soviet');
  assert.equal(sp('Astronaut Hall of Fame 2001 Inductees Multi-Signed Poster - Bob Crippen, Joe Engle, Richard Truly, and Rick Hauck'), 'shuttle-iss');
  assert.equal(subLabelOf({ artist: 'space-exploration', title: 'Edwin Hubble Signed Caltech Athenaeum Membership Card', subCat: 'space', drill: null }), 'Science, Tech & Natural History');
  assert.equal(subLabelOf({ artist: 'space-exploration', title: 'Hubble Space Telescope Flown Insulation', subCat: 'space', drill: null }), 'Rocketry & Other Space');
});

test('culture: a named mob boss is Crime & Notorious; Lou Costello is not', () => {
  assert.deepEqual(taxonOf({ artist: 'entertainment-memorabilia', subCat: 'documents', drill: null, title: 'Frank Costello Typed Letter Signed to Stork Club Owner Sherman Billingsley (1949)' }), { cat: 'historical', sub: 'crime' });
  assert.equal(taxonOf({ artist: 'entertainment-memorabilia', subCat: 'documents', drill: 'hollywood', title: 'Lou Costello Document Signed' }).cat, 'entertainment');
});

test('maker: Pokémon on REA slabs, no variant in the name', () => {
  const m = (title: string) => makerLineOf({ artist: 'pokemon', title, subCat: 'pokemon-cards', drill: 'vintage' }).name;
  assert.equal(m('1996 Pokemon Japanese Base Set #113 Chansey Holographic PSA NM 7'), 'Chansey');
  assert.equal(m('1997 Pokemon Japanese Rocket #149 Dark Dragonite Holographic PSA EX-MT 6'), 'Dark Dragonite');
  assert.equal(m('2017 Pokemon Sun & Moon Crimson Invasion #111 Olivia Full Art - PSA GEM MT 10'), 'Olivia');
});

test('maker: a person topic is the subject; a signer under a non-signing topic signs', () => {
  assert.equal(personOf("Al Capone: Frank Galluccio Original New York Police Department Mug Shot Photograph - Capone's 'Scarface'"), 'Al Capone');
  assert.equal(personOf('William Shakespeare: The Life and Death of King John (Second Folio, 1632)'), 'William Shakespeare');
  assert.equal(personOf('Led Zeppelin: Robert Plant Signed Photograph'), 'Robert Plant');
  assert.equal(personOf('Iwo Jima: John Bradley and Rene Gagnon Signed First Day Cover'), 'John Bradley');
  assert.equal(personOf('Queen: Freddie Mercury Signed Photograph'), 'Freddie Mercury');
  // a shouted Hake's title reads its signer
  assert.equal(makerLineOf({ artist: 'entertainment-memorabilia', title: 'KEVIN EASTMAN LETTER TO LAWRENCE KLEIN REGARDING RAPHAEL #1.', subCat: 'documents' }).name, 'Kevin Eastman');
});

test('kind shield: a Pokémon card from the "Rocket" / "Fossil" sets carries no science kind', () => {
  const rows = [
    { id: 'a', artist: 'pokemon', category: 'object', title: '1997 Pokemon Japanese Rocket #149 Dark Dragonite Holographic PSA EX-MT 6', formKey: 'space', objectClass: 'object' },
    { id: 'b', artist: 'pokemon', category: 'object', title: '1997 Pokemon Japanese Fossil #149 Dragonite Holographic PSA NM-MT 8', formKey: 'fossil', objectClass: 'object' },
  ];
  restampIdentityKeys(rows as never);
  assert.equal(rows[0].formKey, undefined);
  assert.equal(rows[1].formKey, undefined);
  const once = JSON.stringify(rows);
  restampIdentityKeys(rows as never);
  assert.equal(JSON.stringify(rows), once, 'idempotent');
});

test('the title craft is idempotent on its own output', () => {
  for (const t of [
    "Q Bench1966American black walnut, signed 'Cohn' on underside height 13 1/8in (33.3cm)",
    'LOU GEHRIG NEW YORK YANKEES ATTRIBUTED PROFESSIONAL QUALITY UNIFORM PANTS REMNANT WITH STITCHED NAME',
    "diamond demi-parure, 'maillon panthère' | 卡地亞 | 「maillon panthère」鑽石首飾套裝",
    'Charles Eames, Ray Eames, a.o.: Table with black lacquered and chromed steel frame.',
  ]) {
    const once = craftTitle(t);
    assert.equal(craftTitle(once), once, t);
  }
});

test('tcg: partial sets, uncut sheets and graded pairs are Lots & Sets; a Base Set single is not', () => {
  const sub = (title: string) => subCatOf({ artist: 'pokemon', title }).subCat;
  assert.equal(sub('1997 Pokemon Japanese Rocket Gang PSA GEM MT 10 Compete Set (65) - Featuring Dark Charizard'), 'pokemon-lots');
  assert.equal(sub('1999 Pokemon Fossil Partial Set - (47 Cards, 45 Different) - Featuring Gengar, Lapras, Zapdos'), 'pokemon-lots');
  assert.equal(sub('2013 Pokemon Black & White Legendary Treasures Radiant Collection Uncut Sheet (100 Cards)'), 'pokemon-lots');
  assert.equal(sub('2010 Pokemon HeartGold & SoulSilver Holo Lugia Legend PSA GEM MT 10 Pair (2) - Sequential'), 'pokemon-lots');
  assert.equal(sub('1999 Pokemon Base Set #4 Charizard Holographic PSA 9'), 'pokemon-cards');
  assert.equal(sub('2000 Pokemon Base Set 2 Factory-Sealed Booster Box (36 Packs)'), 'pokemon-sealed');
});

test('headline: a circa stays with its year; the trade acronyms keep their capitals', () => {
  assert.equal(h1('Pair of Bonhams chairs designed circa 1950, molded plywood and walnut with labels'), 'Pair of Bonhams chairs, circa 1950');
  assert.match(craftTitle('A STAINLESS STEEL AND BLACK PVD-COATED AUTOMATIC WRISTWATCH'), /PVD-coated/);
});

test('home-review misfiles: a Les Paul is no card, ArtBox Harry Potter has no home, a road car leaves Culture', () => {
  const guitar = { artist: 'sports-cards', auctionHouse: 'Goldin', title: '2000s Gibson Custom Shop Les Paul - Dale Earnhardt "The Intimidator" (#35/333) (#DE2-035) - Includes Gibson Hardshell Case' };
  assert.equal(reclassifyLot(guitar).drop, false);
  assert.equal(guitar.artist, 'sports-memorabilia');
  const hp = { artist: 'sports-cards', auctionHouse: 'Goldin', title: '2004 ArtBox Harry Potter Prisoner of Azkaban Update Autographs Daniel Radcliffe Signed Card - PSA NM-MT 8 - MBA' };
  assert.equal(reclassifyLot(hp).drop, true);
  const car = { artist: 'entertainment-memorabilia', auctionHouse: 'RR Auction', title: '1967 Plymouth Belvedere GTX - From the Personal Collection of William E. Thornton' };
  assert.equal(reclassifyLot(car).drop, true);
  // a postcard, a mint's ingot and a screen car stay
  for (const title of ['1906 Lincoln Publishing Postcard Andrew Coakley', '1971 Lincoln Mint Salvador Dali "Unicorn Dyonisiaque" Solid Sterling Silver Plate', '1966 Ford Thunderbird Screen-Used in Thelma & Louise']) {
    const l = { artist: 'entertainment-memorabilia', auctionHouse: 'RR Auction', title };
    assert.equal(reclassifyLot(l).drop, false, title);
  }
  // a sports card with a sports name stays a card
  const card = { artist: 'sports-cards', auctionHouse: 'Goldin', title: '1986 Fleer #57 Michael Jordan Rookie Card - PSA MINT 9' };
  assert.equal(reclassifyLot(card).drop, false);
  assert.equal(card.artist, 'sports-cards');
});
