/**
 * equivalence.ts — byte-equivalence of two pipeline builds of the SAME input.
 *
 * Hashes every served output (public/data/ray/**) and every corpus output
 * (data/corpus/*.json.gz + *.ndjson, data/qa/*.json) in tree A and tree B and
 * diffs them. Gzipped files are compared on their DECOMPRESSED bytes (the
 * corpus contract is its NDJSON content; deflate framing is an encoding detail
 * — the report still says whether the .gz bytes themselves matched).
 *
 * The ONLY masking is timestamps: the values of the keys generatedAt,
 * lastCrawl, checkedAt and search-meta's `v` (all wall-clock stamps of the run).
 * Run both builds under scripts/ci/freeze-clock.cjs and nothing needs masking
 * at all (pass --no-mask to prove it).
 *
 *   npx tsx scripts/ci/equivalence.ts <treeA> <treeB> [--no-mask] [--skip <regex>]
 *
 * Exit 0 = equivalent; 1 = at least one difference (each one is listed with
 * its first differing offset and context).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';

const ROOTS = ['public/data/ray', 'data/corpus', 'data/qa'];
// inputs carried into the tree (not build outputs) and per-run bookkeeping
const IGNORE = /(^|\/)\.[^/]*$|data\/corpus\/segments\/|\.pulled-|house-ledger(\.prev)?\.json$|backtest-state\.json\.gz$|\.parquet$/;
const TS_KEYS = /"(generatedAt|lastCrawl|checkedAt)":"[^"]*"/g;

function walk(root: string, rel: string, out: string[]): void {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) walk(root, r, out);
    else out.push(r);
  }
}

export function canonicalBytes(file: string, mask: boolean): { body: Buffer; raw: Buffer } {
  const raw = fs.readFileSync(file);
  let body = file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw;
  // (the corpus NDJSON carries no run stamps and can exceed V8's max string
  // length — masked files are the served/qa JSON, all well under 256MB)
  if (mask && /\.(json|ndjson)(\.gz)?$/.test(file) && body.length < 256 * 1048576) {
    let s = body.toString('utf8').replace(TS_KEYS, '"$1":"<ts>"');
    if (file.endsWith('search-meta.json')) s = s.replace(/^\{"v":"[^"]*"/, '{"v":"<ts>"');
    body = Buffer.from(s, 'utf8');
  }
  return { body, raw };
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

export function diffTrees(a: string, b: string, opts: { mask?: boolean; skip?: RegExp } = {}): { files: number; diffs: string[]; gzByteDiffs: string[] } {
  const mask = opts.mask !== false;
  const list = (t: string) => {
    const out: string[] = [];
    for (const r of ROOTS) walk(t, r, out);
    return new Set(out.filter(f => !IGNORE.test(f) && !(opts.skip && opts.skip.test(f))));
  };
  const la = list(a), lb = list(b);
  const diffs: string[] = [];
  const gzByteDiffs: string[] = [];
  for (const f of Array.from(la)) if (!lb.has(f)) diffs.push(`only in A: ${f}`);
  for (const f of Array.from(lb)) if (!la.has(f)) diffs.push(`only in B: ${f}`);
  let files = 0;
  for (const f of Array.from(la).sort()) {
    if (!lb.has(f)) continue;
    files++;
    const A = canonicalBytes(path.join(a, f), mask), B = canonicalBytes(path.join(b, f), mask);
    if (sha(A.body) !== sha(B.body)) {
      let i = 0;
      const n = Math.min(A.body.length, B.body.length);
      while (i < n && A.body[i] === B.body[i]) i++;
      const ctx = (x: Buffer) => JSON.stringify(x.toString('utf8', Math.max(0, i - 120), Math.min(x.length, i + 120)));
      diffs.push(`DIFF ${f} (${A.body.length} vs ${B.body.length} bytes, first difference at ${i})\n    A: ${ctx(A.body)}\n    B: ${ctx(B.body)}`);
    } else if (f.endsWith('.gz') && sha(A.raw) !== sha(B.raw)) {
      gzByteDiffs.push(f);
    }
  }
  return { files, diffs, gzByteDiffs };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const pos = args.filter((x, i) => !x.startsWith('--') && !(args[i - 1] === '--skip'));
  if (pos.length < 2) { console.error('usage: equivalence.ts <treeA> <treeB> [--no-mask] [--skip <regex>]'); process.exit(2); }
  const si = args.indexOf('--skip');
  const r = diffTrees(pos[0], pos[1], { mask: !args.includes('--no-mask'), skip: si >= 0 ? new RegExp(args[si + 1]) : undefined });
  for (const d of r.diffs) console.log(d);
  if (r.gzByteDiffs.length) console.log(`note: ${r.gzByteDiffs.length} .gz file(s) differ only in compressed framing (content identical): ${r.gzByteDiffs.join(', ')}`);
  console.log(`[equivalence] ${r.files} files compared · ${r.diffs.length} difference(s)${args.includes('--no-mask') ? ' · no masking' : ' · timestamps masked'}`);
  process.exit(r.diffs.length ? 1 : 0);
}
