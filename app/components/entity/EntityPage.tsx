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
 *               labeled read (a CI'd index, or a yoy with its basis and
 *               90% interval)
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
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import ArtistNav from '../ArtistNav';
import { LOTPAGE_CSS } from '../lotpage-css';
import { Colophon } from '../Terminal';
import FollowButton from '../FollowButton';
import LotBrowser from '../LotBrowser';
import PlateImg from '../PlateImg';
import { FEED_DEFAULTS, feedFromParams, feedToParams, type FeedFilters } from '../FeedToolbar';
import { useRayDataFirst, useHouseBaselines } from '../../hooks/useRayData';
import { entityFsKey, fsVersion, fetchFirstScreen } from '../../lib/first-screen';
import FirstPaintIsland, { useFirstPaint, useFirstPaintShown } from '../FirstPaint';
import type { EntitySeed } from './seed-server';
import { useSavedLots } from '../../hooks/useSavedLots';
import { useEntity } from '../../hooks/useEntities';
import { useMarket } from '../../lib/market';
import { useLearnVisit } from '../../lib/recs-signals';
import { useUrlState, useLastVisit } from '../../lib/feed-filters';
import { useBackScroll } from '../../lib/use-back-scroll';
import { livePool } from '../../lib/maker-pool';
import { entityIdOf } from '../../lib/entity/live';
import { parseEntityId, subEntityLabel } from '../../lib/entity/key';
import { followKeyOf } from '../../lib/entity/kinds';
import { catFollow, entityFollow } from '../../lib/follows';
import { lotSubjectOf } from '../../lib/maker-subjects';
import { isFlagged } from '../../lib/flags';
import { taxonOf, SPORTS, type CatKey } from '../../lib/taxonomy';
import { ARTIST_LABEL, ARTIST_MARKET, MAKER_MARKETS, MARKETS, type Market } from '../../constants';
import { closeCut, formatDate, formatPrice, getUpcomingCounts, httpsImg, sizedImg, tidyTitle, trueSaleDay, unshoutTitle } from '../../utils';
import { signedPct } from '../SubMarketDirectory';
import { yoyIntervalText } from '../../lib/entity/ledger';
import type { AuctionLot } from '../../types';
import type { VerifiedMover } from '../../preview/terminal/verified';
import { KindModule, YearlyLine, Results, Context } from './modules';
import { RayLoading } from '../RayEntrance';
import { recordOf } from '../../lib/entity/model';
import { displayName, KIND_NOUN, entityDocTitle } from '../../lib/entity/display';
import { useLotLinks } from '../../lib/lot-resolve';
import '../../northstar-pages.css';

// the maker's full sold book (the maker shard + PastResults) mounts only on
// "Every result" — never part of the first load
const EveryResult = dynamic(() => import('./EveryResult'), { ssr: false });

// displayName / KIND_NOUN / the tab title live in a pure module so the static
// aliases (/p, /e) print the same name and title in their build-time head
export { displayName };
/** the live book's page on an entity page: 12 rows, then Show more (round 7 —
 *  the page scans first; home keeps its 24) */
const LIVE_PAGE = 12;
/** (r8, QA3 E1) …and 8 on a phone, where every row is a full-width card */
const LIVE_PAGE_PHONE = 8;

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

const NO_COUNTS: Record<string, number> = {};
const MARKET_LABEL: Record<string, string> = Object.fromEntries(MARKETS.map(m => [m.key, m.key === 'tcg' ? 'TCG' : m.label]));

const NO_SUB = () => () => {};
/** (W30) the entity pages' first-paint step: ~640 static pages each render
 *  every step into their HTML at build time, so they step at 40 minutes
 *  (≈1.1GB of steps folded, not ≈2.2GB) — W27's pages keep 20 */
const FP_ENTITY_STEP_MIN = 40;

export default function EntityPage({ id, seed }: { id: string; seed?: EntitySeed | null }) {
  const ref = useMemo(() => parseEntityId(id), [id]);
  // (perf W13) the header + live book paint from this entity's first-screen
  // slice — every eager lot whose entity key shares its bucket, so `live`
  // below is the book's exact list — then the whole book replaces it
  const fsKey = ref && fsVersion() ? entityFsKey(id) : null;
  // (W30) a static page's build also draws the live book into its HTML (the
  // W27 first paint, app/components/FirstPaint): each step renders THIS page
  // from a pinned snapshot of the same slice and keeps only the live book
  const snap = useFirstPaint();
  const liveRay = useRayDataFirst(snap ? null : fsKey);
  const ray = snap ? snap.ray : liveRay;
  const { allLots, lastCrawl, totalLots, sources, market: marketData, loading: booting, partial } = ray;
  // the first-paint copy already on screen is replaced in place, resolved
  const fpShown = useFirstPaintShown(fsKey);
  const fromCache = ray.fromCache || fpShown;
  const { savedIds, toggle } = useSavedLots();
  const { setMarket } = useMarket();
  // (W30) a static page's header is the build's (./seed-server): the same
  // summary file the page would fetch, so it prints with the HTML and is
  // never fetched again; the detail still loads (the sections below)
  // A query route's shell carries none: its first-screen slice does (the
  // build's `hdr`, the same seed per entity of the bucket) — read off the
  // slice fetch the page already makes, before the summary file is asked for
  const own = seed && seed.id === id ? seed : null;
  const [hdr, setHdr] = useState<{ id: string; seed: EntitySeed | null } | null>(null);
  // (latched: the page that mounted booting reads it, even once the slice lands)
  const [bootedAtMount] = useState(booting);
  const hdrWanted = !own && !snap && !!fsKey && bootedAtMount;
  useEffect(() => {
    if (!hdrWanted || !fsKey) return;
    let on = true;
    fetchFirstScreen(fsKey).then(p => {
      const h = (p as { hdr?: Record<string, Omit<EntitySeed, 'id'>> } | null)?.hdr?.[id];
      if (on) setHdr({ id, seed: h ? { id, ...h } : null });
    });
    return () => { on = false; };
  }, [hdrWanted, fsKey, id]);
  const sd = own ?? (hdr?.id === id ? hdr.seed : null);
  // no summary fetch while the slice may still hand the header over
  const hdrSettled = !hdrWanted || hdr?.id === id;
  const known = useMemo(() => (sd ? { s: sd.s, detail: null } : undefined), [sd]);
  const { summary, detail, summaryPending: sumPending, loading: detailLoading } = useEntity(ref && hdrSettled ? id : null, true, known, booting ? undefined : lastCrawl || undefined);
  const summaryPending = sumPending || !hdrSettled;
  // the build prints counts in its own locale; the reader's own once mounted
  // (a hydration must match the HTML byte for byte)
  const mounted = useSyncExternalStore(NO_SUB, () => true, () => false);
  const nf = (n: number) => (mounted || snap ? n.toLocaleString() : n.toLocaleString('en-US'));
  const market: Market = ref?.market ?? 'all';

  // the page IS its market: the nav's market lights it (once per entity)
  useEffect(() => { if (ref) setMarket(market); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  // THE LIVE BOOK — every live lot whose entity key is this id (the /makers
  // row's exact pool: the build's `ek` stamp, else the same entityKeyOf), in
  // hammer order; the lot browser applies the reader's filters
  // (a stamped lot compares its `ek`; on an unstamped book the cheap test runs
  // first — a maker's lots carry its slug or sit on a collectibles desk (r8: a
  // tracked artist's signed pieces there are the maker's), a subject's sit on a
  // collection desk (r8: a public figure's sports-desk piece is their person's)
  const live = useMemo(() => livePool(allLots)
    .filter(l => {
      const ek = (l as AuctionLot & { ek?: string | null }).ek;
      if (ek !== undefined) return ek === id;
      const m = ARTIST_MARKET[l.artist];
      const near = ref?.kind === 'maker' ? l.artist === ref.slug || !MAKER_MARKETS.has(m) : !MAKER_MARKETS.has(m);
      return near && entityIdOf(l) === id;
    })
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

  // on-device memory (app/lib/recs-signals): a visited page leans "Lots you
  // may like" toward this name, below any follow — never sent anywhere
  useLearnVisit('entity', ref && name ? id : null, () => ({ label: name }));

  useEffect(() => {
    if (!name) return;
    const prev = document.title;
    document.title = entityDocTitle(name, ref?.kind);
    return () => { document.title = prev; };
  }, [name, ref]);

  const [filters, setFilters] = useUrlState<FeedFilters>(FEED_DEFAULTS, feedFromParams, feedToParams);
  const prevVisitDay = useLastVisit();
  const baselines = useHouseBaselines(ray);
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
  // the record's lot link: its alias, or none when no lot page answers (r8)
  // (W30) before the detail lands, a static page's header holds the build's
  // record — recordOf over the same detail bucket (./seed-server)
  const recOf = (s: typeof summary, d: typeof detail) => (d || !sd ? recordOf(s?.record ?? null, d) : sd.rec);
  const recRow = useMemo(() => {
    const r = recOf(summary, detail);
    return r?.id ? [{ id: r.id, img: r.img ?? null }] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, detail, sd]);
  const recLinkOf = useLotLinks(recRow);

  // the nav's per-maker live counts read the whole book: none while partial
  const upcomingCounts = useMemo(() => (partial ? NO_COUNTS : getUpcomingCounts(allLots)), [allLots, partial]);
  const houseCount = sources.length || new Set(allLots.map(l => l.auctionHouse)).size;
  const nav = <ArtistNav activeSlug={ref?.kind === 'maker' ? ref.slug! : ''} savedCount={savedIds.length} upcomingCounts={upcomingCounts} lastCrawl={lastCrawl ? formatDate(lastCrawl) : undefined} />;
  const colophon = <Colophon lotCount={totalLots || allLots.length} houseCount={houseCount} record={null} />;

  // nothing at this address: no summary, no sold history, nothing live
  const settled = !booting && !partial && !summaryPending && !detailLoading;
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
  const rec = recOf(summary, detail);
  const recImg = httpsImg(rec?.img ?? null);
  const recImgDead = !!recImg && recImgDeadSrc === recImg;
  const onRecImgDead = () => setRecImgDeadSrc(recImg ?? null);
  // a feed title scraped all-lowercase reads as a typo in the header: case it
  const recTitle = (() => { const t = tidyTitle(rec?.t); return t && t === t.toLowerCase() ? unshoutTitle(t) : t; })();
  const recId = rec?.id ? recLinkOf(rec.id) : null;
  const houses = detail?.houses ?? sd?.houses ?? [];
  const verified = (summary?.verified as VerifiedMover | null) ?? null;
  const defaultLens = (() => {
    const ml = summary?.medLens;
    if (!ml || !detail?.lensSplit) return null;
    return detail.lensSplit.find(l => ml === l.key || ml.startsWith(`${l.key}:`))?.key ?? null;
  })();
  const pending = summaryPending || (!summary && !detail && detailLoading);

  // §2 THE LIVE BOOK
  const liveBook = live.length > 0 && (
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
        phonePageSize={LIVE_PAGE_PHONE}
        slice={partial ? 'comps' : null}
      />
    </section>
  );
  // (W30) a first-paint step keeps the live book and what follows it while
  // the page holds its slice (the loading plate) — the copy is the page's
  // own partial render of that span, so it is replaced in place
  if (snap) return <>{liveBook}<RayLoading /></>;
  // (W30) a page without the build's header (the query routes) holds the
  // header and the live book together until its facts are in — a ledger
  // that fills in piece by piece pushed the live book down twice
  const headerHeld = !sd && (booting || summaryPending || detailLoading);

  return (
    <div className="terminal-shell">
      {nav}
      <div className="rail nsp-doss">
        <style dangerouslySetInnerHTML={{ __html: LOTPAGE_CSS + ENTITY_CSS }} />

        {headerHeld ? <RayLoading /> : (
          <>
            {/* §1 THE HEADER */}
            <div className="nsp-kicker-row">
              <span className="ns-kicker">
                <Link href={`/makers/m/${market}`}>{MARKET_LABEL[market] || market}</Link>
                {summary?.discipline ? <>{' · '}{summary.discipline}</> : null}
                {` · ${kindNoun}`}
              </span>
              {summary?.sold ? (
                <span className="no" title={houses.length ? houses.map(h => `${h.h} ${nf(h.n)}`).join(' · ') : undefined}>
                  {nf(summary.sold)} sales tracked{houses.length ? ` · ${houses.length} ${houses.length === 1 ? 'house' : 'houses'}` : ''}
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
                <div className="v">{booting ? '—' : live.length ? <a href={`#${anchorId}`} style={{ color: 'inherit', textDecoration: 'none' }}>{nf(live.length)} live</a> : 'None live'}</div>
                {/* (W30) nothing claimed while the book loads: a held line */}
                <div className="s">{booting ? '\u00a0' : live.length ? `${liveHouses} ${liveHouses === 1 ? 'house' : 'houses'}${flags ? ` · ${flags} Below market` : ''}` : 'nothing up for sale today'}</div>
              </div>
              <div>
                <div className="k">Typical sale</div>
                <div className="v">{pending ? '—' : summary?.med12m != null ? formatPrice(summary.med12m) : '—'}</div>
                <div className="s">
                  {pending ? ' ' : summary?.med12m != null
                    ? `${summary.medScope ? `${summary.medScope.toLowerCase()} · ` : ''}12-mo median${summary.med12mN ? ` · n=${nf(summary.med12mN)}` : ''}`
                    : 'fewer than 5 sales in the past 12 months'}
                </div>
              </div>
              {rec ? (
                <div>
                  <div className="k">Record</div>
                  <div className="v" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {recImg && !recImgDead ? (
                      <span className="lectr-lot-comp-thumb" aria-hidden style={{ width: 32, height: 32 }}>
                        {/* (W30) the photo waits for the page's JS: printed in the HTML
                            it took the slow pipe from the scripts (+1.5s at 400kbps) */}
                        {mounted ? <PlateImg src={sizedImg(recImg, 120)} alt="" loading="lazy" referrerPolicy="no-referrer" onDead={onRecImgDead} /> : null}
                      </span>
                    ) : null}
                    {recId ? <Link href={`/lot?id=${encodeURIComponent(recId)}`} style={{ color: 'inherit', textDecoration: 'none' }}>{formatPrice(rec.p)}</Link> : formatPrice(rec.p)}
                  </div>
                  <div className="s nsp-clamp2" title={[recTitle, rec.h, rec.d ? rec.d.slice(0, 4) : null].filter(Boolean).join(' · ') || undefined}>{[recTitle ? (recTitle.length > 72 ? closeCut(recTitle.slice(0, 72), 72) : recTitle) : null, rec.h, rec.d ? rec.d.slice(0, 4) : null].filter(Boolean).join('\u00a0· ')}</div>
                </div>
              ) : null}
              {/* (r8, QA3 N7) the YoY and the verified index are two reads on two
                  bases — each prints under its own label, the index never stands
                  in the YoY's slot (Rolex: row "+9% YoY" vs page "5Y +25%") */}
              {summary?.yoy ? (
                <div>
                  <div className="k">Year on year</div>
                  <div className="v"><span className="mono">{signedPct(summary.yoy.pct)}</span></div>
                  {summary.yoy.basis === 'matched' ? (
                    <div className="s" title="Like for like: each item (the same card at the same grade, the same reference, the same edition) that sold in both years gives its price ratio; this is the median ratio, the last four complete quarters against the four before. The 90% interval is on that median (order statistics, no shape assumed); a read prints only when the interval is within about ±30% or clear of no change">{summary.medScope ? `${summary.medScope.toLowerCase()}, ` : ''}same items · 4 qtrs vs 4 · {nf(summary.yoy.n)} matched{yoyIntervalText(summary.yoy) ? ` · ${yoyIntervalText(summary.yoy)}` : ''}</div>
                  ) : (
                    <div className="s" title="The median of the last four complete quarters against the four before, printed only when both years sold a similar number of lots — a level the mix of what sold moves too, not an appreciation rate. The 90% interval covers sampling noise only, never a change in what sold">{summary.medScope ? `${summary.medScope.toLowerCase()} median` : 'median'} · 4 qtrs vs 4 · n={nf(summary.yoy.n)}{yoyIntervalText(summary.yoy) ? ` · ${yoyIntervalText(summary.yoy)}` : ''}</div>
                  )}
                </div>
              ) : null}
              {verified ? (
                <div>
                  <div className="k">Verified index, {verified.horizon}</div>
                  <div className={`v ${verified.changePct >= 0 ? 'up' : 'down'}`}><span className="mono">{signedPct(verified.changePct)}</span></div>
                  <div className="s">95% interval [{signedPct(verified.ciLoPct)}, {signedPct(verified.ciHiPct)}] · {nf(verified.n)} lots</div>
                </div>
              ) : null}
            </div>

            {/* §2 THE LIVE BOOK — (W30) while the page boots, the build's copy of
                it (the gated W27 first paint) or the loading plate, which holds
                everything below off the first screen until the rows land */}
            {booting ? (
              <>
                <FirstPaintIsland fsKey={fsKey} stepMin={FP_ENTITY_STEP_MIN} render={() => <EntityPage id={id} seed={seed} />} />
                <RayLoading />
              </>
            ) : liveBook}
          </>
        )}

        {detail && !booting && !partial && (
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
        {!detail && !booting && !partial && !detailLoading && !pending && (
          <p className="nsp-note" style={{ marginTop: 28 }}>No sold history is filed under {name} yet — the live book above is the whole record.</p>
        )}
        {/* §6 CONTEXT */}
        {booting ? null : partial ? <RayLoading /> : <Context name={name} detail={detail} marketData={marketData} sportKey={sportKey} discipline={summary?.discipline ?? null} market={market} />}
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
