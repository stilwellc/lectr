import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';

export const metadata: Metadata = {
  title: 'Q2 2026 sports market in review — a $126M quarter led by the cards',
  description: 'A $2.93M LeBron rookie patch auto on top, a $2.81M Gretzky jersey behind it, and 19,000-plus lots through Goldin. The Q2 2026 sports market, reported as the descriptive tape it is: cards set the ceiling, game-used held the marquee, and we read it by volume and record — not a manufactured return.',
};

export default function Q2Sports() {
  return (
    <QuarterInsight
      market="sports"
      date="July 16, 2026"
      title="Sports in Q2: the cards led a $126M quarter"
      dek="The highest-volume market we track by a wide margin: 19,296 lots for $126M, nearly all of it through Goldin. Modern rookie cards set the ceiling, game-used memorabilia held the marquee, and — because these are bid sales with no published estimates — we report it descriptively, by volume and record, not as a return."
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
        para: <>The card that defined a generation of the hobby: LeBron&rsquo;s 2003-04 Upper Deck Exquisite Rookie Patch Autograph, the piece every modern RPA is measured against. It brought $2,928,000 at Goldin&rsquo;s June sale — the top sports result of the quarter, edging out a $2.81M Wayne Gretzky final-Oilers jersey and a $2.56M Shohei Ohtani 1/1 SuperFractor. Three of the quarter&rsquo;s four biggest lots were cards; the modern rookie market, not vintage memorabilia, set the ceiling. It is also the standing record for the entire sports-cards collection we track — the ceiling of a 290,000-lot corpus rests on a single 2003 card.</>,
      }}
      topSales={[
        { title: 'LeBron James — 2003-04 Upper Deck Exquisite Rookie Patch Autograph #78', priceUsd: 2_928_000, house: 'Goldin', date: '2026-06-29', maker: 'sports-cards' },
        { title: "Wayne Gretzky — final Edmonton Oilers jersey, 1988 Stanley Cup Final Game 4, photo-matched", priceUsd: 2_806_000, house: 'Goldin', date: '2026-04-26', maker: 'game-used' },
        { title: 'Shohei Ohtani — 2018 Topps Chrome 1/1 SuperFractor rookie card', priceUsd: 2_562_229, house: 'Goldin', date: '2026-06-29', maker: 'sports-cards' },
        { title: '1952 Topps #311 Mickey Mantle — PSA NM-MT 8', priceUsd: 1_830_000, house: 'Goldin', date: '2026-06-21', maker: 'sports-cards' },
        { title: 'Kobe Bryant / LeBron James / Stephen Curry / Luka Dončić — game-used group', priceUsd: 1_342_000, house: 'Goldin', date: '2026-06-29', maker: 'game-used' },
        { title: 'Shai Gilgeous-Alexander — 2026 Topps Chrome Gold Logoman autograph relic #GLM-1', priceUsd: 1_061_400, house: 'Goldin', date: '2026-06-07', maker: 'sports-cards' },
        { title: '2016 Panini Immaculate Collection Logoman rookie patch autograph', priceUsd: 1_012_600, house: 'Goldin', date: '2026-05-10', maker: 'sports-cards' },
        { title: '1958 Alifabolaget #635 Pelé rookie card — PSA MINT 9 (Pop 6)', priceUsd: 976_000, house: 'Goldin', date: '2026-06-14', maker: 'sports-cards' },
        { title: '2003-04 Upper Deck SP Authentic Triple Signatures — LeBron / Jordan / Bird', priceUsd: 762_500, house: 'Goldin', date: '2026-05-10', maker: 'sports-cards' },
        { title: '2010 Panini National Treasures rookie patch autograph #206', priceUsd: 622_200, house: 'Goldin', date: '2026-04-12', maker: 'sports-cards' },
      ]}
      footnote="Sports runs on bid auctions with no published estimates, so there is no vs-estimate read here and our engine treats the card, game-used, ticket, trophy and memorabilia buckets as descriptive — we report volume, records and top sales, not an appreciation figure. The typical (median) lot prices cited per collection are the honest read where no estimate exists to hammer against. Prices are final bid plus premium."
    >
      <H>The modern cards set the ceiling</H>
      <P>
        The top of the quarter was a card market, not a memorabilia one: a <B>$2.93M LeBron rookie
        patch auto</B>, a <B>$2.56M Ohtani 1/1 SuperFractor</B>, and a <B>$1.83M PSA-8 &rsquo;52
        Mantle</B> — three of the four biggest lots. The lone jersey in that group, Gretzky&rsquo;s
        photo-matched final Oilers shirt at $2.81M, is the exception that frames the rule: modern
        graded rookies now trade at the very top alongside the most storied vintage memorabilia.
      </P>
      <P>
        Read the rest of the top ten and the pattern only hardens. Below the four marquee lots sits a
        second tier that is almost entirely cardboard: a <B>$1.06M Shai Gilgeous-Alexander Gold
        Logoman</B> and a <B>$1.01M Panini Immaculate Logoman</B> — both one-of-one patch autos struck
        from the actual jersey logo, the format the modern hobby now prizes above raw scarcity — then a
        <B> $976K Pelé 1958 rookie in PSA 9</B> (population six), a $762.5K LeBron/Jordan/Bird triple
        auto, and a $622K National Treasures RPA. Nine of the quarter&rsquo;s ten biggest lots were
        cards. The one that wasn&rsquo;t, Gretzky&rsquo;s jersey, is the marquee game-used piece of the
        year — and it still couldn&rsquo;t hold the top spot.
      </P>
      <P>
        Three currents run under those numbers. The first is the <B>rookie patch auto</B> — a rookie
        card carrying both an on-card signature and a swatch of game-worn material — which is now the
        blue-chip form factor across sports; the LeBron, the SGA, the Immaculate and the National
        Treasures lots are all RPAs. The second is the <B>1/1 SuperFractor</B>, the single serial-1
        parallel of a modern flagship set, where Ohtani&rsquo;s 2018 Topps Chrome carried a
        seven-figure result on pure &ldquo;only one exists&rdquo; scarcity. The third is <B>graded
        vintage</B> holding its floor: the &rsquo;52 Mantle traded twice in the quarter — the PSA 8 at
        $1.83M and an SGC 7 at $580K — a clean, legible grade-to-price ladder that vintage still offers
        and raw modern cards can&rsquo;t.
      </P>
      <H>The marquee is still game-used</H>
      <P>
        Cards set the ceiling, but the single most storied object of the quarter was worn, not printed.
        Gretzky&rsquo;s <B>final Edmonton Oilers jersey — Game 4 of the 1988 Stanley Cup Final, photo-
        matched</B> — brought $2.81M, and the $1.34M Kobe/LeBron/Curry/Dončić game-used group put a
        second seven-figure worn lot in the top five. That is the shape of the game-used collection: a
        smaller, thicker market than cards, with a <B>$1,280 typical lot</B> against a standing record
        of <B>$10.09M</B> (Jordan&rsquo;s 1998 &ldquo;Last Dance&rdquo; Finals jersey). Photo-matching —
        forensically tying a specific garment to a specific frame of a specific game — is what
        separates a $1,280 jersey from a $2.8M one, and it is the discipline the top of this collection
        now runs on.
      </P>
      <H>The sub-markets, read descriptively</H>
      <P>
        Because sports clears on bid with no estimates, we don&rsquo;t report each collection as a
        percentage over some catalogue number — there isn&rsquo;t one. We report what it <B>is</B>:
        typical price, standing record, and depth. <B>Sports cards</B> are the engine — a $338 typical
        lot, but the deepest tape we track at roughly 290,000 lots all-time, and the collection that
        holds the quarter&rsquo;s ceiling. <B>Game-used</B> is the marquee — $1,280 typical, a $10.09M
        record. <B>Tickets &amp; passes</B> ($360 typical, record $1.2M on the Brady 2000 Contenders
        Championship Ticket) and <B>trophies &amp; awards</B> ($337 typical, a $3.54M record) are the
        specialist corners. And <B>sports memorabilia</B> — the catch-all of autographs, photos,
        equipment and pennants — is the retail floor at a $256 typical lot. None of these carries an
        appreciation figure, and we won&rsquo;t invent one.
      </P>
      <H>A retail-depth tape, almost all through one house</H>
      <P>
        Sports is the highest-volume market we cover — <B>19,296 lots</B> against a $551 median — and
        <B> Goldin ran roughly 96% of the value</B>. That single-house concentration is the market&rsquo;s
        defining structural fact: unlike art or watches, where value is spread across Christie&rsquo;s,
        Sotheby&rsquo;s and a dozen specialists, sports flows through one weekly-auction platform that has
        become the price-discovery venue for the entire hobby. The mix — a handful of seven-figure cards
        and jerseys over a very long tail of sub-$1,000 lots — is what the vertical is: broad retail
        participation punctuated by a few whales. It&rsquo;s also why the median stays at $551 even in a
        $126M quarter, and why one platform&rsquo;s calendar effectively sets the tape.
      </P>
      <H>Reading it without estimates</H>
      <P>
        These are bid auctions — no house estimates exist, so our usual hammer-vs-estimate read
        doesn&rsquo;t apply, and we don&rsquo;t manufacture an appreciation number the data
        can&rsquo;t support. Instead lectr prices each live lot off its own realized comps (sport-,
        player- and grade-matched), which is why this vertical&rsquo;s &ldquo;lectr value&rdquo; bands
        matter more here than anywhere else: with no estimate in the catalogue, they&rsquo;re the only
        estimate in the room. On a $126M quarter carried by one house, an independent, comps-driven read
        is not a nicety — it&rsquo;s the check.
      </P>
    </QuarterInsight>
  );
}
