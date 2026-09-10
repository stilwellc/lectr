// Worker entry for the per-maker hedonic index pool (scripts/lib/maker-pool.ts).
// Plain CommonJS so worker_threads can load it regardless of how the parent was
// started; it registers tsx's CJS hook and then requires the TypeScript module.
// One worker builds many makers: the parent posts { slug, lots, now } and the
// worker answers { slug, result } (or { slug, error }).
require('tsx/cjs');
const { parentPort } = require('worker_threads');
const { buildMakerIndex } = require('../hedonic-index.ts');

parentPort.on('message', (msg) => {
  try {
    const result = buildMakerIndex(msg.lots, msg.now ? new Date(msg.now) : new Date());
    parentPort.postMessage({ slug: msg.slug, result });
  } catch (e) {
    parentPort.postMessage({ slug: msg.slug, error: (e && e.message) || String(e) });
  }
});
