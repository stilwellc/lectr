'use client';
/**
 * FirstPaint — the first screen, drawn into the static HTML at build time
 * (perf wave W27; the contract lives in app/lib/first-paint.ts).
 *
 * <FirstPaintIsland fsKey="home" render={() => <Page fp />} />, placed where
 * the page renders its loading line (and right BEFORE it):
 *
 *   build    renders `render()` once per (viewport, zone, 20-minute step)
 *            inside <template data-fsv> tags, each under a pinned clock and
 *            with a FirstPaintSnapshot in context — the slice exactly as
 *            useRayDataFirst hands it to the page. The page reads it with
 *            useFirstPaint() and prints its first screen from it.
 *            scripts/first-paint-postbuild.ts folds the steps into one copy
 *            per viewport + each zone's proved window + the gate.
 *   browser  an EMPTY hidden div with the same data-fsi. React never looks
 *            inside it (dangerouslySetInnerHTML, nothing to hydrate), so the
 *            copy the gate kept stays on screen until the page's own render
 *            replaces the loading branch — island and loading line together.
 */
import React, { createContext, useContext, useState, useSyncExternalStore } from 'react';
import { firstScreenView, type FirstScreenData } from '../hooks/useRayData';
import type { FirstScreenPayload } from '../lib/first-screen';
import { fsVersion } from '../lib/first-screen';
import {
  FP_ZONES, FP_STEP_MIN, FP_HORIZON_H, FP_VIEWPORTS, type FpVariant,
  readServed, firstPaintOff, pinClock, unpinClock, fpMatches,
} from '../lib/first-paint';

export interface FirstPaintSnapshot {
  /** what useRayDataFirst returns while it holds the slice */
  ray: FirstScreenData;
  /** the viewport class this step renders (the page's JS breakpoints) */
  variant: FpVariant;
  /** read a served data file synchronously (public/data/ray/<rel>) */
  read: <T>(rel: string) => T | null;
}

const Ctx = createContext<FirstPaintSnapshot | null>(null);

/** the build-time snapshot this render prints from; null everywhere else
 *  (every browser render, and the page's ordinary prerender) */
export function useFirstPaint(): FirstPaintSnapshot | null {
  return useContext(Ctx);
}

/** the build's first-paint copy for `fsKey` is on screen (the gate kept it):
 *  the page's own first render replaces it in place, so it must not replay an
 *  entrance from nothing. Read once, at mount. */
export function useFirstPaintShown(fsKey: string | null): boolean {
  const snap = useFirstPaint();
  const [shown] = useState(() => {
    if (snap) return true;
    if (!fsKey || typeof document === 'undefined') return false;
    return !!document.querySelector(`[data-fsi="${fsKey}"]:not([hidden])`);
  });
  return shown;
}

/** (W27) a width query this render may read: the first-paint step's viewport
 *  class, or the browser's own on a client mount (never during a hydration —
 *  useSyncExternalStore answers false there, so the SSR markup stands); null
 *  = render the SSR defaults and let the mount effects decide */
const NO_SUB = () => () => {};
export function useWidthQuery(fp: FirstPaintSnapshot | null): ((q: string) => boolean) | null {
  const client = useSyncExternalStore(NO_SUB, () => true, () => false);
  if (fp) return q => fpMatches(fp.variant, q);
  if (!client || typeof window === 'undefined' || !window.matchMedia) return null;
  return q => window.matchMedia(q).matches;
}


function Pin({ t, zone }: { t: number; zone: string }) { pinClock(t, zone); return null; }
function Unpin() { unpinClock(); return null; }

/** the slice as the page paints it, prepared under the pinned clock (the
 *  overlay and close stamps read it) from a fresh copy every step */
function Step({ raw, variant, render }: { raw: string; variant: FpVariant; render: () => React.ReactNode }) {
  const p = JSON.parse(raw) as FirstScreenPayload;
  const snap: FirstPaintSnapshot = { ray: firstScreenView(p), variant, read: readServed };
  return <Ctx.Provider value={snap}>{render()}</Ctx.Provider>;
}

interface FsIndex { ver?: string; fromMs?: number; generatedAt?: string }

/** `stepMin` (W30): a coarser step for a page built hundreds of times (the
 *  entity pages — every step is HTML the build writes, then folds). A lot's
 *  close is one-way, so a close between two steps still ends the window at
 *  the step before it; only the window's resolution coarsens. */
export default function FirstPaintIsland({ fsKey, render, stepMin = FP_STEP_MIN }: { fsKey: string | null; render: () => React.ReactNode; stepMin?: number }) {
  // a step's own render never nests another island
  const inside = useFirstPaint();
  if (!fsKey || inside) return null;
  if (firstPaintOff()) {
    return <div data-fsi={fsKey} hidden suppressHydrationWarning dangerouslySetInnerHTML={{ __html: '' }} />;
  }
  const idx = readServed<FsIndex>('first/index.json');
  const payload = readServed<FirstScreenPayload>(`first/${fsKey}.json`);
  if (!idx || !payload || idx.ver !== fsVersion() || payload.ver !== fsVersion()) {
    return <div data-fsi={fsKey} hidden />;
  }
  const raw = JSON.stringify(payload);
  const t0 = Math.floor((idx.fromMs ?? Date.parse(idx.generatedAt || '')) / 60_000) * 60_000;
  if (!Number.isFinite(t0)) return <div data-fsi={fsKey} hidden />;
  const steps = Math.floor((FP_HORIZON_H * 60) / stepMin);
  const out: React.ReactNode[] = [];
  for (const v of Object.keys(FP_VIEWPORTS) as FpVariant[]) {
    for (const zone of FP_ZONES) {
      for (let k = 0; k <= steps; k++) {
        const t = t0 + k * stepMin * 60_000;
        out.push(
          <template key={`${v}|${zone}|${k}`} data-fsv={`${v}|${zone}|${t}`}>
            <Pin t={t} zone={zone} />
            <Step raw={raw} variant={v} render={render} />
            <Unpin />
          </template>,
        );
      }
    }
  }
  return (
    <div data-fsi={fsKey} hidden data-t0={t0} data-loc={new Intl.NumberFormat().resolvedOptions().locale}>
      {out}
    </div>
  );
}
