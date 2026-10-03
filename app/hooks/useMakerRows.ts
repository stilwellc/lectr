'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AuctionLot } from '../types';
import { useRayData } from './useRayData';
import { fetchSummary, isApiUnavailable } from '../lib/api';

/**
 * ONE MAKER'S BOOK, in columns (Oct 2026). /makers/<slug> used to stream the
 * whole served corpus, then (Sep 27) its own maker shards — up to 13 × 19MB
 * for the deepest culture slug. Its aggregate surfaces (hero, price chart,
 * decade band, player strip) only read status / price / date / category /
 * estimates / house / sport / player per row, so the lot API ships exactly
 * that (/api/maker/:slug?view=summary — main + archive tier for
 * sports/science, main-wins, minus the eager lots) plus the top-priced rows
 * whole for the record plates. This hook lays the eager upcoming lots over it
 * (live signal, bid state, close time), exactly as before. The sold TABLE
 * pages through /api/maker/:slug itself (PastResults remote mode).
 */
export interface MakerRows {
  rows: AuctionLot[] | null;
  loaded: boolean;
  error: boolean;
  /** the lot API isn't serving yet — `rows` is the eager live book only */
  unavailable: boolean;
  retry: () => void;
}

export function useMakerRows(slug: string): MakerRows {
  const { allLots } = useRayData();
  const [attempt, setAttempt] = useState(0);
  // an answer counts only for the request that asked (slug + attempt) — a
  // new slug or a retry reads as loading until its own answer lands
  const key = `${slug}#${attempt}`;
  const [raw, setRaw] = useState<{ key: string; rows: AuctionLot[] | null; error: boolean; unavailable?: boolean }>({ key: '', rows: null, error: false });
  useEffect(() => {
    let dead = false;
    fetchSummary('maker', slug).then(
      rows => { if (!dead) setRaw({ key, rows, error: false }); },
      e => {
        if (dead) return;
        // not serving yet: the page stands on the eager book + stats.json
        // (the sold table says the archive isn't available yet)
        if (isApiUnavailable(e)) setRaw({ key, rows: [], error: false, unavailable: true });
        else setRaw({ key, rows: null, error: true });
      },
    );
    return () => { dead = true; };
  }, [slug, key]);

  const rows = useMemo(() => {
    if (!raw.rows || raw.key !== key) return null;
    // the summary omits every eager lot by construction — no id collisions
    return [...raw.rows, ...allLots.filter(l => l.artist === slug)];
  }, [raw, allLots, slug, key]);

  return { rows, loaded: !!rows, error: raw.key === key && raw.error, unavailable: raw.key === key && !!raw.unavailable, retry: () => setAttempt(a => a + 1) };
}
