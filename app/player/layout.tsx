import React from 'react';
import type { Metadata } from 'next';
import { seoMeta } from '../lib/seo';

export const metadata: Metadata = seoMeta({
  title: 'Player dossier',
  description: 'One athlete, the whole market — cards, game-worn and memorabilia read together. lectr auction intelligence.',
  path: '/player',
  // a query shell: no canonical (see seoMeta)
  canonical: false,
});

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
