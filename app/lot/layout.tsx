import React from 'react';
import type { Metadata } from 'next';

// Default metadata for the universal query route (/lot?id=…) — the static
// flagged pages ([id]) override this per lot via generateMetadata.
// NOINDEX: the Cloudflare rewrite serves this shell with a 200 for EVERY
// /lot/* path, so rotated-out lot URLs from yesterday's sitemap would decay
// into indexable duplicate "Lot — lectr" pages (audit C4 pre-GA-6). The
// static flagged set re-asserts index:true in [id]/layout.tsx — those pages
// carry real titles + canonicals and must stay indexable.
export const metadata: Metadata = {
  title: 'Lot',
  description: 'One lot, read against every comparable hammer — lectr auction intelligence.',
  robots: { index: false, follow: true },
};

export default function LotLayout({ children }: { children: React.ReactNode }) {
  return children;
}
