'use client';
/**
 * The rooms that already live in their own files (../today, ../YourMarket,
 * ../signals), mounted through the registry: each adapter maps the desk's
 * internals to the props the room was written against — the wiring
 * page.tsx did inline, kept exactly.
 */
import React from 'react';
import TodayBand from '../../today';
import YourMarket from '../../YourMarket';
import YourSignals from '../../signals';
import { useDeskInternals, type DeskInternals } from '../provider';
import { RoomHead } from '../../head';
import type { SectionProps, SectionMeta, DeskData } from '../types';
import Link from 'next/link';
import { useDesk } from '../provider';
import { Thumb } from '../thumb';
import { fmtFace } from '../../../lib/lot-face';
import { craftTitle } from '../../../utils';

/** RESULTS TO CONFIRM (Oct 20 audit) — the settled watches not yet in your
 *  collection, answered in place: "I won it" books the piece (the same toggle
 *  History's row uses); the full list stays under Collection › History. */
function ResultsInbox() {
  const i = useDeskInternals();
  const { desk } = useDesk();
  const rows = i.sold.filter(l => l.status === 'sold' && !desk.ownedIds.has(i.savedIdOf(l.id)) && !desk.ownedIds.has(l.id) && !i.metaFor(l.id)?.dismissed).slice(0, 4);
  if (!rows.length) return null;
  return (
    <div id="results" className="ck-results" role="group" aria-label="Results to confirm">
      <div className="ck-reads-head">
        <span className="kicker">Did you win? · {i.unclaimedWins}</span><i className="ck-reads-rule" />
        {/* (Oct 28) the pile never clears one tap at a time: one tap says none were yours */}
        <button type="button" className="ck-results-clear" onClick={i.onDismissResults}
          title="Every result waiting here leaves the inbox; they stay under History and Record">
          None were me{i.unclaimedWins > 1 ? ` · clear all ${i.unclaimedWins}` : ''}
        </button>
      </div>
      {rows.map(l => (
        <div key={l.id} className="ck-result ck-ph" style={{ '--ph': '48px' } as React.CSSProperties}>
          <Thumb src={l.imageUrl} label={l.title} size={48} />
          <Link href={`/lot?id=${encodeURIComponent(l.id)}`} className="ck-result-t">{craftTitle(l.title, l.auctionHouse)}</Link>
          <span className="ck-result-s">{l.auctionHouse}{l.priceUsd ? <> · hammered <b>{fmtFace(l.priceUsd)}</b></> : null}</span>
          <span className="ck-result-a">
            <button type="button" className="ray-own-btn" onClick={() => i.onSettledOwn(i.savedIdOf(l.id))}>I won it</button>
          </span>
        </div>
      ))}
      {i.unclaimedWins > rows.length && <a href="#settled" className="ck-away-link ck-result-more">See all {i.unclaimedWins} under History</a>}
    </div>
  );
}

/* ── TODAY ── */
export function todayMeta(_desk: DeskData, i: DeskInternals): SectionMeta | null {
  return i.todayShows ? { id: 'today', label: 'Today' } : null;
}
export function Today(_p: SectionProps) {
  const i = useDeskInternals();
  const { deal, deskView, signedOutView, closingWatches, reads, awayLine, unseenAlerts, todayTop, watchFirst, recsReady } = i;
  if (deskView) {
    return <TodayBand loop={deal.loop} closingWatches={closingWatches} reads={reads} away={awayLine} top={todayTop} topLoading={watchFirst && !recsReady} phoneRows={watchFirst ? 2 : 3} picksN={deal.recs.length} results={<ResultsInbox />} />;
  }
  // signed out: no away facts; a signed-in empty desk keeps its inbox count
  return <TodayBand loop={deal.loop} closingWatches={[]} reads={[]} away={signedOutView ? null : (unseenAlerts > 0 ? awayLine : null)} picksN={deal.recs.length} />;
}

/* ── YOUR MARKET ── */
export function marketMeta(_desk: DeskData, i: DeskInternals): SectionMeta | null {
  return i.hasMarket ? { id: 'market', label: 'Market' } : null;
}
export function Market(_p: SectionProps) {
  const { allLots, marketOwned } = useDeskInternals();
  return <YourMarket book={allLots} owned={marketOwned} />;
}

/* ── YOUR SIGNALS ── */
export function signalsMeta(desk: DeskData, i: DeskInternals): SectionMeta {
  return { id: 'signals', label: 'Signals', count: desk.follows.length || undefined, dot: i.unseenAlerts > 0 };
}
export function Signals(_p: SectionProps) {
  const { allLots, auth, signedOutView } = useDeskInternals();
  return <YourSignals book={allLots} signedOut={signedOutView ? true : auth.authEnabled && !auth.user} />;
}

/* ── the slim sign-in line (signed out only) — after value, never before it ── */
export function signinWhen(_desk: DeskData, i: DeskInternals): boolean { return i.signedOutView; }
export function SignIn(_p: SectionProps) {
  const { coldOut, auth } = useDeskInternals();
  return (
    <section id="signin" className="rail ray-enter ck-signin-section">
      <RoomHead level={3} title="Sign in" style={{ marginBottom: 2 }} />
      <div className="ck-signin">
        {/* a cold visit's one primary action is the quick start — sign-in
            rides as a text link under it, never a second black button */}
        {coldOut ? (
          <button type="button" className="ck-warn-btn ck-account-btn" onClick={() => auth.signInWithGoogle()}>Sign in with Google</button>
        ) : (
          <button className="ray-call-btn ray-call-btn-primary" style={{ border: 'none', cursor: 'pointer' }} onClick={() => auth.signInWithGoogle()}>
            Sign in with Google
          </button>
        )}
        <span>to keep this everywhere — your follows and saves carry over. Free · one tap · nothing on lectr is gated.</span>
      </div>
    </section>
  );
}
