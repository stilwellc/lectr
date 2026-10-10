// r7 fix-client: one live predicate, links that open, one name count, one
// comps number per lot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { servedSoldSample, inSampledGroup, SAMPLE_NEWEST, SAMPLE_TOP } from '../lib/served-sample';
import { buildEntities } from '../emit-entities';
import { enginePoolOf } from '../../app/lib/engine-pool';
import { encodeEntities, decodeEntities, ledgerNamesBy } from '../../app/lib/entity/wire';
import { getUpcomingCounts, isOnBlock } from '../../app/utils';
import type { AuctionLot } from '../../app/types';
import type { EntitySummary } from '../../app/lib/entity/model';

test('served sample: newest + top by price per group, deterministic on ties, unpriced never served', () => {
  const rows: { id: string; artist: string; status: string; realizedUsd?: number; saleDate: string }[] = [];
  // more cards than the sample holds, all on ONE day (ties broken by id)
  for (let i = 0; i < SAMPLE_NEWEST + SAMPLE_TOP + 300; i++) rows.push({ id: `c${String(i).padStart(5, '0')}`, artist: i % 2 ? 'sports-cards' : 'graded-cards', status: 'sold', realizedUsd: 10 + i, saleDate: '2026-09-01' });
  rows.push({ id: 'pk1', artist: 'pokemon', status: 'sold', realizedUsd: 5, saleDate: '2020-01-01' });
  rows.push({ id: 'unpriced', artist: 'pokemon', status: 'sold', saleDate: '2026-09-02' });
  const a = servedSoldSample(rows);
  const b = servedSoldSample(rows.slice().reverse());
  assert.deepEqual(Array.from(a).sort(), Array.from(b).sort(), 'order-independent');
  // the cards group: 1,500 newest (ids c00000…) ∪ 500 priciest (the top ids)
  assert.ok(a.has('c00000') && a.has(`c${String(SAMPLE_NEWEST - 1).padStart(5, '0')}`));
  assert.ok(!a.has(`c${String(SAMPLE_NEWEST).padStart(5, '0')}`));
  assert.ok(a.has(`c${String(rows.length - 3).padStart(5, '0')}`), 'the priciest card is served');
  assert.ok(a.has('pk1'), 'Pokémon is its own group');
  assert.ok(!a.has('unpriced'));
  assert.ok(inSampledGroup({ artist: 'pokemon', status: 'sold' }));
  assert.ok(!inSampledGroup({ artist: 'andy-warhol', status: 'sold' }));
  assert.ok(!inSampledGroup({ artist: 'toString', status: 'sold' }));
});

test('entity results keep every lot link — the lots table opens corpus-only sales (QA2 Q2, verified 40/40 on prod)', () => {
  let n = 0;
  const card = (extra: Record<string, unknown>) => ({ id: `rea-${n++}`, artist: 'graded-cards', title: '1952 Topps #311 Mickey Mantle - PSA 8', status: 'sold', saleDate: '2026-06-01', priceUsd: 50_000, realizedUsd: 50_000, auctionHouse: 'REA', category: 'object', subCat: 'cards', ...extra }) as unknown as AuctionLot;
  const sold = Array.from({ length: 12 }, () => card({}));
  // priced on the engine's field but no realized price: corpus-only (never served)
  const hidden = card({ realizedUsd: undefined, priceUsd: 900_000, saleDate: '2026-07-01' });
  sold.push(hidden);
  const { details } = buildEntities({ eachSold: v => sold.forEach(v), live: [], lastCrawl: '2026-10-09T12:00:00.000Z', market: null, today: '2026-10-09' });
  const d = details.get('pl:mickey-mantle');
  assert.ok(d, 'Mantle has a detail');
  const all = [...d!.top, ...d!.recent];
  const rec = all.find(r => r.p === 900_000);
  assert.ok(rec, 'the corpus-only sale still counts');
  assert.ok(rec!.id.startsWith('rea-'), 'and keeps its link (LotPage resolves it from the lots table)');
  assert.ok(all.filter(r => r.p === 50_000).every(r => r.id.startsWith('rea-')));
});

test('engine pool: every valued lot, never a card-comp or a ×5 fault (QA2 Q3)', () => {
  const base = { poolIds: ['a', 'b', 'c'], n: 15, compMedianUsd: 2_045_000, compValueUsd: 3_307_341, compRatio: 0.56 };
  const held = enginePoolOf({ ...base, signal: null });
  assert.deepEqual(held, { med: 2_045_000, n: 15, ids: ['a', 'b', 'c'], directional: false });
  assert.equal(enginePoolOf({ ...base, signal: { label: 'at comparable market' } })?.directional, false);
  assert.equal(enginePoolOf({ ...base, signal: { label: 'below comparable market' } })?.directional, true);
  assert.equal(enginePoolOf({ ...base, compMedianUsd: null })?.med, 3_307_341, 'older data: compValueUsd');
  assert.equal(enginePoolOf({ ...base, basis: 'card-comp' }), null);
  assert.equal(enginePoolOf({ ...base, compRatio: 6 }), null);
  assert.equal(enginePoolOf({ ...base, compRatio: null }), null);
  assert.equal(enginePoolOf({ ...base, poolIds: [] }), null);
  assert.equal(enginePoolOf(null), null);
});

test('entities wire: the main tier carries the tail\'s ledger names per market (QA2 Q5/Q6)', () => {
  const s = (id: string): EntitySummary => ({ id, kind: 'player', market: 'sports', label: id, subKind: null, discipline: null, face: null, page: null, sold: 20, sold12m: 5, med12m: 100, med12mN: 5, medScope: null, record: null, spark: null, sparkN: null, yoy: null, verified: null, thin: true, caps: { compare: false, follow: null, dossier: true }, medLens: null } as unknown as EntitySummary);
  const tail = [s('pl:a'), s('pl:b'), s('sj:tcg|k:pikachu'), s('mk:andy-warhol')];
  assert.deepEqual(ledgerNamesBy(tail), { sports: 2, tcg: 1 });
  const meta = { generatedAt: 'x', lastCrawl: 'y', sparkQ: [], keepFace: () => false };
  const w = encodeEntities([s('pl:c')], { ...meta, tier: 'main', tailN: 4, tailBy: ledgerNamesBy(tail) });
  const back = decodeEntities(JSON.parse(JSON.stringify(w)));
  assert.deepEqual(back.tailBy, { sports: 2, tcg: 1 });
  const old = encodeEntities([s('pl:c')], { ...meta, tier: 'main', tailN: 4 });
  assert.equal('tailBy' in old, false, 'absent unless given');
});

test('a closed results-pending lot lists but counts nowhere (QA2 Q4)', () => {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const yesterday = new Date(now - 864e5).toISOString().slice(0, 10);
  const lots = [
    { id: 'p1', status: 'upcoming', artist: 'rolex', saleDate: yesterday, saleDateTime: `${yesterday}T14:00:00Z`, resultsPending: true, auctionHouse: 'Phillips' },
    { id: 'p2', status: 'upcoming', artist: 'rolex', saleDate: today, resultsPending: false, auctionHouse: 'Phillips', saleDateTime: new Date(now + 6 * 3600e3).toISOString() },
  ];
  assert.equal(isOnBlock(lots[0] as never), false);
  assert.deepEqual(getUpcomingCounts(lots as never), { rolex: 1 });
});
