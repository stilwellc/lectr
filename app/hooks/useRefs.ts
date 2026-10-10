'use client';
/**
 * useRefs — shared client fetch for the reference dossiers data (refs.json,
 * ~613 watch/model references with yearly medians). Module-cached (one fetch
 * per session); the failure flag clears on the next mount so a flaky fetch
 * never bricks a surface for the whole session. Lazy: only the surfaces that
 * mount this hook pull the 1.9MB file — the watch maker dossier and /ref.
 */
import { useEffect, useState } from 'react';

export interface RefEntry {
  key: string; maker: string; ref: string; n: number;
  /** (Oct 10) the model line its sales name ('daytona'), when clear */
  line?: string | null;
  medianUsd: number; ttmMedianUsd: number | null; beatHighPct: number | null;
  houses: string[];
  yearly: { y: number; med: number; n: number }[];
  recent: { id: string; d: string; h: string; p: number; t: string; img: string | null }[];
}

let refsCache: RefEntry[] | null = null;

/** `enabled` = false defers the fetch (the search palette only pulls refs
    once a reference-shaped query is typed) */
export function useRefs(enabled = true): { refs: RefEntry[] | null; failed: boolean; retry: () => void } {
  const [state, setState] = useState<{ refs: RefEntry[] | null; failed: boolean }>({ refs: refsCache, failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    if (refsCache) return;
    let dead = false;
    fetch('/data/ray/refs.json')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { refsCache = j.refs || []; if (!dead) setState({ refs: refsCache, failed: false }); })
      .catch(() => { if (!dead) setState({ refs: null, failed: true }); });
    return () => { dead = true; };
  }, [attempt, enabled]);
  const retry = () => { setState({ refs: refsCache, failed: false }); setAttempt(a => a + 1); };
  // a cache filled by another mount after this one first rendered
  return { ...state, refs: state.refs ?? refsCache, retry };
}

/** the refs for one maker, sorted by sample size (the deepest first) */
export function refsForMaker(refs: RefEntry[] | null, makerSlug: string): RefEntry[] {
  if (!refs) return [];
  return refs.filter(r => r.maker === makerSlug).sort((a, b) => b.n - a.n);
}
