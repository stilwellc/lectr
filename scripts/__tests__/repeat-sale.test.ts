/**
 * Repeat-sale grouping (scripts/lib/repeat-sale.ts) — fixture tests from the
 * Oct 2026 identity audit's judged groups (195 served groups read by hand:
 * 146 TP / 39 FP / 10 unverifiable). Titles, dates, prices, serials and
 * edition triples are the real corpus rows' (ids in the comments).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'crypto';
import type { AuctionLot } from '../../app/types';
import { buildIdf, buildVectors } from '../../app/lib/similarity';
import {
  strongSerial, catalogueNumbers, catalogueConflict, sameSale, priceCompatible,
  refsCompatible, repeatSalePair, repeatSaleGroupId, groupRepeatSales, withVectors,
} from '../lib/repeat-sale';

let n = 0;
const tok = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 1);
function lot(p: Partial<AuctionLot> & { title: string; saleDate: string; realizedUsd: number; reference?: string | null }): AuctionLot {
  return {
    id: `t-${++n}`, artist: 'rolex', category: 'object', entityClass: 'maker', formKey: 'wristwatch',
    auctionHouse: "Christie's", saleName: '', status: 'sold', titleTokens: tok(p.title),
    serialNo: null, editionMarker: null, editionOf: null, editionTotal: null,
    ...p,
  } as unknown as AuctionLot;
}
const tblOf = (ls: AuctionLot[]) => { const t = buildIdf(ls); buildVectors(ls, t); return t; };

test('strongSerial: case diameters, lot labels, 4-digit model codes and ref-equal numbers are no serial', () => {
  assert.equal(strongSerial({ serialNo: '40mm' }), null);            // christies-auc-5933244/-6 "RED SUBMARINER"
  assert.equal(strongSerial({ serialNo: '22.0mm' }), null);
  assert.equal(strongSerial({ serialNo: 'NO.7' }), null);            // christies-auc-5496502 Daytona
  assert.equal(strongSerial({ serialNo: '2323' }), null);            // Cartier "CASE NO. 2323 DM10978"
  assert.equal(strongSerial({ serialNo: '166.077' }), null);         // Omega dotted ref
  assert.equal(strongSerial({ serialNo: '116400', reference: '116400' }), null);
  assert.equal(strongSerial({ serialNo: 'Z074090' }), 'z074090');
  assert.equal(strongSerial({ serialNo: 'E-26204' }), 'e26204');
  assert.equal(strongSerial({ serialNo: '11701' }), '11701');
});

test('catalogue numbers: volume prefixes fold, different sheets conflict', () => {
  assert.deepEqual(Array.from(catalogueNumbers('ANDY WARHOL Anniversary Donald Duck (F. & S. II 360)').get('fs')!), ['360']);
  assert.deepEqual(Array.from(catalogueNumbers('Andy Warhol Superman, from: Myths (F. & S. II.260)').get('fs')!), ['260']);
  const b = catalogueNumbers('Pablo Picasso Nature morte à la Bouteille (B. 1099; Ba. 1315 IV Bb I)');
  assert.deepEqual(Array.from(b.get('b')!), ['1099']);
  assert.deepEqual(Array.from(b.get('ba')!), ['1315']);
  // christies-auc-5912833 vs -5970793: A.R. 131 vs A.R. 130 — two plates
  assert.equal(catalogueConflict({ title: 'Pablo Picasso (1881-1973) Poisson de profil (A.R. 131)' }, { title: 'Pablo Picasso (1881-1973) Poisson de profil (A.R. 130)' }), true);
  // christies-auc-1652456 vs -1652457: F. and S. 85 vs 88
  assert.equal(catalogueConflict({ title: 'Andy Warhol Sunset (F. and S. 85)' }, { title: 'Andy Warhol Sunset (F. and S. 88)' }), true);
  assert.equal(catalogueConflict({ title: 'Andy Warhol Superman, from Myths (F. and S. 260)' }, { title: 'Andy Warhol Superman, from: Myths (F. & S. II.260)' }), false);
  assert.equal(catalogueConflict({ title: 'ANDY WARHOL Mobil Gas, from Ads (F. and S. 350)' }, { title: 'ANDY WARHOL Mobil, from: Ads' }), false);
});

test('same sale, price drift and reference compatibility', () => {
  assert.equal(sameSale({ saleDate: '2018-04-20', saleName: 'Prints', auctionHouse: "Christie's" }, { saleDate: '2018-04-20', saleName: 'Prints', auctionHouse: "Christie's" }), true);
  // houses reuse sale names every season — the name alone is no sale identity
  assert.equal(sameSale({ saleDate: '2025-12-09', saleName: 'Rare Watches', auctionHouse: "Christie's" }, { saleDate: '2026-06-12', saleName: 'Rare Watches', auctionHouse: "Christie's" }), false);
  assert.equal(sameSale({ saleDate: '2025-12-09', saleName: 'Rare Watches', auctionHouse: "Christie's" }, { saleDate: '2025-12-10', saleName: 'Rare Watches', auctionHouse: "Christie's" }), true);
  // christies-auc-5849866 vs -5901341: same Cartier six months apart at 6.4× — rejected
  assert.equal(priceCompatible({ saleDate: '2014-11-25', realizedUsd: 11287.5 }, { saleDate: '2015-06-02', realizedUsd: 1773.75 }), false);
  // christies-auc-4483028 vs -5790118: the "unique" Rolex G94451, 14.6× over nine years — kept
  assert.equal(priceCompatible({ saleDate: '2005-05-16', realizedUsd: 81906 }, { saleDate: '2014-05-11', realizedUsd: 1199021 }), true);
  const r = (reference: string | null) => ({ reference } as unknown as AuctionLot);
  assert.equal(refsCompatible(r('3338'), r('3338/1')), true);
  assert.equal(refsCompatible(r('69298/69000A'), r('69298')), true);
  assert.equal(refsCompatible(r('oysterperpetual'), r('4127')), true);   // a model name is no ref
  assert.equal(refsCompatible(r('3372'), r('3159')), false);
});

test('judged FPs are vetoed: same sale, catalogue conflict, mm serial, 4-digit model code, inch-fraction edition', () => {
  // rs_uc-6137190: three "$(1) : one plate" at one Christie's sale
  const w1 = lot({ artist: 'andy-warhol', category: 'print', formKey: 'print', title: 'ANDY WARHOL (1928-1987) $(1) : one plate', saleDate: '2018-04-20', realizedUsd: 52500, editionMarker: 'unique', editionOf: 54, editionTotal: 60 });
  const w2 = lot({ artist: 'andy-warhol', category: 'print', formKey: 'print', title: 'ANDY WARHOL (1928-1987) $(1) : one plate', saleDate: '2018-04-20', realizedUsd: 47500, editionMarker: 'unique', editionOf: 54, editionTotal: 60 });
  // rs_uc-6340425: Vesuvius 'unique 3/8' — the 3/8 is an inch fraction
  const v1 = lot({ artist: 'andy-warhol', category: 'print', formKey: 'print', title: 'ANDY WARHOL (1928-1987) Vesuvius', saleDate: '2019-04-18', realizedUsd: 106250, editionMarker: 'unique', editionOf: 3, editionTotal: 8 });
  const v2 = lot({ artist: 'andy-warhol', category: 'print', formKey: 'print', title: 'ANDY WARHOL (1928-1987) Vesuvius', saleDate: '2021-10-22', realizedUsd: 150000, editionMarker: 'unique', editionOf: 3, editionTotal: 8 });
  // rs_uc-6073641: '22mm' read as a serial on two different Bagnoires
  const c1 = lot({ artist: 'cartier', title: 'A diamond-set "Bagnoire" wristwatch, by Cartier', saleDate: '2011-11-16', realizedUsd: 8020, serialNo: '22mm' });
  const c2 = lot({ artist: 'cartier', title: "A DIAMOND-SET 'BAGNOIRE' WRISTWATCH, BY CARTIER", saleDate: '2017-05-08', realizedUsd: 5156, serialNo: '22mm' });
  // rs_uc-4712969: "CASE NO. 1960 GC13666" vs "1960 GC13448" — 1960 is the model
  const m1 = lot({ artist: 'cartier', title: "CARTIER. A LADY'S 18K GOLD AND GEM-SET OVAL WRISTWATCH SIGNED CARTIER, MODEL MINI BAIGNOIRE, CASE NO. 1960 GC13666, CIRCA 1990", saleDate: '2004-04-26', realizedUsd: 5812, serialNo: '1960' });
  const m2 = lot({ artist: 'cartier', title: "CARTIER. A LADY'S 18K GOLD AND GEM-SET OVAL WRISTWATCH WITH BRACELET SIGNED CARTIER, MODEL MINI BAIGNOIRE, CASE NO. 1960 GC13448", saleDate: '2006-05-31', realizedUsd: 10062, serialNo: '1960' });
  // rs_uc-5970793: A.R. 131 vs A.R. 130
  const p1 = lot({ artist: 'pablo-picasso', category: 'print', formKey: 'print', title: 'Pablo Picasso (1881-1973) Poisson de profil (A.R. 131)', saleDate: '2015-06-24', realizedUsd: 45840, editionMarker: 'AP', editionOf: 7, editionTotal: 30 });
  const p2 = lot({ artist: 'pablo-picasso', category: 'print', formKey: 'print', title: 'Pablo Picasso (1881-1973) Poisson de profil (A.R. 130)', saleDate: '2016-02-05', realizedUsd: 30487, editionMarker: 'AP', editionOf: 7, editionTotal: 30 });
  const all = [w1, w2, v1, v2, c1, c2, m1, m2, p1, p2];
  const tbl = tblOf(all);
  for (const [a, b] of [[w1, w2], [v1, v2], [c1, c2], [m1, m2], [p1, p2]]) assert.equal(repeatSalePair(a, b, tbl), false, `${a.title} ~ ${b.title}`);
  assert.equal(groupRepeatSales(all.slice().sort((a, b) => a.saleDate < b.saleDate ? -1 : 1), all, tbl).physGroups, 0);
});

test('judged TPs: a strong serial outranks house-style rewording; an AP edition with agreeing catalogue numbers pairs', () => {
  // christies-auc-4745949 vs -5167006: Cartier case 11701, re-catalogued two years later (cosine below the physical bar)
  const s1 = lot({ artist: 'cartier', title: "Cartier. A Lady's 18ct Gold Quartz Centre Seconds Water Resistant Wristwatch on Matching Bracelet with date Indication", saleDate: '2006-06-29', realizedUsd: 2322, serialNo: '11701' });
  const s2 = lot({ artist: 'cartier', title: "CARTIER. A LADY'S 18K GOLD BRACELET WATCH WITH CENTER SECONDS AND DATE SIGNED CARTIER, CASE NO. 11701, REF. C38283", saleDate: '2008-12-12', realizedUsd: 3750, serialNo: '11701', reference: 'C38283' });
  // christies-auc-4272118 vs -4598685: 4-digit case "1726" + limited edition 68/97 on both
  const l1 = lot({ artist: 'cartier', title: 'CARTIER. A FINE LIMITED EDITION 18K WHITE GOLD SELF-WINDING RECTANGULAR WRISTWATCH WITH SWEEP CENTRE SECONDS', saleDate: '2004-04-26', realizedUsd: 7648, serialNo: '1726', editionOf: 68, editionTotal: 97 });
  const l2 = lot({ artist: 'cartier', title: 'CARTIER. A FINE LIMITED EDITION 18K WHITE GOLD RECTANGULAR AUTOMATIC WRISTWATCH WITH SWEEP CENTRE SECONDS', saleDate: '2005-11-30', realizedUsd: 7740, serialNo: '1726', editionOf: 68, editionTotal: 97 });
  // christies-auc-1342126 vs -5473806: Superman HC 8/12, F.&S. 260 both
  const e1 = lot({ artist: 'andy-warhol', category: 'print', formKey: 'print', title: 'ANDY WARHOL Superman, from Myths (F. and S. 260)', saleDate: '1998-11-02', realizedUsd: 10925, editionMarker: 'HC', editionOf: 8, editionTotal: 12 });
  const e2 = lot({ artist: 'andy-warhol', category: 'print', formKey: 'print', title: 'Andy Warhol Superman, from: Myths (F. & S. II.260)', saleDate: '2011-09-20', realizedUsd: 132891, editionMarker: 'HC', editionOf: 8, editionTotal: 12 });
  const all = [s1, s2, l1, l2, e1, e2];
  const tbl = tblOf(all);
  assert.equal(repeatSalePair(s1, s2, tbl), true);
  assert.equal(repeatSalePair(l1, l2, tbl), true);
  assert.equal(repeatSalePair(e1, e2, tbl), true);
  const rs = groupRepeatSales(all.slice().sort((a, b) => a.saleDate < b.saleDate ? -1 : 1), all, tbl);
  assert.equal(rs.physGroups, 3);
  assert.equal((s2 as AuctionLot & { repeatSaleGroupId?: string }).repeatSaleGroupId, rs.groupOf.get(s1.id));
});

test('complete linkage: A~B and B~C never put A with C when A≁C', () => {
  // one case number, three listings; A and C cite conflicting references
  const a = lot({ title: 'ROLEX. A STAINLESS STEEL AUTOMATIC WRISTWATCH', saleDate: '2010-01-10', realizedUsd: 10000, serialNo: 'M123456', reference: '1680' });
  const b = lot({ title: 'ROLEX. A STAINLESS STEEL AUTOMATIC WRISTWATCH', saleDate: '2012-01-10', realizedUsd: 11000, serialNo: 'M123456', reference: null });
  const c = lot({ title: 'ROLEX. A STAINLESS STEEL AUTOMATIC WRISTWATCH', saleDate: '2014-01-10', realizedUsd: 12000, serialNo: 'M123456', reference: '5513' });
  const all = [a, b, c];
  const tbl = tblOf(all);
  assert.equal(repeatSalePair(a, b, tbl), true);
  assert.equal(repeatSalePair(b, c, tbl), true);
  assert.equal(repeatSalePair(a, c, tbl), false);
  const rs = groupRepeatSales(all, all, tbl);
  assert.equal(rs.physGroups, 1);                       // one pair grouped, the third lot left out
  assert.equal(rs.groupOf.size, 2);
  assert.ok(!(rs.groupOf.has(a.id) && rs.groupOf.has(c.id)));
});

test('group id: full sha1 of the earliest sale’s lot id; Algolia copies carry vectors without touching the row', () => {
  const x = { id: 'christies-auc-6568011', saleDate: '2025-12-09' }, y = { id: 'christies-auc-6590252', saleDate: '2026-06-12' };
  const gid = repeatSaleGroupId([y, x] as AuctionLot[]);
  assert.equal(gid, 'rs_' + crypto.createHash('sha1').update('christies-auc-6568011').digest('hex'));
  assert.equal(gid.length, 3 + 40);
  const row = lot({ title: 'a stainless steel automatic wristwatch ref 16610 case f051581', saleDate: '2018-05-24', realizedUsd: 40000 }) as AuctionLot & { _vn?: number; source?: string };
  row._vn = 1.5;
  const tbl = buildIdf([row, lot({ title: 'patek philippe calatrava', saleDate: '2018-01-01', realizedUsd: 1 })]);
  const copy = withVectors(row, tbl);
  assert.equal(row._vn, 1.5);
  assert.notEqual(copy, row);
  assert.ok(copy._vn > 0 && Object.keys(copy._v).length > 0);
});
