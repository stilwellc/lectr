import React from 'react';
import type { Metadata } from 'next';

// Default metadata for the universal query route (/lot?id=…) — the static
// flagged pages ([id]) override this per lot via generateMetadata.
export const metadata: Metadata = {
  title: 'Lot',
  description: 'One lot, read against every comparable hammer — lectr auction intelligence.',
};

export default function LotLayout({ children }: { children: React.ReactNode }) {
  return children;
}
