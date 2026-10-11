'use client';
/**
 * YOUR MARKET (N5, Oct 11 2026) — the in-product weekly digest of the names
 * the reader follows and owns (never an email). One row per name, ranked by
 * what is newsworthy (app/lib/your-market rankNames: new record > clear move
 * > below-market flags > volume):
 *
 *   sold side   the YoY from pages/entities-<market>.json (with its 90%
 *               interval and n; neutral when the interval spans 0), a new
 *               all-time record or top result from the entity-<bb>.json
 *               detail bucket, the week's biggest sale
 *   live side   live now · below market (isFlagged) · closing this week
 *
 * BYTES: nothing is fetched until the section nears the viewport, and then
 * only the entities file of each market the names live in (the shared
 * useEntities cache — a page that already read it pays nothing) plus one
 * detail bucket per name, at most MAX_READ names.
 *
 * MODES: 'week' (the last seven days; records over thirty) or 'since' (since
 * the reader's previous visit — the site's one last-visit clock). The toggle
 * shows only when a previous visit exists.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { AuctionLot } from '../types';
import { useFollows } from '../lib/follows';
import { useLastVisit, houseBaselines } from '../lib/feed-filters';
import { loadEntitySummary, loadEntityDetail } from '../hooks/useEntities';
import { useRayData } from '../hooks/useRayData';
import { pageHrefOf } from '../lib/entity/kinds';
import type { EntitySummary, EntityDetail } from '../lib/entity/model';
import {
  marketNamesOf, liveFactsOf, moveOf, recordIn, biggestIn, rankNames, isQuiet, digestTotals, daysBefore,
  MAX_READ, RECORD_DAYS, WEEK_DAYS, type NameDigest, type MarketName, type Move,
} from '../lib/your-market';
import { MoversMark } from '../components/marks';
import { localToday } from '../utils';
import { HelpChip } from './help';

export type MarketMode = 'week' | 'since';

const ROWS_SHOWN = 6;

const dayWord = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pctText = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`;
const BASIS: Record<Move['basis'], string> = { matched: 'matched', median: 'median sale', index: 'index' };

type Sold = { s: EntitySummary | null; d: EntityDetail | null };

/** the sold side for `ids`, read once the section is near (undefined = not yet) */
function useSoldSide(ids: readonly string[], enabled: boolean, ver?: string): Map<string, Sold> | undefined {
  const key = ids.join('\n');
  const [got, setGot] = useState<{ key: string; m: Map<string, Sold> } | null>(null);
  useEffect(() => {
    if (!enabled || !key) return;
    let on = true;
    const list = key.split('\n');
    Promise.all(list.map(async id => {
      const [s, d] = await Promise.all([loadEntitySummary(id).catch(() => null), loadEntityDetail(id, ver).catch(() => null)]);
      return [id, { s, d }] as const;
    })).then(rows => { if (on) setGot({ key, m: new Map(rows) }); });
    return () => { on = false; };
  }, [key, enabled, ver]);
  if (!key) return new Map();
  return got?.key === key ? got.m : undefined;
}

/** true once the element is within a screen or so of the viewport (a
 *  callback ref: the section mounts only once the reader has names) */
function useNear(): [boolean, (el: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [near, setNear] = useState(() => typeof window !== 'undefined' && typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (near || !el) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setNear(true); }, { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [el, near]);
  return [near, setEl];
}

function hrefOf(n: MarketName, s: EntitySummary | null): string {
  if (n.id) return pageHrefOf(n.id) || s?.page || '/makers';
  const f = n.follow;
  if (f.kind === 'cat') {
    const [cat, sub] = f.key.split(':');
    return `/?${new URLSearchParams({ cat, ...(sub ? { sub } : {}), tab: 'all' }).toString()}`;
  }
  return `/makers/${encodeURIComponent(f.key)}`;
}

function MoveFact({ m }: { m: Move }) {
  const color = m.tone === 'up' ? 'var(--color-up)' : m.tone === 'down' ? 'var(--color-down-text)' : undefined;
  return (
    <span>
      YoY <b style={{ color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{pctText(m.pct)}</b> {BASIS[m.basis]}
      {' '}· 90%{'\u00a0'}{pctText(m.lo)} to {pctText(m.hi)}{m.tone === 'flat' ? ' (spans\u00a00)' : ''} · n{'\u00a0'}{m.n.toLocaleString('en-US')}
    </span>
  );
}

type Digest = NameDigest & { s: EntitySummary | null; capped: boolean };

function Row({ d, mode, sinceDay }: { d: Digest; mode: MarketMode; sinceDay: string | null }) {
  const { name, move, record, biggest, live } = d;
  const when = mode === 'since' && sinceDay ? `since ${dayWord(sinceDay)}` : 'this week';
  const sold: React.ReactNode[] = [];
  if (record) {
    const r = record.row;
    sold.push(
      <span key="rec">
        <span className="ck-tag" data-tone="up">{record.rank === 1 ? 'Record' : `Top ${record.rank}`}</span>{' '}
        {record.rank === 1 ? 'New all-time record' : `#${record.rank} result on file`} {usd(r.p)} · {dayWord(r.d)}{r.h ? ` · ${r.h}` : ''}
      </span>,
    );
  }
  if (move) sold.push(<MoveFact key="mv" m={move} />);
  if (biggest) {
    if (biggest.row && !(record && record.row.id === biggest.row.id)) {
      const r = biggest.row;
      // the published rows cover only from `from` on: say that span, never the window
      const oneDay = !biggest.whole && biggest.from === r.d;
      const lead = biggest.whole ? `Biggest sale ${when}` : oneDay ? `Biggest sale ${dayWord(r.d)}` : `Biggest sale since ${dayWord(biggest.from)}`;
      sold.push(<span key="big">{lead} {usd(r.p)}{oneDay ? '' : ` · ${dayWord(r.d)}`}{biggest.n != null && biggest.n > 1 ? ` · ${biggest.n} sold` : ''}</span>);
    } else if (!biggest.row && biggest.whole) {
      sold.push(<span key="big">No sales on file {when}</span>);
    }
  }
  if (!name.id || d.capped) sold.push(<span key="scope">{d.capped ? 'Live lots only here' : `${name.follow.kind === 'cat' ? 'Category' : 'Collection'} · live lots only`}</span>);
  else if (!d.read) sold.push(<span key="ld">Reading sold history…</span>);
  else if (!d.s) sold.push(<span key="none">No sold history on file</span>);

  const liveBits: React.ReactNode[] = [];
  if (live.live > 0) {
    liveBits.push(<span key="lv">{live.live.toLocaleString('en-US')} live</span>);
    if (live.flagged > 0) liveBits.push(<b key="fl" style={{ color: 'var(--color-fg)', fontWeight: 600 }}>{live.flagged} below market</b>);
    if (live.closing > 0) liveBits.push(<span key="cl">{live.closing} close this week</span>);
    if (mode === 'since' && live.fresh > 0) liveBits.push(<span key="nw">{live.fresh} new {when}</span>);
  } else {
    liveBits.push(<span key="lv">Nothing live</span>);
  }
  const join = (xs: React.ReactNode[]) => xs.map((x, i) => <React.Fragment key={i}>{i > 0 ? '\u00a0· ' : ''}{x}</React.Fragment>);

  // the right-hand figure: a clear move's sign, else what is live
  const head = move && move.tone !== 'flat'
    ? { v: pctText(move.pct), cap: 'YoY', color: move.tone === 'up' ? 'var(--color-up)' : 'var(--color-down-text)' }
    : { v: live.live.toLocaleString('en-US'), cap: 'live', color: undefined };
  return (
    <Link href={hrefOf(name, d.s)} className="ck-mrow" role="listitem" data-nav-row>
      <div className="ck-mrow-main">
        <span className="ck-mtitle">
          {name.label}
          {name.owned > 0 && <span className="ck-mham" style={{ fontWeight: 400 }}> · {name.owned} owned</span>}
        </span>
        {/* one text run per line (not flex items): a wrap never strands a separator */}
        {sold.length > 0 && <span className="ck-msub"><span>{join(sold)}</span></span>}
        <span className="ck-msub"><span>{join(liveBits)}</span></span>
      </div>
      <div className="ck-mrow-right">
        <b style={{ color: head.color }}>{head.v}</b>
        <span className="ck-mham">{head.cap}</span>
      </div>
    </Link>
  );
}

export default function YourMarket({ book, owned = [], mode: modeProp, since: sinceProp }: {
  /** the live book the page holds */
  book: readonly AuctionLot[];
  /** the reader's owned pieces (their names join the follows) */
  owned?: readonly AuctionLot[];
  /** start in this mode (default: week) */
  mode?: MarketMode;
  /** override the previous-visit day (default: the site's last-visit clock) */
  since?: string | null;
}) {
  const { follows, ready } = useFollows();
  const { lastCrawl } = useRayData();
  const lastVisit = useLastVisit();
  const today = localToday();
  const sinceDay = sinceProp !== undefined ? sinceProp : lastVisit;
  const canSince = !!sinceDay && sinceDay < today;
  const [modePick, setMode] = useState<MarketMode>(modeProp ?? 'week');
  const mode: MarketMode = modePick === 'since' && canSince ? 'since' : 'week';
  const [all, setAll] = useState(false);
  const [near, sectionRef] = useNear();
  // the clock the live facts read, fixed per mount (closing-this-week is a
  // seven-day window — a re-render must not move it)
  const [nowMs] = useState(() => Date.now());

  const names = useMemo(() => marketNamesOf(follows, owned), [follows, owned]);
  const readIds = useMemo(() => names.filter(n => n.id).slice(0, MAX_READ).map(n => n.id!), [names]);
  const sold = useSoldSide(readIds, near, lastCrawl || undefined);
  const baselines = useMemo(() => houseBaselines(book), [book]);

  // the windows: week = the last seven days (records: thirty); since = the
  // days after the previous visit
  const from = mode === 'since' && sinceDay ? daysBefore(sinceDay, -1) : daysBefore(today, WEEK_DAYS - 1);
  const recordFrom = mode === 'since' ? from : daysBefore(today, RECORD_DAYS - 1);

  const digests = useMemo(() => {
    const readSet = new Set(readIds);
    const out: Digest[] = [];
    for (const n of names) {
      const got = n.id ? sold?.get(n.id) : undefined;
      const s = got?.s ?? null, d = got?.d ?? null;
      out.push({
        name: n,
        s,
        capped: !!n.id && !readSet.has(n.id),
        move: moveOf(s?.yoy),
        record: recordIn(d, recordFrom, from),
        biggest: biggestIn(d, from),
        live: liveFactsOf(n, book, { nowMs, today, since: mode === 'since' ? sinceDay : null, baselines }),
        sold12m: s?.sold12m ?? 0,
        read: !!got,
        page: s?.page ?? null,
      });
    }
    return rankNames(out) as Digest[];
  }, [names, readIds, sold, book, today, mode, sinceDay, baselines, from, recordFrom, nowMs]);

  if (!ready || names.length === 0) return null;

  const loading = sold === undefined && readIds.length > 0;
  const quiet = loading ? [] : digests.filter(isQuiet);
  const rows = digests.filter(d => loading || !isQuiet(d));
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
  const t = digestTotals(digests);
  const when = mode === 'since' && sinceDay ? `since ${dayWord(sinceDay)}` : 'this week';
  const news = t.records + t.moves + t.flagged > 0;
  const unread = names.filter(n => n.id).length - readIds.length;

  return (
    <section id="market" ref={sectionRef} className="ray-saved-section rail" aria-label="Your market">
      <div className="ns-plate" style={{ paddingTop: 18 }}>
        <div className="ray-enter" style={{ display: 'flex', alignItems: 'baseline', gap: '4px 14px', flexWrap: 'wrap', marginBottom: 6 }}>
          <h2 className="ray-h2" style={{ margin: 0 }}><span className="ray-sect-mark" aria-hidden><MoversMark size={17} /></span>Your market</h2>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>the names you follow and own, {when}</span>
          <HelpChip name="Your market">
            One row per name you follow or own, newsworthy first: a <b>new all-time record</b> (or a top-eight result on
            file) dated in the window, then a <b>clear year-over-year move</b> — printed with its 90% interval and the
            number of sales it rests on, and toned only when the interval leaves zero out; <b>matched</b> compares the
            same items sold in both years, <b>median sale</b> the pooled medians. Then <b>below-market</b> live lots
            (the engine prices them under their comparables) and what is live and closing within seven days. The
            biggest sale is the window&rsquo;s largest on file; where the published rows cover only part of the window
            it says from which day. No figure here is computed in your browser — each is the nightly build&rsquo;s.
          </HelpChip>
          {canSince && (
            <span style={{ display: 'inline-flex', gap: 6, marginLeft: 'auto' }} role="group" aria-label="Digest window">
              <button type="button" className="ray-toolbar-pill" data-active={mode === 'week'} aria-pressed={mode === 'week'} onClick={() => setMode('week')}>This week</button>
              <button type="button" className="ray-toolbar-pill" data-active={mode === 'since'} aria-pressed={mode === 'since'} onClick={() => setMode('since')}>Since {dayWord(sinceDay!)}</button>
            </span>
          )}
        </div>
        <p className="ck-sig-note" style={{ marginTop: 4 }} role="status">
          {loading
            ? 'Reading the sold history for your names…'
            : news
              ? <>{[
                  t.records ? `${t.records} ${t.records === 1 ? 'name set a record or top result' : 'names set records or top results'}` : null,
                  t.moves ? `${t.moves} clear ${t.moves === 1 ? 'move' : 'moves'} year over year` : null,
                  t.flagged ? `${t.flagged} below-market ${t.flagged === 1 ? 'lot' : 'lots'} live` : null,
                ].filter(Boolean).join(' · ')}.</>
              : <>Nothing moved enough to say so {when}.</>}
        </p>
        {shown.length > 0 && (
          <div className="ck-reads" role="list" aria-label={`Your names, ${when}`} style={{ marginTop: 10 }}>
            {shown.map(d => <Row key={d.name.key} d={d} mode={mode} sinceDay={sinceDay} />)}
          </div>
        )}
        {rows.length > ROWS_SHOWN && (
          <button type="button" className="ck-today-more" aria-expanded={all} onClick={() => setAll(v => !v)}>
            {all ? 'Show fewer' : `+${rows.length - ROWS_SHOWN} more ${rows.length - ROWS_SHOWN === 1 ? 'name' : 'names'}`}
          </button>
        )}
        {quiet.length > 0 && (
          <p className="ck-sig-note">
            Quiet {when}: {quiet.map(d => d.name.label).join(', ')} — no record, no published move, nothing live.
          </p>
        )}
        {unread > 0 && (
          <p className="ck-sig-note">The first {MAX_READ} names carry sold history here; {unread} more show live lots only.</p>
        )}
      </div>
    </section>
  );
}
