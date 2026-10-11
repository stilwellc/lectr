import type { Metadata } from 'next';
import TerminalHome from './preview/terminal/TerminalHome';
import { seoMeta } from './lib/seo';
import { SITE_TITLE } from './lib/route-titles';
import { ROSTER_PHRASE } from './constants';

// home's own head: the site title, a self canonical ('/', so the www host and
// any ?query variant consolidate here) and og:url — the root layout keeps NO
// global canonical (audit-urls), so each route names its own
export const metadata: Metadata = seoMeta({
  title: SITE_TITLE,
  absolute: true,
  description: `Auction intelligence for the collectibles market — ${ROSTER_PHRASE} tracked across major houses, crawled nightly.`,
  path: '/',
  imageAlt: 'lectr — auction intelligence for the collectibles market',
});

// The Terminal is the site's main lander. Its full implementation lives in
// app/preview/terminal/TerminalHome.tsx; the legacy /preview/terminal path
// redirects here. The previous homepage is preserved in git (pre-promo d021c3d).
//
// TerminalHome renders its Colophon OUTSIDE its phase-1 loading gate, so the
// crawlable route map (C4 PRE-GA-5) is in the prerendered HTML without a second
// stand-in footer that has to unmount when data lands — that swap was home's
// worst layout shift. See the note at the Colophon call site.
export default function HomePage() {
  return <TerminalHome />;
}
