'use client';

/**
 * THE LIVING INDEX — flagship landing prototype (direction C, spectacle-forward
 * but tasteful). Static-export safe: 'use client', all window/WebGL/matchMedia
 * access guarded in hooks, EAGER data only (useRayData never triggers
 * full/archive load). Renders a re-authored desktop scene and a distinct mobile
 * scene, chosen live by viewport.
 */

import { useEffect, useState } from 'react';
import { useRayData } from '../../hooks/useRayData';
import {
  deriveHeroTruth,
  deriveTape,
  deriveIndex,
  deriveEdge,
} from './data';
import { useIsMobile } from './useScene';
import DesktopScene from './DesktopScene';
import MobileScene from './MobileScene';
import s from './style.module.css';

export default function LivingIndexPage() {
  const data = useRayData();
  const isMobile = useIsMobile();
  // gate the mobile/desktop branch until mount so the static-export HTML (which
  // has no viewport) and the first client render agree → no hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const truth = deriveHeroTruth(data.totalLots, data.totalSold, data.market);
  const tape = deriveTape(data.tape);
  const index = deriveIndex(data.market);
  const edge = deriveEdge(data.backtest);

  return (
    <main className={s.root}>
      {/* Before mount we render the desktop scene (matches the prerendered
          HTML); after mount the true viewport wins. Both branches count-up and
          reveal correctly, so there's no blank state either way. */}
      {mounted && isMobile ? (
        <MobileScene truth={truth} tape={tape} index={index} edge={edge} />
      ) : (
        <DesktopScene truth={truth} tape={tape} index={index} edge={edge} />
      )}
    </main>
  );
}
