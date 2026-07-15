'use client';

// Saved lots now live on the account layer (per-user, cloud-synced when signed
// in; localStorage when auth is unconfigured). This hook is a thin adapter so
// every existing consumer keeps the same { savedIds, savedMeta, toggle, isSaved }
// shape with no changes.
import { useAccount, type SavedMeta } from '../lib/account';

export type { SavedMeta };

export function useSavedLots() {
  const { savedIds, savedMeta, toggle, isSaved } = useAccount();
  return { savedIds, savedMeta, toggle, isSaved };
}
