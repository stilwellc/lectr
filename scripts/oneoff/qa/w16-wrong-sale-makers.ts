// W16 (Oct 11 2026): the rows the Christie's wrong-sale repair relabels — their
// maker/category before and after the full normalize pass (argv[2] = segment)
import { readGzRows } from '../../corpus-io';
import { normalizeCorpus } from '../../lib/corpus-normalize';
import { repairChristiesWrongSaleRows } from '../../lib/christies-sale-repair';
const rows = readGzRows(process.argv[2]) as Record<string, unknown>[];
const probe = rows.map(r => ({ ...r }));
repairChristiesWrongSaleRows(probe as never);
const ids = new Set<string>();
probe.forEach((r, i) => { if (r.saleName !== rows[i].saleName) ids.add(String(r.id)); });
const before = new Map(rows.filter(r => ids.has(String(r.id))).map(r => [String(r.id), { artist: r.artist, category: r.category, saleName: r.saleName }]));
normalizeCorpus(rows as never, { now: new Date() });
const after = new Map(rows.filter(r => ids.has(String(r.id))).map(r => [String(r.id), r]));
let kept = 0;
for (const [id, b] of Array.from(before.entries())) {
  const a = after.get(id);
  if (a) kept++;
  console.log(`${id.padEnd(22)} ${String(b.artist).padEnd(22)} → ${a ? `${String(a.artist).padEnd(22)} ${String(a.category).padEnd(10)} ${String(a.subCat)}` : 'DROPPED'.padEnd(22)} | ${String(a?.saleName ?? b.saleName).slice(0, 34).padEnd(34)} | ${String((a || rows.find(r => r.id === id) || {}).title || '').slice(0, 70)}`);
}
console.log(`${before.size} relabelled/legacy-sale rows · ${kept} kept after normalize`);
