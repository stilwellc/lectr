import { ARTISTS } from '../constants';

// The roster is finite and known at build time — every artist page prerenders
// as a static file. Without this the whole segment was a λ invocation per
// request (page + OG image), which is what burned through Vercel's Hobby
// fluid-CPU fair-use cap and got the deployment paused. Nothing here needs a
// server: the pages are client components reading static JSON.
export const dynamicParams = false;

export function generateStaticParams() {
  return ARTISTS.map(a => ({ artist: a.slug }));
}

// Sharing /kaws shows KAWS's own line and numbers — the share IS the product.
// The cards are pre-rendered to public/og/<slug>.png by scripts/build-og.tsx
// (dynamic opengraph-image can't ship on a static export).
export function generateMetadata({ params }: { params: { artist: string } }) {
  const label = ARTISTS.find(a => a.slug === params.artist)?.label || params.artist;
  return {
    title: label,
    openGraph: { title: `${label} — lectr`, images: [`/og/${params.artist}.png`] },
    twitter: { card: 'summary_large_image', images: [`/og/${params.artist}.png`] },
  };
}

export default function ArtistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
