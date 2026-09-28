/**
 * extract/cache.ts — the extraction result cache: data/corpus/extract-cache.json.gz
 * (gzip NDJSON, one record per line; buffer-safe like every corpus file).
 *
 * Keyed by lot id + sha256(title + '\n' + description): a lot is re-sent only
 * when its OWN text changes (or the prompt version is bumped). One entry per
 * lot id — a re-extraction replaces the old one, so the file is bounded by the
 * corpus size, not by history.
 *
 * Record kinds:
 *   {k:'meta', pending:[…]}                 batches submitted but not yet collected
 *   {k:'x', id, h, v, m, f, r?}             field extraction (f=null when rejected; r=reason)
 *   {k:'p', ha, hb, v, m, same, reason}     same-object verdict for a text pair
 *   {k:'q', a, ha, ta, b, hb, tb}           a pair queued by build-market for the next run
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Extraction } from './schema';

export const hashText = (title: string, description: string): string =>
  crypto.createHash('sha256').update(`${title}\n${description}`).digest('hex').slice(0, 24);

export interface XRec { k: 'x'; id: string; h: string; v: string; m: string; f: Extraction | null; r?: string }
export interface PRec { k: 'p'; ha: string; hb: string; v: string; m: string; same: boolean | null; reason: string }
export interface Text { title: string; description: string }
export interface QRec { k: 'q'; a: string; ha: string; ta: Text; b: string; hb: string; tb: Text }
export interface PendingBatch {
  id: string;
  kind: 'x' | 'p';
  model: string;
  submitted: string;
  /** custom_id → [lotId, hash] (x) or [ha, hb] (p) */
  items: Record<string, [string, string]>;
}
interface MetaRec { k: 'meta'; pending: PendingBatch[] }

const pairKey = (ha: string, hb: string) => (ha < hb ? `${ha}|${hb}` : `${hb}|${ha}`);
const PAIR_KEEP = 200_000;
const QUEUE_KEEP = 20_000;

export class ExtractCache {
  x = new Map<string, XRec>();
  p = new Map<string, PRec>();
  q = new Map<string, QRec>();
  pending: PendingBatch[] = [];
  dirty = false;

  static load(file: string): ExtractCache {
    const c = new ExtractCache();
    if (!fs.existsSync(file)) return c;
    const buf = zlib.gunzipSync(fs.readFileSync(file));
    let start = 0;
    for (let i = 0; i <= buf.length; i++) {
      if (i < buf.length && buf[i] !== 0x0a) continue;
      if (i > start) {
        let rec: { k?: string } | null = null;
        try { rec = JSON.parse(buf.toString('utf8', start, i)); } catch { rec = null; }
        if (rec?.k === 'x') { const r = rec as XRec; c.x.set(r.id, r); }
        else if (rec?.k === 'p') { const r = rec as PRec; c.p.set(pairKey(r.ha, r.hb), r); }
        else if (rec?.k === 'q') { const r = rec as QRec; c.q.set(pairKey(r.ha, r.hb), r); }
        else if (rec?.k === 'meta') c.pending = (rec as MetaRec).pending || [];
      }
      start = i + 1;
    }
    return c;
  }

  save(file: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const parts: Buffer[] = [Buffer.from(JSON.stringify({ k: 'meta', pending: this.pending }) + '\n')];
    // deterministic order: a re-save of an unchanged cache is byte-identical
    for (const id of Array.from(this.x.keys()).sort()) parts.push(Buffer.from(JSON.stringify(this.x.get(id)) + '\n'));
    const pk = Array.from(this.p.keys()).sort().slice(-PAIR_KEEP);
    for (const k of pk) parts.push(Buffer.from(JSON.stringify(this.p.get(k)) + '\n'));
    const qk = Array.from(this.q.keys()).sort().slice(0, QUEUE_KEEP);
    for (const k of qk) parts.push(Buffer.from(JSON.stringify(this.q.get(k)) + '\n'));
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, zlib.gzipSync(Buffer.concat(parts)));
    fs.renameSync(tmp, file);
    this.dirty = false;
  }

  /** a cache HIT: same lot, same text, same prompt version */
  getX(id: string, h: string, v: string): XRec | null {
    const r = this.x.get(id);
    return r && r.h === h && r.v === v ? r : null;
  }
  putX(r: XRec): void { this.x.set(r.id, r); this.dirty = true; }

  getPair(ha: string, hb: string, v: string): PRec | null {
    const r = this.p.get(pairKey(ha, hb));
    return r && r.v === v ? r : null;
  }
  putPair(r: PRec): void { this.p.set(pairKey(r.ha, r.hb), r); this.q.delete(pairKey(r.ha, r.hb)); this.dirty = true; }
  queuePair(r: QRec): boolean {
    const k = pairKey(r.ha, r.hb);
    if (this.p.has(k) || this.q.has(k)) return false;
    this.q.set(k, r); this.dirty = true; return true;
  }

  /** ids (x) / pair keys (p) already inside an uncollected batch */
  pendingKeys(kind: 'x' | 'p'): Set<string> {
    const s = new Set<string>();
    for (const b of this.pending) if (b.kind === kind)
      for (const [a, bb] of Object.values(b.items)) s.add(kind === 'x' ? a : pairKey(a, bb));
    return s;
  }
}
export { pairKey };
