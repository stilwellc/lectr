'use client';
/**
 * HOW YOUR PICKS DID (N4, Oct 11 2026) — the picks lectr showed this reader
 * (app/lib/pick-log, on this device), once they closed: what each sold for
 * against the lectr value printed when it was shown, and against the house
 * estimate then — the ones the reader saved, then the ones they passed on.
 * One summary line over the last 30 days, its medians n-gated.
 *
 * Composable: one self-contained section (reads the log, the saves, the
 * loaded book; fetches the sold ledger only when a closed pick needs it).
 * Renders nothing until at least one logged pick has closed.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuctionLot } from '../types';
import { DeskRow } from './desk/row';
import { useAccount } from '../lib/account';
import { useSoldLedger, type LedgerEntry } from '../hooks/useRayData';
import {
  readPicks, resolvePicks, needsLedger, summarizeOutcomes, PICKS_KEY, OUTCOME_MIN_N, OUTCOME_WINDOW_DAYS,
  type PickEntry, type PickOutcome, type OutcomeSummary,
} from '../lib/pick-log';
import { SIGNALS_EVENT } from '../lib/recs-signals';
import { fmtFace, FACE_LABEL } from '../lib/lot-face';
import { displayMakerOf } from '../lib/maker-subjects';
import { HorizonMark } from '../components/marks';
import { fmtSignedPct } from '../utils';
import { RoomHead } from './head';
import { useStalled } from './stall';

/** the log, read on mount (null until then — no hydration mismatch), again
 *  on a clear here or a write in another tab */
function usePickLog(): PickEntry[] | null {
  const [picks, setPicks] = useState<PickEntry[] | null>(null);
  const reread = useCallback(() => setPicks(readPicks().picks), []);
  useEffect(() => {
    reread();
    const onChange = (e: Event) => { if ((e as CustomEvent<{ live?: boolean }>).detail?.live) reread(); };
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === PICKS_KEY) reread(); };
    window.addEventListener(SIGNALS_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener(SIGNALS_EVENT, onChange); window.removeEventListener('storage', onStorage); };
  }, [reread]);
  return picks;
}

type LedgerState = { ledger: Map<string, LedgerEntry>; loaded: boolean; error: boolean };
function LedgerGate({ onState }: { onState: (s: LedgerState) => void }) {
  const { ledger, ledgerLoaded, ledgerError } = useSoldLedger();
  useEffect(() => { onState({ ledger, loaded: ledgerLoaded, error: ledgerError }); }, [ledger, ledgerLoaded, ledgerError, onState]);
  return null;
}

const pctTone = (p: number | null): React.CSSProperties =>
  p == null ? { color: 'var(--color-text-faint)' }
    : { color: p > 0 ? 'var(--color-up)' : p < 0 ? 'var(--color-down-text)' : 'var(--color-text-muted)', fontWeight: 700 };

const shortDay = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const dayText = (d?: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

/** "shown Oct 3 · #2 · opened · Not for me" — what lectr did and what the reader did */
function shownLine(o: PickOutcome): string {
  const p = o.pick;
  return [
    `shown ${shortDay(p.t0)}${p.d > 1 ? ` (${p.d} days)` : ''}`,
    `pick #${p.r}`,
    o.won ? 'you won it' : null,
    p.x ? 'Not for me' : p.m ? 'More like this' : null,
    p.o ? 'opened' : null,
  ].filter(Boolean).join(' · ');
}

function soldCell(o: PickOutcome): React.ReactNode {
  if (o.state === 'settling') return <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }} title="Sold — final price settling; the house posts results shortly after the close.">settling…</span>;
  if (o.state === 'unsold') return <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>{o.why === 'withdrawn' ? 'withdrawn' : 'bought in'}</span>;
  return fmtFace(o.price!);
}

/** (THE DESK v4) the outcome as the desk's one row: the sold price is the
 *  figure (its day under), what lectr said then and how the sale landed
 *  against it (the lamp's ink) on the meta line */
function OutcomeRow({ o }: { o: PickOutcome }) {
  const p = o.pick;
  // the maker or the lot's subject (a Goldin card names its player, never
  // the "Sports Cards" bucket) — nothing when neither is known
  const maker = displayMakerOf(p.lot as unknown as AuctionLot)?.name ?? null;
  const est = p.est ? `${fmtFace(p.est[0])}–${fmtFace(p.est[1])}` : null;
  return (
    <DeskRow lot={{ id: p.id, title: p.lot.title, auctionHouse: p.lot.auctionHouse }} who={maker || p.lot.title} wrap
      sub={<>{maker ? `${maker} · ` : ''}{shownLine(o)}</>}
      figureKind="hammer" figure={soldCell(o)} figureSub={dayText(o.date) || null}
      meta={<>
        <span className="dk-meta-fact" title={p.v ? `lectr value when shown, all-in (expected hammer ${fmtFace(p.v.h)} · likely ${fmtFace(p.v.lo)}–${fmtFace(p.v.hi)} hammer · ${p.v.c} confidence)` : 'The engine made no value call on this lot'}>
          {p.v ? <>{FACE_LABEL.value} <b>{fmtFace(p.v.a)}</b> then{o.inRange != null && <> · {o.inRange ? 'in' : 'out of'} range</>}</> : <>no lectr value then</>}
          {o.vsValue != null && <> · <b style={pctTone(Math.round(o.vsValue))} title="Sold price vs the lectr value shown, both all-in">{fmtSignedPct(Math.round(o.vsValue))}</b> vs lectr</>}
        </span>
        {est && (
          <span className="dk-meta-fact" title="The house estimate when lectr showed the pick">
            est. {est} then
            {o.vsEst != null && <> · <b style={pctTone(Math.round(o.vsEst))} title="Sold price vs the estimate midpoint when shown">{fmtSignedPct(Math.round(o.vsEst))}</b> vs est</>}
          </span>
        )}
      </>} />
  );
}

/** newest close first: the result's day, else the close's */
const dayKey = (o: PickOutcome) => o.date || (o.closeMs != null ? new Date(o.closeMs).toISOString().slice(0, 10) : '');

const PAGE = 3;
function OutcomeGroup({ label, rows, note }: { label: string; rows: PickOutcome[]; note?: string }) {
  const [shown, setShown] = useState(PAGE);
  if (!rows.length) return null;
  const vis = rows.slice(0, shown);
  return (
    <div style={{ marginTop: 18 }}>
      <div className="ck-reads-head"><span className="kicker">{label} · {rows.length}</span><i className="ck-reads-rule" /></div>
      {note && <p className="ck-sig-note" style={{ margin: '4px 0 8px' }}>{note}</p>}
      <div className="dk-list" style={{ marginTop: 4 }}>
        {vis.map(o => <OutcomeRow key={o.pick.id} o={o} />)}
      </div>
      {shown < rows.length && (
        <div className="ck-more-row" style={{ marginTop: 14 }}>
          <button className="ray-show-more" onClick={() => setShown(s => s + 6)}>
            Show more ({rows.length - shown} more)
          </button>
        </div>
      )}
    </div>
  );
}

/** "Your picks, past 30 days: 9 settled · median closed −12% vs what lectr
 *  projected (7 with a value) · 5 of 7 inside the likely range · you saved 3" */
export function summaryLine(s: OutcomeSummary): string | null {
  if (s.n === 0) return null;
  const bits: string[] = [`${s.n} settled`];
  if (s.medVsValue != null) {
    bits.push(`median closed ${fmtSignedPct(Math.round(s.medVsValue))} vs what lectr projected (${s.nValue} with a value)`);
    if (s.inRange != null) bits.push(`${s.inRange} of ${s.nValue} inside the likely range`);
  } else if (s.nValue > 0) {
    bits.push(`${s.nValue} with a lectr value — the median vs projection prints at ${OUTCOME_MIN_N}`);
  } else {
    bits.push('none had a lectr value when shown');
  }
  if (s.medVsEst != null) bits.push(`median ${fmtSignedPct(Math.round(s.medVsEst))} vs estimate (${s.nEst})`);
  bits.push(`you saved ${s.saved}${s.won ? `, won ${s.won}` : ''}`);
  return bits.join(' · ');
}

export default function PickOutcomes({ book }: { book: readonly AuctionLot[] }) {
  const picks = usePickLog();
  const { isSaved, savedMeta } = useAccount();
  const rowOf = useMemo(() => {
    const m = new Map<string, AuctionLot>();
    if (picks?.length) {
      const ids = new Set(picks.map(p => p.id));
      for (const l of book) if (ids.has(l.id) || ids.has(l.id.endsWith('~') ? l.id.slice(0, -1) : `${l.id}~`)) m.set(l.id, l);
    }
    return (id: string) => m.get(id);
  }, [book, picks]);
  // the day, as state: outcomes re-cut when the clock passes a close
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 10 * 60_000); return () => window.clearInterval(t); }, []);
  const wantLedger = !!picks && needsLedger(picks, rowOf, now);
  const [ledger, setLedger] = useState<LedgerState>({ ledger: new Map(), loaded: false, error: false });
  const onLedger = useCallback((s: LedgerState) => setLedger(s), []);
  // the sold record has a deadline: past it the room stops saying "Reading…"
  // and says the record is slow (it still lands in place when it answers)
  const ledgerSlow = useStalled(wantLedger && !ledger.loaded && !ledger.error);

  const outs = useMemo(() => (picks ? resolvePicks(picks, {
    rowOf,
    hitOf: id => ledger.ledger.get(id) ?? null,
    isSaved,
    isOwned: id => savedMeta[id]?.owned === true,
  }, now) : []), [picks, rowOf, ledger, isSaved, savedMeta, now]);

  const closed = useMemo(() => outs
    .filter(o => o.state === 'sold' || o.state === 'settling' || o.state === 'unsold')
    .sort((a, b) => dayKey(b).localeCompare(dayKey(a)) || (b.closeMs ?? 0) - (a.closeMs ?? 0)),
  [outs]);
  const pending = outs.filter(o => o.state === 'pending');
  const summary = useMemo(() => summarizeOutcomes(outs, now), [outs, now]);
  const line = summaryLine(summary);
  const saved = closed.filter(o => o.saved);
  const passed = closed.filter(o => !o.saved);
  const open = outs.filter(o => o.state === 'open').length;

  const gate = wantLedger ? <LedgerGate onState={onLedger} /> : null;
  if (!picks || (!closed.length && !pending.length)) return gate;
  const waiting = wantLedger && !ledger.loaded && !ledger.error && !ledgerSlow;

  return (
    <section id="pick-outcomes" className="ck-subroom rail ray-enter" aria-label="How your picks did">
      {gate}
      <div>
        <RoomHead level={3} mark={<HorizonMark size={15} />} title="How your picks did"
          help={{ name: 'How your picks did', body: <>            Every pick lectr shows you here or in home&rsquo;s For you is noted <b>on this device</b> with what lectr said
            about it at the time — its <b>lectr value</b> (the engine&rsquo;s expected price, all-in, and its likely range),
            the house estimate and the live bid, as last shown before the close. When the lot closes, its result is read
            from lectr&rsquo;s sold record. <b>vs lectr</b> is the sold price against that lectr value, both all-in;
            <b> vs est</b> is the sold price against the estimate midpoint (the site&rsquo;s one &ldquo;vs est&rdquo;).
            <b> In range</b> means the sold price, read as a hammer, landed inside the likely range. Picks you saved are
            listed apart from the ones you passed on. A median prints only once {OUTCOME_MIN_N} settled picks carry a
            lectr value; a price still settling, a lot bought in and a lot with no result yet never enter it. Outcomes do
            not steer your picks — a pick you won already counts as owned. Kept in this browser, never uploaded;
            &ldquo;Clear&rdquo; under Your signals empties it.
          </> }}
          sub={<>{picks.length} {picks.length === 1 ? 'pick' : 'picks'} noted on this device{open ? <> · {open} still open</> : null}</>} />
        <p className="ck-outcome-line">
          {line
            ? <><b>Past {OUTCOME_WINDOW_DAYS} days:</b> {line}</>
            : waiting ? 'Reading results for the picks that closed…'
              : <>No pick has a final result in the past {OUTCOME_WINDOW_DAYS} days yet.</>}
        </p>
        {ledger.error && <p className="ck-sig-note">Couldn&apos;t load lectr&rsquo;s sold record — some results may be missing.</p>}
        {ledgerSlow && <p className="ck-sig-note">lectr&rsquo;s sold record is slow to arrive — results for the picks that closed land here when it answers.</p>}
        <OutcomeGroup label="You saved" rows={saved} />
        <OutcomeGroup label="You passed" rows={passed} />
        {pending.length > 0 && (
          <p className="ck-sig-note" style={{ marginTop: 16 }}>
            {pending.length} more {pending.length === 1 ? 'pick has' : 'picks have'} closed with no result on file yet{waiting ? ' (still reading)' : ''} — {pending.length === 1 ? 'it lands' : 'they land'} here when the house posts.
          </p>
        )}
      </div>
    </section>
  );
}
