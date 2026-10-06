/**
 * Edition identity (identity.ts editionIdentityKey / isEditionLot) — Oct 6
 * 2026 identity fix wave. Every fixture is a real Oct 5 corpus lot (title,
 * medium and the head of its description) from the judged edition samples.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { editionIdentityKey, isEditionLot } from '../identity';

type L = { artist: string; title: string; medium?: string | null; description?: string | null; formKey?: string | null };
const key = (l: L) => editionIdentityKey(l);
const ed = (l: L) => isEditionLot({ formKey: 'print', medium: null, ...l });

test('unique works never enter an edition pool', () => {
  // christies Warhol Flowers, $7.86M — a painting with a print formKey
  assert.equal(ed({ artist: 'andy-warhol', title: 'Andy Warhol (1928-1987) Flowers', description: "Andy Warhol (1928-1987) Flowers signed three times 'Andy Warhol' (on the reverse) acrylic and silkscreen ink on canvas 81¾ x 140½ in. Painted in 1965." }), false);
  assert.equal(ed({ artist: 'henri-matisse', title: 'Henri Matisse (1869-1954) Nu', description: 'Henri Matisse (1869-1954) Nu pencil on paper 13 1/8 x 10 in. (33.5 x 25.5 cm.)' }), false);
  assert.equal(ed({ artist: 'ed-ruscha', title: 'ED RUSCHA (B. 1937) Radar', description: "ED RUSCHA (B. 1937) Radar signed and dated 'Edward Ruscha 1976' (on the reverse) pastel and graphite on paper 22 1⁄8 x 28 1⁄8 in. Executed in 1976." }), false);
  assert.equal(ed({ artist: 'andy-warhol', title: 'ANDY WARHOL (1928-1987) Sylvester Stallone, 1980', description: 'ANDY WARHOL (1928-1987) Sylvester Stallone, 1980 unique Polacolor Type 108 print' }), false);
  // ...but prints, hand-coloured prints and editioned ceramics stay
  assert.equal(ed({ artist: 'pablo-picasso', title: 'PABLO PICASSO Buste de jeune Fille (B. 421; M. 67)', description: 'lithograph, 1947, on Arches, signed in pencil, numbered 6/50' }), true);
  assert.equal(ed({ artist: 'kenny-scharf', title: 'Snail Nymphs', medium: 'Etching and aquatint in colours with hand-colouring in watercolour, on wove paper' }), true);
  assert.equal(ed({ artist: 'pablo-picasso', title: 'PABLO PICASSO (1881-1974)', description: "Plat: Service Visage noir stamped d'après Picasso MADOURA glazed ceramic Diameter: 9¼in. Executed in 1948 in an edition of 100" }), true);
  assert.equal(ed({ artist: 'pablo-picasso', title: 'Picasso derrière le masque', description: 'GRAVURE ORIGINALE SIGNÉE DE PICASSO TIRAGE UNIQUE à 36 exemplaires sur “Auvergne à la main”' }), true);
});

test('the maker name and accents no longer split one edition', () => {
  // christies "PABLO PICASSO …" vs sothebys bare title: one key
  assert.equal(key({ artist: 'pablo-picasso', title: 'Pablo Picasso (1881-1973) Cruchon hibou' }), key({ artist: 'pablo-picasso', title: 'Cruchon hibou' }));
  assert.equal(key({ artist: 'andy-warhol', title: 'andy warhol 1928-1987, torso (double)' }), 'andy-warhol|torso double');
  assert.equal(key({ artist: 'pablo-picasso', title: 'tête de faune' }), 'pablo-picasso|tete de faune');      // not "t te de faune"
  assert.equal(key({ artist: 'pablo-picasso', title: "COTE d'AZUR" }), key({ artist: 'pablo-picasso', title: "Côte d'Azur" }));
  // the title that is only the maker's name names nothing
  assert.equal(key({ artist: 'keith-haring', title: 'KEITH HARING (1958-1990)' }), null);
});

test('catalogue raisonné numbers key the edition across title languages', () => {
  const a = key({ artist: 'pablo-picasso', title: 'PABLO PICASSO Pitcher with Arums (A.R. 189)' });
  assert.equal(a, 'pablo-picasso|cr:ar189');
  assert.equal(key({ artist: 'pablo-picasso', title: 'pichet aux arums (a.r. 189)' }), a);
  assert.equal(key({ artist: 'pablo-picasso', title: 'Chouette (Alain Ramié 543)' }), key({ artist: 'pablo-picasso', title: 'chouette (a. r. 543)' }));
  assert.equal(key({ artist: 'pablo-picasso', title: 'le repas frugal (bloch 1; baer 2)' }), key({ artist: 'pablo-picasso', title: 'pablo picasso | le repas frugal (b. 1; ba. 2)' }));
  assert.equal(key({ artist: 'andy-warhol', title: 'superman (f. & s. ii.260)' }), key({ artist: 'andy-warhol', title: 'myths: superman (feldman & schellmann ii.260)' }));
  assert.equal(key({ artist: 'pablo-picasso', title: 'France, conceived in 1949, painted earthenware, impressed stamps, Ramie 82' }), 'pablo-picasso|cr:ar82');
  // same title, different works: the number tells them apart
  assert.notEqual(key({ artist: 'pablo-picasso', title: 'PABLO PICASSO Tête de femme (B. 1064; Ba. 1278)' }), key({ artist: 'pablo-picasso', title: 'PABLO PICASSO Tête de femme (B. 947; Ba. 1213)' }));
  // a birth year is not Bloch
  assert.equal(key({ artist: 'ed-ruscha', title: 'EDWARD RUSCHA (B. 1937) Lisp' }), 'ed-ruscha|lisp');
});

test("'Ed' is a first name, 'ed.' is an edition", () => {
  assert.equal(key({ artist: 'ed-ruscha', title: 'ED RUSCHA Annie (E. 13)' }), 'ed-ruscha|cr:e13');
  assert.equal(key({ artist: 'ed-ruscha', title: 'Ed Ruscha (b. 1937) Gasoline Stations 1962' }), 'ed-ruscha|gasoline stations 1962');
  assert.equal(key({ artist: 'kaws', title: 'Companion ed. 500' }), 'kaws|companion 500');
});

test('signed and after/posthumous are part of the identity', () => {
  const signed = key({ artist: 'pablo-picasso', title: 'PABLO PICASSO Le Crapaud', description: 'lithograph, 1949, on Arches, signed in red crayon, numbered 9/50' });
  assert.equal(signed, 'pablo-picasso|le crapaud|signed');
  assert.equal(key({ artist: 'pablo-picasso', title: 'Le Crapaud' }), 'pablo-picasso|le crapaud');
  // "a proof apart from the signed and numbered edition" is not signed itself
  assert.equal(key({ artist: 'pablo-picasso', title: 'PABLO PICASSO Personnages et Colombe (B. 758; M. 254)', description: 'lithograph, 1954, on Arches, a proof apart from the signed and numbered edition of 50' }), 'pablo-picasso|cr:b758');
  assert.equal(key({ artist: 'pablo-picasso', title: 'plate signed in the stone, Le Crapaud' }), 'pablo-picasso|plate in the stone le crapaud');
  assert.equal(key({ artist: 'andy-warhol', title: "'Self-Portrait- Yellow'", description: "After Andy Warhol 'Self-Portrait- Yellow'" }), 'andy-warhol|self portrait yellow|after');
  assert.equal(key({ artist: 'roy-lichtenstein', title: 'After Roy Lichtenstein, Crying Girl poster' }), 'roy-lichtenstein|crying girl poster|after');
  // Warhol's own "after de Chirico" is a title, not an after-Warhol
  assert.equal(key({ artist: 'andy-warhol', title: 'disquieting muses (after de chirico)' }), 'andy-warhol|disquieting muses after de chirico');
});

test('generic titles abstain unless a number makes them specific', () => {
  assert.equal(key({ artist: 'keith-haring', title: 'Keith Haring (American, 1958-1990) Untitled 1984' }), null);
  assert.equal(key({ artist: 'andy-warhol', title: 'Andy Warhol (1928-1987) Self-Portrait' }), null);
  assert.equal(key({ artist: 'alexander-calder', title: 'ALEXANDER CALDER PRINT' }), null);
  assert.equal(key({ artist: 'pablo-picasso', title: 'Visage no. 202' }), 'pablo-picasso|visage no 202');
  assert.equal(key({ artist: 'roy-lichtenstein', title: 'Composition IV' }), 'roy-lichtenstein|composition iv');
  assert.equal(key({ artist: 'keith-haring', title: 'Untitled (four works from Lucio Amelio)' }), 'keith-haring|untitled four works from lucio amelio');
  assert.equal(key({ artist: 'andy-warhol', title: 'Untitled (Flash - November 22, 1963)' }), 'andy-warhol|untitled flash november 22 1963');
  // short real titles survive now that the maker's name is gone
  assert.equal(key({ artist: 'andy-warhol', title: 'Mao' }), 'andy-warhol|mao');
});
