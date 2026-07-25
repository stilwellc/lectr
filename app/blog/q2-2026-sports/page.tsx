import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';

export const metadata: Metadata = {
  title: 'Q2 2026 sports market in review — a $126M quarter led by the cards',
  description: 'A $2.93M LeBron rookie patch auto on top, a $2.81M Gretzky jersey behind it, and 19,000-plus lots through Goldin. The Q2 2026 sports market, reported as the descriptive tape it is.',
};

export default function Q2Sports() {
  return (
    <QuarterInsight
      market="sports"
      date="July 16, 2026"
      title="Sports in Q2: the cards led a $126M quarter"
      dek="The highest-volume market we track by a wide margin: 19,000-plus lots for $126M, nearly all of it through Goldin. Modern rookie cards set the ceiling, game-used memorabilia held the marquee, and — because these are bid sales — we report it descriptively, not as a return."
      stats={[
        { label: 'Total realized', value: '$125.6M', sub: '19,296 lots sold' },
        { label: 'Median sale', value: '$551', sub: 'a true retail-depth tape' },
        { label: 'Top lot', value: '$2.93M', sub: 'LeBron rookie patch auto' },
        { label: 'Basis', value: 'Bid sales', sub: 'no estimates published' },
      ]}
      headline={{
        image: 'https://d2tt46f3mh26nl.cloudfront.net/public/Lots/202603-2415-1559-28920969-4255-4ef8-a4c8-1338eba9fb2a/74314742-97a8-459a-bdbd-3945dd7cd26e@1x',
        caption: 'LeBron James — 2003-04 Upper Deck Exquisite Collection Rookie Patch Autograph #78',
        priceUsd: 2_928_000,
        house: 'Goldin',
        saleLine: 'June 29, 2026',
        para: <>The card that defined a generation of the hobby: LeBron&rsquo;s 2003-04 Upper Deck Exquisite Rookie Patch Autograph, the piece every modern RPA is measured against. It brought $2,928,000 at Goldin&rsquo;s June sale — the top sports result of the quarter, edged out over a $2.81M Wayne Gretzky final-Oilers jersey and a $2.56M Shohei Ohtani 1/1 SuperFractor. Three of the quarter&rsquo;s four biggest lots were cards; the modern rookie market, not vintage memorabilia, set the ceiling.</>,
      }}
      topSales={[
        { title: 'LeBron James — 2003-04 Upper Deck Exquisite Rookie Patch Autograph #78', priceUsd: 2_928_000, house: 'Goldin', date: '2026-06-29', maker: 'sports-cards' },
        { title: "Wayne Gretzky — final Edmonton Oilers jersey, 1988 Stanley Cup Final Game 4, photo-matched", priceUsd: 2_806_000, house: 'Goldin', date: '2026-04-26', maker: 'game-used' },
        { title: 'Shohei Ohtani — 2018 Topps Chrome 1/1 SuperFractor rookie card', priceUsd: 2_562_229, house: 'Goldin', date: '2026-06-29', maker: 'sports-cards' },
        { title: '1952 Topps #311 Mickey Mantle — PSA NM-MT 8', priceUsd: 1_830_000, house: 'Goldin', date: '2026-06-21', maker: 'sports-cards' },
        { title: 'Kobe Bryant / LeBron James / Stephen Curry / Luka Dončić — game-used group', priceUsd: 1_342_000, house: 'Goldin', date: '2026-06-29', maker: 'game-used' },
      ]}
      footnote="Sports runs on bid auctions with no published estimates, so there is no vs-estimate read here and our engine treats the card, game-used, ticket and trophy buckets as descriptive — we report volume, records and top sales, not an appreciation figure. Prices are final bid plus premium."
    >
      <H>The modern cards set the ceiling</H>
      <P>
        The top of the quarter was a card market, not a memorabilia one: a <B>$2.93M LeBron rookie
        patch auto</B>, a <B>$2.56M Ohtani 1/1 SuperFractor</B>, and a <B>$1.83M PSA-8 &rsquo;52
        Mantle</B> — three of the four biggest lots. The lone jersey in that group, Gretzky&rsquo;s
        photo-matched final Oilers shirt at $2.81M, is the exception that frames the rule: modern
        graded rookies now trade at the very top alongside the most storied vintage memorabilia.
      </P>
      <H>A retail-depth tape, almost all through one house</H>
      <P>
        Sports is the highest-volume market we cover — <B>19,296 lots</B> against a $551 median — and
        <B> Goldin ran 96% of the value</B>. That mix, a handful of seven-figure trophies over a very
        long tail of sub-$1,000 lots, is what the vertical is: broad retail participation punctuated
        by a few whales. It&rsquo;s also why the median stays low even in a $126M quarter.
      </P>
      <H>Reading it without estimates</H>
      <P>
        These are bid auctions — no house estimates exist, so our usual hammer-vs-estimate read
        doesn&rsquo;t apply, and we don&rsquo;t manufacture an appreciation number the data
        can&rsquo;t support. Instead lectr prices each live lot off its own realized comps (sport- and
        player-matched), which is why this vertical&rsquo;s &ldquo;lectr value&rdquo; bands matter
        more here than anywhere else: with no estimate in the catalogue, they&rsquo;re the only
        estimate in the room.
      </P>
    </QuarterInsight>
  );
}
