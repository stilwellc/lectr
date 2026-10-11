/**
 * ONE PROJECTED CLOSE (Oct 11 2026). The decision line printed the ranker's
 * projection (bid × the room's measured close multiple, close-k) while the lot
 * page printed the served growth-curve figure (bidProj.allIn) — on the 495
 * live lots that carried both, ~3.2× apart at the median (0.7–7×). Now every
 * surface prints priority.projectedCloseOf:
 *
 *  1. Live book: the decision line, the reason line, the lot page's
 *     "Projected close" row (projectedCloseFace) and the Gap all print the
 *     helper's figure — hammer, with the all-in = hammer × the lot's premium
 *     factor, labelled "all-in". A legacy bidProj stamp changes nothing.
 *  2. Sources: no surface reads bidProj; the lot page reads projectedCloseFace.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { decisionOf, projectedCloseFace, fmtFace } from '../lot-face';
import { projectedCloseOf, prioStatic, reasonOf } from '../priority';
import { lotAllInFactor } from '../premiums';
import { gapRead } from '../lanes';
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

function checkBook(book: AuctionLot[], label: string): number {
  let n = 0;
  for (const lot of book) {
    const pc = projectedCloseOf(lot as Parameters<typeof projectedCloseOf>[0], NOW);
    const p = prioStatic(lot as Parameters<typeof prioStatic>[0], NOW);
    // the helper IS the ranker's projection anchor, or nothing
    if (pc) {
      n++;
      assert.ok(p && p.src === 'proj' && !p.over, `${label} ${lot.id}: a projection only where the ranker anchors on one`);
      assert.equal(pc.hammer, p!.a);
      assert.equal(pc.allIn, Math.round(pc.hammer * lotAllInFactor(lot, pc.hammer)), `${lot.id}: all-in = hammer × the lot's premium factor`);
    } else {
      assert.ok(!p || p.over || p.src !== 'proj', `${label} ${lot.id}: a projection anchor always yields the helper`);
    }
    // a legacy growth-curve stamp is read by nothing
    const legacy = { ...lot, bidProj: { g: 9, allIn: 123_456_789, ok: true } } as unknown as AuctionLot;
    assert.deepEqual(projectedCloseOf(legacy as Parameters<typeof projectedCloseOf>[0], NOW), pc, `${lot.id}: bidProj never moves the projection`);

    // surface 1 — the decision line (profile picks, Today, Watching, home For you)
    const d = decisionOf(lot, NOW);
    if (pc) {
      assert.equal(d.close?.kind, 'proj');
      assert.equal(d.close!.usd, pc.hammer);
      assert.equal(d.close!.allIn, pc.allIn);
      assert.equal(d.close!.text, `projected close ~${fmtFace(pc.hammer)}`);
      assert.ok(d.close!.title.endsWith(`~${fmtFace(pc.allIn)} all-in`), `${lot.id}: the all-in prints only labelled`);
    } else {
      assert.notEqual(d.close?.kind, 'proj', `${lot.id}: no helper → no projected close on the decision line`);
    }

    // surface 2 — the reason line (home Matters most, profile picks)
    const r = reasonOf(lot as Parameters<typeof reasonOf>[0], NOW) || '';
    if (pc) assert.ok(r.includes(`~${fmtFace(pc.hammer)} projected close`), `${lot.id}: reason "${r}" prints the helper's figure`);
    else assert.doesNotMatch(r, /projected close/, `${lot.id}: no helper → the reason names no projection`);
    if (pc) assert.equal((r.match(/\$[\d.,]+[KM]?/g) || []).length, 1, `${lot.id}: one figure on the reason line`);

    // surface 3 — the lot page's "Projected close" row
    const face = projectedCloseFace(lot, NOW);
    if (pc) {
      assert.ok(face);
      assert.equal(face!.hammer, pc.hammer);
      assert.equal(face!.allIn, pc.allIn);
      assert.equal(face!.text, `~${fmtFace(pc.hammer)}`);
      assert.equal(face!.allInText, `~${fmtFace(pc.allIn)} all-in`);
      assert.equal(face!.text, d.close!.text.replace('projected close ', ''), `${lot.id}: lot page and decision line print one number`);
    } else assert.equal(face, null);

    // surface 4 — the Gap (/value) reads the same figure (gate forced open)
    const g = gapRead({ ...lot, gapOk: true } as AuctionLot, NOW);
    if (g) {
      assert.ok(pc, `${lot.id}: the Gap seats only a projected lot`);
      assert.equal(g.hammer, pc!.hammer);
      assert.equal(g.allIn, pc!.allIn);
    }
  }
  return n;
}

test('live book: every surface prints the one projected close (compiled close-k)', () => {
  const book = liveBook();
  if (!book) return; // a checkout without the data build
  resetCloseK();
  assert.ok(checkBook(book, 'compiled') > 0, 'the live book has projected lots');
});

test('live book: same with the served nightly close-k fit installed', () => {
  const book = liveBook();
  let fit: unknown = null;
  try { fit = JSON.parse(src('public/data/ray/close-k.json')); } catch { /* not served in this checkout */ }
  if (!book || !fit || !setCloseK(fit)) return;
  try { assert.ok(checkBook(book, 'fitted') > 0); } finally { resetCloseK(); }
});

test('fixture: the all-in is the hammer × the lot’s own premium', () => {
  const lot = { id: 'goldin-x', artist: 'sports-cards', auctionHouse: 'Goldin', saleName: 'Goldin Weekly Auction', status: 'upcoming',
    currentBid: 810, saleDateTime: new Date(NOW + 150 * 3_600_000).toISOString(), buyerPremiumPct: 20 } as unknown as AuctionLot;
  resetCloseK();
  const pc = projectedCloseOf(lot as never, NOW)!;
  assert.equal(pc.factor, 1.2);
  assert.equal(pc.allIn, Math.round(pc.hammer * 1.2));
  const f = projectedCloseFace(lot, NOW)!;
  assert.equal(f.premiumPct, 20);
  // a bid already past the projection's anchor prints no projection
  assert.equal(projectedCloseOf({ ...lot, value: { expectedHammerUsd: 100, confidence: 'high' } } as never, NOW), null);
});

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (f === '__tests__' || f === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

test('sources: no surface reads the retired growth-curve projection', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const f of [...walk(path.join(ROOT, 'app')), path.join(ROOT, 'scripts/build-upcoming.ts'), path.join(ROOT, 'scripts/close-board.ts')]) {
    const code = strip(readFileSync(f, 'utf8'));
    assert.doesNotMatch(code, /\bbidProj\b|\blotProjectedClose\b|\bcloseGrowth\b/, `${path.relative(ROOT, f)} reads the retired projection`);
  }
  const page = src('app/components/LotPage.tsx');
  assert.match(page, /k="Projected close"\s+v=\{pc\.text\}/, 'the lot page prints projectedCloseFace');
  assert.match(page, /const pc = projectedCloseFace\(lot\)/);
});
