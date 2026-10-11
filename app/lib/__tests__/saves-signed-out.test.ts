import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toggleEntries, signedUpgrades, SIGNED_SIGNAL_SINCE } from '../account';
import { localSearchPlan, toggleLocalSearch, parseLocalSearches } from '../local-searches';

type E = { id: string; savedAt: string; signalPct: number | null };
const e = (id: string, savedAt = '2026-10-01T00:00:00Z', signalPct: number | null = 12): E => ({ id, savedAt, signalPct });

test('toggleEntries: append when absent, remove when present, never duplicates', () => {
  let list: E[] = [];
  list = toggleEntries(list, 'a', () => e('a'));
  list = toggleEntries(list, 'b', () => e('b'));
  assert.deepEqual(list.map(x => x.id), ['a', 'b']);
  list = toggleEntries(list, 'a', () => e('a'));
  assert.deepEqual(list.map(x => x.id), ['b']);
  const before = [e('x')];
  toggleEntries(before, 'y', () => e('y'));
  assert.equal(before.length, 1, 'pure: the input list is untouched');
});

test('signedUpgrades: only signed device saves whose cloud copy is legacy overwrite', () => {
  const local = [e('new-signed'), e('legacy-local', '2026-08-01T00:00:00Z', 9), e('no-call', '2026-10-01T00:00:00Z', null), e('cloud-signed')];
  const cloud = [
    { lot_id: 'new-signed', saved_at: '2026-08-10T00:00:00Z', signal_pct: 5 },   // cloud predates the convention
    { lot_id: 'legacy-local', saved_at: '2026-08-01T00:00:00Z', signal_pct: null },
    { lot_id: 'no-call', saved_at: '2026-08-01T00:00:00Z', signal_pct: null },
    { lot_id: 'cloud-signed', saved_at: '2026-09-15T00:00:00Z', signal_pct: -7 }, // cloud already signed: keep it
  ];
  assert.ok('2026-08-10' < SIGNED_SIGNAL_SINCE);
  assert.deepEqual(signedUpgrades(local, cloud).map(x => x.id), ['new-signed']);
  assert.deepEqual(signedUpgrades(local, []), [], 'nothing in the cloud: the first insert pass carries them');
});

test('the signed-out save path is a device save, never a sign-in wall', () => {
  const src = fs.readFileSync(new URL('../account.tsx', import.meta.url), 'utf8');
  const toggle = src.slice(src.indexOf('const toggle = useCallback'), src.indexOf('const savedIds = useMemo'));
  assert.match(toggle, /if \(!supabase \|\| !user\) \{/, 'no auth OR signed out → the device list');
  assert.doesNotMatch(toggle, /setLoginOpen\(true\)/, 'the star never opens the sign-in sheet');
  // signed out, the effect reads the device list instead of blanking it
  assert.match(src, /if \(!user\) \{ setEntries\(readStored\(\)\); setSavedReady\(true\); return; \}/);
  // …and the one-time carry-over still lifts it into the account on sign-in,
  // clearing the device copy only after a clean upsert
  assert.match(src, /const local = readStored\(\);[\s\S]*?upsertSaved\(user\.id, local, \{ onConflict: 'user_id,lot_id', ignoreDuplicates: true \}\)[\s\S]*?if \(!error && !upgradeError\) writeStored\(\[\]\);/);
});

test('local saved searches: toggle by query identity, carry only what the account lacks', () => {
  const q1 = { cat: 'tcg', sub: 'vintage' };
  const q2 = { text: 'jordan', minUsd: 1000 };
  let list = toggleLocalSearch([], 'Pokémon · Vintage', q1, '2026-10-11T00:00:00Z');
  list = toggleLocalSearch(list, 'Jordan', q2, '2026-10-11T00:00:00Z');
  assert.equal(list.length, 2);
  // same query, keys in another order → the same search (removed)
  list = toggleLocalSearch(list, 'again', { sub: 'vintage', cat: 'tcg' }, '2026-10-11T00:00:00Z');
  assert.deepEqual(list.map(s => s.name), ['Jordan']);
  const plan = localSearchPlan(
    [{ name: 'A', query: q1, savedAt: 'x' }, { name: 'B', query: q2, savedAt: 'x' }, { name: 'B2', query: { minUsd: 1000, text: 'jordan' }, savedAt: 'x' }],
    [{ cat: 'tcg', sub: 'vintage' }],
  );
  assert.deepEqual(plan.map(s => s.name), ['B'], 'already in the account → skipped; a duplicate on the device → once');
});

test('parseLocalSearches tolerates junk', () => {
  assert.deepEqual(parseLocalSearches(null), []);
  assert.deepEqual(parseLocalSearches('{"not":"a list"}'), []);
  assert.deepEqual(parseLocalSearches('[1, null, {"name":"x"}, {"name":"ok","query":{"cat":"tcg"},"savedAt":"t"}]'), [{ name: 'ok', query: { cat: 'tcg' }, savedAt: 't' }]);
});
