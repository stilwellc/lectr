'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { AuctionLot } from '../types';

const STORAGE_KEY = 'ray-saved-lots';
const LAST_VISIT_KEY = 'lectr-last-visit';

/** What lectr knew about a lot the moment you saved it — the baseline every
    "since you saved" delta is measured against. Nulls mean no baseline was
    captured (a pre-upgrade save, or a lot with no estimate/signal/bids):
    absence of data renders as absence, never as a made-up zero. */
export interface SavedMeta {
  savedAt: string;
  estMid: number | null;
  signalPct: number | null;
  bidCount: number | null;
}

interface SavedEntry extends SavedMeta {
  id: string;
}

function entryFromLot(id: string, lot?: AuctionLot): SavedEntry {
  const lo = lot?.estimateLow || lot?.estimateHigh || 0;
  const hi = lot?.estimateHigh || lot?.estimateLow || 0;
  return {
    id,
    savedAt: new Date().toISOString(),
    estMid: lo || hi ? (lo + hi) / 2 : null,
    signalPct: lot?.signal?.pct ?? null,
    bidCount: lot?.bidCount ?? null,
  };
}

/** Read + migrate. Storage used to be a bare string[] of lot ids; it becomes
    {id, savedAt, estMid, signalPct, bidCount}[]. Bare strings migrate at read
    time with savedAt = now and null baselines (we can't invent what the
    signal was when they were saved). */
function readStored(): SavedEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = new Date().toISOString();
    let migrated = false;
    const entries: SavedEntry[] = [];
    for (const e of parsed) {
      if (typeof e === 'string') {
        migrated = true;
        entries.push({ id: e, savedAt: now, estMid: null, signalPct: null, bidCount: null });
      } else if (e && typeof e === 'object' && typeof e.id === 'string') {
        entries.push({
          id: e.id,
          savedAt: typeof e.savedAt === 'string' ? e.savedAt : now,
          estMid: typeof e.estMid === 'number' ? e.estMid : null,
          signalPct: typeof e.signalPct === 'number' ? e.signalPct : null,
          bidCount: typeof e.bidCount === 'number' ? e.bidCount : null,
        });
      }
    }
    if (migrated) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* private mode */ }
    }
    return entries;
  } catch {
    return [];
  }
}

export function useSavedLots() {
  const [entries, setEntries] = useState<SavedEntry[]>([]);

  useEffect(() => {
    setEntries(readStored());
    // Stamp the visit once per session — "what changed" surfaces read the
    // previous stamp before this one overwrites it next session.
    try {
      if (!sessionStorage.getItem(LAST_VISIT_KEY)) {
        sessionStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
      }
    } catch { /* private mode */ }
  }, []);

  /** Toggle a save. Pass the lot when you have it so the save carries its
      baseline (estimate midpoint, signal %, bid count) for later deltas;
      calling with just the id stays supported. */
  const toggle = useCallback((lotId: string, lot?: AuctionLot) => {
    setEntries(prev => {
      const next = prev.some(e => e.id === lotId)
        ? prev.filter(e => e.id !== lotId)
        : [...prev, entryFromLot(lotId, lot)];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      // Brief haptic pulse on iOS / Android
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
      return next;
    });
  }, []);

  const savedIds = useMemo(() => entries.map(e => e.id), [entries]);

  const savedMeta = useMemo<Record<string, SavedMeta>>(() => {
    const out: Record<string, SavedMeta> = {};
    for (const e of entries) {
      out[e.id] = { savedAt: e.savedAt, estMid: e.estMid, signalPct: e.signalPct, bidCount: e.bidCount };
    }
    return out;
  }, [entries]);

  const isSaved = useCallback((lotId: string) => entries.some(e => e.id === lotId), [entries]);

  return { savedIds, savedMeta, toggle, isSaved };
}
