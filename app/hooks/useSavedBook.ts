'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AuctionLot } from '../types';
import { fetchComps, fetchLots, isApiUnavailable, type ApiLotPack } from '../lib/api';

/**
 * THE DESK'S BOOK (Oct 2026): the profile desk used to stream the whole sold
 * corpus (~35MB brotli) to resolve a handful of saved ids and appraise the
 * owned ones. Now it asks the lot API for exactly those rows (/api/lots, every
 * alias of every saved id) and each resolved lot's comp reads (/api/comps —
 * appraisal, realized band, reference ranges), computed at the edge over the
 * lot's own pool. The eager lots win on overlap (live bid state, signal).
 *
 * `loaded` = rows resolved AND every pack answered (the desk's figures gate
 * on it: a collection must never total over half its appraisals);
 * `error` = a request failed (the desk prints it, with `retry`).
 */
export interface SavedBook {
  lots: AuctionLot[];
  packs: Map<string, ApiLotPack>;
  loaded: boolean;
  error: boolean;
  retry: () => void;
}

const PACK_CONCURRENCY = 4;
const NO_PACKS = new Map<string, ApiLotPack>();

export function useSavedBook(ids: string[], aliasesOf: (id: string) => string[], eager: AuctionLot[], enabled: boolean): SavedBook {
  const [attempt, setAttempt] = useState(0);
  // an answer counts only for the request that asked (the id set + attempt)
  const idsKey = enabled ? Array.from(new Set(ids)).sort().join('\n') : '';
  const key = idsKey ? `${attempt}\n${idsKey}` : '';
  const [st, setSt] = useState<{ key: string; rows: Map<string, AuctionLot>; packs: Map<string, ApiLotPack>; loaded: boolean; error: boolean }>(
    { key: '', rows: new Map(), packs: new Map(), loaded: false, error: false },
  );
  const eagerIds = useMemo(() => new Set(eager.map(l => l.id)), [eager]);
  const eagerReady = eager.length > 0;

  useEffect(() => {
    if (!key || !eagerReady) return;
    let dead = false;
    const saved = idsKey.split('\n');
    (async () => {
      const want = Array.from(new Set(saved.flatMap(aliasesOf))).filter(id => !eagerIds.has(id));
      const rows = want.length ? await fetchLots(want) : new Map<string, AuctionLot>();
      if (dead) return;
      // the resolved row per saved id (first alias that answers, eager first)
      const resolved: string[] = [];
      for (const id of saved) {
        const hit = aliasesOf(id).find(a => eagerIds.has(a) || rows.has(a));
        if (hit) resolved.push(hit);
      }
      setSt({ key, rows, packs: NO_PACKS, loaded: false, error: false });
      const packs = new Map<string, ApiLotPack>();
      let failed = false;
      const queue = Array.from(new Set(resolved));
      await Promise.all(Array.from({ length: Math.min(PACK_CONCURRENCY, queue.length) }, async () => {
        while (queue.length && !dead) {
          const id = queue.shift()!;
          try {
            const a = await fetchComps(id);
            if (a) packs.set(id, a.pack);
          } catch { failed = true; }
        }
      }));
      if (!dead) setSt({ key, rows, packs, loaded: !failed, error: failed });
    })().catch(e => {
      if (dead) return;
      // the lot API isn't serving yet: resolve against the eager book only —
      // settled saves fall to the sold-outcomes ledger, appraisals abstain
      if (isApiUnavailable(e)) setSt({ key, rows: new Map(), packs: NO_PACKS, loaded: true, error: false });
      else setSt({ key, rows: new Map(), packs: NO_PACKS, loaded: false, error: true });
    });
    return () => { dead = true; };
    // aliasesOf is a module function; eagerIds follows eager
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, eagerReady]);

  const lots = useMemo(() => {
    if (st.key !== key || !st.rows.size) return eager;
    const extra: AuctionLot[] = [];
    st.rows.forEach((l, id) => { if (!eagerIds.has(id)) extra.push(l); });
    return extra.length ? [...eager, ...extra] : eager;
  }, [st, key, eager, eagerIds]);

  const live = st.key === key;
  return {
    lots,
    packs: live ? st.packs : NO_PACKS,
    loaded: live && st.loaded,
    error: live && st.error,
    retry: () => setAttempt(a => a + 1),
  };
}
