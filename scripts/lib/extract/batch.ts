/**
 * extract/batch.ts — request building, Message Batches submit / collect, and
 * result validation. The Anthropic client is INJECTED (tests pass a recorded
 * fake), and nothing here runs unless run.ts passed the CALL gate.
 */
import type Anthropic from '@anthropic-ai/sdk';
import * as crypto from 'crypto';
import { ExtractCache, hashText, type PendingBatch, type QRec, type Text } from './cache';
import { BATCH_CHUNK, BATCH_DISCOUNT, EXTRACT_PROMPT_VERSION, SAME_PROMPT_VERSION, priceOf, tokensOf } from './config';
import { EXTRACT_SYSTEM, SAME_SYSTEM, extractUserTurn, sameUserTurn } from './prompt';
import { EXTRACTION_SCHEMA, SAME_SCHEMA, validateExtraction, validateSame } from './schema';

export type BatchesApi = Pick<Anthropic['messages']['batches'], 'create' | 'retrieve' | 'results'>;
type Params = Anthropic.Messages.MessageCreateParamsNonStreaming;

/** Cached system block: 1h TTL (a batch can take longer than the 5m default
 *  to drain, and every request in it shares this exact prefix). */
const system = (text: string): Anthropic.Messages.TextBlockParam[] =>
  [{ type: 'text', text, cache_control: { type: 'ephemeral', ttl: '1h' } }];

export function extractParams(model: string, t: Text): Params {
  return {
    model,
    max_tokens: 1024,
    temperature: 0,
    system: system(EXTRACT_SYSTEM),
    messages: [{ role: 'user', content: extractUserTurn(t.title, t.description) }],
    output_config: { format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
  };
}

export function sameParams(model: string, a: Text, b: Text): Params {
  return {
    model,
    max_tokens: 400,
    // a yes/no read over two short texts: no thinking (Sonnet 5 accepts
    // 'disabled'; sampling params are rejected there, so none are sent)
    thinking: { type: 'disabled' },
    system: system(SAME_SYSTEM),
    messages: [{ role: 'user', content: sameUserTurn(a, b) }],
    output_config: { format: { type: 'json_schema', schema: SAME_SCHEMA } },
  };
}

/** custom_id must match ^[a-zA-Z0-9_-]{1,64}$ — lot ids don't always. */
export const customId = (kind: 'x' | 'p', a: string, b: string): string =>
  `${kind}_${crypto.createHash('sha256').update(`${a}\u0000${b}`).digest('hex').slice(0, 40)}`;

export interface Candidate { id: string; h: string; text: Text }

export interface CostEstimate { requests: number; inTok: number; outTok: number; usd: number }
/** Pre-submit estimate: the shared system prefix billed as a cache READ after
 *  the first write per chunk; per-lot user text at the input rate; output at
 *  the observed ~120 tokens/extraction (~40 for a verdict). Batch price = 50%. */
export function estimateCost(model: string, kind: 'x' | 'p', userChars: number[]): CostEstimate {
  const p = priceOf(model);
  const sysTok = tokensOf((kind === 'x' ? EXTRACT_SYSTEM : SAME_SYSTEM).length);
  const outPer = kind === 'x' ? 140 : 45;
  const n = userChars.length;
  const userTok = userChars.reduce((s, c) => s + tokensOf(c), 0);
  const chunks = Math.max(1, Math.ceil(n / BATCH_CHUNK));
  const writes = Math.min(n, chunks);
  const usd = BATCH_DISCOUNT * (
    (sysTok * writes * p.cacheWrite * 2 /* 1h TTL write = 2x base */ / 1.25
      + sysTok * (n - writes) * p.cacheRead
      + userTok * p.in
      + outPer * n * p.out) / 1e6);
  return { requests: n, inTok: sysTok * n + userTok, outTok: outPer * n, usd: Math.round(usd * 100) / 100 };
}

export interface Usage { in: number; out: number; cacheRead: number; cacheWrite: number }
export const usageCost = (model: string, u: Usage): number => {
  const p = priceOf(model);
  return BATCH_DISCOUNT * (u.in * p.in + u.out * p.out + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6;
};

export async function submitExtractions(api: BatchesApi, cache: ExtractCache, model: string, cands: Candidate[], now: Date): Promise<PendingBatch[]> {
  const out: PendingBatch[] = [];
  for (let i = 0; i < cands.length; i += BATCH_CHUNK) {
    const chunk = cands.slice(i, i + BATCH_CHUNK);
    const items: PendingBatch['items'] = {};
    const requests = chunk.map(c => {
      const cid = customId('x', c.id, c.h);
      items[cid] = [c.id, c.h];
      return { custom_id: cid, params: extractParams(model, c.text) };
    });
    const b = await api.create({ requests });
    const pb: PendingBatch = { id: b.id, kind: 'x', model, submitted: now.toISOString(), items };
    cache.pending.push(pb); cache.dirty = true; out.push(pb);
  }
  return out;
}

export async function submitPairs(api: BatchesApi, cache: ExtractCache, model: string, pairs: QRec[], now: Date): Promise<PendingBatch[]> {
  const out: PendingBatch[] = [];
  for (let i = 0; i < pairs.length; i += BATCH_CHUNK) {
    const chunk = pairs.slice(i, i + BATCH_CHUNK);
    const items: PendingBatch['items'] = {};
    const requests = chunk.map(q => {
      const cid = customId('p', q.ha, q.hb);
      items[cid] = [q.ha, q.hb];
      return { custom_id: cid, params: sameParams(model, q.ta, q.tb) };
    });
    const b = await api.create({ requests });
    const pb: PendingBatch = { id: b.id, kind: 'p', model, submitted: now.toISOString(), items };
    cache.pending.push(pb); cache.dirty = true; out.push(pb);
  }
  return out;
}

export interface CollectStats {
  batches: number; stillRunning: number; succeeded: number; rejected: number; errored: number;
  groundedNulls: number; usage: Usage; usd: number; reasons: Record<string, number>;
}
export const emptyStats = (): CollectStats => ({ batches: 0, stillRunning: 0, succeeded: 0, rejected: 0, errored: 0, groundedNulls: 0, usage: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, usd: 0, reasons: {} });

/** Parse one message into JSON, or a rejection reason. */
export function messageJson(msg: Anthropic.Messages.Message): { ok: true; json: unknown } | { ok: false; reason: string } {
  if (msg.stop_reason !== 'end_turn') return { ok: false, reason: `stop:${msg.stop_reason}` };
  const text = msg.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text').map(b => b.text).join('');
  try { return { ok: true, json: JSON.parse(text) }; } catch { return { ok: false, reason: 'json-parse' }; }
}

/** Collect every ENDED pending batch into the cache. `textOf(id)` returns the
 *  lot's current text (for grounding) — a lot whose text changed since submit
 *  (hash mismatch) is dropped, it will be re-sent. */
export async function collect(api: BatchesApi, cache: ExtractCache, textOf: (id: string) => Text | null, only?: Set<string>): Promise<CollectStats> {
  const st = emptyStats();
  const keep: PendingBatch[] = [];
  const bump = (r: string) => { st.reasons[r] = (st.reasons[r] || 0) + 1; };
  for (const pb of cache.pending) {
    if (only && !only.has(pb.id)) { keep.push(pb); continue; }
    const b = await api.retrieve(pb.id);
    if (b.processing_status !== 'ended') { keep.push(pb); st.stillRunning++; continue; }
    st.batches++;
    const u0 = { ...st.usage };
    const decoder = await api.results(pb.id);
    for await (const res of decoder) {
      const item = pb.items[res.custom_id];
      if (!item) continue;
      if (res.result.type !== 'succeeded') { st.errored++; bump(`result:${res.result.type}`); continue; }
      const msg = res.result.message;
      const u = msg.usage;
      st.usage.in += u.input_tokens || 0; st.usage.out += u.output_tokens || 0;
      st.usage.cacheRead += u.cache_read_input_tokens || 0; st.usage.cacheWrite += u.cache_creation_input_tokens || 0;
      const parsed = messageJson(msg);
      if (pb.kind === 'x') {
        const [id, h] = item;
        const t = textOf(id);
        if (!t || hashText(t.title, t.description) !== h) { bump('text-changed'); continue; }
        if (!parsed.ok) {
          st.rejected++; bump(parsed.reason);
          cache.putX({ k: 'x', id, h, v: EXTRACT_PROMPT_VERSION, m: pb.model, f: null, r: parsed.reason });
          continue;
        }
        const v = validateExtraction(parsed.json, `${t.title}\n${t.description}`);
        if (!v.ok) {
          st.rejected++; bump(`schema:${v.reason}`);
          cache.putX({ k: 'x', id, h, v: EXTRACT_PROMPT_VERSION, m: pb.model, f: null, r: v.reason });
          continue;
        }
        st.succeeded++; st.groundedNulls += v.grounded.length;
        for (const g of v.grounded) bump(`grounded-null:${g}`);
        cache.putX({ k: 'x', id, h, v: EXTRACT_PROMPT_VERSION, m: pb.model, f: v.value });
      } else {
        const [ha, hb] = item;
        const v = parsed.ok ? validateSame(parsed.json) : null;
        if (!v) { st.rejected++; bump(parsed.ok ? 'schema:same' : parsed.reason); continue; }
        st.succeeded++;
        cache.putPair({ k: 'p', ha, hb, v: SAME_PROMPT_VERSION, m: pb.model, same: v.same, reason: v.reason });
      }
    }
    st.usd += usageCost(pb.model, { in: st.usage.in - u0.in, out: st.usage.out - u0.out, cacheRead: st.usage.cacheRead - u0.cacheRead, cacheWrite: st.usage.cacheWrite - u0.cacheWrite });
  }
  cache.pending = keep; cache.dirty = true;
  return st;
}
