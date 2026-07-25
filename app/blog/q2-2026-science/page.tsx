import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';

export const metadata: Metadata = {
  title: 'Q2 2026 science market in review — instruments and space, between the seasons',
  description: 'A pair of George IV globes on top of the clean instrument tape, an Aldrin-shot Apollo 11 photograph leading the space lots, and demand — not a fabricated return — doing the talking. Science’s Q2, honestly reported.',
};

export default function Q2Science() {
  return (
    <QuarterInsight
      market="science"
      date="July 16, 2026"
      title="Science in Q2: instruments and space, between the seasons"
      dek="Science trades in curated seasonal sales, and Q2 fell between the big ones. What did clear — antique globes, a marine chronometer, vintage NASA photographs — plus where demand actually sits: space and fossils running hot, meteorites soft."
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
        para: <>July 20, 1969: Neil Armstrong points the Hasselblad at Buzz Aldrin and takes the most famous portrait ever made off-planet — visor reflecting the photographer, the LM, and most of human ambition. This Type I print (made from the original film within about a year) led science&rsquo;s quiet quarter for space material at $18,910. Nearly every image of the first landing shows Aldrin, for a simple reason collectors love: Armstrong held the camera.</>,
      }}
      topSales={[
        { title: 'A pair of George IV 18-inch terrestrial & celestial library globes, John Smith', priceUsd: 38_400, house: "Sotheby's", date: '2026-04-14', maker: 'scientific-instruments' },
        { title: 'A pair of George I nine-inch terrestrial & celestial table globes, John Senex', priceUsd: 35_840, house: "Sotheby's", date: '2026-04-14', maker: 'scientific-instruments' },
        { title: 'Buzz Aldrin, Apollo 11 — Type I original photograph by Neil Armstrong (Jul. 20, 1969)', priceUsd: 18_910, house: 'Goldin', date: '2026-04-05', maker: 'space-exploration' },
        { title: 'Apollo 11 first lunar landing — Type I original photograph (Jul. 20, 1969)', priceUsd: 15_860, house: 'Goldin', date: '2026-04-05', maker: 'space-exploration' },
        { title: 'An 18-inch terrestrial globe by Dudley Adams, London, 1809', priceUsd: 11_648, house: "Sotheby's", date: '2026-06-09', maker: 'scientific-instruments' },
      ]}
      footnote="A note on hygiene: the raw Q2 science tape carries a run of paintings and design lots that upstream routing mis-filed under scientific instruments and space (works with 'lunar,' 'celestial' or 'astronaut' in the title). The top sales above are the cleaned, genuinely scientific set; the demand reads are our engine's per-collection figures."
    >
      <H>Between the seasons</H>
      <P>
        Science doesn&rsquo;t trade continuously the way watches do — it moves in curated seasonal
        sales, and the biggest ones didn&rsquo;t land inside Q2. What cleared was the steady middle
        of the instrument market: <B>a pair of George IV library globes at $38,400</B>, a set of
        George I table globes just behind, and a Dudley Adams terrestrial globe — alongside the
        vintage NASA photographs that lead the space category any quarter they appear.
      </P>
      <H>What demand says, since price can&rsquo;t</H>
      <P>
        These are collectible buckets, not priced cohorts — our engine won&rsquo;t publish an
        appreciation figure here, so we read demand off the estimates. And demand is split:
        <B> space at +24% and fossils at +23%</B> over estimate are the two hottest reads in the
        vertical, scientific instruments roughly at estimate (+2%), and <B>meteorites soft at
        −32%</B> — the clearest cooling signal science carries right now.
      </P>
      <H>Where the records actually sit</H>
      <P>
        None of Q2&rsquo;s clearing lots came near the category ceilings, which is the point: this is
        a records-driven vertical between its records. The standing highs — a $37.1M scientific
        instrument, a $15.9M space lot, and a fossil record that a summer sale has since pushed past
        $50M — are what the seasonal sales chase. The next note in this series, written off one of
        those sales, will have something real to say about meteorite and fossil price levels.
      </P>
    </QuarterInsight>
  );
}
