/* game-used-fix.ts — simulate the repaired game-used soldCompBand:
   1. recover playerSlug on sold rows via case-normalized + team-stopped title parse
   2. gate pools on identity + objectType (vs current sportsForm)
   3. measure band coverage on sold hindsight sample + live book, and hindsight error */
import * as fs from 'fs';
import { cleanGoldinTitle, sportsForm, classifyForm } from '../../app/lib/comps';
import { playerSlugOf } from '../../app/lib/cards';
import type { AuctionLot } from '../../app/types';

const all: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const upcoming: AuctionLot[] = JSON.parse(fs.readFileSync('public/data/ray/upcoming.json', 'utf8')).lots;

// ── proposed extractor ──────────────────────────────────────────────────────
const TEAM_WORDS = new Set(('atlanta boston brooklyn charlotte chicago cleveland dallas denver detroit golden state houston indiana los angeles memphis miami milwaukee minnesota new orleans york oklahoma city orlando philadelphia phoenix portland sacramento san antonio toronto utah washington ' +
  'hawks celtics nets hornets bulls cavaliers mavericks nuggets pistons warriors rockets pacers clippers lakers grizzlies heat bucks timberwolves pelicans knicks thunder magic 76ers suns blazers trail kings spurs raptors jazz wizards ' +
  'buffalo cincinnati baltimore pittsburgh tennessee jacksonville kansas las vegas chargers broncos raiders chiefs colts texans titans jaguars browns bengals steelers ravens patriots jets bills dolphins cowboys giants eagles commanders bears lions packers vikings falcons panthers saints buccaneers cardinals rams seahawks 49ers niners ' +
  'yankees mets red sox white cubs dodgers padres athletics mariners angels astros rangers royals twins tigers guardians orioles rays blue jays braves marlins nationals phillies pirates reds brewers diamondbacks rockies ' +
  'bruins canadiens maple leafs senators sabres red wings blackhawks blues wild avalanche stars predators jets flames oilers canucks kraken sharks ducks knights coyotes lightning hurricanes capitals flyers penguins devils islanders ' +
  'seattle supersonics sonics new jersey st louis tampa bay green anaheim colorado columbus carolina nashville edmonton calgary vancouver winnipeg montreal ottawa quebec hamilton florida arizona texas california oakland cleveland usa team').split(/\s+/));
const STOP_WORDS = new Set('game worn used issued signed match matched rookie debut career final championship world series super bowl season professional model style era circa nba nfl mlb nhl wnba mls kia emirates cup playoffs conference finals photo autographed auto practice warm up warmup jersey shorts pants sneakers shoes cleats jacket helmet cap hat glove mitt bat ball puck ring belt trophy award medal the a an and with vs at'.split(/\s+/));

function recoverPlayerSlug(title: string): string | null {
  let s = cleanGoldinTitle(title || '');
  // strip a leading 'quoted moment' ("‘rookie debut’ toronto…" appears mid-title too)
  s = s.replace(/[‘’'“”"|].*$/s, ' ').trim(); // cut at first quote/pipe — moments & suffixes
  const toks = s.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const w of toks) {
    const lw = w.toLowerCase().replace(/[^a-z0-9'’.-]/g, '');
    if (!lw || /\d/.test(lw)) break;                 // year/season token ends the name
    if (TEAM_WORDS.has(lw) || STOP_WORDS.has(lw)) break;
    kept.push(lw);
    if (kept.length === 3) break;
  }
  if (kept.length < 2) return null;
  return playerSlugOf(kept.join(' '));
}

const gu = all.filter(l => l.artist === 'game-used' && l.category === 'object');
const guSold = gu.filter(l => l.status === 'sold' && l.priceUsd);

// coverage + purity vs stamped slugs
let rec = 0, both = 0, agree = 0;
const slugCount: Record<string, number> = {};
for (const l of guSold) {
  const r = recoverPlayerSlug(l.title || '');
  if (r) { rec++; slugCount[r] = (slugCount[r] || 0) + 1; }
  const stamped = (l as any).playerSlug;
  if (r && stamped) { both++; if (r === stamped || stamped.startsWith(r) || r.startsWith(stamped)) agree++; }
}
console.log('recovered playerSlug on sold:', rec, '/', guSold.length, `(${(100 * rec / guSold.length).toFixed(1)}%)`);
console.log('agreement with stamped slug (where both):', agree, '/', both);
console.log('distinct recovered slugs:', Object.keys(slugCount).length);
console.log('top recovered:', Object.entries(slugCount).sort((a, b) => b[1] - a[1]).slice(0, 12));

// eyeball 15 random extractions
console.log('\nspot-check extractions:');
for (let i = 0; i < 15; i++) {
  const l = guSold[Math.floor(Math.random() * guSold.length)];
  console.log(' •', recoverPlayerSlug(l.title || ''), '<=', JSON.stringify((l.title || '').slice(0, 80)));
}

// ── identity function variants ──────────────────────────────────────────────
const idOf = (l: AuctionLot): string | null => (l as any).playerSlug || recoverPlayerSlug(l.title || '') || (l.entity ? l.entity.toLowerCase().trim() : null);

function median(s: number[]) { const m = Math.floor(s.length / 2); return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]; }

// simulated band under a chosen item gate
function simBand(lot: AuctionLot, itemGate: 'sportsForm' | 'objectType') {
  const id = idOf(lot);
  if (!id) return null;
  const key = itemGate === 'sportsForm' ? (sportsForm(lot) ?? classifyForm(lot)) : (lot.objectType ?? 'other');
  let pool = guSold.filter(l => l.id !== lot.id && idOf(l) === id &&
    (itemGate === 'sportsForm' ? (sportsForm(l) ?? classifyForm(l)) === key : (l.objectType ?? 'other') === key));
  if (pool.length < 3) return null;
  if (pool.length > 24) pool = pool.map(l => [new Date(l.saleDate).getTime(), l] as const).sort((a, b) => b[0] - a[0]).slice(0, 24).map(x => x[1]);
  const prices = pool.map(l => l.priceUsd!).sort((a, b) => a - b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length * 0.25)], q3 = prices[Math.floor(prices.length * 0.75)];
  if (med > 0 && (q3 - q1) / med > 2.5) return null;
  return { med, n: pool.length, spread: med > 0 ? (q3 - q1) / med : 99 };
}

// pre-index identity for speed
const idCache = new Map<string, string | null>();
const idOfC = (l: AuctionLot) => { let v = idCache.get(l.id); if (v === undefined) { v = idOf(l); idCache.set(l.id, v); } return v; };
// re-bind simBand to cached id
function simBand2(lot: AuctionLot, itemGate: 'sportsForm' | 'objectType', excludeSelf = true) {
  const id = idOfC(lot);
  if (!id) return null;
  const key = itemGate === 'sportsForm' ? (sportsForm(lot) ?? classifyForm(lot)) : (lot.objectType ?? 'other');
  let pool = guSold.filter(l => (!excludeSelf || l.id !== lot.id) && idOfC(l) === id &&
    (itemGate === 'sportsForm' ? (sportsForm(l) ?? classifyForm(l)) === key : (l.objectType ?? 'other') === key));
  if (pool.length < 3) return null;
  if (pool.length > 24) pool = pool.map(l => [new Date(l.saleDate).getTime(), l] as const).sort((a, b) => b[0] - a[0]).slice(0, 24).map(x => x[1]);
  const prices = pool.map(l => l.priceUsd!).sort((a, b) => a - b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length * 0.25)], q3 = prices[Math.floor(prices.length * 0.75)];
  if (med > 0 && (q3 - q1) / med > 2.5) return null;
  return { med, n: pool.length, spread: med > 0 ? (q3 - q1) / med : 99 };
}

// ── hindsight: 300 sampled sold anchors ─────────────────────────────────────
const sample = guSold.filter((_, i) => i % Math.max(1, Math.floor(guSold.length / 300)) === 0).slice(0, 300);
for (const gate of ['sportsForm', 'objectType'] as const) {
  let bands = 0, dispKill = 0, thin = 0, noId = 0;
  const errs: number[] = [];
  for (const lot of sample) {
    const id = idOfC(lot);
    if (!id) { noId++; continue; }
    const b = simBand2(lot, gate);
    if (b) { bands++; errs.push(Math.abs((lot.priceUsd! - b.med) / b.med)); }
    else {
      const key = gate === 'sportsForm' ? (sportsForm(lot) ?? classifyForm(lot)) : (lot.objectType ?? 'other');
      const raw = guSold.filter(l => l.id !== lot.id && idOfC(l) === id &&
        (gate === 'sportsForm' ? (sportsForm(l) ?? classifyForm(l)) === key : (l.objectType ?? 'other') === key));
      if (raw.length < 3) thin++; else dispKill++;
    }
  }
  errs.sort((a, b) => a - b);
  console.log(`\n== HINDSIGHT (${gate} gate) on ${sample.length} sold anchors ==`);
  console.log('bands:', bands, `(${(100 * bands / sample.length).toFixed(1)}%)`, '| noId:', noId, '| pool<3:', thin, '| dispersion-killed:', dispKill);
  if (errs.length) console.log('|realized−med|/med  median:', errs[Math.floor(errs.length / 2)].toFixed(3), ' p75:', errs[Math.floor(errs.length * 0.75)].toFixed(3), ' mean:', (errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(3));
}

// ── live book coverage ──────────────────────────────────────────────────────
const guUp = upcoming.filter(l => l.artist === 'game-used');
for (const gate of ['sportsForm', 'objectType'] as const) {
  let bands = 0, noId = 0, thin = 0, disp = 0;
  for (const lot of guUp) {
    const id = idOfC(lot);
    if (!id) { noId++; continue; }
    const b = simBand2(lot, gate, false);
    if (b) bands++;
    else {
      const key = gate === 'sportsForm' ? (sportsForm(lot) ?? classifyForm(lot)) : (lot.objectType ?? 'other');
      const raw = guSold.filter(l => idOfC(l) === id && (gate === 'sportsForm' ? (sportsForm(l) ?? classifyForm(l)) === key : (l.objectType ?? 'other') === key));
      if (raw.length < 3) thin++; else disp++;
    }
  }
  console.log(`\n== LIVE BOOK (${gate} gate) on ${guUp.length} upcoming game-used ==`);
  console.log('bands:', bands, `(${(100 * bands / guUp.length).toFixed(1)}%)`, '| noId:', noId, '| pool<3:', thin, '| dispersion-killed:', disp);
}

// cross-gate purity check: within identity, does objectType split sports-worn?
const wornSplit: Record<string, number> = {};
for (const l of guSold) if ((sportsForm(l)) === 'sports-worn') { const t = l.objectType ?? 'other'; wornSplit[t] = (wornSplit[t] || 0) + 1; }
console.log('\nsports-worn splits by objectType:', wornSplit);
