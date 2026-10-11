/**
 * lot-follow.ts — WHO a lot page offers to follow (Oct 11 2026): the lot's
 * named entity, the same key the recommender and the nightly matcher read
 * (app/lib/entity/key — the build-stamped `ek`, else computed):
 *
 *   pl:<slug>   the athlete                → a maker/player follow (slug)
 *   mk:<slug>   the art/design/watch maker → a maker follow (slug)
 *   sj: / st:   a named subject / set (a Pokémon, a film, a franchise, a
 *               sealed set …) → an entity follow, labelled with the subject
 *               reader's own name for it (app/lib/maker-subjects) — only when
 *               that reader names the SAME key, so the button never says one
 *               name and follows another
 *   cs: / none  no follow — a bare collection ("Sports Cards · Singles") is
 *               a category, followed from the feed's category chip instead
 */
import { ARTIST_LABEL } from '../constants';
import { entityKeyOf } from './entity/key';
import { lotSubjectOf } from './maker-subjects';
import { makerLineOf } from './lot-labels';
import { publicFigureCanon } from './player-name';
import { makerFollow, entityFollow, type Follow } from './follows';

type FollowLot = Parameters<typeof entityKeyOf>[0] & Parameters<typeof makerLineOf>[0] & Parameters<typeof lotSubjectOf>[0] & {
  ek?: string | null; playerSlug?: string | null; playerName?: string | null;
};

export function lotFollowOf(lot: FollowLot): Follow | null {
  const ek = lot.ek !== undefined ? lot.ek : entityKeyOf(lot);
  if (!ek) return null;
  const rest = ek.slice(3);
  if (!rest) return null;
  if (ek.startsWith('pl:')) {
    const name = lot.playerSlug === rest && lot.playerName ? lot.playerName : lotSubjectOf(lot)?.name || makerLineOf(lot).name;
    return name ? makerFollow(rest, name) : null;
  }
  if (ek.startsWith('mk:')) return makerFollow(rest, ARTIST_LABEL[rest] || rest);
  if (ek.startsWith('sj:') || ek.startsWith('st:')) {
    const bar = rest.indexOf('|');
    if (bar <= 0) return null;
    const key = rest.slice(bar + 1);
    const s = lotSubjectOf(lot);
    if (!s) return null;
    // a famous person files under their canonical name (entity/key) — the
    // key is built from it, so the label follows it too
    const name = s.key === key ? s.name
      : key.startsWith('p:') && s.kind === 'person' ? publicFigureCanon(s.name, true) : null;
    return name ? entityFollow(ek, name) : null;
  }
  return null;
}
