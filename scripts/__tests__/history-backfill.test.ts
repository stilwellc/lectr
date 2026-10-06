/**
 * Sotheby's / Wright history backfill (.github/workflows/backfill-history.yml):
 * the Sotheby's Algolia hit → row parsing + dedupe, the Wright-group house
 * attribution (the LAMA mislabel), and the maker selector.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARTISTS } from '../lib/houses/artists';
import {
  buildSothebysKnown, dedupeVerdict, detailsPrice, hitBelongsTo, hitToLot, lotIdOf, lotPathKey,
  priceCurrencyOf, saleNameOf, titleOf, catalogueFacts, type AlgoliaLotHit,
} from '../lib/houses/sothebys-history';
import {
  WRIGHT_HOUSE_SKIPS, fixWrightRagoSessions, parseWrightAdvancedItem, parseWrightBasicItem,
  wrightGroupHouseOf, wrightGroupUrl, wrightPlatformKey,
} from '../lib/houses/wright';
import { parseLamaItem } from '../lib/houses/lama';
import { historyCounts, resolveHistoryMakers } from '../lib/history-backfill';
import type { AuctionLot } from '../../app/types';

const UUID = '9619a8a2-64d8-4038-a9c2-3b2a7059932b';
const hit = (o: Partial<AlgoliaLotHit> = {}): AlgoliaLotHit => ({
  objectID: UUID,
  url: 'https://www.sothebys.com/en/buy/auction/2021/contemporary-art-evening-auction/versus-medici-2',
  title: 'versus medici',
  conciseHeading: ' Jean-Michel Basquiat, Versus Medici',
  salePrice: 50820000,
  hammerPrice: null,
  details: '12 May 2021 | Sale price: 50,820,000 USD',
  soldStatus: 'SOLD',
  lowEstimate: 35000000, highEstimate: 50000000, estimateCurrency: 'USD',
  artistName: 'Jean-Michel Basquiat', artists: ['Jean-Michel Basquiat'], departments: ['Contemporary Art'],
  endDate: Date.parse('2021-05-12T23:00:00Z'), lotNumber: '105',
  fullText: 'Jean-Michel Basquiat 1960 - 1988 Versus Medici acrylic, oilstick and paper collage on canvas 84 ¼ by 54 ¼ in. Executed in 1982.',
  ...o,
});

// ── Sotheby's: parsing ──────────────────────────────────────────────────────

test('sothebys: lot id = the objectID uuid (≡ GraphQL lotId); legacy ids too; junk → null', () => {
  assert.equal(lotIdOf(hit()), UUID);
  assert.equal(lotIdOf(hit({ objectID: '00000164-6442-d1db-a5e6-ed6762690000' })), '00000164-6442-d1db-a5e6-ed6762690000');
  assert.equal(lotIdOf(hit({ objectID: 'DPPWC' })), null);
  assert.equal(lotIdOf(hit({ objectID: null })), null);
});

test('sothebys: lot path key for both URL shapes; non-lot pages are not keys', () => {
  assert.equal(lotPathKey('https://www.sothebys.com/en/buy/auction/2021/sale-a/lot-b?locale=en'), '/buy/auction/2021/sale-a/lot-b');
  assert.equal(lotPathKey('https://www.sothebys.com/en/auctions/ecatalogue/2004/contemporary-art-part-two-n07995/lot.371.html'), '/auctions/ecatalogue/2004/contemporary-art-part-two-n07995/lot.371.html');
  assert.equal(lotPathKey('https://www.sothebys.com/en/artists/jean-michel-basquiat'), null);
  assert.equal(lotPathKey(''), null);
});

test('sothebys: sale name from the slug (ecatalogue sale number stripped)', () => {
  assert.equal(saleNameOf('https://www.sothebys.com/en/buy/auction/2021/contemporary-art-evening-auction/x'), 'Contemporary Art Evening Auction');
  assert.equal(saleNameOf('https://www.sothebys.com/en/auctions/ecatalogue/2004/contemporary-art-part-two-n07995/lot.371.html'), 'Contemporary Art Part Two');
  assert.equal(saleNameOf('https://www.sothebys.com/en/auctions/ecatalogue/2012/important-watches-hk0389/lot.2178.html'), 'Important Watches');
  assert.equal(saleNameOf('', 'Fallback Title'), 'Fallback Title');
});

test('sothebys: title prefers the cased heading forms over the lower-cased index title', () => {
  assert.equal(titleOf(hit()), 'Versus Medici');
  assert.equal(titleOf(hit({ imageAltText: 'View 1 of Lot 214: Untitled (Three Heads)' })), 'Untitled (Three Heads)');
  assert.equal(titleOf(hit({ conciseHeading: null, title: 'jean-michel basquiat | flexible' })), 'flexible');
});

test('sothebys: currency is fail-closed', () => {
  assert.deepEqual(detailsPrice('29 September 2026 | Sale price: 3,584,000 HKD'), { amount: 3584000, code: 'HKD' });
  assert.equal(priceCurrencyOf(hit()), 'USD');
  assert.equal(priceCurrencyOf(hit({ details: null, estimateCurrency: 'GBP' })), 'GBP');
  assert.equal(priceCurrencyOf(hit({ details: 'Sale price: 50,820,000 INR' })), null, 'unconvertible code');
  assert.equal(priceCurrencyOf(hit({ details: 'Sale price: 1,000 USD' })), null, 'details amount disagrees with salePrice');
  assert.equal(priceCurrencyOf(hit({ details: null, estimateCurrency: null })), null);
  assert.equal(priceCurrencyOf(hit({ details: null, estimateCurrency: 'SGD' })), null);
});

test('sothebys: a sold hit becomes a crawler-shaped row (premium-inclusive realized, dated FX, sale-zone day)', () => {
  const l = hitToLot(hit(), 'jean-michel-basquiat') as AuctionLot;
  assert.equal(typeof l, 'object');
  assert.equal(l.id, `sothebys-${UUID}`);
  assert.equal(l.auctionHouse, "Sotheby's");
  assert.equal(l.status, 'sold');
  assert.equal(l.priceBasis, 'realized');
  assert.equal(l.premiumNative, 50820000);
  assert.equal(l.hammerNative, null);
  assert.equal(l.realizedUsd, 50820000);
  assert.equal(l.estLowNative, 35000000);
  // 23:00Z on 12 May is 7 PM in New York — the sale's own calendar day
  assert.equal(l.saleDate, '2021-05-12');
  assert.equal(l.saleDateTime, '2021-05-12T23:00:00.000Z');
  assert.equal(l.lotNumber, 105);
  assert.equal(l.saleName, 'Contemporary Art Evening Auction');
  assert.equal(l.title, 'Versus Medici');
  assert.match(String(l.medium), /^acrylic/);
  assert.equal(l.year, '1982');
  // a 00:00Z NY evening close stays on the evening's day, not the next UTC day
  const ny = hitToLot(hit({ endDate: Date.parse('2010-11-10T00:00:00Z') }), 'jean-michel-basquiat') as AuctionLot;
  assert.equal(ny.saleDate, '2010-11-09');
});

test('sothebys: a hammer rides only when plausible under the total; estimates only in the price currency', () => {
  const ok = hitToLot(hit({ salePrice: 534400, details: null, hammerPrice: 470000 }), 'x') as AuctionLot;
  assert.equal(ok.hammerNative, 470000);
  assert.equal(ok.premiumNative, 534400);
  assert.equal(ok.buyerPremiumPct, 13.7);
  const equal = hitToLot(hit({ salePrice: 500000, details: null, hammerPrice: 500000 }), 'x') as AuctionLot;
  assert.equal(equal.hammerNative, null, 'hammer == total is not a hammer under a premium');
  const wild = hitToLot(hit({ salePrice: 500000, details: null, hammerPrice: 100000 }), 'x') as AuctionLot;
  assert.equal(wild.hammerNative, null, '5× is no buyer premium');
  const fx = hitToLot(hit({ details: 'Sale price: 50,820,000 USD', estimateCurrency: 'GBP' }), 'x') as AuctionLot;
  assert.equal(fx.estLowNative, null);
  assert.equal(fx.estHighNative, null);
});

test('sothebys: unsold / unpriced / undated / pre-since / bad-currency hits are skipped with a reason', () => {
  assert.equal(hitToLot(hit({ soldStatus: 'UNSOLD' }), 'x'), 'not-sold');
  assert.equal(hitToLot(hit({ salePrice: 0 }), 'x'), 'no-price');
  assert.equal(hitToLot(hit({ endDate: null }), 'x'), 'no-date');
  assert.equal(hitToLot(hit({ objectID: 'abc' }), 'x'), 'no-lot-id');
  assert.equal(hitToLot(hit({ details: 'Sale price: 50,820,000 INR' }), 'x'), 'currency');
  assert.equal(hitToLot(hit(), 'x', { sinceMs: Date.UTC(2022, 0, 1) }), 'before-since');
});

test('sothebys: art belongs by CREATOR + art department; watches by Watches dept + watch signal', () => {
  assert.ok(hitBelongsTo(hit(), 'jean-michel-basquiat'));
  assert.ok(!hitBelongsTo(hit({ artistName: 'After Jean-Michel Basquiat' }), 'jean-michel-basquiat'));
  assert.ok(!hitBelongsTo(hit({ artistName: 'Andy Warhol', title: 'portrait of jean-michel basquiat' }), 'jean-michel-basquiat'));
  assert.ok(!hitBelongsTo(hit({ artistName: null, artists: [], brands: [] }), 'jean-michel-basquiat'), 'title-only mention');
  assert.ok(!hitBelongsTo(hit({ departments: ['Books & Manuscripts'] }), 'jean-michel-basquiat'));
  assert.ok(hitBelongsTo(hit({ departments: [] }), 'jean-michel-basquiat'), 'no department at all is allowed');
  // a collaboration routes like the crawler's creatorsDisplayTitle (first tracked name)
  assert.ok(hitBelongsTo(hit({ artistName: 'Andy Warhol and Jean-Michel Basquiat' }), 'andy-warhol'));
  const w = (o: Partial<AlgoliaLotHit>) => hit({ artistName: null, artists: [], departments: ['Watches'], brands: ['Patek Philippe'], conciseHeading: null, ...o });
  assert.ok(hitBelongsTo(w({ title: 'reference 5711 a stainless steel wristwatch' }), 'patek-philippe'));
  assert.ok(!hitBelongsTo(w({ title: 'calatrava cross | a pair of pink gold cufflinks' }), 'patek-philippe'));
  assert.ok(!hitBelongsTo(w({ title: 'reference 5711 a stainless steel wristwatch', departments: ['Jewelry'] }), 'patek-philippe'));
  assert.ok(!hitBelongsTo(w({ title: 'a gold box' }), 'patek-philippe'), 'no watch signal');
});

test('sothebys: catalogue-line archive titles yield medium/year/dimensions', () => {
  const f = catalogueFacts(hit({ fullText: null, conciseHeading: null, title: 'sell grit', imageAltText: 'Sell Grit, 1983, acrylic and paper collage on canvas, 143.5 by 180cm.' }));
  assert.equal(f.year, '1983');
  assert.equal(f.medium, 'acrylic and paper collage on canvas');
  assert.equal(f.dimensions, '143.5 by 180cm.');
});

test('sothebys dedupe: both crawled id schemes + crawled paths block; a seed-only path is superseded', () => {
  const known = buildSothebysKnown([
    { id: `sothebys-alg-${UUID}`, auctionHouse: "Sotheby's", url: 'https://www.sothebys.com/en/buy/auction/2020/a/b' },
    { id: 'sothebys-11111111-2222-3333-4444-555555555555', auctionHouse: "Sotheby's", url: 'https://www.sothebys.com/en/buy/auction/2020/a/crawled' },
    { id: 'sothebys-versus-medici-2', auctionHouse: "Sotheby's", url: 'https://www.sothebys.com/en/buy/auction/2021/contemporary-art-evening-auction/versus-medici-2' },
    { id: 'christies-1', auctionHouse: "Christie's", url: 'https://www.sothebys.com/en/buy/auction/2020/a/other' },
  ]);
  const lot = (id: string, url: string) => ({ id, url });
  assert.equal(dedupeVerdict(known, lot(`sothebys-${UUID}`, 'https://x/en/buy/auction/2020/z/z')), 'dup-id');
  assert.equal(dedupeVerdict(known, lot('sothebys-11111111-2222-3333-4444-555555555555', 'https://x/buy/auction/2020/q/q')), 'dup-id');
  assert.equal(dedupeVerdict(known, lot('sothebys-aaaaaaaa-2222-3333-4444-555555555555', 'https://www.sothebys.com/en/buy/auction/2020/a/crawled')), 'dup-path');
  assert.equal(dedupeVerdict(known, lot('sothebys-bbbbbbbb-2222-3333-4444-555555555555', 'https://www.sothebys.com/en/buy/auction/2021/contemporary-art-evening-auction/versus-medici-2')), 'supersedes-seed');
  assert.equal(dedupeVerdict(known, lot('sothebys-cccccccc-2222-3333-4444-555555555555', 'https://www.sothebys.com/en/buy/auction/2020/a/other')), 'new', 'another house row never blocks');
});

// ── Wright group: house attribution ─────────────────────────────────────────

const advItem = (house: number | undefined, o: Record<string, unknown> = {}) => ({
  id: 303053, fd_key: '234631~', name: 'Femme au chapeau', alias: 'auctions/2025/05/prints-multiples/199', lot_number: 199,
  result_amount: 6500, result_premium_amount: 8255, item_status: 'Sold', estimate_low: 4000, estimate_high: 6000,
  session: { title: 'Prints & Multiples', start_date: '2025-05-13T17:00:00.000000Z', auction: house === undefined ? {} : { auction_house: house } },
  ...o,
});

test('wright group: house from the numeric auction_house id, a name, the house string, or the alias host', () => {
  assert.equal(wrightGroupHouseOf(advItem(1)), 'Wright');
  assert.equal(wrightGroupHouseOf(advItem(2)), 'Rago');
  assert.equal(wrightGroupHouseOf(advItem(5)), 'LAMA');
  assert.equal(wrightGroupHouseOf(advItem(6)), 'Toomey');
  assert.equal(wrightGroupHouseOf(advItem(9)), 'PAI');
  assert.equal(wrightGroupHouseOf(advItem(77)), 'unknown');
  assert.equal(wrightGroupHouseOf({ auction: { auction_house: { name: 'Rago Arts' } } }), 'Rago');
  assert.equal(wrightGroupHouseOf({ house: 'Toomey & Co.' }), 'Toomey');
  assert.equal(wrightGroupHouseOf({ alias: '//www.lamodern.com/auctions/2025/05/x/1' }), 'LAMA');
  assert.equal(wrightGroupHouseOf({ alias: 'auctions/2025/05/x/1' }), null);
});

test('wright group: relative aliases resolve on the selling house domain', () => {
  assert.equal(wrightGroupUrl('auctions/2026/10/curated-picasso/100', 'Rago'), 'https://www.ragoarts.com/auctions/2026/10/curated-picasso/100');
  assert.equal(wrightGroupUrl('/auctions/x/1', 'Wright'), 'https://www.wright20.com/auctions/x/1');
  assert.equal(wrightGroupUrl('//www.lamodern.com/auctions/x/1', 'Wright'), 'https://www.lamodern.com/auctions/x/1');
});

test('wright advanced item: attributed by house id; LAMA/Toomey items are not the Wright crawler\'s', () => {
  const w = parseWrightAdvancedItem(advItem(1), 'pablo-picasso')!;
  assert.equal(w.id, 'wright-234631~', 'advanced-page scheme unchanged (fd_key)');
  assert.equal(w.auctionHouse, 'Wright');
  assert.equal(w.url, 'https://www.wright20.com/auctions/2025/05/prints-multiples/199');
  const byId = parseWrightAdvancedItem(advItem(1), 'pablo-picasso', { idKey: 'id' })!;
  assert.equal(byId.id, 'wright-303053', 'history walk of a basic page keys by id (≡ the grouped fd_key)');
  const r = parseWrightAdvancedItem(advItem(2), 'pablo-picasso', { idKey: 'id' })!;
  assert.equal(r.id, 'rago-303053');
  assert.equal(r.auctionHouse, 'Rago');
  assert.equal(r.platform, 'wright');
  assert.equal(r.url, 'https://www.ragoarts.com/auctions/2025/05/prints-multiples/199');
  const before = WRIGHT_HOUSE_SKIPS.LAMA || 0;
  assert.equal(parseWrightAdvancedItem(advItem(5), 'pablo-picasso'), null);
  assert.equal(WRIGHT_HOUSE_SKIPS.LAMA, before + 1);
  assert.equal(parseWrightAdvancedItem(advItem(6), 'pablo-picasso'), null);
  assert.equal(parseWrightAdvancedItem(advItem(77), 'pablo-picasso'), null, 'an unmapped group house is skipped, never guessed');
  // no house signal at all → the historical Wright default
  assert.equal(parseWrightAdvancedItem(advItem(undefined), 'pablo-picasso')!.auctionHouse, 'Wright');
});

test('wright advanced item: a "Sold" status with no price is not a sale', () => {
  const l = parseWrightAdvancedItem(advItem(1, { result_amount: 0, result_premium_amount: 0, item_status: 'Sold' }), 'pablo-picasso')!;
  assert.notEqual(l.status, 'sold');
  assert.equal(l.realizedUsd, null);
});

test('wright basic item: a LAMA-house lot on the shared feed is skipped (crawlLama owns it)', () => {
  const base = { fd_key: 303053, name: 'Femme', lot_number: 199, estimate_formatted: '$4,000–6,000', result: 8255, result_sans_premium: 6500 };
  assert.equal(parseWrightBasicItem({ ...base, house: 'LAMA', alias: '//www.lamodern.com/auctions/2025/05/prints-multiples/199' }, {}, 's', 'pablo-picasso'), null);
  const w = parseWrightBasicItem({ ...base, house: 'wright', alias: '/auctions/2025/12/editions-works-on-paper/174' }, { date: '2025-12-16' }, 's', 'pablo-picasso')!;
  assert.equal(w.id, 'wright-303053');
  assert.equal(w.auctionHouse, 'Wright');
  const r = parseWrightBasicItem({ ...base, house: 'Rago', alias: '//www.ragoarts.com/auctions/2026/10/curated-picasso/111' }, { date: '2026-10-13' }, 's', 'pablo-picasso')!;
  assert.equal(r.id, 'rago-303053');
});

test('lama: keeps LAMA-house lots only (the feed is group-wide)', () => {
  const l = parseLamaItem(advItem(5, { alias: 'auctions/2025/05/prints-multiples/199' }), 'pablo-picasso')!;
  assert.equal(l.auctionHouse, 'LAMA');
  assert.equal(l.id, 'lama-234631~');
  assert.equal(parseLamaItem(advItem(1), 'pablo-picasso'), null, 'a Wright sale is not LAMA');
  assert.equal(parseLamaItem(advItem(2), 'pablo-picasso'), null, 'a Rago sale is not LAMA');
  assert.equal(parseLamaItem(advItem(undefined), 'pablo-picasso')!.auctionHouse, 'LAMA', 'no signal → historical LAMA default');
});

test('wright: the session-level Rago heuristic never overrides a house-id attribution', () => {
  const rago = parseWrightAdvancedItem(advItem(2, { alias: 'auctions/2012/05/prints-multiples/1' }), 'p', { idKey: 'id' })!;
  const wright = parseWrightAdvancedItem(advItem(1, { id: 9, fd_key: 'X9', alias: 'auctions/2012/05/prints-multiples/2' }), 'p', { idKey: 'id' })!;
  const out = fixWrightRagoSessions([rago, wright]);
  assert.equal(out[1].auctionHouse, 'Wright');
  assert.equal(out[1].id, 'wright-9');
  assert.equal(wrightPlatformKey('rago-303053'), '303053');
  assert.equal(wrightPlatformKey('lama-234631~'), '234631~');
});

// ── selector + counts ───────────────────────────────────────────────────────

test('selector: houses, groups, explicit lists', () => {
  const art = resolveHistoryMakers('sothebys', 'art', ARTISTS);
  const watches = resolveHistoryMakers('sothebys', 'watches', ARTISTS);
  const all = resolveHistoryMakers('sothebys', 'all', ARTISTS);
  assert.deepEqual(watches.sort(), ['audemars-piguet', 'cartier', 'omega', 'patek-philippe', 'rolex']);
  assert.equal(art.length + watches.length, all.length);
  assert.ok(art.includes('jean-michel-basquiat') && art.includes('pablo-picasso'));
  assert.ok(!all.includes('meteorites'), 'category slugs are not makers');
  assert.deepEqual(resolveHistoryMakers('sothebys', ' patek-philippe, jean-michel-basquiat,patek-philippe ', ARTISTS), ['patek-philippe', 'jean-michel-basquiat']);
  assert.ok(resolveHistoryMakers('wright', 'all', ARTISTS).includes('pablo-picasso'));
  assert.throws(() => resolveHistoryMakers('wright', 'watches', ARTISTS), /selects nothing/);
  assert.throws(() => resolveHistoryMakers('wright', 'rolex', ARTISTS), /no wright history/);
  assert.throws(() => resolveHistoryMakers('christies', 'all', ARTISTS), /unknown house/);
  assert.throws(() => resolveHistoryMakers('sothebys', 'basquiat', ARTISTS), /not in the roster/);
  assert.throws(() => resolveHistoryMakers('sothebys', 'rolex;rm -rf', ARTISTS), /not a slug/);
  assert.throws(() => resolveHistoryMakers('sothebys', ' ', ARTISTS), /empty/);
});

test('counts: rows / sold / per-house / sold-per-year, maker-scoped', () => {
  const rows = [
    { artist: 'pablo-picasso', auctionHouse: 'Wright', status: 'sold', saleDate: '2012-10-18' },
    { artist: 'pablo-picasso', auctionHouse: 'Rago', status: 'bought_in', saleDate: '2013-01-01' },
    { artist: 'kaws', auctionHouse: 'LAMA', status: 'sold', saleDate: '2020-01-01' },
  ];
  const c = historyCounts(rows, new Set(['pablo-picasso']));
  assert.deepEqual(c, { rows: 2, sold: 1, byHouse: { Wright: 1, Rago: 1 }, soldByYear: { 2012: 1 } });
});
