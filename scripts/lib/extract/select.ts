/**
 * extract/select.ts — which lots are worth a model call tonight, in priority
 * order, under the hard cap. Pure (no IO, no network) — unit-tested.
 *
 * Target verticals: sports / graded cards (+ sports-object lots that look like
 * a card — normalize reroutes those into the card slugs), Pokémon, and the
 * five tracked watch makers.
 *
 * Priority (lower first), then newest sale first, then id (deterministic):
 *   0  live (upcoming) lots the regex could NOT key — tonight's abstentions
 *   1  live lots the regex keyed (variant / qualifier / agreement check)
 *   2  sold lots the regex could not key — each one grows a comp pool
 *   3  sold lots the regex keyed
 * Skipped: cache hits (same id + same text hash + same prompt version) and
 * lots already inside an uncollected batch.
 */
import { parseCard, cardKey, looksLikeCard } from '../../../app/lib/cards';
import { pokemonKey } from '../../sub-markets';
import type { AuctionLot } from '../../../app/types';
import { ExtractCache, hashText } from './cache';
import type { Candidate } from './batch';
import { EXTRACT_PROMPT_VERSION } from './config';
import { CARD_SLUGS_X, POKEMON_SLUG_X, WATCH_SLUGS_X } from './apply';

const SPORTS_OBJECT = new Set(['game-used', 'sports-memorabilia', 'memorabilia', 'autographs']);

export type TargetKind = 'card' | 'pokemon' | 'watch';
export function targetKind(l: { artist?: unknown; title?: unknown }): TargetKind | null {
  const a = String(l.artist ?? '');
  if (CARD_SLUGS_X.has(a)) return 'card';
  if (a === POKEMON_SLUG_X) return 'pokemon';
  if (WATCH_SLUGS_X.has(a)) return 'watch';
  if (SPORTS_OBJECT.has(a) && looksLikeCard(String(l.title ?? ''))) return 'card';
  return null;
}

export function regexKeyed(l: Record<string, unknown>, kind: TargetKind): boolean {
  if (kind === 'card') return cardKey(parseCard(String(l.title ?? ''))) != null;
  if (kind === 'pokemon') return pokemonKey(l as unknown as AuctionLot) != null;
  return !!(l.reference && String(l.reference).length);
}

export interface Selection { candidates: Candidate[]; eligible: number; cacheHits: number; pendingSkips: number; capped: number; byKind: Record<string, number> }

export function selectCandidates(lots: Record<string, unknown>[], cache: ExtractCache, cap: number): Selection {
  const pending = cache.pendingKeys('x');
  let eligible = 0, cacheHits = 0, pendingSkips = 0;
  const pool: { c: Candidate; pri: number; date: string; kind: TargetKind }[] = [];
  for (const l of lots) {
    const kind = targetKind(l);
    if (!kind) continue;
    const title = String(l.title ?? '');
    if (!title.trim()) continue;
    eligible++;
    const id = String(l.id);
    const description = String(l.description ?? '');
    const h = hashText(title, description);
    if (cache.getX(id, h, EXTRACT_PROMPT_VERSION)) { cacheHits++; continue; }
    if (pending.has(id)) { pendingSkips++; continue; }
    const live = l.status === 'upcoming';
    const keyed = regexKeyed(l, kind);
    const pri = (live ? 0 : 2) + (keyed ? 1 : 0);
    pool.push({ c: { id, h, text: { title, description } }, pri, date: String(l.saleDate ?? ''), kind });
  }
  pool.sort((a, b) => a.pri - b.pri || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (a.c.id < b.c.id ? -1 : 1));
  const take = pool.slice(0, cap);
  const byKind: Record<string, number> = {};
  for (const p of take) byKind[`${p.kind}:p${p.pri}`] = (byKind[`${p.kind}:p${p.pri}`] || 0) + 1;
  return { candidates: take.map(p => p.c), eligible, cacheHits, pendingSkips, capped: Math.max(0, pool.length - cap), byKind };
}
