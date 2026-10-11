/**
 * The SEO wave (Oct 11 2026): every route's head block (seoMeta), the query
 * shells' no-canonical rule, the static entity aliases' slugs and facts, and
 * the JSON-LD shapes Google validates.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seoMeta, slugify, breadcrumbLd, datasetLd, blogPostingLd, ldJson, abs } from '../seo';
import { assignSlugs, entityFacts, entityDescription, type StaticEntity } from '../seo-entities';
import { entityDocTitle } from '../entity/display';
import type { EntitySummary } from '../entity/model';

test('seoMeta: one route, the full share block — canonical, og:url, card, twitter', () => {
  const m = seoMeta({ title: 'Art', description: 'd', path: '/art', image: '/og/m/art.png' }) as any;
  assert.equal(m.title, 'Art');
  assert.equal(m.alternates.canonical, '/art');
  assert.equal(m.openGraph.url, '/art');
  assert.equal(m.openGraph.title, 'Art — lectr');
  assert.match(m.openGraph.images[0].url, /^\/og\/m\/art\.png/);
  assert.equal(m.openGraph.images[0].width, 1200);
  assert.equal(m.twitter.card, 'summary_large_image');
  assert.equal(m.twitter.title, 'Art — lectr');
});

test('seoMeta: a query shell names no canonical and no og:url', () => {
  const m = seoMeta({ title: 'Player dossier', description: 'd', path: '/player', canonical: false }) as any;
  assert.equal(m.alternates, undefined);
  assert.equal(m.openGraph.url, undefined);
});

test('seoMeta: absolute titles skip the template; a house photo claims no card size', () => {
  const m = seoMeta({ title: 'KAWS — maker dossier · lectr', absolute: true, description: 'd', path: '/makers/kaws', image: 'https://img.example/x.jpg' }) as any;
  assert.deepEqual(m.title, { absolute: 'KAWS — maker dossier · lectr' });
  assert.equal(m.openGraph.title, 'KAWS — maker dossier · lectr');
  assert.equal(m.openGraph.images[0].url, 'https://img.example/x.jpg');
  assert.equal(m.openGraph.images[0].width, undefined);
});

test('slugify: accents, ampersands, punctuation', () => {
  assert.equal(slugify('Pokémon'), 'pokemon');
  assert.equal(slugify('Apollo 11'), 'apollo-11');
  assert.equal(slugify('Sports Cards · Lots & Sets'), 'sports-cards-lots-and-sets');
  assert.equal(slugify("Shaquille O'Neal"), 'shaquille-oneal');
});

const ent = (o: Partial<EntitySummary> & { id: string; label: string }): EntitySummary => ({
  kind: 'subject', market: 'tcg', subKind: null, discipline: null, face: null, page: `/entity?id=${encodeURIComponent(o.id)}`,
  sold: 100, sold12m: 10, med12m: null, med12mN: null, medScope: null, record: null, spark: null, sparkN: null,
  yoy: null, verified: null, thin: false, caps: { compare: false, follow: null, dossier: true }, ...o,
} as EntitySummary);

test('assignSlugs: a shared name is qualified on BOTH sides (order-independent); bare numbers qualified', () => {
  const rows = [
    ent({ id: 'sj:culture|p:michael-jordan', label: 'Michael Jordan', market: 'culture', subKind: 'person' }),
    ent({ id: 'sj:sports|t:michael-jordan', label: 'Michael Jordan', market: 'sports', subKind: 'team' }),
    ent({ id: 'st:tcg|s:151', label: '151', kind: 'set', subKind: 'set' }),
    ent({ id: 'sj:tcg|k:charizard', label: 'Charizard', subKind: 'pokemon' }),
  ];
  const q = (e: EntitySummary) => `${e.market} ${e.subKind || e.kind}`;
  const a = assignSlugs(rows, e => slugify(e.label), q);
  const b = assignSlugs([...rows].reverse(), e => slugify(e.label), q);
  assert.equal(a.get('sj:tcg|k:charizard'), 'charizard');
  assert.equal(a.get('sj:culture|p:michael-jordan'), 'michael-jordan-culture-person');
  assert.equal(a.get('sj:sports|t:michael-jordan'), 'michael-jordan-sports-team');
  assert.equal(a.get('st:tcg|s:151'), '151-tcg-set');
  for (const [k, v] of a) assert.equal(b.get(k), v, `stable across order: ${k}`);
  assert.equal(new Set(a.values()).size, a.size);
});

test('entity facts: the median prints with its n and lens; nothing invented when absent', () => {
  const x: StaticEntity = {
    id: 'pl:michael-jordan', kind: 'player', slug: 'michael-jordan', path: '/p/michael-jordan', query: '/player?id=michael-jordan',
    e: ent({ id: 'pl:michael-jordan', label: 'Michael Jordan', kind: 'player', market: 'sports', discipline: 'Basketball', sold: 17008, med12m: 2197, med12mN: 2098, medScope: 'Sports Cards · Singles', record: { p: 10091000, d: '2022-09-15' } }),
  };
  const f = entityFacts(x);
  assert.equal(f.kicker, 'Basketball');
  assert.equal(f.sold, '17,008 sales tracked');
  assert.equal(f.median, 'past-year median $2K (n=2,098)');
  assert.equal(f.record, 'record $10.09M (2022)');
  assert.match(entityDescription(x), /past-year median \$2K \(Sports Cards · Singles, n=2,098\)/);
  const bare = entityFacts({ ...x, e: { ...x.e, med12m: null, med12mN: null, record: null } });
  assert.equal(bare.median, null);
  assert.equal(bare.record, null);
  assert.doesNotMatch(entityDescription({ ...x, e: { ...x.e, med12m: null, med12mN: null, record: null } }), /past-year median|record \$/);
});

test('entityDocTitle: the dossier grammar the page re-asserts after hydration', () => {
  assert.equal(entityDocTitle('KAWS', 'maker'), 'KAWS — maker dossier · lectr');
  assert.equal(entityDocTitle('Michael Jordan', 'player'), 'Michael Jordan — player dossier · lectr');
  assert.equal(entityDocTitle('Charizard', 'subject'), 'Charizard — dossier · lectr');
});

test('JSON-LD: breadcrumb positions + absolute items; Dataset description floor; headline cap; < escaped', () => {
  const bc = breadcrumbLd([['lectr', '/'], ['The roster', '/makers'], ['KAWS', '/makers/kaws']]) as any;
  assert.deepEqual(bc.itemListElement.map((i: any) => i.position), [1, 2, 3]);
  assert.equal(bc.itemListElement[1].item, 'https://lectr.bid/makers');
  const ds = datasetLd({ path: '/ref/rolex/5513', name: 'Rolex 5513', description: 'short' }) as any;
  assert.ok(ds.description.length >= 50);
  const bp = blogPostingLd({ path: '/blog/x', headline: 'x'.repeat(140), description: 'd', date: '2026-07-16' }) as any;
  assert.ok(bp.headline.length <= 110);
  assert.equal(abs('/a'), 'https://lectr.bid/a');
  assert.ok(!ldJson({ name: '</script><script>alert(1)</script>' }).includes('</script>'));
});
