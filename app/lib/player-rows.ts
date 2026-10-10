/**
 * player-rows.ts — how the player dossier tags and gates its sale rows (Oct 10).
 *
 * players.json files each row under its HOUSE slug (`cat` = the lot's
 * pseudo-maker), so Goldin's "sports-cards" desk tagged a signed baseball, an
 * 8x10 photo and a bat as "Cards", and the "Top object results — game-worn,
 * trophies & tickets" list was five graded cards out of six. A row's tag is
 * read here from its TITLE (cards.looksLikeCard, the conservative card
 * detector) through the live chips' taxonomy (app/lib/taxonomy), so the
 * words match the lot browser's chips right above it.
 */
import { looksLikeCard } from './cards';
import { taxonOf, subLabel, CAT_LABEL } from './taxonomy';

const CARD_DESKS = new Set(['sports-cards', 'graded-cards']);
const SIGNED_RE = /\b(?:signed|autograph(?:ed|s)?|auto)\b/i;

export interface PlayerRowTag { label: string; card: boolean }

/** the tag a player-page row prints, in the live chips' words */
/** on a card desk, the shapes looksLikeCard (built conservative for mixed
    pools) misses: a year-led set line ("07 Upper Deck Exquisite …", "2013 BBM
    …") or a numbered, numerically graded slab ("#F98 … - PSA EX 5") */
const YEAR_SET_RE = /^(?:19|20)?\d{2}(?:-\d{2,4})?\s+(?:topps|bowman|fleer|upper deck|panini|leaf|donruss|bbm|score|select|prizm|exquisite|national treasures|flawless|immaculate|stadium club|goudey|o-pee-chee)\b/i;
const SLAB_RE = /#[\w-]+.*\b(?:psa|sgc|bgs|cgc|csg)\b(?!\/dna)\s+(?:[a-z-]+\s+)*\d/i;

export function playerRowTag(title: string | null | undefined, cat: string): PlayerRowTag {
  const t = String(title || '');
  if (looksLikeCard(t) || (CARD_DESKS.has(cat) && (YEAR_SET_RE.test(t) || SLAB_RE.test(t)))) {
    const tx = taxonOf({ artist: 'sports-cards', title: t });
    return { label: `${CAT_LABEL[tx.cat]} · ${subLabel(tx.cat, tx.sub)}`, card: true };
  }
  // a card desk's non-card row: a signed object is an autograph, the rest
  // falls to the memorabilia reader (tickets, programs, equipment …)
  const artist = CARD_DESKS.has(cat) ? (SIGNED_RE.test(t) ? 'autographs' : 'memorabilia') : cat;
  const tx = taxonOf({ artist, title: t });
  return { label: tx.cat === 'sports-memorabilia' ? subLabel(tx.cat, tx.sub) : `${CAT_LABEL[tx.cat]} · ${subLabel(tx.cat, tx.sub)}`, card: tx.cat === 'sports-cards' };
}

/**
 * The latest run of CONSECUTIVE years in a yearly series — the line is drawn
 * only over it, so a gap (Mantle: 2019, then nothing until 2023) is never
 * bridged into a cliff. `dropped` = the earlier years left undrawn.
 */
export function latestContiguousRun<T extends { y: number }>(yearly: T[]): { run: T[]; dropped: T[] } {
  const ys = [...yearly].sort((a, b) => a.y - b.y);
  let start = ys.length - 1;
  while (start > 0 && ys[start - 1].y === ys[start].y - 1) start--;
  return { run: ys.slice(Math.max(start, 0)), dropped: ys.slice(0, Math.max(start, 0)) };
}
