'use client';

/**
 * usePlayerDossiers — loads the page-stats playerIndex once per session and
 * registers it with lot-labels, so an athlete's name on a memorabilia lot
 * links to /player only when that dossier exists. Returns the registry
 * version; components that print makerLineOf hrefs call it to re-render once
 * the index lands. Fails soft: no page-stats → maker links stand.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { loadPageStats } from './page-data';
import { registerPlayerDossiers, onPlayerDossiers, playerDossierVersion } from './lot-labels';

let started = false;

export function usePlayerDossiers(): number {
  useEffect(() => {
    if (started) return;
    started = true;
    loadPageStats().then(s => { if (s?.playerIndex?.length) registerPlayerDossiers(s.playerIndex.map(p => p.slug)); });
  }, []);
  return useSyncExternalStore(onPlayerDossiers, playerDossierVersion, () => 0);
}
