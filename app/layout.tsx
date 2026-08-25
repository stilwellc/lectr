import React from 'react';
import type { Metadata, Viewport } from 'next';
import { Inter, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import ThemeProvider from './components/ThemeProvider';
import { MarketProvider } from './lib/market';
import { AccountProvider } from './lib/account';
import { ARTISTS } from './constants';

// One voice. Inter carries everything — display numerals, labels, body —
// with tabular figures for anything that counts money.
const inter = Inter({
  subsets: ['latin'],
  // load the VARIABLE font (no fixed weight list) so every weight renders,
  // including the 650/750 used on prominent numerals (static cuts snapped them).
  variable: '--font-inter',
  display: 'swap',
});

// The lander type system (research: serif-for-authority + mono-for-data). Fraunces
// = an editorial "museum voice" display serif (optical sizing, high contrast) for
// headline authority; IBM Plex Mono = terminal-grade tabular figures for all data.
// Exposed as --font-serif-display / --font-mono-data; Inter stays the neutral UI sans.
const serifDisplay = Inter({
  // the display serif is RETIRED (Collin, Aug 25 2026: 'that very specific
  // serif font'). The variable stays so every var(--font-serif-display)
  // consumer resolves to Inter — display surfaces carry weight/tracking
  // overrides in the de-slop block at the end of globals.css.
  subsets: ['latin'],
  variable: '--font-serif-display',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono-data',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://lectr.bid'),
  // NO global canonical: './' collapsed every query/dossier URL onto its bare
  // shell for crawlers (audit-urls); pages declare their own canonicals.
  title: {
    default: 'lectr — auction intelligence',
    template: '%s — lectr',
  },
  description: `Auction intelligence for the collectibles market — ${ARTISTS.length} makers tracked across major houses, crawled nightly.`,
  openGraph: {
    title: 'lectr — auction intelligence',
    description: `Auction intelligence for the collectibles market — ${ARTISTS.length} makers tracked across major houses, crawled nightly.`,
    siteName: 'lectr',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'lectr — auction intelligence',
    description: `Auction intelligence for the collectibles market — ${ARTISTS.length} makers tracked across major houses, crawled nightly.`,
  },
};

export const viewport: Viewport = {
  themeColor: '#0F0E0A',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${serifDisplay.variable} ${plexMono.variable}`}>
      <head>
        {/* Phase-1 data preloads: useRayData fetches these eagerly (no ?v=)
            after hydration — preloading starts the ~1 MB br transfer at t=0.
            crossOrigin="anonymous" matches fetch()'s default cors/same-origin
            credentials mode so the browser reuses the preload (no double
            fetch). upcoming.json dominates phase 1; meta.json versions the
            phase-2 shard URLs, so it must land before phase 2 can start.
            ALL FIVE are preloaded because useRayData awaits them in a single
            Promise.allSettled — first paint gates on the SLOWEST of the set, so
            preloading a subset just makes the unlisted ones (market.json at
            ~243 KB br, stats.json ~65 KB) start late and become the gate. */}
        <link rel="preload" href="/data/ray/upcoming.json" as="fetch" crossOrigin="anonymous" />
        <link rel="preload" href="/data/ray/market.json" as="fetch" crossOrigin="anonymous" />
        <link rel="preload" href="/data/ray/stats.json" as="fetch" crossOrigin="anonymous" />
        <link rel="preload" href="/data/ray/meta.json" as="fetch" crossOrigin="anonymous" />
        <link rel="preload" href="/data/ray/backtest.json" as="fetch" crossOrigin="anonymous" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{document.documentElement.setAttribute('data-theme','dark')}catch(e){}})();`,
          }}
        />
        <style>{`
          .ray-shell { font-variant-numeric: tabular-nums; }
          .ray-chart-draw .recharts-area,
          .ray-chart-draw .recharts-line { clip-path: inset(0 100% 0 0); }
          .ray-chart-draw[data-drawn=true] .recharts-area,
          .ray-chart-draw[data-drawn=true] .recharts-line {
            clip-path: inset(0 0 0 0);
            transition: clip-path 800ms var(--ease-signature);
          }
          .ray-save-btn {
            transition:
              background var(--duration-fast) var(--ease-signature),
              border-color var(--duration-fast) var(--ease-signature),
              transform 120ms var(--ease-signature);
          }
          .ray-save-btn:active { transform: scale(0.88); }
          @media (prefers-reduced-motion: reduce) {
            .ray-chart-draw .recharts-area,
            .ray-chart-draw .recharts-line { clip-path: none; }
            .ray-save-btn:active { transform: none; }
          }
        `}</style>
      </head>
      <body style={{ margin: 0, padding: 0 }}>
        <a href="#main" className="skip-link">Skip to content</a>
        <ThemeProvider>
          <MarketProvider>
            <AccountProvider>
              <main id="main" className="ray-shell">{children}</main>
            </AccountProvider>
          </MarketProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
