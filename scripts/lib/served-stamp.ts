/**
 * served-stamp.ts — THE served-data coherence stamp (Oct 10 2026).
 *
 * The makers pages read about a dozen served JSON files that the nightly
 * writes at different moments (stats.json, cat-stats.json, market.json,
 * players.json, upcoming.json, refs.json, pages/*). A page that mixes two
 * nights prints two populations as one (the Oct 5 shards beside the Oct 8
 * stats in the makers audit). Every one of those files carries the crawl it
 * was built from — meta.json's `lastCrawl`, written by assemble before any of
 * them — so the client can see a mixed set and prefer the files that agree.
 *
 *   object files      a top-level `lastCrawl` string
 *   stats.json        a `crawl` field on every maker row (the file is a bare
 *                     slug → stats map every reader iterates)
 *   entity buckets    `_: { lastCrawl }` (entity ids never start with `_`)
 *   maker shards      (bare arrays) — page-stats.json `lastCrawl` covers them
 */
import fs from 'node:fs';
import path from 'node:path';

/** meta.json's lastCrawl in `dir` ('' when there is no meta yet) */
export function servedLastCrawl(dir: string): string {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { lastCrawl?: string };
    return typeof m.lastCrawl === 'string' ? m.lastCrawl : '';
  } catch { return ''; }
}
