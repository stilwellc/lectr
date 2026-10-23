import type { Metadata } from 'next';
import JsonLd from '../../components/JsonLd';
import { postMeta, postLd } from '../posts';
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
   BUILD-TIME figures, not literals — same contract as the Q2
   note. Every index read in this post is derived from the
   shipped market.json through the SAME selector the live
   VerifiedMovers panel uses (verifiedMovers: longest horizon
   whose 95% CI resolves the sign), so the post can never drift
   from the product.

   HONESTY NOTE: the quarter facts (lot counts, realized totals,
   top sales, sell-through, sold-vs-estimate) are Q3 2026 —
   fixed history, taken from scripts/quarter-stats.ts on the
   October 22, 2026 corpus. Q3 2025 is the like-for-like
   comparison (same method, same corpus); Q2 2026 is quoted on
   today's corpus, not from the published Q2 note. The index is
   NOT fixed: it refits nightly, so every engine figure below is
   a CURRENT read with an explicit as-of date.
   ============================================================ */

const market = marketJson as unknown as MarketData;
const allMovers = verifiedMovers(market);
const movers = verifiedMovers(market, 'watches');
/** true only while every publishable maker in the whole corpus is a watch maker */
const ONLY_WATCHES = movers.length > 0 && movers.length === allMovers.length;
const up = movers.filter(m => m.dir === 'up');
const down = movers.filter(m => m.dir === 'down');
const publishes = (slug: string) => movers.some(m => m.slug === slug);

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

/** the descriptive (demand-only) watch reads — the engine's trailing-year, HAMMER-basis
 *  %-over-estimate (app/lib/demand.ts), never an index */
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
  if (missing.length === HZ.length && !publishes(slug)) { fullAbstain.push(label); continue; }
  const plural = missing.length > 1 || missing[0] !== '1Y';
  partialAbstain.push(`${label} at ${joinList(missing.map(h => HORIZON_COUNT[h]))} year${plural ? 's' : ''}`);
}

const moverSummary = movers.map(m => `${m.label} ${pct(m.changePct)} (${m.horizon})`).join(', ');
const splitPhrase = up.length && down.length ? ` (${countWord(up.length)} up, ${countWord(down.length)} down)` : '';

const POST = {
  title: 'Q3 2026 watch market in review — one Hong Kong sale made the quarter',
  description:
    `586 watches, $41.1M, 95% sell-through — four times Q3 2025, with $30.1M of it from a single Sotheby's Hong Kong sale led by a unique $3.39M Cartier Cheich.${
      movers.length
        ? ` As of the ${asOf} corpus, ${countWord(movers.length)} watch maker${movers.length === 1 ? '' : 's'} clear${movers.length === 1 ? 's' : ''} the 95%-confidence bar: ${moverSummary}.`
        : ` As of the ${asOf} corpus, no watch maker clears the 95%-confidence bar.`
    } The off-season tape, the Cartier surge, and what the engine will and won't say.`,
};
export const metadata: Metadata = postMeta('q3-2026-watches', POST);

const dek =
  `586 watches sold for $41.1M — four times the same quarter a year ago, though one Sotheby's Hong Kong sale accounts for $30.1M of it. Strip that weekend out and the summer calendar was flat in dollars but sharper against estimates. As of the ${asOf} corpus, ${
    movers.length
      ? `${countWord(movers.length)} watch ${movers.length === 1 ? 'maker carries' : 'makers carry'} a published move${splitPhrase}, each with its 95% confidence interval`
      : 'no watch maker carries a published move'
  } — everything else abstains.`;

const footnote = [
  'Sell-through counts sold against bought-in lots only; 107 lots whose results the houses had not published at the time of writing are left out of both sides.',
  'The quarter-level demand figures (the Movers table, and every sold-vs-estimate figure in the prose) are medians of published sold price over the estimate midpoint; they are not returns.',
  `The index reads are hedonic reads of the corpus as of ${asOf}, each shown with its 95% confidence interval and the horizon over which it resolves; they are re-read from market.json every time this page is built, so they are current rather than a Q3 snapshot.`,
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
      <B>{m.label} is {m.dir === 'up' ? 'up' : 'down'} {absPct(m.changePct)} {m.horizon.startsWith('since ') ? m.horizon : `over ${HORIZON_PHRASE[m.horizon] ?? m.horizon}`}</B>
      {' '}(95% CI {pct(m.ciLoPct)} to {pct(m.ciHiPct)}), on a {m.n.toLocaleString()}-lot cohort
    </>
  );
}

export default function Q3Watches() {
  return (
    <>
      <JsonLd data={postLd('q3-2026-watches', POST)} />
    <QuarterInsight
      market="watch"
      quarter="Q3 2026"
      months="July–September"
      basis="sold"
      date="October 22, 2026"
      title="Watches in Q3: one Hong Kong weekend made the quarter"
      dek={dek}
      stats={[
        { label: 'Total realized', value: '$41.1M', sub: '586 lots · $10.1M in Q3 2025' },
        { label: 'Median sale', value: '$22,938', sub: 'vs $15,443 a year ago' },
        { label: 'Sell-through', value: '95.1%', sub: 'vs 90.9% in Q3 2025', tone: 'up' },
        { label: 'Sold vs estimate', value: '1.27×', sub: 'median · 50% beat the high' },
      ]}
      headline={{
        image: '/blog/q3-2026-cartier-cheich.jpg',
        caption: 'Cartier — Cheich, unique white gold wristwatch',
        priceUsd: 3_394_560,
        house: "Sotheby's",
        saleLine: 'September 18, 2026 · Hong Kong',
        para: <>The quarter&rsquo;s top watch wasn&rsquo;t a Patek. The Cheich is among the most
          sculptural shapes Cartier ever put on a wrist: its name evokes the sheikh&rsquo;s headdress,
          and the case is modelled on draped cloth, white gold folded around an elongated dial like a
          headdress framing a face, with the fold falling away past the crown. It has always been one
          of the rarest Cartier shapes, and Sotheby&rsquo;s catalogued this example as unique. It
          brought <B>$3,394,560</B> (about HK$26.5M) in Hong Kong on September 18 against a deliberately
          wide HK$8–40M estimate — more than twice the next-best watch of the quarter, and 8% of all the
          watch value we tracked from July to September. For scale: the biggest watch in our Q3 2025
          coverage made $393K, and that quarter produced no seven-figure result at all. This one is
          also the clearest single expression of the quarter&rsquo;s real story, which is that the
          collector-shape Cartiers — Cheich, Crash, Pebble — are being bid like grand complications.</>,
      }}
      topSales={[
        { title: 'Cartier — Cheich, a historically important and unique white gold wristwatch (c. 2010)', priceUsd: 3_394_560, house: "Sotheby's", date: '2026-09-18', maker: 'cartier' },
        { title: 'Patek Philippe — ref. 5074R-018, possibly unique pink gold minute-repeating perpetual calendar, black dial, factory sealed', priceUsd: 1_474_560, house: "Sotheby's", date: '2026-09-19', maker: 'patek-philippe' },
        { title: 'Patek Philippe — ref. 5016 “Second Series”, pink gold minute-repeating perpetual calendar tourbillon', priceUsd: 1_146_880, house: "Sotheby's", date: '2026-09-18', maker: 'patek-philippe' },
        { title: 'Patek Philippe — ref. 2497, the last example made, yellow gold perpetual calendar (1963)', priceUsd: 1_064_960, house: "Sotheby's", date: '2026-09-18', maker: 'patek-philippe' },
        { title: 'Audemars Piguet — Code 11.59 Grande Sonnerie Carillon Supersonnerie “Samurai”, unique pink gold, cloisonné enamel dial', priceUsd: 1_015_808, house: "Sotheby's", date: '2026-09-19', maker: 'audemars-piguet' },
        { title: 'Patek Philippe — ref. 5531, pink gold minute-repeating world time with cloisonné enamel dial', priceUsd: 983_040, house: "Sotheby's", date: '2026-09-19', maker: 'patek-philippe' },
        { title: 'Cartier — Crash ref. 2774, possibly unique white gold and sapphire-set wristwatch', priceUsd: 884_736, house: "Sotheby's", date: '2026-09-19', maker: 'cartier' },
        { title: 'Patek Philippe — Nautilus ref. 5711/111P-001, platinum and sapphire-set', priceUsd: 827_392, house: "Sotheby's", date: '2026-09-18', maker: 'patek-philippe' },
        { title: 'Patek Philippe — ref. 942/2, unique yellow gold grande sonnerie minute-repeating perpetual calendar split-seconds clock watch (1993)', priceUsd: 720_896, house: "Sotheby's", date: '2026-09-18', maker: 'patek-philippe' },
        { title: 'Patek Philippe — ref. 5374, platinum minute-repeating perpetual calendar, black enamel dial', priceUsd: 688_128, house: "Sotheby's", date: '2026-09-18', maker: 'patek-philippe' },
      ]}
      moversHeader="Median sold vs estimate"
      movers={[
        { label: 'Cartier', chgPct: 42.2, n: 118, slug: 'cartier' },
        { label: 'Omega', chgPct: 37.8, n: 41, slug: 'omega' },
        { label: 'Audemars Piguet', chgPct: 28.0, n: 70, slug: 'audemars-piguet' },
      ]}
      coolers={[
        { label: 'Patek Philippe', chgPct: 20.0, n: 214, slug: 'patek-philippe' },
        { label: 'Rolex', chgPct: 18.9, n: 143, slug: 'rolex' },
      ]}
      footnote={footnote}
    >
      <H>The off-season, with one exception</H>
      <P lede>
        Summer is the trough of the watch calendar — the big Geneva, Hong Kong and New York sales land
        in spring and autumn — so Q3 is never going to look like Q2, which on today&rsquo;s corpus ran
        1,784 sold lots and $245M. The honest comparison is the same quarter a year ago, and against
        that Q3 2026 was a different animal: <B>586 lots sold for $41.1M</B>, against 331 for $10.1M in
        Q3 2025. Sell-through rose from 90.9% to <B>95.1%</B>, the median sale from $15,443 to $22,938,
        and the median lot sold at 1.27× its estimate midpoint (1.18× a year ago), with half the room
        clearing the high outright. Only 3.8% sold under the low estimate. On every measure the
        quarter was deeper and hotter than its predecessor — but most of the dollar gain has a single
        address.
      </P>
      <H>Strip out one sale and the dollars are flat</H>
      <P>
        Sotheby&rsquo;s two-session Important Watches sale in Hong Kong on September 18–19 sold 208
        lots for <B>$30.1M — 73% of everything we tracked</B> in the quarter, and every one of the
        ten biggest results. Our Q3 2025 coverage has no equivalent sale; with it, Sotheby&rsquo;s took
        86% of the quarter&rsquo;s watch value, Phillips 12% and Bonhams 2%, and we tracked no
        Christie&rsquo;s watch sale in either summer. Take that one weekend out and the rest of the
        quarter made <B>$10.9M from 378 lots</B> — barely above last year&rsquo;s $10.1M. The
        recurring September dates tell the same story sale by sale: Phillips in Geneva sold 39 lots
        for $2.58M (34 for $2.63M a year earlier), Phillips Hong Kong 64 for $2.13M (71 for $2.40M),
        and Sotheby&rsquo;s Hong Kong Fine Watches 152 for $2.87M (115 for $3.47M). What did change
        outside the trophy sale is price against estimate: the rest of the quarter sold at a median
        1.28× its estimate midpoint, with 53% beating the high. Volume held; the bar got cleared by
        more.
      </P>
      <H>Cartier carried the room — and the bought-ins</H>
      <P>
        Cartier was the hottest maker we track all quarter: 118 sold at a median <B>42% over the
        estimate midpoint</B>, double its 21% a year ago (on 70 lots), with 63% clearing the high. The
        Hong Kong sale is where it showed. The Cheich led; six Crash variants made $3.05M between them,
        topped by a possibly unique sapphire-set reference 2774 at $885K; and a mid-sized 1970s gold
        Pebble estimated at $122–192K sold for $492K. Fifty-five Cartiers sold in that sale at a median
        1.45× estimate, 35 of them over the high. The same catalogue also produced the quarter&rsquo;s
        one soft patch, and it was Cartier too: <B>26 of the 30 watches bought in all quarter were
        Cartiers</B>, 22 of them in Hong Kong — mostly early jeweller&rsquo;s-era ladies&rsquo;
        watches, pendant and purse watches, none estimated above $36K. Cartier&rsquo;s sell-through
        was 81.9%; Patek Philippe and Audemars Piguet sold every lot they offered. The market is paying
        up for the collector shapes and passing on the Edwardian jewellery. (Cartier&rsquo;s median
        sale also rose from $5,109 to $19,661, but that is composition — last summer&rsquo;s Cartiers
        were mostly small Bonhams lots — not a price move, and we don&rsquo;t read it as one.)
      </P>
      <H>What a confidence interval means here</H>
      <P>
        Everything above is demand: how the median lot sold against its own estimate. It is fast and
        mix-proof, but it is not a return. For a return the engine runs a hedonic index per maker — a
        regression that holds reference, metal, size and condition language constant and reads the
        residual as the market&rsquo;s move over time — and reports the 95% confidence interval around
        that move. <B>If the interval spans zero, we publish nothing.</B> A read of &ldquo;+8%, but
        anywhere from −5% to +21%&rdquo; isn&rsquo;t a direction, it&rsquo;s noise wearing a number, and
        a summer quarter of 586 lots doesn&rsquo;t change that arithmetic: the index fits the whole
        corpus back to the early 1990s, and one hot Hong Kong weekend moves it only as far as its weight allows.
      </P>
      {/* the pull — lifted verbatim from the paragraph above */}
      <PullQuote>A read of &ldquo;+8%, but anywhere from −5% to +21%&rdquo; isn&rsquo;t a direction, it&rsquo;s noise wearing a number.</PullQuote>
      <H>What the index actually says</H>
      <P>
        The quarter above is fixed history; the index is not. It refits nightly over the whole corpus,
        and the reads below are pulled out of <B>market.json</B> when this page is built — so they are
        the <em>current</em> state of the engine, not a Q3 snapshot. As of the {asOf} corpus:
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
          {ONLY_WATCHES ? <> Watches remains the only vertical where any maker clears the bar at all.</> : null}
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
              {s.label} reads {pct(s.demandNow as number)}
            </Fragment>
          ))}{' '}
          against estimates on the engine&rsquo;s own demand line — a trailing-twelve-month median
          read before the buyer&rsquo;s premium, so it runs well below the
          premium-inclusive quarter figures in this note and is not a price move. None of{' '}
          {demandReads.length === 1 ? 'it resolves' : 'them resolves'} an index at any horizon.
        </P>
      )}
      <H>Where the opportunity sits</H>
      <P>
        Put the two reads side by side and the quarter inverts. The makers the room chased hardest —
        Cartier at 42% over estimate, Omega at 38% (on 41 lots), Audemars Piguet at 28% — are the ones
        the index can&rsquo;t yet price, because their like-for-like cohorts are too thin or too mixed
        in the recent quarters to resolve. The two makers with the <em>softest</em> demand, Patek Philippe
        (20% over, on 214 lots, unchanged from 19% a year ago) and Rolex (19%, up from 13%), are
        {publishes('patek-philippe') && publishes('rolex')
          ? <> the two the engine will put a number on</>
          : <> the deepest cohorts we hold</>}
        . For a buyer that is the shape of the opportunity: the Cartier tape is running on estimate
        heat that no index yet underwrites, while the deep Patek and Rolex reference market clears at
        a modest premium to estimates
        {up.length > 0 && down.length === 0 ? <> on a long-run index that points up</> : null}. The
        below-market flags our engine carries into Q4 sit in that middle — not the unrepeatable pieces,
        which clear at or above every estimate, but the liquid references where the comps have moved
        and the catalogues have not. The autumn sales will say whether the Cartier premium holds once
        the Patek-heavy calendar returns.
      </P>
    </QuarterInsight>
    </>
  );
}
