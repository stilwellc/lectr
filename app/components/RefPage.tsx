'use client';

/**
 * RefPage — the reference dossier. /ref?id=<maker:refKey> renders one watch
 * reference/model line from refs.json (build-time aggregates over the sold
 * book): sample size, medians, the yearly monoline, and the recent sales as
 * ledger rows. The page a bidder reads before trusting an estimate.
 *
 * North-star grammar (docs/NORTHSTAR_UI.md, LotPage's pass): quiet gray
 * kicker → light display title → byline provenance ledger (sales / median /
 * past year / beat rate / houses) → the yearly line in a framed chart →
 * sections as registration plates with dotted comp rows.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ArtistNav from './ArtistNav';
import { LOTPAGE_CSS } from './LotPage';
import { Colophon } from './Terminal';
import SalesScatter from '../ref/SalesScatter';
import { variantsOf } from '../ref/ref-book';
import { encodeRefPath } from '../ref/ref-path';
import { loadRefSales } from '../lib/search-index';
import type { RefSale } from '../lib/search-tokens';
import { useRayData } from '../hooks/useRayData';
import { useSavedLots } from '../hooks/useSavedLots';
// the shared refs fetch (module-cached, one pull per session) — the same hook
// the watch maker dossier's RefLedger mounts, so /ref and /makers/<watch>
// never fetch refs.json twice
import { useRefs, type RefEntry } from '../hooks/useRefs';
import { ARTIST_LABEL } from '../constants';
import { closeCut, formatPrice, formatDate, getUpcomingCounts, houseColors, craftTitle, refLabel, httpsImg, sizedImg } from '../utils';
import PlateImg from './PlateImg';
import Term from './Term';
import '../northstar-pages.css';

export type { RefEntry };

/** Every sale on a true time axis — the dots ARE the data (SalesScatter).
    Falls back to the eight latest sales when the full ledger is unavailable,
    and says so. */
function RefChart({ entry, sales, label }: { entry: RefEntry; sales: RefSale[] | null; label: string }) {
  const pts: RefSale[] = sales ?? entry.recent.map(r => [r.d, r.p, r.id, r.h, r.t, r.img] as RefSale);
  if (pts.length < 2) return null;
  const years = pts.map(s => +s[0].slice(0, 4)).filter(y => y > 1900);
  return (
    <section className="nsp-section ns-plate" aria-label="Every sale, by date">
      <div className="nsp-shead">
        <div>
          <h2 className="nsp-h2">
            {sales ? `Every sale, ${Math.min(...years)}–${Math.max(...years)}` : `The latest ${pts.length} sales`}
          </h2>
        </div>
        <span className="nsp-shctx">{pts.length.toLocaleString()} hammers · realized, all-in</span>
      </div>
      <div style={{ marginTop: 12 }}>
        <SalesScatter sales={pts} yearly={entry.yearly} label={label} />
      </div>
      {sales && sales.length !== entry.n && (
        <p className="nsp-note">
          The chart plots the {sales.length.toLocaleString()} sales in tonight&rsquo;s book; the medians above use the{' '}
          {entry.n.toLocaleString()} that pass the comp gates (duplicates and flagged lots set aside).
        </p>
      )}
      {!sales && <p className="nsp-note">The full sale ledger didn&rsquo;t load — plotting the latest sales only.</p>}
    </section>
  );
}

const SALES_PAGE = 12;

export default function RefPage({ refKey }: { refKey: string }) {
  const { allLots, lastCrawl, totalLots } = useRayData();
  const { savedIds } = useSavedLots();
  const { refs, failed } = useRefs();
  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);
  const entry = useMemo(() => refs?.find(r => r.key === refKey) || null, [refs, refKey]);
  // the full sale ledger (search/r-<maker>--<key>.json) — the chart's dots and
  // the "every sale" list; null until loaded / when unavailable
  const [sales, setSales] = useState<RefSale[] | null>(null);
  const [salesState, setSalesState] = useState<'loading' | 'ok' | 'none'>('loading');
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (!entry) return;
    let dead = false;
    loadRefSales(entry.maker, entry.ref).then(s => {
      if (dead) return;
      if (s && s.length) { setSales(s); setSalesState('ok'); } else setSalesState('none');
    });
    return () => { dead = true; };
  }, [entry]);
  const variants = useMemo(() => (entry && refs ? variantsOf(refs, entry.maker, entry.ref) : []), [refs, entry]);

  // live lots of this reference currently on the block (client-derived — the
  // slim payload carries `reference` on watch lots)
  const onBlock = useMemo(() => {
    if (!entry) return [];
    return allLots.filter(l => l.status === 'upcoming' && l.artist === entry.maker && l.reference === entry.ref);
  }, [allLots, entry]);

  const nav = <ArtistNav activeSlug={entry ? entry.maker : ''} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />;

  if (!entry) {
    const loading = refs === null && !failed;
    return (
      <div className="terminal-shell">
        {nav}
        {/* while refs.json loads, fill the viewport so the colophon never
            paints on screen and then gets shoved down by the dossier (CLS).
            Only the loading branch reserves it — the "not in the book" and
            failure copy is the final layout and needs no hold. */}
        <div className="rail nsp-empty" style={{ minHeight: loading ? '100dvh' : undefined }}>
          {loading ? (
            <p>Loading the reference book&hellip;</p>
          ) : (
            <>
              <span className="ns-kicker">Reference dossier</span>
              <h1>Not in the reference book</h1>
              <p>{failed ? 'The reference data didn’t load — try again shortly.' : 'lectr keeps a dossier only where at least eight sales back it.'}</p>
              <div className="nsp-links">
                <Link href="/makers" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>The makers</Link>
              </div>
            </>
          )}
        </div>
        <Colophon lotCount={totalLots || allLots.length} record={null} />
      </div>
    );
  }

  const makerName = ARTIST_LABEL[entry.maker] || entry.maker;
  // the past-year median against the all-time median — a real price move
  // on this reference, so it may wear the lamp (up green / down red)
  const delta = entry.ttmMedianUsd != null && entry.medianUsd > 0
    ? Math.round(100 * (entry.ttmMedianUsd / entry.medianUsd - 1)) : null;
  // ONE SPAN, from every row the page prints: the yearly line only keeps years
  // with 3+ sales, so a reference whose recent hammers are thin read
  // "2010–2023" above rows dated 2026. The span now covers the yearly years
  // AND the recent rows; the chart names its own gated range separately.
  const spanYears = [
    ...entry.yearly.map(y => y.y),
    ...entry.recent.map(r => +String(r.d || '').slice(0, 4)).filter(y => y > 1900),
  ];
  const yearSpan = spanYears.length
    ? (Math.min(...spanYears) === Math.max(...spanYears) ? String(spanYears[0]) : `${Math.min(...spanYears)}–${Math.max(...spanYears)}`)
    : null;

  // the list under the chart: the full ledger when loaded (newest first),
  // else refs.json's latest 8
  const listRows = sales
    ? sales.map(r => ({ id: r[2], d: r[0], h: r[3], p: r[1], t: r[4], img: r[5] }))
    : entry.recent;
  const listTotal = sales ? sales.length : entry.n;
  const listAll = showAll ? listRows : listRows.slice(0, SALES_PAGE);

  return (
    <div className="terminal-shell">
      {nav}
      <div className="rail nsp-doss">
        <style dangerouslySetInnerHTML={{ __html: LOTPAGE_CSS }} />

        <div className="nsp-kicker-row">
          <span className="ns-kicker">
            <Link href={`/makers/${entry.maker}`}>{makerName}</Link>
            {' · reference dossier'}
          </span>
          <span className="no">{entry.n.toLocaleString()} sales</span>
        </div>
        <h1 className="nsp-h1">{refLabel(entry.ref)}</h1>
        <p className="nsp-dek">
          Every {makerName} sale lectr has catalogued under this reference — {entry.n.toLocaleString()} on the book
          {yearSpan ? `, ${yearSpan}` : ''}. Medians, never means.
        </p>

        {/* the byline ledger — gray label over ink value, dotted closing rule */}
        <div className="ns-byline nsp-byline">
          <div>
            <div className="k">Sales on the book</div>
            <div className="v">{entry.n.toLocaleString()}</div>
            <div className="s">realized, buyer&rsquo;s premium included</div>
          </div>
          <div>
            <div className="k">Median, all-time</div>
            <div className="v">{formatPrice(entry.medianUsd)}</div>
          </div>
          {entry.ttmMedianUsd != null && (
            <div>
              <div className="k">Median, past year</div>
              <div className="v">
                {formatPrice(entry.ttmMedianUsd)}
                {delta != null && delta !== 0 && (
                  <span className={`mono ${delta > 0 ? 'up' : 'down'}`} style={{ marginLeft: 8 }}>
                    {delta > 0 ? '+' : '−'}{Math.abs(delta)}%
                  </span>
                )}
              </div>
              <div className="s">vs the all-time median</div>
            </div>
          )}
          {entry.beatHighPct != null && (
            <div>
              <div className="k">Beat the high estimate</div>
              <div className="v"><span className="mono">{entry.beatHighPct}%</span></div>
              <div className="s">of sales with a published estimate</div>
            </div>
          )}
          <div>
            <div className="k">Houses</div>
            <div className="v">{entry.houses.join(', ')}</div>
          </div>
        </div>

        {variants.length > 0 && (
          <p className="nsp-note" style={{ fontSize: 13 }}>
            Also catalogued as{' '}
            {variants.map((v, i) => (
              <React.Fragment key={v.key}>
                {i > 0 && ', '}
                <Link href={`/ref/${v.maker}/${encodeRefPath(v.ref)}`} style={{ color: 'var(--color-fg)' }}>
                  &ldquo;{v.ref}&rdquo;, {v.n.toLocaleString()} sales
                </Link>
              </React.Fragment>
            ))}{' '}— a separate dossier under the other spelling.
          </p>
        )}

        {salesState !== 'loading' && <RefChart entry={entry} sales={sales} label={`${makerName} ${refLabel(entry.ref)}`} />}

        {onBlock.length > 0 && (
          <section className="nsp-section ns-plate" aria-label="On the block now">
            <div className="nsp-shead">
              <div>
                <span className="ns-kicker">Live</span>
                <h2 className="nsp-h2">On the block now, {onBlock.length}</h2>
              </div>
              <span className="nsp-shctx">house estimates, hammer basis</span>
            </div>
            <div className="nsp-rows">
              {onBlock.slice(0, 6).map(l => (
                <Link key={l.id} href={`/lot?id=${encodeURIComponent(l.id)}`} className="lectr-lot-comp">
                  <span className="lectr-lot-comp-t">
                    <span className="lectr-lot-comp-title" style={{ display: 'block' }}>{craftTitle(l.title)}</span>
                    <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>
                      <span style={{ color: houseColors[l.auctionHouse] || 'var(--color-text-faint)', fontWeight: 500 }}>{l.auctionHouse}</span>
                      {' · hammers '}{formatDate(l.saleDate)}
                    </span>
                  </span>
                  <span className="lectr-lot-comp-p">
                    {l.estimateLow ? `${formatPrice(l.estimateLow)} est.` : '—'}
                  </span>
                </Link>
              ))}
            </div>
            <p className="nsp-note">
              Estimates are the house&rsquo;s, on the hammer. Where the engine <Term id="flags">flags</Term> a lot, or <Term id="abstain">abstains</Term> from
              valuing it, the lot&rsquo;s own certificate says so.
            </p>
          </section>
        )}

        <section className="nsp-section ns-plate" aria-label="Recent sales">
          <div className="nsp-shead">
            <div>
              <h2 className="nsp-h2">{listAll.length < listTotal ? `Latest ${listAll.length} of ${listTotal.toLocaleString()} sales` : `Every sale, ${listTotal.toLocaleString()}`}</h2>
            </div>
            <span className="nsp-shctx">realized, buyer&rsquo;s premium included</span>
          </div>
          <div className="nsp-rows">
            {listAll.map(s => (
              <Link key={s.id} href={`/lot?id=${encodeURIComponent(s.id)}`} className="lectr-lot-comp">
                <span className="lectr-lot-comp-thumb" aria-hidden>
                  <span>{(s.t || '?').charAt(0)}</span>
                  {/* .lectr-lot-comp-thumb is a 40×40 well (LotPage CSS) —
                      ask the resizer for 160 rather than hauling the 2880 px
                      master into an avatar (measured 672 KB → ~4 KB each) */}
                  {/* PlateImg, not a bare <img>: an ORB-blocked host (christies)
                      fires no error event, so the old onError-only fallback left
                      a dead opaque box over the monogram. Same well, same fix as
                      the LotPage/modal comp rows. */}
                  {s.img && <PlateImg src={sizedImg(httpsImg(s.img)!, 160)} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                </span>
                <span className="lectr-lot-comp-t">
                  <span className="lectr-lot-comp-title" style={{ display: 'block' }}>{(s.t || '').length >= 80 ? closeCut(craftTitle(s.t), 1) : craftTitle(s.t)}</span>
                  <span className="lectr-lot-comp-meta" style={{ display: 'block' }}>
                    <span style={{ color: houseColors[s.h] || 'var(--color-text-faint)', fontWeight: 500 }}>{s.h}</span>
                    {' · '}{formatDate(s.d, { month: 'short', year: 'numeric' })}
                  </span>
                </span>
                <span className="lectr-lot-comp-p">{formatPrice(s.p)}</span>
              </Link>
            ))}
          </div>
          {listRows.length > listAll.length && (
            <div style={{ marginTop: 14 }}>
              <button type="button" className="ray-call-btn ray-call-btn-quiet" onClick={() => setShowAll(true)}>
                Show all {listRows.length.toLocaleString()} sales
              </button>
            </div>
          )}
          <p className="nsp-note">
            Medians over every {makerName} sale lectr has catalogued for this reference — the yearly medians are a
            mix-affected level, not an appreciation rate.
          </p>
        </section>

        <div className="nsp-links">
          <Link href={`/makers/${entry.maker}`} className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>
            {makerName}, the maker&rsquo;s book
          </Link>
          <Link href="/ref" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>
            Every reference
          </Link>
          <Link href="/glossary" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>
            Glossary
          </Link>
        </div>
      </div>
      <Colophon lotCount={totalLots || allLots.length} record={null} />
    </div>
  );
}
