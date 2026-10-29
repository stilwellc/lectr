/**
 * interests-sync.ts — the quick-start interests on the account (Oct 29 2026).
 *
 * The interests (app/lib/interests: markets picked, stated price range) were
 * device-only. With migration 0013 they have a row (user_interests), and THE
 * MERGE RULE is one function so it can be proved without a browser:
 *
 *   on sign-in   the account's row wins whenever it has anything; a reader
 *                with no row (or an empty one) lifts the device's interests
 *                up, once; neither side has anything → nothing moves
 *   afterwards   the account is the source and the device MIRRORS it; every
 *                writeInterests on the device writes through (app/lib/account)
 *
 * Pure: rows in, interests out. account.tsx owns the fetch, the upsert, the
 * missing-table fallback (session-only, a toast) and the write-through.
 */
import { parseInterests, NO_INTERESTS, type Interests } from './interests';

/** the user_interests row as PostgREST hands it (markets may arrive null pre-default) */
export interface InterestsRow {
  user_id?: string;
  markets: string[] | null;
  min_usd: number | string | null;
  max_usd: number | string | null;
  updated_at?: string | null;
}

const num = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** a row read defensively through the same parser the device uses */
export function rowToInterests(r: InterestsRow | null | undefined): Interests {
  if (!r) return NO_INTERESTS;
  return parseInterests(JSON.stringify({ v: 1, markets: r.markets ?? [], minUsd: num(r.min_usd), maxUsd: num(r.max_usd), at: r.updated_at ?? null }));
}

/** the row the client writes (never user_id: the caller adds it) */
export function interestsToRow(i: Interests): Omit<InterestsRow, 'user_id'> {
  return { markets: i.markets, min_usd: i.minUsd, max_usd: i.maxUsd, updated_at: i.at ?? new Date().toISOString() };
}

/** the reader has said anything at all */
export const hasInterests = (i: Interests | null | undefined): boolean => !!i && (i.markets.length > 0 || i.minUsd != null || i.maxUsd != null);

export interface SignInMerge {
  /** what the device (and the taste) should hold from here */
  use: Interests;
  /** the device's interests must go up to the account (first time) */
  upload: boolean;
}

/** THE MERGE RULE on sign-in (see the header) */
export function mergeOnSignIn(device: Interests, account: Interests | null): SignInMerge {
  if (hasInterests(account)) return { use: account!, upload: false };
  if (hasInterests(device)) return { use: device, upload: true };
  return { use: NO_INTERESTS, upload: false };
}

/** the same interests, up to their timestamp (a mirror write that changes nothing is skipped) */
export function sameInterests(a: Interests, b: Interests): boolean {
  return a.minUsd === b.minUsd && a.maxUsd === b.maxUsd && a.markets.length === b.markets.length && a.markets.every((m, i) => b.markets[i] === m);
}

/** PostgREST's words for "the table is not there yet" (pre-migration 0013) */
export const NO_TABLE = /user_interests|schema cache|does not exist|relation/i;
