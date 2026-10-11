/**
 * measure-player-keep.ts — W16 (Oct 11 2026) measurement of the player-id
 * keep rule (scripts/lib/player-stamp.ts) on the full local corpus.
 *
 * Reads the corpus exactly as build-market does (readCorpus → normalizeCorpus),
 * then compares the published sports-lot playerSlug under the OLD stamp (the
 * build's read overwrites, null clears) with the NEW one (stampPlayer). Writes
 * the regained rows to data/qa/player-keep.json for spot checks.
 *
 * Run: npx tsx --max-old-space-size=12000 scripts/oneoff/qa/w16-player-keep.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCorpus } from '../../corpus-io';
import { normalizeCorpus } from '../../lib/corpus-normalize';
import { ARTISTS } from '../../../app/constants';
import { parseCard, playerOf, rosterCardPlayerOf, playerSlugOf, knownPlayerSet } from '../../../app/lib/cards';
import { athleteName } from '../../../app/lib/player-name';
import { stampPlayer, keepRoster, NO_ROSTER, type PlayerRead } from '../../lib/player-stamp';

type Row = Record<string, unknown> & { id: string; artist: string; title?: string | null; status?: string; playerSlug?: string | null; playerName?: string | null };

const SPORT_SET = new Set<string>(ARTISTS.filter(a => a.market === 'sports').map(a => a.slug));
const CARD_SLUGS = new Set(['sports-cards', 'graded-cards']);
const athleteOf = (p: { player: string | null }, title: string): PlayerRead => {
  const a = p.player ? athleteName(p.player, title) : null;
  const slug = a ? playerSlugOf(a) : null;
  return a && slug ? { player: a, playerSlug: slug } : { player: null, playerSlug: null };
};

const all = readCorpus() as Row[];
console.log(`[measure] ${all.length} rows`);
normalizeCorpus(all as never, { now: new Date() });
const names: (string | null)[] = [];
for (const l of all) if (CARD_SLUGS.has(l.artist)) names.push(parseCard(String(l.title || '')).player);
const known = knownPlayerSet(names);

// the build's read of every sports row it stamps (live cards: slot + roster read)
const reads = new Map<Row, PlayerRead>();
for (const l of all) {
  if (!SPORT_SET.has(l.artist) || l.subCat === 'tcg-other' && CARD_SLUGS.has(l.artist)) continue;
  const t = String(l.title || '');
  if (CARD_SLUGS.has(l.artist)) {
    if (l.status !== 'upcoming') {
      // a sold card's read joins the roster (§3 byPlayer) but is never stamped
      const c = athleteOf(parseCard(t), t);
      if (c.playerSlug) reads.set(l, c);
      continue;
    }
    let r = athleteOf(parseCard(t), t);
    const np = athleteOf(rosterCardPlayerOf(t, known), t);
    if (np.player) r = np;
    reads.set(l, r);
  } else reads.set(l, athleteOf(playerOf(t, l.artist, known), t));
}
const free: (string | null)[] = [];
for (const l of all) if (SPORT_SET.has(l.artist) && !CARD_SLUGS.has(l.artist)) { const t = String(l.title || ''); free.push(athleteOf(playerOf(t, l.artist, NO_ROSTER), t).playerSlug); }
const roster = keepRoster(known, free);
console.log(`[measure] roster: ${known.size} card-known (≥3) · ${roster.size} with roster-free object reads`);

const outcomes: Record<string, number> = {};
const cleared: { id: string; before: string; title: string }[] = [];
const regained: { id: string; artist: string; status?: string; title: string; slug: string; name: string | null; how: string; before: string | null }[] = [];
let oldIds = 0, newIds = 0, oldCleared = 0;
for (const [l, read] of Array.from(reads.entries())) {
  if (CARD_SLUGS.has(l.artist) && l.status !== 'upcoming') continue; // not stamped by the build
  const before = l.playerSlug || null;
  const oldSlug = read.playerSlug;
  if (before && !oldSlug) oldCleared++;
  const w = { title: l.title, playerSlug: l.playerSlug, playerName: l.playerName };
  const t = String(l.title || '');
  const how = stampPlayer(w, read, roster, CARD_SLUGS.has(l.artist) ? undefined : () => athleteOf(playerOf(t, l.artist, roster), t));
  outcomes[how] = (outcomes[how] || 0) + 1;
  if (oldSlug) oldIds++;
  if (w.playerSlug) newIds++;
  if (how === 'cleared' && cleared.length < 20000) cleared.push({ id: l.id, before: before!, title: t.slice(0, 100) });
  if (!oldSlug && w.playerSlug) regained.push({ id: l.id, artist: l.artist, status: l.status, title: t.slice(0, 110), slug: w.playerSlug, name: w.playerName || null, how, before });
}
const players = new Set(regained.map(r => r.slug));
const closed = regained.filter(r => r.status !== 'upcoming');
console.log(`[measure] stamped rows ${reads.size} · OLD ids ${oldIds} (cleared ${oldCleared} existing ids) · NEW ids ${newIds}`);
console.log(`[measure] outcomes ${JSON.stringify(outcomes)}`);
console.log(`[measure] regained ${regained.length} rows (${closed.length} closed, ${regained.length - closed.length} live) across ${players.size} players`);
const byPlayer = new Map<string, number>();
for (const r of regained) byPlayer.set(r.slug, (byPlayer.get(r.slug) || 0) + 1);
console.log('[measure] top players regained:', Array.from(byPlayer.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([s, n]) => `${s} +${n}`).join(', '));
for (const s of ['john-kruk', 'prince-fielder']) console.log(`[measure] ${s}: +${byPlayer.get(s) || 0}`, regained.filter(r => r.slug === s).map(r => r.id).join(' '));
fs.mkdirSync(path.join('data', 'qa'), { recursive: true });
fs.writeFileSync(path.join('data', 'qa', 'player-keep.json'), JSON.stringify({ outcomes, oldIds, newIds, oldCleared, regained, cleared }, null, 1));
