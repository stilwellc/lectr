import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';

export const metadata: Metadata = {
  title: 'Q2 2026 sports market in review — game-used memorabilia doubled',
  description: 'A $1.34M four-player jersey lot on top, Messi debut shirts, and a game-used median up 154%. The Q2 2026 sports memorabilia numbers.',
};

export default function Q2Sports() {
  return (
    <QuarterInsight
      market="sports"
      date="July 16, 2026"
      title="Sports in Q2: game-used doubled"
      dek="The bid-driven memorabilia market ran hot from the floor up: the typical game-used sale more than doubled year over year, provenance did the heavy lifting, and one four-player NBA jersey lot cleared seven figures."
      stats={[
        { label: 'Total realized', value: '$4.7M', sub: '629 lots sold' },
        { label: 'Median sale', value: '$793', sub: '+73% vs Q2 2025', tone: 'up' },
        { label: 'Game-used median', value: '+154%', sub: 'vs Q2 2025 · 275 sales', tone: 'up' },
        { label: 'Basis', value: 'Bid sales', sub: 'no estimates published' },
      ]}
      headline={{
        image: 'https://d2tt46f3mh26nl.cloudfront.net/public/Lots/202605-1915-2628-8b9d16a0-a668-42d2-b387-b0f4f5068910/700e6d0d-1f0c-4ffc-a621-e28b4b6a4c8b@1x',
        caption: 'Kobe Bryant / LeBron James / Stephen Curry / Luka Dončić — game-used group',
        priceUsd: 1_342_000,
        house: 'Goldin',
        saleLine: 'June 29, 2026',
        para: <>Four eras of the NBA in one lot: game-used material spanning Kobe, LeBron, Curry and Dončić, sold as a single group for $1,342,000 — more than a quarter of the entire sports market&rsquo;s Q2 value in one bid. It&rsquo;s also a snapshot of how this market now prices: not by player nostalgia but by documented, photo-matched game use, bundled into generational narratives that trade like portfolios.</>,
      }}
      topSales={[
        { title: 'Kobe Bryant / LeBron James / Stephen Curry / Luka Dončić — game-used group', priceUsd: 1_342_000, house: 'Goldin', date: '2026-06-29', maker: 'game-used' },
        { title: 'LeBron James — 17 game-used, photo-matched Cavaliers items', priceUsd: 207_400, house: 'Goldin', date: '2026-06-29', maker: 'game-used' },
        { title: 'Lionel Messi — FC Barcelona first-team professional debut shirt', priceUsd: 201_300, house: 'Goldin', date: '2026-06-14', maker: 'game-used' },
        { title: 'Lionel Messi — Champions League debut, first full match shirt', priceUsd: 134_200, house: 'Goldin', date: '2026-06-14', maker: 'game-used' },
        { title: 'Aaron Judge — 51st HR of the AL-record 62-HR season, game-used', priceUsd: 111_020, house: 'Goldin', date: '2026-06-29', maker: 'game-used' },
      ]}
      movers={[
        { label: 'Game-used memorabilia', chgPct: 154, n: 275 },
        { label: 'Trophies & awards', chgPct: 54, n: 18 },
        { label: 'Tickets & passes', chgPct: 47, n: 336 },
      ]}
      footnote="Sports runs on bid auctions with no published estimates, so there is no vs-estimate read here; prices are final bid plus premium."
    >
      <H>Provenance is the product</H>
      <P>
        Every one of the quarter&rsquo;s top results is a provenance story: photo-matched jerseys,
        career-debut shirts, a record-season home run. The headline — a <B>$1.34M</B> group of
        game-used jerseys spanning Kobe Bryant, LeBron James, Stephen Curry and Luka Dončić —
        and the pair of <B>Messi debut shirts</B> ($201K and $134K) all trade on documentation,
        not memorabilia-shop nostalgia. The market pays for the chain of custody.
      </P>
      <H>The floor rose everywhere</H>
      <P>
        This wasn&rsquo;t just a trophy-lot quarter. The <em>typical</em> sale rose 73% year over
        year, and every category we track moved the same direction: game-used +154% (275 sales),
        trophies &amp; awards +54%, tickets &amp; passes +47% on 336 sales. When the $500 lot and
        the $500,000 lot inflate together, that&rsquo;s broad participation — new bidders at the
        entry level, not just two whales at the top.
      </P>
      <H>Reading it without estimates</H>
      <P>
        These are bid auctions — no house estimates exist, so our usual hammer-vs-estimate read
        doesn&rsquo;t apply. Instead lectr prices each live lot off its own realized comps
        (sport- and player-matched), which is also why this vertical&rsquo;s &ldquo;lectr
        value&rdquo; bands matter more here than anywhere else: they&rsquo;re the only estimate
        in the room.
      </P>
    </QuarterInsight>
  );
}
