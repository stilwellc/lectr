'use client';

/**
 * MOBILE — a distinct, re-authored vertical scene (not the desktop squished).
 *   1. full-bleed gold gradient + the massive count-up, thumb-reachable, tape
 *      pinned low
 *   2. vertical kinetic reveals: corpus → index → edge
 *   3. the RECORD BOARD as full-bleed vertical plates (own layout)
 * Uses the lighter mobile gradient/particle scene (HeroField mobile). Reveals
 * ride IntersectionObserver (baked into each block) + the global reduced-motion
 * kill-switch; nothing depends on a hover.
 */

import HeroField from './HeroField';
import HeroNumber from './HeroNumber';
import Tape from './Tape';
import IndexChart from './IndexChart';
import RecordBoard from './RecordBoard';
import Edge from './Edge';
import type { HeroTruth, TapeLine, IndexSeries, EdgeSummary } from './data';
import { grouped } from './data';
import { useInViewport } from './useScene';
import s from './style.module.css';

interface Props {
  truth: HeroTruth;
  tape: TapeLine[];
  index: IndexSeries;
  edge: EdgeSummary;
}

function Plate({ children, className }: { children: React.ReactNode; className?: string }) {
  const [ref, inView] = useInViewport<HTMLDivElement>({ once: true, threshold: 0.18 });
  return (
    <div ref={ref} className={`${s.mPlate} ${className ?? ''}`} data-inview={inView ? 'true' : 'false'}>
      {children}
    </div>
  );
}

export default function MobileScene({ truth, tape, index, edge }: Props) {
  return (
    <div className={s.mobile}>
      {/* ── hero — full-bleed gradient + the number, tape low ── */}
      <section className={s.mHero}>
        <HeroField mobile />
        <div className={s.mHeroContent}>
          <HeroNumber truth={truth} mobile />
        </div>
        <div className={s.mHeroTape}>
          <Tape lines={tape} mobile />
        </div>
      </section>

      {/* ── corpus plate ── */}
      <section className={s.mSection}>
        <Plate className={s.mCorpus}>
          <p className={s.mThesis}>One tape for everything worth owning.</p>
          <div className={s.mStat}>
            <span className={s.mStatVal}>{grouped(truth.totalLots)}</span>
            <span className={s.mStatUnit}>lots priced &amp; normalized</span>
          </div>
        </Plate>
      </section>

      {/* ── index plate ── */}
      <section className={s.mSection}>
        <Plate>
          <div className={s.mActHead}>
            <span className={s.mActIndex}>01</span>
            <h2 className={s.mActTitle}>The market, in one line</h2>
          </div>
          <IndexChart series={index} />
        </Plate>
      </section>

      {/* ── record board — full-bleed vertical plates ── */}
      <section className={s.mSection}>
        <div className={s.mActHead}>
          <span className={s.mActIndex}>02</span>
          <h2 className={s.mActTitle}>The Record Board</h2>
        </div>
        <RecordBoard mobile />
      </section>

      {/* ── edge plate + CTA ── */}
      <section className={s.mSection}>
        <Plate>
          <div className={s.mActHead}>
            <span className={s.mActIndex}>03</span>
            <h2 className={s.mActTitle}>The edge, checked</h2>
          </div>
          <Edge edge={edge} />
        </Plate>
        <div className={s.mCta}>
          <a className={s.ctaBtn} href="/">
            Enter the terminal
            <span className={s.ctaArrow} aria-hidden="true">→</span>
          </a>
          <span className={s.ctaNote}>{grouped(truth.totalLots)} lots · nightly</span>
        </div>
      </section>
    </div>
  );
}
