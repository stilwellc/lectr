/**
 * W16 (Oct 11 2026) identity gaps:
 *   · one Christie's object, one id (scripts/lib/id-aliases) — the Oct 11
 *     production segment carried 189 objects under both christies-<n> and
 *     christies-auc-<n>;
 *   · the Christie's wrong-sale rows' makers (classify): Souza paintings in
 *     science-tech (a bare "newton" read FRANCIS NEWTON SOUZA as a scientist),
 *     a Boilly portrait "in a green jacket" and a Roman ringstone in
 *     trophies-awards; the wine / American silver rows stay evicted.
 * Fixtures are the real rows (titles, ids, dates) from that segment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeChristiesIdSchemes, aliasMapOf, christiesObjectIdOf, canonicalChristiesId } from '../lib/id-aliases';
import { dedupeUrlSchemeCollisions } from '../lib/corpus-normalize';
import { reclassifyLot, scienceVerdict, generalistNotATrophy, SCIENTIST_RE, DROP } from '../lib/classify';
import { lotIdTwins, mayBeAliasId } from '../../app/lib/id-aliases';
import { idAliases } from '../../app/lib/recs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
const C = "Christie's";
const art = (o: R = {}): R => ({
  id: 'christies-6610527', auctionHouse: C, artist: 'pablo-picasso', status: 'upcoming', title: 'Grand Vase aux danseurs (A.R. 114)',
  saleDate: '2026-10-23', saleName: 'Paris Sale 24608', lotNumber: 244, estimateLow: 368000, firstSeen: '2026-10-09',
  url: 'https://www.christies.com/en/lot/lot-6610527', ...o,
});
const auc = (o: R = {}): R => ({
  id: 'christies-auc-6610527', auctionHouse: C, artist: 'pablo-picasso', status: 'upcoming', title: 'Pablo Picasso (1881-1973) Grand Vase aux danseurs (A.R. 114)',
  saleDate: '2026-10-23', saleName: 'Art Moderne Vente Du Jour Including Works From The Durand Ruel', lotNumber: null, estimateLow: 368000, firstSeen: '2026-10-09',
  url: 'https://www.christies.com/en/lot/lot-6610527?ldp_breadcrumb=back', ...o,
});

test('object id + canonical id of either crawler id', () => {
  assert.equal(christiesObjectIdOf('christies-auc-6610527'), '6610527');
  assert.equal(christiesObjectIdOf('christies-6610527'), '6610527');
  assert.equal(christiesObjectIdOf('christies-feb26-clown'), null);
  assert.equal(christiesObjectIdOf('christies-244'), null, 'a lot-number fallback id is no object id');
  assert.equal(canonicalChristiesId('christies-auc-6610527'), 'christies-6610527');
});

test('a live pair collapses to ONE row under christies-<n>, the twin id recorded', () => {
  const rows = [auc(), art(), { id: 'christies-auc-1', auctionHouse: C, title: 'x' }];
  const r = dedupeChristiesIdSchemes(rows);
  assert.equal(r.pairs, 1);
  assert.equal(rows.length, 2);
  const k = rows.find(x => x.id === 'christies-6610527')!;
  assert.deepEqual(k.idAliases, ['christies-auc-6610527']);
  assert.equal(k.lotNumber, 244);
  assert.deepEqual(r.aliases, { 'christies-auc-6610527': 'christies-6610527' });
  assert.deepEqual(aliasMapOf(rows), { 'christies-auc-6610527': 'christies-6610527' });
});

test('the canonical id never flips with status: a result on the sale-crawler side keeps christies-<n> and carries the result', () => {
  // (the URL dedupe's status-ranked survivor published christies-auc-<n> the
  // night the sale crawler resolved a lot first — 4 such pairs on Oct 11)
  const rows = [art(), auc({ status: 'sold', priceUsd: 512000, realizedUsd: 512000, firstSeen: '2026-10-08' })];
  dedupeChristiesIdSchemes(rows);
  assert.equal(rows.length, 1);
  const [k] = rows;
  assert.equal(k.id, 'christies-6610527');
  assert.equal(k.status, 'sold');
  assert.equal(k.priceUsd, 512000);
  assert.equal(k.lotNumber, 244, 'the twin lends its lot number');
  assert.equal(k.firstSeen, '2026-10-08', 'the earliest first-seen');
  assert.deepEqual(k.idAliases, ['christies-auc-6610527']);
  // a live twin never lends a live flag to the settled row
  const rows2 = [art({ resultsPending: true }), auc({ status: 'sold', priceUsd: 1 })];
  dedupeChristiesIdSchemes(rows2);
  assert.equal(rows2[0].resultsPending, undefined);
});

test('pairs are found by object id — no URL needed (the URL dedupe missed onlineonly / nulled urls)', () => {
  const rows = [art({ url: null }), auc({ url: 'https://onlineonly.christies.com/s/x/y/12345' })];
  assert.equal(dedupeUrlSchemeCollisions(rows.map(r => ({ ...r })) as never), 0, 'the URL dedupe alone keeps both');
  assert.equal(dedupeChristiesIdSchemes(rows).pairs, 1);
  assert.equal(rows.length, 1);
});

test('different titles under one number are not merged; the pass is idempotent', () => {
  const rows = [art(), auc({ title: 'Henri Matisse (1869-1954) Nu couché' })];
  assert.equal(dedupeChristiesIdSchemes(rows).pairs, 0);
  assert.equal(rows.length, 2);
  const once = [art(), auc()];
  dedupeChristiesIdSchemes(once);
  const snap = JSON.stringify(once);
  assert.equal(dedupeChristiesIdSchemes(once).pairs, 0);
  assert.equal(JSON.stringify(once), snap);
});

test('client: a save / link under either id resolves (recs idAliases, the /lot route)', () => {
  assert.deepEqual(lotIdTwins('christies-auc-6610527'), ['christies-6610527']);
  assert.deepEqual(lotIdTwins('christies-6610527'), ['christies-auc-6610527']);
  assert.deepEqual(lotIdTwins('sothebys-abc'), []);
  assert.ok(idAliases('christies-auc-6610527').includes('christies-6610527'));
  assert.ok(idAliases('christies-6610527').includes('christies-auc-6610527'));
  assert.ok(mayBeAliasId('christies-auc-6610527') && !mayBeAliasId('christies-6610527') && !mayBeAliasId('goldin-1'));
});

// ── the wrong-sale rows' makers ────────────────────────────────────────────
const relabelled = (o: R): R => ({ auctionHouse: C, category: 'object', ...o });
const finalOf = (o: R): string => { const l = { ...o }; const r = reclassifyLot(l as never); return r.drop ? DROP : l.artist; };

test('Souza paintings leave science (FRANCIS NEWTON SOUZA is no scientist); Isaac Newton stays science-tech', () => {
  for (const [id, title] of [
    ['christies-auc-5807428', 'FRANCIS NEWTON SOUZA (1924-2002) View From The Studio'],
    ['christies-auc-5807434', 'FRANCIS NEWTON SOUZA (1924-2002) Portrait of a Man in a Dark Room'],
    ['christies-auc-5807470', 'FRANCIS NEWTON SOUZA (1924-2002) Untitled (Seated Woman)'],
  ]) {
    assert.equal(finalOf(relabelled({ id, artist: 'scientific-instruments', title, saleName: 'South Asian Modern Contemporary Art', saleDate: '2014-06-10' })), DROP, title);
  }
  assert.ok(!SCIENTIST_RE.test('FRANCIS NEWTON SOUZA (1924-2002)'));
  assert.ok(!SCIENTIST_RE.test('helmut newton (b. 1920) in my studio, paris'));
  assert.ok(!SCIENTIST_RE.test('Olivia Newton-John Signed Photograph'));
  assert.ok(SCIENTIST_RE.test('NEWTON, Sir Isaac (1642-1727). Opticks'));
  assert.ok(SCIENTIST_RE.test('SIR ISAAC NEWTON (1642-1727)'));
  assert.equal(scienceVerdict(relabelled({ artist: 'scientific-instruments', title: 'NEWTON, Isaac (1642-1727). Philosophiae naturalis principia mathematica , edited by Thomas Le Seur' }) as never), 'science-tech');
});

test('wine and American silver under fossils / instruments are evicted (no wine or silver maker)', () => {
  assert.equal(finalOf(relabelled({ id: 'christies-auc-5800980', artist: 'fossils', title: 'Château Cheval-Blanc 1947 1 bottles per lot', saleName: 'Finest Rarest Wines Spirits Including The Collection Of Sir Alex Ferguson Cbe' })), DROP);
  assert.equal(finalOf(relabelled({ id: 'christies-auc-5801207', artist: 'fossils', title: 'Hermitage La Chapelle 1990 6 bottles per lot' })), DROP);
  assert.equal(finalOf(relabelled({ id: 'christies-auc-5764045', artist: 'fossils', title: 'A SILVER SEVEN-PIECE DINNER SERVICE MARK OF THEODORE B. STARR, NEW YORK, CIRCA 1900', saleName: 'Important American Silver' })), DROP);
  assert.equal(finalOf(relabelled({ id: 'christies-auc-5764084', artist: 'scientific-instruments', title: 'A SILVER PORRINGER MARK OF JOHN CONEY, BOSTON, CIRCA 1710', saleName: 'Important American Silver' })), DROP);
});

test('a portrait "in a green jacket", a Roman ringstone and decorative trophies are no sporting awards', () => {
  assert.equal(finalOf(relabelled({ id: 'christies-auc-5965199', artist: 'trophies-awards', title: 'Circle of Louis-Léopold Boilly (French, 1761-1845) Portrait of a man, half-length, in a green jacket', saleName: 'Living With Art' })), DROP);
  assert.equal(finalOf(relabelled({ id: 'christies-auc-5628157', artist: 'trophies-awards', title: 'A ROMAN CARNELIAN RINGSTONE CIRCA 2ND CENTURY A.D.', saleName: 'Ancient Jewelry' })), DROP);
  const T = (title: string, saleName = '', house = "Sotheby's") => generalistNotATrophy({ artist: 'trophies-awards', auctionHouse: house, title, saleName } as never);
  assert.equal(T('a south german polychrome and gilt carved wood hunting trophy 18th/19th century'), DROP);
  assert.equal(T('a neoclassical gilded walnut military trophy, italy, 19th century'), DROP);
  // real awards stay
  assert.equal(T('1997 Masters Green Jacket presented to Augusta National member'), null);
  assert.equal(T('A 9CT GOLD AND ENAMEL SCOTTISH CUP WINNERS MEDAL', 'Sporting Memorabilia', C), null);
  assert.equal(T('A YELLOW-METAL 1991 EUROPEAN CUP WINNERS CUP, WINNERS MEDAL', 'Sporting Memorabilia', C), null);
  assert.equal(T('green jacket portrait', '', 'Goldin'), null, 'generalist houses only');
});
