/**
 * Near-duplicate folding (app/lib/fold): one card in many grades at one house
 * shows once (its best-priority copy), identical titles at one house fold,
 * unique works and other houses never do, and the group's search string finds
 * every member.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldVariants, foldKeyOf, foldNote, foldQuery, gradeLabel } from '../fold';
import { parseCard } from '../cards';

const NOW = Date.parse('2026-10-09T20:00:00Z');
const soon = new Date(NOW + 20 * 3_600_000).toISOString();
let n = 0;
const card = (title: string, est: number, house = 'REA') => ({
  id: `c${n++}`, title, artist: 'sports-cards', subCat: 'cards', drill: 'baseball', auctionHouse: house,
  estimateLow: est, estimateHigh: est, saleDateTime: soon,
});

test('cards: grades of one card at one house fold to the best-priority copy, in input order', () => {
  const lots = [
    card('1970 Topps #189 Thurman Munson Rookie PSA EX 5', 800),
    card('1955 Topps #164 Roberto Clemente Rookie PSA 6', 9000),
    card('1970 Topps #189 Thurman Munson Rookie PSA NM-MT 8', 4000),
    card('1970 Topps #189 Thurman Munson Rookie PSA VG-EX 4', 500),
    card('1970 Topps #189 Thurman Munson Rookie PSA NM-MT 8', 4000, 'Goldin'), // another house: its own option
  ];
  const f = foldVariants(lots, NOW);
  assert.deepEqual(f.reps.map(l => l.id), [lots[1].id, lots[2].id, lots[4].id]);
  assert.deepEqual(f.siblings.get(lots[2].id)!.map(l => l.id), [lots[0].id, lots[3].id]);
  assert.equal(f.kind.get(lots[2].id), 'card');
  // every member points at the whole group (the shortlist may seat a sibling)
  assert.equal(f.group.get(lots[0].id)!.members.length, 3);
  assert.equal(f.group.get(lots[1].id), undefined);
});

test('cards: a Pokémon title with no ladder key folds on its gradeless title', () => {
  const tcg = (title: string, est: number) => ({ ...card(title, est, 'Goldin'), artist: 'pokemon', subCat: 'cards', drill: 'vintage' });
  const lots = [
    tcg('1999 Pokemon Base Set Holo #4 Charizard - PSA GEM MT 10', 20000),
    tcg('1999 Pokemon Base Set Holo #4 Charizard - PSA NM-MT 8', 1500),
    tcg('1999 Pokemon Base Set Shadowless Holo #4 Charizard - PSA MINT 9', 9000),
  ];
  const f = foldVariants(lots, NOW);
  assert.equal(f.reps.length, 2);
  assert.deepEqual(f.siblings.get(lots[0].id)!.map(l => l.id), [lots[1].id]);
});

test('titles: identical lots at one house fold; unique works and short titles never do', () => {
  const wax = (house = 'Goldin') => ({ id: `w${n++}`, title: '1986 Fleer Basketball Unopened Wax Pack', artist: 'unopened-wax', subCat: 'wax', auctionHouse: house });
  const art = () => ({ id: `a${n++}`, title: 'Untitled', artist: 'christopher-wool', subCat: 'paintings', auctionHouse: "Christie's" });
  const art2 = () => ({ id: `a${n++}`, title: 'Untitled (Black and White Composition)', artist: 'christopher-wool', subCat: 'paintings', auctionHouse: "Christie's" });
  const lots = [wax(), wax(), wax('Heritage'), art(), art(), art2(), art2()];
  const f = foldVariants(lots, NOW);
  assert.deepEqual(f.reps.map(l => l.id), [lots[0].id, lots[2].id, lots[3].id, lots[4].id, lots[5].id, lots[6].id]);
  assert.equal(f.kind.get(lots[0].id), 'title');
  assert.equal(foldKeyOf(lots[3]), null);
  assert.equal(foldKeyOf(lots[5]), null); // fine art: a shared title is not a shared object
});

test('notes: grade list, then the rest; title groups count copies', () => {
  const lots = [
    card('86 Fleer #57 Michael Jordan Rookie Card - PSA GEM MT 10', 300000, 'Goldin'),
    card('86 Fleer #57 Michael Jordan Rookie Card - PSA MINT 9', 20000, 'Goldin'),
    card('86 Fleer #57 Michael Jordan Rookie Card - BGS 9', 15000, 'Goldin'),
    card('86 Fleer #57 Michael Jordan Rookie Card - PSA NM-MT 8', 6000, 'Goldin'),
    card('86 Fleer #57 Michael Jordan Rookie Card - PSA NM 7', 4000, 'Goldin'),
  ];
  const f = foldVariants(lots, NOW);
  const [rep] = f.reps;
  assert.equal(rep.id, lots[0].id);
  assert.equal(foldNote(rep, f.siblings.get(rep.id)!, 'card'), 'Also PSA 9, BGS 9 · 2 more grades');
  assert.equal(foldNote(rep, [lots[1], lots[1]], 'title'), '+2 more of this lot');
  assert.equal(foldNote(rep, [], 'card'), null);
  assert.equal(gradeLabel(parseCard('2025 Pokemon Japanese Mega Dream #246 Mega Dragonite ex - CGC PRISTINE 10')), 'CGC 10 Pristine');
  assert.equal(gradeLabel(parseCard('1970 Topps #189 Thurman Munson Rookie PSA NM-MT 8 (OC)')), 'PSA 8 (OC)');
});

test('query: the shared title prefix, cut to a whole word, matches every member', () => {
  const lots = [
    card('1970 Topps #189 Thurman Munson Rookie PSA EX 5', 1),
    card('1970 Topps #189 Thurman Munson Rookie PSA EX-MT 6', 1),
    card('1970 Topps #189 Thurman Munson Rookie SGC 7', 1),
  ];
  const q = foldQuery(lots)!;
  assert.equal(q, '1970 topps #189 thurman munson rookie');
  for (const l of lots) assert.ok(l.title.toLowerCase().includes(q));
  // never cut mid-word
  assert.equal(foldQuery([card('1952 Topps #311 Mickey Mantle PSA 1', 1), card('1952 Topps #311 Mickey Mantleish PSA 2', 1)]), '1952 topps #311 mickey');
  // too little in common to search
  assert.equal(foldQuery([card('Lot A of things here', 1), card('Lot B of things here', 1)]), null);
});
