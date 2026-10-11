/**
 * first-paint.ts — rows in the HTML (perf wave W27, Oct 11 2026).
 *
 * On a 400kbps phone the HTML arrives ~0.6s and paints ~3.9s, then the page
 * sat on its loading line for another ~10s while ~400KB of JS and the
 * first-screen slice (app/lib/first-screen) downloaded. The FIRST PAINT draws
 * the slice's own first screen into the static HTML at build time — the same
 * components, the same slice, the same view the page paints from it once its
 * JS runs — so rows paint with the HTML.
 *
 * The slice is a snapshot; the HTML is read later, somewhere else. So the
 * build never ships "the screen at build time" blind. It renders the first
 * screen at every 20-minute step across the next FP_HORIZON_H hours in each
 * reader zone FP_ZONES lists, at both viewport classes (the page's JS picks
 * phone/desktop layouts in code), and scripts/first-paint-postbuild.ts keeps
 * ONE copy per viewport plus, per zone, the last instant up to which every
 * step rendered byte-identical to it. A lot that closes, a "Closes in 4h"
 * that ticks, a reader-day date that turns, a rank that reshuffles — any of
 * them ends that zone's window at the step before it. The inline gate
 * (FP_GATE_JS in app/lib/first-paint-gate.ts, hash-listed in
 * public/_headers) shows the copy only when:
 *
 *   - the reader's zone is one the build proved, and now sits in its window
 *   - the reader's number locale is the build's (counts print with it)
 *   - the viewport is a proved class (phone < 640px, desktop ≥ 900px)
 *   - the device holds no reader state (no saved lots, follows, remembered
 *     views, sessions — anything that could make the page's own first paint
 *     differ), no service worker controls the page (a returning reader's
 *     cached book paints its own way), and the URL carries no view params
 *
 * Otherwise the copy is dropped before it paints and the page loads exactly
 * as before. The copy is never hydrated: the page's own client render
 * (useRayDataFirst's slice, then the book) replaces it whole, and because it
 * is byte-identical to that render there is nothing to shift.
 */

/** the zone the shipped copy is rendered in (the zone list's first) */
export const FP_ZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'UTC', 'Europe/London',
] as const;
export const FP_STEP_MIN = 20;
export const FP_HORIZON_H = 6;
/** viewport classes: the phone layout (every JS breakpoint on its side) and
 *  the desktop layout; widths between print neither */
export const FP_VIEWPORTS = { m: '(max-width: 639px)', d: '(min-width: 900px)' } as const;
export type FpVariant = keyof typeof FP_VIEWPORTS;
/** the width a viewport class stands for when a step evaluates a page's own
 *  width query: a phone and a desktop squarely inside each class */
const FP_WIDTH: Record<FpVariant, number> = { m: 390, d: 1440 };
/** a (max-width / min-width) media query, as a step's viewport class reads it */
export function fpMatches(v: FpVariant, q: string): boolean {
  const w = FP_WIDTH[v];
  let ok = true;
  const re = /\((max|min)-width:\s*(\d+(?:\.\d+)?)px\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) ok = ok && (m[1] === 'max' ? w <= +m[2] : w >= +m[2]);
  return ok;
}
/* ── SLOTS: the copy's clock-relative words ──────────────────────────────
   A first-paint step marks a clock-relative phrase it prints ("Closes in 7h")
   as a slot: fpSlot() wraps the phrase in private-use markers carrying the
   inputs the phrase is a function of; the postbuild turns each into
   <span data-fpr="…">phrase</span> and compares steps with slot words
   masked, and the gate rewrites every slot for the reader's own clock before
   the copy paints. Only words the gate can recompute exactly are slots —
   app/lib/__tests__/first-paint.test.ts holds each kind to the page's own
   function across a sweep of clocks. Anything else that moves with the
   clock ends the copy's window instead. */
export const FP_SLOT_OPEN = '\uE000';
export const FP_SLOT_MID = '\uE002';
export const FP_SLOT_CLOSE = '\uE001';
/** mark `text` as a slot of `kind` with its inputs (no '|' or markers in them) */
export function fpSlot(kind: string, params: (string | number)[], text: string): string {
  return `${FP_SLOT_OPEN}${[kind, ...params].join('|')}${FP_SLOT_MID}${text}${FP_SLOT_CLOSE}`;
}

/* ── build-side helpers (the prerender only; never run in a browser) ── */

type NodeFs = typeof import('fs');
function nodeFs(): NodeFs | null {
  if (typeof window !== 'undefined') return null;
  const p = (globalThis as { process?: { getBuiltinModule?: (m: string) => unknown } }).process;
  return (p?.getBuiltinModule?.('node:fs') as NodeFs | undefined) ?? null;
}
const served = new Map<string, unknown>();
/** a served data file (public/data/ray/<rel>), parsed once per build worker;
 *  null in a browser or when absent */
export function readServed<T = unknown>(rel: string): T | null {
  if (served.has(rel)) return served.get(rel) as T | null;
  const fs = nodeFs();
  if (!fs) return null;
  let v: unknown = null;
  try { v = JSON.parse(fs.readFileSync(`${process.cwd()}/public/data/ray/${rel}`, 'utf8')); } catch { v = null; }
  served.set(rel, v);
  return v as T | null;
}

/** first-paint is opted out of this build (no payloads, a dev server, or
 *  RAY_NO_FIRST_PAINT=1) */
export function firstPaintOff(): boolean {
  return typeof window !== 'undefined' || process.env.NODE_ENV !== 'production' || process.env.RAY_NO_FIRST_PAINT === '1';
}

/* the pinned clock: a render step reads Date.now(), new Date() and the local
   zone exactly as a reader at (t, zone) would. Set and cleared by sibling
   components around each step, inside one synchronous render pass. */
let saved: { D: DateConstructor; tz: string | undefined } | null = null;
export function pinClock(ms: number, zone: string): void {
  if (saved) unpinClock();
  const R = globalThis.Date;
  class Pinned extends R {
    constructor(...a: unknown[]) {
      // @ts-expect-error spread into the Date constructor
      super(...(a.length ? a : [ms]));
    }
    static now(): number { return ms; }
  }
  saved = { D: R, tz: process.env.TZ };
  globalThis.Date = Pinned as unknown as DateConstructor;
  process.env.TZ = zone;
}
export function unpinClock(): void {
  if (!saved) return;
  globalThis.Date = saved.D;
  if (saved.tz === undefined) delete process.env.TZ; else process.env.TZ = saved.tz;
  saved = null;
}
