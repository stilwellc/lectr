/**
 * X5 (Oct 11 2026) — VALUE GRAMMAR, the site-wide honesty law:
 *
 *  1. ONE SIGNAL SOURCE: LotCard.lotSignal reads the build's stamp, else
 *     comps.engineFlagOf — the same read lot-face makes — never a client
 *     recompute over the pool the page happens to hold (flags.ts law).
 *  2. ONE MAGNITUDE FORMATTER: every surface prints a signal through
 *     comps.signalMagnitude ("+38%", "3.2×", "5×+", "−50%") — the desk's
 *     sigText and lot-face call.text are the same string.
 *  3. THE COMPS RULE on the decision line (lot-face decisionOf): a Below
 *     Market call of ≥ 2× whose max bid sits under half the comps median
 *     prints the flag's basis — "comps median $23K · 12 closest of 118
 *     sales" — in place of "worth up to $7K" (R1#3, R3#6: the two read as a
 *     contradiction on one row); the max bid rides the tooltip with its
 *     definition. Pinned to real rows off the Oct 11 book; the live book is
 *     swept whenever the checkout carries it.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { readFileSync } from 'fs';
import path from 'path';
import { decisionOf, decisionParts, lotFace, fmtFace, compsRuleFires, compsCountText, liveSignalOf, DECISION_COMPS_RULE, MAXBID_POINT_PCT } from '../lot-face';
import { signalMagnitude, engineFlagOf } from '../comps';
import { MAXBID_Q } from '../value';
import { VALUE_GRAMMAR_ROWS as ROWS } from './helpers/value-grammar-rows-oct11';
import type { AuctionLot } from '../../types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
/** Oct 11 2026, 6 PM ET — the pinned rows' crawl day */
const NOW = Date.parse('2026-10-11T22:00:00Z');

const row = (id: string): AuctionLot => {
  const r = ROWS[id];
  assert.ok(r, `pinned row ${id}`);
  return JSON.parse(JSON.stringify(r)) as AuctionLot;
};

test('Cow 1976 (bonhams, est $4.6K–$6.9K, comps 3.2×): the line prints the comps median, the max bid moves to the tooltip', () => {
  const l = row('bonhams-31799-61');
  const f = lotFace(l);
  assert.equal(f.call?.text, '3.2×');
  assert.equal(f.maxBid?.hammer, 7046);
  assert.equal(f.comps?.med, 22813);
  assert.ok(f.maxBid!.hammer < f.comps!.med / 2, 'max bid under half the comps median');
  assert.equal(compsRuleFires(f), true);
  const d = decisionOf(l, NOW, f);
  assert.equal(d.worth?.kind, 'comps');
  assert.equal(d.worth?.usd, 22813, 'the worth figure IS the comps median');
  assert.equal(d.worth?.text, `comps median $23K · ${compsCountText(f.comps!.n, f.comps!.ids.length)}`);
  assert.match(d.worth!.text, /^comps median \$23K · (\d+ closest of )?118 sales$/);
  const parts = decisionParts(d);
  assert.doesNotMatch(parts.join(' · '), /worth up to/, parts.join(' · '));
  assert.ok(parts.includes(d.worth!.text));
  // the max bid, with its definition, in the tooltip
  assert.match(d.worth!.title, /walk-away bid ≤ \$7K hammer/);
  assert.match(d.worth!.title, new RegExp(`the engine’s ${MAXBID_POINT_PCT}% point`));
  assert.match(d.worth!.title, /3\.2× flag/);
  // a comps median is all-in realized, the estimate is hammer: no gap across bases
  assert.equal(d.gap, null);
  assert.equal(d.close?.text, 'estimate $4.6K–$6.9K');
});

test('Calder, Fêtes (wright, est $3K–$5K, comps 2.1×) and two Picasso prints at 3.0× / 2.0× print the comps median', () => {
  for (const [id, call, med, n] of [['wright-289173~', '2.1×', '$10K', 6], ['wright-415133', '3.0×', '$18K', 53], ['bonhams-31799-2', '2.0×', '$12K', 5]] as const) {
    const l = row(id);
    const f = lotFace(l);
    assert.equal(f.call?.text, call, id);
    assert.equal(compsRuleFires(f), true, id);
    const d = decisionOf(l, NOW, f);
    assert.equal(d.worth?.kind, 'comps', id);
    assert.equal(d.worth?.usd, f.comps!.med, id);
    assert.match(d.worth!.text, new RegExp(`^comps median \\${med} · (\\d+ closest of )?${n} sales$`), `${id}: ${d.worth!.text}`);
    assert.match(d.worth!.title, /walk-away bid ≤ \$[\d.]+K? hammer/, id);
    assert.doesNotMatch(decisionParts(d).join(' · '), /worth up to/, id);
    assert.equal(d.gap, null, id);
  }
});

test('lots NOT meeting the rule print exactly what they printed before', () => {
  // Below +38% — under 2×: "worth up to" as before
  let l = row('christies-6608618');
  let f = lotFace(l);
  assert.equal(f.call?.text, '+38%');
  assert.ok(f.maxBid && f.comps && f.maxBid.hammer < f.comps.med / 2, 'the share gate alone would pass');
  assert.equal(compsRuleFires(f), false);
  let d = decisionOf(l, NOW, f);
  assert.equal(d.worth?.kind, 'max');
  assert.equal(d.worth?.text, `worth up to ${fmtFace(f.maxBid!.hammer)}`);
  assert.equal(d.worth?.title, `lectr’s max bid ${f.maxBid!.text} — ${f.maxBid!.sub}`);
  // Below +38% at low confidence — no certified max bid, so no worth at all (lot page: no line)
  l = row('bonhams-31799-17');
  f = lotFace(l);
  assert.equal(f.call?.text, '+38%');
  assert.equal(f.maxBid, null);
  assert.equal(compsRuleFires(f), false);
  assert.equal(decisionOf(l, NOW, f).worth, null);
  // no call (the engine's flag abstained) though the max bid sits under half the median
  l = row('phillips-NY030926-48');
  f = lotFace(l);
  assert.equal(f.call, null);
  // (the pinned row carries the stamp without its poolIds; the gate is read off the stamped median)
  assert.ok(f.maxBid && f.maxBid.hammer < l.value!.compMedianUsd! / 2, 'the share gate alone would pass');
  assert.equal(compsRuleFires(f), false);
  assert.match(decisionOf(l, NOW, f).worth!.text, /^worth up to \$/);
  // Below 4.3× with no certified max bid — nothing to replace: no worth either way
  l = row('christies-auc-6608769');
  f = lotFace(l);
  assert.equal(f.call?.text, '4.3×');
  assert.equal(f.maxBid, null);
  assert.equal(compsRuleFires(f), false);
  assert.equal(decisionOf(l, NOW, f).worth, null);
  // Above Market
  l = row('bonhams-31799-31');
  f = lotFace(l);
  assert.equal(f.call?.text, '−50%');
  assert.equal(compsRuleFires(f), false);
  assert.match(decisionOf(l, NOW, f).worth!.text, /^worth up to \$/);
});

test('the rule\'s two gates, at their edges (Cow re-stamped)', () => {
  assert.deepEqual(DECISION_COMPS_RULE, { minPct: 100, maxBidShare: 0.5 });
  // magnitude: +99% is under 2× → the max bid prints
  let l = row('bonhams-31799-61');
  l.signal = { ...l.signal!, pct: 99 };
  assert.equal(lotFace(l).call?.text, '+99%');
  assert.equal(compsRuleFires(lotFace(l)), false);
  l.signal = { ...l.signal!, pct: 100 };
  assert.equal(compsRuleFires(lotFace(l)), true, '+100% is 2×');
  // share: a max bid at half the median or above keeps "worth up to"
  l = row('bonhams-31799-61');
  const med = l.value!.compMedianUsd!;
  (l.value as unknown as { maxBidUsd: number }).maxBidUsd = Math.ceil(med / 2);
  assert.equal(compsRuleFires(lotFace(l)), false);
  (l.value as unknown as { maxBidUsd: number }).maxBidUsd = Math.ceil(med / 2) - 1;
  assert.equal(compsRuleFires(lotFace(l)), true);
  // an Above call never fires, whatever the share
  l = row('bonhams-31799-61');
  l.signal = { ...l.signal!, label: 'Above Market', pct: 150 };
  assert.equal(compsRuleFires(lotFace(l)), false);
});

test('the tooltip\'s "30% point" is value.ts MAXBID_Q, not a second number', () => {
  assert.equal(MAXBID_POINT_PCT, Math.round(MAXBID_Q * 100));
});

test('live book: every worth figure follows the rule — comps median where it fires, the max bid everywhere else', () => {
  let book: AuctionLot[];
  try { book = (JSON.parse(src('public/data/ray/upcoming.json')) as { lots: AuctionLot[] }).lots.filter(l => l.status === 'upcoming'); }
  catch { return; } // a checkout without the data build
  let fires = 0, below2x = 0;
  for (const lot of book) {
    const f = lotFace(lot);
    const d = decisionOf(lot, NOW, f);
    const gate = !!f.call && f.call.label === 'Below Market' && f.call.pct >= 100 && !!f.maxBid && !!f.comps && f.maxBid.hammer < f.comps.med / 2;
    assert.equal(compsRuleFires(f), gate, lot.id);
    if (f.call?.label === 'Below Market' && f.call.pct >= 100) below2x++;
    if (gate) {
      fires++;
      assert.equal(d.worth?.kind, 'comps', lot.id);
      assert.equal(d.worth?.usd, f.comps!.med, lot.id);
      assert.equal(d.gap, null, `${lot.id}: no gap across bases`);
      assert.doesNotMatch(decisionParts(d).join(' · '), /worth up to/, lot.id);
    } else if (f.maxBid) {
      assert.equal(d.worth?.kind, 'max', lot.id);
      assert.equal(d.worth?.usd, f.maxBid.hammer, lot.id);
    } else assert.equal(d.worth, null, lot.id);
  }
  assert.ok(fires > 0 && fires <= below2x, `the rule touches ${fires} of ${below2x} ≥2× flags`);
});

test('one magnitude formatter: the desk\'s sigText IS lot-face call.text IS signalMagnitude', () => {
  // the desk's sigText is `signalMagnitude(sig.label, sig.pct)` by source law
  // (below; derive.ts carries the card's CSS, which node cannot load) — the
  // same call lot-face makes for call.text
  const sigText = (sig: { label: string; pct: number }) => signalMagnitude(sig.label, sig.pct);
  for (const id of ['bonhams-31799-61', 'bonhams-31799-17', 'bonhams-31799-31', 'wright-415133']) {
    const l = row(id);
    const sig = liveSignalOf(l);
    assert.ok(sig, id);
    assert.equal(sigText(sig!), lotFace(l).call?.text, id);
  }
  assert.equal(sigText({ label: 'Below Market', pct: 224 }), '3.2×', 'never "+224%" beside a "3.2×"');
  assert.equal(sigText({ label: 'Below Market', pct: 97 }), '+97%');
  assert.equal(sigText({ label: 'Below Market', pct: 480 }), '5×+');
  assert.equal(sigText({ label: 'Above Market', pct: 31 }), '−31%');
});

test('one signal source: liveSignalOf reads the stamp, else engineFlagOf — never a client recompute', () => {
  // a stamped lot: the stamp, null included
  const l = row('bonhams-31799-61');
  assert.deepEqual(liveSignalOf(l), l.signal);
  assert.equal(liveSignalOf({ ...l, signal: null } as AuctionLot), null, 'a stamped null is an abstention, not a cue to recompute');
  // an unstamped lot with an engine value: the engine's flag off the value (lot-face's own read)
  const u = { ...l } as AuctionLot & { signal?: unknown };
  delete u.signal;
  const got = liveSignalOf(u as AuctionLot);
  assert.deepEqual(got, engineFlagOf(u as AuctionLot));
  assert.equal(got?.label, 'Below Market');
  assert.equal(lotFace(u as AuctionLot).call?.text, signalMagnitude(got!.label, got!.pct));
  // an unstamped lot with no value: nothing
  const bare = { ...u, value: undefined } as unknown as AuctionLot;
  assert.equal(liveSignalOf(bare), null);
});

test('source law: the four grammar files', () => {
  const card = src('app/components/LotCard.tsx');
  assert.doesNotMatch(card, /computeDeepSignal|computeBuySignal/, 'LotCard: no client signal recompute');
  assert.match(card, /export function lotSignal\([^)]*\)[^{]*\{\s*return liveSignalOf\(lot\);\s*\}/, 'LotCard.lotSignal delegates to lot-face');
  assert.match(src('app/profile/desk/provider.tsx'), /lotSignal\(/, 'the desk reads lotSignal (one source)');
  const derive = src('app/profile/desk/derive.ts');
  assert.match(derive, /export const sigText = \(sig: LiveSignal\) => signalMagnitude\(sig\.label, sig\.pct\)/);
  assert.doesNotMatch(derive, /\$\{Math\.abs\(Math\.round\(sig\.pct\)\)\}%/, 'derive: no hand-rolled percent beside signalMagnitude');
  const line = src('app/components/DecisionLine.tsx');
  assert.doesNotMatch(line, /\b(maxBidUsd|compMedianUsd|fmtUsd|formatPrice|signalMagnitude)\b/, 'DecisionLine formats nothing of its own');
  const face = src('app/lib/lot-face.ts');
  assert.match(face, /export const DECISION_COMPS_RULE/);
  assert.match(face, /export function compsRuleFires/);
});
