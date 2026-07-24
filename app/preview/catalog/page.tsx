'use client';

/* ============================================================
   THE CATALOG  ·  /preview/catalog
   Direction B — taste-forward. Phillips × Sotheby's × Artsy,
   data-fied: editorial luxury that happens to be a live market.
   A Phillips catalogue with a Bloomberg spine.

   Fully self-contained under app/preview/catalog/ — its own
   CSS module (zero global collisions), its own client hooks,
   curated Record Board + a REAL live hero lot. Static-export
   safe: 'use client', all window access guarded, EAGER data
   only (useRayData → never triggers the full/archive load).
   ============================================================ */

import React, { useMemo } from 'react';
import { LazyMotion, domAnimation, m } from 'framer-motion';
import s from './style.module.css';
import {
  useMediaQuery,
  useReducedMotion,
  useMounted,
  useInView,
  fmtInt,
  fmtDelta,
  RECORD_BOARD,
  HERO_OBJECT,
} from './lib';
import { HeroObjectDesktop, HeroObjectMobile } from './HeroObject';
import { MarketChart, Pt } from './MarketChart';
import { useRayData } from '../../hooks/useRayData';

const EASE = [0.23, 1, 0.32, 1] as const;

/* ── real corpus truths (meta.json / backtest.json) ── */
const TOTAL_LOTS = 507_107;
const TOTAL_SOLD = 496_486;
const HOUSES = 7;
const MAKERS = 38;

/* the flagged-vs-unflagged edge (real, from backtest.json):
   flagged lots realise a median +41% over estimate-mid vs
   +17% unflagged — the honest, source-able "edge". */
const EDGE_FLAGGED = 41;
const EDGE_UNFLAGGED = 17;

/* fallback tape (real recent art hammers) if eager data is slow */
const FALLBACK_TAPE = [
  { maker: 'Pablo Picasso', title: 'Tête de femme', price: '$8.05M', house: "Sotheby's" },
  { maker: 'George Condo', title: 'Down in Chinatown', price: '$2.81M', house: "Sotheby's" },
  { maker: 'KAWS', title: 'Companion (Originalfake)', price: '$297K', house: "Christie's" },
  { maker: 'Andy Warhol', title: 'Moonwalk', price: '$207K', house: 'Bonhams' },
  { maker: 'Eddie Martinez', title: 'Ideal Location', price: '$154K', house: "Sotheby's" },
  { maker: 'Audemars Piguet', title: 'Royal Oak Perpetual Calendar', price: '$192K', house: "Sotheby's" },
];

const price = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

/* small reveal wrapper — IO-driven, reduced-motion resolves instantly */
function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const reduce = useReducedMotion();
  const on = reduce || seen;
  return (
    <div
      ref={ref}
      className={`${s.reveal} ${on ? s.revealed : ''} ${className || ''}`}
      style={{ transitionDelay: on && !reduce ? `${delay}ms` : '0ms' }}
    >
      {children}
    </div>
  );
}

export default function CatalogPage() {
  const isMobile = useMediaQuery('(max-width: 820px)', false);
  const { tape, demand, lastCrawl } = useRayData();

  // the index chart series — the REAL all-market demand series
  // (upcoming.json → demand.all, 1991→now). Falls to art if 'all' absent.
  const series: Pt[] = useMemo(() => {
    const src = (demand.all && demand.all.length ? demand.all : demand.art) || [];
    // keep it legible: drop the thin, noisy early quarters (pre-1993, low n)
    return src.filter((p) => p.n >= 20 && !p.date.startsWith('1991') && !p.date.startsWith('1992')) as Pt[];
  }, [demand]);

  // the live tape — prefer real art hammers (clean titles), else fallback
  const tapeItems = useMemo(() => {
    const src = tape.art && tape.art.length ? tape.art : tape.all;
    if (src && src.length) {
      return src.slice(0, 8).map((t) => ({
        maker: t.artist,
        title: (t.title || '').replace(/…$/, '').slice(0, 34),
        price: t.price,
        house: t.house,
      }));
    }
    return FALLBACK_TAPE;
  }, [tape]);

  const crawlDate = useMemo(() => {
    if (!lastCrawl) return null;
    try {
      return new Date(lastCrawl).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return null; }
  }, [lastCrawl]);

  return (
    <div className={s.root}>
      <div className={s.grain} aria-hidden />
      <div className={s.content}>
        <Masthead crawlDate={crawlDate} />
        {isMobile
          ? <Mobile series={series} tapeItems={tapeItems} />
          : <Desktop series={series} tapeItems={tapeItems} />}
      </div>
    </div>
  );
}

/* ── masthead ── */
function Masthead({ crawlDate }: { crawlDate: string | null }) {
  return (
    <header className={s.masthead}>
      <div className={s.brand}>lectr <em>· The Catalogue</em></div>
      <div className={s.mastRight}>
        <span className={s.mastMeta}><b>{fmtInt(TOTAL_LOTS)}</b> lots</span>
        <span className={s.mastMeta}><b>{HOUSES}</b> houses</span>
        <span className={s.mastMeta}>{crawlDate ? <>crawled <b>{crawlDate}</b></> : 'crawled nightly'}</span>
      </div>
    </header>
  );
}

/* ══════════════════════════════════════════════════════════════
   DESKTOP — grand, gallery-grade editorial lander.
   ══════════════════════════════════════════════════════════════ */
function Desktop({ series, tapeItems }: { series: Pt[]; tapeItems: { maker: string; title: string; price: string; house: string }[] }) {
  const reduce = useReducedMotion();
  const mounted = useMounted();

  // masked line-draw headline — each line wipes up on mount
  const lines = ['The market for', <>everything <em key="e">worth owning.</em></>];

  return (
    <div className={s.desktop}>
      <LazyMotion features={domAnimation} strict>
        {/* HERO */}
        <section className={`${s.hero} ${s.wrap}`}>
          <div className={s.heroGrid}>
            <div className={s.heroLead}>
              <m.div
                className={s.overline}
                initial={reduce ? false : { opacity: 0 }}
                animate={mounted ? { opacity: 1 } : undefined}
                transition={{ duration: 0.6, ease: EASE }}
              >
                Auction intelligence · Art · Watches · Design · Sports · Science · Culture
              </m.div>

              <h1 className={s.thesis}>
                {lines.map((ln, i) => (
                  <span className={s.thesisLine} key={i}>
                    <m.span
                      className={s.thesisLineInner}
                      initial={reduce ? false : { y: '110%' }}
                      animate={mounted ? { y: '0%' } : undefined}
                      transition={{ duration: 0.9, ease: EASE, delay: 0.15 + i * 0.12 }}
                    >
                      {ln}
                    </m.span>
                  </span>
                ))}
              </h1>

              <m.p
                className={s.heroDek}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={mounted ? { opacity: 1, y: 0 } : undefined}
                transition={{ duration: 0.8, ease: EASE, delay: 0.5 }}
              >
                A single, honest price record for the objects that don&rsquo;t trade on any
                exchange. <b>{fmtInt(TOTAL_LOTS)} lots</b> across seven houses, back to 1999 —
                read like a market, catalogued like a collection.
              </m.p>

              <m.div
                className={s.heroStats}
                initial={reduce ? false : { opacity: 0 }}
                animate={mounted ? { opacity: 1 } : undefined}
                transition={{ duration: 0.8, ease: EASE, delay: 0.7 }}
              >
                <Stat num={fmtInt(TOTAL_LOTS)} label="lots priced" />
                <Stat num={fmtInt(TOTAL_SOLD)} label="sold & settled" />
                <Stat num={`${HOUSES} houses`} label="Christie's · Sotheby's · Phillips …" />
              </m.div>
            </div>

            <HeroObjectDesktop />
          </div>
        </section>

        {/* RECORD BOARD */}
        <section className={`${s.board} ${s.wrap}`}>
          <Reveal>
            <div className={s.sectionHead}>
              <div>
                <div className={s.overline}>The Record Board</div>
                <h2 className={s.sectionTitle}>Every category&rsquo;s <em>high-water mark.</em></h2>
              </div>
              <p className={s.sectionSub}>
                The all-time hammer records, ranked across categories nobody prices together.
                Source-flagged, never asserted from the tape.
              </p>
            </div>
          </Reveal>

          <div className={s.boardList}>
            {RECORD_BOARD.map((r, i) => (
              <Reveal key={r.title} delay={i * 40}>
                <div className={`${s.row} ${i === 0 ? s.rowLit : ''}`}>
                  <div className={s.rowRank}>{String(i + 1).padStart(2, '0')}</div>
                  <div className={s.rowObj}>
                    <div className={s.rowTitle}>{r.title}</div>
                    <div className={s.rowMaker}>{r.maker}</div>
                  </div>
                  <div className={s.rowCat}>
                    <span className={s.catTag}>{r.category}</span>
                    <span className={s.rowSource}>{r.source}</span>
                  </div>
                  <div className={s.rowPrice}>
                    <div className={s.priceNum}>{price(r.usd)}</div>
                    <div className={s.priceHouse}>{r.house}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          {/* ONE quiet live tape */}
          <Reveal delay={80}>
            <div className={s.tape}>
              <span className={s.tapeLabel}>On the tape</span>
              <div className={s.tapeViewport}>
                <div className={s.tapeTrack}>
                  {[...tapeItems, ...tapeItems].map((t, i) => (
                    <span className={s.tapeItem} key={i}>
                      <b>{t.maker}</b> <i>{t.title}</i> <span className={s.num}>{t.price}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* THE MARKET — index chart */}
        <section className={`${s.market} ${s.wrap}`}>
          <Reveal>
            <div className={s.sectionHead}>
              <div>
                <div className={s.overline}>The Market</div>
                <h2 className={s.sectionTitle}>One index for <em>the whole room.</em></h2>
              </div>
              <p className={s.sectionSub}>
                A dollar-normalized demand index across every category we track, rebased to 100.
                Raw quarterly prints sit under the trend — we show the data.
              </p>
            </div>
          </Reveal>
          <Reveal delay={60}>
            <div className={s.chartWell}>
              {series.length > 2
                ? <MarketChart series={series} />
                : <ChartEmpty />}
            </div>
          </Reveal>
        </section>

        {/* EDITORIAL — quantified authority under whitespace */}
        <section className={`${s.essay} ${s.wrap}`}>
          <Reveal>
            <div className={s.essayGrid}>
              <p className={s.essayBody}>
                Collectibles were the last great market without a price.{' '}
                <em>lectr</em> reads <span className={s.num}>{fmtInt(TOTAL_LOTS)}</span> lots
                across seven houses the way a terminal reads equities — every hammer normalized,
                every estimate scored, every result kept. We publish our exclusions. We show the
                raw dots. The object still carries the desire; we just tell you what it&rsquo;s worth.
              </p>
              <div className={s.essayAside}>
                <div className={s.asideRow}>
                  <div className={s.asideNum}><b>{fmtDelta(EDGE_FLAGGED - EDGE_UNFLAGGED, 0)}</b></div>
                  <div className={s.asideLabel}>
                    Median edge of lots our model flags <b>under-estimated</b> versus the rest,
                    measured against realized results — a back-tested, source-able signal.
                  </div>
                </div>
                <div className={s.asideRow}>
                  <div className={s.asideNum}>{MAKERS}</div>
                  <div className={s.asideLabel}>Makers &amp; collections with a full price history, medians and record.</div>
                </div>
                <div className={s.asideRow}>
                  <div className={s.asideNum}>{fmtInt(TOTAL_SOLD)}</div>
                  <div className={s.asideLabel}>Lots sold &amp; settled in the corpus — the honest denominator.</div>
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className={s.cta}>
              <div className={s.ctaText}>See what everything worth owning is really worth.</div>
              <button className={s.ctaBtn} type="button">
                Search the catalogue <span className={s.ctaKbd}>⌘K</span>
              </button>
            </div>
          </Reveal>

          <footer className={s.footer}>
            <span>lectr — auction intelligence</span>
            <span>Sources · Christie&rsquo;s · Sotheby&rsquo;s · Phillips · Bonhams · Goldin · Rago · Wright</span>
          </footer>
        </section>
      </LazyMotion>
    </div>
  );
}

function Stat({ num, label }: { num: string; label: string }) {
  return (
    <div className={s.stat}>
      <span className={s.statNum}>{num}</span>
      <span className={s.statLabel}>{label}</span>
    </div>
  );
}

function ChartEmpty() {
  return (
    <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--paper-faint)', fontFamily: 'var(--font-mono-data)', fontSize: 12, letterSpacing: '0.1em' }}>
      LOADING THE MARKET…
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MOBILE — DISTINCT, re-authored. Full-bleed, gallery-on-a-phone.
   ══════════════════════════════════════════════════════════════ */
function Mobile({ series, tapeItems }: { series: Pt[]; tapeItems: { maker: string; title: string; price: string; house: string }[] }) {
  return (
    <div className={s.mobile}>
      {/* full-bleed hero object, huge serif overline */}
      <section className={s.mHero}>
        <HeroObjectMobile />
        <div className={s.mHeroType}>
          <div className={s.overline}>Auction intelligence</div>
          <h1 className={s.mThesis}>
            The market for<br />everything <em>worth owning.</em>
          </h1>
          <div className={s.mCaption}>
            <div className={s.mCapText}>
              <div className={s.mCapMaker}>{HERO_OBJECT.maker}</div>
              <div className={s.mCapTitle}>{HERO_OBJECT.title}, {HERO_OBJECT.year}</div>
              <div className={s.mCapMeta}>{HERO_OBJECT.house}</div>
            </div>
            <div className={s.mCapFigure}>
              <div className={s.mCapFigureLabel}>{HERO_OBJECT.figureLabel}</div>
              <div className={s.mCapFigureNum}>{HERO_OBJECT.figure}</div>
            </div>
          </div>
        </div>
      </section>

      {/* corpus stat band */}
      <div className={s.mStats}>
        <MStat num={fmtInt(TOTAL_LOTS)} label="lots priced" />
        <MStat num={fmtInt(TOTAL_SOLD)} label="sold" />
        <MStat num={`${HOUSES}`} label="houses" />
      </div>

      {/* record board — full-width plates */}
      <section className={`${s.mSection} ${s.wrap}`}>
        <Reveal>
          <div className={`${s.overline} ${s.mOverline}`}>The Record Board</div>
          <h2 className={s.mSectionTitle}>Every category&rsquo;s <em>high-water mark.</em></h2>
          <p className={s.mSectionSub}>
            All-time hammer records, ranked across categories nobody prices together. Source-flagged.
          </p>
        </Reveal>
        <div className={s.mPlates}>
          {RECORD_BOARD.map((r, i) => (
            <Reveal key={r.title} delay={i * 30}>
              <div className={s.mPlate}>
                <div className={s.mPlateRank}>{String(i + 1).padStart(2, '0')}</div>
                <div>
                  <div className={`${s.mPlatePrice} ${i === 0 ? s.mPlateLit : ''}`}>{price(r.usd)}</div>
                  <div className={s.mPlateTitle}>{r.title}</div>
                  <div className={s.mPlateMeta}>
                    <span className="cat">{r.category}</span>
                    <span>{r.maker}</span>
                    <span>{r.house}</span>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* market chart — full-bleed card */}
      <section className={`${s.mSection} ${s.wrap}`}>
        <Reveal>
          <div className={`${s.overline} ${s.mOverline}`}>The Market</div>
          <h2 className={s.mSectionTitle}>One index for <em>the whole room.</em></h2>
        </Reveal>
        <Reveal delay={60}>
          <div className={s.mChartCard}>
            {series.length > 2 ? <MarketChart series={series} compact /> : <ChartEmpty />}
          </div>
        </Reveal>
      </section>

      {/* editorial */}
      <section className={`${s.mEssay} ${s.wrap}`}>
        <Reveal>
          <p className={s.mEssayBody}>
            Collectibles were the last great market without a price. <em>lectr</em> reads{' '}
            <span className={s.num}>{fmtInt(TOTAL_LOTS)}</span> lots the way a terminal reads
            equities — every hammer normalized, every estimate scored, every result kept.
          </p>
        </Reveal>
        <Reveal delay={60}>
          <div className={s.mAside}>
            <div className={s.mAsideCell}>
              <div className={s.mAsideNum}><b>{fmtDelta(EDGE_FLAGGED - EDGE_UNFLAGGED, 0)}</b></div>
              <div className={s.mAsideLabel}>Median edge on lots we flag under-estimated.</div>
            </div>
            <div className={s.mAsideCell}>
              <div className={s.mAsideNum}>{MAKERS}</div>
              <div className={s.mAsideLabel}>Makers with a full price history.</div>
            </div>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className={s.mCta}>
            <div className={s.mCtaText}>See what everything worth owning is really worth.</div>
            <button className={s.mCtaBtn} type="button">Search the catalogue</button>
          </div>
        </Reveal>
        <footer className={s.footer} style={{ textTransform: 'none' }}>
          <span>lectr</span>
          <span>7 houses · nightly</span>
        </footer>
      </section>
    </div>
  );
}

function MStat({ num, label }: { num: string; label: string }) {
  return (
    <div className={s.mStat}>
      <span className={s.mStatNum}>{num}</span>
      <span className={s.mStatLabel}>{label}</span>
    </div>
  );
}
