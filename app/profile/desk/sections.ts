/**
 * THE SECTION REGISTRY (THE DESK v3, Oct 11 2026) — the desk, top to bottom,
 * as ONE ordered list. The page maps over it to mount every section and
 * builds the rail from each section's `meta(desk)`; the `g`-chords read each
 * section's `key`. Adding a section to the desk = adding one entry here.
 *
 *   id        the hash anchor (#week, #budget …) and the rail's data-id
 *   label     the rail pill's default text (meta may override)
 *   key       the letter after `g` that jumps to it (documented in the
 *             rail's (?) — keep this list and that help in step)
 *   group     the rail's grouping: now · picks · desk (a hairline parts them)
 *   mark      the section's glyph (app/components/marks)
 *   Component the section (SectionProps in) — null = the slot is reserved
 *             and nothing mounts; the rail skips it until a section registers
 *   meta      the rail pill for this desk, or null for no pill (the section
 *             may still mount — Account has no pill but `g a` lands on it)
 *   when      the mount gate (default: always); a section that returns null
 *             itself needs none
 *
 * Phase 1 mounts the rooms the desk already had; Phase 2 fills the reserved
 * slots (#week, #budget, #portfolio, #names, #edge) by setting `Component`
 * and `meta` to the section's default export and named `meta`.
 */
import type React from 'react';
import type { DeskData, SectionMeta, SectionProps } from './types';
import type { DeskInternals } from './provider';
import type { RailItem } from '../rail';
import { WatchMark, RankMark, MoversMark, SignalMark, RecordMark, CollectionMark, TapeMark, AwayMark, HorizonMark, GapMark, IndexLabMark, SalesMark, CalibrationMark } from '../../components/marks';
import { Today, todayMeta, Market, marketMeta, Signals, signalsMeta, SignIn, signinWhen } from './rooms/adapters';
import WatchingRoom, { meta as watchingMeta } from './rooms/watching';
import PicksGroup, { meta as picksMeta } from './rooms/picks';
import RecordRoom, { meta as recordMeta, when as recordWhen } from './rooms/record';
import CollectionRoom, { meta as collectionMeta, when as collectionWhen } from './rooms/collection';
import HistoryRoom, { meta as historyMeta, when as historyWhen } from './rooms/history';
import AccountStrip, { meta as accountMeta } from './rooms/account';
import Becomes, { meta as becomesMeta, when as becomesWhen } from './rooms/becomes';
// Phase 2 — the five sections, each a default export (SectionProps) + meta(desk)
import WeekSection, { meta as weekMeta } from '../week';
import BudgetDesk, { meta as budgetMeta } from '../budget';
import Portfolio, { meta as portfolioMeta } from '../portfolio';
import NamesSection, { meta as namesMeta } from '../names';
import EdgeSection, { meta as edgeMeta } from '../edge';

export type SectionGroup = 'now' | 'picks' | 'desk';
export type MarkComponent = React.ComponentType<{ size?: number; className?: string }>;

export interface DeskSection {
  id: string;
  label: string;
  key: string;
  group: SectionGroup;
  mark?: MarkComponent;
  Component: React.ComponentType<SectionProps> | null;
  meta: (desk: DeskData, i: DeskInternals) => SectionMeta | null;
  when?: (desk: DeskData, i: DeskInternals) => boolean;
}

const noPill = (): SectionMeta | null => null;
/** a reserved Phase-2 slot: nothing mounts, no pill, the key is spoken for */
/** a reserved slot for a section still to come: nothing mounts, no pill, the key is spoken for */
export const slot = (id: string, label: string, key: string, group: SectionGroup, mark: MarkComponent): DeskSection =>
  ({ id, label, key, group, mark, Component: null, meta: noPill });

export const SECTIONS: readonly DeskSection[] = [
  { id: 'today', label: 'Today', key: 't', group: 'now', mark: AwayMark, Component: Today, meta: todayMeta },
  // the hammer timeline: watches, picks and the sales of your names, day by day
  { id: 'week', label: 'Your week', key: 'd', group: 'now', mark: HorizonMark, Component: WeekSection, meta: weekMeta },
  { id: 'watching', label: 'Watching', key: 'w', group: 'now', mark: WatchMark, Component: WatchingRoom, meta: watchingMeta,
    when: (_d, i) => i.deskView && i.upcoming.length > 0 },
  // the picks group: Lots you may like → For your collection → How your picks did (one pill)
  { id: 'for-you', label: 'For you', key: 'f', group: 'picks', mark: RankMark, Component: PicksGroup, meta: picksMeta },
  // signed out: the slim sign-in line sits right after the picks — after value, never before it
  { id: 'signin', label: 'Sign in', key: '', group: 'picks', Component: SignIn, meta: noPill, when: signinWhen },
  { id: 'budget', label: 'Budget', key: 'b', group: 'picks', mark: GapMark, Component: BudgetDesk, meta: budgetMeta },
  { id: 'portfolio', label: 'Portfolio', key: 'p', group: 'picks', mark: IndexLabMark, Component: Portfolio, meta: portfolioMeta },
  { id: 'market', label: 'Market', key: 'm', group: 'picks', mark: MoversMark, Component: Market, meta: marketMeta },
  { id: 'names', label: 'Names', key: 'n', group: 'picks', mark: SalesMark, Component: NamesSection, meta: namesMeta },
  { id: 'signals', label: 'Signals', key: 's', group: 'picks', mark: SignalMark, Component: Signals, meta: signalsMeta },
  { id: 'record', label: 'Record', key: 'r', group: 'desk', mark: RecordMark, Component: RecordRoom, meta: recordMeta, when: recordWhen },
  { id: 'edge', label: 'Edge', key: 'e', group: 'desk', mark: CalibrationMark, Component: EdgeSection, meta: edgeMeta },
  { id: 'collection', label: 'Collection', key: 'c', group: 'desk', mark: CollectionMark, Component: CollectionRoom, meta: collectionMeta, when: collectionWhen },
  { id: 'history', label: 'History', key: 'h', group: 'desk', mark: TapeMark, Component: HistoryRoom, meta: historyMeta, when: historyWhen },
  { id: 'becomes', label: 'What else this page becomes', key: '', group: 'desk', Component: Becomes, meta: becomesMeta, when: becomesWhen },
  { id: 'account', label: 'Account', key: 'a', group: 'desk', Component: AccountStrip, meta: accountMeta },
];

/** the sections that mount on this desk, in order. ONE rule bends the
 *  order: with nothing live on the desk (no watch on a hammer clock) the
 *  picks lead — as they always have — and Your week, which then holds only
 *  picks and the sales of the reader's names, follows the picks group
 *  (right after the sign-in line when signed out) instead of sitting
 *  between Today and the first pick. */
export function mountedSections(desk: DeskData, i: DeskInternals): DeskSection[] {
  const out = SECTIONS.filter(s => !!s.Component && (!s.when || s.when(desk, i)));
  if (i.watchFirst) return out;
  const w = out.findIndex(s => s.id === 'week');
  if (w < 0) return out;
  const [week] = out.splice(w, 1);
  const anchor = out.findIndex(s => s.id === 'signin');
  const after = anchor >= 0 ? anchor : out.findIndex(s => s.id === 'for-you');
  out.splice(after + 1, 0, week);
  return out;
}

/** the rail, in section order: one pill per mounted section whose meta says so */
export function railItemsOf(desk: DeskData, i: DeskInternals): RailItem[] {
  const out: RailItem[] = [];
  for (const s of mountedSections(desk, i)) {
    const m = s.meta(desk, i);
    if (!m) continue;
    out.push({
      id: m.id, label: m.label, group: s.group,
      count: m.count ?? undefined, tone: m.tone, dot: m.dot, quiet: m.quiet,
      hint: s.key ? `g then ${s.key}` : undefined,
    });
  }
  return out;
}

/** the `g`-chord table: key → section id (reserved slots included, so a key
 *  is never reassigned when its section lands) */
export function sectionByKey(key: string): DeskSection | undefined {
  return SECTIONS.find(s => s.key && s.key === key);
}

/** the keys legend the rail's (?) prints: mounted sections first, then the
 *  reserved ones (so a reader learns the key before the room exists) */
export function keysLegend(mounted: readonly DeskSection[]): { key: string; label: string; live: boolean }[] {
  const live = new Set(mounted.map(s => s.id));
  return SECTIONS.filter(s => s.key).map(s => ({ key: s.key, label: s.label, live: live.has(s.id) }));
}
