import type { Metadata } from 'next';
import JsonLd from '../../components/JsonLd';
import { postMeta, postLd } from '../posts';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';
import { PullQuote } from '../../components/blog/Editorial';

const POST = {
  title: 'Q3 2026 sports market in review — Pelé’s World Cup shirt tops a $195M quarter',
  description: 'A $4.88M Pelé 1958 World Cup final shirt on top, two Ohtani cards behind it, and 31,840 lots across eleven houses. The Q3 2026 sports market, read as the descriptive tape it is: a World Cup summer, a Sotheby’s marquee, a Goldin floor — by volume and record, not a manufactured return.',
};
export const metadata: Metadata = postMeta('q3-2026-sports', POST);

export default function Q3Sports() {
  return (
    <>
      <JsonLd data={postLd('q3-2026-sports', POST)} />
    <QuarterInsight
      market="sports"
      quarter="Q3 2026"
      months="July–September"
      basis="sold"
      date="October 22, 2026"
      title="Sports in Q3: Pelé’s World Cup shirt tops a $195M quarter"
      dek="31,840 lots for $195.5M. A World Cup summer put soccer at the top, Ohtani took two of the three biggest lots, and because these are bid sales we report it by volume and record, not as a return."
      stats={[
        { label: 'Total realized', value: '$195.5M', sub: '31,840 lots sold' },
        { label: 'Median sale', value: '$620', sub: '$397 in Q3 2025' },
        { label: 'Top lot', value: '$4.88M', sub: 'Pelé 1958 World Cup final shirt' },
        { label: 'Basis', value: 'Bid sales', sub: 'few estimates published' },
      ]}
      headline={{
        image: '/blog/q3-2026-pele-shirt.jpg',
        caption: 'Pelé — 1958 FIFA World Cup Final match-worn shirt, Brazil v Sweden',
        priceUsd: 4_880_000,
        house: "Sotheby's",
        saleLine: 'The Beautiful Game · July 16, 2026',
        para: <>The shirt a seventeen-year-old Pelé wore in the 1958 World Cup final in Solna, outside Stockholm, where Brazil beat the hosts Sweden 5&ndash;2 for the country&rsquo;s first world title and Pelé scored twice. It is the blue change shirt with the sewn CBD crest — Sweden had the yellow — and it is the object that turned a teenager into the game&rsquo;s first global star. It brought $4,880,000 at Sotheby&rsquo;s &ldquo;The Beautiful Game&rdquo; sale on July 16, days before the 2026 World Cup final, and it was the top sports result of the quarter by nearly two million dollars. For scale, the soccer benchmark remains Maradona&rsquo;s &ldquo;Hand of God&rdquo; shirt (£7.1M at Sotheby&rsquo;s in 2022); the same July sale also placed a Maradona 1986 World Cup captain&rsquo;s armband at $512K.</>,
      }}
      topSales={[
        { title: 'Pelé — 1958 FIFA World Cup Final match-worn shirt, two goals, Brazil’s first title', priceUsd: 4_880_000, house: "Sotheby's", date: '2026-07-16', maker: 'game-used' },
        { title: 'Shohei Ohtani — 2026 Topps Chrome Gold MLB Logoman Autograph Relic (#1/1), unused redemption', priceUsd: 2_848_700, house: 'Goldin', date: '2026-09-26', maker: 'sports-cards' },
        { title: 'Shohei Ohtani — 2018 Bowman Chrome Rookie Autograph Red Refractor (#2/5) — BGS 9.5', priceUsd: 2_440_000, house: 'Goldin', date: '2026-09-19', maker: 'sports-cards' },
        { title: 'Aaron Judge — 2016 New York Yankees “Rookie Debut” Game-Worn Jersey, First Career Home Run', priceUsd: 1_792_000, house: "Sotheby's", date: '2026-07-20', maker: 'game-used' },
        { title: 'Chicago Bulls — 1996, 1997 and 1998 NBA Finals United Center Floor Sections, Signed by Jordan and Pippen', priceUsd: 1_792_000, house: "Sotheby's", date: '2026-07-20', maker: 'game-used' },
        { title: 'Kobe Bryant — 2009 NBA Finals Game 1 Los Angeles Lakers Game-Worn Jersey, 40 Points', priceUsd: 1_664_000, house: "Sotheby's", date: '2026-07-20', maker: 'game-used' },
        { title: 'Michael Jordan — 2003-04 Upper Deck Exquisite Number Pieces Patch Autograph (#14/23)', priceUsd: 1_464_000, house: 'Goldin', date: '2026-09-19', maker: 'sports-cards' },
        { title: '1909-11 T206 Honus Wagner — CGC Authentic Restored', priceUsd: 1_337_263, house: 'Love of the Game', date: '2026-08-08', maker: 'graded-cards' },
        { title: 'Macklin Celebrini — 2024-25 Upper Deck Young Guns Outburst Gold Rookie (#1/1)', priceUsd: 1_281_000, house: 'Goldin', date: '2026-08-15', maker: 'sports-cards' },
        { title: '1952 Topps Unopened Five-Cent Wax Pack “Brick” (8 packs), 1990s Seattle Find', priceUsd: 1_107_000, house: 'REA', date: '2026-08-16', maker: 'unopened-wax' },
      ]}
      footnote="Sports runs on bid auctions, and only about one lot in a hundred carried a published estimate this quarter, so there is no vs-estimate read here and our engine treats the card, game-used, wax, ticket, trophy and memorabilia buckets as descriptive — we report volume, records and top sales, not an appreciation figure. Year-on-year comparisons are against Q3 2025 on the same method, but our house coverage has grown since (Lelands and MLB Auctions are new, Memory Lane and Love of the Game are far deeper), so part of the growth is coverage. Player and soccer totals are title-matched. A $713,700 One Piece trophy card filed under sports trophies is a trading-card-game lot and is left out of the table. Prices are the published sold price (at Goldin, final bid plus premium)."
    >
      <H>A World Cup summer at the top</H>
      <P lede>
        The quarter&rsquo;s ceiling was set by soccer, in the summer the World Cup came to North
        America. Pelé&rsquo;s <B>$4.88M 1958 final shirt</B> led the market outright, and the soccer
        lots underneath it filled out the tape: a <B>$707.6K Lamine Yamal Donruss Kaboom! Black
        1/1</B> and a <B>$702.9K Yamal 2026 Prizm World Cup Black 1/1</B>, a $695.4K Ronaldo/Messi Gold
        Power Prizm, a $671K Pelé 1958 Aquarela rookie in PSA 8, a $610K Pelé Americana Balas rookie in
        PSA 2, and Maradona&rsquo;s $512K armband. Title-matched, soccer ran to <B>about 2,560 lots and
        $28.1M</B> — against roughly 1,000 lots and $5.9M a year earlier.
      </P>
      <P>
        The rest of the top ten split cleanly between two sources. Sotheby&rsquo;s July sales supplied
        the worn objects — Judge&rsquo;s 2016 rookie-debut jersey and the Bulls&rsquo; three-Finals
        United Center floor sections at <B>$1.79M each</B>, and Kobe&rsquo;s 40-point 2009 Finals Game 1
        jersey at <B>$1.66M</B>. Goldin&rsquo;s Elite sales supplied the cardboard — the two Ohtanis, a
        <B> $1.46M Jordan Exquisite Number Pieces</B> patch auto, and a <B>$1.28M Macklin Celebrini
        Young Guns 1/1</B>, a one-of-one rookie of the 2024 NHL draft&rsquo;s first overall pick.
        Two lots came from the specialists: Love of the Game&rsquo;s <B>$1.34M restored T206
        Wagner</B>, and REA&rsquo;s <B>$1.11M brick of eight 1952 Topps wax packs</B>. Thirteen lots
        cleared a million dollars; in Q3 2025 none did.
      </P>
      {/* the pull — lifted verbatim from the second paragraph above */}
      <PullQuote>Thirteen lots cleared a million dollars; in Q3 2025 none did.</PullQuote>
      <H>Ohtani, again</H>
      <P>
        Two of the quarter&rsquo;s three biggest lots were Shohei Ohtani cards: a <B>$2.85M 2026 Topps
        Chrome Gold Logoman 1/1</B> — sold as an unused redemption, so the buyer paid for a card still
        to be made from a patch Ohtani wore — and a <B>$2.44M 2018 Bowman Chrome Red Refractor rookie
        auto</B> numbered 2/5 in BGS 9.5. The same Bowman rookie auto traded down its parallel ladder
        in the same month, from Gold ($341.6K) to Green ($231.8K) to Blue ($172K) to the base auto in
        the tens of thousands — a clean read of how scarcity, not the card, sets the price. Title-matched,
        Ohtani lots totalled <B>$20.0M across 850 sales</B>, about a tenth of the whole quarter, against
        $3.9M across 458 a year earlier. No single player runs the board the way he now does.
      </P>
      <H>The sub-markets, read descriptively</H>
      <P>
        With almost no estimates in the room, we report what each collection <B>is</B>: typical price
        and depth. <B>Sports cards</B> are the engine — 13,294 lots, $111.1M and a $738 typical lot,
        with <B>graded cards</B> adding 7,997 more at a $707 median. <B>Game-used</B> is the marquee:
        2,655 lots, $34.6M, an $820 typical lot, and four of the top six results. <B>Unopened wax</B>
        brought $8.5M on 1,345 lots ($810 typical), <B>autographs</B> $6.2M on 3,207 ($360), and
        <B>trophies &amp; awards</B> $3.4M on 243 at a $1,920 typical lot — the highest median of any
        sports collection. Tickets, programs, Type 1 photos and memorabilia make up the retail floor at
        $250 to $550 a lot. Every one of those medians but Type 1 photos sits above its Q3 2025 level,
        but none of them is an appreciation figure: the mix of what came to sale changed, and we won&rsquo;t present a
        typical price as a return.
      </P>
      <H>Goldin is the floor; the marquee moved</H>
      <P>
        Goldin ran <B>18,566 lots and 66.5% of the value</B>, down from about 77% of Q2 on the same
        corpus — not because Goldin shrank ($129.9M, up from $120.2M) but because Sotheby&rsquo;s
        stepped in. Its July calendar — the Summer Sports Classic, the World Cup sale and the NBA
        Finals series — put <B>$25.3M through just 301 lots</B>, a $12,300 typical lot, 12.9% of the
        quarter. REA&rsquo;s Summer sale (8.2%), Memory Lane, Love of the Game, Lelands, Huggins &amp;
        Scott and SCP make up most of the rest. The shape is a marquee house selling a few hundred
        storied objects over one platform&rsquo;s weekly tape of tens of thousands of cards.
      </P>
      <P>
        Against Q3 2025 the headline is $195.5M against $92.9M and a $620 median against $397 — but
        read that with care. Our coverage is wider this year, and Goldin held more Elite and Thematic
        sales in this July than we have for last. The cleanest like-for-like line is the Goldin Weekly
        floor, same platform and same format both years: <B>12,441 lots for $17.3M at a $282 median</B>,
        against 11,169 lots for $8.3M at $187 in Q3 2025. Against Q2 2026 on today&rsquo;s corpus, the
        quarter ran slightly fewer lots (31,840 against 33,174) for more money ($195.5M against
        $156.9M), at a higher median ($620 against $492).
      </P>
      <H>Reading it without estimates</H>
      <P>
        These are bid auctions, and the few estimates that exist sit entirely on Sotheby&rsquo;s
        and RR Auction lots — the Judge jersey, catalogued at $3–5M, sold for $1.79M, while
        the Bulls floor sections more than cleared their $0.8–1.2M range. That is too thin and too
        lopsided a sample to call a market read, so we don&rsquo;t. Instead lectr prices each live lot
        off its own realized comps (sport-, player- and grade-matched), which is why this vertical&rsquo;s
        &ldquo;lectr value&rdquo; bands matter more here than anywhere else: with no estimate in the
        catalogue, they&rsquo;re the only estimate in the room. On a $195M quarter carried by one
        platform and lifted by one house&rsquo;s July, an independent, comps-driven read is the check.
      </P>
    </QuarterInsight>
    </>
  );
}
