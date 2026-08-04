import React from 'react';
import type { Metadata } from 'next';

// Re-assert indexability for the STATIC flagged set: the parent /lot layout
// carries robots noindex so the universal 200-shell (which Cloudflare serves
// for every rotated-out /lot/* path) never decays into indexable duplicates.
// These prerendered pages ship real titles + self-canonicals and are the ones
// the sitemap points at — they must stay in the index.
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function StaticLotLayout({ children }: { children: React.ReactNode }) {
  return children;
}
