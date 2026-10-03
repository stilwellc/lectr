/**
 * emit-status.ts — the operability surface of the nightly.
 *
 *   ledger  fold tonight's crawl-leg health into the per-house ledger
 *           (R2 latest/house-ledger.json, pulled by `data-store.sh pull-ledger`)
 *   status  write public/data/ray/status.json — THE contract the /status page
 *           renders (shape: scripts/lib/house-status.ts StatusJson)
 *
 * Run in nightly.yml's assemble job:
 *   npx tsx scripts/emit-status.ts ledger --legs health --houses goldin,… \
 *       [--prev data/qa/house-ledger.prev.json] [--segments data/corpus/segments] \
 *       [--crawled true|false] [--out data/qa/house-ledger.json]
 *   (assemble.ts reads the ledger → hides stale houses' live lots,
 *    writes data/qa/house-stats.json)
 *   npx tsx scripts/emit-status.ts status --houses goldin,… \
 *       [--ledger data/qa/house-ledger.json] [--stats data/qa/house-stats.json] \
 *       [--validate data/qa/validate-engine.json] [--out public/data/ray/status.json]
 *
 * Both steps are advisory to the publish: a missing input degrades the
 * status (houses read "no crawl recorded yet"), it never blocks the night.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as readline from 'readline';
import { buildStatus, mergeLegRecords, updateLedger, staleHouseKeys, type Ledger, type LegRecord, type HouseStats } from './lib/house-status';

const arg = (n: string, d = ''): string => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const readJson = <T>(f: string): T | null => {
  if (!f || !fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) as T; } catch (e) { console.log(`::warning title=emit-status::${f} unreadable: ${(e as Error).message}`); return null; }
};
const writeJson = (f: string, v: unknown) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
const housesArg = () => arg('houses').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);

export function readLegRecords(dir: string): LegRecord[] {
  const out: LegRecord[] = [];
  const walk = (d: string) => {
    let es: fs.Dirent[];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) {
        const j = readJson<LegRecord | LegRecord[]>(p);
        for (const r of Array.isArray(j) ? j : j ? [j] : []) if (r && typeof r.house === 'string') out.push(r);
      }
    }
  };
  walk(dir);
  return out;
}

/** data-store.sh assemble-segments drops data/corpus/segments/.<house>.source
 *  = 'handoff' (this run's crawl) | 'last-good' (R2) | 'absent'. */
export function readSegmentSources(dir: string, houses: string[]): Record<string, 'fresh' | 'last-good' | 'unknown'> {
  const out: Record<string, 'fresh' | 'last-good' | 'unknown'> = {};
  for (const h of houses) {
    let s = '';
    try { s = fs.readFileSync(path.join(dir, `.${h}.source`), 'utf8').trim(); } catch { /* none */ }
    out[h] = s === 'handoff' ? 'fresh' : s === 'last-good' ? 'last-good' : 'unknown';
  }
  return out;
}

/** Newest lastSeen / validatedAt in a segment (streamed) — the bootstrap stale
 *  clock for a house the ledger has never seen. Date-only stamps count as the
 *  END of that day (never hide a house early). null when unreadable. */
export async function segmentLastSeen(file: string): Promise<string | null> {
  if (!fs.existsSync(file)) return null;
  let mx = '';
  try {
    const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      for (const k of ['"lastSeen":"', '"validatedAt":"']) {
        const i = line.indexOf(k);
        if (i < 0) continue;
        const v = line.slice(i + k.length, line.indexOf('"', i + k.length));
        if (v > mx) mx = v;
      }
    }
  } catch { return null; }
  if (!mx) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(mx) ? `${mx}T23:59:59.000Z` : mx;
  return Number.isFinite(Date.parse(d)) ? new Date(d).toISOString() : null;
}

async function cmdLedger() {
  const houses = housesArg();
  if (!houses.length) throw new Error('ledger: --houses is required');
  const now = new Date(arg('now') || Date.now());
  const prev = readJson<Ledger>(arg('prev', 'data/qa/house-ledger.prev.json'));
  const legs = mergeLegRecords(readLegRecords(arg('legs', 'health')));
  const segDir = arg('segments', 'data/corpus/segments');
  const sources = readSegmentSources(segDir, houses);
  const crawled = arg('crawled', 'true') !== 'false';
  const bootstrapSince: Record<string, string | null> = {};
  for (const h of houses) if (!prev?.houses?.[h]) bootstrapSince[h] = await segmentLastSeen(path.join(segDir, `${h}.ndjson.gz`));
  const ledger = updateLedger(prev, { houses, legs, sources, crawled, now, runId: process.env.GITHUB_RUN_ID || null, bootstrapSince });
  const out = arg('out', 'data/qa/house-ledger.json');
  writeJson(out, ledger);
  const down = houses.filter(h => !ledger.houses[h]?.ok);
  const stale = Array.from(staleHouseKeys(ledger, now)).filter(h => houses.includes(h));
  console.log(`[status] ledger → ${out}: ${houses.length - down.length}/${houses.length} houses ok${down.length ? ` · down: ${down.join(', ')}` : ''}${stale.length ? ` · STALE (live hidden): ${stale.join(', ')}` : ''}${prev ? '' : ' · (no prior ledger — bootstrap)'}`);
  for (const h of down) console.log(`::warning title=house ${h} not ok::${ledger.houses[h].reason || 'not ok'} (failing ${ledger.houses[h].failStreak} night(s); last ok ${ledger.houses[h].lastOkAt || 'never recorded'})`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `houses_down=${down.length}\nhouses_down_list=${down.join(',')}\nstale=${stale.join(',')}\n`);
}

async function cmdStatus() {
  const houses = housesArg();
  if (!houses.length) throw new Error('status: --houses is required');
  const now = new Date(arg('now') || Date.now());
  const ledger = readJson<Ledger>(arg('ledger', 'data/qa/house-ledger.json'));
  const statsFile = readJson<{ houses: Record<string, HouseStats> }>(arg('stats', 'data/qa/house-stats.json'));
  const validate = readJson<{ signal?: string }>(arg('validate', 'data/qa/validate-engine.json'));
  let engineVersion: string | null = null;
  try { engineVersion = (await import('./backtest-core')).ENGINE_VERSION; } catch { /* advisory */ }
  const status = buildStatus({
    now, houses, ledger, stats: statsFile?.houses ?? null, engineVersion,
    engineSignal: validate?.signal ?? null, runId: process.env.GITHUB_RUN_ID || null,
  });
  const out = arg('out', 'public/data/ray/status.json');
  writeJson(out, status);
  console.log(`[status] ${out}: signal ${status.publish.signal} · engine ${engineVersion} (${status.publish.engineSignal ?? 'n/a'}) · down ${status.publish.housesDown.join(', ') || 'none'}`);
}

if (process.env.RAY_SKIP_MAIN !== '1') {
  const cmd = process.argv[2];
  const run = cmd === 'ledger' ? cmdLedger() : cmd === 'status' ? cmdStatus() : Promise.reject(new Error('usage: emit-status.ts ledger|status [--flags]'));
  run.catch(e => { console.error(`[status] ${(e as Error).message}`); process.exit(1); });
}
