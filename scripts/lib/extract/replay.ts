/**
 * extract/replay.ts — an offline stand-in for the Message Batches API that
 * replays RECORDED model outputs (keyed by lot title). Used by the unit tests
 * and by `extract-eval.ts --fixtures`, so the whole pipeline — request build,
 * submit, poll, collect, validate, cache, apply — runs with no key and no
 * network. Also counts calls, so tests can assert "no API traffic".
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { BatchesApi } from './batch';

export interface ReplayApi extends BatchesApi { calls: { create: number; retrieve: number; results: number }; requests: number }

const titleOf = (content: unknown): string => {
  const s = typeof content === 'string' ? content : '';
  const m = s.match(/^TITLE: (.*)$/m);
  return m ? m[1] : '';
};

export function replayApi(outputs: Record<string, unknown>, opts: { stillRunning?: boolean } = {}): ReplayApi {
  const batches = new Map<string, { custom_id: string; title: string }[]>();
  let n = 0;
  const api = {
    calls: { create: 0, retrieve: 0, results: 0 },
    requests: 0,
    async create(body: { requests: { custom_id: string; params: { messages: { content: unknown }[] } }[] }) {
      api.calls.create++;
      const id = `msgbatch_replay_${++n}`;
      batches.set(id, body.requests.map(r => ({ custom_id: r.custom_id, title: titleOf(r.params.messages[0].content) })));
      api.requests += body.requests.length;
      return { id, processing_status: 'in_progress' };
    },
    async retrieve(id: string) {
      api.calls.retrieve++;
      return { id, processing_status: opts.stillRunning ? 'in_progress' : 'ended' };
    },
    async results(id: string) {
      api.calls.results++;
      const reqs = batches.get(id) || [];
      async function* gen() {
        for (const r of reqs) {
          const out = outputs[r.title];
          if (out === undefined) { yield { custom_id: r.custom_id, result: { type: 'errored', error: { type: 'error', error: { type: 'api_error', message: 'no fixture' } } } }; continue; }
          const message: Partial<Anthropic.Messages.Message> = {
            id: `msg_${r.custom_id}`, type: 'message', role: 'assistant', model: 'replay',
            stop_reason: 'end_turn', stop_sequence: null,
            content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out), citations: null }],
            usage: { input_tokens: 90, output_tokens: 130, cache_read_input_tokens: 4200, cache_creation_input_tokens: 0 } as Anthropic.Messages.Usage,
          };
          yield { custom_id: r.custom_id, result: { type: 'succeeded', message } };
        }
      }
      return gen();
    },
  };
  return api as unknown as ReplayApi;
}
