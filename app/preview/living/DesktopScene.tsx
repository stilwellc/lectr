'use client';

/**
 * DESKTOP — the cinematic hero resolves into the terminal on scroll.
 *   Act 1  full-screen gold mesh-gradient + the massive count-up + drifting tape
 *   Act 2  "507,107 lots" — the corpus, stated
 *   Act 3  the dollar-normalized index DRAWS in
 *   Act 4  the RECORD BOARD
 *   Act 5  the backtest edge + a quiet CTA
 * Scroll reveals ride native CSS scroll-driven animation where supported, with
 * an IntersectionObserver fallback baked into each block (chart/board/edge each
 * observe themselves). Reduced motion → every act ships in its final state.
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

/** A scroll-revealed act. IO fallback drives `data-inview`; the CSS module also
 *  wires native scroll-timeline where the browser supports it. */
function Act({ children, className }: { children: React.ReactNode; className?: string }) {
  const [ref, inView] = useInViewport<HTMLDivElement>({ once: true, threshold: 0.2 });
  return (
    <div ref={ref} className={`${s.act} ${className ?? ''}`} data-inview={inView ? 'true' : 'false'}>
      {children}
    </div>
  );
}

export default function DesktopScene({ truth, tape, index, edge }: Props) {
  return (
    <div className={s.desktop}>
      {/* ── ACT 1 — the shader hero, pinned full-screen ── */}
      <section className={s.hero}>
        <HeroField mobile={false} />
        <div className={s.heroContent}>
          <HeroNumber truth={truth} mobile={false} />
        </div>
        <div className={s.heroTape}>
          <Tape lines={tape} mobile={false} />
        </div>
        <div className={s.scrollCue} aria-hidden="true">
          <span>scroll</span>
          <span className={s.scrollCueLine} />
        </div>
      </section>

      {/* ── ACT 2 — the corpus, stated ── */}
      <section className={s.section}>
        <Act className={s.corpus}>
          <p className={s.corpusThesis}>
            One tape for everything worth owning. Every hammer, every house, one
            index.
          </p>
          <div className={s.corpusStat}>
            <span className={s.corpusStatVal}>{grouped(truth.totalLots)}</span>
            <span className={s.corpusStatUnit}>lots, priced and normalized</span>
          </div>
        </Act>
      </section>

      {/* ── ACT 3 — the index draws in ── */}
      <section className={s.section}>
        <Act className={s.chartAct}>
          <div className={s.actHead}>
            <span className={s.actIndex}>01</span>
            <h2 className={s.actTitle}>The market, in one line</h2>
            <p className={s.actLede}>
              A cohort-normalized index across every category. Raw quarterly
              hammers underneath — we show the data, not a smoothed story.
            </p>
          </div>
          <IndexChart series={index} />
        </Act>
      </section>

      {/* ── ACT 4 — the Record Board ── */}
      <section className={s.section}>
        <Act className={s.boardAct}>
          <div className={s.actHead}>
            <span className={s.actIndex}>02</span>
            <h2 className={s.actTitle}>The Record Board</h2>
            <p className={s.actLede}>
              All-time hammer records, ranked across categories nobody else puts
              in one table.
            </p>
          </div>
          <RecordBoard mobile={false} />
        </Act>
      </section>

      {/* ── ACT 5 — the edge + CTA ── */}
      <section className={s.section}>
        <Act className={s.edgeAct}>
          <div className={s.actHead}>
            <span className={s.actIndex}>03</span>
            <h2 className={s.actTitle}>The edge, checked against history</h2>
          </div>
          <Edge edge={edge} />
          <div className={s.cta}>
            <a className={s.ctaBtn} href="/">
              Enter the terminal
              <span className={s.ctaArrow} aria-hidden="true">→</span>
            </a>
            <span className={s.ctaNote}>{grouped(truth.totalLots)} lots · updated nightly</span>
          </div>
        </Act>
      </section>
    </div>
  );
}
