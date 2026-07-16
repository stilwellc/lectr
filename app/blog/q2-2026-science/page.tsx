import type { Metadata } from 'next';
import QuarterInsight, { P, H, B } from '../../components/blog/QuarterInsight';

export const metadata: Metadata = {
  title: 'Q2 2026 science market in review — the quiet quarter before the season',
  description: 'Ten lots, an Aldrin-shot Apollo 11 photograph on top, and 241 lots waiting on the block. Science’s Q2 was the off-season — honestly reported.',
};

export default function Q2Science() {
  return (
    <QuarterInsight
      market="science"
      date="July 16, 2026"
      title="Science in Q2: the quiet quarter"
      dek="Ten sales. That’s the honest number — science trades in seasons, and Q2 was the off-season. The interesting part is what it says about how this vertical works, and what’s sitting on the block for Q3."
      stats={[
        { label: 'Total realized', value: '$65.7K', sub: '10 lots sold — yes, ten' },
        { label: 'Median sale', value: '$2,558', sub: 'too thin to trend' },
        { label: 'On the block now', value: '241 lots', sub: 'closing in Q3 — the real season', tone: 'up' },
        { label: 'Top sale', value: '$18,910', sub: 'Apollo 11 Type I photograph' },
      ]}
      headline={{
        image: 'https://d2tt46f3mh26nl.cloudfront.net/public/Lots/202602-0514-5819-e0456ff9-b1c4-4f4f-98bb-1bcf5f9254ee/SF00002634015copy__496bbefb-821d-4844-8756-87738a0f0b24@1x',
        caption: 'Buzz Aldrin on the lunar surface — Type I photograph by Neil Armstrong',
        priceUsd: 18_910,
        house: 'Goldin',
        saleLine: 'April 5, 2026',
        para: <>July 20, 1969: Neil Armstrong points the Hasselblad at Buzz Aldrin, and takes the most famous portrait ever made off-planet — visor reflecting the photographer, the LM, and most of human ambition. This Type I print (made from the original film within about a year) led science&rsquo;s quiet quarter at $18,910. Nearly every image of the first landing shows Aldrin, for a simple reason collectors love: Armstrong held the camera.</>,
      }}
      topSales={[
        { title: 'Buzz Aldrin, Apollo 11 — Type I original photograph by Neil Armstrong (Jul. 20, 1969)', priceUsd: 18_910, house: 'Goldin', date: '2026-04-05', maker: 'space-exploration' },
        { title: 'A rare two-day marine chronometer, single-barrel', priceUsd: 16_640, house: "Sotheby's", date: '2026-06-17', maker: 'scientific-instruments' },
        { title: 'Apollo 11 first lunar landing — Type I original photograph (Jul. 20, 1969)', priceUsd: 15_860, house: 'Goldin', date: '2026-04-05', maker: 'space-exploration' },
        { title: '"The Blue Marble" — Type I original photograph (Dec. 7, 1972)', priceUsd: 4_270, house: 'Goldin', date: '2026-04-05', maker: 'space-exploration' },
      ]}
      footnote="While preparing this note we also audited the vertical’s data and evicted 30 lots that earlier routing had mis-filed under science (skeleton-dial wristwatches are not fossils). The figures above are the cleaned set."
    >
      <H>Ten lots is the honest number</H>
      <P>
        We could dress this up. We won&rsquo;t: across the houses we track, science — meteorites,
        fossils, space artifacts, instruments — concluded <B>ten sales in the entire quarter</B>,
        for $65.7K. This vertical doesn&rsquo;t trade continuously the way watches do; it trades in
        curated seasonal sales, and none of the big ones landed inside Q2. Any &ldquo;trend&rdquo;
        drawn from ten lots would be fiction, so we&rsquo;re not drawing one.
      </P>
      <H>What did trade: the Apollo photographs</H>
      <P>
        The quarter belonged to vintage NASA photography — a <B>Type I original of Buzz Aldrin
        shot by Neil Armstrong</B> on the lunar surface led at $18,910, with a first-lunar-landing
        frame right behind it and <em>The Blue Marble</em> further down. Type I originals (prints
        made from the original film within roughly a year) keep proving they&rsquo;re the
        collectible core of space memorabilia; later-generation prints trade at a fraction.
      </P>
      <H>Q3 is the actual season</H>
      <P>
        The reason to watch this vertical is what&rsquo;s open right now: <B>241 science lots are
        live on the block</B> as this posts — the summer science sales, closing through July. That
        one month will produce more data than the last three combined, and the next note in this
        series will have something real to say about meteorite and fossil price levels.
      </P>
    </QuarterInsight>
  );
}
