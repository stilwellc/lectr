#!/usr/bin/env node
// Put the FRESHEST intraday close-board overlay into public/data/ray/ before a
// build. Candidates (newest `generatedAt` wins):
//   1. whatever is already at public/data/ray/close-board.json (the served
//      payload a pull just installed — the nightly's own copy)
//   2. files passed as arguments (close-board.yml hands its just-built
//      overlay to the deploy this way)
//   3. production's live copy, https://lectr.bid/data/ray/close-board.json
//      (so a code-push deploy between close-board runs never regresses the
//      overlay to the nightly's older one)
// Since Sep 27 2026 the overlay is NOT committed to git (close-board.yml
// deploys directly; a GITHUB_TOKEN push could never trigger deploy.yml).
// Best-effort: an unreachable prod or a bad candidate is logged and skipped;
// this never fails a deploy.
//   node scripts/ci/seed-close-board.mjs [candidate.json …]
import fs from 'node:fs';
import path from 'node:path';

const DEST = path.join('public', 'data', 'ray', 'close-board.json');
const PROD = process.env.CLOSE_BOARD_PROD_URL || 'https://lectr.bid/data/ray/close-board.json';

const read = (label, text) => {
  try {
    const j = JSON.parse(text);
    if (!j || typeof j !== 'object' || typeof j.generatedAt !== 'string') throw new Error('no generatedAt');
    return { label, text, gen: j.generatedAt };
  } catch (e) {
    console.log(`[close-board seed] ${label}: unusable (${e.message})`);
    return null;
  }
};

const cands = [];
if (fs.existsSync(DEST)) cands.push(read('served payload', fs.readFileSync(DEST, 'utf8')));
for (const f of process.argv.slice(2)) {
  if (fs.existsSync(f)) cands.push(read(f, fs.readFileSync(f, 'utf8')));
  else console.log(`[close-board seed] ${f}: not found`);
}
if (process.env.CLOSE_BOARD_SKIP_PROD !== '1') {
  try {
    const r = await fetch(`${PROD}?cb=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
    if (r.ok) cands.push(read('production', await r.text()));
    else console.log(`[close-board seed] production: HTTP ${r.status}`);
  } catch (e) {
    console.log(`[close-board seed] production: unreachable (${e.message})`);
  }
}

const best = cands.filter(Boolean).sort((a, b) => (a.gen < b.gen ? 1 : a.gen > b.gen ? -1 : 0))[0];
if (!best) {
  console.log('[close-board seed] no overlay available — the client simply applies none');
  process.exit(0);
}
fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.writeFileSync(DEST, best.text);
console.log(`[close-board seed] using ${best.label} (generatedAt ${best.gen})`);
