/* game-used-fix3.ts — final extractor: hyphen-aware stops + date/event prefix skip.
   Measures: recovery coverage both sides, purity, live-book + hindsight bands
   under sportsForm vs objectType gate, zero-history cap. */
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
  'buffalo cincinnati baltimore pittsburgh tennessee jacksonville kansas las vegas chargers broncos raiders chiefs colts texans titans jaguars browns bengals steelers ravens patriots jets bills dolphins cowboys giants eagles commanders redskins bears lions packers vikings falcons panthers saints buccaneers cardinals rams seahawks 49ers niners ' +
  'yankees mets red sox white cubs dodgers padres athletics mariners angels astros rangers royals twins tigers guardians indians orioles rays blue jays braves marlins nationals expos phillies pirates reds brewers diamondbacks rockies ' +
  'bruins canadiens maple leafs senators sabres wings blackhawks blues wild avalanche stars predators flames oilers canucks kraken sharks ducks knights coyotes lightning hurricanes capitals flyers penguins devils islanders ' +
  'seattle supersonics sonics new jersey st louis tampa bay green anaheim colorado columbus carolina nashville edmonton calgary vancouver winnipeg montreal ottawa quebec florida arizona texas california oakland usa team ' +
  'real madrid barcelona manchester united city liverpool chelsea arsenal tottenham juventus milan inter bayern munich paris saint-germain psg ajax').split(/\s+/));
const STOP_WORDS = new Set('game match team worn used issued signed autographed auto inscribed rookie debut career final finals championship world series super bowl season professional model style era circa nba nfl mlb nhl wnba mls kia emirates cup playoffs playoff conference photo practice warm warmup training jersey shorts pants sneakers shoes cleats cleat boot jacket helmet cap hat glove mitt bat ball puck ring belt trophy award medal home road away alternate icon association statement classic edition the a an and with vs at of for from includes long short sleeve sleeved left right'.split(/\s+/));
const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?$/i;

function recoverPlayerSlug(title: string): string | null {
  let s = cleanGoldinTitle(title || '');
  s = s.replace(/[‘’'“”"|].*$/s, ' ').trim();
  // drop leading " - "-delimited prefix segments that are dates/events (contain
  // digits or stop words like Finals/Game) — the name never contains a digit
  const segs = s.split(/\s+-\s+/);
  let si = 0;
  while (si < segs.length - 1 && (/\d/.test(segs[si]) || /\b(finals?|game|round|series|conference)\b/i.test(segs[si]))) si++;
  s = segs.slice(si).join(' ');
  const toks = s.split(/\s+/).filter(Boolean);
  // skip leading date-ish tokens: months, bare numbers/years, "17," etc.
  let i = 0;
  while (i < toks.length && (MONTHS.test(toks[i]) || /^['’]?\d/.test(toks[i]))) i++;
  const kept: string[] = [];
  for (; i < toks.length; i++) {
    const lw = toks[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9'’.\-]/g, '').replace(/[.,]+$/, '');
    if (!lw || /\d/.test(lw)) break;
    const head = lw.split('-')[0].replace(/[.'’]/g, '');
    const whole = lw.replace(/[.'’]/g, '');
    const isStop = STOP_WORDS.has(head) || STOP_WORDS.has(whole);
    const isTeam = TEAM_WORDS.has(whole) || TEAM_WORDS.has(head);
    // magic-johnson class: team NICKNAME as first token + plain surname next
    if (isTeam) {
      const nx = (toks[i + 1] || '').toLowerCase().replace(/[^a-z]/g, '');
      const nxPlain = nx && !TEAM_WORDS.has(nx) && !STOP_WORDS.has(nx) && !/\d/.test(toks[i + 1] || '');
      if (!(kept.length === 0 && nxPlain)) break;
    } else if (isStop) break;
    kept.push(lw.replace(/[.,]+$/, ''));
    if (kept.length === 3) break;
  }
  if (kept.length < 2) return null;
  return playerSlugOf(kept.join(' '));
}

// spot checks
const checks = [
  'Oct. 17, 2010 Tom Brady Game-Used, Photo-Matched, Signed, Inscribed New England Patriots Jersey',
  'Eastern Conference Finals Game 2 - Dennis Rodman Game-Used, Photo-Matched, Signed Detroit Pistons Jersey',
  'Kevin Durant Game-Used, Photo-Matched Golden State Warriors Icon Edition Jersey',
  'Dec. 6, 15, 2024 - Brandin Podziemski Game-Used Golden State Warriors Icon Edition Jersey',
  '1994 Dan Marino Miami Dolphins Signed Game-Issued Left Cleat - MEARS Authentic',
  '24 Kylian Mbappe Paris Saint-Germain Training Set - Includes Long-Sleeved Top',
  'magic johnson los angeles lakers 1983-85 era game worn & signed sneakers',
  'kevin durant seattle supersonics 2007 nba rookie photo shoot worn jersey',
  'lebron james miami heat 2013 nba finals game worn jersey',
  'toni kukoč chicago bulls 1996-1997 game issued warmup pants',
  'Manchester City vs. Inter Milan FC - Champions League Final Match-Used Soccer Ball',
];
for (const c of checks) console.log(' •', recoverPlayerSlug(c), '<=', c.slice(0, 70));

const gu = all.filter(l => l.artist === 'game-used' && l.category === 'object');
const guSold = gu.filter(l => l.status === 'sold' && l.priceUsd);
const guUp = upcoming.filter(l => l.artist === 'game-used');

const idCache = new Map<string, string | null>();
function idOf(l: AuctionLot): string | null {
  let v = idCache.get(l.id);
  if (v === undefined) {
    v = recoverPlayerSlug(l.title || '') || (l as any).playerSlug || null;
    idCache.set(l.id, v);
  }
  return v;
}

let soldCov = 0, upCov = 0;
for (const l of guSold) if (idOf(l)) soldCov++;
for (const l of guUp) if (idOf(l)) upCov++;
console.log('\nidentity coverage — sold:', soldCov, '/', guSold.length, `(${(100 * soldCov / guSold.length).toFixed(1)}%)`,
  '| upcoming:', upCov, '/', guUp.length, `(${(100 * upCov / guUp.length).toFixed(1)}%)`);

// purity vs stamped (where stamped is clean 2-word)
let both = 0, agree = 0;
for (const l of [...guSold, ...guUp]) {
  const st = (l as any).playerSlug, rec = recoverPlayerSlug(l.title || '');
  if (st && rec) { both++; if (st === rec || st.startsWith(rec + '-') || rec.startsWith(st + '-')) agree++; }
}
console.log('agreement recovered~stamped (prefix-tolerant):', agree, '/', both, `(${(100 * agree / both).toFixed(1)}%)`);

// zero-history cap on live book
let zeroHist = 0, hasId = 0;
const soldIdSet = new Map<string, number>();
for (const l of guSold) { const id = idOf(l); if (id) soldIdSet.set(id, (soldIdSet.get(id) || 0) + 1); }
for (const lot of guUp) { const id = idOf(lot); if (!id) continue; hasId++; if (!soldIdSet.has(id)) zeroHist++; }
console.log('upcoming w/ identity:', hasId, '| zero sold history:', zeroHist, '| some history:', hasId - zeroHist);

function median(s: number[]) { const m = Math.floor(s.length / 2); return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]; }
function simBand(lot: AuctionLot, itemGate: 'sportsForm' | 'objectType', excludeSelf: boolean) {
  const id = idOf(lot);
  if (!id) return { band: null as null | { med: number; n: number; spread: number }, why: 'noId' };
  const key = itemGate === 'sportsForm' ? (sportsForm(lot) ?? classifyForm(lot)) : (lot.objectType ?? 'other');
  const raw = guSold.filter(l => (!excludeSelf || l.id !== lot.id) && idOf(l) === id &&
    (itemGate === 'sportsForm' ? (sportsForm(l) ?? classifyForm(l)) === key : (l.objectType ?? 'other') === key));
  if (raw.length < 3) return { band: null, why: 'thin' };
  let pool = raw;
  if (pool.length > 24) pool = pool.map(l => [new Date(l.saleDate).getTime(), l] as const).sort((a, b) => b[0] - a[0]).slice(0, 24).map(x => x[1]);
  const prices = pool.map(l => l.priceUsd!).sort((a, b) => a - b);
  const med = median(prices);
  const q1 = prices[Math.floor(prices.length * 0.25)], q3 = prices[Math.floor(prices.length * 0.75)];
  if (med > 0 && (q3 - q1) / med > 2.5) return { band: null, why: 'disp' };
  return { band: { med, n: pool.length, spread: med > 0 ? (q3 - q1) / med : 99 }, why: 'ok' };
}

for (const gate of ['sportsForm', 'objectType'] as const) {
  let bands = 0, noId = 0, thin = 0, disp = 0;
  for (const lot of guUp) {
    const r = simBand(lot, gate, false);
    if (r.band) bands++; else if (r.why === 'noId') noId++; else if (r.why === 'thin') thin++; else disp++;
  }
  console.log(`\nLIVE BOOK (${gate}): bands ${bands}/${guUp.length} (${(100 * bands / guUp.length).toFixed(1)}%) | noId ${noId} | thin ${thin} | disp ${disp}`);
}

const sample = guSold.filter((_, i) => i % Math.max(1, Math.floor(guSold.length / 300)) === 0).slice(0, 300);
for (const gate of ['sportsForm', 'objectType'] as const) {
  let bands = 0, noId = 0, thin = 0, disp = 0; const errs: number[] = []; const byConf: Record<string, { n: number; errs: number[] }> = {};
  for (const lot of sample) {
    const r = simBand(lot, gate, true);
    if (r.band) {
      bands++; const e = Math.abs((lot.priceUsd! - r.band.med) / r.band.med); errs.push(e);
      const conf = r.band.n >= 8 && r.band.spread <= 1.0 ? 'high' : r.band.n >= 4 ? 'medium' : 'low';
      (byConf[conf] ??= { n: 0, errs: [] }).n++; byConf[conf].errs.push(e);
    } else if (r.why === 'noId') noId++; else if (r.why === 'thin') thin++; else disp++;
  }
  errs.sort((a, b) => a - b);
  console.log(`\nHINDSIGHT (${gate}): bands ${bands}/${sample.length} (${(100 * bands / sample.length).toFixed(1)}%) | noId ${noId} | thin ${thin} | disp ${disp}`);
  if (errs.length) console.log('  abs err median:', errs[Math.floor(errs.length / 2)].toFixed(3), 'p75:', errs[Math.floor(errs.length * 0.75)].toFixed(3));
  for (const [c, v] of Object.entries(byConf)) {
    v.errs.sort((a, b) => a - b);
    console.log(`  conf=${c}: n=${v.n} err.med=${v.errs[Math.floor(v.errs.length / 2)].toFixed(3)}`);
  }
}
