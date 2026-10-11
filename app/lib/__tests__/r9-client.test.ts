/**
 * r9 CLIENT FIXES (QA4 B2, B3, C1–C4).
 *  B2  card lots: the lot page and the modal print ONE card value and max bid
 *      (lot-face's card path)
 *  B3  "This model last sold for" is the latest sale of the same model
 *  C4  phone feed rows print the live bid under the printed-bid gate
 *  C1  a followed maker surfaces their book; a narrow taste deals deeper
 *  C2  one seat per card identity across grades (TCG too), the twin named
 *  C3  signed-out copy says which follows need an account
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { lotFace } from '../lot-face';
import { lotMaxBid } from '../verdict';
import { latestExactSale, titleIdentity } from '../exact-sale';
import { buildTaste, recommend, recDepth, recNote, cardIdentityKey, REC_DEAL, type RecLot } from '../recs';
import { entityFollow } from '../follows';
import { parseCard } from '../cards';
import { feedRowPrice } from '../estimate-text';
import type { AuctionLot } from '../../types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const UP = path.join(ROOT, 'public/data/ray/upcoming.json');

/* ── B2 ─────────────────────────────────────────────────────────────────── */

const MANTLE = {
  id: 'goldin-mantle', artist: 'sports-cards', title: '1951 Bowman #253 Mickey Mantle Rookie Card - SGC VG 3',
  status: 'upcoming', auctionHouse: 'Goldin', saleDate: '2026-10-20', currentBid: 4750, bidCount: 8,
  value: {
    poolIds: ['rea-177106', 'rea-193078'], n: 2, compValueUsd: 23989, low: 15545, high: 37687, compRatio: null, signal: null,
    estimateUsd: 23989, vsBid: null, confidence: 'medium', exact: null, basis: 'card-comp', cardTier: 'exact',
    expectedHammerUsd: 19663, bandLowUsd: 12742, bandHighUsd: 30891, maxBidUsd: 17028, premiumFactor: 1.22,
  },
  cardComps: { med: 10370, n: 11, lastSales: [{ d: '2026-08-16', p: 24600 }, { d: '2023-11-02', p: 10370 }], gradeLadder: [] },
  signal: null,
} as unknown as AuctionLot;

test('B2: a card lot has one value, one max bid, and its same-card record beside them', () => {
  const f = lotFace(MANTLE);
  assert.ok(f.value, 'the card value prints');
  assert.strictEqual(f.value!.hammer, 19663);
  assert.ok(f.maxBid, 'the max bid prints');
  assert.strictEqual(f.maxBid!.hammer, 17028);
  assert.ok(f.maxBid!.hammer <= f.value!.hi, 'the max bid sits inside the value it is read from');
  assert.ok(f.card);
  assert.strictEqual(f.card!.basis, 'from 2 comparable card sales');
  assert.strictEqual(f.card!.med, 10370);
  assert.match(f.card!.sub, /^median · 11 sales, same card & grade$/);
  assert.deepStrictEqual(f.card!.last, { p: 24600, d: '2026-08-16' });
});

test('B2: the lot page and the modal read the card figures from lot-face only', () => {
  const page = src('app/components/LotPage.tsx');
  const modal = src('app/components/ComparableModal.tsx');
  // the value row no longer hides on card lots
  assert.doesNotMatch(page, /face\?\.value && lot\.value\?\.basis !== 'card-comp'/);
  // no second max bid / card median read of the page's own
  assert.doesNotMatch(page, /lotMaxBid\(/);
  assert.doesNotMatch(page, /lot\.cardComps\.med/);
  assert.match(page, /face\?\.maxBid/);
  assert.match(page, /face\.card\.basis/);
  assert.match(modal, /face\.maxBid\.text/);
  assert.match(modal, /face\.card\?\.basis/);
});

test('B2: on the served book every valued card lot prints a value and the engine max bid', { skip: !existsSync(UP) }, () => {
  const lots = (JSON.parse(readFileSync(UP, 'utf8')) as { lots: AuctionLot[] }).lots;
  let n = 0;
  for (const l of lots) {
    if (l.value?.basis !== 'card-comp') continue;
    const ab = (l.value as { abstain?: string | null }).abstain;
    if (typeof ab === 'string' && ab.startsWith('card:')) continue;
    const f = lotFace(l);
    const mb = lotMaxBid(l);
    assert.deepStrictEqual(f.maxBid ? { hammer: f.maxBid.hammer, allIn: f.maxBid.allIn } : null, mb, l.id);
    if (mb) { assert.ok(f.value, `${l.id}: a max bid never prints without its value`); n++; }
  }
  assert.ok(n > 0);
});

/* ── B3 ─────────────────────────────────────────────────────────────────── */

const sold = (id: string, title: string, saleDate: string, priceUsd: number): AuctionLot => ({
  id, artist: 'pablo-picasso', title, saleDate, priceUsd, status: 'sold', category: 'original', auctionHouse: "Christie's",
} as unknown as AuctionLot);

test('B3: "this model last sold for" is the latest sale of the same model', () => {
  const a = sold('c-1996', 'Pablo Picasso (1881-1973) Tête de fou', '1996-11-13', 574500);
  const b = sold('c-2020', 'Pablo Picasso (1881-1973) Tête de fou', '2020-02-05', 1062189);
  const c = sold('c-2018', 'Pablo Picasso (1881-1973) Le Fou', '2018-11-11', 2052500);
  const stamp = { id: a.id, realizedUsd: 574500, saleDate: '1996-11-13', cls: 'modelMatch' };
  const r = latestExactSale(stamp, a, [a, b, c]);
  assert.ok(r);
  assert.strictEqual(r!.id, 'c-2020');
  assert.strictEqual(r!.realizedUsd, 1062189);
  // a different work is never the model's sale; a stamp with no later twin stands
  assert.strictEqual(latestExactSale(stamp, a, [a, c])!.id, 'c-1996');
  // a title naming no single identity (a print and its portfolio) makes no claim
  const p1 = sold('m1', 'Mao', '2008-06-29', 86400), p2 = sold('m2', 'Mao', '2007-10-16', 1655453);
  assert.strictEqual(latestExactSale({ id: 'm1', realizedUsd: 86400, saleDate: '2008-06-29', cls: 'modelMatch' }, p1, [p1, p2]), null);
  assert.strictEqual(titleIdentity('ED RUSCHA (B. 1937) The End', 'ed ruscha'), 'the end');
});

test('B3: the engine stamps the latest identity match; the modal resolves it', () => {
  assert.match(src('app/lib/value.ts'), /const exactC = latestOf\(top\.filter\(c => c\.match\.cls === 'physicalMatch'\)\)/);
  assert.match(src('app/components/ComparableModal.tsx'), /latestExactSale\(v\.exact, exactLot/);
});

/* ── C4 ─────────────────────────────────────────────────────────────────── */

test('C4: a feed row prints the live bid on a lot without a two-sided estimate', () => {
  const base = { id: 'x', artist: 'a', title: 't', status: 'upcoming', saleDate: '2026-10-20', auctionHouse: 'RR Auction' };
  // RR posts a low only: the bid is the honest lead (formatEstimate's branch)
  assert.strictEqual(feedRowPrice({ ...base, estimateLow: 20000, currentBid: 8000, bidCount: 18 } as unknown as AuctionLot), '$8K bid');
  assert.strictEqual(feedRowPrice({ ...base, estimateLow: 400000, estimateHigh: null, currentBid: 97000 } as unknown as AuctionLot), '$97K bid');
  // a two-sided estimate prints as the card prints it, labelled
  assert.strictEqual(feedRowPrice({ ...base, estimateLow: 7_980_000, estimateHigh: 10_640_000 } as unknown as AuctionLot), '$8.0M–$10.6M est.');
  // a bound with no bid keeps its side; nothing to print is a dash
  assert.strictEqual(feedRowPrice({ ...base, estimateLow: 20000 } as unknown as AuctionLot), 'from $20K est.');
  assert.strictEqual(feedRowPrice({ ...base } as unknown as AuctionLot), '—');
  assert.strictEqual(feedRowPrice({ ...base, auctionHouse: 'Goldin' } as unknown as AuctionLot), '—');
});

/* ── C1 / C2 ────────────────────────────────────────────────────────────── */

const NOW = Date.parse('2026-10-09T20:00:00Z');
const at = (d: number) => new Date(NOW + d * 864e5).toISOString();

test('C1: one followed maker surfaces their book, and a narrow taste deals deeper', () => {
  const pool: RecLot[] = [];
  for (let i = 0; i < 80; i++) pool.push({
    id: `w-${i}`, artist: 'andy-warhol', ek: 'mk:andy-warhol', title: `Warhol print ${i}`, subCat: 'prints', status: 'upcoming',
    auctionHouse: ['Phillips', "Christie's", "Sotheby's", 'Bonhams'][i % 4], saleName: `S${i % 7}`,
    saleDate: at(2 + (i % 9)).slice(0, 10), saleDateTime: at(2 + (i % 9)), estimateLow: 10000 + i * 500, estimateHigh: 15000 + i * 500, currency: 'USD',
  });
  const taste = buildTaste({ saved: [], follows: [{ kind: 'maker', key: 'andy-warhol', label: 'Andy Warhol' }], nowMs: NOW });
  const std = recommend(pool, taste, { n: REC_DEAL, nowMs: NOW });
  assert.ok(std.length >= 20, `a single follow fills the list (got ${std.length}; was ~40% of the seats)`);
  const depth = recDepth(taste);
  assert.strictEqual(depth, REC_DEAL * 2);
  const deep = recommend(pool, taste, { n: depth, nowMs: NOW });
  assert.ok(deep.length > std.length, 'Show more reveals more of the book');
  // the standard list is the deep list's prefix (one deal, two depths)
  assert.deepStrictEqual(deep.slice(0, std.length).map(r => r.lot.id), std.map(r => r.lot.id));
  // a broad taste keeps the standard deal
  const broad = buildTaste({ saved: [], follows: [
    { kind: 'maker', key: 'a', label: 'A' }, { kind: 'maker', key: 'b', label: 'B' }, { kind: 'house', key: 'Phillips', label: 'Phillips' },
  ], nowMs: NOW });
  assert.strictEqual(recDepth(broad), REC_DEAL);
});

test('C2: the same Pokémon card in two grades is one seat; the kept pick names the other', () => {
  const tcg = (id: string, title: string, bid: number): RecLot => ({
    id, artist: 'pokemon', ek: 'sj:tcg|k:charizard', title, subCat: 'singles', status: 'upcoming', auctionHouse: 'Goldin', saleName: `Sale ${id}`,
    saleDate: at(4).slice(0, 10), saleDateTime: at(4), currentBid: bid, bidCount: 5, currency: 'USD',
  });
  const raw = tcg('raw', '2002 Pokemon Legendary Collection Reverse Holo #3 Charizard', 4500);
  const psa = tcg('psa', '2002 Pokemon Legendary Collection Reverse Holo #3 Charizard - PSA GEM MT 10', 110000);
  const other = tcg('oth', '1999 Pokemon Base Set Holo #4 Charizard - PSA NM-MT 8', 6000);
  assert.ok(cardIdentityKey(parseCard(raw.title), 'tcg'));
  assert.strictEqual(cardIdentityKey(parseCard(raw.title), 'tcg'), cardIdentityKey(parseCard(psa.title), 'tcg'));
  assert.notStrictEqual(cardIdentityKey(parseCard(raw.title), 'tcg'), cardIdentityKey(parseCard(other.title), 'tcg'));
  const taste = buildTaste({ saved: [], follows: [entityFollow('sj:tcg|k:charizard', 'Charizard')], nowMs: NOW });
  const recs = recommend([raw, psa, other], taste, { n: 24, nowMs: NOW });
  const got = recs.map(r => r.lot.id).filter(id => id === 'raw' || id === 'psa');
  assert.strictEqual(got.length, 1, 'one seat for the card');
  const kept = recs.find(r => r.lot.id === got[0])!;
  assert.match(kept.reason, /also live (?:raw|as PSA 10)$/);
  assert.match(recNote(kept, { short: true }), /also live/);
});

/* ── C3 ─────────────────────────────────────────────────────────────────── */

test('C3: signed-out copy promises no-account follows only for the kinds that keep them', () => {
  const profile = src('app/profile/page.tsx');
  const signedOut = profile.match(/signedOut\s*\?\s*<>([^<]*)<\/>/)?.[1] ?? '';
  assert.ok(signedOut, 'the signed-out sentence');
  const free = signedOut.split('no account needed')[0];
  assert.doesNotMatch(free, /maker|player/i, 'makers and players need an account signed out');
  assert.match(signedOut, /sign in to follow makers and players/);
  // the sheet a maker / player Follow opens says follow, not "save lots"
  assert.match(src('app/components/FollowButton.tsx'), /openLogin\('follow'\)/);
  assert.match(src('app/lib/account.tsx'), /Sign in to follow makers and players/);
});
