/**
 * crawl-replay-check.ts — byte-equivalence harness for the house crawlers.
 *
 * Replays a recorded HTTP tape (scripts/lib/http-tape.ts) through the crawler
 * code and dumps what it produced, so a refactor of scripts/ray-crawl.ts /
 * scripts/lib/houses/* can be proven output-identical on the same inputs.
 *
 * Two modes:
 *
 *   parse — in-process: runs one house's fetch+parse entry points (per-maker
 *           crawl for each RAY_ONLY maker, the cross-roster auction crawl for
 *           the scope main() would derive, Goldin's feed crawl, Sotheby's close
 *           times, the detail-page enrichers on the first lots) and writes
 *           {calls, health} as JSON.
 *   cli   — out-of-process: runs the unmodified CLI (`tsx scripts/ray-crawl.ts`)
 *           as a segmented leg (RAY_HOUSE) in a throwaway working directory
 *           under replay, then hashes every file it wrote (segment, leg-health,
 *           …) into the JSON.
 *
 * Usage:
 *   # 1. record (live network; writes the tape; run the CLI and/or parse mode)
 *   RAY_HTTP_RECORD=/tmp/tape/phillips RAY_HOUSE=phillips RAY_ONLY=eddie-martinez \
 *     npx tsx scripts/ray-crawl.ts                       # from a scratch cwd
 *   npx tsx scripts/ci/crawl-replay-check.ts --mode parse --house phillips \
 *     --only eddie-martinez --tape /tmp/tape/phillips --record --out /dev/null
 *   # 2. baseline on the old code, 3. compare on the new code:
 *   npx tsx scripts/ci/crawl-replay-check.ts --mode parse --house phillips \
 *     --only eddie-martinez --tape /tmp/tape/phillips --out before.json
 *   npx tsx scripts/ci/crawl-replay-check.ts … --out after.json --compare before.json
 *
 * Exit 1 when --compare differs. Never writes to R2/Supabase: segmented legs
 * only write local files, and the cli mode runs in a temp cwd.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { spawnSync } from 'child_process';

type Json = Record<string, unknown>;

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

const MODE = arg('mode', 'parse')!;
const HOUSE = arg('house')!;
const ONLY = (arg('only') || '').split(',').filter(Boolean);
// parse mode: per-maker roster (defaults to --only; --only still drives the auction scope)
const MAKERS = (arg('makers') || arg('only') || '').split(',').filter(Boolean);
const TAPE = path.resolve(arg('tape')!);
const OUT = arg('out')!;
const COMPARE = arg('compare');
const RECORD = arg('record') === 'true';
const ENRICH_N = Number(arg('enrich', '40'));
const ROOT = path.resolve(__dirname, '..', '..');

if (!HOUSE || !arg('tape') || !OUT) {
  console.error('usage: crawl-replay-check.ts --mode parse|cli --house <segment> --only a,b --tape <dir> --out <file> [--compare <file>] [--record]');
  process.exit(2);
}

/** main()'s RAY_ONLY → auction-crawl scope derivation (mirrored verbatim). */
function auctionScope(only: Set<string> | null): 'watches' | 'science' | 'sports' | 'art' | 'all' | null {
  const WATCH_SLUGS = ['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier'];
  const SCIENCE_SLUGS = ['meteorites', 'fossils', 'space-exploration', 'scientific-instruments'];
  const SPORTS_SLUGS = ['sports-cards', 'game-used', 'trophies-awards', 'tickets-passes', 'sports-memorabilia'];
  const ART_SLUGS = ['george-condo', 'kaws', 'andy-warhol', 'keith-haring', 'ed-ruscha', 'pablo-picasso', 'henri-matisse', 'tom-sachs', 'peter-saul', 'raymond-pettibon', 'barry-mcgee', 'futura-2000', 'r-crumb', 'fab-5-freddy', 'francesco-clemente', 'eddie-martinez', 'kenny-scharf', 'george-nakashima', 'charles-eames', 'jean-prouve', 'pierre-jeanneret'];
  const w = !only || WATCH_SLUGS.some(s => only.has(s));
  const sc = !only || SCIENCE_SLUGS.some(s => only.has(s));
  const sp = !only || SPORTS_SLUGS.some(s => only.has(s));
  const a = !only || ART_SLUGS.some(s => only.has(s));
  const n = [w, sc, sp, a].filter(Boolean).length;
  return n > 1 ? 'all' : w ? 'watches' : sc ? 'science' : sp ? 'sports' : a ? 'art' : null;
}

async function runParse(): Promise<Json> {
  process.env.RAY_SKIP_MAIN = '1';
  if (RECORD) process.env.RAY_HTTP_RECORD = TAPE;
  else process.env.RAY_HTTP_REPLAY = TAPE;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import('../ray-crawl');
  const { HOUSE_REGISTRY: R, ARTISTS, HEALTH } = mod;
  const roster = (ARTISTS as { slug: string }[]).filter(a => MAKERS.includes(a.slug));
  const calls: Json = {};
  const houses = HOUSE === 'wright' ? ['wright', 'lama'] : [HOUSE];
  const produced: unknown[] = [];
  for (const h of houses) {
    const reg = R[h];
    if (!reg) throw new Error(`no registry entry for ${h}`);
    if (reg.crawlArtist) {
      for (const a of roster) {
        const lots = await reg.crawlArtist(a);
        calls[`${h}.crawlArtist(${a.slug})`] = lots;
        produced.push(...lots);
      }
    }
    if (reg.crawlAuctions) {
      const scope = auctionScope(ONLY.length ? new Set(ONLY) : null);
      if (scope) {
        const lots = await reg.crawlAuctions(scope);
        if (reg.closeTimes) await reg.closeTimes(lots);
        calls[`${h}.crawlAuctions(${scope})`] = lots;
        produced.push(...lots);
      }
    }
    if (reg.crawl) {
      const lots = await reg.crawl();
      calls[`${h}.crawl()`] = lots;
      calls[`${h}.state()`] = reg.state ? reg.state() : null;
      produced.push(...lots);
    }
    if (reg.enrich) {
      const targets = (produced as { url?: string }[]).filter(l => l.url).slice(0, ENRICH_N);
      const out: unknown[] = [];
      for (const l of targets) out.push(await reg.enrich(l));
      calls[`${h}.enrich[${targets.length}]`] = out;
    }
  }
  return { calls, health: HEALTH };
}

function hashTree(dir: string): Json {
  const out: Json = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      let buf = fs.readFileSync(p);
      if (p.endsWith('.gz')) buf = zlib.gunzipSync(buf); // gzip header carries no mtime from Node, but be safe
      out[path.relative(dir, p)] = { bytes: buf.length, sha1: crypto.createHash('sha1').update(buf).digest('hex') };
    }
  };
  walk(dir);
  return out;
}

function runCli(): Json {
  const cwd = fs.mkdtempSync(path.join(process.env.RAY_REPLAY_TMP || os.tmpdir(), `ray-replay-${HOUSE}-`));
  const env = {
    ...process.env,
    RAY_HOUSE: HOUSE,
    RAY_ONLY: ONLY.join(','),
    [RECORD ? 'RAY_HTTP_RECORD' : 'RAY_HTTP_REPLAY']: TAPE,
  };
  delete (env as Json).RAY_SKIP_MAIN;
  const r = spawnSync(process.execPath, ['--import', path.join(ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs'), path.join(ROOT, 'scripts', 'ray-crawl.ts')], {
    cwd, env, encoding: 'utf8', maxBuffer: 1 << 28,
  });
  fs.writeFileSync(`${OUT}.log`, (r.stdout || '') + '\n--- stderr ---\n' + (r.stderr || ''));
  const files = hashTree(cwd);
  fs.rmSync(cwd, { recursive: true, force: true });
  return { exit: r.status, files };
}

async function main() {
  const result = MODE === 'cli' ? runCli() : await runParse();
  const text = JSON.stringify(result, null, 1);
  fs.writeFileSync(OUT, text);
  console.log(`[replay-check] ${MODE} ${HOUSE}: wrote ${OUT} (${text.length} bytes, sha1 ${crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)})`);
  if (COMPARE) {
    const base = fs.readFileSync(COMPARE, 'utf8');
    if (base === text) { console.log(`[replay-check] IDENTICAL to ${COMPARE}`); return; }
    const a = JSON.parse(base) as Json, b = result as Json;
    const diffKeys = (x: Json, y: Json, pre = ''): string[] => {
      const ks = Array.from(new Set(Object.keys(x || {}).concat(Object.keys(y || {}))));
      const d: string[] = [];
      for (const k of ks) {
        const xs = JSON.stringify(x?.[k]), ys = JSON.stringify(y?.[k]);
        if (xs !== ys) d.push(`${pre}${k}`);
      }
      return d;
    };
    console.error(`[replay-check] DIFFERS from ${COMPARE}: ${[...diffKeys(a, b), ...diffKeys(a.calls as Json, b.calls as Json, 'calls.'), ...diffKeys(a.files as Json, b.files as Json, 'files.')].join(', ')}`);
    process.exitCode = 1;
  }
}

main().then(() => process.exit(process.exitCode ?? 0)).catch(e => { console.error(e); process.exit(1); });
