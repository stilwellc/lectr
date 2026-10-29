'use client';
/**
 * NAMES CALENDAR & BLIND SPOTS (THE DESK v3 §7, `#names`, Oct 11 2026).
 *
 * For every name the reader follows, owns or has saved — grouped by market:
 *   the calendar   the sales its live lots sit in (house · sale · when it
 *                  closes · lot count · the estimate band summed over the
 *                  PRICED lots, one-sided estimates apart as "from $X" ·
 *                  live bids · below-market flags), soonest first. The
 *                  estimate fields are USD and are never converted here
 *                  (R4#1 — budget/priced.ts is the one read).
 *   the pulse      the nightly's 12-month median WITH its n and scope, sold
 *                  in the trailing year, the complete-quarter trend, the
 *                  year-over-year only where the build printed one
 *   the blind spot a name with nothing live: last seen sale, where it
 *                  usually sells, Follow when not followed
 *
 * Your market (./YourMarket) already prints what MOVED for these names this
 * week (records, clear YoY moves, below-market flags); this section answers
 * "when do my names next come up, and which have gone quiet" — it links up
 * to #market for the news rather than repeating it.
 *
 * Reads: the page's DeskData only, plus — from two screens out (R3: the
 * sold side used to start reading as the section arrived) — the entities
 * file of each name's market and one detail bucket per name (the shared
 * useEntities caches), at most MAX_READ names, each with a deadline
 * (../stall). One clock: desk.now.
 *
 * Phone (R2): one name open per market, the rest folded behind "Show N
 * more" with their live counts visible; the head reads "Names" with the
 * full title in its sub-line; every tap clears a 40px hit area.
 *
 * (THE DESK v4, Oct 29 2026) a sale is the desk's one row (../desk/row
 * DeskRow): the lot's photo and title (a sale of several lots: its first
 * lots as an overlapping photo stack — the "it's a sale" read — and "N lots
 * · house · sale"), the estimate band / live bids / flags on the sub-line,
 * the close as the figure; Comps (the one-lot sale's modal) or See lots in
 * the action slot.
 */
import { DeskRow, type RowLot } from '../desk/row';
import { Thumb } from '../desk/thumb';
import { imageOf } from '../../lib/house-images';
import { craftTitle } from '../../utils';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../../types';
import type { SectionProps, SectionMeta, DeskData } from '../desk/types';
import { RoomHead } from '../head';
import { withTimeout, READ_DEADLINE_MS } from '../stall';
import { loadEntitySummary, loadEntityDetail, loadEntities, entityDetailFailed } from '../../hooks/useEntities';
import type { EntitySummary, EntityDetail } from '../../lib/entity/model';
import { parseEntityId } from '../../lib/entity/key';
import { pageHrefOf } from '../../lib/entity/kinds';
import { MIN_MED_N } from '../../lib/entity/stats';
import { Spark, sparkTitle } from '../../components/entity/EntityRow';
import { fmtPct, yoyDir, yoyTitle } from '../../lib/entity/ledger';
import { fmtUsd } from '../../lib/fmt-usd';
import { HorizonMark } from '../../components/marks';
import {
  deskNamesOf, groupByMarket, liveLotsOf, salesOf, saleWhen, calendarTotals, pulseOf, sparkSpan,
  blindSpotOf, agoText, namesTotals, orderNames, MAX_READ,
  type DeskName, type Sale, type NameRead, type Pulse, type BlindSpot,
} from './names';
import './names.css';

/* ── the contract ── */

function namesOf(desk: DeskData): DeskName[] {
  return deskNamesOf(desk.follows, desk.collection, desk.saved);
}

/** the rail pill — NONE on a desk without names (R3#4: a quiet "Names"
 *  pill was a dead end; the section returns null too, like Market) */
export function meta(desk: DeskData): SectionMeta | null {
  const n = namesOf(desk).length;
  return n > 0 ? { id: 'names', label: 'Names', count: n, quiet: false } : null;
}

/* ── the sold side (summary + detail per name, with a deadline) ── */

type Sold = { s: EntitySummary | null; d: EntityDetail | null; sparkQ: string[] | null; sFail: boolean; dFail: boolean; slow: boolean };
const SLOW = Symbol('slow');

async function readSold(id: string, ver: string | undefined): Promise<{ now: Sold; late: Promise<Sold> | null }> {
  const market = parseEntityId(id)?.market;
  const fileP = market ? loadEntities(market).catch(() => null) : Promise.resolve(null);
  const sP = loadEntitySummary(id).catch(() => null);
  const dP = loadEntityDetail(id, ver).catch(() => null);
  const settle = (s: EntitySummary | null, d: EntityDetail | null, file: Awaited<typeof fileP> | undefined, sSlow: boolean, dSlow: boolean): Sold => ({
    s, d,
    sparkQ: file?.sparkQ ?? null,
    // no summary AND its market's file never decoded: a failed read, not "none on file"
    sFail: sSlow || (!s && market != null && file === null),
    dFail: dSlow || (!d && entityDetailFailed(id)),
    slow: sSlow || dSlow,
  });
  const [s, d, file] = await Promise.all([
    withTimeout(sP, READ_DEADLINE_MS, SLOW), withTimeout(dP, READ_DEADLINE_MS, SLOW), withTimeout(fileP, READ_DEADLINE_MS, SLOW),
  ]);
  const now = settle(s === SLOW ? null : s, d === SLOW ? null : d, file === SLOW ? undefined : file, s === SLOW, d === SLOW);
  const late = s === SLOW || d === SLOW
    ? Promise.all([sP, dP, fileP]).then(([s2, d2, f2]) => settle(s2, d2, f2, false, false))
    : null;
  return { now, late };
}

function useSoldSide(ids: readonly string[], enabled: boolean, ver?: string): Map<string, Sold> | undefined {
  const key = ids.join('\n');
  const [got, setGot] = useState<{ key: string; m: Map<string, Sold> } | null>(null);
  useEffect(() => {
    if (!enabled || !key) return;
    let on = true;
    const list = key.split('\n');
    Promise.all(list.map(async id => [id, await readSold(id, ver)] as const)).then(rows => {
      if (!on) return;
      setGot({ key, m: new Map(rows.map(([id, r]) => [id, r.now])) });
      for (const [id, r] of rows) {
        r.late?.then(v => { if (on) setGot(g => (g && g.key === key ? { key, m: new Map(g.m).set(id, v) } : g)); });
      }
    });
    return () => { on = false; };
  }, [key, enabled, ver]);
  if (!key) return new Map();
  return got?.key === key ? got.m : undefined;
}

/** a screen or two before the section — the sold side is on file by the time the reader arrives */
const NEAR_MARGIN = '1800px 0px';

/** true once the element is within NEAR_MARGIN of the viewport */
function useNear(): [boolean, (el: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [near, setNear] = useState(() => typeof window !== 'undefined' && typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (near || !el) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setNear(true); }, { rootMargin: NEAR_MARGIN });
    io.observe(el);
    return () => io.disconnect();
  }, [el, near]);
  return [near, setEl];
}

/* ── words ── */

const dayWord = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dayOfMs = (ms: number) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const timeOfMs = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const n2 = (n: number) => n.toLocaleString('en-US');
const pct = (x: number) => `${Math.round(x * 100)}%`;

function hrefOf(n: DeskName, s: EntitySummary | null): string {
  if (n.id) return pageHrefOf(n.id) || s?.page || '/makers';
  const f = n.follow;
  if (f.kind === 'cat') {
    const [cat, sub] = f.key.split(':');
    return `/?${new URLSearchParams({ cat, ...(sub ? { sub } : {}), tab: 'all' }).toString()}`;
  }
  return `/makers/${encodeURIComponent(f.key)}`;
}

function whenText(s: Sale, now: number): { lead: string; sub: string | null; soon: boolean } {
  const w = saleWhen(s.closeMs, now);
  if (w.kind === 'unknown') return { lead: 'Date to come', sub: null, soon: false };
  if (w.kind === 'closed') return { lead: 'Closing', sub: 'results pending', soon: true };
  if (w.kind === 'hours') return { lead: w.hours > 0 ? `in ${w.hours}h ${String(w.minutes).padStart(2, '0')}m` : `in ${w.minutes}m`, sub: s.timed ? timeOfMs(s.closeMs!) : 'end of day', soon: true };
  return { lead: w.days === 1 ? 'Tomorrow' : dayOfMs(w.ms), sub: s.timed ? timeOfMs(w.ms) : w.days === 1 ? dayOfMs(w.ms) : null, soon: false };
}

/** a summed band over the priced lots: "$12K–$18K" — the estimate fields
 *  are USD already; nothing is converted or marked approximate here */
function bandText(lo: number, hi: number): string {
  return lo === hi ? fmtUsd(lo) : `${fmtUsd(lo)}–${fmtUsd(hi)}`;
}

/** "from $700" — the one-sided estimates' published sides, never in the band (R4#10) */
function fromText(from: number, n: number, lots: number): string {
  return `from ${fmtUsd(from)}${n < lots ? ` on ${n}` : ''} (one side published)`;
}

function estText(s: Sale): string {
  const { est, bids, lots } = s;
  const parts: string[] = [];
  if (est.k > 0) parts.push(`est ${bandText(est.lo, est.hi)}${est.k < lots.length ? ` on ${est.k} of ${lots.length}` : ''}`);
  if (est.oneSided > 0) parts.push(fromText(est.from, est.oneSided, lots.length));
  if (bids.n > 0) parts.push(`${fmtUsd(bids.sum)} bid on ${bids.n === lots.length ? (lots.length === 1 ? 'it' : 'all') : bids.n}`);
  if (est.k === 0 && est.oneSided === 0 && bids.n === 0) parts.push('no estimate published');
  return parts.join(' · ');
}

/* ── rows ── */

function PulseLine({ p, label }: { p: Pulse; label: string }) {
  const bits: React.ReactNode[] = [];
  if (p.med12m != null) {
    bits.push(
      <span key="med" title={`12-month median sale · n ${n2(p.med12mN!)} · ${p.scope ?? 'every sale'} — the nightly build's figure, not computed here`}>
        Median 12 mo <b className="nm-num">{fmtUsd(p.med12m)}</b> <span className="nm-n">n {n2(p.med12mN!)}</span>
        {' '}<span className="nm-scope">{p.scope ?? 'all sales'}</span>
      </span>,
    );
  } else {
    bits.push(<span key="med" title={`Under ${MIN_MED_N} sales in the trailing year — no median prints without its n`}>No 12-mo median (n under {MIN_MED_N})</span>);
  }
  if (p.sold12m != null && p.sold12m > 0) {
    bits.push(<span key="s12" title={p.sold12mSince ? `the last ${n2(p.sold12m)} sales, since ${p.sold12mSince} — not a 12-month window` : 'sales tracked in the last 12 months'}>
      {n2(p.sold12m)} sold {p.sold12mSince ? `since ${p.sold12mSince}` : '12 mo'}
    </span>);
  } else if (p.sold != null && p.sold > 0) {
    bits.push(<span key="s12">none sold 12 mo · {n2(p.sold)} all time</span>);
  }
  if (p.spark) {
    const span = sparkSpan(p.sparkQ, p.spark.length);
    bits.push(
      <span key="sp" className="nm-spark" title={`${sparkTitle(p.sparkBasis, p.sparkYoyOff, p.yoy?.basis)}${span ? ` · ${span}` : ''}`}>
        <Spark values={p.spark} w={72} h={18} />
        <span className="nm-n">{p.spark.length}-q trend</span>
      </span>,
    );
  }
  if (p.yoy) {
    const dir = yoyDir(p.yoy);
    const color = dir === 'up' ? 'var(--color-up)' : dir === 'down' ? 'var(--color-down-text)' : undefined;
    bits.push(<span key="yoy" title={yoyTitle(p.yoy)}>YoY <b className="nm-num" style={{ color }}>{fmtPct(p.yoy.pct)}</b> <span className="nm-n">n {n2(p.yoy.n)}</span>{!dir && <> <span className="nm-scope">no clear move</span></>}</span>);
  }
  return <p className="nm-pulse" aria-label={`${label}, 12-month pulse`}>{bits.map((b, i) => <React.Fragment key={i}>{i > 0 ? <span className="nm-dot" aria-hidden>·</span> : null}{b}</React.Fragment>)}</p>;
}

function SaleRow({ s, now, href, onOpen }: { s: Sale; now: number; href: string; onOpen: (l: AuctionLot) => void }) {
  const w = whenText(s, now);
  const one = s.lots.length === 1 ? s.lots[0] : null;
  // a sale of several lots prints as one row: its first lots as an overlapping
  // photo stack (up to four, the count past them), "N lots · house · sale"
  const stack = one ? [] : s.lots.filter(l => imageOf(l)).slice(0, 4);
  const lot: RowLot = one ?? { id: s.key, title: `${n2(s.lots.length)} lots · ${s.house}${s.saleName ? ` · ${s.saleName}` : ''}`, auctionHouse: s.house, imageUrl: stack[0] ? imageOf(stack[0]) : null };
  const photo = one ? undefined : (
    <span className="dk-stack" data-n={stack.length}>
      {stack.map(l => <Thumb key={l.id} src={imageOf(l)} label={l.title} size={32} round />)}
      {stack.length === 0 && <Thumb label={s.house} size={32} round />}
      {s.lots.length > stack.length && <span className="dk-stack-n">+{n2(s.lots.length - stack.length)}</span>}
    </span>
  );
  return (
    <DeskRow as="li" lot={lot} photo={photo} href={one ? undefined : href} title={one ? craftTitle(one.title, one.auctionHouse) : lot.title} who={one ? undefined : s.house}
      attrs={{ 'data-soon': w.soon ? '' : undefined }}
      sub={<>
        {one ? <>{s.house}{s.saleName ? ` · ${s.saleName}` : ''} · </> : null}
        {estText(s)}
        {s.flagged > 0 && <> · <b className="nm-flag">{s.flagged === s.lots.length && s.lots.length > 1 ? 'all' : s.flagged} below market</b></>}
      </>}
      subText={[one ? `${s.house}${s.saleName ? ` · ${s.saleName}` : ''}` : null, estText(s), s.flagged > 0 ? `${s.flagged} below market` : null].filter(Boolean).join(' · ')}
      figure={<span className="dk-clock" data-soon={w.soon || undefined}>{w.lead}</span>} figureKind="clock" figureText={w.lead} figureSub={w.sub}
      action={one
        ? <button type="button" className="dk-link" onClick={() => onOpen(one)} aria-label={`Comps for ${one.title}`}>Comps</button>
        : <Link href={href} className="dk-link" aria-label={`See ${s.lots.length} lots at ${s.house}`}>See lots</Link>} />
  );
}

/** sales printed per name before "+N more" (in place) */
const SALES_SHOWN = 2;

function BlindLine({ bs, read, fail, slow, hasEntity }: { bs: BlindSpot | null; read: boolean; fail: boolean; slow: boolean; hasEntity: boolean }) {
  if (!hasEntity) return <p className="nm-blind">Nothing live</p>;
  if (!read) return <p className="nm-blind">Nothing live · reading its sold history…</p>;
  if (fail) return <p className="nm-blind">Nothing live · sold history didn&rsquo;t load{slow ? ' (still trying)' : ''}</p>;
  if (!bs) return <p className="nm-blind">Nothing live · no sold history on file</p>;
  const bits: React.ReactNode[] = [<span key="nl">Nothing live</span>];
  if (bs.lastSeen) {
    const l = bs.lastSeen;
    bits.push(<span key="ls">Last seen <b className="nm-when">{agoText(bs.daysSince ?? 0)}</b> · {fmtUsd(l.p)}{l.h ? ` at ${l.h}` : ''} · {dayWord(l.d)}</span>);
  } else {
    bits.push(<span key="ls">No sale on file</span>);
  }
  if (bs.houses.length) {
    bits.push(<span key="h" title={`shares of ${n2(bs.housesN)} tracked sales, all time`}>Usually sells at {bs.houses.map((h, i) => <React.Fragment key={h.h}>{i > 0 ? ', ' : ''}{h.h} <span className="nm-n">{pct(h.share)}</span></React.Fragment>)}</span>);
  }
  return <p className="nm-blind">{bits.map((b, i) => <React.Fragment key={i}>{i > 0 ? <span className="nm-dot" aria-hidden>·</span> : null}{b}</React.Fragment>)}</p>;
}

function NameRow({ r, sold, capped, now, onOpen, onFollow }: {
  r: NameRead; sold: Sold | undefined; capped: boolean; now: number;
  onOpen: (l: AuctionLot) => void; onFollow: (n: DeskName) => void;
}) {
  const { name } = r;
  const [allSales, setAllSales] = useState(false);
  const s = sold?.s ?? null;
  const href = hrefOf(name, s);
  const pulse = useMemo(() => pulseOf(s, sold?.sparkQ), [s, sold?.sparkQ]);
  const bs = useMemo(() => blindSpotOf(sold?.d ?? null, now), [sold?.d, now]);
  const read = !!sold;
  const live = r.live > 0;
  const who = [
    name.followed ? 'following' : null,
    name.owned > 0 ? `${name.owned} owned` : null,
    name.saved > 0 ? `${name.saved} watched` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div className="nm-row" role="listitem" data-live={live || undefined}>
      <div className="nm-head">
        <Link href={href} className="nm-name" data-nav-row>{name.label}</Link>
        {who && <span className="nm-who">{who}</span>}
        {!name.followed && (
          <button type="button" className="nm-follow" onClick={() => onFollow(name)} aria-label={`Follow ${name.label}`}>Follow</button>
        )}
        <span className="nm-fig">
          <b>{live ? n2(r.live) : '—'}</b>
          <span className="ck-mham">{live ? (r.live === 1 ? 'lot live' : 'lots live') : 'nothing live'}</span>
        </span>
      </div>
      {name.id && !capped && (
        pulse ? <PulseLine p={pulse} label={name.label} />
          : read ? <p className="nm-pulse">{sold!.sFail ? 'Sold history didn’t load' : 'No sold history on file'}</p>
            : <p className="nm-pulse">Reading sold history…</p>
      )}
      {/* (Oct 20) said once in the room's figure line; each capped name just says so */}
      {name.id && capped && <p className="nm-pulse">Calendar only</p>}
      {!name.id && <p className="nm-pulse">{name.follow.kind === 'cat' ? 'Category' : 'Collection'} follow · live lots only — no single name to read a sold history for</p>}
      {live ? (
        <ul className="nm-sales dk-list" aria-label={`${name.label}, upcoming sales`}>
          {(allSales ? r.sales : r.sales.slice(0, SALES_SHOWN)).map(s => <SaleRow key={s.key} s={s} now={now} href={href} onOpen={onOpen} />)}
          {r.sales.length > SALES_SHOWN && (
            <li className="nm-sale nm-sale-more">
              <button type="button" className="nm-link" aria-expanded={allSales} onClick={() => setAllSales(v => !v)}>
                {allSales ? 'Fewer sales' : `+${r.sales.length - SALES_SHOWN} more ${r.sales.length - SALES_SHOWN === 1 ? 'sale' : 'sales'}`}
              </button>
            </li>
          )}
        </ul>
      ) : (
        <BlindLine bs={bs} read={read} fail={!!sold?.dFail} slow={!!sold?.slow} hasEntity={!!name.id} />
      )}
    </div>
  );
}

/* ── a market's names ── */

/** names open per market on a phone (R2 b): the rest fold with their counts visible */
const PHONE_OPEN = 1;
/** (Oct 20 audit) a desk opens each market on its first names too — the room ran 12 screens */
const DESK_OPEN = 4;

function MarketGroup({ label, reads, now, narrow, sold, readSet, onOpen, onFollow }: {
  label: string; reads: NameRead[]; now: number; narrow: boolean; sold: Map<string, Sold> | undefined; readSet: Set<string>;
  onOpen: (l: AuctionLot) => void; onFollow: (n: DeskName) => void;
}) {
  const [all, setAll] = useState(false);
  const open = !all ? reads.slice(0, narrow ? PHONE_OPEN : DESK_OPEN) : reads;
  const folded = reads.slice(open.length);
  return (
    <div className="nm-group">
      <div className="ck-reads-head">
        <span className="kicker">{label}</span>
        <hr className="ck-reads-rule" />
        <span className="ck-mham">{reads.filter(r => r.live > 0).length} of {reads.length} live</span>
      </div>
      <div role="list" aria-label={`${label} names`}>
        {open.map(r => (
          <NameRow key={r.name.key} r={r} now={now}
            sold={r.name.id ? sold?.get(r.name.id) : undefined}
            capped={!!r.name.id && !readSet.has(r.name.id)}
            onOpen={onOpen} onFollow={onFollow} />
        ))}
        {folded.length > 0 && (
          <div className="nm-folded" role="listitem">
            <ul className="nm-folded-list" aria-label={`${label}, ${folded.length} more names`}>
              {folded.map(r => (
                <li key={r.name.key}><span className="nm-folded-name">{r.name.label}</span> <span className="nm-n">{r.live > 0 ? `${n2(r.live)} live` : 'nothing live'}</span></li>
              ))}
            </ul>
            <button type="button" className="nm-more" onClick={() => setAll(true)} aria-expanded={false}>
              Show {folded.length} more {folded.length === 1 ? 'name' : 'names'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── the section ── */

export default function NamesSection({ desk, act, narrow }: SectionProps) {
  const now = desk.now;
  const names = useMemo(() => namesOf(desk), [desk]);
  const [near, sectionRef] = useNear();
  const readIds = useMemo(() => names.filter(n => n.id).slice(0, MAX_READ).map(n => n.id!), [names]);
  const sold = useSoldSide(readIds, near, desk.lastCrawl || undefined);

  // (perf) the live scan runs per name over the whole book: a 10-minute clock
  // grain, not the desk's 1-minute tick (a lot's live/closed edge moves rarely)
  const slow = Math.floor(now / 600_000) * 600_000;
  const reads = useMemo<NameRead[]>(() => names.map(n => {
    const lots = liveLotsOf(n, desk.book, slow);
    const sales = salesOf(lots);
    return { name: n, sales, live: lots.length, flagged: sales.reduce((s, x) => s + x.flagged, 0) };
  }), [names, desk.book, slow]);

  const lastSeenOf = (key: string): string | null => {
    const n = names.find(x => x.key === key);
    const d = n?.id ? sold?.get(n.id)?.d : null;
    if (!d) return null;
    let best = '';
    for (const r of [...(d.recent || []), ...(d.top || [])]) if (r.d > best) best = r.d;
    return best || null;
  };
  const groups = useMemo(() => groupByMarket(names).map(g => ({
    ...g,
    reads: orderNames(g.names.map(n => reads.find(r => r.name.key === n.key)!), lastSeenOf),
  })), [names, reads, sold]); // eslint-disable-line react-hooks/exhaustive-deps

  if (names.length === 0) return null;

  const t = namesTotals(reads);
  const cal = calendarTotals(reads.flatMap(r => r.sales));
  const readSet = new Set(readIds);
  const loading = sold === undefined && readIds.length > 0;
  const unread = names.filter(n => n.id).length - readIds.length;
  const band = cal.k > 0 ? bandText(cal.lo, cal.hi) : null;
  const totals = (
    <>
      {n2(t.names)} {t.names === 1 ? 'name' : 'names'} · {t.live} with {cal.lots === 1 ? 'a lot' : `${n2(cal.lots)} lots`} live across {t.sales} {t.sales === 1 ? 'sale' : 'sales'}
      {band ? ` · est ${band}${cal.k < cal.lots ? ` on ${n2(cal.k)} of ${n2(cal.lots)} lots` : ''}` : ''}
      {cal.oneSided > 0 ? ` · ${fromText(cal.from, cal.oneSided, cal.lots)}` : ''}
      {cal.flagged > 0 ? ` · ${cal.flagged} below market` : ''}
      {t.blind > 0 ? ` · ${t.blind} ${t.blind === 1 ? 'blind spot' : 'blind spots'}` : ''}
    </>
  );

  // the sold-history cap, said once (the rows past it say "Calendar only")
  const capNote = names.some(n => n.id && !readIds.includes(n.id))
    ? <> · sold history covers your first {MAX_READ} names; the rest are calendar only</>
    : null;

  return (
    <section id="names" ref={sectionRef} className="ray-saved-section rail ray-enter nm-section" aria-label="Names calendar and blind spots">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <RoomHead mark={<HorizonMark size={17} />} title={narrow ? 'Names' : 'Names calendar & blind spots'}
          help={{ name: 'Names calendar & blind spots', body: <>
            Every name you follow, own or watch, by market. <b>The calendar</b> is the sales its live lots sit in — house,
            sale, when it closes (your clock; inside a day, in hours), lots, the house estimates summed over the lots with
            both bounds published (a one-sided estimate prints <b>from $X</b> and is never summed; bid auctions publish
            none, so their live bids print instead), and how many the engine prices <b>below market</b>. <b>The pulse</b> is the nightly build&rsquo;s:
            the 12-month median prints only with its n (never under {MIN_MED_N} sales) and the scope it covers, sold in
            the trailing year, the complete-quarter trend (a gap is a quarter too thin to read), and year over year only
            where the build&rsquo;s n gate and 90% interval allowed one — colored only for a clear move. <b>A blind spot</b>
            is a name with nothing live: its last sale on file, the houses it usually sells at (shares of every tracked
            sale), and Follow if you don&rsquo;t yet. What moved this week for these names is in <a href="#market">Your market</a>.
          </> }}
          sub={<>{narrow ? <>Names calendar &amp; blind spots · </> : null}{totals}{capNote}</>} />
        {loading && <p className="ck-sig-note nm-status" role="status">Reading sold history for {n2(readIds.length)} {readIds.length === 1 ? 'name' : 'names'}…</p>}
        {groups.map(g => (
          <MarketGroup key={g.market} label={g.label} reads={g.reads} now={now} narrow={narrow} sold={sold} readSet={readSet}
            onOpen={act.openLot} onFollow={n => act.follow(n.follow)} />
        ))}
        {unread > 0 && <p className="ck-sig-note">The first {MAX_READ} names carry sold history here; {unread} more show their calendar only.</p>}
        {!desk.fullLoaded && desk.fullError && <p className="ck-sig-note">The archive didn&rsquo;t load — the calendar reads the live book; owned and watched names may be missing until it does.</p>}
      </div>
    </section>
  );
}
