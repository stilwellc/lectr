'use client';
/**
 * THE BUDGET DESK (#budget) — THE DESK v3 §5 (Oct 11 2026).
 *
 * The question it answers: "what can I actually bid this week, and what
 * will it cost me if I win?" Three reads under the reader's stated band:
 *
 *   Bid plan        the live watches by close night, each at ONE hammer
 *                   figure (the engine's max bid, else the ranker's labelled
 *                   anchor — budget.ts planRowOf), summed per night against
 *                   the ceiling; an over-budget night says by how much and
 *                   which rows to drop first (a suggestion, nothing moves).
 *   What your budget buys this week
 *                   the engine's Below Market flags in the reader's markets,
 *                   inside the band, closing within 7 days — dealScore order.
 *   If you win      every plan row's all-in with its house premium
 *                   (premiums.lotAllInFactor), and the sum.
 *
 * Honest by construction: no band stated → the desk asks for one (the
 * quick start's own floor/ceiling steps, one tap, act.setPrice) and prints
 * the plan with no ceiling line — every figure still labelled by what it is.
 * One clock: desk.now. Money: fmtFace. Every figure is budget.ts's.
 */
import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import type { SectionProps, SectionMeta, DeskData } from '../desk/types';
import type { AuctionLot } from '../../types';
import { VALUE_FLOORS, VALUE_CEILINGS, fmtCeiling } from '../../lib/feed-filters';
import { priceText } from '../../lib/interests';
import { fmtFace, decisionOf } from '../../lib/lot-face';
import { craftTitle } from '../../utils';
import { displayMakerOf } from '../../lib/maker-subjects';
import { DepthMark } from '../../components/marks';
import DecisionLine from '../../components/DecisionLine';
import { RoomHead } from '../head';
import {
  bidPlan, budgetBuys, readerMarkets, winTotals, basisMix, nightLabel, isoDayOf,
  BASIS_TAG, BASIS_TEXT, BUYS_WINDOW_DAYS, type BidPlan, type PlanRow, type PlanNight, type BuyRow,
} from './budget';
import './budget.css';

export const SECTION_ID = 'budget';

/** the quick start's own floor words (QuickStart.tsx fmtFloor) */
const fmtFloor = (n: number) => (n >= 1000 ? `$${n / 1000}K+` : `$${n}+`);

/** what the rail shows for this section */
export function meta(desk: DeskData): SectionMeta {
  const stated = priceText(desk.price);
  const live = desk.saved.filter(l => l.status === 'upcoming').length;
  const hasTaste = (desk.taste?.seeds.length ?? 0) > 0 || desk.follows.length > 0;
  return { id: SECTION_ID, label: 'Budget', count: stated ?? (live || null), quiet: !stated && live === 0 && !hasTaste };
}

const whoOf = (l: AuctionLot): string | null => displayMakerOf(l)?.name ?? null;

function BandEditor({ desk, act, onDone }: SectionProps & { onDone?: () => void }) {
  const { minUsd, maxUsd } = desk.price ?? { minUsd: null, maxUsd: null };
  const set = (next: { minUsd?: number | null; maxUsd?: number | null }) => {
    let lo = next.minUsd !== undefined ? next.minUsd : minUsd;
    let hi = next.maxUsd !== undefined ? next.maxUsd : maxUsd;
    if (lo != null && hi != null && hi <= lo) hi = null;
    act.setPrice({ minUsd: lo, maxUsd: hi });
  };
  return (
    <div className="ck-budget-band" role="group" aria-label="Your budget band">
      <div className="ck-budget-band-row">
        <span className="kicker">At least</span>
        <button type="button" className="ray-toolbar-pill" data-active={minUsd == null} aria-pressed={minUsd == null} onClick={() => set({ minUsd: null })}>Any</button>
        {VALUE_FLOORS.map(v => (
          <button key={v} type="button" className="ray-toolbar-pill" data-active={minUsd === v} aria-pressed={minUsd === v}
            onClick={() => set({ minUsd: minUsd === v ? null : v })}>{fmtFloor(v)}</button>
        ))}
      </div>
      <div className="ck-budget-band-row">
        <span className="kicker">Up to</span>
        <button type="button" className="ray-toolbar-pill" data-active={maxUsd == null} aria-pressed={maxUsd == null} onClick={() => set({ maxUsd: null })}>Any</button>
        {VALUE_CEILINGS.map(v => (
          <button key={v} type="button" className="ray-toolbar-pill" data-active={maxUsd === v} aria-pressed={maxUsd === v}
            disabled={minUsd != null && v <= minUsd}
            onClick={() => set({ maxUsd: maxUsd === v ? null : v })}>{fmtCeiling(v)}</button>
        ))}
        {onDone && <button type="button" className="ray-toolbar-pill" style={{ marginLeft: 'auto' }} onClick={onDone}>Done</button>}
      </div>
    </div>
  );
}

function PlanRowView({ r, now }: { r: PlanRow; now: number }) {
  const who = whoOf(r.lot);
  const when = decisionOf(r.lot, now, r.face).when;
  const tag = BASIS_TAG[r.basis];
  return (
    <Link href={`/lot?id=${encodeURIComponent(r.lot.id)}`} className="ck-read" role="listitem" data-nav-row
      title={`${tag}: ${BASIS_TEXT[r.basis]}${r.oneSided ? ' (one published side)' : ''} · ${fmtFace(r.allIn)} all-in at ${r.premiumPct}% premium`}>
      <span className="ck-tag" data-tone={r.belowPct != null ? 'up' : r.basis === 'max' ? 'hot' : undefined}>{tag}</span>
      <span className="ck-read-title">{craftTitle(r.lot.title, r.lot.auctionHouse)}</span>
      <span className="ck-read-fact">
        {who ? <>{who} · </> : null}{r.lot.auctionHouse}
        {r.belowPct != null && <> · {r.face.call!.text} below market</>}
        {when && <> · {when.text}</>}
      </span>
      <span className="ck-budget-fig">
        {fmtFace(r.hammer)}
        <span className="sub">{fmtFace(r.allIn)} all-in · {r.premiumPct}%</span>
      </span>
    </Link>
  );
}

function NightView({ n, plan, now }: { n: PlanNight; plan: BidPlan; now: number }) {
  const label = n.day ? nightLabel(n.day, now) : 'No close date';
  return (
    <div className="ck-budget-night">
      <div className="ck-reads-head">
        <span className="kicker">{label}</span>
        <i className="ck-reads-rule" />
        <span className="ck-budget-night-figs" data-over={n.over != null ? '' : undefined}>
          {n.rows.length} {n.rows.length === 1 ? 'lot' : 'lots'} · <b>{fmtFace(n.total)}</b> at hammer · {fmtFace(n.totalAllIn)} all-in
        </span>
      </div>
      <div role="list" aria-label={`${label} bid plan`}>
        {n.rows.map(r => <PlanRowView key={r.lot.id} r={r} now={now} />)}
      </div>
      {n.over != null && plan.ceiling != null && (
        <p className="ck-budget-over">
          <b>{fmtFace(n.over)} over</b> your {fmtFace(plan.ceiling)} ceiling at hammer.
          {n.drops.length > 0 && (
            <> To fit, drop first{' '}
              {n.drops.map((d, i) => (
                <React.Fragment key={d.lot.id}>
                  {i > 0 && ', then '}
                  <em>{craftTitle(d.lot.title, d.lot.auctionHouse)}</em> ({fmtFace(d.hammer)} {BASIS_TAG[d.basis].toLowerCase()}{d.edge > 0 ? ', flagged' : d.edge < 0 ? ', above market' : ', no edge'})
                </React.Fragment>
              ))}
              {' '}→ {n.kept > 0
                ? <>{fmtFace(n.afterDrops)}, {n.kept} {n.kept === 1 ? 'lot stays' : 'lots stay'}</>
                : <>$0 — nothing on this night fits under {fmtFace(plan.ceiling)} on its own</>}. A suggestion — nothing leaves your desk.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function BuyRowView({ r, now, saved, onWatch }: { r: BuyRow; now: number; saved: boolean; onWatch: () => void }) {
  const who = whoOf(r.lot);
  const comps = r.face.comps;
  return (
    <div className="ck-budget-buy">
      <Link href={`/lot?id=${encodeURIComponent(r.lot.id)}`} className="ck-read" role="listitem" data-nav-row data-decision
        title={r.call.derivation ? `${r.call.text}: ${r.call.derivation}${r.call.net ? ` · ${r.call.net}` : ''}` : undefined}>
        <span className="ck-tag" data-tone="up">{r.call.text} below</span>
        <span className="ck-read-title">{craftTitle(r.lot.title, r.lot.auctionHouse)}</span>
        <span className="ck-read-fact" style={{ whiteSpace: 'normal' }}>
          {who ? <>{who} · </> : null}{r.lot.auctionHouse}
          {comps && <> · comps median {comps.text} · {comps.sub.replace(/^weighted · /, '')}</>}
        </span>
        <span style={{ flex: '1 1 100%', minWidth: 0 }}>
          <DecisionLine lot={r.lot} nowMs={now} abstain="quiet" />
        </span>
      </Link>
      <button type="button" className="ray-toolbar-pill" data-active={saved} aria-pressed={saved} onClick={onWatch}
        aria-label={saved ? `Stop watching ${craftTitle(r.lot.title, r.lot.auctionHouse)}` : `Watch ${craftTitle(r.lot.title, r.lot.auctionHouse)}`}>
        {saved ? 'Watching' : 'Watch'}
      </button>
    </div>
  );
}

export default function BudgetDesk(props: SectionProps) {
  const { desk, act } = props;
  const now = desk.now;
  const stated = priceText(desk.price);
  const [editing, setEditing] = useState(false);
  const plan = useMemo(() => bidPlan(desk.saved, now, desk.price), [desk.saved, now, desk.price]);
  const markets = useMemo(() => readerMarkets(desk.taste, desk.follows, desk.book), [desk.taste, desk.follows, desk.book]);
  const buys = useMemo(() => budgetBuys(desk.book, now, desk.price, markets, desk.savedIds), [desk.book, now, desk.price, markets, desk.savedIds]);
  const win = useMemo(() => winTotals(plan), [plan]);
  const live = plan.rows.length + plan.unpriced.length;
  // the markets in words; past four the list is the desk's whole spread
  const marketWords = !buys.markets.length ? 'every market'
    : buys.markets.length > 4 ? `${buys.markets.length} markets you watch`
    : buys.markets.map(m => m === 'tcg' ? 'TCG' : m[0].toUpperCase() + m.slice(1)).join(', ');

  return (
    <section id={SECTION_ID} className="ray-saved-section rail ray-enter" aria-label="Budget desk">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <RoomHead mark={<DepthMark size={17} />} title="Budget desk" style={{ marginBottom: 14 }}
          help={{ name: 'Budget desk', body: <>
            <b>Your band</b> is the price range you stated in the quick start — hammer basis, before the buyer&rsquo;s premium; lectr never
            infers one. <b>Bid plan</b> lists every live lot you watch by the night it closes, each at one hammer figure: the engine&rsquo;s
            <b> max bid</b> (its walk-away) where it has one; otherwise the house <b>estimate midpoint</b>, a bid room&rsquo;s <b>projected
            close</b>, the <b>lectr value</b> or the bare <b>live bid</b> — the tag says which. A night&rsquo;s sum is read against your
            ceiling; over it, the desk suggests what to drop first (least edge, then the lots the engine did not price, biggest first) and
            moves nothing. <b>What your budget buys</b> is the engine&rsquo;s Below Market flags in your markets, inside your band, closing within
            {' '}{BUYS_WINDOW_DAYS} days, in the one flagged order. <b>If you win</b> grosses each figure to all-in with that house&rsquo;s own
            premium schedule on the sale date. A lot with no estimate, bid or engine read is listed unpriced, never summed.
          </> }}
          sub={<>
            {stated ? <>Band {stated} at hammer</> : <>No budget stated</>}
            {live > 0 && <> · {live} live {live === 1 ? 'lot' : 'lots'} watched · <span className="ck-wide">plan </span>{fmtFace(plan.total)} at hammer across {plan.nights.length} {plan.nights.length === 1 ? 'night' : 'nights'}</>}
            {plan.overNights > 0 && <> · {plan.overNights} {plan.overNights === 1 ? 'night' : 'nights'} over</>}
          </>}
          actions={stated && !editing ? <button type="button" className="ray-toolbar-pill ck-tune" onClick={() => setEditing(true)}>Edit band</button> : undefined} />

        {(!stated || editing) && (
          <>
            {!stated && <p className="ck-budget-empty">Pick a floor and a ceiling — <b>one tap</b> — and the plan reads against it. Until then every figure below is labelled by what it is, with no ceiling line.</p>}
            <BandEditor {...props} onDone={stated ? () => setEditing(false) : undefined} />
          </>
        )}

        <div className="ck-gauge ck-budget-gauge" role="list" aria-label="Budget figures">
          <div className="ck-gauge-cell" role="listitem" title={stated ? 'Your stated range — hammer basis (the quick start)' : 'No price range stated'}>
            <span className="ck-gauge-v">{stated ?? '—'}</span>
            <span className="ck-gauge-s">{stated ? 'your band · hammer basis' : 'no band stated'}</span>
          </div>
          <div className="ck-gauge-cell" role="listitem" title={plan.rows.length ? basisMix(plan.rows) : 'nothing live on the desk'}>
            <span className="ck-gauge-v">{plan.rows.length ? fmtFace(plan.total) : '—'}</span>
            <span className="ck-gauge-s">{plan.rows.length ? <>bid plan at hammer · {plan.nMax} at max bid, {plan.nOther} labelled</> : 'bid plan · nothing live'}</span>
          </div>
          <div className="ck-gauge-cell" role="listitem" title="Every plan figure × its house premium, summed">
            <span className="ck-gauge-v">{plan.rows.length ? fmtFace(win.allIn) : '—'}</span>
            <span className="ck-gauge-s">{plan.rows.length ? <>if you win, all-in · {fmtFace(win.premiums)} premiums{win.premiumPct != null ? ` (${win.premiumPct}%)` : ''}</> : 'if you win · all-in'}</span>
          </div>
          <div className="ck-gauge-cell" role="listitem" title={`Below Market flags in ${marketWords}${buys.banded ? ' inside your band' : ''}, closing within ${BUYS_WINDOW_DAYS} days`}>
            <span className="ck-gauge-v">{buys.candidates}</span>
            <span className="ck-gauge-s">below market this week · {marketWords}{buys.banded ? ' · in band' : ''}</span>
          </div>
        </div>

        {/* ── Bid plan ── */}
        <div className="ck-subroom">
          <div>
            <RoomHead level={3} title="Bid plan" style={{ marginBottom: 10 }}
              sub={plan.rows.length
                ? <>{plan.rows.length} {plan.rows.length === 1 ? 'lot' : 'lots'} by close night · {basisMix(plan.rows)}{plan.ceiling != null ? <> · ceiling {fmtFace(plan.ceiling)} a night</> : <> · no ceiling stated</>}</>
                : <>Nothing you watch is on the block{desk.fullError ? ' — the archive did not arrive, so settled saves are unresolved' : ''}. Save a lot anywhere on lectr and it lands here under its close night.</>} />
            {plan.nights.map(n => <NightView key={n.day || 'none'} n={n} plan={plan} now={now} />)}
            {plan.unpriced.length > 0 && (
              <p className="ck-budget-empty">
                Unpriced, not summed: {plan.unpriced.map((l, i) => (
                  <React.Fragment key={l.id}>{i > 0 && ', '}<Link href={`/lot?id=${encodeURIComponent(l.id)}`}>{craftTitle(l.title, l.auctionHouse)}</Link></React.Fragment>
                ))} — no estimate, bid or engine read on the lot.
              </p>
            )}
          </div>
        </div>

        {/* ── What your budget buys this week ── */}
        <div className="ck-subroom">
          <div>
            <RoomHead level={3} title="What your budget buys this week" style={{ marginBottom: 10 }}
              sub={<>
                Below Market by the engine · {marketWords}{buys.banded ? <> · inside {stated}</> : <> · every price (no band stated)</>} · closing by {nightLabel(isoDayOf(now + BUYS_WINDOW_DAYS * 864e5), now)}
                {buys.candidates > buys.rows.length && <> · top {buys.rows.length} of {buys.candidates}</>}
              </>} />
            {buys.rows.length ? (
              <div role="list" aria-label="Below-market lots inside your budget this week">
                {buys.rows.map(r => (
                  <BuyRowView key={r.lot.id} r={r} now={now} saved={desk.savedIds.has(r.lot.id)} onWatch={() => act.toggleSave(r.lot)} />
                ))}
              </div>
            ) : (
              <p className="ck-budget-empty">
                No Below Market flag in {marketWords}{buys.banded ? ` inside ${stated}` : ''} closes within {BUYS_WINDOW_DAYS} days
                {desk.book.length === 0 ? ' — the live book has not landed' : ''}. The flag is the engine&rsquo;s call; a quiet week is a quiet week.
              </p>
            )}
          </div>
        </div>

        {/* ── If you win ── */}
        <div className="ck-subroom ck-budget-win">
          <div>
            <RoomHead level={3} title="If you win" style={{ marginBottom: 10 }}
              sub={win.rows.length
                ? <>Each plan figure grossed to all-in with its house&rsquo;s buyer&rsquo;s premium on the sale date · {fmtFace(win.premiums)} in premiums on {fmtFace(win.hammer)} at hammer{win.premiumPct != null ? ` (${win.premiumPct}%)` : ''}</>
                : <>Nothing live to gross up — the plan is empty.</>} />
            {win.rows.length > 0 && (
              <div role="list" aria-label="All-in cost if you win every plan lot">
                {win.rows.map(r => (
                  <div className="ns-ledger-row" role="listitem" key={r.lot.id}>
                    <span className="ck-budget-win-main">
                      <Link href={`/lot?id=${encodeURIComponent(r.lot.id)}`} className="ck-budget-win-title">{craftTitle(r.lot.title, r.lot.auctionHouse)}</Link>
                      <span className="ck-budget-win-house">{r.lot.auctionHouse} · {r.premiumPct}% premium · {BASIS_TAG[r.basis].toLowerCase()}</span>
                    </span>
                    <span className="ck-budget-fig">{fmtFace(r.hammer)} → {fmtFace(r.allIn)}</span>
                  </div>
                ))}
                <div className="ns-ledger-row ck-budget-sum" role="listitem">
                  <span className="ck-budget-win-main">All {win.rows.length} {win.rows.length === 1 ? 'lot' : 'lots'} · at hammer → all-in{plan.ceiling != null && win.rows.length > 1 ? <span className="ck-budget-win-house"> · your ceiling is per night, not per week</span> : null}</span>
                  <span className="ck-budget-fig">{fmtFace(win.hammer)} → {fmtFace(win.allIn)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
