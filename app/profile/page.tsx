'use client';

import React, { useEffect, useRef, useState } from 'react';
import { retryFullLoad } from '../hooks/useRayData';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';
import CountUp from '../components/CountUp';
import Masthead, { Accent } from '../components/Masthead';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import ComparableModal from '../components/ComparableModal';
import { formatDate } from '../utils';
import { fmtFace } from '../lib/lot-face';
import { useHashLanding, jump, JUMP_EVENT, OPEN_TAB_EVENT, MISSING_EVENT } from './rail';
import { Clamp, Closed } from './desk/fold';
import { SectionBar, type BarItem } from './desk/sectionbar';
import { DailyNudge } from './desk/nudge';
import { noteScroll, snapFor } from './desk/restore';
import { KeysChip } from './desk/keyshelp';
import { useStalled } from './stall';
import { DeskProvider, useDeskState, useDeskInternals, useDesk, type DeskState } from './desk/provider';
import { SUB_ANCHORS, TAB_ORDER, mountedSections, missingSection, tabItemsOf, tabOf, EVERY_TAB, type DeskSection, type DeskTab } from './desk/sections';

import { LedgerGate } from './desk/rooms/history';
import Cockpit from './desk/cockpit';
import { useDeskKeys } from './desk/keys';

/* ============================================================
   MY PROFILE — THE DESK v3 (Oct 11 2026). The page is a shell:
   (the standing law of this page, in one sitting: docs/DESK.md)

     1. useDeskState() resolves everything ONCE, in the one order
        (saves → corpus → settled cache → taste → stall deadlines →
        the deal) and hands it down as the contract (desk/types.ts:
        DeskData + DeskActions + narrow) plus the page's own reads.
     2. desk/sections.ts is the desk, top to bottom — the page maps
        over it to mount each section and build the rail from each
        section's meta(desk). Adding a section = adding one entry.
     3. The masthead stays (title + CountUp sub-line) and gains the
        cockpit: four registration cells (Watching · Next hammer · Needs
        you · Your calls) and the 14-day hammer strip.

   ONE PAGE, LAYERED (THE DESK v4, Oct 29 2026 — "6 pages is way too much;
   think Robinhood: all right there, tons of data, simple"): the eight tabs
   are gone. The desk is one column — the cockpit, then Today, then every
   room folded to its first screen (desk/fold Clamp: one "Show all" opens it
   in place), the secondary rooms (Budget, Signals, Market, History) closed
   to one row each (Closed: the tap mounts them), Account at the foot. The
   tab model (sections.ts TABS) survives as the GROUPING — Record = your
   calls + the record, Collection = portfolio + collection — and as what
   every #anchor, g-chord, push link and email link (#tab-watching) resolves
   through. Nothing is removed; everything is one scroll and one tap away.
   Past the cockpit a slim sticky SECTION BAR (desk/sectionbar.tsx) carries
   the groups and their figures — Today · Watching 8 · For you 24 · … · More —
   the current one underlined, each a jump to its room.

   The collector's three questions still order the desk: what needs
   me now (Today, Watching), what lectr sees for me (the picks, my
   market, my signals), how am I doing (Record, Collection, History).

   Honesty rules hold everywhere: green/red only on measured
   deltas; reference bands are labeled ranges that never enter a
   total; a market read on holdings is the MARKET's move, labeled
   as such; abstention prints its reason (a failed fetch is never
   dressed as a fact about a lot).

   SIGNAL SIGN LAW (see account.tsx SIGNED_SIGNAL_SINCE): the
   at-save signal is interpreted through signalCallOf() — legacy
   saves lost their direction and render unsigned + neutral,
   never green/red. Live signals print the app-wide convention:
   Below Market = +pct mint (comps sit above the ask), Above
   Market = −pct coral.
   ============================================================ */

/* (pass 6) the keys legend moved to desk/keyshelp.tsx — it rides the Account head */

/** a deep link to a room this desk doesn't have yet (#record on a cold desk)
 *  used to land silently — one line under the rail says what the room is,
 *  how it fills, and the tap that starts it (R3#5) */
function MissingLanding({ sections }: { sections: readonly DeskSection[] }) {
  const [id, setId] = useState<string | null>(null);
  React.useEffect(() => {
    const read = () => { try { setId(decodeURIComponent(window.location.hash.slice(1)) || null); } catch { setId(null); } };
    const onMissing = (e: Event) => setId((e as CustomEvent<{ id: string }>).detail?.id ?? null);
    const clear = () => setId(null);
    read();
    window.addEventListener('hashchange', read);
    window.addEventListener(MISSING_EVENT, onMissing);
    window.addEventListener(JUMP_EVENT, clear);
    window.addEventListener(OPEN_TAB_EVENT, clear);
    return () => {
      window.removeEventListener('hashchange', read); window.removeEventListener(MISSING_EVENT, onMissing);
      window.removeEventListener(JUMP_EVENT, clear); window.removeEventListener(OPEN_TAB_EVENT, clear);
    };
  }, []);
  // only an id the desk knows (a room, an anchor inside one)
  if (id && !tabOf(id)) return null;
  // an anchor inside a room (#settled, #inbox, #week-…) is explained by its room
  const owner = id ? (SUB_ANCHORS[id] ?? (id.startsWith('week-') ? 'week' : id)) : null;
  const s = owner ? missingSection(owner, sections) : null;
  if (!s || !s.fill) return null;
  const { fill } = s;
  const hash = fill.tap.href.startsWith('#');
  return (
    <section className="rail ck-landnote" role="status">
      <p>
        <b>{s.label}</b> — not on this desk yet; {fill.how}. It holds {fill.text}.{' '}
        {hash
          ? <a href={fill.tap.href} className="ck-away-link" onClick={e => { e.preventDefault(); jump(fill.tap.href.slice(1)); }}>{fill.tap.label} →</a>
          : <a href={fill.tap.href} className="ck-away-link">{fill.tap.label} →</a>}
      </p>
    </section>
  );
}


/** the masthead — the statement, the sub-line, the desk details, the
 *  archive warnings, then the cockpit */
function DeskMasthead() {
  const i = useDeskInternals();
  const { deskView, signedOutView, summary, collection, sold, soldOrphans, upcoming, orphanIds, savedIds, fromCache, lastCrawl, deskKicker, tunedLine, hasDeskDetails, changes, tasteLabels, tenure, auth, partialLoadFailed, fullSlow } = i;
  const [deskDetails, setDeskDetails] = useState(false);
  const savedLotsN = i.savedLots.length;
  // settled = a result posted; a watch past its day with no result is awaiting results, not settled
  const settledN = sold.length + soldOrphans.length - i.pendingResultsN;
  // (Oct 29) the fold opens only when something CHANGED since the saves — a
  // signal moved, a bid landed; the basis, taste and tenure lines ride inside
  // it then (the cockpit prints the basis on its own cell either way)
  const changed = hasDeskDetails && (changes.moved > 0 || changes.newBids > 0);
  return (
    <section id="desk" className="rail ray-enter ck-desk" style={{ paddingTop: 24 }}>
      {signedOutView ? (
        <Masthead
          kicker="My desk"
          title={<>Your desk at <Accent>the auction</Accent>.</>}
          sub={tunedLine ?? 'Tell lectr what you collect and live lots tied to it land in For you.'}
        />
      ) : !deskView ? (
        <Masthead
          kicker={deskKicker}
          serial={lastCrawl || undefined}
          title={<>Your desk at <Accent>the auction</Accent>.</>}
          sub="Bookmark a lot anywhere on lectr and it tracks here to the hammer — comps, signals, your record once it settles, your collection when you win."
        />
      ) : (
        <>
          {/* ══ 0 · THE MASTHEAD — compressed: title + one sub-line; the rest
              of the old sub-line lives in Desk details ══ */}
          <Masthead
            kicker={deskKicker}
            serial={lastCrawl || undefined}
            title={(summary.totalEst > 0
              ? <>
                  Watching{' '}
                  <Accent>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <CountUp to={summary.totalEst} format={fmtFace} duration={1100} animate={!fromCache} />
                    </span>
                  </Accent>{' '}
                  to the hammer{summary.priced < upcoming.length ? <> across {summary.priced} of {upcoming.length} lots</> : null}.
                </>
              // (pass 7) lots on the block lead the morning's headline even without a
              // sum to print (19 RR autographs with one-sided estimates): the live desk
              // before the collection line — the collection has its own cell and room
              : upcoming.length > 0
                ? <>
                    Watching <Accent>{upcoming.length} {upcoming.length === 1 ? 'lot' : 'lots'}</Accent> to the hammer{summary.closesToday > 0 ? <>, {summary.closesToday} {summary.closesToday === 1 ? 'closes' : 'close'} today</> : null}.
                  </>
                : collection.rows.length > 0
                ? <>Your desk: <Accent>{collection.rows.length} owned</Accent>, {settledN} settled{i.pendingResultsN > 0 ? <> · {i.pendingResultsN} awaiting results</> : null}.</>
                : upcoming.length === 0 && savedLotsN === 0 && orphanIds.length > 0
                ? <>Your desk: <Accent>{orphanIds.length} settled {orphanIds.length === 1 ? 'watch' : 'watches'}</Accent>, resolving results.</>
                // nothing live: the desk is a record, not a watch — falling
                // back to savedLots.length claimed "Watching 3 lots to the
                // hammer" over a sub-line that said "0 live lots"
                : <>Your desk: <Accent>{settledN} settled {settledN === 1 ? 'watch' : 'watches'}</Accent>{i.pendingResultsN > 0 ? <>, {i.pendingResultsN} awaiting results</> : null}, judged under Record.</>)}
            // (Oct 28) the next hammer, the live count, the results to confirm, the
            // flags and the total's basis are the cockpit's cells now — on every
            // tab and every width — so the sub-line keeps only the What-changed fold
            sub={changed
              ? <button type="button" className="ck-deskdetails-btn" aria-expanded={deskDetails} aria-controls="desk-details"
                  onClick={() => setDeskDetails(v => !v)}>What changed</button>
              : undefined}
          />
          {/* what changed since the saves, one line each — counts in ink (a count
              has no sign: the lamp is for measured deltas only); then the basis,
              taste and tenure lines the old sub-line carried */}
          {changed && deskDetails && (
            <div className="ck-deskdetails" id="desk-details">
              <ul className="ck-deskdetails-list">
                {changes.moved > 0 && <li><b>{changes.moved}</b> {changes.moved === 1 ? 'signal' : 'signals'} moved since you saved — the rows say which way</li>}
                {changes.newBids > 0 && <li><b>{changes.newBids}</b> new {changes.newBids === 1 ? 'bid' : 'bids'} on your watches since you saved</li>}
                {summary.totalEst > 0 && <li>{fmtFace(summary.totalEst)} at estimate midpoint · {summary.priced} of {upcoming.length} lots priced{summary.oneSided > 0 && <> · {summary.oneSided} from one bound, not summed</>}</li>}
                {tasteLabels.length > 0 && <li>you watch {tasteLabels.join(' · ')}</li>}
                {tenure && <li>on the desk since {tenure}</li>}
                {auth.authEnabled && auth.user && <li>signed in as {auth.user.email || 'you'} · <a href="#account" className="ck-away-link">Account</a></li>}
              </ul>
            </div>
          )}

          {/* partial phase-2 failure — say so where the data would be */}
          {partialLoadFailed && (
            <div className="ck-warn ray-enter" role="status">
              Couldn&apos;t load the archive that resolves your concluded lots —{' '}
              {savedIds.length - savedLotsN > 0
                ? <>{savedIds.length - savedLotsN} of your {savedIds.length} saved {savedIds.length === 1 ? 'watch is' : 'watches are'} not shown, and </>
                : null}
              settled results and appraisals are incomplete.{' '}
              <button className="ck-warn-btn" onClick={() => retryFullLoad()}>Try again</button>
            </div>
          )}
          {/* (deadline) the archive is still out, not failed — say so, once */}
          {fullSlow && !partialLoadFailed && (
            <div className="ck-warn ray-enter" role="status">
              The archive that resolves your concluded lots is slow to arrive — settled results and appraisals fill in
              when it lands{savedIds.length - savedLotsN > 0 ? <>; {savedIds.length - savedLotsN} of your {savedIds.length} saved {savedIds.length === 1 ? 'watch is' : 'watches are'} not shown yet</> : null}.
            </div>
          )}
        </>
      )}
      {/* ══ 0b · THE COCKPIT — the registration cells (every tab, every width) + the 14-day strip (Today) ══ */}
      <Cockpit />
    </section>
  );
}

/** the More rooms: closed to one row each, mounted on the tap */
const MORE: ReadonlySet<string> = new Set(['budget', 'signals', 'market', 'history']);
/** one line on what each More room holds (the row says it before it opens) */
const MORE_HINT: Record<string, string> = {
  budget: 'your watches by close night against your band',
  signals: 'what tunes your picks — follows, searches, this device',
  market: 'the 12-month pulse of the names you follow or own',
  history: 'the line-item receipt of every settled watch',
};
/** the order the groups read, top to bottom (Today first, the rest folded) */
const GROUP_ORDER: readonly DeskTab[] = ['today', 'watching', 'for-you', 'week', 'record', 'owned', 'names', 'budget'];
/** a tab hash (#tab-watching, from an email or an old link) lands on the group's first room */
function firstRoomOf(group: DeskTab, sections: readonly DeskSection[]): string | null {
  const order = TAB_ORDER[group];
  const rooms = sections.filter(s => s.tab === group && !EVERY_TAB.has(s.id) && !MORE.has(s.id))
    .sort((a, b) => (order ? order.indexOf(a.id) - order.indexOf(b.id) : 0));
  return rooms[0]?.id ?? sections.find(s => s.tab === group && !EVERY_TAB.has(s.id))?.id ?? null;
}

/** the More band's own anchor — the section bar's last stop (not a room: no tab resolves it) */
const MORE_ID = 'more';

/** the desk: masthead + cockpit → Today → every room folded to its first
 *  screen, each on its own band (alternating grounds: the color break
 *  between rooms) → the More rooms closed to a row → Account; the section
 *  bar reads the bands back (one item per band, in band order) */
function DeskBody() {
  const { desk, act, narrow } = useDesk();
  const i = useDeskInternals();
  // (perf) the registry runs every room's meta()/when(): once per desk change, not per render
  const sections = React.useMemo(() => mountedSections(desk, i), [desk, i]);
  const groups = React.useMemo(() => tabItemsOf(desk, i), [desk, i]);
  // a tab hash — the email's "#tab-watching", an old link, the hash the old
  // tab bar left in a reader's address bar — lands on the group's first room
  // (a room hash is useHashLanding's); the browser's back/forward (hashchange)
  // lands too. Once: never a second lander fighting the first (the live desk
  // "spazzed" with two).
  const landed = React.useRef(false);
  React.useEffect(() => {
    if (!i.landReady) return;
    const land = (fromChange: boolean) => {
      let id = '';
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (!id) return;
      const g = tabOf(id);
      if (id.startsWith('tab-')) {
        if (!g) return;
        // Today is the top of the page: nothing to land on
        if (g === 'today') { try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`); } catch { /* ignore */ } return; }
        const room = firstRoomOf(g, sections); if (room) jump(room); return;
      }
      if (fromChange && g) jump(id);
    };
    if (!landed.current) { landed.current = true; land(false); }
    const onChange = () => land(true);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, [i.landReady, sections]);
  // the ids a jump may name inside a room (the room, its anchors)
  const idsOf = (ids: string[]) => ids.concat(Object.entries(SUB_ANCHORS).filter(([, room]) => ids.includes(room)).map(([a]) => a));
  const always = sections.filter(s => EVERY_TAB.has(s.id));
  // THE COLD DESK (nothing watched, no picks, no names): the rooms that mount
  // are the invitation — the quick start, the index — and read whole, never
  // folded to a first screen (a clamped quick start looked broken)
  const cold = !i.deskView && desk.recs.length === 0 && desk.closingPicks.length === 0 && desk.follows.length === 0;
  // pass 1: one column per group (its fold, its bar item), in the order the desk reads.
  // (pass 5) Today and the FIRST folded room mount at once; every fold after
  // them is a seat until the reader is a screen away (desk/fold Clamp `lazy`)
  const barItems: BarItem[] = [];
  const cols: { g: DeskTab; room: string; node: React.ReactNode }[] = [];
  let folds = 0;
  for (const g of GROUP_ORDER) {
    // Today with nothing to say mounts nothing: no band (the tones alternate
    // from the first band that shows), no bar item (the bar drops a hidden
    // band's item on its own too — this keeps the two in step from the data)
    if (g === 'today' && !i.todayShows) continue;
    const order = TAB_ORDER[g];
    const rooms = sections.filter(s => s.tab === g && !EVERY_TAB.has(s.id) && !MORE.has(s.id))
      .sort((a, b) => (order ? order.indexOf(a.id) - order.indexOf(b.id) : 0));
    if (!rooms.length) continue;
    const item = groups.find(t => t.id === g);
    const ids = idsOf(rooms.map(r => r.id));
    const inner = rooms.map(s => { const C = s.Component!; return <C key={s.id} desk={desk} act={act} narrow={narrow} />; });
    barItems.push({ id: g, label: item?.label ?? rooms[0].label, count: item?.count, tone: item?.tone, target: rooms[0].id });
    // Today's foot carries the Daily Desk nudge (a signed-in reader without the paper)
    cols.push({ g, room: rooms[0].id, node: g === 'today' ? <>{inner}<DailyNudge /></> : <Clamp ids={ids} label={item?.label ?? rooms[0].label} count={item?.count} whole={cold} lazy={folds++ > 0}>{inner}</Clamp> });
  }
  // pass 2: the bands. Record + Collection read side by side at ≥ 900px (one
  // band, two columns — "how am I doing" in one glance), stacked on a phone;
  // each keeps its own fold and its own bar item. Alone, either is a band.
  let band = 0;
  const bands: React.ReactNode[] = [];
  const PAIR: readonly DeskTab[] = ['record', 'owned'];
  const paired = cols.filter(c => PAIR.includes(c.g));
  for (const c of cols) {
    if (paired.length === 2 && PAIR.includes(c.g)) {
      if (c.g !== paired[0].g) continue;   // the second joins the first's band
      const tone = band++ % 2 ? 'b' : 'a';
      bands.push(
        <div key="pair" className="dt-band dt-pair" data-tone={tone} data-pair>
          {paired.map(p => (
            <div key={p.g} className="dt-pair-col" data-tone={p.g === 'owned' ? 'ink' : undefined} data-room={p.room} data-group={p.g}>{p.node}</div>
          ))}
        </div>,
      );
      continue;
    }
    const tone = c.g === 'owned' ? 'ink' : band++ % 2 ? 'b' : 'a';
    bands.push(<div key={c.g} className="dt-band" data-tone={tone} data-room={c.room} data-group={c.g}>{c.node}</div>);
  }
  const more = sections.filter(s => MORE.has(s.id));
  if (more.length > 0) barItems.push({ id: MORE_ID, label: 'More', count: more.length, target: MORE_ID });
  return (
    <>
      <div className="dt-head"><DeskMasthead /></div>
      <SectionBar items={barItems} />
      {/* not before the desk can land: the archive that resolves #settled & co. lands late */}
      {i.landReady && <MissingLanding sections={sections} />}
      <div id="dt-panel" className="dt-panel">
        {bands}
        {more.length > 0 && (
          <div id={MORE_ID} className="dt-band dk-more" data-tone={band % 2 ? 'b' : 'a'} data-group={MORE_ID} aria-label="More rooms">
            <div className="rail dk-more-head"><h3 className="ck-h3 dk-more-h">More</h3><span className="dk-more-sub">{more.length} rooms, each one tap</span></div>
            {more.map(s => {
              const C = s.Component!;
              const m = s.meta(desk, i);
              const Mark = s.mark;
              return (
                <Closed key={s.id} ids={idsOf([s.id])} label={m?.label ?? s.label} count={m?.count ?? undefined} hint={MORE_HINT[s.id]}
                  mark={Mark ? <Mark size={15} /> : undefined}>
                  <C desk={desk} act={act} narrow={narrow} />
                </Closed>
              );
            })}
          </div>
        )}
      </div>
      <div className="dt-band dt-band-foot" data-tone="foot">
        {always.map(s => {
          const C = s.Component!;
          return <C key={s.id} desk={desk} act={act} narrow={narrow} />;
        })}
        {/* the keys legend's (?) — it mounts onto the Account head's row (desk/keyshelp) */}
        <KeysChip />
      </div>
      {/* on-demand: only fetch the ledger when there are orphans to resolve */}
      {i.orphanIds.length > 0 && <LedgerGate onState={i.setLedgerState} />}
      {/* the page-level comps modal — DeskActions.openLot */}
      {i.modalLot && <ComparableModal lot={i.modalLot} allLots={i.allLots} onClose={i.closeModal} />}
    </>
  );
}

/** THE RETURN (desk/restore): the page reports its scroll and the element
 *  under the chrome; a desk mounting from a fresh snapshot lands back on
 *  that element at the same offset — after the desk can land, re-anchored for
 *  a moment while the restored rooms settle, and never against a reader who
 *  has already taken the wheel. The anchor, not y: the rooms above re-render
 *  at other heights on the way back (a settled cache now warm, a "since your
 *  last visit" line), and y alone landed a screen off. */
/** the chrome's height: the nav and the section bar's own height (its element,
 *  not --dt-h: that is 0 for a frame after a remount, before the bar's observer
 *  fires, and the snapshot and the landing must measure against one line) */
const chromeHeight = () => (document.querySelector<HTMLElement>('.ray-artist-nav')?.offsetHeight ?? 64) + (document.querySelector<HTMLElement>('.dk-sbar')?.offsetHeight ?? 0);
/** the element with an id under the chrome's bottom edge, and how far its top sits under it */
function anchorUnderChrome(): { id: string; dy: number } | null {
  const line = chromeHeight() + 8;
  const hit = document.elementFromPoint(Math.round(window.innerWidth / 2), line)?.closest<HTMLElement>('[id]');
  if (!hit || hit === document.documentElement || hit === document.body || !hit.id) return null;
  return { id: hit.id, dy: Math.round(hit.getBoundingClientRect().top - line) };
}
function useReturn(ready: boolean): void {
  useEffect(() => {
    let raf = 0;
    const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; noteScroll(window.scrollY, anchorUnderChrome()); }); };
    window.addEventListener('scroll', on, { passive: true });
    // the browser's own restoration would fight the desk's (the rooms mount late)
    const prev = window.history.scrollRestoration;
    try { window.history.scrollRestoration = 'manual'; } catch { /* ignore */ }
    return () => { window.removeEventListener('scroll', on); if (raf) cancelAnimationFrame(raf); try { window.history.scrollRestoration = prev; } catch { /* ignore */ } };
  }, []);
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const snap = snapFor(window.location.pathname);
    if (!snap || snap.y <= 0) return;
    const { y, anchor } = snap;
    let stop = false;
    const intents: (keyof WindowEventMap)[] = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    const end = () => { stop = true; for (const ev of intents) window.removeEventListener(ev, end); };
    for (const ev of intents) window.addEventListener(ev, end, { passive: true });
    const until = Date.now() + 2500;
    const tick = () => {
      if (stop) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      // the anchor's own place (its top `dy` under the chrome), else the y
      const el = anchor ? document.getElementById(anchor.id) : null;
      const want = el ? window.scrollY + el.getBoundingClientRect().top - chromeHeight() - 8 - anchor!.dy : y;
      const target = Math.min(Math.round(want), Math.max(0, max));
      // instant: 'auto' defers to the page's smooth scroll-behavior and glided for a second
      if (Math.abs(window.scrollY - target) > 2) window.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior });
      if (Date.now() < until) window.setTimeout(tick, 120); else end();
    };
    tick();
  }, [ready]);
}

function Shell({ state }: { state: DeskState }) {
  const { i } = state;
  const { auth, loading, fullLoaded, fullError, fromCache, savedIds, orphanIds, signedOutView, landReady, pageLoading, lastCrawl, upcomingCounts, badgeCount } = i;
  const savedLotsN = i.savedLots.length;
  useDeskKeys();
  // a return (desk/restore) lands where the reader left; the hash landing
  // stands down for it (a deep link / reload has no fresh snapshot and lands by hash)
  const [returning] = useState(() => typeof window !== 'undefined' && !!snapFor(window.location.pathname)?.y);
  useHashLanding(landReady && !returning);
  useReturn(landReady);
  // the whole-page loader's own deadline: past it the loader says the book is
  // slow and offers a reload — never a skeleton forever
  const pageSlow = useStalled(pageLoading, 15_000);
  const slowNote = pageSlow ? (
    <section className="rail" role="status" style={{ paddingBlock: 64, textAlign: 'center', minHeight: '60vh' }}>
      <p style={{ color: 'var(--color-text-muted)', margin: '0 0 14px' }}>
        {loading || !auth.authReady || !auth.savedReady
          ? <>The book is slow to arrive — your desk opens the moment it lands.</>
          : <>The archive that resolves your saved lots is slow to arrive — your desk opens the moment it lands.</>}
      </p>
      <button className="ray-call-btn ray-call-btn-quiet" onClick={() => window.location.reload()}>Reload</button>
    </section>
  ) : null;

  return (
    <div className="terminal-shell ck-page" style={{ minHeight: '100vh', fontFamily: 'var(--font-sans), sans-serif' }}>
      <ArtistNav activeSlug="saved" savedCount={badgeCount} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />

      {signedOutView ? (
        <RayEntrance animate><DeskBody /></RayEntrance>
      ) : loading || !auth.authReady || !auth.savedReady ? (
        (slowNote ?? <RayLoading />)
      ) : savedLotsN === 0 && !fullLoaded && fullError ? (
        <RayEntrance animate={false}>
          <section className="rail" style={{ paddingBlock: 48, textAlign: 'center' }}>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 14 }}>
              Couldn&apos;t load the full book to resolve your saved lots.
            </p>
            <button className="ray-call-btn ray-call-btn-primary" onClick={() => retryFullLoad()}>Try again</button>
          </section>
        </RayEntrance>
      ) : savedLotsN === 0 && !fullLoaded ? (
        savedIds.length === 0 ? (
          <RayEntrance animate={!fromCache}><DeskBody /></RayEntrance>
        ) : (
          (slowNote ?? <RayLoading />)
        )
      ) : savedLotsN === 0 && orphanIds.length === 0 ? (
        <RayEntrance animate={!fromCache}><DeskBody /></RayEntrance>
      ) : (
        <RayEntrance animate={!fromCache}><DeskBody /></RayEntrance>
      )}
      <Colophon record={null} />
    </div>
  );
}

export default function SavedPage() {
  const state = useDeskState();
  return (
    <DeskProvider value={state}>
      <Shell state={state} />
    </DeskProvider>
  );
}
