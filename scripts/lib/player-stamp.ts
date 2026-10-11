/**
 * PLAYER-ID KEEP RULE (Oct 11 2026, W16 identity gaps).
 *
 * build-market stamps `playerSlug`/`playerName` on every sports lot from its
 * own title read (cards: parseCard; objects: playerOf gated by the roster of
 * players the card parser reads ≥3 times, then the athlete test). Until W16
 * that stamp was an unconditional overwrite: when the build's read came up
 * empty it CLEARED the id the row already carried — normalize's
 * recoverPlayerSlug stamp, or the crawl's — so "1986-1989 John Kruk San Diego
 * Padres Game-Used Bat" (Kruk is not a ≥3-card roster player, and his name is
 * followed by a team, not use language) published with no player and fell
 * off /player/john-kruk and players.json (9 of his 14 served rows).
 *
 * The rule: a CONFIDENT id is never cleared, only replaced by a better one.
 *   1. the build's own read (non-null) wins — it is the athlete-tested reader;
 *   2. else a confident existing id is kept;
 *   3. else the build re-reads the title against the KEEP ROSTER (below) —
 *      a player the build already reads, roster-free, off his "John Kruk
 *      Signed Game-Worn …" lots is read on "1986-1989 John Kruk San Diego
 *      Padres Game-Used Bat" too;
 *   4. else no player (the garbage stamps — "important-lou-gehrig", "new-york",
 *      "mlb-all-star" — are still cleared).
 *
 * Confident = a two-plus-word slug the title prints word for word, that the
 * athlete test (app/lib/player-name athleteName) canonicalises to ITSELF (a
 * person, not a team / set / sale run, not a non-athlete public figure), and
 * that names a KEEP-ROSTER player (or one on the hand roster,
 * scripts/lib/athlete-roster).
 */
import { athleteName } from '../../app/lib/player-name';
import { playerSlugOf } from '../../app/lib/cards';
import { ATHLETES } from './athlete-roster';

export type PlayerRead = { player: string | null; playerSlug: string | null };

/** THE KEEP ROSTER — the players an id may be kept or re-read for:
 *    · the ≥3-card roster (knownPlayerSet — the gate the build's object read
 *      already uses), and
 *    · every athlete the build's object reader names WITHOUT any roster: the
 *      fixed-form reads that need none — a name directly followed by use
 *      language or the signed form + a worn object ("John Kruk Signed
 *      Game-Worn Phillies Road Jersey"), the structured NFL/MLB-Auction slot,
 *      Sotheby's lower-case NBA desk (`rosterFreeReads`: playerOf with an
 *      EMPTY known set).
 *  Deliberately NOT every build read nor every card-slot read: those mint
 *  "lake-placid", "england-international", "scotty-cameron-titleist" — keeping
 *  or re-reading against them (measured Oct 11) regained 4.7–5.6k rows, a
 *  third of them non-players. The hand roster (ATHLETES) is checked alongside
 *  in confidentPlayer. */
export function keepRoster(known: ReadonlySet<string>, rosterFreeReads: Iterable<string | null | undefined>): Set<string> {
  const out = new Set<string>(known);
  for (const s of Array.from(rosterFreeReads)) if (s && !notAPlayerSlug(s)) out.add(s);
  return out;
}

/** Runs the roster-free reads (and the hand-stamped crawl ids) still mint
 *  that are no athlete (measured Oct 11 on the keep candidates): nations and
 *  national sides ("united-states", "pele-brazil"), clubs ("buffalo-bisons",
 *  "texas-tech"), card products ("tristar-hidden-treasures"), and the two
 *  non-athletes the athlete test does not know (a putter maker, a singer). */
const NOT_A_PLAYER_SLUG_WORD = /(?:^|-)(?:united|states|america|american|brazil|england|english|scotland|britain|germany|france|italy|japan|mexico|national|olympic|olympics|bisons|stockings|tech|university|college|state|tristar|treasures|hidden|series|team|club|city|stadium|cup)(?:-|$)/;
const NOT_AN_ATHLETE = new Set(['scotty-cameron', 'elton-john']);
export function notAPlayerSlug(slug: string): boolean {
  return NOT_AN_ATHLETE.has(slug) || NOT_A_PLAYER_SLUG_WORD.test(slug);
}

/** The empty roster playerOf reads against for its roster-free reads. */
export const NO_ROSTER: ReadonlySet<string> = new Set<string>();

const fold = (s: string): string => ` ${s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.'’]/g, '').replace(/[^a-z0-9]+/g, ' ')} `;

/** The slug's words, title-cased ("john-kruk" → "John Kruk"). */
export function nameOfSlug(slug: string): string {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** The canonical athlete an existing id names on THIS title, or null when the
 *  id is not confident (see the header). */
export function confidentPlayer(slug: string | null | undefined, name: string | null | undefined, title: string | null | undefined, roster: ReadonlySet<string>): PlayerRead | null {
  if (!slug || !slug.includes('-') || notAPlayerSlug(slug)) return null;
  if (!roster.has(slug) && !ATHLETES.has(slug.replace(/-/g, ' '))) return null;
  const t = fold(String(title || ''));
  if (!slug.split('-').every(w => t.includes(` ${w} `))) return null;
  // the stored name when it is this slug's, else the slug's words
  const nm = name && playerSlugOf(name) === slug ? name : nameOfSlug(slug);
  const a = athleteName(nm, String(title || ''));
  if (!a || playerSlugOf(a) !== slug) return null;
  return { player: a, playerSlug: slug };
}

export type StampOutcome = 'read' | 'kept' | 'reread' | 'cleared' | 'none';

/**
 * Stamp one sports lot's player. `read` is the build's read of the title;
 * `reread` (lazy) re-reads it against the wider roster. Writes
 * playerSlug/playerName on `row` and returns what happened:
 *   read    the build's read (possibly replacing an existing id)
 *   kept    no read; the confident existing id stays
 *   reread  no read, no confident id; the wider-roster read names the player
 *   cleared an existing (non-confident) id was dropped
 *   none    no id before, none after
 */
export function stampPlayer(
  row: { title?: string | null; playerSlug?: string | null; playerName?: string | null },
  read: PlayerRead,
  roster: ReadonlySet<string>,
  reread?: () => PlayerRead,
): StampOutcome {
  const had = row.playerSlug || null;
  if (read.playerSlug) {
    row.playerSlug = read.playerSlug; row.playerName = read.player;
    return 'read';
  }
  const kept = confidentPlayer(had, row.playerName, row.title, roster);
  if (kept) {
    row.playerSlug = kept.playerSlug; row.playerName = kept.player;
    return 'kept';
  }
  const r2 = reread ? reread() : null;
  if (r2 && r2.playerSlug && roster.has(r2.playerSlug) && !notAPlayerSlug(r2.playerSlug)) {
    row.playerSlug = r2.playerSlug; row.playerName = r2.player;
    return 'reread';
  }
  row.playerSlug = null; row.playerName = null;
  return had ? 'cleared' : 'none';
}
