/**
 * Christie's sale identity (scripts/lib/houses/christies.ts, Oct 11 2026).
 *
 * The nightly "markup change?" warnings on 6 sales + 1 HTTP 500 were not a
 * markup change: discovery cut the room suffix off links like
 * /en/auction/important-watches-24504-nyr, and without the suffix www reads the
 * SALE NUMBER as a SALE ID — a different (2012–15) sale, the calendar, or a
 * 500 inside onlineonly. Fixtures are trimmed live pages fetched Oct 11 2026.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  CHRISTIES_ART_SEEDS, CHRISTIES_SCIENCE_SEEDS, CHRISTIES_SPORTS_SEEDS, CHRISTIES_WATCH_SEEDS,
  checkChristiesSaleIdentity, christiesLotUrl, christiesSaleNameOf, classifyChristiesSalePage,
  extractChristiesSaleSlugs, parseChristiesSaleSlug, readChristiesSaleIdentity,
} from '../lib/houses/christies';
import { isSportsSale } from '../sports-sale';

const fx = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const WWW = (slug: string) => `https://www.christies.com/en/auction/${slug}?sortby=lotnumber&page=1`;

test('discovery keeps the room suffix (the old regex cut it and crawled the wrong sale)', () => {
  const slugs = extractChristiesSaleSlugs(fx('christies-department-sale-links.html'));
  for (const s of ['important-watches-24504-nyr', 'luxury-evening-sale-24582-sha', 'watches-online-the-new-york-edit-24505-nyr',
    'auction-19985-nyr', '20th-century-evening-sale-24266-nyr', 'collection-mia-van-hool-l-audace-l-oeuvre-24952-par',
    'retromobile-new-york-auctions-25352-nyg', 'prints-and-multiples-31060', 'american-greats-vintage-sports-and-hollywood-from-the-dr-g-b-espy-collection-31068']) {
    assert.ok(slugs.includes(s), `missing ${s}`);
  }
  for (const s of ['important-watches-24504', 'auction-19985', '20th-century-evening-sale-24266']) assert.ok(!slugs.includes(s), `truncated ${s}`);
  // the /overview tail and trailing slash are not part of the slug
  assert.ok(slugs.every(s => /^[a-z0-9-]+-\d{4,6}(-[a-z]{3})?$/.test(s)), slugs.join(','));
});

test('discovery lower-cases + dedupes, and a number inside the name is not the sale id', () => {
  const html = '<a href="/en/auction/Prints-and-Multiples-31060">x</a><a href="/en/auction/prints-and-multiples-31060/">y</a>'
    + '<a href="/en/auction/the-2024-season-highlights-31999-par/overview">z</a>';
  assert.deepEqual(extractChristiesSaleSlugs(html).sort(), ['prints-and-multiples-31060', 'the-2024-season-highlights-31999-par']);
});

test('slug parse: id form vs number+room form; saleName unchanged for existing rows', () => {
  assert.deepEqual(parseChristiesSaleSlug('important-watches-30715'), { slug: 'important-watches-30715', name: 'important-watches', num: '30715', room: null });
  assert.deepEqual(parseChristiesSaleSlug('important-watches-24504-nyr'), { slug: 'important-watches-24504-nyr', name: 'important-watches', num: '24504', room: 'nyr' });
  assert.equal(christiesSaleNameOf('important-watches-24504-nyr'), 'Important Watches');
  assert.equal(christiesSaleNameOf('important-watches-30715'), 'Important Watches');
  assert.equal(christiesSaleNameOf('rare-watches-including-watches-for-ela-24403-gnv'), 'Rare Watches Including Watches For Ela');
});

test('page identity read from the real markup', () => {
  assert.deepEqual(readChristiesSaleIdentity(fx('christies-sale-19985-nyr.html')),
    { saleId: '29142', saleNumber: '19985', room: 'nyr', title: 'Extra Innings: A Private Collection of Important Baseball Memorabilia' });
  assert.deepEqual(readChristiesSaleIdentity(fx('christies-sale-24504-nyr-unpublished.html')),
    { saleId: '-1', saleNumber: '24504', room: 'nyr', title: 'Important Watches' });
  const oo = readChristiesSaleIdentity(fx('christies-sale-25241-nyr-onlineonly.html'));
  assert.equal(oo.saleId, '31547'); assert.equal(oo.saleNumber, '25241'); assert.equal(oo.room, 'nyr');
});

test('a suffixed sale with a catalogue → its lots', () => {
  const pg = classifyChristiesSalePage('auction-19985-nyr', WWW('auction-19985-nyr'), fx('christies-sale-19985-nyr.html'));
  assert.equal(pg.kind, 'lots');
  if (pg.kind === 'lots') { assert.equal(pg.total, 231); assert.equal(pg.lots.length, 2); assert.match(pg.lots[0].title_primary_txt, /Utica vs\. Camden/); }
});

test('an announced sale (sale_id -1, no lots object) is not-published — not a markup change', () => {
  const pg = classifyChristiesSalePage('important-watches-24504-nyr', WWW('important-watches-24504-nyr'), fx('christies-sale-24504-nyr-unpublished.html'));
  assert.equal(pg.kind, 'not-published');
});

test('the suffix-stripped slug that 200s with an unrelated legacy sale is rejected (never ingested under the wrong saleName)', () => {
  const pg = classifyChristiesSalePage('picasso-ceramics-24248', WWW('picasso-ceramics-24248'), fx('christies-sale-24248-wrong-sale.html'));
  assert.equal(pg.kind, 'wrong-sale');
  // the same page asked for under its true identity is fine
  assert.equal(checkChristiesSaleIdentity(parseChristiesSaleSlug('fine-printed-books-and-manuscripts-24248')!, readChristiesSaleIdentity(fx('christies-sale-24248-wrong-sale.html'))).ok, true);
});

test('number / room mismatches are wrong-sale; generic "auction-N" slugs skip the name check', () => {
  const id = { saleId: '29142', saleNumber: '19985', room: 'nyr', title: 'Extra Innings: A Private Collection of Important Baseball Memorabilia' };
  assert.equal(checkChristiesSaleIdentity(parseChristiesSaleSlug('auction-19985-nyr')!, id).ok, true);
  assert.equal(checkChristiesSaleIdentity(parseChristiesSaleSlug('auction-19986-nyr')!, id).ok, false);
  assert.equal(checkChristiesSaleIdentity(parseChristiesSaleSlug('auction-19985-par')!, id).ok, false);
  assert.equal(checkChristiesSaleIdentity(parseChristiesSaleSlug('auction-19985')!, id).ok, false); // id form: 19985 ≠ sale id 29142
  // a Diane Arbus photographs sale is not "important watches" even when the number matches
  assert.equal(checkChristiesSaleIdentity(parseChristiesSaleSlug('important-watches-24504')!, { saleId: '24504', saleNumber: '3408', room: 'nyr', title: 'Photographs by Diane Arbus' }).ok, false);
  // the old art seed: sale id 24607 is a 2014 wine sale ("including" alone proves nothing)
  assert.equal(checkChristiesSaleIdentity(parseChristiesSaleSlug('avant-garde-s-including-thinking-italian-24607')!,
    { saleId: '24607', saleNumber: '1530', room: 'cks', title: 'Finest & Rarest Wines & Spirits including The Collection of Sir Alex Ferguson CBE' }).ok, false);
  // …but a sale Christie's RENAMED after minting the slug is still itself (live Oct 11 2026)
  assert.equal(checkChristiesSaleIdentity(parseChristiesSaleSlug('20th-21st-century-paris-evening-sale-including-thinking-italian-31249')!,
    { saleId: '31249', saleNumber: '24607', room: 'par', title: 'Avant-Garde(s) including Thinking Italian' }).ok, true);
});

test('www → onlineonly redirect is an online sale with its www sale id (for the lotsearch API)', () => {
  const pg = classifyChristiesSalePage('auction-25241-nyr', 'https://onlineonly.christies.com/s/vicente-wolf-photography-collection-online/lots/4130', fx('christies-sale-25241-nyr-onlineonly.html'));
  assert.deepEqual(pg, { kind: 'online', saleId: '31547' });
});

test('redirect to the calendar is not-found', () => {
  assert.equal(classifyChristiesSalePage('auction-19985', 'https://www.christies.com/en/calendar', '<html><title>Calendar</title></html>').kind, 'not-found');
});

test('a sale page with identity but no lots and a real sale id is still flagged as a markup change', () => {
  const html = fx('christies-sale-24504-nyr-unpublished.html').replace('"sale_id":"-1"', '"sale_id":"30999"');
  assert.equal(classifyChristiesSalePage('important-watches-24504-nyr', WWW('important-watches-24504-nyr'), html).kind, 'unparsed');
});

test('API online lot urls go to the onlineonly sso (the close-time enrichment keys on it)', () => {
  assert.equal(christiesLotUrl({ url: 'https://www.christies.com/en/sso?ObjectID=25241.51&LotNumber=51&ldp_breadcrumb=back', event_type: 'OnlineSale' }),
    'https://onlineonly.christies.com/sso?ObjectID=25241.51&LotNumber=51');
  assert.equal(christiesLotUrl({ url: 'https://www.christies.com/en/lot/lot-6334731?ldp_breadcrumb=back' }), 'https://www.christies.com/en/lot/lot-6334731?ldp_breadcrumb=back');
  assert.equal(christiesLotUrl({}), null);
});

test('every seed is a well-formed slug; suffix-stripped seeds are gone', () => {
  const seeds = [...CHRISTIES_WATCH_SEEDS, ...CHRISTIES_SCIENCE_SEEDS, ...CHRISTIES_SPORTS_SEEDS, ...CHRISTIES_ART_SEEDS];
  for (const s of seeds) assert.ok(parseChristiesSaleSlug(s), s);
  for (const bad of ['important-watches-24504', 'watches-online-the-new-york-edit-24505', 'rare-watches-including-watches-for-ela-24403',
    'avant-garde-s-including-thinking-italian-24607', 'art-contemporain-vente-du-jour-24609', 'art-moderne-24608']) {
    assert.ok(!seeds.includes(bad), bad);
  }
});

test('the sale title feeds the sports gate when the slug is generic', () => {
  assert.equal(isSportsSale('auction-19985-nyr'), false);
  assert.equal(isSportsSale('auction-19985-nyr Extra Innings: A Private Collection of Important Baseball Memorabilia'), true);
});
