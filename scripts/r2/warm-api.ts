/**
 * warm-api.ts — the post-upload warm step for the lot API (docs/data-pipeline.md §3).
 *
 * Right after scripts/r2-api-push.sh flips api/current.json, the first visitor
 * of every surface used to pay the whole cold path (Oct 3–5: 32s). This waits
 * until lectr.bid serves the NEW version, then GETs the hot answers once each,
 * exactly as the client asks for them (app/lib/api.ts URL shapes, so the
 * edge-cache keys match): the version probe, every market's summary, archive
 * first page and settled flags, and the biggest makers' summaries + first
 * table page. That touches every new object a first visit needs and fills the
 * colo cache nearest the runner. ~50 GETs — nothing next to the 100k/day plan.
 *
 * Read-only (plain GETs through the public site). Never fails the nightly:
 * it reports and exits 0 unless --strict.
 *
 *   npx tsx scripts/r2/warm-api.ts [--out data/r2-api] [--base https://lectr.bid] [--wait 300] [--strict]
 */
import fs from 'node:fs';
import path from 'node:path';
import { ARTISTS, MARKETS } from '../../app/constants';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const OUT = arg('out', 'data/r2-api');
const BASE = arg('base', 'https://lectr.bid').replace(/\/$/, '');
const WAIT_S = Number(arg('wait', '300'));
const STRICT = process.argv.includes('--strict');
const UA = 'lectr-nightly-warm/1 (+https://lectr.bid)';
/** the makers whose pages carry the most traffic / the largest books */
const TOP_MAKERS = ['pablo-picasso', 'andy-warhol', 'kaws', 'jean-michel-basquiat', 'roy-lichtenstein', 'rolex', 'patek-philippe', 'game-used', 'graded-cards', 'entertainment-memorabilia'];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function get(p: string): Promise<{ ms: number; status: number; version: string; cache: string; bytes: number }> {
  const t = Date.now();
  try {
    const r = await fetch(`${BASE}${p}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(90_000) });
    const b = await r.arrayBuffer();
    return { ms: Date.now() - t, status: r.status, version: r.headers.get('X-Corpus-Version') || '', cache: r.headers.get('X-Api-Cache') || '', bytes: b.byteLength };
  } catch {
    return { ms: Date.now() - t, status: 0, version: '', cache: '', bytes: 0 };
  }
}

(async () => {
  const want = (JSON.parse(fs.readFileSync(path.join(OUT, 'api', 'current.json'), 'utf8')) as { version: string }).version;
  console.log(`[warm] waiting for ${BASE} to serve ${want}`);
  // isolates hold the pointer ≤60s (then refresh behind a request) and the
  // colo copy lives 30s, so the flip shows within ~2 min
  const t0 = Date.now();
  let seen = '';
  for (;;) {
    const r = await fetch(`${BASE}/api/version?warm=${Date.now()}`, { headers: { 'User-Agent': UA } }).then(x => x.json() as Promise<{ version?: string }>).catch(() => ({ version: '' }));
    seen = r.version || '';
    if (seen === want) break;
    if (Date.now() - t0 > WAIT_S * 1000) {
      console.log(`[warm] gave up after ${WAIT_S}s — site still serves ${seen || 'nothing'}`);
      process.exit(STRICT ? 1 : 0);
    }
    await sleep(10_000);
  }
  console.log(`[warm] flipped after ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const known = new Set<string>(ARTISTS.map(a => a.slug));
  const page0 = 'sort=date&page=0&size=20';
  const paths = [
    '/api/version',
    ...MARKETS.flatMap(m => [
      `/api/market/${m.key}?view=summary`,
      `/api/archive?market=${m.key}&${page0}`,
      `/api/settled-flags?market=${m.key}`,
    ]),
    ...TOP_MAKERS.filter(s => known.has(s)).flatMap(s => [`/api/maker/${s}?view=summary`, `/api/maker/${s}?${page0}`]),
  ];
  let bad = 0;
  const rows: string[] = [];
  // 4 at a time: fast, and gentle on one colo
  for (let i = 0; i < paths.length; i += 4) {
    const batch = paths.slice(i, i + 4);
    const got = await Promise.all(batch.map(async p => {
      let r = await get(p);
      // an isolate still on its previous pointer: once more
      if (r.status === 200 && r.version !== want) { await sleep(5000); r = await get(p); }
      return { p, r };
    }));
    for (const { p, r } of got) {
      if (r.status !== 200 && r.status !== 404) bad++;
      rows.push(`${String(r.status).padStart(3)} ${String(r.ms).padStart(6)}ms ${r.cache.padEnd(4)} ${(r.bytes / 1024).toFixed(0).padStart(5)}KB ${r.version === want ? '' : `(v=${r.version || '?'}) `}${p}`);
    }
  }
  console.log(rows.join('\n'));
  console.log(`[warm] ${paths.length} GETs · ${bad} failed`);
  process.exit(STRICT && bad ? 1 : 0);
})();
