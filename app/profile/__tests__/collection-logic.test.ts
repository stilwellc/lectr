/**
 * THE COLLECTION's mark basis (desk/rooms/collection-logic): every engine mark
 * on an owned piece prints how many comps and how stale.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markBasisText } from '../desk/rooms/collection-logic';

test('markBasisText: a settled piece carries the night it was read; the year prints only when it is not this year', () => {
  assert.equal(markBasisText(12, '2026-10-12', 2026), '12 comps · as of Oct 12');
  assert.equal(markBasisText(1, '2025-12-30', 2026), '1 comp · as of Dec 30, 2025');
  assert.equal(markBasisText(1200, '2026-10-12T04:00:00Z', 2026), '1,200 comps · as of Oct 12');
});

test('markBasisText: a live piece is read nightly (no stamp); a settled row served before the clock prints its comps alone', () => {
  assert.equal(markBasisText(7, null, 2026, true), '7 comps · live, read nightly');
  assert.equal(markBasisText(7, undefined, 2026), '7 comps');
  assert.equal(markBasisText(7, 'garbage', 2026), '7 comps');
});
