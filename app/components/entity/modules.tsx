'use client';
/**
 * The entity page's sections below the live book (makers overhaul P2,
 * Oct 10 2026): the kind module (§3), the ONE yearly line (§4), the results
 * (§5) and the context ledger (§6). Every figure comes from the entity's
 * detail bucket (pages/entity-<bb>.json — the same entityFigures pass as the
 * /makers row), every median prints with its n, every split speaks the live
 * chips' words (taxonomy lens labels, app/lib/facets keys).
 *
 * Grammar: the north-star dossier set (app/northstar-pages.css — nsp-section,
 * ns-plate, nsp-shead, nsp-ledger / ns-ledger-row, the lectr-lot-comp rows).
 * Nothing here declares a new style.
 */
import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { EntityDetail, EntityResultRow, EntityKind } from '../../lib/entity/model';
import type { MarketData, SubMarketRead } from '../../hooks/useRayData';
import { useRefs, refsForMaker } from '../../hooks/useRefs';
import { encodeRefPath } from '../../ref/ref-path';
import { closeCut, formatDate, formatPrice, httpsImg, sizedImg, refLabel } from '../../utils';
import PlateImg from '../PlateImg';
import { signedPct } from '../SubMarketDirectory';
import type { Market } from '../../constants';
import { shortLens, drillSlugOf } from '../../lib/entity/lens';
export { shortLens, drillSlugOf };

const HeroChart = dynamic(() => import('../../preview/terminal/HeroChart'), { ssr: false, loading: () => <div style={{ height: 170 }} aria-hidden /> });
type HeroLine = import('../../preview/terminal/HeroChart').HeroLine;

type Cat = EntityDetail['cats'][number];

/* ── shared bits ───────────────────────────────────────────────────── */

function SectionHead({ kicker, title, ctx }: { kicker: string; title: React.ReactNode; ctx?: React.ReactNode }) {
  return (
    <div className="nsp-shead">
      <div>
        <span className="ns-kicker">{kicker}</span>
        <h2 className="nsp-h2">{title}</h2>
      </div>
      {ctx ? <span className="nsp-shctx">{ctx}</span> : null}
    </div>
  );
}

/** one median cell — the figure with its n, or why there is none */
function MedCell({ med, n }: { med: number | null; n: number }) {
  return (
    <span className="nsp-lval">
      {med != null
        ? <><span className="nsp-lsub" style={{ marginLeft: 0 }}>n={n.toLocaleString()}</span><span className="nsp-lv">{formatPrice(med)}</span></>
        : <span className="nsp-lsub" style={{ marginLeft: 0 }}>{n ? `${n} in 12 mo, too few to typify` : 'none in 12 mo'}</span>}
    </span>
  );
}

/* ── §3 THE KIND MODULE ────────────────────────────────────────────── */

/** a split row under this many sales all-time, with no 12-month median, folds into the note */
const FOLD_N = 100;

export interface SplitRow { key: string; label: string; n: number; med: number | null; n12: number; href?: string | null; live?: number }

/** a split ledger: one row per lens / facet — sales all-time, the trailing
 *  year's median with its n, and the live lots in that cut (a tap narrows the
 *  live book above to them) */
function SplitLedger({ rows, onLive }: { rows: SplitRow[]; onLive?: (key: string) => void }) {
  return (
    <div className="nsp-ledger">
      {rows.map(r => (
        <div key={r.key} className="ns-ledger-row">
          <span className="nsp-lk">
            {r.href ? <Link href={r.href} className="t" style={{ textDecoration: 'none' }}>{r.label}</Link> : <span className="t">{r.label}</span>}
            <span className="nsp-lsub">{r.n.toLocaleString()} {r.n === 1 ? 'sale' : 'sales'}</span>
            {r.live && onLive ? (
              <button type="button" className="nsp-more" onClick={() => onLive(r.key)}
                style={{ marginLeft: 10, marginTop: 0, background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
                {r.live} live &rsaquo;
              </button>
            ) : null}
          </span>
          <MedCell med={r.med} n={r.n12} />
        </div>
      ))}
    </div>
  );
}

const MODULE_HEAD: Record<string, { kicker: string; title: string }> = {
  art: { kicker: 'By medium', title: 'What sells, medium by medium' },
  design: { kicker: 'By form', title: 'What sells, form by form' },
  player: { kicker: 'By category', title: 'Cards and the physical record' },
  pokemon: { kicker: 'By era', title: 'Era, grade and language' },
  set: { kicker: 'By era', title: 'What sells from the set' },
  mission: { kicker: 'By object', title: 'What sells from the mission' },
  subject: { kicker: 'By object', title: 'What kind of object sells' },
};

export function KindModule({ id, kind, subKind, market, slug, label, detail, marketData, liveByLens, onLive, sportKey }: {
  id: string; kind: EntityKind; subKind: string | null; market: Market; slug: string | null; label: string;
  detail: EntityDetail; marketData: MarketData | null;
  /** live lots per clean `cat:sub` (the live book's own pool) */
  liveByLens: Map<string, number>;
  onLive: (lensKey: string) => void;
  sportKey: string | null;
}) {
  if (kind === 'sub') return null;
  if (market === 'watches' && slug) return <WatchModule slug={slug} label={label} marketData={marketData} />;
  const head = MODULE_HEAD[market === 'art' || market === 'design' ? market : kind === 'player' ? 'player'
    : subKind === 'pokemon' ? 'pokemon' : kind === 'set' ? 'set' : subKind === 'mission' ? 'mission' : 'subject'];
  const drills = drillIndex(marketData);
  const rows: SplitRow[] = detail.cats.map((c: Cat) => {
    const slugD = drillSlugOf(c.key, sportKey);
    return {
      key: c.key, label: shortLens(c.key, c.label), n: c.n, med: c.med12m, n12: c.med12mN,
      href: slugD && drills.has(slugD) ? `/sub/${slugD.replace(':', '/')}` : null,
      live: liveByLens.get(c.key) || 0,
    };
  });
  const facets = detail.facets || [];
  if (rows.length < 2 && !facets.length) return null;
  // a cut with no printable median and under FOLD_N sales all-time folds into
  // one line under the ledger — named, with its n, never dropped
  const shown = rows.filter(r => r.med != null || r.n >= FOLD_N || r.live);
  const folded = rows.filter(r => !shown.includes(r));
  return (
    <section className="nsp-section ns-plate" aria-label={head.kicker}>
      <SectionHead kicker={head.kicker} title={head.title} ctx="sales all-time · median of the past 12 months, n beside it" />
      {rows.length >= 2 && <SplitLedger rows={shown} onLive={onLive} />}
      {rows.length >= 2 && folded.length > 0 && (
        <p className="nsp-note">Also {folded.map(r => `${r.label} (${r.n.toLocaleString()} ${r.n === 1 ? 'sale' : 'sales'})`).join(', ')} — too few in the past 12 months to typify.</p>
      )}
      {facets.map((g, i) => (
        <div key={g.key} style={{ marginTop: rows.length >= 2 || i > 0 ? 18 : 0 }}>
          {rows.length >= 2 || i > 0 || g.label !== head.kicker ? (
            <span className="ns-kicker">
              {g.label}{g.scope ? ` · ${shortLens(g.scope, detail.cats.find(c => c.key === g.scope)?.label || g.scope)} only` : ''}
            </span>
          ) : null}
          <SplitLedger rows={g.rows.map(r => ({ key: `${g.key}:${r.key}`, label: r.label, n: r.n, med: r.med12m, n12: r.n12 }))} />
        </div>
      ))}
      {id.startsWith('mk:') && market === 'art' ? (
        <p className="nsp-note">Each medium is its own median — a print and a painting never share one. The page&rsquo;s typical sale reads the medium that sold most this year.</p>
      ) : null}
    </section>
  );
}

/* watch brands: model families (one metric type per column), then the true
   references (a reference number, never a family name) into /ref */
function WatchModule({ slug, label, marketData }: { slug: string; label: string; marketData: MarketData | null }) {
  const families = useMemo(() => ((marketData?.drills?.watches || []) as (SubMarketRead & { parent?: string })[])
    .filter(r => r.parent === slug || r.slug.startsWith(`${slug}:`))
    .sort((a, b) => b.lots - a.lots), [marketData, slug]);
  const { refs, failed, retry } = useRefs();
  const rows = useMemo(() => refsForMaker(refs, slug).filter(r => /\d/.test(r.ref)).slice(0, 8), [refs, slug]);
  return (
    <section className="nsp-section ns-plate" aria-label="Model families and references">
      <SectionHead kicker="By family" title={`${label}'s model families`} ctx="typical = median of the past 12 months · read = the family's strongest measured read" />
      {families.length ? (
        <div className="nsp-ledger">
          {families.map(r => (
            <Link key={r.slug} href={`/sub/${r.slug.replace(':', '/')}`} className="ns-ledger-row" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="nsp-lk">
                <span className="t">{r.label.replace(new RegExp(`\\s*·?\\s*${label}$`), '')}</span>
                <span className="nsp-lsub">{r.lots.toLocaleString()} lots</span>
              </span>
              <span className="nsp-lval">
                <ReadTag r={r} />
                <span className="nsp-lv">{r.typicalUsd != null ? formatPrice(r.typicalUsd) : '—'}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : <p className="nsp-note">No model family is tracked for {label} yet.</p>}
      <div style={{ marginTop: 22 }}>
        <span className="ns-kicker">References</span>
        {failed ? (
          <p className="nsp-note">The reference book didn&rsquo;t load. <button type="button" className="nsp-more" onClick={retry} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>Try again</button></p>
        ) : refs === null ? (
          <p className="nsp-note">Loading the reference book&hellip;</p>
        ) : rows.length ? (
          <div className="nsp-ledger">
            {rows.map(r => (
              <Link key={r.key} href={`/ref/${slug}/${encodeRefPath(r.ref)}`} className="ns-ledger-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="nsp-lk">
                  <span className="t">{refLabel(r.ref)}</span>
                  <span className="nsp-lsub">{r.line ? `${refLabel(r.line)} · ` : ''}{r.n.toLocaleString()} sales · {r.houses.length} {r.houses.length === 1 ? 'house' : 'houses'}</span>
                </span>
                <span className="nsp-lval">
                  <span className="nsp-lsub" style={{ marginLeft: 0 }}>median, all sales</span>
                  <span className="nsp-lv">{formatPrice(r.medianUsd)}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : <p className="nsp-note">No reference with a number on it has enough sales yet.</p>}
      </div>
    </section>
  );
}

/** a drill row's headline read, in /sub's words — green/red only on a CI'd
 *  index move or measured demand; a descriptive row prints nothing here */
function ReadTag({ r }: { r: SubMarketRead }) {
  if (r.readType === 'index' && r.index) {
    const v = r.index.changePct;
    return (
      <span title={`verified index, ${r.index.horizon}, 90% interval [${r.index.ciLoPct.toFixed(0)}%, ${r.index.ciHiPct.toFixed(0)}%]`}>
        <span className={`nsp-lv mono ${v >= 0 ? 'up' : 'down'}`}>{signedPct(v)}</span>
        <span className="nsp-lsub">{r.index.horizon} verified</span>
      </span>
    );
  }
  if (r.readType === 'demand' && r.demandNow != null) {
    const v = r.demandNow;
    return (
      <span>
        <span className={`nsp-lv mono ${v >= 0 ? 'up' : 'down'}`}>{signedPct(v)}</span>
        <span className="nsp-lsub">vs estimate</span>
      </span>
    );
  }
  return null;
}

/* ── §4 THE ONE YEARLY LINE ────────────────────────────────────────── */

type Year = EntityDetail['yearly'][number];

export function YearlyLine({ detail, name, defaultLens }: { detail: EntityDetail; name: string; defaultLens: string | null }) {
  // the lenses worth a line of their own (≥3 years with a printable median)
  const lenses = useMemo(() => (detail.lensSplit || [])
    .filter(l => l.n >= LENS_PILL_N && l.yearly.filter(y => y.med != null && !y.partial).length >= 3)
    .map(l => ({ key: l.key, label: l.label, yearly: l.yearly, n: l.n })), [detail]);
  const initial = defaultLens && lenses.some(l => l.key === defaultLens) ? defaultLens : 'all';
  const [lens, setLens] = useState<string>(initial);
  const cur = lenses.find(l => l.key === lens);
  const yearly: Year[] = cur ? cur.yearly : detail.yearly;
  const lensLabel = cur ? shortLens(cur.key, cur.label) : 'every sale';

  const { points, axis, partial } = useMemo(() => {
    const done = yearly.filter(y => !y.partial);
    const drawn = done.filter(y => y.med != null);
    if (!drawn.length) return { points: [], axis: [], partial: yearly.find(y => y.partial) ?? null };
    const lo = drawn[0].y, hi = drawn[drawn.length - 1].y;
    const axis: string[] = [];
    for (let y = lo; y <= hi; y++) axis.push(String(y));
    return {
      points: drawn.map(y => ({ period: String(y.y), value: y.med!, n: y.n })),
      axis,
      partial: yearly.find(y => y.partial) ?? null,
    };
  }, [yearly]);
  const gaps = axis.length - points.length;

  if (points.length < 3 && lenses.length === 0) return null;
  const anchor: HeroLine = { key: 'yearly', label: `${name} · yearly median`, color: 'var(--color-fg, #f7f8f8)', unit: 'money', points };
  return (
    <section className="nsp-section ns-plate" aria-label="Yearly median">
      <SectionHead
        kicker="The line"
        title={points.length ? `Yearly median, ${axis[0]}–${axis[axis.length - 1]}` : 'Yearly median'}
        ctx={`${lensLabel} · a year needs 5+ sales · gaps left open`}
      />
      {lenses.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }} role="group" aria-label="Which sales the line reads">
          <button type="button" className="ray-toolbar-pill" data-active={lens === 'all'} aria-pressed={lens === 'all'} onClick={() => setLens('all')}>Every sale</button>
          {lenses.map(l => (
            <button key={l.key} type="button" className="ray-toolbar-pill" data-active={lens === l.key} aria-pressed={lens === l.key} onClick={() => setLens(l.key)}>
              {shortLens(l.key, l.label)}
            </button>
          ))}
        </div>
      )}
      {points.length >= 2 ? (
        <div className="nsp-chart">
          <HeroChart anchor={anchor} periods={axis} height={170} play={false} compact hideTickLabels={false} />
        </div>
      ) : <p className="nsp-note">Too few years with five or more sales to draw a line for this cut.</p>}
      <p className="nsp-note">
        The median price of what sold each year — a level that moves with the mix of what came up, not an appreciation rate.
        {gaps > 0 ? ` ${gaps} ${gaps === 1 ? 'year' : 'years'} inside the span had fewer than five sales and ${gaps === 1 ? 'is' : 'are'} left as a gap.` : ''}
        {partial ? ` ${partial.y} so far: ${partial.med != null ? `${formatPrice(partial.med)} over ` : ''}${partial.n.toLocaleString()} ${partial.n === 1 ? 'sale' : 'sales'} — not drawn until the year closes.` : ''}
      </p>
    </section>
  );
}

/* ── §5 RESULTS ────────────────────────────────────────────────────── */

function ResultRow({ row }: { row: EntityResultRow }) {
  const title = (row.t || '').length >= 119 ? closeCut(row.t, 119) : row.t;
  const img = httpsImg(row.img);
  const body = (
    <>
      <span className="lectr-lot-comp-thumb" aria-hidden>
        <span>{(title || '?').trim().charAt(0)}</span>
        {img && <PlateImg src={sizedImg(img, 160)} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      </span>
      <span className="lectr-lot-comp-t">
        <span className="lectr-lot-comp-title" style={{ display: 'block' }}>{title}</span>
        <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>
          {[row.cat, row.h, formatDate(row.d, { month: 'short', year: 'numeric' })].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="lectr-lot-comp-p">{formatPrice(row.p)}</span>
    </>
  );
  return row.id
    ? <Link href={`/lot?id=${encodeURIComponent(row.id)}`} className="lectr-lot-comp">{body}</Link>
    : <span className="lectr-lot-comp" style={{ cursor: 'default' }}>{body}</span>;
}

const RESULT_ROWS = 6;
const LENS_PILL_N = 100;

export function Results({ detail, sold, onEvery }: { detail: EntityDetail; sold: number | null; onEvery?: (() => void) | null }) {
  // a lens earns its own "Top" pill with real depth (≥ LENS_PILL_N sales), three at most
  const lenses = (detail.lensSplit || []).filter(l => l.top.length > 0 && l.n >= LENS_PILL_N).slice(0, 3);
  const [view, setView] = useState<string>('recent');
  const rows = (view === 'recent' ? detail.recent : view === 'top' ? detail.top : (lenses.find(l => l.key === view)?.top || [])).slice(0, RESULT_ROWS);
  if (!detail.recent.length && !detail.top.length) return null;
  const sorted = view === 'recent'
    ? rows.slice().sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.p - a.p))
    : rows.slice().sort((a, b) => b.p - a.p || (a.d < b.d ? 1 : -1));
  return (
    <section className="nsp-section ns-plate" aria-label="Results">
      <SectionHead
        kicker="Results"
        title={view === 'recent' ? 'Latest sales' : view === 'top' ? 'Top results' : `Top results · ${shortLens(view, lenses.find(l => l.key === view)?.label || '')}`}
        ctx="realized, buyer’s premium included"
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }} role="group" aria-label="Which results">
        <button type="button" className="ray-toolbar-pill" data-active={view === 'recent'} aria-pressed={view === 'recent'} onClick={() => setView('recent')}>Latest</button>
        <button type="button" className="ray-toolbar-pill" data-active={view === 'top'} aria-pressed={view === 'top'} onClick={() => setView('top')}>Top</button>
        {lenses.length > 1 && lenses.map(l => (
          <button key={l.key} type="button" className="ray-toolbar-pill" data-active={view === l.key} aria-pressed={view === l.key} onClick={() => setView(l.key)}>
            Top · {shortLens(l.key, l.label)}
          </button>
        ))}
      </div>
      <div className="nsp-rows">
        {sorted.map((r, i) => <ResultRow key={`${r.id}-${i}`} row={r} />)}
      </div>
      {onEvery && sold && sold > sorted.length ? (
        <button type="button" className="ray-show-more" style={{ marginTop: 14, padding: '7px 20px' }} onClick={onEvery}>
          Every result, {sold.toLocaleString()}
        </button>
      ) : null}
    </section>
  );
}

/* ── §6 CONTEXT ────────────────────────────────────────────────────── */

type Drill = SubMarketRead & { parent?: string };

function drillIndex(marketData: MarketData | null): Map<string, Drill> {
  const m = new Map<string, Drill>();
  for (const rows of Object.values(marketData?.drills || {})) for (const r of rows as Drill[]) if (!m.has(r.slug)) m.set(r.slug, r);
  return m;
}

const DOMAIN_DRILL: Record<string, string> = { 'Film & TV': 'culture:hollywood', Music: 'culture:music' };

export function Context({ name, detail, marketData, sportKey, discipline, market }: {
  name: string; detail: EntityDetail | null; marketData: MarketData | null; sportKey: string | null; discipline: string | null; market: Market;
}) {
  const rows = useMemo(() => {
    const idx = drillIndex(marketData);
    const out: Drill[] = [];
    const add = (s: string | null) => { const r = s ? idx.get(s) : null; if (r && !out.includes(r)) out.push(r); };
    if (discipline) add(DOMAIN_DRILL[discipline] ?? null);
    for (const c of detail?.cats || []) add(drillSlugOf(c.key, sportKey));
    if (market === 'tcg') add('tcg:pokemon-cards');
    return out.slice(0, 4);
  }, [marketData, detail, sportKey, discipline, market]);
  if (!rows.length) return null;
  return (
    <section className="nsp-section ns-plate" aria-label="The markets it trades in">
      <SectionHead kicker="Context" title={`The markets ${name} trades in`} ctx={`sub-market reads across every lot — not ${name}'s own figures`} />
      <div className="nsp-ledger">
        {rows.map(r => (
          <Link key={r.slug} href={`/sub/${r.slug.replace(':', '/')}`} className="ns-ledger-row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="nsp-lk">
              <span className="t">{r.label}</span>
              <span className="nsp-lsub">{r.lots.toLocaleString()} lots</span>
            </span>
            <span className="nsp-lval">
              <ReadTag r={r} />
              {r.typicalUsd != null
                ? <><span className="nsp-lsub" style={{ marginLeft: 0 }}>typical</span><span className="nsp-lv">{formatPrice(r.typicalUsd)}</span></>
                : <span className="nsp-lsub" style={{ marginLeft: 0 }}>too few sales to typify</span>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
