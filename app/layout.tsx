import React from 'react';
import type { Metadata, Viewport } from 'next';
import { Inter, Fraunces, IBM_Plex_Mono, Caveat } from 'next/font/google';
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
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-serif-display',
  display: 'swap',
  axes: ['opsz', 'SOFT', 'WONK'],
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono-data',
  display: 'swap',
});

// The script accent — the closest webfont voice to the hand-drawn lectr mark.
// Speaks ONLY in the two "curated card" rooms (verified board / record board).
const script = Caveat({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-script',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://lectr.bid'),
  alternates: { canonical: './' },
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
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${fraunces.variable} ${plexMono.variable} ${script.variable}`}>
      <head>
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
