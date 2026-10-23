import type { Metadata } from 'next';
import JsonLd from '../../components/JsonLd';
import { postMeta, postLd } from '../posts';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';
import { PullQuote } from '../../components/blog/Editorial';

const POST = {
  title: 'Q3 2026 science market in review — one skeleton was the quarter',
  description: 'Gus, a 38-foot Tyrannosaurus, sold for $50.1M at Sotheby’s in July — about 80% of everything science cleared all quarter. The quarter with him and without him, demand read off the estimates (fossils and space hot, meteorites soft), and no fabricated returns.',
};
export const metadata: Metadata = postMeta('q3-2026-science', POST);

export default function Q3Science() {
  return (
    <>
      <JsonLd data={postLd('q3-2026-science', POST)} />
    <QuarterInsight
      market="science"
      quarter="Q3 2026"
      months="July–September"
      basis="sold"
      moversHeader="Demand vs estimate"
      date="October 22, 2026"
      title="Science in Q3: one skeleton was the quarter"
      dek="The summer sales Q2 was waiting for arrived, and one lot in them outweighed everything else combined: a $50.1M Tyrannosaurus. Here is the quarter with him and without him, where demand ran hot (fossils, space), where it went soft (meteorites), and what the comparison with last July can and can't tell you."
      stats={[
        { label: 'Gus, the T. rex', value: '$50.1M', sub: '80% of the quarter’s $62.6M' },
        { label: 'Science without him', value: '$12.5M', sub: 'median lot $3,296 either way' },
        { label: 'Fossils demand', value: '+79%', sub: 'median over estimate · 35 lots', tone: 'up' },
        { label: 'Meteorites demand', value: '−15%', sub: '14 of 47 offered went unsold', tone: 'down' },
      ]}
      headline={{
        image: '/blog/q3-2026-gus-trex.jpg',
        caption: 'Tyrannosaurus rex, “Gus” — Hell Creek Formation, South Dakota',
        priceUsd: 50_130_000,
        house: "Sotheby's",
        saleLine: 'July 14, 2026 · Natural History',
        para: <>Found in 2021 on a ranch in Harding County, South Dakota, Gus is a single specimen: about 38 feet long, 12½ feet tall, 183 bone elements plus 30 of the 32 belly ribs, with roughly 82% of the skull present. Sotheby&rsquo;s estimated him at $20&ndash;30 million and he sold for <B>$50.13 million</B> &mdash; about double the estimate midpoint, and the highest price yet paid for a dinosaur at auction. That one lot is 80% of every dollar in our Q3 science tape. It is the story of the quarter, and it is also a problem for reading the quarter, so the sections below show the market twice: with him, and with him taken out.</>,
      }}
      topSales={[
        { title: 'Tyrannosaurus rex, “Gus” — mounted skeleton, Hell Creek Formation', priceUsd: 50_130_000, house: "Sotheby's", date: '2026-07-14', maker: 'fossils' },
        { title: 'Tyrannosaurus rex leg', priceUsd: 1_792_000, house: "Sotheby's", date: '2026-07-14', maker: 'fossils' },
        { title: 'Allosaurus jaws with teeth — skull display', priceUsd: 1_536_000, house: "Sotheby's", date: '2026-07-14', maker: 'fossils' },
        { title: 'Gryposaurus', priceUsd: 1_280_000, house: "Sotheby's", date: '2026-07-14', maker: 'fossils' },
        { title: 'Apollo 11 — Duro felt-tip pen and Engine Arm circuit-breaker switch, flown to the lunar surface', priceUsd: 857_600, house: "Sotheby's", date: '2026-07-15', maker: 'space-exploration' },
        { title: 'Fossil sea lilies — Jurassic display', priceUsd: 640_000, house: "Sotheby's", date: '2026-07-14', maker: 'fossils' },
        { title: 'Apple-1 computer — the “Neumark” Apple-1 in a Smith-Corona typewriter case', priceUsd: 499_363, house: 'RR Auction', date: '2026-08-20', maker: 'science-tech' },
        { title: 'Apple-1 computer', priceUsd: 409_600, house: "Sotheby's", date: '2026-07-15', maker: 'scientific-instruments' },
        { title: 'Seymchan meteorite — monolithic centerpiece', priceUsd: 256_000, house: "Sotheby's", date: '2026-07-14', maker: 'meteorites' },
        { title: 'Fossil palm frond', priceUsd: 217_600, house: "Sotheby's", date: '2026-07-14', maker: 'fossils' },
      ]}
      movers={[
        { label: 'Fossils & Dinosaurs', chgPct: 79, n: 35, slug: 'fossils' },
        { label: 'Space Exploration', chgPct: 50, n: 126, slug: 'space-exploration' },
        { label: 'Scientific Instruments', chgPct: 83, n: 11, slug: 'scientific-instruments' },
      ]}
      coolers={[
        { label: 'Meteorites', chgPct: -15, n: 34, slug: 'meteorites' },
      ]}
      footnote="Movers are the median sold price over the estimate midpoint per collection, not a price change; Scientific Instruments (11 lots) is a small sample. RR Auction publishes a single estimate figure rather than a range, so its lots are read against that one number, which tends to flatter them; Goldin publishes no estimates, so its 56 lots carry no demand read. Sell-through is computed only at Sotheby's, the one house in this tape that records unsold lots (153 sold of 183 resolved, 84%); RR Auction and Goldin record only sales, and last year's Sotheby's lots were captured sold-only, so there is no like-for-like sell-through against Q3 2025. Hygiene: we removed lots routed into science by a keyword: a Horatio Nelson letter ($6,744) and an 'Untitled (Astronauts)' artwork ($1,536) this quarter, and an Arnaldo Pomodoro sculpture ($69,850) from the Q3 2025 comparison. Our engine publishes no appreciation figure for these collections, and this note makes none."
    >
      <H>One skeleton was the quarter</H>
      <P lede>
        Q2&rsquo;s note said the big science sales land in the summer. They did. Sotheby&rsquo;s held
        Natural History on July 14, Space Exploration on July 15 and History of Science &amp;
        Technology the same day, and RR Auction ran a 122-lot Apple 50th-anniversary sale on August
        20. Together the tape came to <B>$62.6 million across 423 sold lots</B>. Of that, $50.13
        million is one lot: Gus. The rest of the Natural History sale added $7.3 million, which
        means the July 14 room accounted for $57.5 million, or about 92% of the quarter. There was
        one big night in science this quarter, and nearly all the money came from a single bid
        within it.
      </P>
      <H>The quarter without him</H>
      <P>
        Take Gus out and science cleared <B>$12.5 million</B>. The median lot hardly moves: $3,296
        without him against $3,336 with him, because the median is set by the hundreds of signed
        NASA photographs, Edison letters and sealed iPhones that make up the body of the tape, not
        by its peak. The demand read doesn&rsquo;t move either. Across the 366 sold lots with an
        estimate, the median sold at about <B>1.46 times its estimate midpoint</B> with or without
        the T. rex, and 72% finished above the high estimate. The rest of the fossil room was strong
        in its own right: a T. rex leg at $1.79 million, Allosaurus jaws at $1.54 million, a
        Gryposaurus at $1.28 million, and decorative pieces that ran past their estimates, such as
        fossil sea lilies at <B>$640,000 on a $30,000&ndash;50,000 estimate</B> and a megalodon
        tooth at $48,640 on $3,000&ndash;5,000. It was not all clean, though. A baby dinosaur nest
        estimated at $800,000&ndash;1.2 million went unsold, as did a T. rex claw and a Camarasaurus
        jaw. Six of the 41 fossil lots offered did not sell.
      </P>
      {/* the pull — lifted verbatim from the paragraph above */}
      <PullQuote>The median is set by the hundreds of signed NASA photographs, Edison letters and sealed iPhones that make up the body of the tape, not by its peak.</PullQuote>
      <H>What demand says, since price can&rsquo;t</H>
      <P>
        These collections are buckets of different objects, not repeat sales of the same thing, so
        our engine won&rsquo;t publish an appreciation figure for them, and we don&rsquo;t either.
        What we can read is where lots settled against the auctioneer&rsquo;s number.
        <B> Fossils at +79%</B> over estimate (35 lots, all at Sotheby&rsquo;s) is the hottest read
        in the vertical. <B>Space ran +50%</B> across 126 lots, and the like-for-like version is
        sharper: Sotheby&rsquo;s space lots, nearly all from its July space sale, settled a median
        <B>+78% over estimate this year against +4% last July</B>, on almost the same number of sold lots (74 against 76).
        Scientific instruments read +83%, but on 11 lots, so treat that as a small sample.
        <B> Meteorites are the soft spot at −15%</B>. Only 8 of 34 sold lots beat the high
        estimate, 15 settled below the low, and 14 of the 47 meteorites offered in the Natural
        History sale went unsold, including a Brenham and a Gibeon each estimated at $40,000&ndash;60,000.
        The meteorite market has real buyers. The Seymchan centerpiece made $256,000, more than
        double its estimate. They are selective, though, and a sale that offers more meteorites than
        it has buyers for shows it.
      </P>
      <H>Against last July</H>
      <P>
        The headline totals don&rsquo;t compare. Q3 2025 cleared $4.1 million in our coverage, but
        last July&rsquo;s tape has no Natural History sale in it at all, so $62.6 million against
        $4.1 million mostly measures a sale entering coverage, not a market growing fifteen-fold.
        Matched sale by sale, the picture is calmer. Sotheby&rsquo;s July space sale made
        <B> $2.20 million against $1.81 million</B>, and its History of Science &amp; Technology sale
        made $716,000 against $660,000. RR Auction&rsquo;s August Apple sale grew the most, from
        $454,000 to <B>$1.69 million</B>, but it was an anniversary sale with a deeper and better
        catalogue (an Apple-1, a Lisa, Jobs-signed 1976 company checks), so treat it as a bigger
        offering, not a hotter market. Leave out the Natural History sale and the quarter cleared
        about $5.1 million against $4.1 million, with the median lot at $3,336 against $1,669. On
        today&rsquo;s corpus, the quarter before (Q2 2026) cleared $2.7 million across 546 lots
        with a $963 median, which is what science looks like between its seasons.
      </P>
      <H>Space, up close</H>
      <P>
        The top space lot was two small things with a famous job. During Apollo 11 the Engine Arm
        circuit breaker on the lunar module&rsquo;s panel snapped off, and Buzz Aldrin pushed the
        breaker in with a felt-tip pen so the ascent engine could fire. That switch head and a Duro
        &ldquo;Rocket&rdquo; pen, both flown to and used on the lunar surface and sold with an
        Aldrin provenance letter, made <B>$857,600</B> on an $800,000&ndash;1.2 million estimate.
        That is inside the range, not over it. The heat was further down the sale, where Aldrin-signed
        objects kept running away from modest estimates. A flown Soviet flag he inscribed brought
        $102,400 on $7,000&ndash;10,000, and a signed Tranquility Base photograph brought $64,000 on
        $4,000&ndash;6,000. A Skylab command-module pressure hatch brought $192,000, and the
        sale sold 75 of the 85 lots whose result we have.
      </P>
      <H>A note on the two Apple-1s</H>
      <P>
        Two Apple-1 computers sold this quarter: the &ldquo;Neumark&rdquo; machine in a
        Smith-Corona typewriter case at <B>$499,363</B> (RR Auction) and another at $409,600
        (Sotheby&rsquo;s). It is tempting to set these against the $571,500 and $475,000 Apple-1s
        of Q3 2025 and draw a line, and that is exactly the appreciation claim we won&rsquo;t make.
        These are different machines with different cases, documentation and histories, and four
        sales of four different objects are not a price series. What the Apple tape does show is
        depth: 122 lots in RR&rsquo;s anniversary sale, from that Apple-1 down to sealed
        first-generation iPhones and a signed business card graded GEM MT 10 at $156,658. That is
        the science-and-technology collection at its broadest, and it&rsquo;s why its +49% demand
        read, set against RR&rsquo;s single-figure estimates, is better taken as &ldquo;sold
        well&rdquo; than as a measured premium.
      </P>
    </QuarterInsight>
    </>
  );
}
