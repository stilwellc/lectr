import { ARTISTS } from '../../constants';

// The roster is finite and known at build time — every maker page prerenders
// as a static file. Without this the whole segment was a λ invocation per
// request (page + OG image), which is what burned through Vercel's Hobby
// fluid-CPU fair-use cap and got the deployment paused. Nothing here needs a
// server: the pages are client components reading static JSON.
export const dynamicParams = false;

export function generateStaticParams() {
  return ARTISTS.map(a => ({ slug: a.slug }));
}

// Sharing /makers/kaws shows KAWS's own line and numbers — the share IS the
// product. The cards are pre-rendered to public/og/<slug>.png by
// scripts/build-og.tsx (dynamic opengraph-image can't ship on a static
// export). OG filenames are unchanged by the /makers move.
export function generateMetadata({ params }: { params: { slug: string } }) {
  const label = ARTISTS.find(a => a.slug === params.slug)?.label || params.slug;
  return {
    title: label,
    openGraph: { title: `${label} — lectr`, images: [`/og/${params.slug}.png`] },
    twitter: { card: 'summary_large_image', images: [`/og/${params.slug}.png`] },
  };
}

export default function MakerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
