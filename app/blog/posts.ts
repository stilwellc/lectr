import type { Metadata } from 'next';
import { seoMeta, blogPostingLd, breadcrumbLd, type Ld } from '../lib/seo';

/** the notes on file — the /blog shelf AND each post's dated head (article
 *  meta + BlogPosting structured data) read this one list */
// `href` is the special case — a card that lives outside /blog/* (the systems
// walk-through at /about). Cards without it link to /blog/{slug} as before.
export const POSTS: { slug: string; date: string; title: string; dek: string; href?: string }[] = [
  {
    slug: 'how-lectr-works',
    href: '/about',
    date: '2026-07-17',
    title: 'How lectr works',
    dek: 'The systems walk-through — crawlers, the identity ledger, the engine, and the nightly replay, section by section.',
  },
  {
    slug: 'q3-2026-art',
    date: '2026-10-22',
    title: 'Art in Q3: a thin summer that cleared almost everything',
    dek: 'A $38M quarter, about a third of last summer’s, with no eight-figure lot to carry it. What did come up sold — 92% of it — and nearly half the money arrived in a single late-September week in Hong Kong.',
  },
  {
    slug: 'q3-2026-watches',
    date: '2026-10-22',
    title: 'Watches in Q3: one Hong Kong weekend made the quarter',
    dek: '586 watches sold for $41.1M, four times Q3 2025, but one Sotheby’s Hong Kong sale made $30.1M of it. Strip it out and the summer was flat in dollars, sharper against estimates. Cartier ran hottest.',
  },
  {
    slug: 'q3-2026-design',
    date: '2026-10-22',
    title: 'Design in Q3: the Nakashima quarter',
    dek: 'A quiet summer quarter, nearly all Wright and nearly all Nakashima, and hotter than Q3 2025: the median lot sold at 1.37× its estimate midpoint and 70% beat the high estimate.',
  },
  {
    slug: 'q3-2026-sports',
    date: '2026-10-22',
    title: 'Sports in Q3: Pelé’s World Cup shirt tops a $195M quarter',
    dek: '31,840 lots for $195.5M. A World Cup summer put soccer at the top, Ohtani took two of the three biggest lots, and because these are bid sales we report it by volume and record, not as a return.',
  },
  {
    slug: 'q3-2026-science',
    date: '2026-10-22',
    title: 'Science in Q3: one skeleton was the quarter',
    dek: 'The summer sales arrived and one lot outweighed everything else: a $50.1M Tyrannosaurus. The quarter with him and without him — fossils and space running hot, meteorites soft, and what last July can and can’t tell you.',
  },
  {
    slug: 'q2-2026-art',
    date: '2026-07-16',
    title: 'Art in Q2: trophies cleared, the middle got picky',
    dek: 'A $509M quarter split almost evenly between Sotheby’s and Christie’s — the masterpieces cleared, about a third of everything offered failed to sell, and KAWS kept repricing.',
  },
  {
    slug: 'q2-2026-watches',
    date: '2026-07-16',
    title: 'Watches in Q2: the deepest tape we track',
    dek: '1,811 watches sold for $240M at 97–98% sell-through — and the only vertical where the engine publishes a return: Cartier and Rolex up over five years, Patek down over three.',
  },
  {
    slug: 'q2-2026-design',
    date: '2026-07-16',
    title: 'Design in Q2: small money, real heat',
    dek: 'The smallest market we track posted the strongest demand of the quarter: 69% of sold lots beat their high estimate, Nakashima and Prouvé led, and the commodity end dragged.',
  },
  {
    slug: 'q2-2026-sports',
    date: '2026-07-16',
    title: 'Sports in Q2: the cards led a $126M quarter',
    dek: 'A $2.93M LeBron rookie patch auto on top, a photo-matched Gretzky jersey behind it, 19,296 lots through the quarter — a card-led tape, read by volume and record.',
  },
  {
    slug: 'q2-2026-science',
    date: '2026-07-16',
    title: 'Science in Q2: between the seasons',
    dek: 'Antique globes and Apollo Type I photographs led a cleaned tape — space and fossils ran hot on demand, meteorites soft, and the big seasonal sales land in Q3.',
  },
  {
    slug: 'how-we-built-the-pricing-engine',
    date: '2026-07-24',
    title: 'How we built the price-movement engine',
    dek: 'A per-maker hedonic regression with a confidence gate bolted to the front — the controls, the abstention rules, and why only three makers currently clear the bar.',
  },
];

function postOf(slug: string) {
  const p = POSTS.find(x => x.slug === slug);
  if (!p) throw new Error(`blog post ${slug} is not in app/blog/posts.ts`);
  return p;
}

/** a post's head: its own title + description, self canonical, article
 *  type with the publish date, the site card */
/** the share card a post ships (scripts/build-og.tsx renders it) */
export const postCardPath = (slug: string) => `/og/blog/${slug}.png`;

export function postMeta(slug: string, m: { title: string; description: string }): Metadata {
  const p = postOf(slug);
  return seoMeta({ title: m.title, description: m.description, path: `/blog/${slug}`, type: 'article', publishedTime: p.date, image: postCardPath(slug), imageAlt: p.title });
}

/** a post's structured data: BlogPosting + its breadcrumb */
export function postLd(slug: string, m: { title: string; description: string }): Ld[] {
  const p = postOf(slug);
  const path = `/blog/${slug}`;
  return [
    blogPostingLd({ path, headline: m.title, description: m.description, date: p.date }),
    breadcrumbLd([['lectr', '/'], ['Notes from the desk', '/blog'], [p.title, path]]),
  ];
}
