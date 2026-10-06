/**
 * emit-page-stats.ts — the small build-time page payloads (public/data/ray/pages/).
 *
 * WHY: home's settlement slip, every /lot/* certificate, /makers faces and each
 * /makers/<slug> page used to stream the WHOLE served corpus (lots-*.json,
 * ~35MB brotli, plus the ~25MB sold-archive for sports/science) to print a few
 * numbers or one maker's rows. This script reads the SAME served shards the
 * client would have streamed (so every figure is byte-for-byte what the page
 * used to compute), merges the eager upcoming lots onto them exactly as
 * useRayData's phase 2 does, runs the SAME app/lib functions once, and writes:
 *
 *   pages/page-stats.json     settlement per market · maker faces · maker shard
 *                             counts · ref/player directories · settled calls
 *   pages/lot-idx-XX.json     lot id → served shard (256 buckets, bucketOf)
 *   pages/lot-pack-XX.json    per upcoming lot: comps / band / appraisal /
 *                             reference band / provenance
 *   pages/maker-<slug>-N.json one maker's own rows (main + archive tier)
 *
 * Run AFTER assemble.ts + build-upcoming.ts (it reads their served output):
 *   NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/emit-page-stats.ts
 * Reads public/data/ray/{meta,upcoming,refs,players}.json, lots-*.json,
 * sold-archive-*.json and (optional) data/corpus/calls-ledger.json.gz.
 * Pure read of those inputs; writes only public/data/ray/pages/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SERVED_DIR, CORPUS_DIR, streamGzLines } from './corpus-io';
import { readCalls } from './lib/calls-ledger';
import { ARTISTS, MARKETS, marketArtists, marketOf } from '../app/constants';
import {
  appraiseLot, soldCompBand, isSportsScienceObject,
  scienceReferenceBand, cultureReferenceBand, classifyForm, formsForMarket,
} from '../app/lib/comps';
import { isMisattributed } from '../app/lib/attribution';
import { overEstimatePct } from '../app/utils';
import { bucketOf, markFallbackProjections, type PageStats, type LotPack, type PackRow, type SettledCallRow } from '../app/lib/page-data';
import type { AuctionLot } from '../app/types';

export interface PageStatsOpts {
  /** id → the corpus row an engine pool may name off the served book (the
   *  single-load nightly resolves these in memory: pageStatsCorpusRows) */
  corpusRows?: Map<string, AuctionLot>;
}

export async function emitPageStats(opts: PageStatsOpts = {}): Promise<void> {
  const t0 = Date.now();
  const OUT = path.join(SERVED_DIR, 'pages');
  const readJson = <T,>(f: string): T => JSON.parse(fs.readFileSync(path.join(SERVED_DIR, f), 'utf8')) as T;
  const log = (s: string) => console.log(`[page-stats] ${s} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // ── 1 · load the served book exactly as the browser would ─────────────────
  const meta = readJson<{ lastCrawl?: string; sources?: string[] }>('meta.json');
  const up = readJson<{ lots?: AuctionLot[] }>('upcoming.json');
  const eager = up.lots || [];
  const eagerById = new Map(eager.map(l => [l.id, l]));

  function readShards(base: string): AuctionLot[][] {
    let n = 0;
    try { n = Number(readJson<{ shards: number }>(`${base}-index.json`).shards) || 0; } catch { n = 0; }
    const out: AuctionLot[][] = [];
    for (let i = 0; i < n; i++) out.push(readJson<AuctionLot[]>(`${base}-${i}.json`));
    return out;
  }
  const mainShards = readShards('lots');
  const archShards = readShards('sold-archive');
  if (!mainShards.length) throw new Error('[page-stats] no lots-*.json shards in the served dir — run assemble first');
  log(`read ${mainShards.length} main + ${archShards.length} archive shards`);

  // phase-2 re-attach (useRayData.loadFull): the eager lot's stamped fields win
  function reattach(l: AuctionLot): AuctionLot {
    const e = eagerById.get(l.id) as (AuctionLot & Record<string, unknown>) | undefined;
    if (!e) return l;
    const x = { ...l } as unknown as Record<string, unknown>;
    if (e.signal !== undefined) x.signal = e.signal;
    for (const k of ['soldComp', 'bidVelocity', 'saleDateTime', 'bidProj', 'currentBid', 'bidCount', 'overlayAt']) {
      if (e[k] != null) x[k] = e[k];
    }
    return x as unknown as AuctionLot;
  }
  const allLots: AuctionLot[] = ([] as AuctionLot[]).concat(...mainShards).map(reattach);
  // archive: self-deduped (loadSoldArchive), NOT deduped against main (the
  // certificate's bandPoolLots concatenates the two tiers as-is)
  const archive: AuctionLot[] = [];
  {
    const seen = new Set<string>();
    for (const s of archShards) for (const l of s) { if (seen.has(l.id)) continue; seen.add(l.id); archive.push(l); }
  }
  log(`book: ${allLots.length.toLocaleString()} main · ${archive.length.toLocaleString()} archive`);

  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (/^(lot-idx|lot-pack|maker)-.*\.json$/.test(f)) fs.unlinkSync(path.join(OUT, f));
  const write = (f: string, v: unknown) => { const s = JSON.stringify(v); fs.writeFileSync(path.join(OUT, f), s); return s.length; };

  // ── 2 · lot id → shard index (main wins, like the client's merge) ─────────
  {
    const buckets: Record<string, Record<string, number>> = {};
    const put = (id: string, code: number) => {
      const b = bucketOf(id);
      const m = buckets[b] || (buckets[b] = {});
      if (!(id in m)) m[id] = code;
    };
    mainShards.forEach((s, i) => { for (const l of s) put(l.id, i); });
    archShards.forEach((s, i) => { for (const l of s) put(l.id, 100 + i); });
    let bytes = 0;
    for (let i = 0; i < 256; i++) { const b = i.toString(16).padStart(2, '0'); bytes += write(`lot-idx-${b}.json`, buckets[b] || {}); }
    log(`lot index: 256 buckets, ${(bytes / 1048576).toFixed(1)}MB raw`);
  }

  // ── 3 · settlement per market (TerminalHome's exact computation) ──────────
  const settlement: PageStats['settlement'] = {};
  for (const m of MARKETS) {
    const set = marketArtists(m.key);
    const sold = allLots.filter(l => set.has(l.artist) && l.status === 'sold' && l.priceUsd)
      .sort((a, b) => (a.saleDate > b.saleDate ? -1 : a.saleDate < b.saleDate ? 1 : 0));
    const perf: number[] = [];
    for (const l of sold) { const p = overEstimatePct(l); if (p != null) perf.push(p); }
    perf.sort((a, b) => a - b);
    settlement[m.key] = {
      sold: sold.length,
      medianPct: perf.length ? perf[Math.floor(perf.length / 2)] : null,
      latest: sold[0]?.saleDate || null,
    };
  }
  log('settlement');

  // ── 4 · maker faces (/makers heroBySlug, verbatim) + maker shards ─────────
  const makerFaces: PageStats['makerFaces'] = {};
  for (const l of allLots) {
    if (!l.imageUrl) continue;
    if (isMisattributed(l.artist, l.title || '')) continue;
    const forms = formsForMarket(marketOf(l.artist));
    if (forms) { const f = classifyForm(l); if (f === 'unknown' || !forms.has(f)) continue; }
    const val = l.priceUsd || l.currentBid || l.estimateHigh || l.estimateLow || 0;
    const cur = makerFaces[l.artist];
    if (!cur || val > cur.val) makerFaces[l.artist] = { url: l.imageUrl, val };
  }
  // maker rows: the served row minus crawl bookkeeping no page reads
  // (artist is implied by the file — the client restores it)
  const DROP = new Set(['artist', 'firstSeen', '_vn', 'entitySrc', 'heightCm', 'widthCm', 'depthCm', 'subjectKeys', 'itemClass', 'drill']);
  const slim = (l: AuctionLot) => {
    const o: Record<string, unknown> = {};
    for (const k in l) if (!DROP.has(k)) o[k] = (l as unknown as Record<string, unknown>)[k];
    return o;
  };
  const makerShards: Record<string, number> = {};
  {
    const bySlug = new Map<string, AuctionLot[]>();
    for (const a of ARTISTS) bySlug.set(a.slug, []);
    for (const l of allLots) bySlug.get(l.artist)?.push(l);
    // the archive tier rides only the makers whose page mounts it (sports +
    // science — /makers/[slug] isArchiveMaker), MAIN WINS on a shared id
    // (useSoldArchive's allLotsWithArchive merge)
    const archiveMarkets = new Set(['sports', 'science']);
    const mainIds = new Set(allLots.map(l => l.id));
    for (const l of archive) if (archiveMarkets.has(marketOf(l.artist)) && !mainIds.has(l.id)) bySlug.get(l.artist)?.push(l);
    const CAP = 18 * 1048576;
    let total = 0;
    for (const [slug, rows] of Array.from(bySlug.entries())) {
      const strs = rows.map(r => JSON.stringify(slim(r)));
      const parts: string[][] = [[]];
      let cur = 2;
      for (const s of strs) {
        const last = parts[parts.length - 1];
        if (last.length && cur + s.length + 1 > CAP) { parts.push([s]); cur = 2 + s.length; } else { last.push(s); cur += s.length + 1; }
      }
      parts.forEach((p, i) => { const body = '[' + p.join(',') + ']'; total += body.length; fs.writeFileSync(path.join(OUT, `maker-${slug}-${i}.json`), body); });
      makerShards[slug] = parts.length;
    }
    log(`maker shards: ${Object.keys(makerShards).length} makers, ${(total / 1048576).toFixed(0)}MB raw`);
  }

  // ── 5 · lot packs — the certificate's corpus reads, precomputed ───────────
  const rowOf = (l: AuctionLot): PackRow => {
    const r: Record<string, unknown> = {
      id: l.id, title: (l.title || '').slice(0, 240), auctionHouse: l.auctionHouse, saleDate: l.saleDate,
      priceUsd: l.priceUsd, status: l.status, artist: l.artist, category: l.category,
    };
    if (l.url) r.url = l.url;
    if (l.imageUrl) r.imageUrl = l.imageUrl;
    if (l.medium) r.medium = String(l.medium).slice(0, 160);
    if (l.saleName) r.saleName = l.saleName;
    if (l.repeatSaleGroupId) r.repeatSaleGroupId = l.repeatSaleGroupId;
    return r as PackRow;
  };
  const byDateDesc = (a: AuctionLot, b: AuctionLot) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime();
  // the whole pool's prices, ascending — the /value call plate's PriceBand
  const pricesOf = (pool: AuctionLot[]) => pool.map(l => Math.round(l.priceUsd || 0)).filter(p => p > 0).sort((a, b) => a - b);
  const top12 = (pool: AuctionLot[]) => [...pool].sort(byDateDesc).slice(0, 12).map(rowOf);

  const SPORTS_ID_SLUGS = new Set(['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia']);
  // comps.ts objectIdentityKey, mirrored — used ONLY to pre-bucket candidates
  // (the pool functions re-apply the exact equality gate themselves)
  const idKey = (l: AuctionLot): string => SPORTS_ID_SLUGS.has(l.artist)
    ? String((l as AuctionLot & { playerSlug?: string | null }).playerSlug || '')
    : (l.entity ? l.entity.toLowerCase().trim() : '');
  const group = (rows: AuctionLot[], key: (l: AuctionLot) => string) => {
    const m = new Map<string, AuctionLot[]>();
    for (const l of rows) { const k = key(l); (m.get(k) || m.set(k, []).get(k)!).push(l); }
    return m;
  };
  const mainByArtist = group(allLots, l => l.artist);
  const bandPool = allLots.concat(archive);                               // bandPoolLots
  const bandByArtistId = group(bandPool.filter(l => isSportsScienceObject(l)), l => `${l.artist}|${idKey(l)}`);
  const mainByArtistId = group(allLots.filter(l => isSportsScienceObject(l)), l => `${l.artist}|${idKey(l)}`);
  const cultureSet = new Set(['movie-tv', 'music-memorabilia', 'entertainment-memorabilia']);
  const culturePool = allLots.filter(l => cultureSet.has(l.artist));
  const byGroupId = group(bandPool.filter(l => !!l.repeatSaleGroupId), l => String(l.repeatSaleGroupId));
  const soldById = new Map<string, AuctionLot>();
  for (const l of allLots) if (l.status === 'sold' && l.priceUsd) soldById.set(l.id, l);

  // the corpus-only rows an engine pool names but the served book never ships
  // (the gap comp-evidence.json papered over with photo-less 10-row stubs) —
  // resolved from the full corpus below, so a call's rows carry their photo
  const engineGaps: { c: NonNullable<LotPack['c']>; ids: string[]; found: AuctionLot[] }[] = [];
  const offWire = new Set<string>();
  {
    const buckets: Record<string, Record<string, LotPack>> = {};
    let nPack = 0, nRows = 0;
    for (const lot of eager) {
      const pack: LotPack = {};
      const sso = isSportsScienceObject(lot);
      const mkt = marketOf(lot.artist);
      // the band (sports/science objects) — identity-bucketed pool, same result
      if (sso) {
        const pool = bandByArtistId.get(`${lot.artist}|${idKey(lot)}`) || [];
        const band = soldCompBand(lot, pool);
        if (band) pack.b = { form: band.form, median: band.median, low: band.low, high: band.high, n: band.n, confidence: band.confidence, rows: top12(band.pool) };
      }
      if (!pack.b) {
        const ev = lot.value;
        const evSane = !ev || ev.compRatio == null || (ev.compRatio <= 5 && ev.compRatio >= 1 / 5);
        if (ev && ev.signal && ev.compRatio != null && evSane) {
          if (!ev.signal.label.startsWith('at')) {
            const pool = (ev.poolIds || []).map(id => soldById.get(id)).filter((x): x is AuctionLot => !!x);
            pack.c = { n: ev.n || pool.length, med: (ev as { compMedianUsd?: number | null }).compMedianUsd ?? ev.compValueUsd ?? null, form: lot.formKey || null, kind: 'form', resolved: pool.length, rows: top12(pool), ps: pricesOf(pool) };
            // engine pools draw on the corpus-only tier too — fill the rest below
            if (pool.length < (ev.poolIds || []).length) {
              engineGaps.push({ c: pack.c, ids: (ev.poolIds || []).map(String), found: pool });
              for (const id of ev.poolIds || []) if (!soldById.has(String(id))) offWire.add(String(id));
            }
          }
        }
        // (Oct 6 2026, wave 3) NO FALLBACK READ: a lot the engine declined
        // carries no comp call (the client signalWithPool read used to fill
        // pack.c here — a directional read the engine had abstained from)
        // appraisal — only where the certificate falls through to it
        const sigMed = (lot.signal as { med?: number } | null | undefined)?.med;
        // (Oct 6 2026, wave 4) and only on a lot the ENGINE valued
        if (lot.value && sigMed == null && (!pack.c || pack.c.med == null)) {
          const pool = sso ? (mainByArtistId.get(`${lot.artist}|${idKey(lot)}`) || []) : (mainByArtist.get(lot.artist) || []);
          pack.a = appraiseLot(lot, pool)?.value ?? null;
        }
      }
      if (mkt === 'science') pack.r = scienceReferenceBand(lot, mainByArtist.get(lot.artist) || []);
      else if (mkt === 'culture') pack.r = cultureReferenceBand(lot, culturePool);
      if (lot.repeatSaleGroupId) {
        const rows = [...(byGroupId.get(String(lot.repeatSaleGroupId)) || [])];
        if (!rows.some(r => r.id === lot.id)) rows.push(lot);
        if (rows.length >= 2) pack.p = rows.sort((a, b) => ((a.saleDate || '') < (b.saleDate || '') ? -1 : 1)).map(rowOf);
      }
      const b = bucketOf(lot.id);
      (buckets[b] || (buckets[b] = {}))[lot.id] = pack;
      nPack++;
      nRows += (pack.b?.rows.length || 0) + (pack.c?.rows.length || 0) + (pack.p?.length || 0);
    }
    // ── resolve off-wire engine pool ids from the full corpus (optional: a
    // runner without data/corpus keeps the served-only rows + comp-evidence) ──
    if (offWire.size) {
      const got = new Map<string, AuctionLot>();
      if (opts.corpusRows) {
        // single-load nightly: the caller resolved these rows from the in-memory
        // corpus with the same rule (first SOLD, priced occurrence in file order)
        for (const id of Array.from(offWire)) { const l = opts.corpusRows.get(id); if (l) got.set(id, l); }
      } else {
        for (const f of ['lots.json.gz', 'sold-archive.json.gz']) {
          const file = path.join(CORPUS_DIR, f);
          if (!fs.existsSync(file)) continue;
          // streamed (was one gunzipSync of the whole file — ~2GB off-heap)
          await streamGzLines(file, (buf, start, end) => {
            // cheap id sniff on the row head before paying for a parse
            const head = buf.toString('utf8', start, Math.min(end, start + 400));
            const m = head.match(/"id":"((?:[^"\\]|\\.)*)"/);
            if (m && offWire.has(m[1]) && !got.has(m[1])) {
              try {
                const l = JSON.parse(buf.toString('utf8', start, end)) as AuctionLot;
                if (l.status === 'sold' && (l.priceUsd || 0) > 0) got.set(l.id, l);
              } catch { /* a torn row is skipped, never guessed */ }
            }
          });
        }
      }
      let filled = 0;
      for (const g of engineGaps) {
        const pool = g.ids.map(id => soldById.get(id) || got.get(id)).filter((x): x is AuctionLot => !!x);
        if (pool.length > g.found.length) { g.c.resolved = pool.length; g.c.rows = top12(pool); g.c.ps = pricesOf(pool); filled++; }
      }
      log(`off-wire engine rows: ${got.size}/${offWire.size} resolved from the corpus → ${filled} calls filled`);
    }
    let bytes = 0;
    for (let i = 0; i < 256; i++) { const b = i.toString(16).padStart(2, '0'); bytes += write(`lot-pack-${b}.json`, buckets[b] || {}); }
    log(`lot packs: ${nPack} lots, ${nRows} rows, ${(bytes / 1048576).toFixed(1)}MB raw`);
  }

  // ── 6 · directories for bare /ref and /player ─────────────────────────────
  let refIndex: PageStats['refIndex'] = [];
  try {
    const refs = readJson<{ refs: { maker: string; ref: string; n: number; medianUsd: number }[] }>('refs.json').refs || [];
    refIndex = refs.map(r => ({ maker: r.maker, ref: r.ref, n: r.n, med: r.medianUsd }));
  } catch { /* refs.json absent — the page abstains */ }
  let playerIndex: PageStats['playerIndex'] = [];
  try {
    const pl = readJson<{ players: { slug: string; name: string; sport: string | null; n: number }[] }>('players.json').players || [];
    playerIndex = pl.map(p => ({ slug: p.slug, name: p.name, sport: p.sport ?? null, n: p.n }));
  } catch { /* players.json absent */ }

  // ── 7 · settled calls — the forward ledger's graded rows, per market ──────
  const settled: Record<string, SettledCallRow[]> = {};
  {
    const lotById = new Map<string, AuctionLot>();
    for (const l of allLots) lotById.set(l.id, l);
    for (const l of archive) if (!lotById.has(l.id)) lotById.set(l.id, l);
    let calls = readCalls().filter(c => typeof c.r === 'number' && c.r! > 0 && c.p > 0);
    let rows: SettledCallRow[];
    if (calls.length) {
      rows = calls.map(c => {
        const l = lotById.get(c.id);
        return {
          id: c.id, k: c.k, d: c.d, sd: c.sd || '', p: Math.round(c.p), r: Math.round(c.r!),
          ...(typeof c.f === 'number' ? { f: Math.round(c.f) } : {}),
          m: c.m || (l ? marketOf(l.artist) : ''), t: l?.title || '', a: l?.artist || '', h: l?.auctionHouse || '',
        };
      });
    } else {
      // no ledger on this runner — the served receipts tape is the same rows
      try { rows = (readJson<{ rows: SettledCallRow[] }>('receipts.json').rows || []).map(r => ({ ...r, t: r.t || '', a: r.a || '', h: r.h || '' })); } catch { rows = []; }
    }
    calls = [];
    const marked = markFallbackProjections(rows).filter(r => !r.fb)
      .sort((a, b) => String(b.sd).localeCompare(String(a.sd)));
    for (const m of MARKETS) {
      const set = marketArtists(m.key);
      settled[m.key] = marked.filter(r => m.key === 'all' || r.m === m.key || set.has(r.a)).slice(0, 6);
    }
  }

  const stats: PageStats = {
    generatedAt: new Date().toISOString(),
    lastCrawl: meta.lastCrawl || '',
    settlement, makerFaces, makerShards, refIndex, playerIndex, settled,
  };
  const sz = write('page-stats.json', stats);
  log(`page-stats.json ${(sz / 1024).toFixed(0)}KB — done`);
}

/** The ids emitPageStats may resolve off the served book: every engine pool
 *  id of an eager lot carrying a signal (a superset of its offWire set). */
export function pageStatsCandidateIds(eager: Record<string, unknown>[]): Set<string> {
  const ids = new Set<string>();
  for (const l of eager) {
    const v = l.value as { signal?: unknown; poolIds?: unknown[] } | null | undefined;
    if (!v || !v.signal || !Array.isArray(v.poolIds)) continue;
    for (const id of v.poolIds) ids.add(String(id));
  }
  return ids;
}

/** The corpus rows for `ids`, by the standalone scan's rule: corpus file order
 *  (main tier, then archive), first occurrence that is SOLD with a price. */
export function pageStatsCorpusRows(corpus: Record<string, unknown>[], ids: Set<string>): Map<string, AuctionLot> {
  const got = new Map<string, AuctionLot>();
  for (const l of corpus) {
    const id = l.id as string;
    if (!ids.has(id) || got.has(id)) continue;
    if (l.status === 'sold' && ((l.priceUsd as number) || 0) > 0) got.set(id, { ...l } as unknown as AuctionLot);
  }
  return got;
}

if (require.main === module) emitPageStats().catch(e => { console.error('[page-stats] FAILED:', e); process.exit(1); });
