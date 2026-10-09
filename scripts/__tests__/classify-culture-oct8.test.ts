/**
 * Culture / TCG / space classification fixes (Oct 8 2026 audit). Fixtures are
 * REAL corpus titles (RR, Goldin, Christie's, REA) pinned to the value the
 * audit judged right.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subCatOf, cultureTextDomain, curatedDomainOf, spaceScienceDrillOf } from '../lib/sub-cats';
import { cultureItemClass } from '../lib/corpus-normalize';
import { NON_SPORT_TCG_RE } from '../lib/classify';

type R = Record<string, unknown>;
const C = (title: string, o: R = {}) => {
  const itemClass = cultureItemClass({ title, ...o } as { title: string });
  return subCatOf({ artist: 'entertainment-memorabilia', title, itemClass, ...o });
};
const P = (title: string) => subCatOf({ artist: 'pokemon', title });

test('fix 1 · historical cues: crime, aviation, Titanic, wars, church, colonial currency, signers', () => {
  assert.equal(cultureTextDomain('Cleveland Mafia Summit Collection of (19) Original Cleveland Police Department Mug Shots'), 'crime');
  assert.equal(cultureTextDomain('Bonnie and Clyde Fabric Relic'), 'crime');
  assert.equal(cultureTextDomain('Hindenburg Flown Fabric Swatch: Recovered from the tail of the Hindenburg'), 'aviation');
  assert.equal(cultureTextDomain('Robert Falcon Scott: The Antarctic explorer to'), 'aviation');
  assert.equal(cultureTextDomain('Titanic: Millvina Dean Signed Photograph'), 'historic');
  assert.equal(cultureTextDomain('Harper’s Weekly Newspaper'), 'historic');
  assert.equal(cultureTextDomain('John Morton Signed Pennsylvania Colonial Currency - PMG Fine 12'), 'historic');
  assert.equal(cultureTextDomain('Pope Pius XII Signed Apostolic Blessing'), 'historic');
  assert.equal(cultureTextDomain('Civil War Confederate Canteen'), 'military');
  assert.equal(cultureTextDomain('Civil War-Era Model 1850 Staff and Field Officer\'s Sword'), 'military');
  assert.equal(cultureTextDomain('William Ellery Signed Document as a Signer of the Declaration'), 'political');
  assert.equal(cultureTextDomain('King Francis I Document Signed'), 'royalty');
  assert.equal(cultureTextDomain('Grand Duke Constantine Letter Signed'), 'royalty');
  assert.equal(cultureTextDomain('Kaiser Wilhelm II Signed Photograph'), 'royalty');
  // not the film, not the general, not a date
  assert.equal(cultureTextDomain('Titanic Screen-Used Life Jacket from the 1997 film'), 'hollywood');
  assert.equal(cultureTextDomain('John Pope Signed Document'), null);
  assert.equal(cultureTextDomain('Charles Thomson Revolutionary War-Dated Letter Signed'), null);
  // a film sale's "THE OUTLAW" one-sheet stays film
  assert.equal(C('THE OUTLAW, 20TH CENTURY-FOX, 1941', { saleName: 'Television And Film Memorabilia' }).drill, 'hollywood');
  // single-theme RR sales name the domain; a general "Featuring" sale does not
  assert.equal(C('William Logan Gwinn', { saleName: 'Titanic II' }).drill, 'historic');
  assert.equal(C('Sheriff \'Smoot\' Schmid\'s \'Execution Book\'', { saleName: 'Gangsters, Outlaw & Lawmen' }).drill, 'crime');
  assert.equal(C('Herbert Ross Signed Photograph', { saleName: 'Rare Manuscript, Document & Autograph' }).drill, null);
  assert.equal(C('Gloria Stuart', { saleName: 'Civil War Auction' }).drill, null);
});

test('fix 1 · subject lookup: aviators, the notorious, scientists, bare RR names', () => {
  assert.equal(curatedDomainOf(['charles lindbergh']), 'aviation');
  assert.equal(curatedDomainOf(['wright brothers']), 'aviation');
  assert.equal(curatedDomainOf(['amelia earhart']), 'aviation');
  assert.equal(curatedDomainOf(['al capone']), 'crime');
  assert.equal(curatedDomainOf(['john dillinger']), 'crime');
  assert.equal(curatedDomainOf(['jonas salk']), 'science');
  assert.equal(curatedDomainOf(['hannibal hamlin']), 'political');
  assert.equal(curatedDomainOf(['louis xiv']), 'royalty');
  assert.equal(curatedDomainOf(['jay gould']), 'historic');
  assert.equal(C('Charles Lindbergh', { subjectKeys: ['charles lindbergh'] }).drill, 'aviation');
  assert.equal(C('Jack Ruby', { subjectKeys: ['jack ruby'] }).drill, 'crime');
});

test('fix 2 · animation cels and production drawings are subCat cel-art', () => {
  assert.equal(C('Myron Waldman Animation Cel').subCat, 'cel-art');
  assert.equal(C('Sleeping Beauty and Prince Phillip production cel from Sleeping Beauty Production Cel').subCat, 'cel-art');
  assert.equal(C('Preston Blair preliminary model sheet drawing of Donald Duck Preliminary Model Sheet Drawing').subCat, 'cel-art');
});

test('fix 3 · a space-science culture lot: program, scientist or aviator', () => {
  assert.equal(C('Frank Borman Signed Photograph', { subjectKeys: ['frank borman'] }).drill, 'apollo');
  assert.equal(C('Christa McAuliffe Signed Photograph', { subjectKeys: ['christa mcauliffe'] }).drill, 'shuttle-iss');
  assert.equal(C('Carl Jung: Freud’s greatest student provides his rarely seen autograph in this vintage photo', { subjectKeys: ['carl jung'] }).drill, 'science');
  assert.equal(spaceScienceDrillOf('Sikorsky Signed Photograph'), 'aviation');
  assert.equal(spaceScienceDrillOf('Astronauts Group Lot'), 'space-science');
});

test('fix 4 · astronauts the space matcher missed', () => {
  const S = (title: string) => subCatOf({ artist: 'space-exploration', title }).drill;
  assert.equal(S('Alan B. Shepard Signed Photograph'), 'mercury-gemini');
  assert.equal(S('John H. Glenn Signed Photograph'), 'mercury-gemini');
  assert.equal(S('Grissom Signed Check'), 'mercury-gemini');
  assert.equal(S('Astronaut Signed Placards: Chaffee, Anders, Bean, and Cernan'), 'apollo');
  assert.equal(S('Jim Lovell Signed Photograph'), 'apollo');
  assert.equal(S('Ed White Signed Photograph'), 'apollo');
  assert.equal(S('Rocketdyne F-1 Engine Turbopump Component'), 'apollo');
  assert.equal(S('Challenger Crew Signed Photograph'), 'shuttle-iss');
  assert.equal(S('Sally Ride Signed Photograph'), 'shuttle-iss');
  assert.equal(S('Valentina Tereshkova Signed Photograph'), 'soviet');
  assert.equal(S('Alexei Leonov Original Painting'), 'soviet');
});

test('fix 8 · guitar makers are instruments, the namesakes are not', () => {
  assert.equal(cultureItemClass({ title: 'Gibson Les Paul Custom' }), 'instrument');
  assert.equal(cultureItemClass({ title: 'Prince\'s Rickenbacker' }), 'instrument');
  assert.equal(cultureItemClass({ title: 'Eric Clapton\'s Pedalboard' }), 'instrument');
  assert.equal(cultureItemClass({ title: 'Mel Gibson Signed Photograph' }), 'signed-photo');
  assert.equal(cultureItemClass({ title: 'Eddie Rickenbacker Signed Photograph' }), 'signed-photo');
});

test('fix 9 · Pokémon era: e-Card series vintage, two-digit years', () => {
  assert.equal(P('2003 Pokemon Skyridge Reverse Foil #89 Raticate - PSA EX 5').drill, 'vintage');
  assert.equal(P('2003 Pokemon Aquapolis Rare Holofoil #150 Nidoking - PSA GEM MT 10').drill, 'vintage');
  assert.equal(P('99 Pokemon Japanese Promo Dugtrio Team Battle Phone Card Zapdos - PSA GEM MT 10').drill, 'vintage');
  assert.equal(P('23 Pokemon Scarlet & Violet Promos Chinese Battle For Victini #052 Victini ex - BGS PRISTINE/Black Label 10').drill, 'modern');
  assert.equal(P('2009 Pokemon Japanese SoulSilver Collection 1st Edition Holo Lugia Legend PSA GEM MT 10').drill, 'classic');
});

test('fix 10 · a slab grade with no pack / box word is a single', () => {
  assert.equal(P('2019 Pokemon Sm Black Star Promo Hidden Fates Tins Sm211 Charizard Gx PSA 8').subCat, 'pokemon-cards');
  assert.equal(P('2020 Pokemon Black Star Promos V Power Tins Eevee V – CGC GEM MT 10 GEM MINT').subCat, 'pokemon-cards');
  assert.equal(P('1999 Pokemon Base Set Unopened Foil Pack PSA MINT 9').subCat, 'pokemon-sealed');
});

test('pokemon-memorabilia and pokemon-lots', () => {
  assert.equal(P('2006-07 Pokemon State/Province/Territory Championships Glass Trophy - 8.5 x 5').subCat, 'pokemon-memorabilia');
  assert.equal(P('Bear Walker x Pokemon Center Custom Articuno Themed Skateboard Deck - With Original Box').subCat, 'pokemon-memorabilia');
  assert.equal(P('Hasbro Pokemon Plush Toy Collection (8 Total, 7 Different)').subCat, 'pokemon-memorabilia');
  // a trophy CARD is a card
  assert.equal(P('2014 Pokemon World Championships No. 1 Trainer Pikachu Trophy Card - CGC MINT 9').subCat, 'pokemon-cards');
  assert.equal(P('2016 Pokemon World Championships No. 3 Trainer Trophy Pikachu - CGC MINT 9').subCat, 'pokemon-cards');
  assert.equal(P('1999 Pokemon Base Set Shadowless 1st Edition PSA MINT 9 Complete Set (103) - Featuring Charizard').subCat, 'pokemon-lots');
  assert.equal(P('1997 Pokemon Japanese Rocket PSA NM-MT 8 Collection (10)').subCat, 'pokemon-lots');
  // a set NAME is not a lot; sealed product collections stay sealed
  assert.equal(P('2002 Pokemon Legendary Collection Reverse Holo #88 Psyduck - CGC PRISTINE 10').subCat, 'pokemon-cards');
  assert.equal(P('2021 Pokemon Celebrations Factory-Sealed Ultra-Premium Collection (25 Packs)').subCat, 'pokemon-sealed');
  assert.equal(P('2025 Pokemon Destined Rivals Factory-Sealed Sleeved Booster Pack Collection (10)').subCat, 'pokemon-sealed');
});

test('fix 11 · non-Pokémon TCG in a sports slug is tcg-other, no sport', () => {
  assert.deepEqual(subCatOf({ artist: 'graded-cards', title: '2004 Yu-Gi-Oh! Rise of Destiny 1st Edition #EN033 A Team: Trap Disposal Unit Ultimate Rare PSA MINT 9' }), { subCat: 'tcg-other', drill: null, flown: null });
  assert.equal(subCatOf({ artist: 'unopened-wax', title: '2022 Bandai One Piece Romance Dawn OP-01 Original Booster Box Blue Bottom Case' }).subCat, 'tcg-other');
  assert.equal(subCatOf({ artist: 'sports-cards', title: '1993 Magic The Gathering Alpha Black Lotus BGS 9' }).subCat, 'tcg-other');
  assert.ok(NON_SPORT_TCG_RE.test('Lorcana The First Chapter Enchanted Elsa PSA 10'));
  // Magic Johnson is a basketball card
  assert.equal(subCatOf({ artist: 'sports-cards', title: '1980 Topps Larry Bird/Julius Erving/Magic Johnson #16 PSA 8' }).subCat, 'cards');
});

test('fix 13 · couture is not a costume unless a named person wore it', () => {
  assert.equal(C('A CHRISTIAN DIOR EVENING GOWN OF SCARLET CHIFFON LABELED \'CHRISTIAN DIOR PARIS\'').subCat, 'other');
  assert.equal(C('A CHANEL BALLGOWN, CAPE, SHOES AND MATCHING CLUTCH BAG LABELED \'CHANEL\'').subCat, 'other');
  assert.equal(C('Elton John\'s Personally-Owned and -Worn Versace Shirt').subCat, 'worn-personal');
  assert.equal(C('Audrey Hepburn\'s Givenchy Haute Couture Cocktail Gown, Autumn-Winter 1966').subCat, 'worn-personal');
});
