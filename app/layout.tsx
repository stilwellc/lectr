import React from 'react';
import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Syne, Space_Mono } from 'next/font/google';
import './globals.css';
import ThemeProvider from './components/ThemeProvider';
import { ARTISTS } from './constants';

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

const syne = Syne({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://ray-one-theta.vercel.app'),
  title: {
    default: 'Ray — Auction Intelligence',
    template: '%s — Ray',
  },
  description: `Auction intelligence for the art market — ${ARTISTS.length} artists tracked across major houses, crawled automatically.`,
  openGraph: {
    title: 'Ray — Auction Intelligence',
    description: `Auction intelligence for the art market — ${ARTISTS.length} artists tracked across major houses, crawled automatically.`,
    siteName: 'Ray',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Ray — Auction Intelligence',
    description: `Auction intelligence for the art market — ${ARTISTS.length} artists tracked across major houses.`,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0D0B08' },
    { media: '(prefers-color-scheme: light)', color: '#F5F0E6' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${cormorant.variable} ${syne.variable} ${spaceMono.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('costil-theme');if(!t)t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`,
          }}
        />
        <style>{`
          /* Every numeric display in Ray uses tabular figures */
          .ray-shell { font-variant-numeric: tabular-nums; }
          /* THE MARKET DRAWS ITSELF — chart bodies wipe in left to right along the
             time axis on first intersection (attribute set by useChartDraw). Keep this
             block free of quotes/apostrophes/angle brackets so hydration stays clean. */
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
          <main id="main" className="ray-shell">{children}</main>
        </ThemeProvider>
        <div className="grain-overlay" aria-hidden="true" />
      </body>
    </html>
  );
}
