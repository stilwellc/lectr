import type { Metadata } from 'next';
import { Fragment } from 'react';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';
import { PullQuote } from '../../components/blog/Editorial';
import meta from '../../../public/data/ray/meta.json';
import marketJson from '../../../public/data/ray/market.json';
import { verifiedMovers, fmtPct, type VerifiedMover } from '../../preview/terminal/verified';
import type { MarketData } from '../../hooks/useRayData';
import { ARTIST_LABEL, ARTIST_MARKET } from '../../constants';
import { formatDate } from '../../utils';

/* ============================================================
   BUILD-TIME figures, not literals. Every index read in this
   post is derived from the shipped market.json through the SAME
   selector the live VerifiedMovers panel uses (verifiedMovers:
   longest horizon whose 95% CI resolves the sign), so the post
   can never drift from the product (audit C2 pre-GA-8).

   HONESTY NOTE: the quarter facts in this post (lot counts,
   realized totals, top sales, sell-through) are Q2 2026 —
   fixed history. The index is NOT: it refits nightly off the
   whole corpus. So every derived figure below is stated as a
   CURRENT read with an explicit as-of date, never as "what the
   index said in Q2". Claims that could not be honestly restated
   as current were deleted rather than re-pointed at live data.
   ============================================================ */

const market = marketJson as unknown as MarketData;
const allMovers = verifiedMovers(market);
const movers = verifiedMovers(market, 'watches');
/** true only while every publishable maker in the whole corpus is a watch maker */
const ONLY_WATCHES = movers.length > 0 && movers.length === allMovers.length;
const up = movers.filter(m => m.dir === 'up');
const down = movers.filter(m => m.dir === 'down');
const isUp = (slug: string) => up.some(m => m.slug === slug);

/** the corpus as-of, straight from meta.json — the date every read below is true for */
const asOf = formatDate(meta.lastCrawl);

const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);
const HORIZON_PHRASE: Record<string, string> = { '1Y': 'one year', '3Y': 'three years', '5Y': 'five years' };
const HORIZON_COUNT: Record<string, string> = { '1Y': 'one', '3Y': 'three', '5Y': 'five' };
/** minus sign, not hyphen — the site's grammar for a measured negative */
const pct = (n: number) => fmtPct(n).replace('-', '−');
const absPct = (n: number) => `${Math.abs(n).toFixed(1)}%`;
const joinList = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '')
    : xs.length === 2 ? `${xs[0]} and ${xs[1]}`
      : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
const labels = (ms: VerifiedMover[]) => joinList(ms.map(m => m.label));

/** the descriptive (demand-only) watch reads — measured %-over-estimate, never an index */
const demandReads = (market.subMarkets?.watches ?? [])
  .filter(s => s.readType === 'demand' && s.demandNow != null);

/** which horizons each watch maker abstains at — derived, so it can't go stale */
const HZ = ['1Y', '3Y', '5Y'] as const;
const partialAbstain: string[] = [];
const fullAbstain: string[] = [];
for (const slug of Object.keys(market.makerIndex ?? {})) {
  if (ARTIST_MARKET[slug] !== 'watches') continue;
  const hz = market.makerIndex?.[slug]?.horizons;
  const missing = HZ.filter(h => !hz?.[h]?.publishable);
  if (!missing.length) continue;
  const label = ARTIST_LABEL[slug] || slug;
  if (missing.length === HZ.length) { fullAbstain.push(label); continue; }
  const plural = missing.length > 1 || missing[0] !== '1Y';
  partialAbstain.push(`${label} at ${joinList(missing.map(h => HORIZON_COUNT[h]))} year${plural ? 's' : ''}`);
}

const moverSummary = movers.map(m => `${m.label} ${pct(m.changePct)} (${m.horizon})`).join(', ');
const splitPhrase = up.length && down.length ? ` (${countWord(up.length)} up, ${countWord(down.length)} down)` : '';

export const metadata: Metadata = {
  title: 'Q2 2026 watch market in review — the deepest, most liquid tape we track',
  description:
    `1,811 watches, $240M, near-total sell-through — the deepest, most measurable market we cover${
      ONLY_WATCHES ? ', and the only vertical where our engine will publish a return' : ''
    }.${
      movers.length
        ? ` As of the ${asOf} corpus, ${countWord(movers.length)} maker${movers.length === 1 ? '' : 's'} clear${movers.length === 1 ? 's' : ''} the 95%-confidence bar: ${moverSummary}.`
        : ' As of the ' + asOf + ' corpus, no watch maker clears the 95%-confidence bar.'
    } What a confidence interval means, why almost everything abstains, and the Q2 2026 sales underneath.`,
};

const dek =
  `1,811 watches sold for $240M — by far the most liquid, most measurable market we cover.${
    ONLY_WATCHES ? " It's also the only vertical where our engine clears the bar to publish a return." : ''
  } As of the ${asOf} corpus, ${
    movers.length
      ? `${countWord(movers.length)} watch ${movers.length === 1 ? 'maker carries' : 'makers carry'} a published move${splitPhrase}, each with its 95% confidence interval`
      : 'no watch maker carries a published move'
  } — everything else abstains.`;

const footnote = [
  `The index reads in this note are hedonic reads of the corpus as of ${asOf}, each shown with its 95% confidence interval and the horizon over which it resolves; they are re-read from market.json every time this page is built, so they are current rather than a Q2 snapshot.`,
  partialAbstain.length
    ? `Where a maker's interval doesn't resolve the sign we publish no direction — ${joinList(partialAbstain)}.`
    : '',
  fullAbstain.length
    ? `${joinList(fullAbstain)} ${fullAbstain.length === 1 ? 'clears' : 'clear'} no horizon at all.`
    : '',
  ONLY_WATCHES ? 'Watches is the one vertical where any maker currently clears the bar.' : '',
].filter(Boolean).join(' ');

/** One mover, as a sentence clause: direction, size, horizon, interval, cohort. */
function moverClause(m: VerifiedMover) {
  return (
    <>
      <B>{m.label} is {m.dir === 'up' ? 'up' : 'down'} {absPct(m.changePct)} over {HORIZON_PHRASE[m.horizon] ?? m.horizon}</B>
      {' '}(95% CI {pct(m.ciLoPct)} to {pct(m.ciHiPct)}), on a {m.n.toLocaleString()}-lot cohort
    </>
  );
}

export default function Q2Watches() {
  return (
    <QuarterInsight
      market="watch"
      date="July 16, 2026"
      title="Watches in Q2: the deepest tape we track"
      dek={dek}
      stats={[
        { label: 'Total realized', value: '$239.9M', sub: '1,811 lots sold' },
        { label: 'Median sale', value: '$48,260', sub: 'across the makers we track' },
        { label: 'Sell-through', value: '97–98%', sub: 'deepest liquidity we track', tone: 'up' },
        { label: 'Hammer vs estimate', value: '1.35×', sub: 'median · 55% beat the high' },
      ]}
      headline={{
        image: 'https://dist.phillips.com/auction-assets/HK080226/234083_001.jpg?bg-color=ffffff&pad=0&fit=bounds&height=550&optimize=medium&width=605',
        caption: 'Patek Philippe — pink gold perpetual calendar chronograph',
        priceUsd: 10_287_360,
        house: 'Phillips',
        saleLine: 'May 30, 2026 · Hong Kong',
        para: <>The quarter&rsquo;s top watch, and one of the largest of the year: an historically important pink gold perpetual calendar chronograph with French calendar and moon phases, its case made by Vichet — the only known pink gold first-series example carrying British hallmarks. It brought $10,287,360 at Phillips&rsquo; May sale against a $3.1–6.1M estimate. Phillips owned the top of the quarter: it took <B>43% of all watch value</B> and every one of the five biggest results, all of them Patek. That&rsquo;s the pattern beneath a reference market that mostly refuses to resolve at all — the trophy tier keeps setting records even where the index underneath it declines to call a direction.</>,
      }}
      topSales={[
        { title: 'Patek Philippe — pink gold perpetual calendar chronograph, French calendar & moon phases (Vichet case)', priceUsd: 10_287_360, house: 'Phillips', date: '2026-05-30', maker: 'patek-philippe' },
        { title: 'Patek Philippe — yellow gold two-crown world-time with cloisonné enamel dial', priceUsd: 9_155_150, house: 'Phillips', date: '2026-05-09', maker: 'patek-philippe' },
        { title: 'Patek Philippe — a most probably unique white gold perpetual calendar split-seconds chronograph', priceUsd: 5_202_000, house: 'Phillips', date: '2026-06-13', maker: 'patek-philippe' },
        { title: 'Patek Philippe — an incredible, extremely well-preserved pink gold perpetual calendar', priceUsd: 3_992_000, house: 'Phillips', date: '2026-06-13', maker: 'patek-philippe' },
        { title: 'Patek Philippe — a rare, freshly unsealed white gold double-dial wristwatch', priceUsd: 3_728_300, house: 'Phillips', date: '2026-05-09', maker: 'patek-philippe' },
        { title: 'Patek Philippe — 18K white gold automatic perpetual calendar (ref. 3450)', priceUsd: 2_759_000, house: "Christie's", date: '2026-06-12', maker: 'patek-philippe' },
        { title: 'Audemars Piguet — unique platinum custom-order minute-repeating perpetual calendar', priceUsd: 2_454_100, house: "Christie's", date: '2026-05-11', maker: 'audemars-piguet' },
        { title: 'Cartier — Crash, yellow gold distorted oval wristwatch', priceUsd: 1_998_848, house: "Sotheby's", date: '2026-04-24', maker: 'cartier' },
        { title: 'Patek Philippe — unique yellow gold single-button chronograph', priceUsd: 1_966_080, house: "Sotheby's", date: '2026-04-24', maker: 'patek-philippe' },
        { title: 'Cartier — 18K gold asymmetric wristwatch', priceUsd: 1_822_750, house: "Christie's", date: '2026-05-11', maker: 'cartier' },
      ]}
      footnote={footnote}
    >
      <H>The only tape we&rsquo;ll put a number on</H>
      <P lede>
        Watches were the easiest market to sell into all quarter — <B>97–98% sell-through</B> across
        1,811 lots, with the median hammering 35% over its estimate midpoint and 55% clearing the high
        outright. Nothing else we track comes close on clearance or on sample depth: art buys in a
        third of what it offers, design ran 170 sold lots all quarter, and watches cleared better than
        ten times that with almost nothing left in the room. That depth is the whole reason watches is
        {ONLY_WATCHES ? <> the <em>only</em> vertical</> : <> a vertical</>}{' '}
        where our engine will publish a like-for-like return. Elsewhere we
        speak in demand — how the median lot hammered against its own estimate — because the cohorts
        are too thin or too mixed to isolate a price move. Here the cohorts are big enough that a move
        survives its own confidence interval, so we can speak in price.
      </P>
      <H>What a confidence interval means here</H>
      <P>
        The engine runs a hedonic index per maker: a regression that holds reference, metal, size and
        condition-language constant and reads the residual as the market&rsquo;s move over time — then
        it reports the 95% confidence interval around that move. <B>The rule is simple: if the interval
        spans zero, we publish nothing.</B> A read of &ldquo;+8%, but anywhere from −5% to +21%&rdquo;
        isn&rsquo;t a direction, it&rsquo;s noise wearing a number, and we&rsquo;d rather say so than
        launder it into a headline. That is why a maker can appear at one horizon and vanish at another:
        the same cohort resolves cleanly over one window and dissolves into uncertainty over the next.
        {ONLY_WATCHES ? <> It is also why watches is the one place we quote a return at all — everywhere
        else the intervals never tighten enough to clear the bar.</> : null}
      </P>
      {/* the pull — lifted verbatim from the paragraph above */}
      <PullQuote>A read of &ldquo;+8%, but anywhere from −5% to +21%&rdquo; isn&rsquo;t a direction, it&rsquo;s noise wearing a number, and we&rsquo;d rather say so than launder it into a headline.</PullQuote>
      <H>What the index actually says</H>
      <P>
        One thing to be clear about before the numbers: the quarter above is fixed history, but the
        index is not. It refits nightly over the whole corpus, and the reads below are pulled out of{' '}
        <B>market.json</B> when this page is built — so they are the <em>current</em> state of the
        engine, not a Q2 snapshot. As of the {asOf} corpus:
      </P>
      {movers.length > 0 ? (
        <P>
          <B>{countWord(movers.length)} watch {movers.length === 1 ? 'maker clears' : 'makers clear'} the
          bar</B>{movers.length > 1 && up.length && down.length ? <>, and they don&rsquo;t point the same way</> : null}.{' '}
          {movers.map((m, i) => (
            <Fragment key={m.slug}>
              {i > 0 ? '; ' : ''}
              {moverClause(m)}
            </Fragment>
          ))}
          . Every other horizon these makers hold either spans zero or fails an upstream gate, and we
          publish nothing there.
        </P>
      ) : (
        <P>
          <B>No watch maker currently clears the bar.</B> Every horizon we hold either spans zero or
          fails an upstream gate, so the engine publishes no watch return at all — which is the system
          working, not failing.
        </P>
      )}
      {demandReads.length > 0 && (
        <P>
          The rest stay descriptive.{' '}
          {demandReads.map((s, i) => (
            <Fragment key={s.slug}>
              {i > 0 ? '; ' : ''}
              {s.label} reads {pct(s.demandNow as number)} against its own estimates over the trailing
              year — a demand figure, not a price move — and its index resolves at no horizon
            </Fragment>
          ))}
          . We report the moves that resolve and hold the ones that don&rsquo;t.
        </P>
      )}
      {up.length > 0 && down.length > 0 && (
        <P>
          Read together, that is a bifurcated market. {labels(down)} {down.length === 1 ? 'is' : 'are'}{' '}
          giving ground on the index while {labels(up)} {up.length === 1 ? 'is' : 'are'} compounding —
          exactly the kind of divergence the index exists to surface: the record-setter and the
          appreciating asset are not the same maker.
        </P>
      )}
      <H>Trophies detached from the reference market</H>
      <P>
        The top of the quarter is nearly all Patek and nearly all Phillips. The $10.3M perpetual
        calendar chronograph led, followed by a $9.2M cloisonné world-time and three more seven-figure
        Pateks — and <B>Phillips took 43% of all tracked watch value</B> and the five biggest results
        outright. Sotheby&rsquo;s (28%) and Christie&rsquo;s (26%) split most of the rest. Patek alone
        was 60% of tracked value, Rolex 16%, Cartier 15%. None of these approached a record — Patek&rsquo;s
        all-time high is the $31.2M Grandmaster Chime from 2019 — but they didn&rsquo;t need to: they are
        the tell that condition-and-rarity trophies keep clearing at full price whatever the deep
        reference tape beneath them is doing. Two of the quarter&rsquo;s most interesting results
        were Cartiers — a <em>Crash</em> at $2.0M and an asymmetric gold wristwatch at $1.8M
        {isUp('cartier') ? <> — which is the trophy tape agreeing with the index for once: a maker the
        engine currently reads as appreciating is also one of the houses throwing surprises at the top</> : null}.
      </P>
      <H>Where the opportunity sits</H>
      <P>
        For a buyer, the shape of this market is the opportunity. Liquidity is total — you can sell almost
        anything — but outside the unrepeatable pieces the comps have already done the repricing and many
        estimates haven&rsquo;t caught up
        {down.length > 0 ? <>, particularly in the {labels(down)} references the index currently reads
        as declining</> : null}. The below-market flags our engine carries into Q3 sit in exactly that
        middle: not the trophies, which clear at or above every estimate, but the deep, liquid reference
        tape where the comps have moved and the catalogues have not.
        {movers.length > 0 ? <> That is the one vertical where we can point at a number and defend it —
        so it&rsquo;s the one where we do.</> : null}
      </P>
    </QuarterInsight>
  );
}
