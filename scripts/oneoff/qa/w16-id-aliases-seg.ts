// W16 (Oct 11 2026): Christie's object ids under both crawler ids in a segment
// file (argv[2] — e.g. R2 latest/segments/christies.ndjson.gz), before and
// after normalize; argv[3] = pairs to print, argv[4] = file for the pair ids
import { readGzRows } from '../../corpus-io';
import { christiesObjectIdOf } from '../../lib/id-aliases';
import { normalizeCorpus } from '../../lib/corpus-normalize';
const rows = readGzRows(process.argv[2]) as Record<string, unknown>[];
const fields = ['id', 'artist', 'status', 'saleDate', 'saleName', 'priceUsd', 'realizedUsd', 'estimateLow', 'url', 'title', 'lotNumber'];
function report(label: string, rs: Record<string, unknown>[], show: number) {
  const by = new Map<string, Record<string, unknown>[]>();
  for (const r of rs) { const n = christiesObjectIdOf(String(r.id)); if (n) (by.get(n) || by.set(n, []).get(n)!).push(r); }
  const dup = Array.from(by.entries()).filter(([, v]) => v.length > 1);
  const st: Record<string, number> = {};
  for (const [, v] of dup) { const k = v.map(r => `${String(r.id).startsWith('christies-auc-') ? 'auc' : 'art'}:${r.status}`).sort().join('+'); st[k] = (st[k] || 0) + 1; }
  console.log(`[${label}] rows ${rs.length} · object ids ${by.size} · pairs ${dup.length}`, JSON.stringify(st));
  const urlKind: Record<string, number> = {};
  for (const [, v] of dup) for (const r of v) { const u = String(r.url || 'null'); const k = `${String(r.id).startsWith('christies-auc-') ? 'auc' : 'art'}:${u === 'null' ? 'null' : u.includes('onlineonly') ? 'onlineonly' : /\/lot\/lot-\d+/.test(u) ? 'lot-page' : 'other'}`; urlKind[k] = (urlKind[k] || 0) + 1; }
  console.log(`[${label}] url kinds`, JSON.stringify(urlKind));
  for (const [, v] of dup.slice(0, show)) { for (const r of v) console.log('  ', fields.map(f => `${f}=${JSON.stringify(r[f])?.slice(0, 70)}`).join(' ')); console.log(); }
}
report('segment raw', rows, 0);
normalizeCorpus(rows as never, { now: new Date() });
report('after normalize', rows, Number(process.argv[3] || 6));
// the raw pair ids, for the read-only Supabase check
{
  const raw = readGzRows(process.argv[2]) as Record<string, unknown>[];
  const by = new Map<string, string[]>();
  for (const r of raw) { const n = christiesObjectIdOf(String(r.id)); if (n) (by.get(n) || by.set(n, []).get(n)!).push(String(r.id)); }
  const ids = Array.from(by.values()).filter(v => v.length > 1).flat();
  require('fs').writeFileSync(process.argv[4] || '/dev/null', JSON.stringify(ids));
}
// survivors of each raw pair after normalize: which scheme, which status, date gap
{
  const raw = readGzRows(process.argv[2]) as Record<string, unknown>[];
  const by = new Map<string, Record<string, unknown>[]>();
  for (const r of raw) { const n = christiesObjectIdOf(String(r.id)); if (n) (by.get(n) || by.set(n, []).get(n)!).push(r); }
  const after = new Map<string, Record<string, unknown>>();
  for (const r of rows) { const n = christiesObjectIdOf(String(r.id)); if (n) after.set(n, r); }
  const st: Record<string, number> = {};
  let gap = 0; const ex: string[] = [];
  for (const [n, v] of Array.from(by.entries())) {
    if (v.length < 2) continue;
    const s = after.get(n);
    const art = v.find(r => !String(r.id).includes('-auc-'))!, auc = v.find(r => String(r.id).includes('-auc-'))!;
    if (art.saleDate !== auc.saleDate) gap++; if (s && s.status === "unknown-result") { if (ex.length < 6) ex.push(`${n} art ${art.saleDate} auc ${auc.saleDate} auc status ${auc.status} saleName ${String(auc.saleName).slice(0,40)} → ${s.id} ${s.status} ${s.saleDate}`); }
    const k = s ? `${String(s.id).includes('-auc-') ? 'auc' : 'art'}:${s.status}` : 'dropped';
    st[k] = (st[k] || 0) + 1;
  }
  console.log('[survivors]', JSON.stringify(st), `· saleDate differs on ${gap} pairs`);
  for (const e of ex) console.log('   ', e);
}
