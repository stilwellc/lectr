/**
 * Pricing fix wave 5 (Oct 6 2026) — object-type comp boundaries: paper
 * format, subject-only titles, space missions and flight status, jewelry /
 * material culture, another named work of a suite, another colorway.
 * docs/ENGINE_LANES.md §16.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  paperFormatOf, paperFormatConflict, missionsOf, missionConflict, flightOf, flightConflict,
  isBareSubjectTitle, workConflict, colorConflict, objectClassesOf5, objectBoundaryFault, bulkOf, compPurityFault, type PurityLot,
} from '../../app/lib/comp-purity';
import { setEngineFlags, estimateValueEx, ENGINE_FLAGS_CURRENT, BOUNDARY5, type Comp, type EngineFlags } from '../../app/lib/value';
import { buildIdf, type Match } from '../../app/lib/similarity';
import type { AuctionLot } from '../../app/types';

const mem = (title: string, o: Record<string, unknown> = {}) => ({ artist: 'entertainment-memorabilia', category: 'object', title, ...o }) as PurityLot;
const space = (title: string) => ({ artist: 'space-exploration', category: 'object', title }) as PurityLot;
const art = (title: string, artist = 'pablo-picasso') => ({ artist, title, category: 'print', formKey: 'print' }) as PurityLot;

test('paperFormatOf: manuscript > letter > check > document > signature, first named wins', () => {
  assert.equal(paperFormatOf("Rudyard Kipling Handwritten Manuscript Page from 'Stalky & Co.'"), 'manuscript');
  assert.equal(paperFormatOf('King Edward VII Autograph Letter Signed'), 'letter');
  assert.equal(paperFormatOf('Chaim Weizmann TLS'), 'letter');
  assert.equal(paperFormatOf('Bela Lugosi Document Signed'), 'document');
  assert.equal(paperFormatOf('Rube Goldberg Signed Agency Contract'), 'document');
  assert.equal(paperFormatOf('King Edward VII Signature'), 'signature');
  assert.equal(paperFormatOf('Ronald Reagan Signed Photograph'), null);
});

test('paperFormatConflict: signature ~ letter and manuscript ~ anything; letter ~ document and signature ~ document stay', () => {
  assert.ok(paperFormatConflict('King Edward VII Autograph Letter Signed', 'King Edward VII Signature'));
  assert.ok(paperFormatConflict('Kipling Handwritten Manuscript Page', 'Kipling Handwritten Letter Signed'));
  assert.ok(!paperFormatConflict('Nicholas I Handwritten Letter Signed', 'Nicholas I Document Signed'));
  assert.ok(!paperFormatConflict('Chico Marx Document Signed', 'Chico Marx Signature'));
  assert.ok(!paperFormatConflict('Chico Marx Signed Photograph', 'Chico Marx Signature'), 'no format on one side');
});

test('missionsOf / missionConflict: a mission is a designator across programs; a range names each mission', () => {
  assert.deepEqual(Array.from(missionsOf('Skylab 2 Flown Robbins Medallion')), ['skylab2']);
  assert.ok(missionsOf('Space Shuttle: STS-1-STS-5 (5) Unflown Robbins Medallions').has('sts3'));
  assert.ok(missionConflict('Skylab 2 Flown Robbins Medallion', 'Apollo 11 Flown Robbins Medallion'));
  assert.ok(missionConflict('Apollo 11 Crew-Signed $1 Dollar Bill', 'Skylab 3 Crew-Signed Dollar Bill'));
  assert.ok(!missionConflict('Apollo 14 Flown American Flag', 'Apollo 14 Flown Spanish Flag'));
  assert.ok(!missionConflict('Apollo 14 Flown American Flag', 'Flown American Flag'), 'no mission on one side');
});

test('flightOf / flightConflict: lunar-surface flown, flown and unflown are three markets', () => {
  assert.equal(flightOf('Apollo 14 Lunar Surface-Flown American Flag'), 'surface');
  assert.equal(flightOf('Apollo 14 Flown American Flag'), 'flown');
  assert.equal(flightOf('Apollo 16 Unflown Robbins Medallion'), 'unflown');
  assert.equal(flightOf('Apollo 16 Robbins Medallion'), null);
  assert.ok(flightConflict('Apollo 14 Flown American Flag', 'Apollo 14 Lunar Surface-Flown American Flag'));
  assert.ok(!flightConflict('Apollo 14 Flown American Flag', 'Apollo 14 American Flag'));
});

test('isBareSubjectTitle: the title IS its stamped subject, or ≤ 2 words naming no object', () => {
  assert.ok(isBareSubjectTitle(mem('Woodrow Wilson', { subjectKeys: ['woodrow wilson'] })));
  assert.ok(isBareSubjectTitle(mem('Vivien Leigh and Laurence Olivier', { subjectKeys: ['vivien leigh'] })));
  assert.ok(isBareSubjectTitle(mem('John F. Kennedy: John Jr and Caroline', { subjectKeys: ['john f kennedy'] })));
  assert.ok(isBareSubjectTitle(space('Gemini')));
  assert.ok(isBareSubjectTitle(space('[Apollo Lunar Module]')));
  assert.ok(!isBareSubjectTitle(mem('Ed Sullivan Emmy Award Nomination', { subjectKeys: ['ed sullivan emmy award'] })), 'an object noun');
  assert.ok(!isBareSubjectTitle(space('Cosmonaut Suit')), 'an object noun');
  assert.ok(!isBareSubjectTitle(mem('Rod Steiger Signed Photograph', { subjectKeys: ['rod steiger'] })));
  assert.ok(!isBareSubjectTitle(art('Woodrow Wilson', 'andy-warhol')), 'memorabilia only');
});

test('workConflict: two named works each carrying a word the other lacks; added words alone are not a conflict', () => {
  assert.ok(workConflict(art('Minotaure, buveur et femmes, from La Suite Vollard'), art('Minotaure caressant une femme, from: La Suite Vollard')));
  assert.ok(workConflict(art('Figure au corsage rayé'), art('Pablo Picasso (1881-1973) Femme au corsage à fleurs')));
  assert.ok(!workConflict(art('Minotaure, buveur et femmes, from La Suite Vollard'), art('PABLO PICASSO (1881-1973) Minotaur, buveur et femmes, from La Suite Vollard')), 'spelling');
  assert.ok(!workConflict(art('Toros'), art('Vallauris 1956 Toros')), 'one side only adds words');
  assert.ok(!workConflict(art('La Sieste: Couple (from La Série 347)'), art('Untitled (from La Série 347)')), 'untitled carries no words');
});

test('colorConflict: art colorways that share nothing; one side silent is no claim', () => {
  assert.ok(colorConflict(art('Balloon Dog (Red)', 'jeff-koons'), art('Balloon Dog (Blue)', 'jeff-koons')));
  assert.ok(!colorConflict(art('Balloon Dog (Red)', 'jeff-koons'), art('Red Balloon Dog', 'jeff-koons')));
  assert.ok(!colorConflict(art('Balloon Dog (Red)', 'jeff-koons'), art('Balloon Dog', 'jeff-koons')));
});

test('objectClassesOf5 + objectBoundaryFault: jewelry / material culture never priced by paper or photographs', () => {
  assert.ok(objectClassesOf5('KENNEDY JOHN, JACKIE, CAROLINE & JOHN JR. CHARM BRACELET PAIR.').has('jewelry'));
  const t = mem('KENNEDY JOHN, JACKIE, CAROLINE & JOHN JR. CHARM BRACELET PAIR.', { subjectKeys: ['kennedy john'] });
  assert.equal(objectBoundaryFault(t, mem('John F. Kennedy, Jr. and Caroline Kennedy Photograph'), BOUNDARY5), 'object');
  assert.equal(objectBoundaryFault(t, mem('John F. Kennedy: John Jr and Caroline', { subjectKeys: ['john f kennedy'] }), BOUNDARY5), 'identity-less');
  assert.equal(objectBoundaryFault(mem('Chaim Weizmann Typed Letter Signed'), mem('Chaim Weizmann Signature'), BOUNDARY5), 'format');
  assert.equal(objectBoundaryFault(space('Skylab 2 Flown Robbins Medallion'), space('Apollo 11 Flown Robbins Medallion'), BOUNDARY5), 'mission');
  assert.equal(objectBoundaryFault(mem('Chaim Weizmann Typed Letter Signed'), mem('Chaim Weizmann Typed Letter Signed'), BOUNDARY5), null);
  assert.equal(objectBoundaryFault(art('Figure au corsage rayé'), art('Femme au corsage à fleurs'), { work: 1 }), 'work');
  assert.equal(objectBoundaryFault(art('Figure au corsage rayé'), art('Femme au corsage à fleurs'), BOUNDARY5), null, 'work is a purity fault, not a pool boundary');
  assert.equal(objectBoundaryFault(mem('Woodrow Wilson Signed Photograph'), mem('Woodrow Wilson', { subjectKeys: ['woodrow wilson'] }), {}), null, 'every rule off');
});

test('compPurityFault(work): another named work / colorway carries no call only when asked', () => {
  assert.equal(compPurityFault(art('Figure au corsage rayé'), art('Femme au corsage à fleurs')), null);
  assert.equal(compPurityFault(art('Figure au corsage rayé'), art('Femme au corsage à fleurs'), true), 'work');
});

test('bulkOf: an explicit count of ≥ 3, a collection or an archive; a year in parentheses is not a count', () => {
  assert.equal(bulkOf('Collection of (52) Space Shuttle Robbins Medallions'), 'bulk');
  assert.equal(bulkOf('Bob Dylan (4) Signed Giclée Prints'), 'bulk');
  assert.equal(bulkOf('King Charles III Signed Christmas Card (1980)'), 'one');
  assert.equal(bulkOf('Bob Dylan Signed Giclée Print'), 'one');
});

const M = (cosine: number): Match => ({ score: Math.round(cosine * 100), cosine, cls: 'similar', reasons: [] });
const with_ = (o: Partial<EngineFlags>): EngineFlags => ({ ...ENGINE_FLAGS_CURRENT, ...o, version: `${ENGINE_FLAGS_CURRENT.version}~t` });
const tbl = buildIdf([]);
const lotOf = (title: string, o: Record<string, unknown> = {}) => ({
  id: 't', title, artist: 'entertainment-memorabilia', category: 'object', auctionHouse: 'RR Auction', status: 'upcoming', saleDate: '2026-10-08', estLowUsd: 300, ...o,
} as unknown as AuctionLot);
const compOf = (id: string, title: string, usd: number, o: Record<string, unknown> = {}): Comp => ({
  id, match: M(0.9), realizedUsd: usd, saleDate: '2025-12-01',
  lot: { id, title, artist: 'entertainment-memorabilia', category: 'object', status: 'sold', saleDate: '2025-12-01', realizedUsd: usd, ...o } as unknown as AuctionLot,
});

test('engine: objectBoundary keeps signatures out of a letter pool; memIdLessAbstain withholds a subject-only title', () => {
  const t = lotOf('King Edward VII Autograph Letter Signed');
  const comps = [
    compOf('a', 'King Edward VII Autograph Letter Signed', 300), compOf('b', 'King Edward VII Autograph Letter Signed', 320),
    compOf('c', 'King Edward VII Autograph Letter Signed', 280), compOf('s1', 'King Edward VII Signature', 240), compOf('s2', 'King Edward VII Signature', 245),
  ];
  setEngineFlags(with_({ objectBoundary: false }));
  const off = estimateValueEx(t, comps, tbl).value!;
  setEngineFlags(with_({ objectBoundary: true }));
  const on = estimateValueEx(t, comps, tbl).value!;
  assert.deepEqual(off.poolIds.slice().sort(), ['a', 'b', 'c', 's1', 's2']);
  assert.deepEqual(on.poolIds.slice().sort(), ['a', 'b', 'c']);
  const bare = lotOf('Woodrow Wilson', { subjectKeys: ['woodrow wilson'] });
  const wcomps = [compOf('w1', 'Woodrow Wilson Portrait', 300), compOf('w2', 'Woodrow Wilson Portrait', 310), compOf('w3', 'Woodrow Wilson Portrait', 320)];
  setEngineFlags(with_({ memIdLessAbstain: false }));
  assert.ok(estimateValueEx(bare, wcomps, tbl).value);
  setEngineFlags(with_({ memIdLessAbstain: true }));
  assert.equal(estimateValueEx(bare, wcomps, tbl).abstain, 'identity-less');
  setEngineFlags(null);
});
