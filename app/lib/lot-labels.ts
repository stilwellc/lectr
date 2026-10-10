/**
 * lot-labels.ts — the name a lot is filed under on a card or row (Oct 9).
 *
 * Collection lots sit under pseudo-makers ("Sports Cards", "Graded Cards",
 * "Pokémon") — 6,000+ rows on the live book all reading the same two words in
 * the maker slot. When the lot names a real subject we can read with
 * confidence, that subject takes the slot instead: the card's player (parsed
 * year·set·# identity) or the Pokémon on a numbered card. Otherwise the
 * maker label stands, unchanged.
 */
import { ARTIST_LABEL } from '../constants';
import { parseCard, cardLadderKey } from './cards';
import { taxonOf, subLabel, CAT_LABEL } from './taxonomy';
import { cardBadgesOf } from './facets';

const CARD_MAKERS = new Set(['sports-cards', 'graded-cards']);
const POKE_NAME = /#[\w-]+\s+(.+?)(?:\s+-\s|\s*$)/;
const POKE_NOISE = /\b(?:Holo|Reverse Holo|1st Edition|Shadowless|Unlimited)\b/g;
/** a person's name, 2–4 words — the parser sometimes runs on into card words ("Jackie Robinson Inaugural Bowman") */
const PERSON = /^[A-Z][\w.'’-]*(?: (?:[A-Z][\w.'’-]*|Jr\.?|Sr\.?|II|III|IV|de|van|da|del|la)){1,3}$/;
const CARD_WORD = /\b(?:Inaugural|Bowman|Topps|Fleer|Donruss|Panini|Prizm|Chrome|Refractor|Upper|Deck|Rookie|Card|Cards|Signed|Auto|Autograph|Autographs|Set|Team|Lot|Box|Pack|Base|Promo|Edition|Series|Parallel|Insert|Patch|Relic|Jersey|Gold|Silver|Black|Red|Blue|Green|Orange|Purple)\b/;

type NamedLot = { artist: string; title?: string | null; subCat?: string | null; drill?: string | null };

export interface MakerLine { name: string; href: string }

const memo = new WeakMap<object, MakerLine>();

export function makerLineOf(lot: NamedLot): MakerLine {
  const hit = memo.get(lot as object);
  if (hit) return hit;
  const fallback: MakerLine = { name: ARTIST_LABEL[lot.artist] || lot.artist, href: `/makers/${lot.artist}` };
  let out = fallback;
  const title = String(lot.title || '');
  if (title && CARD_MAKERS.has(lot.artist) && taxonOf(lot).cat === 'sports-cards') {
    const id = parseCard(title);
    // a player only off a parsed card identity — never a guessed name from a memorabilia title
    if (!id.notCard && !id.multi && id.player && id.playerSlug && cardLadderKey(id) && PERSON.test(id.player) && !CARD_WORD.test(id.player)) {
      out = { name: id.player, href: `/player?id=${encodeURIComponent(id.playerSlug)}` };
    }
  } else if (title && lot.artist === 'pokemon') {
    const m = title.match(POKE_NAME);
    const name = m?.[1].replace(POKE_NOISE, '').replace(/\s+/g, ' ').trim();
    if (name && name.split(' ').length <= 4 && /^[A-Z]/.test(name)) out = { name, href: fallback.href };
  }
  memo.set(lot as object, out);
  return out;
}

/** subs that say nothing on a card ("Singles", "Other") — the badges speak instead */
const QUIET_SUBS = new Set(['singles', 'other', 'objects', 'space-other']);

/**
 * The one label line a lot carries on cards and rows: its clean sub-category
 * (app/lib/taxonomy — the same words as the filter chips) plus up to two
 * facet badges (app/lib/facets.cardBadgesOf), e.g. "Pokémon · Vintage ·
 * PSA 10", "Space · Apollo · Signed · Flown". Quiet subs drop out; the
 * category stands in only when nothing else would print.
 */
export function labelLineOf(lot: Parameters<typeof cardBadgesOf>[0] & NamedLot): string {
  const t = taxonOf(lot);
  const parts: string[] = [];
  if (!QUIET_SUBS.has(t.sub)) parts.push(subLabel(t.cat, t.sub));
  for (const b of cardBadgesOf(lot)) if (!parts.includes(b)) parts.push(b);
  if (!parts.length) parts.push(CAT_LABEL[t.cat]);
  return parts.join(' · ');
}

/** the short table-column label: the sub, or the lead badge when the sub is quiet */
export function subColumnOf(lot: Parameters<typeof cardBadgesOf>[0] & NamedLot): string {
  const t = taxonOf(lot);
  if (!QUIET_SUBS.has(t.sub)) return subLabel(t.cat, t.sub);
  return cardBadgesOf(lot)[0] ?? CAT_LABEL[t.cat];
}
