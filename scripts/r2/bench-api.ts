/**
 * bench-api.ts — the Free-plan CPU check for the lot API (10ms/request cap).
 * Miniflare/wrangler dev don't enforce CPU limits and Workers freeze timers
 * during compute, so this measures the SAME handler (functions/_lib/api.ts)
 * in Node over an emit-r2-index.ts output dir, with process.cpuUsage() around
 * the whole request (routing, R2 reads as in-memory ranges, gunzip, parse,
 * response). Cold = fresh isolate (pointer/manifest/dir.bin memos empty).
 *
 *   npx tsx scripts/r2/bench-api.ts <out-dir> [route …]
 */
import fs from 'node:fs';
import path from 'node:path';
import { handleApi } from '../../functions/_lib/api';
import { gunzipText, resetStoreMemo, type R2BucketLike } from '../../functions/_lib/store';
import zlib from 'node:zlib';

/** R2 stand-in: objects are loaded into memory ONCE (outside the timed
    region), so a ranged GET costs what it costs a Worker — no CPU for the
    I/O itself, only for what the handler does with the bytes. */
class MemBucket implements R2BucketLike {
  private files = new Map<string, Buffer>();
  constructor(private root: string) {}
  preload() {
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else this.files.set(path.relative(this.root, p), fs.readFileSync(p));
      }
    };
    walk(this.root);
  }
  async get(key: string, options?: { range?: { offset: number; length: number } }) {
    const f = this.files.get(key);
    if (!f) return null;
    const buf = options?.range ? f.subarray(options.range.offset, options.range.offset + options.range.length) : f;
    return {
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      text: async () => buf.toString('utf8'),
    };
  }
}

const root = process.argv[2];
if (!root) throw new Error('usage: bench-api.ts <out-dir> [route …]');
const bucket = new MemBucket(root);
bucket.preload();
const routes = process.argv.slice(3).length ? process.argv.slice(3) : [
  '/api/version',
  '/api/lot/christies-auc-4310994',
  '/api/lots?ids=christies-auc-4310994,bonhams-28032-226,rrauction-645-346100506450653,christies-auc-4314797,christies-auc-4344507,christies-auc-4301991,goldin-202608-3116-4754-7eb76d9c-26d7-4f83-9435-be648f4ce286,christies-6608607,bonhams-brk_1008629-1E3C2B51D7CF,rrauction-752-351346607526028,goldin-0,goldin-1',
  '/api/comps?lot=christies-6608607',
  '/api/comps?lot=christies-auc-4310994',
  '/api/maker/pablo-picasso?view=summary',
  '/api/maker/entertainment-memorabilia?view=summary',
  '/api/maker/game-used?view=summary',
  '/api/maker/game-used?sort=price&page=24',
  '/api/maker/pablo-picasso?sort=date&cat=print&page=3',
  '/api/archive?market=all&sort=date&page=0',
  '/api/archive?market=all&sort=price&page=24',
  '/api/archive?market=sports&sort=date&sport=Basketball&page=10',
  '/api/market/all?view=summary',
  '/api/ref/rolex/116500',
  '/api/settled-flags?market=all',
];

async function once(route: string): Promise<{ ms: number; status: number; bytes: number }> {
  const c0 = process.cpuUsage();
  const res = await handleApi(new Request(`https://lectr.test${route}`), { CORPUS: bucket }, {}, null);
  const b = await res.arrayBuffer();
  const c = process.cpuUsage(c0);
  return { ms: (c.user + c.system) / 1000, status: res.status, bytes: b.byteLength };
}

(async () => {
  // warm the JIT and Node's lazily-initialized web-stream gunzip once (a
  // ~15ms one-time process cost in Node; workerd's DecompressionStream is
  // native) so the rows measure the request, not runtime start-up
  for (let i = 0; i < 20; i++) await once('/api/version');
  await gunzipText(new Uint8Array(zlib.gzipSync('{}')));
  const out: string[] = [];
  let worstCold = 0, worstWarm = 0;
  for (const r of routes) {
    resetStoreMemo();
    const cold = await once(r);
    const warm = [];
    for (let i = 0; i < 5; i++) warm.push((await once(r)).ms);
    warm.sort((a, b) => a - b);
    const w = warm[2];
    worstCold = Math.max(worstCold, cold.ms); worstWarm = Math.max(worstWarm, w);
    out.push(`${cold.status} cold ${cold.ms.toFixed(2).padStart(6)}ms · warm ${w.toFixed(2).padStart(6)}ms · ${(cold.bytes / 1024).toFixed(1).padStart(7)}KB  ${r.length > 90 ? r.slice(0, 90) + '…' : r}`);
  }
  console.log(out.join('\n'));
  console.log(`worst cold ${worstCold.toFixed(2)}ms · worst warm ${worstWarm.toFixed(2)}ms (Node user+system CPU per request; R2 = in-memory ranges)`);
})();
