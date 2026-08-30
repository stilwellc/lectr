import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';
import { PullQuote } from '../../components/blog/Editorial';

export const metadata: Metadata = {
  title: 'Q2 2026 science market in review — instruments and space, between the seasons',
  description: 'A pair of George IV globes on top of the cleaned instrument tape, an Aldrin-shot Apollo 11 photograph leading the space lots, and demand — not a fabricated return — doing the talking. Space and fossils run hot, meteorites soft. Science’s Q2, honestly reported off a de-polluted tape.',
};

export default function Q2Science() {
  return (
    <QuarterInsight
      market="science"
      date="July 16, 2026"
      title="Science in Q2: instruments and space, between the seasons"
      dek="Science trades in curated seasonal sales, and Q2 fell between the big ones. What did clear — antique globes, vintage NASA photographs — plus where demand actually sits: space and fossils running hot, meteorites soft. And a word on the tape itself: we cleaned it before we read it."
      stats={[
        { label: 'Space & fossils demand', value: '+23–25%', sub: 'median over estimate', tone: 'up' },
        { label: 'Meteorites demand', value: '−32%', sub: 'the quarter’s soft spot', tone: 'down' },
        { label: 'Instruments demand', value: '+2%', sub: 'roughly at estimate' },
        { label: 'Top clean lot', value: '$38.4K', sub: 'pair of George IV globes' },
      ]}
      headline={{
        image: 'https://d2tt46f3mh26nl.cloudfront.net/public/Lots/202602-0514-5819-e0456ff9-b1c4-4f4f-98bb-1bcf5f9254ee/SF00002634015copy__496bbefb-821d-4844-8756-87738a0f0b24@1x',
        caption: 'Buzz Aldrin on the lunar surface — Type I photograph by Neil Armstrong',
        priceUsd: 18_910,
        house: 'Goldin',
        saleLine: 'April 5, 2026',
        para: <>July 20, 1969: Neil Armstrong points the Hasselblad at Buzz Aldrin and takes the most famous portrait ever made off-planet — visor reflecting the photographer, the LM, and most of human ambition. This Type I print (made from the original film within about a year of the mission) led science&rsquo;s quiet quarter for space material at $18,910. Nearly every image of the first landing shows Aldrin, for a reason collectors love: Armstrong held the camera. Goldin&rsquo;s April sale ran a whole run of these first-generation prints — the companion NASA Type I of the landing itself brought $15,860, and a 1972 &ldquo;Blue Marble&rdquo; Type I $4,270 — a rare stretch of genuinely space-historical material in a quarter otherwise thin on it.</>,
      }}
      topSales={[
        { title: 'A pair of George IV 18-inch terrestrial & celestial library globes, John Smith', priceUsd: 38_400, house: "Sotheby's", date: '2026-04-14', maker: 'scientific-instruments' },
        { title: 'A pair of George I nine-inch terrestrial & celestial table globes, John Senex', priceUsd: 35_840, house: "Sotheby's", date: '2026-04-14', maker: 'scientific-instruments' },
        { title: 'Buzz Aldrin, Apollo 11 — Type I original photograph by Neil Armstrong (Jul. 20, 1969)', priceUsd: 18_910, house: 'Goldin', date: '2026-04-05', maker: 'space-exploration' },
        { title: 'Austrian Biedermeier globe table (globustisch), Vienna, circa 1820', priceUsd: 16_640, house: "Sotheby's", date: '2026-04-14', maker: 'scientific-instruments' },
        { title: 'Apollo 11 first lunar landing — Type I original photograph, NASA (Jul. 20, 1969)', priceUsd: 15_860, house: 'Goldin', date: '2026-04-05', maker: 'space-exploration' },
        { title: 'An 18-inch terrestrial globe by Dudley Adams, London, 1809', priceUsd: 11_648, house: "Sotheby's", date: '2026-06-09', maker: 'scientific-instruments' },
        { title: '"The Blue Marble" — Type I original NASA photograph (Dec. 7, 1972)', priceUsd: 4_270, house: 'Goldin', date: '2026-04-05', maker: 'space-exploration' },
        { title: 'An English brass radius vernier sextant, 19th century', priceUsd: 3_584, house: "Sotheby's", date: '2026-06-24', maker: 'scientific-instruments' },
      ]}
      footnote="A note on hygiene: the raw Q2 science tape carries a run of paintings and design lots that upstream routing mis-filed under scientific instruments and space (works with 'lunar,' 'celestial' or 'astronaut' in the title — a Hockney, a Houseago astronaut sculpture, a Niemeyer bed all surfaced above the real instruments). The top sales above are the cleaned, genuinely scientific set. The demand figures are our engine's per-collection medians over estimate — space +24%, fossils +23%, instruments +2%, meteorites −32% — read against near-complete estimate coverage in this vertical."
    >
      <H>Between the seasons</H>
      <P lede>
        Science doesn&rsquo;t trade continuously the way watches do — it moves in curated seasonal
        sales, and the biggest ones didn&rsquo;t land inside Q2. What cleared was the steady middle
        of the instrument market: <B>a pair of George IV library globes at $38,400</B>, a set of
        George I table globes just behind, an Austrian Biedermeier globustisch, and a Dudley Adams
        terrestrial globe — alongside the vintage NASA photographs that lead the space category any
        quarter they appear. It is a globe-heavy list, which is exactly what a between-the-seasons
        instrument quarter looks like: no headline meteorite, no dinosaur, just the reliable
        cartographic middle of the market doing its quiet business.
      </P>
      <H>First, we cleaned the tape</H>
      <P>
        Before any of those reads are worth anything, the tape has to be honest — and the raw Q2
        science tape was not. Upstream routing had mis-filed a run of paintings and design lots under
        the science collections on the strength of a single word in the title: a <B>David Hockney at
        $482,600</B> and a <B>Thomas Houseago &ldquo;Astronaut&rdquo; sculpture at $123,825</B> landed
        under space; an <B>Oscar Niemeyer bed</B> and a <B>Mattia Bonetti dining table</B> under
        scientific instruments — because &ldquo;lunar,&rdquo; &ldquo;celestial&rdquo; and
        &ldquo;astronaut&rdquo; are as common in art titles as in a NASA caption. Left in, they&rsquo;d
        have put a half-million-dollar painting at the top of the science tape and quietly corrupted
        every demand read below it. We pulled them. The eight lots above are the cleaned set: globes,
        a sextant, and first-generation Apollo photographs — objects that are actually scientific. We
        would rather show a $38,400 globe as our top lot and mean it than a $482,600 Hockney we
        don&rsquo;t.
      </P>
      {/* the pull — lifted verbatim from the paragraph above */}
      <PullQuote>We would rather show a $38,400 globe as our top lot and mean it than a $482,600 Hockney we don&rsquo;t.</PullQuote>
      <H>What demand says, since price can&rsquo;t</H>
      <P>
        These are collectible buckets, not priced cohorts — our engine won&rsquo;t publish an
        appreciation figure here, so we read demand off the estimates, which science actually has
        (near-complete estimate coverage across these collections is what lets us). And demand is
        split: <B>space at +24% and fossils at +23%</B> over estimate are the two hottest reads in the
        vertical, scientific instruments roughly at estimate (+2%), and <B>meteorites soft at
        −32%</B> — the clearest cooling signal science carries right now. Read the sub-market table as
        &ldquo;how far over (or under) the auctioneer&rsquo;s number lots are settling,&rdquo; not as a
        year-on-year price change: the &ldquo;Sales&rdquo; column there is each collection&rsquo;s full
        tracked depth, from a 7,400-lot instrument market down to a thin 204-lot meteorite tape whose
        softness is real but sits on a small base.
      </P>
      <H>The space photographs, up close</H>
      <P>
        The one genuinely space-historical corner Q2 offered was Goldin&rsquo;s April run of Apollo
        Type I photographs. A <B>Type I</B> is a first-generation print struck from the original flight
        film within roughly a year of the mission — the closest a collector gets to the negative, and
        the reason these clear where later reprints don&rsquo;t. The Armstrong-shot Aldrin portrait led
        at $18,910, the NASA landing print followed at $15,860, and the 1972 &ldquo;Blue Marble&rdquo;
        — the whole-earth frame from Apollo 17, one of the most reproduced photographs in history —
        brought $4,270. Modest absolute numbers, but they are the real thing, and in a quarter this thin
        on space material they carried the collection on their own.
      </P>
      <H>Where the records actually sit</H>
      <P>
        None of Q2&rsquo;s clearing lots came near the category ceilings, which is the point: this is
        a records-driven vertical between its records. The standing highs — a <B>$37.1M scientific
        instrument</B>, a <B>$15.9M space lot</B>, and a <B>fossil record a July sale has since pushed
        past $50M</B> (a Tyrannosaurus at Sotheby&rsquo;s on July 14) — are what the seasonal sales
        chase, and they dwarf anything Q2 produced by three orders of magnitude. A caveat we&rsquo;ll
        keep flagging: the two highest all-time &ldquo;science&rdquo; marks still carry the fingerprints
        of the same routing problem we cleaned out of Q2 — the instrument record is titled to a
        Basquiat, the space record to a Turcato canvas — which is precisely why the cleaned tape, not
        the raw ceiling, is the number we trust. The next note in this series, written off one of the
        real summer sales, will have something grounded to say about fossil and meteorite price levels.
      </P>
    </QuarterInsight>
  );
}
