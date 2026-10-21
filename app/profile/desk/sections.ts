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

/* ── THE TABS (Oct 20 2026) ────────────────────────────────────────────────
   The desk was ONE 24,000px column — 14 rooms stacked, a 27-screen scroll on
   desktop and 26 on a phone ("horrible and unusable"). The rooms now live in
   six tabs; the page mounts ONE tab's rooms at a time. Nothing is removed:
   every room mounts under its tab, every #anchor / g-chord still lands (the
   jump switches tab first, then scrolls), and Account rides under every tab. */
export type DeskTab = 'today' | 'watching' | 'for-you' | 'names' | 'owned' | 'record';
export interface DeskTabDef { id: DeskTab; label: string }
export const TABS: readonly DeskTabDef[] = [
  { id: 'today', label: 'Today' },
  { id: 'watching', label: 'Watching' },
  { id: 'for-you', label: 'For you' },
  { id: 'names', label: 'Names' },
  { id: 'owned', label: 'Collection' },
  { id: 'record', label: 'Record' },
];
/** a tab whose id isn't its namesake room's */
const NAMESAKE: Partial<Record<DeskTab, string>> = { owned: 'collection' };
/** a tab whose rooms read best in another order than the desk's (Record leads
 *  with your calls — the record room's figures live on other tabs too) */
export const TAB_ORDER: Partial<Record<DeskTab, readonly string[]>> = { record: ['edge', 'record'] };
/** the rooms that ride under every tab (no tab of their own) */
export const EVERY_TAB = new Set(['account', 'becomes']);
export type MarkComponent = React.ComponentType<{ size?: number; className?: string }>;

/** what a room is once it has data, and the ONE tap that starts filling it —
 *  the cold desk's section index (rooms/becomes) and the line under the rail
 *  when a deep link names a room this desk doesn't have yet both read it */
export interface SectionFill {
  /** what the room holds ("every settled watch judged vs its estimate") */
  text: string;
  /** how it fills ("it fills as your watches settle") */
  how: string;
  tap: { label: string; href: string };
}

export interface DeskSection {
  id: string;
  label: string;
  key: string;
  group: SectionGroup;
  /** the tab this room lives under (EVERY_TAB rooms: the first tab, rendered under all) */
  tab: DeskTab;
  mark?: MarkComponent;
  Component: React.ComponentType<SectionProps> | null;
  meta: (desk: DeskData, i: DeskInternals) => SectionMeta | null;
  when?: (desk: DeskData, i: DeskInternals) => boolean;
  fill?: SectionFill;
}

/* ── the mount gates for the rooms that need data (the when() pattern:
   Watching, Record, Collection and History always had one; the Phase-2
   rooms join them so a cold desk is masthead + quick start + the index +
   account, not 4,700px of empty rooms — R3#2). A room that is NOT mounted
   has no pill; its key still lists in the (?) as "not on this desk yet",
   and a deep link to it prints its fill line under the rail. ── */
/** the reader has told lectr something (a taste): saves, follows, picks */
const hasTaste = (d: DeskData, i: DeskInternals): boolean =>
  i.deskView || d.recs.length > 0 || d.closingPicks.length > 0 || d.follows.length > 0 || (d.taste?.seeds.length ?? 0) > 0;
const weekWhen = (d: DeskData, i: DeskInternals): boolean => hasTaste(d, i);
const budgetWhen = (d: DeskData, i: DeskInternals): boolean => hasTaste(d, i) || d.price.minUsd != null || d.price.maxUsd != null;
const portfolioWhen = (d: DeskData): boolean => d.collection.length > 0 || d.ownedIds.size > 0;
const namesWhen = (d: DeskData): boolean => d.follows.length > 0 || d.collection.length > 0 || d.saved.length > 0;
const edgeWhen = (d: DeskData): boolean => d.saved.length > 0;

/** the tap that fills each room — "Watch" buttons live on this page (the
 *  picks' bookmark), /value has today's below-market lots and tonight's
 *  closers, /receipts the engine's own settled record */
const WATCH_TAP = { label: 'Watch a lot from For you', href: '#for-you' };
const FILLS: Record<string, SectionFill> = {
  week: { text: 'every close of yours — watches, picks, the sales of your names — day by day', how: 'it fills as you watch lots and follow names', tap: WATCH_TAP },
  watching: { text: 'your live lots: signals and bids tracked to the hammer', how: 'bookmark any lot on lectr and it lands here', tap: WATCH_TAP },
  budget: { text: 'your watches grouped by close night against your band, and what the band buys this week', how: 'it fills as you watch lots and set a band', tap: { label: 'Today’s below-market lots', href: '/value' } },
  portfolio: { text: 'the pieces you own, re-marked over time against their makers’ sales', how: 'it fills when a settled watch is marked “I won it”', tap: WATCH_TAP },
  market: { text: 'the names you follow or own and their 12-month pulse', how: 'it fills as you follow names', tap: { label: 'Follow a name', href: '/makers' } },
  names: { text: 'the upcoming sales of every name you follow or own, and the names with nothing live', how: 'it fills as you follow names', tap: { label: 'Follow a name', href: '/makers' } },
  record: { text: 'every settled watch judged against its estimate — your eye, measured', how: 'it fills as your watches settle', tap: { label: 'Tonight’s closers', href: '/value?sort=closing' } },
  edge: { text: 'your calls graded against the hammer, by market, with the receipts', how: 'it fills as your watches settle', tap: { label: 'The engine’s own record', href: '/receipts' } },
  collection: { text: 'the pieces you own, appraised against the live market nightly', how: 'it fills when a settled watch is marked “I won it”', tap: WATCH_TAP },
  history: { text: 'the line-item receipt of every settled watch', how: 'it fills as your watches settle', tap: { label: 'The engine’s own record', href: '/receipts' } },
};

const noPill = (): SectionMeta | null => null;
/** a reserved Phase-2 slot: nothing mounts, no pill, the key is spoken for */
/** a reserved slot for a section still to come: nothing mounts, no pill, the key is spoken for */
export const slot = (id: string, label: string, key: string, group: SectionGroup, mark: MarkComponent, tab: DeskTab): DeskSection =>
  ({ id, label, key, group, tab, mark, Component: null, meta: noPill });

export const SECTIONS: readonly DeskSection[] = [
  { id: 'today', label: 'Today', key: 't', group: 'now', tab: 'today', mark: AwayMark, Component: Today, meta: todayMeta },
  // the hammer timeline: watches, picks and the sales of your names, day by day
  { id: 'week', label: 'Your week', key: 'd', group: 'now', tab: 'watching', mark: HorizonMark, Component: WeekSection, meta: weekMeta, when: weekWhen, fill: FILLS.week },
  { id: 'watching', label: 'Watching', key: 'w', group: 'now', tab: 'watching', mark: WatchMark, Component: WatchingRoom, meta: watchingMeta,
    when: (_d, i) => i.deskView && i.upcoming.length > 0, fill: FILLS.watching },
  // the picks group: Lots you may like → For your collection → How your picks did (one pill)
  { id: 'for-you', label: 'For you', key: 'f', group: 'picks', tab: 'for-you', mark: RankMark, Component: PicksGroup, meta: picksMeta },
  // signed out: the slim sign-in line sits right after the picks — after value, never before it
  { id: 'signin', label: 'Sign in', key: '', group: 'picks', tab: 'for-you', Component: SignIn, meta: noPill, when: signinWhen },
  { id: 'budget', label: 'Budget', key: 'b', group: 'picks', tab: 'watching', mark: GapMark, Component: BudgetDesk, meta: budgetMeta, when: budgetWhen, fill: FILLS.budget },
  { id: 'portfolio', label: 'Portfolio', key: 'p', group: 'picks', tab: 'owned', mark: IndexLabMark, Component: Portfolio, meta: portfolioMeta, when: portfolioWhen, fill: FILLS.portfolio },
  { id: 'market', label: 'Market', key: 'm', group: 'picks', tab: 'names', mark: MoversMark, Component: Market, meta: marketMeta, fill: FILLS.market },
  { id: 'names', label: 'Names', key: 'n', group: 'picks', tab: 'names', mark: SalesMark, Component: NamesSection, meta: namesMeta, when: namesWhen, fill: FILLS.names },
  { id: 'signals', label: 'Signals', key: 's', group: 'picks', tab: 'for-you', mark: SignalMark, Component: Signals, meta: signalsMeta },
  { id: 'record', label: 'Record', key: 'r', group: 'desk', tab: 'record', mark: RecordMark, Component: RecordRoom, meta: recordMeta, when: recordWhen, fill: FILLS.record },
  { id: 'edge', label: 'Your calls', key: 'e', group: 'desk', tab: 'record', mark: CalibrationMark, Component: EdgeSection, meta: edgeMeta, when: edgeWhen, fill: FILLS.edge },
  { id: 'collection', label: 'Collection', key: 'c', group: 'desk', tab: 'owned', mark: CollectionMark, Component: CollectionRoom, meta: collectionMeta, when: collectionWhen, fill: FILLS.collection },
  { id: 'history', label: 'History', key: 'h', group: 'desk', tab: 'owned', mark: TapeMark, Component: HistoryRoom, meta: historyMeta, when: historyWhen, fill: FILLS.history },
  { id: 'becomes', label: 'What else this page becomes', key: '', group: 'desk', tab: 'today', Component: Becomes, meta: becomesMeta, when: becomesWhen },
  { id: 'account', label: 'Account', key: 'a', group: 'desk', tab: 'today', Component: AccountStrip, meta: accountMeta },
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

/** the rooms this desk does NOT mount that a reader can still fill — the
 *  cold desk's index (rooms/becomes), in desk order; a room with no fill
 *  (Today, Signals, Account) never lists */
export function unfilledSections(desk: DeskData, i: DeskInternals): DeskSection[] {
  // each room's own gate (not mountedSections — the index's gate reads this)
  return SECTIONS.filter(s => !!s.fill && !!s.Component && !!s.when && !s.when(desk, i));
}

/** a deep link's target that is not on this desk — its fill, for the one
 *  line under the rail ("Record — not on this desk yet; it fills as your
 *  watches settle") */
export function missingSection(id: string, mounted: readonly DeskSection[]): DeskSection | null {
  if (!id || mounted.some(s => s.id === id)) return null;
  return SECTIONS.find(s => s.id === id && !!s.fill) ?? null;
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

/** anchors INSIDE a room (links and deep links point at them) → the room that holds them */
export const SUB_ANCHORS: Readonly<Record<string, string>> = {
  settled: 'history', inbox: 'signals', 'on-device': 'signals', 'for-collection': 'for-you', 'pick-outcomes': 'for-you',
};
/** a tab's own hash ('#tab-watching') — never a room id, so a tab click can't
 *  land on (or report missing) the room that happens to share its name */
export const TAB_HASH = 'tab-';
export const tabHash = (t: DeskTab) => `${TAB_HASH}${t}`;

/** the tab an id lives under — a tab hash (tab-x), a room id, or an anchor
 *  inside a room (settled, inbox, week-2026-10-20 …); null for an unknown id
 *  or a room that rides under every tab */
export function tabOf(id: string | null | undefined): DeskTab | null {
  if (!id) return null;
  if (id.startsWith(TAB_HASH)) {
    const t = TABS.find(x => x.id === id.slice(TAB_HASH.length));
    return t ? t.id : null;
  }
  const owner = SUB_ANCHORS[id] ?? (id.startsWith('week-') ? 'week' : id);
  const sec = SECTIONS.find(x => x.id === owner);
  if (sec) return EVERY_TAB.has(sec.id) ? null : sec.tab;
  const t = TABS.find(x => x.id === id);
  return t ? t.id : null;
}

export interface TabItem extends DeskTabDef {
  /** the tab's lead number (its first room's pill count) */
  count?: React.ReactNode;
  tone?: 'up' | 'down';
  dot?: boolean;
  /** the rooms mounted under it, as rail items (the in-tab jump row) */
  items: RailItem[];
  /** nothing mounted under it on this desk */
  empty: boolean;
}

/** the tab bar for this desk: every tab (an empty one stays — it explains how it fills) */
export function tabItemsOf(desk: DeskData, i: DeskInternals): TabItem[] {
  const rail = railItemsOf(desk, i);
  const mounted = mountedSections(desk, i);
  return TABS.map(t => {
    const ids = new Set(mounted.filter(s => s.tab === t.id && !EVERY_TAB.has(s.id)).map(s => s.id));
    const order = TAB_ORDER[t.id];
    // the pills read in the order the panel mounts the rooms
    const items = rail.filter(r => ids.has(r.id)).sort((a, b) => (order ? order.indexOf(a.id) - order.indexOf(b.id) : 0));
    // the tab's number is its namesake room's (Watching = the lots you watch,
    // not every close of the week; Collection = the Collection room), else its
    // first room with a count
    const ns = NAMESAKE[t.id] ?? t.id;
    const lead = items.find(r => r.id === ns && r.count != null && !r.quiet) ?? items.find(r => r.count != null && !r.quiet);
    // empty = no room under it has anything to say (a room can mount and
    // render nothing: Today with no closes, Market with no names)
    return { ...t, count: lead?.count, tone: lead?.tone, dot: items.some(r => r.dot), items, empty: items.length === 0 };
  });
}
