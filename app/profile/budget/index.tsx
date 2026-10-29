'use client';
/**
 * THE BUDGET DESK (#budget) — THE DESK v3 §5 (Oct 11 2026).
 *
 * The question it answers: "what can I actually bid this week, and what
 * will it cost me if I win?" Two reads under the reader's stated band:
 *
 *   Bid plan        the live watches by close night, each at ONE hammer
 *                   figure with its all-in beside it (the engine's max bid,
 *                   else the ranker's labelled anchor — budget.ts planRowOf).
 *                   A night SUMS the rows priced by the engine or the room;
 *                   an estimate-midpoint row is listed as "no max bid yet —
 *                   the estimate midpoint would be $X" and joins the sum only
 *                   under the "Show estimate midpoints in the plan" toggle
 *                   (R1#7); a one-sided estimate prints "from $X" and never
 *                   sums (R4#3, R4#10). Over the ceiling, the night says by
 *                   how much and which rows to drop first (a suggestion,
 *                   nothing moves). The premium sum closes the plan — "If
 *                   you win" lives in the rows now (R1#17), not a second list.
 *   What your budget buys this week
 *                   the engine's Below Market flags in the reader's markets,
 *                   inside the band, closing within 7 days — dealScore order.
 *                   Before a market is stated: one row per market (R3#7).
 *
 * Honest by construction: no band stated → the desk asks for one (the
 * quick start's own floor/ceiling steps, one tap, act.setPrice) and prints
 * the plan with no ceiling line — every figure still labelled by what it is.
 * One clock: desk.now. Money: fmtFace. Every figure is budget.ts's.
 *
 * (THE DESK v4, Oct 29 2026) a plan row and a buy row are the desk's one
 * row (../desk/row DeskRow): the figure is your max / the plan figure with
 * its all-in ("$1.2K → $1.4K" · "all-in · 25% premium"), the basis as the
 * tag; a buy row's figure is the lot's price, the engine's flag its tag,
 * Watch its action.
 */
import { DeskRow, priceFigureOf } from '../desk/row';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { SectionProps, SectionMeta, DeskData } from '../desk/types';
import type { AuctionLot } from '../../types';
import { VALUE_FLOORS, VALUE_CEILINGS, fmtCeiling } from '../../lib/feed-filters';
import { priceText } from '../../lib/interests';
import { fmtFace, decisionOf } from '../../lib/lot-face';
import { shortTitle } from '../../lib/recs';
import { displayMakerOf } from '../../lib/maker-subjects';
import { DepthMark } from '../../components/marks';
import { RoomHead } from '../head';
import {
  bidPlan, budgetBuys, marketTease, readerMarkets, winTotals, basisMix, nightLabel, isoDayOf, rowTag,
  BASIS_TEXT, BUYS_WINDOW_DAYS, TEASE_MIN_N, type BidPlan, type PlanRow, type PlanNight, type BuyRow,
} from './budget';
import { oneSidedText } from './priced';
import './budget.css';

export const SECTION_ID = 'budget';

/** the quick start's own floor words (QuickStart.tsx fmtFloor) */
const fmtFloor = (n: number) => (n >= 1000 ? `$${n / 1000}K+` : `$${n}+`);

/** on-device: the estimate-midpoint toggle */
const EST_KEY = 'lectr-budget-estmid';
/** the phone's folds (Watching's PHONE_ROWS grammar): rows open per night, nights open */
const PHONE_ROWS = 3;
const PHONE_NIGHTS = 2;

/** what the rail shows for this section */
export function meta(desk: DeskData): SectionMeta {
  const stated = priceText(desk.price);
  const live = desk.saved.filter(l => l.status === 'upcoming').length;
  const hasTaste = (desk.taste?.seeds.length ?? 0) > 0 || desk.follows.length > 0;
  return { id: SECTION_ID, label: 'Budget', count: stated ?? (live || null), quiet: !stated && live === 0 && !hasTaste };
}

const whoOf = (l: AuctionLot): string | null => displayMakerOf(l)?.name ?? null;
const lotHref = (l: AuctionLot) => `/lot?id=${encodeURIComponent(l.id)}`;
/** "tonight" / "tomorrow" mid-sentence; a dated night keeps its capitals ("Wed Oct 14") */
const soonestWord = (label: string) => (label === 'Tonight' || label === 'Tomorrow' ? label.toLowerCase() : label);
const marketWord = (m: string) => (m === 'tcg' ? 'TCG' : m === 'culture' ? 'Pop Culture' : m[0].toUpperCase() + m.slice(1));

/** a flag remembered on this device (SSR-safe: the stored value lands after mount) */
function useStoredFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(initial);
  useEffect(() => { try { const s = localStorage.getItem(key); if (s != null) setV(s === '1'); } catch { /* private mode */ } }, [key]);
  const set = (next: boolean) => { setV(next); try { localStorage.setItem(key, next ? '1' : '0'); } catch { /* private mode */ } };
  return [v, set];
}

function BandEditor({ desk, act, onDone }: SectionProps & { onDone?: () => void }) {
  const { minUsd, maxUsd } = desk.price ?? { minUsd: null, maxUsd: null };
  const set = (next: { minUsd?: number | null; maxUsd?: number | null }) => {
    const lo = next.minUsd !== undefined ? next.minUsd : minUsd;
    let hi = next.maxUsd !== undefined ? next.maxUsd : maxUsd;
    if (lo != null && hi != null && hi <= lo) hi = null;
    act.setPrice({ minUsd: lo, maxUsd: hi });
  };
  return (
    <div className="ck-budget-band" role="group" aria-label="Your budget band">
      <p className="ck-budget-band-note">Same band as your quick start — one setting, hammer basis.</p>
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

/** the row's figure in words — what the plan prints and what its title spells out */
function figureOf(r: PlanRow, estInPlan: boolean): { fig: string; sub: string; fact: string | null; summed: boolean } {
  if (r.oneSided && r.side) {
    return { fig: oneSidedText(r.side, r.hammer, fmtFace), sub: `one side published · ${fmtFace(r.allIn)} all-in`, fact: null, summed: false };
  }
  if (r.basis === 'est' && !estInPlan) {
    return { fig: fmtFace(r.hammer), sub: `est midpoint · ${fmtFace(r.allIn)} all-in`, fact: 'no max yet — set yours on Watching', summed: false };
  }
  return { fig: `${fmtFace(r.hammer)} → ${fmtFace(r.allIn)}`, sub: `all-in · ${r.premiumPct}% premium`, fact: r.basis === 'est' ? 'estimate midpoint, counted at your ask' : null, summed: true };
}

function PlanRowView({ r, now, estInPlan }: { r: PlanRow; now: number; estInPlan: boolean }) {
  const who = whoOf(r.lot);
  const when = decisionOf(r.lot, now, r.face).when;
  const tag = rowTag(r);
  const f = figureOf(r, estInPlan);
  return (
    <DeskRow lot={r.lot} tone={r.belowPct != null ? 'up' : undefined}
      attrs={{ 'data-summed': f.summed ? '' : undefined, title: `${tag}: ${BASIS_TEXT[r.basis]}${r.oneSided ? ' (one published side — never summed)' : ''} · ${fmtFace(r.allIn)} all-in at ${r.premiumPct}% premium` }}
      tag={{ text: tag, tone: r.belowPct != null ? 'up' : r.basis === 'max' || r.basis === 'mine' ? 'hot' : undefined }}
      sub={<>
        {who ? <>{who} · </> : null}{r.lot.auctionHouse}
        {r.belowPct != null && <> · {r.face.call!.text} below market</>}
        {f.fact && <> · {f.fact}</>}
        {when && <> · {when.text}</>}
      </>}
      subText={[who, r.lot.auctionHouse, r.belowPct != null ? `${r.face.call!.text} below market` : null, f.fact, when?.text].filter(Boolean).join(' · ')}
      figure={<span data-quiet={f.summed ? undefined : ''}>{f.fig}</span>} figureKind="plan" figureText={f.fig} figureSub={f.sub} />
  );
}

function OverLine({ n, plan, narrow }: { n: PlanNight; plan: BidPlan; narrow: boolean }) {
  const [open, setOpen] = useState(!narrow);
  if (n.over == null || plan.ceiling == null) return null;
  return (
    <div className="ck-budget-over">
      <p className="ck-budget-over-line">
        <b>{fmtFace(n.over)} over</b> your {fmtFace(plan.ceiling)} ceiling at hammer · {n.nCounted} {n.nCounted === 1 ? 'lot' : 'lots'} summed
        {n.drops.length > 0 && (
          <> · <button type="button" className="ck-budget-link" aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? 'Hide' : 'How to fit'}</button></>
        )}
      </p>
      {open && n.drops.length > 0 && (
        <p className="ck-budget-over-how">
          Drop first{' '}
          {n.drops.map((d, i) => (
            <React.Fragment key={d.lot.id}>
              {i > 0 && ', then '}
              <em>{shortTitle(d.lot.title, d.lot.auctionHouse)}</em> ({fmtFace(d.hammer)} {rowTag(d).toLowerCase()}{d.edge > 0 ? ', flagged' : d.edge < 0 ? ', above market' : ', no edge'})
            </React.Fragment>
          ))}
          {' '}→ {n.kept > 0
            ? <>{fmtFace(n.afterDrops)}, {n.kept} {n.kept === 1 ? 'lot stays' : 'lots stay'}</>
            : <>$0 — nothing summed on this night fits under {fmtFace(plan.ceiling)} on its own</>}. A suggestion — nothing leaves your desk.
        </p>
      )}
    </div>
  );
}

function NightView({ n, plan, now, narrow, open }: { n: PlanNight; plan: BidPlan; now: number; narrow: boolean; open: boolean }) {
  const label = n.day ? nightLabel(n.day, now) : 'No close date';
  const [all, setAll] = useState(false);
  const rows = narrow && !all ? n.rows.slice(0, PHONE_ROWS) : n.rows;
  const folded = n.rows.length - rows.length;
  const apart: string[] = [];
  if (n.nEst > 0 && !plan.estInPlan) apart.push(`+${fmtFace(n.estTotal)} at est midpoint, not counted`);
  if (n.nFrom > 0) apart.push(`from ${fmtFace(n.fromSum)} one-sided, not counted`);
  return (
    <div className="ck-budget-night" data-folded={open ? undefined : ''}>
      <div className="ck-reads-head">
        <span className="kicker">{label}</span>
        <i className="ck-reads-rule" />
        <span className="ck-budget-night-figs" data-over={n.over != null ? '' : undefined}>
          {n.rows.length} {n.rows.length === 1 ? 'lot' : 'lots'}
          {n.nCounted > 0 ? <> · <b>{fmtFace(n.total)}</b> at hammer → {fmtFace(n.totalAllIn)} all-in{n.nCounted < n.rows.length ? ` on ${n.nCounted}` : ''}</> : <> · nothing summed</>}
          {apart.length > 0 && <> · {apart.join(' · ')}</>}
        </span>
      </div>
      {open ? (
        <>
          <div className="dk-list" role="group" aria-label={`${label} bid plan`}>
            {rows.map(r => <PlanRowView key={r.lot.id} r={r} now={now} estInPlan={plan.estInPlan} />)}
          </div>
          {folded > 0 && (
            <button type="button" className="ck-budget-more" onClick={() => setAll(true)}>Show all {n.rows.length} lots</button>
          )}
          <OverLine n={n} plan={plan} narrow={narrow} />
        </>
      ) : null}
    </div>
  );
}

/** the buy row's decision line WITHOUT the engine's "worth up to" (R1#3,
 *  R3#6): beside a "2.1× below" tag the max bid read as a contradiction;
 *  the lane tag's basis (comps median · n) is printed on the fact line
 *  instead. lot-face's DECISION_COMPS_RULE (X5, b136d0c) does the same
 *  swap in decisionOf, but only past 2× with the max bid under half the
 *  median — every row HERE carries the lane tag, so the budget row keeps
 *  the close + the clock only and never prints a worth beside the flag
 *  (nor the comps median twice). Both parts are decisionOf's own. */
function BuyDecision({ lot, now }: { lot: AuctionLot; now: number }) {
  const d = useMemo(() => decisionOf(lot, now), [lot, now]);
  const parts: { text: string; title?: string }[] = [];
  if (d.close) parts.push({ text: d.close.text, title: d.close.title });
  if (d.when) parts.push({ text: d.when.text });
  if (!parts.length) return null;
  return (
    <span className="ray-feedrow-price ck-decision">
      {parts.map((p, i) => (
        <React.Fragment key={i}>{i > 0 && <span aria-hidden style={{ margin: '0 6px' }}>·</span>}<span title={p.title}>{p.text}</span></React.Fragment>
      ))}
    </span>
  );
}

function BuyRowView({ r, now, saved, onWatch }: { r: BuyRow; now: number; saved: boolean; onWatch: () => void }) {
  const who = whoOf(r.lot);
  const comps = r.face.comps;
  const short = shortTitle(r.lot.title, r.lot.auctionHouse);
  const price = priceFigureOf(r.lot);
  return (
    <DeskRow lot={r.lot} tone="up" wrap
      attrs={{ title: r.call.derivation ? `${r.call.text} below market: ${r.call.derivation}${r.call.net ? ` · ${r.call.net}` : ''}` : `${r.call.text} below market — the engine's flag` }}
      tag={{ text: `${r.call.text} below`, tone: 'up' }}
      sub={<>
        {who ? <>{who} · </> : null}{r.lot.auctionHouse}
        {comps && <> · comps median {comps.text} · {comps.n.toLocaleString('en-US')} {comps.n === 1 ? 'sale' : 'sales'}</>}
      </>}
      subText={[who, r.lot.auctionHouse, comps ? `comps median ${comps.text} · ${comps.n.toLocaleString('en-US')} ${comps.n === 1 ? 'sale' : 'sales'}` : null].filter(Boolean).join(' · ')}
      figure={<span data-quiet={price.quiet || undefined}>{price.fig}</span>} figureKind={price.kind} figureText={price.fig} figureSub={price.sub}
      decision={<BuyDecision lot={r.lot} now={now} />}
      action={<button type="button" className="ray-toolbar-pill ck-budget-watch" data-active={saved} aria-pressed={saved} onClick={onWatch}
        aria-label={saved ? `Stop watching ${short}` : `Watch ${short}`}>
        {saved ? 'Watching' : 'Watch'}
      </button>} />
  );
}

export default function BudgetDesk(props: SectionProps) {
  const { desk, act, narrow } = props;
  const now = desk.now;
  const stated = priceText(desk.price);
  const [editing, setEditing] = useState(false);
  const [estInPlan, setEstInPlan] = useStoredFlag(EST_KEY, false);
  const [allNights, setAllNights] = useState(false);
  // your own max leads each row (Oct 20 audit) — the engine's figure stays as context
  const metaFor = desk.metaFor;
  const maxOf = useCallback((id: string) => { const m = metaFor(id)?.maxUsd; return typeof m === 'number' && m > 0 ? m : null; }, [metaFor]);
  const plan = useMemo(() => bidPlan(desk.saved, now, desk.price, { estInPlan }, maxOf), [desk.saved, now, desk.price, estInPlan, maxOf]);
  const markets = useMemo(() => readerMarkets(desk.taste, desk.follows, desk.book), [desk.taste, desk.follows, desk.book]);
  // (perf) the book-wide scans read a 10-minute clock grain, not the 1-minute tick
  const slow = Math.floor(now / 600_000) * 600_000;
  const buys = useMemo(() => budgetBuys(desk.book, slow, desk.price, markets, desk.savedIds), [desk.book, slow, desk.price, markets, desk.savedIds]);
  const tease = useMemo(() => (markets.size === 0 ? marketTease(desk.book, slow, desk.price, desk.savedIds) : []), [markets, desk.book, slow, desk.price, desk.savedIds]);
  const win = useMemo(() => winTotals(plan), [plan]);
  const live = plan.rows.length + plan.unpriced.length;
  // the markets in words: the list up to four, past that the count
  const marketWords = !buys.markets.length ? 'every market'
    : buys.markets.length > 4 ? `${buys.markets.length} markets you watch`
    : buys.markets.map(marketWord).join(', ');
  const openNights = narrow && !allNights ? PHONE_NIGHTS : plan.nights.length;
  const teaseTotal = tease.reduce((s, t) => s + t.n, 0);

  return (
    <section id={SECTION_ID} className="ray-saved-section rail ray-enter" aria-label="Budget desk">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <RoomHead mark={<DepthMark size={17} />} title="Budget desk" style={{ marginBottom: 14 }}
          help={{ name: 'Budget desk', body: <>
            <b>Your band</b> is the price range you stated in the quick start — hammer basis, before the buyer&rsquo;s premium; lectr never
            infers one. <b>Bid plan</b> lists every live lot you watch by the night it closes, each at one hammer figure with its all-in
            beside it (that house&rsquo;s own premium schedule on the sale date): the engine&rsquo;s <b>max bid</b> (its walk-away) where it has
            one; otherwise a bid room&rsquo;s <b>projected close</b>, the <b>lectr value</b> or the bare <b>live bid</b> — the tag says which.
            A night&rsquo;s sum carries those rows only. A lot at the house <b>estimate midpoint</b> is listed as &ldquo;no max bid yet&rdquo; and
            joins the sum only when you switch <b>Show estimate midpoints in the plan</b> on; a one-sided estimate prints <b>from $X</b> and
            never sums. Over your ceiling, the desk suggests what to drop first (least edge, then the lots the engine did not price, biggest
            first) and moves nothing. <b>What your budget buys</b> is the engine&rsquo;s Below Market flags in your markets, inside your band,
            closing within {BUYS_WINDOW_DAYS} days, in the one flagged order — by the engine, not a prediction; before you state a market it
            counts them per market. A lot with no estimate, bid or engine read is listed unpriced, never summed.
          </> }}
          sub={<>
            {stated ? <>Band {stated} at hammer</> : <>No budget stated</>}
            {live > 0 && <> · {live} live {live === 1 ? 'lot' : 'lots'} watched across {plan.nights.length} {plan.nights.length === 1 ? 'night' : 'nights'}</>}
            {plan.overNights > 0 && <> · {plan.overNights} {plan.overNights === 1 ? 'night' : 'nights'} over</>}
          </>}
          actions={stated && !editing ? <button type="button" className="ray-toolbar-pill ck-tune" onClick={() => setEditing(true)}>Edit band</button> : undefined} />

        {/* (pass 5) no band: one quiet line in the room's voice and its one tap — the editor opens on it */}
        {editing ? (
          <BandEditor {...props} onDone={() => setEditing(false)} />
        ) : !stated ? (
          <p className="ck-budget-empty dk-empty">
            No band stated — every figure below is labelled by what it is, with no ceiling line.{' '}
            <button type="button" className="dk-empty-tap" onClick={() => setEditing(true)}>Set a band</button>
          </p>
        ) : null}

        <div className="ck-gauge ck-budget-gauge" role="list" aria-label="Budget figures">
          <div className="ck-gauge-cell" role="listitem" title={stated ? 'Your stated range — hammer basis (the quick start)' : 'No price range stated'}>
            <span className="ck-gauge-v">{stated ?? '—'}</span>
            <span className="ck-gauge-s">{stated ? 'your band · hammer basis' : 'no band stated'}</span>
          </div>
          <div className="ck-gauge-cell" role="listitem" title={plan.nCounted ? basisMix(plan.rows.filter(r => r.counted || (plan.estInPlan && r.basis === 'est' && !r.oneSided))) : 'nothing summed on the desk'}>
            <span className="ck-gauge-v">{plan.nCounted ? fmtFace(plan.total) : '—'}</span>
            <span className="ck-gauge-s">{plan.nCounted ? <>bid plan at hammer · {plan.nCounted} of {plan.rows.length} summed</> : plan.rows.length ? <>bid plan · {plan.rows.length} listed, none summed</> : 'bid plan · nothing live'}</span>
          </div>
          <div className="ck-gauge-cell" role="listitem" title="Every summed figure × its house premium">
            <span className="ck-gauge-v">{plan.nCounted ? fmtFace(win.allIn) : '—'}</span>
            <span className="ck-gauge-s">{plan.nCounted ? <>if you win, all-in · {fmtFace(win.premiums)} premiums{win.premiumPct != null ? ` (${win.premiumPct}%)` : ''}</> : 'if you win · all-in'}</span>
          </div>
          <div className="ck-gauge-cell" role="listitem" title={`Below Market flags in ${marketWords}${buys.banded ? ' inside your band' : ''}, closing within ${BUYS_WINDOW_DAYS} days${tease.length ? ` · comps n ≥ ${TEASE_MIN_N}` : ''}`}>
            <span className="ck-gauge-v">{tease.length ? teaseTotal : buys.candidates}</span>
            <span className="ck-gauge-s">below market this week · {marketWords}{buys.banded ? ' · in band' : ''}</span>
          </div>
        </div>

        {/* ── Bid plan ── */}
        <div className="ck-subroom">
          <div>
            {/* (pass 5) nothing on the block: the plan is one quiet line and its tap, no head */}
            {plan.rows.length === 0 && plan.unpriced.length === 0 ? (
              <p className="dk-empty" style={{ margin: 0 }}>
                Bid plan — nothing you watch is on the block{desk.fullError ? ' (the archive did not arrive, so settled saves are unresolved)' : ''}; a lot saved anywhere on lectr lands here under its close night.{' '}
                <a href="#for-you" className="dk-empty-tap">Watch a lot</a>
              </p>
            ) : (
            <RoomHead level={3} title="Bid plan" style={{ marginBottom: 10 }}
              sub={plan.rows.length
                ? <>
                    {plan.rows.length} {plan.rows.length === 1 ? 'lot' : 'lots'} by close night · {basisMix(plan.rows)}
                    {plan.ceiling != null ? <> · ceiling {fmtFace(plan.ceiling)} a night</> : <> · no ceiling stated</>}
                    {plan.nEst > 0 && <> · {plan.estInPlan ? 'estimate midpoints counted at your ask' : 'estimate midpoints listed in grey, not summed'}</>}
                  </>
                : <>Nothing you watch is on the block{desk.fullError ? ' — the archive did not arrive, so settled saves are unresolved' : ''}. Save a lot anywhere on lectr and it lands here under its close night.</>}
              actions={plan.nEst > 0
                ? <button type="button" className="ray-toolbar-pill ck-tune" data-active={estInPlan} aria-pressed={estInPlan} onClick={() => setEstInPlan(!estInPlan)}>
                    Show estimate midpoints in the plan
                  </button>
                : undefined} />
            )}
            {plan.nights.map((n, i) => (
              <NightView key={n.day || 'none'} n={n} plan={plan} now={now} narrow={narrow} open={i < openNights} />
            ))}
            {plan.nights.length > openNights && (
              <button type="button" className="ck-budget-more" onClick={() => setAllNights(true)} aria-expanded={false}>
                Open all {plan.nights.length} nights{plan.overNights > 0 ? ` · ${plan.overNights} over` : ''}
              </button>
            )}
            {plan.unpriced.length > 0 && (
              <p className="ck-budget-empty">
                Unpriced, not summed: {plan.unpriced.map((l, i) => (
                  <React.Fragment key={l.id}>{i > 0 && ', '}<Link href={lotHref(l)}>{shortTitle(l.title, l.auctionHouse)}</Link></React.Fragment>
                ))} — no estimate, bid or engine read on the lot.
              </p>
            )}
            {plan.rows.length > 0 && (
              <div className="ck-budget-win" role="list" aria-label="If you win every summed lot">
                <div className="ns-ledger-row ck-budget-sum" role="listitem">
                  <span className="ck-budget-win-main">
                    If you win all {win.rows.length} summed {win.rows.length === 1 ? 'lot' : 'lots'} · at hammer → all-in
                    <span className="ck-budget-win-house">
                      {fmtFace(win.premiums)} in buyer&rsquo;s premiums{win.premiumPct != null ? ` (${win.premiumPct}% of hammer)` : ''} · each house&rsquo;s schedule on its sale date
                      {plan.ceiling != null && win.rows.length > 1 ? ' · your ceiling is per night, not per week' : ''}
                    </span>
                  </span>
                  <span className="ck-budget-fig">{fmtFace(win.hammer)} → {fmtFace(win.allIn)}</span>
                </div>
                {plan.nEst > 0 && !plan.estInPlan && (
                  <div className="ns-ledger-row" role="listitem">
                    <span className="ck-budget-win-main">
                      + {plan.nEst} at estimate midpoint, if counted
                      <span className="ck-budget-win-house">not a bid you chose — switch the toggle above to sum them</span>
                    </span>
                    <span className="ck-budget-fig" data-muted="">{fmtFace(plan.estTotal)} → {fmtFace(plan.estAllIn)}</span>
                  </div>
                )}
                {plan.nFrom > 0 && (
                  <div className="ns-ledger-row" role="listitem">
                    <span className="ck-budget-win-main">
                      {plan.nFrom} one-sided {plan.nFrom === 1 ? 'estimate' : 'estimates'}, never summed
                      <span className="ck-budget-win-house">the house published one bound only</span>
                    </span>
                    <span className="ck-budget-fig" data-muted="">from {fmtFace(plan.fromSum)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── What your budget buys this week ── */}
        <div className="ck-subroom">
          <div>
            <RoomHead level={3} title="What your budget buys this week" style={{ marginBottom: 10 }}
              sub={<>
                Below Market by the engine — not a prediction · {marketWords}{buys.banded ? <> · inside {stated}</> : <> · every price (no band stated)</>} · closing by {nightLabel(isoDayOf(now + BUYS_WINDOW_DAYS * 864e5), now)}
                {!tease.length && buys.candidates > buys.rows.length && <> · top {buys.rows.length} of {buys.candidates}</>}
              </>} />
            {tease.length ? (
              <div role="group" aria-label="Below-market lots this week, by market">
                {tease.map(t => (
                  <Link key={t.market} href={`/value/${t.market}`} className="ck-read ck-budget-tease" data-nav-row
                    title={`${t.n} Below Market ${t.n === 1 ? 'flag' : 'flags'} in ${t.label} closing within ${BUYS_WINDOW_DAYS} days, each on a comps pool of ${TEASE_MIN_N}+ sales — the market's value desk`}>
                    <span className="ck-read-title">{t.label}</span>
                    <span className="ck-read-fact">{t.n} below market this week · soonest {soonestWord(nightLabel(isoDayOf(t.soonestMs), now))}</span>
                    <span className="ck-budget-fig" aria-hidden>→</span>
                  </Link>
                ))}
                <p className="ck-budget-empty">Tell the desk your markets — a follow, or the quick start&rsquo;s taps — and this reads them live, lot by lot.</p>
              </div>
            ) : buys.rows.length ? (
              <div className="dk-list" role="group" aria-label="Below-market lots inside your budget this week">
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
      </div>
    </section>
  );
}
