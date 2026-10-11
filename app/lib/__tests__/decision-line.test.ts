/**
 * THE DECISION LINE (N2, Oct 11 2026) — "projected close ~$34K · worth up to
 * $38K · $4K headroom · closes Thu 10 PM" on /profile picks, the Today band,
 * Watching rows and home's For you.
 *
 *  1. Live book: every number decisionOf prints IS its source — the close
 *     figure is the ranker's anchor (priority.prioStatic, src 'proj') or the
 *     house estimate; "worth up to" is lotFace's max bid; the gap is the
 *     difference of those two printed figures; the close is the house-tz
 *     clock. No engine max bid → no "worth up to", ever.
 *  2. Fixtures: an estimate lot, a bare lot, an abstained lot, the close words.
 *  3. Surfaces read the line through DecisionLine → decisionOf, never a
 *     figure of their own.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { readFileSync } from 'fs';
import path from 'path';
import { decisionOf, decisionParts, lotFace, fmtFace, DECISION_GAP_MIN } from '../lot-face';
import { prioStatic, closeMsOf } from '../priority';
import { setCloseK, resetCloseK } from '../close-k';
import type { AuctionLot } from '../../types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
/** Oct 9 2026, 4 PM ET — the served book's crawl day */
const NOW = Date.parse('2026-10-09T20:00:00Z');

function liveBook(): AuctionLot[] | null {
  try {
    return (JSON.parse(src('public/data/ray/upcoming.json')) as { lots: AuctionLot[] }).lots.filter(l => l.status === 'upcoming');
  } catch { return null; }
}

/** every "$…" figure a text prints */
const figs = (s: string) => s.match(/\$[\d.,]+[KM]?/g) ?? [];

function checkBook(book: AuctionLot[], label: string) {
  const seen = { proj: 0, est: 0, worth: 0, gap: 0, abstained: 0, noWorth: 0, when: 0 };
  for (const lot of book) {
    const face = lotFace(lot);
    const d = decisionOf(lot, NOW);
    const p = prioStatic(lot as Parameters<typeof prioStatic>[0], NOW);
    const allowed = new Set<string>();

    // the close figure: the ranker's anchor, or the house estimate — nothing else
    if (d.close?.kind === 'proj') {
      seen.proj++;
      assert.ok(p && p.src === 'proj' && !p.over, `${label} ${lot.id}: a projection only where the ranker anchors on one`);
      assert.equal(d.close.usd, p!.a, `${lot.id}: projected close is the ranker's anchor`);
      assert.equal(d.close.text, `projected close ~${fmtFace(p!.a)}`);
      allowed.add(fmtFace(p!.a));
    } else if (d.close?.kind === 'est') {
      seen.est++;
      assert.ok(p && p.src === 'est' && !p.over, `${lot.id}: an estimate only where the ranker anchors on it`);
      const lo = (lot.estLowUsd ?? lot.estimateLow) || null;
      const hi = (lot.estHighUsd ?? lot.estimateHigh) || null;
      assert.equal(d.close.lo, lo); assert.equal(d.close.hi, hi);
      assert.equal(d.close.oneSided, !(lo && hi));
      assert.equal(d.close.usd, p!.a, `${lot.id}: the estimate midpoint is the anchor`);
      assert.match(d.close.text, lo && hi ? /^estimate \$/ : lo ? /^estimate from \$/ : /^estimate to \$/);
      if (lo) allowed.add(fmtFace(lo));
      if (hi) allowed.add(fmtFace(hi));
    } else {
      assert.ok(!p || p.over || (p.src !== 'proj' && p.src !== 'est'), `${lot.id}: an anchored lot prints its close figure`);
    }

    // worth up to: lotFace's max bid — or nothing
    if (face.maxBid) {
      seen.worth++;
      assert.ok(d.worth, `${lot.id}: a max bid prints`);
      assert.equal(d.worth!.usd, face.maxBid.hammer, `${lot.id}: worth up to IS lotFace.maxBid`);
      assert.equal(d.worth!.text, `worth up to ${fmtFace(face.maxBid.hammer)}`);
      allowed.add(fmtFace(face.maxBid.hammer));
    } else {
      seen.noWorth++;
      assert.equal(d.worth, null, `${lot.id}: no engine max bid → no worth figure`);
      assert.equal(d.gap, null, `${lot.id}: no worth → no gap`);
      if (d.abstained) seen.abstained++;
    }

    // the gap: the difference of the two printed figures, ≥10% apart
    if (d.gap) {
      seen.gap++;
      assert.ok(d.close && d.worth);
      if (d.close!.kind === 'proj') {
        assert.equal(d.gap.usd, Math.abs(d.worth!.usd - d.close!.usd));
        assert.ok(d.gap.usd >= DECISION_GAP_MIN * d.close!.usd);
        assert.equal(d.gap.dir, d.worth!.usd > d.close!.usd ? 'room' : 'over');
      } else {
        assert.ok(d.gap.dir === 'room' ? d.close!.hi != null : d.close!.lo != null, `${lot.id}: a gap only against a published bound`);
        assert.equal(d.gap.usd, d.gap.dir === 'room' ? d.worth!.usd - d.close!.hi! : d.close!.lo! - d.worth!.usd);
        assert.ok(d.gap.usd > 0);
      }
      allowed.add(fmtFace(d.gap.usd));
    } else if (d.close?.kind === 'proj' && d.worth) {
      assert.ok(Math.abs(d.worth.usd - d.close.usd) < DECISION_GAP_MIN * d.close.usd, `${lot.id}: a ≥10% gap prints`);
    }

    // the close clock: priority's own, still ahead
    if (d.when) {
      seen.when++;
      assert.equal(d.when.ms, closeMsOf(lot));
      assert.ok(d.when.ms > NOW);
      assert.match(d.when.text, /^(closes|sells) /);
      if (!d.when.timed) assert.doesNotMatch(d.when.text, /\d(:\d\d)? ?[AP]M/, `${lot.id}: a date-only sale never prints an hour`);
    }

    // every figure the line prints is one of the sources above
    for (const t of decisionParts(d)) for (const f of figs(t)) assert.ok(allowed.has(f), `${lot.id}: "${t}" prints ${f}, not a source figure`);
    // and nothing is printed for a figure that does not exist
    const line = decisionParts(d).join(' · ');
    if (!face.maxBid) assert.doesNotMatch(line, /worth up to/);
    if (!d.close) assert.doesNotMatch(line, /projected close|estimate \$/);
  }
  return seen;
}

test('live book: every printed decision number equals its source (compiled close-k)', () => {
  const book = liveBook();
  if (!book) return; // a checkout without the data build
  resetCloseK();
  const seen = checkBook(book, 'compiled');
  // the book exercises every branch
  for (const k of ['proj', 'est', 'worth', 'gap', 'noWorth', 'when'] as const) assert.ok(seen[k] > 0, `live book has ${k} lines (${JSON.stringify(seen)})`);
});

test('live book: same with the served nightly close-k fit installed', () => {
  const book = liveBook();
  let fit: unknown = null;
  try { fit = JSON.parse(src('public/data/ray/close-k.json')); } catch { /* not served in this checkout */ }
  if (!book || !fit || !setCloseK(fit)) return;
  try { checkBook(book, 'fitted'); } finally { resetCloseK(); }
});

const base = (o: Partial<AuctionLot>): AuctionLot => ({
  id: 'x', title: 'A lot', artist: null, auctionHouse: 'Bonhams', saleName: 'Fine Art',
  status: 'upcoming', saleDate: '2026-10-13', ...o,
} as unknown as AuctionLot);

test('fixtures: an estimate house prints its estimate, labelled; no engine → no worth', () => {
  const l = base({ estimateLow: 20_000, estimateHigh: 30_000, saleDateTime: '2026-10-13T18:00:00Z' } as Partial<AuctionLot>);
  const d = decisionOf(l, NOW);
  assert.equal(d.close?.kind, 'est');
  assert.equal(d.close?.text, 'estimate $20K–$30K');
  assert.equal(d.worth, null);
  assert.equal(d.abstained, false);
  assert.equal(d.gap, null);
  const parts = decisionParts(d);
  assert.equal(parts[0], 'estimate $20K–$30K');
  assert.match(parts[1], /^closes Tue /);
  assert.deepEqual(decisionParts(d, { when: false, close: false }), []);
});

test('fixtures: a one-sided estimate names its side, never a range', () => {
  const d = decisionOf(base({ estimateLow: 150_000, saleDateTime: '2026-10-13T18:00:00Z' } as Partial<AuctionLot>), NOW);
  assert.equal(d.close?.text, 'estimate from $150K');
  assert.equal(d.close?.oneSided, true);
  assert.equal(d.close?.hi, null);
});

test('fixtures: an engine that abstained says so — and never prints a figure for it', () => {
  const l = base({ estimateLow: 5_000, estimateHigh: 7_000, value: { abstain: 'thin', n: 0 } } as unknown as Partial<AuctionLot>);
  const d = decisionOf(l, NOW);
  assert.equal(d.worth, null);
  assert.equal(d.abstained, true);
  assert.ok(decisionParts(d).includes('no engine read'));
  assert.doesNotMatch(decisionParts(d).join(' '), /worth up to/);
});

test('fixtures: a date-only sale names the day, never an hour; a past close prints nothing', () => {
  const l = base({ saleDate: '2026-10-13', estimateLow: 1_000, estimateHigh: 2_000 });
  const d = decisionOf(l, NOW);
  assert.equal(d.when?.timed, false);
  assert.equal(d.when?.text, 'sells Tue');
  const gone = base({ saleDate: '2026-10-01', saleDateTime: '2026-10-01T18:00:00Z', estimateLow: 1_000, estimateHigh: 2_000 });
  assert.equal(decisionOf(gone, NOW).when, null);
});

test('surfaces print the decision through DecisionLine → decisionOf, no figure of their own', () => {
  const c = src('app/components/DecisionLine.tsx');
  assert.match(c, /import \{[^}]*\bdecisionOf\b[^}]*\} from '..\/lib\/lot-face'/);
  assert.doesNotMatch(c, /\b(maxBidUsd|expectedHammerUsd|currentBid|estimateLow|estimateHigh|closeKOf|fmtUsd|formatPrice)\b/);
  // (desk3) the /profile rooms moved out of page.tsx into desk/rooms — the
  // picks, the Watching ledger and the cockpit's Next-hammer cell print it
  for (const f of ['app/profile/desk/rooms/picks.tsx', 'app/profile/desk/rooms/watching.tsx', 'app/profile/desk/cockpit.tsx', 'app/profile/today.tsx', 'app/components/LotBrowser.tsx']) {
    assert.match(src(f), /<DecisionLine lot=/, `${f} renders DecisionLine`);
  }
});
