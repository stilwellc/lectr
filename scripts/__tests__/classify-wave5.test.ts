// Wave 5 (Oct 8 2026 Fine Art / Design / Watches audit): the classifier fixes
// F1–F5, ceramics, D2–D3, W1–W2 — every case is a title the audit judged wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artCategoryFix, reclassifyLot, objectDepthCm } from '../lib/classify';
import { subCatOf } from '../lib/sub-cats';
import { classifyForm } from '../../app/lib/comps';
import { isMisattributed } from '../../app/lib/attribution';
import { normalizeArtCategory } from '../lib/corpus-normalize';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
const A = (o: R) => artCategoryFix({ auctionHouse: 'Wright', ...o } as never);
/** the normalize path for one lot: reclassify → art-category heal → formKey → subCat */
function pipe(o: R): R {
  const l: R = { auctionHouse: 'Wright', ...o };
  reclassifyLot(l as never);
  normalizeArtCategory([l as never]);
  l.formKey = classifyForm(l as never);
  l.subCat = subCatOf(l).subCat;
  return l;
}

test('object depth: Wright labelled d / dia, three measures, a frame never counts', () => {
  assert.deepEqual(objectDepthCm('¾ h × 12 dia in (2  × 30  cm)'), { cm: 30.48, labelled: true });
  assert.equal(objectDepthCm('28½ h × 14 w × 10 d in (72  × 36  × 25  cm)')?.cm, 25.4);
  assert.deepEqual(objectDepthCm('73 x 72.4 x 55.2 cm'), { cm: 55.2, labelled: false });
  assert.equal(objectDepthCm('495 by 450 by 345 mm.')?.cm, 34.5);
  assert.equal(objectDepthCm('Table Lamp1966walnut, fiberglassheight 24 1/2in (62.2cm); diameter 13in (33cm)')?.cm, 33.02);
  assert.equal(objectDepthCm('16 h × 10⅜ w in (41  × 26  cm)'), null);
  assert.equal(objectDepthCm('framed: 30 x 24 x 2 in.'), null);
});

test('F1 · ceramics / sculpture filed as prints, uniques or other', () => {
  // Wright's bare Madoura titles: only the size line says it is a plate
  assert.equal(A({ artist: 'pablo-picasso', category: 'print', title: 'Tête', dimensions: '¾ h × 12 dia in (2  × 30  cm)' }), 'sculpture');
  assert.equal(A({ artist: 'pablo-picasso', category: 'print', title: 'Bullfight', dimensions: '1½ d × 17¼ dia in (4  × 44  cm)' }), 'sculpture');
  assert.equal(A({ artist: 'pablo-picasso', category: 'print', title: 'Chope visage', dimensions: '' }), 'sculpture');
  // Christie's Haring painted aluminum: an edition number but no print medium
  assert.equal(A({ artist: 'keith-haring', category: 'print', auctionHouse: "Christie's", title: 'Untitled', dimensions: '73 x 72.4 x 55.2 cm', description: "Keith Haring (1958–1990) Untitled stamped with the artist's signature, number and date 'K. Haring 86 ? 3/3' (on the base) painted aluminum 28 ¾ x 28 ½" }), 'sculpture');
  assert.equal(A({ artist: 'jeff-koons', category: 'unknown', auctionHouse: 'Phillips', title: 'Balloon Dog (Blue)' }), 'sculpture');
  assert.equal(A({ artist: 'jeff-koons', category: 'unknown', title: 'Puppy', description: 'Jeff Koons (born 1955) Puppy' }), 'sculpture');
  assert.equal(A({ artist: 'kaws', category: 'original', title: 'Bendy (Yellow)', dimensions: '3¾ h × 15 w × 6½ d in (10  × 38  × 17  cm)' }), 'sculpture');
  assert.equal(A({ artist: 'kaws', category: 'print', auctionHouse: 'Bonhams', title: 'Companion Bearbrick 400% (Grey/Blue), 2006', medium: 'print on the back' }), 'sculpture');
  assert.equal(A({ artist: 'alexander-calder', category: 'unknown', title: 'Quatre Blancs', medium: 'Sheet metal, wire, and paint' }), 'sculpture');
  assert.equal(A({ artist: 'roy-lichtenstein', category: 'unknown', auctionHouse: "Sotheby's", title: 'Landscape Mobile (Study)', dimensions: '123.5 by 114.6 cm.' }), null);
  // …never a print with its medium, a painting, or a boxed "Package Painting"
  assert.equal(A({ artist: 'kaws', category: 'print', title: 'Untitled, from Urge', medium: 'Screenprint in colors on Saunders Waterford paper', dimensions: '11 3/8 x 8 5/8in (28.9 x 21.9cm)' }), null);
  assert.equal(A({ artist: 'kaws', category: 'original', title: 'Untitled (Kimpsons) (Krusty) (from the Package Painting Series)', dimensions: '23⅝ h × 19⅛ w × 3¼ d in (60  × 49  × 8  cm)' }), null);
  assert.equal(A({ artist: 'barry-mcgee', category: 'original', title: 'Untitled', dimensions: '11¼ h × 9 w × 1 d in (29  × 23  × 3  cm)' }), null);
});

test('F2 · Série 156 / 347 plates stay prints, and the reclass converges (idempotent)', () => {
  const plate = { artist: 'pablo-picasso', auctionHouse: 'Phillips', title: 'Deux femmes, une en raccourci et une repliée sur elle-même (Two Women, One Shortened and the Other Inward-looking), plate 141 from Série 156 (Bl. 1995, Ba. 2005)' };
  for (const category of ['print', 'unknown', 'sculpture']) {
    const once = A({ ...plate, category }) ?? category;
    assert.equal(once, 'print', category);
    assert.equal(A({ ...plate, category: once }) ?? once, once, `${category}: a second pass moves nothing`);
  }
  assert.equal(A({ ...plate, category: 'sculpture', title: '347 series: plate 81 (b. 1561)' }), 'print');
  assert.equal(A({ ...plate, category: 'print', title: 'Plate II, from Sueño Y Mentira de Franco' }), null);
  // a dated / measured ceramic "plate" is still a ceramic, and silver repoussé
  // "plate 13¾in." is no plate number
  assert.equal(A({ artist: 'pablo-picasso', category: 'sculpture', title: 'Visage géométrique', description: "stamped with the silversmith's mark of François and Pierre Hugo silver repoussé plate 13¾in. (35cm.) diameter" }), null);
  // the whole pipeline twice: the same category every time
  const lots: R[] = [
    { ...plate, category: 'print' }, { ...plate, category: 'sculpture' },
    { artist: 'pablo-picasso', category: 'print', title: 'Tête', dimensions: '¾ h × 12 dia in (2  × 30  cm)' },
    { artist: 'jeff-koons', category: 'unknown', title: 'Balloon Dog (Magenta)', auctionHouse: 'Phillips', id: 'phillips-UK030323-338' },
    { artist: 'pablo-picasso', category: 'sculpture', title: 'Sculpteur, Modèle et Sculpture assise, from La Suite Vollard (B. 146; Ba. 297)' },
  ];
  for (const l of lots) {
    const a = pipe(l);
    const b = pipe({ ...a });
    assert.equal(b.category, a.category, l.title);
    assert.equal(b.subCat, a.subCat, l.title);
  }
});

test('F3 · photographs: process words → photograph; F&S-numbered "photographs" → prints', () => {
  assert.equal(A({ artist: 'andy-warhol', category: 'print', auctionHouse: "Christie's", title: 'ANDY WARHOL (1928-1987) Andy and young man, 1981-1986', description: 'ANDY WARHOL (1928-1987) Andy and young man, 1981-1986 unique gelatin silver print Estate and Foundation stamps' }), 'photograph');
  assert.equal(A({ artist: 'andy-warhol', category: 'print', title: 'Untitled (Self Portrait, Long Island)', medium: 'Silver gelatin print' }), 'photograph');
  // a screenprint after a Polaroid is a screenprint
  assert.equal(A({ artist: 'andy-warhol', category: 'print', title: 'Mick Jagger', medium: 'screenprint in colors', description: 'from a Polaroid by the artist' }), null);
  assert.equal(A({ artist: 'andy-warhol', category: 'photograph', auctionHouse: "Sotheby's", title: 'shoes (deluxe edition) (feldman & schellmann ii.251)' }), 'print');
  assert.equal(A({ artist: 'andy-warhol', category: 'photograph', title: 'Cowboys and Indians (Feldman & Schellmann II.377-386)', medium: 'pencil' }), 'print');
  assert.equal(classifyForm({ title: 'self-portrait (feldman & schellmann ii.16)', medium: '', category: 'photograph' }), 'unknown');
  assert.equal(classifyForm({ title: 'Untitled (Self Portrait)', medium: 'gelatin silver print', category: 'print' }), 'photograph');
});

test('F4 · the Fine Art "Other" pile: editions, sculpture, drawings, ephemera, collisions', () => {
  assert.equal(A({ artist: 'roy-lichtenstein', category: 'unknown', auctionHouse: 'Bonhams', title: 'Nude Reading, from the Nude Series' }), 'print');
  assert.equal(A({ artist: 'francis-bacon', category: 'unknown', auctionHouse: 'Bonhams', title: 'Right panel, from Triptych 1991' }), 'print');
  assert.equal(A({ artist: 'jean-michel-basquiat', category: 'unknown', auctionHouse: 'Phillips', title: 'RGT Clavicle; and 3 Views of the Shoulder Joint Opened, from Anatomy' }), 'print');
  assert.equal(A({ artist: 'jeff-koons', category: 'unknown', auctionHouse: 'Phillips', id: 'phillips-NY030726-176', title: 'Flower Drawing (Red)' }), 'print');
  assert.equal(A({ artist: 'francesco-clemente', category: 'unknown', auctionHouse: 'Phillips', id: 'phillips-NY010417-276', title: 'Women and Men #13' }), null);
  assert.equal(A({ artist: 'roy-lichtenstein', category: 'unknown', auctionHouse: "Christie's", title: 'Night Seascape Banner', description: 'ROY LICHTENSTEIN (1923-1997) Night Seascape Banner felt multiple, 1966, unsigned and unnumbered' }), 'print');
  assert.equal(A({ artist: 'francesco-clemente', category: 'unknown', auctionHouse: "Christie's", title: 'Francesco Clemente (b. 1952) Beauty is Mine', description: "Francesco Clemente (b. 1952) Beauty is Mine signed and dated 'Francesco Clemente 1998' (on the reverse) colored chalks on paper" }), 'original');
  assert.equal(A({ artist: 'alexander-calder', category: 'unknown', auctionHouse: "Sotheby's", title: 'Snail, gouache sur papier, 1969, 74,5 x 109,5cm', medium: 'gouache sur papier' }), 'original');
  assert.equal(A({ artist: 'alexander-calder', category: 'unknown', auctionHouse: "Sotheby's", title: 'Red, on Blue and Black, 1958, painted metal and wire, 12 1/2  x 17 x 6 1/2  in.' }), 'sculpture');
  // ephemera / textile forms file by category, not 'other'
  const K = (o: R) => subCatOf({ formKey: classifyForm(o as never), ...o }).subCat;
  assert.equal(K({ artist: 'roy-lichtenstein', category: 'print', title: 'Crying Girl', medium: 'offset lithograph in colors (mailer)' }), 'prints');
  assert.equal(K({ artist: 'andy-warhol', category: 'print', title: 'Lincoln Center Ticket', medium: 'screenprint in colors' }), 'prints');
  assert.equal(K({ artist: 'pablo-picasso', category: 'original', title: '"Les deux hiboux", faire part de mariage (wedding announcement), 1962.' }), 'originals');
  // the name collisions under a tracked maker
  assert.equal(isMisattributed('francesco-clemente', 'STUNNING ROBERTO CLEMENTE SINGLE SIGNED BASEBALL: LIKELY FINEST CONDITION GRADE EXAMPLE (PSA/DNA 9 MINT)'), true);
  assert.equal(isMisattributed('francesco-clemente', 'CAVALIERI, Bonaventura (ca. 1598-1647). Lo specchio ustorio . Bologna: Clemente Ferroni, 1632.'), true);
  assert.equal(isMisattributed('alexander-calder', 'The Life of the Salmon', 'CALDERWOOD (W.L.) The Life of the Salmon'), true);
  assert.equal(isMisattributed('alexander-calder', 'Zigzag', 'ALEXANDER CALDER (1898-1976) Zigzag incised with the artist\'s monogram'), false);
  assert.equal(isMisattributed('francesco-clemente', 'Francesco Clemente (b. 1952) Beauty is Mine'), false);
});

test('F5 · "book" as subject / support and "published by" beside a print medium', () => {
  assert.equal(classifyForm({ title: 'Still Life with Oysters, Fish in a Bowl and Book, oil and magna on canvas, 1973', medium: 'oil and magna on canvas', category: 'original' }), 'painting');
  assert.equal(classifyForm({ title: 'Corrida, oil pastel on the frontispiece of a book', medium: 'oil pastel on the frontispiece of a book', category: 'original' }), 'work-on-paper');
  assert.equal(classifyForm({ title: 'Real Estate Opportunities (from the Book Covers series)', medium: 'lithograph on white Arches paper', category: 'print' }), 'print');
  assert.equal(classifyForm({ title: 'Swimming Pools, from Book Covers series', medium: '', category: 'print' }), 'print');
  // a real artist's book stays one
  assert.equal(classifyForm({ title: 'Thirtyfour Parking Lots', medium: 'offset lithograph in bound book', category: 'print' }), 'book');
  assert.equal(classifyForm({ title: 'Jazz', medium: 'book with 20 pochoir plates', category: 'print' }), 'book');
  const K = (o: R) => subCatOf({ artist: 'andy-warhol', category: 'print', formKey: 'print', ...o }).subCat;
  assert.equal(K({ title: 'Andy Warhol (American, 1928-1987) Electric Chair Screenprint in colours, 1971, on thick wove paper, published by Bruno Bischofberger, Zurich' }), 'prints');
  assert.equal(K({ artist: 'roy-lichtenstein', title: 'Still Life with Red Jar (Corlett 291) Screenprint in colours, 1994, on Lana Lanaquarelle paper, published by Gemini G.E.L.' }), 'prints');
  assert.equal(K({ artist: 'ed-ruscha', formKey: 'book', title: 'Various Small Fires and Milk', medium: 'published by the artist' }), 'books');
});

test('ceramics: Madoura / earthenware / vessels split from sculpture; bronzes and porcelain multiples stay', () => {
  const S = (o: R) => subCatOf({ category: 'sculpture', formKey: 'sculpture', ...o }).subCat;
  assert.equal(S({ artist: 'pablo-picasso', title: 'Chope visage', medium: 'earthenware ceramic pitcher with colored engobe' }), 'ceramics');
  assert.equal(S({ artist: 'pablo-picasso', title: 'chope visage (a. r. 432)' }), 'ceramics');
  assert.equal(S({ artist: 'pablo-picasso', title: 'Tête', dimensions: '¾ h × 12 dia in (2  × 30  cm)' }), 'ceramics');
  assert.equal(S({ artist: 'keith-haring', title: 'Untitled', medium: 'ink on terracotta vessel' }), 'ceramics');
  assert.equal(S({ artist: 'jeff-koons', title: 'Puppy (Vase)', medium: 'glazed white ceramic vase multiple' }), 'ceramics');
  assert.equal(S({ artist: 'jeff-koons', title: 'Balloon Dog (Yellow)', medium: 'glazed porcelain' }), 'sculpture');
  assert.equal(S({ artist: 'pablo-picasso', title: 'Pablo Picasso (1881-1973) Visage géométrique', description: 'silver repoussé plate' }), 'sculpture');
  assert.equal(S({ artist: 'pablo-picasso', title: "Pablo Picasso (1881-1973) Dix-neuf plats en argent: i. Visage de faune--dated '28.6.55.'" }), 'sculpture');
  assert.equal(S({ artist: 'henri-matisse', title: 'Henri Matisse (1869-1954) Nu appuyé sur les mains', description: "signed with initials and numbered on the left leg 'H.M. 3/10' bronze with brown patina" }), 'sculpture');
  assert.equal(S({ artist: 'rashid-johnson', title: 'Untitled Color Men', description: 'black soap and wax on ceramic tiles mounted on panel' }), 'sculpture');
  assert.equal(S({ artist: 'andy-warhol', title: 'Andy Warhol in a blond wig Framed and glazed.', medium: 'glazed' }), 'sculpture');
});

test('D1–D3 · design: storage keeps case-storage, table lamps are lighting, Eames model codes', () => {
  const D = (title: string, formKey = 'design-other', artist = 'charles-eames') => subCatOf({ artist, title, formKey }).subCat;
  assert.equal(D("JEAN PROUVÉ (1901-1984) Bahut 'BA 12'", 'unknown', 'jean-prouve'), 'case-storage');
  assert.equal(D('ESU 400', 'case'), 'case-storage');
  assert.equal(classifyForm({ title: 'table lamp', medium: 'burl walnut, walnut, rice paper, lacquered wood', category: 'design' }), 'lighting');
  assert.equal(classifyForm({ title: 'Table Lamp1966walnut, fiberglassheight 24 1/2in (62.2cm)', medium: '', category: 'design' }), 'lighting');
  assert.equal(classifyForm({ title: 'Lamp table', medium: 'walnut', category: 'design' }), 'table');
  assert.equal(D('table lamp', 'table', 'george-nakashima'), 'lighting');
  for (const t of ['LKX-2', 'LKR', 'DKW-2', 'DAW']) assert.equal(D(t), 'seating', t);
  for (const t of ['CTM-1', 'CTM, preproduction']) assert.equal(D(t), 'tables', t);
});

test('W1–W2 · watches: clocks, accessories and the lapel / purse / fob / pendant watches', () => {
  const W = (title: string, artist = 'patek-philippe') => subCatOf({ artist, title, formKey: classifyForm({ title, medium: '', category: 'object' }) }).subCat;
  assert.equal(W('PATEK PHILIPPE. A VERY FINE AND UNIQUE GILT BRASS SOLAR-POWERED DESK CLOCK WITH CLOISONNE ENAMEL BY ALICE SECRETAN SIGNED PATEK PHILIPPE, GENEVE, REF. 1336'), 'clocks');
  assert.equal(W('ETERNA WATCH CO: SILVER TRAVEL TIMEPIECE CIRCA 1920', 'omega'), 'clocks');
  assert.equal(W('a silver and enamel minute repeating boudoir timepiece, cartier, paris, circa 1925', 'cartier'), 'clocks');
  // Cartier's movement maker and a striking "clock watch" are not clocks; nor is "4 o'clock"
  assert.equal(W('Cartier. A fine and rare 18K gold purse watch SIGNED CARTIER, FRANCE, MOVEMENT BY EUROPEAN WATCH & CLOCK CO.', 'cartier'), 'pocket-watches');
  assert.notEqual(W('Cartier. An interesting 18ct Gold Slim Shutter Watch together with associated 18ct gold chain SIGNED CARTIER, EUROPEAN CLOCK AND WATCH CO', 'cartier'), 'clocks');
  assert.equal(W('PATEK PHILIPPE. A VERY RARE 18K GOLD HUNTER CASE MINUTE REPEATING KEYLESS LEVER TWO-TRAIN CLOCK WATCH'), 'pocket-watches');
  assert.equal(W("Rolex Submariner Ref. 5513 stainless steel wristwatch, crown at 4 o'clock", 'rolex'), 'wristwatches');
  assert.equal(W('A watch winding box', 'rolex'), 'watch-accessories');
  assert.equal(W('rolex | a watch winding box, circa 2010', 'rolex'), 'watch-accessories');
  assert.equal(W('A collection of 7 watch boxes', 'audemars-piguet'), 'watch-accessories');
  assert.equal(W('reference rma 210-g grey marble round ashtray with applied rolex coronet emblems', 'rolex'), 'watch-accessories');
  assert.equal(W('A rubber royal oak offshore strap', 'audemars-piguet'), 'watch-accessories');
  // a watch sold WITH its box / strap is a watch
  assert.equal(W('A fine and attractive stainless steel wristwatch with Gay Frères bracelet, guarantee and presentation box'), 'wristwatches');
  assert.equal(W('Patek Philippe Calatrava Ref. 96 on leather strap'), 'wristwatches');
  assert.equal(W('platinum, 18 karat gold, onyx, diamond, pearl and enamel lapel watch, cartier, circa 1920', 'cartier'), 'pocket-watches');
  assert.equal(W('platinum, gold, diamond, onyx and enamel pendant-watch, cartier', 'cartier'), 'pocket-watches');
  assert.equal(W('A late 19th century gold and hardstone fob watch, by Patek Philippe'), 'pocket-watches');
  assert.equal(W('A snakeskin covered steel purse watch SIGNED ROLEX, MODEL SPORTING PRINCE', 'rolex'), 'pocket-watches');
  assert.equal(W('AUDEMARS PIGUET GOLD TWENTY DOLLAR COIN MANUALLY-WOUND DRESS WATCH WITH CHAIN, NO. 43566', 'audemars-piguet'), 'pocket-watches');
});
