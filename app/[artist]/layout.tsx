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

export default function ArtistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
