/**
 * W16 (Oct 11 2026) — the player-id keep rule (scripts/lib/player-stamp).
 * build-market used to CLEAR a sports lot's playerSlug whenever its own title
 * read came up empty (John Kruk: 9 of 14 served rows had no player).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampPlayer, confidentPlayer, keepRoster, notAPlayerSlug, NO_ROSTER } from '../lib/player-stamp';
import { playerOf, playerSlugOf } from '../../app/lib/cards';
import { athleteName } from '../../app/lib/player-name';

const athleteOf = (p: { player: string | null }, title: string) => {
  const a = p.player ? athleteName(p.player, title) : null;
  const slug = a ? playerSlugOf(a) : null;
  return a && slug ? { player: a, playerSlug: slug } : { player: null, playerSlug: null };
};
const NONE = { player: null, playerSlug: null };

test('the roster-free object read names Kruk off his signed game-worn jersey (the keep roster source)', () => {
  const t = 'John Kruk Signed Game-Worn 1992 Philadelphia Phillies Home Jersey - Full JSA';
  assert.equal(athleteOf(playerOf(t, 'game-used', NO_ROSTER), t).playerSlug, 'john-kruk');
});

test('a confident existing id is kept when the build read is empty', () => {
  const roster = keepRoster(new Set(), ['john-kruk']);
  const row = { title: '1986-1989 John Kruk San Diego Padres Game-Used Bat PSA/DNA', playerSlug: 'john-kruk', playerName: 'John Kruk' };
  assert.equal(stampPlayer(row, NONE, roster), 'kept');
  assert.equal(row.playerSlug, 'john-kruk');
  assert.equal(row.playerName, 'John Kruk');
});

test('the build read replaces an existing id (a better one)', () => {
  const roster = keepRoster(new Set(), ['john-kruk']);
  const row = { title: 'John Kruk Game-Worn 1993 World Series Jersey', playerSlug: 'john-kruk-game', playerName: null as string | null };
  assert.equal(stampPlayer(row, { player: 'John Kruk', playerSlug: 'john-kruk' }, roster), 'read');
  assert.equal(row.playerSlug, 'john-kruk');
});

test('no confident id → the keep-roster re-read names the player', () => {
  const roster = keepRoster(new Set(), ['john-kruk']);
  const t = '1991 John Kruk Philadelphia Phillies Game-Used Road Jersey with Phil Wood LOA';
  const row = { title: t, playerSlug: null as string | null, playerName: null as string | null };
  // the ≥3-card gate alone reads nobody here
  assert.equal(athleteOf(playerOf(t, 'game-used', new Set()), t).playerSlug, null);
  assert.equal(stampPlayer(row, NONE, roster, () => athleteOf(playerOf(t, 'game-used', roster), t)), 'reread');
  assert.equal(row.playerSlug, 'john-kruk');
});

test('garbage ids are still cleared: not titled, not a person, not on a roster, a non-player run', () => {
  const roster = keepRoster(new Set(['lou-gehrig']), ['john-kruk', 'united-states']);
  const cases: [string, string][] = [
    ['important-lou-gehrig', 'IMPORTANT LOU GEHRIG SIGNED BASEBALL'],   // parser run, not the athlete slug
    ['john-kruk', 'Darren Daulton Game-Worn Phillies Jersey'],          // not printed in this title
    ['new-york', 'New York Yankees Team Signed Baseball'],              // not on a roster
    ['united-states', '1934 UNITED STATES ALL-STAR TEAM TOUR OF JAPAN AUTOGRAPHED BASEBALL'],
    ['lake-placid', '25 Lake Placid "Miracle On Ice" Hockey Rink'],
  ];
  for (const [slug, title] of cases) {
    const row = { title, playerSlug: slug as string | null, playerName: null as string | null };
    assert.equal(stampPlayer(row, NONE, roster), 'cleared', slug);
    assert.equal(row.playerSlug, null, slug);
  }
  assert.ok(notAPlayerSlug('united-states') && notAPlayerSlug('pele-brazil') && notAPlayerSlug('texas-tech') && !notAPlayerSlug('john-kruk'));
  assert.equal(roster.has('united-states'), false, 'non-player runs never join the keep roster');
});

test('hand-roster athletes are confident without a corpus read', () => {
  assert.deepEqual(confidentPlayer('lou-gehrig', null, 'Lou Gehrig Professional Model Bat', new Set()), { player: 'Lou Gehrig', playerSlug: 'lou-gehrig' });
});

test('idempotent: re-stamping a stamped row changes nothing', () => {
  const roster = keepRoster(new Set(), ['john-kruk']);
  const row = { title: '1986-1989 John Kruk San Diego Padres Game-Used Bat PSA/DNA', playerSlug: 'john-kruk', playerName: 'John Kruk' };
  stampPlayer(row, NONE, roster);
  const once = { ...row };
  stampPlayer(row, NONE, roster);
  assert.deepEqual(row, once);
});
