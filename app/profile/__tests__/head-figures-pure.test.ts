/**
 * EVERY ROOM HEAD FIGURE HAS A PURE SOURCE (docs/DESK.md §3). The rooms'
 * JSX prints figures that derive.ts, priced.ts, edge.ts, portfolio.ts,
 * budget.ts, names.ts, week.ts, today-logic.ts and collection-logic.ts
 * compute — never arithmetic in a figure slot. This test walks each room's
 * TSX, finds the figure props (sub, count, stat, statNote, figure,
 * figureText, figureSub, figureSubText, body, v, note, title) and the meta
 * objects' `count:`, takes the balanced expression, and fails with file:line
 * on `.reduce(`, `.filter(…).length`, `.map(…).length` or `.some(` inside
 * it. A future room keeps the rule or names its logic file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const FILES = [
  'page.tsx', 'today.tsx',
  'desk/cockpit.tsx', 'desk/rooms/watching.tsx', 'desk/rooms/record.tsx', 'desk/rooms/collection.tsx', 'desk/rooms/history.tsx',
  'desk/rooms/picks.tsx', 'desk/rooms/adapters.tsx', 'desk/rooms/account.tsx', 'desk/rooms/becomes.tsx',
  'week/index.tsx', 'week/closing-now.tsx', 'names/index.tsx', 'budget/index.tsx', 'portfolio/index.tsx', 'edge/index.tsx',
];
const SLOT = /\b(sub|count|stat|statNote|figure|figureText|figureSub|figureSubText|body|v|note|title)\s*[=:]\s*/g;
const ARITH = /\.reduce\(|\.filter\([^)]*\)\s*\.length|\.map\([^)]*\)\s*\.length|\.some\(/;

/** the balanced expression at `at`: a {…} prop, a `…` template, or a bare
 *  object-literal value up to the next top-level comma / closing brace */
function expressionAt(src: string, at: number): string {
  const open = src[at];
  if (open === '`') {
    const end = src.indexOf('`', at + 1);
    return end < 0 ? src.slice(at) : src.slice(at, end + 1);
  }
  if (open === '"' || open === "'") {
    const end = src.indexOf(open, at + 1);
    return end < 0 ? src.slice(at) : src.slice(at, end + 1);
  }
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') {
      if (depth === 0) return src.slice(at, i);         // the enclosing literal closed
      depth--;
      if (depth === 0 && open === '{') return src.slice(at, i + 1);
    } else if (depth === 0 && open !== '{' && (c === ',' || c === '\n')) return src.slice(at, i);
  }
  return src.slice(at);
}
const lineOf = (src: string, at: number) => src.slice(0, at).split('\n').length;

test('no room derives a head or row figure in its JSX slot — every figure reads a pure source', () => {
  const hits: string[] = [];
  for (const f of FILES) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    // comments describe, they don't print
    const src = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    for (const m of Array.from(src.matchAll(SLOT))) {
      const at = m.index! + m[0].length;
      const expr = expressionAt(src, at);
      if (ARITH.test(expr)) hits.push(`${f}:${lineOf(src, m.index!)} ${m[1]}= … ${expr.match(ARITH)![0]}`);
    }
  }
  assert.deepEqual(hits, [], `figure slots with inline arithmetic — move the read into the room's logic file:\n  ${hits.join('\n  ')}`);
});

test('the guard sees what it guards: a figure slot with a reduce would be caught', () => {
  const src = `<Cell stat={rows.reduce((s, r) => s + r.n, 0)} />\nmeta: { count: lots.filter(l => l.live).length }`;
  const found: string[] = [];
  for (const m of Array.from(src.matchAll(SLOT))) {
    const expr = expressionAt(src, m.index! + m[0].length);
    if (ARITH.test(expr)) found.push(m[1]);
  }
  assert.deepEqual(found, ['stat', 'count']);
});
