/**
 * Card identity keys (app/lib/cards.ts cardKey/cardLadderKey + the
 * repeat-sale / Pokémon keys in scripts/sub-markets.ts). Every fixture is a
 * real corpus title from the Oct 2026 identity audit's judged 300-card sample
 * (scratchpad dd-id/cards/sample300_judged.csv) or its corpus sweep.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { parseCard, cardKey, cardLadderKey, cardSetKey, cardYearKey, isMultiCardTitle } from '../../app/lib/cards';
import { pokemonKey, cardRepeatKey } from '../sub-markets';
import type { AuctionLot } from '../../app/types';

const key = (t: string) => cardKey(parseCard(t));
const pk = (t: string) => pokemonKey({ artist: 'pokemon', title: t } as AuctionLot);

test('the player name stops at grader / grade words (willie-mays-psa-ex-mt class)', () => {
  assert.equal(parseCard('1952 Bowman #218 Willie Mays PSA EX-MT 6 (MK)').playerSlug, 'willie-mays');
  assert.equal(parseCard('1949 Bowman #50 Jackie Robinson PSA POOR 1').playerSlug, 'jackie-robinson');
  assert.equal(parseCard('1933 Goudey #144 Babe Ruth SGC Authentic').playerSlug, 'babe-ruth');
  assert.equal(parseCard('1987 Bellingham Mariners Team Issue #15 Ken Griffey Jr. BGS MINT 9 - Pre-Rookie!').playerSlug, 'ken-griffey-jr');
  assert.equal(parseCard('1964 Topps Giants #49 Hank Aaron--PSA Gem Mint 10').playerSlug, 'hank-aaron');
  assert.equal(parseCard('22 Panini Flawless Platinum #171 Shaquille O\'Neal Gem Relic Card (#1/1) - PSA GEM MT 10').playerSlug, 'shaquille-oneal');
  // card descriptors appended after the name
  assert.equal(parseCard('1959 Topps #564 Mickey Mantle All-Star PSA MINT 9').playerSlug, 'mickey-mantle');
  assert.equal(parseCard('1952 Topps #375 Jack Merson High Number PSA EX-MT+ 6.5').playerSlug, 'jack-merson');
  assert.equal(parseCard('1956 Topps #130 Willie Mays Gray Back SGC GOOD 2').playerSlug, 'willie-mays');
  assert.equal(parseCard('1952 Bowman Large Football #108 Hubert Johnson Short Print SGC GOOD+ 2.5').playerSlug, 'hubert-johnson');
  assert.equal(parseCard('2020 Panini Donruss Elite Football #1 Patrick Mahomes II Orange #42/49 PSA GEM MINT 10').playerSlug, 'patrick-mahomes-ii');
  // a REA and a Goldin sale of one card now share a key
  assert.equal(key('1952 Bowman #218 Willie Mays PSA EX-MT 6'), key('52 Bowman #218 Willie Mays - PSA EX-MT 6'));
});

test('surnames that are also descriptor / colour words survive', () => {
  assert.equal(parseCard('1971 Topps #14 Vida Blue Rookie PSA 8').playerSlug, 'vida-blue');
  assert.equal(parseCard('1991 Topps #1 Reggie White PSA 10').playerSlug, 'reggie-white');
  assert.equal(parseCard('1916 Herpolsheimer Co. #69 Wilbur Good - SGC 7 NM').playerSlug, 'wilbur-good');
  assert.equal(parseCard('2024 Panini National Treasures WWE Retro Materials Platinum #RM-UWR Ultimate Warrior Patch Card (#1/1) - CGC A').playerSlug, 'ultimate-warrior');
});

test('set names normalize across houses: sport words, catalog codes, year-range tails', () => {
  assert.equal(cardSetKey('Topps Baseball'), 'topps');
  assert.equal(cardSetKey('R319 Goudey'), 'goudey');
  assert.equal(cardSetKey('M101-4 Sporting News'), 'sportingnews');
  assert.equal(cardSetKey('T206'), 't206');
  assert.equal(cardSetKey('1987 Fleer Basketball'), 'fleer');
  // REA "1986-1987 Fleer Basketball" = H&S "1986-87 Fleer Basketball" = Goldin "87 Fleer"
  const goldin = key('87 Fleer #57 Michael Jordan Rookie Card - PSA MINT 9');
  assert.equal(key('1986-1987 Fleer Basketball #57 Michael Jordan Rookie PSA MINT 9'), goldin);
  assert.equal(key('1986-87 Fleer Basketball #57 Michael Jordan Rookie - PSA 9 MINT'), goldin);
  assert.equal(key('1955 Topps Baseball #189 Phil Rizzuto - PSA NM-MT 8'), key('55 Topps #189 Phil Rizzuto - PSA NM-MT 8'));
  assert.equal(key('1933 R319 Goudey #32 Bud Clancy PSA EX-MT 6'), key('1933 Goudey #32 Bud Clancy - PSA EX-MT 6'));
});

test('years: a range is the year (not the set), a one-season range keys on its end year', () => {
  assert.equal(parseCard('1986-1987 Fleer Basketball #57 Michael Jordan').year, '1986-87');
  assert.equal(parseCard('1986-1987 Fleer Basketball #57 Michael Jordan').setName, 'Fleer Basketball');
  assert.equal(parseCard('97-98 SPX #6 Michael Jordan').year, '1997-98');
  assert.equal(parseCard('1934-1936 R327 Diamond Stars #6 Max Bishop PSA EX+ 5.5').year, '1934-36');
  assert.equal(cardYearKey('1986-87'), '1987');
  assert.equal(cardYearKey('1999-00'), '2000');
  assert.equal(cardYearKey('1934-36'), '1934-36');
  assert.equal(cardYearKey('1952'), '1952');
});

test('the autograph grade: comma-separated second grade, 1–10 only, never across #', () => {
  const ag = (t: string) => parseCard(t).autoGrade;
  assert.equal(ag('2012 Topps Allen & Ginter Autographs #AGA-RFD Roger Federer Signed Card - BGS GEM MINT 9.5, Beckett 10'), '10');
  assert.equal(ag('2021 Panini Select Prizm Tri Color #31 Deebo Samuel Signed Card (#243/249) - BGS Authentic, Beckett 10'), '10');
  assert.equal(ag('2014 Topps Five Star Autographs Football #FSA-TBRA Tom Brady BGS NM-MT 8 with GEM 10 Signature'), '10');
  assert.equal(ag('1997-98 SPX #6 Michael Jordan Silver Buyback UDA Auto--BGS 9/Auto 10'), '10');
  // card numbers are not autograph grades
  assert.equal(ag('2022 Leaf Signature Series Dual Autograph Summer #DA-32 Magic Johnson/Jerry West Dual-Signed Card (#1/1) - PSA GEM MT 10'), null);
  assert.equal(ag('2018 Panini Eminence One of a Kind Autograph #1-OK Oliver Kahn Signed Card (#1/1) - Panini Encased'), null);
  assert.equal(ag('2019 Panini Prizm Draft Picks Autograph Green Prizm #60 Anthony Volpe Signed Rookie Card - PSA MINT 9'), null);
  // the existing forms still read
  assert.equal(ag('87 Fleer #57 Michael Jordan Signed Rookie Card - PSA EX 5, PSA/DNA NM-MT 8'), '8');
  assert.equal(ag('87 Fleer #57 Michael Jordan Signed Rookie Card - PSA Authentic, PSA/DNA Authentic'), 'A');
  // a signed and an unsigned Federer are different keys; two Beckett-10 autos join
  assert.notEqual(key('2012 Topps Allen & Ginter Autographs #AGA-RFD Roger Federer Signed Card - BGS GEM MINT 9.5, Beckett 10'),
    key('2012 Topps Allen & Ginter Autographs #AGA-RFD Roger Federer Signed Card - BGS GEM MINT 9.5, Beckett 9'));
});

test('label tiers and the smaller graders key apart from the plain grade', () => {
  assert.equal(key('2018 Topps Chrome Update #HMT32 Shohei Ohtani Rookie Card - BGS PRISTINE 10'), 'shohei-ohtani|2018|toppschromeupdate|hmt32|BGS10-pristine');
  assert.equal(parseCard('2009 Donruss Elite Extra Edition Autograph #57 Mike Trout Signed Rookie Card (#410/495) - BGS PRISTINE/Black Label 10, Beckett 10').gradeTier, 'bl');
  assert.notEqual(key('2018 Topps Chrome Update #HMT32 Shohei Ohtani Rookie Card - BGS PRISTINE 10'), key('2018 Topps Chrome Update #HMT32 Shohei Ohtani Rookie Card - BGS GEM MINT 9.5')!.replace('9.5', '10'));
  // a "Gold Label" SET name is not a grade tier
  assert.equal(parseCard('1999 Topps Gold Label #1 Mike Piazza - PSA GEM MT 10').gradeTier, null);
  assert.equal(key('2021 Topps Chrome UCL Sapphire Edition #100 Lionel Messi - TAG GEM MT 10'), 'lionel-messi|2021|toppschromeuclsapphireedition|100|v:color|TAG10');
  // (Oct 6 re-audit) a pre-1980 "SP" is a scarcity note on the base card, not a variant
  assert.equal(key('1948 Leaf #45 Ken Keltner SP – GAI 5'), 'ken-keltner|1948|leaf|45|GAI5');
  // lowercase "tag" is not a grader
  assert.equal(parseCard('1952 Topps #1 Andy Pafko with original price tag').gradeUnparsed, false);
});

test('multi-card lots never key', () => {
  for (const t of [
    '20 Panini Prizm #248 Zion Williamson BGS GEM MINT 9.5 Rookie Card Collection (25)',
    '1954 Topps Baseball: #128 Hank Aaron RC (PSA 5.5) & #201 Al Kaline RC (PSA 5)',
    '1963 Topps Complete Set (576) Including #537 Pete Rose Rookie PSA EX-MT 6',
    '2003 Yu-Gi-Oh! Dark Crisis #000 Vampire Lord Secret Rare Holographic PSA GEM MINT 10 Pair',
  ]) {
    assert.equal(isMultiCardTitle(t), true, t);
    assert.equal(cardKey(parseCard(t)), null, t);
    assert.equal(cardLadderKey(parseCard(t)), null, t);
  }
  // a serial "#42/49" is not a second card; "Team Set" as a product name is one card
  assert.equal(isMultiCardTitle('2020 Panini Donruss Elite Football #1 Patrick Mahomes II Orange #42/49 PSA GEM MINT 10'), false);
  assert.equal(isMultiCardTitle('23 Topps Paris Saint-Germain Team Set Red #48 Lionel Messi (#1/5) - PSA EX-MT 6'), false);
  assert.equal(pk('1999 Pokemon Black Star Promos CGC Mint 9 Collection (4) – Featuring #3 Mewtwo, #4 Pikachu'), null);
});

test('MBA sticker colour is not a parallel', () => {
  assert.equal(parseCard('1960 Topps #300 Hank Aaron PSA NM 7 (MBA Silver Diamond)').variant, null);
});

test('Pokémon key: character, language and reverse kept; rarity words folded; year range one token', () => {
  assert.equal(pk('2000 Pokemon Neo Genesis 1st Edition Rare Holofoil #16 Togetic - CGC GEM MINT 10'), '2000|neo-genesis|16|togetic|1st|CGC10');
  assert.equal(pk('2000 Pokemon Gym Challenge Rare Holo #17 Blaine - PSA MINT 9'), '2000|gym-challenge|17|blaine|unl|PSA9');
  assert.equal(pk('2005 Pokemon EX Delta Species Reverse Holofoil #22 Holon\'s Magneton – PSA MINT 9'), '2005|ex-delta-species|22|holon-s-magneton|unl-rev|PSA9');
  assert.equal(pk('2021 Pokemon Japanese 25th Anniversary Collection Reverse Holo #006 Groudon - CGC GEM MINT 10'), '2021|25th-anniversary-collection|006|groudon|unl-ja-rev|CGC10');
  assert.equal(pk('2019-20 Pokemon Sword & Shield Black Star Promos Celebrations Collection Full Art Holofoil #SWSH134 Dark Sylveon V – BGS MINT 9'),
    '2019|sword-shield-black-star|SWSH134|dark-sylveon-v|unl|BGS9');
  // a Japanese printing never pools with the English card
  assert.notEqual(pk('1999 Pokemon Japanese Base Set Holo #4 Charizard - PSA 9 MINT'), pk('1999 Pokemon Base Set Holo #4 Charizard - PSA MINT 9'));
  assert.equal(pk('1999 Pokemon Base Set 1st Edition Holo #4 Charizard - CGC PRISTINE 10'), '1999|base-set|4|charizard|1st|CGC10-pristine');
});

test('repeat-sale card key: signed and unsigned copies never pair; REA joins Goldin', () => {
  const rk = (t: string) => cardRepeatKey({ title: t, _card: parseCard(t) } as unknown as AuctionLot);
  const plain = rk('1952 Topps #311 Mickey Mantle - PSA EX 5');
  const signed = rk('1952 Topps #311 Mickey Mantle Signed Card - PSA EX 5, PSA/DNA 8');
  assert.ok(plain && signed);
  assert.notEqual(plain, signed);
  assert.ok(signed!.endsWith('|s'));
  assert.equal(rk('1986-1987 Fleer Basketball #57 Michael Jordan Rookie PSA MINT 9'), rk('87 Fleer #57 Michael Jordan Rookie Card - PSA MINT 9'));
  assert.equal(rk('1963 Topps Complete Set (576) Including #537 Pete Rose Rookie PSA EX-MT 6'), null);
});

test('variant junk: set names and short-print notes are not parallels; comics and magazines are not cards (Oct 6 re-audit)', () => {
  assert.equal(key('1911 T3 Turkey Red #17 Clark Griffith PSA VG-EX 4'), 'clark-griffith|1911|t3turkeyred|17|PSA4');
  assert.equal(key('1954 Red Man Tobacco #NL-25 Willie Mays PSA VG-EX 4'), 'willie-mays|1954|redmantobacco|nl-25|PSA4');
  // vintage SP: the same card with or without the house's note
  assert.equal(key('1957 Topps #77 Bill Russell SP Rookie PSA 7.5 NM+'), key('1957 Topps #77 Bill Russell Rookie PSA 7.5 NM+'));
  // "SP" inside the product name / card number is not a short print
  assert.equal(key('2005 SP Game Used Authentic Fabrics Autographed #AAFLJ LeBron James (21/100) - PSA GEM MT 10'), 'lebron-james|2005|spgameusedauthenticfabricsautographed|aaflj|v:auto|/100|PSA10');
  assert.equal(parseCard('2008 Upper Deck SP Game Used #142 Kevin Durant Rookie Card (#604/999) - PSA GEM MT 10').variant, null);
  assert.equal(parseCard('2021 Panini Immaculate Sneak Peek Brand Logo #SP-KMJ Karl Malone Patch Card (#1/1) - PSA EX-MT 6').variant, '1of1+relic');
  // a modern short-print variation still keys apart from the base
  assert.equal(parseCard('2021 Topps Chrome #1 Shohei Ohtani SP Variation - PSA 10').variant, 'sp+var');
  assert.equal(parseCard('2002 Upper Deck Superstars #MJTWA Michael Jordan/Tiger Woods Legendary Leaders Autographs (19/25) PSA 10 GEM MINT').variant, null);
  // comic books / magazine issues abstain; card products named for them stay cards
  assert.equal(key('1943 Classic Comics #13 Dr. Jekyll and Mr. Hyde Original First Edition Key Issue Comic Book--CGC 7.5'), null);
  assert.equal(key('1963 Marvel Comics Amazing Spider-Man #5 Early Doctor Doom Appearance - CGC 4.5'), null);
  assert.equal(key('1973 Marvel Tomb of Dracula #10 First Appearance of Blade the Vampire Slayer - CGC 7.5'), null);
  assert.equal(key('04 Topps Bazooka Comics #15 LeBron James Rookie Card – PSA GEM MT 10'), 'lebron-james|2004|toppsbazookacomics|15|PSA10');
  assert.equal(key('1998 Fleer Sports Illustrated #105 Cal Ripken Jr. – PSA NM-MT 8'), 'cal-ripken-jr|1998|fleersportsillustrated|105|PSA8');
});
