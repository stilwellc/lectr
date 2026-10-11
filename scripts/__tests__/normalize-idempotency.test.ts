/**
 * normalizeCorpus idempotency — normalize(normalize(x)) === normalize(x).
 *
 * The value book re-runs corpus cleanup on the already-published corpus; on
 * Oct 11 2026 that pass still logged "580 relic cards → sports-cards" plus
 * thousands of reclass moves, and rewrote 7.8k playerSlugs. Measured on the
 * full published corpus (1,237,233 rows) the causes were:
 *   · goldin-sport-noncard (reclass ladder) ↔ rerouteRelicCards fighting over
 *     615 Goldin rows every pass (moved out, moved back) → one shared verdict
 *     (classify goldinSportVerdict);
 *   · normalizeArtCategory flipping "silkscreen ink and graphite on primed
 *     canvas" (Warhol's $85M White Disaster) print ↔ original on alternate
 *     passes → the original branch honours the print branch's PAINTED_CANVAS;
 *   · recoverPlayerSlugs / restampCardPlayer overwriting build-market's
 *     athlete-tested stamp ("lou-gehrig") with a longer title read
 *     ("important-lou-gehrig") → a titled athlete stamp is kept;
 *   · reclass counts included A→B→A round trips (2,538 RR space lots) →
 *     only net moves are counted.
 *
 * Fixtures: real published rows (normalize-idempotency-rows.json). The corpus
 * property test runs over a deterministic sample of the local corpus when
 * data/corpus is present (symlink the main checkout's data/corpus into a
 * worktree); it is skipped where the corpus is absent (CI's test step).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import type { AuctionLot } from '../../app/types';
import { normalizeCorpus, reclassifyCorpus, rerouteRelicCards, normalizeArtCategory, recoverPlayerSlugs, restampCardPlayer, isTitledAthleteSlug } from '../lib/corpus-normalize';
import { goldinSportVerdict, isSlabbedBrandCard } from '../lib/classify';
import { streamGzRows } from '../corpus-io';

const NOW = new Date('2026-10-11T12:00:00Z');
const rows = (): Record<string, any>[] => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'normalize-idempotency-rows.json'), 'utf8'));
const byId = (rs: Record<string, any>[], id: string) => rs.find(r => r.id === id)!;
const quiet = <T>(fn: () => T): T => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };
const norm = (rs: Record<string, any>[]) => quiet(() => normalizeCorpus(rs as unknown as AuctionLot[], { now: NOW }));

test('fixture rows: a second normalize changes nothing', () => {
  const rs = rows();
  norm(rs);
  const once = JSON.stringify(rs);
  norm(rs);
  assert.equal(JSON.stringify(rs), once);
});

test('White Disaster (silkscreen ink on PRIMED canvas) settles as an original and stays there', () => {
  const r = byId(rows(), 'sothebys-32448e0b-fd0d-49e9-83b9-bd5d1258ad70');
  for (let i = 0; i < 3; i++) { normalizeArtCategory([r as never]); assert.equal(r.category, 'original', `pass ${i}`); }
});

test('Goldin: one verdict — game-used sneakers and 1/1 art pieces leave sports-cards, a slabbed brand card stays', () => {
  const rs = rows();
  norm(rs);
  const lebron = rs.find(r => /LeBron James Game-Used/.test(r.title))!;
  const piggy = rs.find(r => /PiggyBanx/.test(r.title))!;
  const mahomes = rs.find(r => /Patrick Mahomes II/.test(r.title))!;
  assert.equal(lebron.artist, 'game-used');
  assert.equal(piggy.artist, 'sports-memorabilia');
  assert.equal(mahomes.artist, 'sports-cards');
  // and the relic reroute agrees, so it has nothing left to move
  assert.equal(rerouteRelicCards(rs as never).total, 0);
  assert.equal(goldinSportVerdict(mahomes.title), 'sports-cards');
  assert.ok(isSlabbedBrandCard('2010 Topps Chrome Wrapper Redemption Refractor #223 Lou Gehrig – PSA MINT 9'));
  assert.ok(!isSlabbedBrandCard('Kobe Bryant Game-Used, Signed Nike Kobe IX Elite PE Sneakers (#1/1) - MeiGray, Upper Deck Authentication 10'));
});

test('the published athlete stamp survives the title parser', () => {
  const rs = rows();
  const gehrig = byId(rs, 'christies-auc-6551472'), ruth = byId(rs, 'christies-auc-6551471');
  assert.equal(gehrig.playerSlug, 'lou-gehrig');
  quiet(() => recoverPlayerSlugs(rs as never));
  assert.equal(gehrig.playerSlug, 'lou-gehrig');
  assert.equal(ruth.playerSlug, 'babe-ruth');
  assert.ok(isTitledAthleteSlug('babe-ruth', 'FINE BABE RUTH PROFESSIONAL MODEL BASEBALL BAT'));
  assert.ok(!isTitledAthleteSlug('babe-ruth', 'LOU GEHRIG JERSEY'), 'the athlete must be in the title');
  assert.ok(!isTitledAthleteSlug('fine-babe-ruth', 'FINE BABE RUTH BAT'), 'not a roster athlete');
  // a card stamp the same way
  const yamal = { title: '2026 Panini The National VIP Double Gem #LY Lamine Yamal Diamond Relic Card (#1/1)', playerName: 'Lamine Yamal', playerSlug: 'lamine-yamal' };
  restampCardPlayer(yamal, new Set(['lamine-yamal']));
  assert.equal(yamal.playerSlug, 'lamine-yamal');
});

test('reclass counts are NET moves: a row moved and moved back in one pass is not counted', () => {
  const rs = rows();
  norm(rs);
  const r = reclassifyCorpus(rs as never);
  assert.deepEqual(r.byClass, {});
});

// ── property test over the real corpus (skipped without data/corpus) ──
const CORPUS = path.join(__dirname, '..', '..', 'data', 'corpus');
const hasCorpus = fs.existsSync(path.join(CORPUS, 'lots.json.gz'));
test('PROPERTY: normalize(normalize(x)) === normalize(x) on a corpus sample', { skip: !hasCorpus && 'no data/corpus (symlink the local corpus to run)', timeout: 600_000 }, async () => {
  const every = Number(process.env.RAY_IDEM_EVERY || 25);
  const sample: Record<string, any>[] = [];
  let i = 0;
  for (const f of ['lots.json.gz', 'sold-archive.json.gz']) {
    const p = path.join(CORPUS, f);
    if (!fs.existsSync(p)) continue;
    await streamGzRows(p, r => { if (i++ % every === 0) sample.push(r); });
  }
  assert.ok(sample.length > 1000, `sample ${sample.length}`);
  norm(sample);
  const once = sample.map(r => JSON.stringify(r));
  norm(sample);
  const diffs: string[] = [];
  sample.forEach((r, k) => { if (JSON.stringify(r) !== once[k] && diffs.length < 5) diffs.push(`${r.id}: ${once[k].slice(0, 160)} → ${JSON.stringify(r).slice(0, 160)}`); });
  assert.equal(sample.length, once.length, 'no rows added or dropped on the second pass');
  assert.deepEqual(diffs, [], `${diffs.length} row(s) changed on the second pass`);
});
