/* (r7 data fix, Oct 10) entity data — the ids a lot files under and the
   figures they print. Titles are the corpus's and the live book's own. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entityKeyOf } from '../entity/key';
import { makerLineOf } from '../lot-labels';
import { athleteName, isPublicFigure, notOnePerson } from '../player-name';
import { knownPlayerSet } from '../cards';
import { filmOf } from '../subject';
import { productLineOf } from '../subject-groups';
import { isMisattributed, isWorkByArtist } from '../attribution';
import { taxonOf } from '../taxonomy';
import { entityFigures, sameItemSpark, completeQuarters, type SoldPoint } from '../entity/stats';
import { encodeEntities, decodeEntities, LENS_LABELS } from '../entity/wire';
import type { EntitySummary } from '../entity/model';

const lot = (artist: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id: `${artist}-${title}`.slice(0, 48), artist, title, status: 'upcoming', saleDate: '2026-10-20', ...extra });
const key = (artist: string, title: string, extra: Record<string, unknown> = {}) => entityKeyOf(lot(artist, title, extra));

test('r7 data: a team card is its team, never a /player (Q1 "New York")', () => {
  const l = lot('graded-cards', '1961 Topps #228 New York Yankees Team PSA 8');
  assert.equal(entityKeyOf(l), 'sj:sports|t:new-york-yankees');
  const line = makerLineOf(lot('graded-cards', '1959 Topps #510 New York Yankees Team PSA 7'));
  assert.ok(!line.href.startsWith('/player'), line.href);
  assert.equal(line.name, 'New York Yankees');
  // the pipeline roster never learns a city as a player, however often team cards print it
  const roster = knownPlayerSet(['New York', 'New York', 'New York', 'Mickey Mantle', 'Mickey Mantle', 'Mickey Mantle']);
  assert.ok(!roster.has('new-york'));
  assert.ok(roster.has('mickey-mantle'));
  // an athlete's card still links his page
  assert.equal(makerLineOf(lot('graded-cards', '1952 Topps #311 Mickey Mantle PSA 8')).href, '/player?id=mickey-mantle');
});

test('r7 data: highlight / place / caption runs are no athlete', () => {
  for (const t of ['1959 Topps #461 Mantle Hits 42nd Homer for Crown PSA 8 NM-MT', '1961 Topps #406 Mantle Blasts 565-FT. Home Run PSA 8', '1961 Topps #47 Musial Raps Out PSA 8']) {
    assert.ok(!String(key('graded-cards', t)).startsWith('pl:'), t);
    assert.ok(!makerLineOf(lot('graded-cards', t)).href.startsWith('/player'), t);
  }
  assert.ok(!String(key('autographs', 'Enormous Signed HOF Postcard Collection (45 - CGC/JSA)')).startsWith('pl:'));
  assert.ok(!String(key('autographs', 'Tennis Autographed Flats Collection of (38) with Borg/Connors Multi-Signed Photo')).startsWith('pl:'));
  assert.ok(!String(key('equipment-artifacts', 'Yankee Stadium Mural Display Piece', { playerName: 'Yankee Stadium', playerSlug: 'yankee-stadium' })).startsWith('pl:'));
  for (const n of ['New York', 'Green Bay', 'Yankee Stadium', 'Gold Coin', 'Mantle Hits', 'Oscar De La', 'Amazing Baltimore Orioles', 'Colorado Rockies', 'Nashville Elite Giants']) {
    assert.equal(athleteName(n, n), null, n);
  }
  assert.ok(notOnePerson('Buc Hill Aces') && notOnePerson('Mantle Hits') && !notOnePerson('Mickey Mantle'));
});

test('r7 data: athlete names the shape test used to miss', () => {
  for (const [n, t, want] of [
    ['LaMelo Ball', '2020 Panini Prizm #278 LaMelo Ball PSA 10', 'LaMelo Ball'],
    ['Breece Hall', '2022 Prizm #301 Breece Hall PSA 10', 'Breece Hall'],
    ['Y. A. Tittle', 'Y. A. Tittle Signed Football', 'Y.A. Tittle'],
    ['BEN HOGAN', 'BEN HOGAN SIGNED GOLF BALL', 'Ben Hogan'],
    ['Elly De La', '2023 Bowman Chrome #BCP-1 Elly De La Cruz PSA 10', 'Elly De La Cruz'],
    ['Bill Skowran Yankees', '1960 Bill "Moose" Skowran Yankees Game Used Bat', 'Bill Skowran'],
    ['Tony Gwynn Hawaii Islanders', '1982 TCMA #10 Tony Gwynn Hawaii Islanders PSA 8', 'Tony Gwynn'],
    ['Pele', 'Pele Signed Brazil Jersey', 'Pelé'],
    ['Grover Cleveland Alexander', '1922 E120 Grover Cleveland Alexander PSA 4', 'Grover Cleveland Alexander'],
  ] as const) assert.equal(athleteName(n, t), want, n);
});

test('r7 data: a famous non-athlete on a sports desk is a person, never a player', () => {
  assert.ok(isPublicFigure('Marilyn Monroe') && isPublicFigure('Ronald Reagan Typewritten') && !isPublicFigure('Earl Monroe'));
  assert.equal(key('autographs', 'Richard Nixon Signed Baseball (PSA/DNA 8 NM-MT)'), 'sj:sports|p:richard-nixon');
  assert.equal(key('sports-memorabilia', 'Marilyn Monroe and Joe DiMaggio Photograph c.1954 (Joe DiMaggio Collection)(PSA/DNA Type I)', { playerName: 'Marilyn Monroe', playerSlug: 'marilyn-monroe' }), 'sj:sports|p:marilyn-monroe');
  // the athlete beside them keeps his row
  assert.equal(key('autographs', 'Earl Monroe Signed Basketball'), 'pl:earl-monroe');
  // a leading photographer yields to the stamped athlete the title spells
  assert.equal(key('autographs', 'c.1956 J.D. McCarthy Signed Mickey Mantle Postcard PSA 9 MINT Auto', { playerName: 'Mickey Mantle', playerSlug: 'mickey-mantle' }), 'pl:mickey-mantle');
});

test('r7 data: an artist\'s own work on a collectibles desk files under the maker; ephemera stays the person', () => {
  assert.equal(key('entertainment-memorabilia', "Andy Warhol Oversized Signed Screenprint - 'John Wayne' (Ltd. Ed. #216/250) (FS II.377)"), 'mk:andy-warhol');
  assert.equal(key('entertainment-memorabilia', 'Andy Warhol Signed Book with Soup Can Sketch - The Philosophy of Andy Warhol'), 'mk:andy-warhol');
  assert.equal(key('entertainment-memorabilia', 'Pablo Picasso Signed Sketch on Postcard to Man Ray'), 'mk:pablo-picasso');
  assert.equal(key('entertainment-memorabilia', "Andy Warhol Signed Postcard of 'Marilyn Monroe'"), 'sj:culture|p:andy-warhol');
  assert.equal(key('entertainment-memorabilia', 'Andy Warhol Signed Book - Prints'), 'sj:culture|p:andy-warhol');
  assert.equal(key('entertainment-memorabilia', 'Andy Warhol and Jamie Wyeth Signed Prints'), 'sj:culture|p:andy-warhol');
  assert.ok(!isWorkByArtist("Andy Warhol Signed Postcard - 'Andy Mouse' by Keith Haring"));
  assert.ok(!isWorkByArtist('Pablo Picasso Signed Photograph of His 1906 Painting'));
});

test('r7 data: a maker record is the maker\'s own work (Fab 5 Freddy\'s vinyl was Haring\'s art)', () => {
  const t = "Fab 5 Freddy and Beside's “Change the Beat” 12 inch vinyl, signed and with original artwork by Keith Haring";
  assert.equal(isMisattributed('fab-5-freddy', t), true);
  assert.equal(key('fab-5-freddy', t), null);
  // a joint hand that includes the maker keeps him
  assert.equal(isMisattributed('pablo-picasso', 'Le Chant des Morts, illustrations by Picasso and Matisse'), false);
  assert.equal(isMisattributed('fab-5-freddy', 'Bruce, Get Loose'), false);
});

test('r7 data: one film across mediums', () => {
  assert.equal(filmOf('The Dwarfs production drawing from Snow White and the Seven Dwarfs Production Drawing'), 'Snow White and the Seven Dwarfs');
  assert.equal(filmOf('Wicked Witch production cel from Snow White and the Seven Dwarfs Production Cel'), 'Snow White and the Seven Dwarfs');
  assert.equal(filmOf('Kanga and Roo production key master background set-up from The Tigger Movie Production Key Master Background Set-Up'), 'The Tigger Movie');
  assert.equal(filmOf('Tom and Quacker production layout drawing from Downhearted Duckling Production Layout Drawing'), 'Downhearted Duckling');
  const a = key('entertainment-memorabilia', 'The Dwarfs production drawing from Snow White and the Seven Dwarfs Production Drawing');
  const b = key('entertainment-memorabilia', 'Wicked Witch production cel from Snow White and the Seven Dwarfs Production Cel');
  assert.equal(a, b);
  assert.equal(a, 'sj:culture|f:snow-white-and-the-seven-dwarfs');
});

test('r7 data: one id per set — print runs and the default sport fold in', () => {
  assert.equal(productLineOf('1952 Topps Low-Number Collection (297) Including 71 Black Backs'), '1952 Topps');
  assert.equal(productLineOf('1952 Topps High Numbers SGC-Graded Collection (43)'), '1952 Topps');
  assert.equal(productLineOf('1952 Topps Baseball High Grade PSA-Graded Complete Set (407)'), '1952 Topps');
  assert.equal(productLineOf('1952 Topps High Number PSA EX 5 Collection (43)'), '1952 Topps');
  assert.equal(productLineOf('1960 Topps Second Series Unopened Wax Pack'), '1960 Topps');
  assert.equal(productLineOf('1986 Fleer Basketball Unopened Wax Box (36 Packs)'), '1986 Fleer Basketball');
  assert.equal(key('graded-cards', '1952 Topps Low-Number Collection (297) Including 71 Black Backs'), key('graded-cards', '1952 Topps Baseball High Grade PSA-Graded Complete Set (407)'));
});

test('r7 data: a toy is no prop (Star Wars\' "props" median was Han Solo action figures)', () => {
  const t = taxonOf({ artist: 'pop-memorabilia', subCat: 'worn-personal', title: 'STAR WARS: RETURN OF THE JEDI (1983) - HAN SOLO (IN TRENCH COAT) 77 BACK-A CARDED ACTION FIGURE.' });
  assert.equal(`${t.cat}:${t.sub}`, 'entertainment:other');
  const prop = taxonOf({ artist: 'movie-tv', subCat: 'props', title: 'Star Wars: Obi-Wan Kenobi Ewan McGregor Production-Made Lightsaber Prop' });
  assert.equal(prop.sub, 'props-costumes');
});

/* ── the same-items spark ── */
const TODAY = '2026-10-10';
const Q = completeQuarters(TODAY, 12);
const dayOf = (q: string) => `${q.slice(0, 4)}-${String((Number(q.slice(6)) - 1) * 3 + 2).padStart(2, '0')}-15`;
function keyedPoints(): SoldPoint[] {
  // 30 cards, each sold every quarter, rising 5% a quarter; plus a mix shock: the last quarter
  // also sells 40 expensive one-off cards (Elite night) that would spike a pooled median
  const out: SoldPoint[] = [];
  Q.forEach((q, i) => {
    for (let c = 0; c < 30; c++) out.push({ p: (100 + c * 10) * Math.pow(1.05, i), d: dayOf(q), h: 'H', lens: 'sports-cards:singles', coarse: 'sports-cards', id: `${q}-${c}`, t: '', img: null, k: `card-${c}` });
    if (i === Q.length - 1) for (let e = 0; e < 40; e++) out.push({ p: 20000, d: dayOf(q), h: 'H', lens: 'sports-cards:singles', coarse: 'sports-cards', id: `${q}-e${e}`, t: '', img: null, k: `elite-${e}` });
  });
  return out;
}

test('r7 data: a keyed lens draws the same items, chained — the mix cannot spike it', () => {
  const f = entityFigures(keyedPoints(), TODAY, LENS_LABELS);
  assert.equal(f.sparkBasis, 'matched');
  const sp = f.spark!.filter((v): v is number => v != null);
  assert.equal(sp.length, 12);
  // monotone ~+5% a quarter, the last quarter included (a pooled median would jump ~20×)
  for (let i = 1; i < sp.length; i++) assert.ok(sp[i] / sp[i - 1] > 1.02 && sp[i] / sp[i - 1] < 1.08, `${i}: ${sp[i - 1]} → ${sp[i]}`);
  // the newest four quarters average the typical sale
  const last4 = sp.slice(-4).reduce((a, b) => a + b, 0) / 4;
  assert.ok(Math.abs(Math.log(last4 / f.med12m!)) < 0.05, `${last4} vs ${f.med12m}`);
  // too few repeat sales to chain → the quarterly median stands, said as such
  const thin = keyedPoints().map(r => ({ ...r, k: `${r.id}` }));
  const g = entityFigures(thin, TODAY, LENS_LABELS);
  assert.equal(g.sparkBasis, 'median');
  assert.equal(sameItemSpark(thin, Q, null), null);
});

test('r7 data: a subject\'s typical sale reads its live book\'s lens when that lens has a median', () => {
  const pts: SoldPoint[] = [];
  for (let i = 0; i < 40; i++) pts.push({ p: 120, d: '2026-06-15', h: 'H', lens: 'entertainment:other', coarse: 'entertainment', id: `o${i}`, t: '', img: null });
  for (let i = 0; i < 8; i++) pts.push({ p: 4000, d: '2026-05-15', h: 'H', lens: 'entertainment:props-costumes', coarse: 'entertainment', id: `p${i}`, t: '', img: null });
  assert.equal(entityFigures(pts, TODAY, LENS_LABELS).medLens, 'entertainment:other');
  const f = entityFigures(pts, TODAY, LENS_LABELS, { liveLens: 'entertainment:props-costumes' });
  assert.equal(f.medLens, 'entertainment:props-costumes');
  assert.equal(f.med12m, 4000);
  // a live lens with too few sales of its own leaves the sold-dominant lens
  const few = pts.filter(r => r.lens !== 'entertainment:props-costumes' || r.id < 'p3');
  assert.equal(entityFigures(few, TODAY, LENS_LABELS, { liveLens: 'entertainment:props-costumes' }).medLens, 'entertainment:other');
});

test('r7 data: the spark basis rides the wire', () => {
  const base: EntitySummary = {
    id: 'pl:michael-jordan', kind: 'player', market: 'sports', label: 'Michael Jordan', discipline: 'Basketball', face: null, page: null,
    sold: 100, sold12m: 50, med12m: 2000, med12mN: 50, medScope: null, record: null,
    spark: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], sparkN: Array(12).fill(5), sparkBasis: 'matched', yoy: null, verified: null, thin: false,
    caps: { compare: true, follow: 'michael-jordan', dossier: true },
  };
  const w = encodeEntities([base, { ...base, id: 'pl:kobe-bryant', label: 'Kobe Bryant', sparkBasis: 'median' }], { tier: 'main', generatedAt: 'x', lastCrawl: 'x', sparkQ: Q, tailN: 0, keepFace: () => false });
  const d = decodeEntities(JSON.parse(JSON.stringify(w)));
  assert.deepEqual(d.entities.map(e => e.sparkBasis), ['matched', 'median']);
  // a file with no matched spark carries no column (older readers: median)
  const w2 = encodeEntities([{ ...base, sparkBasis: 'median' }], { tier: 'main', generatedAt: 'x', lastCrawl: 'x', sparkQ: Q, tailN: 0, keepFace: () => false });
  assert.equal(w2.c.sb, undefined);
});
