// LLM extraction layer (scripts/lib/extract) — offline tests with recorded
// fixture responses: schema rejection + grounding, cache hits, the nightly cap,
// inert mode (no key → no calls, no mutation), and the advisory merges.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseCard, cardKey } from '../../app/lib/cards';
import { pokemonKey } from '../sub-markets';
import type { AuctionLot } from '../../app/types';
import { checkShape, validateExtraction, type Extraction } from '../lib/extract/schema';
import { ExtractCache, hashText } from '../lib/extract/cache';
import { selectCandidates } from '../lib/extract/select';
import { runExtraction } from '../lib/extract/run';
import { replayApi } from '../lib/extract/replay';
import { estimateCost } from '../lib/extract/batch';
import {
  attachExtractions, fillWatchReferencesFromExtract, mergeCardExtract, pokemonKeyFromExtract,
  sameObjectFilter, llmConditionFlag, resetExtractCache, extractCache,
} from '../lib/extract/apply';
import { EXTRACT_PROMPT_VERSION, SAME_PROMPT_VERSION } from '../lib/extract/config';
import { EXAMPLES, EXTRACT_SYSTEM } from '../lib/extract/prompt';

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'extract-fixture.json'), 'utf8')).extract as Record<string, Extraction>;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ray-extract-'));

let seq = 0;
function lot(title: string, over: Partial<AuctionLot> & Record<string, unknown> = {}): AuctionLot & Record<string, unknown> {
  return {
    id: `t-${++seq}`, artist: 'sports-cards', title, year: null, medium: null, dimensions: null, category: 'object',
    imageUrl: null, auctionHouse: 'Goldin', saleName: '', saleDate: '2026-08-01', lotNumber: null,
    estimateLow: null, estimateHigh: null, currency: 'USD', hammerPrice: null, premiumPrice: null, priceUsd: null,
    status: 'sold', ...over,
  } as AuctionLot & Record<string, unknown>;
}

function setEnv(vars: Record<string, string | undefined>) {
  for (const k of ['ANTHROPIC_API_KEY', 'RAY_EXTRACT', 'RAY_EXTRACT_APPLY', 'RAY_EXTRACT_CACHE', 'RAY_EXTRACT_MAX']) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
  resetExtractCache();
}
beforeEach(() => setEnv({}));

// ── schema ───────────────────────────────────────────────────────────────────
test('schema: a valid fixture passes shape; unknown key, bad grade, bad enum, missing key are rejected', () => {
  assert.equal(checkShape(FIX['1983 Topps 482 Tony Gwynn Rookie Card – PSA MINT 9']).ok, true);
  const etb = checkShape(FIX['2021 Pokemon Celebrations Factory-Sealed Elite Trainer Box (10 4-Card Packs, 4 Packs) - Possible Charizard, Umbreon, Pikachu Cards']);
  assert.deepEqual(etb, { ok: false, reason: 'unknown-key:price_guess' });
  const seven = checkShape(FIX['2015 Pokemon Xy Roaring Skies 20 Pikachu – PSA NM 7']);
  assert.deepEqual(seven, { ok: false, reason: 'grade-format' });
  const base = FIX['1983 Topps 482 Tony Gwynn Rookie Card – PSA MINT 9'];
  assert.equal(checkShape({ ...base, grading_company: 'PSX' }).ok, false);
  assert.equal(checkShape({ ...base, vertical: 'car' }).ok, false);
  assert.equal(checkShape({ ...base, serial_run: 0 }).ok, false);
  assert.equal(checkShape({ ...base, complications: ['warp_drive'] }).ok, false);
  assert.equal(checkShape({ ...base, grading_company: null }).ok, false, 'a grade with no company is incoherent');
  const { year: _y, ...missing } = base;
  assert.equal(checkShape(missing).ok, false);
  assert.equal(checkShape('{"not":"an object"}').ok, false);
  assert.equal(checkShape(null).ok, false);
});

test('grounding: fields the lot text does not carry are nulled (no leakage, no guesses)', () => {
  const t = '1909-1911 T206 White Border Rube Marquard Portrait SGC VG/EX 50';
  const v = validateExtraction(FIX[t], t);
  assert.ok(v.ok);
  if (!v.ok) return;
  assert.equal(v.value.card_number, null, 'hallucinated #121 is not in the text');
  assert.ok(v.grounded.includes('card_number'));
  assert.equal(v.value.grade, '4', 'SGC legacy 50 grounds grade 4');
  // a reference that is not in the text dies; one that is survives
  const w = FIX['Rolex. A fine stainless steel automatic twin time zone wristwatch with stainless steel bracelet together with Rolex box and papers'];
  const title = 'Rolex. A fine stainless steel automatic twin time zone wristwatch with stainless steel bracelet together with Rolex box and papers';
  const noDesc = validateExtraction(w, title);
  assert.ok(noDesc.ok && noDesc.value.reference === null && noDesc.value.year === null);
  const withDesc = validateExtraction(w, `${title}\nGMT-Master, Ref:1675, Made in 1966`);
  assert.ok(withDesc.ok && withDesc.value.reference === '1675');
  // a grader never named in the text takes its grade with it
  const g = validateExtraction({ ...FIX['1983 Topps 482 Tony Gwynn Rookie Card – PSA MINT 9'], grading_company: 'BGS' }, '1983 Topps 482 Tony Gwynn Rookie Card – PSA MINT 9');
  assert.ok(g.ok && g.value.grading_company === null && g.value.grade === null);
});

test('prompt: 10–15 real examples, all of which validate against their own text', () => {
  assert.ok(EXAMPLES.length >= 10 && EXAMPLES.length <= 15, `examples=${EXAMPLES.length}`);
  for (const ex of EXAMPLES) {
    const out = JSON.parse(EXTRACT_SYSTEM.split(`TITLE: ${ex.title}`)[1].split('OUTPUT: ')[1].split('\n')[0]);
    const v = validateExtraction(out, `${ex.title}\n${ex.description || ''}`);
    assert.ok(v.ok, `${ex.title}: ${!v.ok && v.reason}`);
    if (v.ok) assert.deepEqual(v.grounded, [], `${ex.title} example is not self-grounded: ${v.ok && v.grounded}`);
  }
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(EXTRACT_SYSTEM), 'no volatile timestamps in the cached prefix');
});

// ── cache + selection + cap ──────────────────────────────────────────────────
test('cache: hit on same id+text+version, miss when the text changes or the prompt version moves; save/load round-trips', () => {
  const dir = tmp(); const f = path.join(dir, 'c.json.gz');
  const c = new ExtractCache();
  const l = lot('1983 Topps 482 Tony Gwynn Rookie Card – PSA MINT 9');
  const h = hashText(l.title, '');
  c.putX({ k: 'x', id: l.id, h, v: EXTRACT_PROMPT_VERSION, m: 'm', f: FIX[l.title] });
  c.save(f);
  const c2 = ExtractCache.load(f);
  assert.ok(c2.getX(l.id, h, EXTRACT_PROMPT_VERSION));
  assert.equal(c2.getX(l.id, hashText(l.title + ' ', ''), EXTRACT_PROMPT_VERSION), null);
  assert.equal(c2.getX(l.id, h, 'x0-old'), null);
  // deterministic bytes: an unchanged cache re-saves identically
  const b1 = fs.readFileSync(f); c2.save(f); assert.ok(b1.equals(fs.readFileSync(f)));

  const sel = selectCandidates([l, lot(l.title, { id: 'other' })], c2, 100);
  assert.equal(sel.cacheHits, 1);
  assert.deepEqual(sel.candidates.map(x => x.id), ['other']);
  l.title = l.title + ' (Reholdered)';
  assert.equal(selectCandidates([l], c2, 100).candidates.length, 1, 'changed text is re-sent');
});

test('cap: RAY_EXTRACT_MAX bounds the night; live unkeyed lots go first, then live keyed, sold unkeyed, sold keyed', () => {
  const lots = [
    lot('1983 Topps #482 Tony Gwynn Rookie Card - PSA MINT 9', { id: 'sold-keyed' }),
    lot('1983 Topps 482 Tony Gwynn Rookie Card – PSA MINT 9', { id: 'sold-unkeyed' }),
    lot('1983 Topps #482 Tony Gwynn Rookie Card - PSA MINT 9', { id: 'live-keyed', status: 'upcoming' }),
    lot('1983 Topps 482 Tony Gwynn Rookie Card – PSA MINT 9', { id: 'live-unkeyed', status: 'upcoming' }),
    lot('Oil on canvas', { id: 'art', artist: 'andy-warhol' }),
  ];
  const all = selectCandidates(lots, new ExtractCache(), 100);
  assert.equal(all.eligible, 4, 'non-target verticals are never sent');
  assert.deepEqual(all.candidates.map(c => c.id), ['live-unkeyed', 'live-keyed', 'sold-unkeyed', 'sold-keyed']);
  const capped = selectCandidates(lots, new ExtractCache(), 2);
  assert.deepEqual(capped.candidates.map(c => c.id), ['live-unkeyed', 'live-keyed']);
  assert.equal(capped.capped, 2);
});

test('cap is enforced end-to-end by the runner; cost is estimated and logged', async () => {
  const dir = tmp();
  setEnv({ RAY_EXTRACT_CACHE: path.join(dir, 'c.json.gz'), RAY_EXTRACT_MAX: '3' });
  const lots = Array.from({ length: 10 }, (_, i) => lot(`1983 Topps ${400 + i} Tony Gwynn – PSA MINT 9`));
  const api = replayApi({});
  const rep = await runExtraction({ lots, api, pollMs: 0, waitMin: 0 });
  assert.equal(rep.submitted, 3);
  assert.equal(api.requests, 3);
  assert.ok(rep.estUsd > 0 && rep.estUsd < 0.05, `est ${rep.estUsd}`);
  const e = estimateCost('claude-haiku-4-5-20251001', 'x', Array(20000).fill(160));
  assert.ok(e.usd > 1 && e.usd < 40, `20k lots ≈ $${e.usd}`);
});

// ── inert mode ───────────────────────────────────────────────────────────────
test('inert without a key: no calls, no cache file, no mutation, same objects back', async () => {
  const dir = tmp(); const f = path.join(dir, 'c.json.gz');
  setEnv({ RAY_EXTRACT_CACHE: f });
  const rep = await runExtraction({ lots: [lot('1983 Topps 482 Tony Gwynn Rookie Card – PSA MINT 9')] });
  assert.equal(rep.enabled, false);
  assert.equal(fs.existsSync(f), false);

  // even with a populated cache on disk, apply stays off without the gate
  const c = new ExtractCache();
  const l = lot('1983 Topps 482 Tony Gwynn Rookie Card – PSA MINT 9');
  c.putX({ k: 'x', id: l.id, h: hashText(l.title, ''), v: EXTRACT_PROMPT_VERSION, m: 'm', f: FIX[l.title] });
  c.save(f);
  const before = JSON.stringify(l);
  assert.equal(attachExtractions([l]), 0);
  assert.equal(fillWatchReferencesFromExtract([l]), 0);
  assert.equal(JSON.stringify(l), before);
  const card = parseCard(l.title);
  const withLlm = { ...l, llm: { h: 'x', v: EXTRACT_PROMPT_VERSION, src: 'llm', ...FIX[l.title] } } as AuctionLot;
  assert.equal(mergeCardExtract(card, withLlm), card, 'same object when off');
  assert.equal(pokemonKeyFromExtract({ ...withLlm, artist: 'pokemon' } as AuctionLot), null);
  const pool = [lot('a'), lot('b')];
  assert.equal(sameObjectFilter(l, pool), pool);
  assert.equal(llmConditionFlag(l), false);
  // RAY_EXTRACT=0 beats a present key
  setEnv({ ANTHROPIC_API_KEY: 'sk-test', RAY_EXTRACT: '0', RAY_EXTRACT_CACHE: f });
  assert.equal((await runExtraction({ lots: [l] })).enabled, false);
  assert.equal(attachExtractions([l]), 0);
});

// ── end-to-end with recorded responses ───────────────────────────────────────
test('replay: submit → collect → validate → cache → attach → advisory merges', async () => {
  const dir = tmp(); const f = path.join(dir, 'c.json.gz');
  setEnv({ RAY_EXTRACT_CACHE: f });
  const gwynn = lot('1983 Topps 482 Tony Gwynn Rookie Card – PSA MINT 9', { status: 'upcoming' });
  const faulk = lot('1994 Upper Deck #7 Marshall Faulk Signed, Inscribed Rookie Card - BGS MINT 9, Beckett 10');
  const marq = lot('1909-1911 T206 White Border Rube Marquard Portrait SGC VG/EX 50', { artist: 'graded-cards' });
  const bells = lot('1999 Pokemon Jungle 49 Bellsprout – PSA MINT 9', { artist: 'pokemon' });
  const etb = lot('2021 Pokemon Celebrations Factory-Sealed Elite Trainer Box (10 4-Card Packs, 4 Packs) - Possible Charizard, Umbreon, Pikachu Cards', { artist: 'pokemon' });
  const pika = lot('2015 Pokemon Xy Roaring Skies 20 Pikachu – PSA NM 7', { artist: 'pokemon' });
  const rolex = lot('Rolex. A fine stainless steel automatic twin time zone wristwatch with stainless steel bracelet together with Rolex box and papers',
    { artist: 'rolex', description: 'GMT-Master, Ref:1675, Made in 1966, Sold 11th November 1967', reference: null });
  const lots = [gwynn, faulk, marq, bells, etb, pika, rolex];
  const api = replayApi(FIX);
  const rep = await runExtraction({ lots, api, pollMs: 0, waitMin: 0 });
  assert.equal(rep.submitted, 7);
  const st = rep.collectedTonight!;
  assert.equal(st.succeeded, 5);
  assert.equal(st.rejected, 2, 'unknown key + non-numeric grade rejected whole');
  assert.equal(st.reasons['schema:unknown-key:price_guess'], 1);
  assert.equal(st.reasons['schema:grade-format'], 1);
  assert.ok(st.reasons['grounded-null:card_number'] >= 1, 'Marquard #121 nulled');
  assert.equal(rep.pendingLeft, 0);

  // a second night: everything is a cache hit → nothing sent
  const api2 = replayApi(FIX);
  const rep2 = await runExtraction({ lots, api: api2, pollMs: 0, waitMin: 0 });
  assert.equal(rep2.submitted, 0);
  assert.equal(api2.calls.create, 0);

  // apply (the assemble step: gate via RAY_EXTRACT_APPLY, no key needed)
  setEnv({ RAY_EXTRACT_CACHE: f, RAY_EXTRACT_APPLY: '1' });
  assert.equal(attachExtractions(lots), 5);
  assert.equal((gwynn as { llm?: { src?: string } }).llm?.src, 'llm');
  assert.equal((etb as { llm?: unknown }).llm, undefined, 'rejected record never attaches');

  // cards: fills the '#'-less identity into the SAME key the regex gives the '#' form
  const regexTwin = cardKey(parseCard('1983 Topps #482 Tony Gwynn Rookie Card - PSA MINT 9'));
  assert.equal(cardKey(parseCard(gwynn.title)), null, 'regex alone cannot key it');
  const merged = mergeCardExtract(parseCard(gwynn.title), gwynn) as ReturnType<typeof parseCard> & { llmFilled?: string[] };
  assert.equal(cardKey(merged), regexTwin);
  assert.ok(merged.llmFilled?.includes('cardNo'));

  // never override a hard regex grade: the fixture says 10, the regex reads BGS 9
  const fr = parseCard(faulk.title);
  const fm = mergeCardExtract(fr, faulk);
  assert.equal(fm.gradeCo, 'BGS'); assert.equal(fm.gradeNum, 9);
  assert.equal(cardKey(fm), cardKey(fr));

  // SGC legacy grade the regex could not parse (gradeUnparsed) → filled; no card number → still unkeyed
  const mm = mergeCardExtract(parseCard(marq.title), marq);
  assert.equal(mm.gradeCo, 'SGC'); assert.equal(mm.gradeNum, 4); assert.equal(mm.gradeUnparsed, false);
  assert.equal(mm.cardNo, null);

  // pokémon: regex misses the '#'-less number; the extraction keys it into the regex twin's pool
  assert.equal(pokemonKey(bells), null);
  const twin = lot('1999 Pokemon Jungle #49 Bellsprout - PSA MINT 9', { artist: 'pokemon' });
  assert.equal(pokemonKeyFromExtract(bells), pokemonKey(twin));

  // watch: an empty reference is filled with provenance
  assert.equal(fillWatchReferencesFromExtract(lots), 1);
  assert.equal(rolex.reference, '1675');
  assert.equal((rolex as { referenceSrc?: string }).referenceSrc, 'llm');
});

test('runner: a batch still processing at the deadline stays pending and is collected the next night', async () => {
  const dir = tmp(); const f = path.join(dir, 'c.json.gz');
  setEnv({ RAY_EXTRACT_CACHE: f });
  const l = lot('1983 Topps 482 Tony Gwynn Rookie Card – PSA MINT 9');
  const slow = replayApi(FIX, { stillRunning: true });
  const r1 = await runExtraction({ lots: [l], api: slow, pollMs: 0, waitMin: 0 });
  assert.equal(r1.pendingLeft, 1);
  assert.equal(ExtractCache.load(f).pending.length, 1);
  // next night: the SAME lot is not re-sent while in flight
  const slow2 = replayApi(FIX, { stillRunning: true });
  const r2 = await runExtraction({ lots: [l], api: slow2, pollMs: 0, waitMin: 0 });
  assert.equal(r2.submitted, 0);
  // collect: a fresh replay API that knows the batch ended — reuse the first
  // replay's batch table by flipping it to ended
  const done = replayApi(FIX);
  const c = ExtractCache.load(f);
  const pb = c.pending[0];
  // re-submit through the "done" API under the same custom ids, then point pending at it
  const created = await done.create({ requests: Object.keys(pb.items).map(cid => ({ custom_id: cid, params: { messages: [{ content: `TITLE: ${l.title}` }] } })) } as never);
  c.pending[0] = { ...pb, id: (created as { id: string }).id }; c.save(f);
  const r3 = await runExtraction({ lots: [l], api: done, pollMs: 0, waitMin: 0 });
  assert.equal(r3.collectedPrior?.succeeded, 1);
  assert.equal(r3.pendingLeft, 0);
});

test('same-object veto: a cached "different item" verdict drops the comp; unjudged comps are queued', () => {
  const dir = tmp(); const f = path.join(dir, 'c.json.gz');
  setEnv({ RAY_EXTRACT_CACHE: f, RAY_EXTRACT_APPLY: '1' });
  const target = lot('1983 Topps #482 Tony Gwynn Rookie Card - PSA MINT 9', { status: 'upcoming' });
  const good = lot('1983 Topps #482 Tony Gwynn RC - PSA MINT 9', { saleDate: '2026-07-01' });
  const bad = lot('1983 Topps #482 Tony Gwynn Rookie Card (Reprint) - PSA MINT 9', { saleDate: '2026-07-02' });
  const unk = lot('1983 Topps #482 Tony Gwynn - PSA 9', { saleDate: '2026-06-01' });
  const c = new ExtractCache();
  const ht = hashText(target.title, '');
  c.putPair({ k: 'p', ha: ht, hb: hashText(good.title, ''), v: SAME_PROMPT_VERSION, m: 'm', same: true, reason: 'same card' });
  c.putPair({ k: 'p', ha: hashText(bad.title, ''), hb: ht, v: SAME_PROMPT_VERSION, m: 'm', same: false, reason: 'reprint' });
  c.save(f);
  resetExtractCache();
  const kept = sameObjectFilter(target, [good, bad, unk]);
  assert.deepEqual(kept.map(x => x.id), [good.id, unk.id]);
  assert.equal(extractCache().q.size, 1, 'the one unjudged comp is queued for the next run');
  assert.equal(Array.from(extractCache().q.values())[0].b, unk.id);
  // evalOnly passes queue:false — nothing queued
  resetExtractCache();
  sameObjectFilter(target, [good, bad, unk], { queue: false });
  assert.equal(extractCache().q.size, 0);
});
