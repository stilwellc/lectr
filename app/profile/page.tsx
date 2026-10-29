'use client';

import React, { useState } from 'react';
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
import { HelpChip } from './help';
import { Clamp, Closed } from './desk/fold';
import { SectionBar, type BarItem } from './desk/sectionbar';
import { useStalled } from './stall';
import { DeskProvider, useDeskState, useDeskInternals, useDesk, type DeskState } from './desk/provider';
import { SECTIONS, SUB_ANCHORS, TAB_ORDER, mountedSections, keysLegend, missingSection, tabItemsOf, tabOf, EVERY_TAB, type DeskSection, type DeskTab } from './desk/sections';

import { LedgerGate } from './desk/rooms/history';
import Cockpit from './desk/cockpit';
import { useDeskKeys } from './desk/keys';

/* ============================================================
   MY PROFILE — THE DESK v3 (Oct 11 2026). The page is a shell:

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

/** the keys legend behind the rail's (?) — kept in step with desk/sections */
function KeysHelp({ mountedIds }: { mountedIds: ReadonlySet<string> }) {
  const legend = keysLegend(SECTIONS.filter(s => mountedIds.has(s.id)));
  return (
    <>
      <b>j</b>/<b>k</b> walk the rows; <b>Enter</b> opens the row under the cursor (a watch&rsquo;s dossier, a lot).
      Press <b>g</b> then a letter to open that room and land on it:{' '}
      {legend.map((k, idx) => (
        <React.Fragment key={k.key}>
          {idx > 0 && ' · '}
          <b>{k.key}</b> {k.label}{!k.live && <span style={{ color: 'var(--color-text-faint)' }}> (not on this desk yet)</span>}
        </React.Fragment>
      ))}
      . A folded room opens when you land in it; every landing writes the address bar, so a reload or a shared link opens the same place. <b>?</b> opens this legend.
    </>
  );
}

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
                  to the hammer.
                </>
              : collection.rows.length > 0
                ? <>Your desk: <Accent>{collection.rows.length} owned</Accent>, {sold.length + soldOrphans.length} settled.</>
                : upcoming.length === 0 && savedLotsN === 0 && orphanIds.length > 0
                ? <>Your desk: <Accent>{orphanIds.length} settled {orphanIds.length === 1 ? 'watch' : 'watches'}</Accent>, resolving results.</>
                : upcoming.length > 0
                ? <>
                    Watching <Accent>{upcoming.length} {upcoming.length === 1 ? 'lot' : 'lots'}</Accent> to the hammer.
                  </>
                // nothing live: the desk is a record, not a watch — falling
                // back to savedLots.length claimed "Watching 3 lots to the
                // hammer" over a sub-line that said "0 live lots"
                : <>Your desk: <Accent>{savedLotsN} settled {savedLotsN === 1 ? 'watch' : 'watches'}</Accent>, judged under Record.</>)}
            // (Oct 28) the next hammer, the live count, the results to confirm, the
            // flags and the total's basis are the cockpit's cells now — on every
            // tab and every width — so the sub-line keeps only the What-changed fold
            sub={hasDeskDetails
              ? <button type="button" className="ck-deskdetails-btn" aria-expanded={deskDetails} aria-controls="desk-details"
                  onClick={() => setDeskDetails(v => !v)}>What changed</button>
              : undefined}
          />
          {/* the rest of the old sub-line — coverage, moves, taste, tenure */}
          {hasDeskDetails && deskDetails && (
            <div className="ck-deskdetails" id="desk-details">
              <p>
                {summary.totalEst > 0 && <>{fmtFace(summary.totalEst)} at estimate midpoint · {summary.priced} of {upcoming.length} lots priced</>}
                {(changes.moved > 0 || changes.newBids > 0) && (
                  <>
                    {summary.totalEst > 0 ? ' · ' : ''}since you saved
                    {changes.moved > 0 && <> · {changes.moved} {changes.moved === 1 ? 'signal' : 'signals'} moved</>}
                    {changes.newBids > 0 && <> · {changes.newBids} new {changes.newBids === 1 ? 'bid' : 'bids'}</>}
                  </>
                )}
                {tasteLabels.length > 0 && <> · you watch {tasteLabels.join(' · ')}</>}
                {tenure && <> · since {tenure}</>}
                {auth.authEnabled && auth.user && <> · signed in as {auth.user.email || 'you'} · <a href="#account" className="ck-away-link">Account</a></>}
              </p>
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
  const mountedIds = React.useMemo(() => new Set(sections.map(s => s.id)), [sections]);
  // a tab hash — the email's "#tab-watching", an old link — lands on the group's first room
  React.useEffect(() => {
    if (!i.landReady) return;
    const land = () => {
      let id = '';
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (!id) return;
      const g = tabOf(id);
      if (id.startsWith('tab-') && g) { const room = firstRoomOf(g, sections); if (room) jump(room); return; }
      if (g) jump(id);
    };
    land();
    window.addEventListener('hashchange', land);
    return () => window.removeEventListener('hashchange', land);
  }, [i.landReady, sections]);
  // the ids a jump may name inside a room (the room, its anchors)
  const idsOf = (ids: string[]) => ids.concat(Object.entries(SUB_ANCHORS).filter(([, room]) => ids.includes(room)).map(([a]) => a));
  const always = sections.filter(s => EVERY_TAB.has(s.id));
  let band = 0;
  const bands: React.ReactNode[] = [];
  const barItems: BarItem[] = [];
  for (const g of GROUP_ORDER) {
    const order = TAB_ORDER[g];
    const rooms = sections.filter(s => s.tab === g && !EVERY_TAB.has(s.id) && !MORE.has(s.id))
      .sort((a, b) => (order ? order.indexOf(a.id) - order.indexOf(b.id) : 0));
    if (!rooms.length) continue;
    const item = groups.find(t => t.id === g);
    const ids = idsOf(rooms.map(r => r.id));
    const inner = rooms.map(s => { const C = s.Component!; return <C key={s.id} desk={desk} act={act} narrow={narrow} />; });
    const tone = rooms.some(s => s.id === 'collection') ? 'ink' : band++ % 2 ? 'b' : 'a';
    barItems.push({ id: g, label: item?.label ?? rooms[0].label, count: item?.count, tone: item?.tone, target: rooms[0].id });
    bands.push(
      <div key={g} className="dt-band" data-tone={tone} data-room={rooms[0].id} data-group={g}>
        {g === 'today'
          ? inner
          : <Clamp ids={ids} label={item?.label ?? rooms[0].label} count={item?.count}>{inner}</Clamp>}
      </div>,
    );
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
            <div className="rail dk-more-head"><span className="kicker">More</span><span className="dk-more-sub">{more.length} rooms, each one tap</span></div>
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
        <div className="rail dk-keys"><HelpChip name="Keys"><KeysHelp mountedIds={mountedIds} /></HelpChip></div>
      </div>
      {/* on-demand: only fetch the ledger when there are orphans to resolve */}
      {i.orphanIds.length > 0 && <LedgerGate onState={i.setLedgerState} />}
      {/* the page-level comps modal — DeskActions.openLot */}
      {i.modalLot && <ComparableModal lot={i.modalLot} allLots={i.allLots} onClose={i.closeModal} />}
    </>
  );
}

function Shell({ state }: { state: DeskState }) {
  const { i } = state;
  const { auth, loading, fullLoaded, fullError, fromCache, savedIds, orphanIds, signedOutView, landReady, pageLoading, lastCrawl, upcomingCounts, badgeCount } = i;
  const savedLotsN = i.savedLots.length;
  useDeskKeys();
  useHashLanding(landReady);
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
