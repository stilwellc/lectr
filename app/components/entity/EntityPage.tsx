'use client';
/**
 * EntityPage — ONE page for every entity (makers overhaul P2, Oct 10 2026):
 * a maker (/makers/<slug>), a player (/player?id=), and every Pokémon, film,
 * franchise, mission, person, set or collection (/entity?id=<entity id>).
 *
 * The section order (mk-overhaul audit 05 §5), the same for every kind:
 *   1. header   kicker (market · kind) → h1 → Follow → ONE labeled facts
 *               ledger: live lots, typical sale (median, n, scope), the
 *               record once (its photo or none), houses; momentum only as a
 *               labeled read (a CI'd index, or a median-on-median yoy)
 *   2. live     the shared LotBrowser over the entity's live lots — the exact
 *               pool its /makers row counts (entity key `ek`, one function)
 *   3. kind     the decision unit: medium / form / families → references /
 *               category / era + grade + language / object
 *   4. line     ONE yearly median, n-gated, gaps drawn as gaps
 *   5. results  latest / top sales, clickable, with photos
 *   6. context  the sub-markets it trades in, labeled as context
 *   7. colophon
 *
 * One source per number: every figure is the entity's summary
 * (pages/entities-<market>.json) or its detail (pages/entity-<bb>.json) —
 * both written by the one entityFigures pass the /makers ledger reads.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import ArtistNav from '../ArtistNav';
import { LOTPAGE_CSS } from '../LotPage';
import { Colophon } from '../Terminal';
import FollowButton from '../FollowButton';
import LotBrowser from '../LotBrowser';
import PlateImg from '../PlateImg';
import { FEED_DEFAULTS, feedFromParams, feedToParams, type FeedFilters } from '../FeedToolbar';
import { useRayData } from '../../hooks/useRayData';
import { useSavedLots } from '../../hooks/useSavedLots';
import { useEntity } from '../../hooks/useEntities';
import { useMarket } from '../../lib/market';
import { useUrlState, useLastVisit, houseBaselines } from '../../lib/feed-filters';
import { useBackScroll } from '../../lib/use-back-scroll';
import { livePool } from '../../lib/maker-pool';
import { entityIdOf } from '../../lib/entity/live';
import { parseEntityId, subEntityLabel } from '../../lib/entity/key';
import { followKeyOf } from '../../lib/entity/kinds';
import { catFollow, entityFollow } from '../../lib/follows';
import { lotSubjectOf } from '../../lib/maker-subjects';
import { isFlagged } from '../../lib/flags';
import { taxonOf, SPORTS, type CatKey } from '../../lib/taxonomy';
import { ARTIST_LABEL, ARTIST_MARKET, MARKETS, type Market } from '../../constants';
import { closeCut, formatDate, formatPrice, getUpcomingCounts, httpsImg, sizedImg, trueSaleDay } from '../../utils';
import { signedPct } from '../SubMarketDirectory';
import type { AuctionLot } from '../../types';
import type { VerifiedMover } from '../../preview/terminal/verified';
import { KindModule, YearlyLine, Results, Context } from './modules';
import { recordOf } from '../../lib/entity/model';
import '../../northstar-pages.css';

// the maker's full sold book (the maker shard + PastResults) mounts only on
// "Every result" — never part of the first load
const EveryResult = dynamic(() => import('./EveryResult'), { ssr: false });

/** houses print names as they shout them (Goldin: "MICKEY MANTLE") — a
 *  shouting name is re-cased for display; a cased one is left alone */
const SMALL = new Set(['de', 'da', 'del', 'della', 'di', 'la', 'le', 'van', 'von', 'y']);
export function displayName(raw: string): string {
  const name = (raw || '').trim();
  const letters = name.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 3) return name;
  const shouting = name.replace(/[^A-Z]/g, '').length / letters.length > 0.85;
  if (!shouting) return name;
  return name.toLowerCase().split(/\s+/).map((w, i) => {
    const bare = w.replace(/[.,]/g, '');
    if (/^(ii|iii|iv|jr|sr)$/.test(bare)) return bare === 'jr' || bare === 'sr' ? `${bare.charAt(0).toUpperCase()}${bare.slice(1)}.` : bare.toUpperCase();
    if (i > 0 && SMALL.has(bare)) return w;
    let out = w.replace(/(^|['’-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
    out = out.replace(/^Mc([a-z])/, (_, b) => `Mc${b.toUpperCase()}`);
    return out;
  }).join(' ');
}

const KIND_NOUN: Record<string, string> = {
  maker: 'maker', player: 'player', set: 'set', sub: 'collection',
  pokemon: 'Pokémon', person: 'person', film: 'film', franchise: 'franchise',
  mission: 'mission', team: 'team', band: 'band', brand: 'brand',
};
/** the live book's page on an entity page: 12 rows, then Show more (round 7 —
 *  the page scans first; home keeps its 24) */
const LIVE_PAGE = 12;

/* phone, tightened (round 7): the header's same type and ledger set closer,
   the record's caption held to two lines (its full title on hover / in the
   lot), so the first live lot lands higher; the line's and the results' lens
   pills ride one swipeable row instead of wrapping to three */
const ENTITY_CSS = `
@media (max-width: 640px) {
  .nsp-doss .nsp-title-row .nsp-h1 { margin-top: 4px; }
  .nsp-doss .nsp-byline { margin-top: 14px; row-gap: 10px; }
  .nsp-doss .nsp-pills { flex-wrap: nowrap !important; overflow-x: auto; scrollbar-width: none; margin-inline: calc(-1 * var(--gutter)); padding-inline: var(--gutter); }
  .nsp-doss .nsp-pills::-webkit-scrollbar { display: none; }
  .nsp-doss .nsp-pills > * { flex: none; }
  .nsp-doss .nsp-byline .s.nsp-clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
}`;

const MARKET_LABEL: Record<string, string> = Object.fromEntries(MARKETS.map(m => [m.key, m.key === 'tcg' ? 'TCG' : m.label]));

export default function EntityPage({ id }: { id: string }) {
  const ref = useMemo(() => parseEntityId(id), [id]);
  const ray = useRayData();
  const { allLots, lastCrawl, totalLots, sources, market: marketData, fromCache, loading: booting } = ray;
  const { savedIds, toggle } = useSavedLots();
  const { setMarket } = useMarket();
  const { summary, detail, summaryPending, loading: detailLoading } = useEntity(ref ? id : null);
  const market: Market = ref?.market ?? 'all';

  // the page IS its market: the nav's market lights it (once per entity)
  useEffect(() => { if (ref) setMarket(market); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  // THE LIVE BOOK — every live lot whose entity key is this id (the /makers
  // row's exact pool: the build's `ek` stamp, else the same entityKeyOf), in
  // hammer order; the lot browser applies the reader's filters
  // (a maker's lots carry its slug and a subject's sit in its market — the
  // cheap test first, so an unstamped book reads only those lots' keys)
  const live = useMemo(() => livePool(allLots)
    .filter(l => (ref?.kind === 'maker' ? l.artist === ref.slug : ARTIST_MARKET[l.artist] === market) && entityIdOf(l) === id)
    .sort((a, b) => (trueSaleDay(a) < trueSaleDay(b) ? -1 : trueSaleDay(a) > trueSaleDay(b) ? 1 : 0)), [allLots, id, ref, market]);

  // the name: the summary's, else (before it lands, or a live-only subject)
  // the spelling its live lots use most
  const name = useMemo(() => {
    if (!ref) return '';
    if (ref.kind === 'maker') return ARTIST_LABEL[ref.slug!] || summary?.label || ref.slug!;
    if (summary?.label) return displayName(summary.label);
    if (ref.kind === 'sub') return subEntityLabel(ref.cat!, ref.sub!);
    const n = new Map<string, number>();
    for (const l of live) { const s = lotSubjectOf(l); if (s) n.set(s.name, (n.get(s.name) || 0) + 1); }
    let best = '', c = 0;
    n.forEach((k, nm) => { if (k > c) { c = k; best = nm; } });
    return displayName(best);
  }, [ref, summary, live]);

  useEffect(() => {
    if (!name) return;
    const prev = document.title;
    document.title = `${name} — ${ref?.kind === 'player' ? 'player' : ref?.kind === 'maker' ? 'maker' : 'entity'} · lectr`;
    return () => { document.title = prev; };
  }, [name, ref]);

  const [filters, setFilters] = useUrlState<FeedFilters>(FEED_DEFAULTS, feedFromParams, feedToParams);
  const prevVisitDay = useLastVisit();
  const baselines = useMemo(() => houseBaselines(allLots), [allLots]);
  const scope = useMemo(() => {
    if (!ref) return null;
    if (ref.kind === 'maker') return { maker: ref.slug!, named: true };
    if (ref.kind === 'player') return { subj: `p:${ref.slug}`, named: true };
    if (ref.subjectKey) return { subj: ref.subjectKey, named: true };
    return { named: false };
  }, [ref]);
  const toggleSave = useCallback((lotId: string, lot?: AuctionLot) => { toggle(lotId, lot ?? allLots.find(l => l.id === lotId)); }, [toggle, allLots]);
  useBackScroll(live.length > 0);
  const anchorId = ref?.kind === 'maker' ? 'upcoming' : 'on-the-block';

  // a split row's "N live" narrows the live book to that cut and lands on it
  const liveByLens = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of live) { const t = taxonOf(l); const k = `${t.cat}:${t.sub}`; m.set(k, (m.get(k) || 0) + 1); }
    return m;
  }, [live]);
  const onLive = useCallback((lens: string) => {
    const i = lens.indexOf(':');
    setFilters(f => ({ ...f, cat: lens.slice(0, i) as CatKey, sub: lens.slice(i + 1), tab: 'all' }));
    document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [setFilters, anchorId]);

  const [every, setEvery] = useState(false);
  // the record photo's frame goes with a dead hotlink (no empty bordered box)
  const [recImgDeadSrc, setRecImgDeadSrc] = useState<string | null>(null);

  const upcomingCounts = useMemo(() => getUpcomingCounts(allLots), [allLots]);
  const houseCount = sources.length || new Set(allLots.map(l => l.auctionHouse)).size;
  const nav = <ArtistNav activeSlug={ref?.kind === 'maker' ? ref.slug! : ''} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />;
  const colophon = <Colophon lotCount={totalLots || allLots.length} houseCount={houseCount} record={null} />;

  // nothing at this address: no summary, no sold history, nothing live
  const settled = !booting && !summaryPending && !detailLoading;
  if (!ref || (settled && !summary && !detail && live.length === 0)) {
    return (
      <div className="terminal-shell">
        {nav}
        <div className="rail nsp-empty">
          <span className="ns-kicker">{ref?.kind === 'player' ? 'Player' : 'Entity'}</span>
          <h1>Nothing tracked here yet</h1>
          <p>lectr keeps a page where at least ten sales back it, or something is on the block.</p>
          <div className="nsp-links">
            <Link href={ref ? `/makers/m/${market}` : '/makers'} className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>Back to the roster</Link>
          </div>
        </div>
        {colophon}
      </div>
    );
  }

  const kindNoun = KIND_NOUN[ref.kind === 'subject' ? (ref.subKind || 'subject') : ref.kind] || 'name';
  const followKey = ref.kind === 'maker' || ref.kind === 'player' ? followKeyOf(id, { playerDossier: true }) : null;
  // a collection follows its clean category; a subject / set its entity id
  // (app/lib/follows — "For you" ranks its lots, the nightly alerts on them)
  const follow = followKey ? null
    : ref.kind === 'sub' && ref.cat ? catFollow(ref.cat as CatKey, ref.sub ?? null)
    : name ? entityFollow(id, name) : null;
  const sportKey = market === 'sports' ? (SPORTS.find(s => s.label === summary?.discipline)?.key ?? null) : null;
  const flags = live.reduce((n, l) => n + (isFlagged(l) ? 1 : 0), 0);
  const liveHouses = new Set(live.map(l => l.auctionHouse)).size;
  // the record once: the summary's [price, day], its title / house / photo
  // from the detail's top results (model recordOf — matched, never assumed)
  const rec = recordOf(summary?.record ?? null, detail);
  const recImg = httpsImg(rec?.img ?? null);
  const recImgDead = !!recImg && recImgDeadSrc === recImg;
  const onRecImgDead = () => setRecImgDeadSrc(recImg ?? null);
  const recTitle = rec?.t || '';
  const recId = rec?.id || null;
  const houses = detail?.houses ?? [];
  const verified = (summary?.verified as VerifiedMover | null) ?? null;
  const defaultLens = (() => {
    const ml = summary?.medLens;
    if (!ml || !detail?.lensSplit) return null;
    return detail.lensSplit.find(l => ml === l.key || ml.startsWith(`${l.key}:`))?.key ?? null;
  })();
  const pending = summaryPending || (!summary && !detail && detailLoading);

  return (
    <div className="terminal-shell">
      {nav}
      <div className="rail nsp-doss">
        <style dangerouslySetInnerHTML={{ __html: LOTPAGE_CSS + ENTITY_CSS }} />

        {/* §1 THE HEADER */}
        <div className="nsp-kicker-row">
          <span className="ns-kicker">
            <Link href={`/makers/m/${market}`}>{MARKET_LABEL[market] || market}</Link>
            {summary?.discipline ? <>{' · '}{summary.discipline}</> : null}
            {` · ${kindNoun}`}
          </span>
          {summary?.sold ? (
            <span className="no" title={houses.length ? houses.map(h => `${h.h} ${h.n.toLocaleString()}`).join(' · ') : undefined}>
              {summary.sold.toLocaleString()} sales tracked{houses.length ? ` · ${houses.length} ${houses.length === 1 ? 'house' : 'houses'}` : ''}
            </span>
          ) : null}
        </div>
        <div className="nsp-title-row">
          <h1 className="nsp-h1">{name || ' '}</h1>
          {followKey && name ? <FollowButton slug={followKey} name={name} /> : follow && name ? <FollowButton follow={follow} name={name} /> : null}
        </div>

        <div className="ns-byline nsp-byline" aria-busy={pending || undefined}>
          <div>
            <div className="k">On the block</div>
            <div className="v">{booting ? '—' : live.length ? <a href={`#${anchorId}`} style={{ color: 'inherit', textDecoration: 'none' }}>{live.length.toLocaleString()} live</a> : 'None live'}</div>
            <div className="s">{live.length ? `${liveHouses} ${liveHouses === 1 ? 'house' : 'houses'}${flags ? ` · ${flags} Below market` : ''}` : 'nothing up for sale today'}</div>
          </div>
          <div>
            <div className="k">Typical sale</div>
            <div className="v">{pending ? '—' : summary?.med12m != null ? formatPrice(summary.med12m) : '—'}</div>
            <div className="s">
              {pending ? ' ' : summary?.med12m != null
                ? `${summary.medScope ? `${summary.medScope.toLowerCase()} · ` : ''}12-mo median${summary.med12mN ? ` · n=${summary.med12mN.toLocaleString()}` : ''}`
                : 'fewer than 5 sales in the past 12 months'}
            </div>
          </div>
          {rec ? (
            <div>
              <div className="k">Record</div>
              <div className="v" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {recImg && !recImgDead ? (
                  <span className="lectr-lot-comp-thumb" aria-hidden style={{ width: 32, height: 32 }}>
                    <PlateImg src={sizedImg(recImg, 120)} alt="" loading="lazy" referrerPolicy="no-referrer" onDead={onRecImgDead} />
                  </span>
                ) : null}
                {recId ? <Link href={`/lot?id=${encodeURIComponent(recId)}`} style={{ color: 'inherit', textDecoration: 'none' }}>{formatPrice(rec.p)}</Link> : formatPrice(rec.p)}
              </div>
              <div className="s nsp-clamp2" title={[recTitle, rec.h, rec.d ? rec.d.slice(0, 4) : null].filter(Boolean).join(' · ') || undefined}>{[recTitle ? (recTitle.length > 40 ? closeCut(recTitle.slice(0, 40), 40) : recTitle) : null, rec.h, rec.d ? rec.d.slice(0, 4) : null].filter(Boolean).join(' · ')}</div>
            </div>
          ) : null}
          {verified ? (
            <div>
              <div className="k">Verified index, {verified.horizon}</div>
              <div className={`v ${verified.changePct >= 0 ? 'up' : 'down'}`}><span className="mono">{signedPct(verified.changePct)}</span></div>
              <div className="s">95% interval [{signedPct(verified.ciLoPct)}, {signedPct(verified.ciHiPct)}] · {verified.n.toLocaleString()} lots</div>
            </div>
          ) : summary?.yoy ? (
            <div>
              <div className="k">Year on year</div>
              <div className="v"><span className="mono">{signedPct(summary.yoy.pct)}</span></div>
              {summary.yoy.basis === 'matched' ? (
                <div className="s" title="Like for like: each item (the same card at the same grade, the same reference, the same edition) that sold in both years gives its price ratio; this is the median ratio, the last four complete quarters against the four before">{summary.medScope ? `${summary.medScope.toLowerCase()}, ` : ''}same items · 4 qtrs vs 4 · {summary.yoy.n.toLocaleString()} matched</div>
              ) : (
                <div className="s" title="The median of the last four complete quarters against the four before, printed only when both years sold a similar number of lots — a level the mix of what sold moves too, not an appreciation rate">{summary.medScope ? `${summary.medScope.toLowerCase()} median` : 'median'} · 4 qtrs vs 4 · n={summary.yoy.n.toLocaleString()}</div>
              )}
            </div>
          ) : null}
        </div>

        {/* §2 THE LIVE BOOK */}
        {live.length > 0 && (
          <section id={anchorId} className="nsp-section nsp-live ns-plate" aria-label="On the block now">
            <div className="nsp-shead" style={{ marginBottom: 14 }}>
              <div>
                <span className="ns-kicker">Live</span>
                <h2 className="nsp-h2">On the block now, {live.length.toLocaleString()}</h2>
              </div>
              <span className="nsp-shctx">{liveHouses} {liveHouses === 1 ? 'house' : 'houses'} · every category</span>
            </div>
            <LotBrowser
              lots={live}
              compLots={allLots}
              filters={filters}
              onFiltersChange={next => setFilters(next)}
              market={market}
              scope={scope}
              savedIds={savedIds}
              onToggleSave={toggleSave}
              lastCrawl={lastCrawl}
              fromCache={fromCache}
              prevVisitDay={prevVisitDay}
              baselines={baselines}
              anchorId={anchorId}
              persistKey={`/entity/${id}`}
              pageSize={LIVE_PAGE}
            />
          </section>
        )}

        {detail && (
          <>
            {/* §3 THE KIND MODULE */}
            <KindModule
              id={id} kind={ref.kind} subKind={ref.subKind} market={market} slug={ref.slug} label={name}
              detail={detail} marketData={marketData} liveByLens={liveByLens} onLive={onLive} sportKey={sportKey}
            />
            {/* §4 THE LINE */}
            <YearlyLine detail={detail} name={name} defaultLens={defaultLens} />
            {/* §5 RESULTS */}
            <Results detail={detail} sold={summary?.sold ?? null} onEvery={ref.kind === 'maker' && !every ? () => setEvery(true) : null} />
          </>
        )}
        {!detail && !detailLoading && !pending && (
          <p className="nsp-note" style={{ marginTop: 28 }}>No sold history is filed under {name} yet — the live book above is the whole record.</p>
        )}
        {/* §6 CONTEXT */}
        <Context name={name} detail={detail} marketData={marketData} sportKey={sportKey} discipline={summary?.discipline ?? null} market={market} />
        <div className="nsp-links">
          <Link href={`/makers/m/${market}`} className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>The {MARKET_LABEL[market] || market} roster</Link>
          <Link href={market === 'all' ? '/' : `/${market}`} className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>The {MARKET_LABEL[market] || market} market</Link>
          <Link href="/sub" className="ray-call-btn ray-call-btn-quiet" style={{ textDecoration: 'none' }}>Every sub-market</Link>
        </div>
      </div>

      {/* "Every result": the maker's whole sold book, on request */}
      {every && ref.kind === 'maker' && <EveryResult slug={ref.slug!} />}
      {colophon}
    </div>
  );
}
