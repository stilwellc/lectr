'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AuctionLot } from '../types';
import { useRayData, triggerFullLoad } from './useRayData';
import { loadPageStats, loadMakerLots } from '../lib/page-data';

/**
 * ONE MAKER'S BOOK, not the whole corpus (Sep 27 2026). /makers/<slug> used
 * to stream every served shard (~35MB brotli, plus the ~25MB archive for
 * sports/science) to filter one maker's rows. The build now writes each
 * maker's own rows to pages/maker-<slug>-N.json (main tier + — for
 * sports/science makers — the archive tier, main-wins on a shared id, exactly
 * useSoldArchive's merge). This hook loads those, then lays the eager
 * upcoming lots over them by id (the phase-2 re-attach: live signal, bid
 * state and close time ride the eager copies).
 *
 * `source: 'corpus'` = the data build predates the maker shards; the hook
 * has asked for the full corpus and the caller keeps its old path.
 */
export interface MakerRows {
  rows: AuctionLot[] | null;
  loaded: boolean;
  error: boolean;
  source: 'maker' | 'corpus' | 'pending';
}

export function useMakerRows(slug: string): MakerRows {
  const { allLots, lastCrawl, loading } = useRayData();
  const [raw, setRaw] = useState<{ rows: AuctionLot[] | null; source: MakerRows['source']; error: boolean }>(
    { rows: null, source: 'pending', error: false },
  );
  useEffect(() => {
    if (loading) return;                                   // wait for the crawl stamp
    let dead = false;
    setRaw({ rows: null, source: 'pending', error: false });
    loadPageStats().then(st => {
      if (dead) return;
      const n = st?.makerShards?.[slug];
      if (!st || !n) { setRaw({ rows: null, source: 'corpus', error: false }); triggerFullLoad(); return; }
      loadMakerLots(slug, n, lastCrawl).then(rows => {
        if (dead) return;
        if (!rows) { setRaw({ rows: null, source: 'maker', error: true }); return; }
        // the file omits `artist` (implied by the slug) — restore it
        for (const r of rows) (r as { artist: string }).artist = slug;
        setRaw({ rows, source: 'maker', error: false });
      });
    });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, loading]);

  const rows = useMemo(() => {
    if (!raw.rows) return null;
    const eager = new Map<string, AuctionLot>();
    for (const l of allLots) if (l.artist === slug) eager.set(l.id, l);
    const out: AuctionLot[] = [];
    const seen = new Set<string>();
    for (const r of raw.rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(eager.get(r.id) || r);
    }
    eager.forEach((l, id) => { if (!seen.has(id)) out.push(l); });
    return out;
  }, [raw.rows, allLots, slug]);

  return { rows, loaded: !!rows, error: raw.error, source: raw.source };
}
