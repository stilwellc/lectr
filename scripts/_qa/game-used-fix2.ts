/* game-used-fix2.ts — idOf ordering: recovered-slug-first vs stamped-first;
   thin-pool anatomy on the live book; magic-johnson class fix */
import * as fs from 'fs';
import { cleanGoldinTitle, sportsForm, classifyForm } from '../../app/lib/comps';
import { playerSlugOf } from '../../app/lib/cards';
import type { AuctionLot } from '../../app/types';

const all: AuctionLot[] = [];
for (const f of fs.readdirSync('public/data/ray')) {
  if (/^lots-\d+\.json$/.test(f)) all.push(...JSON.parse(fs.readFileSync('public/data/ray/' + f, 'utf8')));
}
const upcoming: AuctionLot[] = JSON.parse(fs.readFileSync('public/data/ray/upcoming.json', 'utf8')).lots;

const TEAM_WORDS = new Set(('atlanta boston brooklyn charlotte chicago cleveland dallas denver detroit golden state houston indiana los angeles memphis miami milwaukee minnesota new orleans york oklahoma city orlando philadelphia phoenix portland sacramento san antonio toronto utah washington ' +
  'hawks celtics nets hornets bulls cavaliers mavericks nuggets pistons warriors rockets pacers clippers lakers grizzlies heat bucks timberwolves pelicans knicks thunder magic 76ers suns blazers trail kings spurs raptors jazz wizards ' +
  'buffalo cincinnati baltimore pittsburgh tennessee jacksonville kansas las vegas chargers broncos raiders chiefs colts texans titans jaguars browns bengals steelers ravens patriots jets bills dolphins cowboys giants eagles commanders bears lions packers vikings falcons panthers saints buccaneers cardinals rams seahawks 49ers niners ' +
  'yankees mets red sox white cubs dodgers padres athletics mariners angels astros rangers royals twins tigers guardians orioles rays blue jays braves marlins nationals phillies pirates reds brewers diamondbacks rockies ' +
  'bruins canadiens maple leafs senators sabres red wings blackhawks blues wild avalanche stars predators jets flames oilers canucks kraken sharks ducks knights coyotes lightning hurricanes capitals flyers penguins devils islanders ' +
  'seattle supersonics sonics new jersey st louis tampa bay green anaheim colorado columbus carolina nashville edmonton calgary vancouver winnipeg montreal ottawa quebec hamilton florida arizona texas california oakland cleveland usa team').split(/\s+/));
const STOP_WORDS = new Set('game worn used issued signed match matched rookie debut career final championship world series super bowl season professional model style era circa nba nfl mlb nhl wnba mls kia emirates cup playoffs conference finals photo autographed auto practice warm up warmup jersey shorts pants sneakers shoes cleats jacket helmet cap hat glove mitt bat ball puck ring belt trophy award medal the a an and with vs at'.split(/\s+/));

function recoverPlayerSlug(title: string): string | null {
  let s = cleanGoldinTitle(title || '');
  s = s.replace(/[‘’'“”"|].*$/s, ' ').trim();
  const toks = s.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    // NFD-normalize BEFORE stripping so kukoč → kukoc, not kuko
    const lw = toks[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9'’.-]/g, '');
    if (!lw || /\d/.test(lw)) break;
    const isTeam = TEAM_WORDS.has(lw);
    // magic-johnson class: a team NICKNAME as the FIRST token is a name when the
    // next token is a plain surname (not team/stop/digit)
    if (isTeam && !(kept.length === 0 && toks[i + 1] &&
      !TEAM_WORDS.has(toks[i + 1].toLowerCase()) && !STOP_WORDS.has(toks[i + 1].toLowerCase()) && !/\d/.test(toks[i + 1]))) break;
    if (!isTeam && STOP_WORDS.has(lw)) break;
    if (isTeam && kept.length > 0) break;
    kept.push(lw);
    if (kept.length === 3) break;
  }
  if (kept.length < 2) return null;
  return playerSlugOf(kept.join(' '));
}

const gu = all.filter(l => l.artist === 'game-used' && l.category === 'object');
const guSold = gu.filter(l => l.status === 'sold' && l.priceUsd);
const guUp = upcoming.filter(l => l.artist === 'game-used');

console.log('magic check:', recoverPlayerSlug('magic johnson los angeles lakers 1983-85 era game worn & signed and inscribed sneakers'));
console.log('orlando check:', recoverPlayerSlug('orlando magic team signed basketball 1995'));
console.log('kukoc check:', recoverPlayerSlug('toni kukoč chicago bulls 1996-1997 game issued warmup pants'));

// recovered-FIRST identity (uniform both sides)
const idCache = new Map<string, string | null>();
function idOf(l: AuctionLot): string | null {
  let v = idCache.get(l.id);
  if (v === undefined) {
    v = recoverPlayerSlug(l.title || '') || (l as any).playerSlug || (l.entity ? l.entity.toLowerCase().trim() : null);
    idCache.set(l.id, v);
  }
  return v;
}

// upcoming identity coverage under recovered-first
let upId = 0; for (const l of guUp) if (idOf(l)) upId++;
console.log('\nupcoming identity coverage (recovered-first):', upId, '/', guUp.length);

// stamped vs recovered mismatch on upcoming (was the 12% blocker?)
let mismatch = 0, checked = 0;
for (const l of guUp) {
  const st = (l as any).playerSlug, rec = recoverPlayerSlug(l.title || '');
  if (st && rec) { checked++; if (st !== rec) mismatch++; }
}
console.log('upcoming stamped≠recovered:', mismatch, '/', checked);

function median(s: number[]) { const m = Math.floor(s.length / 2); return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]; }

function simBand(lot: AuctionLot, itemGate: 'sportsForm' | 'objectType', excludeSelf: boolean) {
  const id = idOf(lot);
  if (!id) return { band: null as null | { med: number; n: number }, why: 'noId', rawN: 0 };
  const key = itemGate === 'sportsForm' ? (sportsForm(lot) ?? classifyForm(lot)) : (lot.objectType ?? 'other');
  const raw = guSold.filter(l => (!excludeSelf || l.id !== lot.id) && idOf(l) === id &&
    (itemGate === 'sportsForm' ? (sportsForm(l) ?? classifyForm(l)) === key : (l.objectType ?? 'other') === key));
  if (raw.length < 3) return { band: null, why: 'thin', rawN: raw.length };
  let pool = raw;
  if (pool.length > 24) pool = pool.map(l => [new Date(l.saleDate).getTime(), l] as const).sort((a, b) => b[0] - a[0]).slice(0, 24).map(x => x[1]);
  const prices = pool.map(l => l.priceUsd!).sort((a, b) => a - b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length * 0.25)], q3 = prices[Math.floor(prices.length * 0.75)];
  if (med > 0 && (q3 - q1) / med > 2.5) return { band: null, why: 'disp', rawN: raw.length };
  return { band: { med, n: pool.length }, why: 'ok', rawN: raw.length };
}

for (const gate of ['sportsForm', 'objectType'] as const) {
  let bands = 0, noId = 0, thin = 0, disp = 0;
  const thinRawN: number[] = [];
  for (const lot of guUp) {
    const r = simBand(lot, gate, false);
    if (r.band) bands++; else if (r.why === 'noId') noId++; else if (r.why === 'thin') { thin++; thinRawN.push(r.rawN); } else disp++;
  }
  thinRawN.sort((a, b) => a - b);
  console.log(`\n== LIVE BOOK (${gate}, recovered-first id) on ${guUp.length} ==`);
  console.log('bands:', bands, `(${(100 * bands / guUp.length).toFixed(1)}%)`, '| noId:', noId, '| thin:', thin, '| disp:', disp);
  const d: Record<number, number> = {};
  for (const n of thinRawN) d[n] = (d[n] || 0) + 1;
  console.log('thin rawN dist:', d);
}

// hindsight again with recovered-first + diacritic fix
const sample = guSold.filter((_, i) => i % Math.max(1, Math.floor(guSold.length / 300)) === 0).slice(0, 300);
for (const gate of ['sportsForm', 'objectType'] as const) {
  let bands = 0; const errs: number[] = [];
  let noId = 0, thin = 0, disp = 0;
  for (const lot of sample) {
    const r = simBand(lot, gate, true);
    if (r.band) { bands++; errs.push(Math.abs((lot.priceUsd! - r.band.med) / r.band.med)); }
    else if (r.why === 'noId') noId++; else if (r.why === 'thin') thin++; else disp++;
  }
  errs.sort((a, b) => a - b);
  console.log(`\n== HINDSIGHT (${gate}, recovered-first) on ${sample.length} ==`);
  console.log('bands:', bands, `(${(100 * bands / sample.length).toFixed(1)}%)`, '| noId:', noId, '| thin:', thin, '| disp:', disp);
  if (errs.length) console.log('abs err  median:', errs[Math.floor(errs.length / 2)].toFixed(3), ' p75:', errs[Math.floor(errs.length * 0.75)].toFixed(3));
}

// how many upcoming players simply have zero sold history under ANY gate?
let zeroHist = 0;
for (const lot of guUp) {
  const id = idOf(lot);
  if (!id) continue;
  if (!guSold.some(l => idOf(l) === id)) zeroHist++;
}
console.log('\nupcoming anchors whose identity has ZERO sold rows at all:', zeroHist, '/', guUp.length);
