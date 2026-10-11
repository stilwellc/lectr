/**
 * measure-id-aliases.ts — W16 (Oct 11 2026): find the same Christie's lot
 * carried under both id schemes (christies-<objectId> from the per-artist
 * crawler, christies-auc-<objectId> from the sale crawler) across the local
 * corpus and the served book (upcoming.json + shards).
 *
 * Run: npx tsx --max-old-space-size=12000 scripts/oneoff/qa/w16-id-aliases.ts [--no-corpus]
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCorpus, SERVED_DIR } from '../../corpus-io';
import { christiesObjectIdOf } from '../../lib/id-aliases';

type Row = { id?: unknown; status?: unknown; title?: unknown; saleDate?: unknown; priceUsd?: unknown; realizedUsd?: unknown; artist?: unknown };

function pairs(rows: Row[], label: string): Map<string, Row[]> {
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const n = christiesObjectIdOf(String(r.id || ''));
    if (!n) continue;
    (by.get(n) || by.set(n, []).get(n)!).push(r);
  }
  const dup = new Map<string, Row[]>();
  by.forEach((v, k) => { if (new Set(v.map(r => r.id)).size > 1) dup.set(k, v); });
  console.log(`[aliases] ${label}: ${rows.length} rows · ${by.size} Christie's object ids · ${dup.size} carried under 2 ids`);
  let i = 0;
  dup.forEach(v => { if (i++ < 12) console.log('   ', v.map(r => `${r.id} ${r.status} ${r.saleDate} $${r.priceUsd ?? r.realizedUsd ?? '-'} ${r.artist} "${String(r.title || '').slice(0, 50)}"`).join('  ||  ')); });
  return dup;
}

const served = (f: string): Row[] => {
  const j = JSON.parse(fs.readFileSync(path.join(SERVED_DIR, f), 'utf8'));
  return Array.isArray(j) ? j : (j.lots || []);
};
const shardFiles = fs.readdirSync(SERVED_DIR).filter(f => /^(lots|sold-archive)-\d+\.json$/.test(f));
pairs(served('upcoming.json'), 'served upcoming.json (live book)');
const shardRows: Row[] = [];
for (const f of shardFiles) shardRows.push(...served(f));
pairs(shardRows, 'served shards');
pairs(served('upcoming.json').concat(shardRows), 'served book + shards');
if (!process.argv.includes('--no-corpus')) pairs(readCorpus() as Row[], 'corpus');
