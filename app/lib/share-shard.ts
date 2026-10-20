/**
 * share-shard.ts — where a query-shell link's share preview lives (Oct 20
 * 2026). scripts/build-og.tsx writes every player / entity dossier's head
 * (title, description, card) into SHARE_SHARDS small JSON files under
 * public/og/q/, keyed by entity id; functions/player and functions/entity read
 * the one shard a link needs (~40 KB) to give a link-preview bot that dossier's
 * own preview. Pure — imported by the build (Node) and the Pages Functions.
 */
export const SHARE_SHARDS = 64;

/** FNV-1a 32 → shard. Build and Functions MUST agree; the test pins it. */
export function shareShardOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % SHARE_SHARDS;
}

export const shareShardPath = (n: number) => `/og/q/${n}.json`;

/** one shard: entity id → [title, description, card path] */
export type ShareShard = Record<string, [string, string, string]>;
