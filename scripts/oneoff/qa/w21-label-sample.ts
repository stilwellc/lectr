/**
 * w21-label-sample.ts — a stratified label-audit sample of the LIVE book
 * (public/data/ray/upcoming.json), ≥60 lots per market, round-robin across
 * houses, with every printed label computed by the app's own readers:
 *   category (catLabelOf) · sub (subLabelOf) · maker (makerLineOf) ·
 *   object kind (formKey / objectClass + kindFits) · display title
 *   (craftTitle for cards, splitTitle().short for the lot page h1).
 * Markets the live book can't fill to 60 (design, watches, jewelry) are topped
 * up from the published corpus shards (lots-*.json), recent rows first.
 *
 *   npx tsx scripts/oneoff/qa/w21-label-sample.ts <seed> <outDir> [excludeIdsFile]
 *
 * RELABEL=1 re-derives formKey / objectClass / subCat / drill / category with
 * the CURRENT rules (normalizeCorpus over every served + published row) before
 * sampling — the "after" read of what the nightly will ship.
 */
import * as fs from 'fs';
import * as path from 'path';
import { marketOf } from '../../../app/constants';
import { catLabelOf, subLabelOf } from '../../../app/lib/taxonomy';
import { makerLineOf } from '../../../app/lib/lot-labels';
import { kindFits } from '../../../app/lib/object-kind';
import { craftTitle, splitTitle } from '../../../app/utils';
import { normalizeCorpus } from '../../lib/corpus-normalize';

const [seed = 'a', outDir = '/tmp/w21', exclFile] = process.argv.slice(2);
const excl = new Set<string>(exclFile && fs.existsSync(exclFile) ? JSON.parse(fs.readFileSync(exclFile, 'utf8')) : []);
const D = path.join(process.cwd(), 'public/data/ray');
let live: any[] = JSON.parse(fs.readFileSync(path.join(D, 'upcoming.json'), 'utf8')).lots;
const liveIds = new Set(live.map(l => l.id));
let corpus: any[] = [];
for (let i = 0; i < 15; i++) {
  const p = path.join(D, `lots-${i}.json`);
  if (fs.existsSync(p)) corpus = corpus.concat(JSON.parse(fs.readFileSync(p, 'utf8')));
}
corpus = corpus.filter(r => !liveIds.has(r.id));
if (process.env.RELABEL) {
  // the nightly's own pass (scripts/build-market → normalizeCorpus) over the
  // whole served book + published corpus, so learned maps see every row
  const all = [...live, ...corpus];
  // the served card / athlete stamps come from build-market's athlete pass,
  // which the trimmed published rows can't replay — keep them as served
  const players = new Map(live.map(l => [l.id, [l.playerName, l.playerSlug]]));
  const log = console.log; console.log = () => {};
  try { normalizeCorpus(all, { now: new Date() }); } finally { console.log = log; }
  for (const l of all) { const p = players.get(l.id); if (p && p[0]) { l.playerName = p[0]; l.playerSlug = p[1]; } }
  const keep = new Set(all.map(r => r.id));
  live.splice(0, live.length, ...live.filter(r => keep.has(r.id)));
  corpus = corpus.filter(r => keep.has(r.id));
}
const recent = (r: any) => (r.saleDate || '') >= '2025-01-01';

const h = (s: string) => { let x = 2166136261; for (const c of seed + s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
const JEWEL = /\b(?:necklaces?|collier|sautoir|brooch(?:es)?|broche|earrings?|ear ?clips|boucles d'oreilles|pendentif|bangles?|bague|tiara|cufflinks|parure|choker|jewel(?:le)?ry|bijou|(?:diamond|gold|platinum|signet|cocktail|engagement|eternity|emerald|ruby|sapphire) rings?|rings? set with)\b/i;
const WATCHY = /watch|montre|chronograph|\bclock|pendulette/i;
const isJewelish = (l: any) => !WATCHY.test(l.title || '') && (l.objectClass === 'jewelry' || l.formKey === 'jewelry' || JEWEL.test(l.title || ''));

function strat(pool: any[], n: number): any[] {
  const by = new Map<string, any[]>();
  for (const l of pool.filter(l => !excl.has(l.id)).sort((a, b) => h(a.id) - h(b.id))) {
    const k = l.auctionHouse || '?';
    (by.get(k) ?? by.set(k, []).get(k)!).push(l);
  }
  const out: any[] = [];
  const qs = [...by.values()];
  while (out.length < n && qs.some(q => q.length)) for (const q of qs) { if (q.length && out.length < n) out.push(q.shift()); }
  return out;
}

const MARKETS = ['art', 'design', 'watches', 'jewelry', 'sports', 'tcg', 'science', 'culture'];
const N = 64;
const picks: Record<string, any[]> = {};
for (const m of MARKETS) {
  // jewelry is no lectr market: it rides the watch houses (Cartier), design
  // (silver, Bruun) and art (Calder) books, plus stage / screen pieces in culture
  const JM = ['watches', 'art', 'design', 'culture'];
  const inM = (l: any) => m === 'jewelry' ? isJewelish(l) && JM.includes(marketOf(l.artist))
    : marketOf(l.artist) === m && !(m === 'watches' && isJewelish(l) && !/watch|montre/i.test(l.title || ''));
  const lv = strat(live.filter(inM), N).map(l => ({ ...l, _src: 'live' }));
  // the corpus top-up for jewelry stays with the jewelers' books (culture's
  // jewel words are mostly a photo's caption, "wearing a diamond ring")
  const inFill = (l: any) => inM(l) && (m === 'jewelry' ? marketOf(l.artist) !== 'culture' : recent(l));
  const fill = lv.length < N ? strat(corpus.filter(inFill), N - lv.length).map(l => ({ ...l, _src: 'corpus' })) : [];
  picks[m] = [...lv, ...fill];
}
fs.mkdirSync(outDir, { recursive: true });
const ids: string[] = [];
for (const m of MARKETS) {
  const rows = picks[m].map(l => {
    ids.push(l.id);
    const mk = makerLineOf(l).name;
    return {
      id: l.id, src: l._src, house: l.auctionHouse, title: String(l.title || '').slice(0, 400),
      medium: l.medium ? String(l.medium).slice(0, 160) : undefined, sale: l.saleName || undefined,
      L_category: catLabelOf(l), L_sub: subLabelOf(l), L_maker: mk || '(blank)',
      L_kind: `${l.formKey || '-'}${l.objectClass ? `/${l.objectClass}` : ''}${kindFits(l) ? '' : ' [kindFits=false]'}`,
      L_cardTitle: craftTitle(l.title || '', l.auctionHouse), L_h1: splitTitle(l.title || '', l.auctionHouse).short,
    };
  });
  fs.writeFileSync(path.join(outDir, `${m}.json`), JSON.stringify(rows, null, 1));
  const houses: Record<string, number> = {};
  for (const r of rows) houses[r.house] = (houses[r.house] || 0) + 1;
  console.log(m, rows.length, `live=${rows.filter(r => r.src === 'live').length}`, JSON.stringify(houses));
}
fs.writeFileSync(path.join(outDir, 'ids.json'), JSON.stringify(ids));
