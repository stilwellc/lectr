/**
 * apply-healed-rows.ts — merge a committed NDJSON of healed lots into a segment.
 *
 * WHY THIS EXISTS (Sep 3 2026). The CreateAuction houses (lelands / memorylane /
 * lotg) cannot be crawled from GitHub Actions: from a runner address the
 * Cloudflare interstitial CLEARS but the gallery then serves empty content, so
 * `gallery-heal.yml` "succeeds" having read nothing. That produced two false
 * green runs (Aug 13: "106 auctions, 0 sold lots"; Sep 3: 1 targeted auction,
 * 0 sold lots) before crawl-lelands-gallery.ts grew its silent-zero guard.
 * The same crawl from a residential address returns lots normally.
 *
 * But the R2 credentials live only in CI (the local token copy is wiped and gh
 * secrets are write-only), so neither side can complete a heal alone:
 *   residential IP  = can crawl, cannot push
 *   GitHub runner   = can push,  cannot crawl
 *
 * So the heal is split. Crawl locally with
 *   npx tsx scripts/crawl-lelands-gallery.ts --house <h> --auction <name> \
 *     --dump data/healed/<h>-<tag>.ndjson
 * commit that file, then dispatch apply-healed-rows.yml, which pulls the
 * segment, runs this script, and pushes it back under the segment lock.
 *
 * SAFETY. This is a UNION merge keyed by lot id — healed rows overwrite the
 * poisoned rows they replace and nothing else is touched. It refuses to run on
 * an empty input, refuses to shrink a segment, and (unless --allow-new) refuses
 * to introduce ids the segment has never seen, because a heal is by definition
 * a re-read of rows that already exist. Those guards are what stop the failure
 * this file was written for: a partial local crawl replacing a full segment.
 */
import * as fs from 'fs';
import { readSegment, writeSegment } from './corpus-io';

type Lot = Record<string, unknown> & { id?: string };

const arg = (n: string, d = '') => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

function main() {
  const seg = arg('segment');
  const file = arg('file');
  const allowNew = process.argv.includes('--allow-new');
  const write = process.argv.includes('--write');
  if (!seg || !file) {
    console.error('usage: apply-healed-rows --segment <name> --file <ndjson> [--allow-new] [--write]');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`::error title=healed rows missing::${file} does not exist`);
    process.exit(1);
  }

  const fresh: Lot[] = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Lot)
    .filter((l) => l && typeof l.id === 'string');

  if (!fresh.length) {
    console.error(`::error title=healed rows empty::${file} parsed to 0 lots — refusing to touch segment ${seg}`);
    process.exit(1);
  }

  const existing = readSegment(seg) as Lot[];
  const byId = new Map<string, Lot>();
  for (const l of existing) if (l && typeof l.id === 'string') byId.set(l.id, l);
  const before = byId.size;

  // A heal re-reads rows that already exist. An id the segment has never seen
  // means the dump came from the wrong auction/house, or a partial crawl is
  // being passed off as a heal — the exact way ~11K real rows could be replaced
  // by a few hundred. Refuse by default; --allow-new is the deliberate override.
  const unknown = fresh.filter((l) => !byId.has(l.id as string));
  if (unknown.length && !allowNew) {
    console.error(
      `::error title=unknown ids in heal::${unknown.length} of ${fresh.length} rows are not in segment ${seg} ` +
        `(e.g. ${unknown.slice(0, 3).map((l) => l.id).join(', ')}). Pass --allow-new only if you mean to ADD lots.`,
    );
    process.exit(1);
  }

  let changed = 0;
  const examples: string[] = [];
  for (const l of fresh) {
    const id = l.id as string;
    const prev = byId.get(id);
    if (prev && JSON.stringify(prev) !== JSON.stringify(l)) {
      changed++;
      if (examples.length < 6) {
        examples.push(`${id}: ${String(prev.realizedUsd)} → ${String(l.realizedUsd)}`);
      }
    }
    byId.set(id, l);
  }

  const union = Array.from(byId.values());
  if (union.length < before) {
    console.error(`::error title=segment would shrink::${seg} ${before} → ${union.length} — refusing`);
    process.exit(1);
  }

  console.log(`[heal] segment ${seg}: ${before} rows, ${fresh.length} healed rows in, ${changed} changed, ${unknown.length} new`);
  examples.forEach((e) => console.log(`   ${e}`));
  console.log(`[heal] result ${union.length} rows`);

  if (!write) {
    console.log('[heal] dry run — pass --write to persist (the workflow does)');
    return;
  }
  writeSegment(seg, union as Record<string, unknown>[]);
  console.log(`[heal] wrote segment ${seg}`);
}

main();
