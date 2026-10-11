/**
 * first-paint-postbuild — fold the build's first-paint steps into the copy a
 * page ships (perf wave W27; the contract is app/lib/first-paint.ts).
 *
 *   npx tsx scripts/first-paint-postbuild.ts [--out <dir>]
 *
 * Runs after `next build`, before csp-postbuild. Every exported page whose
 * HTML carries a first-paint island (<div data-fsi …>) holds one
 * <template data-fsv="<viewport>|<zone>|<ms>"> per step. For each viewport
 * the copy is the first zone's step at t0; a zone is PROVED up to the last
 * step t such that, at every step from t0 through t, both viewports rendered
 * byte-identical to their copies (React's useId tokens aside — they name the
 * tree position, and the copy is never hydrated). A step that suspended
 * (a pending Suspense boundary) proves nothing. The templates are replaced by
 * the copies, the island gets data-z (zone → last proved ms) and the gate
 * script; an island no zone proves ships empty (the page loads as before).
 *
 * Fail-soft: any surprise empties the island — never fails the deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FP_ZONES, FP_GATE_JS, FP_CSS, FP_VIEWPORTS, FP_SLOT_OPEN, FP_SLOT_MID, FP_SLOT_CLOSE } from '../app/lib/first-paint';

const VARIANTS = Object.keys(FP_VIEWPORTS);

/** a step's slot markers (app/lib/first-paint fpSlot) → <span data-fpr>; a
 *  marker inside a tag (an attribute) is just its words — nothing rewrites
 *  them, so their clock limits the window like any other text */
const SLOT = new RegExp(`${FP_SLOT_OPEN}([^${FP_SLOT_MID}${FP_SLOT_CLOSE}]*)${FP_SLOT_MID}([^${FP_SLOT_OPEN}${FP_SLOT_CLOSE}]*)${FP_SLOT_CLOSE}`, 'g');
export function slotify(h: string): string {
  return h.replace(SLOT, (_w, params: string, text: string, at: number) =>
    (h.lastIndexOf('<', at) > h.lastIndexOf('>', at) ? text : `<span data-fpr="${params}">${text}</span>`));
}

/** React useId tokens («r1», :r1:, _R_x_) — tree positions, not content —
 *  and slot words (the gate rewrites them for the reader's clock) */
export const normalize = (h: string) => h
  .replace(/(?:«[^»]*»|:R?r[0-9a-zA-Z]*:|_R_[0-9a-zA-Z_]*?_(?=["\s>)]))/g, '#id')
  .replace(/(<span data-fpr="[^"]*">)[^<]*<\/span>/g, '$1§</span>');

/** the index just past the </template> closing the template opened at `from`
 *  (nested <template>s counted) */
function templateEnd(html: string, from: number): number {
  const re = /<template\b|<\/template>/g;
  re.lastIndex = from;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    depth += m[0] === '</template>' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

export interface FoldResult { html: string; islands: number; shown: number; zones: Record<string, number>[]; t0: number[] }

/** fold every island in one page's HTML */
export function foldPage(html: string): FoldResult {
  const res: FoldResult = { html, islands: 0, shown: 0, zones: [], t0: [] };
  const open = /<div data-fsi="([^"]+)" hidden=""([^>]*)>/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    const start = m.index + m[0].length;
    // the island's children: a run of step templates (or nothing)
    let i = start;
    const steps: { v: string; zone: string; t: number; body: string }[] = [];
    let broken = false;
    while (html.startsWith('<template data-fsv="', i)) {
      const end = templateEnd(html, i);
      if (end < 0) { broken = true; break; }
      const tag = html.slice(i, html.indexOf('>', i) + 1);
      const [v, zone, t] = (tag.match(/data-fsv="([^"]+)"/)?.[1] || '').split('|');
      steps.push({ v, zone, t: Number(t), body: slotify(html.slice(i + tag.length, end - '</template>'.length)) });
      i = end;
    }
    if (!steps.length) continue;
    if (broken || !html.startsWith('</div>', i)) {
      out += html.slice(last, start); last = i; // drop the steps; ship empty
      res.islands++;
      continue;
    }
    res.islands++;
    const ref = FP_ZONES[0];
    const copy: Record<string, string> = {};
    const t0 = Math.min(...steps.map(s => s.t));
    for (const v of VARIANTS) {
      const s = steps.find(x => x.v === v && x.zone === ref && x.t === t0);
      if (s) copy[v] = s.body;
    }
    // a boundary still pending at the end of the render (`$!` is a client-only
    // component's fallback — static, the very markup the page paints first)
    const pending = (b: string) => /<!--\$\?-->|<template id="B:/.test(b);
    const zones: Record<string, number> = {};
    // a step that printed nothing (the page still booting) proves nothing
    if (VARIANTS.every(v => copy[v] !== undefined && copy[v].length > 512 && !pending(copy[v]))) {
      const want: Record<string, string> = {};
      for (const v of VARIANTS) want[v] = normalize(copy[v]);
      for (const zone of FP_ZONES) {
        const times = Array.from(new Set(steps.filter(s => s.zone === zone).map(s => s.t))).sort((a, b) => a - b);
        let proved = -1;
        for (const t of times) {
          const same = VARIANTS.every(v => {
            const s = steps.find(x => x.v === v && x.zone === zone && x.t === t);
            return !!s && !pending(s.body) && normalize(s.body) === want[v];
          });
          if (!same) break;
          proved = t;
        }
        if (proved >= 0) zones[zone] = proved;
      }
    }
    res.zones.push(zones);
    res.t0.push(t0);
    out += html.slice(last, m.index);
    if (Object.keys(zones).length) {
      res.shown++;
      out += `<div data-fsi="${m[1]}" hidden=""${m[2]} data-z='${JSON.stringify(zones)}'>`
        + VARIANTS.map(v => `<div data-v="${v}">${deferImages(copy[v])}</div>`).join('')
        + `<style>${FP_CSS}</style><script>${FP_GATE_JS}</script>`;
    } else {
      out += `<div data-fsi="${m[1]}" hidden=""${m[2]}>`;
    }
    last = i;
  }
  res.html = out + html.slice(last);
  return res;
}

/** a copy's off-site images wait for the page's own render: the copy paints
 *  every row's monogram plate (the face an unloaded photo already shows), and
 *  the photos never take the pipe from the JS that replaces it — Chrome's
 *  lazy-load reach on a slow connection is thousands of pixels, so even
 *  loading="lazy" rows below the fold fetched at once and held the page's
 *  own paint back by seconds */
export function deferImages(h: string): string {
  return h.replace(/<img\b[^>]*>/g, tag => {
    if (!/\ssrc="(https?:)?\/\//.test(tag)) return tag;
    // an image not yet loaded paints nothing in the page's own render; with
    // no src its alt words would paint instead, so they wait with it
    return tag.replace(/\s(src|srcset|alt)="([^"]*)"/g, (m, k: string, v: string) => (k === 'alt' ? (v ? ` alt="" data-fp-alt="${v}"` : m) : ` data-fp-${k}="${v}"`));
  });
}

function htmlFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'data' && e.name !== '_next') htmlFiles(p, acc); }
    else if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

if (require.main === module && !process.env.RAY_SKIP_MAIN) {
  const i = process.argv.indexOf('--out');
  const OUT = path.resolve(i > 0 ? process.argv[i + 1] : 'out');
  const t = Date.now();
  let pages = 0, shown = 0, before = 0, after = 0;
  const lines: string[] = [];
  for (const f of htmlFiles(OUT)) {
    const html = fs.readFileSync(f, 'utf8');
    if (!html.includes('data-fsi=')) continue;
    // FP_DEBUG=<dir>: keep the unfolded steps for inspection
    if (process.env.FP_DEBUG) { fs.mkdirSync(process.env.FP_DEBUG, { recursive: true }); fs.writeFileSync(path.join(process.env.FP_DEBUG, path.relative(OUT, f).replace(/\//g, '__')), html); }
    let r: FoldResult;
    try { r = foldPage(html); } catch (e) {
      // never ship raw steps: strip every island's children
      r = { html: html.replace(/(<div data-fsi="[^"]+" hidden=""[^>]*>)(?:<template data-fsv=[\s\S]*?)(<\/div>)/g, '$1$2'), islands: 1, shown: 0, zones: [], t0: [] };
      console.log(`::warning::first-paint: ${path.relative(OUT, f)} — ${(e as Error).message}; shipped without a first paint`);
    }
    if (!r.islands) continue;
    pages++; shown += r.shown; before += html.length; after += r.html.length;
    fs.writeFileSync(f, r.html);
    const z = r.zones[0] || {};
    const w = (ms: number | undefined) => (ms == null ? '—' : `${Math.round((ms - r.t0[0]) / 60_000)}m`);
    lines.push(`  ${path.relative(OUT, f)}: ${r.shown ? 'shown' : 'NONE'} · ${FP_ZONES.map(zn => `${zn.split('/').pop()} +${w(z[zn])}`).join(' ')}`);
  }
  console.log(`first-paint: ${shown}/${pages} pages carry a first paint (${((before - after) / 1e6).toFixed(1)}MB of steps folded, ${((Date.now() - t) / 1000).toFixed(1)}s)`);
  for (const l of lines) console.log(l);
}
