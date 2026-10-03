/**
 * http-tape.ts — record/replay for the crawler's HTTP layer (equivalence
 * proofs for crawler refactors; never used by the nightly).
 *
 * Importing this module is a no-op unless one of these env vars is set:
 *
 *   RAY_HTTP_RECORD=<dir>  wrap globalThis.fetch: a request whose tape entry
 *                          already exists is served from the tape, anything
 *                          else goes to the network and the response (status,
 *                          headers, body bytes) is written to <dir>. Network
 *                          errors are recorded too. Time runs normally.
 *   RAY_HTTP_REPLAY=<dir>  strict replay: every request is answered from <dir>;
 *                          a request with no entry throws a TypeError (exactly
 *                          what a network failure looks like to the crawler),
 *                          so a replay is deterministic even on a tape miss.
 *                          The clock is frozen at the recording's start
 *                          (Date.now / new Date()) and timers fire immediately,
 *                          so politeness sleeps and backoffs cost nothing.
 *
 * Entries are keyed by method + url + sha1(body). The n-th identical request in
 * one process maps to entry #n (falls back to the last recorded one), so a
 * paged loop that re-requests the same URL replays in order.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

interface TapeEntry {
  method: string;
  url: string;
  bodySha1: string | null;
  status?: number;
  statusText?: string;
  headers?: [string, string][];
  bodyB64?: string;
  finalUrl?: string;
  error?: string;
}

const RECORD_DIR = process.env.RAY_HTTP_RECORD || '';
const REPLAY_DIR = process.env.RAY_HTTP_REPLAY || '';
const TAPE_DIR = REPLAY_DIR || RECORD_DIR;

const sha1 = (s: string | Buffer) => crypto.createHash('sha1').update(s).digest('hex');

function bodyText(body: unknown): string | null {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (Buffer.isBuffer(body)) return body.toString('base64');
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('base64');
  return String(body);
}

function keyOf(method: string, url: string, body: string | null): string {
  return `${method.toUpperCase()} ${url} ${body == null ? '-' : sha1(body)}`;
}

const seen = new Map<string, number>();
const fileFor = (key: string, n: number) => path.join(TAPE_DIR, `${sha1(key).slice(0, 20)}-${n}.json`);

function lookup(key: string, n: number): TapeEntry | null {
  let f = fileFor(key, n);
  if (!fs.existsSync(f)) {
    // fewer recorded repeats than replayed ones: serve the last recorded copy
    let last = n - 1;
    while (last >= 0 && !fs.existsSync(fileFor(key, last))) last--;
    if (last < 0) return null;
    f = fileFor(key, last);
  }
  return JSON.parse(fs.readFileSync(f, 'utf8')) as TapeEntry;
}

function toResponse(e: TapeEntry): Response {
  if (e.error) throw new TypeError(`fetch failed (taped): ${e.error}`);
  const nullBody = e.status === 204 || e.status === 304 || e.method === 'HEAD';
  const res = new Response(nullBody ? null : Buffer.from(e.bodyB64 || '', 'base64'), {
    status: e.status,
    statusText: e.statusText,
    headers: e.headers,
  });
  Object.defineProperty(res, 'url', { value: e.finalUrl || e.url });
  return res;
}

export const tapeStats = { hits: 0, misses: 0, recorded: 0, missUrls: [] as string[] };

function install(): void {
  if (!TAPE_DIR) return;
  fs.mkdirSync(TAPE_DIR, { recursive: true });
  const metaPath = path.join(TAPE_DIR, '_meta.json');
  const realFetch = globalThis.fetch.bind(globalThis);

  if (RECORD_DIR && !REPLAY_DIR && !fs.existsSync(metaPath)) {
    fs.writeFileSync(metaPath, JSON.stringify({ now: Date.now(), recordedAt: new Date().toISOString() }));
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method || (typeof input === 'object' && 'method' in input ? input.method : 'GET') || 'GET').toUpperCase();
    const body = bodyText(init.body);
    const key = keyOf(method, url, body);
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);

    const hit = lookup(key, n);
    if (hit) { tapeStats.hits++; return toResponse(hit); }
    if (REPLAY_DIR) {
      tapeStats.misses++;
      if (tapeStats.missUrls.length < 50) tapeStats.missUrls.push(`${method} ${url}`);
      throw new TypeError(`fetch failed (tape miss): ${method} ${url}`);
    }

    const entry: TapeEntry = { method, url, bodySha1: body == null ? null : sha1(body) };
    try {
      const res = await realFetch(input as RequestInfo, init);
      const buf = Buffer.from(await res.arrayBuffer());
      entry.status = res.status;
      entry.statusText = res.statusText;
      entry.headers = Array.from(res.headers.entries())
        .filter(([k]) => k !== 'content-encoding' && k !== 'content-length' && k !== 'transfer-encoding');
      entry.bodyB64 = buf.toString('base64');
      entry.finalUrl = res.url;
    } catch (e) {
      entry.error = (e as Error)?.message || String(e);
    }
    fs.writeFileSync(fileFor(key, n), JSON.stringify(entry));
    tapeStats.recorded++;
    return toResponse(entry);
  }) as typeof fetch;

  if (REPLAY_DIR) {
    // frozen clock at the recording's start + zero-delay timers
    let now = Date.now();
    try { now = JSON.parse(fs.readFileSync(metaPath, 'utf8')).now; } catch { /* untimed tape */ }
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(now);
        else super(...(args as [string]));
      }
      static now() { return now; }
    }
    globalThis.Date = FrozenDate as DateConstructor;
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: (...a: unknown[]) => void, _ms?: number, ...a: unknown[]) =>
      realSetTimeout(fn, 0, ...a)) as typeof setTimeout;
  }

  process.on('exit', () => {
    if (tapeStats.hits || tapeStats.misses || tapeStats.recorded) {
      console.error(`[http-tape] ${REPLAY_DIR ? 'replay' : 'record'} ${TAPE_DIR}: hits=${tapeStats.hits} misses=${tapeStats.misses} recorded=${tapeStats.recorded}`);
    }
  });
}

install();
