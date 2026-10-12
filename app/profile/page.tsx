'use client';

import React, { useState } from 'react';
import { retryFullLoad } from '../hooks/useRayData';
import ArtistNav from '../components/ArtistNav';
import { Colophon } from '../components/Terminal';
import CountUp from '../components/CountUp';
import Masthead, { Accent } from '../components/Masthead';
import CloseClock from '../components/CloseClock';
import RayEntrance, { RayLoading } from '../components/RayEntrance';
import ComparableModal from '../components/ComparableModal';
import { formatDate } from '../utils';
import { fmtFace } from '../lib/lot-face';
import { PillRail, useHashLanding, jump } from './rail';
import { useStalled } from './stall';
import { closeDays, hammerWord } from './desk/derive';
import { DeskProvider, useDeskState, useDeskInternals, useDesk, type DeskState } from './desk/provider';
import { SECTIONS, mountedSections, railItemsOf, keysLegend, missingSection, type DeskSection } from './desk/sections';
import type { RailItem } from './rail';
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
        cockpit: three registration cells and the 14-day hammer strip.

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
      <b>j</b>/<b>k</b> walk the rows on this page; <b>Enter</b> opens the row under the cursor (a watch&rsquo;s dossier, a lot).
      Press <b>g</b> then a letter to jump to a section:{' '}
      {legend.map((k, idx) => (
        <React.Fragment key={k.key}>
          {idx > 0 && ' · '}
          <b>{k.key}</b> {k.label}{!k.live && <span style={{ color: 'var(--color-text-faint)' }}> (not on this desk yet)</span>}
        </React.Fragment>
      ))}
      . Every pill above is a link, too — the hash in the address bar follows you. <b>?</b> opens this legend.
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
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const s = id ? missingSection(id, sections) : null;
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

/** the rooms without a pill the phone's Sections sheet still lists */
const RAIL_TAIL: RailItem[] = [{ id: 'account', label: 'Account', group: 'desk' }];

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
          sub={tunedLine ?? 'Tell lectr what you collect and live lots tied to it land below.'}
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
            title={summary.totalEst > 0
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
                : <>Your desk: <Accent>{savedLotsN} settled {savedLotsN === 1 ? 'watch' : 'watches'}</Accent>, judged below.</>}
            sub={
              <>
                {summary.next && (
                  <>Next hammer {hammerWord(closeDays(summary.next))}
                    {summary.next.saleDateTime && <CloseClock iso={summary.next.saleDateTime} windowHours={24} prefix=" · " />}
                    {' '}·{' '}
                  </>
                )}
                {upcoming.length} live {upcoming.length === 1 ? 'lot' : 'lots'}
                {summary.flagged > 0 && (
                  <>
                    {' '}·{' '}
                    {/* a count of flags, not a market direction — ink (lamp law) */}
                    <b style={{ color: 'var(--color-fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {summary.flagged} below market
                    </b>
                  </>
                )}
                {hasDeskDetails && (
                  <>
                    {' '}·{' '}
                    <button type="button" className="ck-deskdetails-btn" aria-expanded={deskDetails} aria-controls="desk-details"
                      onClick={() => setDeskDetails(v => !v)}>Desk details</button>
                  </>
                )}
              </>
            }
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
      {/* ══ 0b · THE COCKPIT — three registration cells + the 14-day strip ══ */}
      <Cockpit />
    </section>
  );
}

/** the desk: masthead → rail → every registered section, in order */
function DeskBody() {
  const { desk, act, narrow } = useDesk();
  const i = useDeskInternals();
  const sections = mountedSections(desk, i);
  const items = railItemsOf(desk, i);
  const mountedIds = new Set(sections.map(s => s.id));
  return (
    <>
      <DeskMasthead />
      <PillRail items={items} help={<KeysHelp mountedIds={mountedIds} />} tail={RAIL_TAIL} />
      <MissingLanding sections={sections} />
      {sections.map(s => {
        const C = s.Component!;
        return <C key={s.id} desk={desk} act={act} narrow={narrow} />;
      })}
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
