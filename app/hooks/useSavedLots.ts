'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'ray-saved-lots';

function getStored(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function useSavedLots() {
  const [savedIds, setSavedIds] = useState<string[]>([]);

  useEffect(() => {
    setSavedIds(getStored());
  }, []);

  const toggle = useCallback((lotId: string) => {
    setSavedIds(prev => {
      const next = prev.includes(lotId)
        ? prev.filter(id => id !== lotId)
        : [...prev, lotId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      // Brief haptic pulse on iOS / Android
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
      return next;
    });
  }, []);

  const isSaved = useCallback((lotId: string) => savedIds.includes(lotId), [savedIds]);

  return { savedIds, toggle, isSaved };
}
