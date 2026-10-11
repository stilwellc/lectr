/**
 * (W28, Oct 11) a pick's reason must be TRUE: "Like your X prints" names
 * prints by X the desk really keeps (a Polaroid set filed under Prints is
 * not one), another artist's work about X is not X's, a learned band too
 * wide to mean anything is never printed, mixed money units each carry a
 * sign, the desk's group is named by the desk; and the scoring a page asks
 * for twice (the deal, the return loop's strips) is done once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaste, recommend, scoreLots, featOf, bandText, byOtherArtist, termMatcherOf, statedBandOf, type RecLot } from '../recs';
import { makerFollow } from '../follows';

const NOW = Date.parse('2026-10-09T20:00:00Z');
const at = (days: number) => new Date(NOW + days * 864e5).toISOString();
let seq = 0;
function art(artist: string, title: string, lo: number, hi: number, o: Partial<RecLot> = {}): RecLot {
  return {
    id: `w-${++seq}`, artist, title, subCat: 'prints', auctionHouse: 'Christie’s', saleName: 'Prints',
    saleDate: at(5).slice(0, 10), estimateLow: lo, estimateHigh: hi, currency: 'USD', status: 'upcoming', ...o,
  };
}

test('money voice: one unit shares its sign, mixed units each carry one', () => {
  assert.equal(bandText(20000, 40000), '$20K–40K');
  assert.equal(bandText(520, 130000), '$520–$130K');
  assert.equal(bandText(800, 1200), '$800–$1.2K');
  assert.equal(statedBandOf({ minUsd: 250, maxUsd: 10000 })!.text, '$250–$10K');
  assert.equal(statedBandOf({ minUsd: 1000, maxUsd: 50000 })!.text, '$1K–50K');
});

test('a Warhol Polaroid set filed under Prints is not "like your Andy Warhol prints"', () => {
  const s1 = art('andy-warhol', 'Flowers (F. & S. 67)', 30000, 50000);
  const s2 = art('andy-warhol', 'Golden Mushroom, from Campbell’s Soup II', 25000, 35000);
  const polaroids = art('andy-warhol', 'Set Of 10 Sports Polaroids: Rod Gilbert, Dorothy Hamill, Muhammad Ali', 40000, 60000);
  const screen = art('andy-warhol', 'Van Heusen (Ronald Reagan) (from the Ads portfolio)', 30000, 50000);
  assert.equal(featOf(polaroids, NOW).medium, 'photo');
  assert.equal(featOf(screen, NOW).medium, null);
  const t = buildTaste({ saved: [{ id: s1.id, lot: s1 }, { id: s2.id, lot: s2 }], follows: [], nowMs: NOW });
  const rs = recommend([polaroids, screen], t, { nowMs: NOW });
  const byId = new Map(rs.map(r => [r.lot.id, r]));
  assert.match(byId.get(screen.id)!.reason, /^Like your Andy Warhol prints/, 'a Warhol screenprint is one of them');
  const p = byId.get(polaroids.id);
  assert.ok(p, 'the Polaroids are still Warhol’s — a same-maker pick');
  assert.doesNotMatch(p!.reason, /prints/, p!.reason);
  assert.ok(p!.why.includes('same maker'), p!.why.join());
});

test('another artist’s work about the maker is not the maker’s', () => {
  const muniz = art('andy-warhol', 'VIK MUNIZ (B. 1961) Andy Warhol (Pictures of Ink)', 20000, 30000, { subCat: 'photographs' });
  const corlett = art('roy-lichtenstein', 'The Mask, from Brushstroke Figures Series (C. 227)', 20000, 30000);
  assert.ok(byOtherArtist(muniz));
  assert.ok(!byOtherArtist(corlett), 'a catalogue number is not an artist');
  assert.ok(!byOtherArtist(art('andy-warhol', 'ANDY WARHOL (1928-1987) Flowers', 1, 2)), 'the maker’s own name and dates');
  const real = art('andy-warhol', 'Mao (F. & S. 91)', 20000, 30000);
  const t = buildTaste({ saved: [], follows: [makerFollow('andy-warhol', 'Andy Warhol')], nowMs: NOW });
  const rs = recommend([muniz, real], t, { nowMs: NOW });
  assert.deepEqual(rs.map(r => r.lot.id), [real.id], 'a Warhol follow never reads Muniz’s Warhol');
});

test('a learned band wider than ×20 scores but is never printed', () => {
  const desk = [
    art('pablo-picasso', 'Corrida', 300, 500), art('pablo-picasso', 'Visage', 2000, 3000),
    art('pablo-picasso', 'Tête de Rembrandt', 90000, 120000), art('pablo-picasso', 'Portrait de jeune fille', 50000, 70000),
  ];
  const cand = art('henri-matisse', 'Nu assis', 4000, 6000);
  const cand2 = art('pablo-picasso', 'Le Banderillero', 4000, 6000);
  const t = buildTaste({ saved: desk.map(l => ({ id: l.id, lot: l })), follows: [], nowMs: NOW });
  const b = t.bands.get('fine-art')!;
  assert.ok(Math.pow(10, b.hi - b.lo) > 20, 'the desk spans more than ×20');
  for (const r of recommend([cand, cand2], t, { nowMs: NOW })) assert.doesNotMatch(r.reason, /in your \$/, r.reason);
});

test('the desk’s group is named by the desk, not by one variant', () => {
  const tcg = (title: string, bid: number): RecLot => ({
    id: `z-${++seq}`, artist: 'pokemon', title, subCat: 'pokemon-cards', drill: 'modern', auctionHouse: 'Goldin', saleDate: at(3).slice(0, 10),
    saleDateTime: at(3), currentBid: bid, bidCount: 5, currency: 'USD', status: 'upcoming', ek: 'sj:tcg|k:charizard',
  });
  const a = tcg('2023 Pokemon Obsidian Flames Special Illustration Rare #223 Charizard ex - PSA GEM MT 10', 900);
  const b = tcg('2022 Pokemon Brilliant Stars Alternate Art #154 Charizard VSTAR - PSA GEM MT 10', 800);
  const c = tcg('2020 Pokemon Champion’s Path Secret Rare #79 Charizard V - PSA GEM MT 10', 850);
  const t = buildTaste({ saved: [{ id: a.id, lot: a }, { id: b.id, lot: b }], follows: [], nowMs: NOW });
  const [r] = recommend([c], t, { nowMs: NOW });
  assert.ok(r);
  assert.doesNotMatch(r.reason, /Charizard V cards/, r.reason);
});

test('"screen used" asks for the used object, not a trading card of the film', () => {
  const m = termMatcherOf('star wars screen used')!;
  const card = { id: 'c', artist: 'non-sports-cards', title: '1977 Topps "Star Wars" #1 Luke Skywalker Collection (5)' } as RecLot;
  const prop = { id: 'p', artist: 'entertainment-memorabilia', title: 'Star Wars: Return of the Jedi Screen-Used Stormtrooper Blaster' } as RecLot;
  assert.equal(m(card, featOf(card, NOW)), false);
  assert.equal(m(prop, featOf(prop, NOW)), true);
});

test('one scoring per (pool, taste, minute): the deal and the strips share it, and agree with a fresh pass', () => {
  const desk = [art('andy-warhol', 'Flowers', 30000, 50000), art('andy-warhol', 'Cow', 20000, 30000)];
  const pool = [...Array.from({ length: 30 }, (_, i) => art('andy-warhol', `Print ${i}`, 10000 + i * 1000, 20000 + i * 1000)), ...desk];
  const t = buildTaste({ saved: desk.map(l => ({ id: l.id, lot: l })), follows: [], nowMs: NOW });
  const a = scoreLots(pool, t, { nowMs: NOW, n: 24 });
  const b = scoreLots(pool, t, { nowMs: NOW + 5000, n: 60 });
  assert.equal(a[0], b[0], 'the second call reuses the first scoring (same row objects)');
  // a fresh taste object scores from scratch — and deals the same
  const t2 = buildTaste({ saved: desk.map(l => ({ id: l.id, lot: l })), follows: [], nowMs: NOW });
  assert.deepEqual(recommend(pool, t2, { nowMs: NOW, n: 60 }).map(r => r.lot.id), recommend(pool, t, { nowMs: NOW, n: 60 }).map(r => r.lot.id));
  // a minute later the block is re-read
  assert.notEqual(scoreLots(pool, t, { nowMs: NOW + 61_000 })[0], a[0]);
});
